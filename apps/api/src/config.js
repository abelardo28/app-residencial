// Configuración validada al arrancar: si falta algo obligatorio, la API no inicia.
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TZ: z.string().default('America/Mexico_City'),

    DATABASE_PATH: z.string().default('./data/residencial.db'),
    SEED_DEMO: bool.default(false),

    // URL pública de la APP: se usa en los enlaces de activación y en CORS
    APP_URL: z.url().default('http://localhost:5173'),
    CORS_ORIGINS: z.string().default(''),
    COOKIE_SECURE: bool.optional(),
    TRUST_PROXY: bool.default(false),
    // Intentos por minuto y por IP en las rutas de inicio de sesión y activación
    AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(20),

    // Firma de los QR de acceso (HMAC-SHA256)
    ACCESS_SECRET: z.string().min(32).default('dev-only-access-secret-change-me-0000000000'),

    // Mensajería: `console` guarda los mensajes en el buzón de desarrollo; `live` los envía
    MESSAGING_PROVIDER: z.enum(['console', 'live']).default('console'),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default('Residencial <no-reply@residencial.local>'),
    WHATSAPP_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_AUTH_TEMPLATE: z.string().default('codigo_verificacion'),
    WHATSAPP_TEMPLATE_LANG: z.string().default('es_MX'),
    // Asistente y avisos por WhatsApp (webhook de Meta y plantillas de mensajes iniciados por el residencial)
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().optional(),
    WHATSAPP_NOTICE_TEMPLATE: z.string().default('aviso_residencial'),
    WHATSAPP_REMINDER_TEMPLATE: z.string().default('recordatorio_pago'),

    // Pagos
    ECARTPAY_MODE: z.enum(['mock', 'live']).default('mock'),
    ECARTPAY_API_URL: z.url().default('https://sandbox.ecartpay.com/api'),
    ECARTPAY_PUBLIC_KEY: z.string().optional(),
    ECARTPAY_PRIVATE_KEY: z.string().optional(),
    ECARTPAY_WEBHOOK_SECRET: z.string().optional(),
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV !== 'production') return;
    const required = (key, why) => !c[key] && ctx.addIssue({ code: 'custom', path: [key], message: `Obligatorio en producción: ${why}` });
    if (c.ACCESS_SECRET.startsWith('dev-only'))
      ctx.addIssue({ code: 'custom', path: ['ACCESS_SECRET'], message: 'Define una clave propia en producción.' });
    if (c.SEED_DEMO) ctx.addIssue({ code: 'custom', path: ['SEED_DEMO'], message: 'No cargues datos de demostración en producción.' });
    if (c.MESSAGING_PROVIDER === 'live') {
      required('RESEND_API_KEY', 'envío de correos');
      required('WHATSAPP_TOKEN', 'envío de WhatsApp');
      required('WHATSAPP_PHONE_NUMBER_ID', 'envío de WhatsApp');
      required('WHATSAPP_APP_SECRET', 'validar los mensajes que llegan de WhatsApp');
      required('WHATSAPP_VERIFY_TOKEN', 'registrar el webhook de WhatsApp');
    }
    if (c.ECARTPAY_MODE === 'live') {
      required('ECARTPAY_PRIVATE_KEY', 'cobros con Ecart Pay');
      required('ECARTPAY_WEBHOOK_SECRET', 'validar los avisos de Ecart Pay');
    }
  });

export function loadConfig(env = process.env) {
  // Una variable vacía (`CLAVE=`) cuenta como no definida y toma su valor por defecto
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')));
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida:\n${lines}`);
  }
  const c = parsed.data;
  return {
    ...c,
    isProd: c.NODE_ENV === 'production',
    isTest: c.NODE_ENV === 'test',
    cookieSecure: c.COOKIE_SECURE ?? c.NODE_ENV === 'production',
    corsOrigins: [
      c.APP_URL,
      ...c.CORS_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ],
  };
}
