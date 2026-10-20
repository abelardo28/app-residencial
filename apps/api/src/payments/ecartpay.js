// Adaptador de Ecart Pay. Las llaves sólo viven en el servidor.
// En modo `mock` el cobro se considera pagado al consultarlo (para desarrollo y pruebas).
// En modo `live` revisa los endpoints y el formato del aviso (webhook) en la documentación de tu cuenta
// de Ecart Pay; aquí están aislados para ajustarlos sin tocar el resto de la API.
// La suscripción de cada residencial puede guardar la tarjeta (`saveCard`) para cobrarla cada mes con `chargeCard`:
// sólo se guarda el identificador que entrega Ecart Pay, nunca el número de la tarjeta.
import { uid } from '@residencial/shared';
import { hmac, safeEqual } from '../lib/crypto.js';

const paidStatus = (s) => (['paid', 'completed', 'succeeded'].includes(s) ? 'paid' : s === 'failed' ? 'failed' : 'pending');

export function createEcartPay(config) {
  if (config.ECARTPAY_MODE === 'mock') {
    return {
      mode: 'mock',
      async createCheckout({ amount, concept, redirectPath = '/pagos' }) {
        const id = uid('ecp_');
        return { id, checkoutUrl: `${config.APP_URL}/#${redirectPath}?checkout=${id}`, amount, concept };
      },
      async getStatus() {
        return 'paid';
      },
      async getCheckout(id) {
        return { status: 'paid', card: { brand: 'Visa', last4: '4242', token: `card_${id}` } };
      },
      async chargeCard({ token, amount }) {
        // Para probar un rechazo en desarrollo, usa una tarjeta cuyo identificador contenga "declined".
        return { id: uid('ecp_chg_'), status: token.includes('declined') ? 'failed' : 'paid', amount };
      },
      verifyWebhook: () => true,
    };
  }

  const auth = () => 'Basic ' + Buffer.from(`${config.ECARTPAY_PUBLIC_KEY}:${config.ECARTPAY_PRIVATE_KEY}`).toString('base64');
  return {
    mode: 'live',
    async createCheckout({ amount, concept, email, reference, saveCard = false, redirectPath = '/pagos' }) {
      const res = await fetch(`${config.ECARTPAY_API_URL}/checkouts`, {
        method: 'POST',
        headers: { Authorization: auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          currency: 'MXN',
          concept,
          email,
          reference,
          save_card: saveCard,
          redirect_url: `${config.APP_URL}/#${redirectPath}`,
        }),
      });
      if (!res.ok) throw new Error(`Ecart Pay ${res.status}`);
      const data = await res.json();
      return { id: data.id, checkoutUrl: data.url || data.checkout_url, amount };
    },
    async getStatus(id) {
      return (await this.getCheckout(id)).status;
    },
    /** Estado del cobro y, si se pidió guardarla, la tarjeta con la que se pagó. */
    async getCheckout(id) {
      const res = await fetch(`${config.ECARTPAY_API_URL}/checkouts/${encodeURIComponent(id)}`, { headers: { Authorization: auth() } });
      if (!res.ok) throw new Error(`Ecart Pay ${res.status}`);
      const data = await res.json();
      const pm = data.payment_method || data.card || {};
      return {
        status: paidStatus(data.status),
        card:
          pm.id || pm.token
            ? { brand: pm.brand || 'Tarjeta', last4: String(pm.last4 || pm.last_four || '').slice(-4), token: pm.id || pm.token }
            : null,
      };
    },
    /** Cobra una tarjeta guardada (cobro automático de la suscripción). */
    async chargeCard({ token, amount, concept, reference, email }) {
      const res = await fetch(`${config.ECARTPAY_API_URL}/charges`, {
        method: 'POST',
        headers: { Authorization: auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_method: token, amount, currency: 'MXN', concept, reference, email }),
      });
      if (!res.ok) return { id: null, status: 'failed', error: `Ecart Pay ${res.status}` };
      const data = await res.json();
      return { id: data.id, status: paidStatus(data.status), amount };
    },
    /** Verifica la firma HMAC del aviso con el secreto del webhook. */
    verifyWebhook(rawBody, signature) {
      return !!signature && safeEqual(hmac(config.ECARTPAY_WEBHOOK_SECRET, rawBody), signature);
    },
  };
}
