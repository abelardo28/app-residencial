// Cliente de Server-Sent Events sobre fetch, con reconexión.

/** Separa un búfer de texto en eventos `{ event, data }`; devuelve los eventos completos y el resto. */
export function parseEvents(buffer) {
  const events = [];
  let rest = buffer.replace(/\r\n/g, '\n');
  let i;
  while ((i = rest.indexOf('\n\n')) >= 0) {
    const block = rest.slice(0, i);
    rest = rest.slice(i + 2);
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue; // comentario (latido)
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length) events.push({ event, data: data.join('\n') });
  }
  return { events, rest };
}

/**
 * Mantiene abierta la conexión y llama `onEvent` por cada evento. Si se cae, reintenta con espera creciente.
 * `onStatus(true|false)` avisa cuando se conecta o se desconecta. Devuelve una función para detenerlo.
 */
export function connectStream(url, { token, onEvent, onStatus = () => {}, log = console, maxDelayMs = 30_000 }) {
  let stopped = false;
  let controller;
  let delay = 1000;
  (async function loop() {
    while (!stopped) {
      controller = new AbortController();
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          signal: controller.signal,
        });
        if (res.status === 401) throw Object.assign(new Error('Token rechazado: genera uno nuevo en la APP.'), { fatal: true });
        if (!res.ok) throw new Error(`La API respondió ${res.status}`);
        onStatus(true);
        delay = 1000;
        const decoder = new TextDecoder();
        let buffer = '';
        for await (const chunk of res.body) {
          const parsed = parseEvents(buffer + decoder.decode(chunk, { stream: true }));
          buffer = parsed.rest;
          for (const e of parsed.events) onEvent(e);
        }
        throw new Error('La conexión se cerró');
      } catch (err) {
        if (stopped) break;
        onStatus(false);
        if (err.fatal) {
          log.error(`[conexión] ${err.message}`);
          delay = maxDelayMs;
        } else log.warn(`[conexión] ${err.message}. Reintento en ${Math.round(delay / 1000)} s`);
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, maxDelayMs);
      }
    }
  })();
  return () => {
    stopped = true;
    controller?.abort();
  };
}
