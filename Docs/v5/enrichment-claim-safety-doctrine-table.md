# Enrichment claim-safety doctrine table (salvaged from PR #293)

**Status:** DRAFT DOCTRINE — provisional, **pending Neil/Jinghui ratification**.
Not implemented anywhere. This is a doctrine record, not a contract.
**Extracted:** 2026-07-19 from PR #293 (`feat(v5): add decision data spine proof
slice`), which was closed unmerged.

## Why this file exists

PR #293 proposed a "decision data spine" — a read-side classifier under
`src/orchestrator-v5/spine/` that narrowed the live `blocks[0].enrichment`
payload into a typed scientific view and tagged each field with provenance and
claim-safety. **That architecture was abandoned.** The classifier, its
fail-closed dispute logic, its isolation tests and its sanitised fixture all
went with it and are not salvaged here.

What survives is the residue worth keeping: the **table itself** — the
per-field judgement of where each enrichment key comes from and how far a
user-facing claim may lean on it. That judgement was real work and exists
nowhere else on `staging`. It is reproduced below so the next lane to touch
claim-safety starts from it rather than re-deriving it.

## The two rules that govern the table

1. **No field defaults to `claim_safe`.** Not one of the 40. PR #293's own test
   suite asserted this as an invariant.
2. **Causal-effect-like fields floor at `not_claim_safe`.** Everything
   descriptive floors at `conservative`. `metadata` is `unknown` because
   transport and diagnostic fields are not scientific claims at all.

`conservative` here means: may be surfaced, but only in descriptive,
non-causal, non-empirical language. `not_claim_safe` means: must not be
surfaced as a claim about the world.

## Scope and provenance of the table

- **40 keys**, matching `blocks[0].enrichment` of
  `tests/fixtures/cross-service/v5-turn.run-analysis.staging.json` as captured
  at the time of #293. The live shape may have drifted since — **re-derive the
  key set before relying on this being complete.**
- `provenance` values: `plot_engine` (PLoT assembly/adapter layer), `isl`
  (Inference-Service-Layer compute), `coaching_m1` (M1 coaching prose),
  `cee_meta` (CEE-generated metadata).
- The `[DRAFT] … pending ratification` prefix carried on almost every reason
  string in #293 has been lifted into this document's status line rather than
  repeated on all 40 rows. Every row below is draft.

## The table

| Enrichment field | Category | Provenance | Default claim-safety | Reason |
|---|---|---|---|---|
| `option_comparison` | comparison | `plot_engine` | **conservative** | descriptive model output, not real-world truth; non-causal; non-empirical |
| `conditional_winners` | comparison | `plot_engine` | **conservative** | descriptive model output, not real-world truth; non-causal; non-empirical |
| `decision_brief` | comparison | `cee_meta` | **conservative** | descriptive model output, not real-world truth; non-causal; non-empirical |
| `factor_sensitivity` | sensitivity | `isl` | **conservative** | composite — sensitivity + embedded VOI/EVPI + confidence; conservative pending ratification |
| `edge_sensitivity` | sensitivity | `plot_engine` | **conservative** | edge sensitivity; conservative pending ratification; shape unverified (empty in reference fixture) |
| `factor_stability` | robustness | `isl` | **conservative** | stability metric; conservative pending ratification |
| `stability_thresholds` | robustness | `cee_meta` | **conservative** | stability thresholds (operational defaults); conservative pending ratification |
| `robustness` | robustness | `isl` | **conservative** | robustness assessment; conservative pending ratification |
| `robustness_synthesis` | robustness | `cee_meta` | **conservative** | robustness synthesis; conservative pending ratification |
| `confidence_tier` | confidence | `isl` | **conservative** | confidence tier; conservative pending ratification |
| `decision_quality` | confidence | `cee_meta` | **conservative** | decision-quality signal; conservative pending ratification |
| `identifiability` | identifiability | `isl` | **conservative** | identifiability; conservative pending ratification |
| `inference_warnings` | calibration | `isl` | **conservative** | calibration / inference warnings; conservative pending ratification |
| `flip_thresholds` | causal_effect | `isl` | **not_claim_safe** | causal-effect-like counterfactual (tipping point); not claim-safe by default |
| `edge_e_values` | causal_effect | `isl` | **not_claim_safe** | causal-effect-like (edge E-values); not claim-safe by default; shape unverified (empty in reference fixture) |
| `m1_coaching` | other | `coaching_m1` | **conservative** | coaching narrative; conservative pending ratification |
| `m1_review` | other | `coaching_m1` | **conservative** | coaching review; conservative pending ratification |
| `improvement_guidance` | other | `coaching_m1` | **conservative** | coaching guidance; conservative pending ratification |
| `critiques` | other | `isl` | **conservative** | ISL critiques; conservative pending ratification |
| `review_cards` | other | `cee_meta` | **conservative** | review cards; conservative pending ratification |
| `insights` | other | `cee_meta` | **conservative** | insights; conservative pending ratification |
| `rationale` | other | `cee_meta` | **conservative** | rationale; conservative pending ratification |
| `analysis_status` | metadata | `cee_meta` | **unknown** | transport/diagnostic metadata; not a scientific claim |
| `option_comparison_status` | metadata | `cee_meta` | **unknown** | transport/diagnostic metadata; not a scientific claim |
| `robustness_status` | metadata | `cee_meta` | **unknown** | transport/diagnostic metadata; not a scientific claim |
| `drivers_status` | metadata | `cee_meta` | **unknown** | transport/diagnostic metadata; not a scientific claim |
| `isl_analysis_status` | metadata | `isl` | **unknown** | transport/diagnostic metadata; not a scientific claim |
| `review_status` | metadata | `cee_meta` | **unknown** | transport/diagnostic metadata; not a scientific claim |
| `review_skip_reason` | metadata | `cee_meta` | **unknown** | transport/diagnostic metadata; not a scientific claim |
| `cee_status` | metadata | `cee_meta` | **unknown** | transport/diagnostic metadata; not a scientific claim |
| `request_id` | metadata | `cee_meta` | **unknown** | transport/diagnostic metadata; not a scientific claim |
| `response_hash` | metadata | `cee_meta` | **unknown** | transport/diagnostic metadata; not a scientific claim |
| `processing_time_ms` | metadata | `cee_meta` | **unknown** | transport/diagnostic metadata; not a scientific claim |
| `request_schema_version` | metadata | `cee_meta` | **unknown** | transport/diagnostic metadata; not a scientific claim |
| `endpoint_version` | metadata | `cee_meta` | **unknown** | transport/diagnostic metadata; not a scientific claim |
| `preflight_version` | metadata | `cee_meta` | **unknown** | transport/diagnostic metadata; not a scientific claim |
| `downstream_calls` | metadata | `cee_meta` | **unknown** | transport/diagnostic metadata; not a scientific claim |
| `fact_objects` | metadata | `cee_meta` | **unknown** | transport/diagnostic metadata; not a scientific claim |
| `_meta` | metadata | `cee_meta` | **unknown** | transport/diagnostic metadata; not a scientific claim |
| `meta` | metadata | `cee_meta` | **unknown** | transport/diagnostic metadata; not a scientific claim |

## What was NOT salvaged, and why

- **`claim-safety.ts` classifier, `enrichment-scientific-view.ts` narrower, the
  barrel, three test files and the sanitised fixture.** The architecture they
  belonged to was abandoned; landing the code would preserve a dead shape and
  imply the design is still live.
- **The `computeDisputeContext` fail-closed logic** (absent status companion →
  `status_not_computed` → preserves the `not_claim_safe` floor). This was the
  genuinely sharp idea in #293 and is recorded here in one sentence rather than
  as code, because it only makes sense inside the classifier that was dropped.
- **The `claim_safe` absence invariant as an executable test.** Recorded above
  as rule 1. There is nothing for it to assert against on `staging`.

## Known limitation, recorded by #293 itself

Claim-safety in #293 was re-derived on read and **never persisted**. The
consequence, stated in the PR: it could not answer historical audit questions
("which past analyses were claim-unsafe?"). Persistence would be a separate
lane requiring re-sequencing. That limitation carries forward to anything built
from this table.
