# CEE response quality investigation v1

**Date:** 16 April 2026
**Scope:** Response surface quality — what CEE emits into `assistant_text`, blocks, `suggested_actions`, `guidance_items`, and coaching fields. Post Phase 0-2 integrity fixes.
**Method:** Static analysis of all emission paths with file:line references. Staging verification data cross-referenced where available.

---

## Investigation 1: Option choices emission pattern

### Finding: option choices are prose + structured block. No chip budget consumed. By design.

**Label: ACTIVE (prose + ComparisonBlock). No fix required.**

The `compare_options` handler ([compare-options.ts:36-135](src/orchestrator/deterministic/actions/compare-options.ts#L36-L135)) is the sole mechanism for presenting option comparisons. It emits:

1. A `ComparisonBlock` (structured, with `options[]` carrying `id`, `label`, `probability`, `rank`, `strengths`, `weaknesses`, `key_differentiators`) — [compare-options.ts:65-73](src/orchestrator/deterministic/actions/compare-options.ts#L65-L73)
2. An `assistantText` headline naming winner, runner-up, margin, and top differentiator — [compare-options.ts:123-128](src/orchestrator/deterministic/actions/compare-options.ts#L123-L128)

There is no `select_option` action_type, no option-selection chip type, and no block type carrying "choose this option" semantics.

### Chip budget competition analysis

The chip engine's 3-chip cap ([chip-engine.ts:349](src/orchestrator/deterministic/chip-engine.ts#L349)) and the chip type enum ([chip-engine.ts:46](src/orchestrator/deterministic/chip-engine.ts#L46)) allocate all slots to: `calibrate`, `challenge`, `analyse`, `explain`, `evidence`, `restructure`, `decide`. Post-analysis bundles ([chip-engine.ts:151-173](src/orchestrator/deterministic/chip-engine.ts#L151-L173)) consume all 3 slots with combinations of:

- Fragile path: `chipWhatWouldChange` + `chipCalibrateTopFactor` + `chipCompareOptions`
- Dominant factor: `chipHowConfidentInFactor` + `chipWhatWouldFlip` + `chipGenerateBrief`
- Stable: `chipHowConfidentInFactor` + `chipRunPremortem` + `chipGenerateBrief`

The `chipCompareOptions` chip ([chip-engine.ts:470-479](src/orchestrator/deterministic/chip-engine.ts#L470-L479)) surfaces as type `explain`, action_type `compare_options`. It offers to **compare** options, not select one. If option-choice were a chip, it would compete with calibrate/challenge/analyse — all higher-priority. The current design presents option comparisons in the `ComparisonBlock` data structure (rendered as a rich card by the UI) without consuming chip budget. This is architecturally sound.

### Staging evidence

`staging-verification-results.json` shows `compare_options` surfaced 1 time across 707 test interactions (line 38: `"compare_options": 1`), confirming it fires only on the fragile-result post-analysis path.

### Minimal path to structured option choices

If option choices were routed through `suggested_actions`:
- A new `action_type: 'select_option'` would be required, plus a new chip type in the engine's enum.
- Each option would need its own chip slot (2-4 slots for typical decisions), immediately exceeding the 3-chip budget.
- The `ComparisonBlock` already carries structured data the UI can render as clickable options without chip budget cost.
- **Recommendation: no change needed.** The block-based approach is correct.

---

## Investigation 2: Coaching emission — prose vs blocks

### Per-handler analysis

**6 migrated handlers (HandlerFact -> composer generates text):**

| # | Handler | Blocks emitted | Coaching in prose | Coaching in blocks |
|---|---------|----------------|-------------------|--------------------|
| 1 | `draft_created` ([draft-graph.ts](src/orchestrator/deterministic/actions/draft-graph.ts)) | `graph_patch` | YES — tradeoff, biggest_inference, calibration_target | NO |
| 2 | `factor_added` ([add-factor.ts](src/orchestrator/deterministic/actions/add-factor.ts)) | `[]` | YES — critical_gap | NO |
| 3 | `option_added` ([add-option.ts](src/orchestrator/deterministic/actions/add-option.ts)) | `[]` | MINIMAL — intervention_count only | NO |
| 4 | `value_set` ([set-factor-value.ts](src/orchestrator/deterministic/actions/set-factor-value.ts)) | `[]` | YES — drivers[0] top-driver framing | NO |
| 5 | `analysis_complete` ([run-analysis.ts](src/orchestrator/deterministic/actions/run-analysis.ts)) | review_card, fact | YES — headline | YES (analysis blocks) |
| 6 | `analysis_started` (pipeline internal) | `[]` | NO | NO |

Of the 6 migrated handlers, only `run_analysis` emits structured blocks with coaching content. The other 5 carry all coaching in prose via the composer.

**8 unmigrated handlers (legacy assistantText):**

| # | Handler | Blocks | Prose length | 600-char collapse risk |
|---|---------|--------|-------------|------------------------|
| 7 | `edge_adjusted` | `[]` | ~60 chars | NO |
| 8 | `constraint_added` | `[]` | ~50 chars | NO |
| 9 | `factor_removed` | `[]` | ~40 chars | NO |
| 10 | `goal_target_set` | `[]` | ~50 chars | NO |
| 11 | `premortem_run` | PremortemBlock | ~70 chars + block narrative | NO for text; block may be long |
| 12 | `assumption_challenged` | `[]` | 300-500 chars (markdown, bold headers) | **PARTIAL** — multi-paragraph but typically <600 |
| 13 | `brief_generated` | `[]` | ~40 chars or null (stub) | NO |
| 14 | `evidence_found` | FlipAnalysisBlock | 150-300 chars | **PARTIAL** — multi-factor lists can approach 600 |

### Duplication check

**Label: CLEAN. No prose/block duplication found.**

[explain-result.ts:44-49](src/orchestrator/deterministic/actions/explain-result.ts#L44-L49) explicitly addresses winner-statement duplication: the headline lives in `assistantText` only; the commentary block's `narrative` is intentionally empty. No other handler shows the same content in both prose and blocks.

### Post-draft block composition

Post-draft turns emit a single `graph_patch` block from the draft handler. All coaching is prose-only from the composer. No commentary/framing blocks are emitted post-draft.

### Post-analysis block composition

Post-analysis turns emit review_card and fact blocks from `run-analysis`. Coaching context is rebuilt ([pipeline-v4.ts:976-983](src/orchestrator/deterministic/pipeline-v4.ts#L976-L983)) and guidance items regenerated ([pipeline-v4.ts:1616-1637](src/orchestrator/deterministic/pipeline-v4.ts#L1616-L1637)) post-analysis. Commentary blocks are only emitted if the user explicitly requests explanation via `explain_result`.

### Design rule: composer keeps prose short

[response-composer.ts:29-43](src/orchestrator/deterministic/response-composer.ts#L29-L43):
- When `hasPatchBlock=true`: 1 sentence (exception: `draft_created` allows 2)
- When `hasPatchBlock=false`: 1-2 sentences maximum

This design prevents 600-char collapse for all migrated handlers. The risk is confined to the 8 unmigrated handlers that bypass the composer.

---

## Investigation 3: Value formatting in CEE-generated text

### Formatting infrastructure

[display-value.ts](src/cee/factor-extraction/display-value.ts) provides a comprehensive formatting pipeline:
- `synthesiseDisplayValue()`: Priority chain — raw_value+currency -> raw_value+% -> raw_value+time -> raw_value plain -> normalised+% -> normalised+unit -> qualitative band -> bare normalised value
- `formatCurrencyAmount()`: Produces `"500k"`, `"1.5m"` with currency prefix (`£`, `$`, etc.)
- `qualitativeBand()`: Maps 0-1 to Low/Moderate/High/Very high
- `formatPlainNumber()`: Uses `toLocaleString("en-GB")`

### Where formatting is used vs bypassed

| Surface | Uses display-value.ts? | Raw values leak? | Severity |
|---------|------------------------|-------------------|----------|
| `set-factor-value.ts` `computeDisplayValue()` ([line 314-333](src/orchestrator/deterministic/actions/set-factor-value.ts#L314-L333)) | PARTIAL (qualitativeBand only) | YES — `"0.75 £"` for currency | **HIGH** |
| `what-would-flip.ts` narrative ([line 87](src/orchestrator/deterministic/actions/what-would-flip.ts#L87)) | NO | YES — `"(current: 0.2 scale)"` | **MEDIUM** |
| `what-would-flip.ts` `formatFlipValue()` ([lines 231-237](src/orchestrator/deterministic/actions/what-would-flip.ts#L231-L237)) | NO (local utility) | YES — bare numbers for currency | **MEDIUM** |
| `patch-summary.ts` `formatUpdateValueForDisplay()` ([line 793](src/orchestrator/patch-summary.ts#L793)) | NO | YES — `"${newValue} ${unit}"` | **LOW** |
| `add-factor.ts` legacy text ([line 149](src/orchestrator/deterministic/actions/add-factor.ts#L149)) | NO | YES — `"(value: 0.75 £)"` | **LOW** (composer replaces when fact present) |
| `set-goal-target.ts` ([line 63](src/orchestrator/deterministic/actions/set-goal-target.ts#L63)) | NO | YES — raw threshold | **LOW** |
| `compare-options.ts` | NO (but uses `%` * 100 correctly) | NO | CLEAN |
| `explain-result.ts` | NO (but uses `.toFixed(0)%`) | NO | CLEAN |

### Root cause

`computeDisplayValue()` in [set-factor-value.ts:332](src/orchestrator/deterministic/actions/set-factor-value.ts#L332) renders `"${value} ${unit}"` — raw normalised value + unit string. It receives `(value, unit)` but has no access to `raw_value` or `cap`, so it cannot call `synthesiseDisplayValue()`. The `what-would-flip.ts` narrative builder ([line 87](src/orchestrator/deterministic/actions/what-would-flip.ts#L87)) directly interpolates `node.value` + `node.unit` with no formatting call.

### Staging evidence

- `staging-verification-results.json:11227`: `"Campaign Quality and Creativity (currently 0.2 scale)"` — raw normalised value in flip narrative
- `staging-verification-results.json:32131`: `"**Content Quality** (current: 0.2 scale): sensitivity 1.00"` — same in block narrative
- `staging-verification-results.json:3062`: `"Proposing to update **Annual Salary Cost**: value."` — field key "value" leaked instead of actual value (patch-summary `friendlyFieldName` fallback)

### Minimal fix pattern

A shared `formatNodeValueForDisplay(node)` utility wrapping `synthesiseDisplayValue()` with node metadata lookup, consumed by `set-factor-value.ts`, `what-would-flip.ts`, `patch-summary.ts`, and any handler rendering factor values. The `display-value.ts` module already has the full pipeline; the gap is that only the draft-graph CEE pipeline calls it. Deterministic handlers bypass it entirely.

---

## Investigation 4: Tense and state consistency in emitted text

### Composer path: fully gated. ACTIVE, correct.

All 6 migrated templates in [response-composer.ts](src/orchestrator/deterministic/response-composer.ts) gate tense on `fact.auto_apply`:

| Template | Applied tense | Proposal tense | Line |
|----------|--------------|----------------|------|
| `composeFactorAdded` | "is now in the model" | "would capture" | 193 |
| `composeOptionAdded` | "is now captured" | "would add" | 216 |
| `composeValueSet` | 4-way matrix (hasPatchBlock x auto_apply) | all correct | 246, 283 |
| `composeEdgeAdjusted` | "is now" | "would change to" | 307 |
| `composeConstraintAdded` | "is now captured" | "would be added" | 316 |
| `composeFactorRemoved` | "is no longer" | "would be removed" | 325 |
| `composeGoalTargetSet` | "is now" | "would change to" | 335 |

Design rules at [line 37](src/orchestrator/deterministic/response-composer.ts#L37) explicitly ban "Updated", "Added", "Done", "Applied".

### Unmigrated handlers: no tense issue. CLEAN.

The 8 unmigrated handlers are all READ-ONLY tools (no graph mutation). They emit commentary, analysis, or exercise content — never state-change language. The concern that unmigrated handlers might emit applied language unconditionally is unfounded.

### `buildPatchSummary` tense: correct.

[patch-summary.ts:224-239](src/orchestrator/patch-summary.ts#L224-L239) `verbFor()` gates on `patchContext`:
- `'edit'` (proposal) -> "Proposing to add/update/remove/connect"
- `'full_draft'` or `'accepted'` -> "Added/Updated/Removed/Connected"

Called with `'accepted'` only from [system-event-router.ts:717](src/orchestrator/system-event-router.ts#L717) (post-acceptance path).

### `system-event-router.ts` patch_accepted: correct.

[system-event-router.ts:729](src/orchestrator/system-event-router.ts#L729): `"${base} applied to your model.${staleNote}"` — fires only after user acceptance. Correct tense.

### `edit-graph.ts`: no fact emitted. PARTIAL risk.

[edit-graph.ts:822](src/orchestrator/deterministic/actions/edit-graph.ts#L822) does not emit a `fact` in its return. The response-composer is bypassed; tense correctness depends on the V2 handler + honesty guard. The honesty guard at [line 774](src/orchestrator/deterministic/actions/edit-graph.ts#L774) catches overclaiming structural language but uses past-tense ("I adjusted the strength...") which is correct because `adjust_edge_strength` is auto-apply in `edit_graph` context.

### Staging evidence: degraded summary text (not tense).

4 instances in staging verification where `buildPatchSummary` produced degraded content:
- Line 3062: `"Proposing to update **Annual Salary Cost**: value."` — the literal field key "value" leaked via `friendlyFieldName` fallback instead of the actual value
- Lines 20188, 58729, 65107: same pattern for different factors

Tense is correct ("Proposing to") but content is wrong (displaying field key "value" instead of the new value). This is a `patch-summary.ts:836` `friendlyFieldName` mapping issue, not a tense issue.

---

## Investigation 5: Chip generation quality

### Chip engine pipeline (8 steps)

**Label: ACTIVE. Well-instrumented. Budget is 3, not 4.**

The brief stated `enforceChipBudget` caps at 4 — this is incorrect. The cap is **3** ([chip-engine.ts:349](src/orchestrator/deterministic/chip-engine.ts#L349)).

Complete pipeline ([chip-engine.ts:89-371](src/orchestrator/deterministic/chip-engine.ts#L89-L371)):

1. **Bundle selection** (109-174): Context-driven, 3 branches (post-draft, post-analysis, stale)
2. **Deferred promotion** (179-190): Compound tool calls discarded by one-tool-per-turn policy, `priority: 0`
3. **Guidance pool expansion** (201-208): `chipFromGuidance()` maps guidance items, `priority: 10`
4. **Session suppression** (215-239): 2-turn window minus clicked chips
5. **Dedup** (248-258): By `action_type`; guidance-derived (`gi_` prefix) exempt
6. **Progress-slot rule** (265-284): Pre-analysis must have progress chip unless recover/confirm
7. **Tool availability filter** (290-302): Drops chips for unavailable tools BEFORE the cap
8. **Cap at 3** (350): `available.slice(0, 3)`

### Priority system

| Source | Priority | Survives cap? |
|--------|----------|---------------|
| Deferred actions | 0 (highest) | Always — `unshift`ed to front |
| `run_analysis` / `generate_artefact` | 1 | Usually — progress-slot rule ensures |
| Calibrate/challenge bundle | 2-3 | Usually — bundle inserted before guidance |
| Compare/other | 4 | Sometimes — depends on bundle size |
| Guidance-derived | 10 (lowest) | Rarely — only when bundle chips suppressed |

### Candidate count before cap

The engine commonly produces 4-6 candidates before the 3-cap. Each bundle generates 3 chips. Deferred adds 1-2. Guidance pool adds 2-5. After dedup and session suppression, the pool typically has 3-6. The cap at 3 is the binding constraint on nearly every turn.

### Drop telemetry

**ACTIVE. Four telemetry events:**

| Event | Location | Trigger |
|-------|----------|---------|
| `v4.chip_engine.suppressed_by_session` | chip-engine.ts:235 | Shown in last 2 turns |
| `v4.chip_filtered_unavailable` | chip-engine.ts:295 | Tool not in resolved set |
| `v4.chip_run_analysis_suppressed` | chip-engine.ts:120 | Readiness gate |
| `v4.chip_floor_activated` | chip-engine.ts:337 | Session window exhaustion bypass |

However, there is **no telemetry for chips dropped by the 3-cap itself**. When 5 candidates survive filtering but only 3 are emitted, the 2 dropped by `slice(0, 3)` are not logged.

### Bundle/guidance overlap

**PARTIAL.** Dedup uses `action_type` uniqueness but guidance chips (`gi_` prefix) are exempt ([chip-engine.ts:253](src/orchestrator/deterministic/chip-engine.ts#L253)). A bundle chip `set_factor_value` and a guidance chip `set_factor_value` targeting different factors can both survive dedup. The 3-cap prevents both from appearing when the bundle fills all 3 slots.

### Session window aggressiveness

[session-state.ts:360-370](src/orchestrator/deterministic/session-state.ts#L360-L370): 2-turn window. Any chip shown and NOT clicked on turns T and T-1 is suppressed on T+1. With only 3 bundle chips per branch, the pool exhausts by turn 3 if the user never clicks.

Mitigation: Layer 2 floor ([chip-engine.ts:319-347](src/orchestrator/deterministic/chip-engine.ts#L319-L347)) promotes the highest-priority session-suppressed chip when all candidates are exhausted. Layer 1 guidance pool expansion adds fresh candidates tied to graph state.

Re-relevant chips: clicked chips are immediately re-surfaceable ([session-state.ts:377-380](src/orchestrator/deterministic/session-state.ts#L377-L380)).

---

## Investigation 6: Guidance items emission

### Producers

**Two producers, both ACTIVE:**

**1. Post-draft guidance** ([post-draft.ts](src/orchestrator/guidance/post-draft.ts)): max 8 items

| Signal code | Condition | Category | Priority |
|-------------|-----------|----------|----------|
| `STRUCTURAL_CYCLE` | Warning: cycle_detected | must_fix | 95 |
| `DEFAULT_EDGE_STRENGTH` | Warning: uniform/defaulted edges | should_fix | 70 |
| `STRUCTURAL_VALIDATION_ERROR` | Unknown warning, non-low severity | should_fix | 65 |
| `DEFAULT_NODE_CONFIDENCE` | Degree >= 3, default exists_probability | should_fix | 70 |
| `LOW_OPTION_COUNT` | Options <= 2 | could_fix | 45 |
| `WEAKLY_CONNECTED_NODE` | Risk/outcome with 0 inbound causal edges | could_fix | 40 |
| `MISSING_FRAMING_ELEMENT` | No goal node and no goal in framing | could_fix | 35 |
| `COMPLEXITY_CHECK` | Nodes > 10 with low-connectivity nodes | could_fix | 30 |

**2. Post-analysis guidance** ([post-analysis.ts](src/orchestrator/guidance/post-analysis.ts)): max 12 items

| Signal code | Condition | Category | Priority |
|-------------|-----------|----------|----------|
| `PROPOSAL_CARD_CRITICAL` | Review card priority_band: critical | must_fix | 90 |
| `PROPOSAL_CARD_HIGH` | Review card priority_band: high | must_fix | 80 |
| `PROPOSAL_CARD_MEDIUM` | Review card priority_band: medium | should_fix | 65 |
| `PROPOSAL_CARD_LOW` | Review card priority_band: low | could_fix | 40 |
| `FRAGILE_RESULT` | Robustness level: fragile | must_fix | 85 |
| `HIGH_INFLUENCE_LOW_CONFIDENCE` | Influence > 0.3, default confidence | should_fix | min(79, influence*100) |
| `CONSTRAINT_VIOLATION` | Constraint probability < 0.5 | should_fix | 70 |
| `DOMINANT_FACTOR` | Any factor influence > 0.5 | should_fix | 60 |
| `TECHNIQUE_PRE_MORTEM` | Top-two separation <= 10%, not robust | technique | 25 |
| `TECHNIQUE_DISCONFIRMATION` | Top option win_probability > 70% | technique | 20 |
| `TECHNIQUE_DEVIL_ADVOCATE` | Top-two separation <= 10% | technique | 20 |
| `CTA_LITE` | Always (unless explain intent or RECOVER) | technique | 10 |

### Dedup logic

[guidance-item.ts:163](src/orchestrator/types/guidance-item.ts#L163): `item_id = gi_` + SHA-256(`signal_code + target_id || 'global' + source`). Duplicates resolved by higher priority.

### Cross-referencing with response content

**Label: DEAD. No cross-referencing exists.**

There is no logic that checks whether a guidance item's content duplicates what's in `assistantText`, blocks, or driver lists. Guidance items and response text are generated independently. Concrete overlap scenarios:
- `HIGH_INFLUENCE_LOW_CONFIDENCE` for factor X could duplicate composer text "X is the factor the outcome is most sensitive to"
- `FRAGILE_RESULT` could duplicate a `what_would_flip` block narrative about fragility
- `PROPOSAL_CARD_*` items are direct conversions of `review_cards` from the analysis response, which also appear in review_card blocks

### Stage-gating

**Label: DEAD. No stage-gating.**

Post-draft guidance runs on **every turn with a graph** ([pipeline-v4.ts:1646-1671](src/orchestrator/deterministic/pipeline-v4.ts#L1646-L1671)) — it serves as the chip engine's guidance pool, not as stage-gated user guidance. The only mode-based suppression: `TECHNIQUE_*` offers are suppressed in RECOVER mode; `CTA_LITE` is suppressed for explain intent and RECOVER mode.

### Target object coverage

**PARTIAL. ~40-50% of guidance items lack a `target_object.id`.**

- Items with `id`: `DEFAULT_NODE_CONFIDENCE`, `HIGH_INFLUENCE_LOW_CONFIDENCE`, `DOMINANT_FACTOR`, `CONSTRAINT_VIOLATION`, `WEAKLY_CONNECTED_NODE` — always carry `id` and `label`
- Items without `id`: `LOW_OPTION_COUNT`, `MISSING_FRAMING_ELEMENT`, `COMPLEXITY_CHECK`, `STRUCTURAL_CYCLE`, `FRAGILE_RESULT`, `TECHNIQUE_*`, `CTA_LITE` — use `{ type: 'graph' }` or `{ type: 'framing' }` with no `id`
- `PROPOSAL_CARD_*`: carry `id` only when the card has a `node_id` field

UI-side item-level dedup requires `target_object.id`. For items without it, the UI can only dedup at the `signal_code` level.

---

## Investigation 7: Coaching context field survival — post Phase 0-2

### 7.1 `typeof === 'string'` filter bug — CONFIRMED, STILL PRESENT

**Label: ACTIVE bug. Unchanged by Phase 0-2.**

[draft-graph.ts:480](src/orchestrator/tools/draft-graph.ts#L480):
```typescript
.filter((item): item is string => typeof item === 'string')
```

The Zod schema at [cee-v3.ts:453-459](src/schemas/cee-v3.ts#L453-L459) defines `strengthen_items` as `z.array(z.object({ id, label, detail, action_type, bias_category? }))`. Every item is an object. The `typeof item === 'string'` filter rejects 100% of items. **All strengthen_items are silently dropped.** Only `coaching.summary` (string) ever reaches `narrationHint` and `patchData.summary`.

### 7.2 ActionResult does not carry coaching — CONFIRMED

**Label: ACTIVE gap. Unchanged by Phase 0-2.**

[types.ts:358-411](src/orchestrator/deterministic/types.ts#L358-L411): `ActionResult` has `blocks`, `assistantText`, `guidance_items`, `analysis_response?`, `operations?`, `applied_graph?`, `analysis_ready?`, `failure?`, `fact?`, `suggested_actions_override?`. No `coaching`, `coaching_summary`, or `strengthen_items` field.

### 7.3 Zod schema strips coaching sub-fields — CONFIRMED

**Label: ACTIVE. `widening_log`, `bias_signals`, `provenance` are not defined.**

The coaching schema in [cee-v3.ts](src/schemas/cee-v3.ts) defines only `summary` (string) and `strengthen_items` (array of objects). No `widening_log`, `bias_signals`, or `provenance` fields. These are stripped on parse.

### 7.4 `coaching_consequence` — NOT LANDED

**Label: DEAD. Zero matches in `src/`.** Only exists in the prior audit doc as a recommendation.

### 7.5 `has_coaching` — TELEMETRY-ONLY

**Label: ACTIVE (telemetry). Not a response contract field.**

Three occurrences, all in log/telemetry objects:
- [draft-graph.ts:254](src/orchestrator/tools/draft-graph.ts#L254): `has_coaching: coachingSummary !== null`
- [edit-graph.ts:1632](src/orchestrator/tools/edit-graph.ts#L1632): `has_coaching: !!llmResult.coaching`
- [edit-graph.ts:2263](src/orchestrator/tools/edit-graph.ts#L2263): same pattern

### 7.6 What coaching data survives to the envelope

**V4 deterministic pipeline path:**

1. LLM response contains `coaching: { summary, strengthen_items }` (Zod-validated)
2. `extractCoachingSummary()` extracts `summary` as string, drops all `strengthen_items` (typeof bug)
3. `summary` reaches `graph_patch.data.summary` via `buildPatchSummary()`
4. Independently, `CoachingContext` is built from graph structure/analysis/session state ([coaching-context-builder.ts:165-275](src/orchestrator/deterministic/coaching-context-builder.ts#L165-L275)) — does NOT read LLM coaching output
5. `composeResponse()` uses `CoachingContext` fields (tradeoff, biggest_inference, headline, etc.) to generate `assistantText`
6. Envelope has NO coaching field

**Net result:** LLM `coaching.summary` survives to `graph_patch.data.summary`. LLM `coaching.strengthen_items` are completely lost. The V4 path builds its own coaching from structural analysis, disconnected from the LLM coaching output.

---

## Investigation 8: Response contract drift

### 8.1 `is_baseline` — set for ALL options. PARTIAL reliability.

[analysis-ready-helper.ts:196-218](src/orchestrator/tools/analysis-ready-helper.ts#L196-L218):
1. Priority 1: node-level `is_baseline === true` from LLM
2. Priority 2: `labelMatchesBaseline()` keyword match
3. Non-matching options: explicit `false`

All options receive a value — the UI always has this field. However, the keyword list (at `cee/transforms/analysis-ready.ts:180-192`) includes high-false-positive words: "current", "existing", "stay", "remain", "keep". An option like "Keep expanding into Asia" would match as baseline. **Functional but with false-positive risk on common English words.**

### 8.2 `win_probability` passthrough — CLEAN, no field stripping

**Label: ACTIVE. Passthrough is clean.**

[envelope-assembler.ts:275-277](src/orchestrator/pipeline/phase5-validation/envelope-assembler.ts#L275-L277):
```typescript
if (toolResult.analysis_response) {
    envelope.analysis_response = toolResult.analysis_response;
}
```

The `analysis_response` is passed through as-is — a raw `V2RunResponseEnvelope` object. No field stripping occurs. `win_probability` on `results[]` entries survives intact to the envelope.

**UI reads:** `envelope.analysis_response.results[].win_probability` directly. `win_probability_displayed` does not exist server-side and is a UI-side formatting concern. The passthrough path does not drop any analysis fields — `factor_sensitivity`, `constraint_analysis`, `robustness_synthesis` all ride inside the passthrough `analysis_response`.

If PLoT omits a field, it will be absent on the envelope — CEE does not default-fill missing analysis sub-fields.

### 8.3 `proposal_items` / `elementLabel` — NOT IN CODEBASE

**Label: N/A. These are not CEE concepts.**

Proposal data is carried via:
- `GraphPatchBlockData.operations: PatchOperation[]` (each with `op`, `path`, `value`, `old_value?`)
- `ProposalBlockData.changes[]` (each with `operation`, `target`, `detail`)

The UI consumes `graph_patch.data.operations`, not any `proposal_items` field. If the UI expects `proposal_items`, this is a UI-side construct derived from block data.

### 8.4 `display_value` — only one handler sets it

**Label: PARTIAL. Gap in 3+ handlers.**

Only [set-factor-value.ts:260-284](src/orchestrator/deterministic/actions/set-factor-value.ts#L260-L284) computes `display_value` on the fact. Handlers that should but don't:
- `adjust-edge-strength.ts` — edge strength changes presented as raw `0.85`
- `set-goal-target.ts` — goal targets as raw numeric
- `add-factor.ts` — initial values as raw numeric (mitigated when composer replaces legacy text)

### 8.5 Top-level analysis fields on envelope

`factor_sensitivity`, `constraint_analysis`, `robustness_synthesis` are NOT emitted as top-level envelope fields. They ride inside `envelope.analysis_response` via passthrough. If PLoT omits them, they're absent. No independent defaults are set by the envelope assembler.

### 8.6 Dead envelope fields

No computed-but-never-populated dead fields found in the envelope assembler. All conditional fields (`deterministic_answer_tier`, `_pipeline_outcome`, `dsk_coaching`) have active producers.

---

## Investigation 9: Open-ended quality discovery

### 9.1 British English — CLEAN

No American spellings ("analyze", "optimize", "behavior", "center", "color") found in user-facing strings in `src/orchestrator/deterministic/` or `src/orchestrator/guidance/`.

### 9.2 Em dashes — ACTIVE violations

Despite the composer's own rule at [response-composer.ts:39](src/orchestrator/deterministic/response-composer.ts#L39) ("No em dashes"), em dashes appear in user-facing strings:

**User-facing `assistantText`:**
- [edit-graph.ts:682](src/orchestrator/deterministic/actions/edit-graph.ts#L682): `"I couldn't place an edge between those nodes — one of them doesn't exist..."`
- [confirmation-flow.ts:151](src/orchestrator/deterministic/confirmation-flow.ts#L151): `"Got it — proposal dismissed."`
- [pipeline-v4.ts:1957](src/orchestrator/deterministic/pipeline-v4.ts#L1957): `"Building your decision model is taking longer than usual. Please try again — complex decisions..."`

**Guidance titles (user-facing):**
- [post-draft.ts:280](src/orchestrator/guidance/post-draft.ts#L280): `"Only one option — add alternatives"`
- [post-draft.ts:328](src/orchestrator/guidance/post-draft.ts#L328): `"Model has ${...} nodes — consider simplifying"`
- [post-analysis.ts:338](src/orchestrator/guidance/post-analysis.ts#L338): `"Result is fragile — small changes could flip the recommendation"`
- [post-analysis.ts:449](src/orchestrator/guidance/post-analysis.ts#L449): `"Imagine the decision failed — what went wrong?"`
- [post-analysis.ts:513](src/orchestrator/guidance/post-analysis.ts#L513): `"It's close — argue against the top option"`

**LLM prompt context (affects LLM output style):**
- [llm-prompt.ts:127,128,135,161](src/orchestrator/deterministic/llm-prompt.ts#L127)
- [prompt-builder-v2.ts:275,288,297](src/orchestrator/deterministic/prompt-builder-v2.ts#L275)

### 9.3 TODO/FIXME/HACK — minimal

Only 1 active TODO in the target directories:
- [pipeline-v4.ts:459](src/orchestrator/deterministic/pipeline-v4.ts#L459): `"TODO(P2): Confirmation turns hardcode 'legacy_handler'. When the composer is wired into the confirmation path, update this to reflect the actual source."`

### 9.4 Dead block type: `exercise`

[factory.ts:350-360](src/orchestrator/blocks/factory.ts#L350-L360): `createExerciseBlock` is defined in the factory and typed in [types.ts:393](src/orchestrator/deterministic/types.ts#L393), but **never imported or called by any action handler**. The exercise block type is dead code.

### 9.5 CoachingContext fields computed but never read by response-composer

**Label: PARTIAL waste on deterministic-only turns.**

Fields computed in `coaching-context-builder.ts` on every turn but consumed only by `prompt-builder-v2.ts` (LLM prompt) and/or `chip-engine.ts`, never by the response-composer:
- `prediction_state`, `option_mechanism_overlap`, `risk_factor_count`, `top_fragile`, `triggered_plays`, `ai_estimated_count`, `user_provided_count`, `total_factor_count`, `chip_inputs`

On the deterministic fast-path where the response-composer generates text without an LLM call, these fields are computed but never read. Not strictly dead (they serve the LLM path), but wasted computation on non-LLM turns.

### 9.6 Patch summary field-key leakage

[patch-summary.ts:836](src/orchestrator/patch-summary.ts#L836): `friendlyFieldName` maps `'value'` to `'value'` (identity). When `formatUpdateValueForDisplay` returns null, the summary renders the field key literally: `"Proposing to update **Factor**: value."` Staging shows 4 instances of this.

---

## Findings not anticipated by this brief

### F1: Chip budget is 3, not 4

The brief stated `enforceChipBudget` caps at 4. The actual cap is 3 ([chip-engine.ts:349](src/orchestrator/deterministic/chip-engine.ts#L349)). The UI-side budget may differ.

### F2: No telemetry for chips dropped by the 3-cap

When 5 candidates survive all filtering but only 3 are emitted via `slice(0, 3)`, the 2 dropped chips have no telemetry. Only session suppression, availability filtering, and readiness gating produce drop events.

### F3: `compare_options` fires once in 707 test interactions

The fragile-result post-analysis path (which includes `chipCompareOptions`) is the only chip path that surfaces option comparison. In staging verification, this fired once. The chip may be under-surfaced.

### F4: Post-draft guidance runs on every turn, not just post-draft

[pipeline-v4.ts:1646-1671](src/orchestrator/deterministic/pipeline-v4.ts#L1646-L1671) calls `generatePostDraftGuidance(graph, [], null)` on every turn with a graph. This is by design (chip engine guidance pool), but means structural guidance items are always present in the envelope — even on turns where they are stale or irrelevant.

### F5: `generate-artefact` is a stub

[generate-artefact.ts:43-44](src/orchestrator/deterministic/actions/generate-artefact.ts#L43-L44): prerequisite checks always return an error. The handler never executes substantive work. Yet `chipGenerateBrief` appears in post-analysis bundles ([chip-engine.ts:160,170](src/orchestrator/deterministic/chip-engine.ts#L160)), meaning the UI surfaces a chip for a non-functional feature.

### F6: `edit_graph` handler does not emit a `fact`

[edit-graph.ts:822](src/orchestrator/deterministic/actions/edit-graph.ts#L822): the return has no `fact` field, so the response-composer is bypassed. Tense correctness for `edit_graph` depends on the V2 handler and honesty guard rather than the gated composer. This is the most complex handler and the one most likely to produce tense inconsistencies as the V2 path evolves.

### F7: Guidance items from `PROPOSAL_CARD_*` are 1:1 copies of review cards

Post-analysis guidance at [post-analysis.ts:170-249](src/orchestrator/guidance/post-analysis.ts#L170-L249) converts each `review_card` into a `PROPOSAL_CARD_*` guidance item. These cards also appear as `review_card` blocks in the response. The UI renders both — a review card in the response body and a matching guidance item in the guidance strip — with no cross-referencing or dedup.

### F8: `chipGenerateBrief` maps to dead handler

The chip `generate_artefact` appears in two post-analysis bundles ([chip-engine.ts:160,170](src/orchestrator/deterministic/chip-engine.ts#L160-L170)). The `generate-artefact.ts` handler is a stub (F5). The tool availability filter should catch this if `generate_artefact` is not in the resolved tool set, but if it is registered, the chip surfaces and the user gets an error on click.

### F9: `coaching.strengthen_items` data is 100% lost

Between the `typeof === 'string'` bug (7.1) and the absence of `strengthen_items` on `ActionResult` (7.2), the LLM's strengthen_items response is completely discarded. The LLM spends tokens generating this structured coaching data, and it reaches zero consumers. This is both a quality loss and a token waste.
