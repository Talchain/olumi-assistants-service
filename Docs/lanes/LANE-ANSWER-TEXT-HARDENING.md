# Lane: answer_text belt-and-braces hardening (CEE code track)

Branch: `claude-cee/answer-text-hardening` (worktree
`.worktrees/cee-answer-text-hardening`, base `origin/staging` @ `81392d152`).

**PR status: DRAFT. Not to be merged or marked ready without explicit
instruction** — see "Why sequenced behind v42.2g" below.

## What

Coach/converse turns carry an OPTIONAL top-level `answer_text` on the V5
routing tool call (landed PR #380 / `b7b2b4048`, ROADMAP 1.38). Compose
prefers `answer_text` (sanitised through the same guard pipeline as
`orientationText`) and falls back to the free-form pre-tool-call
`orientationText` when absent. On Sonnet 5, adaptive thinking sometimes
starves `orientationText` to zero — combined with an absent/blank
`answer_text`, this produces a fully empty user-facing coach answer
(live-observed 1/6, `acceptance-evidence/sonnet5-reflip/`).

This lane adds two independently-justified defensive layers, both gated
behind a single new flag `CEE_ANSWER_TEXT_REQUIRED` (default OFF,
`booleanString` pattern in `config/index.ts`):

- **Layer A — schema pressure.** `tool-schema.ts`'s `RawToolCallSchema`
  requires a non-blank top-level `answer_text` on coach/converse tool calls
  ONLY when the flag is on. This is a plain Zod validation failure like every
  other rule in the file's `superRefine`, so an omission flows through the
  **existing** `REPAIR_ONCE` mechanism in `route-with-tool-use.ts` unchanged
  — no new retry plumbing. One retry, with the issue's message ("answer_text
  is required when intent_class === …") surfaced to the model verbatim via
  `buildRepairMessages`'s `tool_result` content; a second omission produces
  the pre-existing typed `schema_repair_failed` RoutingError, which
  `translateRoutingError` already routes to `commitBoundedRoutingFallback`
  (unchanged). `execute`/`clarify` are untouched — they already forbid
  `answer_text` outright (unaffected by the flag) and carry their answer via
  `action.explanation.answer_text` / `clarification.question`.

- **Layer B — compose guard.** `turn-executor.ts`'s coach/converse compose
  branches check the FINAL `composedOk.assistant_text` (after chip
  generation, `sanitiseNarrateOutput`, and `applyCoachingOutputGuard` have
  all already run unchanged) and, only when the flag is on and that text is
  empty/whitespace, override it with the bounded-recovery copy/chips —
  reusing a builder (`buildBoundedFallbackCopyAndChips`) extracted from the
  **existing** `commitBoundedRoutingFallback` (the schema-repair-failure
  recovery path), not new copy. Emits `v5.coaching.empty_answer_recovered`
  with lengths only (`answer_text_length`, `orientation_length`,
  `intent_class`) — never the model's prose.

  Layer B is deliberately checked **post-sanitisation**, not on the raw
  `answer_text`/`orientationText` fields, because layer A only validates the
  RAW string non-blank. A raw `answer_text` that is non-blank (so layer A's
  check passes, no repair fires) can still sanitise to `''` —
  `sanitiseNarrateOutput`'s `TAG_PATTERN` strips `<...>`/`</...>` markers and
  keeps inner text, so content that is ONLY markup (e.g.
  `<internal></internal>`) sanitises to empty. That is the genuinely
  independent residual layer B closes; the raw-blank case layer A already
  prevents (or, if `REPAIR_ONCE` also fails, the pre-existing
  `schema_repair_failed` → `commitBoundedRoutingFallback` path already
  covers, with the SAME copy, under the existing `v5.routing_bounded_fallback`
  event). Layer B also stands as independent defence-in-depth if layer A's
  check is ever bypassed (a future code path, or a rolling-deploy skew
  window between pods on different builds).

Flag OFF is byte-identical to pre-hardening behaviour on both layers —
verified by dedicated regression-pin tests (see Tests below).

## Why sequenced behind v42.2g (measurement isolation)

The orchestrator-prompt workstream is running a **prompt-only** fix for the
same defect (v40 RUNTIME edit / a forthcoming served-prompt revision,
tracked there as the next version after the current staging pin v42.2f —
see `orchestrator-prompt-workstream` memory, "Sonnet-5 go-live day"). Their
instrument measures the effect of the prompt change ALONE against the
eval-pack floor. If this code-level lane merged and its flag were flipped on
staging at the same time, the two fixes' effects on the empty-answer rate
would be confounded — neither track could attribute the delta to their own
change. Per this repo's `PROGRAM-BOARD.md` workstream-ownership convention
(prompt CONTENT via `staging_version` is the prompt track's lane; this CEE
code lane owns the schema/compose defence), this PR stays **DRAFT, unmerged,
flag OFF** until the prompt track's measurement window closes and Paul
explicitly sequences the flip (or decides the code lane isn't needed at all,
if the prompt fix alone closes the gap). Do not merge or mark ready without
that explicit go-ahead.

## Repair-retry cost tradeoff

Baseline (pre-flip) `REPAIR_ONCE` retry rate attributable to this rule is
**0% by construction** — the Zod rule that can trigger it does not exist
until `CEE_ANSWER_TEXT_REQUIRED=true`. Once flipped, every coach/converse
tool call where Sonnet leaves `answer_text` blank/absent will cost one extra
`chatWithTools` round trip (same mechanism, same latency profile, as the
existing `max_tokens` retry documented in `route-with-tool-use.ts`). If the
rate is high, the fix's own cost (extra latency + tokens on a meaningful
fraction of coach/converse turns) needs weighing against the defect's
severity — this is explicitly a Paul-gated call, not one made in this lane.

**Measurement instrument (fix-round addition, not flag-gated):** `answer_text`
has been optional since PR #380 landed the same day as this lane
(`b7b2b4048`, 2026-07-08), and until this fix round there was genuinely no
telemetry on how often Sonnet populates it spontaneously versus leaving it
for `orientationText` to carry (the pre-#380 shape, which most of the
existing test fixtures still exercise as the "backwards-compatible"
default). `turn-executor.ts` now emits `v5.coaching.answer_source`
(`source: 'answer_text' | 'orientation_fallback'`, plus both channels'
lengths and `intent_class`) at the RAW compose pick site for every
coach/converse turn — **deliberately independent of the
`CEE_ANSWER_TEXT_REQUIRED` flag**, so it measures the CURRENT prompt-only
world (v42.2g) as-is, giving the prompt-workstream's population-lift claim an
actual instrument instead of an assertion. This closes the measurement gap
this section used to describe; the retry-rate signal for a POST-flip world
(visible via the existing `v5.routing.max_tokens_retry`-style informational
log pattern, or by diffing `llm_calls_used` distribution pre/post-flip)
remains the thing to watch once the flag itself is flipped.

## The explain_* prompt-vs-schema latent inconsistency (investigated, filed — not fixed here)

The prompt track flagged a possible inconsistency: "RUNTIME tells `explain_*`
'natural text ships verbatim' while the schema REQUIRES
`action.explanation.answer_text`." Investigated against this lane's base
(`origin/staging` @ `81392d152`, per the header above):

- **The RUNTIME instruction** (v40 `<RUNTIME>` Explanation block, quoted in
  `Docs/v5/v5-explain-handler-diagnosis.md:25`): *"Never emit a tool call for
  an explanation handler unless your natural text already contains the
  complete answer."* This prompt text is NOT in this repo — it is served via
  the PMS (Prompt Management System), owned by the prompt-workstream, per
  this repo's own `lane38-coach-answer-body-2026-07-08.md` boundary note
  ("PMS / served prompt text — Brief I owns it"). `data/prompts.json` in
  this repo is a separate, stale, unrelated prompt-fixture store (last
  modified 2026-04-08) — not the served routing prompt.

- **The schema/tool description** (`src/orchestrator-v5/routing/tool-schema.ts:100`,
  `:114-115`, `:123-124` as of this lane's HEAD): each explanation handler's
  `handler_id` enum description instructs *"You MUST populate
  `explanation.answer_text` with your complete
  [structural/analysis/sensitivity] explanation."* This is tool-definition
  text (code, not served prompt), in scope for this repo.

- **Which side actually wins at runtime** — the schema field, unconditionally:
  - `src/orchestrator-v5/turn-executor.ts:4917` derives
    `isExplanationHandler = EXPLANATION_HANDLER_IDS.has(proposedHandlerId)`
    (the three explain_* handlers).
  - `src/orchestrator-v5/turn-executor.ts:5538-5539` (line numbers as of this
    lane's HEAD, unmodified by this lane) sets
    `suppressOrientation = handlerOutcome.suppress_orientation === true || isExplanationHandler`
    — i.e. `isExplanationHandler` ALONE forces orientation suppression,
    unconditionally, regardless of what that leading/"natural" text
    contains.
  - `src/orchestrator-v5/turn-executor.ts:5540` (`orientationForCompose = suppressOrientation ? '' : sanitisedOrientation.output`)
    — the suppressed orientation is discarded entirely, never reaching
    compose.
  - `src/orchestrator-v5/tools/handlers/explain-results.ts:6-13` (docstring,
    unchanged by this lane) confirms this is deliberate design, not a bug:
    *"the handler always owns the entire user-visible string. Sonnet's
    `answer_text` (carried inside the tool-call payload via
    `invocation.explanation`) is used verbatim when the side-band validator
    marked it valid; otherwise the deterministic fallback… The turn-executor
    forces `suppress_orientation: true` for explanation handlers, so
    Sonnet's pre-tool-call orientation never reaches the user."*

  **Verdict: the SCHEMA field (`action.explanation.answer_text`) wins today,
  unconditionally — the RUNTIME prompt's "natural text" framing does not
  describe what actually ships.** If Sonnet dutifully follows the v40
  RUNTIME instruction literally — writes the complete answer in its
  pre-tool-call leading text, but (having satisfied that instruction in its
  own reading) omits or under-fills `explanation.answer_text` in the tool
  call itself — the user receives the deterministic fallback (side-band
  validator stamps `answer_text_valid: false` on an absent/invalid
  `explanation.answer_text`), not Sonnet's authored leading text, which is
  discarded by the unconditional suppression above. The v40 diagnosis
  itself (`v5-explain-handler-diagnosis.md:120`) assumes the two are
  equivalent ("the contract was always 'Sonnet writes the full answer'"),
  but there is no code-level mechanism enforcing that a model's leading text
  and its `explanation.answer_text` tool argument contain the same content —
  they are independently generated fields within one completion. The wording
  mismatch is real; whether it has caused a live miss (Sonnet satisfying the
  RUNTIME instruction's letter via leading text while under-filling the tool
  field) is not established by this investigation — no reproduction was
  attempted here, out of this lane's scope.

- **Fix disposition:** NOT fixed in this lane. The fix is a served RUNTIME
  prompt-text edit (e.g. rewording the v40 instruction to say
  `explanation.answer_text` instead of "your natural text"), which is prompt
  CONTENT owned by the prompt-workstream via `staging_version`/PMS — not a
  one-liner within this CEE code lane's scope (this lane owns
  `tool-schema.ts`'s Zod refinement + `turn-executor.ts`'s compose guard for
  coach/converse only; `explain_*`'s existing schema/suppression mechanism
  is explicitly untouched, per the file:line trail above, and is already
  functioning as designed regardless of the prompt wording). **Filed here
  precisely** for the prompt-workstream to action: reword the v40 (or
  successor) `<RUNTIME>` Explanation block to name
  `explanation.answer_text` explicitly rather than "your natural text",
  removing the latent ambiguity.

## Tests (RED-first per behaviour claim)

- `src/orchestrator-v5/routing/__tests__/tool-schema-answer-text-required.test.ts`
  — layer A, Zod-schema-only: flag OFF accepts coach/converse with no/blank
  `answer_text` (byte-identical pin); flag ON rejects absent/blank
  `answer_text` on coach/converse (with the expected repair-message text),
  accepts non-blank; execute/clarify unaffected either way (still forbid a
  stray `answer_text`, still don't require one).
- `src/orchestrator-v5/routing/__tests__/route-with-tool-use-answer-text-repair.test.ts`
  — layer A, REPAIR_ONCE integration: coach/converse omission triggers
  exactly ONE repair call citing the omission, second success ships the
  repaired answer; second omission → `schema_repair_failed` after exactly 2
  calls; execute unaffected (single call); flag OFF → single call, no
  repair, byte-identical. Model-agnostic by construction — the suite only
  depends on the injected adapter's `chatWithTools` shape, never a specific
  model, so the same mechanism holds if the orchestrator model reverts to a
  gpt-4o-class model.
- `src/orchestrator-v5/__tests__/turn-executor-answer-text-compose-guard.test.ts`
  — layer B, full `runTurnExecutor` integration: flag-OFF regression pins
  document the KNOWN LIVE DEFECT (blank assistant_text ships unguarded);
  flag-ON proves a raw-non-blank-but-sanitises-to-empty `answer_text`
  degrades to the bounded-recovery response in a SINGLE LLM call (proving
  layer B is independent of layer A's repair mechanism); proves layer A + B
  cooperate correctly when `REPAIR_ONCE` successfully repairs; proves
  non-empty answers and orientation-only answers pass through unchanged with
  no telemetry; proves text-only converse (never empty by construction) never
  triggers the guard; checks the `v5.coaching.empty_answer_recovered`
  telemetry event shape (lengths only, asserts `answer_text`/`orientation_text`
  keys are absent from the payload).
- `src/orchestrator-v5/__tests__/turn-executor-answer-source-telemetry.test.ts`
  (fix-round addition) — `v5.coaching.answer_source`, the NOT-flag-gated
  measurement instrument: coach and tool-call-converse turns record
  `source: 'answer_text'` when the raw field is non-blank and
  `'orientation_fallback'` when it's absent, WITH THE FLAG OFF (default) —
  proving the instrument observes the current prompt-only world, not just a
  post-hardening one; text-only converse never emits it (no channel to pick);
  flag-ON case proves the instrument fires independently of the layer-B
  recovery event (raw pick vs. post-sanitise final-text check are two
  different signals, both correctly observable on the same turn).
- `tests/utils/telemetry-events.test.ts` — updated for two new frozen events:
  `V5CoachingEmptyAnswerRecovered: "v5.coaching.empty_answer_recovered"` and
  (fix-round addition) `V5CoachingAnswerSource: "v5.coaching.answer_source"`
  (enum snapshot, Datadog-alignment debug-only registration, and the
  spec-compliance frozen list; namespace regex already permits the
  `coaching` sub-namespace, no regex change needed).

## Gates

- `pnpm typecheck:src` — clean (0 errors introduced).
- `bash scripts/ci/typecheck-ratchet.sh` — 136 files / 462 errors (baseline
  137 files / 462 errors) — same pre-existing informational drift note as
  lane38 (`integration-precondition-fail-chip.test.ts` no-longer-erroring),
  unrelated to this change.
- Targeted vitest: `src/orchestrator-v5/routing/__tests__/` (all files),
  `tests/integration/phase1-behavioural.test.ts`,
  `tests/integration/phase1-routing-end-to-end.test.ts`,
  `tests/unit/v5.tool-schema.stability.test.ts`,
  `tests/unit/v5.route-with-tool-use.*.test.ts`,
  `tests/contract/v5-golden-path-acceptance.test.ts`,
  `src/orchestrator-v5/__tests__/turn-executor-answer-text-compose-guard.test.ts`,
  `src/orchestrator-v5/__tests__/turn-executor-reasoning-capture.test.ts`,
  `src/config/`, `tests/utils/telemetry-events.test.ts` →
  **56 files / 1710 passed, 1 skipped (pre-existing), 0 failed.**
- `bash scripts/validate-prepush.sh` — all checks passed.

## Scope boundary

Touches: `src/config/index.ts` (new flag), `src/orchestrator-v5/routing/tool-schema.ts`
(layer A), `src/orchestrator-v5/turn-executor.ts` (layer B + the extracted
`buildBoundedFallbackCopyAndChips` helper, refactored out of
`commitBoundedRoutingFallback` with no behaviour change; fix-round addition:
the `v5.coaching.answer_source` emit at both compose pick sites, NOT
flag-gated), `src/utils/telemetry.ts` (two new events, one from the fix
round), `tests/utils/telemetry-events.test.ts` (frozen-list updates), plus
the four new test files above.

Not touched: served RUNTIME prompt text (prompt-workstream's lane, per the
`explain_*` finding above), `explain_from_structure`/`explain_results`/
`what_would_flip` handler code or schema (their existing
`explanation.answer_text` mechanism is unrelated to coach/converse's
top-level `answer_text` and is left exactly as-is), `compose.ts`,
`registry.ts`, `PROGRAM-BOARD.md` (this lane's row to be added there
separately when the sequencing decision is made).
