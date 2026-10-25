// Conceptos de cobro además de la cuota (administración): cuota extraordinaria, multa, fondo de reserva…
// Se cobran una vez o cada mes, a todas las casas o sólo a algunas, y aparecen en el estado de cuenta del residente.
import { useState } from 'react';
import { Pencil, Plus, Receipt, Trash2 } from 'lucide-react';
import { CHARGE_KINDS, chargeApplies, ledger } from '@residencial/shared';
import { useStore } from '../data/store';
import { fmtDate, money, monthKey, monthLabel } from '../lib/utils';
import { Badge, Button, Card, CardHead, Chips, Empty, Field, Modal } from './ui';

const when = (c) =>
  c.kind === 'once'
    ? `Cobro único · vence el ${fmtDate(c.dueDate + 'T12:00')}`
    : `Cada mes desde ${monthLabel(c.from)}${c.to ? ` hasta ${monthLabel(c.to)}` : ''}`;

export default function Charges() {
  const { db, actions, toast } = useStore();
  const [editing, setEditing] = useState(null);
  const charges = (db.settings.charges || []).filter((c) => !c.archived);
  const units = db.units;

  /** Casas que ya pagaron (o enviaron comprobante) de este concepto, sobre las que les aplica. */
  const progress = (c) => {
    const rows = units.filter((u) => chargeApplies(c, u.id)).flatMap((u) => ledger(db, u.id).filter((r) => r.chargeId === c.id));
    return { paid: rows.filter((r) => r.state === 'paid').length, total: rows.length };
  };

  return (
    <Card>
      <CardHead
        title="Conceptos de cobro"
        subtitle={`Además de la cuota de ${money(db.settings.monthlyFee)}. Cada residente los ve en su estado de cuenta y los paga igual que la cuota.`}
      >
        <Button size="sm" variant="primary" onClick={() => setEditing({})}>
          <Plus size={15} /> Nuevo concepto
        </Button>
      </CardHead>
      {charges.length === 0 && (
        <Empty icon={<Receipt />}>Aún no hay conceptos. Agrega una cuota extraordinaria, una multa o el fondo de reserva.</Empty>
      )}
      <div className="list">
        {charges.map((c) => {
          const p = progress(c);
          return (
            <div key={c.id} className="list-item wrap">
              <div className="avatar">
                <Receipt size={16} />
              </div>
              <div className="grow">
                <div className="title">{c.name}</div>
                <div className="faint">
                  {when(c)} · {c.unitIds?.length ? `${c.unitIds.length} casa(s)` : 'Todas las casas'}
                </div>
                {p.total > 0 && (
                  <div className="faint">
                    {p.paid} de {p.total} pagado(s)
                  </div>
                )}
              </div>
              <b>{money(c.amount)}</b>
              <Badge tone="info">{CHARGE_KINDS[c.kind]}</Badge>
              <Button size="sm" variant="ghost" className="icon-btn" aria-label={`Editar ${c.name}`} onClick={() => setEditing(c)}>
                <Pencil size={15} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="icon-btn danger"
                aria-label={`Eliminar ${c.name}`}
                onClick={() =>
                  window.confirm(`¿Eliminar «${c.name}»? Deja de cobrarse; los pagos que ya se hicieron se conservan.`) &&
                  actions.deleteCharge(c.id).then(
                    () => toast('Concepto eliminado', c.name),
                    () => {},
                  )
                }
              >
                <Trash2 size={15} />
              </Button>
            </div>
          );
        })}
      </div>
      {editing && <ChargeModal charge={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function ChargeModal({ charge, onClose }) {
  const { db, actions, toast } = useStore();
  const isNew = !charge.id;
  const nextMonth = new Date();
  nextMonth.setDate(nextMonth.getDate() + 30);
  const [f, setF] = useState({
    name: charge.name || '',
    amount: charge.amount ?? '',
    kind: charge.kind || 'once',
    dueDate: charge.dueDate || nextMonth.toISOString().slice(0, 10),
    from: charge.from || monthKey(),
    to: charge.to || '',
    scope: charge.unitIds?.length ? 'some' : 'all',
    unitIds: charge.unitIds || [],
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));

  async function save() {
    setErr('');
    const amount = Number(f.amount);
    if (!f.name.trim()) return setErr('Escribe el nombre del concepto.');
    if (!(amount > 0)) return setErr('Escribe un monto mayor a cero.');
    if (f.scope === 'some' && !f.unitIds.length) return setErr('Elige al menos una casa.');
    if (f.kind === 'monthly' && f.to && f.to < f.from) return setErr('El mes final debe ser posterior al inicial.');
    setBusy(true);
    try {
      await actions.saveCharge({
        ...(isNew ? {} : { id: charge.id }),
        name: f.name.trim(),
        amount,
        kind: f.kind,
        ...(f.kind === 'once' ? { dueDate: f.dueDate } : { from: f.from, to: f.to || null }),
        unitIds: f.scope === 'some' ? f.unitIds : [],
      });
      toast(isNew ? 'Concepto creado' : 'Concepto actualizado', isNew ? 'Ya aparece en el estado de cuenta de las casas.' : f.name);
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isNew ? 'Nuevo concepto de cobro' : 'Editar concepto'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={busy} onClick={save}>
            {isNew ? 'Crear' : 'Guardar'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Nombre">
          <input className="input" value={f.name} onChange={set('name')} placeholder="Cuota extraordinaria, multa, fondo de reserva…" />
        </Field>
        <Field label="Monto por casa">
          <input type="number" className="input" min={1} value={f.amount} onChange={set('amount')} />
        </Field>
        <Chips
          value={f.kind}
          onChange={set('kind')}
          options={[
            { value: 'once', label: 'Una sola vez' },
            { value: 'monthly', label: 'Cada mes' },
          ]}
        />
        {f.kind === 'once' ? (
          <Field label="Fecha límite de pago">
            <input type="date" className="input" value={f.dueDate} onChange={set('dueDate')} />
          </Field>
        ) : (
          <div className="grid g2">
            <Field label="Desde" hint={`Vence el día ${db.settings.dueDay}, como la cuota`}>
              <input type="month" className="input" value={f.from} onChange={set('from')} />
            </Field>
            <Field label="Hasta (opcional)">
              <input type="month" className="input" value={f.to} min={f.from} onChange={set('to')} />
            </Field>
          </div>
        )}
        <Field label="A quién se cobra">
          <Chips
            value={f.scope}
            onChange={set('scope')}
            options={[
              { value: 'all', label: 'Todas las casas' },
              { value: 'some', label: 'Sólo algunas' },
            ]}
          />
        </Field>
        {f.scope === 'some' && (
          <Chips
            multi
            scroll
            value={f.unitIds}
            onChange={set('unitIds')}
            options={db.units.map((u) => ({ value: u.id, label: u.label }))}
          />
        )}
        {!isNew && <div className="faint">Si cambias el monto, lo que ya se pagó se queda como estaba.</div>}
        {err && <div className="banner bad">{err}</div>}
      </div>
    </Modal>
  );
}
