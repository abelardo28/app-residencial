import { useState } from 'react';
import { Plus, Vote, X } from 'lucide-react';
import { useStore } from '../data/store';
import { fmtDate, toLocalInput } from '../lib/utils';
import { Badge, Button, Card, Empty, Field, Modal, PageHead } from '../components/ui';

export default function Polls() {
  const { db, me, actions } = useStore();
  const [creating, setCreating] = useState(false);
  const residents = db.users.filter((u) => u.role === 'resident').length;

  return (
    <>
      <PageHead title="Votaciones" subtitle="Decisiones de la comunidad con resultados en tiempo real." fab={me.role === 'admin' ? { icon: <Plus size={18} />, label: 'Votación', onClick: () => setCreating(true) } : null}>
        {me.role === 'admin' && <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> Nueva votación</Button>}
      </PageHead>
      <div className="g-cards">
        {db.polls.length === 0 && <Card><Empty icon={<Vote />}>Sin votaciones.</Empty></Card>}
        {db.polls.map((p) => {
          const open = new Date(p.closesAt) > new Date();
          const total = Object.keys(p.votes).length;
          const myVote = p.votes[me.id];
          const showResults = me.role === 'admin' || myVote || !open;
          return (
            <Card key={p.id}>
              <div className="row between" style={{ marginBottom: 12 }}>
                <h3>{p.question}</h3>
                <Badge tone={open ? 'ok' : ''}>{open ? `Cierra ${fmtDate(p.closesAt)}` : 'Cerrada'}</Badge>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                {p.options.map((o) => {
                  const n = Object.values(p.votes).filter((v) => v === o.id).length;
                  const pct = total ? Math.round((n / total) * 100) : 0;
                  return (
                    <button key={o.id} disabled={!open || me.role !== 'resident'} onClick={() => actions.vote(p.id, o.id)} className="card flat" style={{ padding: 12, textAlign: 'left', cursor: open && me.role === 'resident' ? 'pointer' : 'default', borderColor: myVote === o.id ? 'var(--ink-1)' : undefined }}>
                      <div className="row between"><span>{o.text}{myVote === o.id ? ' · tu voto' : ''}</span>{showResults && <span className="muted">{pct}% · {n}</span>}</div>
                      {showResults && <div className="bar-track" style={{ marginTop: 8 }}><div className="bar-fill" style={{ width: `${pct}%` }} /></div>}
                    </button>
                  );
                })}
              </div>
              <div className="faint" style={{ marginTop: 10 }}>Participación {total}/{residents} residentes</div>
            </Card>
          );
        })}
      </div>
      {creating && <CreatePoll onClose={() => setCreating(false)} />}
    </>
  );
}

function CreatePoll({ onClose }) {
  const { actions } = useStore();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [closesAt, setClosesAt] = useState(toLocalInput(Date.now() + 7 * 864e5));
  const valid = question && options.filter(Boolean).length >= 2;
  return (
    <Modal title="Nueva votación" onClose={onClose} footer={<Button variant="primary" disabled={!valid} onClick={() => { actions.createPoll({ question, closesAt: new Date(closesAt).toISOString(), options: options.filter(Boolean).map((text, i) => ({ id: 'o' + i, text })) }); onClose(); }}>Publicar</Button>}>
      <div className="stack">
        <Field label="Pregunta"><input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} /></Field>
        {options.map((o, i) => (
          <div key={i} className="row">
            <input className="input" style={{ flex: 1 }} value={o} placeholder={`Opción ${i + 1}`} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} />
            {options.length > 2 && <Button variant="ghost" onClick={() => setOptions(options.filter((_, j) => j !== i))}><X size={15} /></Button>}
          </div>
        ))}
        <Button variant="ghost" onClick={() => setOptions([...options, ''])}><Plus size={15} /> Agregar opción</Button>
        <Field label="Cierra"><input type="datetime-local" className="input" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
