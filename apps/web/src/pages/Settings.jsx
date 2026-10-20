import { useState } from 'react';
import { billingSettings } from '@residencial/shared';
import { useStore } from '../data/store';
import { money, monthLabel, fmtDate } from '../lib/utils';
import { invoiceState } from './portal/Portal';
import { Badge, Button, Card, CardHead, Field, FileDrop, PageHead } from '../components/ui';
import { compressImage } from '../lib/utils';
import { coverOf, DEMO_COVER } from '../lib/cover';

export default function SettingsPage() {
  const { db, actions, toast, root, session, mode } = useStore();
  const res = root.platform.residencias.find((r) => r.id === session.tenantId);
  const plan = root.platform.plans.find((p) => p.id === res?.plan);
  const invoices = root.platform.invoices
    .filter((i) => i.tenantId === session.tenantId && i.status !== 'void')
    .sort((a, b) => b.period.localeCompare(a.period))
    .slice(0, 6);
  const INV = { paid: ['Pagado', 'ok'], pending: ['Pendiente', 'warn'], overdue: ['Vencido', 'bad'] };
  const s = db.settings;
  const billing = billingSettings(s);
  const [f, setF] = useState({
    lateFee: billing.lateFee,
    graceDays: billing.lateFeeGraceDays,
    ...billing.restrictions,
    name: s.name,
    monthlyFee: s.monthlyFee,
    dueDay: s.dueDay,
    bankName: s.bank.name,
    clabe: s.bank.clabe,
    holder: s.bank.holder,
    providers: s.generalProviders.join(', '),
  });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const toggle = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.checked }));

  function save() {
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
        bank: { name: f.bankName, clabe: f.clabe, holder: f.holder },
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
          <CardHead title="Cuenta para transferencias" />
          <div className="stack">
            <Field label="Banco">
              <input className="input" value={f.bankName} onChange={set('bankName')} />
            </Field>
            <Field label="CLABE">
              <input className="input mono" value={f.clabe} onChange={set('clabe')} />
            </Field>
            <Field label="Titular">
              <input className="input" value={f.holder} onChange={set('holder')} />
            </Field>
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
        <Card>
          <CardHead
            title="Suscripción"
            subtitle={plan ? `Plan ${plan.name} · ${money(plan.price)} al mes · hasta ${plan.maxUnits} unidades` : ''}
          />
          <div className="list">
            {invoices.map((i) => {
              const [l, t] = INV[invoiceState(i)] || ['', ''];
              return (
                <div key={i.id} className="list-item">
                  <div className="grow">
                    <div className="title">{monthLabel(i.period)}</div>
                    <div className="faint">
                      {i.status === 'paid' ? `Pagado el ${fmtDate(i.paidAt)}` : `Vence ${fmtDate(i.dueDate + 'T12:00')}`}
                    </div>
                  </div>
                  <b>{money(i.amount)}</b>
                  <Badge tone={t}>{l}</Badge>
                </div>
              );
            })}
          </div>
          <p className="faint" style={{ marginTop: 10 }}>
            La suscripción la administra la empresa. Si tienes dudas sobre un cargo, contáctala directamente.
          </p>
        </Card>
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
