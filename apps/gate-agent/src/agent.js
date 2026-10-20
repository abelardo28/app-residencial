// Lógica del agente: une la API, el relevador, el lector de tags y la cámara.
import { createInterface } from 'node:readline';
import { connectStream } from './sse.js';
import { createRelay } from './relay.js';
import { startLprServer } from './lpr.js';

/** ¿La orden sigue vigente? Una orden vieja (por ejemplo, tras una caída de red) nunca abre la pluma. */
export function isFresh(command, now = Date.now(), slackMs = 5000) {
  const age = now - new Date(command.createdAt).getTime();
  return age >= -slackMs && age <= (command.ttlSeconds || 20) * 1000 + slackMs;
}

export function startAgent(config, { log = console, input = process.stdin } = {}) {
  const api = `${config.apiUrl}/api/v1/devices`;
  const post = async (token, path, body) => {
    const res = await fetch(api + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error?.message || `La API respondió ${res.status}`);
    return data;
  };
  const stops = [];

  // ---------- Pluma ----------
  if (config.barrierToken) {
    const relay = createRelay(config, log);
    const done = new Set();
    const run = async (cmd) => {
      if (done.has(cmd.id)) return;
      done.add(cmd.id);
      if (!isFresh(cmd)) return log.warn(`[pluma] Orden ${cmd.id} vencida; no se abre.`);
      let ok = true;
      let error = '';
      try {
        await relay.pulse();
        log.info(`[pluma] Abierta · ${cmd.reason}`);
      } catch (err) {
        ok = false;
        error = err.message;
        log.error(`[pluma] No se pudo abrir: ${error}`);
      }
      await post(config.barrierToken, `/commands/${encodeURIComponent(cmd.id)}/ack`, { ok, error }).catch((e) =>
        log.warn(`[pluma] No se pudo confirmar: ${e.message}`),
      );
    };
    stops.push(
      connectStream(`${api}/stream`, {
        token: config.barrierToken,
        log,
        onStatus: (up) => log.info(up ? '[pluma] Conectada a la API' : '[pluma] Sin conexión con la API'),
        onEvent: (e) => {
          if (e.event === 'command') run(JSON.parse(e.data));
          if (e.event === 'revoked') log.error('[pluma] El token se revocó: genera uno nuevo en la APP.');
        },
      }),
    );
  }

  // ---------- Lector de tags ----------
  const sendRead = (token, kind, value) =>
    post(token, '/events', { kind, value }).then(
      (r) => log.info(`[${kind === 'tag' ? 'tag' : 'cámara'}] ${value}: ${r.result.label} (${r.result.result})`),
      (e) => log.warn(`[${kind}] No se pudo enviar ${value}: ${e.message}`),
    );
  if (config.readerToken && config.tagInput === 'stdin') {
    const rl = createInterface({ input });
    rl.on('line', (line) => {
      const code = line.trim();
      if (code.length >= 4) sendRead(config.readerToken, 'tag', code);
    });
    log.info('[tag] Esperando lecturas del lector (teclado USB)');
    stops.push(() => rl.close());
  }

  // ---------- Cámara de placas ----------
  if (config.cameraToken) {
    const server = startLprServer(
      { port: config.lprPort, key: config.lprKey },
      (plate) => sendRead(config.cameraToken, 'plate', plate),
      log,
    );
    stops.push(() => server.close());
  }

  return () => stops.forEach((s) => s());
}
