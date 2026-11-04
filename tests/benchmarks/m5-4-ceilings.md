# M5.4 - Q3/Q7 ceiling guard

Measured 2026-11-04T13:21:48.121Z against `http://localhost:4173` (production build, 4x CPU).
Mode: **ratified**.

| check | measured | ceiling | result |
| --- | --- | --- | --- |
| tool-ready p95 (4x) | 549 ms | 583 ms | pass |
| first interaction, worst route | 16 ms | 23 ms | pass |
| worst main-thread task (4x) | 125 ms | 200 ms | pass |
| chromium-iphone 200-page merge completes | 376 ms | - | pass |
| chromium-iphone 200-page heap | 10 MB | 15 MB | pass |
| webkit-iphone 50-page merge completes | 257 ms | - | pass |
| webkit-iphone 50-page heap | n/a | 15 MB | pass |

- routes measured: 51
- script errors: 0
- 50-page merge long tasks: 3 (worst 125 ms)
- iPhone-13 200-page merge: completed, heap 10 MB
- WebKit iPhone-13 50-page merge: completed

The WebKit run reports **no heap**: `performance.memory` is Chromium-only. It is not iOS Safari; it is the Safari engine under an iPhone viewport.
