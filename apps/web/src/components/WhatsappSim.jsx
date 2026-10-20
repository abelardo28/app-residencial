import { Fragment, useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import { useStore, SHOW_DEMO_HELP } from '../data/store';
import { fmtTime } from '../lib/utils';

// Simulador de WhatsApp: escribe como si fueras un residente desde su teléfono y recibe lo que respondería
// el asistente. En producción los mensajes llegan por el webhook de WhatsApp Cloud API (ver README).
const QUICK = ['Hola', '1', '2', '3', '4'];
const ROLE = { resident: 'Residente', guard: 'Vigilancia', admin: 'Administración' };

export function WhatsappSimButton({ floating }) {
  const { whatsapp } = useStore();
  const [open, setOpen] = useState(false);
  if (!SHOW_DEMO_HELP || !whatsapp) return null;
  return (
    <>
      {!(floating && open) && (
        <button
          className={`btn ${floating ? 'outbox-fab wa-fab' : 'icon-btn'}`}
          onClick={() => setOpen(true)}
          aria-label="Simulador de WhatsApp"
          title="Prueba el asistente de WhatsApp"
        >
          <MessageCircle size={18} />
          {floating && <span>WhatsApp</span>}
        </button>
      )}
      {open && <WhatsappSim onClose={() => setOpen(false)} />}
    </>
  );
}

function WhatsappSim({ onClose }) {
  const { whatsapp, me } = useStore();
  const [contacts, setContacts] = useState([]);
  const [phone, setPhone] = useState('');
  const [chats, setChats] = useState({}); // teléfono -> mensajes
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef();

  useEffect(() => {
    whatsapp.contacts().then(
      (list) => {
        setContacts(list);
        const mine = list.find((c) => c.phone === me?.phone) || list.find((c) => c.role === 'resident');
        if (mine) setPhone(mine.phone);
      },
      () => setContacts([]),
    );
  }, [whatsapp, me?.phone]);

  const messages = chats[phone] || [];
  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [messages.length]);

  async function send(body) {
    const msg = body.trim();
    if (!msg || !phone || busy) return;
    const add = (items) => setChats((c) => ({ ...c, [phone]: [...(c[phone] || []), ...items] }));
    add([{ from: 'me', text: msg, at: new Date() }]);
    setText('');
    setBusy(true);
    try {
      const { replies } = await whatsapp.send(phone, msg);
      add(replies.map((r) => ({ from: 'bot', text: r, at: new Date() })));
    } catch (e) {
      add([{ from: 'bot', text: e.message || 'No se pudo enviar.', at: new Date() }]);
    } finally {
      setBusy(false);
    }
  }

  const contact = contacts.find((c) => c.phone === phone);
  return (
    <>
      <div className="sidebar-overlay" style={{ display: 'block' }} onClick={onClose} />
      <aside className="drawer wa" role="dialog" aria-label="Simulador de WhatsApp">
        <div className="wa-head">
          <div className="avatar">
            <MessageCircle size={16} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>Asistente del residencial</b>
            <div className="faint">Simulador · lo que vería la persona en WhatsApp</div>
          </div>
          <button className="btn ghost icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: '8px 12px' }}>
          <select className="select" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Escribir como">
            {contacts.map((c) => (
              <option key={c.phone + c.name} value={c.phone}>
                {c.name} · {ROLE[c.role] || c.role} · {c.residencial}
              </option>
            ))}
            <option value="+525599999999">Número no registrado</option>
          </select>
        </div>
        <div className="wa-body">
          {messages.length === 0 && (
            <div className="wa-hint">
              Escribe <b>Hola</b> como {contact?.name || 'la persona'} para ver el menú. Prueba también <b>pase Juan Pérez</b>.
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`wa-msg ${m.from}`}>
              <WaText text={m.text} />
              <span className="wa-time">{fmtTime(m.at)}</span>
            </div>
          ))}
          {busy && <div className="wa-msg bot typing">escribiendo…</div>}
          <div ref={bottom} />
        </div>
        <div className="chips" style={{ padding: '8px 12px 0' }}>
          {QUICK.map((q) => (
            <button key={q} className="chip" onClick={() => send(q)} disabled={busy}>
              {q}
            </button>
          ))}
        </div>
        <form
          className="wa-input"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <input
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Escribe un mensaje"
            maxLength={500}
          />
          <button className="btn primary icon-btn" type="submit" disabled={busy || !text.trim()} aria-label="Enviar">
            <Send size={16} />
          </button>
        </form>
      </aside>
    </>
  );
}

/** Texto con el formato de WhatsApp: *negritas* y enlaces. */
function WaText({ text }) {
  return text.split('\n').map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {line.split(/(\*[^*\n]+\*|https?:\/\/\S+)/g).map((part, j) => {
        if (/^\*[^*]+\*$/.test(part)) return <b key={j}>{part.slice(1, -1)}</b>;
        if (/^https?:\/\//.test(part))
          return (
            <a key={j} href={part} target="_blank" rel="noopener noreferrer">
              {part.length > 48 ? `${part.slice(0, 45)}…` : part}
            </a>
          );
        return part;
      })}
    </Fragment>
  ));
}
