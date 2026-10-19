import { useMemo, useState } from 'react';
import { Download, DoorOpen, Search } from 'lucide-react';
import { useStore, unitLabel, userName } from '../data/store';
import { PASS_TYPES } from '@residencial/shared';
import { fmtDate, fmtTime } from '../lib/utils';
import { Badge, Button, Card, Empty, Modal, PageHead, Tabs } from '../components/ui';

const KIND = { pass: ['Con pase', 'ok'], walkin: ['Sin pase', 'warn'], general: ['General', 'info'] };

export default function AccessLog() {
  const { db, me } = useStore();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [photo, setPhoto] = useState(null);

  const rows = useMemo(() => {
    let r = db.accessLogs;
    if (me.role === 'resident') r = r.filter((l) => l.unitId === me.unitId || l.kind === 'general');
    if (kind !== 'all') r = r.filter((l) => l.kind === kind);
    if (q) {
      const s = q.toLowerCase();
      r = r.filter((l) => [l.visitorName, l.plate, unitLabel(db, l.unitId)].join(' ').toLowerCase().includes(s));
    }
    return r;
  }, [db, me, q, kind]);

  function exportCsv() {
    const head = ['Fecha', 'Entrada', 'Salida', 'Visitante', 'Tipo', 'Domicilio', 'Placa', 'Vigilante'];
    const lines = rows.map((l) => [
      fmtDate(l.at),
      fmtTime(l.at),
      fmtTime(l.exitAt),
      l.visitorName,
      PASS_TYPES[l.type] || l.type,
      l.unitId ? unitLabel(db, l.unitId) : 'General',
      l.plate,
      userName(db, l.guardId),
    ]);
    const csv = [head, ...lines].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = 'bitacora-accesos.csv';
    a.click();
  }

  return (
    <>
      <PageHead
        title={me.role === 'resident' ? 'Historial de visitas' : 'Bitácora de accesos'}
        subtitle="Cada entrada queda registrada con hora, placa y fotografía."
      >
        {me.role !== 'resident' && (
          <Button onClick={exportCsv}>
            <Download size={16} /> Exportar CSV
          </Button>
        )}
      </PageHead>
      <div className="row" style={{ marginBottom: 16 }}>
        <Tabs
          value={kind}
          onChange={setKind}
          items={[
            { value: 'all', label: 'Todos' },
            { value: 'pass', label: 'Con pase' },
            { value: 'walkin', label: 'Sin pase' },
            { value: 'general', label: 'Generales' },
          ]}
        />
        <div className="row" style={{ flex: 1, minWidth: 220, flexWrap: 'nowrap' }}>
          <Search size={16} className="muted" />
          <input className="input" placeholder="Buscar nombre, placa o casa" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <Card>
        {rows.length === 0 ? (
          <Empty icon={<DoorOpen />}>Sin registros.</Empty>
        ) : (
          <>
            <div className="show-sm">
              {rows.map((l) => (
                <div key={l.id} className="m-card" onClick={() => l.photo && setPhoto(l)}>
                  {l.photo ? (
                    <img src={l.photo} className="thumb" alt="" />
                  ) : (
                    <div className="avatar">
                      <DoorOpen size={16} />
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row between" style={{ flexWrap: 'nowrap' }}>
                      <b style={{ fontWeight: 600 }}>{l.visitorName}</b>
                      {l.exitAt ? (
                        <span className="faint">
                          {fmtTime(l.at)}–{fmtTime(l.exitAt)}
                        </span>
                      ) : (
                        <Badge tone="ok">Dentro</Badge>
                      )}
                    </div>
                    <div className="faint">
                      {l.unitId ? unitLabel(db, l.unitId) : 'Todo el residencial'} · {fmtDate(l.at, { year: undefined })}
                      {l.plate ? (
                        <>
                          {' '}
                          · <span className="mono">{l.plate}</span>
                        </>
                      ) : (
                        ''
                      )}
                    </div>
                    <div className="row" style={{ gap: 6, marginTop: 4 }}>
                      <Badge tone={KIND[l.kind][1]}>{KIND[l.kind][0]}</Badge>
                      {l.plateMatch === false && <Badge tone="bad">Placa distinta</Badge>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="table-wrap hide-sm">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Visitante</th>
                    <th>Domicilio</th>
                    <th>Placa</th>
                    <th>Entrada</th>
                    <th>Salida</th>
                    <th className="hide-sm">Registró</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.id}>
                      <td>
                        {l.photo ? (
                          <img src={l.photo} className="thumb" alt="" style={{ cursor: 'zoom-in' }} onClick={() => setPhoto(l)} />
                        ) : (
                          <div className="thumb" style={{ background: 'var(--surface-sunk)' }} />
                        )}
                      </td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{l.visitorName}</div>
                        <div className="row" style={{ gap: 6 }}>
                          <Badge tone={KIND[l.kind][1]}>{KIND[l.kind][0]}</Badge>
                          {l.plateMatch === false && <Badge tone="bad">Placa distinta</Badge>}
                        </div>
                      </td>
                      <td>{l.unitId ? unitLabel(db, l.unitId) : <span className="faint">Todo el residencial</span>}</td>
                      <td className="mono">{l.plate || '—'}</td>
                      <td>
                        {fmtDate(l.at, { year: undefined })}
                        <div className="faint">{fmtTime(l.at)}</div>
                      </td>
                      <td>{l.exitAt ? fmtTime(l.exitAt) : <Badge tone="ok">Dentro</Badge>}</td>
                      <td className="hide-sm faint">{userName(db, l.guardId)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
      {photo && (
        <Modal title={`${photo.visitorName} · ${photo.plate || 'sin placa'}`} onClose={() => setPhoto(null)}>
          <img src={photo.photo} alt="" style={{ width: '100%', borderRadius: 16 }} />
        </Modal>
      )}
    </>
  );
}
