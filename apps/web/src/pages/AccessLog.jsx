import { useMemo, useState } from 'react';
import { Download, DoorOpen, Search } from 'lucide-react';
import { useStore, unitLabel, userName } from '../data/store';
import { PASS_TYPES } from '@residencial/shared';
import { fmtDate, fmtTime } from '../lib/utils';
import { Badge, Button, Card, Chips, Empty, Modal, PageHead } from '../components/ui';

const KINDS = [
  { value: 'all', label: 'Todos' },
  { value: 'pass', label: 'Con pase' },
  { value: 'walkin', label: 'Sin pase' },
  { value: 'general', label: 'Generales' },
];
const KIND = { pass: ['Con pase', 'ok'], walkin: ['Sin pase', 'warn'], general: ['General', 'info'] };

export default function AccessLog() {
  const { db, me } = useStore();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [detail, setDetail] = useState(null);

  const scoped = useMemo(() => {
    let r = db.accessLogs;
    if (me.role === 'resident') r = r.filter((l) => l.unitId === me.unitId || l.kind === 'general');
    if (q) {
      const s = q.toLowerCase();
      r = r.filter((l) => [l.visitorName, l.plate, unitLabel(db, l.unitId)].join(' ').toLowerCase().includes(s));
    }
    return r;
  }, [db, me, q]);
  const counts = useMemo(() => {
    const c = { all: scoped.length };
    for (const l of scoped) c[l.kind] = (c[l.kind] || 0) + 1;
    return c;
  }, [scoped]);
  const rows = useMemo(
    () => (kind === 'all' ? scoped : scoped.filter((l) => l.kind === kind)).toSorted((a, b) => b.at.localeCompare(a.at)),
    [scoped, kind],
  );
  // En el celular la lista se agrupa por día para no repetir la fecha en cada renglón
  const days = useMemo(() => {
    const m = new Map();
    for (const l of rows) {
      const k = dayLabel(l.at);
      m.set(k, [...(m.get(k) || []), l]);
    }
    return [...m];
  }, [rows]);

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
      <div className="log-filters">
        <div className="input-wrap log-search">
          <Search size={16} className="input-icon" />
          <input className="input with-icon" placeholder="Buscar nombre, placa o casa" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Chips scroll value={kind} onChange={setKind} options={KINDS.map((k) => ({ ...k, label: `${k.label} ${counts[k.value] ?? 0}` }))} />
      </div>
      <Card className="log-card">
        {rows.length === 0 ? (
          <Empty icon={<DoorOpen />}>Sin registros.</Empty>
        ) : (
          <>
            <div className="show-sm">
              {days.map(([day, list]) => (
                <section key={day} className="log-day">
                  <div className="log-day-head">
                    {day}
                    <span>{list.length}</span>
                  </div>
                  {list.map((l) => (
                    <button key={l.id} type="button" className="log-row" onClick={() => setDetail(l)}>
                      {l.photo ? (
                        <img src={l.photo} className="log-thumb" alt="" />
                      ) : (
                        <span className="log-thumb">
                          <DoorOpen size={16} />
                        </span>
                      )}
                      <span className="log-main">
                        <span className="log-name">{l.visitorName}</span>
                        <span className="log-sub">
                          <i className={`kdot ${KIND[l.kind][1]}`} />
                          {l.unitId ? unitLabel(db, l.unitId) : 'General'}
                          {l.plate && (
                            <>
                              {' · '}
                              <span className="mono">{l.plate}</span>
                            </>
                          )}
                          {l.plateMatch === false && <b className="bad-text"> · placa distinta</b>}
                        </span>
                      </span>
                      <span className="log-time">
                        {shortTime(l.at)}
                        {l.exitAt ? <small title="Salida">→ {shortTime(l.exitAt)}</small> : <small className="ok-text">Dentro</small>}
                      </span>
                    </button>
                  ))}
                </section>
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
                    <tr key={l.id} className="tap" onClick={() => setDetail(l)}>
                      <td>
                        {l.photo ? (
                          <img src={l.photo} className="thumb" alt="" style={{ cursor: 'zoom-in' }} />
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
      {detail && <LogDetail log={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

const shortTime = (d) =>
  new Date(d).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' }).replace(/\s?([ap])\.\s?m\./i, ' $1m');

function dayLabel(at) {
  const d = new Date(at);
  const today = new Date();
  const diff = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 864e5);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' });
}

function LogDetail({ log: l, onClose }) {
  const { db } = useStore();
  const rows = [
    ['Tipo', PASS_TYPES[l.type] || l.type],
    ['Domicilio', l.unitId ? unitLabel(db, l.unitId) : 'Todo el residencial'],
    [
      'Placa',
      l.plate ? (
        <span key="placa" className="mono">
          {l.plate}
        </span>
      ) : (
        '—'
      ),
    ],
    ['Entrada', `${fmtDate(l.at, { year: undefined })} · ${fmtTime(l.at)}`],
    [
      'Salida',
      l.exitAt ? (
        fmtTime(l.exitAt)
      ) : (
        <Badge key="salida" tone="ok">
          Dentro
        </Badge>
      ),
    ],
    ['Registró', userName(db, l.guardId)],
  ];
  return (
    <Modal title={l.visitorName} onClose={onClose}>
      <div className="row" style={{ gap: 6, marginBottom: 12 }}>
        <Badge tone={KIND[l.kind][1]}>{KIND[l.kind][0]}</Badge>
        {l.plateMatch === false && <Badge tone="bad">Placa distinta</Badge>}
      </div>
      {l.photo && <img src={l.photo} alt="" style={{ width: '100%', borderRadius: 16, marginBottom: 12 }} />}
      <dl className="log-dl">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
