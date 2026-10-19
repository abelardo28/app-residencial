// Copia los archivos de tesseract.js a public/ocr para no depender de un CDN externo.
// Las rutas se resuelven con el resolvedor de Node: funcionan aunque npm instale los paquetes en la raíz del monorepo.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'ocr');
mkdirSync(out, { recursive: true });

const files = [
  [join(pkgDir('tesseract.js'), 'dist/worker.min.js'), 'worker.min.js'],
  [join(pkgDir('@tesseract.js-data/eng'), '4.0.0_best_int/eng.traineddata.gz'), 'eng.traineddata.gz'],
  ...['lstm', 'simd-lstm', 'relaxedsimd-lstm'].map((v) => [
    join(pkgDir('tesseract.js-core'), `tesseract-core-${v}.wasm.js`),
    `tesseract-core-${v}.wasm.js`,
  ]),
];
let missing = 0;
for (const [from, to] of files) {
  if (!existsSync(from)) {
    console.warn('No encontrado:', from);
    missing++;
    continue;
  }
  cpSync(from, join(out, to));
}
console.log(`Archivos OCR copiados a public/ocr${missing ? ` (faltan ${missing})` : ''}`);
