# Lane 38 (ROADMAP 1.38) — coach tool variant carries answer_text, stop dropping authored coaching answers

**Branch:** `claude-cee/coach-answer-body` (base: `origin/staging` @ `2a6f4128e`)
**Scope owned:** `src/orchestrator-v5/routing/tool-schema.ts` (coach + converse tool-call
variants), `src/orchestrator-v5/turn-executor.ts` (coach branch + the text_only/converse
compose branch), plus targeted tests in
`src/orchestrator-v5/routing/__tests__/tool-schema.test.ts` and
`tests/integration/phase1-behavioural.test.ts`.
**Not touched:** PMS / served prompt text (Brief I owns it — see note below),
`tools/orchestrator-eval`, `src/cee/draft/**`, `compose.ts`, `registry.ts`, the
explanation-handler answer channel (`action.explanation.answer_text`, unaffected —
execute/explanation turns were never broken by this defect).

## Mechanism (root cause, verified at tip `c49f5cc06` by the prompt-workstream)

Full handover: `/Users/paulslee/Documents/GitHub/orchestrator-prompt-workstream/TRUNCATION-BUG-HANDOVER.md`
(specimens, live evidence, verification hook).

- A coach classification requires Sonnet to **call** `olumi_action` (to set
  `intent_class: 'coach'`), so a coach turn is always a `tool_call`.
- The coach tool-call variant had **no answer-body field** —
  `tool-schema.ts:486` (pre-fix) returned only
  `{ intent_class: 'coach', coaching_mode }`. The `.strict()` Zod schema meant Sonnet
  could not smuggle a body onto a coach call even if it tried.
- Compose (`turn-executor.ts:5823`, pre-fix) could therefore only ship
  `sanitiseNarrateOutput(routingResult.orientationText)` — Sonnet's **pre-tool-call
  leading text**, documented as a brief "pre-action orientation" (`compose.ts:71-73`,
  `registry.ts:122-134`), never meant to carry the whole answer.
- Result: the fuller coaching answer Sonnet actually authored (~90-105 completion
  tokens in the live specimens) had nowhere to land and was silently dropped; only the
  one-sentence orientation shipped, reading as a plausible-but-hollow answer with no
  error signal.
- Same defect on **tool-call converse** (`tool-schema.ts:353-355` pre-fix — also
  body-less). **Text-only** converse and **execute/explanation** turns were unaffected
  (they already ship `.text` / `explanation.answer_text` respectively) — confirmed by
  grep across `sanitiseNarrateOutput`, `applyCoachingOutputGuard`,
  `composeDirectAnswerResponse`, and the registry/compose comments; no
  first-sentence-splitting logic exists anywhere on this path, so "truncation" was
  never a string-length bug — it was a missing schema field.

## Fix

1. **`tool-schema.ts`** — added an OPTIONAL top-level `answer_text` field to the
   `olumi_action` tool:
   - JSON schema (`OLUMI_ACTION_TOOL.input_schema.properties.answer_text`): a string
     property with a description instructing the model to place its FULL coaching or
     conversational answer there, explicitly warning that leading text is a brief
     orientation only. **This description is part of the tool definition (code), not
     served prompt text** — it is inside `TOOL_SCHEMA_DESCRIPTION` literals in a `.ts`
     file, so it is in-scope for this lane per the prompt-content boundary. Brief I may
     additionally reinforce "put the full answer in `answer_text`" prompt-side via
     `staging_version` if useful — that is their call, not made here.
   - `RawToolCallSchema` (Zod): `answer_text: z.string().optional()`, with the
     `superRefine` extended so `answer_text` is **forbidden** on `execute` and
     `clarify` (those already have `action.explanation.answer_text` /
     `clarification.question` respectively — mirrors the existing per-intent
     forbidden-field pattern in the file) and **permitted** on `coach` / `converse`.
   - `ToolCallResponse` type union: `answer_text?: string` added to the `coach` and
     `converse` variants only; `answer_text?: undefined` on `execute` / `clarify` for
     exhaustive-shape parity with the file's existing style.
   - `parseToolCallResponse`: threads `data.answer_text` through on the `coach` and
     `converse` branches.
   - **Optional by construction** — a coach/converse tool call with no `answer_text`
     remains valid; nothing about the wire contract became stricter for existing
     callers.

2. **`turn-executor.ts`** — the coach branch and the converse-tool-call sub-case of the
   final `else` branch now compute
   `routingResult.proposal.answer_text ?? routingResult.orientationText` and feed
   *that* through the **same** `sanitiseNarrateOutput` → chip-generation →
   `applyCoachingOutputGuard` → `composeDirectAnswerResponse` pipeline the orientation
   text used to go through — no bypass, no new guard path. Absent `answer_text` falls
   through to `orientationText` exactly as before (byte-identical pre-fix behaviour).

3. **Untouched on purpose:** `compose.ts` (`composeDirectAnswerResponse` /
   `composeClarifyResponse` just take a string — no signature change needed);
   `registry.ts` (explanation-handler orientation-suppression logic is
   execute-side and already correct); the R10 no-op clarification-preservation guard
   in `edit-graph-dispatch.ts` (a different code path — `edit_graph` dispatch, not
   routing/coach — confirmed unaffected by running
   `edit-graph-dispatch-clarification-preservation.test.ts`, all 3 tests pass
   unchanged).

## Tests (RED-first, per the brief)

- `src/orchestrator-v5/routing/__tests__/tool-schema.test.ts` — new
  `OLUMI_ACTION_TOOL top-level answer_text field (coach/converse)` describe block (8
  tests): declares an optional top-level string, not in `required`; parses
  coach/converse WITH `answer_text` (value preserved); parses coach/converse WITHOUT
  `answer_text` (undefined, backwards-compatible); rejects `execute` /
  `clarify` carrying `answer_text` (`/answer_text is forbidden/`).
- `tests/integration/phase1-behavioural.test.ts` — new
  `phase 1 behavioural — coach/converse answer_text channel (ROADMAP 1.38)` describe
  block (5 end-to-end `runTurnExecutor` tests):
  - coach tool call carrying `answer_text` → `response.assistant_text` ships the FULL
    authored answer, not the short `orientationText`.
  - coach tool call WITHOUT `answer_text` → byte-identical to pre-fix behaviour
    (`orientationText` ships) — this is the regression pin.
  - converse tool call carrying `answer_text` → ships the full answer.
  - converse tool call WITHOUT `answer_text` → byte-identical to pre-fix behaviour.
  - a guard-tripping coach `answer_text` (pseudo-XML tag contamination) is scrubbed by
    the SAME `sanitiseNarrateOutput` TAG_PATTERN behaviour every other narrate surface
    gets (tag markup stripped, inner text retained per house behaviour, contamination
    telemetry event fires) — proves the new channel runs through the guard, not around
    it.
- The pre-existing `intent_class="coach" is logged distinctly from "converse" on
  text-only turns` test (same file) already covered the "no `answer_text` in the tool
  call" shape and continues to pass unchanged — an independent confirmation that the
  fix is additive.
- `edit-graph-dispatch-clarification-preservation.test.ts` (the R10 trip-test named in
  the brief) — checked and confirmed **not applicable**: `R10` in this codebase is the
  `edit_graph` dispatch's no-op clarification-preservation rule
  (`edit-graph-dispatch.ts`), a different code path from coach/converse routing. Ran
  it anyway; all 3 tests pass unchanged.

## Gates

- `pnpm typecheck:src` — clean.
- `bash scripts/ci/typecheck-ratchet.sh` — `136 files / 462 errors` (baseline `137 /
  462`); the informational 136-vs-137 file-count drift is the pre-existing
  `integration-precondition-fail-chip.test.ts` no-longer-erroring note, unrelated to
  this change (matches the brief's documented note).
- Targeted vitest: `src/orchestrator-v5/routing/__tests__/` (all files),
  `tests/integration/phase1-behavioural.test.ts`,
  `tests/integration/phase1-routing-end-to-end.test.ts`,
  `tests/integration/phase1.5-*.test.ts`,
  `tests/integration/v5-explain-then-yes-flagship.test.ts`,
  `tests/unit/v5.tool-schema.stability.test.ts`,
  `tests/unit/v5.route-with-tool-use.*.test.ts`,
  `tests/contract/v5-golden-path-acceptance.test.ts` →
  **52 files / 1673 passed / 3 skipped (pre-existing skips), 0 failed.**
- No new telemetry event names — only an additive optional field threaded through the
  existing `turn_executor.contamination_narrate` payload shape (still `raw_length` /
  `sanitised_length` / `turn_class`, values only, no new discriminators). Frozen
  telemetry registry respected.

## What Brief I (prompt workstream) may add

The handover's fast-mitigation layer ("prompt can instruct the model to put the full
answer in leading text") is no longer needed as a stopgap once this schema fix ships —
`answer_text` is now the correct, durable channel. Brief I may still choose to
reinforce, prompt-side via `staging_version`, that coach/converse tool calls should
populate `answer_text` with the complete answer (the tool schema's field description
already carries this instruction at the code layer; a prompt-side nudge is additive,
not required for the fix to work).
