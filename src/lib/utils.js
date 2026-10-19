export const uid = (p = '') => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
export const nowIso = () => new Date().toISOString();

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function shortCode(len = 6) {
  const a = new Uint32Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join('');
}

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

export const monthKey = (d = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
};
export const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export function lastMonths(n, from = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(new Date(from.getFullYear(), from.getMonth() - i, 1)));
  return out;
}

// Valor para <input type="datetime-local"> en hora local
export function toLocalInput(d) {
  const x = new Date(d);
  const off = x.getTimezoneOffset();
  return new Date(x.getTime() - off * 60000).toISOString().slice(0, 16);
}

export function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// Reduce fotos para que quepan en el almacenamiento local de la demo.
export async function compressImage(fileOrUrl, maxSide = 900, quality = 0.72) {
  const src = typeof fileOrUrl === 'string' ? fileOrUrl : await fileToDataUrl(fileOrUrl);
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

export async function fileToAttachment(file) {
  const isImage = file.type.startsWith('image/');
  const dataUrl = isImage ? await compressImage(file, 1400, 0.8) : await fileToDataUrl(file);
  return { id: uid('f_'), name: file.name, type: isImage ? 'image/jpeg' : file.type, size: file.size, dataUrl };
}

export const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const initials = (name = '') => name.split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
