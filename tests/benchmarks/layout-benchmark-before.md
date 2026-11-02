## Layout benchmark (synthetic corpus) — BASELINE

> Captured on 2026-11-02 **before** any Phase 3 engine change, using the same
> corpus, metrics and 0.95-line-recall harness the final run uses. Kept as the
> "before" column of the Phase 3 record (PLAN.md §29.4).
>
> Two caveats when diffing against `layout-benchmark-after.md`:
> - the held-out pool at baseline covered six case shapes (prose, indented
>   prose, headings, lists, two-column, table); it was extended to all twelve
>   for the final measurement, so only those six are directly comparable;
> - `column accuracy` was measured before the ground-truth column count was
>   corrected (table rows were counted as columns), which is why the baseline
>   figure is 3.3%/21.2% rather than a meaningful number.

### DEV seeds (tuning set)

| metric | value |
| --- | --- |
| paragraph grouping P / R / F1 | 67.2% / 87.6% / 76.0% |
| reading-order accuracy | 100.0% (543/543) |
| role accuracy | 88.0% (206/234) |
| heading-level accuracy | 60.0% (3/5) |
| list-level accuracy | 100.0% (7/7) |
| column accuracy | 3.3% (7/213) |
| font family / bold / italic | 100.0% / 97.7% / 100.0% |
| table cell P / R | 0.0% / 0.0% (0/22 in 0/2 tables) |
| line recall | 100.0% |
| confidence AUROC | 0.627 |
| confidence spread (sd) | 0.0026 |
| mean conf correct / wrong | 0.820 / 0.343 |
| flagged wrong / unflagged wrong | 18/18 / 65 |
| reflow accuracy (false-safe / false-refuse) | 66.7% (1 / 1) |
| extraction latency per page | 48.2 ms |

### HELD-OUT seeds (scored set, 6 of 12 shapes)

| metric | value |
| --- | --- |
| paragraph grouping P / R / F1 | 59.3% / 75.1% / 66.3% |
| reading-order accuracy | 99.0% (101/102) |
| role accuracy | 88.6% (31/35) |
| heading-level accuracy | 60.0% (3/5) |
| list-level accuracy | 100.0% (7/7) |
| column accuracy | 21.2% (7/33) |
| font family / bold / italic | 100.0% / 84.8% / 100.0% |
| table cell P / R | 0.0% / 0.0% (0/16 in 0/1 tables) |
| line recall | 100.0% |
| confidence AUROC | 0.880 |
| confidence spread (sd) | 0.0200 |
| mean conf correct / wrong | 0.820 / 0.507 |
| flagged wrong / unflagged wrong | 2/2 / 27 |
| reflow accuracy (false-safe / false-refuse) | 100.0% (0 / 0) |
| extraction latency per page | 12.7 ms |

### per-case (held-out, the six shapes measured at baseline)

| case | grouping F1 | reading order | roles | table recall | conf spread | reflow |
| --- | --- | --- | --- | --- | --- | --- |
| prose | 50.0% | 100.0% | 50.0% | 0.0% | 6.0% | 100.0% |
| indented-prose | 93.7% | 100.0% | 100.0% | 0.0% | 0.0% | 100.0% |
| headings | 100.0% | 100.0% | 75.0% | 0.0% | 0.0% | 100.0% |
| lists | 100.0% | 100.0% | 100.0% | 0.0% | 0.0% | 100.0% |
| two-column | 68.3% | 100.0% | 100.0% | 0.0% | 0.0% | 100.0% |
| table | 100.0% | 100.0% | 100.0% | 0.0% | 6.0% | 100.0% |

### latency (24-page dense document)

| access pattern | total | per page |
| --- | --- | --- |
| one bulk extraction | — | — |
| page-by-page (scroll) | — | — |

(The baseline run predates the scroll measurement; the pre-change cost of a
scroll is reproduced in the final report by evicting the parsed document between
page reads, which is exactly what the old code did on every call.)
