# V5 Phase 3 — input contract & content-thinness diagnostics

**Status:** Live as of 2026-05-18. Companion to PRs #178 / #179 / #180 / #181 and the F1 telemetry addition (`V5DecisionReviewCompleted`).

This note documents the input contract Phase 3 block builders depend on, the structural gaps observed on current staging traffic, and how to read the `v5.decision_review.completed` telemetry event to diagnose thin Phase 3 content end to end.

It is **descriptive, not prescriptive.** It does not propose changes to the run_analysis response, freshness semantics, the chip-click routing, Phase 3 lifecycle, schemas, PLoT, ISL, DGAI, or the `/orchestrate/v2/turn` envelope. Each gap is recorded so the owning team can decide on a fix in a separate workstream.

## TL;DR

Phase 3 currently emits the `analysis_result` block reliably, but several **block families silently drop on most staging traffic** because the input signals they depend on are missing from the PLoT V2 envelope.

| Block family | Required input | Current staging state |
|---|---|---|
| `scenario_context`, `flip_threshold`, `pre_mortem.grounded_in`, `bias.affected_elements`, `evidence_priority` | `enrichment.graph.{nodes,edges}[]` | **Absent at top level** of PLoT envelope |
| `EvidenceBlock` (every entry) | `enrichment.factor_sensitivity[].confidence` | **Often null / absent** per the enricher's contract test |
| `narrative_summary` ReviewCard, `robustness` ReviewCard | LLM-authored fields from v11 decision_review prompt | Length-sensitive; sparse inputs → terse output |

**These drops are intentional fail-closed behaviour.** The composer in `src/orchestrator-v5/compose/phase3-blocks.ts` is correctly refusing to emit blocks whose target refs can't be resolved or whose severities can't be backed by calibrated signal. The fix surface is **upstream of the composer**, not in the composer.

## Phase 3 input contract

Every Phase 3 block builder reads from one of two surfaces on the persisted run_analysis fact:

1. `fact.result.enrichment` — a **byte-for-byte pass-through of the PLoT V2 response envelope** (set verbatim in [src/orchestrator-v5/tools/handlers/run-analysis.ts:542](../../src/orchestrator-v5/tools/handlers/run-analysis.ts)). The handler-ownership invariant explicitly forbids CEE-derived fields here.
2. `fact.result.enrichment.decision_review` — the v11 decision_review LLM output, attached as a verbatim pass-through (plus a CEE-added `produced_at` timestamp) by [src/orchestrator-v5/coaching/decision-review-enricher.ts:209](../../src/orchestrator-v5/coaching/decision-review-enricher.ts).

The dependency map below pairs each block kind with the source field it gates on.

### Graph-ref block family (requires `enrichment.graph`)

`buildGraphNodeLookup` ([phase3-blocks.ts:163](../../src/orchestrator-v5/compose/phase3-blocks.ts)) builds a `factor_id` / `edge_id` → `{id, label, kind}` Map by reading `enrichment.graph.nodes[]` and `enrichment.graph.edges[]`. When `enrichment.graph` is absent, the Map is empty and the following blocks drop at their lookup gates:

- **`scenario_context`** ReviewCardBlock — `dr.scenario_contexts` is keyed by `edge_id`; entries drop at [phase3-blocks.ts:933-941](../../src/orchestrator-v5/compose/phase3-blocks.ts) when `lookup.get(edge_id) === undefined`.
- **`flip_threshold`** ReviewCardBlock — `dr.flip_thresholds[].factor_id` must resolve; drops at [phase3-blocks.ts:711-712](../../src/orchestrator-v5/compose/phase3-blocks.ts).
- **`pre_mortem`** ReviewCardBlock — `grounded_in[]` refs must all resolve; drops at [phase3-blocks.ts:626-680](../../src/orchestrator-v5/compose/phase3-blocks.ts).
- **`bias`** ReviewCardBlock — `affected_elements[]` refs must resolve; drops at [phase3-blocks.ts:771](../../src/orchestrator-v5/compose/phase3-blocks.ts).
- **`evidence_priority`** ReviewCardBlock — top-1 evidence_enhancement factor must resolve; drops at [phase3-blocks.ts:830-872](../../src/orchestrator-v5/compose/phase3-blocks.ts).
- **`EvidenceBlock`** label resolution — factor_id → label fallback fails; drops at [phase3-blocks.ts:462](../../src/orchestrator-v5/compose/phase3-blocks.ts).

The decision_review enricher itself also reads `enrichment.graph` ([decision-review-enricher.ts:501](../../src/orchestrator-v5/coaching/decision-review-enricher.ts)) to build the label / unit maps that feed `isl_results` into the prompt. When absent, the prompt receives `factor_id` strings only — the v11 prompt is instructed not to use raw IDs in user-facing prose, so the output prose loses grounding even before composer rendering.

### Calibrated-confidence block family (requires `enrichment.factor_sensitivity[].confidence`)

`buildFactorConfidenceLookup` ([phase3-blocks.ts:253](../../src/orchestrator-v5/compose/phase3-blocks.ts)) maps `factor_id` → `'high' | 'medium' | 'low'` strictly from `enrichment.factor_sensitivity[].confidence`. Per the in-source comment (lines 231-251) and the contract test [decision-review-enricher.contract.test.ts:321](../../src/orchestrator-v5/coaching/__tests__/decision-review-enricher.contract.test.ts), v11 decision_review does **not** expose per-entry calibrated confidence inside `evidence_enhancements`; this is the only source today.

When `confidence` is null / missing / non-finite, the factor is **omitted from the lookup** (intentional — defaulting would mislabel EvidenceBlock severity as critical/warning based on a fabricated band). EvidenceBlock emission then drops the entry at [phase3-blocks.ts:507-508](../../src/orchestrator-v5/compose/phase3-blocks.ts), even when `decision_review.evidence_enhancements` is well-populated.

### LLM-output-driven block family (requires populated v11 prompt output)

The narrative + robustness ReviewCards depend purely on string content authored by the v11 decision_review LLM:

- **`narrative_summary`** ReviewCardBlock — drops on empty `dr.narrative_summary` at [phase3-blocks.ts:600-625](../../src/orchestrator-v5/compose/phase3-blocks.ts).
- **`robustness`** ReviewCardBlock — drops on empty `dr.robustness_explanation.summary` at [phase3-blocks.ts:800-829](../../src/orchestrator-v5/compose/phase3-blocks.ts).

These fields are LLM-authored and not derived by CEE. The v11 prompt ([src/prompts/defaults.ts:1350-1518](../../src/prompts/defaults.ts)) enforces strict "do not fabricate" rules — given lean PLoT inputs (few fragile_edges, null confidences, lean `option_comparison`), the prompt correctly emits sparse output. Composer fail-closed thresholds then drop the corresponding cards.

## Current staging gaps (observed)

### Gap 1 — `enrichment.graph` absent at envelope top level

PLoT's `V2RunResponseEnvelope` ([src/orchestrator/types.ts:376-406](../../src/orchestrator/types.ts)) defines `meta`, `results`, `fact_objects`, `review_cards`, `robustness`, `decision_brief`, `factor_sensitivity`, `constraint_analysis`, `response_hash` — **no `graph` field at top level.** The staging fixture [tests/fixtures/cross-service/v5-turn.run-analysis.staging.json](../../tests/fixtures/cross-service/v5-turn.run-analysis.staging.json) has `graph` only nested inside `payloads.isl_request.graph` (ISL debug echo, not a contract field).

**Effect:** every block in the graph-ref family drops on every production run_analysis turn.

### Gap 2 — `factor_sensitivity[].confidence` often missing

The enricher contract test [decision-review-enricher.contract.test.ts:321](../../src/orchestrator-v5/coaching/__tests__/decision-review-enricher.contract.test.ts) pins a real PLoT envelope shape where `confidence` is absent.

**Effect:** EvidenceBlock emission is near-zero on production traffic even when v11 produces non-empty `evidence_enhancements`.

### Gap 3 — v11 output density compounds upstream sparsity

Because Gaps 1 and 2 also weaken the prompt's inputs (no graph label map, fragile_edges with no calibrated confidences, lean option_comparison), the LLM's narrative / robustness output is itself terse. This is the v11 prompt behaving correctly, not a CEE bug.

## Composer behaviour is intentional

Every drop site listed above is documented as fail-closed in the composer source. The invariant at [phase3-blocks.ts:52-54](../../src/orchestrator-v5/compose/phase3-blocks.ts) is:

> Never emit a block whose target refs cannot be resolved, and never emit a severity that isn't backed by a real calibrated signal.

Fabricating a label or defaulting a confidence band would produce blocks that mislead the user — worse than emitting nothing. The current behaviour is correct given the inputs available.

## Diagnosing thin Phase 3 content with `v5.decision_review.completed`

The F1 telemetry event (added 2026-05-18) fires once per successful decision_review invocation, after the sanitised enrichment has been attached to the run_analysis handler fact. It is **mutually exclusive with `v5.decision_review.failed`** for any given `request_id` — a throw between shape extraction and attach lands in the catch block and emits `failed`, not `completed`. Its payload pairs an **input-density** snapshot (read from the raw PLoT V2 enrichment) with an **output-density** snapshot (read from the LLM result). Every non-routing field is a finite number or boolean — never a string, array, or nested object; never prose, labels, IDs, brief text, or decision_review content.

### Payload fields

**Routing (strings; also on `invoked` / `skipped` / `failed`):**
- `request_id`, `scenario_id`

**Timing:**
- `duration_ms` — wall-clock window from invoked-emit through successful attach (LLM round-trip + shape extraction + sanitise + attach). Measures the full success-path latency, not just the LLM call.

**Input density (from `enrichment`, pre-prompt):**
- `enrichment_has_graph` — `true` iff `enrichment.graph` is an object AND both `graph.nodes` and `graph.edges` are arrays. Matches what `buildGraphNodeLookup` consumes — a `{nodes: 'oops'}` shape reports `false`. Gap 1 signal; must be `true` for graph-ref blocks to emit.
- `enrichment_graph_node_count`, `enrichment_graph_edge_count`
- `enrichment_factor_sensitivity_count`
- `enrichment_factor_sensitivity_with_confidence_count` — Gap 2 signal. The delta against `*_count` is the EvidenceBlock drop rate.
- `enrichment_robustness_fragile_edges_count` — feeds prompt-side scenario_contexts selection.
- `enrichment_results_count`, `enrichment_option_comparison_count`, `enrichment_decision_brief_options_count` — PR #180 fallback chain density.

**Output density (from `result.output`, post-LLM, pre-sanitise):**
- `output_narrative_summary_length` — zero means the narrative ReviewCard will drop.
- `output_robustness_explanation_summary_length`, `output_robustness_stability_factors_count`, `output_robustness_fragility_factors_count`
- `output_evidence_enhancements_count` — raw count of keys in the `evidence_enhancements` map (LLM-emitted entries).
- `output_evidence_enhancements_usable_count` — count of entries whose `specific_action`, `rationale`, AND `decision_hygiene` are all non-empty **after trimming**. Mirrors the composer's EvidenceBlock drop gate at [phase3-blocks.ts:469-486](../../src/orchestrator-v5/compose/phase3-blocks.ts), which calls `.trim()` on each field before length-checking — a whitespace-only entry like `"   "` is treated as empty and does NOT count as usable. The delta against `*_count` is the count of stub entries the LLM emitted but the composer would drop on prose-validation grounds (independent of the RC-2 confidence-lookup gate).
- `output_scenario_contexts_count`, `output_flip_thresholds_count`
- `output_bias_findings_count`, `output_key_assumptions_count`, `output_decision_quality_prompts_count`, `output_story_headlines_count`
- `output_has_pre_mortem`, `output_has_framing_check`

### Reading the event

Triage flow for a turn with thin Phase 3 content:

1. **Is `enrichment_has_graph` false?** → Gap 1 is firing. Every graph-ref block dropped. Fix is upstream (PLoT to surface graph) or a CEE side-channel (out of scope today; see `cee-read-only-investigation-workstream-sprightly-manatee.md` F3/F4).
2. **Is `enrichment_factor_sensitivity_count > 0` but `enrichment_factor_sensitivity_with_confidence_count == 0`?** → Gap 2 is firing. EvidenceBlocks will all drop. Fix is upstream (PLoT/ISL to populate confidence).
3. **Are input fields populated but output fields zero / very short?** → Gap 3 is firing. The v11 prompt is over-filtering. Fix is prompt-side (out of scope; track separately).
4. **Are output fields populated but the rendered turn lacks the corresponding blocks?** → Composer-side drop (likely from missing graph; cross-check Gap 1). The composer is doing the right thing; the data it needs isn't there.

## Pointers for future work

- The associated read-only investigation findings (root causes, triaged fix list, ownership boundaries) are at `/Users/paulslee/.claude/plans/cee-read-only-investigation-workstream-sprightly-manatee.md` (local plan file).
- The relevant memory notes are `project_v5_phase3_decision_review` (PR #178/#179/#180 history) and the M1 and PLoT/M1 BRIEF_MISSING follow-ups for adjacent enrichment paths.
- This document is the data contract; the plan file is the diagnostic + triage layer.
