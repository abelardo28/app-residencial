// Suscripción del residencial con la empresa (sólo administración): cargos, pago con tarjeta o transferencia,
// cobro automático y la pantalla que se ve cuando el servicio está suspendido por adeudo.
import { useState } from 'react';
import { AlertTriangle, CreditCard, Home, Landmark, LogOut, RefreshCw, Trash2 } from 'lucide-react';
import { invoiceState, payable, subscriptionReference } from '@residencial/shared';
import { useStore } from '../data/store';
import { fileToAttachment, fmtDate, money, monthLabel } from '../lib/utils';
import { EcartCheckout } from '../pages/Payments';
import { Attachment, Badge, Button, Card, CardHead, Field, FileDrop, Modal, Tabs } from './ui';

export const INVOICE_STATE = {
  paid: ['Pagado', 'ok'],
  pending: ['Pendiente', 'warn'],
  overdue: ['Vencido', 'bad'],
  review: ['En revisión', 'info'],
  void: ['Cancelado', ''],
};
const METHOD = { transfer: 'transferencia', card: 'tarjeta', cash: 'efectivo', ecartpay: 'tarjeta' };

export function SubscriptionCard() {
  const { root, session, subscription, toast } = useStore();
  const [paying, setPaying] = useState(null);
  const [busy, setBusy] = useState(false);
  const res = root.platform.residencias.find((r) => r.id === session.tenantId);
  const plan = root.platform.plans.find((p) => p.id === res?.plan);
  const billing = root.platform.billing?.find((b) => b.tenantId === session.tenantId) || { autopay: false, card: null };
  const invoices = root.platform.invoices
    .filter((i) => i.tenantId === session.tenantId && i.status !== 'void')
    .sort((a, b) => b.period.localeCompare(a.period))
    .slice(0, 6);
  const owed = invoices.filter(payable);

  async function act(fn, done) {
    setBusy(true);
    try {
      await fn();
      toast(...done);
    } catch {
      /* el motivo ya se mostró */
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHead
        title="Suscripción"
        subtitle={plan ? `Plan ${plan.name} · ${money(plan.price)} al mes · hasta ${plan.maxUnits} unidades` : ''}
      />
      <div className="sub-autopay">
        <div className="avatar">
          <RefreshCw size={16} />
        </div>
        <div className="grow">
          <div className="title">Cobro automático</div>
          <div className="faint">
            {billing.card
              ? `${billing.card.brand} •••• ${billing.card.last4} · ${billing.autopay ? 'se cobra sola cada mes' : 'en pausa'}`
              : 'Paga con tarjeta y marca «Cobrar automáticamente» para no tener que hacerlo cada mes.'}
          </div>
        </div>
        {billing.card && (
          <div className="row" style={{ gap: 6, flexWrap: 'nowrap', flexShrink: 0 }}>
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={billing.autopay}
                disabled={busy}
                aria-label="Cobro automático"
                onChange={(e) => {
                  const on = e.target.checked;
                  act(() => subscription.setAutopay(on), on ? ['Cobro automático activado'] : ['Cobro automático en pausa']);
                }}
              />
              Activo
            </label>
            <Button
              variant="ghost"
              size="sm"
              className="icon-btn"
              aria-label="Quitar tarjeta"
              title="Quitar tarjeta"
              disabled={busy}
              onClick={() => act(() => subscription.removeCard(), ['Tarjeta eliminada'])}
            >
              <Trash2 size={15} />
            </Button>
          </div>
        )}
      </div>
      <div className="list">
        {invoices.map((i) => {
          const st = invoiceState(i);
          const [label, tone] = INVOICE_STATE[st] || ['', ''];
          return (
            <div key={i.id} className="list-item">
              <div className="grow">
                <div className="title">{monthLabel(i.period)}</div>
                <div className="faint">
                  {i.status === 'paid'
                    ? `Pagado el ${fmtDate(i.paidAt)}${METHOD[i.method] ? ` con ${METHOD[i.method]}` : ''}`
                    : st === 'review'
                      ? `Comprobante enviado el ${fmtDate(i.review.submittedAt)}; la empresa lo está revisando`
                      : i.review?.rejectedAt
                        ? `Comprobante rechazado: ${i.review.rejectReason}`
                        : `Vence el ${fmtDate(i.dueDate + 'T12:00')}`}
                </div>
              </div>
              <b>{money(i.amount)}</b>
              {payable(i) ? (
                <Button size="sm" variant={st === 'overdue' ? 'primary' : undefined} onClick={() => setPaying(i)}>
                  Pagar
                </Button>
              ) : (
                <Badge tone={tone}>{label}</Badge>
              )}
            </div>
          );
        })}
      </div>
      {!owed.length && (
        <p className="faint" style={{ marginTop: 10 }}>
          Estás al corriente con la suscripción.
        </p>
      )}
      {paying && <PaySubscription invoice={paying} billing={billing} onClose={() => setPaying(null)} />}
    </Card>
  );
}

function PaySubscription({ invoice, billing, onClose }) {
  const { root, subscription, toast } = useStore();
  const bank = root.platform.company.bank;
  const [method, setMethod] = useState('card');
  const [saveCard, setSaveCard] = useState(!billing.autopay);
  const [reference, setReference] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [checkout, setCheckout] = useState(null);
  const [busy, setBusy] = useState(false);
  const ref = subscriptionReference(invoice);

  async function submit() {
    setBusy(true);
    try {
      if (method === 'card') {
        const c = await subscription.startCard(invoice.id, saveCard);
        if (c.checkoutUrl) window.open(c.checkoutUrl, '_blank', 'noopener');
        setCheckout({ ...c, invoiceId: invoice.id, saveCard });
        return;
      }
      if (!receipt) return toast('Falta el comprobante', 'Adjunta la imagen o PDF de tu transferencia.', 'bad');
      await subscription.submitTransfer(invoice.id, { reference: reference || ref, receipt: receipt.dataUrl });
      toast('Comprobante enviado', 'La empresa lo revisará y te avisaremos.');
      onClose();
    } catch {
      /* el motivo ya se mostró */
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    let st;
    try {
      st = await subscription.confirmCard(checkout);
    } catch {
      return;
    } finally {
      setBusy(false);
    }
    if (st.status !== 'paid') return toast('Pago pendiente', 'Ecart Pay aún no confirma el pago.', 'bad');
    toast('¡Pago recibido!', checkout.saveCard ? 'Activamos el cobro automático con esta tarjeta.' : `${money(invoice.amount)} pagados.`);
    onClose();
  }

  if (checkout) return <EcartCheckout total={invoice.amount} checkout={checkout} busy={busy} onPay={confirm} onClose={onClose} />;

  return (
    <Modal
      title={`Suscripción · ${monthLabel(invoice.period)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={busy || (method === 'transfer' && !bank)} onClick={submit}>
            {method === 'card' ? `Pagar ${money(invoice.amount)}` : 'Enviar comprobante'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Tabs
          value={method}
          onChange={setMethod}
          items={[
            { value: 'card', label: 'Tarjeta', icon: <CreditCard size={15} /> },
            { value: 'transfer', label: 'Transferencia', icon: <Landmark size={15} /> },
          ]}
        />
        {method === 'card' && (
          <>
            <p className="muted">Paga con tarjeta de crédito o débito en Ecart Pay. El pago se registra al momento.</p>
            {!billing.autopay && (
              <label className="check">
                <input type="checkbox" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} />
                <span>
                  <b>Cobrar automáticamente cada mes</b>
                  <span className="faint">
                    Guardamos la tarjeta en Ecart Pay (no en la app) y te avisamos de cada cobro. Puedes quitarla cuando quieras.
                  </span>
                </span>
              </label>
            )}
          </>
        )}
        {method === 'transfer' &&
          (bank ? (
            <>
              <div className="card flat" style={{ padding: 14 }}>
                <div className="faint">Transfiere a</div>
                <div>{bank.holder}</div>
                <div>
                  {bank.name} · CLABE <span className="mono">{bank.clabe}</span>
                </div>
                <div>
                  Concepto o referencia <b className="mono">{ref}</b>
                </div>
              </div>
              <Field label="Clave de rastreo (opcional)">
                <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={ref} />
              </Field>
              {receipt ? (
                <Attachment file={receipt} onRemove={() => setReceipt(null)} />
              ) : (
                <FileDrop
                  accept="image/*,application/pdf"
                  label="Sube el comprobante (imagen o PDF)"
                  onFiles={async ([f]) => f && setReceipt(await fileToAttachment(f))}
                />
              )}
              <p className="faint">La empresa revisa el comprobante y el cargo queda pagado cuando lo aprueba.</p>
            </>
          ) : (
            <p className="muted">La empresa aún no registra su cuenta para transferencias. Paga con tarjeta o contáctala.</p>
          ))}
        <div className="row between" style={{ paddingTop: 4 }}>
          <span className="muted">Total</span>
          <b style={{ fontSize: 20 }}>{money(invoice.amount)}</b>
        </div>
      </div>
    </Modal>
  );
}

/** Lo único que ve la administración mientras el servicio está suspendido: pagar para reactivarlo. */
export function SuspendedAdmin() {
  const { root, session, actions } = useStore();
  const res = root.platform.residencias.find((r) => r.id === session.tenantId);
  return (
    <div className="suspended-shell">
      <div className="suspended-box stack">
        <div className="brand">
          <div className="brand-mark">
            <Home size={18} />
          </div>
          <div>
            <b>{res?.name}</b>
            <small>Administración</small>
          </div>
        </div>
        <div className="banner bad">
          <AlertTriangle size={18} />
          <div>
            <b>El servicio está suspendido.</b> Residentes y vigilancia no pueden entrar a la app
            {res?.statusReason ? ` (${res.statusReason.toLowerCase()})` : ''}.{' '}
            {/adeudo/i.test(res?.statusReason || '')
              ? 'Paga los cargos pendientes y se reactivará al momento.'
              : 'Contacta a la empresa para reactivarlo.'}
          </div>
        </div>
        <SubscriptionCard />
        <Button variant="ghost" onClick={actions.logout}>
          <LogOut size={16} /> Cerrar sesión
        </Button>
      </div>
    </div>
  );
}
