# P0 draft-failure diagnosis — CEE staging, derived 2026-09-21

HEAD pinned by BOTH authorities:
- `git ls-remote` → 5104b244cb3e75e0e6ee164e6377ab9d19437159
- `gh api .../git/ref/heads/staging` → 5104b244cb3e75e0e6ee164e6377ab9d19437159

Clone: /private/tmp/cee-p0-draft-1790000140-23180 (blobless, staging, HEAD asserted)

## 1. WHICH EMITTER FIRED — settled at the deployed logs, not inferred

Render service `cee-staging` = srv-d4slpaili9vc73eiq4og, owner tea-d3eqr815pdvs73c6dn5g.

Per-request trace of 76033230-82c7-4523-afd2-25f6dfc13bdb (09:50:28→09:50:55) ends:
    Graph validation passed
    Post-enforcement validation: 3 non-blocking warning(s)
    Deterministic graph enforcement completed
    Structural parse failed — graph does not conform to DraftGraphOutput schema
    V5 draft_graph dispatch — unified pipeline threw
    V5 draft_graph pipeline threw — returning 500 BoundaryError   (pipeline_status_code: 400)

EMITTER = `src/cee/unified-pipeline/stages/repair/structural-parse.ts:42-47`
(Stage 4 substep 10, the Zod safety net). NOT enrichment, NOT the post-enforcement
gate, NOT the OPTIONS_IDENTICAL bypass, NOT the empty-draft gate.

### Same-window census (neither query truncated, hasMore=false on both)
Window 2026-09-21T00:00:00Z .. 23:59:59Z:
- draft 500 BoundaryError requests : 16
- structural_parse.failed requests : 16
- overlap                          : 16
- 500s that are NOT structural_parse: 0
=> 100% of that window's draft 500s are this one emitter.

### Controls on the log probe (trap 13)
- positive control "unified pipeline threw" -> 5 hits
- negative control "zzz_never_present_zzz"  -> 0 hits
- "cee.enrich.crashed" -> 0, "enrichment_failed" -> 0  (enrichment genuinely NOT the cause)

## 2. IS `retryable` BEING DROPPED? NO — the brief's hypothesis is REFUTED

The promotion wrapper (`route-v2.ts:2323`) is intact and the threading is intact
(`pipelineRetryable` attached at draft-graph.ts:458, read at route-v2.ts:5119,
passed at 5497/5640).

The producer is SILENT. `structural-parse.ts` calls:
    buildCeeErrorResponse("CEE_GRAPH_INVALID", "Graph failed structural validation",
                          { requestId: ctx.requestId })
with NO `retryable`, NO `reason`, NO `recovery`, NO `validation_error_codes`.
`buildCeeErrorResponse` defaults `retryable: options.retryable ?? false`
(pipeline.ts:157). So `retryable=false` is the CORRECT FLOOR for an emitter that
declares nothing — nothing is lost in transit.

This is precisely the shape graph-enforcement.ts's own HONEST RETRY comment
(2026-07-24, lines 882-886) describes as the defect it fixed for ITS emitter:
"no `retryable` and no `recovery` meant the envelope defaulted to
`retryable: false` / `recovery: null`, i.e. a hard dead end."
The sibling emitter never got the same treatment.

## 3. WHY THE USER GETS A BLANK SCREEN

`draft-failure-recovery-turn.ts` exists and is correct, but the route gates it:
    route-v2.ts:5469  if (!previewWasStreamed && isPostEnforcementBlock(recoveryCodes))
`isPostEnforcementBlock(codes) = codes.length > 0`, keyed on
`details.validation_error_codes` — emitted by exactly ONE site, the post-enforcement
gate. structural-parse emits none -> gate false -> bare 500, `assistant_text` empty.

route-v2.ts:5459-5463 names this in terms: "EVERY other failure class on this path
keeps today's 500 ... THAT IS THE RESIDUAL, and it is stated rather than buried."
The measured P0 lives in that residual.

## 4. ROOT CAUSE OF THE PARSE FAILURE — one field, complete census

All 17 retained `cee.structural_parse.failed` events, 20 issues total, NO truncation
(max error_count=2 vs extractZodIssues cap of 3):
    paths: {'graph.nodes.N.observed_state': 20}
    codes: {'invalid_union': 20}

`NodeObservedState` (schemas/graph.ts:285) = union[ConstraintObservedState, FactorObservedState].
BOTH branches require `value: z.number()`; the factor branch additionally REFUSES any
`metadata` key. So an observed_state that is provenance-only (no numeric `value`), or a
malformed constraint shape, fails BOTH branches -> invalid_union.
Corroborating live log in the same request: "Post-enrich invariant: 1/3 controllable
factor(s) lack numeric data.value".

## 5. TRANSIENCE — measured, not inferred

The smoke gate sends a FIXED brief ("Should we open a second bakery location in Leeds
next quarter?") 5x per head. Rates across today's five staging heads: 40/60/20/40/40%.
Identical bytes, same build, different outcome => stochastic. Same evidential basis the
estate already accepted for the enforcement class (route-v2.ts:2314-2319).

## 6. AUTO-RETRY DOES NOT COVER THIS CLASS
`draft-auto-retry.ts` RetryableDraftFailureClass = "post_enforcement" | "options_identical".
`isEnforcementBlockedResult` needs FOUR conjuncts: statusCode 422, code CEE_GRAPH_INVALID,
retryable===true, details.last_phase==="deterministic_enforcement".
structural-parse emits 400 and no last_phase => even with retryable:true it CANNOT
accidentally trigger auto-retry. To be pinned by test, not assumed.

---

## 7. STATE AT FREEZE (2026-09-21, machine restart for disk pressure)

SHIPPED IN THE PRECEDING COMMIT (78e88384), all green locally:
- `structural-parse.ts` declares `reason` + `retryable: true` and exports
  `isStructuralParseBlockReason` beside the emission.
- `route-v2.ts` speaks for that class via a SECOND, separately-named predicate.
- 2 new specs, 13 tests, all passing; RED-first evidenced at pristine
  (producer 5 failed / 1 passed of 6; route 6 failed / 1 passed of 7).

WHAT THE USER NOW GETS (executed, not reconstructed):
    Something went wrong on our side while building your decision model, so
    nothing was shown to you. Nothing in what you wrote caused this.

    If this keeps happening, send us this reference: <request_id>
plus the existing one-tap "Try again" chip, armed as a real draft_graph pending.
No new product copy was authored: this is the already-reviewed
`OLUMI_FAULT_FALLBACK_READABLE` + `composeReferenceLine`.

### UNFINISHED — do these next
1. MUTANTS. Worktree baseline was green (13/13) but the kit did NOT run.
   Planned, each expected to RED the named spec:
     M1 drop `retryable: true`            -> producer spec
     M2 drop `reason:`                    -> producer + route specs
     M3 drop `|| speaksAsStructuralParse` -> route spec
     M4 force the gate to always-true     -> the "different class keeps its 500"
                                             twin MUST red (discrimination proof)
     M5 status 400 -> 422                 -> the auto-retry safety pin MUST red
   Applied-check per mutant scoped to `src/`, control asserting exactly 0.
2. THE FULL REQUIRED CHECK, as a STEP SEQUENCE (trap 22e): lint -> typecheck ->
   tests. Only the two new specs were run locally; `pnpm lint` and
   `tsc -p tsconfig.build.json --noEmit` have NOT been run on this commit.
3. CI polled to conclusion in the FOREGROUND.

### OUTCOME METRIC — named before any further fix (trap 23)
SYMPTOM metric: draft 500 rate (40% on head 5104b244).
OUTCOME metric: share of first turns where the user gets EITHER a usable model
OR a readable explanation. This commit moves the OUTCOME metric only — it does
not reduce the 500 rate, and must not be reported as if it did. The failure
still happens; the user is now told, and offered a retry.

### NOT DONE, EACH NEEDS ITS OWN EVIDENCE
- The underlying `observed_state` union failure (the real defect: 20/20 issues).
  Both union branches require `value: z.number()`; a provenance-only
  observed_state matches neither. ⚠ Do NOT start a prompt/grammar rewrite —
  trap 23 records that exact attempt moving a symptom metric spectacularly and
  the outcome metric not at all.
- Whether this class should join the bounded auto-retry
  (`draft-auto-retry.ts`). Its membership rule demands the producer declare the
  class stochastic (now true) AND a measured retry RECOVERY RATE (NOT measured).
  Measure that before adding it.
