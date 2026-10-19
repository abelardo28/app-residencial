import { badRequest } from './errors.js';

/** Valida `data` con un esquema de zod. Si no cumple, responde 400 con el detalle por campo. */
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
  throw badRequest('Revisa los datos enviados.', details);
}
