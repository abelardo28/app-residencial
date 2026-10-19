// Criptografía del modo demo (Web Crypto). Sólo simula al servidor dentro del navegador:
// con la API, las contraseñas se guardan con Argon2id en el servidor y la sesión vive en una cookie HttpOnly.
import { SECURITY } from '@residencial/shared';

export const PBKDF2_ITERATIONS = 120000;

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
  return btoa(String.fromCharCode(...a))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
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
      expiresAt: new Date(Date.now() + SECURITY.INVITE_HOURS * 3600e3).toISOString(),
      attempts: 0,
      createdAt: new Date().toISOString(),
    },
  };
}
