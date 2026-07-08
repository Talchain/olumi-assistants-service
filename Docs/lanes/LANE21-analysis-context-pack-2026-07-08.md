# Lane 21 (P0-A) — widen the ContextPack analysis projection to banded full-analysis coverage

**Branch:** `claude-lane21/analysis-context-pack` (base: `origin/staging` @ `e122f16b6`)
**Scope owned:** `src/orchestrator-v5/context/**`, `src/orchestrator-v5/format/**`, route-with-tool-use wiring (one surgical parity edit at the turn-executor ingress seam).
**Not touched:** PMS / prompt templates (ruling D1), `compose.ts` / transport keep-lists.

## Problem (evidence-verified)

The orchestrator LLM received a ~603-char display-safe summary of the analysis
(2 options, 3 driver labels, no flip thresholds, no VOI, nothing on options
3–4) inside a ~21k-char prompt, while the UI rendered 4 options / 5 factors.
The seam is the ContextPack analysis projection
(`src/orchestrator-v5/context/context-pack-assembler.ts` →
`src/orchestrator-v5/format/format-analysis-for-context.ts`), NOT the
compose.ts keep-list (that feeds the UI).

A second, compounding gap: `src/orchestrator-v5/context/analysis-fallback.ts`
gated the entire enrichment projection on
`compactAnalysis(enrichment).options.length > 0`. The live staging envelope
can carry unusable `option_comparison[]` entries (no option identity) while
its TOP-LEVEL `factor_sensitivity[]` / `robustness` / `flip_thresholds[]` /
`m1_coaching` surfaces are fully populated — the minimal `win_probabilities`
path then silently projected `top_drivers: []`, `robustness_level: 'unknown'`
and no fragile edges.

## Mechanism (what changed, per stage)

### Stage A — projection breadth (`3a7a386e1`)
`projectAnalysis` (context-pack-assembler.ts) now emits, on the raw
handler-facing `ContextPackAnalysis`:

- `options`: EVERY scale-guard-valid option `{label, probability}`, sorted by
  win probability descending, bounded by `MAX_PROJECTED_OPTIONS = 12`.
- `top_drivers`: routed cap widened 3 → 5 (`CONTEXT_PACK_TOP_DRIVER_CAP`,
  UI parity). The chip-click dispatch keeps the legacy default cap of 3 via
  the shared `projectTopDrivers(drivers, controlledIds, cap)` helper —
  ordering / sign / lever-suppression logic remains shared, only breadth
  differs.
- `flip_thresholds`: tipping carriage `{factor_label, current_value,
  flip_value, unit, no_flip_within_bounds}` — attached top-level staging
  signals win; per-option `summary.flip_thresholds` is the fallback.
- `fragile_edge_count`: the UNCAPPED count behind the capped label list.
  Fail-closed: when P0b-1 lever suppression drops any edge, the count
  collapses to the filtered list length (the producer count can no longer be
  attested).
- `evidence_gaps` / `goal_fit`: raw signal slots (see
  `src/orchestrator-v5/context/analysis-signals.ts`).

New module `analysis-signals.ts`: additive intersection type
`AnalysisResponseSummaryWithSignals` (the shared V4 `AnalysisResponseSummary`
is NOT widened) + defensive derivations from the untyped enrichment record:

- `deriveTippingPointsFromTopLevel` — `enrichment.flip_thresholds[]`; keeps
  real flip pairs and producer-attested `flip_reason:
  'no_effect_within_bounds'` rows; drops ambiguous rows; cap 3.
- `deriveEvidenceGapsFromEnrichment` — `m1_coaching.evidence_gaps[]`
  (`voi_score` ∈ [0,1], upstream VOI-ranked order preserved); cap 3.
- `deriveGoalFitFromEnrichment` — PLoT #204: top-level `goal_fit_basis`,
  per-option `option_comparison[].constraint_delivery.goal_fit_basis`, or the
  `CONSTRAINT_GOALFIT_MODELLED_BASIS` note code in `notes[]`/`critiques[]`.
  Projects the FACT goal fit was scored + its basis; never probabilities.

Strict Zod `ContextPackAnalysisSchema` extended with the five optional fields
(strict-mode would otherwise throw in test env on the widened pack).

### Stage B — display-safe banded formatter (`5ed91498a`)
`format-analysis-for-context.ts` (`DisplaySafeAnalysis`) — everything the LLM
sees, doctrine A2 binding (banded / percent phrasing only, structural
no-numbers-anywhere invariant tested recursively):

- `options`: ranked list `{rank: "1", label, win_probability: "72%"}` — rank
  is a string; array order = rank.
- `tipping_points`: `tippingRiskPhrase()` — relative-distance presentation
  bands (`FLIP_PROXIMITY_BANDS`: small <10%, moderate <35%, else large), e.g.
  "close to a tipping point — a small decrease could flip the result";
  direction-only phrase at `current = 0`; producer-attested "no flip point
  found within the tested range". Raw thresholds never surface; entries with
  nothing safe to say are omitted, never fabricated.
- `fragile_edge_count`: string count (`"7"`) behind the capped edge list.
- `value_of_information`: `voiBandPhrase()` — reuses the SHARED
  influence-band vocabulary (`bandFromMagnitude`, near-zero dropped), e.g.
  `{label, value_of_information: "moderate"}`.
- `goal_fit`: "goal fit was scored from the modelled outcome distribution".
- Budget: `DISPLAY_ANALYSIS_CHAR_BUDGET = 4000` asserted against a maximal
  12-option / 5-driver / 3-flip / 3-VOI fixture (pretty-printed serialisation,
  the same form `buildUserMessage` embeds). Typical 4-option runs measure
  ~1.5–2k chars vs the ~603-char starvation baseline.

No route-with-tool-use change was needed for delivery: `buildUserMessage`
already substitutes `display_analysis` for `analysis` when serialising the
pack, so the widened fields reach the prompt automatically.

### Stage C — fallback/projection source reconciliation (`591a2d33c`)
New `reconcileAnalysisSummaryWithEnrichment(summary, enrichment)` in
`analysis-fallback.ts` — the SINGLE composite seam:
`applyTopLevelDriversOverride` + `applyTopLevelFragileEdgeOverride` + Lane 21
signal attachment. Consumed by:

- `buildAnalysisFromPriorFacts` enriched path (options > 0) — unchanged
  semantics, plus signals.
- `buildAnalysisFromPriorFacts` minimal `win_probabilities` path — NEW: when
  the envelope is well-formed (compactAnalysis non-null; blocked/failed still
  skip), the option-independent derived fields (`robustness_level`,
  `fragile_edge_count`, flip/constraint carriage) are merged and the same
  composite runs. The gate can no longer silently drop the top-level surfaces.
- turn-executor body-`analysis_state` ingress seam (the orient wiring feeding
  `assembleContextPackWithSummary` → `routeWithToolUse`): the two separate
  override calls were replaced by the composite, so ingress and prior-facts
  paths project identically by construction. `fragile_edge_source` /
  `top_driver_source` telemetry meanings unchanged.

## Fixture diff (staging shape, `tests/fixtures/cross-service/v5-turn.run-analysis.staging.json`)

Before (LLM-facing analysis section):

```json
{ "status": "complete",
  "leading_option": {"label": "Hire Two Senior Engineers Locally", "win_probability": "72%"},
  "runner_up": {"label": "Maintain Current Team (Status Quo)", "win_probability": "23%"},
  "margin": "49 percentage points", "robustness_band": "moderate",
  "top_drivers": [3 entries], "fragile_edges": [≤3 label pairs] }
```

After (same source data, widened):

```json
{ …all of the above, plus…
  "options": [
    {"rank": "1", "label": "Hire Two Senior Engineers Locally", "win_probability": "72%"},
    {"rank": "2", "label": "Maintain Current Team (Status Quo)", "win_probability": "23%"},
    {"rank": "3", "label": "Engage Offshore Partner", "win_probability": "5%"},
    {"rank": "4", "label": "Introduce Tiered Pricing for Gradual Hiring", "win_probability": "0%"}],
  "top_drivers": [up to 5 entries],
  "fragile_edge_count": "2",
  "value_of_information": [{"label": "Local Talent Market Tightness", "value_of_information": "moderate"}, …],
  "goal_fit": "goal fit was scored from the modelled outcome distribution" }
```

(This fixture's `flip_thresholds[]` rows all carry `flip_value: null` +
`flip_reason: 'no_effect_within_bounds'` → they render as the attested
"no flip point found within the tested range" phrase, not as fabricated
tipping claims.)

## Test results (commands + counts)

- `pnpm exec vitest run src/orchestrator-v5/context/__tests__ src/orchestrator-v5/format/__tests__` → **631 passed / 0 failed** (post-stage-C).
- `pnpm exec vitest run src/orchestrator-v5` (all colocated v5 tests) → **6468 passed / 0 failed / 1 skipped / 11 todo** (302 files). One unrelated flake appeared once in an early stage-B run and did not reproduce on two subsequent full runs.
- RED-first evidence: stage A new suite 10/11 failed on base; stage B 8/27 failed pre-implementation; stage C 5 new tests failed pre-implementation. Each stage's failing run was executed before the fix landed.
- `pnpm typecheck:src` (tsc -p tsconfig.build.json, the repo's real gate) → clean after every stage.
- `pnpm exec eslint <changed files>` → clean after every stage.
- Final gates (stage D): `pnpm test:required`, `pnpm typecheck:src`, pre-push hook (`scripts/validate-prepush.sh`) on the final push — results recorded in the PR body.

## Deliverable 3 — diagnosis notes (documented, not fixed)

### Coaching co-blockers (`brief_present=false`, `autofire_disabled`, advice gate 0-for-8)

1. **`autofire_disabled`** — `config.cee.runAnalysisAwaitDecisionReview`
   defaults **false** (`src/config/index.ts` ~line 531, env
   `V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW`). With the flag off,
   `turn-executor.ts` (~line 5103) skips
   `enrichRunAnalysisWithDecisionReview` entirely and emits
   `v5.decision_review.skipped {reason: 'autofire_disabled'}`. Consequence:
   `enrichment.decision_review` is never persisted, so the ContextPack
   `coaching.decision_review` slot stays null on every later turn. Deploy-env
   decision, not a code defect in this lane's paths.
2. **`brief_present=false`** — the brief given to the enricher resolves from
   `context.scenarioBriefText` = `scenarios.brief_text` (canonical state,
   `build-turn-context.ts:488`, legacy fallback `options.scenarioBrief`).
   The telemetry shows staging scenarios carry no persisted `brief_text`, so
   even with autofire enabled the enricher would skip with `no_brief`
   (`decision-review-enricher.ts` ~line 120). TRUE CO-BLOCKER: enabling the
   flag alone is insufficient; brief persistence must land first (UI/draft
   flow writes `scenarios.brief_text` via `append_turn_atomic(p_brief_text)`,
   `src/orchestrator-v5/commit.ts:70` — the write path exists; production
   flows don't populate it).
3. **Advice gate 0-for-8** — `post-analysis-advice-gate.ts` short-circuits
   only when analysis is present AND freshness is `'fresh'` AND the class
   matcher hits AND per-class inputs exist. Three classes (`improvement`,
   `explain_results_free_text`, `what_would_flip_free_text`) carry
   `needs_top_driver: true`; before this lane the fallback minimal path
   projected `top_drivers: []` on the live staging shape, so those classes
   returned `data_unavailable_for_class` structurally. **Stage C closes that
   specific starvation co-blocker** (top-level drivers now populate on every
   path). Remaining co-blockers, outside owned paths: freshness gating
   (stale/unknown falls through by design) and matcher coverage.

### Prompt-version identity split (served 'v42.1a' vs telemetry 'v40'/21,439)

- The stale constant: `src/orchestrator-v5/routing/prompt-loader.ts:31`
  (`export const ROUTING_PROMPT_VERSION = 'v40'`) plus the module-eager
  `LOADED_PROMPT = loadRoutingPrompt()` (line 113) whose `systemChars` is the
  char count of the ON-DISK `Prompts/v40.txt` (the 21,439 figure; sanity
  range [18,500, 22,000]).
- The live served prompt is resolved per call from the PMS snapshot
  (`ensureRoutingPromptSnapshot()` → `snapshot.version`, e.g. `111` /
  operator name 'v42.1a', `source: 'store'`); route-with-tool-use.ts:465 uses
  the snapshot correctly for `prompt_resolved` telemetry. **The served prompt
  is right; only the assembled-pack telemetry lies.**
- Stale consumers of the constant:
  - `turn-executor.ts` `obsPayload()` (~line 656–661) stamps
    `prompt_version: ROUTING_PROMPT_VERSION`, `prompt_hash:
    ROUTING_PROMPT_HASH`, `system_chars: ROUTING_PROMPT_SYSTEM_CHARS` onto
    every lifecycle event including `ContextPackAssembled` — this is the
    'v40' / 21,439-char telemetry.
  - `route-with-tool-use.ts:176` re-exports `ROUTING_PROMPT_VERSION =
    LOADED_PROMPT.version` and uses it in the cache-telemetry payload
    (~line 285) and the module-init `v5.routing_prompt_loaded` log (~line 297).
- NOT fixed here: the constants live in `src/orchestrator-v5/routing/`
  (outside this lane's owned paths except the route wiring), and the correct
  fix — stamping `obsPayload` from the per-call snapshot — is a cross-module
  telemetry-semantics change adjacent to the prompt workstream (ruling D1).
  Recommended follow-up: thread `snapshot.version`/`snapshot.systemChars`
  into `obsPayload` after `ensureRoutingPromptSnapshot()` resolves, and
  rename the module constant to `BUNDLED_DEFAULT_PROMPT_VERSION` so no
  telemetry site can mistake it for the served version.

## Residual risks / deliberate stops

- **Driver-cap divergence (3 chip / 5 routed)** is deliberate and documented
  at `projectTopDrivers`; the chip path's narrow hand-built projection in
  `chip-click-dispatch.ts` is untouched. If chip prose should also see 5,
  that is a one-line change at that call site.
- **`fragile_edge_count` under lever suppression** intentionally under-counts
  (filtered list length) rather than repeating an unattestable producer
  count.
- **VOI banding** consumes ONLY the normalised `m1_coaching.evidence_gaps[].voi_score`;
  raw `factor_sensitivity[].value_of_information` (unnormalised) is
  deliberately not banded — banding an unnormalised scale with the influence
  thresholds would misclassify. If evidence_gaps are absent, no VOI section
  renders (honest omission).
- **Goal-fit basis phrase** for unknown basis tokens humanises underscores
  rather than allowlisting; the only currently attested token is
  `modelled_outcome_distribution` (PLoT #204). No CEE fixture carries the
  #204 shape yet — derivation is tested against synthetic records matching
  the PLoT PR description; verify against a live staging capture when PLoT
  #204 reaches staging.
- **Claim-permission frame** (`claim-permissions.ts`, all science classes
  `held`) is structural-only and not wired; this lane widens the LLM's
  RECEIVED context in banded form and does not change what prose composers
  may claim. If the frame lands later, `evpi_voi`/`flip` surfacing rules
  apply downstream of this projection.
- The widened fields are additive and optional on both the TS interface and
  the strict schema; the chip-click narrow projection and all pre-existing
  consumers are shape-compatible (proved by the full colocated v5 suite).
