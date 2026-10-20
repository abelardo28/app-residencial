// Caseta física: equipos (plumas, lectores de tags y cámaras de placas), tags de residentes y bitácora.
import { useState } from 'react';
import { Copy, Cpu, KeyRound, Nfc, Plus, Trash2, Zap } from 'lucide-react';
import { DEVICE_KINDS, LANES } from '@residencial/shared';
import { useStore, unitLabel } from '../data/store';
import { API_BASE } from '../data/api/client';
import { fmtDateTime, timeAgo } from '../lib/utils';
import GateControls, { isConnected } from '../components/GateControls';
import { Badge, Button, Card, CardHead, Empty, Field, Modal, PageHead, Tabs } from '../components/ui';

export default function GateDevices() {
  const { db } = useStore();
  const [tab, setTab] = useState('devices');
  const devices = db.devices || [];
  const tags = db.tags || [];
  return (
    <>
      <PageHead title="Caseta física" subtitle="Conecta plumas, lectores de tags y cámaras de placas." />
      <GateControls compact />
      <div style={{ marginBottom: 16 }}>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'devices', label: 'Equipos', count: devices.length },
            { value: 'tags', label: 'Tags', count: tags.length },
            { value: 'log', label: 'Bitácora' },
          ]}
        />
      </div>
      {tab === 'devices' && <Devices />}
      {tab === 'tags' && <Tags />}
      {tab === 'log' && <EventLog />}
    </>
  );
}

function Devices() {
  const { db, actions, gateSim } = useStore();
  const [adding, setAdding] = useState(false);
  const [token, setToken] = useState(null); // { device, token }
  const devices = db.devices || [];
  const name = (id) => devices.find((d) => d.id === id)?.name || '—';

  return (
    <>
      <Card>
        <CardHead title="Equipos de la caseta" subtitle="Cada equipo se conecta con el agente de caseta y su propio token.">
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            <Plus size={15} /> Agregar
          </Button>
        </CardHead>
        {devices.length === 0 && <Empty icon={<Cpu />}>Aún no hay equipos. Agrega la pluma de la entrada para empezar.</Empty>}
        <div className="list">
          {devices.map((d) => (
            <div key={d.id} className="list-item wrap">
              <div className="grow">
                <div className="title">
                  {d.name} <span className="faint">· {DEVICE_KINDS[d.kind]}</span>
                </div>
                <div className="faint">
                  {LANES[d.lane]}
                  {d.barrierId ? ` · abre ${name(d.barrierId)}` : ''}
                </div>
              </div>
              {d.status !== 'active' ? (
                <Badge>Desactivado</Badge>
              ) : isConnected(d) ? (
                <Badge tone="ok">Conectado</Badge>
              ) : (
                <Badge tone="bad">{d.disconnectedAt ? `Sin conexión ${timeAgo(d.disconnectedAt)}` : 'Nunca conectado'}</Badge>
              )}
              {gateSim && d.kind !== 'barrier' && d.status === 'active' && <SimulateRead device={d} />}
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  actions.rotateDeviceToken(d.id).then(
                    (r) => setToken({ device: d, token: r.token }),
                    () => {},
                  )
                }
              >
                <KeyRound size={15} /> Token
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => actions.updateDevice(d.id, { status: d.status === 'active' ? 'disabled' : 'active' }).catch(() => {})}
              >
                {d.status === 'active' ? 'Desactivar' : 'Activar'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Eliminar ${d.name}`}
                onClick={() =>
                  window.confirm(`¿Eliminar ${d.name}? El agente dejará de funcionar.`) && actions.deleteDevice(d.id).catch(() => {})
                }
              >
                <Trash2 size={15} />
              </Button>
            </div>
          ))}
        </div>
      </Card>
      <Card style={{ marginTop: 16 }}>
        <CardHead title="Cómo se conecta" />
        <ol className="muted" style={{ paddingLeft: 18, display: 'grid', gap: 6 }}>
          <li>
            Instala el agente de caseta (<span className="mono">apps/gate-agent</span>) en una computadora o Raspberry Pi de la caseta.
          </li>
          <li>Agrega aquí cada equipo y copia su token en el archivo de configuración del agente.</li>
          <li>
            La pluma se activa con un relevador (Shelly, controlador con API HTTP o tarjeta de relés). Los lectores de tags tipo teclado USB
            y las cámaras con LPR que envían avisos HTTP (Hikvision, Dahua) se conectan al mismo agente.
          </li>
          <li>El agente sólo hace conexiones de salida: no hay que abrir puertos en el módem de la caseta.</li>
        </ol>
      </Card>
      {adding && <AddDevice onClose={() => setAdding(false)} onCreated={(r) => setToken(r)} />}
      {token && <TokenModal {...token} onClose={() => setToken(null)} />}
    </>
  );
}

function SimulateRead({ device }) {
  const { db, gateSim } = useStore();
  const sample =
    device.kind === 'reader'
      ? (db.tags || []).find((t) => t.status === 'active')?.code || 'A1B2C3D4'
      : db.users.find((u) => u.role === 'resident' && u.vehicles?.length)?.vehicles[0] || 'ABC123A';
  return (
    <Button
      size="sm"
      onClick={() => {
        const value = window.prompt(device.kind === 'reader' ? 'Número de tag leído' : 'Placa leída', sample);
        if (value) gateSim.read(device.id, device.kind === 'reader' ? 'tag' : 'plate', value).catch(() => {});
      }}
    >
      <Zap size={15} /> Simular lectura
    </Button>
  );
}

function AddDevice({ onClose, onCreated }) {
  const { db, actions } = useStore();
  const barriers = (db.devices || []).filter((d) => d.kind === 'barrier');
  const [f, setF] = useState({ name: '', kind: 'barrier', lane: 'entrada', barrierId: '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal
      title="Agregar equipo"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={!f.name.trim()}
            onClick={() =>
              actions.createDevice({ ...f, barrierId: f.kind === 'barrier' ? null : f.barrierId || null }).then(
                (r) => {
                  onCreated(r);
                  onClose();
                },
                () => {},
              )
            }
          >
            Agregar
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Nombre">
          <input className="input" value={f.name} onChange={set('name')} placeholder="Ej. Pluma de visitas" />
        </Field>
        <div className="grid g2">
          <Field label="Tipo">
            <select className="select" value={f.kind} onChange={set('kind')}>
              {Object.entries(DEVICE_KINDS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Carril">
            <select className="select" value={f.lane} onChange={set('lane')}>
              {Object.entries(LANES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {f.kind !== 'barrier' && (
          <Field label="Pluma que abre" hint="Si no eliges, se usa la pluma del mismo carril.">
            <select className="select" value={f.barrierId} onChange={set('barrierId')}>
              <option value="">La del mismo carril</option>
              {barriers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
    </Modal>
  );
}

function TokenModal({ device, token, onClose }) {
  const { toast } = useStore();
  const apiUrl = new URL(API_BASE, window.location.href).href.replace(/\/api\/v1\/?$/, '');
  const key = { barrier: 'BARRIER_TOKEN', reader: 'READER_TOKEN', camera: 'CAMERA_TOKEN' }[device.kind];
  const env = `API_URL=${apiUrl}\n${key}=${token}`;
  return (
    <Modal title={`Token de ${device.name}`} onClose={onClose} footer={<Button onClick={onClose}>Listo</Button>}>
      <div className="stack">
        <p className="muted">Guárdalo en el archivo .env del agente de caseta. Si lo renuevas, el token anterior deja de funcionar.</p>
        <pre className="mono card flat" style={{ padding: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>
          {env}
        </pre>
        <Button
          onClick={() =>
            navigator.clipboard.writeText(env).then(
              () => toast('Copiado', 'Configuración del agente'),
              () => toast('No se pudo copiar', 'Cópialo manualmente.', 'bad'),
            )
          }
        >
          <Copy size={15} /> Copiar
        </Button>
      </div>
    </Modal>
  );
}

function Tags() {
  const { db, actions, toast } = useStore();
  const [f, setF] = useState({ unitId: '', code: '', label: '' });
  const tags = [...(db.tags || [])].sort((a, b) => unitLabel(db, a.unitId).localeCompare(unitLabel(db, b.unitId), 'es', { numeric: true }));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <div className="grid g2">
      <Card>
        <CardHead title="Registrar tag" subtitle="Los tags activos abren la pluma de residentes al pasar por el lector." />
        <div className="stack">
          <Field label="Casa">
            <select className="select" value={f.unitId} onChange={set('unitId')}>
              <option value="">Selecciona…</option>
              {db.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Número del tag" hint="Viene impreso en el tag o lo muestra el lector al pasarlo.">
            <input className="input mono" value={f.code} onChange={(e) => setF((x) => ({ ...x, code: e.target.value.toUpperCase() }))} />
          </Field>
          <Field label="Descripción">
            <input className="input" value={f.label} onChange={set('label')} placeholder="Ej. Camioneta gris" />
          </Field>
          <Button
            variant="primary"
            disabled={!f.unitId || f.code.length < 4}
            onClick={() =>
              actions.registerTag({ ...f, label: f.label || 'Tag' }).then(
                () => {
                  toast('Tag registrado', unitLabel(db, f.unitId));
                  setF({ unitId: '', code: '', label: '' });
                },
                () => {},
              )
            }
          >
            <Nfc size={16} /> Registrar
          </Button>
        </div>
      </Card>
      <Card>
        <CardHead title="Tags registrados" />
        {tags.length === 0 && <Empty>Sin tags.</Empty>}
        <div className="list">
          {tags.map((t) => (
            <div key={t.id} className="list-item wrap">
              <div className="grow">
                <div className="title">
                  {unitLabel(db, t.unitId)} · {t.label}
                </div>
                <div className="faint mono">{t.code}</div>
              </div>
              <Badge tone={t.status === 'active' ? 'ok' : 'bad'}>{t.status === 'active' ? 'Activo' : 'Bloqueado'}</Badge>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => actions.updateTag(t.id, { status: t.status === 'active' ? 'blocked' : 'active' }).catch(() => {})}
              >
                {t.status === 'active' ? 'Bloquear' : 'Activar'}
              </Button>
              <Button size="sm" variant="ghost" aria-label="Eliminar tag" onClick={() => actions.deleteTag(t.id).catch(() => {})}>
                <Trash2 size={15} />
              </Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

const RESULT = {
  opened: 'Abrió',
  denied: 'Negado',
  pass: 'Aviso a caseta',
  resident: 'Residente',
  unknown: 'Sin registro',
  no_barrier: 'Sin pluma',
};

function EventLog() {
  const { db } = useStore();
  const devices = db.devices || [];
  const events = db.gateEvents || [];
  return (
    <Card>
      {events.length === 0 && <Empty>Sin lecturas todavía.</Empty>}
      <div className="list">
        {events.map((e) => (
          <div key={e.id} className="list-item">
            <div className="grow">
              <div className="title">{e.label}</div>
              <div className="faint">
                {devices.find((d) => d.id === e.deviceId)?.name || 'Equipo'} ·{' '}
                {e.kind === 'plate' ? `Placa ${e.value}` : e.kind === 'tag' ? `Tag ${e.value}` : 'Apertura manual'} · {fmtDateTime(e.at)}
              </div>
            </div>
            <Badge tone={e.result === 'opened' ? 'ok' : e.result === 'denied' ? 'bad' : ''}>{RESULT[e.result] || e.result}</Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}
