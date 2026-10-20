// Avisos de cámaras con lectura de placas (LPR / ANPR).
// Acepta JSON genérico ({"plate":"ABC123A"}), el XML de Hikvision (<licensePlate>) y el formato de Dahua (PlateNumber).
import { createServer } from 'node:http';

export function plateFrom(body = '', contentType = '') {
  const text = String(body);
  if (contentType.includes('json') || text.trim().startsWith('{')) {
    try {
      const j = JSON.parse(text);
      return clean(j.plate || j.licensePlate || j.PlateNumber || j.plateNumber || j?.Picture?.Plate?.PlateNumber || '');
    } catch {
      return '';
    }
  }
  const m = text.match(/<licensePlate>([^<]+)<\/licensePlate>/i) || text.match(/PlateNumber["=:\s]+"?([A-Z0-9-]+)/i);
  return clean(m?.[1] || '');
}
const clean = (p) =>
  String(p)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/** Servidor local donde la cámara envía sus avisos. Llama `onPlate(placa)` por cada lectura válida. */
export function startLprServer({ port, key }, onPlate, log = console) {
  const seen = new Map(); // la cámara repite la misma placa varias veces seguidas
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method !== 'POST') return res.writeHead(405).end();
    if (key && url.searchParams.get('key') !== key && req.headers['x-agent-key'] !== key) return res.writeHead(401).end();
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 2_000_000) req.destroy(); // las fotos de la cámara no se necesitan
    });
    req.on('end', () => {
      res.writeHead(200).end('OK');
      const plate = plateFrom(body, req.headers['content-type'] || '');
      if (plate.length < 5) return;
      const last = seen.get(plate) || 0;
      if (Date.now() - last < 15_000) return;
      seen.set(plate, Date.now());
      onPlate(plate);
    });
  });
  server.listen(port, () => log.info(`[cámara] Esperando avisos de placas en el puerto ${port}`));
  return server;
}
