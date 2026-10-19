// Acceso seguro al almacenamiento del navegador: en algunos navegadores o vistas previas puede estar bloqueado.
export const KEY = 'residencial:db:v2';
export const SESSION = 'residencial:session:v2';

export const safe = {
  get: (store, k) => {
    try {
      return window[store].getItem(k);
    } catch {
      return null;
    }
  },
  set: (store, k, v) => {
    try {
      window[store].setItem(k, v);
      return true;
    } catch {
      return false;
    }
  },
  remove: (store, k) => {
    try {
      window[store].removeItem(k);
    } catch {
      /* sin almacenamiento */
    }
  },
};

/** Borra los datos del modo demo (en modo API no hay nada guardado aquí). */
export const resetStorage = () => {
  safe.remove('localStorage', KEY);
  safe.remove('sessionStorage', SESSION);
};
