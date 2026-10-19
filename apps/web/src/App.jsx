import { Component } from 'react';
import { HashRouter, MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { StoreProvider, useStore, resetStorage } from './data/store';
import Layout from './components/Layout';
import Auth from './pages/auth/Auth';
import PortalRoutes from './pages/portal/Portal';
import ResidentHome from './pages/ResidentHome';
import AdminHome from './pages/AdminHome';
import Gate from './pages/Gate';
import Passes from './pages/Passes';
import AccessLog from './pages/AccessLog';
import Payments from './pages/Payments';
import Notices from './pages/Notices';
import Reservations from './pages/Reservations';
import Incidents from './pages/Incidents';
import Packages from './pages/Packages';
import Polls from './pages/Polls';
import Finances from './pages/Finances';
import People from './pages/People';
import SettingsPage from './pages/Settings';

function Home() {
  const { me } = useStore();
  if (me.role === 'guard') return <Gate />;
  if (me.role === 'admin') return <AdminHome />;
  return <ResidentHome />;
}

// Restringe rutas por rol
function Only({ roles, children }) {
  const { me } = useStore();
  return roles.includes(me.role) ? children : <Navigate to="/" replace />;
}

function Routed() {
  const { me, session, staffMe } = useStore();
  if (session?.kind === 'platform' && staffMe) return <PortalRoutes />;
  if (!me) return <Auth />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="pases" element={<Only roles={['resident']}><Passes /></Only>} />
        <Route path="accesos" element={<AccessLog />} />
        <Route path="pagos" element={<Only roles={['resident', 'admin']}><Payments /></Only>} />
        <Route path="avisos" element={<Notices />} />
        <Route path="reservas" element={<Only roles={['resident', 'admin']}><Reservations /></Only>} />
        <Route path="reportes" element={<Only roles={['resident', 'admin']}><Incidents /></Only>} />
        <Route path="paquetes" element={<Packages />} />
        <Route path="votaciones" element={<Only roles={['resident', 'admin']}><Polls /></Only>} />
        <Route path="finanzas" element={<Only roles={['resident', 'admin']}><Finances /></Only>} />
        <Route path="usuarios" element={<Only roles={['admin']}><People /></Only>} />
        <Route path="configuracion" element={<Only roles={['admin']}><SettingsPage /></Only>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

// Cuando la app corre incrustada (vista previa, iframe sin URL propia) la navegación por URL
// falla, así que se usa un enrutador en memoria. En su propio dominio se usa la URL con #.
const embedded = (() => {
  try {
    return window.self !== window.top || !/^https?:$/.test(window.location.protocol);
  } catch {
    return true;
  }
})();
const Router = embedded ? MemoryRouter : HashRouter;

class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="login">
        <div className="card" style={{ maxWidth: 520 }}>
          <h2>Algo salió mal</h2>
          <p className="muted" style={{ margin: '8px 0 16px' }}>No se pudo mostrar esta pantalla. Puedes volver a intentarlo o restablecer los datos de prueba.</p>
          <p className="faint mono" style={{ marginBottom: 16 }}>{String(this.state.error?.message || this.state.error)}</p>
          <div className="row">
            <button className="btn" onClick={() => this.setState({ error: null })}>Reintentar</button>
            <button className="btn primary" onClick={() => { resetStorage(); window.location.reload(); }}>Restablecer datos</button>
          </div>
        </div>
      </div>
    );
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <StoreProvider>
        <Router>
          <Routed />
        </Router>
      </StoreProvider>
    </ErrorBoundary>
  );
}
