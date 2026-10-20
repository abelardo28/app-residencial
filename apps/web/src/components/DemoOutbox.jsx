import { useEffect, useState } from 'react';
import { Inbox, Mail, MessageCircle, X, Link2, KeyRound } from 'lucide-react';
import { Portal } from './ui';
import { useStore, SHOW_DEMO_HELP } from '../data/store';
import { timeAgo } from '../lib/utils';

// Buzón de prueba: muestra los correos y WhatsApp que en producción se envían de verdad.
// En modo demo los mensajes están en el navegador; con la API en desarrollo se leen de /api/v1/dev/outbox.
const POLL_MS = 3000;

/** Mensajes del buzón según el modo de datos. `null` = no disponible. */
function useOutbox(active) {
  const { mode, root, api } = useStore();
  const [remote, setRemote] = useState(null);
  useEffect(() => {
    if (mode !== 'api' || !SHOW_DEMO_HELP) return;
    let alive = true;
    const load = () =>
      api.get('/dev/outbox').then(
        (d) => alive && setRemote(d.messages),
        () => alive && setRemote(null),
      );
    load();
    const iv = setInterval(load, active ? POLL_MS : POLL_MS * 4);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [mode, api, active]);
  if (!SHOW_DEMO_HELP) return null;
  return mode === 'api' ? remote : root.platform.outbox;
}
const PENDING = 'residencial:pending-activation';

export function openActivation(params) {
  try {
    sessionStorage.setItem(PENDING, JSON.stringify(params));
  } catch {
    /* sin almacenamiento */
  }
  window.dispatchEvent(new CustomEvent('demo:activation', { detail: params }));
}
export function takePendingActivation() {
  try {
    const raw = sessionStorage.getItem(PENDING);
    sessionStorage.removeItem(PENDING);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export const sendDemoCode = (code) => window.dispatchEvent(new CustomEvent('demo:code', { detail: code }));

export function DemoOutboxButton({ floating }) {
  const [open, setOpen] = useState(false);
  const outbox = useOutbox(false);
  if (!outbox) return null;
  const count = outbox.length;
  return (
    <>
      {!(floating && open) && (
        <button
          className={`btn ${floating ? 'outbox-fab' : 'icon-btn'}`}
          onClick={() => setOpen(true)}
          aria-label="Buzón de prueba"
          title="Buzón de prueba (correo y WhatsApp simulados)"
        >
          <Inbox size={18} />
          {floating && <span>Buzón de prueba</span>}
          {count > 0 && <span className="dot">{count > 99 ? '99+' : count}</span>}
        </button>
      )}
      {open && <DemoOutbox onClose={() => setOpen(false)} />}
    </>
  );
}

function DemoOutbox({ onClose }) {
  const { session, auth } = useStore();
  const [filter, setFilter] = useState('all');
  const list = (useOutbox(true) || []).filter((m) => filter === 'all' || m.channel === filter);
  const codeOf = (m) => m.meta?.code;
  return (
    <Portal>
      <div className="sidebar-overlay" style={{ display: 'block' }} onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Buzón de prueba">
        <div className="row between" style={{ padding: '18px 16px 8px', flexWrap: 'nowrap' }}>
          <div>
            <h2>Buzón de prueba</h2>
            <p className="faint">Lo que el servidor enviaría por correo y WhatsApp.</p>
          </div>
          <button className="btn ghost icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div className="chips" style={{ padding: '0 16px 8px' }}>
          {[
            ['all', 'Todo'],
            ['email', 'Correo'],
            ['whatsapp', 'WhatsApp'],
          ].map(([v, l]) => (
            <button key={v} className={`chip ${filter === v ? 'on' : ''}`} onClick={() => setFilter(v)}>
              {l}
            </button>
          ))}
        </div>
        <div className="drawer-body stack">
          {list.length === 0 && <div className="empty">Sin mensajes.</div>}
          {list.map((m) => (
            <div key={m.id} className={`outbox-msg ${m.channel}`}>
              <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                {m.channel === 'email' ? <Mail size={15} /> : <MessageCircle size={15} />}
                <b className="grow" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.to}
                </b>
                <span className="faint">{timeAgo(m.at)}</span>
              </div>
              {m.subject && <div style={{ fontWeight: 500, marginTop: 6 }}>{m.subject}</div>}
              <div className="muted outbox-body">{m.meta?.link ? m.body.replace(m.meta.link, '[enlace de activación]') : m.body}</div>
              <div className="row" style={{ marginTop: 8 }}>
                {m.meta?.kind === 'invite' && m.meta.token && (
                  <button
                    className="btn sm primary"
                    onClick={() => {
                      if (session) auth.logout();
                      openActivation({ t: m.meta.token, e: m.meta.email });
                      onClose();
                    }}
                  >
                    <Link2 size={14} /> {session ? 'Cerrar sesión y abrir enlace' : 'Abrir enlace'}
                  </button>
                )}
                {codeOf(m) && (
                  <button
                    className="btn sm"
                    onClick={() => {
                      sendDemoCode(codeOf(m));
                      onClose();
                    }}
                  >
                    <KeyRound size={14} /> Usar código <span className="mono">{codeOf(m)}</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </Portal>
  );
}
