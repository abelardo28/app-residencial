import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Home,
  QrCode,
  ShieldCheck,
  Wallet,
  Megaphone,
  Bell,
  CalendarDays,
  Wrench,
  Package,
  Vote,
  PieChart,
  Users,
  LogOut,
  Menu,
  Siren,
  DoorOpen,
  Settings,
  MoreHorizontal,
  Cpu,
} from 'lucide-react';
import { useStore, unitLabel } from '../data/store';
import NotificationsPanel from './NotificationsPanel';
import SosButton from './SosButton';
import { DemoOutboxButton } from './DemoOutbox';
import { WhatsappSimButton } from './WhatsappSim';
import InstallApp from './InstallApp';
import { initials } from '../lib/utils';
import { coverOf } from '../lib/cover';

const ROLE_LABEL = { admin: 'Administración', guard: 'Vigilancia', resident: 'Residente' };

export default function Layout() {
  const { db, me, actions, toasts, root, session } = useStore();
  const cover = coverOf(db.settings);
  const address = root.platform.residencias.find((r) => r.id === session.tenantId)?.address;
  const [open, setOpen] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => window.scrollTo(0, 0), [loc.pathname, me.id]);

  const unread = db.notifications.filter((n) => n.userId === me.id && !n.read).length;
  const pendingPays = db.payments.filter((p) => p.status === 'pending').length;
  const waitingPk = db.packages.filter((p) => p.status === 'waiting' && (me.role !== 'resident' || p.unitId === me.unitId)).length;
  const openInc = db.incidents.filter((i) => i.status !== 'resuelta').length;
  const unreadNotices = db.notices.filter((n) => !n.readBy.includes(me.id) && me.role !== 'admin').length;

  const items = {
    resident: [
      [
        'Principal',
        [
          ['/', 'Inicio', Home],
          ['/pases', 'Mis pases de acceso', QrCode],
          ['/accesos', 'Historial de visitas', DoorOpen],
          ['/pagos', 'Pagos', Wallet],
          ['/avisos', 'Avisos', Megaphone, unreadNotices],
        ],
      ],
      [
        'Comunidad',
        [
          ['/reservas', 'Reservar áreas', CalendarDays],
          ['/reportes', 'Reportes', Wrench],
          ['/paquetes', 'Paquetería', Package, waitingPk],
          ['/votaciones', 'Votaciones', Vote],
          ['/finanzas', 'Transparencia', PieChart],
        ],
      ],
    ],
    guard: [
      [
        'Caseta',
        [
          ['/', 'Control de acceso', ShieldCheck],
          ['/accesos', 'Bitácora de accesos', DoorOpen],
          ['/paquetes', 'Paquetería', Package, waitingPk],
          ['/avisos', 'Avisos', Megaphone, unreadNotices],
        ],
      ],
    ],
    admin: [
      [
        'Gestión',
        [
          ['/', 'Panel', Home],
          ['/pagos', 'Pagos', Wallet, pendingPays],
          ['/avisos', 'Avisos', Megaphone],
          ['/accesos', 'Bitácora de accesos', DoorOpen],
          ['/usuarios', 'Residentes y personal', Users],
        ],
      ],
      [
        'Comunidad',
        [
          ['/reservas', 'Reservaciones', CalendarDays],
          ['/reportes', 'Reportes', Wrench, openInc],
          ['/paquetes', 'Paquetería', Package],
          ['/votaciones', 'Votaciones', Vote],
          ['/finanzas', 'Finanzas', PieChart],
          ['/caseta', 'Caseta física', Cpu],
          ['/configuracion', 'Configuración', Settings],
        ],
      ],
    ],
  }[me.role];

  const activeSos = db.sos.filter((s) => s.status === 'active');

  // Accesos rápidos de la barra inferior en celular (el resto queda en "Más")
  const quick = {
    resident: ['/', '/pases', '/pagos', '/avisos'],
    guard: ['/', '/accesos', '/paquetes', '/avisos'],
    admin: ['/', '/pagos', '/avisos', '/accesos'],
  }[me.role];
  const allLinks = items.flatMap(([, links]) => links);
  const short = {
    '/': me.role === 'guard' ? 'Caseta' : 'Inicio',
    '/pases': 'Pases',
    '/pagos': 'Pagos',
    '/avisos': 'Avisos',
    '/accesos': me.role === 'guard' ? 'Bitácora' : 'Accesos',
    '/paquetes': 'Paquetes',
  };
  const current = allLinks.find(([to]) => (to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to)));

  return (
    <div className="shell">
      {open && <div className="sidebar-overlay" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
        <div className="brand">
          <div className="brand-mark">
            <Home size={18} />
          </div>
          <div>
            <b>{db.settings.name}</b>
            <small>{ROLE_LABEL[me.role]}</small>
          </div>
        </div>
        {items.map(([section, links]) => (
          <nav className="nav" key={section}>
            <div className="nav-section">{section}</div>
            {links.map(([to, label, Icon, count]) => (
              <NavLink key={to} to={to} end={to === '/'}>
                <Icon size={18} strokeWidth={1.8} />
                {label}
                {count ? <span className="count">{count}</span> : null}
              </NavLink>
            ))}
          </nav>
        ))}
        <div style={{ flex: 1 }} />
        <InstallApp className="block" />
        <div className="row card flat" style={{ padding: 10, gap: 10 }}>
          <div className="avatar">{initials(me.name)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500 }}>{me.name}</div>
            <div className="faint">{me.role === 'resident' ? unitLabel(db, me.unitId) : ROLE_LABEL[me.role]}</div>
          </div>
          <button
            className="btn ghost icon-btn"
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
            onClick={() => {
              actions.logout();
              nav('/');
            }}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <div className={`main ${cover ? 'has-cover' : ''}`}>
        {cover && (
          <div className="cover" aria-hidden="true">
            <img src={cover} alt="" />
          </div>
        )}
        <header className="topbar">
          <button className="btn ghost icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Menú">
            <Menu size={19} />
          </button>
          <div className="topbar-title show-sm">{current?.[1] || db.settings.name}</div>
          <div className="faint hide-sm">{new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <div className="spacer" />
          {me.role === 'admin' && <DemoOutboxButton />}
          <WhatsappSimButton />
          {me.role === 'resident' && <SosButton />}
          <button className="btn icon-btn" onClick={() => setShowNotifs(true)} aria-label="Notificaciones">
            <Bell size={18} />
            {unread > 0 && <span className="dot">{unread}</span>}
          </button>
        </header>

        {me.role !== 'resident' && activeSos.length > 0 && loc.pathname !== '/' && (
          <div className="sos-strip">
            <div className="banner bad" onClick={() => nav('/')} style={{ cursor: 'pointer' }}>
              <Siren size={20} /> <b>{activeSos.length} alerta(s) de emergencia activa(s).</b> Toca para atender.
            </div>
          </div>
        )}

        <div className="cover-title">
          <div className="cover-name">{db.settings.name}</div>
          <div className="cover-sub">
            {ROLE_LABEL[me.role]}
            {me.role === 'resident' ? ` · ${unitLabel(db, me.unitId)}` : ''}
            {address ? <span className="hide-sm"> · {address}</span> : null}
          </div>
        </div>

        <main className="content">
          <Outlet />
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Navegación principal">
        {quick.map((to) => {
          const link = allLinks.find(([t]) => t === to);
          if (!link) return null;
          const [, , Icon, count] = link;
          return (
            <NavLink key={to} to={to} end={to === '/'}>
              <Icon size={21} strokeWidth={1.8} />
              {short[to]}
              {count ? <span className="count">{count}</span> : null}
            </NavLink>
          );
        })}
        <button onClick={() => setOpen(true)}>
          <MoreHorizontal size={21} strokeWidth={1.8} />
          Más
        </button>
      </nav>

      {showNotifs && <NotificationsPanel onClose={() => setShowNotifs(false)} />}

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
