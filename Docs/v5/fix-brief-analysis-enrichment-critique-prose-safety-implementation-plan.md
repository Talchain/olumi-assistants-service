# Implementation Plan — analysis enrichment critique prose safety

**Status:** PLAN ONLY — no production code until reviewed.
**Branch:** `claude/analysis-enrichment-critique-prose-safety` (fresh, off staging tip `3bb151b6`).
**Source brief:** [`Docs/v5/fix-brief-analysis-enrichment-critique-prose-safety.md`](./fix-brief-analysis-enrichment-critique-prose-safety.md)
**Captured leak fixture:** [`tests/fixtures/cross-service/v5-turn.run-analysis.staging.json`](../../tests/fixtures/cross-service/v5-turn.run-analysis.staging.json) (build `3bb151b`, response_hash `ef1aeb36a440854a`). Sidecar metadata: [`v5-turn.run-analysis.staging.metadata.json`](../../tests/fixtures/cross-service/v5-turn.run-analysis.staging.metadata.json).

This revision reconciles three blockers raised in review: (1) critique-code count, (2) U-bucket contradiction, (3) `review_cards[*]` prose paths.

---

## Step 1 — Critique-code classification (verified against ISL source-of-truth)

**Source-of-truth count:** 31 `CritiqueDefinition` entries in `Inference-Service-Layer/src/models/critique.py`, all 31 registered in the `CRITIQUES` dict (verified by source-grep on 2026-04-30). Plus the captured uncoded preprocessing leak template = **32 entries total**.

**Bucket rules (revised — strict, no "leave jargon live, defer rewrite"):**

- **D — diagnostic-only (suppress).** Route to `enrichment._diagnostics.critiques[]`, gated by `CEE_TURN_DEBUG_ENABLED`. Never on the wire by default.
- **U — user-facing.** Allowed ONLY if the message reads as product-safe coaching after ID sanitisation. No engine vocabulary surviving.
- **S — structural-warning.** Critique stays in `enrichment.critiques[]` but its `message` field is **replaced** with a generic acceptable line tied to the code. `code` / `severity` / `affected_*` preserved so UI can render its own copy from structured fields. Used for codes whose signal is essential but whose template language is jargon-heavy.

**Reclassification (per the new rule):** any U candidate whose template uses engine vocabulary (`interventions`, `intervention target`, `causal path`, `variance`, `samples`, `win probabilities`) — even after IDs are resolved to labels — is **demoted to S** with a generic replacement message.

| # | Code (or template) | Severity | Source | Bucket | Rationale (post-rule) |
|---|---|---|---|---|---|
| 0 | `"Node 'X' has kind='option'. Option nodes are filtered before analysis."` (uncoded) | n/a | preprocessing | **D** | Engine preprocessing detail. |
| 1 | `MISSING_GOAL_NODE` | blocker | validation | **D** | Engine validation; user doesn't author IDs. |
| 2 | `NO_OPTIONS` | blocker | validation | **U** | "No options provided for comparison." Plain English; product-safe. |
| 3 | `EMPTY_INTERVENTIONS` | blocker | validation | **S** | Template uses `interventions` jargon. Replace with: `"Option <label> doesn't change anything in the model. Specify what this option modifies."` |
| 4 | `INVALID_INTERVENTION_TARGET` | blocker | validation | **S** | Uses `intervention_target` + `non-existent node`. Replace with: `"Option <label> references something that's no longer in the model."` |
| 5 | `NO_EFFECTIVE_PATH_TO_GOAL` | blocker | validation | **S** | Uses `interventions` + `effectively affect`. Replace with: `"Option <label> has no path to your goal."` |
| 6 | `IDENTICAL_OPTIONS` | blocker | validation | **S** | Uses `interventions`. Replace with: `"Options <a> and <b> do exactly the same thing in the model."` |
| 7 | `GRAPH_CYCLE_DETECTED` | blocker | validation | **D** | Engine validation. |
| 8 | `GRAPH_EMPTY` | blocker | validation | **D** | Engine validation. |
| 9 | `GRAPH_DISCONNECTED` | warning | validation | **S** | Uses `disconnected components`. Replace with: `"Some parts of the model aren't connected to your goal."` |
| 10 | `INVALID_NODE_ID` | blocker | validation | **D** | Engine validation. |
| 11 | `DUPLICATE_NODE_ID` | blocker | validation | **D** | Engine validation. |
| 12 | `EDGE_STRENGTH_OUT_OF_RANGE` | warning | validation | **D** | Engine vocab. |
| 13 | `EDGE_STD_INVALID` | blocker | validation | **D** | Engine validation. |
| 14 | `EDGE_ENDPOINT_MISSING` | blocker | validation | **D** | Engine validation. |
| 15 | `NEGLIGIBLE_EDGE_STRENGTH` | info | validation | **D** | Engine impl detail. |
| 16 | `INSUFFICIENT_OPTIONS` | blocker | validation | **U** | "At least 2 options required for comparison, got X." Plain English; product-safe. |
| 17 | `OPTION_NO_INTERVENTIONS` | info | validation | **S** | Uses `interventions` + `status quo`. Replace with: `"Option <label> represents the baseline (no changes from current state)."` |
| 18 | `DUPLICATE_OPTION_ID` | blocker | validation | **D** | Engine validation. |
| 19 | `INTERVENTION_VALUE_INVALID` | blocker | validation | **D** | Engine validation. |
| 20 | `MONTE_CARLO_FAILED` | blocker | analysis | **D** | Engine error; recovery-chip handles user surface. |
| 21 | `BASELINE_NEAR_ZERO` | warning | analysis | **D** | Engine-stat detail. |
| 22 | `INFERENCE_TIMEOUT` | blocker | engine | **D** | Recovery-chip handles user surface. |
| 23 | `SEED_INVALID` | warning | validation | **D** | Engine validation. |
| 24 | `DEGENERATE_OUTCOMES` | warning | analysis | **U** | "All options produce nearly identical outcomes." Plain English; product-safe. |
| 25 | `NUMERICAL_INSTABILITY` | warning | analysis | **D** | Engine-stat detail. |
| 26 | `LOW_EFFECTIVE_SAMPLES` | warning | analysis | **S** | Uses `samples` + `numerically valid`. Replace with: `"The analysis was less reliable than usual on this run."` |
| 27 | `IDENTIFIABILITY_ISSUE` | warning | analysis | **D** | Stats vocab. |
| 28 | `DEGENERATE_OPTION_ZERO_VARIANCE` | warning | analysis | **S** | Uses `variance` + `intervention` + `causal path`. Replace with: `"Option <label> has no detectable effect on the goal."` |
| 29 | `HIGH_TIE_RATE` | warning | analysis | **S** | Uses `samples` + `win probabilities`. Replace with: `"Many simulated futures gave ties between options — the comparison is finely balanced."` |
| 30 | `CONSTRAINT_NODE_DEFAULT_BASE` | warning | analysis | **D** | Engine internals (`ParameterUncertainty`, `point_mass`). |
| 31 | `INTERNAL_ERROR` | blocker | engine | **D** | Recovery-chip handles user surface. |

**Bucket totals (verified):**
- D = 20 (rows 0, 1, 7, 8, 10, 11, 12, 13, 14, 15, 18, 19, 20, 21, 22, 23, 25, 27, 30, 31)
- U = 3 (rows 2, 16, 24 — only the three that are plain English with no engine vocabulary)
- S = 9 (rows 3, 4, 5, 6, 9, 17, 26, 28, 29)
- **Total = 32 = 31 ISL codes + 1 uncoded captured leak.** ✓

**Fail-safe rule:** any future ISL code added to `Inference-Service-Layer/src/models/critique.py` is treated as **D by default**. Promotion to U or S requires a conscious change here. Pinned by a unit test.

**Default-replacement-message catalogue** (S bucket): the 9 replacement messages above are stored in `src/orchestrator-v5/compose/sanitise-enrichment.ts` as `S_BUCKET_REPLACEMENTS: Record<CritiqueCode, (ctx) => string>` so `<label>` interpolation reuses `resolveLabel`. Tests pin every entry verbatim.

---

## Step 2 — Suppression target & gating (unchanged from previous draft)

**Where suppressed diagnostics live:** `enrichment._diagnostics.critiques[]`. Same shape as `enrichment.critiques[]`. Diagnostic text preserved verbatim — debug surface keeps the unscrubbed message.

**Gating:**
- `CEE_TURN_DEBUG_ENABLED=true` → `_diagnostics` emitted on the wire.
- Default → `_diagnostics` field absent.

**Why CEE-owned `_diagnostics` not nested under `_meta`:** `_meta` is the upstream ISL audit-trail blob (`response_hash`, `payloads`, `feature_flags_snapshot`); coupling diagnostics to it would entangle two unrelated lifecycles.

---

## Step 3 — `sanitiseUserFacingText` move (mechanical only) — unchanged

Source `src/orchestrator-v5/compose/output-safety.ts` → destination `src/orchestrator/shared/output-safety.ts` (parallel to existing `shared/entity-id-pattern.ts`).

Move scope, exclusions, no-circular-import contract, and dependency direction (`compose → shared`, never reverse) **as previously drafted**.

**New shared file:** `src/orchestrator/shared/forbidden-tokens.ts` with TWO tiers (refined per review):

### Tier A — HARD-BAN (regex match → fail sanitiser test, fail egress)

Precise template patterns from engine code with no legitimate user-facing use:

```ts
export const HARD_BAN_PATTERNS: ReadonlyArray<RegExp> = [
  /\bNode '/,                              // capital-N "Node '" — captured-leak prefix
  /\bkind\s*=\s*'/,                        // kind='option' template literal
  /filtered before analysis/i,              // captured-leak suffix
  /Option nodes are/,                       // capital-O template prefix
  /_pipeline_outcome/,                      // wire-shape internal field name
  /\bmonte\s+carlo\b/i,                     // engine algorithm name
  /\bepsilon-guarded\b/i,                   // engine numerical-stability term
  /\bbootstrap_sampling\b/i,                // confidence_source enum value
  /\bParameterUncertainty\b/,               // ISL class name
  /\bpoint_mass\b/,                         // distribution enum value
];
```

### Tier B — WARNING (regex match → log, do not fail)

Broader terms that *might* be jargon but appear in legitimate prose. Tracked in evidence/warnings, never block:

```ts
export const WARNING_PATTERNS: ReadonlyArray<RegExp> = [
  /\bISL\b/,                                // could appear in docs / coaching refs
  /\binterventions?\b/i,                    // already used in some coaching templates
  /\bintervention[_\s]targets?\b/i,
  /\bnumerically\s+valid\s+samples?\b/i,
  /\be-value\b/i,
  /\bcausal\s+paths?\b/i,
  /\bbootstrap\b/i,                         // without _sampling — could be unrelated
  /\bpayloads?\b/i,                         // ambiguous — could be legitimate user copy
];
```

Recovery-chip enforcement (`compose/recovery-chips-forbidden-terms.ts:FORBIDDEN_USER_TEXT_TERMS`) imports from this same shared file. Existing recovery-chip terms (`error`, `failed`, `broken`, `enricher`, `handler`, `zod`, `parse`, `executor`, `finaliser`, `finalizer`, `ai service`, `stack trace`) become a third export. Three named sets, one source of truth, **no duplicated regex**.

---

## Step 4 — Path-aware allowlist (revised) + structural exclusions + acceptance

### Allowlist of paths sanitised (15 paths, was 12 — added 3 review-card prose paths)

```
$.blocks[*].enrichment.critiques[*].message
$.blocks[*].enrichment.critiques[*].suggestion
$.blocks[*].enrichment.gaps[*].description
$.blocks[*].enrichment.robustness[*].caveat
$.blocks[*].enrichment.summary
$.blocks[*].enrichment.narrative
$.blocks[*].enrichment.improvement_guidance[*]
$.blocks[*].enrichment.factor_sensitivity[*].interpretation
$.blocks[*].enrichment.m1_review[*].text
$.blocks[*].enrichment.m1_coaching[*].text
$.blocks[*].enrichment.rationale
$.blocks[*].enrichment.robustness_synthesis
$.blocks[*].enrichment.review_cards[*].what                            (NEW)
$.blocks[*].enrichment.review_cards[*].why                             (NEW)
$.blocks[*].enrichment.review_cards[*].items[*].suggested_evidence     (NEW)
```

Audit confirmation in `tests/fixtures/cross-service/v5-turn.run-analysis.staging.metadata.json:review_cards_audit`. Captured fixture's review-card prose is currently ID-clean and label-resolved (no leak in this snapshot), but the paths must be allowlisted so the contract holds when ISL/PLoT prose changes.

### Excluded subtrees that MUST be byte-equal pre/post

```
$.blocks[*].enrichment.critiques[*].id
$.blocks[*].enrichment.critiques[*].code
$.blocks[*].enrichment.critiques[*].severity
$.blocks[*].enrichment.critiques[*].source
$.blocks[*].enrichment.critiques[*].affected_option_ids
$.blocks[*].enrichment.critiques[*].affected_node_ids
$.blocks[*].enrichment.factor_sensitivity[*].node_id
$.blocks[*].enrichment.fragile_edges[*]                  (whole subtree)
$.blocks[*].enrichment.edge_e_values[*]                  (whole subtree)
$.blocks[*].enrichment.factor_evpi[*]                    (whole subtree)
$.blocks[*].enrichment.option_comparison[*].id
$.blocks[*].enrichment.option_comparison[*].label        (label is data, not prose)
$.blocks[*].enrichment.payloads                          (whole subtree)
$.blocks[*].enrichment.flip_thresholds                   (whole subtree)
$.blocks[*].enrichment.stability_thresholds              (whole subtree)
$.blocks[*].enrichment.request_id_chain                  (whole subtree)
$.blocks[*].enrichment._meta                             (whole subtree)
$.blocks[*].enrichment.feature_flags_snapshot            (whole subtree)
$.blocks[*].enrichment.meta                              (whole subtree)
$.blocks[*].enrichment.review_cards[*].card_id
$.blocks[*].enrichment.review_cards[*].card_type
$.blocks[*].enrichment.review_cards[*].priority
$.blocks[*].enrichment.review_cards[*].priority_band
$.blocks[*].enrichment.review_cards[*].review_phase
$.blocks[*].enrichment.review_cards[*].suggested_action
$.blocks[*].enrichment.review_cards[*].supporting_refs[*]              (whole subtree)
$.blocks[*].enrichment.review_cards[*].provenance                      (whole subtree)
$.blocks[*].enrichment.review_cards[*].items[*].node_id
$.blocks[*].enrichment.review_cards[*].items[*].factor_id
$.blocks[*].enrichment.review_cards[*].items[*].factor_label           (label is data)
$.blocks[*].enrichment.review_cards[*].items[*].sensitivity_rank
$.blocks[*].enrichment.review_cards[*].items[*].sensitivity_value
$.blocks[*].enrichment.review_cards[*].items[*].confidence_normalised
$.blocks[*].enrichment.review_cards[*].items[*].score
$.blocks[*].enrichment.review_cards[*].items[*].elasticity
$.analysis_ready.*                                       (existing finaliser path)
```

### Acceptance check (revised)

1. Load `tests/fixtures/cross-service/v5-turn.run-analysis.staging.json`.
2. Deep-clone as `before`; run sanitiser to produce `after`.
3. For every excluded subtree above: `expect(getByPath(after, path)).toEqual(getByPath(before, path))` (deep-equal).
4. For every allowlisted path: `expect(getByPath(after, path))` matches none of `HARD_BAN_PATTERNS` AND `scanForEntityIds(...)` returns `[]`.
5. WARNING_PATTERNS hits are recorded in a per-test warnings array but DO NOT fail.
6. Bucket-D critiques in `_diagnostics.critiques[]` (with `CEE_TURN_DEBUG_ENABLED=true`); absent from `enrichment.critiques[]`. With debug=false, `_diagnostics` is `undefined`.
7. Bucket-S critiques in `enrichment.critiques[]` with their replacement message (verbatim from the catalogue), structural fields (id/code/severity/affected_*) byte-equal to the original.
8. Bucket-U critiques in `enrichment.critiques[]` with the original message (after IDs resolved + hard-ban scrubbed).
9. New fail-safe: synthetic critique with code `'UNKNOWN_NEW_CODE_xxxx'` lands in `_diagnostics`.

The acceptance test lives at `tests/contract/decision-review-egress.test.ts`.

---

## Step 5 — Captured fixture as regression input — unchanged

Used by:
1. **Unit (sanitiser)** — `src/orchestrator-v5/compose/__tests__/sanitise-enrichment.test.ts`: inline mini-fixtures for fast iteration; one cross-reference assertion against the captured fixture.
2. **Contract** — `tests/contract/decision-review-egress.test.ts`: load full captured fixture; assert all 9 acceptance points.
3. **Replay** — harness step 4 PASSES post-fix.

**Pretty-printed** (138 KB, 2-space indent) for review-friendly diffs. **Sidecar metadata** at `tests/fixtures/cross-service/v5-turn.run-analysis.staging.metadata.json` records build, ancestry, scenario_id, regression-target paths, review_cards audit, and drift policy.

---

## Step 6 — How replay step 4 becomes PASS — unchanged from previous draft

Pre-fix: `scanForEntityIds(body)` matches at `$.blocks[0].enrichment.critiques[0..3].message:opt_*` → step 4 FAIL.

Post-fix (`CEE_TURN_DEBUG_ENABLED=false`):
- 4 critiques (all bucket D — engine preprocessing) move to `_diagnostics`, then are STRIPPED from the wire.
- `enrichment.critiques[]` is empty.
- `scanForEntityIds(body)` returns `[]` → step 4 PASS.

Post-fix with debug enabled:
- `_diagnostics.critiques[]` carries the original 4 leaks verbatim (engineer surface).
- Harness `EXCLUDED_FIELD_NAMES` needs `_diagnostics` added (one-line follow-up to `tools/v5-journey-replay/output-safety.ts`) so the harness mirrors the production "this is debug-only" decision. Tracked, gated on debug mode landing on staging.

---

## Implementation phasing — unchanged from previous draft

Six independently-reviewable commits in order:

1. **Move `sanitiseUserFacingText`** to `src/orchestrator/shared/output-safety.ts`. Mechanical-only.
2. **Add `src/orchestrator/shared/forbidden-tokens.ts`** with three named sets (Tier A hard-ban, Tier B warning, recovery-chip set). Existing `recovery-chips-forbidden-terms.ts` re-exports from here.
3. **Add `src/orchestrator-v5/compose/resolve-label.ts`** — pure function + unit tests. No call-sites yet.
4. **Add `src/orchestrator-v5/compose/sanitise-enrichment.ts`** — bucket map, S-bucket replacements, `sanitiseEnrichmentText`, allowlist walker. Pure function + unit tests. No call-sites yet.
5. **Wire into `decision-review-enricher.ts`** — single call-site change, gated by `CEE_TURN_DEBUG_ENABLED`. Add partition unit test + contract test against captured fixture.
6. **Backstop in `response-finaliser.ts`** — defensive second pass on the same allowlist.

Commits 1–4 are pure additions / mechanical moves with no behaviour change.

---

## Out of scope — unchanged

- Rewriting bucket-U / bucket-S **content** beyond ID resolution + token scrub + S-bucket generic-message replacement.
- Adding new ISL critique codes or changing ISL-side template strings.
- Promoting bucket-D critiques to bucket-U.
- Adding `_diagnostics` to UI consumption tests.
- Graph-hash signal in harness step-6 mutation gate.
- The malformed clarifier-chip `.message` (tracked separately as P3 in [`Docs/v5/observations/p3-clarifier-chip-message-double-prefix.md`](./observations/p3-clarifier-chip-message-double-prefix.md)).

---

## Acceptance summary (single source of truth)

1. **31 ISL codes correctly bucketed**: D=20, U=3, S=9; +1 uncoded leak in D = 32 entries total. Verified against `Inference-Service-Layer/src/models/critique.py` source-of-truth.
2. **Captured fixture sanitised**: 15 allowlisted paths scan clean (`scanForEntityIds` returns `[]`).
3. **No HARD_BAN tokens** anywhere under the allowlist.
4. **Excluded structural subtrees byte-equal pre/post** (deep-equal).
5. **Bucket-D critiques routed to `_diagnostics`** under `CEE_TURN_DEBUG_ENABLED=true`; absent from wire by default.
6. **Bucket-S critiques use their replacement message verbatim** from the catalogue.
7. **Resolver fallback never returns raw ID** — covered for every prefix family.
8. **Live replay step 4 PASSES** against staging post-deploy.
9. **No regression**: 110 UI-side contract tests + 64 CEE-side contract tests + 292 harness unit tests stay green.
10. **Fail-safe pinning test**: unknown ISL code → bucket D by default.
