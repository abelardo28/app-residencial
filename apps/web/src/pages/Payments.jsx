import { useState } from 'react';
import { CreditCard, Landmark, Banknote, Check, X, FileText, Bell, Receipt, Lock, Plus } from 'lucide-react';
import { useStore, unitLabel, userName } from '../data/store';
import { lastMonths, monthLabel, money, fmtDateTime, fileToAttachment, monthKey } from '../lib/utils';
import { createCheckout, getCheckoutStatus, ECARTPAY_MODE } from '../services/ecartpay';
import { Attachment, Badge, Button, Card, CardHead, Empty, Field, FileDrop, Modal, PageHead, Stat, Tabs } from '../components/ui';

export const LEDGER_MONTHS = 4;
const METHOD = { ecartpay: 'Ecart Pay', transfer: 'Transferencia', cash: 'Efectivo' };
const STATUS = { approved: ['Aprobado', 'ok'], pending: ['En revisión', 'warn'], rejected: ['Rechazado', 'bad'] };

// Estado de cada mes para una casa
export function ledger(db, unitId) {
  const today = new Date();
  return lastMonths(LEDGER_MONTHS).map((m) => {
    const ps = db.payments.filter((p) => p.unitId === unitId && p.period === m);
    const approved = ps.find((p) => p.status === 'approved');
    const pending = ps.find((p) => p.status === 'pending');
    const rejected = ps.find((p) => p.status === 'rejected');
    const overdue = m < monthKey(today) || (m === monthKey(today) && today.getDate() > db.settings.dueDay);
    const state = approved ? 'paid' : pending ? 'review' : overdue ? 'overdue' : 'due';
    return { month: m, state, payment: approved || pending || rejected };
  });
}
const LEDGER_LABEL = { paid: ['Pagado', 'ok'], review: ['En revisión', 'warn'], overdue: ['Vencido', 'bad'], due: ['Por pagar', 'info'] };

export default function Payments() {
  const { me } = useStore();
  return me.role === 'admin' ? <AdminPayments /> : <ResidentPayments />;
}

function ResidentPayments() {
  const { db, me } = useStore();
  const [paying, setPaying] = useState(false);
  const [viewing, setViewing] = useState(null);
  const rows = ledger(db, me.unitId);
  const owed = rows.filter((r) => r.state === 'overdue' || r.state === 'due');
  const mine = db.payments.filter((p) => p.unitId === me.unitId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <>
      <PageHead title="Pagos de mantenimiento" subtitle={`Cuota mensual ${money(db.settings.monthlyFee)} · vence el día ${db.settings.dueDay} de cada mes`} fab={owed.length ? { icon: <CreditCard size={18} />, label: `Pagar ${money(owed.length * db.settings.monthlyFee)}`, onClick: () => setPaying(true) } : null}>
        <Button variant="primary" onClick={() => setPaying(true)} disabled={!owed.length}><CreditCard size={16} /> Pagar</Button>
      </PageHead>
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Stat label="Saldo pendiente" value={money(owed.length * db.settings.monthlyFee)} sub={owed.length ? `${owed.length} mes(es)` : 'Estás al corriente'} />
        <Stat label="En revisión" value={rows.filter((r) => r.state === 'review').length} sub="Comprobantes enviados" />
        <Stat label="Último pago" value={mine.find((p) => p.status === 'approved') ? money(mine.find((p) => p.status === 'approved').amount) : '—'} sub={mine.find((p) => p.status === 'approved') ? monthLabel(mine.find((p) => p.status === 'approved').period) : ''} />
      </div>
      <div className="grid g2">
        <Card>
          <CardHead title="Estado de cuenta" />
          <div className="list">
            {rows.slice().reverse().map((r) => (
              <div key={r.month} className="list-item">
                <div className="grow"><div className="title">{monthLabel(r.month)}</div><div className="faint">{money(db.settings.monthlyFee)}</div></div>
                <Badge tone={LEDGER_LABEL[r.state][1]}>{LEDGER_LABEL[r.state][0]}</Badge>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHead title="Movimientos" />
          {mine.length === 0 && <Empty>Sin movimientos.</Empty>}
          <div className="list">
            {mine.map((p) => (
              <div key={p.id} className="list-item" style={{ cursor: 'pointer' }} onClick={() => setViewing(p)}>
                <div className="avatar"><Receipt size={16} /></div>
                <div className="grow">
                  <div className="title">{monthLabel(p.period)}</div>
                  <div className="faint">{METHOD[p.method]} · {fmtDateTime(p.createdAt)}</div>
                  {p.status === 'rejected' && p.reviewNote && <div className="faint" style={{ color: 'var(--bad)' }}>{p.reviewNote}</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div>{money(p.amount)}</div>
                  <Badge tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      {paying && <PayModal owed={owed} onClose={() => setPaying(false)} />}
      {viewing && <PaymentDetail p={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function PayModal({ owed, onClose }) {
  const { db, me, actions, toast } = useStore();
  const [periods, setPeriods] = useState(owed.map((o) => o.month).slice(0, 1));
  const [method, setMethod] = useState('ecartpay');
  const [receipt, setReceipt] = useState(null);
  const [reference, setReference] = useState('');
  const [checkout, setCheckout] = useState(null);
  const [busy, setBusy] = useState(false);
  const total = periods.length * db.settings.monthlyFee;
  const toggle = (m) => setPeriods((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m].sort()));

  async function submit() {
    if (!periods.length) return;
    if (method === 'transfer' && !receipt) return toast('Falta el comprobante', 'Adjunta la imagen o PDF de tu transferencia.', 'bad');
    if (method === 'ecartpay') {
      setBusy(true);
      try {
        const c = await createCheckout({ amount: total, concept: `Mantenimiento ${periods.map(monthLabel).join(', ')}`, reference: `${me.unitId}-${periods.join('_')}`, customer: { name: me.name, email: me.email } });
        if (c.checkoutUrl) window.open(c.checkoutUrl, '_blank');
        setCheckout(c);
      } catch (e) {
        toast('Error', e.message, 'bad');
      } finally { setBusy(false); }
      return;
    }
    actions.submitPayment({ periods, method, receipt, reference });
    toast('Enviado', method === 'cash' ? 'Administración confirmará tu pago en efectivo.' : 'Tu comprobante quedó en revisión.');
    onClose();
  }

  async function confirmEcart() {
    setBusy(true);
    const st = await getCheckoutStatus(checkout.id);
    setBusy(false);
    if (st.status !== 'paid') return toast('Pago pendiente', 'Ecart Pay aún no confirma el pago.', 'bad');
    actions.submitPayment({ periods, method: 'ecartpay', ecartpayId: checkout.id, reference: checkout.id });
    toast('¡Pago aprobado!', `${money(total)} pagados con Ecart Pay.`);
    onClose();
  }

  if (checkout) return <EcartCheckout total={total} checkout={checkout} busy={busy} onPay={confirmEcart} onClose={onClose} />;

  return (
    <Modal title="Pagar mantenimiento" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={busy || !periods.length} onClick={submit}>{method === 'ecartpay' ? `Pagar ${money(total)}` : 'Enviar'}</Button></>}>
      <div className="stack">
        <Field label="Meses a pagar">
          <div className="chips">
            {owed.map((o) => <button key={o.month} type="button" className={`chip ${periods.includes(o.month) ? 'on' : ''}`} onClick={() => toggle(o.month)}>{monthLabel(o.month)}</button>)}
          </div>
        </Field>
        <Tabs value={method} onChange={setMethod} items={[
          { value: 'ecartpay', label: 'Ecart Pay', icon: <CreditCard size={15} /> },
          { value: 'transfer', label: 'Transferencia', icon: <Landmark size={15} /> },
          { value: 'cash', label: 'Efectivo', icon: <Banknote size={15} /> },
        ]} />
        {method === 'ecartpay' && <p className="muted">Paga con tarjeta de crédito, débito u otros métodos disponibles en Ecart Pay. El pago se aprueba en automático y administración recibe el aviso.</p>}
        {method === 'transfer' && (
          <>
            <div className="card flat" style={{ padding: 14 }}>
              <div className="faint">Datos bancarios</div>
              <div>{db.settings.bank.holder}</div>
              <div>{db.settings.bank.name} · CLABE <span className="mono">{db.settings.bank.clabe}</span></div>
              <div className="faint">Referencia sugerida: {unitLabel(db, me.unitId)}</div>
            </div>
            <Field label="Clave de rastreo o referencia"><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
            {receipt ? <Attachment file={receipt} onRemove={() => setReceipt(null)} /> : <FileDrop accept="image/*,application/pdf" label="Sube tu comprobante (imagen o PDF)" onFiles={async ([f]) => f && setReceipt(await fileToAttachment(f))} />}
          </>
        )}
        {method === 'cash' && (
          <>
            <p className="muted">Entrega el efectivo en la oficina de administración. Tu pago quedará en revisión hasta que lo confirmen.</p>
            <Field label="¿A quién lo entregaste? (opcional)"><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Nombre / número de recibo" /></Field>
            {receipt ? <Attachment file={receipt} onRemove={() => setReceipt(null)} /> : <FileDrop accept="image/*" label="Foto del recibo de caja (opcional)" onFiles={async ([f]) => f && setReceipt(await fileToAttachment(f))} />}
          </>
        )}
        <div className="row between" style={{ paddingTop: 4 }}><span className="muted">Total</span><b style={{ fontSize: 20 }}>{money(total)}</b></div>
      </div>
    </Modal>
  );
}

// Checkout simulado mientras no haya backend conectado a Ecart Pay.
function EcartCheckout({ total, checkout, busy, onPay, onClose }) {
  const live = ECARTPAY_MODE === 'live';
  return (
    <Modal title="Ecart Pay" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={busy} onClick={onPay}>{live ? 'Ya pagué, verificar' : `Pagar ${money(total)}`}</Button></>}>
      {live ? (
        <p className="muted">Se abrió el checkout de Ecart Pay en otra pestaña. Cuando termines, vuelve aquí y verifica el pago.</p>
      ) : (
        <div className="stack">
          <div className="banner info"><Lock size={16} /> Modo de prueba. Configura <span className="mono">VITE_API_URL</span> para usar el checkout real.</div>
          <Field label="Número de tarjeta"><input className="input mono" defaultValue="4242 4242 4242 4242" /></Field>
          <div className="grid g2">
            <Field label="Vencimiento"><input className="input" defaultValue="12/29" /></Field>
            <Field label="CVV"><input className="input" defaultValue="123" /></Field>
          </div>
          <div className="faint">Orden {checkout.id}</div>
        </div>
      )}
    </Modal>
  );
}

function PaymentDetail({ p, onClose, review }) {
  const { db, actions, toast } = useStore();
  const [note, setNote] = useState('');
  const isPending = p.status === 'pending';
  return (
    <Modal title={`${monthLabel(p.period)} · ${money(p.amount)}`} onClose={onClose}
      footer={review && isPending ? (
        <>
          <Button className="danger" onClick={() => { if (!note) return toast('Indica el motivo', 'El residente verá el motivo del rechazo.', 'bad'); actions.reviewPayment(p.id, 'rejected', note); onClose(); }}><X size={16} /> Rechazar</Button>
          <Button variant="primary" onClick={() => { actions.reviewPayment(p.id, 'approved', note); toast('Pago aprobado', 'Se notificó al residente.'); onClose(); }}><Check size={16} /> Aprobar</Button>
        </>
      ) : null}>
      <div className="stack">
        <div className="row between"><span className="muted">Residente</span><span>{userName(db, p.residentId)} · {unitLabel(db, p.unitId)}</span></div>
        <div className="row between"><span className="muted">Método</span><span>{METHOD[p.method]}</span></div>
        {p.reference && <div className="row between"><span className="muted">Referencia</span><span className="mono">{p.reference}</span></div>}
        <div className="row between"><span className="muted">Enviado</span><span>{fmtDateTime(p.createdAt)}</span></div>
        <div className="row between"><span className="muted">Estado</span><Badge tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Badge></div>
        {p.reviewedAt && <div className="row between"><span className="muted">Revisó</span><span>{userName(db, p.reviewedBy)} · {fmtDateTime(p.reviewedAt)}</span></div>}
        {p.reviewNote && <div className="banner warn">{p.reviewNote}</div>}
        {p.receipt && (p.receipt.type?.startsWith('image/') ? <img src={p.receipt.dataUrl} alt="Comprobante" style={{ width: '100%', borderRadius: 14, border: '1px solid var(--border)' }} /> : <Attachment file={p.receipt} />)}
        {review && isPending && <Field label="Nota para el residente"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Obligatoria si rechazas" /></Field>}
      </div>
    </Modal>
  );
}

function AdminPayments() {
  const { db, actions, toast } = useStore();
  const [tab, setTab] = useState('pending');
  const [viewing, setViewing] = useState(null);
  const [cashFor, setCashFor] = useState(null);
  const pending = db.payments.filter((p) => p.status === 'pending');
  const residents = db.users.filter((u) => u.role === 'resident');
  const debtors = residents.map((r) => ({ r, owed: ledger(db, r.unitId).filter((x) => x.state === 'overdue') })).filter((x) => x.owed.length);
  const thisMonth = db.payments.filter((p) => p.status === 'approved' && p.period === monthKey());

  return (
    <>
      <PageHead title="Cobranza" subtitle="Revisa comprobantes, confirma efectivo y da seguimiento a la morosidad." />
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Por revisar" value={pending.length} />
        <Stat label="Cobrado este mes" value={money(thisMonth.reduce((s, p) => s + p.amount, 0))} />
        <Stat label="Casas al corriente" value={`${residents.length - debtors.length}/${residents.length}`} />
        <Stat label="Adeudo total" value={money(debtors.reduce((s, d) => s + d.owed.length * db.settings.monthlyFee, 0))} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <Tabs value={tab} onChange={setTab} items={[{ value: 'pending', label: 'Por revisar', count: pending.length }, { value: 'debt', label: 'Morosidad', count: debtors.length }, { value: 'all', label: 'Historial' }]} />
      </div>

      {tab === 'pending' && (
        <Card>
          {pending.length === 0 && <Empty icon={<Check />}>Todo revisado.</Empty>}
          <div className="list">
            {pending.map((p) => (
              <div key={p.id} className="list-item wrap">
                {p.receipt?.type?.startsWith('image/') ? <img src={p.receipt.dataUrl} className="thumb" alt="" /> : <div className="avatar"><FileText size={16} /></div>}
                <div className="grow">
                  <div className="title">{userName(db, p.residentId)} · {unitLabel(db, p.unitId)}</div>
                  <div className="faint">{monthLabel(p.period)} · {METHOD[p.method]} · {fmtDateTime(p.createdAt)}</div>
                </div>
                <b>{money(p.amount)}</b>
                <Button size="sm" variant="primary" onClick={() => setViewing(p)}>Revisar</Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'debt' && (
        <Card>
          <CardHead title="Casas con adeudo">
            {debtors.length > 0 && <Button size="sm" onClick={() => { actions.sendReminder(debtors.map((d) => d.r.id)); toast('Recordatorio enviado', `${debtors.length} residente(s) notificados.`); }}><Bell size={15} /> Recordar a todos</Button>}
          </CardHead>
          {debtors.length === 0 && <Empty>Todas las casas están al corriente.</Empty>}
          <div className="list">
            {debtors.map(({ r, owed }) => (
              <div key={r.id} className="list-item wrap">
                <div className="grow">
                  <div className="title">{unitLabel(db, r.unitId)} · {r.name}</div>
                  <div className="faint">{owed.map((o) => monthLabel(o.month)).join(', ')}</div>
                </div>
                <b style={{ color: 'var(--bad)' }}>{money(owed.length * db.settings.monthlyFee)}</b>
                <Button size="sm" onClick={() => { actions.sendReminder([r.id]); toast('Recordatorio enviado', r.name); }}><Bell size={15} /></Button>
                <Button size="sm" onClick={() => setCashFor({ r, owed })}><Plus size={15} /> Efectivo</Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'all' && (
        <Card>
          <div className="show-sm">
            {[...db.payments].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => (
              <div key={p.id} className="m-card" onClick={() => setViewing(p)}>
                <div className="avatar"><Receipt size={16} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row between" style={{ flexWrap: 'nowrap' }}><b style={{ fontWeight: 600 }}>{unitLabel(db, p.unitId)}</b><span>{money(p.amount)}</span></div>
                  <div className="faint">{monthLabel(p.period)} · {METHOD[p.method]} · {userName(db, p.residentId)}</div>
                  <div style={{ marginTop: 4 }}><Badge tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Badge></div>
                </div>
              </div>
            ))}
          </div>
          <div className="table-wrap hide-sm">
            <table>
              <thead><tr><th>Casa</th><th>Periodo</th><th>Método</th><th>Monto</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {[...db.payments].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => (
                  <tr key={p.id}>
                    <td>{unitLabel(db, p.unitId)}<div className="faint">{userName(db, p.residentId)}</div></td>
                    <td>{monthLabel(p.period)}</td>
                    <td>{METHOD[p.method]}</td>
                    <td>{money(p.amount)}</td>
                    <td><Badge tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Badge></td>
                    <td><Button size="sm" variant="ghost" onClick={() => setViewing(p)}>Ver</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {viewing && <PaymentDetail p={viewing} review onClose={() => setViewing(null)} />}
      {cashFor && <CashModal {...cashFor} onClose={() => setCashFor(null)} />}
    </>
  );
}

function CashModal({ r, owed, onClose }) {
  const { actions, toast } = useStore();
  const [periods, setPeriods] = useState(owed.map((o) => o.month));
  const [reference, setReference] = useState('');
  return (
    <Modal title={`Registrar efectivo · ${r.name}`} onClose={onClose} footer={<Button variant="primary" disabled={!periods.length} onClick={() => { actions.registerCashPayment({ residentId: r.id, periods, reference }); toast('Pago registrado', 'Se notificó al residente.'); onClose(); }}>Registrar</Button>}>
      <div className="stack">
        <div className="chips">{owed.map((o) => <button key={o.month} className={`chip ${periods.includes(o.month) ? 'on' : ''}`} onClick={() => setPeriods((p) => (p.includes(o.month) ? p.filter((x) => x !== o.month) : [...p, o.month]))}>{monthLabel(o.month)}</button>)}</div>
        <Field label="Folio del recibo"><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
