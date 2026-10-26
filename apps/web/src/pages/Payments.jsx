import { useState } from 'react';
import { CreditCard, Landmark, Banknote, Check, X, FileText, Bell, Receipt, Lock, Plus, Copy, Ban, Star, Trash2 } from 'lucide-react';
import { useStore, unitLabel, userName } from '../data/store';
import { monthLabel, money, fmtDate, fmtDateTime, fileToAttachment, monthKey } from '../lib/utils';
import { bankAccounts, debtOf, debtRestriction, ledger, paymentMonth, periodLabel, unitReference } from '@residencial/shared';
import { Attachment, Badge, Button, Card, CardHead, Empty, Field, FileDrop, Modal, PageHead, Stat, Tabs } from '../components/ui';
import Reconciliation from './Reconciliation';
import Charges from '../components/Charges';

const METHOD = { ecartpay: 'Ecart Pay', transfer: 'Transferencia', cash: 'Efectivo' };
const STATUS = { approved: ['Aprobado', 'ok'], pending: ['En revisión', 'warn'], rejected: ['Rechazado', 'bad'] };

const sumAmount = (rows) => rows.reduce((s, r) => s + r.amount, 0);

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
  const owedTotal = sumAmount(owed);
  const restricted = debtRestriction(db, me.unitId, 'reservations') || debtRestriction(db, me.unitId, 'recurrentPasses');
  const mine = db.payments.filter((p) => p.unitId === me.unitId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <>
      <PageHead
        title="Pagos"
        subtitle={`Cuota mensual ${money(db.settings.monthlyFee)} · vence el día ${db.settings.dueDay} de cada mes`}
        fab={
          owed.length
            ? {
                icon: <CreditCard size={18} />,
                label: `Pagar ${money(owedTotal)}`,
                onClick: () => setPaying(true),
              }
            : null
        }
      >
        <Button variant="primary" onClick={() => setPaying(true)} disabled={!owed.length}>
          <CreditCard size={16} /> Pagar
        </Button>
      </PageHead>
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Stat
          label="Saldo pendiente"
          value={money(owedTotal)}
          sub={owed.length ? `${owed.length} cargo(s)${owed.some((r) => r.lateFee) ? ' · incluye recargos' : ''}` : 'Estás al corriente'}
        />
        <Stat label="En revisión" value={rows.filter((r) => r.state === 'review').length} sub="Comprobantes enviados" />
        <Stat
          label="Último pago"
          value={mine.find((p) => p.status === 'approved') ? money(mine.find((p) => p.status === 'approved').amount) : '—'}
          sub={mine.find((p) => p.status === 'approved') ? periodLabel(mine.find((p) => p.status === 'approved')) : ''}
        />
      </div>
      {restricted && (
        <div className="banner warn" style={{ marginBottom: 16 }}>
          <Ban size={16} /> {restricted}
        </div>
      )}
      <div className="grid g2">
        <Card>
          <CardHead title="Estado de cuenta" />
          <div className="list">
            {rows
              .slice()
              .reverse()
              .map((r) => (
                <div key={r.key} className="list-item">
                  <div className="grow">
                    <div className="title">{r.label}</div>
                    <div className="faint">
                      {money(r.amount)}
                      {r.chargeId && r.state !== 'paid' && ` · vence el ${fmtDate(r.due + 'T12:00')}`}
                      {r.lateFee > 0 && ` · incluye recargo de ${money(r.lateFee)}`}
                      {r.waived && r.state === 'overdue' && ' · recargo condonado'}
                    </div>
                  </div>
                  <Badge tone={LEDGER_LABEL[r.state][1]}>{LEDGER_LABEL[r.state][0]}</Badge>
                </div>
              ))}
          </div>
        </Card>
        <div className="stack">
          <TransferCard />
          <SavedCards />
        </div>
        <Card>
          <CardHead title="Movimientos" />
          {mine.length === 0 && <Empty>Sin movimientos.</Empty>}
          <div className="list">
            {mine.map((p) => (
              <div key={p.id} className="list-item" style={{ cursor: 'pointer' }} onClick={() => setViewing(p)}>
                <div className="avatar">
                  <Receipt size={16} />
                </div>
                <div className="grow">
                  <div className="title">{periodLabel(p)}</div>
                  <div className="faint">
                    {METHOD[p.method]}
                    {p.card ? ` ${p.card}` : ''} · {fmtDateTime(p.createdAt)}
                  </div>
                  {p.status === 'rejected' && p.reviewNote && (
                    <div className="faint" style={{ color: 'var(--bad)' }}>
                      {p.reviewNote}
                    </div>
                  )}
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

/** Copia sin espacios (CLABE, referencia) y avisa. */
function useCopy() {
  const { toast } = useStore();
  return async (text, what) => {
    try {
      await navigator.clipboard.writeText(text.replace(/\s/g, ''));
      toast('Copiado', what);
    } catch {
      toast('No se pudo copiar', 'Cópialo manualmente.', 'bad');
    }
  };
}

/** Cuentas del residencial con su CLABE para copiar. */
function BankAccountList({ accounts }) {
  const copy = useCopy();
  return accounts.map((b) => (
    <div key={b.id} className="bank-account">
      <div className="grow">
        {b.alias && <div className="title">{b.alias}</div>}
        <div className="faint">CLABE · {b.name}</div>
        <span className="mono">{b.clabe}</span>
        <div className="faint">Beneficiario: {b.holder}</div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => copy(b.clabe, `CLABE de ${b.alias || b.name}`)}
        aria-label={`Copiar CLABE de ${b.alias || b.name}`}
      >
        <Copy size={15} />
      </Button>
    </div>
  ));
}

/** Datos para pagar por SPEI con la referencia de la casa: así la conciliación aplica el pago sola. */
function TransferCard() {
  const { db, me } = useStore();
  const copy = useCopy();
  const ref = unitReference(db, me.unitId);
  const accounts = bankAccounts(db.settings);
  return (
    <Card>
      <CardHead title="Paga por transferencia" subtitle="Escribe tu referencia en el campo «Referencia numérica» de tu banco." />
      <div className="stack">
        <div className="row between">
          <div>
            <div className="faint">Tu referencia ({unitLabel(db, me.unitId)})</div>
            <b className="mono" style={{ fontSize: 22, letterSpacing: 2 }}>
              {ref}
            </b>
          </div>
          <Button size="sm" onClick={() => copy(ref, 'Referencia de pago')} aria-label="Copiar referencia">
            <Copy size={15} /> Copiar
          </Button>
        </div>
        {accounts.length ? <BankAccountList accounts={accounts} /> : <p className="muted">Administración aún no registra una cuenta.</p>}
        <div className="faint">Con la referencia, tu pago se aplica al conciliar el estado de cuenta y no necesitas subir comprobante.</div>
      </div>
    </Card>
  );
}

/** Tarjetas propias, con la predeterminada primero. */
const myCards = (db, me) =>
  (db.cards || []).filter((c) => c.userId === me.id).sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault));
const cardName = (c) => `${c.brand} ···${c.last4}`;

function SavedCards() {
  const { db, me, actions, toast } = useStore();
  const cards = myCards(db, me);
  return (
    <Card>
      <CardHead
        title="Tarjetas guardadas"
        subtitle="Se guardan al pagar marcando «Guardar esta tarjeta». Sólo se conserva el identificador de Ecart Pay."
      />
      {cards.length === 0 ? (
        <p className="muted">Aún no tienes tarjetas guardadas.</p>
      ) : (
        <div className="list">
          {cards.map((c) => (
            <div key={c.id} className="list-item">
              <div className="avatar">
                <CreditCard size={16} />
              </div>
              <div className="grow">
                <div className="title" style={{ whiteSpace: 'nowrap' }}>
                  {cardName(c)}
                </div>
              </div>
              {c.isDefault ? (
                <Badge tone="ok">Predeterminada</Badge>
              ) : (
                <Button
                  size="sm"
                  aria-label={`Usar ${cardName(c)} como predeterminada`}
                  onClick={() =>
                    actions.setDefaultCard(c.id).then(
                      () => toast('Tarjeta predeterminada', cardName(c)),
                      () => {},
                    )
                  }
                >
                  <Star size={14} /> <span className="hide-sm">Predeterminada</span>
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Eliminar ${cardName(c)}`}
                onClick={() =>
                  window.confirm(`¿Eliminar la tarjeta ${cardName(c)}?`) &&
                  actions.deleteCard(c.id).then(
                    () => toast('Tarjeta eliminada', cardName(c)),
                    () => {},
                  )
                }
              >
                <Trash2 size={15} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function PayModal({ owed, onClose }) {
  const { db, me, actions, toast } = useStore();
  const [periods, setPeriods] = useState(owed.map((o) => o.key).slice(0, 1));
  const [method, setMethod] = useState('ecartpay');
  const [receipt, setReceipt] = useState(null);
  const [reference, setReference] = useState('');
  const [checkout, setCheckout] = useState(null);
  const [busy, setBusy] = useState(false);
  const cards = myCards(db, me);
  const [cardId, setCardId] = useState(cards[0]?.id || 'new');
  const [saveCard, setSaveCard] = useState(!cards.length);
  const card = cards.find((c) => c.id === cardId);
  const accounts = bankAccounts(db.settings);
  const [accountId, setAccountId] = useState(accounts[0]?.id);
  const total = sumAmount(owed.filter((o) => periods.includes(o.key)));
  const toggle = (k) => setPeriods((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  async function submit() {
    if (!periods.length) return;
    if (method === 'transfer' && !receipt) return toast('Falta el comprobante', 'Adjunta la imagen o PDF de tu transferencia.', 'bad');
    if (method === 'ecartpay' && card) {
      setBusy(true);
      try {
        await actions.payWithCard(periods, card.id);
      } catch {
        return;
      } finally {
        setBusy(false);
      }
      toast('¡Pago aprobado!', `${money(total)} pagados con ${cardName(card)}.`);
      return onClose();
    }
    if (method === 'ecartpay') {
      setBusy(true);
      try {
        const c = await actions.startEcartpay(periods, { saveCard });
        if (c.checkoutUrl) window.open(c.checkoutUrl, '_blank', 'noopener');
        setCheckout(c);
      } catch {
        /* el motivo ya se mostró */
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      await actions.submitPayment({
        periods,
        method,
        receipt,
        reference,
        ...(method === 'transfer' && accountId ? { bankAccountId: accountId } : {}),
      });
    } catch {
      return;
    }
    toast('Enviado', method === 'cash' ? 'Administración confirmará tu pago en efectivo.' : 'Tu comprobante quedó en revisión.');
    onClose();
  }

  async function confirmEcart(paidWith) {
    setBusy(true);
    let st;
    try {
      st = await actions.confirmEcartpay(checkout, paidWith);
    } catch {
      return;
    } finally {
      setBusy(false);
    }
    if (st.status !== 'paid') return toast('Pago pendiente', 'Ecart Pay aún no confirma el pago.', 'bad');
    toast('¡Pago aprobado!', `${money(total)} pagados con Ecart Pay.`);
    onClose();
  }

  if (checkout) return <EcartCheckout total={total} checkout={checkout} busy={busy} onPay={confirmEcart} onClose={onClose} />;

  return (
    <Modal
      title="Pagar"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={busy || !periods.length} onClick={submit}>
            {method === 'ecartpay' ? `Pagar ${money(total)}` : 'Enviar'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Qué vas a pagar">
          <div className="chips">
            {owed.map((o) => (
              <button key={o.key} type="button" className={`chip ${periods.includes(o.key) ? 'on' : ''}`} onClick={() => toggle(o.key)}>
                {o.label} · {money(o.amount)}
              </button>
            ))}
          </div>
        </Field>
        <Tabs
          value={method}
          onChange={setMethod}
          items={[
            { value: 'ecartpay', label: 'Tarjeta', icon: <CreditCard size={15} /> },
            { value: 'transfer', label: 'Transferencia', icon: <Landmark size={15} /> },
            { value: 'cash', label: 'Efectivo', icon: <Banknote size={15} /> },
          ]}
        />
        {method === 'ecartpay' && (
          <>
            {cards.length > 0 && (
              <div className="pick-list" role="radiogroup" aria-label="Tarjeta">
                {[...cards, { id: 'new' }].map((c) => (
                  <label key={c.id} className={`pick ${cardId === c.id ? 'on' : ''}`}>
                    <input type="radio" name="card" checked={cardId === c.id} onChange={() => setCardId(c.id)} />
                    <CreditCard size={16} />
                    <span className="grow">{c.id === 'new' ? 'Otra tarjeta' : cardName(c)}</span>
                    {c.isDefault && <Badge tone="ok">Predeterminada</Badge>}
                  </label>
                ))}
              </div>
            )}
            {card ? (
              <p className="muted">Se cobra en este momento a tu {cardName(card)} y el pago queda aprobado.</p>
            ) : (
              <>
                <p className="muted">
                  Paga con tarjeta de crédito, débito u otros métodos disponibles en Ecart Pay. El pago se aprueba en automático y
                  administración recibe el aviso.
                </p>
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} /> Guardar esta tarjeta para mis
                  próximos pagos
                </label>
              </>
            )}
          </>
        )}
        {method === 'transfer' && (
          <>
            {accounts.length > 1 && (
              <Field label="¿A qué cuenta transferiste?">
                <div className="chips">
                  {accounts.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className={`chip ${accountId === a.id ? 'on' : ''}`}
                      onClick={() => setAccountId(a.id)}
                    >
                      {a.alias || a.name}
                    </button>
                  ))}
                </div>
              </Field>
            )}
            <div className="card flat" style={{ padding: 14 }}>
              <BankAccountList accounts={accounts.filter((a) => a.id === accountId)} />
              <div>
                Referencia numérica <b className="mono">{unitReference(db, me.unitId)}</b>
              </div>
            </div>
            <Field label="Clave de rastreo o referencia">
              <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
            {receipt ? (
              <Attachment file={receipt} onRemove={() => setReceipt(null)} />
            ) : (
              <FileDrop
                accept="image/*,application/pdf"
                label="Sube tu comprobante (imagen o PDF)"
                onFiles={async ([f]) => f && setReceipt(await fileToAttachment(f))}
              />
            )}
          </>
        )}
        {method === 'cash' && (
          <>
            <p className="muted">
              Entrega el efectivo en la oficina de administración. Tu pago quedará en revisión hasta que lo confirmen.
            </p>
            <Field label="¿A quién lo entregaste? (opcional)">
              <input
                className="input"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Nombre / número de recibo"
              />
            </Field>
            {receipt ? (
              <Attachment file={receipt} onRemove={() => setReceipt(null)} />
            ) : (
              <FileDrop
                accept="image/*"
                label="Foto del recibo de caja (opcional)"
                onFiles={async ([f]) => f && setReceipt(await fileToAttachment(f))}
              />
            )}
          </>
        )}
        <div className="row between" style={{ paddingTop: 4 }}>
          <span className="muted">Total</span>
          <b style={{ fontSize: 20 }}>{money(total)}</b>
        </div>
      </div>
    </Modal>
  );
}

// Checkout simulado mientras no haya backend conectado a Ecart Pay (también lo usa el pago de la suscripción).
export function EcartCheckout({ total, checkout, busy, onPay, onClose }) {
  const live = !checkout.mock;
  const [number, setNumber] = useState('4242 4242 4242 4242');
  const digits = number.replace(/\D/g, '');
  // En modo de prueba se informa la tarjeta escrita (en la API la informa Ecart Pay)
  const typed = { brand: { 4: 'Visa', 5: 'Mastercard', 3: 'American Express' }[digits[0]] || 'Tarjeta', last4: digits.slice(-4) };
  return (
    <Modal
      title="Ecart Pay"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={busy || (!live && digits.length < 13)} onClick={() => onPay(live ? null : typed)}>
            {live ? 'Ya pagué, verificar' : `Pagar ${money(total)}`}
          </Button>
        </>
      }
    >
      {live ? (
        <p className="muted">Se abrió el checkout de Ecart Pay en otra pestaña. Cuando termines, vuelve aquí y verifica el pago.</p>
      ) : (
        <div className="stack">
          <div className="banner info">
            <Lock size={16} /> Modo de prueba: no se hace ningún cargo real.
          </div>
          <Field label="Número de tarjeta">
            <input className="input mono" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} />
          </Field>
          <div className="grid g2">
            <Field label="Vencimiento">
              <input className="input" defaultValue="12/29" />
            </Field>
            <Field label="CVV">
              <input className="input" defaultValue="123" />
            </Field>
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
    <Modal
      title={`${periodLabel(p)} · ${money(p.amount)}`}
      onClose={onClose}
      footer={
        review && isPending ? (
          <>
            <Button
              className="danger"
              onClick={() => {
                if (!note) return toast('Indica el motivo', 'El residente verá el motivo del rechazo.', 'bad');
                actions.reviewPayment(p.id, 'rejected', note).then(onClose, () => {});
              }}
            >
              <X size={16} /> Rechazar
            </Button>
            <Button
              variant="primary"
              onClick={() =>
                actions.reviewPayment(p.id, 'approved', note).then(
                  () => {
                    toast('Pago aprobado', 'Se notificó al residente.');
                    onClose();
                  },
                  () => {},
                )
              }
            >
              <Check size={16} /> Aprobar
            </Button>
          </>
        ) : null
      }
    >
      <div className="stack">
        <div className="row between">
          <span className="muted">Residente</span>
          <span>
            {userName(db, p.residentId)} · {unitLabel(db, p.unitId)}
          </span>
        </div>
        <div className="row between">
          <span className="muted">Método</span>
          <span>
            {METHOD[p.method]}
            {p.card ? ` · ${p.card}` : ''}
          </span>
        </div>
        {p.bankAccount && (
          <div className="row between">
            <span className="muted">Cuenta</span>
            <span>{p.bankAccount}</span>
          </div>
        )}
        {p.reference && (
          <div className="row between">
            <span className="muted">Referencia</span>
            <span className="mono">{p.reference}</span>
          </div>
        )}
        <div className="row between">
          <span className="muted">Enviado</span>
          <span>{fmtDateTime(p.createdAt)}</span>
        </div>
        <div className="row between">
          <span className="muted">Estado</span>
          <Badge tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Badge>
        </div>
        {p.reviewedAt && (
          <div className="row between">
            <span className="muted">Revisó</span>
            <span>
              {userName(db, p.reviewedBy)} · {fmtDateTime(p.reviewedAt)}
            </span>
          </div>
        )}
        {p.reviewNote && <div className="banner warn">{p.reviewNote}</div>}
        {p.receipt &&
          (p.receipt.type?.startsWith('image/') ? (
            <img src={p.receipt.dataUrl} alt="Comprobante" style={{ width: '100%', borderRadius: 14, border: '1px solid var(--border)' }} />
          ) : (
            <Attachment file={p.receipt} />
          ))}
        {review && isPending && (
          <Field label="Nota para el residente">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Obligatoria si rechazas" />
          </Field>
        )}
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
  const debtors = residents
    .map((r) => {
      const debt = debtOf(db, r.unitId);
      return { r, owed: debt.rows, amount: debt.amount };
    })
    .filter((x) => x.owed.length);
  const [waiveFor, setWaiveFor] = useState(null);
  const unmatched = (db.bankMovements || []).filter((m) => m.status === 'unmatched');
  const thisMonth = db.payments.filter((p) => p.status === 'approved' && paymentMonth(p) === monthKey());

  return (
    <>
      <PageHead title="Cobranza" subtitle="Concilia el estado de cuenta, revisa comprobantes y da seguimiento a la morosidad." />
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat label="Por revisar" value={pending.length} />
        <Stat label="Cobrado este mes" value={money(thisMonth.reduce((s, p) => s + p.amount, 0))} />
        <Stat label="Casas al corriente" value={`${residents.length - debtors.length}/${residents.length}`} />
        <Stat label="Adeudo total" value={money(debtors.reduce((s, d) => s + d.amount, 0))} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'pending', label: 'Por revisar', count: pending.length },
            { value: 'bank', label: 'Conciliación', count: unmatched.length },
            { value: 'debt', label: 'Morosidad', count: debtors.length },
            { value: 'all', label: 'Historial' },
            { value: 'charges', label: 'Conceptos', count: (db.settings.charges || []).filter((c) => !c.archived).length || undefined },
          ]}
        />
      </div>

      {tab === 'pending' && (
        <Card>
          {pending.length === 0 && <Empty icon={<Check />}>Todo revisado.</Empty>}
          <div className="list">
            {pending.map((p) => (
              <div key={p.id} className="list-item wrap">
                {p.receipt?.type?.startsWith('image/') ? (
                  <img src={p.receipt.dataUrl} className="thumb" alt="" />
                ) : (
                  <div className="avatar">
                    <FileText size={16} />
                  </div>
                )}
                <div className="grow">
                  <div className="title">
                    {userName(db, p.residentId)} · {unitLabel(db, p.unitId)}
                  </div>
                  <div className="faint">
                    {periodLabel(p)} · {METHOD[p.method]} · {fmtDateTime(p.createdAt)}
                  </div>
                </div>
                <b>{money(p.amount)}</b>
                <Button size="sm" variant="primary" onClick={() => setViewing(p)}>
                  Revisar
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'bank' && <Reconciliation />}

      {tab === 'charges' && <Charges />}

      {tab === 'debt' && (
        <Card>
          <CardHead title="Casas con adeudo">
            {debtors.length > 0 && (
              <Button
                size="sm"
                onClick={() => {
                  actions.sendReminder(debtors.map((d) => d.r.id));
                  toast('Recordatorio enviado', `${debtors.length} residente(s) notificados.`);
                }}
              >
                <Bell size={15} /> Recordar a todos
              </Button>
            )}
          </CardHead>
          {debtors.length === 0 && <Empty>Todas las casas están al corriente.</Empty>}
          <div className="list">
            {debtors.map(({ r, owed, amount }) => (
              <div key={r.id} className="list-item wrap">
                <div className="grow">
                  <div className="title">
                    {unitLabel(db, r.unitId)} · {r.name}
                  </div>
                  <div className="faint">
                    {owed.map((o) => o.label).join(', ')} · Ref. <span className="mono">{unitReference(db, r.unitId)}</span>
                  </div>
                  {owed.some((o) => o.lateFee) && <div className="faint">Recargos: {money(owed.reduce((s, o) => s + o.lateFee, 0))}</div>}
                </div>
                <b style={{ color: 'var(--bad)' }}>{money(amount)}</b>
                <Button
                  size="sm"
                  onClick={() => {
                    actions.sendReminder([r.id]);
                    toast('Recordatorio enviado', r.name);
                  }}
                >
                  <Bell size={15} />
                </Button>
                {owed.some((o) => o.lateFee) && (
                  <Button size="sm" onClick={() => setWaiveFor({ r, owed })}>
                    Condonar recargo
                  </Button>
                )}
                <Button size="sm" onClick={() => setCashFor({ r, owed })}>
                  <Plus size={15} /> Efectivo
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'all' && (
        <Card>
          <div className="show-sm">
            {[...db.payments]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map((p) => (
                <div key={p.id} className="m-card" onClick={() => setViewing(p)}>
                  <div className="avatar">
                    <Receipt size={16} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row between" style={{ flexWrap: 'nowrap' }}>
                      <b style={{ fontWeight: 600 }}>{unitLabel(db, p.unitId)}</b>
                      <span>{money(p.amount)}</span>
                    </div>
                    <div className="faint">
                      {periodLabel(p)} · {METHOD[p.method]} · {userName(db, p.residentId)}
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <Badge tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Badge>
                    </div>
                  </div>
                </div>
              ))}
          </div>
          <div className="table-wrap hide-sm">
            <table>
              <thead>
                <tr>
                  <th>Casa</th>
                  <th>Concepto</th>
                  <th>Método</th>
                  <th>Monto</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...db.payments]
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .map((p) => (
                    <tr key={p.id}>
                      <td>
                        {unitLabel(db, p.unitId)}
                        <div className="faint">{userName(db, p.residentId)}</div>
                      </td>
                      <td>{periodLabel(p)}</td>
                      <td>{METHOD[p.method]}</td>
                      <td>{money(p.amount)}</td>
                      <td>
                        <Badge tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Badge>
                      </td>
                      <td>
                        <Button size="sm" variant="ghost" onClick={() => setViewing(p)}>
                          Ver
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {viewing && <PaymentDetail p={viewing} review onClose={() => setViewing(null)} />}
      {cashFor && <CashModal {...cashFor} onClose={() => setCashFor(null)} />}
      {waiveFor && <WaiveModal {...waiveFor} onClose={() => setWaiveFor(null)} />}
    </>
  );
}

function CashModal({ r, owed, onClose }) {
  const { actions, toast } = useStore();
  const [periods, setPeriods] = useState(owed.map((o) => o.key));
  const [reference, setReference] = useState('');
  return (
    <Modal
      title={`Registrar efectivo · ${r.name}`}
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          disabled={!periods.length}
          onClick={() =>
            actions.registerCashPayment({ residentId: r.id, periods, reference }).then(
              () => {
                toast('Pago registrado', 'Se notificó al residente.');
                onClose();
              },
              () => {},
            )
          }
        >
          Registrar
        </Button>
      }
    >
      <div className="stack">
        <div className="chips">
          {owed.map((o) => (
            <button
              key={o.key}
              className={`chip ${periods.includes(o.key) ? 'on' : ''}`}
              onClick={() => setPeriods((p) => (p.includes(o.key) ? p.filter((x) => x !== o.key) : [...p, o.key]))}
            >
              {o.label} · {money(o.amount)}
            </button>
          ))}
        </div>
        <div className="row between">
          <span className="muted">Total</span>
          <b>{money(sumAmount(owed.filter((o) => periods.includes(o.key))))}</b>
        </div>
        <Field label="Folio del recibo">
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function WaiveModal({ r, onClose }) {
  const { db, actions, toast } = useStore();
  const withFee = debtOf(db, r.unitId).rows.filter((o) => o.lateFee > 0);
  return (
    <Modal title={`Condonar recargos · ${unitLabel(db, r.unitId)}`} onClose={onClose}>
      <div className="stack">
        <p className="muted">La cuota del mes se sigue debiendo; sólo se quita el recargo. Queda registrado en la auditoría.</p>
        {withFee.length === 0 && <Empty icon={<Check />}>Sin recargos por condonar.</Empty>}
        <div className="list">
          {withFee.map((o) => (
            <div key={o.month} className="list-item">
              <div className="grow">
                <div className="title">{monthLabel(o.month)}</div>
                <div className="faint">Recargo {money(o.lateFee)}</div>
              </div>
              <Button
                size="sm"
                onClick={() =>
                  actions.waiveLateFee(r.unitId, o.month).then(
                    () => {
                      toast('Recargo condonado', `${unitLabel(db, r.unitId)} · ${monthLabel(o.month)}`);
                    },
                    () => {},
                  )
                }
              >
                Condonar
              </Button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
