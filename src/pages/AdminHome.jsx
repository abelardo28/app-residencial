import { Link } from 'react-router-dom';
import { Wallet, DoorOpen, Wrench, Siren, ArrowRight, Megaphone, TrendingUp } from 'lucide-react';
import { useStore, unitLabel, userName } from '../data/store';
import { money, monthKey, lastMonths, monthLabel, timeAgo, fmtTime } from '../lib/utils';
import { Badge, Button, Card, CardHead, Empty, Stat } from '../components/ui';
import { ledger } from './Payments';

export default function AdminHome() {
  const { db, actions, toast } = useStore();
  const residents = db.users.filter((u) => u.role === 'resident');
  const pending = db.payments.filter((p) => p.status === 'pending');
  const debtors = residents.filter((r) => ledger(db, r.unitId).some((x) => x.state === 'overdue'));
  const todayLogs = db.accessLogs.filter((l) => new Date(l.at).toDateString() === new Date().toDateString());
  const openInc = db.incidents.filter((i) => i.status !== 'resuelta');
  const sos = db.sos.filter((s) => s.status === 'active');
  const months = lastMonths(6);
  const collected = months.map((m) => db.payments.filter((p) => p.period === m && p.status === 'approved').reduce((s, p) => s + p.amount, 0));
  const expected = residents.length * db.settings.monthlyFee;

  return (
    <>
      <div className="page-head">
        <div><h1>Panel de administración</h1><p>{db.settings.name} · {residents.length} residentes en {db.units.length} casas</p></div>
      </div>

      {sos.map((s) => (
        <div key={s.id} className="banner bad" style={{ marginBottom: 12 }}>
          <Siren size={20} /> <div style={{ flex: 1 }}><b>{s.kind}</b> · {unitLabel(db, s.unitId)} · {userName(db, s.residentId)} · {timeAgo(s.at)}</div>
          <Button size="sm" onClick={() => { actions.attendSos(s.id); toast('Alerta atendida', ''); }}>Marcar atendida</Button>
        </div>
      ))}

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Link to="/pagos" style={{ textDecoration: 'none' }}><Stat icon={<Wallet size={15} />} label="Pagos por revisar" value={pending.length} sub={money(pending.reduce((s, p) => s + p.amount, 0))} /></Link>
        <Stat icon={<TrendingUp size={15} />} label="Morosidad" value={`${residents.length ? Math.round((debtors.length / residents.length) * 100) : 0}%`} sub={`${debtors.length} casa(s) con adeudo`} />
        <Link to="/accesos" style={{ textDecoration: 'none' }}><Stat icon={<DoorOpen size={15} />} label="Accesos hoy" value={todayLogs.length} sub={`${db.accessLogs.filter((l) => !l.exitAt).length} dentro ahora`} /></Link>
        <Link to="/reportes" style={{ textDecoration: 'none' }}><Stat icon={<Wrench size={15} />} label="Reportes abiertos" value={openInc.length} /></Link>
      </div>

      <div className="g-dash">
        <Card>
          <CardHead title="Cobranza de mantenimiento" subtitle={`Meta mensual ${money(expected)}`} />
          <div className="stack">
            {months.map((m, i) => (
              <div key={m}>
                <div className="row between" style={{ fontSize: 13 }}><span>{monthLabel(m)}</span><span className="muted">{money(collected[i])} · {expected ? Math.round((collected[i] / expected) * 100) : 0}%</span></div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${expected ? Math.min(100, (collected[i] / expected) * 100) : 0}%` }} /></div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHead title="Comprobantes por revisar"><Link to="/pagos" className="btn ghost sm">Ir a pagos <ArrowRight size={14} /></Link></CardHead>
          {pending.length === 0 && <Empty>Sin pendientes.</Empty>}
          <div className="list">
            {pending.slice(0, 5).map((p) => (
              <div key={p.id} className="list-item">
                <div className="avatar"><Wallet size={16} /></div>
                <div className="grow"><div className="title">{unitLabel(db, p.unitId)} · {userName(db, p.residentId)}</div><div className="faint">{monthLabel(p.period)} · {timeAgo(p.createdAt)}</div></div>
                <b>{money(p.amount)}</b>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHead title="Últimos accesos"><Link to="/accesos" className="btn ghost sm">Bitácora <ArrowRight size={14} /></Link></CardHead>
          <div className="list">
            {db.accessLogs.slice(0, 5).map((l) => (
              <div key={l.id} className="list-item">
                <div className="avatar"><DoorOpen size={16} /></div>
                <div className="grow"><div className="title">{l.visitorName}</div><div className="faint">{l.unitId ? unitLabel(db, l.unitId) : 'General'} · {fmtTime(l.at)} {l.plate}</div></div>
                {l.plateMatch === false && <Badge tone="bad">Placa distinta</Badge>}
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHead title="Avisos recientes"><Link to="/avisos" className="btn ghost sm">Publicar <ArrowRight size={14} /></Link></CardHead>
          <div className="list">
            {db.notices.slice(0, 4).map((n) => (
              <div key={n.id} className="list-item">
                <div className="avatar"><Megaphone size={16} /></div>
                <div className="grow"><div className="title">{n.title}</div><div className="faint">Leído por {n.readBy.length}/{residents.length}</div></div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <p className="faint" style={{ marginTop: 16 }}>Mes actual: {monthLabel(monthKey())}</p>
    </>
  );
}
