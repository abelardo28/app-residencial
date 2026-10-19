// Service worker mínimo: muestra notificaciones y abre la app al tocarlas.
// Para Web Push real, el backend envía el payload con la clave VAPID y este evento lo recibe.
self.addEventListener('push', (event) => {
  let data = { title: 'Residencial', body: 'Tienes una nueva notificación' };
  try {
    data = event.data.json();
  } catch {}
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: '/favicon.svg', data }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/';
  event.waitUntil(clients.openWindow('/#' + link));
});
