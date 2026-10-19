// Contexto de datos de la APP. Lo llena el proveedor activo (API o demo) con la misma forma:
// { mode, root, db, me, staffMe, session, actions, auth, accounts, platform, authNotice, toast, toasts }
import { createContext, useContext } from 'react';

export const StoreContext = createContext(null);
export const useStore = () => useContext(StoreContext);

// Selectores de uso común
export const unitLabel = (db, id) => db.units.find((u) => u.id === id)?.label || '—';
export const userName = (db, id) => (id === 'ecartpay' ? 'Ecart Pay' : db.users.find((u) => u.id === id)?.name || '—');
