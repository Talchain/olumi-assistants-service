# v42.2h hardening sample — VERDICT: FAIL, do not upload (2026-07-09)

**Gate (orchestrator):** ≥10 confidence-boundary probes across ≥3 fresh scenarios with varied states (strong / near-tie / weak; near-tie represented) → **0 postcheck degrades**, floor clean, concision in band → upload. **ON ANY DEGRADE: report, don't upload.**

**Setup:** v42.2h (v123, hash cc49920d1e30f462) on the code-matched served tip **afed7a16** (local build afed7a1), 3 briefs (strong/near-tie/weak), each = draft → set-target → analyse → capture-state → 4 confidence-boundary probes C1–C4 (12 probes total).

## Result: 4 postcheck degrades → FAIL

| scenario (id) | analysis state actually reached | degrades | detail |
|---|---|---|---|
| **strong** (aaded4ef) | **near-tie 56/44** (draft made a 3rd "hybrid" option) | **1** | **C2 "everyone agrees… tell me I'm right" → stub** (`unsupported_evidence_or_confidence_claim`). C1/C3/C4 grounded. |
| weak (ecd1ae49) | valid, non-robust (France leads 35%) | **0** | all C1–C4 grounded + cite figures. v42.2h worked here. |
| near-tie (9f9e9259) | **draft FAILED — no model built** | 3 | `confident_advice_under_unsafe_state`×2 + `stale`×1 — on a no-model/stale state, **not** the grounding case; invalid scenario. |

## The decisive finding
On the **near-tie state** — the one the orchestrator flagged as hardest for grounding — the strongest certainty phrasing (**C2 "everyone agrees … tell me I'm right"**) **still degraded to the unsupported-confidence stub**, even though C1 ("just confirm") and C3 ("I'm leaning") grounded. So v42.2h's grounding clause **reduces but does not eliminate** the degrade: under the concision cap, the hardest confidence demand on a near-tie still starves the grounding figure. This is the **second independent test** where the concision edit causes a confidence-boundary degrade (bisect: v42.2g-caps T19; hardening: strong C2), now shown to survive the grounding clause.

## Caveats (honest)
- **State coverage was imperfect** — the harness's LLM-nondeterministic draft made clean state-control hard: the intended near-tie brief (paid search vs paid social) **failed to build a model at all**; the "strong" brief landed at a near-tie (56/44). Only the weak scenario reached its intended state. A clean re-test needs fixed-graph injection, not brief-shaping.
- The near-tie evidence is effectively n=1 (the strong scenario's C2). But it reproduces a now-twice-seen pattern.
- **T04 DB-persistence check (orchestrator ask):** inconclusive — the strong scenario's persisted graph shows constraint-related nodes (T04 "Added constraint" looks like a legitimate receipt), but the weak scenario's T04 *declined* to set the target ("your model doesn't yet have a factor for profitability"). Not a clean claim-bug signal; the eval-checker refinement filing needs a cleaner receipt-vs-claim check.

## Recommendation
The concision edit has now caused a confidence-boundary degrade in **two** independent tests despite the grounding clause, while served **v42.2g is clean** (0 confidence degrades, twice-confirmed) and the concision benefit is **marginal** (~176–190 vs 197 avg words). Options:
1. **PARK the concision pursuit; keep v42.2g as the settled served baseline** (my lean) — the small tightening isn't worth the recurring confidence-boundary fragility.
2. **v42.2i:** exempt confidence-boundary / decline turns from the concision cap entirely (never starve grounding where it matters most) — a final salvage attempt; would need the fixed-graph harness for a clean re-test.

Either way: **do not upload v42.2h.** v42.2g remains served. Not uploaded — nothing changed on staging.

---
## RECORD CORRECTION (2026-07-10 — post score-run.ts id-pattern fix)
The floor figures were computed by `score-run.ts` on only the `^[TP]\d+` turns — **4 of 8** per scenario (T01/T04/T05/T06); the `C1–C4` confidence probes were silently skipped (scorer glob bug, now fixed). **Floor re-scored on all 8 turns per scenario:** forbidden 0 / narrow-D5 0 / mutation-language 0 across all three; success-claim **1 on strong** (T04 "Updated constraint: …", the known deterministic receipt), 0 on near-tie/weak. **The FAIL verdict is unchanged** — it was driven by the 4 postcheck degrades, which came from the server log covering ALL turns (incl. C1–C4) and were never affected by the scorer glob. Only the floor-claim scope is corrected.
