import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { mark, observeFirstInteraction } from './lib/marks';
import './index.css';

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
