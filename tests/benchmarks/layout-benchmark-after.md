## Layout benchmark (synthetic corpus)

### DEV seeds (tuning set)

| metric | value |
| --- | --- |
| paragraph grouping P / R / F1 | 100.0% / 100.0% / 100.0% |
| reading-order accuracy | 100.0% (663/663) |
| role accuracy | 100.0% (234/234) |
| heading-level accuracy | 100.0% (5/5) |
| list-level accuracy | 100.0% (7/7) |
| column accuracy | 100.0% (10/10) |
| font family / bold / italic | 100.0% / 97.9% / 100.0% |
| table cell P / R | 100.0% / 100.0% (22/22 in 2/2 tables) |
| line recall | 100.0% |
| confidence AUROC | n/a |
| confidence spread (sd) | 0.0528 |
| mean conf correct / wrong | 0.913 / 0.000 |
| flagged wrong / unflagged wrong | 0/1 / 0 |
| reflow accuracy (false-safe / false-refuse) | 100.0% (0 / 0) |
| extraction latency per page | 53.3 ms |

### HELD-OUT seeds (scored set)

| metric | value |
| --- | --- |
| paragraph grouping P / R / F1 | 100.0% / 99.8% / 99.9% |
| reading-order accuracy | 100.0% (663/663) |
| role accuracy | 100.0% (234/234) |
| heading-level accuracy | 100.0% (5/5) |
| list-level accuracy | 100.0% (7/7) |
| column accuracy | 100.0% (10/10) |
| font family / bold / italic | 100.0% / 97.9% / 100.0% |
| table cell P / R | 100.0% / 100.0% (22/22 in 2/2 tables) |
| line recall | 100.0% |
| confidence AUROC | 0.611 |
| confidence spread (sd) | 0.0569 |
| mean conf correct / wrong | 0.908 / 0.073 |
| flagged wrong / unflagged wrong | 0/2 / 2 |
| reflow accuracy (false-safe / false-refuse) | 100.0% (0 / 0) |
| extraction latency per page | 37.5 ms |

### per-case (held-out)

| case | grouping F1 | reading order | roles | table recall | conf spread | reflow |
| --- | --- | --- | --- | --- | --- | --- |
| prose | 100.0% | 100.0% | 100.0% | 0.0% | 1.0% | 100.0% |
| indented-prose | 100.0% | 100.0% | 100.0% | 0.0% | 3.9% | 100.0% |
| headings | 100.0% | 100.0% | 100.0% | 0.0% | 9.2% | 100.0% |
| lists | 100.0% | 100.0% | 100.0% | 0.0% | 3.2% | 100.0% |
| two-column | 99.1% | 100.0% | 100.0% | 0.0% | 8.1% | 100.0% |
| table | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% | 100.0% |
| small-table | 100.0% | 100.0% | 100.0% | 100.0% | 0.0% | 100.0% |
| furniture | 100.0% | 100.0% | 100.0% | 0.0% | 6.4% | 100.0% |
| caption-footnote | 100.0% | 100.0% | 100.0% | 0.0% | 15.3% | 100.0% |
| image | 100.0% | 100.0% | 100.0% | 0.0% | 15.6% | 100.0% |
| mixed-typography | 100.0% | 100.0% | 100.0% | 0.0% | 0.9% | 100.0% |
| dense | 100.0% | 100.0% | 100.0% | 0.0% | 4.6% | 100.0% |
### latency (24-page dense document)

| access pattern | total | per page |
| --- | --- | --- |
| one bulk extraction | 273 ms | 11.4 ms |
| page-by-page (scroll, cached document) | 274 ms | 11.4 ms |
| page-by-page (re-parse every call = pre-Phase-3) | 318 ms | 13.2 ms |