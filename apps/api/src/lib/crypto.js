// Primitivas criptográficas del servidor.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

// Parámetros Argon2id recomendados por OWASP (19 MiB, 2 iteraciones).
const ARGON = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password) => argonHash(password, ARGON);
export async function verifyPassword(hash, password) {
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

// Hash ficticio para que una cuenta inexistente tarde lo mismo que una real (evita enumerar correos).
let dummyHash;
export async function burnPasswordCheck(password) {
  dummyHash ??= await hashPassword('cuenta-inexistente-' + randomBytes(8).toString('hex'));
  await verifyPassword(dummyHash, password);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const randomDigits = (length = 6) => Array.from({ length }, () => randomInt(0, 10)).join('');
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
export const hmac = (secret, text) => createHmac('sha256', secret).update(text).digest('base64url');

export function safeEqual(a = '', b = '') {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Firma de los QR de acceso: HMAC-SHA256 truncado (16 caracteres = 96 bits). */
export const passSigner = (secret) => (payload) => hmac(secret, payload).slice(0, 16);
