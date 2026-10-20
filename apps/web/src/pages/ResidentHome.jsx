import { Link } from 'react-router-dom';
import { QrCode, Wallet, Megaphone, Package, DoorOpen, CalendarDays, ArrowRight, Vote, Wrench } from 'lucide-react';
import { useStore, unitLabel } from '../data/store';
import { passStatus } from '@residencial/shared';
import { money, timeAgo, fmtTime, monthLabel } from '../lib/utils';
import { Badge, Card, CardHead, Empty, Stat } from '../components/ui';
import { ledger } from '@residencial/shared';

export default function ResidentHome() {
  const { db, me } = useStore();
  const rows = ledger(db, me.unitId);
  const owed = rows.filter((r) => r.state === 'overdue' || r.state === 'due');
  const activePasses = db.passes.filter((p) => p.unitId === me.unitId && passStatus(p).tone === 'ok');
  const visits = db.accessLogs.filter((l) => l.unitId === me.unitId || l.kind === 'general').slice(0, 5);
  const notices = db.notices.filter((n) => n.audience !== 'staff').slice(0, 3);
  const pkgs = db.packages.filter((p) => p.unitId === me.unitId && p.status === 'waiting');
  const polls = db.polls.filter((p) => new Date(p.closesAt) > new Date() && !p.votes[me.id]);
  const hour = new Date().getHours();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            {hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches'}, {me.name.split(' ')[0]}
          </h1>
          <p>
            {unitLabel(db, me.unitId)} · {db.settings.name}
          </p>
        </div>
      </div>

      {rows.some((r) => r.state === 'overdue') && (
        <Link to="/pagos" className="banner bad" style={{ marginBottom: 16, textDecoration: 'none' }}>
          <Wallet size={18} /> Tienes {owed.length} cuota(s) pendiente(s) por {money(owed.reduce((s, r) => s + r.amount, 0))}.{' '}
          <b style={{ marginLeft: 'auto' }}>Pagar ahora</b>
        </Link>
      )}

      <div className="quick-actions show-sm">
        {[
          ['/pases', 'Nuevo pase', QrCode],
          ['/pagos', 'Pagar', Wallet],
          ['/reservas', 'Reservar', CalendarDays],
          ['/reportes', 'Reportar', Wrench],
        ].map(([to, label, Icon]) => (
          <Link key={to} to={to} className="quick">
            <span className="quick-icon">
              <Icon size={20} />
            </span>
            {label}
          </Link>
        ))}
      </div>

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Link to="/pases" style={{ textDecoration: 'none' }}>
          <Stat icon={<QrCode size={15} />} label="Pases activos" value={activePasses.length} sub="Toca para crear uno" />
        </Link>
        <Link to="/pagos" style={{ textDecoration: 'none' }}>
          <Stat
            icon={<Wallet size={15} />}
            label="Saldo"
            value={money(owed.reduce((s, r) => s + r.amount, 0))}
            sub={owed.length ? owed.map((o) => monthLabel(o.month)).join(', ') : 'Al corriente'}
          />
        </Link>
        <Link to="/paquetes" style={{ textDecoration: 'none' }}>
          <Stat icon={<Package size={15} />} label="Paquetes en caseta" value={pkgs.length} />
        </Link>
        <Link to="/votaciones" style={{ textDecoration: 'none' }}>
          <Stat icon={<Vote size={15} />} label="Votaciones abiertas" value={polls.length} sub={polls.length ? 'Falta tu voto' : ''} />
        </Link>
      </div>

      <div className="g-dash">
        <Card>
          <CardHead title="Visitas recientes">
            <Link to="/accesos" className="btn ghost sm">
              Ver todo <ArrowRight size={14} />
            </Link>
          </CardHead>
          {visits.length === 0 && <Empty icon={<DoorOpen />}>Sin visitas registradas.</Empty>}
          <div className="list">
            {visits.map((v) => (
              <div key={v.id} className="list-item">
                <div className="avatar">
                  <DoorOpen size={16} />
                </div>
                <div className="grow">
                  <div className="title">{v.visitorName}</div>
                  <div className="faint">
                    {timeAgo(v.at)} · {fmtTime(v.at)}
                    {v.plate ? ` · ${v.plate}` : ''}
                  </div>
                </div>
                {v.kind === 'general' ? (
                  <Badge tone="info">General</Badge>
                ) : v.exitAt ? (
                  <Badge>Salió</Badge>
                ) : (
                  <Badge tone="ok">Dentro</Badge>
                )}
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHead title="Avisos">
            <Link to="/avisos" className="btn ghost sm">
              Ver todo <ArrowRight size={14} />
            </Link>
          </CardHead>
          <div className="list">
            {notices.map((n) => (
              <Link to="/avisos" key={n.id} className="list-item" style={{ textDecoration: 'none' }}>
                <div className="avatar">
                  <Megaphone size={16} />
                </div>
                <div className="grow">
                  <div className="title">{n.title}</div>
                  <div className="faint">{timeAgo(n.createdAt)}</div>
                </div>
                {!n.readBy.includes(me.id) && <Badge tone="bad">Nuevo</Badge>}
              </Link>
            ))}
          </div>
        </Card>
        <Card>
          <CardHead title="Próximas reservaciones">
            <Link to="/reservas" className="btn ghost sm">
              Reservar <ArrowRight size={14} />
            </Link>
          </CardHead>
          {db.reservations
            .filter((r) => r.unitId === me.unitId && r.status === 'approved' && r.date >= new Date().toISOString().slice(0, 10))
            .map((r) => (
              <div key={r.id} className="list-item">
                <div className="avatar">
                  <CalendarDays size={16} />
                </div>
                <div className="grow">
                  <div className="title">{db.settings.amenities.find((a) => a.id === r.amenityId)?.name}</div>
                  <div className="faint">
                    {new Date(r.date + 'T12:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' })} ·{' '}
                    {r.from}–{r.to}
                  </div>
                </div>
              </div>
            ))}
          {!db.reservations.some((r) => r.unitId === me.unitId && r.status === 'approved') && <Empty>Sin reservaciones.</Empty>}
        </Card>
        <Card>
          <CardHead title="Pases activos">
            <Link to="/pases" className="btn ghost sm">
              Administrar <ArrowRight size={14} />
            </Link>
          </CardHead>
          {activePasses.length === 0 && <Empty icon={<QrCode />}>No hay pases activos.</Empty>}
          {activePasses.map((p) => (
            <div key={p.id} className="list-item">
              <div className="avatar">
                <QrCode size={16} />
              </div>
              <div className="grow">
                <div className="title">{p.visitorName}</div>
                <div className="faint mono">{p.code}</div>
              </div>
              <Badge tone="ok">Activo</Badge>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
