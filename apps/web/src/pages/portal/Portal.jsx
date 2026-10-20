import { useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Building2,
  LayoutDashboard,
  Receipt,
  Layers,
  ScrollText,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  ChevronRight,
  ArrowLeft,
  Ban,
  PlayCircle,
  Bell,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Users,
  Wallet,
  Search,
  Eye,
  FileText,
} from 'lucide-react';
import { useStore } from '../../data/store';
import { money, monthLabel, monthKey, fmtDate, initials, timeAgo } from '../../lib/utils';
import { Badge, Button, Card, CardHead, Chips, Field, Modal, PageHead, Stat, Tabs } from '../../components/ui';
import { AccountBadge, AccountModal, AuditList, InviteModal, ROLE_NAME } from '../../components/Accounts';
import { DemoOutboxButton } from '../../components/DemoOutbox';
import { INVOICE_STATE } from '../../components/Subscription';
import { invoiceState } from '@residencial/shared';

const INV = INVOICE_STATE;
const METHODS = { transfer: 'Transferencia', cash: 'Efectivo', card: 'Tarjeta', ecartpay: 'Ecart Pay' };
const PLURAL = { resident: 'Residentes', guard: 'Vigilantes', admin: 'Administradores' };
const RES_STATUS = { active: ['Activo', 'ok'], suspended: ['Suspendido', 'bad'] };

export default function PortalRoutes() {
  return (
    <Routes>
      <Route element={<PortalLayout />}>
        <Route index element={<Overview />} />
        <Route path="residencias" element={<Residencias />} />
        <Route path="residencias/:id" element={<ResidencialDetail />} />
        <Route path="cobranza" element={<Billing />} />
        <Route path="planes" element={<Plans />} />
        <Route path="auditoria" element={<Audit />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

const LINKS = [
  ['/', 'Resumen', LayoutDashboard],
  ['/residencias', 'Residencias', Building2],
  ['/cobranza', 'Cobranza', Receipt],
  ['/planes', 'Planes', Layers],
  ['/auditoria', 'Auditoría', ScrollText],
];

function PortalLayout() {
  const { root, staffMe, actions, toasts } = useStore();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => window.scrollTo(0, 0), [loc.pathname]);
  const overdue = root.platform.invoices.filter((i) => ['overdue', 'review'].includes(invoiceState(i))).length;
  const current = LINKS.find(([to]) => (to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to)));
  return (
    <div className="shell portal-shell">
      {open && <div className="sidebar-overlay" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
        <div className="brand">
          <div className="brand-mark">
            <Building2 size={18} />
          </div>
          <div>
            <b>{root.platform.company.name}</b>
            <small>Portal de empresa</small>
          </div>
        </div>
        <nav className="nav">
          <div className="nav-section">Operación</div>
          {LINKS.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              <Icon size={18} strokeWidth={1.8} />
              {label}
              {to === '/cobranza' && overdue ? <span className="count">{overdue}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div style={{ flex: 1 }} />
        <div className="row card flat" style={{ padding: 10, gap: 10 }}>
          <div className="avatar">{initials(staffMe.name)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500 }}>{staffMe.name}</div>
            <div className="faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {staffMe.email}
            </div>
          </div>
          <button className="btn ghost icon-btn" title="Cerrar sesión" aria-label="Cerrar sesión" onClick={actions.logout}>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn ghost icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Menú">
            <Menu size={19} />
          </button>
          <div className="topbar-title show-sm">{current?.[1] || 'Portal'}</div>
          <div className="faint hide-sm">
            Portal de empresa · {new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <div className="spacer" />
          <DemoOutboxButton />
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Navegación del portal">
        {LINKS.slice(0, 4).map(([to, label, Icon]) => (
          <NavLink key={to} to={to} end={to === '/'}>
            <Icon size={21} strokeWidth={1.8} />
            {label}
            {to === '/cobranza' && overdue ? <span className="count">{overdue}</span> : null}
          </NavLink>
        ))}
        <button onClick={() => setOpen(true)}>
          <MoreHorizontal size={21} strokeWidth={1.8} />
          Más
        </button>
      </nav>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast" style={t.tone === 'bad' ? { borderColor: 'var(--bad)' } : null}>
            <b>{t.title}</b>
            <span className="muted">{t.body}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Datos combinados de cada residencial
function useResidencias() {
  const { root } = useStore();
  return useMemo(
    () =>
      root.platform.residencias.map((r) => {
        const t = root.tenants[r.id];
        const inv = root.platform.invoices.filter((i) => i.tenantId === r.id);
        const plan = root.platform.plans.find((p) => p.id === r.plan);
        return {
          ...r,
          plan,
          tenant: t,
          units: t?.units.length || 0,
          users: t?.users.length || 0,
          admins: t?.users.filter((u) => u.role === 'admin') || [],
          debt: inv.filter((i) => i.status === 'pending').reduce((s, i) => s + i.amount, 0),
          overdue: inv.some((i) => invoiceState(i) === 'overdue'),
        };
      }),
    [root],
  );
}

function Overview() {
  const { root } = useStore();
  const list = useResidencias();
  const nav = useNavigate();
  const m = monthKey();
  const inv = root.platform.invoices;
  const active = list.filter((r) => r.status === 'active');
  const mrr = active.reduce((s, r) => s + (r.plan?.price || 0), 0);
  const collected = inv.filter((i) => i.status === 'paid' && i.paidAt?.slice(0, 7) === m).reduce((s, i) => s + i.amount, 0);
  const due = inv.filter((i) => i.status === 'pending');
  const overdue = due.filter((i) => invoiceState(i) === 'overdue');
  const name = (id) => root.platform.residencias.find((r) => r.id === id)?.name;
  const audit = root.platform.audit.slice(0, 8).map((e) => ({ ...e, tenantName: name(e.tenantId) }));

  return (
    <>
      <PageHead title="Resumen" subtitle="Estado de tus residencias y de la cobranza de suscripciones." />
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Stat
          icon={<Building2 size={15} />}
          label="Residencias activas"
          value={active.length}
          sub={`${list.length - active.length} suspendida(s)`}
        />
        <Stat icon={<Wallet size={15} />} label="Ingreso mensual" value={money(mrr)} sub="Suscripciones activas" />
        <Stat icon={<CheckCircle2 size={15} />} label={`Cobrado en ${monthLabel(m)}`} value={money(collected)} />
        <Stat
          icon={<AlertTriangle size={15} />}
          label="Por cobrar"
          value={money(due.reduce((s, i) => s + i.amount, 0))}
          sub={`${overdue.length} vencido(s)`}
        />
      </div>
      <div className="g-dash">
        <Card>
          <CardHead title="Residencias" subtitle="Toca una para administrarla.">
            <Button size="sm" onClick={() => nav('/residencias')}>
              Ver todas
            </Button>
          </CardHead>
          <div className="list">
            {list.map((r) => (
              <ResRow key={r.id} r={r} />
            ))}
          </div>
        </Card>
        <Card>
          <CardHead title="Cobros pendientes">
            <Button size="sm" onClick={() => nav('/cobranza')}>
              Ir a cobranza
            </Button>
          </CardHead>
          {due.length === 0 ? (
            <div className="empty">Todo al corriente.</div>
          ) : (
            <div className="list">
              {due.map((i) => (
                <div key={i.id} className="list-item">
                  <div className="avatar">
                    <Receipt size={15} />
                  </div>
                  <div className="grow">
                    <div className="title">{name(i.tenantId)}</div>
                    <div className="faint">
                      {monthLabel(i.period)} · vence {fmtDate(i.dueDate + 'T12:00')}
                    </div>
                  </div>
                  <b>{money(i.amount)}</b>
                  <InvBadge i={i} />
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card style={{ gridColumn: '1 / -1' }}>
          <CardHead title="Actividad reciente">
            <Button size="sm" onClick={() => nav('/auditoria')}>
              Ver auditoría
            </Button>
          </CardHead>
          <AuditList items={audit} showTenant />
        </Card>
      </div>
    </>
  );
}

const InvBadge = ({ i }) => {
  const [l, t] = INV[invoiceState(i)];
  return <Badge tone={t}>{l}</Badge>;
};

function ResRow({ r }) {
  const nav = useNavigate();
  const [l, t] = RES_STATUS[r.status];
  return (
    <button className="list-item wrap clickable" onClick={() => nav(`/residencias/${r.id}`)}>
      <div className="avatar">
        <Building2 size={16} />
      </div>
      <div className="grow">
        <div className="title">{r.name}</div>
        <div className="faint">
          Plan {r.plan?.name} · {r.units} unidades · {r.users} usuarios
        </div>
      </div>
      <div className="row" style={{ gap: 6 }}>
        {r.debt > 0 && <Badge tone={r.overdue ? 'bad' : 'warn'}>Debe {money(r.debt)}</Badge>}
        <Badge tone={t}>{l}</Badge>
        <ChevronRight size={16} className="faint hide-sm" />
      </div>
    </button>
  );
}

function Residencias() {
  const list = useResidencias();
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const shown = list
    .filter((r) => filter === 'all' || (filter === 'debt' ? r.debt > 0 : r.status === filter))
    .filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHead
        title="Residencias"
        subtitle="Da de alta residenciales y gestiona sus cuentas."
        fab={{ icon: <Plus size={18} />, label: 'Nuevo residencial', onClick: () => setCreating(true) }}
      >
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> Nuevo residencial
        </Button>
      </PageHead>
      <div className="row" style={{ marginBottom: 14, gap: 10 }}>
        <Chips
          scroll
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Todas' },
            { value: 'active', label: 'Activas' },
            { value: 'suspended', label: 'Suspendidas' },
            { value: 'debt', label: 'Con adeudo' },
          ]}
        />
      </div>
      <Card>
        <div className="input-wrap" style={{ marginBottom: 12 }}>
          <Search size={16} className="input-icon" />
          <input className="input with-icon" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar residencial" />
        </div>
        {shown.length === 0 && <div className="empty">Sin resultados.</div>}
        <div className="list cols-lg">
          {shown.map((r) => (
            <ResRow key={r.id} r={r} />
          ))}
        </div>
      </Card>
      {creating && <CreateResidencial onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateResidencial({ onClose }) {
  const { root, platform, toast } = useStore();
  const nav = useNavigate();
  const [f, setF] = useState({
    name: '',
    address: '',
    plan: 'basic',
    unitCount: 20,
    unitPrefix: 'Casa',
    monthlyFee: 1200,
    adminName: '',
    adminEmail: '',
    adminPhone: '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const plan = root.platform.plans.find((p) => p.id === f.plan);
  async function submit() {
    if (!f.adminName.trim()) return setErr('Escribe el nombre del administrador.');
    if (Number(f.unitCount) > plan.maxUnits) return setErr(`El plan ${plan.name} permite hasta ${plan.maxUnits} unidades.`);
    setBusy(true);
    setErr('');
    try {
      const id = await platform.createResidencial({
        name: f.name,
        address: f.address,
        plan: f.plan,
        unitCount: f.unitCount,
        unitPrefix: f.unitPrefix,
        monthlyFee: f.monthlyFee,
        admin: { name: f.adminName.trim(), email: f.adminEmail, phone: f.adminPhone },
      });
      toast('Residencial creado', `${f.adminName} recibirá su invitación por correo y WhatsApp.`);
      onClose();
      nav(`/residencias/${id}`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Nuevo residencial"
      wide
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy ? 'Creando…' : 'Crear e invitar al administrador'}
        </Button>
      }
    >
      <div className="stack">
        <div className="grid g2">
          <Field label="Nombre">
            <input className="input" value={f.name} onChange={set('name')} autoFocus placeholder="Residencial…" />
          </Field>
          <Field label="Dirección">
            <input className="input" value={f.address} onChange={set('address')} />
          </Field>
        </div>
        <Field label="Plan">
          <Chips
            value={f.plan}
            onChange={set('plan')}
            options={root.platform.plans.map((p) => ({ value: p.id, label: `${p.name} · ${money(p.price)}/mes` }))}
          />
        </Field>
        <div className="grid g3">
          <Field label="Unidades" hint={`Máximo ${plan.maxUnits}`}>
            <input className="input" type="number" min="1" value={f.unitCount} onChange={set('unitCount')} />
          </Field>
          <Field label="Nombre de unidad">
            <Chips
              value={f.unitPrefix}
              onChange={set('unitPrefix')}
              options={['Casa', 'Depto', 'Lote', 'Torre'].map((v) => ({ value: v, label: v }))}
            />
          </Field>
          <Field label="Cuota de mantenimiento">
            <input className="input" type="number" min="0" value={f.monthlyFee} onChange={set('monthlyFee')} />
          </Field>
        </div>
        <div className="nav-section" style={{ padding: 0, marginTop: 4 }}>
          Administrador del residencial
        </div>
        <div className="grid g3">
          <Field label="Nombre">
            <input className="input" value={f.adminName} onChange={set('adminName')} />
          </Field>
          <Field label="Correo">
            <input className="input" type="email" value={f.adminEmail} onChange={set('adminEmail')} />
          </Field>
          <Field label="WhatsApp">
            <input className="input" type="tel" value={f.adminPhone} onChange={set('adminPhone')} placeholder="33 1234 5678" />
          </Field>
        </div>
        {err && <div className="banner bad">{err}</div>}
      </div>
    </Modal>
  );
}

function ResidencialDetail() {
  const { id } = useParams();
  const { root, platform, toast } = useStore();
  const nav = useNavigate();
  const r = useResidencias().find((x) => x.id === id);
  const [tab, setTab] = useState('users');
  const [inviting, setInviting] = useState(false);
  const [openUser, setOpenUser] = useState(null);
  const [suspending, setSuspending] = useState(false);
  if (!r) return <Navigate to="/residencias" replace />;
  const t = r.tenant;
  const invoices = root.platform.invoices.filter((i) => i.tenantId === id);
  const audit = root.platform.audit.filter((e) => e.tenantId === id);
  const user = openUser && t.users.find((u) => u.id === openUser);
  const [sl, st] = RES_STATUS[r.status];
  const counts = Object.keys(ROLE_NAME).map((role) => [role, t.users.filter((u) => u.role === role).length]);

  return (
    <>
      <button className="link-btn" onClick={() => nav('/residencias')} style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Residencias
      </button>
      <PageHead keep title={r.name} subtitle={r.address || 'Sin dirección'}>
        <Badge tone={st}>{sl}</Badge>
        {r.status === 'active' ? (
          <Button className="danger" onClick={() => setSuspending(true)}>
            <Ban size={15} /> Suspender servicio
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() => {
              platform.setResidencialStatus(id, 'active');
              toast('Servicio reactivado', 'Se avisó a los administradores.');
            }}
          >
            <PlayCircle size={15} /> Reactivar
          </Button>
        )}
      </PageHead>
      {r.status === 'suspended' && (
        <div className="banner bad" style={{ marginBottom: 14 }}>
          <Ban size={17} /> Nadie de este residencial puede iniciar sesión.{r.statusReason ? ` Motivo: ${r.statusReason}.` : ''}
        </div>
      )}
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Card className="stat">
          <div className="label">
            <Layers size={15} /> Plan
          </div>
          <select
            className="select"
            style={{ marginTop: 8 }}
            value={r.plan?.id}
            onChange={(e) => {
              platform.changePlan(id, e.target.value);
              toast('Plan actualizado', 'Aplica desde el siguiente cargo.');
            }}
          >
            {root.platform.plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {money(p.price)}
              </option>
            ))}
          </select>
          {r.units > (r.plan?.maxUnits || Infinity) && (
            <div className="sub" style={{ color: 'var(--bad)' }}>
              Excede {r.plan.maxUnits} unidades
            </div>
          )}
        </Card>
        <Stat icon={<Building2 size={15} />} label="Unidades" value={r.units} sub={`Cuota ${money(t.settings.monthlyFee)}`} />
        <Stat
          icon={<Users size={15} />}
          label="Usuarios"
          value={r.users}
          sub={counts.map(([role, n]) => `${n} ${(n === 1 ? ROLE_NAME[role] : PLURAL[role]).toLowerCase()}`).join(' · ')}
        />
        <Stat
          icon={<Receipt size={15} />}
          label="Adeudo"
          value={money(r.debt)}
          sub={r.overdue ? 'Tiene cargos vencidos' : 'Sin vencidos'}
        />
      </div>
      <div style={{ marginBottom: 14 }}>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'users', label: 'Cuentas', count: r.users },
            { value: 'billing', label: 'Suscripción' },
            { value: 'audit', label: 'Auditoría' },
          ]}
        />
      </div>
      {tab === 'users' && (
        <Card>
          <CardHead title="Cuentas del residencial" subtitle="Tú das de alta a los administradores; ellos crean residentes y vigilantes.">
            <Button size="sm" variant="primary" onClick={() => setInviting(true)}>
              <Plus size={15} /> Administrador
            </Button>
          </CardHead>
          <div className="list cols-lg">
            {[...t.users]
              .sort((a, b) => (a.role === 'admin' ? -1 : 0) - (b.role === 'admin' ? -1 : 0))
              .map((u) => (
                <button key={u.id} className="list-item wrap clickable" onClick={() => setOpenUser(u.id)}>
                  <div className="avatar">{initials(u.name)}</div>
                  <div className="grow">
                    <div className="title">{u.name}</div>
                    <div className="faint">
                      {ROLE_NAME[u.role]} · {u.email}
                      {u.auth?.lastLoginAt ? ` · ${timeAgo(u.auth.lastLoginAt)}` : ''}
                    </div>
                  </div>
                  <AccountBadge user={u} />
                </button>
              ))}
          </div>
        </Card>
      )}
      {tab === 'billing' && (
        <Card>
          <InvoiceList invoices={invoices} />
        </Card>
      )}
      {tab === 'audit' && (
        <Card>
          <AuditList items={audit} />
        </Card>
      )}
      {inviting && <InviteModal tenantId={id} roles={['admin']} onClose={() => setInviting(false)} />}
      {user && (
        <AccountModal
          tenantId={id}
          user={user}
          unitText={user.role === 'resident' ? t.units.find((x) => x.id === user.unitId)?.label : ''}
          onClose={() => setOpenUser(null)}
          allowDelete={user.role === 'admin' && r.admins.length > 1}
        />
      )}
      {suspending && <SuspendModal r={r} onClose={() => setSuspending(false)} />}
    </>
  );
}

function SuspendModal({ r, onClose }) {
  const { platform, toast } = useStore();
  const [reason, setReason] = useState(r.overdue ? 'Adeudo de suscripción' : '');
  return (
    <Modal
      title={`Suspender ${r.name}`}
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          className="danger"
          onClick={() => {
            platform.setResidencialStatus(r.id, 'suspended', reason.trim());
            toast('Servicio suspendido', 'Se cerraron las sesiones y se avisó a los administradores.');
            onClose();
          }}
        >
          Suspender
        </Button>
      }
    >
      <div className="stack">
        <p className="muted">
          Todas las cuentas del residencial (administración, vigilancia y residentes) dejarán de poder entrar hasta que lo reactives. Los
          datos se conservan.
        </p>
        <Field label="Motivo" hint="Se incluye en el aviso a los administradores">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function InvoiceList({ invoices, showName }) {
  const { root, platform, toast } = useStore();
  const [paying, setPaying] = useState(null);
  const [reviewing, setReviewing] = useState(null);
  const name = (id) => root.platform.residencias.find((r) => r.id === id)?.name;
  const autopay = (id) => root.platform.billing?.find((b) => b.tenantId === id && b.autopay);
  const sorted = [...invoices].sort((a, b) => b.period.localeCompare(a.period));
  if (!sorted.length) return <div className="empty">Sin cargos.</div>;
  return (
    <>
      <div className="list cols-lg">
        {sorted.map((i) => {
          const st = invoiceState(i);
          return (
            <div key={i.id} className="list-item wrap">
              <div className="avatar">
                <Receipt size={15} />
              </div>
              <div className="grow">
                <div className="title">
                  {showName ? name(i.tenantId) : `Suscripción ${monthLabel(i.period)}`}
                  {i.status === 'pending' && autopay(i.tenantId) && (
                    <Badge tone="info" style={{ marginLeft: 6 }}>
                      Cobro automático
                    </Badge>
                  )}
                </div>
                <div className="faint">
                  {showName ? `${monthLabel(i.period)} · ` : ''}
                  {i.status === 'paid'
                    ? `Pagado ${fmtDate(i.paidAt)} · ${METHODS[i.method] || i.method}${i.reference ? ` · ${i.reference}` : ''}`
                    : st === 'review'
                      ? `Comprobante enviado por ${i.review.by} el ${fmtDate(i.review.submittedAt)}`
                      : `Vence ${fmtDate(i.dueDate + 'T12:00')}${i.review?.rejectedAt ? ' · comprobante rechazado' : ''}`}
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <b>{money(i.amount)}</b>
                <InvBadge i={i} />
                {st === 'review' && (
                  <Button size="sm" variant="primary" onClick={() => setReviewing(i)}>
                    <Eye size={14} /> Revisar comprobante
                  </Button>
                )}
                {(st === 'pending' || st === 'overdue') && (
                  <>
                    <Button size="sm" variant="primary" onClick={() => setPaying(i)}>
                      <CheckCircle2 size={14} /> Registrar pago
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        platform.remindInvoice(i.id);
                        toast('Recordatorio enviado', 'Se avisó a los administradores por correo y en la app.');
                      }}
                      title="Enviar recordatorio"
                    >
                      <Bell size={14} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="danger"
                      onClick={() => confirm('¿Cancelar este cargo?') && platform.cancelInvoice(i.id)}
                      title="Cancelar cargo"
                    >
                      <XCircle size={14} />
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {paying && <PayModal inv={paying} onClose={() => setPaying(null)} />}
      {reviewing && <ReviewModal inv={reviewing} name={name(reviewing.tenantId)} onClose={() => setReviewing(null)} />}
    </>
  );
}

/** Comprobante de transferencia enviado por el administrador del residencial. */
function ReviewModal({ inv, name, onClose }) {
  const { platform, toast } = useStore();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const isPdf = inv.review.receipt?.startsWith('data:application/pdf');
  const done = (p, msg) =>
    p.then(
      () => {
        toast(...msg);
        onClose();
      },
      () => {},
    );
  return (
    <Modal
      title={`${name} · ${monthLabel(inv.period)}`}
      onClose={onClose}
      footer={
        rejecting ? (
          <>
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              Volver
            </Button>
            <Button
              variant="danger"
              disabled={!reason.trim()}
              onClick={() => done(platform.rejectTransfer(inv.id, reason.trim()), ['Comprobante rechazado', 'Se avisó al administrador.'])}
            >
              Rechazar
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" className="danger" onClick={() => setRejecting(true)}>
              Rechazar
            </Button>
            <Button
              variant="primary"
              onClick={() => done(platform.approveTransfer(inv.id), ['Pago aprobado', `${money(inv.amount)} · ${name}`])}
            >
              <CheckCircle2 size={15} /> Aprobar {money(inv.amount)}
            </Button>
          </>
        )
      }
    >
      <div className="stack">
        <div className="kv">
          <div>
            Referencia <span className="mono">{inv.review.reference || '—'}</span>
          </div>
          <div>
            Enviado por {inv.review.by} el {fmtDate(inv.review.submittedAt)}
          </div>
        </div>
        {isPdf ? (
          <a className="btn" href={inv.review.receipt} download={`comprobante-${inv.period}.pdf`}>
            <FileText size={15} /> Descargar comprobante (PDF)
          </a>
        ) : (
          <img className="receipt-view" src={inv.review.receipt} alt="Comprobante de la transferencia" />
        )}
        {rejecting && (
          <Field label="Motivo" hint="Lo verá el administrador para enviar otro comprobante">
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="No se ve el monto, otra cuenta…"
              autoFocus
            />
          </Field>
        )}
      </div>
    </Modal>
  );
}

function PayModal({ inv, onClose }) {
  const { platform, toast } = useStore();
  const [method, setMethod] = useState('transfer');
  const [reference, setReference] = useState('');
  return (
    <Modal
      title={`Registrar pago · ${monthLabel(inv.period)}`}
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          onClick={() => {
            platform.payInvoice(inv.id, { method, reference: reference.trim() });
            toast('Pago registrado', money(inv.amount));
            onClose();
          }}
        >
          Confirmar {money(inv.amount)}
        </Button>
      }
    >
      <div className="stack">
        <Field label="Método">
          <Chips value={method} onChange={setMethod} options={Object.entries(METHODS).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Referencia o folio">
          <input
            className="input mono"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="SPEI, folio, recibo…"
          />
        </Field>
      </div>
    </Modal>
  );
}

function Billing() {
  const { root, platform, toast } = useStore();
  const [tab, setTab] = useState('due');
  const [days, setDays] = useState(15);
  const inv = root.platform.invoices.filter((i) =>
    tab === 'all' ? true : tab === 'due' ? i.status === 'pending' : invoiceState(i) === tab,
  );
  const m = monthKey();
  const generate = () =>
    platform.generateInvoices(m).then(
      (n) =>
        toast(
          n ? `${n} cargo(s) generado(s)` : 'Sin cargos nuevos',
          n ? monthLabel(m) : 'Todas las residencias activas ya tienen cargo este mes.',
        ),
      () => {},
    );
  return (
    <>
      <PageHead
        title="Cobranza"
        subtitle="Suscripciones mensuales de cada residencial."
        fab={{
          icon: <Plus size={18} />,
          label: `Generar ${monthLabel(m)}`,
          onClick: () => {
            generate();
          },
        }}
      >
        <Button
          onClick={() => {
            generate();
          }}
        >
          <Plus size={15} /> Generar cargos de {monthLabel(m)}
        </Button>
      </PageHead>
      <Card style={{ marginBottom: 16 }}>
        <div className="row between" style={{ gap: 12 }}>
          <div style={{ flex: '1 1 260px' }}>
            <b>Suspensión por adeudo</b>
            <p className="faint">
              Suspende los residenciales con cargos vencidos hace más de los días indicados. Se avisa a sus administradores.
            </p>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <select className="select" style={{ width: 'auto' }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[0, 5, 15, 30, 60].map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? 'Cualquier vencido' : `Más de ${d} días`}
                </option>
              ))}
            </select>
            <Button
              className="danger"
              onClick={() => {
                if (!confirm('¿Suspender los residenciales con adeudo vencido?')) return;
                platform.suspendOverdue(days).then(
                  (n) => toast(n ? `${n} residencial(es) suspendido(s)` : 'Ninguno cumple la condición', ''),
                  () => {},
                );
              }}
            >
              <Ban size={15} /> Suspender morosos
            </Button>
          </div>
        </div>
      </Card>
      <div style={{ marginBottom: 14 }}>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            {
              value: 'due',
              label: 'Por cobrar',
              count: root.platform.invoices.filter((i) => i.status === 'pending').length,
            },
            {
              value: 'review',
              label: 'Por revisar',
              count: root.platform.invoices.filter((i) => invoiceState(i) === 'review').length,
            },
            { value: 'overdue', label: 'Vencidos' },
            { value: 'paid', label: 'Pagados' },
            { value: 'all', label: 'Todos' },
          ]}
        />
      </div>
      <Card>
        <InvoiceList invoices={inv} showName />
      </Card>
    </>
  );
}

function Plans() {
  const { root, platform, toast } = useStore();
  const [edit, setEdit] = useState(null);
  const usage = (id) => root.platform.residencias.filter((r) => r.plan === id).length;
  return (
    <>
      <PageHead title="Planes" subtitle="Precio mensual y límites de cada plan. Los cambios aplican a los siguientes cargos." />
      <div className="grid g3">
        {root.platform.plans.map((p) => (
          <Card key={p.id} className="plan-card">
            <div className="row between">
              <h3>{p.name}</h3>
              <Badge>{usage(p.id)} residencia(s)</Badge>
            </div>
            <div className="plan-price">
              {money(p.price)}
              <span className="faint"> / mes</span>
            </div>
            <div className="faint">Hasta {p.maxUnits} unidades</div>
            <ul className="pw-rules" style={{ margin: '12px 0' }}>
              {p.features.map((f) => (
                <li key={f} className="ok">
                  <CheckCircle2 size={13} /> {f}
                </li>
              ))}
            </ul>
            <Button size="sm" onClick={() => setEdit({ ...p })}>
              Editar
            </Button>
          </Card>
        ))}
      </div>
      {edit && (
        <Modal
          title={`Plan ${edit.name}`}
          onClose={() => setEdit(null)}
          footer={
            <Button
              variant="primary"
              onClick={() => {
                platform.updatePlan(edit.id, { price: Number(edit.price) || 0, maxUnits: Number(edit.maxUnits) || 1 });
                toast('Plan actualizado', '');
                setEdit(null);
              }}
            >
              Guardar
            </Button>
          }
        >
          <div className="grid g2">
            <Field label="Precio mensual">
              <input
                className="input"
                type="number"
                min="0"
                value={edit.price}
                onChange={(e) => setEdit({ ...edit, price: e.target.value })}
              />
            </Field>
            <Field label="Unidades máximas">
              <input
                className="input"
                type="number"
                min="1"
                value={edit.maxUnits}
                onChange={(e) => setEdit({ ...edit, maxUnits: e.target.value })}
              />
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}

function Audit() {
  const { root } = useStore();
  const [tenant, setTenant] = useState('all');
  const [sev, setSev] = useState('all');
  const [q, setQ] = useState('');
  const name = (id) => root.platform.residencias.find((r) => r.id === id)?.name || (id ? '' : 'Empresa');
  const items = root.platform.audit
    .filter((e) => tenant === 'all' || (tenant === 'platform' ? !e.tenantId : e.tenantId === tenant))
    .filter((e) => sev === 'all' || (sev === 'alerts' ? e.severity !== 'info' : true))
    .filter((e) => !q || [e.action, e.actor, e.target].some((s) => s?.toLowerCase().includes(q.toLowerCase())))
    .slice(0, 200)
    .map((e) => ({ ...e, tenantName: name(e.tenantId) }));
  return (
    <>
      <PageHead title="Auditoría" subtitle="Registro de inicios de sesión, intentos fallidos, cambios de cuentas y operaciones." />
      <Card>
        <div className="row" style={{ gap: 10, marginBottom: 12 }}>
          <select
            className="select"
            style={{ width: 'auto', flex: '1 1 200px' }}
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
          >
            <option value="all">Todas las residencias</option>
            <option value="platform">Sólo empresa</option>
            {root.platform.residencias.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <Chips
            value={sev}
            onChange={setSev}
            options={[
              { value: 'all', label: 'Todo' },
              { value: 'alerts', label: 'Sólo alertas' },
            ]}
          />
          <div className="input-wrap" style={{ flex: '2 1 240px' }}>
            <Search size={16} className="input-icon" />
            <input className="input with-icon" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar acción, persona…" />
          </div>
        </div>
        <AuditList items={items} showTenant />
      </Card>
    </>
  );
}

export { InvoiceList };
