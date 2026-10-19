import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Wallet, DoorOpen, Megaphone, Package, Siren, Truck, AlertTriangle, Wrench, Vote, CalendarDays, Bell } from 'lucide-react';
import { useStore } from '../data/store';
import { timeAgo } from '../lib/utils';
import { pushPermission, pushSupported, requestPush } from '../services/push';
import { Button, Empty } from './ui';

const ICONS = { payment: Wallet, access: DoorOpen, notice: Megaphone, package: Package, sos: Siren, general: Truck, alert: AlertTriangle, incident: Wrench, poll: Vote, reservation: CalendarDays };

export default function NotificationsPanel({ onClose }) {
  const { db, me, actions } = useStore();
  const nav = useNavigate();
  const [perm, setPerm] = useState(pushPermission());
  const list = db.notifications.filter((n) => n.userId === me.id);

  return (
    <>
      <div className="backdrop" style={{ background: 'rgba(20,18,16,.18)' }} onClick={onClose} />
      <aside className="drawer">
        <div className="row between" style={{ padding: '16px 16px 8px' }}>
          <h2>Notificaciones</h2>
          <div className="row">
            <Button size="sm" variant="ghost" onClick={actions.markAllRead}>Marcar todo leído</Button>
            <button className="btn ghost icon-btn" onClick={onClose}><X size={18} /></button>
          </div>
        </div>
        {pushSupported() && perm !== 'granted' && (
          <div style={{ padding: '0 16px 8px' }}>
            <div className="banner info">
              <Bell size={18} />
              <div style={{ flex: 1 }}>Activa las notificaciones del dispositivo para enterarte aunque la app esté en segundo plano.</div>
              <Button size="sm" onClick={async () => setPerm(await requestPush())}>Activar</Button>
            </div>
          </div>
        )}
        <div className="drawer-body">
          {list.length === 0 && <Empty icon={<Bell />}>Sin notificaciones</Empty>}
          {list.map((n) => {
            const Icon = ICONS[n.kind] || Bell;
            return (
              <div key={n.id} className={`notif ${n.read ? '' : 'unread'}`} onClick={() => { actions.markRead(n.id); if (n.link) nav(n.link); onClose(); }}>
                <div className="avatar" style={n.kind === 'sos' || n.kind === 'alert' ? { color: 'var(--bad)' } : null}><Icon size={17} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="title" style={{ fontWeight: 500 }}>{n.title}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{n.body}</div>
                  <div className="faint">{timeAgo(n.createdAt)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
}
