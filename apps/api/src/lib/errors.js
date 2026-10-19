import { DomainError } from '@residencial/shared';

/** Error con estado HTTP para respuestas controladas. */
export class HttpError extends Error {
  constructor(status, message, code = 'error', details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, 'invalid_request', details);
export const unauthorized = (msg = 'Inicia sesión para continuar.', code = 'unauthorized') => new HttpError(401, msg, code);
export const forbidden = (msg = 'No tienes permiso para hacer esto.') => new HttpError(403, msg, 'forbidden');
export const notFound = (msg = 'No encontrado.') => new HttpError(404, msg, 'not_found');
export const conflict = (msg) => new HttpError(409, msg, 'conflict');

/**
 * Formato único de error: `{ error: { code, message, details? } }`.
 * Los errores inesperados se registran completos pero al cliente sólo llega un mensaje genérico.
 */
export function errorHandler(err, request, reply) {
  if (err instanceof HttpError || err instanceof DomainError) {
    return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err.validation || err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
    return reply.status(400).send({ error: { code: 'invalid_request', message: 'La solicitud no es válida.' } });
  }
  if (err.statusCode === 429) {
    return reply
      .status(429)
      .send({ error: { code: 'rate_limited', message: 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.' } });
  }
  if (err.statusCode === 413) {
    return reply.status(413).send({ error: { code: 'payload_too_large', message: 'El archivo es demasiado grande.' } });
  }
  request.log.error({ err }, 'Error no controlado');
  return reply.status(500).send({ error: { code: 'internal', message: 'Ocurrió un error. Inténtalo de nuevo.' } });
}
