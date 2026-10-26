// Lectura de estados de cuenta bancarios (CSV exportado desde la banca en línea) para la conciliación.
// Reconoce las columnas por su nombre, así funciona con los formatos más comunes (BBVA, Banorte, Santander…).

const norm = (s = '') => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const COLUMNS = {
  date: ['fecha', 'fecha operacion', 'fecha de operacion', 'dia'],
  description: ['concepto', 'descripcion', 'detalle', 'movimiento', 'leyenda'],
  reference: ['referencia', 'referencia numerica', 'ref', 'clave de rastreo', 'rastreo'],
  credit: ['abono', 'abonos', 'deposito', 'depositos', 'ingreso', 'ingresos', 'haber', 'credito'],
  debit: ['cargo', 'cargos', 'retiro', 'retiros', 'egreso', 'debe', 'debito'],
  amount: ['importe', 'monto', 'cantidad'],
};

function splitLine(line, sep) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === sep && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** "$1,500.00" → 1500 · "(200.00)" → -200 */
export function parseAmount(text = '') {
  const t = String(text).trim();
  if (!t) return 0;
  const negative = /^\(.*\)$/.test(t) || t.startsWith('-');
  const n = Number(t.replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? (negative ? -n : n) : 0;
}

/** dd/mm/aaaa, dd-mm-aaaa o aaaa-mm-dd → aaaa-mm-dd */
export function parseDate(text = '') {
  const t = text.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return t;
}

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Convierte el CSV en depósitos: [{ id, date, amount, reference, description }].
 * Sólo devuelve abonos (los cargos se ignoran). `id` es estable: al volver a importar el mismo archivo
 * los movimientos se reconocen como repetidos.
 */
export function parseBankStatement(text) {
  const lines = String(text)
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (!lines.length) return { movements: [], error: 'El archivo está vacío.' };
  const headerIndex = lines.findIndex((l) => /fecha/i.test(l));
  if (headerIndex < 0) return { movements: [], error: 'No encontramos la fila de encabezados (debe tener una columna "Fecha").' };
  const header = lines[headerIndex];
  const sep = [';', '\t', ','].sort((a, b) => header.split(b).length - header.split(a).length)[0];
  const cols = splitLine(header, sep).map(norm);
  const find = (names) => cols.findIndex((c) => names.some((n) => c === n || c.startsWith(n)));
  const idx = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, find(names)]));
  if (idx.date < 0 || (idx.credit < 0 && idx.amount < 0)) {
    return { movements: [], error: 'El archivo necesita las columnas "Fecha" y "Abono" (o "Importe").' };
  }

  const seen = new Map();
  const movements = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const cells = splitLine(line, sep);
    const get = (k) => (idx[k] >= 0 ? cells[idx[k]] || '' : '');
    const amount = idx.credit >= 0 ? parseAmount(get('credit')) : parseAmount(get('amount'));
    if (!(amount > 0) || (idx.credit < 0 && parseAmount(get('debit')) > 0)) continue; // sólo depósitos
    const description = get('description');
    const refCell = get('reference');
    // La referencia de 7 dígitos puede venir en su columna o dentro del concepto
    const reference = (refCell.match(/\b\d{7}\b/) || description.match(/\b\d{7}\b/) || [refCell])[0] || '';
    const date = parseDate(get('date'));
    const key = `${date}|${amount}|${reference}|${description}`;
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    movements.push({ id: `bm_${fnv(`${key}|${n}`)}`, date, amount, reference, description: description.slice(0, 200) });
  }
  return { movements, error: movements.length ? null : 'No encontramos depósitos en el archivo.' };
}

/**
 * Cuentas para transferencias del residencial, con la principal primero.
 * Los residenciales guardados antes de tener varias cuentas sólo traen `settings.bank`.
 */
export function bankAccounts(settings) {
  const list = settings?.bankAccounts?.length
    ? settings.bankAccounts
    : settings?.bank?.clabe
      ? [{ id: 'principal', alias: '', ...settings.bank, primary: true }]
      : [];
  return [...list].sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
}

/** Últimos 4 dígitos de la CLABE, para nombrar la cuenta sin mostrarla completa. */
export const clabeTail = (clabe = '') => clabe.replace(/\D/g, '').slice(-4);

/** Nombre corto de una cuenta: «Mantenimiento · BBVA ···4455». */
export const bankAccountLabel = (a) => [a.alias, `${a.name} ···${clabeTail(a.clabe)}`].filter(Boolean).join(' · ');
