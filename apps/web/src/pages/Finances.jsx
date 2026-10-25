import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useStore } from '../data/store';
import { money, monthKey, monthLabel, fmtDate } from '../lib/utils';
import { paymentMonth } from '@residencial/shared';
import { Button, Card, CardHead, Field, Modal, PageHead, Stat, Empty } from '../components/ui';

const CATS = ['Seguridad', 'Mantenimiento', 'Servicios', 'Administración', 'Fondo de reserva', 'Otro'];

export default function Finances() {
  const { db, me } = useStore();
  const [adding, setAdding] = useState(false);
  const m = monthKey();
  const income = db.payments.filter((p) => p.status === 'approved' && paymentMonth(p) === m).reduce((s, p) => s + p.amount, 0);
  const monthExp = db.expenses.filter((e) => e.date.slice(0, 7) === m);
  const spent = monthExp.reduce((s, e) => s + e.amount, 0);
  const byCat = CATS.map((c) => ({ c, v: monthExp.filter((e) => e.category === c).reduce((s, e) => s + e.amount, 0) })).filter((x) => x.v);
  const max = Math.max(1, ...byCat.map((x) => x.v));

  return (
    <>
      <PageHead
        title={me.role === 'admin' ? 'Finanzas' : 'Transparencia'}
        subtitle={`En qué se usan las cuotas · ${monthLabel(m)}`}
        fab={me.role === 'admin' ? { icon: <Plus size={18} />, label: 'Gasto', onClick: () => setAdding(true) } : null}
      >
        {me.role === 'admin' && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Registrar gasto
          </Button>
        )}
      </PageHead>
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Stat label="Ingresos del mes" value={money(income)} />
        <Stat label="Gastos del mes" value={money(spent)} />
        <Stat label="Balance" value={money(income - spent)} />
      </div>
      <div className="grid g2">
        <Card>
          <CardHead title="Gastos por categoría" />
          {byCat.length === 0 && <Empty>Sin gastos este mes.</Empty>}
          <div className="stack">
            {byCat.map(({ c, v }) => (
              <div key={c}>
                <div className="row between" style={{ fontSize: 13 }}>
                  <span>{c}</span>
                  <span className="muted">{money(v)}</span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(v / max) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHead title="Movimientos" />
          <div className="list">
            {db.expenses.map((e) => (
              <div key={e.id} className="list-item">
                <div className="grow">
                  <div className="title">{e.concept}</div>
                  <div className="faint">
                    {e.category} · {fmtDate(e.date + 'T12:00')}
                  </div>
                </div>
                <b>{money(e.amount)}</b>
              </div>
            ))}
          </div>
        </Card>
      </div>
      {adding && <AddExpense onClose={() => setAdding(false)} />}
    </>
  );
}

function AddExpense({ onClose }) {
  const { actions } = useStore();
  const [f, setF] = useState({ concept: '', category: CATS[0], amount: '', date: new Date().toISOString().slice(0, 10) });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal
      title="Registrar gasto"
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          onClick={() => {
            if (!f.concept || !f.amount) return;
            actions.addExpense({ ...f, amount: Number(f.amount) }).then(onClose, () => {});
          }}
        >
          Guardar
        </Button>
      }
    >
      <div className="stack">
        <Field label="Concepto">
          <input className="input" value={f.concept} onChange={set('concept')} />
        </Field>
        <Field label="Categoría">
          <select className="select" value={f.category} onChange={set('category')}>
            {CATS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <div className="grid g2">
          <Field label="Monto">
            <input type="number" className="input" value={f.amount} onChange={set('amount')} />
          </Field>
          <Field label="Fecha">
            <input type="date" className="input" value={f.date} onChange={set('date')} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
