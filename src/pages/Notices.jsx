import { useEffect, useState } from 'react';
import { Plus, Megaphone, CalendarClock, FileText, ClipboardList, Wrench, AlertOctagon, Info, MapPin, Eye, Trash2 } from 'lucide-react';
import { useStore, userName } from '../data/store';
import { fmtDateTime, timeAgo, fileToAttachment } from '../lib/utils';
import { Attachment, Badge, Button, Card, Chips, Empty, Field, FileDrop, Modal, PageHead } from '../components/ui';

export const CATS = {
  general: { label: 'General', icon: Info },
  reunion: { label: 'Reunión', icon: CalendarClock },
  documento: { label: 'Documento', icon: FileText },
  bitacora: { label: 'Bitácora', icon: ClipboardList },
  mantenimiento: { label: 'Mantenimiento', icon: Wrench },
  urgente: { label: 'Urgente', icon: AlertOctagon },
};

export default function Notices() {
  const { db, me } = useStore();
  const [cat, setCat] = useState('all');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const visible = db.notices.filter((n) => me.role === 'admin' || (me.role === 'guard' ? n.audience === 'staff' || n.audience === 'all' : n.audience !== 'staff'));
  const list = cat === 'all' ? visible : visible.filter((n) => n.category === cat);
  const residentsCount = db.users.filter((u) => u.role === 'resident').length;

  return (
    <>
      <PageHead title="Avisos" subtitle="Comunicados, reuniones, documentos y bitácoras de la administración." fab={me.role === 'admin' ? { icon: <Plus size={18} />, label: 'Nuevo aviso', onClick: () => setCreating(true) } : null}>
        {me.role === 'admin' && <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> Nuevo aviso</Button>}
      </PageHead>
      <div style={{ marginBottom: 16 }}>
        <Chips scroll value={cat} onChange={setCat} options={[{ value: 'all', label: 'Todos' }, ...Object.entries(CATS).map(([value, c]) => ({ value, label: c.label }))]} />
      </div>
      <div className="g-cards">
        {list.length === 0 && <Card><Empty icon={<Megaphone />}>No hay avisos.</Empty></Card>}
        {list.map((n) => {
          const C = CATS[n.category] || CATS.general;
          const unread = me.role !== 'admin' && !n.readBy.includes(me.id);
          return (
            <Card key={n.id} style={{ cursor: 'pointer', padding: 18 }} onClick={() => setOpenId(n.id)}>
              <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                <div className="notice-cat" style={{ background: n.category === 'urgente' ? 'var(--bad-bg)' : 'var(--surface-sunk)', color: n.category === 'urgente' ? 'var(--bad)' : 'var(--text-2)' }}><C.icon size={19} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row between">
                    <h3>{n.title}</h3>
                    <div className="row" style={{ gap: 6 }}>
                      {unread && <Badge tone="bad">Nuevo</Badge>}
                      <Badge>{C.label}</Badge>
                    </div>
                  </div>
                  <p className="muted" style={{ marginTop: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{n.body}</p>
                  <div className="row faint" style={{ marginTop: 8 }}>
                    <span>{timeAgo(n.createdAt)}</span>
                    {n.eventDate && <span>· <CalendarClock size={13} /> {fmtDateTime(n.eventDate)}</span>}
                    {n.attachments.length > 0 && <span>· {n.attachments.length} archivo(s)</span>}
                    {me.role === 'admin' && <span>· <Eye size={13} /> leído por {n.readBy.length}/{residentsCount}</span>}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      {creating && <CreateNotice onClose={() => setCreating(false)} />}
      {openId && <NoticeDetail id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function NoticeDetail({ id, onClose }) {
  const { db, me, actions } = useStore();
  const n = db.notices.find((x) => x.id === id);
  useEffect(() => {
    if (me.role !== 'admin') actions.markNoticeRead(id);
  }, [id, me.role, actions]);
  if (!n) return null;
  const residents = db.users.filter((u) => u.role === 'resident');
  const answer = n.confirmations?.[me.id];
  const counts = { si: 0, no: 0 };
  Object.values(n.confirmations || {}).forEach((v) => counts[v]++);

  return (
    <Modal wide title={n.title} onClose={onClose}>
      <div className="stack">
        <div className="row faint"><Badge>{CATS[n.category]?.label}</Badge> Publicado por {userName(db, n.authorId)} · {fmtDateTime(n.createdAt)}</div>
        {n.eventDate && (
          <div className="banner info"><CalendarClock size={18} /> <b>{fmtDateTime(n.eventDate)}</b>{n.location && <><MapPin size={15} /> {n.location}</>}</div>
        )}
        <p style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>
        {n.attachments.length > 0 && <div className="stack" style={{ gap: 8 }}>{n.attachments.map((a) => <Attachment key={a.id} file={a} />)}</div>}

        {n.requireConfirm && me.role === 'resident' && (
          <div className="card flat" style={{ padding: 14 }}>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>¿Asistirás?</div>
            <div className="row">
              <Button variant={answer === 'si' ? 'primary' : ''} onClick={() => actions.confirmNotice(id, 'si')}>Sí asistiré</Button>
              <Button variant={answer === 'no' ? 'primary' : ''} onClick={() => actions.confirmNotice(id, 'no')}>No podré</Button>
            </div>
          </div>
        )}

        {me.role === 'admin' && (
          <div className="card flat" style={{ padding: 14 }}>
            <div className="row between" style={{ marginBottom: 8 }}>
              <b>Confirmación de lectura</b>
              <span className="faint">{n.readBy.length} de {residents.length}{n.requireConfirm ? ` · asistirán ${counts.si}, no ${counts.no}` : ''}</span>
            </div>
            <div className="chips">
              {residents.map((r) => (
                <span key={r.id} className={`badge ${n.readBy.includes(r.id) ? 'ok' : ''}`}>{r.name}{n.confirmations?.[r.id] ? ` · ${n.confirmations[r.id] === 'si' ? 'asiste' : 'no asiste'}` : ''}</span>
              ))}
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <Button size="sm" variant="ghost" className="danger" onClick={() => { actions.deleteNotice(id); onClose(); }}><Trash2 size={15} /> Eliminar aviso</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function CreateNotice({ onClose }) {
  const { actions, toast } = useStore();
  const [f, setF] = useState({ title: '', category: 'general', body: '', eventDate: '', location: '', audience: 'residents', requireConfirm: false, attachments: [] });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v }));

  async function addFiles(files) {
    const big = files.find((x) => x.size > 3 * 1024 * 1024);
    if (big) toast('Archivo muy grande', 'En la demo el límite es 3 MB por archivo.', 'bad');
    const ok = await Promise.all(files.filter((x) => x.size <= 3 * 1024 * 1024).map(fileToAttachment));
    setF((x) => ({ ...x, attachments: [...x.attachments, ...ok] }));
  }
  function submit() {
    if (!f.title || !f.body) return toast('Faltan datos', 'Escribe título y mensaje.', 'bad');
    actions.createNotice({ ...f, eventDate: f.eventDate ? new Date(f.eventDate).toISOString() : null });
    toast('Aviso publicado', 'Se notificó a los destinatarios.');
    onClose();
  }

  return (
    <Modal wide title="Nuevo aviso" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={submit}>Publicar y notificar</Button></>}>
      <div className="stack">
        <Field label="Tipo"><Chips value={f.category} onChange={set('category')} options={Object.entries(CATS).map(([value, c]) => ({ value, label: c.label }))} /></Field>
        <Field label="Título"><input className="input" value={f.title} onChange={set('title')} /></Field>
        <Field label="Mensaje"><textarea className="textarea" value={f.body} onChange={set('body')} /></Field>
        {(f.category === 'reunion' || f.category === 'mantenimiento') && (
          <div className="grid g2">
            <Field label="Fecha y hora"><input type="datetime-local" className="input" value={f.eventDate} onChange={set('eventDate')} /></Field>
            <Field label="Lugar"><input className="input" value={f.location} onChange={set('location')} /></Field>
          </div>
        )}
        <Field label="Destinatarios"><Chips value={f.audience} onChange={set('audience')} options={[{ value: 'residents', label: 'Residentes' }, { value: 'all', label: 'Residentes y vigilancia' }, { value: 'staff', label: 'Solo vigilancia' }]} /></Field>
        {f.category === 'reunion' && (
          <label className="row"><input type="checkbox" checked={f.requireConfirm} onChange={set('requireConfirm')} /> Pedir confirmación de asistencia</label>
        )}
        <Field label="Archivos adjuntos">
          <div className="stack" style={{ gap: 8 }}>
            {f.attachments.map((a) => <Attachment key={a.id} file={a} onRemove={() => setF((x) => ({ ...x, attachments: x.attachments.filter((y) => y.id !== a.id) }))} />)}
            <FileDrop multiple label="Agrega documentos, actas, fotos o bitácoras" onFiles={addFiles} />
          </div>
        </Field>
      </div>
    </Modal>
  );
}
