// Instalar la app (PWA). Chrome, Edge y Android avisan con `beforeinstallprompt`; se guarda desde el arranque
// porque puede llegar antes de que se monte la pantalla. En iPhone/iPad no existe ese aviso: se explica cómo
// agregarla desde Safari (Compartir → Agregar a inicio).
import { useEffect, useState } from 'react';

let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

export function initInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // el botón propio decide cuándo mostrarlo
    deferred = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

export const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
export const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** `mode`: 'prompt' (botón del navegador), 'ios' (instrucciones) o null (ya instalada o no disponible). */
export function useInstall() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  const mode = isInstalled() ? null : deferred ? 'prompt' : isIos() ? 'ios' : null;
  async function install() {
    if (!deferred) return false;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    notify();
    return outcome === 'accepted';
  }
  return { mode, install };
}
