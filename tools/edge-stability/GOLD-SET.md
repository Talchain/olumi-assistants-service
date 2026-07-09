# Edge-Stability gold set

The locked set of briefs the harness runs. Changes require explicit review and a version
bump with rationale (a regression harness is only meaningful against a stable corpus).

## v0 (2026-07-09)
The six bakeoff-v6 golden briefs — reused as-is to ship the first-ever measurement without
blocking on corpus growth. Source: `tools/bakeoff-v6/tests/fixtures/golden-briefs/`.

| id | one-line |
|---|---|
| buy-vs-build | CRM: buy commercial vs build custom |
| expand-vs-focus | expand into Europe vs focus on US |
| f10 | (recovered production brief) |
| hire-vs-contract | full-time engineers vs contractors |
| migrate-vs-stay | migrate platform vs stay |
| technical-debt | Q1 refactor auth vs ship features |

Seeds for v0: `17, 42, 101, 2024, 7` (5 independent draws).

## Planned v1 (target 20+, per acceptance item 2)
Grow toward 20+ diverse briefs (varied domain, option count, numeric density, brief length).
Each addition lands here with: id, one-line, why-added, and the date. Growth is staged so
per-run cost scales deliberately (each brief = N draft calls + N PLoT runs per harness run).

## Change log
- **v0 (2026-07-09):** initial lock — the 6 bakeoff golden briefs, seeds 17/42/101/2024/7.
