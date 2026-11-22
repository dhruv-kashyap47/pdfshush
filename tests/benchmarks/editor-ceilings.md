# Editor ceilings (H-03)

Measured by `pnpm test:editor-perf` on 2026-11-22. The harness is
`packages/pdf-core/test/editorBench.test.ts`; the numbers are printed by the
test, not copied from a previous run. CI runs the same test with
`EDITOR_BENCH_CI=1`, which uses the wider public-runner budget.

| measurement | local result | local ceiling | CI ceiling | detail |
| --- | ---: | ---: | ---: | --- |
| open/inspect 100 pages | 31 ms | 4,000 ms | 8,000 ms | 100 pages, 39 kB fixture |
| PDFium capabilities, 100 pages | 33 ms | 10,000 ms | 20,000 ms | 100 native pages |
| 10k ink points export | 366 ms | 2,500 ms | 5,000 ms | 2 × 5,000-point strokes (the per-object cap) |
| one text edit, 100-page doc | 107 ms | 1,500 ms | 3,000 ms | one overlay text object |
| content-stream tokenise/emit | 230 ms | 2,000 ms | 4,000 ms | 1.1 MB, 100,000 operations |

The content-stream row also asserts byte identity: the emitted stream has the
same length as the source, which is the Gate C property the throughput is paid
on top of.

## What this does and does not claim

- It bounds engine work, not route rendering. The product baseline
  (`pnpm test:perf`, `tests/benchmarks/m5-4-ceilings.*`) remains the route and
  memory gate.
- A 10,000-point single stroke is refused by design (`MAX_INK_POINTS` is 5,000
  per object), so the benchmark exports two capped strokes and says so.
- These ceilings are regression tripwires, not competitive benchmarks. A shared
  runner is slower than this machine; the CI budget reflects that.
