// Utilidades criptográficas (Web Crypto).
// En producción todo esto vive en el servidor: el navegador sólo envía el correo y la contraseña por HTTPS,
// y el servidor guarda el hash (Argon2id o PBKDF2), emite la sesión en una cookie HttpOnly y aplica los límites.
export const PBKDF2_ITERATIONS = 120000;
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
export const INVITE_HOURS = 48;
export const MFA_MINUTES = 5;
export const MAX_CODE_ATTEMPTS = 5;
export const SESSION_HOURS = 8;
export const IDLE_MINUTES = 30;

const enc = new TextEncoder();
const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));

export function randomHex(bytes = 16) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return toHex(a);
}

// Token largo para enlaces (base64url, 32 bytes = 256 bits)
export function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Código numérico sin sesgo de módulo
export function randomDigits(len = 6) {
  let out = '';
  const a = new Uint8Array(1);
  while (out.length < len) {
    crypto.getRandomValues(a);
    if (a[0] < 250) out += String(a[0] % 10);
  }
  return out;
}

export async function sha256(text) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export async function hashPassword(password, saltHex = randomHex(16), iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations }, key, 256);
  return { salt: saltHex, hash: toHex(bits), iter: iterations };
}

// Comparación en tiempo constante
export function safeEqual(a = '', b = '') {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function verifyPassword(password, auth) {
  if (!auth?.hash) return false;
  const { hash } = await hashPassword(password, auth.salt, auth.iter);
  return safeEqual(hash, auth.hash);
}

const COMMON = ['password', 'contraseña', '12345678', 'qwerty', 'residencial', 'admin123', '123456789', 'abc12345'];

// Reglas de contraseña: devuelve la lista de requisitos que no se cumplen.
export function passwordIssues(pw, { name = '', email = '' } = {}) {
  const issues = [];
  if (pw.length < 10) issues.push('Al menos 10 caracteres');
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) issues.push('Mayúsculas y minúsculas');
  if (!/\d/.test(pw)) issues.push('Al menos un número');
  if (!/[^A-Za-z0-9]/.test(pw)) issues.push('Al menos un símbolo (#, !, $…)');
  const low = pw.toLowerCase();
  const parts = [...name.toLowerCase().split(/\s+/), email.toLowerCase().split('@')[0]].filter((p) => p && p.length >= 4);
  if (COMMON.some((c) => low.includes(c)) || parts.some((p) => low.includes(p))) issues.push('Sin tu nombre, correo ni palabras comunes');
  return issues;
}

export const normEmail = (e = '') => e.trim().toLowerCase();
export const validEmail = (e = '') => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
// WhatsApp en formato internacional (México por defecto si se escriben 10 dígitos)
export function normPhone(p = '') {
  const d = p.replace(/\D/g, '');
  if (d.length === 10) return '+52' + d;
  if (d.length === 12 && d.startsWith('52')) return '+' + d;
  if (d.length >= 11 && d.length <= 15) return '+' + d;
  return '';
}
export const maskEmail = (e = '') => e.replace(/^(.{2}).*(@.*)$/, '$1•••$2');
export const maskPhone = (p = '') => (p ? p.slice(0, 3) + ' ••• ••• ' + p.slice(-4) : '');

// Invitación de activación: el enlace (token) va por correo y el código por WhatsApp.
// Se guardan sólo los hashes; para activar se necesitan los dos canales.
export async function createInvite(userId, purpose = 'activate') {
  const token = randomToken();
  const code = randomDigits(6);
  return {
    secrets: { token, code },
    invite: {
      purpose,
      tokenHash: await sha256(token),
      codeHash: await sha256(`${userId}:${code}`),
      expiresAt: new Date(Date.now() + INVITE_HOURS * 3600e3).toISOString(),
      attempts: 0,
      createdAt: new Date().toISOString(),
    },
  };
}
