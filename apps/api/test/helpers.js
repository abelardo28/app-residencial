// Utilidades de prueba: API en memoria con los datos de demostración y un cliente con cookies.
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/database.js';
import { seedDemo } from '../src/db/seed.js';

export const PASSWORD = 'Demo#2026';
export const COMPANY_PASSWORD = 'Empresa#2026';

export async function createTestApp() {
  const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_PATH: ':memory:' });
  const db = openDatabase(':memory:');
  const app = await buildApp(config, { db, logger: false });
  await seedDemo(app.ctx.repos, config);

  /** Último código enviado a un destinatario (correo o WhatsApp) según el buzón de desarrollo. */
  const lastCode = (to, kind) => app.ctx.repos.platform.recentMessages(200).find((m) => m.to === to && m.meta.kind === kind)?.meta.code;

  /** Cliente que conserva la cookie de sesión y envía el token CSRF. */
  function client() {
    const state = { sid: null, csrf: null };
    const request = async (method, url, body, { csrf = true } = {}) => {
      const headers = {};
      if (state.sid) headers.cookie = `sid=${state.sid}`;
      if (csrf && state.csrf) headers['x-csrf-token'] = state.csrf;
      const res = await app.inject({ method, url: `/api/v1${url}`, payload: body, headers });
      const cookie = res.cookies.find((c) => c.name === 'sid');
      if (cookie) state.sid = cookie.value || null;
      const json = res.body ? safeJson(res.body) : null;
      if (json?.session?.csrfToken) state.csrf = json.session.csrfToken;
      return { status: res.statusCode, body: json, headers: res.headers };
    };
    const c = {
      state,
      get: (url, opts) => request('GET', url, undefined, opts),
      post: (url, body = {}, opts) => request('POST', url, body, opts),
      patch: (url, body = {}, opts) => request('PATCH', url, body, opts),
      delete: (url, opts) => request('DELETE', url, undefined, opts),
      /** Inicia sesión; si se pide verificación en dos pasos, toma el código del buzón. */
      async login(email, password = PASSWORD, scope = 'tenant') {
        const res = await c.post('/auth/login', { email, password, scope });
        if (res.body?.mfa) {
          const acc = app.ctx.repos.accounts.findByEmail(email);
          return c.post('/auth/mfa', { challengeId: res.body.mfa.challengeId, code: lastCode(acc.phone, 'mfa') });
        }
        return res;
      },
    };
    return c;
  }

  return { app, client, lastCode, repos: app.ctx.repos, close: () => app.close() };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const passInput = (over = {}) => ({
  visitorName: 'Pedro Visitante',
  type: 'amigo',
  mode: 'single',
  validFrom: new Date(Date.now() - 60e3).toISOString(),
  validTo: new Date(Date.now() + 3600e3).toISOString(),
  maxUses: 1,
  days: [],
  timeFrom: '00:00',
  timeTo: '23:59',
  ...over,
});
