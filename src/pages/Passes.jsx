import { useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Plus, QrCode, Share2, Download, Ban, Clock, Repeat, Car } from 'lucide-react';
import { useStore } from '../data/store';
import { PASS_TYPES, passStatus } from '../services/access';
import { DAYS, fmtDateTime, toLocalInput, fmtTime } from '../lib/utils';
import { Badge, Button, Card, Chips, Empty, Field, Modal, PageHead, Tabs } from '../components/ui';

const DURATIONS = [
  { value: 2, label: '2 horas' },
  { value: 4, label: '4 horas' },
  { value: 8, label: '8 horas' },
  { value: 24, label: '1 día' },
  { value: 72, label: '3 días' },
  { value: 0, label: 'Personalizado' },
];

export function describeValidity(p) {
  if (p.mode === 'recurrent') {
    return `${p.days.map((d) => DAYS[d]).join(', ')} · ${p.timeFrom}–${p.timeTo} · hasta ${new Date(p.validTo).toLocaleDateString('es-MX')}`;
  }
  return `${fmtDateTime(p.validFrom)} → ${fmtTime(p.validTo)}${new Date(p.validTo).toDateString() !== new Date(p.validFrom).toDateString() ? ` (${new Date(p.validTo).toLocaleDateString('es-MX')})` : ''}`;
}

export default function Passes() {
  const { db, me, actions } = useStore();
  const [tab, setTab] = useState('active');
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(null);

  const mine = db.passes.filter((p) => p.unitId === me.unitId);
  const active = mine.filter((p) => ['Activo', 'Programado'].includes(passStatus(p).label));
  const history = mine.filter((p) => !active.includes(p));
  const list = tab === 'active' ? active : history;

  return (
    <>
      <PageHead title="Pases de acceso" subtitle="Genera un código que expira solo y compártelo con tu visita." fab={{ icon: <Plus size={18} />, label: 'Nuevo pase', onClick: () => setCreating(true) }}>
        <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> Nuevo pase</Button>
      </PageHead>
      <div style={{ marginBottom: 16 }}>
        <Tabs value={tab} onChange={setTab} items={[{ value: 'active', label: 'Vigentes', count: active.length }, { value: 'history', label: 'Historial' }]} />
      </div>
      <Card>
        {list.length === 0 && <Empty icon={<QrCode />}>{tab === 'active' ? 'No tienes pases vigentes.' : 'Aún no hay historial.'}</Empty>}
        <div className="list cols-lg">
          {list.map((p) => {
            const st = passStatus(p);
            return (
              <div key={p.id} className="list-item">
                <div className="avatar">{p.mode === 'recurrent' ? <Repeat size={17} /> : <QrCode size={17} />}</div>
                <div className="grow">
                  <div className="title">{p.visitorName}</div>
                  <div className="faint">{PASS_TYPES[p.type]} · {describeValidity(p)}</div>
                  {p.uses.length > 0 && <div className="faint">Usado {p.uses.length} {p.uses.length === 1 ? 'vez' : 'veces'} · último {fmtDateTime(p.uses.at(-1).at)}</div>}
                </div>
                <Badge tone={st.tone}>{st.label}</Badge>
                <Button size="sm" onClick={() => setViewing(p)}>Ver</Button>
              </div>
            );
          })}
        </div>
      </Card>

      {creating && <CreatePass onClose={() => setCreating(false)} onCreated={(p) => { setCreating(false); setViewing(p); }} />}
      {viewing && <PassView pass={db.passes.find((p) => p.id === viewing.id) || viewing} onClose={() => setViewing(null)} onRevoke={(id) => { actions.revokePass(id); setViewing(null); }} />}
    </>
  );
}

function CreatePass({ onClose, onCreated }) {
  const { actions } = useStore();
  const [f, setF] = useState({
    visitorName: '', type: 'familiar', mode: 'single', start: toLocalInput(new Date()), hours: 4, end: toLocalInput(Date.now() + 4 * 3600e3),
    maxUses: 2, days: [1, 2, 3, 4, 5], timeFrom: '08:00', timeTo: '18:00', untilDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    expectedPlate: '', notes: '',
  });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const [err, setErr] = useState('');

  function submit() {
    if (!f.visitorName.trim()) return setErr('Escribe el nombre de la visita.');
    let validFrom, validTo;
    if (f.mode === 'recurrent') {
      if (!f.days.length) return setErr('Elige al menos un día.');
      validFrom = new Date(f.start.slice(0, 10) + 'T00:00').toISOString();
      validTo = new Date(f.untilDate + 'T23:59').toISOString();
    } else {
      validFrom = new Date(f.start).toISOString();
      validTo = f.hours ? new Date(new Date(f.start).getTime() + f.hours * 3600e3).toISOString() : new Date(f.end).toISOString();
    }
    if (new Date(validTo) <= new Date(validFrom)) return setErr('La fecha de término debe ser posterior al inicio.');
    const pass = actions.createPass({
      visitorName: f.visitorName.trim(), type: f.type, mode: f.mode, validFrom, validTo, expectedPlate: f.expectedPlate, notes: f.notes,
      maxUses: f.mode === 'multi' ? Number(f.maxUses) : 1, days: f.mode === 'recurrent' ? f.days : [], timeFrom: f.mode === 'recurrent' ? f.timeFrom : '00:00', timeTo: f.mode === 'recurrent' ? f.timeTo : '23:59',
    });
    onCreated(pass);
  }

  return (
    <Modal title="Nuevo pase de acceso" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={submit}>Generar código</Button></>}>
      <div className="stack">
        <Field label="¿Quién te visita?"><input className="input" value={f.visitorName} onChange={set('visitorName')} placeholder="Nombre o empresa" autoFocus /></Field>
        <Field label="Tipo de visita"><Chips value={f.type} onChange={set('type')} options={Object.entries(PASS_TYPES).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Uso del código">
          <Chips value={f.mode} onChange={set('mode')} options={[{ value: 'single', label: 'Una sola entrada' }, { value: 'multi', label: 'Varias entradas' }, { value: 'recurrent', label: 'Recurrente (personal)' }]} />
        </Field>

        {f.mode !== 'recurrent' ? (
          <>
            <Field label="Válido desde"><input type="datetime-local" className="input" value={f.start} onChange={set('start')} /></Field>
            <Field label="Duración"><Chips value={f.hours} onChange={set('hours')} options={DURATIONS} /></Field>
            {!f.hours && <Field label="Válido hasta"><input type="datetime-local" className="input" value={f.end} onChange={set('end')} /></Field>}
            {f.mode === 'multi' && <Field label="Número de entradas"><input type="number" min={2} max={50} className="input" value={f.maxUses} onChange={set('maxUses')} /></Field>}
          </>
        ) : (
          <>
            <Field label="Días permitidos"><Chips multi value={f.days} onChange={set('days')} options={DAYS.map((d, i) => ({ value: i, label: d }))} /></Field>
            <div className="grid g2">
              <Field label="Desde las"><input type="time" className="input" value={f.timeFrom} onChange={set('timeFrom')} /></Field>
              <Field label="Hasta las"><input type="time" className="input" value={f.timeTo} onChange={set('timeTo')} /></Field>
            </div>
            <Field label="Vigente hasta"><input type="date" className="input" value={f.untilDate} onChange={set('untilDate')} /></Field>
          </>
        )}
        <Field label="Placa esperada (opcional)" hint="Si el vehículo llega con otra placa, se te avisará.">
          <input className="input mono" value={f.expectedPlate} onChange={(e) => set('expectedPlate')(e.target.value.toUpperCase())} placeholder="ABC123D" />
        </Field>
        <Field label="Indicaciones para caseta (opcional)"><input className="input" value={f.notes} onChange={set('notes')} placeholder="Ej. trae herramientas, viene en motocicleta" /></Field>
        {err && <div className="banner bad">{err}</div>}
      </div>
    </Modal>
  );
}

function PassView({ pass, onClose, onRevoke }) {
  const { db } = useStore();
  const ref = useRef();
  const [big, setBig] = useState(false);
  const st = passStatus(pass);
  const shareText = `${db.settings.name}\nPase para: ${pass.visitorName}\nCódigo: ${pass.code}\nVigencia: ${describeValidity(pass)}\nMuestra este código en caseta.`;

  async function share() {
    const canvas = ref.current?.querySelector('canvas');
    try {
      if (canvas && navigator.canShare) {
        const blob = await new Promise((r) => canvas.toBlob(r));
        const file = new File([blob], `pase-${pass.code}.png`, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) return await navigator.share({ files: [file], text: shareText });
      }
      if (navigator.share) return await navigator.share({ text: shareText });
      await navigator.clipboard.writeText(shareText);
      alert('Datos del pase copiados. Pégalos en WhatsApp o mensaje.');
    } catch { /* el usuario canceló */ }
  }
  function download() {
    const a = document.createElement('a');
    a.href = ref.current.querySelector('canvas').toDataURL('image/png');
    a.download = `pase-${pass.code}.png`;
    a.click();
  }

  return (
    <Modal title="Pase de acceso" onClose={onClose}>
      <div className="pass">
        <div className="row between" style={{ position: 'relative' }}>
          <div>
            <div className="faint">{db.settings.name}</div>
            <h2 style={{ marginTop: 2 }}>{pass.visitorName}</h2>
            <div className="faint">{PASS_TYPES[pass.type]}</div>
          </div>
          <span className="badge" style={{ background: 'rgba(255,255,255,.14)', color: '#fff' }}>{st.label}</span>
        </div>
        <div style={{ display: 'grid', placeItems: 'center', margin: '20px 0 12px', position: 'relative' }} ref={ref}>
          <div className="qr" onClick={() => setBig(true)} title="Toca para agrandar" style={{ cursor: 'zoom-in', opacity: st.tone === 'ok' || st.tone === 'info' ? 1 : 0.35 }}>
            <QRCodeCanvas value={pass.token} size={208} level="M" marginSize={0} />
          </div>
          <div className="code" style={{ marginTop: 14 }}>{pass.code}</div>
          <div className="faint show-sm" style={{ marginTop: 4 }}>Toca el código QR para mostrarlo en grande</div>
        </div>
        <div className="stack" style={{ gap: 6, position: 'relative' }}>
          <div className="row"><Clock size={15} /> <span>{describeValidity(pass)}</span></div>
          {pass.mode === 'multi' && <div className="row"><Repeat size={15} /> {pass.uses.length} de {pass.maxUses} entradas usadas</div>}
          {pass.expectedPlate && <div className="row"><Car size={15} /> Placa esperada <span className="mono">{pass.expectedPlate}</span></div>}
        </div>
      </div>
      {big && (
        <div className="qr-full" onClick={() => setBig(false)}>
          <QRCodeCanvas value={pass.token} size={Math.min(window.innerWidth, window.innerHeight) * 0.78} level="M" marginSize={2} />
          <div className="code mono">{pass.code}</div>
          <div className="faint">{pass.visitorName} · toca para cerrar</div>
        </div>
      )}
      <div className="row" style={{ marginTop: 16 }}>
        <Button variant="primary" onClick={share}><Share2 size={16} /> Compartir</Button>
        <Button onClick={download}><Download size={16} /> Descargar</Button>
        <div style={{ flex: 1 }} />
        {(st.tone === 'ok' || st.tone === 'info') && <Button variant="ghost" className="danger" onClick={() => onRevoke(pass.id)}><Ban size={16} /> Cancelar pase</Button>}
      </div>
    </Modal>
  );
}
