# UI ⇄ CEE wire-contract skew — evidence pack (0.8.1 vs 0.13.0)

**Date:** 2026-07-02 · **CEE ref:** `origin/staging` @ `2376914c8` (post-#318) · **Status:** live output-loss
defect, not future polish.

## 1. The skew

| Consumer | `@talchain/schemas` pin | Source |
|---|---|---|
| CEE (this repo) | **0.13.0** | `package.json` → `file:./vendor/talchain-schemas-0.13.0.tgz` (pin guarded by the pre-push `tarball-sha` gate) |
| DecisionGuideAI (UI) | **0.8.1** | DGAI `package.json` → `file:./vendor/talchain-schemas-0.8.1.tgz` |

The platform's documented dominant hazard is exactly this: a consumer on an older schema version
**silently drops** fields it doesn't know. The UI's boundary validation is observational only —
`warnOnInvalidApiResponse()` in DGAI `src/lib/api-schemas.ts` `safeParse`s and logs but never
rejects — so nothing fails closed and nothing alerts when output is lost.

## 2. The actual wire shape at 0.13.0

The UI-facing wire shape of `POST /orchestrate/v2/turn` is the **strict** `OlumiResponseSchema`
from `@talchain/schemas/boundary`:

- Egress seam: `src/orchestrator/route-v2.ts` validates the candidate response against the strict
  schema (`validateEgress`), with underscore-prefixed debug fields (`_timings`,
  `_diagnostic_trace`, `_context_summary`) stripped before and re-attached after validation via
  `src/orchestrator/debug-fields.ts`.
- Top-level keys (all of them — the schema is strict, unknown keys are rejected):
  `response_version` (literal 2), `assistant_text`, `blocks`, `suggested_actions`, `insights`,
  `stage_indicator` (`frame|analyse|decide|review`), `draft_graph?`, `analysis_ready?`.

### Premise correction (supersedes earlier claims)

There are **no top-level `guidance_items`, `chips`, or `next_best_action` fields on the v2 wire**.
The strict egress schema rejects them (proven by runtime probe in the pin test, §5).
`guidance_items` exists only inside the legacy v1 deterministic orchestrator
(`src/orchestrator/deterministic/actions/*`); `next_best_action` does not exist in CEE `src/` at
all. Any earlier statement implying these are droppable top-level wire fields is superseded.

## 3. What a 0.8.1 consumer drops today

1. **The four Phase-3 block types (0.13.0-new) — the biggest loss.** `BlockSchema`'s discriminated
   union has 12 block types at 0.13.0; these four are unknown to 0.8.1:
   - `coaching` (`CoachingBlockSchema` — 15 fields incl. `coaching_kind`, `signal_id`,
     `freshness`, `priority_rank`, `target_refs`, `action_intent`, `action_label`)
   - `review_card` (`ReviewCardBlockSchema` — incl. `card_kind`, `severity`)
   - `evidence` (`EvidenceBlockSchema` — incl. `evidence_gap`, `current_confidence`,
     `impact_if_gathered`, `suggested_technique`)
   - `exercise` (`ExerciseBlockSchema` — incl. `exercise_kind`, `counter_case`,
     `failure_scenario`, `mitigation`, `reference_class`, `warning_signs`)

   CEE may already be producing coaching / evidence / exercise / review-card output that the UI
   cannot recognise or render.
2. **`suggested_actions[].action_type`** (added 0.5.0) and the **`ChipSchema`** export
   (`action`/`id`/`label`) — chips-on-the-wire ride `suggested_actions`; the golden-journey
   harness reads them there (`tools/golden-journey-harness/observation.ts` `getChips`).
3. **Enrichment values on schema-unpinned carriers.** The carriers are declared open —
   `blocks[].enrichment` is `z.record(z.unknown())` on `AnalysisResultBlockSchema`,
   `ExplanationBlockSchema`, `FlipAnalysisBlockSchema`; `analysis_ready` is a passthrough object
   (declared keys only `goal_node_id`, `options`, `status`). Runtime keys riding them today:
   `edge_e_values`, `flip_thresholds`, `confidence_tier`, `inference_warnings`,
   `factor_sensitivity`, `m1_coaching`, `conditional_probabilities`.
   Producers: `src/orchestrator-v5/compose.ts` and
   `src/orchestrator-v5/coaching/decision-review-enricher.ts` (plus the PLoT enrichment keep-list
   seam, PR #297). The UI probes some of these only as evidence-promotion *gate keys*
   (DGAI `src/lib/v5EvidenceKeys.ts`) — the values themselves are not extracted or displayed.
4. **UI-side adapted-but-partially-rendered fields** (not a schema-version issue, but part of the
   same output-loss picture): `strengthen_items[].actionType` and `strengthen_items[].biasCategory`
   are mapped by DGAI `src/adapters/cee/client.ts` `mapDraftCoachingFromResponse()`. As of the
   Brief 5.8B D2b overlay, `actionType` IS now rendered
   (`src/canvas/components/pre-analysis/utils/applyStrengthenOverlay.ts` →
   `TriageActionCardsBody.tsx` / `PreAnalysisPanel.tsx`); `biasCategory` remains mapped but never
   consumed by any component.

## 4. Why the loss is silent

- CEE egress is strict and correct — the producer cannot emit malformed output.
- DGAI ingestion validates observationally (`warnOnInvalidApiResponse` logs, never rejects) and
  0.8.1 Zod schemas simply have no knowledge of the four new block types, so they are dropped
  without even a warning that names them.
- No field-arrival telemetry exists on either side (DGAI `src/telemetry/guidanceEvents.ts` tracks
  coaching shown/clicked/dismissed, not received).

## 5. The guard added with this doc

`tests/contract/cee-egress-wire-surface-pin.test.ts` (this branch) pins the UI-relevant wire
surface at 0.13.0 by deterministic Zod introspection (no fixtures, no network):

- top-level key set + strictness + optionality;
- runtime probe that top-level `guidance_items`/`chips`/`next_best_action` are rejected;
- the 12 block-type discriminators + the named 4-type UI-unknown subset;
- exact key sets of the four Phase-3 block schemas;
- `ActionSchema`/`ChipSchema` key sets;
- the enrichment carriers (presence + `analysis_ready` passthrough keys).

It is collected by `pnpm test:required` (the required CI gate), so **any future schema bump that
changes the UI-relevant wire surface fails loudly**. Update protocol on failure: update the pins,
update this doc, and coordinate the DGAI schema bump before merging.

Run locally: `pnpm vitest run tests/contract/cee-egress-wire-surface-pin.test.ts`.

## 6. Recommended next slices (separate lanes, Paul to sequence)

1. **DGAI schema bump 0.8.1 → 0.13.0** — the keystone fix for the output loss (plan doc in the
   DGAI repo, this workstream; implementation branch needs separate authorisation).
2. DGAI rendering for the four Phase-3 block types + `action_type` affordances.
3. Field-arrival observability (`coaching_received`-style events) so silent drops become visible.
4. Decide whether the enrichment carriers should gain a typed keep-list at the contract level
   (they are the known-open seam; see also PR #297's compose-seam keep-list).
