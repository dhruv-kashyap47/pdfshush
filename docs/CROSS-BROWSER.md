# Cross-browser and touch record (H-05/H-06)

Recorded 2026-11-22 against the production preview (`vite preview`, 4173) with
Playwright 1.63.0 on Windows. Commands:

```bash
pnpm test:e2e:cross-browser   # Chromium 1255, Firefox 1543, WebKit 2388
pnpm test:e2e:editor-touch    # Chromium iPhone 13 profile
```

## Engine loop

Every installed engine completed the same loop: open a PDF, create a text box
from the keyboard, move it with an arrow key, find text, save, and reopen the
downloaded PDF with the new text present.

| Feature | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| Pointer events | pass | pass | pass |
| IndexedDB | pass | pass | pass |
| OffscreenCanvas | pass | pass | **unsupported in this WebKit build** |
| Async Clipboard API | pass | pass | pass |
| `createImageBitmap` | pass | pass | pass |
| Open, edit, find, save, reopen | pass | pass | pass |
| Direct-manipulation handles | pass | pass | pass |
| Worker page raster | pass | pass | **unsupported; text editing/export still pass** |

The WebKit build used by Playwright has no `OffscreenCanvas`. The raster job
therefore throws its explicit "no canvas implementation" error and the editor
still edits, finds and exports text. This is recorded as an unsupported
capability, not a pass, and it is not claimed as an iOS Safari result. A physical
iOS pass is the right next check for notch safe areas, software keyboard and
pinch inertia.

## Touch/mobile

The Chromium phone profile passed every check:

| Check | Result |
| --- | --- |
| Phone navigation and find reachable without a keyboard | pass |
| Page fits the 390 px viewport | 387 px |
| Select mode leaves vertical scrolling (`touch-action: pan-y`) | pass |
| Find opens as a bottom sheet | pass at y=573 |
| Pen owns the gesture (`touch-action: none`) | pass |
| One finger paints one stroke; a palm contact is ignored | 1 ink object |
| Properties open and dismiss without losing selection | pass |
| No horizontal page overflow | 0 px |

### Gated combinations

- **WebKit without OffscreenCanvas:** text editing, find, signatures and export
  work; page raster previews do not. The app reports the engine error instead of
  pretending a page rendered.
- **Desktop browsers reporting `ontouchstart === false`:** the probe is recorded
  as unsupported; that is the correct answer, not a missing feature.
- **Physical iOS/Android:** not run in this environment. The Playwright profiles
  are named as emulation, never as a device pass.
