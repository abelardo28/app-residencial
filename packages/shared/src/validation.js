// Reglas de datos de cuentas que deben coincidir en la APP (mensajes en vivo) y en la API (validación final).

export const PASSWORD_RULES = [
  'Al menos 10 caracteres',
  'Mayúsculas y minúsculas',
  'Al menos un número',
  'Al menos un símbolo (#, !, $…)',
  'Sin tu nombre, correo ni palabras comunes',
];

const COMMON = ['password', 'contraseña', '12345678', 'qwerty', 'residencial', 'admin123', '123456789', 'abc12345'];

/** Devuelve la lista de reglas de `PASSWORD_RULES` que la contraseña no cumple. */
export function passwordIssues(pw = '', { name = '', email = '' } = {}) {
  const issues = [];
  if (pw.length < 10) issues.push(PASSWORD_RULES[0]);
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) issues.push(PASSWORD_RULES[1]);
  if (!/\d/.test(pw)) issues.push(PASSWORD_RULES[2]);
  if (!/[^A-Za-z0-9]/.test(pw)) issues.push(PASSWORD_RULES[3]);
  const low = pw.toLowerCase();
  const parts = [...name.toLowerCase().split(/\s+/), email.toLowerCase().split('@')[0]].filter((p) => p && p.length >= 4);
  if (COMMON.some((c) => low.includes(c)) || parts.some((p) => low.includes(p))) issues.push(PASSWORD_RULES[4]);
  return issues;
}

export const normEmail = (e = '') => e.trim().toLowerCase();
export const validEmail = (e = '') => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());

/** WhatsApp en formato E.164. Diez dígitos se toman como número de México. Devuelve '' si no es válido. */
export function normPhone(p = '') {
  const d = p.replace(/\D/g, '');
  if (d.length === 10) return '+52' + d;
  if (d.length >= 11 && d.length <= 15) return '+' + d;
  return '';
}

export const maskEmail = (e = '') => e.replace(/^(.{2}).*(@.*)$/, '$1•••$2');
export const maskPhone = (p = '') => (p ? p.slice(0, 3) + ' ••• ••• ' + p.slice(-4) : '');

export const ROLES = ['resident', 'guard', 'admin'];
export const ROLE_NAME = { resident: 'Residente', guard: 'Vigilante', admin: 'Administrador' };
export const ACCOUNT_STATUS = {
  active: ['Activa', 'ok'],
  pending: ['Pendiente de activar', 'warn'],
  reset: ['Restablecimiento pendiente', 'warn'],
  suspended: ['Suspendida', 'bad'],
};

// Límites de seguridad compartidos (la API los aplica; la APP los muestra).
export const SECURITY = {
  MAX_LOGIN_ATTEMPTS: 5,
  LOCK_MINUTES: 15,
  INVITE_HOURS: 48,
  MFA_MINUTES: 5,
  MAX_CODE_ATTEMPTS: 5,
  SESSION_HOURS: 8,
  IDLE_MINUTES: 30,
};
