// Lectura automática de placas en el navegador con tesseract.js.
// Los archivos del motor y el modelo de idioma se sirven desde /ocr (ver scripts/copy-ocr-assets.mjs).

let workerPromise = null;
let progressCb = null;

function getWorker() {
  if (!workerPromise) {
    // Carga diferida: tesseract.js sólo se descarga cuando el vigilante toma la primera foto.
    workerPromise = import('tesseract.js').then(async ({ createWorker, PSM }) => {
      const base = import.meta.env.BASE_URL + 'ocr';
      const w = await createWorker('eng', 1, {
        workerPath: `${base}/worker.min.js`,
        corePath: base,
        langPath: base,
        logger: (m) => progressCb?.(m),
      });
      await w.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ',
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      });
      return w;
    });
  }
  return workerPromise;
}

// Escala de grises + contraste + margen blanco para mejorar la lectura.
async function preprocess(dataUrl, maxSide) {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });
  const scale = Math.min(2, maxSide / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const pad = Math.round(Math.max(w, h) * 0.08);
  const c = document.createElement('canvas');
  c.width = w + pad * 2;
  c.height = h + pad * 2;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, pad, pad, w, h);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const g = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
    const v = Math.max(0, Math.min(255, (g - 128) * 1.6 + 128));
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  return c.toDataURL('image/png');
}

// Formatos comunes de placas mexicanas (AAA-000-A, AAA-00-00, 000-AAA, A-00-AAA, etc.)
const PATTERNS = [
  /^[A-Z]{3}\d{3}[A-Z]$/,
  /^[A-Z]{3}\d{2}\d{2}$/,
  /^[A-Z]{3}\d{3,4}$/,
  /^\d{3}[A-Z]{3}$/,
  /^[A-Z]\d{2}[A-Z]{3}$/,
  /^[A-Z]{2}\d{4,5}$/,
  /^\d{2}[A-Z]{2}\d{2}$/,
];

export function pickPlate(raw) {
  const parts = raw.toUpperCase().split(/\n+/);
  // También se une todo el texto por si la placa quedó partida en dos renglones
  const lines = [...parts, parts.join('')];
  const candidates = new Set();
  for (const line of lines) {
    const compact = line.replace(/[^A-Z0-9]/g, '');
    // Ventanas de 5 a 8 caracteres dentro de cada línea
    for (let len = 8; len >= 5; len--) {
      for (let i = 0; i + len <= compact.length; i++) candidates.add(compact.slice(i, i + len));
    }
  }
  const scored = [...candidates]
    .map((c) => {
      const letters = (c.match(/[A-Z]/g) || []).length;
      const digits = (c.match(/\d/g) || []).length;
      let score = 0;
      if (PATTERNS.some((p) => p.test(c))) score += 10;
      if (letters >= 2 && digits >= 2) score += 4;
      score += Math.min(c.length, 7) * 0.3;
      if (letters === 0 || digits === 0) score -= 8;
      return { c, score };
    })
    .filter((x) => x.score > 2)
    .sort((a, b) => b.score - a.score);
  return { plate: scored[0]?.c || '', candidates: scored.slice(0, 5).map((x) => x.c) };
}

// Varias pasadas con distinta escala y segmentación; se queda con la primera placa válida.
const PASSES = [
  { maxSide: 900, psm: 'SINGLE_BLOCK' },
  { maxSide: 1400, psm: 'SPARSE_TEXT' },
  { maxSide: 600, psm: 'SPARSE_TEXT' },
];

export async function readPlate(dataUrl, onProgress) {
  progressCb = onProgress;
  const worker = await getWorker();
  const { PSM } = await import('tesseract.js');
  let best = { plate: '', candidates: [], raw: '', confidence: 0 };
  try {
    for (const pass of PASSES) {
      await worker.setParameters({ tessedit_pageseg_mode: PSM[pass.psm] });
      const { data } = await worker.recognize(await preprocess(dataUrl, pass.maxSide));
      if (import.meta.env.DEV) console.info('[OCR]', pass, JSON.stringify(data.text), data.confidence);
      const found = pickPlate(data.text || '');
      if (found.plate) return { ...found, raw: data.text, confidence: data.confidence };
      if (!best.raw) best = { ...best, raw: data.text || '' };
    }
    return best;
  } finally {
    progressCb = null;
  }
}
