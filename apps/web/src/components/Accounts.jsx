import { useState } from 'react';
import { Send, KeyRound, Ban, PlayCircle, Unlock, Trash2, Mail, MessageCircle, ShieldAlert, ShieldCheck, Info } from 'lucide-react';
import { useStore, ACCOUNT_STATUS } from '../data/store';
import { maskPhone } from '@residencial/shared';
import { fmtDateTime, timeAgo, initials } from '../lib/utils';
import { Badge, Button, Chips, Field, Modal } from './ui';

export const ROLE_NAME = { resident: 'Residente', guard: 'Vigilante', admin: 'Administrador' };

const isLocked = (u) => u.auth?.lockedUntil && new Date(u.auth.lockedUntil) > new Date();

export function AccountBadge({ user }) {
  if (isLocked(user)) return <Badge tone="bad">Bloqueada</Badge>;
  const [label, tone] = ACCOUNT_STATUS[user.auth?.status] || ACCOUNT_STATUS.pending;
  return <Badge tone={tone}>{label}</Badge>;
}

// Ficha de la cuenta con las acciones de seguridad. La usan el administrador y el portal de empresa.
export function AccountModal({ tenantId, user, selfId, unitText, onClose, allowDelete = true }) {
  const { accounts, toast } = useStore();
  const [busy, setBusy] = useState('');
  const a = user.auth || {};
  const self = user.id === selfId;
  const pendingInvite = a.invite && new Date(a.invite.expiresAt) > new Date();

  async function act(key, fn, msg) {
    setBusy(key);
    try {
      await fn();
      toast(msg[0], msg[1]);
      onClose();
    } catch (e) {
      toast('No se pudo completar', e.message, 'bad');
    } finally {
      setBusy('');
    }
  }

  return (
    <Modal title="Cuenta" onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        <div className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
          <div className="avatar" style={{ width: 46, height: 46 }}>
            {initials(user.name)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{user.name}</div>
            <div className="faint">
              {ROLE_NAME[user.role]}
              {unitText ? ` · ${unitText}` : ''}
            </div>
          </div>
          <AccountBadge user={user} />
        </div>
        <div className="kv">
          <div>
            <Mail size={14} /> <span>{user.email}</span>
          </div>
          <div>
            <MessageCircle size={14} /> <span>{user.phone ? maskPhone(user.phone) : '—'}</span>
          </div>
          <div>
            <ShieldCheck size={14} /> <span>{a.lastLoginAt ? `Último acceso ${timeAgo(a.lastLoginAt)}` : 'Aún no inicia sesión'}</span>
          </div>
          {a.passwordChangedAt && (
            <div>
              <KeyRound size={14} /> <span>Contraseña cambiada el {fmtDateTime(a.passwordChangedAt)}</span>
            </div>
          )}
          {pendingInvite && (
            <div>
              <Send size={14} /> <span>Invitación vigente hasta {fmtDateTime(a.invite.expiresAt)}</span>
            </div>
          )}
          {isLocked(user) && (
            <div style={{ color: 'var(--bad)' }}>
              <ShieldAlert size={14} /> <span>Bloqueada por intentos fallidos hasta {fmtDateTime(a.lockedUntil)}</span>
            </div>
          )}
        </div>

        {self ? (
          <div className="banner info">
            <Info size={17} /> No puedes cambiar la seguridad de tu propia cuenta. Pídeselo a otro administrador o a la empresa.
          </div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {(a.status === 'pending' || a.status === 'reset') && (
              <Button
                onClick={() =>
                  act(
                    'inv',
                    () => (a.status === 'reset' ? accounts.resetPassword(tenantId, user.id) : accounts.resendInvite(tenantId, user.id)),
                    [
                      'Invitación reenviada',
                      'Se envió un nuevo enlace por correo y un código por WhatsApp. El anterior dejó de funcionar.',
                    ],
                  )
                }
                disabled={!!busy}
              >
                <Send size={15} /> Reenviar invitación
              </Button>
            )}
            {a.status === 'active' && (
              <Button
                onClick={() =>
                  confirm(
                    `¿Restablecer la contraseña de ${user.name}? Su contraseña actual dejará de funcionar y se cerrarán sus sesiones.`,
                  ) &&
                  act('reset', () => accounts.resetPassword(tenantId, user.id), [
                    'Restablecimiento enviado',
                    'Recibirá un enlace por correo y un código por WhatsApp.',
                  ])
                }
                disabled={!!busy}
              >
                <KeyRound size={15} /> Restablecer contraseña
              </Button>
            )}
            {isLocked(user) && (
              <Button
                onClick={() => act('unlock', () => accounts.unlock(tenantId, user.id), ['Cuenta desbloqueada', ''])}
                disabled={!!busy}
              >
                <Unlock size={15} /> Desbloquear
              </Button>
            )}
            {a.status === 'suspended' ? (
              <Button
                onClick={() => act('sus', () => accounts.setSuspended(tenantId, user.id, false), ['Cuenta reactivada', ''])}
                disabled={!!busy}
              >
                <PlayCircle size={15} /> Reactivar cuenta
              </Button>
            ) : (
              <Button
                className="danger"
                onClick={() =>
                  confirm(`¿Suspender a ${user.name}? Se cerrarán sus sesiones y no podrá entrar.`) &&
                  act('sus', () => accounts.setSuspended(tenantId, user.id, true), ['Cuenta suspendida', 'Se cerraron sus sesiones.'])
                }
                disabled={!!busy}
              >
                <Ban size={15} /> Suspender cuenta
              </Button>
            )}
            {allowDelete && (
              <Button
                variant="ghost"
                className="danger"
                onClick={() =>
                  confirm(`¿Eliminar a ${user.name}? Esta acción no se puede deshacer.`) &&
                  act('del', () => accounts.remove(tenantId, user.id), ['Usuario eliminado', ''])
                }
                disabled={!!busy}
              >
                <Trash2 size={15} /> Eliminar usuario
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// Alta de usuario: no se escribe contraseña. Se envía la invitación por correo y WhatsApp.
export function InviteModal({ tenantId, units = [], roles = ['resident', 'guard', 'admin'], defaultRole, onAddUnit, onClose }) {
  const { accounts, toast } = useStore();
  const [f, setF] = useState({
    name: '',
    role: defaultRole || roles[0],
    unitId: units[0]?.id || '',
    email: '',
    phone: '',
    shift: 'Matutino',
    vehicles: '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [newUnit, setNewUnit] = useState(null); // texto del domicilio que se está agregando
  async function addUnit() {
    if (!newUnit?.trim()) return;
    try {
      const u = await onAddUnit({ label: newUnit.trim() });
      setF((x) => ({ ...x, unitId: u.id }));
      setNewUnit(null);
    } catch (e) {
      setErr(e.message);
    }
  }
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  async function submit() {
    const data = {
      name: f.name,
      role: f.role,
      email: f.email,
      phone: f.phone,
      vehicles: f.vehicles
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    };
    if (f.role === 'resident') data.unitId = f.unitId;
    if (f.role === 'guard') data.shift = f.shift;
    setBusy(true);
    setErr('');
    try {
      await accounts.invite(tenantId, data);
      toast('Invitación enviada', `${f.name} recibirá un enlace por correo y un código por WhatsApp para activar su cuenta.`);
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Nuevo usuario"
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={submit} disabled={busy}>
          <Send size={15} /> {busy ? 'Enviando…' : 'Crear y enviar invitación'}
        </Button>
      }
    >
      <div className="stack">
        {roles.length > 1 && (
          <Field label="Rol">
            <Chips value={f.role} onChange={set('role')} options={roles.map((value) => ({ value, label: ROLE_NAME[value] }))} />
          </Field>
        )}
        <Field label="Nombre completo">
          <input className="input" value={f.name} onChange={set('name')} autoFocus />
        </Field>
        {f.role === 'resident' && (
          <>
            <Field label="Domicilio">
              {newUnit === null ? (
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <select className="select" style={{ flex: 1 }} value={f.unitId} onChange={set('unitId')}>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                        {u.street ? ` · ${u.street}` : ''}
                      </option>
                    ))}
                  </select>
                  {onAddUnit && (
                    <Button type="button" onClick={() => setNewUnit('')}>
                      Agregar
                    </Button>
                  )}
                </div>
              ) : (
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    value={newUnit}
                    onChange={(e) => setNewUnit(e.target.value)}
                    placeholder="Ej. Casa 13 o Depto 204"
                    autoFocus
                  />
                  <Button type="button" variant="primary" onClick={addUnit}>
                    Guardar
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setNewUnit(null)}>
                    Cancelar
                  </Button>
                </div>
              )}
            </Field>
            <Field label="Placas de sus vehículos" hint="Separadas por coma">
              <input className="input mono" value={f.vehicles} onChange={set('vehicles')} />
            </Field>
          </>
        )}
        {f.role === 'guard' && (
          <Field label="Turno">
            <Chips
              value={f.shift}
              onChange={set('shift')}
              options={['Matutino', 'Vespertino', 'Nocturno'].map((s) => ({ value: s, label: s }))}
            />
          </Field>
        )}
        <div className="grid g2">
          <Field label="Correo electrónico" hint="Aquí llega el enlace de activación">
            <input className="input" type="email" value={f.email} onChange={set('email')} />
          </Field>
          <Field label="WhatsApp" hint="10 dígitos; aquí llega el código">
            <input className="input" type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="33 1234 5678" />
          </Field>
        </div>
        <div className="banner info" style={{ alignItems: 'flex-start' }}>
          <ShieldCheck size={17} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            No asignas contraseña. La persona la crea al activar su cuenta con el enlace del correo y el código de WhatsApp (válidos 48 h y
            de un solo uso).
          </span>
        </div>
        {err && <div className="banner bad">{err}</div>}
      </div>
    </Modal>
  );
}

const SEV = { info: '', warn: 'warn', danger: 'bad' };
export function AuditList({ items, showTenant }) {
  if (!items.length) return <div className="empty">Sin actividad registrada.</div>;
  return (
    <div className="list">
      {items.map((e) => (
        <div key={e.id} className="list-item">
          <div className={`avatar ${SEV[e.severity] ? `tone-${SEV[e.severity]}` : ''}`}>
            {e.severity === 'info' ? <ShieldCheck size={15} /> : <ShieldAlert size={15} />}
          </div>
          <div className="grow">
            <div className="title">
              {e.action}
              {e.target ? <span className="muted"> · {e.target}</span> : null}
            </div>
            <div className="faint">
              {e.actor || 'Sistema'}
              {showTenant && e.tenantName ? ` · ${e.tenantName}` : ''} · {fmtDateTime(e.at)}
              {e.detail ? ` · ${e.detail}` : ''}
            </div>
          </div>
          {e.severity !== 'info' && <Badge tone={SEV[e.severity]}>{e.severity === 'danger' ? 'Crítico' : 'Atención'}</Badge>}
        </div>
      ))}
    </div>
  );
}
