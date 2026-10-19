// Gestión de cuentas de un residencial. La usan el administrador del residencial (sólo en el suyo)
// y el personal de la empresa (en cualquiera). No existe el registro libre: toda cuenta nace aquí.
import { SECURITY, ROLES, normEmail, normPhone, numericCode, uid, validEmail } from '@residencial/shared';
import { transaction } from '../../db/database.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';

const later = (hours) => new Date(Date.now() + hours * 3600e3).toISOString();

export function createAccountsService({ repos, templates, dispatch, events }) {
  const { db, accounts, sessions, tenants, platform } = repos;

  /** Comprueba que `actor` pueda administrar las cuentas de `tenantId` y devuelve el residencial. */
  function authorize(actor, tenantId) {
    const tenant = tenants.find(tenantId);
    if (!tenant) throw notFound('El residencial no existe.');
    const isStaff = actor.scope === 'platform';
    if (!isStaff && !(actor.role === 'admin' && actor.tenantId === tenantId)) throw forbidden();
    return tenant;
  }

  function target(actor, tenantId, userId) {
    const tenant = authorize(actor, tenantId);
    const acc = accounts.findById(userId);
    if (!acc || acc.tenantId !== tenantId) throw notFound('La cuenta no existe.');
    if (acc.id === actor.id) throw forbidden('No puedes hacer esto sobre tu propia cuenta.');
    return { tenant, acc };
  }

  const audit = (actor, tenantId, e) => platform.audit({ tenantId, actor: actor.name, ...e });
  const changed = (tenantId) => {
    events.publish(tenantId, { reason: 'accounts' });
    dispatch();
  };

  /**
   * Genera una invitación nueva (enlace por correo + código por WhatsApp). Sólo se guardan sus hashes.
   * Con `purpose = 'reset'` además anula la contraseña y cierra todas las sesiones de la cuenta.
   */
  function issueInvite(actor, tenant, acc, purpose, action) {
    const token = randomToken(32);
    const code = numericCode(6);
    accounts.saveInvite({
      userId: acc.id, purpose, tokenHash: sha256(token), codeHash: sha256(`${acc.id}:${code}`),
      expiresAt: later(SECURITY.INVITE_HOURS), createdAt: new Date().toISOString(),
    });
    if (purpose === 'reset') {
      accounts.update(acc.id, { status: 'reset', passwordHash: null, failed: 0, lockedUntil: null });
      accounts.bumpSessionVersion(acc.id);
      sessions.deleteForUser(acc.id);
    } else {
      accounts.update(acc.id, { failed: 0, lockedUntil: null });
    }
    platform.enqueue(templates.invite({ user: acc, org: tenant.name, token, code, purpose }));
    audit(actor, tenant.id, { action, target: `${acc.name} · ${acc.email}` });
  }

  return {
    invite(actor, tenantId, data) {
      const tenant = authorize(actor, tenantId);
      const email = normEmail(data.email);
      const phone = normPhone(data.phone);
      if (!data.name?.trim()) throw badRequest('Escribe el nombre.');
      if (!validEmail(email)) throw badRequest('El correo no es válido.');
      if (!phone) throw badRequest('El WhatsApp debe tener 10 dígitos (o incluir lada internacional).');
      if (!ROLES.includes(data.role)) throw badRequest('El rol no es válido.');
      if (data.role === 'resident' && !tenants.listRecords(tenantId, 'units').some((u) => u.id === data.unitId)) throw badRequest('Selecciona una casa válida.');
      if (accounts.findByEmail(email)) throw conflict('Ya existe una cuenta con ese correo.');

      const acc = transaction(db, () => {
        const created = accounts.create({
          id: uid('usr_'), scope: 'tenant', tenantId, email, name: data.name.trim(), phone, role: data.role,
          profile: { unitId: data.role === 'resident' ? data.unitId : undefined, vehicles: data.vehicles || [], shift: data.shift },
          status: 'pending', createdAt: new Date().toISOString(),
        });
        issueInvite(actor, tenant, created, 'activate', 'Usuario creado e invitación enviada');
        return created;
      });
      changed(tenantId);
      return { id: acc.id };
    },

    resendInvite(actor, tenantId, userId) {
      const { tenant, acc } = target(actor, tenantId, userId);
      if (acc.status === 'active') throw new HttpError(409, 'La cuenta ya está activa. Si olvidó su contraseña, restablécela.', 'already_active');
      transaction(db, () => issueInvite(actor, tenant, acc, acc.status === 'reset' ? 'reset' : 'activate', 'Invitación reenviada'));
      changed(tenantId);
    },

    /** Sólo un administrador puede restablecer: no existe "olvidé mi contraseña" sin intervención. */
    resetPassword(actor, tenantId, userId) {
      const { tenant, acc } = target(actor, tenantId, userId);
      transaction(db, () => issueInvite(actor, tenant, acc, 'reset', 'Restablecimiento de contraseña'));
      changed(tenantId);
    },

    setSuspended(actor, tenantId, userId, suspended) {
      const { acc } = target(actor, tenantId, userId);
      transaction(db, () => {
        accounts.update(acc.id, { status: suspended ? 'suspended' : acc.passwordHash ? 'active' : accounts.inviteFor(acc.id)?.purpose === 'reset' ? 'reset' : 'pending' });
        accounts.bumpSessionVersion(acc.id);
        sessions.deleteForUser(acc.id);
        audit(actor, tenantId, { action: suspended ? 'Cuenta suspendida' : 'Cuenta reactivada', target: acc.name, severity: suspended ? 'warn' : 'info' });
      });
      changed(tenantId);
    },

    unlock(actor, tenantId, userId) {
      const { acc } = target(actor, tenantId, userId);
      transaction(db, () => {
        accounts.update(acc.id, { failed: 0, lockedUntil: null });
        audit(actor, tenantId, { action: 'Cuenta desbloqueada', target: acc.name });
      });
      changed(tenantId);
    },

    remove(actor, tenantId, userId) {
      const { acc } = target(actor, tenantId, userId);
      transaction(db, () => {
        accounts.delete(acc.id);
        audit(actor, tenantId, { action: 'Usuario eliminado', target: acc.name, severity: 'warn' });
      });
      changed(tenantId);
    },
  };
}
