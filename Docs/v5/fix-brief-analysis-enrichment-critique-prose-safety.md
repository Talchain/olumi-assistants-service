# Fix Brief — analysis enrichment critique prose safety

**Status:** DRAFT (not yet implemented; awaiting approval)
**Date:** 2026-04-30
**Severity:** P1 — raw entity IDs and internal engine vocabulary visible
to end users in `analysis_result.blocks[0].enrichment.critiques[*].message`.
**Origin:** ISL/PLoT critique-template emission, NOT decision_review LLM.
**Discovered by:** v5-journey-replay harness 2026-04-30, scenario
`5f625966-eead-4337-a306-79de5f0a9632`, build `a555cf7`.

---

## Reproducer

Wire response captured from `cee-staging.onrender.com/orchestrate/v2/turn`
on step 4 (run_analysis chip-click), 2026-04-30:

```
blocks[0].enrichment.critiques[0..3].message:
  "Node 'opt_hire_local' has kind='option'. Option nodes are filtered before analysis."
  "Node 'opt_offshore' has kind='option'. Option nodes are filtered before analysis."
  "Node 'opt_status_quo' has kind='option'. Option nodes are filtered before analysis."
  "Node 'opt_tiered_pricing' has kind='option'. Option nodes are filtered before analysis."
```

Two distinct contract violations:
1. **Raw entity IDs** (`opt_hire_local`, etc.) in user-facing prose.
2. **Internal engine vocabulary** ("Node", "kind=", "filtered before
   analysis", "Option nodes") in user-facing prose. Even with IDs
   resolved to labels, the message reads as engine implementation
   detail, not coaching.

## Critique audit (precondition for this brief)

The wider ISL critique catalogue
(`Inference-Service-Layer/src/models/critique.py`) was audited for
coaching-vs-diagnostic classification. Summary:

**Diagnostic** (suppress from user-facing enrichment, route to debug-
only payload — `enrichment._diagnostics.critiques[]` or behind
`CEE_TURN_DEBUG_ENABLED=true`):

- `"Node 'X' has kind='option'. Option nodes are filtered before analysis"`
  (the captured leak — engine preprocessing detail; not in
  `critique.py`, emitted from a separate option-filtering preprocessing
  path)
- `MISSING_GOAL_NODE`, `INVALID_NODE_ID`, `DUPLICATE_NODE_ID`,
  `DUPLICATE_OPTION_ID`, `INTERVENTION_VALUE_INVALID`, `SEED_INVALID`,
  `GRAPH_EMPTY`
- `EDGE_STRENGTH_OUT_OF_RANGE`, `EDGE_STD_INVALID`,
  `EDGE_ENDPOINT_MISSING`, `NEGLIGIBLE_EDGE_STRENGTH`,
  `GRAPH_DISCONNECTED`, `GRAPH_CYCLE_DETECTED`
- `MONTE_CARLO_FAILED`, `INFERENCE_TIMEOUT`, `INTERNAL_ERROR`,
  `BASELINE_NEAR_ZERO`, `NUMERICAL_INSTABILITY`, `LOW_EFFECTIVE_SAMPLES`,
  `CONSTRAINT_NODE_DEFAULT_BASE`
- `IDENTIFIABILITY_ISSUE` (borderline — stats vocabulary; rephrase as
  coaching in a future ticket)

**Coaching** (rewrite templates to product copy, surface to user as
critique messages):

- `INSUFFICIENT_OPTIONS`, `EMPTY_INTERVENTIONS`,
  `INVALID_INTERVENTION_TARGET`, `NO_EFFECTIVE_PATH_TO_GOAL`,
  `IDENTICAL_OPTIONS`, `OPTION_NO_INTERVENTIONS`, `DEGENERATE_OUTCOMES`,
  `DEGENERATE_OPTION_ZERO_VARIANCE`, `HIGH_TIE_RATE`

The captured staging leak is **diagnostic** by this classification.
The fix is to suppress diagnostic critiques from the user-facing
enrichment shape, not to rewrite their templates.

## Scope

This brief is intentionally scoped to the **suppression / sanitisation
layer**, not to a content rewrite of every coaching critique. Coaching-
critique rephrasing is a separate ticket.

### Server-side (CEE; post-approval only)

**1. Sanitiser module: extract `sanitiseUserFacingText` to a shared module.**

`src/orchestrator-v5/compose/output-safety.ts` currently exports
`sanitiseUserFacingText` and `sanitiseOlumiResponseForEgress`. Move the
core scrubber to a shared module so the decision-review enricher and
the response-finaliser can both reuse it without a V4→V5 dependency
edge:

- New file: `src/orchestrator/shared/output-safety.ts` (parallel to the
  existing `src/orchestrator/shared/entity-id-pattern.ts` neutral
  utility).
- Move: `sanitiseUserFacingText`, the slug-shape heuristic, the
  confirmation gates (`fac`/`opt`-confirmed, multi-segment first-
  segment-too-short rejection, etc.), and the path-aware scanner.
- Re-export from the existing `compose/output-safety.ts` so V5 callers
  don't need to update imports.
- This addresses the tracked debt note in `entity-id-pattern.ts:8-13`
  ("any change to ENTITY_ID_LEAK_RE must be co-reviewed against
  output-safety.ts").

**2. ID-to-label resolver: new `src/orchestrator-v5/compose/resolve-label.ts`.**

Single shared resolver used by both the enricher and the finaliser:

```ts
export interface LabelResolverContext {
  readonly graph?: { nodes?: ReadonlyArray<{ id?: string; label?: string }> };
  readonly analysisReady?: { options?: ReadonlyArray<{ option_id?: string; label?: string }> };
  readonly enrichment?: {
    option_comparison?: ReadonlyArray<{ id?: string; label?: string }>;
    payloads?: { isl_request?: { options?: ReadonlyArray<{ id?: string; label?: string }> } };
  };
}

export function resolveLabel(id: string, ctx: LabelResolverContext): string;
```

Lookup priority:
1. `ctx.graph.nodes[*].id === id` → return `node.label`
2. `ctx.analysisReady.options[*].option_id === id` → return `option.label`
3. `ctx.enrichment.option_comparison[*].id === id` → return `option.label`
4. `ctx.enrichment.payloads.isl_request.options[*].id === id` → return `option.label`
5. **Fallback (never the raw ID):**
   - `opt_*` / `option_*` → `'the relevant option'`
   - `fac_*` / `factor_*` → `'the relevant factor'`
   - `dec_*` / `decision_*` → `'the relevant decision'`
   - `goal_*` → `'the relevant goal'`
   - `out_*` / `outcome_*` → `'the relevant outcome'`
   - `risk_*` → `'the relevant risk'`
   - `con_*` / `constraint_*` → `'the relevant constraint'`
   - any other prefix → `'the relevant node'`

**3. Diagnostic-vs-coaching split in `decision-review-enricher.ts`.**

In `src/orchestrator-v5/coaching/decision-review-enricher.ts`, before
the existing `{ ...enrichment, decision_review: output }` write at
~line 149:

a. Partition `enrichment.critiques[]` into `coaching` and `diagnostic`
   buckets using a `DIAGNOSTIC_CRITIQUE_CODES` set (see audit above)
   plus a structural heuristic for un-coded critiques: any critique
   whose `message` matches `/^Node\s+'/i` or contains
   `/\bkind=|filtered before analysis\b/i` is classified diagnostic.
b. Write coaching critiques to `enrichment.critiques[]` (same path the
   UI consumes today). Apply `sanitiseEnrichmentText(message, ctx)` to
   each coaching critique's `message` field.
c. Move diagnostic critiques to `enrichment._diagnostics.critiques[]`
   (new path, debug-only). Gated visibility:
   - When `CEE_TURN_DEBUG_ENABLED=true`: emit `_diagnostics` on the
     wire.
   - Otherwise: omit `_diagnostics` entirely (don't ship the field).

**4. Egress backstop: `response-finaliser.ts`.**

In `src/orchestrator-v5/response-finaliser.ts`, extend `stripCeeTrace`
(or alongside it) to apply `sanitiseEnrichmentText` over the explicit
allowlist below as a defensive second pass. This guards against any
future enrichment producer that bypasses the enricher.

### Path-aware sanitisation allowlist (explicit)

The sanitiser walks ONLY these paths. Other enrichment fields pass
through unchanged.

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
```

`sanitiseEnrichmentText(text, ctx)` is the composition of:
1. Resolve every `ENTITY_ID_RE` match using `resolveLabel(id, ctx)`.
2. Strip internal-template tokens that survive ID resolution
   (see "internal-language forbidden tokens" below).

### Structural fields that MUST remain unchanged

The sanitiser must not touch any of these:

- `$.blocks[*].enrichment.critiques[*].id`
- `$.blocks[*].enrichment.critiques[*].code`
- `$.blocks[*].enrichment.critiques[*].severity`
- `$.blocks[*].enrichment.critiques[*].source`
- `$.blocks[*].enrichment.critiques[*].affected_option_ids`
- `$.blocks[*].enrichment.critiques[*].affected_node_ids`
- `$.blocks[*].enrichment.factor_sensitivity[*].node_id`
- `$.blocks[*].enrichment.fragile_edges[*].edge_id`,
  `from_id`, `to_id`, `edge_e_values[*]`, `factor_evpi[*].factor_id`
- `$.blocks[*].enrichment.option_comparison[*].id`,
  `option_comparison[*].label` (label is a label, not user-facing prose)
- `$.blocks[*].enrichment.payloads.*` (request/response audit trail)
- `$.blocks[*].enrichment.flip_thresholds`,
  `enrichment.stability_thresholds`, `enrichment.request_id_chain`,
  `enrichment._meta`, `enrichment.feature_flags_snapshot`,
  `enrichment.meta` — all diagnostic
- `analysis_ready.*` substructure (handled separately by existing
  finaliser path)

Acceptance test asserts deep-equality of each excluded subtree before
and after sanitisation.

### Internal-language forbidden tokens

After sanitisation, NO user-facing text in the allowlist may contain:

- `Node ` (followed by a space — engine validation prefix)
- `kind=` / `kind='`
- `filtered before analysis`
- `option nodes` (case-insensitive)
- `_pipeline_outcome`
- `payloads`
- `ISL` (case-insensitive standalone token)
- `intervention_target`, `interventions`, `monte carlo`,
  `numerically valid samples`, `epsilon-guarded`, `e-value`,
  `bootstrap`, `causal path` (engine-vocabulary that survived
  uncoded critiques)

The forbidden-token set is shared with the existing
`recovery-chips-forbidden-terms.ts` enforcement layer. Add the new
tokens to a shared registry, not a parallel constant.

## Implementation surface (file-by-file)

1. **NEW:** `src/orchestrator/shared/output-safety.ts` — extract
   `sanitiseUserFacingText` from `compose/output-safety.ts` so V5 and
   V4 paths can share it.
2. **NEW:** `src/orchestrator-v5/compose/resolve-label.ts` — single
   shared label resolver.
3. **NEW:** `src/orchestrator-v5/compose/sanitise-enrichment.ts` —
   `sanitiseEnrichmentText`, the path-aware allowlist walker, and
   the diagnostic-critique classifier.
4. **EDIT:** `src/orchestrator-v5/coaching/decision-review-enricher.ts`
   (~line 149): partition critiques, sanitise coaching ones, move
   diagnostic ones to `enrichment._diagnostics`, gate by
   `CEE_TURN_DEBUG_ENABLED`.
5. **EDIT:** `src/orchestrator-v5/response-finaliser.ts`: add a
   second-pass scrubber over the allowlist as defence-in-depth.
6. **EDIT:** `src/orchestrator-v5/compose/output-safety.ts` and
   `compose/recovery-chips-forbidden-terms.ts`: re-export the moved
   utilities; add new forbidden tokens to the shared registry.

## Tests

### Unit (resolver)
`src/orchestrator-v5/compose/__tests__/resolve-label.test.ts`:
- Each lookup priority returns the right label.
- Each fallback prefix returns the right "the relevant X" string.
- Empty / null context for every priority returns the prefix-specific
  fallback, never the raw ID.

### Unit (sanitiser)
`src/orchestrator-v5/compose/__tests__/sanitise-enrichment.test.ts`:
- The captured staging leak (verbatim) → after sanitise:
  - With graph context: `"Node 'Hire Two Senior Engineers Locally' has kind='option'. Option nodes are filtered before analysis."` →
    further internal-template scrubbing → final acceptable user copy
    (this is the diagnostic path; the message gets MOVED to
    `_diagnostics` rather than rewritten in place).
  - Without graph context: same diagnostic-move path; resolver
    fallback returns `"the relevant option"` if the message ever does
    surface in coaching path.
- Sanitiser preserves structural id fields byte-equal (deep-equal
  assertion).
- Internal-language forbidden tokens trigger no false positives on
  legitimate decision-modeling prose ("the analysis took longer than
  expected" etc.).

### Unit (enricher partition)
`src/orchestrator-v5/coaching/__tests__/decision-review-enricher-partition.test.ts`:
- Mock enrichment with mixed coaching + diagnostic critiques. Assert:
  - `enrichment.critiques[]` contains only coaching codes; their
    messages have IDs resolved and tokens scrubbed.
  - `enrichment._diagnostics.critiques[]` contains the diagnostic
    codes (when `CEE_TURN_DEBUG_ENABLED=true`).
  - `_diagnostics` is omitted when `CEE_TURN_DEBUG_ENABLED=false`.
  - Structural fields (`affected_option_ids`, `id`, `code`, `severity`)
    are unchanged in both buckets.

### Contract (cross-boundary)
`tests/contract/decision-review-egress.test.ts`:
- Load `tests/fixtures/cross-service/decision-review.normalised.json`
  with synthetic `opt_*` leaks and the captured staging template
  injected. Run sanitiser. Assert:
  - All 12 allowlisted paths scan clean (`scanForEntityIds` returns
    empty).
  - No internal-language tokens in user-facing text.
  - Excluded structural fields are byte-equal pre- and post-sanitise
    (`expect(after.payloads).toEqual(before.payloads)`, etc.).

### Replay
The harness's existing `assertAnalysisRunExtended` already runs
`scanForEntityIds` on the full body. Post-fix:
- Live replay step 4 must PASS on staging.
- The captured wire sample becomes the regression fixture for both
  the unit test and the contract test.

## Out of scope

- Rephrasing coaching critiques into product copy (tracked as a
  separate UX ticket; this brief is about safety, not voice).
- Changing the ISL/PLoT-side critique templates (the leak is upstream
  of CEE; CEE's job is the egress contract).
- Changes to enrichment shape beyond the allowlisted text fields and
  the new `_diagnostics` debug-only path.
- Prompt rewrites.

## Acceptance

1. **Wire-clean on the captured staging response.** All 12 allowlisted
   enrichment paths pass `scanForEntityIds` (no entity-ID matches).
2. **Internal language gone.** None of the forbidden tokens
   (`Node `, `kind=`, `filtered before analysis`, `option nodes`,
   `_pipeline_outcome`, `payloads`, `ISL`, etc.) remain in user-facing
   text under the allowlist.
3. **Structural fields untouched.** Deep-equality of every excluded
   subtree pre- and post-sanitise.
4. **Diagnostic critiques moved.** Diagnostic critique codes (per
   audit) appear in `_diagnostics.critiques[]` under
   `CEE_TURN_DEBUG_ENABLED=true`, NOT in `enrichment.critiques[]`.
5. **Diagnostic critiques omitted by default.** With
   `CEE_TURN_DEBUG_ENABLED=false`, `_diagnostics` is not present on
   the wire.
6. **Resolver fallback never returns raw ID.** Asserted by unit
   coverage of every prefix family with empty context.
7. **Live replay step 4 passes** against staging post-deploy.
8. **No regression on `tests/contract/`** — all 110 existing UI-side
   contract tests and 64 CEE-side contract tests stay green.
