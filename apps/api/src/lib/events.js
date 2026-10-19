// Avisos en tiempo real por residencial (Server-Sent Events).
// Con varias instancias de la API, reemplaza este emisor en memoria por Redis Pub/Sub o PostgreSQL LISTEN/NOTIFY.
import { EventEmitter } from 'node:events';

export function createEventBus() {
  const bus = new EventEmitter();
  bus.setMaxListeners(0);
  return {
    /** Anuncia que cambiaron los datos de un residencial (`tenantId`) o de la empresa (`platform`). */
    publish(channel, payload = {}) {
      bus.emit(channel, { at: new Date().toISOString(), ...payload });
      if (channel !== 'platform') bus.emit('platform', { tenantId: channel, at: new Date().toISOString() });
    },
    subscribe(channel, fn) {
      bus.on(channel, fn);
      return () => bus.off(channel, fn);
    },
  };
}
