import { useEffect, useMemo, useState } from 'react';
import { Home, Building2, Eye, EyeOff, ShieldCheck, Lock, Mail, MessageCircle, Check, X, ArrowLeft, KeyRound, Info } from 'lucide-react';
import { useStore, SHOW_DEMO_HELP } from '../../data/store';
import { passwordIssues } from '@residencial/shared';
import { DemoOutboxButton, takePendingActivation } from '../../components/DemoOutbox';

// Lee un enlace de activación (#/activar?t=…&e=…) y lo borra de la barra de direcciones
// para que el token no quede en el historial.
function readActivationFromUrl() {
  try {
    const h = window.location.hash || '';
    if (!h.startsWith('#/activar')) return null;
    const q = new URLSearchParams(h.split('?')[1] || '');
    window.history.replaceState(null, '', window.location.pathname + window.location.search + '#/');
    return { t: q.get('t') || '', e: q.get('e') || '' };
  } catch {
    return null;
  }
}
const wantsPortal = () => {
  try {
    return /^#\/empresa/.test(window.location.hash);
  } catch {
    return false;
  }
};

export default function Auth() {
  const { authNotice, auth } = useStore();
  const [view, setView] = useState(() => {
    const act = readActivationFromUrl() || takePendingActivation();
    if (act) return { name: 'activate', ...act };
    return { name: wantsPortal() ? 'portal' : 'login' };
  });

  // El buzón de prueba puede abrir un enlace de activación sin recargar
  useEffect(() => {
    const onAct = () => {
      const a = takePendingActivation();
      if (a) setView({ name: 'activate', ...a, n: Date.now() });
    };
    window.addEventListener('demo:activation', onAct);
    return () => window.removeEventListener('demo:activation', onAct);
  }, []);

  const portal = view.name === 'portal' || view.scope === 'platform';
  const go = (v) => {
    auth.clearNotice();
    setView(v);
  };

  return (
    <div className={`auth ${portal ? 'portal' : ''}`}>
      <DemoOutboxButton floating />
      <div className="auth-card">
        <Side portal={portal} />
        <div className="auth-main">
          {authNotice && (
            <div className="banner info" style={{ marginBottom: 16 }}>
              <Info size={18} /> {authNotice}
            </div>
          )}
          {(view.name === 'login' || view.name === 'portal') && (
            <LoginForm key={view.name} scope={view.name === 'portal' ? 'platform' : 'tenant'} email={view.email} go={go} />
          )}
          {view.name === 'mfa' && <MfaForm mfa={view.mfa} scope={view.scope} go={go} />}
          {view.name === 'activate' && <Activate key={view.n || 0} token={view.t} email={view.e} go={go} />}
        </div>
      </div>
    </div>
  );
}

function Side({ portal }) {
  return (
    <div className="auth-side">
      <div className="row" style={{ gap: 12 }}>
        <div className="brand-mark">{portal ? <Building2 size={20} /> : <Home size={20} />}</div>
        <div>
          <b>{portal ? 'Residencial Cloud' : 'App Residencial'}</b>
          <small>{portal ? 'Portal de empresa' : 'Residentes, vigilancia y administración'}</small>
        </div>
      </div>
      <div className="auth-side-copy">
        <h2>{portal ? 'Administra todas tus residencias desde un solo lugar.' : 'Tu residencial, seguro y en orden.'}</h2>
        <ul>
          {(portal
            ? [
                'Alta de residencias y de sus administradores',
                'Cobro de suscripciones y suspensión por adeudo',
                'Auditoría de accesos y cambios',
              ]
            : [
                'Las cuentas las crea la administración',
                'Activación con enlace por correo y código por WhatsApp',
                'Verificación en dos pasos para administradores',
              ]
          ).map((t) => (
            <li key={t}>
              <Check size={15} /> {t}
            </li>
          ))}
        </ul>
      </div>
      <p className="faint auth-side-foot">
        <Lock size={13} /> Conexión cifrada. Nunca te pediremos tu contraseña por correo ni WhatsApp.
      </p>
    </div>
  );
}

function PasswordInput({ value, onChange, autoComplete, autoFocus, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-wrap">
      <input
        className="input"
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        placeholder={placeholder}
      />
      <button
        type="button"
        className="btn ghost icon-btn"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
      >
        {show ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}

// Código de 6 dígitos. En la demo se puede rellenar desde el buzón de prueba.
function CodeInput({ value, onChange, autoFocus = true }) {
  useEffect(() => {
    const fill = (e) => onChange(String(e.detail).slice(0, 6));
    window.addEventListener('demo:code', fill);
    return () => window.removeEventListener('demo:code', fill);
  }, [onChange]);
  return (
    <input
      className="input code-input"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      placeholder="••••••"
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      aria-label="Código de 6 dígitos"
    />
  );
}

const DEMO_TENANT = [
  ['Administración', 'admin@residencial.mx'],
  ['Vigilancia', 'caseta@residencial.mx'],
  ['Residente', 'ana@correo.mx'],
  ['Otro residencial', 'admin@losrobles.mx'],
];

function LoginForm({ scope, email: initialEmail = '', go }) {
  const { auth } = useStore();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const portal = scope === 'platform';

  async function submit(e) {
    e.preventDefault();
    if (!email || !password) return setErr('Escribe tu correo y contraseña.');
    setBusy(true);
    setErr('');
    const r = await auth.login({ email, password, scope });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      setPassword('');
      return;
    }
    if (r.mfa) go({ name: 'mfa', mfa: r.mfa, scope });
  }

  return (
    <form onSubmit={submit} className="stack" style={{ gap: 14 }} noValidate>
      <div>
        <h1>{portal ? 'Portal de empresa' : 'Inicia sesión'}</h1>
        <p className="muted">
          {portal ? 'Acceso exclusivo para el personal de la empresa.' : 'Entra con el correo que registró tu administración.'}
        </p>
      </div>
      <label className="field">
        <span>Correo electrónico</span>
        <input
          className="input"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus={!initialEmail}
          placeholder="tu@correo.com"
        />
      </label>
      <label className="field">
        <span>Contraseña</span>
        <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" autoFocus={!!initialEmail} />
      </label>
      {err && (
        <div className="banner bad" role="alert">
          <X size={17} /> {err}
        </div>
      )}
      <button className="btn primary lg" disabled={busy}>
        {busy ? 'Verificando…' : 'Entrar'}
      </button>
      <button type="button" className="link-btn" onClick={() => setForgot((f) => !f)}>
        ¿Olvidaste tu contraseña?
      </button>
      {forgot && (
        <div className="banner info" style={{ alignItems: 'flex-start' }}>
          <ShieldCheck size={18} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            {portal
              ? 'Por seguridad, la contraseña del portal sólo la puede restablecer otro responsable de la empresa.'
              : 'Por seguridad, sólo la administración de tu residencial puede restablecer tu contraseña. Pídeselo y recibirás un enlace por correo y un código por WhatsApp para crear una nueva.'}
          </div>
        </div>
      )}
      {!portal && (
        <button type="button" className="link-btn" onClick={() => go({ name: 'activate' })}>
          ¿Recibiste una invitación? Activa tu cuenta
        </button>
      )}
      <div className="auth-divider" />
      <button type="button" className="link-btn faint" onClick={() => go({ name: portal ? 'login' : 'portal' })}>
        {portal ? (
          <>
            <ArrowLeft size={14} /> Volver al acceso de residentes
          </>
        ) : (
          <>
            <Building2 size={14} /> Acceso para la empresa
          </>
        )}
      </button>
      {SHOW_DEMO_HELP && (
        <DemoHint
          portal={portal}
          onPick={(e) => {
            setEmail(e);
            setPassword(portal ? 'Empresa#2026' : 'Demo#2026');
            setErr('');
          }}
        />
      )}
    </form>
  );
}

function DemoHint({ portal, onPick }) {
  const list = portal ? [['Dirección general', 'empresa@residencial.cloud']] : DEMO_TENANT;
  return (
    <div className="demo-hint">
      <div className="faint" style={{ marginBottom: 8 }}>
        <b>Demo.</b> Contraseña <span className="mono">{portal ? 'Empresa#2026' : 'Demo#2026'}</span>.{' '}
        {portal || 'Los administradores reciben un código en el buzón de prueba.'}
      </div>
      <div className="chips">
        {list.map(([label, email]) => (
          <button type="button" key={email} className="chip" onClick={() => onPick(email)} title={email}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MfaForm({ mfa, scope, go }) {
  const { auth } = useStore();
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e?.preventDefault();
    if (code.length !== 6) return setErr('Escribe los 6 dígitos.');
    setBusy(true);
    const r = await auth.verifyMfa(mfa.challengeId, code);
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      setCode('');
      if (r.expired) setTimeout(() => go({ name: scope === 'platform' ? 'portal' : 'login' }), 1800);
    }
  }
  return (
    <form onSubmit={submit} className="stack" style={{ gap: 14 }}>
      <div>
        <h1>Verificación en dos pasos</h1>
        <p className="muted">
          Enviamos un código de 6 dígitos a tu WhatsApp <b>{mfa.phone}</b> y a tu correo <b>{mfa.email}</b>. Vence en 5 minutos.
        </p>
      </div>
      <CodeInput value={code} onChange={setCode} />
      {err && (
        <div className="banner bad" role="alert">
          <X size={17} /> {err}
        </div>
      )}
      <button className="btn primary lg" disabled={busy}>
        {busy ? 'Verificando…' : 'Verificar y entrar'}
      </button>
      <button type="button" className="link-btn" onClick={() => go({ name: scope === 'platform' ? 'portal' : 'login' })}>
        <ArrowLeft size={14} /> Volver
      </button>
    </form>
  );
}

const STEPS = ['Enlace', 'Código', 'Contraseña'];

function Activate({ token: t0 = '', email: e0 = '', go }) {
  const { auth } = useStore();
  const [step, setStep] = useState(t0 ? 'checking' : 'link');
  const [link, setLink] = useState('');
  const [cred, setCred] = useState({ token: t0, email: e0 });
  const [info, setInfo] = useState(null);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  async function checkLink(token, email) {
    setBusy(true);
    setErr('');
    const r = await auth.checkActivation({ email, token });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      setStep('link');
      return;
    }
    setCred({ token, email });
    setInfo(r);
    setStep('code');
  }
  useEffect(() => {
    if (t0) checkLink(t0, e0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitLink(e) {
    e.preventDefault();
    try {
      const raw = link.trim();
      const q = new URLSearchParams(raw.includes('?') ? raw.split('?')[1] : '');
      const token = q.get('t');
      const email = q.get('e');
      if (!token || !email) return setErr('Pega el enlace completo que recibiste por correo.');
      checkLink(token, decodeURIComponent(email));
    } catch {
      setErr('Pega el enlace completo que recibiste por correo.');
    }
  }
  async function submitCode(e) {
    e.preventDefault();
    if (code.length !== 6) return setErr('Escribe los 6 dígitos.');
    setBusy(true);
    setErr('');
    const r = await auth.checkActivation({ ...cred, code });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      setCode('');
      if (/anulamos/.test(r.error)) setStep('link');
      return;
    }
    setInfo((i) => ({ ...i, ...r }));
    setStep('password');
  }
  const issues = useMemo(() => passwordIssues(pw, info?.user || { email: cred.email }), [pw, info, cred.email]);
  const rules = [
    'Al menos 10 caracteres',
    'Mayúsculas y minúsculas',
    'Al menos un número',
    'Al menos un símbolo (#, !, $…)',
    'Sin tu nombre, correo ni palabras comunes',
  ];
  async function submitPw(e) {
    e.preventDefault();
    if (issues.length) return setErr('La contraseña aún no cumple todos los requisitos.');
    if (pw !== pw2) return setErr('Las contraseñas no coinciden.');
    setBusy(true);
    setErr('');
    const r = await auth.completeActivation({ ...cred, code, password: pw });
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setDone(r);
  }

  const idx = { link: 0, checking: 0, code: 1, password: 2 }[step];
  const reset = info?.purpose === 'reset';

  if (done) {
    return (
      <div className="stack" style={{ gap: 14 }}>
        <div className="verdict-icon ok">
          <Check size={26} />
        </div>
        <h1>{reset ? 'Contraseña actualizada' : 'Cuenta activada'}</h1>
        <p className="muted">Ya puedes iniciar sesión con tu correo y tu nueva contraseña. Te enviamos un correo de confirmación.</p>
        <button className="btn primary lg" onClick={() => go({ name: done.scope === 'platform' ? 'portal' : 'login', email: cred.email })}>
          Iniciar sesión
        </button>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div>
        <h1>{reset ? 'Restablece tu contraseña' : 'Activa tu cuenta'}</h1>
        <p className="muted">
          {info ? `Hola, ${info.name.split(' ')[0]}.` : ''} Necesitas el enlace que llegó a tu correo y el código que llegó a tu WhatsApp.
        </p>
      </div>
      <div className="steps">
        {STEPS.map((s, i) => (
          <div key={s} className={`step ${i < idx ? 'done' : i === idx ? 'on' : ''}`}>
            <span>{i < idx ? <Check size={12} /> : i + 1}</span>
            {s}
          </div>
        ))}
      </div>

      {(step === 'link' || step === 'checking') && (
        <form onSubmit={submitLink} className="stack" style={{ gap: 14 }}>
          {step === 'checking' ? (
            <p className="muted">Validando enlace…</p>
          ) : (
            <>
              <label className="field">
                <span>
                  <Mail size={13} /> Enlace de activación
                </span>
                <input
                  className="input"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="Pega aquí el enlace del correo"
                  autoFocus
                />
                <small className="faint">Lo más fácil es abrir el enlace directamente desde tu correo.</small>
              </label>
              {err && (
                <div className="banner bad" role="alert">
                  <X size={17} /> {err}
                </div>
              )}
              <button className="btn primary lg" disabled={busy}>
                Continuar
              </button>
            </>
          )}
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={submitCode} className="stack" style={{ gap: 14 }}>
          <label className="field">
            <span>
              <MessageCircle size={13} /> Código enviado por WhatsApp a {info.phone}
            </span>
            <CodeInput value={code} onChange={setCode} />
          </label>
          {err && (
            <div className="banner bad" role="alert">
              <X size={17} /> {err}
            </div>
          )}
          <button className="btn primary lg" disabled={busy}>
            {busy ? 'Verificando…' : 'Verificar código'}
          </button>
        </form>
      )}

      {step === 'password' && (
        <form onSubmit={submitPw} className="stack" style={{ gap: 14 }}>
          <input type="email" value={cred.email} autoComplete="username" readOnly hidden />
          <label className="field">
            <span>
              <KeyRound size={13} /> Nueva contraseña
            </span>
            <PasswordInput value={pw} onChange={setPw} autoComplete="new-password" autoFocus />
          </label>
          <ul className="pw-rules">
            {rules.map((r) => {
              const ok = pw && !issues.includes(r);
              return (
                <li key={r} className={ok ? 'ok' : ''}>
                  {ok ? <Check size={13} /> : <span className="pw-dot" />} {r}
                </li>
              );
            })}
          </ul>
          <label className="field">
            <span>Confirma la contraseña</span>
            <PasswordInput value={pw2} onChange={setPw2} autoComplete="new-password" />
          </label>
          {err && (
            <div className="banner bad" role="alert">
              <X size={17} /> {err}
            </div>
          )}
          <button className="btn primary lg" disabled={busy}>
            {busy ? 'Guardando…' : reset ? 'Guardar contraseña' : 'Activar cuenta'}
          </button>
        </form>
      )}
      <button type="button" className="link-btn" onClick={() => go({ name: 'login' })}>
        <ArrowLeft size={14} /> Volver a iniciar sesión
      </button>
    </div>
  );
}
