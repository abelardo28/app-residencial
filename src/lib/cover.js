// Foto de portada del residencial. Sin configurar se usa la foto de ejemplo; `null` la quita.
export const DEMO_COVER = `${import.meta.env.BASE_URL}portada-demo.jpg`;
export const coverOf = (settings) => (settings?.cover === undefined ? DEMO_COVER : settings.cover);
