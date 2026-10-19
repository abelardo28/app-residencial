import { useState } from 'react';
import { Package, Plus, Check } from 'lucide-react';
import { useStore, unitLabel, userName } from '../data/store';
import { fmtDateTime, timeAgo } from '../lib/utils';
import { Badge, Button, Card, Chips, Empty, Field, Modal, PageHead, Tabs } from '../components/ui';

const CARRIERS = ['Amazon', 'Mercado Libre', 'DHL', 'FedEx', 'Estafeta', 'Comida a domicilio', 'Otro'];

export default function Packages() {
  const { db, me } = useStore();
  const [tab, setTab] = useState('waiting');
  const [creating, setCreating] = useState(false);
  const [delivering, setDelivering] = useState(null);
  const base = me.role === 'resident' ? db.packages.filter((p) => p.unitId === me.unitId) : db.packages;
  const list = base.filter((p) => p.status === tab);

  return (
    <>
      <PageHead
        title="Paquetería"
        subtitle={
          me.role === 'resident'
            ? 'Paquetes recibidos en caseta. Muestra el código al recoger.'
            : 'Registra paquetes recibidos y entrégalos con código.'
        }
        fab={me.role === 'guard' ? { icon: <Plus size={18} />, label: 'Recibir paquete', onClick: () => setCreating(true) } : null}
      >
        {me.role === 'guard' && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> Recibir paquete
          </Button>
        )}
      </PageHead>
      <div style={{ marginBottom: 16 }}>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'waiting', label: 'En caseta', count: base.filter((p) => p.status === 'waiting').length },
            { value: 'delivered', label: 'Entregados' },
          ]}
        />
      </div>
      <Card>
        {list.length === 0 && <Empty icon={<Package />}>Sin paquetes.</Empty>}
        <div className="list cols-lg">
          {list.map((p) => (
            <div key={p.id} className="list-item">
              <div className="avatar">
                <Package size={16} />
              </div>
              <div className="grow">
                <div className="title">
                  {p.carrier}
                  {p.description ? ` · ${p.description}` : ''}
                </div>
                <div className="faint">
                  {unitLabel(db, p.unitId)} · recibió {userName(db, p.receivedBy)} {timeAgo(p.receivedAt)}
                  {p.deliveredAt ? ` · entregado ${fmtDateTime(p.deliveredAt)}` : ''}
                </div>
              </div>
              {me.role === 'resident' && p.status === 'waiting' && (
                <span className="badge info mono" style={{ fontSize: 15 }}>
                  {p.pickupCode}
                </span>
              )}
              {p.status === 'delivered' && <Badge tone="ok">Entregado</Badge>}
              {me.role === 'guard' && p.status === 'waiting' && (
                <Button size="sm" onClick={() => setDelivering(p)}>
                  <Check size={15} /> Entregar
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>
      {creating && <ReceivePackage onClose={() => setCreating(false)} />}
      {delivering && <Deliver p={delivering} onClose={() => setDelivering(null)} />}
    </>
  );
}

function ReceivePackage({ onClose }) {
  const { db, actions, toast } = useStore();
  const [f, setF] = useState({ unitId: '', carrier: CARRIERS[0], description: '' });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  return (
    <Modal
      title="Recibir paquete"
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          onClick={() => {
            if (!f.unitId) return;
            actions.registerPackage(f).then(
              () => {
                toast('Paquete registrado', 'Se avisó al residente.');
                onClose();
              },
              () => {},
            );
          }}
        >
          Registrar y avisar
        </Button>
      }
    >
      <div className="stack">
        <Field label="Domicilio">
          <select className="select" value={f.unitId} onChange={set('unitId')}>
            <option value="">Selecciona…</option>
            {db.units
              .filter((u) => db.users.some((r) => r.unitId === u.id))
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Paquetería">
          <Chips value={f.carrier} onChange={set('carrier')} options={CARRIERS.map((c) => ({ value: c, label: c }))} />
        </Field>
        <Field label="Descripción">
          <input className="input" value={f.description} onChange={set('description')} placeholder="Ej. sobre, caja grande" />
        </Field>
      </div>
    </Modal>
  );
}

function Deliver({ p, onClose }) {
  const { actions, toast } = useStore();
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  return (
    <Modal
      title="Entregar paquete"
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          onClick={() =>
            actions.deliverPackage(p.id, code).then(
              () => {
                toast('Paquete entregado', '');
                onClose();
              },
              (e) => setErr(e.message),
            )
          }
        >
          Confirmar entrega
        </Button>
      }
    >
      <div className="stack">
        <p className="muted">Pide al residente el código de 4 dígitos que recibió en su notificación.</p>
        <input
          className="input plate"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="0000"
          autoFocus
        />
        {err && <div className="banner bad">{err}</div>}
      </div>
    </Modal>
  );
}
