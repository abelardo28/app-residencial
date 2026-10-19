// Lógica compartida por ambos proveedores de datos.
import { useCallback, useEffect, useRef, useState } from 'react';
import { showSystemNotification } from '../services/push';

/** Avisos flotantes (toasts). */
export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((title, body, tone = '') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, title, body, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return { toasts, toast };
}

/** Muestra un toast y una notificación del sistema cuando llega algo nuevo para el usuario. */
export function useNotificationAlerts(notifications, userId, toast) {
  const seen = useRef(null);
  useEffect(() => {
    if (!userId || !notifications) return;
    const mine = notifications.filter((n) => n.userId === userId);
    if (seen.current === null || seen.current.user !== userId) {
      seen.current = { user: userId, ids: new Set(mine.map((n) => n.id)) };
      return;
    }
    for (const n of mine) {
      if (seen.current.ids.has(n.id)) continue;
      seen.current.ids.add(n.id);
      if (!n.read) {
        toast(n.title, n.body, n.kind === 'sos' ? 'bad' : '');
        showSystemNotification(n);
      }
    }
  }, [notifications, userId, toast]);
}

/**
 * Ejecuta una acción y, si falla, muestra el motivo en un toast.
 * La promesa sigue rechazándose para que la pantalla pueda detener su flujo (`await` + `try`).
 */
export function withErrorToast(toast, fn) {
  const p = (async () => fn())();
  p.catch((e) => toast('No se pudo completar', e?.message || 'Inténtalo de nuevo.', 'bad'));
  return p;
}
