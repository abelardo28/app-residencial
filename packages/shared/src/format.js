// Identificadores, fechas y formato de moneda. Funciona igual en Node y en el navegador.

const ALPHANUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para evitar confusiones

function randomString(alphabet, length) {
  const bytes = new Uint32Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join('');
}

/** Identificador aleatorio con prefijo legible, p. ej. `p_k3j9x2m1a8`. */
export const uid = (prefix = '') => prefix + randomString(ALPHANUM, 12);

/** Código corto para que el visitante lo dicte en caseta. */
export const shortCode = (length = 6) => randomString(CODE_ALPHABET, length);

/** Código numérico (p. ej. entrega de paquetes). */
export const numericCode = (length = 4) => randomString('0123456789', length);

export const nowIso = () => new Date().toISOString();

export const money = (n) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 }).format(n || 0);

export const fmtDate = (d, opts = {}) =>
  d ? new Date(d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', ...opts }) : '';
export const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '');
export const fmtDateTime = (d) => (d ? `${fmtDate(d)} · ${fmtTime(d)}` : '');

export function timeAgo(d) {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'hace un momento';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const dd = Math.round(h / 24);
  if (dd < 30) return `hace ${dd} d`;
  return fmtDate(d);
}

/** Mes en formato `AAAA-MM`. */
export const monthKey = (d = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
};

export const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Los últimos `n` meses terminando en el actual, del más antiguo al más reciente. */
export function lastMonths(n, from = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(new Date(from.getFullYear(), from.getMonth() - i, 1)));
  return out;
}

export const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const initials = (name = '') =>
  name.split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
