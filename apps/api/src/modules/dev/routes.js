// /api/v1/dev — utilidades de desarrollo. Sólo se registran fuera de producción y con mensajería `console`.
export default async function devRoutes(app, { repos, whatsappService }) {
  // Buzón de prueba: muestra los correos y WhatsApp que se habrían enviado (enlaces y códigos de activación).
  app.get('/outbox', async () => ({ messages: repos.platform.recentMessages(100) }));

  // Simulador de WhatsApp: escribe como si fueras un teléfono registrado y recibe lo que respondería el asistente.
  app.get('/whatsapp/contacts', async () => ({
    contacts: repos.tenants
      .list()
      .flatMap((t) => repos.accounts.listByTenant(t.id).map((a) => ({ ...a, residencial: t.name })))
      .filter((a) => a.phone && a.status === 'active')
      .map((a) => ({ phone: a.phone, name: a.name, role: a.role, residencial: a.residencial })),
  }));
  app.post('/whatsapp', async (req) => {
    const { from = '', text = '' } = req.body || {};
    return whatsappService.handleIncoming({ from: String(from), text: String(text).slice(0, 1000) }, { deliver: false });
  });
}
