# Replay and pilot evidence

The zero-LLM replay is complete. The live pilot has not run because neither available execution route can reach the credential/provider network. This lane has spent zero provider calls; it is not REVIEW-READY evidence.

| Measure | Immutable base | Working tree |
|---|---:|---:|
| Recorded sources | 116 | 116 |
| Admitted | 115 | 115 |
| CEE chance predicate withheld | 79 | 79 |
| CEE chance predicate ready | 36 | 36 |
| Refused construction | 1 | 1 |
| Olumi occurrences held | 0 | 0 |
| Probability factors converted | 0 | 0 |
| Probability factors dropped | 0 | 0 |
| Probability factors remaining | 0 | 0 |

All 116 registered graph hashes are identical before/after; all 116 source hashes match; no ready chance was gained or lost; no extra replay retry needed a repeated answer. The sole refused construction is part of the recorded corpus. These recordings contain neither an `occurrence` field nor a qualifying probability-factor shape, so the census is a compatibility control rather than evidence of conversion yield. The required conversion and admission cases are covered by the root's deterministic RED-first rows.

The baseline is an immutable `git archive` of `926e1c96637b595ca6914c59564f66e5cbc39814`, not the working tree after editing. The corpus and method are specified in `replay-method.md`, with exact source hashes and registered graphs in `replay-base/rows.json` and `replay-after/rows.json`; `replay-comparison.json` holds the comparison. Both explicit replay invocations passed (1 test each, 4.26s and 4.28s). The exact load gate, one worker, `--configLoader=runner` and `/dev/null` stdin were used. This evaluates CEE's registered-graph `chancesWithheldByAGuess` predicate; no served PLoT/ISL Run is implied.

Pilot preparation follows the named P44 harness's strict outgoing schema/body and fake registration dispatch. Paul's preserved B1 source is `/private/tmp/accel-p44/lab/b1.txt`, SHA-256 `a587f2ad55c1d946a3db9e631ac8668df5aba33c1e34305b9e07de43c82ed553`; copied bytes and the origin record are `pilot-brief.txt` and `pilot-brief-source.json`. The exact 5b50b4c8 request was not found locally; it was not recreated or claimed as the live brief.

`pilot-budget.md` authorizes exactly two draws with a finite safe integer cap of at most four provider attempts, using the checked-in construction baseline model/effort. Live staging routing is not independently verified. Both evidence suites skip ordinary CI collection unless their explicit replay/live environment gates are present. The pilot has no mock-draw mode.

The shell's read-only network probe failed DNS resolution (`URLError`, underlying `gaierror`, errno 8). The enabled Node REPL's independent `fetch` probe also failed (`TypeError`). No credential value was emitted or persisted. `pilot-blocked.json` records 0 attempts, 0 draws and null occurrence/probability-factor rates. `scripts/census/event-branch-pilot-runner.py` is ready to read the existing key into memory and run the capped pilot when an authorized network route is available.

Owned files: `acceptance-evidence/event-branch/replay*`, `pilot*`, and `scripts/census/event-branch-{pilot-runner,replay-summary}.py`. This lane changed no production source, committed nothing, pushed nothing, and wrote no store.
