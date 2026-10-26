// Casas o departamentos del residencial (administración): alta, cambio de nombre y baja.
// Cada uno conserva su referencia SPEI aunque se agreguen o quiten otros.
import { useState } from 'react';
import { Home, Pencil, Plus, Trash2 } from 'lucide-react';
import { unitReference } from '@residencial/shared';
import { useStore } from '../data/store';
import { Button, Card, CardHead, Empty, Field, Modal } from './ui';

export const byLabel = (a, b) => a.label.localeCompare(b.label, 'es', { numeric: true });

export default function Units() {
  const { db, root, session, actions, toast } = useStore();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const plan = root.platform.plans.find((p) => p.id === root.platform.residencias.find((r) => r.id === session.tenantId)?.plan);
  const term = q.trim().toLowerCase();
  const units = [...db.units].sort(byLabel).filter((u) => !term || `${u.label} ${u.street}`.toLowerCase().includes(term));
  const residents = (id) => db.users.filter((u) => u.role === 'resident' && u.unitId === id);

  return (
    <Card>
      <CardHead
        title="Domicilios"
        subtitle={`${db.units.length} registrados${plan ? ` · tu plan incluye hasta ${plan.maxUnits}` : ''}. Cada uno tiene su referencia para pagar por SPEI.`}
      >
        <Button size="sm" variant="primary" onClick={() => setEditing({})}>
          <Plus size={15} /> Agregar domicilio
        </Button>
      </CardHead>
      {plan && db.units.length > plan.maxUnits && (
        <div className="banner warn" style={{ marginBottom: 12 }}>
          Tienes más domicilios de los que incluye el plan {plan.name}. La empresa te contactará para ajustarlo.
        </div>
      )}
      <input
        className="input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar casa o calle"
        style={{ marginBottom: 12 }}
      />
      {units.length === 0 && <Empty icon={<Home />}>Sin resultados.</Empty>}
      <div className="list cols-lg">
        {units.map((u) => {
          const people = residents(u.id);
          return (
            <div key={u.id} className="list-item">
              <div className="avatar">
                <Home size={16} />
              </div>
              <div className="grow">
                <div className="title">{u.label}</div>
                <div className="faint">
                  {u.street ? `${u.street} · ` : ''}Ref. <span className="mono">{unitReference(db, u.id)}</span>
                </div>
                <div className="faint">{people.length ? people.map((p) => p.name).join(', ') : 'Sin residentes'}</div>
              </div>
              <Button size="sm" variant="ghost" className="icon-btn" aria-label={`Editar ${u.label}`} onClick={() => setEditing(u)}>
                <Pencil size={15} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="icon-btn danger"
                aria-label={`Eliminar ${u.label}`}
                onClick={() =>
                  window.confirm(`¿Eliminar ${u.label}?`) &&
                  actions.deleteUnit(u.id).then(
                    () => toast('Domicilio eliminado', u.label),
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
      {editing && <UnitModal unit={editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function UnitModal({ unit, onClose }) {
  const { actions, toast } = useStore();
  const isNew = !unit.id;
  const [f, setF] = useState({ label: unit.label || '', street: unit.street || '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!f.label.trim()) return setErr('Escribe el número o nombre del domicilio.');
    setBusy(true);
    try {
      await actions.saveUnit({ ...(isNew ? {} : { id: unit.id }), label: f.label.trim(), street: f.street.trim() });
      toast(isNew ? 'Domicilio agregado' : 'Domicilio actualizado', f.label.trim());
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={isNew ? 'Agregar domicilio' : `Editar ${unit.label}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={busy} onClick={save}>
            {isNew ? 'Agregar' : 'Guardar'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Casa o departamento">
          <input
            className="input"
            value={f.label}
            onChange={(e) => setF({ ...f, label: e.target.value })}
            placeholder="Ej. Casa 13 o Depto 204"
            autoFocus
          />
        </Field>
        <Field label="Calle, privada o torre (opcional)">
          <input className="input" value={f.street} onChange={(e) => setF({ ...f, street: e.target.value })} />
        </Field>
        {err && <div className="banner bad">{err}</div>}
      </div>
    </Modal>
  );
}
