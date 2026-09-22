# Criterion 4 is met on deployed staging — with a discriminating control, not a one-directional green

**22 Sep 2026 · deployed build `a459d23` (staging `a459d23aa8c19efcf6aee2de427dec835c46aa7c`) · signed-in · 0 SKIP**

#1686 merged at 13:38:55Z and deployed. The hardened spine witness, run against
the new build with the baseline taken on `c12a54d` for comparison:

| | `c12a54d` (before) | `a459d23` (after) |
|---|---|---|
| **total** | 16 PASS · 6 FAIL | **18 PASS · 4 FAIL** |
| criterion 4 | **FAIL** | **PASS** |
| criteria 1 · 2a · 3 · 6 | PASS | PASS (held) |
| criterion 2b (#1685) | FAIL | FAIL (unmerged) |
| criterion 5 (#1679) | FAIL | FAIL (unmerged) |

Nothing regressed. The two rows that flipped are exactly the two #1686 owned.

## Why this is evidence and not a green tick

The danger with #1686 was never "does it accept a proportion" — it is that the
**rejected first version accepted it everywhere**, and would have written `0.8`
onto factors where `0.8` means **80**. On `c12a54d` the product refused `0.8` on
*both* factor shapes **with the same sentence**, so any one-directional probe
would have scored a corrupting build and a correct build identically.

The pair parts company on `a459d23`:

| factor | shape | deployed behaviour | persisted |
|---|---|---|---|
| `f9223d57` Product-Market Fit Investment | `unit:'scale'`, **no cap**, no `raw_value` | *"Updated Product-Market Fit Investment from 0.3 scale to…"* | **0.8** ✓ |
| `fac_internal_pipeline` | `unit:'scale'`, **`cap:100`**, `raw_value:20` | *"That looks like a proportion rather than a value in scale…"* | **0.2, untouched** ✓ |

The control's shape is copied verbatim from live staging — one of **128 real
`cap=100` proportion-unit factors** (contrast control, same query: 2,611
proportion-unit factors overall, 663 capped). There `value = raw_value/cap`.

**Status rung: JOURNEY-WITNESSED on deployed staging, 22 Sep 2026.**

---

# Priority 4 — the lifecycle already holds at the CEE seam. No build work needed.

*graph revision → analysis freshness → readiness → displayed result*, measured on
the wire on `a459d23` (`witness/lifecycle.mjs`, capture `lifecycle-a459d23.json`).
The probe walks the **whole** payload for freshness/revision carriers rather than
assuming where they sit.

| | after `run the analysis` | after editing Sales Cycle Length |
|---|---|---|
| `analysis_ready.freshness` | `fresh` | **`stale`** |
| `analysis_ready.freshness_reason` | `graph_hash_match` | **`graph_hash_diverged`** |
| `analysis_ready.graph_hash_at_run` | `56eacec6adfe21a0` | `56eacec6adfe21a0` (pinned to the run) |
| `analysis_ready.current_graph_hash` | `56eacec6adfe21a0` | **`96cae050527f3884`** (moved) |
| `blocks[].freshness` | `fresh` | **`stale`** |
| `blocks[].graph_hash_at_generation` | `56eacec6adfe21a0` | `56eacec6adfe21a0` |

And the product **says so in words, unprompted**:

> *"These results may be out of date because the model has changed since the last
> analysis. Before the recent change to sales cycle length, moving upmarket to
> enterprise scored highest against your goal in 68% of runs…"*

So the revision → freshness → displayed-result chain is coherent and truthful at
the seam, and the block-level and payload-level carriers agree. **Priority 4
needs no new controller or field** — the authority already exists and is single.

## Two things this does NOT prove

1. ⚠ **`readiness` does not demote on staleness** — `analysis_ready.status` stays
   `ready` and `may_run` stays `true` while `freshness === 'stale'`. That reads
   as *correct* (a stale analysis is precisely one you may re-run), but it means
   **`status`/`may_run` must never be used as a freshness signal**. The freshness
   verdict is `freshness` / `freshness_reason` and nothing else.
2. ⛔ **This is the CEE seam, not the rendered surface.** Whether the UI actually
   renders `freshness: 'stale'` to the user is a DGAI question and is **not
   witnessed here**. CEE emits no editability or display signal of its own
   (`read_only|readOnly|is_editable|not_editable` = 0 across CEE `src/`
   non-test; contrast in the same run `may_run` 74, `blocked` 481). A carrier
   present on the wire is not a thing a user has seen.
