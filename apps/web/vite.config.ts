import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { prerenderPlugin, prerenderedRoutesPlugin } from './build/prerender';
import { buildCsp } from './src/lib/csp';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * The Content-Security-Policy is part of the product, not of a deploy config:
 * the trust page explains the policy the app is actually running under, and the
 * offline e2e suite asserts it. Injecting it here means `vite build` output is
 * self-describing, and a deployment cannot forget it.
 *
 * Build only. The dev server needs HMR's websocket and its inline client, and
 * injecting the production policy there would make the two environments behave
 * differently in a way that hides breakage until deploy.
 */
function cspPlugin(extraOrigins: readonly string[]): Plugin {
  return {
    name: 'pdfshush-csp',
    apply: 'build',
    transformIndexHtml(html) {
      // `head-prepend` matters: a meta CSP only constrains requests made after
      // it is parsed, so it has to be the first thing in `<head>`.
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: buildCsp(extraOrigins),
            },
            injectTo: 'head-prepend',
          },
        ],
      };
    },
  };
}

/**
 * Emits `sw.js` with `__BUILD_ID__` replaced by a hash of the emitted asset
 * names. The asset names are content hashes, so the cache version changes
 * exactly when the build does; a deploy can never serve a stale engine from the
 * previous cache.
 */
function serviceWorkerPlugin(): Plugin {
  return {
    name: 'pdfshush-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const buildId = createHash('sha256')
        .update(Object.keys(bundle).sort().join('\n'))
        .digest('hex')
        .slice(0, 12);
      const source = readFileSync(path.resolve(rootDir, 'service-worker.js'), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: source.replaceAll('__BUILD_ID__', buildId),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, '');
  // Comma-separated origins for self-hosters whose AI endpoint is not in the
  // shipped allowlist. Empty by default: the hosted build stays closed.
  const extraCspOrigins = (env.VITE_CSP_CONNECT_EXTRA ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    plugins: [
      react(),
      tailwindcss(),
      cspPlugin(extraCspOrigins),
      serviceWorkerPlugin(),
      prerenderPlugin({
        rootDir,
        ...(env.VITE_SITE_ORIGIN ? { siteOrigin: env.VITE_SITE_ORIGIN } : {}),
      }),
      prerenderedRoutesPlugin(rootDir),
    ],
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
      rolldownOptions: {
        output: {
          // Vite 8/Rolldown: object and function `manualChunks` are gone, so the
          // vendor split is expressed as named code-splitting groups. Third-party
          // code changes on a different cadence than ours, so giving it stable
          // names keeps a tool deploy from invalidating the whole cache.
          codeSplitting: {
            groups: [
              {
                name: 'vendor-react',
                test: /node_modules[\\/](?:react|react-dom|scheduler|react-router|react-router-dom)[\\/]/,
              },
              {
                name: 'vendor-ui',
                test: /node_modules[\\/](?:@radix-ui|@dnd-kit|@floating-ui|sonner|lucide-react|tailwind-merge|clsx|class-variance-authority|cmdk)[\\/]/,
              },
              {
                name: 'vendor-motion',
                test: /node_modules[\\/](?:animejs|motion|framer-motion)[\\/]/,
              },
            ],
          },
        },
      },
    },
  };
});
