import { useState } from 'react';
import { Plus, Wrench, Send } from 'lucide-react';
import { useStore, unitLabel, userName } from '../data/store';
import { fileToAttachment, timeAgo } from '../lib/utils';
import { Badge, Button, Card, Chips, Empty, Field, FileDrop, Modal, PageHead, Tabs } from '../components/ui';

const ST = { abierta: ['Abierto', 'bad'], en_proceso: ['En proceso', 'warn'], resuelta: ['Resuelto', 'ok'] };
const CATEGORIES = ['Alumbrado', 'Plomería', 'Seguridad', 'Áreas verdes', 'Limpieza', 'Ruido / convivencia', 'Otro'];

export default function Incidents() {
  const { db, me } = useStore();
  const [tab, setTab] = useState('open');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const base = me.role === 'admin' ? db.incidents : db.incidents.filter((i) => i.unitId === me.unitId);
  const list = base.filter((i) => (tab === 'open' ? i.status !== 'resuelta' : i.status === 'resuelta'));

  return (
    <>
      <PageHead title="Reportes" subtitle="Reporta fallas o situaciones y da seguimiento hasta que se resuelvan." fab={me.role === 'resident' ? { icon: <Plus size={18} />, label: 'Reportar', onClick: () => setCreating(true) } : null}>
        {me.role === 'resident' && <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> Nuevo reporte</Button>}
      </PageHead>
      <div style={{ marginBottom: 16 }}><Tabs value={tab} onChange={setTab} items={[{ value: 'open', label: 'Activos', count: base.filter((i) => i.status !== 'resuelta').length }, { value: 'done', label: 'Resueltos' }]} /></div>
      <Card>
        {list.length === 0 && <Empty icon={<Wrench />}>Sin reportes.</Empty>}
        <div className="list cols-lg">
          {list.map((i) => (
            <div key={i.id} className="list-item" style={{ cursor: 'pointer' }} onClick={() => setOpenId(i.id)}>
              {i.photo ? <img src={i.photo.dataUrl} className="thumb" alt="" /> : <div className="avatar"><Wrench size={16} /></div>}
              <div className="grow">
                <div className="title">{i.title}</div>
                <div className="faint">{i.category} · {unitLabel(db, i.unitId)} · {timeAgo(i.createdAt)} · {i.comments.length} comentario(s)</div>
              </div>
              <Badge tone={ST[i.status][1]}>{ST[i.status][0]}</Badge>
            </div>
          ))}
        </div>
      </Card>
      {creating && <CreateIncident onClose={() => setCreating(false)} />}
      {openId && <IncidentDetail id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function CreateIncident({ onClose }) {
  const { actions, toast } = useStore();
  const [f, setF] = useState({ title: '', category: CATEGORIES[0], description: '', photo: null });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  return (
    <Modal title="Nuevo reporte" onClose={onClose} footer={<Button variant="primary" onClick={() => { if (!f.title) return; actions.createIncident(f); toast('Reporte enviado', 'Administración dará seguimiento.'); onClose(); }}>Enviar</Button>}>
      <div className="stack">
        <Field label="¿Qué pasa?"><input className="input" value={f.title} onChange={set('title')} /></Field>
        <Field label="Categoría"><Chips value={f.category} onChange={set('category')} options={CATEGORIES.map((c) => ({ value: c, label: c }))} /></Field>
        <Field label="Detalles"><textarea className="textarea" value={f.description} onChange={set('description')} /></Field>
        {f.photo ? <img src={f.photo.dataUrl} className="photo-preview" alt="" /> : <FileDrop accept="image/*" capture="environment" label="Agrega una foto (opcional)" onFiles={async ([x]) => x && set('photo')(await fileToAttachment(x))} />}
      </div>
    </Modal>
  );
}

function IncidentDetail({ id, onClose }) {
  const { db, me, actions } = useStore();
  const i = db.incidents.find((x) => x.id === id);
  const [comment, setComment] = useState('');
  return (
    <Modal wide title={i.title} onClose={onClose}>
      <div className="stack">
        <div className="row"><Badge tone={ST[i.status][1]}>{ST[i.status][0]}</Badge><span className="faint">{i.category} · {unitLabel(db, i.unitId)} · {userName(db, i.residentId)}</span></div>
        {i.description && <p>{i.description}</p>}
        {i.photo && <img src={i.photo.dataUrl} className="photo-preview" style={{ maxHeight: 320 }} alt="" />}
        {me.role === 'admin' && (
          <Field label="Estado"><Chips value={i.status} onChange={(s) => actions.updateIncident(id, { status: s })} options={Object.entries(ST).map(([value, [label]]) => ({ value, label }))} /></Field>
        )}
        <div className="divider" />
        {i.comments.map((c) => (
          <div key={c.id} className="card flat" style={{ padding: 12 }}>
            <div className="faint">{userName(db, c.userId)} · {timeAgo(c.at)}</div>
            <div>{c.text}</div>
          </div>
        ))}
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (!comment) return; actions.updateIncident(id, { comment }); setComment(''); }}>
          <input className="input" style={{ flex: 1 }} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Escribe un comentario" />
          <Button type="submit"><Send size={15} /></Button>
        </form>
      </div>
    </Modal>
  );
}
