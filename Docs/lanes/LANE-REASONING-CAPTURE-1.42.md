# Lane: CEE half of Sonnet-5 reasoning capture (ROADMAP 1.42)

Branch: `claude-cee/reasoning-capture` (worktree `.worktrees/cee-reasoning-capture-1.42`,
base `origin/staging` @ `df10edca9`).

## What

Adds a flag-gated capability to capture Sonnet-5's extended-thinking (`thinking`
content block) text **VERBATIM** — Paul's explicit ruling for 1.42, over the
alternative of summarising or redacting it — and thread it through CEE's
routing→turn-executor→route pipeline to a new `_reasoning` sidecar field on
the `/orchestrate/v2/turn` wire envelope, for the UI's future progressive-
disclosure surface (collapsed by default, explicitly labelled "Sonnet's
reasoning" or similar — a UI-side lane, not part of this CEE half).

New flag: `CEE_REASONING_CAPTURE_ENABLED` (default `false`). Flag-off is
byte-identical to the existing #385 drop+warn behaviour at every layer.

## Why

`ROADMAP.md` 1.42 calls for exposing the Sonnet-5 model's chain-of-thought to
build user trust in `run_analysis` / routing decisions, framed as progressive
disclosure ("show your working," collapsed by default). This is the CEE
producer half: capture the text from the Anthropic response and get it as far
as an additive wire field. The UI consumer half (collapsed-by-default render,
explicit "AI reasoning" label, expand affordance) is a separate lane.

## The seven changes (file:line references are to this branch's HEAD, not the
original planning commit `8cf918a8d` — staging moved to `df10edca9` between
plan verification and implementation; every line was re-verified locally)

1. **`src/config/index.ts`** — new flag `reasoningCaptureEnabled`
   (`CEE_REASONING_CAPTURE_ENABLED`, `booleanString.default(false)`) in the
   `features` schema block, plus the corresponding `env.CEE_REASONING_CAPTURE_ENABLED`
   mapping in `parseConfig()`.

2. **`src/adapters/llm/types.ts`** — `ChatWithToolsResult` gains an optional
   `reasoning?: string`. Deliberately **not** added to `ToolResponseBlock` /
   `content[]`: `content` is echoed back to Anthropic on the `REPAIR_ONCE`
   path (`route-with-tool-use.ts` `buildRepairMessages`) and its text blocks
   are joined into `orientationText`. Putting reasoning there would recreate
   the #385 signature leak AND risk a protocol-echo 400 (Anthropic requires a
   valid `signature` to replay a `thinking` block, which we never capture).

3. **`src/adapters/llm/anthropic.ts`** (the #385 mapper, `chatWithToolsAnthropic`)
   — when a content block is `type: 'thinking'` AND the flag is on, its
   `.thinking` text (never `.signature`) is pushed to a local
   `reasoningParts[]` array; the existing warn+drop path is otherwise
   unchanged (including for `redacted_thinking`, which is **always** dropped
   regardless of the flag — its `data` field is an opaque encrypted blob, not
   readable reasoning). The result carries `reasoning: parts.join('\n\n')`
   only when non-empty. Logs `reasoning_chars` count only, never content.
   Streaming path (`streamChatWithToolsAnthropic`) is untouched — V4-only,
   out of scope for the V5 routing capture.

4. **`src/orchestrator-v5/routing/route-with-tool-use.ts`** — no code change.
   `RoutingResult.rawResult: ChatWithToolsResult` already carries the new
   optional field through unchanged; verified `orientationText` /
   `text` (the text_only path) are derived solely from `result.content`'s
   text blocks, never from `rawResult.reasoning` — confirmed by the new
   regression tests in this lane.

5. **`src/orchestrator-v5/turn-executor.ts`** — `TurnExecutorRunResult` gains
   `reasoning?: string`. A `capturedReasoning` variable is declared in the
   function's **outer** scope (same level as `analysisReadyForTurn`,
   `effectiveTurnGraph`, etc.) — NOT inside the `try` block that also holds
   `routingResult`, because `finalizeRun()` is declared *outside* that `try`
   block and cannot see `let`-declarations scoped inside it (confirmed by
   `tsc`: an initial attempt to co-locate the declaration with `routingResult`
   failed to compile with "Cannot find name"). It is assigned immediately
   after the real LLM routing call (`routingResult.rawResult?.reasoning`) and
   surfaced on `finalizeRun()`'s return object. Never attached to `response`
   pre-egress — a strict-egress failure would otherwise fallback-envelope the
   whole turn, including the reasoning.

6. **`src/orchestrator/route-v2.ts`** — `sendFinalised200`'s `ctx` gains
   `readonly reasoning?: string`, threaded from `run.reasoning` at the
   `turn_executor` call site. `_reasoning` is attached to the wire body
   **after** `validateEgress` passes, using the same
   strip → validate → re-attach mechanic as `_context_summary` /
   `_diagnostic_trace` (spread onto `wireBody`, re-finalise for the
   `preSerialization` WeakSet brand), gated on
   `config.features.reasoningCaptureEnabled && ctx.reasoning`. Also added
   defensively to the pre-validation strip list (`delete cloned._reasoning`)
   even though no dispatch path body-attaches it today — same
   defence-in-depth posture as `_context_summary`. `sanitiseOlumiResponseForEgress`
   (`orchestrator-v5/compose/output-safety.ts:102`) spreads `{...response}`
   and only overwrites named product fields (`assistant_text`, `blocks`,
   `suggested_actions`, `insights`) — confirmed it passes an underscore-prefixed
   sidecar like `_reasoning` through untouched.

7. **`src/orchestrator/debug-fields.ts`** — `OlumiResponseWithDebugFields`
   intersection gains `readonly _reasoning?: string`, documented as a
   flag-gated **product** sidecar (not an operator diagnostic like its
   siblings) — pending formalisation as a named field on
   `@talchain/schemas` 0.15.0. The two-gate `X-Olumi-Debug` header model does
   NOT apply to it; it is intended to reach the client UI whenever the
   server-side flag is on.

## Flag

`CEE_REASONING_CAPTURE_ENABLED` — default `false` (dark-shipped). Off:
byte-identical to pre-1.42 drop+warn behaviour at every layer (adapter never
populates `reasoning`; route never attaches `_reasoning`). On: `thinking`
block text is captured verbatim and reaches the wire as `_reasoning` when the
turn produced one. **Enablement is Paul-gated** — this lane does not flip it
on staging or production.

## Risks — stated honestly

**VERBATIM reasoning bypasses CEE's egress claim-safety / forbidden-phrase
cage.** `enforceEgressForbiddenPhraseGuard` and `enforceStructuralSuccessClaimGuard`
(turn-executor's `finalizeRun`) run against `response.assistant_text` and the
product `content[]` — they were never designed to, and do not, inspect
`_reasoning`. A Sonnet-5 thinking block could in principle contain phrasing
the cage would have blocked in the product surface (a premature "done"
claim, a speculative causal claim not backed by the graph, etc.) and it would
reach the wire unfiltered. **This is by ruling, not oversight** — Paul's
explicit instruction for 1.42 was VERBATIM-with-label over a
summarise-or-redact alternative, on the reasoning that raw model reasoning is
inherently exploratory/provisional and mislabeling it as a vetted product
claim would be the actual honesty violation.

**Containment**, per the ruling, is therefore NOT a wire-level scrub. It is:
- **flag-default-off** — zero exposure until Paul explicitly enables it;
- **collapsed-by-default UI** (the consumer-side lane, not built here) — the
  user must actively expand to see it, distinguishing it from primary
  product prose at the point of consumption;
- **explicit label** — the UI must render it under a clear "model reasoning /
  not a verified claim" heading, never inline with `assistant_text`.

**Secondary risk**: the `signature` field is Anthropic's opaque replay token
for `thinking` blocks (needed only if you want to send a prior `thinking`
block back to the API, e.g. for extended multi-turn tool use with thinking
preserved). This capability never captures or stores `signature` — confirmed
by tests asserting it never appears in `JSON.stringify(result)`. This is a
deliberate scope-narrowing: CEE does not currently replay `thinking` blocks
back to Anthropic on any path, so there is no functional loss, and it removes
an entire class of accidental-replay / accidental-leak surface.

**Tertiary risk**: `redacted_thinking` blocks (Anthropic's own redaction of
thinking that trips its safety classifiers) are dropped unconditionally,
flag or no flag. Capturing them would be actively wrong — the `data` field is
an opaque encrypted blob, not text, and Anthropic redacts it precisely
because the underlying content should not be surfaced.

## Tests (RED-first where a behaviour claim is made)

- `tests/unit/anthropic.thinking.test.ts` (extends the #385 regression
  suite): flag ON → `reasoning` captured verbatim, `JSON.stringify(result)`
  contains no `signature` string, `content[]` still text+tool_use only, no
  `thinking` block, no reasoning text in `content`; flag ON + no thinking
  block → `reasoning` undefined; flag ON + `redacted_thinking` → always
  dropped, never captured; flag OFF (default) → byte-identical to the
  existing drop+warn behaviour (no `reasoning` key on the result at all).
- `src/orchestrator-v5/routing/__tests__/route-with-tool-use.test.ts`: proves
  `rawResult.reasoning` rides through both the `tool_call` and `text_only`
  paths unchanged, while `orientationText` / `text` (both derived solely from
  `content`) never contain it.
- `src/orchestrator-v5/__tests__/turn-executor-reasoning-capture.test.ts`:
  integration proof that `run.reasoning` is surfaced on the executor's
  return AND `response.assistant_text` never contains the reasoning text —
  the two are threaded via independent variables, never concatenated.
- `tests/integration/orchestrator/route-v2-reasoning-capture.test.ts`: flag
  OFF (default) → no `_reasoning` on the wire even when `run.reasoning` is
  present; flag ON + `run.reasoning` present → `_reasoning` attached verbatim
  post-egress-validation; flag ON + no `run.reasoning` → still absent (never
  fabricated); flag ON + egress validation failure (typed-fallback path) →
  the fallback envelope never carries `_reasoning`, even with an upstream
  body pre-attach the strip step must drop.

## Gates run

- `pnpm typecheck:src` — clean.
- `scripts/ci/typecheck-ratchet.sh` — within baseline (462 errors / 136-137
  files; pre-existing drift, unrelated to this lane).
- Targeted `vitest run` on all four new/extended test files plus the
  neighbouring `_context_summary` / `_diagnostic_trace` / canonical-state
  route-v2 suites (89 tests, all green) to confirm no regression to the
  existing debug-field re-attach machinery this lane rides on.
- Full pre-push hook runs on `git push` per repo convention.
