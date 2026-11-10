import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource/instrument-serif'; /* Hero display face, self-hosted. */
import '@fontsource/instrument-serif/400-italic.css'; /* Caption voice. */
import { installBuildRecovery } from './lib/build-recovery';
import { mark, observeFirstInteraction } from './lib/marks';
import { registerServiceWorker } from './lib/service-worker';
import './index.css';

installBuildRecovery();

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Measurement marks for the M5.0 product baseline (PLAN.md §31.6). Inert in
// normal use; see lib/marks.ts.
mark('app-ready');
observeFirstInteraction();

// Offline support, deferred to idle time. A production build registers the
// worker; the dev server never does (see lib/service-worker.ts).
registerServiceWorker();
