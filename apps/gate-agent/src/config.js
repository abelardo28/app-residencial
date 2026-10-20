// Configuración del agente desde variables de entorno.
export function loadConfig(env = process.env) {
  const c = {
    apiUrl: (env.API_URL || '').replace(/\/$/, ''),
    barrierToken: env.BARRIER_TOKEN || '',
    relay: env.RELAY || 'console',
    relayUrl: env.RELAY_URL || '',
    relayPulseMs: Number(env.RELAY_PULSE_MS || 1000),
    readerToken: env.READER_TOKEN || '',
    tagInput: env.TAG_INPUT || 'stdin',
    cameraToken: env.CAMERA_TOKEN || '',
    lprPort: Number(env.LPR_PORT || 8090),
    lprKey: env.LPR_KEY || '',
  };
  const errors = [];
  if (!/^https?:\/\//.test(c.apiUrl)) errors.push('API_URL debe ser la dirección de la API (https://…).');
  if (!c.barrierToken && !c.readerToken && !c.cameraToken)
    errors.push('Define al menos un token: BARRIER_TOKEN, READER_TOKEN o CAMERA_TOKEN.');
  if (!['console', 'shelly', 'http'].includes(c.relay)) errors.push('RELAY debe ser console, shelly o http.');
  if (c.relay !== 'console' && !c.relayUrl) errors.push('RELAY_URL es obligatorio con RELAY=shelly o http.');
  if (!(c.relayPulseMs >= 200 && c.relayPulseMs <= 10000)) errors.push('RELAY_PULSE_MS debe estar entre 200 y 10000.');
  if (errors.length) throw new Error(`Configuración inválida:\n  - ${errors.join('\n  - ')}`);
  return c;
}
