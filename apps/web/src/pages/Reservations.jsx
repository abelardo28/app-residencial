import { useState } from 'react';
import { CalendarDays, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useStore, unitLabel, userName } from '../data/store';
import { money } from '../lib/utils';
import { debtRestriction } from '@residencial/shared';
import { Badge, Button, Card, CardHead, Chips, Empty, Field, Modal, PageHead } from '../components/ui';

export default function Reservations() {
  const { db, me, actions } = useStore();
  const [creating, setCreating] = useState(null);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = db.reservations
    .filter((r) => r.status === 'approved' && r.date >= today)
    .sort((a, b) => (a.date + a.from).localeCompare(b.date + b.from));
  const mine = me.role === 'admin' ? upcoming : upcoming.filter((r) => r.unitId === me.unitId);
  const blocked = me.role === 'resident' ? debtRestriction(db, me.unitId, 'reservations') : null;
  const isAdmin = me.role === 'admin';
  const [editing, setEditing] = useState(null);
  const amenities = db.settings.amenities.filter((a) => !a.archived && (isAdmin || a.active !== false));

  return (
    <>
      <PageHead
        title={me.role === 'admin' ? 'Reservaciones' : 'Reservar áreas comunes'}
        subtitle="Consulta la disponibilidad y aparta en segundos, sin choques de horario."
      >
        {isAdmin && (
          <Button variant="primary" onClick={() => setEditing({})}>
            <Plus size={16} /> Nueva área
          </Button>
        )}
      </PageHead>
      {blocked && (
        <div className="banner warn" style={{ marginBottom: 16 }}>
          {blocked}
        </div>
      )}
      <div className="grid g4" style={{ marginBottom: 16 }}>
        {amenities.length === 0 && (
          <Card>
            <Empty icon={<CalendarDays />}>
              {isAdmin ? 'Agrega las áreas que los residentes pueden apartar.' : 'Aún no hay áreas para reservar.'}
            </Empty>
          </Card>
        )}
        {amenities.map((a) => (
          <Card key={a.id} className="stack" style={{ gap: 6 }}>
            <div className="row between" style={{ flexWrap: 'nowrap' }}>
              <h3>{a.name}</h3>
              {isAdmin && (
                <Button size="sm" variant="ghost" className="icon-btn" aria-label={`Editar ${a.name}`} onClick={() => setEditing(a)}>
                  <Pencil size={15} />
                </Button>
              )}
            </div>
            {a.active === false && <Badge tone="warn">Pausada</Badge>}
            {a.description && <div className="faint">{a.description}</div>}
            <div className="faint">
              {a.open}–{a.close} · <Users size={12} /> {a.capacity}
            </div>
            <div className="faint">{a.deposit ? `Depósito ${money(a.deposit)}` : 'Sin depósito'}</div>
            <div className="faint">{upcoming.filter((r) => r.amenityId === a.id).length} reservación(es) próximas</div>
            {me.role === 'resident' && (
              <Button size="sm" disabled={!!blocked} onClick={() => setCreating(a.id)}>
                <Plus size={14} /> Reservar
              </Button>
            )}
          </Card>
        ))}
      </div>
      <Card>
        <CardHead title={me.role === 'admin' ? 'Próximas reservaciones' : 'Mis reservaciones'} />
        {mine.length === 0 && <Empty icon={<CalendarDays />}>No hay reservaciones próximas.</Empty>}
        <div className="list">
          {mine.map((r) => (
            <div key={r.id} className="list-item">
              <div className="avatar">
                <CalendarDays size={16} />
              </div>
              <div className="grow">
                <div className="title">{db.settings.amenities.find((a) => a.id === r.amenityId)?.name}</div>
                <div className="faint">
                  {new Date(r.date + 'T12:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })} · {r.from}–
                  {r.to} · {r.guests} personas{me.role === 'admin' ? ` · ${unitLabel(db, r.unitId)} (${userName(db, r.residentId)})` : ''}
                </div>
              </div>
              <Badge tone="ok">Confirmada</Badge>
              <Button size="sm" variant="ghost" className="danger" onClick={() => actions.cancelReservation(r.id)}>
                Cancelar
              </Button>
            </div>
          ))}
        </div>
      </Card>
      {creating && <CreateReservation amenityId={creating} onClose={() => setCreating(null)} />}
      {editing && <AmenityModal amenity={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function CreateReservation({ amenityId, onClose }) {
  const { db, actions, toast } = useStore();
  const [f, setF] = useState({
    amenityId,
    date: new Date(Date.now() + 864e5).toISOString().slice(0, 10),
    from: '16:00',
    to: '18:00',
    guests: 10,
    notes: '',
  });
  const [err, setErr] = useState('');
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const am = db.settings.amenities.find((a) => a.id === f.amenityId);
  const taken = db.reservations.filter((r) => r.status === 'approved' && r.amenityId === f.amenityId && r.date === f.date);

  async function submit() {
    setErr('');
    if (f.from >= f.to) return setErr('La hora de término debe ser posterior al inicio.');
    if (f.from < am.open || f.to > am.close) return setErr(`Horario disponible ${am.open}–${am.close}.`);
    if (Number(f.guests) > am.capacity) return setErr(`Capacidad máxima: ${am.capacity} personas.`);
    try {
      await actions.createReservation({ ...f, guests: Number(f.guests) });
      toast('Reservación confirmada', `${am.name} · ${f.date} ${f.from}–${f.to}`);
      onClose();
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <Modal
      title="Nueva reservación"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={submit}>
            Reservar
          </Button>
        </>
      }
    >
      <div className="stack">
        <Chips
          value={f.amenityId}
          onChange={set('amenityId')}
          options={db.settings.amenities.filter((a) => !a.archived && a.active !== false).map((a) => ({ value: a.id, label: a.name }))}
        />
        <Field label="Fecha">
          <input type="date" className="input" value={f.date} min={new Date().toISOString().slice(0, 10)} onChange={set('date')} />
        </Field>
        {taken.length > 0 && <div className="faint">Ocupado ese día: {taken.map((t) => `${t.from}–${t.to}`).join(', ')}</div>}
        <div className="grid g2">
          <Field label="Desde">
            <input type="time" className="input" value={f.from} onChange={set('from')} />
          </Field>
          <Field label="Hasta">
            <input type="time" className="input" value={f.to} onChange={set('to')} />
          </Field>
        </div>
        <Field label="Invitados">
          <input type="number" className="input" min={1} value={f.guests} onChange={set('guests')} />
        </Field>
        {am.deposit > 0 && <div className="banner info">Esta área requiere un depósito de {money(am.deposit)} reembolsable.</div>}
        {err && <div className="banner bad">{err}</div>}
      </div>
    </Modal>
  );
}

function AmenityModal({ amenity, onClose }) {
  const { actions, toast } = useStore();
  const isNew = !amenity.id;
  const [f, setF] = useState({
    name: amenity.name || '',
    capacity: amenity.capacity ?? 10,
    open: amenity.open || '09:00',
    close: amenity.close || '21:00',
    deposit: amenity.deposit ?? 0,
    description: amenity.description || '',
    active: amenity.active !== false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));

  async function run(fn, done) {
    setErr('');
    setBusy(true);
    try {
      await fn();
      toast(...done);
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  const save = () => {
    if (!f.name.trim()) return setErr('Escribe el nombre del área.');
    if (f.open >= f.close) return setErr('La hora de cierre debe ser posterior a la de apertura.');
    if (!(Number(f.capacity) >= 1)) return setErr('La capacidad debe ser de al menos 1 persona.');
    run(
      () =>
        actions.saveAmenity({
          ...(isNew ? {} : { id: amenity.id }),
          name: f.name.trim(),
          capacity: Number(f.capacity),
          open: f.open,
          close: f.close,
          deposit: Number(f.deposit) || 0,
          description: f.description.trim(),
          active: f.active,
        }),
      [isNew ? 'Área agregada' : 'Área actualizada', f.name.trim()],
    );
  };

  return (
    <Modal
      title={isNew ? 'Nueva área común' : `Editar ${amenity.name}`}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <Button
              variant="ghost"
              className="danger"
              disabled={busy}
              style={{ marginRight: 'auto' }}
              onClick={() =>
                window.confirm(`¿Eliminar ${amenity.name}? Ya no se podrá reservar.`) &&
                run(() => actions.deleteAmenity(amenity.id), ['Área eliminada', amenity.name])
              }
            >
              <Trash2 size={15} /> Eliminar
            </Button>
          )}
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
        <Field label="Nombre">
          <input className="input" value={f.name} onChange={set('name')} placeholder="Casa club, asadores, cancha…" />
        </Field>
        <div className="grid g2">
          <Field label="Abre">
            <input type="time" className="input" value={f.open} onChange={set('open')} />
          </Field>
          <Field label="Cierra">
            <input type="time" className="input" value={f.close} onChange={set('close')} />
          </Field>
        </div>
        <div className="grid g2">
          <Field label="Capacidad (personas)">
            <input type="number" className="input" min={1} value={f.capacity} onChange={set('capacity')} />
          </Field>
          <Field label="Depósito reembolsable">
            <input type="number" className="input" min={0} value={f.deposit} onChange={set('deposit')} />
          </Field>
        </div>
        <Field label="Reglas o descripción (opcional)">
          <textarea
            className="input"
            rows={2}
            value={f.description}
            onChange={set('description')}
            placeholder="Ej. sin música después de las 22:00"
          />
        </Field>
        {!isNew && (
          <label className="check">
            <input type="checkbox" checked={!f.active} onChange={(e) => set('active')(!e.target.checked)} />
            <span>
              <b>Pausar reservaciones</b>
              <span className="faint">Los residentes no la verán mientras esté pausada; las reservaciones ya hechas se mantienen.</span>
            </span>
          </label>
        )}
        {err && <div className="banner bad">{err}</div>}
      </div>
    </Modal>
  );
}
