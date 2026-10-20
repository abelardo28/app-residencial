// Modo sin internet de la tablet de caseta.
// Mientras hay conexión se descarga cada 5 minutos un paquete con los pases vigentes de las próximas 24 h
// (sólo la huella de cada QR, no el QR). Si se cae el internet, la tablet valida contra ese paquete y guarda
// las entradas en una cola; al volver la conexión se envían con su hora real y el servidor las revisa.
import { useCallback, useEffect, useRef, useState } from 'react';
import { evaluatePass, nowIso, parseInput, uid } from '@residencial/shared';
import { useStore } from '../data/store';
import { demoHash } from '../data/demo/sign';

const REFRESH_MS = 5 * 60e3;
const keyOf = (tenantId, what) => `residencial:gate-${what}:${tenantId}`;

function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // almacenamiento lleno o bloqueado
  }
}

async function hashToken(alg, text) {
  if (alg === 'fnv') return demoHash.fn(text);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
const isNetwork = (e) => e?.code === 'network';

export function useOfflineGate() {
  const { actions, session } = useStore();
  const tenantId = session?.tenantId;
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [simulated, setSimulatedState] = useState(() => sessionStorage.getItem('residencial:gate-sim-offline') === '1');
  const [pack, setPack] = useState(() => read(keyOf(tenantId, 'pack'), null));
  const [queue, setQueue] = useState(() => read(keyOf(tenantId, 'queue'), []));
  const [syncing, setSyncing] = useState(false);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const offline = simulated || !online;

  const setSimulated = (v) => {
    sessionStorage.setItem('residencial:gate-sim-offline', v ? '1' : '0');
    setSimulatedState(v);
  };
  const saveQueue = useCallback(
    (q) => {
      queueRef.current = q;
      setQueue(q);
      if (!write(keyOf(tenantId, 'queue'), q))
        write(
          keyOf(tenantId, 'queue'),
          q.map((x) => ({ ...x, photo: '' })),
        ); // sin fotos si no cabe
    },
    [tenantId],
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Descarga el paquete mientras hay conexión
  useEffect(() => {
    if (offline || !tenantId) return;
    const load = () =>
      actions.call('offlinePack').then(
        (p) => {
          write(keyOf(tenantId, 'pack'), p);
          setPack(p);
        },
        (e) => isNetwork(e) && setOnline(false),
      );
    load();
    const iv = setInterval(load, REFRESH_MS);
    return () => clearInterval(iv);
  }, [offline, tenantId, actions]);

  // Al volver la conexión se envían los registros pendientes, en orden
  const sync = useCallback(async () => {
    if (!queueRef.current.length) return;
    setSyncing(true);
    try {
      for (const item of [...queueRef.current]) {
        const input = { ...item };
        delete input.localId;
        try {
          await actions.call('registerEntry', input);
        } catch (e) {
          if (isNetwork(e)) {
            setOnline(false);
            return;
          }
          // Error del servidor (p. ej. el pase se eliminó): se descarta para no bloquear la cola
        }
        saveQueue(queueRef.current.filter((x) => x.localId !== item.localId));
      }
    } finally {
      setSyncing(false);
    }
  }, [actions, saveQueue]);
  useEffect(() => {
    if (!offline) sync();
  }, [offline, sync]);

  async function checkLocal(text) {
    const fresh = pack && new Date(pack.validUntil) > new Date();
    if (!fresh) return { ok: false, offline: true, reason: 'Sin conexión y sin pases guardados. Conéctate un momento para descargarlos.' };
    const parsed = parseInput(text, () => '');
    let pass;
    if (parsed.kind === 'token') {
      const h = await hashToken(pack.alg, text.trim());
      pass = pack.passes.find((p) => p.tokenHash === h);
    } else pass = pack.passes.find((p) => p.code === parsed.code);
    if (!pass) return { ok: false, offline: true, reason: 'Código no encontrado en los pases guardados' };
    // Cuenta también las entradas registradas sin conexión en esta tablet
    const localUses = queueRef.current.filter((q) => q.passId === pass.id).map((q) => ({ at: q.offlineAt }));
    const withUses = { ...pass, uses: [...pass.uses, ...localUses] };
    return { pass: withUses, offline: true, ...evaluatePass(withUses) };
  }

  /** Valida un QR o código: con el servidor si hay conexión, con el paquete guardado si no. */
  async function check(text) {
    if (!offline) {
      try {
        return await actions.call('checkCode', text);
      } catch (e) {
        if (!isNetwork(e)) throw e;
        setOnline(false);
      }
    }
    return checkLocal(text);
  }

  /** Registra una entrada; sin conexión queda en la cola y se envía después. */
  async function register(input, display = {}) {
    if (!offline) {
      try {
        return await actions.call('registerEntry', input);
      } catch (e) {
        if (!isNetwork(e)) throw e;
        setOnline(false);
      }
    }
    const item = { ...input, offlineAt: nowIso(), localId: uid('q_') };
    saveQueue([...queueRef.current, item]);
    return { ...display, ...input, offline: true };
  }

  return { offline, simulated, setSimulated, pack, queue, syncing, check, register, sync };
}
