# M5.4 - Q3/Q7 ceiling guard

Measured 2026-11-04T14:02:22.211Z against `http://localhost:4173` (production build, 4x CPU).
Mode: **ratified**.

| check | measured | ceiling | result |
| --- | --- | --- | --- |
| tool-ready p95 (4x) | 545 ms | 583 ms | pass |
| first interaction, worst route | 14 ms | 23 ms | pass |
| worst main-thread task (4x) | 127 ms | 200 ms | pass |
| chromium-iphone 200-page merge completes | 356 ms | - | pass |
| chromium-iphone 200-page heap | 10 MB | 15 MB | pass |
| webkit-iphone 50-page merge completes | 212 ms | - | pass |
| webkit-iphone 50-page heap | n/a | 15 MB | pass |

- routes measured: 51
- script errors: 0
- 50-page merge long tasks: 2 (worst 127 ms)
- iPhone-13 200-page merge: completed, heap 10 MB
- WebKit iPhone-13 50-page merge: completed

The WebKit run reports **no heap**: `performance.memory` is Chromium-only. It is not iOS Safari; it is the Safari engine under an iPhone viewport.
