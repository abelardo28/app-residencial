// Copia los archivos de tesseract.js a public/ocr para no depender de un CDN externo.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
const out = 'public/ocr';
mkdirSync(out, { recursive: true });
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
  ...['lstm', 'simd-lstm', 'relaxedsimd-lstm'].map((v) => [`node_modules/tesseract.js-core/tesseract-core-${v}.wasm.js`, `tesseract-core-${v}.wasm.js`]),
];
for (const [from, to] of files) {
  if (!existsSync(from)) { console.warn('No encontrado:', from); continue; }
  cpSync(from, `${out}/${to}`);
}
console.log('Archivos OCR copiados a', out);
