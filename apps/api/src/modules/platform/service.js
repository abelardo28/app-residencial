// Portal de la empresa: residencias, planes, suscripciones y suspensión del servicio.
import { createTx, monthKey, monthLabel, money, uid, validEmail, normPhone } from '@residencial/shared';
import { transaction } from '../../db/database.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { toUserView } from '../../repositories/accounts.js';
import { toResidencia } from '../tenant/service.js';

const DEFAULT_SETTINGS = {
  dueDay: 10, lateFee: 0, bank: { name: '', clabe: '', holder: '' }, amenities: [],
  generalProviders: ['Recolección de basura', 'Gas', 'Pipa de agua'],
};
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

export function createPlatformService({ repos, templates, dispatch, events, accountsService }) {
  const { db, accounts, tenants, platform } = repos;
  const audit = (actor, e) => platform.audit({ actor: actor.name, ...e });
  const admins = (tenantId) => accounts.listByTenant(tenantId).filter((a) => a.role === 'admin');
  const mustTenant = (id) => tenants.find(id) || (() => { throw notFound('El residencial no existe.'); })();
  const mustInvoice = (id) => platform.invoice(id) || (() => { throw notFound('El cargo no existe.'); })();
  const changed = (tenantId) => {
    events.publish(tenantId || 'platform', { reason: 'platform' });
    dispatch();
  };

  function setStatus(actor, tenantId, status, reason = '') {
    const t = mustTenant(tenantId);
    transaction(db, () => {
      tenants.setStatus(tenantId, status, reason, new Date().toISOString());
      platform.enqueue(admins(tenantId).flatMap((admin) => templates.serviceStatus({ admin, org: t.name, active: status === 'active', reason })));
      audit(actor, { tenantId, action: status === 'active' ? 'Residencial reactivado' : 'Residencial suspendido', target: t.name, severity: status === 'active' ? 'info' : 'danger', detail: reason });
    });
    changed(tenantId);
  }

  return {
    /** Vista completa para el personal de la empresa (con lo necesario de cada residencial). */
    snapshot() {
      const list = tenants.list();
      const tenantData = {};
      for (const t of list) {
        const invites = accounts.invitesByTenant(t.id);
        tenantData[t.id] = {
          settings: t.settings,
          units: tenants.listRecords(t.id, 'units'),
          users: accounts.listByTenant(t.id).map((a) => toUserView(a, invites.get(a.id))),
        };
      }
      return {
        platform: {
          company: { name: 'Residencial Cloud' },
          residencias: list.map(toResidencia),
          plans: platform.plans(),
          invoices: platform.invoices(),
          audit: platform.auditLog({ limit: 300 }),
          outbox: [],
          staff: accounts.listStaff().map((a) => toUserView(a)),
        },
        tenants: tenantData,
      };
    },

    createResidencial(actor, { name, address, plan, unitCount, unitPrefix, monthlyFee, admin }) {
      if (!platform.plan(plan)) throw badRequest('El plan no existe.');
      if (!validEmail(admin.email)) throw badRequest('El correo del administrador no es válido.');
      if (!normPhone(admin.phone)) throw badRequest('El WhatsApp del administrador no es válido.');
      if (accounts.findByEmail(admin.email)) throw conflict('Ya existe una cuenta con el correo del administrador.');
      const tenantId = uid('t_');
      const now = new Date().toISOString();
      const units = Array.from({ length: unitCount }, (_, i) => ({ id: `u${i + 1}`, label: `${unitPrefix || 'Casa'} ${i + 1}`, street: '' }));
      transaction(db, () => {
        tenants.create({ id: tenantId, name, address, plan, contact: admin.name, settings: { ...DEFAULT_SETTINGS, name, monthlyFee }, createdAt: now });
        tenants.insertMany(tenantId, 'units', units);
        platform.createInvoice({ id: uid('inv_'), tenantId, period: monthKey(), amount: platform.plan(plan).price, status: 'pending', dueDate: inDays(10), createdAt: now });
        audit(actor, { tenantId, action: 'Residencial creado', target: name });
        accountsService.invite(actor, tenantId, { name: admin.name, email: admin.email, phone: admin.phone, role: 'admin' });
      });
      changed(tenantId);
      return { id: tenantId };
    },

    setResidencialStatus: setStatus,

    changePlan(actor, tenantId, plan) {
      mustTenant(tenantId);
      const p = platform.plan(plan);
      if (!p) throw badRequest('El plan no existe.');
      transaction(db, () => {
        tenants.setPlan(tenantId, plan);
        audit(actor, { tenantId, action: 'Cambio de plan', target: p.name });
      });
      changed(tenantId);
    },

    generateInvoices(actor, period = monthKey()) {
      const created = transaction(db, () => {
        const items = tenants.list().filter((t) => t.status === 'active' && !platform.hasInvoice(t.id, period));
        const now = new Date().toISOString();
        for (const t of items) platform.createInvoice({ id: uid('inv_'), tenantId: t.id, period, amount: platform.plan(t.plan)?.price || 0, status: 'pending', dueDate: `${period}-10`, createdAt: now });
        if (items.length) audit(actor, { action: 'Cargos generados', target: `${items.length} residencia(s) · ${monthLabel(period)}` });
        return items.length;
      });
      changed();
      return { created };
    },

    payInvoice(actor, id, { method, reference }) {
      const inv = mustInvoice(id);
      if (inv.status !== 'pending') throw conflict('Este cargo ya no está pendiente.');
      transaction(db, () => {
        platform.payInvoice(id, { method, reference: reference || '', paidAt: new Date().toISOString() });
        audit(actor, { tenantId: inv.tenantId, action: 'Pago de suscripción registrado', target: `${tenants.find(inv.tenantId)?.name} · ${monthLabel(inv.period)} · ${money(inv.amount)}` });
      });
      changed(inv.tenantId);
    },

    cancelInvoice(actor, id) {
      const inv = mustInvoice(id);
      if (inv.status !== 'pending') throw conflict('Sólo se cancelan cargos pendientes.');
      transaction(db, () => {
        platform.voidInvoice(id);
        audit(actor, { tenantId: inv.tenantId, action: 'Cargo cancelado', target: `${monthLabel(inv.period)} · ${money(inv.amount)}`, severity: 'warn' });
      });
      changed(inv.tenantId);
    },

    /** Envía el recordatorio por correo y deja una notificación a los administradores del residencial. */
    remindInvoice(actor, id) {
      const inv = mustInvoice(id);
      const t = mustTenant(inv.tenantId);
      transaction(db, () => {
        const list = admins(inv.tenantId);
        platform.enqueue(list.flatMap((admin) => templates.invoiceReminder({ admin, org: t.name, amount: money(inv.amount), period: monthLabel(inv.period) })));
        const uow = tenants.unitOfWork(inv.tenantId, accounts);
        createTx(uow.next).notify(list.map((a) => a.id), { title: 'Suscripción pendiente', body: `La suscripción de ${monthLabel(inv.period)} por ${money(inv.amount)} está pendiente de pago.`, kind: 'payment', link: '/configuracion' });
        uow.commit();
        audit(actor, { tenantId: inv.tenantId, action: 'Recordatorio de suscripción enviado', target: t.name });
      });
      changed(inv.tenantId);
    },

    /** Suspende los residenciales con cargos vencidos hace más de `days` días. */
    suspendOverdue(actor, days = 15) {
      const ids = platform.overdueTenants(inDays(-days));
      for (const id of ids) setStatus(actor, id, 'suspended', `Adeudo mayor a ${days} días`);
      return { suspended: ids.length };
    },

    updatePlan(actor, planId, data) {
      const p = platform.plan(planId);
      if (!p) throw notFound('El plan no existe.');
      transaction(db, () => {
        platform.savePlan({ ...p, ...data, id: planId });
        audit(actor, { action: 'Plan actualizado', target: p.name });
      });
      changed();
    },
  };
}
