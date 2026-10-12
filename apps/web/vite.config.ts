import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
    },
  },
  worker: {
    // Module workers let us import pdf-core (and the pdf.js worker URL) with
    // static ESM syntax inside the worker file.
    format: 'es',
  },
  server: {
    port: 5173,
    host: true,
    // The SPA calls `/api/*` same-origin. Without this the browser would talk to
    // :8080 cross-origin, which needs a CORS layer and `SameSite=None` cookies
    // (i.e. `Secure`, i.e. HTTPS even in dev). Proxying keeps the session cookie
    // `SameSite=Lax` and needs no CORS at all. Production serves web and /api
    // from one origin the same way.
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});