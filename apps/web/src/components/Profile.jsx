// Perfil propio: se abre al tocar la tarjeta con tus iniciales. Nombre, contraseña y avisos por WhatsApp.
// El correo y el teléfono (por donde llega el código de acceso) los cambia administración, para que nadie se apropie de la cuenta.
import { useMemo, useState } from 'react';
import { Check, KeyRound, LogOut, UserRound } from 'lucide-react';
import { PASSWORD_RULES, passwordIssues } from '@residencial/shared';
import { useStore } from '../data/store';
import { PasswordInput } from '../pages/auth/Auth';
import { Button, Field, Modal, Tabs } from './ui';

export default function Profile({ user, subtitle, onClose, onLogout }) {
  const { auth, db, me, actions, toast } = useStore();
  const [tab, setTab] = useState('profile');
  const [name, setName] = useState(user.name);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const issues = useMemo(() => passwordIssues(pw.next, user), [pw.next, user]);
  const tenantUser = me && me.id === user.id;
  const optedOut = tenantUser && (db?.whatsappOptOuts || []).some((o) => o.id === user.id);

  async function run(fn, done) {
    setErr('');
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    toast(...done);
    onClose();
  }
  const saveName = () => {
    if (!name.trim()) return setErr('Escribe tu nombre.');
    run(() => auth.updateProfile({ name: name.trim() }), ['Perfil actualizado', name.trim()]);
  };
  const savePassword = () => {
    if (!pw.current) return setErr('Escribe tu contraseña actual.');
    if (issues.length) return setErr('La nueva contraseña aún no cumple todos los requisitos.');
    if (pw.next !== pw.confirm) return setErr('Las contraseñas nuevas no coinciden.');
    run(
      () => auth.changePassword({ current: pw.current, password: pw.next }),
      ['Contraseña cambiada', 'Cerramos tu sesión en los demás dispositivos.'],
    );
  };
  const setP = (k) => (v) => setPw((x) => ({ ...x, [k]: v }));

  return (
    <Modal
      title="Mi cuenta"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" className="danger" style={{ marginRight: 'auto' }} onClick={onLogout}>
            <LogOut size={15} /> Cerrar sesión
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={busy} onClick={tab === 'profile' ? saveName : savePassword}>
            {tab === 'profile' ? 'Guardar' : 'Cambiar contraseña'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Tabs
          value={tab}
          onChange={(v) => {
            setTab(v);
            setErr('');
          }}
          items={[
            { value: 'profile', label: 'Datos', icon: <UserRound size={15} /> },
            { value: 'password', label: 'Contraseña', icon: <KeyRound size={15} /> },
          ]}
        />
        {tab === 'profile' ? (
          <>
            <Field label="Nombre">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </Field>
            <div className="card flat" style={{ padding: 14 }}>
              <div className="faint">{subtitle}</div>
              <div>{user.email}</div>
              {user.phone && <div className="faint">WhatsApp {user.phone}</div>}
              <div className="faint" style={{ marginTop: 6 }}>
                Para cambiar tu correo o tu teléfono pídelo a administración: por ahí llegan tus códigos de acceso.
              </div>
            </div>
            {tenantUser && user.role === 'resident' && (
              <label className="check">
                <input type="checkbox" checked={!optedOut} onChange={(e) => actions.setWhatsappAlerts(e.target.checked).catch(() => {})} />
                <span>
                  <b>Avisos por WhatsApp</b>
                  <span className="faint">Visitas que llegan, paquetes, pagos y avisos del residencial.</span>
                </span>
              </label>
            )}
          </>
        ) : (
          <>
            <Field label="Contraseña actual">
              <PasswordInput value={pw.current} onChange={setP('current')} autoComplete="current-password" />
            </Field>
            <Field label="Nueva contraseña">
              <PasswordInput value={pw.next} onChange={setP('next')} autoComplete="new-password" />
            </Field>
            <ul className="pw-rules">
              {PASSWORD_RULES.map((r) => {
                const ok = pw.next && !issues.includes(r);
                return (
                  <li key={r} className={ok ? 'ok' : ''}>
                    {ok ? <Check size={13} /> : <span className="pw-dot" />} {r}
                  </li>
                );
              })}
            </ul>
            <Field label="Confirma la nueva contraseña">
              <PasswordInput value={pw.confirm} onChange={setP('confirm')} autoComplete="new-password" />
            </Field>
            <p className="faint">Al cambiarla cerramos tu sesión en los demás dispositivos; en este sigues dentro.</p>
          </>
        )}
        {err && <div className="banner bad">{err}</div>}
      </div>
    </Modal>
  );
}
