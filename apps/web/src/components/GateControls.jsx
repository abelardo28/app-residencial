import { useState } from 'react';
import { DoorOpen, Nfc, Car, Hand } from 'lucide-react';
import { COMMAND_TTL_SECONDS } from '@residencial/shared';
import { useStore } from '../data/store';
import { fmtTime, timeAgo } from '../lib/utils';
import { Badge, Button, Card, CardHead } from './ui';

const RESULT = {
  opened: ['Abrió', 'ok'],
  denied: ['Negado', 'bad'],
  pass: ['Visita con pase', 'info'],
  resident: ['Residente', 'info'],
  unknown: ['Sin registro', ''],
  no_barrier: ['Sin pluma', 'warn'],
};
const KIND_ICON = { tag: Nfc, plate: Car, manual: Hand };

export const isConnected = (d) => !!d.connectedAt && !d.disconnectedAt;

/** Estado de la última orden de una pluma: abriendo, abierta o sin respuesta. */
export function barrierState(commands, deviceId) {
  const last = commands.find((c) => c.deviceId === deviceId);
  if (!last) return null;
  const age = Date.now() - new Date(last.createdAt).getTime();
  if (last.status === 'pending') return age < COMMAND_TTL_SECONDS * 1000 ? ['Abriendo…', 'warn'] : ['No respondió', 'bad'];
  if (last.status === 'failed') return ['Falló', 'bad'];
  return age < 60e3 ? [`Abierta ${fmtTime(last.ackAt || last.createdAt)}`, 'ok'] : null;
}

/** Botones para abrir las plumas y lecturas recientes de tags y placas (caseta y administración). */
export default function GateControls({ compact }) {
  const { db, actions, toast } = useStore();
  const [busy, setBusy] = useState(null);
  const barriers = (db.devices || []).filter((d) => d.kind === 'barrier' && d.status === 'active');
  const events = (db.gateEvents || []).slice(0, compact ? 3 : 5);
  if (!barriers.length) return null;

  async function open(d) {
    setBusy(d.id);
    try {
      await actions.openGate({ deviceId: d.id, reason: 'Apertura desde caseta' });
      toast('Abriendo pluma', d.name);
    } catch {
      /* el motivo ya se mostró */
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card style={{ marginBottom: 16 }}>
      <CardHead title="Plumas" subtitle="Ábrelas desde aquí; los tags y placas registrados abren solos." />
      <div className="row" style={{ gap: 10 }}>
        {barriers.map((d) => {
          const st = barrierState(db.gateCommands || [], d.id);
          return (
            <div key={d.id} className="row" style={{ gap: 8 }}>
              <Button variant="primary" disabled={busy === d.id} onClick={() => open(d)}>
                <DoorOpen size={16} /> Abrir {d.name.toLowerCase()}
              </Button>
              {st ? <Badge tone={st[1]}>{st[0]}</Badge> : !isConnected(d) && <Badge tone="bad">Desconectada</Badge>}
            </div>
          );
        })}
      </div>
      {events.length > 0 && (
        <div className="list" style={{ marginTop: 12 }}>
          {events.map((e) => {
            const Icon = KIND_ICON[e.kind] || Hand;
            const [label, tone] = RESULT[e.result] || [e.result, ''];
            return (
              <div key={e.id} className="list-item">
                <div className="avatar">
                  <Icon size={15} />
                </div>
                <div className="grow">
                  <div className="title">{e.label}</div>
                  <div className="faint">
                    {e.kind === 'plate' ? `Placa ${e.value}` : e.kind === 'tag' ? `Tag ${e.value}` : 'Apertura manual'} · {timeAgo(e.at)}
                  </div>
                </div>
                <Badge tone={tone}>{label}</Badge>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
