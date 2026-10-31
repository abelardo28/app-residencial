// Imagen del pase para compartir o descargar: la misma tarjeta que se ve en la app
// (residencial, visita, estado, QR, código, vigencia y placa), dibujada en un canvas.

const W = 720;
const PAD = 52;
const QR_BOX = 460;
const QR_SIZE = 408;
const LIGHT = '#f8f7f5';
const FAINT = 'rgba(248, 247, 245, 0.62)';

const font = (weight, size) => `${weight} ${size}px ${getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif'}`;
const MONO = (size) => `600 ${size}px ui-monospace, Menlo, Consolas, monospace`;

/** Parte un texto en renglones que caben en `width`. */
function wrap(ctx, text, width, max = 3) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > max) {
    lines.length = max;
    lines[max - 1] = lines[max - 1].replace(/\s*\S*$/, '…');
  }
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Texto centrado con separación entre letras (no todos los navegadores tienen `letterSpacing` en canvas). */
function spaced(ctx, text, cx, y, spacing) {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
  let x = cx - total / 2;
  ctx.textAlign = 'left';
  [...text].forEach((ch, i) => {
    ctx.fillText(ch, x, y);
    x += widths[i] + spacing;
  });
}

/**
 * @param {object} p
 * @param {HTMLCanvasElement} p.qr  canvas con el QR (de preferencia grande)
 * @param {string} p.org  nombre del residencial
 * @param {string} p.visitor
 * @param {string} p.type
 * @param {string} p.status
 * @param {string} p.code
 * @param {string[]} p.details  renglones bajo el código (vigencia, entradas, placa)
 * @returns {Promise<Blob>}
 */
export async function passImage({ qr, org, visitor, type, status, code, details }) {
  await document.fonts?.ready;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const inner = W - PAD * 2;

  // Primero se mide para saber la altura
  ctx.font = font(700, 46);
  const name = wrap(ctx, visitor, inner - 150, 2);
  ctx.font = font(400, 27);
  const info = details.flatMap((d) => wrap(ctx, d, inner, 3));
  const H = PAD + 34 + name.length * 54 + 40 + 40 + QR_BOX + 86 + info.length * 40 + 30 + 40 + PAD;

  canvas.width = W;
  canvas.height = H;
  ctx.textBaseline = 'alphabetic';

  // Fondo como la tarjeta de la app
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#57524c');
  bg.addColorStop(0.55, '#2a2724');
  bg.addColorStop(1, '#171513');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W - 60, 40, 0, W - 60, 40, 340);
  glow.addColorStop(0, 'rgba(255,255,255,0.16)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  let y = PAD + 26;
  ctx.fillStyle = FAINT;
  ctx.font = font(500, 26);
  ctx.textAlign = 'left';
  ctx.fillText(org, PAD, y);

  // Estado arriba a la derecha
  ctx.font = font(600, 24);
  const pillW = ctx.measureText(status).width + 36;
  roundRect(ctx, W - PAD - pillW, y - 30, pillW, 44, 22);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fill();
  ctx.fillStyle = LIGHT;
  ctx.textAlign = 'center';
  ctx.fillText(status, W - PAD - pillW / 2, y);

  ctx.textAlign = 'left';
  ctx.font = font(700, 46);
  for (const line of name) {
    y += 54;
    ctx.fillText(line, PAD, y);
  }
  y += 40;
  ctx.fillStyle = FAINT;
  ctx.font = font(400, 27);
  ctx.fillText(type, PAD, y);

  // QR sobre fondo blanco
  y += 40;
  const qx = (W - QR_BOX) / 2;
  roundRect(ctx, qx, y, QR_BOX, QR_BOX, 32);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qr, (W - QR_SIZE) / 2, y + (QR_BOX - QR_SIZE) / 2, QR_SIZE, QR_SIZE);
  y += QR_BOX + 70;

  ctx.fillStyle = LIGHT;
  ctx.font = MONO(52);
  spaced(ctx, code, W / 2, y, 16);
  y += 16;

  ctx.textAlign = 'left';
  ctx.font = font(400, 27);
  for (const line of info) {
    y += 40;
    ctx.fillText(line, PAD, y);
  }

  y += 30;
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  y += 40;
  ctx.fillStyle = FAINT;
  ctx.font = font(500, 24);
  ctx.textAlign = 'center';
  ctx.fillText('Muestra este código en la caseta de acceso', W / 2, y);

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo crear la imagen.'))), 'image/png'),
  );
}

/** iPhone o iPad (en la app instalada el atributo `download` no guarda nada). */
export const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Descarga un archivo; en iPhone/iPad abre la hoja de compartir, donde está «Guardar imagen». */
export async function saveFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (isIos() && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] });
    return 'shared';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
