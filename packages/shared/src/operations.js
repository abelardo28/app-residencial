// Operaciones del residencial: la única fuente de reglas de negocio.
// La API las ejecuta en el servidor (fuente de verdad). El modo demo de la APP las ejecuta en el navegador.
//
// Cada operación declara qué roles pueden ejecutarla y recibe:
//   t     ayudantes de escritura (ver tx.js)
//   ctx   { user, sign, trusted } — `user` es quien ejecuta; `trusted` son datos verificados por el servidor
//   input un objeto ya validado (la API valida forma y tipos con zod antes de llegar aquí)
// Los campos que no debe decidir el cliente (ids, autor, estado, fechas) siempre se escriben después del input.
import { uid, nowIso, shortCode, numericCode, money, monthLabel, fmtTime } from './format.js';
import { buildToken, evaluatePass, parseInput, normalizePlate, PASS_TYPES } from './access.js';
import { debtRestriction, payableRows, unitByReference, unitReference } from './ledger.js';
import { GATE_OPERATIONS, openAfterEntry } from './gate.js';
import { whatsappMessages } from './whatsapp.js';
import { DomainError, forbidden } from './tx.js';

const RESIDENT = ['resident'];
const GUARD = ['guard'];
const ADMIN = ['admin'];
const STAFF = ['guard', 'admin'];
const ALL = ['resident', 'guard', 'admin'];

/** Filas pagables de los meses pedidos, o error si alguno ya está pagado o en revisión. */
function rowsFor(t, unitId, periods) {
  const rows = new Map(payableRows(t.next, unitId).map((r) => [r.month, r]));
  const list = [...new Set(periods)];
  if (!list.length || list.some((p) => !rows.has(p)))
    throw new DomainError('Alguno de los meses ya está pagado o en revisión.', 409, 'period_unavailable');
  return list.sort().map((p) => rows.get(p));
}
const paymentOf = (row, data) => ({
  id: uid('pay_'),
  concept: row.lateFee ? 'Cuota de mantenimiento + recargo' : 'Cuota de mantenimiento',
  period: row.month,
  amount: row.amount,
  lateFee: row.lateFee,
  createdAt: nowIso(),
  ...data,
});
const bankMovements = (t) => t.next.bankMovements || (t.next.bankMovements = []);

/** Hora de un registro hecho sin conexión: se acepta hasta 72 h atrás y nunca en el futuro. */
function offlineTime(iso) {
  const at = new Date(iso).getTime();
  const now = Date.now();
  if (!(at <= now + 60e3 && at >= now - 72 * 3600e3)) throw new DomainError('La hora del registro sin conexión no es válida.');
  return new Date(Math.min(at, now)).toISOString();
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

const noticeAudience = (notice, user) =>
  user.role === 'admin' ||
  (user.role === 'guard' && ['staff', 'all'].includes(notice.audience)) ||
  (user.role === 'resident' && notice.audience !== 'staff');

export const OPERATIONS = {
  // ---------- Notificaciones ----------
  markRead: {
    roles: ALL,
    run(t, { user }, { id }) {
      const n = t.must('notifications', id, 'La notificación');
      if (n.userId !== user.id) throw forbidden();
      t.patch('notifications', id, { read: true });
    },
  },
  markAllRead: {
    roles: ALL,
    run(t, { user }) {
      t.next.notifications = t.next.notifications.map((n) => (n.userId === user.id && !n.read ? { ...n, read: true } : n));
    },
  },

  // ---------- Pases de acceso ----------
  createPass: {
    roles: RESIDENT,
    run(t, { user, sign }, input) {
      if (new Date(input.validTo) <= new Date(input.validFrom)) throw new DomainError('La vigencia debe terminar después de iniciar.');
      if (input.mode && input.mode !== 'single') {
        const blocked = debtRestriction(t.next, user.unitId, 'recurrentPasses');
        if (blocked) throw new DomainError(blocked, 403, 'debt_restricted');
      }
      const pass = {
        maxUses: 1,
        days: [],
        timeFrom: '00:00',
        timeTo: '23:59',
        ...input,
        expectedPlate: normalizePlate(input.expectedPlate),
        id: uid('p_'),
        code: shortCode(),
        residentId: user.id,
        unitId: user.unitId,
        uses: [],
        status: 'active',
        createdAt: nowIso(),
      };
      pass.token = buildToken(pass, sign);
      return t.add('passes', pass);
    },
  },
  revokePass: {
    roles: RESIDENT,
    run(t, { user }, { id }) {
      const pass = t.must('passes', id, 'El pase');
      if (pass.residentId !== user.id) throw forbidden('Sólo quien creó el pase puede cancelarlo.');
      t.patch('passes', id, { status: 'revoked' });
    },
  },

  // Busca y valida lo que escanea o teclea el vigilante. No modifica datos.
  checkCode: {
    roles: GUARD,
    run(t, { sign }, { text }) {
      const parsed = parseInput(text, sign);
      let pass = null;
      if (parsed.kind === 'token') {
        if (!parsed.signatureOk) return { ok: false, reason: 'Código alterado o no emitido por este residencial' };
        pass = t.get('passes', parsed.id) || null;
      } else {
        if (parsed.code.length < 4) return { ok: false, reason: 'Escribe el código completo' };
        pass = t.next.passes.find((p) => p.code === parsed.code) || null;
      }
      return { pass, ...evaluatePass(pass) };
    },
  },

  // ---------- Accesos ----------
  registerEntry: {
    roles: GUARD,
    run(t, { user }, { passId, visitorName, type, unitId, plate, photo, notes, companions = 0, offlineAt, openGate }) {
      const pass = passId ? t.must('passes', passId, 'El pase') : null;
      // Registro hecho sin internet en la tablet: la visita ya entró, así que no se rechaza; si el pase
      // ya no era válido (por ejemplo, se usó dos veces) se marca y se avisa a administración.
      const at = offlineAt ? offlineTime(offlineAt) : nowIso();
      let offlineConflict = null;
      if (pass) {
        const check = evaluatePass(pass, new Date(at));
        if (!check.ok && !offlineAt) throw new DomainError(check.reason, 409, 'pass_invalid');
        if (!check.ok) offlineConflict = check.reason;
      } else {
        if (!visitorName?.trim()) throw new DomainError('Escribe el nombre del visitante.');
        if (!t.next.units.some((u) => u.id === unitId)) throw new DomainError('Elige un domicilio válido.');
      }
      const cleanPlate = normalizePlate(plate);
      const plateMatch = pass?.expectedPlate && cleanPlate ? pass.expectedPlate === cleanPlate : null;
      const log = {
        id: uid('a_'),
        kind: pass ? 'pass' : 'walkin',
        passId: pass?.id || null,
        visitorName: pass?.visitorName || visitorName.trim(),
        type: pass?.type || type,
        unitId: pass?.unitId || unitId,
        plate: cleanPlate,
        plateMatch,
        photo,
        notes,
        companions,
        guardId: user.id,
        at,
        exitAt: null,
        ...(offlineAt ? { offline: true, syncedAt: nowIso(), offlineConflict } : {}),
      };
      t.add('accessLogs', log);
      if (offlineConflict)
        t.notify(t.admins(), {
          title: 'Revisa un acceso sin conexión',
          body: `${log.visitorName} entró a las ${fmtTime(at)} sin internet en caseta, pero el pase no era válido: ${offlineConflict}.`,
          kind: 'alert',
          link: '/accesos',
        });
      if (pass) t.patch('passes', pass.id, (p) => ({ uses: [...p.uses, { at: log.at, guardId: user.id, logId: log.id }] }));
      const who = PASS_TYPES[log.type] || log.type;
      t.notify(t.unitResidents(log.unitId), {
        title: `Ingresó ${log.visitorName}`,
        body: `${who} · ${fmtTime(log.at)}${cleanPlate ? ` · placa ${cleanPlate}` : ''}${pass ? '' : ' · sin pase previo'}`,
        kind: 'access',
        link: '/accesos',
      });
      if (plateMatch === false) {
        t.notify([...t.unitResidents(log.unitId), ...t.admins()], {
          title: 'Placa distinta a la registrada',
          body: `${log.visitorName} llegó con placa ${cleanPlate}; el pase indicaba ${pass.expectedPlate}.`,
          kind: 'alert',
          link: '/accesos',
        });
      }
      if (!offlineAt) openAfterEntry(t, user, log, openGate);
      return log;
    },
  },
  registerExit: {
    roles: GUARD,
    run(t, _ctx, { id }) {
      const log = t.must('accessLogs', id, 'El registro');
      if (log.exitAt) return;
      t.patch('accessLogs', id, { exitAt: nowIso() });
      if (log.unitId)
        t.notify(t.unitResidents(log.unitId), {
          title: `Salió ${log.visitorName}`,
          body: `Registrado a las ${fmtTime(new Date())}`,
          kind: 'access',
          link: '/accesos',
        });
    },
  },
  // Acceso general (basura, pipa, gas...) que se avisa a todos los residentes.
  generalAccess: {
    roles: GUARD,
    run(t, { user }, { provider, plate, photo, notes }) {
      const log = {
        id: uid('a_'),
        kind: 'general',
        visitorName: provider,
        type: 'general',
        unitId: null,
        plate: normalizePlate(plate),
        photo,
        notes,
        guardId: user.id,
        at: nowIso(),
        exitAt: null,
      };
      t.add('accessLogs', log);
      t.notify(t.residents(), {
        title: `${provider} en el residencial`,
        body: `Ingresó a las ${fmtTime(log.at)}${notes ? ` · ${notes}` : ''}`,
        kind: 'general',
        link: '/accesos',
      });
      return log;
    },
  },

  // ---------- Pagos ----------
  submitPayment: {
    roles: RESIDENT,
    run(t, { user, trusted }, { periods, method, receipt, reference, ecartpayId, notes }) {
      const rows = rowsFor(t, user.unitId, periods);
      const list = rows.map((r) => r.month);
      const total = rows.reduce((sum, r) => sum + r.amount, 0);
      // Un pago con Ecart Pay sólo se aprueba si el servidor confirmó el cobro (y su monto) con el proveedor.
      const verified = method === 'ecartpay';
      if (
        verified &&
        (trusted?.ecartpay?.id !== ecartpayId || (trusted.ecartpay.amount !== undefined && trusted.ecartpay.amount !== total))
      )
        throw new DomainError('No pudimos confirmar el pago con Ecart Pay.', 402, 'payment_unverified');
      if (method === 'transfer' && !receipt) throw new DomainError('Adjunta el comprobante de la transferencia.');
      const now = nowIso();
      const created = rows.map((row) =>
        paymentOf(row, {
          residentId: user.id,
          unitId: user.unitId,
          method,
          status: verified ? 'approved' : 'pending',
          reference: reference || '',
          ecartpayId: ecartpayId || null,
          receipt: receipt || null,
          notes: notes || '',
          ...(verified ? { reviewedBy: 'ecartpay', reviewedAt: now } : {}),
        }),
      );
      const names = list.map(monthLabel).join(', ');
      created.forEach((p) => t.add('payments', p));
      const unit = t.unitLabel(user.unitId);
      if (verified) {
        t.notify(t.admins(), {
          title: 'Pago recibido con Ecart Pay',
          body: `${user.name} · ${unit} pagó ${money(total)} (${names}).`,
          kind: 'payment',
          link: '/pagos',
        });
        t.notify([user.id], {
          title: 'Pago aprobado',
          body: `Ecart Pay confirmó tu pago de ${money(total)} (${names}).`,
          kind: 'payment',
          link: '/pagos',
        });
      } else {
        const how = method === 'cash' ? 'reportó un pago en efectivo' : 'subió un comprobante';
        t.notify(t.admins(), {
          title: method === 'cash' ? 'Pago en efectivo por confirmar' : 'Comprobante por revisar',
          body: `${user.name} · ${unit} ${how} de ${money(total)} (${names}).`,
          kind: 'payment',
          link: '/pagos',
        });
      }
      return created;
    },
  },
  reviewPayment: {
    roles: ADMIN,
    run(t, { user }, { id, status, note }) {
      const p = t.must('payments', id, 'El pago');
      if (p.status !== 'pending') throw new DomainError('Este pago ya fue revisado.', 409, 'already_reviewed');
      t.patch('payments', id, { status, reviewNote: note || '', reviewedBy: user.id, reviewedAt: nowIso() });
      t.notify([p.residentId], {
        title: status === 'approved' ? 'Pago aprobado' : 'Pago rechazado',
        body:
          status === 'approved'
            ? `Tu pago de ${monthLabel(p.period)} por ${money(p.amount)} fue aprobado.`
            : `Tu pago de ${monthLabel(p.period)} fue rechazado${note ? `: ${note}` : '.'}`,
        kind: 'payment',
        link: '/pagos',
      });
      t.audit({
        action: status === 'approved' ? 'Pago aprobado' : 'Pago rechazado',
        target: `${t.userName(p.residentId)} · ${monthLabel(p.period)}`,
      });
    },
  },
  // El administrador registra un cobro en efectivo recibido en oficina.
  registerCashPayment: {
    roles: ADMIN,
    run(t, { user }, { residentId, periods, reference }) {
      const r = t.must('users', residentId, 'El residente');
      if (r.role !== 'resident') throw new DomainError('Sólo se registran pagos de residentes.');
      const rows = rowsFor(t, r.unitId, periods);
      const now = nowIso();
      rows.forEach((row) =>
        t.add(
          'payments',
          paymentOf(row, {
            residentId,
            unitId: r.unitId,
            method: 'cash',
            status: 'approved',
            reference: reference || 'Recibo de caja',
            reviewedBy: user.id,
            reviewedAt: now,
          }),
        ),
      );
      t.notify([residentId], {
        title: 'Pago en efectivo registrado',
        body: `Administración registró tu pago de ${periods.map(monthLabel).join(', ')}.`,
        kind: 'payment',
        link: '/pagos',
      });
      t.audit({ action: 'Pago en efectivo registrado', target: `${r.name} · ${periods.map(monthLabel).join(', ')}` });
    },
  },
  sendReminder: {
    roles: ADMIN,
    run(t, _ctx, { residentIds }) {
      const valid = residentIds.filter((id) => t.get('users', id)?.role === 'resident');
      t.notify(valid, {
        title: 'Recordatorio de pago',
        body: 'Tienes cuotas de mantenimiento pendientes. Puedes pagar con Ecart Pay desde la app.',
        kind: 'payment',
        link: '/pagos',
      });
      const org = t.next.settings.name;
      const owed = (u) => money(payableRows(t.next, u.unitId).reduce((sum, r) => sum + r.amount, 0));
      t.send(
        whatsappMessages(
          t.next,
          valid.map((id) => t.get('users', id)),
          {
            kind: 'reminder',
            body: (u) =>
              `${org}: hola ${u.name.split(' ')[0]}, tienes un saldo pendiente de ${owed(u)}. Paga por SPEI con tu referencia ${unitReference(t.next, u.unitId)} o responde *2* para ver los datos de pago.`,
            params: (u) => [u.name.split(' ')[0], org, owed(u), unitReference(t.next, u.unitId)],
          },
        ),
      );
      return { sent: valid.length };
    },
  },

  // ---------- Cobranza ----------
  // Condona el recargo de un mes vencido (la cuota se sigue debiendo).
  waiveLateFee: {
    roles: ADMIN,
    run(t, _ctx, { unitId, period }) {
      const unit = t.must('units', unitId, 'La casa');
      if (!(unit.waivedLateFees || []).includes(period))
        t.patch('units', unitId, { waivedLateFees: [...(unit.waivedLateFees || []), period] });
      t.audit({ action: 'Recargo condonado', target: `${unit.label} · ${monthLabel(period)}` });
    },
  },

  /**
   * Concilia los depósitos de un estado de cuenta. Por cada depósito:
   *  1. busca la casa por su referencia de 7 dígitos;
   *  2. si la casa subió comprobantes en revisión por el mismo monto, los aprueba;
   *  3. si no, aplica el depósito a los meses más antiguos que debe cuando el monto coincide exacto;
   *  4. lo demás queda "por asignar" para que administración decida.
   * Los depósitos ya importados se reconocen por su id y no se vuelven a aplicar.
   */
  reconcileBank: {
    roles: ADMIN,
    run(t, { user }, { movements }) {
      const known = new Set(bankMovements(t).map((m) => m.id));
      const summary = { matched: 0, unmatched: 0, duplicates: 0, total: 0 };
      const now = nowIso();
      for (const mv of movements) {
        if (known.has(mv.id)) {
          summary.duplicates++;
          continue;
        }
        known.add(mv.id);
        const record = { ...mv, importedAt: now, importedBy: user.id, status: 'unmatched', unitId: null, paymentIds: [], reason: '' };
        const unit = unitByReference(t.next, mv.reference);
        if (!unit) {
          record.reason = mv.reference ? 'La referencia no corresponde a ninguna casa' : 'El depósito no trae referencia';
        } else {
          record.unitId = unit.id;
          const pending = t.next.payments.filter((p) => p.unitId === unit.id && p.status === 'pending');
          const pendingTotal = pending.reduce((s, p) => s + p.amount, 0);
          if (pending.length && pendingTotal === mv.amount) {
            pending.forEach((p) =>
              t.patch('payments', p.id, { status: 'approved', reviewedBy: 'conciliacion', reviewedAt: now, bankMovementId: mv.id }),
            );
            record.paymentIds = pending.map((p) => p.id);
          } else {
            const owed = payableRows(t.next, unit.id);
            const take = [];
            let sum = 0;
            for (const row of owed) {
              if (sum + row.amount > mv.amount) break;
              take.push(row);
              sum += row.amount;
            }
            if (take.length && sum === mv.amount) {
              const residentId = t.next.users.find((u) => u.role === 'resident' && u.unitId === unit.id)?.id || null;
              for (const row of take) {
                const p = paymentOf(row, {
                  residentId,
                  unitId: unit.id,
                  method: 'transfer',
                  status: 'approved',
                  reference: mv.reference,
                  notes: mv.description,
                  reviewedBy: 'conciliacion',
                  reviewedAt: now,
                  bankMovementId: mv.id,
                });
                t.add('payments', p);
                record.paymentIds.push(p.id);
              }
            } else {
              record.reason = owed.length
                ? `El monto no coincide con lo que debe la casa (${money(owed.reduce((s, r) => s + r.amount, 0))})`
                : 'La casa no tiene adeudo';
            }
          }
          if (record.paymentIds.length) {
            record.status = 'matched';
            const periods = t.next.payments.filter((p) => record.paymentIds.includes(p.id)).map((p) => monthLabel(p.period));
            t.notify(t.unitResidents(unit.id), {
              title: 'Recibimos tu transferencia',
              body: `Se aplicó tu depósito de ${money(mv.amount)} a ${periods.join(', ')}.`,
              kind: 'payment',
              link: '/pagos',
            });
          }
        }
        if (record.status === 'matched') {
          summary.matched++;
          summary.total += mv.amount;
        } else summary.unmatched++;
        t.add('bankMovements', record);
      }
      t.audit({
        action: 'Estado de cuenta conciliado',
        target: `${summary.matched} aplicados · ${summary.unmatched} por asignar · ${summary.duplicates} repetidos`,
      });
      return summary;
    },
  },
  // Administración aplica a mano un depósito que la conciliación no pudo asignar.
  assignBankMovement: {
    roles: ADMIN,
    run(t, { user }, { id, unitId, periods }) {
      const mv = t.must('bankMovements', id, 'El depósito');
      if (mv.status !== 'unmatched') throw new DomainError('Este depósito ya se procesó.', 409, 'already_processed');
      const unit = t.must('units', unitId, 'La casa');
      const rows = rowsFor(t, unitId, periods);
      const total = rows.reduce((sum, r) => sum + r.amount, 0);
      if (total > mv.amount)
        throw new DomainError(`Los meses elegidos suman ${money(total)} y el depósito es de ${money(mv.amount)}.`, 409, 'amount_exceeded');
      const now = nowIso();
      const residentId = t.next.users.find((u) => u.role === 'resident' && u.unitId === unitId)?.id || null;
      const created = rows.map((row) =>
        paymentOf(row, {
          residentId,
          unitId,
          method: 'transfer',
          status: 'approved',
          reference: mv.reference,
          notes: mv.description,
          reviewedBy: user.id,
          reviewedAt: now,
          bankMovementId: id,
        }),
      );
      created.forEach((p) => t.add('payments', p));
      t.patch('bankMovements', id, {
        status: 'matched',
        unitId,
        paymentIds: created.map((p) => p.id),
        reason: '',
        assignedBy: user.id,
        surplus: mv.amount - total, // saldo a favor de la casa, por aclarar
      });
      t.notify(t.unitResidents(unitId), {
        title: 'Recibimos tu transferencia',
        body: `Se aplicó tu depósito de ${money(mv.amount)} a ${rows.map((r) => monthLabel(r.month)).join(', ')}.`,
        kind: 'payment',
        link: '/pagos',
      });
      t.audit({ action: 'Depósito asignado manualmente', target: `${unit.label} · ${money(mv.amount)}` });
    },
  },
  ignoreBankMovement: {
    roles: ADMIN,
    run(t, { user }, { id }) {
      const mv = t.must('bankMovements', id, 'El depósito');
      if (mv.status !== 'unmatched') throw new DomainError('Este depósito ya se procesó.', 409, 'already_processed');
      t.patch('bankMovements', id, { status: 'ignored', ignoredBy: user.id });
      t.audit({ action: 'Depósito descartado', target: `${mv.date} · ${money(mv.amount)}` });
    },
  },

  // ---------- Avisos ----------
  createNotice: {
    roles: ADMIN,
    run(t, { user }, input) {
      const notice = {
        audience: 'residents',
        attachments: [],
        ...input,
        id: uid('n_'),
        authorId: user.id,
        createdAt: nowIso(),
        readBy: [],
        confirmations: {},
      };
      t.add('notices', notice);
      const targets =
        notice.audience === 'staff' ? t.guards() : notice.audience === 'all' ? [...t.residents(), ...t.guards()] : t.residents();
      t.notify(targets, {
        title: `${notice.category === 'urgente' ? 'Urgente: ' : 'Nuevo aviso: '}${notice.title}`,
        body: notice.body.slice(0, 120),
        kind: 'notice',
        link: '/avisos',
      });
      if (notice.audience !== 'staff') {
        const org = t.next.settings.name;
        const summary = notice.body.length > 300 ? `${notice.body.slice(0, 300)}…` : notice.body;
        t.send(
          whatsappMessages(
            t.next,
            targets.map((id) => t.get('users', id)).filter((u) => u.role === 'resident'),
            {
              kind: 'notice',
              body: `*${org}*\n${notice.title}\n\n${summary}\n\nResponde *3* para ver los avisos recientes.`,
              params: [org, notice.title, summary],
            },
          ),
        );
      }
      return notice;
    },
  },
  deleteNotice: {
    roles: ADMIN,
    run(t, _ctx, { id }) {
      t.must('notices', id, 'El aviso');
      t.remove('notices', id);
    },
  },
  markNoticeRead: {
    roles: ALL,
    run(t, { user }, { id }) {
      const n = t.must('notices', id, 'El aviso');
      if (!noticeAudience(n, user)) throw forbidden();
      if (!n.readBy.includes(user.id)) t.patch('notices', id, { readBy: [...n.readBy, user.id] });
    },
  },
  confirmNotice: {
    roles: RESIDENT,
    run(t, { user }, { id, answer }) {
      const n = t.must('notices', id, 'El aviso');
      if (!noticeAudience(n, user)) throw forbidden();
      t.patch('notices', id, (x) => ({
        confirmations: { ...x.confirmations, [user.id]: answer },
        readBy: x.readBy.includes(user.id) ? x.readBy : [...x.readBy, user.id],
      }));
    },
  },

  // ---------- Reservaciones ----------
  createReservation: {
    roles: RESIDENT,
    run(t, { user }, input) {
      const blocked = debtRestriction(t.next, user.unitId, 'reservations');
      if (blocked) throw new DomainError(blocked, 403, 'debt_restricted');
      const am = t.next.settings.amenities.find((a) => a.id === input.amenityId);
      if (!am) throw new DomainError('Elige un área válida.');
      if (input.from >= input.to) throw new DomainError('La hora de fin debe ser posterior al inicio.');
      if (input.from < am.open || input.to > am.close) throw new DomainError(`${am.name} abre de ${am.open} a ${am.close}.`);
      if (input.guests > am.capacity) throw new DomainError(`${am.name} admite hasta ${am.capacity} personas.`);
      const clash = t.next.reservations.find(
        (r) =>
          r.status !== 'cancelled' && r.amenityId === input.amenityId && r.date === input.date && r.from < input.to && input.from < r.to,
      );
      if (clash) throw new DomainError(`Ese horario ya está reservado (${clash.from}–${clash.to}).`, 409, 'slot_taken');
      const res = { ...input, id: uid('r_'), residentId: user.id, unitId: user.unitId, status: 'approved', createdAt: nowIso() };
      t.add('reservations', res);
      t.notify(t.admins(), {
        title: 'Nueva reservación',
        body: `${user.name} reservó ${am.name} el ${input.date} de ${input.from} a ${input.to}.`,
        kind: 'reservation',
        link: '/reservas',
      });
      return res;
    },
  },
  cancelReservation: {
    roles: ['resident', 'admin'],
    run(t, { user }, { id }) {
      const r = t.must('reservations', id, 'La reservación');
      if (user.role === 'resident' && r.residentId !== user.id) throw forbidden();
      t.patch('reservations', id, { status: 'cancelled' });
    },
  },

  // ---------- Reportes ----------
  createIncident: {
    roles: RESIDENT,
    run(t, { user }, input) {
      const inc = {
        ...input,
        id: uid('i_'),
        residentId: user.id,
        unitId: user.unitId,
        status: 'abierta',
        createdAt: nowIso(),
        comments: [],
      };
      t.add('incidents', inc);
      t.notify(t.admins(), { title: 'Nuevo reporte', body: `${user.name}: ${input.title}`, kind: 'incident', link: '/reportes' });
      return inc;
    },
  },
  updateIncident: {
    roles: ['resident', 'admin'],
    run(t, { user }, { id, status, comment }) {
      const inc = t.must('incidents', id, 'El reporte');
      if (user.role === 'resident') {
        if (inc.residentId !== user.id) throw forbidden();
        if (status && status !== inc.status) throw forbidden('Sólo administración cambia el estado del reporte.');
      }
      t.patch('incidents', id, (x) => ({
        status: status || x.status,
        comments: comment ? [...x.comments, { id: uid('c_'), userId: user.id, text: comment, at: nowIso() }] : x.comments,
      }));
      const labels = { abierta: 'Abierto', en_proceso: 'En proceso', resuelta: 'Resuelto' };
      const target = user.role === 'resident' ? t.admins() : [inc.residentId];
      t.notify(target, {
        title: `Reporte: ${inc.title}`,
        body: status && status !== inc.status ? `Estado: ${labels[status]}${comment ? ` · ${comment}` : ''}` : comment,
        kind: 'incident',
        link: '/reportes',
      });
    },
  },

  // ---------- Paquetería ----------
  registerPackage: {
    roles: GUARD,
    run(t, { user }, { unitId, carrier, description }) {
      if (!t.next.units.some((u) => u.id === unitId)) throw new DomainError('Elige un domicilio válido.');
      const pickupCode = numericCode(4);
      const pk = {
        id: uid('k_'),
        unitId,
        carrier,
        description: description || '',
        receivedBy: user.id,
        receivedAt: nowIso(),
        status: 'waiting',
        pickupCode,
      };
      t.add('packages', pk);
      t.notify(t.unitResidents(unitId), {
        title: 'Tienes un paquete en caseta',
        body: `${carrier}${description ? ` · ${description}` : ''}. Código de entrega: ${pickupCode}`,
        kind: 'package',
        link: '/paquetes',
      });
      return pk;
    },
  },
  deliverPackage: {
    roles: GUARD,
    run(t, { user }, { id, code }) {
      const pk = t.must('packages', id, 'El paquete');
      if (pk.status !== 'waiting') throw new DomainError('Este paquete ya fue entregado.', 409, 'already_delivered');
      if (pk.pickupCode !== code) throw new DomainError('El código de entrega no coincide', 422, 'wrong_code');
      t.patch('packages', id, { status: 'delivered', deliveredAt: nowIso(), deliveredBy: user.id });
      t.notify(t.unitResidents(pk.unitId), {
        title: 'Paquete entregado',
        body: `${pk.carrier} entregado a las ${fmtTime(new Date())}`,
        kind: 'package',
        link: '/paquetes',
      });
    },
  },

  // ---------- Votaciones ----------
  createPoll: {
    roles: ADMIN,
    run(t, { user }, input) {
      const poll = {
        ...input,
        options: input.options.map((o) => ({ id: uid('o_'), text: o.text })),
        id: uid('pl_'),
        authorId: user.id,
        createdAt: nowIso(),
        votes: {},
      };
      t.add('polls', poll);
      t.notify(t.residents(), { title: 'Nueva votación', body: input.question, kind: 'poll', link: '/votaciones' });
      return poll;
    },
  },
  vote: {
    roles: RESIDENT,
    run(t, { user }, { id, optionId }) {
      const poll = t.must('polls', id, 'La votación');
      if (new Date(poll.closesAt) < new Date()) throw new DomainError('La votación ya cerró.', 409, 'poll_closed');
      if (!poll.options.some((o) => o.id === optionId)) throw new DomainError('Opción no válida.');
      t.patch('polls', id, (p) => ({ votes: { ...p.votes, [user.id]: optionId } }));
    },
  },

  // ---------- Finanzas ----------
  addExpense: {
    roles: ADMIN,
    run(t, _ctx, input) {
      return t.add('expenses', { ...input, id: uid('e_') });
    },
  },

  // ---------- Emergencias ----------
  triggerSos: {
    roles: RESIDENT,
    run(t, { user }, { kind = 'Emergencia' }) {
      const sos = { id: uid('s_'), residentId: user.id, unitId: user.unitId, kind, at: nowIso(), status: 'active' };
      t.add('sos', sos);
      t.notify([...t.guards(), ...t.admins()], {
        title: `ALERTA: ${kind}`,
        body: `${user.name} · ${t.unitLabel(user.unitId)} solicitó ayuda inmediata.`,
        kind: 'sos',
        link: '/',
      });
      return sos;
    },
  },
  attendSos: {
    roles: STAFF,
    run(t, { user }, { id }) {
      const s = t.must('sos', id, 'La alerta');
      if (s.status !== 'active') return;
      t.patch('sos', id, { status: 'attended', attendedBy: user.id, attendedAt: nowIso() });
      t.notify([s.residentId], { title: 'Vigilancia va en camino', body: `${user.name} atendió tu alerta.`, kind: 'sos', link: '/' });
    },
  },

  // ---------- Administración ----------
  updateUser: {
    roles: ADMIN,
    run(t, _ctx, { id, ...data }) {
      t.must('users', id, 'El usuario');
      // Correo, rol y credenciales no se cambian aquí: pasan por la gestión de cuentas.
      t.patch('users', id, pick(data, ['name', 'unitId', 'vehicles', 'shift']));
    },
  },
  // Alta o baja de los avisos por WhatsApp (la persona responde BAJA / ALTA en el chat o lo cambia en la APP).
  setWhatsappAlerts: {
    roles: ALL,
    run(t, { user }, { enabled }) {
      const has = t.get('whatsappOptOuts', user.id);
      if (enabled && has) t.remove('whatsappOptOuts', user.id);
      if (!enabled && !has) t.add('whatsappOptOuts', { id: user.id, at: nowIso() });
    },
  },

  updateSettings: {
    roles: ADMIN,
    run(t, _ctx, data) {
      t.next.settings = {
        ...t.next.settings,
        ...pick(data, [
          'name',
          'monthlyFee',
          'dueDay',
          'lateFee',
          'lateFeeGraceDays',
          'restrictions',
          'bank',
          'amenities',
          'generalProviders',
          'cover',
          'gate',
          'whatsapp',
        ]),
      };
      if (data.cover === '') delete t.next.settings.cover; // '' = volver a la foto de ejemplo
      t.audit({ action: 'Configuración actualizada', target: Object.keys(data).join(', ') });
    },
  },

  ...GATE_OPERATIONS,
};

/** Ejecuta una operación verificando el rol. Devuelve lo que regrese la operación. */
export function runOperation(name, t, ctx, input = {}) {
  const op = OPERATIONS[name];
  if (!op) throw new DomainError(`Operación desconocida: ${name}`, 404, 'unknown_operation');
  if (!op.roles.includes(ctx.user?.role)) throw forbidden();
  return op.run(t, ctx, input);
}
