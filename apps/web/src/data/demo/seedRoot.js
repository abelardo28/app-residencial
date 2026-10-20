// Estado inicial del modo demo: los datos de ejemplo compartidos + credenciales simuladas en el navegador.
import { DEMO_INVITE, seedCompany, seedSecondTenant, seedTenant } from '@residencial/shared/demo';
import { DEMO_AUTH, DEMO_INVITE_HASHES } from './credentials';
import { templates } from './messages';
import { demoSign } from './sign';

const h = (hours) => new Date(Date.now() + hours * 3600e3).toISOString();
const active = (id) => ({
  status: 'active',
  ...DEMO_AUTH[id],
  failed: 0,
  lockedUntil: null,
  sessionVersion: 1,
  passwordChangedAt: h(-30 * 24),
});
const pendingInvite = () => ({
  status: 'pending',
  failed: 0,
  lockedUntil: null,
  sessionVersion: 1,
  invite: { purpose: 'activate', ...DEMO_INVITE_HASHES, expiresAt: h(48), attempts: 0, createdAt: h(-1) },
});
const withAuth = (tenant) => ({
  ...tenant,
  users: tenant.users.map((u) => ({ vehicles: [], ...u, auth: u.id === DEMO_INVITE.userId ? pendingInvite() : active(u.id) })),
});

export function seedRoot() {
  const company = seedCompany();
  const t1 = withAuth(seedTenant({ sign: demoSign }));
  const mariana = t1.users.find((u) => u.id === DEMO_INVITE.userId);
  const outbox = templates.invite({
    user: mariana,
    org: t1.settings.name,
    token: DEMO_INVITE.token,
    code: DEMO_INVITE.code,
    purpose: 'activate',
  });
  return {
    version: 2,
    platform: {
      company: company.company,
      staff: company.staff.map((s) => ({ ...s, auth: active(s.id) })),
      plans: company.plans,
      residencias: company.residencias,
      invoices: company.invoices,
      billing: [],
      audit: [
        {
          id: 'au_seed',
          at: h(-1),
          tenantId: 't1',
          actor: 'Laura Méndez',
          action: 'Usuario creado',
          target: mariana.name,
          severity: 'info',
        },
      ],
      outbox,
      mfa: {},
    },
    tenants: { t1, t2: withAuth(seedSecondTenant()) },
  };
}
