// Service worker: permite instalar la app, la abre sin conexión con la última versión vista
// y muestra las notificaciones. Para Web Push real, el backend envía el payload con la clave VAPID.
const CACHE = 'residencial-v1';
const scope = new URL(self.registration.scope);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Primero la red (siempre la versión más reciente); si no hay conexión, lo último guardado.
// La API (/api) nunca se guarda: los datos sólo vienen del servidor.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== scope.origin || url.pathname.includes('/api/')) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match(scope.href) : undefined))),
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'Residencial', body: 'Tienes una nueva notificación' };
  try {
    data = event.data.json();
  } catch {}
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: new URL('icon-192.png', scope).href, data }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/';
  event.waitUntil(clients.openWindow(`${scope.href}#${link}`));
});
