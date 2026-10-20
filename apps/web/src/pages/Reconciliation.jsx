// Conciliación bancaria: administración sube el estado de cuenta (CSV) y los depósitos con la referencia
// de la casa se aplican solos. Lo que no cuadra queda "por asignar" para decidirlo a mano.
import { useState } from 'react';
import { Check, Download, FileSpreadsheet, Landmark, Link2, Trash2 } from 'lucide-react';
import { debtOf, parseBankStatement, payableRows, unitReference } from '@residencial/shared';
import { useStore, unitLabel } from '../data/store';
import { fmtDate, money, monthLabel } from '../lib/utils';
import { Badge, Button, Card, CardHead, Empty, Field, FileDrop, Modal } from '../components/ui';

const MV_STATUS = { matched: ['Aplicado', 'ok'], unmatched: ['Por asignar', 'warn'], ignored: ['Descartado', ''] };
const day = (d) => fmtDate(new Date(`${d}T12:00:00`));

export default function Reconciliation() {
  const { db, actions, toast } = useStore();
  const [file, setFile] = useState(null); // { name, movements, error }
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [assigning, setAssigning] = useState(null);
  const movements = [...(db.bankMovements || [])].sort((a, b) => (b.importedAt + b.date).localeCompare(a.importedAt + a.date));
  const unmatched = movements.filter((m) => m.status === 'unmatched');
  const processed = movements.filter((m) => m.status !== 'unmatched');

  async function read([f]) {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return toast('Archivo muy grande', 'Sube el estado de cuenta de un solo mes.', 'bad');
    const { movements, error } = parseBankStatement(await f.text());
    setSummary(null);
    setFile({ name: f.name, movements: movements.slice(0, 1000), error });
  }

  async function reconcile() {
    setBusy(true);
    try {
      setSummary(await actions.reconcileBank(file.movements));
      setFile(null);
    } catch {
      /* el motivo ya se mostró */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <Card>
        <CardHead title="Subir estado de cuenta" subtitle="Exporta los movimientos de tu banca en línea en CSV (Excel → Guardar como CSV).">
          <Button size="sm" variant="ghost" onClick={() => downloadSample(db)}>
            <Download size={15} /> CSV de ejemplo
          </Button>
        </CardHead>
        {!file && <FileDrop accept=".csv,.txt,text/csv" label="Arrastra el CSV del banco o toca para elegirlo" onFiles={read} />}
        {file && (
          <div className="stack">
            <div className="list-item">
              <div className="avatar">
                <FileSpreadsheet size={16} />
              </div>
              <div className="grow">
                <div className="title">{file.name}</div>
                <div className="faint">
                  {file.error || `${file.movements.length} depósito(s) · ${money(file.movements.reduce((s, m) => s + m.amount, 0))}`}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setFile(null)}>
                Cambiar
              </Button>
            </div>
            {!file.error && (
              <Button variant="primary" disabled={busy} onClick={reconcile}>
                <Landmark size={16} /> Conciliar {file.movements.length} depósito(s)
              </Button>
            )}
          </div>
        )}
        {summary && (
          <div className="banner info" style={{ marginTop: 12 }}>
            <Check size={16} /> {summary.matched} aplicado(s) por {money(summary.total)} · {summary.unmatched} por asignar
            {summary.duplicates ? ` · ${summary.duplicates} ya importado(s)` : ''}
          </div>
        )}
      </Card>

      <Card>
        <CardHead title="Depósitos por asignar" subtitle="No traían una referencia válida o el monto no coincide con el adeudo." />
        {unmatched.length === 0 && <Empty icon={<Check />}>No hay depósitos pendientes.</Empty>}
        <div className="list">
          {unmatched.map((m) => (
            <div key={m.id} className="list-item wrap">
              <div className="grow">
                <div className="title">
                  {money(m.amount)} · {day(m.date)}
                </div>
                <div className="faint">{m.description || 'Sin concepto'}</div>
                <div className="faint">
                  {m.unitId ? `${unitLabel(db, m.unitId)} · ` : ''}
                  {m.reason}
                </div>
              </div>
              <Button size="sm" variant="primary" onClick={() => setAssigning(m)}>
                <Link2 size={15} /> Asignar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Descartar depósito"
                onClick={() =>
                  actions.ignoreBankMovement(m.id).then(
                    () => toast('Depósito descartado', money(m.amount)),
                    () => {},
                  )
                }
              >
                <Trash2 size={15} />
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHead title="Historial de conciliación" />
        {processed.length === 0 && <Empty>Aún no se ha conciliado ningún estado de cuenta.</Empty>}
        <div className="list">
          {processed.slice(0, 50).map((m) => (
            <div key={m.id} className="list-item">
              <div className="grow">
                <div className="title">
                  {money(m.amount)} · {m.unitId ? unitLabel(db, m.unitId) : 'Sin casa'}
                </div>
                <div className="faint">
                  {day(m.date)} · {m.description || 'Sin concepto'}
                </div>
                {m.surplus > 0 && <div className="faint">Saldo a favor por aclarar: {money(m.surplus)}</div>}
              </div>
              <Badge tone={MV_STATUS[m.status][1]}>{MV_STATUS[m.status][0]}</Badge>
            </div>
          ))}
        </div>
      </Card>

      {assigning && <AssignModal mv={assigning} onClose={() => setAssigning(null)} />}
    </div>
  );
}

function AssignModal({ mv, onClose }) {
  const { db, actions, toast } = useStore();
  const [unitId, setUnitId] = useState(mv.unitId || '');
  const rows = unitId ? payableRows(db, unitId) : [];
  const [periods, setPeriods] = useState([]);
  const total = rows.filter((r) => periods.includes(r.month)).reduce((s, r) => s + r.amount, 0);
  const pickUnit = (id) => {
    setUnitId(id);
    setPeriods([]);
  };
  return (
    <Modal
      title={`Asignar depósito de ${money(mv.amount)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            disabled={!periods.length || total > mv.amount}
            onClick={() =>
              actions.assignBankMovement(mv.id, unitId, periods).then(
                () => {
                  toast('Depósito aplicado', `${unitLabel(db, unitId)} · se notificó al residente.`);
                  onClose();
                },
                () => {},
              )
            }
          >
            Aplicar
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="faint">
          {day(mv.date)} · {mv.description || 'Sin concepto'}
          {mv.reference ? ` · Ref. ${mv.reference}` : ''}
        </div>
        <Field label="Casa">
          <select className="input" value={unitId} onChange={(e) => pickUnit(e.target.value)}>
            <option value="">Elige la casa</option>
            {db.units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label} · {unitReference(db, u.id)}
              </option>
            ))}
          </select>
        </Field>
        {unitId && (
          <Field label="Meses que cubre">
            {rows.length === 0 ? (
              <div className="faint">Esta casa no tiene meses por pagar.</div>
            ) : (
              <div className="chips">
                {rows.map((r) => (
                  <button
                    key={r.month}
                    type="button"
                    className={`chip ${periods.includes(r.month) ? 'on' : ''}`}
                    onClick={() => setPeriods((p) => (p.includes(r.month) ? p.filter((x) => x !== r.month) : [...p, r.month]))}
                  >
                    {monthLabel(r.month)} · {money(r.amount)}
                  </button>
                ))}
              </div>
            )}
          </Field>
        )}
        {total > mv.amount && (
          <div className="banner warn">
            Los meses elegidos suman {money(total)} y el depósito es de {money(mv.amount)}. Elige menos meses o condona el recargo en
            Morosidad.
          </div>
        )}
        {periods.length > 0 && total < mv.amount && (
          <div className="faint">Sobran {money(mv.amount - total)}: quedan anotados en el historial como saldo a favor por aclarar.</div>
        )}
      </div>
    </Modal>
  );
}

/** Estado de cuenta de prueba con depósitos de las casas que deben (para probar la conciliación en la demo). */
function downloadSample(db) {
  const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  const today = fmt(new Date());
  const residents = db.users.filter((u) => u.role === 'resident');
  const debtors = residents.map((r) => ({ r, debt: debtOf(db, r.unitId) })).filter((x) => x.debt.months);
  const lines = ['Estado de cuenta - movimientos', 'Fecha;Concepto;Referencia;Cargo;Abono;Saldo'];
  debtors.slice(0, 2).forEach(({ r, debt }) => {
    lines.push(`${today};SPEI RECIBIDO ${r.name.toUpperCase()};${unitReference(db, r.unitId)};;${debt.amount.toFixed(2)};`);
  });
  if (debtors[2])
    lines.push(`${today};SPEI RECIBIDO ${debtors[2].r.name.toUpperCase()};${unitReference(db, debtors[2].r.unitId)};;500.00;`);
  lines.push(`${today};DEPOSITO EN EFECTIVO SUCURSAL;;;${db.settings.monthlyFee.toFixed(2)};`);
  lines.push(`${today};COMISION POR SERVICIO;;15.00;;`);
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'estado-de-cuenta-ejemplo.csv' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
