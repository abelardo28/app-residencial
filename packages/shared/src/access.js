// Pases de acceso con caducidad.
// El QR contiene `RES1.<idPase>.<expiraEpoch>.<firma>`. La firma impide inventar códigos.
// Quien llama inyecta la función `sign`: la API usa HMAC-SHA256 con una clave secreta del servidor;
// el modo demo de la APP usa una firma simple porque no tiene servidor.

export const PASS_TYPES = {
  familiar: 'Familiar',
  amigo: 'Amigo / invitado',
  proveedor: 'Proveedor',
  trabajador: 'Trabajador',
  servicio: 'Servicio a domicilio',
  paqueteria: 'Paquetería',
};

export const PASS_MODES = ['single', 'multi', 'recurrent'];

export function buildToken(pass, sign) {
  const exp = Math.floor(new Date(pass.validTo).getTime() / 1000);
  const payload = `${pass.id}.${exp}`;
  return `RES1.${payload}.${sign(payload)}`;
}

/** Acepta el contenido del QR o el código corto de 6 caracteres. */
export function parseInput(text, sign) {
  const t = (text || '').trim();
  if (t.startsWith('RES1.')) {
    const [, id, exp, sig] = t.split('.');
    return { kind: 'token', id, exp: Number(exp), signatureOk: !!sig && sign(`${id}.${exp}`) === sig };
  }
  return { kind: 'code', code: t.toUpperCase().replace(/[^A-Z0-9]/g, '') };
}

/** Determina si un pase puede usarse en este momento. */
export function evaluatePass(pass, now = new Date()) {
  if (!pass) return { ok: false, reason: 'Código no encontrado' };
  if (pass.status === 'revoked') return { ok: false, reason: 'El residente canceló este pase' };
  if (pass.mode === 'single' && pass.uses.length > 0) return { ok: false, reason: 'Este código ya fue utilizado' };
  if (pass.mode === 'multi' && pass.uses.length >= pass.maxUses) return { ok: false, reason: 'Se agotaron los usos de este código' };
  const from = new Date(pass.validFrom);
  const to = new Date(pass.validTo);
  if (now < from) return { ok: false, reason: `Aún no es válido. Inicia ${from.toLocaleString('es-MX')}` };
  if (now > to) return { ok: false, reason: 'El código expiró' };
  if (pass.mode === 'recurrent') {
    if (!pass.days.includes(now.getDay())) return { ok: false, reason: 'Hoy no es un día permitido para este pase' };
    const hm = now.toTimeString().slice(0, 5);
    if (hm < pass.timeFrom || hm > pass.timeTo) return { ok: false, reason: `Horario permitido ${pass.timeFrom}–${pass.timeTo}` };
  }
  return { ok: true };
}

export function passStatus(pass, now = new Date()) {
  if (pass.status === 'revoked') return { label: 'Cancelado', tone: 'bad' };
  if (pass.mode === 'single' && pass.uses.length) return { label: 'Utilizado', tone: '' };
  if (pass.mode === 'multi' && pass.uses.length >= pass.maxUses) return { label: 'Utilizado', tone: '' };
  if (now > new Date(pass.validTo)) return { label: 'Expirado', tone: '' };
  if (now < new Date(pass.validFrom)) return { label: 'Programado', tone: 'info' };
  return { label: 'Activo', tone: 'ok' };
}

export const normalizePlate = (p = '') => p.toUpperCase().replace(/[^A-Z0-9]/g, '');
