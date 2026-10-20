// Controladores del relevador que abre la pluma. La pluma recibe un "pulso" (contacto cerrado un momento),
// igual que con el botón de la caseta.
export function createRelay({ relay, relayUrl, relayPulseMs }, log = console) {
  const timeout = AbortSignal.timeout ? () => AbortSignal.timeout(5000) : () => undefined;
  const get = async (url) => {
    const res = await fetch(url, { signal: timeout() });
    if (!res.ok) throw new Error(`El relevador respondió ${res.status}`);
  };
  switch (relay) {
    case 'shelly':
      // Shelly Gen1/Gen2: enciende y se apaga solo después de `timer` segundos
      return {
        pulse: () => get(`${relayUrl.replace(/\/$/, '')}/relay/0?turn=on&timer=${Math.max(1, Math.round(relayPulseMs / 1000))}`),
      };
    case 'http':
      return { pulse: () => get(relayUrl) };
    default:
      return {
        async pulse() {
          log.info(`[pluma] ABRIR (pulso de ${relayPulseMs} ms)`);
        },
      };
  }
}
