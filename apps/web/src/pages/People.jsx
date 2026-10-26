import { useState } from 'react';
import { Plus, Search, ChevronRight, ShieldCheck, Home } from 'lucide-react';
import { useStore, unitLabel } from '../data/store';
import { initials } from '../lib/utils';
import { Badge, Button, Card, CardHead, PageHead, Tabs } from '../components/ui';
import { AccountBadge, AccountModal, AuditList, InviteModal, ROLE_NAME } from '../components/Accounts';
import { ledger } from '@residencial/shared';
import Units, { byLabel } from '../components/Units';

export default function People() {
  const { db, me, root, session, actions } = useStore();
  const [tab, setTab] = useState('resident');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(null);
  const tenantId = session.tenantId;
  const term = q.trim().toLowerCase();
  const list = db.users
    .filter((u) => u.role === tab)
    .filter((u) => !term || [u.name, u.email, unitLabel(db, u.unitId)].some((s) => s?.toLowerCase().includes(term)));
  const pending = db.users.filter((u) => u.auth?.status === 'pending' || u.auth?.status === 'reset').length;
  const audit = root.platform.audit.filter((e) => e.tenantId === tenantId).slice(0, 80);
  const openUser = open && db.users.find((u) => u.id === open);

  return (
    <>
      <PageHead
        title="Residentes y personal"
        subtitle="Tú creas las cuentas; cada persona recibe su invitación por correo y WhatsApp."
        fab={
          !['audit', 'units'].includes(tab) ? { icon: <Plus size={18} />, label: 'Nuevo usuario', onClick: () => setAdding(true) } : null
        }
      >
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus size={16} /> Nuevo usuario
        </Button>
      </PageHead>
      <div className="row" style={{ marginBottom: 16, gap: 10 }}>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            ...Object.entries(ROLE_NAME).map(([value]) => ({
              value,
              label: { resident: 'Residentes', guard: 'Vigilantes', admin: 'Administradores' }[value],
              count: db.users.filter((u) => u.role === value).length,
            })),
            { value: 'units', label: 'Domicilios', icon: <Home size={14} />, count: db.units.length },
            { value: 'audit', label: 'Seguridad', icon: <ShieldCheck size={14} /> },
          ]}
        />
        {pending > 0 && <Badge tone="warn">{pending} por activar</Badge>}
      </div>

      {tab === 'units' ? (
        <Units />
      ) : tab === 'audit' ? (
        <Card>
          <CardHead title="Actividad de seguridad" subtitle="Inicios de sesión, intentos fallidos, invitaciones y cambios de cuentas." />
          <AuditList items={audit} />
        </Card>
      ) : (
        <Card>
          <div className="input-wrap" style={{ marginBottom: 12 }}>
            <Search size={16} className="input-icon" />
            <input
              className="input with-icon"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre, correo o domicilio"
            />
          </div>
          {list.length === 0 && <div className="empty">Sin resultados.</div>}
          <div className="list cols-lg">
            {list.map((u) => {
              const debt = u.role === 'resident' && ledger(db, u.unitId).some((x) => x.state === 'overdue');
              return (
                <button key={u.id} className="list-item wrap clickable" onClick={() => setOpen(u.id)}>
                  <div className="avatar">{initials(u.name)}</div>
                  <div className="grow">
                    <div className="title">
                      {u.name}
                      {u.id === me.id && <span className="faint"> (tú)</span>}
                    </div>
                    <div className="faint">
                      {u.role === 'resident' ? `${unitLabel(db, u.unitId)} · ` : u.shift ? `Turno ${u.shift} · ` : ''}
                      {u.email}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <AccountBadge user={u} />
                    {u.role === 'resident' && u.auth?.status === 'active' && (
                      <Badge tone={debt ? 'bad' : 'ok'}>{debt ? 'Con adeudo' : 'Al corriente'}</Badge>
                    )}
                    <ChevronRight size={16} className="faint hide-sm" />
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      )}
      {adding && (
        <InviteModal
          tenantId={tenantId}
          units={[...db.units].sort(byLabel)}
          onAddUnit={actions.saveUnit}
          defaultRole={['audit', 'units'].includes(tab) ? 'resident' : tab}
          onClose={() => setAdding(false)}
        />
      )}
      {openUser && (
        <AccountModal
          tenantId={tenantId}
          user={openUser}
          selfId={me.id}
          unitText={openUser.role === 'resident' ? unitLabel(db, openUser.unitId) : openUser.shift}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
