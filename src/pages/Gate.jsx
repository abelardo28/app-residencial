import { useEffect, useRef, useState } from 'react';
import { ScanLine, UserPlus, Truck, Users, CheckCircle2, XCircle, Siren, LogOut, Keyboard, AlertTriangle } from 'lucide-react';
import { useStore, unitLabel } from '../data/store';
import { PASS_TYPES, normalizePlate } from '../services/access';
import { fmtTime, timeAgo } from '../lib/utils';
import QrScanner from '../components/QrScanner';
import PlateCapture from '../components/PlateCapture';
import { Badge, Button, Card, CardHead, Chips, Empty, Field, PageHead, Stat, Tabs } from '../components/ui';
import { describeValidity } from './Passes';

export default function Gate() {
  const { db, actions, toast } = useStore();
  const [tab, setTab] = useState('scan');
  const inside = db.accessLogs.filter((l) => !l.exitAt);
  const today = db.accessLogs.filter((l) => new Date(l.at).toDateString() === new Date().toDateString());
  const sos = db.sos.filter((s) => s.status === 'active');

  return (
    <>
      <PageHead title="Control de acceso" subtitle="Escanea el código del visitante y fotografía su placa." />

      {sos.map((s) => (
        <div key={s.id} className="banner bad" style={{ marginBottom: 12 }}>
          <Siren size={22} />
          <div style={{ flex: 1 }}>
            <b>{s.kind}</b> · {unitLabel(db, s.unitId)} · {db.users.find((u) => u.id === s.residentId)?.name} · {timeAgo(s.at)}
          </div>
          <Button size="sm" onClick={() => { actions.attendSos(s.id); toast('Alerta atendida', 'Se avisó al residente.'); }}>Atender</Button>
        </div>
      ))}

      <div className="grid g3 hide-sm" style={{ marginBottom: 16 }}>
        <Stat label="Accesos hoy" value={today.length} />
        <Stat label="Dentro ahora" value={inside.length} />
        <Stat label="Paquetes en caseta" value={db.packages.filter((p) => p.status === 'waiting').length} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <Tabs value={tab} onChange={setTab} items={[
          { value: 'scan', label: 'Escanear código', icon: <ScanLine size={16} /> },
          { value: 'walkin', label: 'Visita sin pase', icon: <UserPlus size={16} /> },
          { value: 'general', label: 'Acceso general', icon: <Truck size={16} /> },
          { value: 'inside', label: 'Dentro ahora', icon: <Users size={16} />, count: inside.length },
        ]} />
      </div>

      {tab === 'scan' && <ScanFlow />}
      {tab === 'walkin' && <WalkIn />}
      {tab === 'general' && <GeneralAccess />}
      {tab === 'inside' && <Inside logs={inside} />}
    </>
  );
}

function ScanFlow() {
  const { db, actions, toast } = useStore();
  const [manual, setManual] = useState('');
  const [result, setResult] = useState(null);
  const [plate, setPlate] = useState('');
  const [photo, setPhoto] = useState('');
  const [companions, setCompanions] = useState(0);
  const [notes, setNotes] = useState('');

  const resultRef = useRef();
  const check = (text) => {
    const r = actions.checkCode(text);
    navigator.vibrate?.(r.ok ? 60 : [90, 60, 90]); // confirmación táctil en el celular del vigilante
    setResult(r); setPlate(''); setPhoto(''); setCompanions(0); setNotes('');
  };
  useEffect(() => {
    if (result && window.innerWidth <= 760) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [result]);
  const reset = () => { setResult(null); setManual(''); };

  function admit() {
    try {
      const log = actions.registerEntry({ passId: result.pass.id, plate, photo, companions: Number(companions), notes });
      toast('Acceso registrado', `${log.visitorName} → ${unitLabel(db, log.unitId)}. Se notificó al residente.`);
      reset();
    } catch (e) {
      setResult({ ...result, ok: false, reason: e.message });
    }
  }

  const p = result?.pass;
  const mismatch = p?.expectedPlate && plate && normalizePlate(plate) !== p.expectedPlate;

  return (
    <div className="gate-grid">
      <Card>
        <CardHead title="Lector" subtitle="Apunta la cámara al QR del visitante" />
        {!result && <QrScanner onScan={check} />}
        {result && <Button className="block" onClick={reset}><ScanLine size={16} /> Escanear otro</Button>}
        <div className="divider" style={{ margin: '16px 0' }} />
        <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); check(manual); }}>
          <Keyboard size={16} className="muted hide-sm" />
          <input className="input mono" style={{ flex: 1 }} value={manual} onChange={(e) => setManual(e.target.value.toUpperCase())} placeholder="Código de 6 caracteres" maxLength={8} />
          <Button type="submit">Validar</Button>
        </form>
        <p className="faint" style={{ marginTop: 8 }}>Prueba con el código <span className="mono">K7M2QX</span> de la demo.</p>
      </Card>

      <div className="stack" style={{ gap: 16 }}>
        <Card>
        <div ref={resultRef} style={{ scrollMarginTop: 70 }} />
        {!result && <Empty icon={<ScanLine />}>El resultado de la validación aparecerá aquí.</Empty>}
        {result && !result.ok && (
          <div className="verdict bad">
            <XCircle size={28} />
            <div>
              <div className="t">Acceso denegado</div>
              <div>{result.reason}</div>
              {p && <div className="faint" style={{ marginTop: 6 }}>{p.visitorName} · {unitLabel(db, p.unitId)}</div>}
            </div>
          </div>
        )}
        {result?.ok && (
          <div className="stack">
            <div className="verdict ok">
              <CheckCircle2 size={28} />
              <div>
                <div className="t">Código válido</div>
                <div><b>{p.visitorName}</b> · {PASS_TYPES[p.type]}</div>
                <div>Visita a {unitLabel(db, p.unitId)} ({db.users.find((u) => u.id === p.residentId)?.name})</div>
                <div className="faint" style={{ color: 'inherit', opacity: 0.8 }}>{describeValidity(p)}</div>
              </div>
            </div>
            {p.notes && <div className="banner info">{p.notes}</div>}
            <PlateCapture plate={plate} onPlate={setPlate} photo={photo} onPhoto={setPhoto} />
            {p.expectedPlate && <div className="faint">Placa registrada por el residente: <span className="mono">{p.expectedPlate}</span></div>}
            {mismatch && <div className="banner warn"><AlertTriangle size={18} /> La placa no coincide con la registrada. Se avisará al residente y a administración.</div>}
            <div className="grid g2">
              <Field label="Acompañantes"><input type="number" min={0} className="input" value={companions} onChange={(e) => setCompanions(e.target.value)} /></Field>
              <Field label="Observaciones"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            </div>
            <Button variant="primary" size="lg" className="sticky-action" onClick={admit}><CheckCircle2 size={18} /> Registrar entrada</Button>
          </div>
        )}
        </Card>
        <RecentEntries />
      </div>
    </div>
  );
}

// En escritorio aprovecha el espacio para mostrar los accesos más recientes.
function RecentEntries() {
  const { db } = useStore();
  const logs = db.accessLogs.slice(0, 6);
  return (
    <Card className="hide-sm">
      <CardHead title="Últimos accesos" subtitle="Registros más recientes de la caseta" />
      {logs.length === 0 && <Empty>Sin registros.</Empty>}
      <div className="list cols-lg">
        {logs.map((l) => (
          <div key={l.id} className="list-item">
            {l.photo ? <img src={l.photo} className="thumb" alt="" /> : <div className="avatar"><Users size={16} /></div>}
            <div className="grow">
              <div className="title">{l.visitorName}</div>
              <div className="faint">{l.unitId ? unitLabel(db, l.unitId) : 'General'} · {fmtTime(l.at)}{l.plate ? ` · ${l.plate}` : ''}</div>
            </div>
            {l.exitAt ? <Badge>Salió</Badge> : <Badge tone="ok">Dentro</Badge>}
          </div>
        ))}
      </div>
    </Card>
  );
}

function WalkIn() {
  const { db, actions, toast } = useStore();
  const empty = { visitorName: '', type: 'paqueteria', unitId: '', plate: '', photo: '', notes: '' };
  const [f, setF] = useState(empty);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const occupied = db.units.filter((u) => db.users.some((r) => r.unitId === u.id));

  function submit() {
    if (!f.visitorName || !f.unitId) return toast('Faltan datos', 'Indica nombre y domicilio.', 'bad');
    actions.registerEntry(f);
    toast('Visita registrada', `Se notificó a ${unitLabel(db, f.unitId)}.`);
    setF(empty);
  }

  return (
    <div className="grid g2">
      <Card>
        <CardHead title="Datos de la visita" subtitle="Para visitas sin código. El residente recibirá un aviso al momento." />
        <div className="stack">
          <Field label="Nombre"><input className="input" value={f.visitorName} onChange={set('visitorName')} /></Field>
          <Field label="Tipo"><Chips value={f.type} onChange={set('type')} options={Object.entries(PASS_TYPES).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Domicilio que visita">
            <select className="select" value={f.unitId} onChange={set('unitId')}>
              <option value="">Selecciona…</option>
              {occupied.map((u) => <option key={u.id} value={u.id}>{u.label} · {db.users.filter((r) => r.unitId === u.id).map((r) => r.name).join(', ')}</option>)}
            </select>
          </Field>
          <Field label="Observaciones"><input className="input" value={f.notes} onChange={set('notes')} placeholder="Identificación, motivo…" /></Field>
        </div>
      </Card>
      <Card>
        <CardHead title="Vehículo" />
        <div className="stack">
          <PlateCapture plate={f.plate} onPlate={set('plate')} photo={f.photo} onPhoto={set('photo')} />
          <Button variant="primary" size="lg" className="sticky-action" onClick={submit}>Registrar entrada</Button>
        </div>
      </Card>
    </div>
  );
}

function GeneralAccess() {
  const { db, actions, toast } = useStore();
  const [provider, setProvider] = useState(db.settings.generalProviders[0]);
  const [custom, setCustom] = useState('');
  const [plate, setPlate] = useState('');
  const [photo, setPhoto] = useState('');
  const [notes, setNotes] = useState('');
  const name = provider === '__other' ? custom : provider;

  function submit() {
    if (!name) return;
    actions.generalAccess({ provider: name, plate, photo, notes });
    toast('Acceso general registrado', 'Se notificó a todos los residentes.');
    setPlate(''); setPhoto(''); setNotes(''); setCustom('');
  }
  return (
    <div className="grid g2">
      <Card>
        <CardHead title="Servicio general" subtitle="Se enviará una notificación a todos los residentes." />
        <div className="stack">
          <Chips value={provider} onChange={setProvider} options={[...db.settings.generalProviders.map((p) => ({ value: p, label: p })), { value: '__other', label: 'Otro' }]} />
          {provider === '__other' && <Field label="Nombre del servicio"><input className="input" value={custom} onChange={(e) => setCustom(e.target.value)} /></Field>}
          <Field label="Mensaje para residentes (opcional)"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej. saquen sus bolsas antes de las 10:00" /></Field>
        </div>
      </Card>
      <Card>
        <CardHead title="Vehículo" />
        <div className="stack">
          <PlateCapture plate={plate} onPlate={setPlate} photo={photo} onPhoto={setPhoto} />
          <Button variant="primary" size="lg" className="sticky-action" onClick={submit}><Truck size={18} /> Registrar y avisar a todos</Button>
        </div>
      </Card>
    </div>
  );
}

function Inside({ logs }) {
  const { db, actions } = useStore();
  return (
    <Card>
      {logs.length === 0 && <Empty icon={<Users />}>No hay visitas dentro del residencial.</Empty>}
      <div className="list">
        {logs.map((l) => (
          <div key={l.id} className="list-item">
            {l.photo ? <img src={l.photo} className="thumb" alt="" /> : <div className="avatar"><Users size={16} /></div>}
            <div className="grow">
              <div className="title">{l.visitorName}</div>
              <div className="faint">{l.unitId ? unitLabel(db, l.unitId) : 'Acceso general'} · entró {fmtTime(l.at)} {l.plate && <>· <span className="mono">{l.plate}</span></>}</div>
            </div>
            {l.plateMatch === false && <Badge tone="warn">Placa distinta</Badge>}
            <Button size="sm" onClick={() => actions.registerExit(l.id)}><LogOut size={15} /> Salida</Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
