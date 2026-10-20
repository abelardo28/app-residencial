// Inicio de sesión, verificación en dos pasos, activación de cuentas y sesiones.
import { SECURITY, maskEmail, maskPhone, normEmail, passwordIssues } from '@residencial/shared';
import { transaction } from '../../db/database.js';
import { burnPasswordCheck, hashPassword, randomDigits, randomToken, safeEqual, sha256, verifyPassword } from '../../lib/crypto.js';
import { HttpError, unauthorized } from '../../lib/errors.js';

const GENERIC_LOGIN_ERROR = 'Correo o contraseña incorrectos.';
const INVALID_LINK = 'El enlace no es válido, ya se usó o venció. Pide a tu administrador que te envíe uno nuevo.';
const minutes = (n) => n * 60e3;
const later = (ms) => new Date(Date.now() + ms).toISOString();

export function createAuthService({ repos, templates, dispatch }) {
  const { accounts, sessions, tenants, platform } = repos;
  const orgName = (acc) => (acc.scope === 'platform' ? 'Residencial Cloud' : tenants.find(acc.tenantId)?.name || '');
  const audit = (acc, e) => platform.audit({ tenantId: acc?.tenantId, actor: acc?.name, target: acc?.email, ...e });

  function startSession(acc, meta) {
    const token = randomToken(32);
    const csrfToken = randomToken(24);
    const now = new Date().toISOString();
    const expiresAt = later(SECURITY.SESSION_HOURS * 3600e3);
    transaction(repos.db, () => {
      sessions.create({
        tokenHash: sha256(token),
        userId: acc.id,
        sessionVersion: acc.sessionVersion,
        csrfToken,
        createdAt: now,
        expiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      accounts.update(acc.id, { failed: 0, lockedUntil: null, lastLoginAt: now });
      audit(acc, { action: 'Inicio de sesión', ip: meta.ip });
    });
    return { token, csrfToken, expiresAt };
  }

  // Busca una invitación vigente por el token del enlace y comprueba que corresponda al correo.
  function findInvite(email, token) {
    if (!token) return null;
    const invite = accounts.inviteByTokenHash(sha256(token.trim()));
    if (!invite || new Date(invite.expiresAt) < new Date()) return null;
    const acc = accounts.findById(invite.userId);
    if (!acc || normEmail(acc.email) !== normEmail(email)) return null;
    return { acc, invite };
  }

  const service = {
    async login({ email, password, scope }, meta) {
      const acc = accounts.findByEmail(normEmail(email));
      if (!acc || acc.scope !== scope) {
        await burnPasswordCheck(password); // mismo tiempo de respuesta exista o no la cuenta
        platform.audit({
          actor: maskEmail(normEmail(email)),
          action: 'Intento de acceso con correo no registrado',
          severity: 'warn',
          ip: meta.ip,
        });
        throw unauthorized(GENERIC_LOGIN_ERROR, 'invalid_credentials');
      }
      if (acc.lockedUntil && new Date(acc.lockedUntil) > new Date()) {
        await burnPasswordCheck(password);
        const min = Math.ceil((new Date(acc.lockedUntil) - Date.now()) / 60e3);
        throw new HttpError(423, `Por seguridad la cuenta está bloqueada. Intenta de nuevo en ${min} min.`, 'locked');
      }
      const ok = acc.passwordHash ? await verifyPassword(acc.passwordHash, password) : (await burnPasswordCheck(password), false);
      if (!ok) {
        const failed = acc.failed + 1;
        const lock = failed >= SECURITY.MAX_LOGIN_ATTEMPTS;
        transaction(repos.db, () => {
          accounts.update(acc.id, lock ? { failed: 0, lockedUntil: later(minutes(SECURITY.LOCK_MINUTES)) } : { failed });
          audit(acc, {
            action: lock ? 'Cuenta bloqueada por intentos fallidos' : 'Contraseña incorrecta',
            severity: lock ? 'danger' : 'warn',
            ip: meta.ip,
          });
          if (lock) platform.enqueue(templates.locked({ user: acc }));
        });
        if (lock) {
          dispatch();
          throw new HttpError(423, `Demasiados intentos. Bloqueamos la cuenta ${SECURITY.LOCK_MINUTES} minutos.`, 'locked');
        }
        throw unauthorized(GENERIC_LOGIN_ERROR, 'invalid_credentials');
      }
      if (acc.status === 'suspended') throw new HttpError(403, 'Tu cuenta está suspendida. Contacta a tu administrador.', 'suspended');
      if (acc.status !== 'active') throw unauthorized(GENERIC_LOGIN_ERROR, 'invalid_credentials');
      if (acc.scope === 'tenant' && acc.role !== 'admin') {
        const t = tenants.find(acc.tenantId);
        if (t?.status !== 'active')
          throw new HttpError(
            403,
            `El acceso de ${t?.name || 'este residencial'} está suspendido. Contacta a la administración.`,
            'tenant_suspended',
          );
      }

      // Verificación en dos pasos para administradores y personal de la empresa
      if (acc.scope === 'platform' || acc.role === 'admin') {
        const code = randomDigits(6);
        const challengeId = randomToken(18);
        transaction(repos.db, () => {
          accounts.purgeExpiredChallenges(new Date().toISOString());
          accounts.createChallenge({
            id: challengeId,
            userId: acc.id,
            codeHash: sha256(`${challengeId}:${code}`),
            expiresAt: later(minutes(SECURITY.MFA_MINUTES)),
          });
          platform.enqueue(templates.mfa({ user: acc, code }));
        });
        dispatch();
        return { mfa: { challengeId, phone: maskPhone(acc.phone), email: maskEmail(acc.email) } };
      }
      return { session: startSession(acc, meta), account: acc };
    },

    verifyMfa({ challengeId, code }, meta) {
      const ch = accounts.getChallenge(challengeId);
      if (!ch || new Date(ch.expiresAt) < new Date()) throw new HttpError(401, 'El código venció. Inicia sesión de nuevo.', 'mfa_expired');
      if (!safeEqual(sha256(`${challengeId}:${code.trim()}`), ch.codeHash)) {
        const attempts = ch.attempts + 1;
        if (attempts >= SECURITY.MAX_CODE_ATTEMPTS) {
          accounts.deleteChallenge(challengeId);
          throw new HttpError(401, 'Demasiados intentos. Inicia sesión de nuevo.', 'mfa_expired');
        }
        accounts.setChallengeAttempts(challengeId, attempts);
        throw new HttpError(401, `Código incorrecto. Te quedan ${SECURITY.MAX_CODE_ATTEMPTS - attempts} intentos.`, 'mfa_invalid');
      }
      accounts.deleteChallenge(challengeId);
      const acc = accounts.findById(ch.userId);
      if (!acc || acc.status !== 'active') throw unauthorized(GENERIC_LOGIN_ERROR, 'invalid_credentials');
      return { session: startSession(acc, meta), account: acc };
    },

    // Paso 1 de la activación: valida el enlace (correo) y, si se envía, el código (WhatsApp)
    checkActivation({ email, token, code }) {
      const found = findInvite(email, token);
      if (!found) throw new HttpError(400, INVALID_LINK, 'invalid_link');
      const { acc, invite } = found;
      if (code === undefined) return { name: acc.name, purpose: invite.purpose, phone: maskPhone(acc.phone) };
      if (!safeEqual(sha256(`${acc.id}:${code.trim()}`), invite.codeHash)) {
        const attempts = invite.attempts + 1;
        const burn = attempts >= SECURITY.MAX_CODE_ATTEMPTS;
        transaction(repos.db, () => {
          if (burn) accounts.deleteInvite(acc.id);
          else accounts.setInviteAttempts(acc.id, attempts);
          audit(acc, { action: burn ? 'Invitación anulada por intentos fallidos' : 'Código de activación incorrecto', severity: 'warn' });
        });
        throw new HttpError(
          400,
          burn
            ? 'Demasiados intentos. Por seguridad anulamos esta invitación; pide una nueva a tu administrador.'
            : `Código incorrecto. Te quedan ${SECURITY.MAX_CODE_ATTEMPTS - attempts} intentos.`,
          burn ? 'invite_burned' : 'invalid_code',
        );
      }
      return { name: acc.name, purpose: invite.purpose, user: { name: acc.name, email: acc.email } };
    },

    // Paso 2: crea la contraseña y activa la cuenta (la invitación queda inutilizada)
    async completeActivation({ email, token, code, password }) {
      const check = service.checkActivation({ email, token, code });
      const { acc } = findInvite(email, token);
      const issues = passwordIssues(password, acc);
      if (issues.length) throw new HttpError(400, 'La contraseña no cumple: ' + issues.join(', ').toLowerCase(), 'weak_password');
      const passwordHash = await hashPassword(password);
      transaction(repos.db, () => {
        accounts.update(acc.id, {
          status: 'active',
          passwordHash,
          failed: 0,
          lockedUntil: null,
          passwordChangedAt: new Date().toISOString(),
        });
        accounts.bumpSessionVersion(acc.id);
        accounts.deleteInvite(acc.id);
        sessions.deleteForUser(acc.id);
        platform.enqueue(templates.activated({ user: acc, org: orgName(acc) }));
        audit(acc, { action: check.purpose === 'reset' ? 'Contraseña restablecida' : 'Cuenta activada' });
      });
      dispatch();
      return { scope: acc.scope };
    },

    /**
     * Valida la cookie de sesión. Devuelve `{ session, account }` o lanza 401 con el motivo.
     * `touch: false` no cuenta como actividad (lo usa la conexión de avisos en tiempo real).
     */
    resolveSession(token, { touch = true } = {}) {
      if (!token) throw unauthorized();
      const tokenHash = sha256(token);
      const s = sessions.find(tokenHash);
      if (!s) throw unauthorized('Tu sesión terminó. Inicia sesión de nuevo.', 'session_ended');
      const end = (message) => {
        sessions.delete(tokenHash);
        throw unauthorized(message, 'session_ended');
      };
      const now = Date.now();
      if (now > new Date(s.expiresAt).getTime()) end('Tu sesión expiró. Inicia sesión de nuevo.');
      if (now - new Date(s.lastSeenAt).getTime() > minutes(SECURITY.IDLE_MINUTES)) end('Cerramos tu sesión por inactividad.');
      const acc = accounts.findById(s.userId);
      if (!acc || acc.status !== 'active' || acc.sessionVersion !== s.sessionVersion)
        end('Tu sesión se cerró porque cambió el estado de tu cuenta.');
      // Con el residencial suspendido sólo el administrador conserva la sesión, limitada a pagar la suscripción.
      const suspended = acc.scope === 'tenant' && tenants.find(acc.tenantId)?.status !== 'active';
      if (suspended && acc.role !== 'admin') end('El acceso a este residencial está suspendido. Contacta a la administración.');
      if (touch && now - new Date(s.lastSeenAt).getTime() > 60e3) sessions.touch(tokenHash, new Date(now).toISOString());
      return { session: { ...s, token, restricted: suspended }, account: acc };
    },

    logout(token, acc) {
      if (!token) return;
      sessions.delete(sha256(token));
      if (acc) audit(acc, { action: 'Cierre de sesión' });
    },
  };
  return service;
}
