# Lane 22 (P0-B) — Conversational edit capability & honesty

**Date:** 2026-07-07 · **Branch:** `claude-lane22/edit-capability` · **Base:** `origin/staging` @ `1aa46892e`
**Mission:** in the product owner's live 2026-07-07 session the LLM edit lane failed 3-for-3 (three different modes) while typed handlers went 2-for-2; the session ended 19 seconds after the third failure. Six work items, all verified against live Render logs + code at `1aa46892e`.

All items were implemented RED→GREEN: the failing tests were written and run first
(43 failures across 8 files against clean `origin/staging` behaviour), then the fixes landed
(full required CI gate: 18 805 passed / 0 failed).

---

## Item 1 — Proposal-continuation matcher ("system proposes, user says yes, system forgets")

**Broken (live evidence):** assistant proposed *"add the 20% velocity target as a constraint"*;
capture succeeded (`v5.proposal_continuation.captured`); user replied verbatim
*"Yes, add that velocity target."* → `no_agreement` → proposal dropped → no-op edit lane.

**Root causes** (`src/orchestrator-v5/coaching/proposal-continuation.ts`):
- `STANDALONE_AGREEMENT` was `$`-anchored — every "Yes, <anything>" failed, even "Yes please."
- `AGREEMENT_PHRASES` was a 6-entry whitelist missing "yes please" / "sounds good" / "do it" / "add it".
- Messages > 400 chars were auto-rejected, so a pasted-back question + "Yes, please update the model now." (live miss #2) could never match.
- No signal tied the reply to the *stored concept* — "velocity target" appeared verbatim in both proposal and reply and was ignored.

**Fixed:**
- `AFFIRMATIVE_PREFIX` rule: affirmative opener + (politeness-only remainder OR continuation
  imperative), rejected on any negation/contrary token anywhere and on explicit value
  assignments (`to/by/at <number>` — a fully-specified edit routes to the real edit path,
  not the Stage-1 ladder).
- `BARE_IMPERATIVE_AGREEMENT`: "Add it." / "Include it." / "add it to the model" / "Do it.".
- Whitelist gaps added (negation-window-guarded like every other phrase).
- Oversized / multi-sentence messages: the **final sentence** is evaluated alone.
- `conceptTokenOverlapAgreement` + exported `detectsProposalAgreement(message, concept)`:
  ≥2 significant concept tokens as whole words in the reply (all tokens for 1-token
  concepts), rejected on negation/contrary, interrogative lead, or value assignment.
- **One shared matcher feeds both call sites:** `decideProposalContinuation` (now calling
  `detectsProposalAgreement`) is the single decision helper used by the pre-LLM intercept
  (`resolveProposalResume`, edit-graph-dispatch.ts) and the post-LLM recovery
  (`decideNoOpRecovery`). Already-disambiguated "as a factor affecting X" messages are
  explicitly never intercepted (new early return) so concept overlap cannot swallow a
  Stage-3 instruction.

**Test proof:** `src/orchestrator-v5/coaching/__tests__/proposal-continuation.test.ts` —
table-driven accept/reject sets including the two exact live misses; end-to-end Stage-1
resume through `decideProposalContinuation`; the dispatch-level live-miss e2e (below) proves
"Yes, add that velocity target." now resumes pre-LLM with zero LLM calls. 188/188 green.

## Item 2 — Continuation telemetry (make the matcher measurable)

**Broken:** `resumed{outcome:no_agreement}` was emitted ONLY in the zero-operations post-LLM
sub-case. The pre-LLM gate declined **silently** (`rejection:null` → nothing emitted,
edit-graph-dispatch.ts ~1421-1428), and a missed resume where the LLM produced ops
(applied or rejected) was invisible.

**Fixed** (`src/orchestrator-v5/handlers/edit-graph-dispatch.ts`):
- Pre-LLM gate: valid pending + matcher no-match now emits
  `V5ProposalContinuationResumed{outcome:'no_agreement', pre_llm:true}`. `no_pending`
  (steady state) still emits nothing.
- Ops-produced paths: valid pending + `wasRejected || operations.length > 0` emits
  `V5ProposalContinuationResumed{outcome:'no_agreement', pre_llm:false, ops_produced:true, edit_was_rejected}`.
- **No new telemetry event names** — the frozen-registry tripwire
  (tests/utils/telemetry-events.test.ts) is untouched by design; the new emits reuse the
  existing `v5.proposal_continuation.resumed` name with distinguishing payload fields.
  Note for dashboards: a no-match turn can now emit up to two `no_agreement` events
  (gate + post-LLM), distinguishable by `pre_llm` / `ops_produced`.

**Test proof:** `src/orchestrator-v5/handlers/__tests__/edit-graph-dispatch-continuation-telemetry.test.ts`
(new, modeled on the early-emit harness): live-miss resume (no LLM call, one
`{stage_one, pre_llm:true}` emit), pre-LLM no-match emit, ops-produced/rejected emit.

## Item 3 — No-op fallback quality + R10 clarification preservation

**Broken (live):** the V4 no-op branch shipped canned copy with ZERO chips
(`buildNoOpRecoveryChips` needs a validator referential error; the live no-op had none), and
the R10 trip test dropped the LLM's own claim-safe clarifying question
(`coaching_dropped:true, clarification_preserved:false`) because the edit prompt teaches the
word "graph" and `EDIT_INTERNALS_PATTERNS` declines bare `graph`/`path`.

**Fixed:**
- `src/orchestrator/tools/edit-graph.ts` no-op branch: graph→model word transform on the
  scrubbed candidate BEFORE the trip test (claim-safe domain synonym; transform-not-decline),
  so an otherwise-clean question survives.
- `src/orchestrator-v5/compose/forbidden-user-facing-phrases.ts`: bare `path` removed from
  `EDIT_INTERNALS_PATTERNS` (legitimate decision English; dotted `operations.path`,
  snake_case ids and `->` arrows still decline). Sole other consumer of
  `findEditInternalsHit` (`coaching-output-postcheck.ts`) references it only in a comment —
  verified unaffected.
- Declined preservation now ships `buildEditClarifyFallbackParts` (new export in
  `src/orchestrator-v5/compose/edit-clarify-response.ts`) — the SAME deterministic copy +
  1–3 factor/option-label chips as the route-level intercepts, egress-guard-safe by pinned
  tests; chip prompts are question-shaped (no edit-verb re-dispatch trap). Referential-error
  chips still take precedence when available.
- The old chip-less `NO_OP_FALLBACK_TEXT` constant is removed.

**Test proof:** `tests/unit/orchestrator/tools/edit-graph-no-op-preservation.test.ts`
(graph→model preservation, path preservation, chips-on-decline, chips-on-no-coaching);
`src/orchestrator-v5/compose/__tests__/edit-internals-predicate.test.ts` (bare-path
relaxation + dotted-path still trips). Updated pre-existing pins of the old canned copy:
`edit-graph.test.ts` (5 sites), `edit-graph-v2.test.ts` (10b), `edit-graph-bare-array-safe-envelope.test.ts`
(D3-no-op), `edit-graph-no-op-telemetry.test.ts` (`deterministic_chips_emitted` now > 0 —
deliberate contract change: the count now includes clarify-fallback chips).

## Item 4 — Structural-rejection honesty (the failure the session ended on)

**Broken (live):** a NO_PATH_TO_GOAL structural pre-validation rejection suppressed the
actionable reason into "Consider simplifying the change or approaching it differently." and
offered a "Simplify the change" chip that is a documented dead-end (exact-text interceptor
`chip-simplify-intercept.ts`, closed loop since 2026-05-22).

**Fixed:**
- `src/orchestrator/patch-rejection-helper.ts`: new optional `user_safe_reasons` field —
  caller-vetted strings only; first two distinct reasons replace the vague line:
  *"I wasn't able to apply that change. This change would leave a node that cannot reach the
  goal. You could describe the change differently, or I can rebuild the model from an
  updated brief."* Raw `violations` stay suppressed exactly as before; `structural_guidance`
  (Cap-2A flag) still takes precedence; empty/absent reasons → byte-identical old copy.
- `src/orchestrator/tools/edit-graph.ts` structural-validation site: populates
  `user_safe_reasons` from the user-facing `VIOLATION_MESSAGES` catalogue ONLY (the
  catalogue is a complete `Record<StructuralViolationCode, string>`, so every code maps to
  approved copy; raw `v.detail` never qualifies). Verified the surfaced strings pass the
  egress `FORBIDDEN_USER_FACING_PHRASES` guard (no bare-"node" pattern there).
- Both rejection sites: dead-end chip replaced with
  `{label: 'What would work instead?', prompt: 'What would work instead?'}` — a
  question-shaped prompt with no edit verb, so it routes to the conversational path instead
  of a guaranteed no-op edit dispatch. `chip-simplify-intercept.ts` is retained for
  already-rendered legacy chips.

**Test proof:** `tests/unit/orchestrator/patch-rejection-helper.test.ts` (surface / cap+dedupe /
empty-fallback); `tests/unit/orchestrator/tools/edit-graph-v2.test.ts` (end-to-end: actionable
reason on the wire, no internal ids, dead-end chip gone, affordances remain);
`tests/unit/orchestrator/edit-graph-add-risk-flag-seam.test.ts` updated — the Cap-2A flag-OFF
"byte-identical GENERIC" pins now pin the exact honest copy instead (flag-ON placeholder
behaviour unchanged; chips-parity test unchanged).

## Item 5 — Receipt forward-promise honesty

**Broken:** `formatGoalTargetSet` unconditionally shipped *"The next analysis will score your
options against this target."* — false for every goal-target registration today (goal-fit is
deterministically suppressed for goal nodes without a value channel; PLoT PR #203 and the
target_base doctrine implementation are pending).

**Fixed** (`src/orchestrator-v5/tools/handlers/d1-shared/format-confirmation.ts`):
*"Success target set: {goal} at least {value}. I'll flag how your options score against it
once the analysis can measure this goal."* — sentence 1 keeps the receipt-guard claim shape
(`decideGoalTargetReceipt` still protects it); sentence 2's "once" places it in the guard's
conditional screen, and the copy passes `findSuccessClaimHit` / `findForbiddenPhraseHit`
(asserted in the join test).

**Test proof:** `src/orchestrator-v5/tools/handlers/__tests__/add-constraint-goal-target-join.test.ts`
(exact new copy + guards); `goal-target-receipt-guard.test.ts` and
`turn-executor-goal-target-commit-honesty.test.ts` consume `formatGoalTargetSet` dynamically
and stay green (verified in the full run).

## Item 6 — Proposal-capture precondition hash

**Broken (live):** both live proposal captures persisted with EMPTY `preconditions` (no
`graph_hash`), so hash-divergence invalidation was inert. Cause: the capture-site hash in
`src/orchestrator-v5/turn-executor.ts` (both the STEP-7 `llm_sonnet` commit and the
`advice_gate` commit) computed from the RAW request `options.graphState`, which is absent on
follow-up turns → hash null → no precondition.

**Fixed:** both sites now hash `graphStateForTurn` — the executor's single authoritative
per-turn graph (request graphState when present, else the persisted-graph fallback loaded by
`buildTurnContext`). When the request DOES carry graphState the value is identical, so
present-graph behaviour is unchanged; the mutated-graph precedence at the STEP-7 site is
also unchanged.

**Test proof:** `src/orchestrator-v5/__tests__/turn-executor-proposal-capture-hash.test.ts`
(new): drives a follow-up-turn shape (no request graphState, rich persisted EXP-01 fixture
graph) through a Sonnet proposal reply and pins
`pending_actions[proposed_concept].preconditions.graph_hash === computeAnalysisAffectingGraphHash(persistedGraph)`.
RED before the fix (preconditions `{}`), GREEN after. The `advice_gate` site received the
same one-line fix but is covered indirectly (driving the advice gate requires a full
post-analysis fact fixture; the hash expression is now identical at both sites).

---

## Verification summary

| Gate | Result |
|---|---|
| RED baseline (new/changed tests vs origin/staging behaviour) | 43 failed / 250 passed across 8 files |
| `pnpm typecheck:src` (tsc -p tsconfig.build.json, the real gate) | clean |
| `scripts/ci/typecheck-ratchet.sh` | within baseline (136 files / 462 errors vs 137/462 — drift shrank) |
| `scripts/check-forbidden-boundary-patterns.sh` | all == baseline (warnOnInvalid 0, as-unknown-as 95, science-fallback 17) |
| `pnpm exec eslint <changed files>` | clean |
| `pnpm test:required` (the required CI suite) | **18 805 passed / 0 failed** (99 skipped / 13 todo, pre-existing) |
| Frozen telemetry registry | untouched (no new event names; payload-field additions only) |
| New `it.skip` | none |

## Residual risks / follow-ups (documented, not attempted — out of scope per brief)

1. **V5-native edit prompt / V4 patch-DSL output contract** (`parseEditGraphResponse`,
   edit-graph.ts) — unchanged; the edit LLM still emits the V4 DSL.
2. **`edit_graph` not in the Sonnet L1 routing enum** (route-v2.ts ~1573/1601) — unchanged.
3. **No continuation channel for constraint-kind proposals** — the Stage-1 ladder still
   offers risk/factor/note only; the live "as a constraint" proposal resumes into that
   ladder (doctrine-adjacent, deferred).
4. **Double `no_agreement` emits per no-match turn** (gate + post-LLM) — intentional and
   field-distinguishable (`pre_llm`, `ops_produced`); dashboards summing raw counts must
   filter.
5. **Matcher over-acceptance risk:** "do it/that" and affirmative-prefix+imperative rules
   only run when a live, TTL-valid, hash-valid pending proposal exists, and value
   assignments/negations/questions are screened — but a colloquial "can we do it tomorrow?"
   within the TTL window would resume Stage 1. Accepted as the cheaper failure mode
   (deterministic 3-chip clarifier, one turn to dismiss) vs the live one (proposal dropped).
6. **`deterministic_chips_emitted` semantics widened** (now counts clarify-fallback chips,
   not just referential-error chips) — noted for anyone reading pre/post dashboards.
7. **Advice-gate capture-hash leg has no direct test** (see Item 6).
8. **Cap-2A "byte-identical baseline" claim retired:** add-risk-rejection-render.test.ts
   still proves the helper-level composition with caller-supplied fixtures, but the live
   call site now ships the honest reason copy; the flag-seam test pins the new exact
   strings.
