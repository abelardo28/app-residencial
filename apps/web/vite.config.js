import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// En desarrollo, /api se reenvía a la API local: la APP y la API comparten origen
// y la cookie de sesión (SameSite=Strict) funciona sin configurar CORS.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      proxy: { '/api': { target: env.API_PROXY_TARGET || 'http://localhost:3000', changeOrigin: false } },
    },
    preview: {
      proxy: { '/api': { target: env.API_PROXY_TARGET || 'http://localhost:3000', changeOrigin: false } },
    },
  };
});
