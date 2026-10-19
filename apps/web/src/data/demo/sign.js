// Firma de los QR en el modo demo. NO es segura: la clave está en el navegador.
// Con la API, los QR se firman en el servidor con HMAC-SHA256 y una clave que nunca sale de ahí.
const SECRET = 'demo-solo-navegador';

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const demoSign = (payload) => fnv(payload + '|' + SECRET) + fnv(SECRET + '|' + payload);
