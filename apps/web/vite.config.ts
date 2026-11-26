import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { prerenderPlugin, prerenderedRoutesPlugin } from './build/prerender.ts';
import { buildCsp } from './src/lib/csp.ts';

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
/**
 * Guides as a virtual module.
 *
 * `import.meta.glob` cannot see frontmatter, so an eager glob would ship every
 * draft's full text inside the production bundle even though it is never listed
 * or routed. This resolves the directory at build time and includes a draft only
 * in `serve` (so a writer can preview it). The bundle a visitor downloads
 * therefore contains published articles and nothing else.
 */
function guidesPlugin(rootDir: string): Plugin {
  const virtualId = 'virtual:guides';
  const resolved = `\0${virtualId}`;
  let serve = false;

  return {
    name: 'pdfshush-guides',
    configResolved(config) {
      serve = config.command === 'serve';
    },
    resolveId(id) {
      return id === virtualId ? resolved : undefined;
    },
    load(id) {
      if (id !== resolved) return undefined;

      const directory = path.join(rootDir, 'src', 'content', 'guides');
      let files: string[] = [];
      try {
        files = readdirSync(directory).filter((file) => file.endsWith('.md'));
      } catch {
        return 'export default {}';
      }

      const entries = files
        .map((file) => ({
          file,
          source: readFileSync(path.join(directory, file), 'utf8'),
        }))
        .map((entry) => ({
          ...entry,
          draft: /^draft:\s*(true|"true")\s*$/m.test(entry.source),
        }))
        .filter((entry) => serve || !entry.draft);

      return `export default {${entries
        .map((entry) => `${JSON.stringify(entry.file)}:${JSON.stringify(entry.source)}`)
        .join(',')}};`;
    },
  };
}

function cspPlugin(extraOrigins: readonly string[], ads = false): Plugin {
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
              content: buildCsp(extraOrigins, { ads }),
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
 *
 * The hash also covers the public shell files that the worker caches under a
 * stable name. Those are copied to `dist` rather than emitted into the bundle,
 * so a repainted icon or an edited manifest changes no bundle key at all; with
 * the bundle keys alone the new worker would be byte-identical to the old one,
 * never install, and leave an installed app on the previous artwork.
 */
function serviceWorkerPlugin(): Plugin {
  const SHELL_FILES = [
    'favicon.ico',
    'manifest.webmanifest',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-512.png',
    'icons/apple-touch-icon.png',
  ];

  return {
    name: 'pdfshush-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const hash = createHash('sha256').update(Object.keys(bundle).sort().join('\n'));
      for (const file of SHELL_FILES) {
        const absolute = path.resolve(rootDir, 'public', file);
        // A missing shell file must not fail the build; `no file` is still a
        // distinct input, so its removal changes the id too.
        hash.update(existsSync(absolute) ? readFileSync(absolute) : Buffer.from(file));
      }
      const buildId = hash.digest('hex').slice(0, 12);
      const source = readFileSync(path.resolve(rootDir, 'service-worker.js'), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: source.replaceAll('__BUILD_ID__', buildId),
      });
    },
  };
}

/**
 * Serves the English OCR model at a stable, same-origin path.
 *
 * Tesseract asks for `<langPath>/eng.traineddata.gz`. Emitting the gzip under a
 * content-hashed asset name would make `langPath` change with every build and
 * force a fresh ~11 MB download, so this emits a fixed path instead. The file
 * comes from `@tesseract.js-data/eng`, a devDependency: it is build input, not
 * runtime code, and the shipped artifact is the emitted asset.
 *
 * The response deliberately has no `Content-Encoding: gzip` header. Tesseract
 * gunzips the bytes itself; letting the browser decompress them first would
 * make the model look corrupt.
 */
function ocrTrainedDataPlugin(): Plugin {
  const assetName = 'tessdata/eng.traineddata.gz';
  let sourcePath: string | null = null;

  const resolveSource = (): string => {
    if (sourcePath) return sourcePath;
    const require = createRequire(import.meta.url);
    const packageJson = require.resolve('@tesseract.js-data/eng/package.json');
    sourcePath = path.join(path.dirname(packageJson), '4.0.0', 'eng.traineddata.gz');
    return sourcePath;
  };

  return {
    name: 'pdfshush-ocr-traineddata',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.method !== 'GET' || !request.url) return next();
        let pathname: string;
        try {
          pathname = new URL(request.url, 'http://localhost').pathname;
        } catch {
          return next();
        }
        if (pathname !== `/${assetName}`) return next();
        const file = readFileSync(resolveSource());
        response.setHeader('Content-Type', 'application/gzip');
        response.setHeader('Content-Length', String(file.byteLength));
        // The model is versioned by the dependency, not by the build; a long
        // cache is correct and saves the download on a reload.
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        response.end(file);
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: assetName,
        source: readFileSync(resolveSource()),
      });
    },
  };
}

/**
 * Preview only: a missing `/assets/*` file must be a 404, not the SPA shell.
 *
 * Vite preview's history fallback returns index.html for every unknown path. A
 * tab from an older build then receives HTML where it expected CSS or a module:
 * the stylesheet has zero rules (so `error` never fires) and the module fails as
 * a MIME error. Production servers already behave this way; preview should too.
 */
function previewAsset404Plugin(): Plugin {
  return {
    name: 'pdfshush-preview-assets-404',
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.method !== 'GET' || !request.url) return next();
        let pathname: string;
        try {
          pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        } catch {
          return next();
        }
        if (!pathname.startsWith('/assets/')) return next();
        const distDir = path.resolve(rootDir, 'dist');
        const file = path.resolve(distDir, `.${pathname}`);
        if (!file.startsWith(distDir + path.sep)) {
          response.statusCode = 404;
          response.end('Not found');
          return;
        }
        if (existsSync(file)) return next();
        response.statusCode = 404;
        response.setHeader('content-type', 'text/plain; charset=utf-8');
        response.end('Not found');
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
      guidesPlugin(rootDir),
      cspPlugin(extraCspOrigins, env.VITE_ADS_ENABLED === 'true'),
      serviceWorkerPlugin(),
      ocrTrainedDataPlugin(),
      previewAsset404Plugin(),
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
