// Punto de entrada de los datos. Según VITE_DATA_MODE la APP usa:
//   api   la API del servidor (apps/api): fuente de verdad, sesiones seguras y datos filtrados por rol
//   demo  una simulación completa en el navegador (localStorage) para probar sin servidor
import { lazy, Suspense } from 'react';

export { useStore, unitLabel, userName } from './context';
export { ACCOUNT_STATUS } from '@residencial/shared';
export { resetStorage } from './demo/storage';

export const DATA_MODE = import.meta.env.VITE_DATA_MODE === 'demo' ? 'demo' : 'api';
// Ayudas de prueba (cuentas de ejemplo, buzón de mensajes): en la demo y en desarrollo, nunca en producción.
export const SHOW_DEMO_HELP = DATA_MODE === 'demo' || import.meta.env.DEV;

// Sólo se descarga el proveedor que se usa
const Provider = lazy(() => (DATA_MODE === 'demo' ? import('./demo/DemoProvider') : import('./api/ApiProvider')));

export function StoreProvider({ children }) {
  return (
    <Suspense fallback={<div className="boot">Cargando…</div>}>
      <Provider>{children}</Provider>
    </Suspense>
  );
}
