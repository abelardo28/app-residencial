import { useState } from 'react';
import { bankAccounts, billingSettings, gateSettings } from '@residencial/shared';
import { Link } from 'react-router-dom';
import { useStore } from '../data/store';
import { SubscriptionCard } from '../components/Subscription';
import { Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardHead, Field, FileDrop, PageHead } from '../components/ui';
import { compressImage } from '../lib/utils';
import { coverOf, DEMO_COVER } from '../lib/cover';

export default function SettingsPage() {
  const { db, actions, toast, mode } = useStore();
  const s = db.settings;
  const billing = billingSettings(s);
  const [gate, setGate] = useState(gateSettings(s));
  const [wa, setWa] = useState({ enabled: false, notices: true, reminders: true, number: '', ...(s.whatsapp || {}) });
  const flag = (setter, k) => (e) => setter((x) => ({ ...x, [k]: e.target.checked }));
  const [f, setF] = useState({
    lateFee: billing.lateFee,
    graceDays: billing.lateFeeGraceDays,
    ...billing.restrictions,
    name: s.name,
    monthlyFee: s.monthlyFee,
    dueDay: s.dueDay,
    providers: s.generalProviders.join(', '),
  });
  const [banks, setBanks] = useState(() => bankAccounts(s).map((a) => ({ alias: '', ...a })));
  const setBank = (i, k) => (e) => setBanks((list) => list.map((a, j) => (j === i ? { ...a, [k]: e.target.value } : a)));
  const makePrimary = (i) => setBanks((list) => list.map((a, j) => ({ ...a, primary: j === i })));
  const holder = banks[0]?.holder || s.name;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const toggle = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.checked }));

  function save() {
    const incomplete = banks.find((a) => (a.clabe || a.name || a.alias) && !(a.clabe.trim() && a.name.trim() && a.holder.trim()));
    if (incomplete) return toast('Completa la cuenta', 'Cada cuenta necesita banco, CLABE y titular.', 'bad');
    actions
      .updateSettings({
        name: f.name,
        monthlyFee: Number(f.monthlyFee),
        dueDay: Number(f.dueDay),
        lateFee: Number(f.lateFee) || 0,
        lateFeeGraceDays: Number(f.graceDays) || 0,
        restrictions: {
          enabled: f.enabled,
          minMonths: Math.max(1, Number(f.minMonths) || 1),
          reservations: f.reservations,
          recurrentPasses: f.recurrentPasses,
        },
        bankAccounts: banks
          .filter((a) => a.clabe.trim())
          .map(({ id, alias, name, clabe, holder: h, primary }) => ({
            ...(id ? { id } : {}),
            alias,
            name,
            clabe,
            holder: h,
            primary: !!primary,
          })),
        gate,
        whatsapp: wa,
        generalProviders: f.providers
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      })
      .then(
        () => toast('Configuración guardada', ''),
        () => {},
      );
  }

  return (
    <>
      <PageHead keep title="Configuración">
        <Button variant="primary" onClick={save}>
          Guardar cambios
        </Button>
      </PageHead>
      <div className="grid g2">
        <Card>
          <CardHead title="Residencial" />
          <div className="stack">
            <Field label="Nombre">
              <input className="input" value={f.name} onChange={set('name')} />
            </Field>
            <div className="grid g2">
              <Field label="Cuota mensual (MXN)">
                <input type="number" className="input" value={f.monthlyFee} onChange={set('monthlyFee')} />
              </Field>
              <Field label="Día de vencimiento">
                <input type="number" min={1} max={28} className="input" value={f.dueDay} onChange={set('dueDay')} />
              </Field>
            </div>
            <Field label="Servicios de acceso general" hint="Separados por coma. Al registrarlos se avisa a todos los residentes.">
              <textarea className="textarea" value={f.providers} onChange={set('providers')} />
            </Field>
          </div>
        </Card>
        <Card>
          <CardHead
            title="Cuentas para transferencias"
            subtitle="Los residentes ven todas; la principal aparece primero y es la que se manda por WhatsApp primero."
          />
          <div className="stack">
            {banks.map((a, i) => (
              <div key={a.id || i} className="account-edit">
                <div className="row between">
                  <label className="row" style={{ gap: 8 }}>
                    <input type="radio" name="primary-bank" checked={!!a.primary} onChange={() => makePrimary(i)} /> Principal
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Quitar cuenta"
                    onClick={() =>
                      setBanks((list) => {
                        const rest = list.filter((_, j) => j !== i);
                        return a.primary && rest.length ? rest.map((x, j) => ({ ...x, primary: j === 0 })) : rest;
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
                <Field label="Para qué es (opcional)" hint="Por ejemplo: Cuotas de mantenimiento, Reservas">
                  <input className="input" value={a.alias} onChange={setBank(i, 'alias')} />
                </Field>
                <Field label="Banco">
                  <input className="input" value={a.name} onChange={setBank(i, 'name')} />
                </Field>
                <Field label="CLABE">
                  <input className="input mono" inputMode="numeric" value={a.clabe} onChange={setBank(i, 'clabe')} />
                </Field>
                <Field label="Titular">
                  <input className="input" value={a.holder} onChange={setBank(i, 'holder')} />
                </Field>
              </div>
            ))}
            {banks.length < 10 && (
              <Button onClick={() => setBanks((list) => [...list, { alias: '', name: '', clabe: '', holder, primary: !list.length }])}>
                <Plus size={16} /> Agregar cuenta
              </Button>
            )}
          </div>
        </Card>
        <Card>
          <CardHead title="Recargos y restricciones" subtitle="Aplícalos sólo si están aprobados en el reglamento o la asamblea." />
          <div className="stack">
            <div className="grid g2">
              <Field label="Recargo por mes vencido (MXN)" hint="0 = sin recargo">
                <input type="number" min={0} className="input" value={f.lateFee} onChange={set('lateFee')} />
              </Field>
              <Field label="Días de tolerancia" hint="Después del día de vencimiento">
                <input type="number" min={0} max={28} className="input" value={f.graceDays} onChange={set('graceDays')} />
              </Field>
            </div>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={f.enabled} onChange={toggle('enabled')} /> Restringir servicios por adeudo
            </label>
            {f.enabled && (
              <>
                <Field label="A partir de cuántos meses vencidos">
                  <input type="number" min={1} max={12} className="input" value={f.minMonths} onChange={set('minMonths')} />
                </Field>
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={f.reservations} onChange={toggle('reservations')} /> Reservar áreas comunes
                </label>
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={f.recurrentPasses} onChange={toggle('recurrentPasses')} /> Pases recurrentes o de varias
                  entradas
                </label>
              </>
            )}
            <p className="faint">El acceso a la vivienda y los pases de una sola visita nunca se bloquean.</p>
          </div>
        </Card>
        <Card>
          <CardHead title="WhatsApp" subtitle="Los residentes crean pases, consultan su saldo y reciben avisos sin instalar la app." />
          <div className="stack">
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={wa.enabled} onChange={flag(setWa, 'enabled')} /> Activar el asistente y los avisos por
              WhatsApp
            </label>
            {wa.enabled && (
              <>
                <Field label="Número de WhatsApp del residencial" hint="Se muestra a los residentes para que le escriban.">
                  <input
                    className="input"
                    value={wa.number}
                    onChange={(e) => setWa((x) => ({ ...x, number: e.target.value }))}
                    placeholder="+52 55 0000 0000"
                  />
                </Field>
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={wa.notices} onChange={flag(setWa, 'notices')} /> Enviar los avisos nuevos
                </label>
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={wa.reminders} onChange={flag(setWa, 'reminders')} /> Enviar los recordatorios de pago
                </label>
                <p className="faint">Cada residente puede responder BAJA para dejar de recibir avisos.</p>
              </>
            )}
          </div>
        </Card>
        <Card>
          <CardHead title="Caseta física" subtitle="Cómo se comportan las plumas conectadas.">
            <Link to="/caseta" className="btn sm ghost">
              Equipos y tags
            </Link>
          </CardHead>
          <div className="stack">
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={gate.autoOpenOnPass} onChange={flag(setGate, 'autoOpenOnPass')} /> Abrir la pluma al registrar
              una visita con pase válido
            </label>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={gate.autoOpenResidentPlates} onChange={flag(setGate, 'autoOpenResidentPlates')} /> Abrir sola
              con la placa de un residente
            </label>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={gate.residentOpen} onChange={flag(setGate, 'residentOpen')} /> Permitir a los residentes abrir
              la pluma desde la app
            </label>
          </div>
        </Card>
        <Card>
          <CardHead title="Integraciones" />
          <div className="stack">
            <div className="row between">
              <span>Ecart Pay</span>
              <Badge tone={mode === 'api' ? 'ok' : 'warn'}>{mode === 'api' ? 'Configurado en el servidor' : 'Modo de prueba'}</Badge>
            </div>
            <div className="row between">
              <span>Notificaciones push</span>
              <Badge tone={import.meta.env.VITE_VAPID_PUBLIC_KEY ? 'ok' : 'warn'}>
                {import.meta.env.VITE_VAPID_PUBLIC_KEY ? 'Web Push' : 'Solo en dispositivo'}
              </Badge>
            </div>
            <div className="row between">
              <span>Lectura de placas (OCR)</span>
              <Badge tone="ok">En el navegador</Badge>
            </div>
            <p className="faint">Las llaves se configuran en el archivo .env del proyecto. Consulta el README.</p>
          </div>
        </Card>
        <Card>
          <CardHead
            title="Foto de portada"
            subtitle="Se muestra de fondo, con transparencia, en el encabezado de residentes, vigilancia y administración."
          />
          <div className="stack">
            <div className="cover-preview">
              {coverOf(s) ? <img src={coverOf(s)} alt="Portada del residencial" /> : null}
              <span>{s.name}</span>
            </div>
            <FileDrop
              accept="image/*"
              label="Sube una foto de la fachada o entrada (horizontal)"
              onFiles={async ([file]) => {
                if (!file?.type.startsWith('image/')) return toast('Elige una imagen', 'JPG o PNG.', 'bad');
                const cover = await compressImage(file, 1600, 0.74);
                actions.updateSettings({ cover }).then(
                  () => toast('Portada actualizada', 'Ya se ve en el encabezado de todos los usuarios.'),
                  () => {},
                );
              }}
            />
            <div className="row">
              {coverOf(s) !== DEMO_COVER && (
                <Button size="sm" onClick={() => actions.updateSettings({ cover: '' })}>
                  Usar foto de ejemplo
                </Button>
              )}
              {coverOf(s) && (
                <Button size="sm" variant="ghost" className="danger" onClick={() => actions.updateSettings({ cover: null })}>
                  Quitar portada
                </Button>
              )}
            </div>
          </div>
        </Card>
        <SubscriptionCard />
        {mode === 'demo' && (
          <Card>
            <CardHead title="Datos de demostración" />
            <p className="muted" style={{ marginBottom: 12 }}>
              Restablece todos los registros y cuentas a los datos de ejemplo iniciales y cierra la sesión.
            </p>
            <Button className="danger" onClick={() => confirm('¿Borrar todos los datos y restaurar la demo?') && actions.resetDemo()}>
              Restablecer demo
            </Button>
          </Card>
        )}
      </div>
    </>
  );
}
