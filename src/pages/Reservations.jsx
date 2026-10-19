import { useState } from 'react';
import { CalendarDays, Plus, Users } from 'lucide-react';
import { useStore, unitLabel, userName } from '../data/store';
import { money } from '../lib/utils';
import { Badge, Button, Card, CardHead, Chips, Empty, Field, Modal, PageHead } from '../components/ui';

export default function Reservations() {
  const { db, me, actions } = useStore();
  const [creating, setCreating] = useState(null);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = db.reservations.filter((r) => r.status === 'approved' && r.date >= today).sort((a, b) => (a.date + a.from).localeCompare(b.date + b.from));
  const mine = me.role === 'admin' ? upcoming : upcoming.filter((r) => r.unitId === me.unitId);

  return (
    <>
      <PageHead title={me.role === 'admin' ? 'Reservaciones' : 'Reservar áreas comunes'} subtitle="Consulta la disponibilidad y aparta en segundos, sin choques de horario." />
      <div className="grid g4" style={{ marginBottom: 16 }}>
        {db.settings.amenities.map((a) => (
          <Card key={a.id} className="stack" style={{ gap: 6 }}>
            <h3>{a.name}</h3>
            <div className="faint">{a.open}–{a.close} · <Users size={12} /> {a.capacity}</div>
            <div className="faint">{a.deposit ? `Depósito ${money(a.deposit)}` : 'Sin depósito'}</div>
            <div className="faint">{upcoming.filter((r) => r.amenityId === a.id).length} reservación(es) próximas</div>
            {me.role === 'resident' && <Button size="sm" onClick={() => setCreating(a.id)}><Plus size={14} /> Reservar</Button>}
          </Card>
        ))}
      </div>
      <Card>
        <CardHead title={me.role === 'admin' ? 'Próximas reservaciones' : 'Mis reservaciones'} />
        {mine.length === 0 && <Empty icon={<CalendarDays />}>No hay reservaciones próximas.</Empty>}
        <div className="list">
          {mine.map((r) => (
            <div key={r.id} className="list-item">
              <div className="avatar"><CalendarDays size={16} /></div>
              <div className="grow">
                <div className="title">{db.settings.amenities.find((a) => a.id === r.amenityId)?.name}</div>
                <div className="faint">{new Date(r.date + 'T12:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })} · {r.from}–{r.to} · {r.guests} personas{me.role === 'admin' ? ` · ${unitLabel(db, r.unitId)} (${userName(db, r.residentId)})` : ''}</div>
              </div>
              <Badge tone="ok">Confirmada</Badge>
              <Button size="sm" variant="ghost" className="danger" onClick={() => actions.cancelReservation(r.id)}>Cancelar</Button>
            </div>
          ))}
        </div>
      </Card>
      {creating && <CreateReservation amenityId={creating} onClose={() => setCreating(null)} />}
    </>
  );
}

function CreateReservation({ amenityId, onClose }) {
  const { db, actions, toast } = useStore();
  const [f, setF] = useState({ amenityId, date: new Date(Date.now() + 864e5).toISOString().slice(0, 10), from: '16:00', to: '18:00', guests: 10, notes: '' });
  const [err, setErr] = useState('');
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const am = db.settings.amenities.find((a) => a.id === f.amenityId);
  const taken = db.reservations.filter((r) => r.status === 'approved' && r.amenityId === f.amenityId && r.date === f.date);

  function submit() {
    setErr('');
    if (f.from >= f.to) return setErr('La hora de término debe ser posterior al inicio.');
    if (f.from < am.open || f.to > am.close) return setErr(`Horario disponible ${am.open}–${am.close}.`);
    if (Number(f.guests) > am.capacity) return setErr(`Capacidad máxima: ${am.capacity} personas.`);
    try {
      actions.createReservation({ ...f, guests: Number(f.guests) });
      toast('Reservación confirmada', `${am.name} · ${f.date} ${f.from}–${f.to}`);
      onClose();
    } catch (e) { setErr(e.message); }
  }

  return (
    <Modal title="Nueva reservación" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={submit}>Reservar</Button></>}>
      <div className="stack">
        <Chips value={f.amenityId} onChange={set('amenityId')} options={db.settings.amenities.map((a) => ({ value: a.id, label: a.name }))} />
        <Field label="Fecha"><input type="date" className="input" value={f.date} min={new Date().toISOString().slice(0, 10)} onChange={set('date')} /></Field>
        {taken.length > 0 && <div className="faint">Ocupado ese día: {taken.map((t) => `${t.from}–${t.to}`).join(', ')}</div>}
        <div className="grid g2">
          <Field label="Desde"><input type="time" className="input" value={f.from} onChange={set('from')} /></Field>
          <Field label="Hasta"><input type="time" className="input" value={f.to} onChange={set('to')} /></Field>
        </div>
        <Field label="Invitados"><input type="number" className="input" min={1} value={f.guests} onChange={set('guests')} /></Field>
        {am.deposit > 0 && <div className="banner info">Esta área requiere un depósito de {money(am.deposit)} reembolsable.</div>}
        {err && <div className="banner bad">{err}</div>}
      </div>
    </Modal>
  );
}
