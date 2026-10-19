// Datos de demostración (los mismos que usa el modo demo de la APP). Nunca en producción.
import { DEMO_COMPANY_PASSWORD, DEMO_INVITE, DEMO_PASSWORD, seedCompany, seedSecondTenant, seedTenant } from '@residencial/shared/demo';
import { hashPassword, passSigner, sha256 } from '../lib/crypto.js';
import { COLLECTIONS } from '../repositories/tenants.js';
import { transaction } from './database.js';

/** Carga la demo si la base está vacía. Devuelve `true` si cargó datos. */
export async function seedDemo(repos, config) {
  const { db, accounts, tenants, platform } = repos;
  if (tenants.list().length) return false;

  const company = seedCompany();
  const data = { t1: seedTenant({ sign: passSigner(config.ACCESS_SECRET) }), t2: seedSecondTenant() };
  const now = new Date().toISOString();
  const allUsers = [...company.staff, ...Object.values(data).flatMap((t) => t.users)];
  const hashes = new Map();
  for (const u of allUsers) if (u.id !== DEMO_INVITE.userId) hashes.set(u.id, await hashPassword(u.role === 'owner' ? DEMO_COMPANY_PASSWORD : DEMO_PASSWORD));

  transaction(db, () => {
    company.plans.forEach(platform.savePlan);
    for (const s of company.staff) {
      accounts.create({ ...s, scope: 'platform', status: 'active', passwordHash: hashes.get(s.id), passwordChangedAt: now, createdAt: now });
    }
    for (const r of company.residencias) {
      const t = data[r.id];
      tenants.create({ ...r, settings: t.settings });
      for (const c of COLLECTIONS) tenants.insertMany(r.id, c, t[c]);
      for (const u of t.users) {
        const pending = u.id === DEMO_INVITE.userId;
        accounts.create({
          id: u.id, scope: 'tenant', tenantId: r.id, email: u.email, name: u.name, phone: u.phone, role: u.role,
          profile: { unitId: u.unitId, vehicles: u.vehicles || [], shift: u.shift },
          status: pending ? 'pending' : 'active', passwordHash: hashes.get(u.id) ?? null, passwordChangedAt: pending ? null : now, createdAt: now,
        });
      }
    }
    company.invoices.forEach(platform.createInvoice);
    // Invitación de ejemplo (Mariana López): el enlace y el código aparecen en el buzón de desarrollo.
    accounts.saveInvite({
      userId: DEMO_INVITE.userId, purpose: 'activate', tokenHash: sha256(DEMO_INVITE.token), codeHash: sha256(`${DEMO_INVITE.userId}:${DEMO_INVITE.code}`),
      expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(), createdAt: now,
    });
    platform.audit({ action: 'Datos de demostración cargados' });
  });
  return true;
}
