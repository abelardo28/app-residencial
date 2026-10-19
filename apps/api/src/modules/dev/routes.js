// /api/v1/dev — utilidades de desarrollo. Sólo se registran fuera de producción y con mensajería `console`.
export default async function devRoutes(app, { repos }) {
  // Buzón de prueba: muestra los correos y WhatsApp que se habrían enviado (enlaces y códigos de activación).
  app.get('/outbox', async () => ({ messages: repos.platform.recentMessages(100) }));
}
