// Cliente HTTP de la API. La sesión viaja en una cookie HttpOnly (el código de la APP no la ve);
// las peticiones que modifican datos llevan además el token CSRF que la API entrega al iniciar sesión.
export const API_BASE = `${(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')}/api/v1`;

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** @param {{ onSessionEnded?: (error: ApiError) => void }} options */
export function createApiClient({ onSessionEnded } = {}) {
  let csrfToken = null;

  async function request(method, path, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
    let res;
    try {
      res = await fetch(API_BASE + path, {
        method,
        headers,
        credentials: 'include',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'network', 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.');
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const e = data?.error || {};
      const error = new ApiError(res.status, e.code || 'error', e.message || 'Ocurrió un error. Inténtalo de nuevo.', e.details);
      // Un 401 fuera de /auth significa que la sesión terminó (expiró, inactividad, cuenta suspendida…)
      if (res.status === 401 && !path.startsWith('/auth/')) onSessionEnded?.(error);
      throw error;
    }
    return data;
  }

  return {
    setCsrfToken: (token) => {
      csrfToken = token || null;
    },
    get: (path) => request('GET', path),
    post: (path, body = {}) => request('POST', path, body),
    patch: (path, body = {}) => request('PATCH', path, body),
    delete: (path) => request('DELETE', path),
    request,
  };
}
