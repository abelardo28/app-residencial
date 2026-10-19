// Utilidades de la APP. El formato (dinero, fechas, meses) viene del paquete compartido para que
// la API y la APP muestren lo mismo; aquí quedan sólo las funciones que necesitan el navegador.
import { uid } from '@residencial/shared';

export {
  uid,
  nowIso,
  shortCode,
  money,
  fmtDate,
  fmtTime,
  fmtDateTime,
  timeAgo,
  monthKey,
  monthLabel,
  lastMonths,
  DAYS,
  initials,
} from '@residencial/shared';

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

// Reduce las fotos antes de subirlas (menos datos móviles y almacenamiento).
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
