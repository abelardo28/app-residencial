// Integración con Ecart Pay.
//
// Flujo en producción:
//   1. El front llama a TU backend: POST {VITE_API_URL}/payments/ecartpay/checkout
//   2. El backend autentica con las llaves de Ecart Pay (pública + privada, nunca en el navegador),
//      crea la orden/link de pago y devuelve { id, checkoutUrl }.
//   3. El residente paga en checkoutUrl; Ecart Pay notifica al backend por webhook.
//   4. El webhook marca el pago como aprobado y dispara las notificaciones a residente y administradores.
//
// Sin VITE_API_URL se usa el modo simulado: se muestra un checkout de prueba dentro de la app.
const API = import.meta.env.VITE_API_URL;
export const ECARTPAY_MODE = API ? 'live' : 'mock';

export async function createCheckout({ amount, concept, reference, customer }) {
  if (ECARTPAY_MODE === 'mock') {
    return { id: 'ecp_test_' + Math.random().toString(36).slice(2, 10), checkoutUrl: null, mock: true };
  }
  const r = await fetch(`${API}/payments/ecartpay/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, currency: 'MXN', concept, reference, customer }),
  });
  if (!r.ok) throw new Error('No se pudo iniciar el pago con Ecart Pay');
  return r.json();
}

export async function getCheckoutStatus(id) {
  if (ECARTPAY_MODE === 'mock') return { id, status: 'paid' };
  const r = await fetch(`${API}/payments/ecartpay/checkout/${id}`);
  if (!r.ok) throw new Error('No se pudo consultar el pago');
  return r.json(); // { id, status: 'paid' | 'pending' | 'failed' }
}
