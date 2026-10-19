// Notificaciones del sistema (navegador / PWA).
// En la demo se muestran localmente cuando llega una notificación nueva para el usuario activo.
// Para Web Push real: genera llaves VAPID, define VITE_VAPID_PUBLIC_KEY y envía la suscripción a tu backend.
let registration = null;

export async function initPush() {
  if (!('serviceWorker' in navigator)) return;
  try {
    registration = await navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js');
  } catch {
    registration = null;
  }
}

export const pushSupported = () => 'Notification' in window;
export const pushPermission = () => (pushSupported() ? Notification.permission : 'denied');

export async function requestPush() {
  if (!pushSupported()) return 'denied';
  const p = await Notification.requestPermission();
  const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (p === 'granted' && vapid && registration?.pushManager) {
    const sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapid });
    const api = import.meta.env.VITE_API_URL;
    if (api)
      await fetch(`${api}/push/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
  }
  return p;
}

export function showSystemNotification({ title, body, link }) {
  if (pushPermission() !== 'granted') return;
  try {
    if (registration) registration.showNotification(title, { body, icon: '/favicon.svg', data: { link } });
    else new Notification(title, { body, icon: '/favicon.svg' });
  } catch {
    /* algunos navegadores bloquean notificaciones fuera de HTTPS */
  }
}
