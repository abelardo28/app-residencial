// Adaptador de Ecart Pay. Las llaves sólo viven en el servidor.
// En modo `mock` el cobro se considera pagado al consultarlo (para desarrollo y pruebas).
// En modo `live` revisa los endpoints y el formato del aviso (webhook) en la documentación de tu cuenta
// de Ecart Pay; aquí están aislados para ajustarlos sin tocar el resto de la API.
import { uid } from '@residencial/shared';
import { hmac, safeEqual } from '../lib/crypto.js';

export function createEcartPay(config) {
  if (config.ECARTPAY_MODE === 'mock') {
    return {
      mode: 'mock',
      async createCheckout({ amount, concept }) {
        const id = uid('ecp_');
        return { id, checkoutUrl: `${config.APP_URL}/#/pagos?checkout=${id}`, amount, concept };
      },
      async getStatus() {
        return 'paid';
      },
      verifyWebhook: () => true,
    };
  }

  const auth = () => 'Basic ' + Buffer.from(`${config.ECARTPAY_PUBLIC_KEY}:${config.ECARTPAY_PRIVATE_KEY}`).toString('base64');
  return {
    mode: 'live',
    async createCheckout({ amount, concept, email, reference }) {
      const res = await fetch(`${config.ECARTPAY_API_URL}/checkouts`, {
        method: 'POST',
        headers: { Authorization: auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, currency: 'MXN', concept, email, reference, redirect_url: `${config.APP_URL}/#/pagos` }),
      });
      if (!res.ok) throw new Error(`Ecart Pay ${res.status}`);
      const data = await res.json();
      return { id: data.id, checkoutUrl: data.url || data.checkout_url, amount };
    },
    async getStatus(id) {
      const res = await fetch(`${config.ECARTPAY_API_URL}/checkouts/${encodeURIComponent(id)}`, { headers: { Authorization: auth() } });
      if (!res.ok) throw new Error(`Ecart Pay ${res.status}`);
      const data = await res.json();
      return ['paid', 'completed', 'succeeded'].includes(data.status) ? 'paid' : data.status === 'failed' ? 'failed' : 'pending';
    },
    /** Verifica la firma HMAC del aviso con el secreto del webhook. */
    verifyWebhook(rawBody, signature) {
      return !!signature && safeEqual(hmac(config.ECARTPAY_WEBHOOK_SECRET, rawBody), signature);
    },
  };
}
