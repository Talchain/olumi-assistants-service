/**
 * Provider-independent draft budget + terminal-completion policy (ROADMAP 2.90).
 *
 * ONE seam for the two things every draft path — Anthropic AND OpenAI — must get
 * right, hoisted here so neither adapter can drift from the other:
 *
 *  1. AFFORDABILITY DERIVATION (`resolveDraftMaxTokens`) — the effective
 *     max_tokens is DERIVED from the call-site timeout and can NEVER exceed what
 *     the timeout affords (`getAffordableDraftTokens`, config/timeouts.ts). This
 *     is the mechanism that closed the 2026-07-20 draft outage on the Anthropic
 *     path; the OpenAI path used to send the raw configured value or NO cap at
 *     all (Codex #9), so a runaway OpenAI generation could hang to the timeout
 *     exactly as the Anthropic one did before #585.
 *
 *  2. TERMINAL-COMPLETION POLICY (`isDraftTruncated`) — a normalised truncation
 *     signal across providers (Anthropic `stop_reason === "max_tokens"`, OpenAI
 *     `finish_reason === "length"`). Both paths flag it, log it loudly, accept
 *     the draft if the truncated text still parses+validates, and otherwise
 *     throw a truncation-TYPED error rather than a generic non-JSON one.
 *
 *  3. THINKING CLAMP (`resolveDraftThinking`) — Anthropic-only (OpenAI draft has
 *     no extended thinking). When extended thinking is enabled, the TOTAL
 *     request (thinking budget + reserved visible output) must fit the affordable
 *     envelope. Before 2.90 the adapter RAISED max_tokens to `budget + 1024`
 *     whenever the thinking budget forced it — which could exceed affordability,
 *     warn-but-continue, and thereby RESURRECT the exact unaffordable budget the
 *     outage fix removed (Codex #8: default `CEE_DRAFT_GRAPH_THINKING_BUDGET`
 *     10000 + 1024 = 11024 > affordable ~8550). The clamp reduces the thinking
 *     budget instead, so the effective request is provably ≤ affordable.
 *
 *  4. RUNAWAY DETECTION PRIMITIVES — the thresholds and the per-string-value
 *     scanner the streamed Anthropic draft loop consults. All DERIVED from live
 *     corpora in config/timeouts.ts, each with a fail-loud module-load pin, so a
 *     threshold cannot silently become one that never fires (or one that
 *     false-aborts).
 *
 *  5. THE FAILED-CALL `_llm_meta` BUILDER (`buildFailedCallLlmMeta`) — one shape
 *     for every failure route on every provider. It was hand-written four times
 *     and the copies drifted; see the note at the function.
 *
 * NONE of these constants are env-gated (no new flags): affordability is derived
 * from config/timeouts.ts, the clamp is arithmetic over the derived affordable
 * value, and the truncation signal is a provider fact.
 */

import {
  getAffordableDraftTokens,
  DRAFT_LLM_TIMEOUT_MS,
  DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S,
  DRAFT_TTFB_SAFETY_OVERHEAD_S,
  OBSERVED_MAX_HEALTHY_TIME_TO_EDGES_MS,
  OBSERVED_MAX_HEALTHY_DRAFT_STRING_CHARS,
  DRAFT_STRING_RUN_HEADROOM_FACTOR,
  isRunawayRetryAffordable,
  viableRunawayRetryFloorTokens,
} from "../../config/timeouts.js";
import { getMaxTokensFromConfig } from "./router.js";
import { DRAFT_ATTACHMENT_MAX_BYTES } from "./draft-attachment.js";

// Guard floor for an EXPLICITLY-configured draft max_tokens set too low —
// a complex 15-node graph with coaching, causal claims, and goal constraints
// can exceed 4096 tokens. The floor is capped at the affordable budget in
// `resolveDraftMaxTokens`: a floor ABOVE what the timeout affords was the
// exact 2026-07-20 outage defect (8,192 tokens needed 115s against a 105s
// timeout, so long generations hung to the cap instead of completing).
// The former hand-set default of 16,384 is GONE: when CEE_MAX_TOKENS_DRAFT
// is unset, the budget is derived from the timeout instead of mirrored from
// what the model could theoretically emit.
export const DRAFT_MAX_TOKENS_FLOOR = 8192;

/**
 * Visible-output tokens reserved ABOVE the extended-thinking budget so the draft
 * can still emit a real answer after thinking. Mirrors — and satisfies — the
 * Anthropic API constraint that max_tokens must be strictly greater than the
 * thinking budget_tokens, with a usable (not just +1) margin for the JSON graph.
 */
export const MIN_DRAFT_VISIBLE_OUTPUT_TOKENS = 1024;

/**
 * Anthropic's minimum accepted extended-thinking budget. If the affordable
 * budget cannot fit this plus the reserved visible output, thinking cannot run
 * within the timeout at all and is disabled (loudly) rather than forcing the
 * request past affordability.
 */
export const ANTHROPIC_MIN_THINKING_BUDGET_TOKENS = 1024;

/**
 * Resolve the draft max_tokens for a call that will be aborted at `timeoutMs`.
 *
 * THE mechanism that closes the 2026-07-20 draft-outage arithmetic: the
 * effective token budget is DERIVED from the timeout at the call site — the
 * one place both values are visible — and can never exceed what the timeout
 * affords (`getAffordableDraftTokens`, conservative constants documented in
 * `config/timeouts.ts`). A runaway generation now returns at the token cap
 * (truncation-typed handling in each adapter) instead of hanging to the
 * timeout and 504ing.
 *
 * - unconfigured: effective = affordable — the timeout-derived budget from
 *   `getAffordableDraftTokens(timeoutMs)` (config/timeouts.ts), computed from the
 *   throughput floor and TTFB overhead, NOT a hand-set number (illustrative:
 *   ~8,550 tokens at the default LLM window — recompute from config, do not pin)
 * - configured too low: raised to min(DRAFT_MAX_TOKENS_FLOOR, affordable)
 * - configured too high: clamped down to affordable
 *
 * `ceilingTokens` (optional) is the caller-supplied "runaway sentinel" (#609) —
 * an upper bound applied AFTER all of the above. It can only ever LOWER the
 * effective budget (a `Math.min`), never raise it past what the timeout affords,
 * so the #585 max_tokens/timeout coherence guarantee is preserved: a ceiling
 * above `affordable` is a no-op, and one below it makes the runaway class
 * truncate earlier (lean-retry reachability, 2026-07-21). Absent → no cap. The
 * parameter travels WITH the function into this hoisted seam (ROADMAP 2.90): the
 * attempt-1 sentinel is threaded from parse.ts through the Anthropic draft call's
 * `maxTokensCeiling` opt to here, and dropping it would silently no-op the cap.
 *
 * Consumed by both the Anthropic and OpenAI draft paths (the OpenAI path passes
 * no ceiling), and by the boot-time affordability assertion + value tests.
 */
export function resolveDraftMaxTokens(timeoutMs: number, ceilingTokens?: number): {
  configured: number | null;
  affordable: number;
  effective: number;
} {
  // Anthropic requires max_tokens >= 1; a degenerate timeout still needs an
  // API-valid request (it will fail fast on time, not on a 400).
  const affordable = Math.max(1, getAffordableDraftTokens(timeoutMs));
  const configured = getMaxTokensFromConfig("draft_graph") ?? null;
  // Apply the runaway sentinel LAST and only downward — never below 1 (API
  // requires max_tokens >= 1) and never as an upward override of affordability.
  const applyCeiling = (n: number): number =>
    typeof ceilingTokens === "number" && ceilingTokens > 0
      ? Math.max(1, Math.min(n, ceilingTokens))
      : n;
  if (configured === null) {
    return { configured, affordable, effective: applyCeiling(affordable) };
  }
  const floor = Math.min(DRAFT_MAX_TOKENS_FLOOR, affordable);
  return {
    configured,
    affordable,
    effective: applyCeiling(Math.min(Math.max(configured, floor), affordable)),
  };
}

/**
 * Result of clamping the extended-thinking budget to the affordable envelope.
 */
export interface ResolvedDraftThinking {
  /** Whether extended thinking should be sent on the call (false if unaffordable). */
  enabled: boolean;
  /** The (possibly clamped) thinking budget to send. 0 when disabled. */
  budget: number;
  /** The effective max_tokens — GUARANTEED ≤ affordable and > budget when enabled. */
  maxTokens: number;
  /** True when the requested budget was reduced to fit affordability. */
  clamped: boolean;
  /** True when thinking was turned off because affordability can't fit even the minimum. */
  disabled: boolean;
}

/**
 * THINKING CLAMP (Codex #8). Given the operator-requested thinking budget and
 * the affordable/derived token budgets, produce an effective thinking budget +
 * max_tokens whose TOTAL never exceeds `affordable`.
 *
 * Invariants (asserted by tests, recomputed not restated):
 *  - `maxTokens <= affordable` ALWAYS (the outage arithmetic stays impossible)
 *  - when `enabled`, `maxTokens > budget` (Anthropic's API constraint)
 *  - when the affordable budget cannot fit `ANTHROPIC_MIN_THINKING_BUDGET_TOKENS`
 *    plus `MIN_DRAFT_VISIBLE_OUTPUT_TOKENS`, thinking is `disabled` rather than
 *    forced past affordability
 *
 * @param requestedBudget the operator's CEE_DRAFT_GRAPH_THINKING_BUDGET
 * @param affordable the timeout-derived affordable token budget
 * @param derivedMaxTokens the effective max_tokens from `resolveDraftMaxTokens`
 *   (already ≤ affordable) for the non-thinking case
 */
export function resolveDraftThinking(params: {
  requestedBudget: number;
  affordable: number;
  derivedMaxTokens: number;
}): ResolvedDraftThinking {
  const { requestedBudget, affordable, derivedMaxTokens } = params;

  // The largest thinking budget that still leaves reserved visible output within
  // the affordable envelope.
  const maxThinkingBudget = affordable - MIN_DRAFT_VISIBLE_OUTPUT_TOKENS;

  // Affordable is too small to fit even the minimum thinking budget plus a real
  // answer — thinking cannot complete inside the timeout, so disable it entirely
  // rather than shipping an unaffordable request. derivedMaxTokens (≤ affordable)
  // is used for the plain, thinking-off call.
  if (maxThinkingBudget < ANTHROPIC_MIN_THINKING_BUDGET_TOKENS) {
    return {
      enabled: false,
      budget: 0,
      maxTokens: derivedMaxTokens,
      clamped: false,
      disabled: true,
    };
  }

  let budget = requestedBudget;
  let clamped = false;
  if (budget > maxThinkingBudget) {
    budget = maxThinkingBudget;
    clamped = true;
  }

  // max_tokens must exceed the thinking budget; raise from the derived value only
  // as far as budget + reserved output — which is ≤ affordable by construction
  // (budget ≤ affordable - reserved), so the total request never exceeds
  // affordability.
  let maxTokens = derivedMaxTokens;
  const minMaxTokens = budget + MIN_DRAFT_VISIBLE_OUTPUT_TOKENS;
  if (minMaxTokens > maxTokens) {
    maxTokens = minMaxTokens;
  }

  return { enabled: true, budget, maxTokens, clamped, disabled: false };
}

/**
 * Boot assertion (the thinking half of the 2026-07-20 "never again", Codex #8):
 * an ENABLED extended-thinking budget the derived timeout cannot afford is the
 * config that RESURRECTS the outage arithmetic — the pre-2.90 adapter raised
 * max_tokens to `budget + reserved` and hung long drafts to the timeout. Returns
 * error strings for `server.ts` to log at ERROR (the runtime clamp is the real
 * guard — `resolveDraftThinking` — so this fires-but-continues, mirroring
 * `validateDraftTokenAffordability`). BOTH compared values are DERIVED from live
 * config (the caller injects the resolved CEE_DRAFT_GRAPH_THINKING[_BUDGET]; the
 * affordable budget is recomputed from DRAFT_LLM_TIMEOUT_MS here) — never restated.
 *
 * Fires only when thinking is enabled AND `budgetTokens + MIN_DRAFT_VISIBLE_OUTPUT_TOKENS`
 * exceeds the affordable draft budget.
 */
export function validateDraftThinkingAffordability(
  enabled: boolean,
  budgetTokens: number,
): string[] {
  const errors: string[] = [];
  if (!enabled) return errors;
  const affordable = getAffordableDraftTokens(DRAFT_LLM_TIMEOUT_MS);
  const maxAffordableBudget = affordable - MIN_DRAFT_VISIBLE_OUTPUT_TOKENS;
  if (budgetTokens > maxAffordableBudget) {
    errors.push(
      `CEE_DRAFT_GRAPH_THINKING is enabled with a thinking budget of ${budgetTokens} tokens, but the affordable ` +
      `draft budget derived from DRAFT_LLM_TIMEOUT_MS (${DRAFT_LLM_TIMEOUT_MS}ms) is ${affordable} tokens — the ` +
      `thinking budget plus the ${MIN_DRAFT_VISIBLE_OUTPUT_TOKENS}-token minimum visible output ` +
      `(${budgetTokens + MIN_DRAFT_VISIBLE_OUTPUT_TOKENS}) exceeds it. A draft asked to think for more tokens than ` +
      `the timeout affords HANGS to the cap and 504s (2026-07-20 outage class, Codex #8). The runtime clamps the ` +
      `thinking budget to ${Math.max(0, maxAffordableBudget)} tokens (or disables thinking when that is below the ` +
      `${ANTHROPIC_MIN_THINKING_BUDGET_TOKENS}-token minimum); lower CEE_DRAFT_GRAPH_THINKING_BUDGET or raise ` +
      `DRAFT_REQUEST_BUDGET_MS.`,
    );
  }
  return errors;
}

/**
 * TERMINAL-COMPLETION POLICY — normalise a provider finish signal into "the
 * generation was cut at the token cap". Anthropic reports `stop_reason:
 * "max_tokens"`, OpenAI reports `finish_reason: "length"`. Both mean the draft
 * ran into the derived token budget and the tail may be unparseable; each
 * adapter accepts a still-parseable truncated draft and otherwise throws a
 * truncation-TYPED error (`truncated_at_max_tokens: true`) rather than a generic
 * non-JSON one.
 */
export function isDraftTruncated(finishSignal: string | null | undefined): boolean {
  return finishSignal === "max_tokens" || finishSignal === "length";
}

// ── EARLY RUNAWAY DETECTION (Lane C, 2026-07-23; PROGRESS-AWARE recalibration
//    DETECTOR-FIX, 2026-07-24, ROADMAP 1.205(a)) ───────────────────────────────
// The residual draft-failure class after the wave-1 demand-reduction contract
// (WAVE1-DRAFT-BUILD anatomy): a generation that cuts INSIDE the `nodes` array
// with ZERO edges emitted, burning the full ~8550-token budget over ~82-91s.
// On the NON-streaming call, that one doomed attempt consumes the whole ~110s
// window, so there is no budget left to retry. Streaming the draft call lets
// the Anthropic adapter detect the runaway EARLY — while the model is still in
// the nodes array long past when every healthy draft has finished — abort the
// doomed attempt, and retry a fresh generation within the remaining budget.
//
// The discriminator is STRUCTURAL, not a magic token count: every healthy draft
// reaches the `edges` array (26-43 edges; every edge object carries `"from":`),
// every runaway emits 0 edges (measureTruncatedDraftAnatomy over 4 live 400s).
// So "runaway" == "still in nodes (no `"from":` seen) past a derived deadline".
//
// ⚠ CORPUS RECALIBRATED (DETECTOR-FIX, 2026-07-24). The F4 live adjudication
// (hunter-draft.md §F4) proved the day-1 corpus was STALE and the old blanket
// 20s time gate was aborting HEALTHY drafts. FRESH live distribution,
// `cee.llm.draft_edges_reached` n=16 over 3h on cee-staging (tip 5d9afbb0,
// structured_outputs=true, claude-sonnet-4-6, prompt v195):
//   - healthy time-to-edges:  min 12.4s · p50 15.4s · p90 19.3s · p100 19.57s
//     (25% ≥18s; 4/16 ≥19s — the slow-healthy tail now BRUSHES a 20s gate,
//      431ms margin). The old "healthy max 15.4s (n=10)" was stale by ~4.2s.
//   - healthy nodes-section serialized chars:  4141 – 7078 (edges reached at
//     4082-4820; direct false-abort captures at 5178/5334/7012/7078 chars were
//     actively-generating drafts KILLED at the old 20s wall before `"from":`).
//   - runaway:  8550 tok, 0 edges, 82-91s, visible output 9526-23281 chars.
//
// THE FIX (root-cause, NOT "bump the number"): the wall-clock gate cannot tell
// "slower/heavier generation" from "runaway", so it is made PROGRESS-AWARE.
// A no-edges stream is a runaway only when it is ALSO not making forward
// progress (stalled) OR has ballooned past the char budget OR has blown the
// absolute ceiling — an actively-emitting draft still advancing through nodes at
// 19s is NOT clipped. Three orthogonal signals, no single one trusted (the
// progress signal alone is spoofable by a runaway that keeps emitting — it is
// backstopped by the char gate and the hard ceiling):
//
// NONE of these are env-gated (no new flags; the streamed abort-retry ships ON,
// rollback = code revert — consistent with the rest of this seam).

// STALL-CHECK deadline: the point after which a no-edges stream that has made NO
// forward progress (see DRAFT_RUNAWAY_STALL_MS) is judged a silent runaway. This
// is NO LONGER a blanket abort (the 2026-07-24 false-abort defect) — a draft
// actively emitting deltas past this point is left to run to the hard ceiling
// (below), which sits comfortably above the live healthy p100. Kept at 20s: it
// is only the moment stall-checking begins, and every healthy draft either has
// reached edges by 19.57s (cancelling detection) or is still emitting (not
// stalled), so 20s never clips a healthy draft under the progress gate.
export const DRAFT_RUNAWAY_DETECT_MS = 20_000;

// Silent-thrash discriminator: a no-edges stream that has emitted NO new text
// for this long is a constrained-decode thrash burning wall-clock, not a healthy
// generation (real streams emit tokens continuously every ~50-200ms; no healthy
// draft pauses whole seconds mid-stream). Set generously (8s ≫ any healthy
// inter-delta gap) so it NEVER trips a progressing draft; the hard ceiling is
// the ultimate backstop, so a conservative value here costs only detection
// latency, never a false abort. Checked at DRAFT_RUNAWAY_DETECT_MS and again at
// the ceiling.
export const DRAFT_RUNAWAY_STALL_MS = 8_000;

// ABSOLUTE per-attempt no-edges ceiling — the pure-time backstop that bounds
// every abortable attempt (so the retry-budget arithmetic in the adapter has a
// hard upper limit on time consumed before an abort).
//
// ⭐ RE-DERIVED 30,000 -> 25,000 (FAST-ABORT, 2026-07-25). Read the history
// before touching this: the blanket 20s gate was REVERTED on 2026-07-24 for
// false-aborting the slow-healthy tail, and 30s was chosen as that corpus's
// p100 (19,570 ms) + ~10.4s. The pooled live evidence is now:
//
//   healthy time-to-edges p100 = 21,258 ms   (OBSERVED_MAX_HEALTHY_TIME_TO_EDGES_MS,
//                                             pooled n=28 over both live corpora)
//   runaway  time-to-edges     = NEVER reached, 17/17, at ceilings of 8,550 /
//                                12,000 / 16,000 tokens over 73-140s
//
// so 25,000 ms clears everything ever measured by 3,742 ms (+17.6%) and still
// catches 17/17 runaways — the populations do not overlap at all, they are
// separated by "reached edges at all", not by a rate.
//
// WHY A THINNER MARGIN IS CORRECT NOW, AND WAS NOT IN JULY. On 2026-07-24 a
// false abort was FATAL: the yardstick bug (see config/timeouts.ts) meant the
// post-abort attempt was funded at ~3,150 tokens and failed by construction, so
// every false abort destroyed a request. With the yardstick corrected a false
// abort costs 25s and buys a properly-funded 6,300-token retry. That changes
// what the margin is protecting against, and the arithmetic then favours 25s:
// at 25s the 110s window funds THREE attempts, at 30s only TWO. At the measured
// per-attempt success rate (13/30 = 0.433) that is ~0.80 vs ~0.68 — and 25s
// still wins even if a fifth of healthy drafts were false-aborted (~0.72).
//
// Do NOT lower this below OBSERVED_MAX_HEALTHY_TIME_TO_EDGES_MS; the pin in
// `__tests__/draft-fast-abort-yardstick.test.ts` fails loud if anyone does.
export const DRAFT_RUNAWAY_HARD_CEILING_MS = 25_000;

// Char budget: max healthy nodes-section = 7078 chars (fresh); runaway visible
// minimum = 9526 chars. 8000 sits above the healthy max (+13%) and below the
// runaway min (-16%), catching a TEXT-heavy (ballooning) runaway independent of
// wall-clock. Gated on "no edges yet", so it only ever fires while still in the
// nodes array. This is the signal that catches a runaway which keeps emitting
// (and so is NOT stalled) before it can blow the hard ceiling.
export const DRAFT_RUNAWAY_DETECT_CHARS = 8_000;

// ── ATTACHMENT-AWARE DETECTOR ALLOWANCE (FINAL-SWEEP, 2026-07-24; Codex F-3) ──
// Every threshold above was fitted on a NO-DOC corpus (the native doc-attach
// feature did not exist when they were measured). #670/#671 then made a native
// document the PRIMARY draft path WITHOUT touching them. A document inflates the
// input side two ways the no-doc thresholds don't model:
//   • TTFB / prompt-processing — the fixed no-doc component is already ~13.26s
//     (timeouts.ts); a 512KB doc adds parse + processing on top, pushing time-to-
//     edges past the 30s ceiling and the 20s stall deadline (→ false abort).
//   • Doc-grounded prose volume — richer node descriptions before the first edge
//     can cross the 8000-char gate (only +13% over the no-doc healthy max).
// Both are proportional to the document's SIZE, which is known at request time
// (meta.bytes, capped at DRAFT_ATTACHMENT_MAX_BYTES). Derive a BOUNDED allowance,
// scaled linearly by size, added to the detect/stall/ceiling deadlines + the char
// gate. Bounded so a genuine runaway WITH a document still dies within a fixed
// extra budget (ceiling+MS_MAX / chars+CHARS_MAX at the cap), never indefinitely.
export const DRAFT_ATTACHMENT_DETECT_ALLOWANCE_MS_MAX = 20_000;
export const DRAFT_ATTACHMENT_DETECT_ALLOWANCE_CHARS_MAX = 4_000;

export function draftAttachmentDetectorAllowance(attachmentBytes: number | undefined): {
  readonly extraMs: number;
  readonly extraChars: number;
} {
  if (typeof attachmentBytes !== "number" || !Number.isFinite(attachmentBytes) || attachmentBytes <= 0) {
    return { extraMs: 0, extraChars: 0 };
  }
  // Fraction of the max-size document (clamped at 1.0 — the parse layer already
  // rejects > DRAFT_ATTACHMENT_MAX_BYTES; this is a belt-and-suspenders clamp).
  const sizeFraction = Math.min(1, attachmentBytes / DRAFT_ATTACHMENT_MAX_BYTES);
  return {
    extraMs: Math.round(sizeFraction * DRAFT_ATTACHMENT_DETECT_ALLOWANCE_MS_MAX),
    extraChars: Math.round(sizeFraction * DRAFT_ATTACHMENT_DETECT_ALLOWANCE_CHARS_MAX),
  };
}

// DRIFT TRIPWIRE (the alarm that was MISSING on 2026-07-24). A RISING rate of
// these WARNs is the early signal that the live p100 is creeping toward the
// ceiling and the corpus is drifting — surfaced BEFORE it becomes a false-abort.
//
// ⭐ RE-ANCHORED (FAST-ABORT, 2026-07-25) — a direct consequence of lowering the
// ceiling, not a separate change. It used to be `0.6 × HARD_CEILING`. At a
// 25,000 ms ceiling that is 15,000 ms, which is BELOW the healthy p50 (15.4s):
// the tripwire would have WARNed on more than half of all healthy drafts and
// become precisely the alarm-everyone-learns-to-ignore this estate keeps
// hunting. Anchored instead to the pooled observed healthy p100 — "this draft
// took longer to reach edges than anything ever measured, and is eating the
// ceiling's margin". Still derived from live measurement (one constant, one
// home, in config/timeouts.ts), still strictly below the ceiling so it warns
// before it aborts, and it fires on 1 of the 12 corpus drafts rather than 7.
export const DRAFT_RUNAWAY_DRIFT_WARN_MS = OBSERVED_MAX_HEALTHY_TIME_TO_EDGES_MS;

// Fail-loud coherence pin: a tripwire at or past the ceiling can never warn
// before the abort it is supposed to pre-empt. Asserted at module load so a
// future edit to either constant cannot silently produce a dead alarm.
if (DRAFT_RUNAWAY_DRIFT_WARN_MS >= DRAFT_RUNAWAY_HARD_CEILING_MS) {
  throw new Error(
    `draft-budget: DRAFT_RUNAWAY_DRIFT_WARN_MS (${DRAFT_RUNAWAY_DRIFT_WARN_MS}ms) must be strictly below ` +
    `DRAFT_RUNAWAY_HARD_CEILING_MS (${DRAFT_RUNAWAY_HARD_CEILING_MS}ms) — a drift alarm that cannot fire ` +
    `before the abort it warns about is a dead alarm.`,
  );
}

// Fail-loud corpus pin: the abort ceiling must sit ABOVE the slowest healthy
// draft ever measured. A ceiling below it aborts healthy generations — the exact
// defect that got the blanket 20s gate reverted on 2026-07-24.
if (DRAFT_RUNAWAY_HARD_CEILING_MS <= OBSERVED_MAX_HEALTHY_TIME_TO_EDGES_MS) {
  throw new Error(
    `draft-budget: DRAFT_RUNAWAY_HARD_CEILING_MS (${DRAFT_RUNAWAY_HARD_CEILING_MS}ms) must exceed the slowest ` +
    `healthy time-to-edges ever observed (${OBSERVED_MAX_HEALTHY_TIME_TO_EDGES_MS}ms) — a lower ceiling ` +
    `false-aborts healthy drafts (2026-07-24 revert class).`,
  );
}

/**
 * Drift tripwire predicate: is this healthy draft's time-to-edges deep enough
 * into the slow tail to warrant a drift WARN? Pure + derived (live measurement
 * vs the ceiling-anchored threshold), never a hand-maintained list — so it fails
 * loud on real drift and cannot rot into a false-green mirror.
 */
export function isEdgesTimeDrifting(timeToEdgesMs: number | null | undefined): boolean {
  return typeof timeToEdgesMs === "number" && timeToEdgesMs >= DRAFT_RUNAWAY_DRIFT_WARN_MS;
}

// Defensive backstop on the number of runaway retries (independent of the
// budget guard): the budget guard alone terminates the loop only because real
// streaming consumes wall-clock, so a pathological provider that returned an
// instant char-gate runaway every time (0ms elapsed) could otherwise spin. On
// hitting this cap the next attempt runs to the full remaining budget with no
// early abort (final-attempt semantics), so the loop always terminates. In the
// real budget this cap never binds (only ~3 attempts fit the ~110s window).
export const DRAFT_MAX_RUNAWAY_RETRIES = 5;

// ---------------------------------------------------------------------------
// ⭐ THE RUNAWAY RETRY MUST BE ABLE TO DIFFER (F3, 2026-07-25)
//
// THE DEFECT. `anthropicTemperatureFor(model, { thinking: false })` returns
// `opts.requested ?? 0`, and the draft supplies no requested value — so every
// draft attempt, including every post-abort retry, was sent at temperature 0.
// A retry that re-sends a byte-identical request to a near-deterministic decode
// is not a re-roll; it is the same generation again. The whole cost model the
// abort-and-retry mechanism is justified by ("a false abort costs 25s and buys a
// properly-funded retry") assumes the retry can produce something different.
// Confirmed on the wire 2026-07-25: deployed staging reports `temperature: 0` on
// `trace.pipeline.llm_metadata`.
//
// WHY 1, AND WHY THIS IS NOT A MAGIC NUMBER.
//  1. The pathology being escaped is a DEGENERATE REPETITION LOOP — U+200B runs,
//     a repeated phrase, "← display only.  " over and over (10/10 characterised
//     runaways). Greedy/low-temperature decoding is what gets STUCK in those;
//     raising temperature is the standard escape, not a gamble.
//  2. It is not a new value on this path. The draft call already sends
//     temperature 1 whenever extended thinking is enabled — the API requires it —
//     so temperature-1 drafting is a configuration this service already ships.
//  3. Anthropic's range is 0-1, so this is "maximally decorrelated from the
//     attempt that just failed", which is exactly the property a retry needs.
//
// ⭐ BLAST RADIUS IS EXACTLY THE POPULATION THAT IS OTHERWISE DOOMED. It applies
// only to attempts made AFTER a runaway abort. The first attempt of every
// request is byte-identical to before, and the healthy population — all 30 live
// observations carried `runaway_abort_count: 0` — never sees it.
//
// Routed through `anthropicTemperatureFor` at the call site, so a model that
// rejects sampling params still gets NO temperature field: this cannot become a
// sixth hand-copy of that gate.
export const DRAFT_RUNAWAY_RETRY_TEMPERATURE = 1;

// Stop early-aborting once the remaining budget is below HARD_CEILING_MS + this:
// the FINAL attempt then runs to the full remaining window with NO early abort,
// so a late-but-legitimate completion is never discarded and the existing
// salvage (closeTruncatedJson) still applies to a natural max_tokens truncation.
//
// ⚠ RECONCILED TO THE SKIP-GATE FLOOR (FINAL-SWEEP, 2026-07-24; Codex F-4). This
// value is now DERIVED, not a hand-typed 35s, because the retry-authorization
// (`hasRoomForAnotherAbortableAttempt`, reserving HARD_CEILING_MS + this) and the
// final-attempt SKIP-GATE were contradicting each other. `canRetryAgain` reserved
// only 35s, promising a post-abort final ≥ 35s; but the skip-gate refuses any
// final that affords fewer than LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR (2,700) tokens,
// which in time is (2700/90 + 15s) = 45s. So an abort landing the final window in
// [35s, 45s) was AUTHORIZED by canRetryAgain and then REFUSED by the skip-gate —
// converting a single (possibly false) abort into a total request failure with
// budget unspent. Deriving this from the SAME primitives the skip-gate's token
// floor uses (LEAN floor / throughput-floor + TTFB overhead) makes the two agree
// BY CONSTRUCTION: an abort is authorized only when its promised final window can
// actually afford a converged graph. It tracks the floor automatically if any of
// those primitives change (derive, never mirror).
//
// ⭐ RE-DERIVED (FAST-ABORT, 2026-07-25). The token floor the two gates check has
// moved from LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR (2,700) to
// viableRunawayRetryFloorTokens() (3,581 — the evidence-derived requirement for a
// SUCCESSFUL draft, see config/timeouts.ts), so this time-domain twin MUST move
// with it. Leaving it at the 45,000ms the old floor implied would re-open the
// #673 contradiction one rung along: a post-abort window in [45.0s, 54.79s) would
// be AUTHORIZED by this reserve and then REFUSED by the gate. Evaluates to
// 54,789ms today.
export const DRAFT_RUNAWAY_MIN_RETRY_MS = Math.ceil(
  (viableRunawayRetryFloorTokens() / DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S +
    DRAFT_TTFB_SAFETY_OVERHEAD_S) *
    1000,
);

/**
 * Shared retry-reserve predicate (FINAL-SWEEP, 2026-07-24; Codex F-4 + quality
 * F1). TRUE when the remaining budget has room for a full ABORTABLE attempt (one
 * that, under progress-aware detection, may consume up to the HARD CEILING before
 * aborting) PLUS a viable final retry after it — reserving HARD_CEILING_MS +
 * DRAFT_RUNAWAY_MIN_RETRY_MS — AND the runaway-retry backstop is not yet hit.
 *
 * Single source for BOTH sites that previously hand-copied this arithmetic on two
 * clock reads microseconds apart: the loop-top skip-gate (`willBeFinalAttempt =
 * !hasRoom(...)`) and the in-closure abort authorization (`canRetryAgain =
 * hasRoom(...)`). They were byte-identical thresholds a lockstep-edit hazard kept
 * drifting (the reserve itself just moved DETECT→HARD_CEILING); one function makes
 * a future change land at both callers at once.
 */
export function hasRoomForAnotherAbortableAttempt(
  remainingMs: number,
  runawayAbortCount: number,
): boolean {
  return (
    remainingMs > DRAFT_RUNAWAY_HARD_CEILING_MS + DRAFT_RUNAWAY_MIN_RETRY_MS &&
    runawayAbortCount < DRAFT_MAX_RUNAWAY_RETRIES
  );
}

// ---------------------------------------------------------------------------
// ⭐ SKIP-GATE ALIGNMENT (2026-07-25). The two decisions the adapter's draft
// loop makes about "should another generation be funded?" — the ABORT
// authorisation and the FINAL-ATTEMPT skip-gate — now both route through the
// single anti-doom rule (`isDraftRetryAffordable`, config/timeouts.ts).
//
// THE DEFECT THEY FIX. The rule existed twice with DIFFERENT floors:
//   * timeouts.ts  — `>= max(2_700, priorAttemptMaxTokens)`  (both halves)
//   * anthropic.ts — `< 2_700`                               (floor half only)
// Since 3,150 >= 2,700 the adapter's gate NEVER fired, so after two 30s runaway
// aborts had burned 60s of the 110s window the "final" attempt was funded at
// getAffordableDraftTokens(50_000) = 3,150 tokens — ~37% of the 8,550-token
// budget the aborted attempts had — and truncated by construction ~90s in.
// Measured 2026-07-24: /assist A2killer 0/18, observed caps 3,146-3,826, with
// 15 of 18 inside a FOUR-token band at 3,146-3,149. That is not model variance;
// it is this arithmetic.
//
// WHY BOTH SITES AND NOT JUST THE GATE. Fixing only the skip-gate converts a
// ~90s guaranteed failure into a ~60s honest one — real, but it still throws two
// 30s aborts away first. The abort that CREATED the doomed window was itself
// authorised by a weaker rule (`hasRoomForAnotherAbortableAttempt` alone, which
// only knows about the 2,700 floor). Aborting into a window the skip-gate will
// then refuse is the same contradiction #673 fixed for the 35s/45s pair, one
// level up. Both sites must agree or the clock still burns.
//
// ⭐ THE YARDSTICK WAS WRONG, AND THAT WAS THE WHOLE DEFECT (FAST-ABORT,
// 2026-07-25). #675 (above) was right that a doomed retry must never be funded,
// and right that both sites must agree. It measured the wrong quantity.
//
// Comparing the post-abort window against the ABANDONED CAP demands
// aff(110s - ceiling) >= 8,550, which is arithmetically impossible — so #675's
// own doc concluded "the ladder does not fire at all at default configuration".
// Live confirmation, 30 observations: `runaway_abort_count: 0` on every one.
// The detector was built, correct, and switched off.
//
// The premise behind the abandoned-cap yardstick is "a model that could not fit
// N tokens re-truncates in anything less" — a statement about a generation that
// TRIED to fit a graph and overflowed. A runaway is not that. Measured over 29
// live runs (parallel-briefs/TOKEN-CEILING-EXPERIMENT-2026-07-25.md): 17/17
// runaways never emitted a single edge (`time_to_edges_ms` NULL, schema error
// `edges: Required`), and consumed `completion_tokens == the cap, EXACTLY` at
// 8,550 AND 12,000 AND 16,000, with 30-60s of window still unspent. A runaway
// has no size it is trying to reach. Its cap tells you nothing about demand.
//
// What a retry actually needs is what a SUCCESSFUL draft costs: 1,652-2,387
// tokens over 15 observations, identical at every ceiling. That is the quantity
// `isRunawayRetryAffordable` measures (corpus max x an explicit headroom factor,
// floored at #675's own 2,700 so it can never be laxer — today 3,581).
//
// BOTH #675 PROPERTIES STILL HOLD, and both are asserted in
// `__tests__/draft-fast-abort-yardstick.test.ts`:
//   1. NO DOOMED RETRY. The gate is STRICTER than the floor #675 shipped, and a
//      window affording less than a real draft is still refused at both sites —
//      17 of the 18 live caps that motivated #675 (3,146-3,826) are still
//      skipped.
//   2. NO AUTHORISE-THEN-REFUSE. `DRAFT_RUNAWAY_MIN_RETRY_MS` is re-derived from
//      this same floor, so an abort is authorised only when the window it leaves
//      passes the gate that runs next (swept over the whole domain in the test).
//
// THE WALL IS STILL RESPECTED. The 504-class the abort ladder was blamed for is
// closed by the F1 max_tokens derivation, not by aborting: every attempt's cap is
// getAffordableDraftTokens(its window) by construction, so a runaway truncates AT
// max_tokens INSIDE the wall and `closeTruncatedJson` salvage still applies.
//
// RESULTING LADDER at default configuration (110s window, 25s ceiling):
//   attempt 1 — 110s window, 8,550 cap, aborts at <=25s if no edges
//   attempt 2 —  85s window, 8,550 cap, aborts at <=25s if no edges
//   attempt 3 —  60s window, 4,050 cap (final squeeze), runs out; salvage applies
// A fourth rung would afford aff(35s) = 1,800 < 3,581 and is refused — the
// ladder terminates on the anti-doom rule, not by luck. Derived, not switched:
// no flag, no env gate.
// ---------------------------------------------------------------------------

/**
 * May the adapter EARLY-ABORT the in-flight attempt and fund another one?
 *
 * TRUE only when BOTH hold:
 *  1. the remaining budget reserves a full abortable attempt plus a retry
 *     (`hasRoomForAnotherAbortableAttempt`), AND
 *  2. the window the abort would actually leave behind can fund a CONVERGED
 *     draft (`isRunawayRetryAffordable`) — the evidence-derived requirement,
 *     not the cap being abandoned.
 *
 * The post-abort window is measured from the HARD CEILING, not DETECT_MS: a
 * progress-aware abort may consume up to the ceiling before firing, so the
 * ceiling is the honest worst case — the same reserve
 * `hasRoomForAnotherAbortableAttempt` uses, derived from the same constant.
 *
 * @param remainingMs live remaining window for the whole draft call
 * @param runawayAbortCount aborts already spent on this call
 * @param maxTokensCeiling optional caller ceiling, threaded so the post-abort
 *   affordability is computed against the budget the retry would REALLY get
 */
export function isAbortableRetryViable(
  remainingMs: number,
  runawayAbortCount: number,
  maxTokensCeiling?: number,
): boolean {
  if (!hasRoomForAnotherAbortableAttempt(remainingMs, runawayAbortCount)) return false;
  const postAbortWindowMs = Math.max(0, remainingMs - DRAFT_RUNAWAY_HARD_CEILING_MS);
  const postAbortAffordableTokens = resolveDraftMaxTokens(
    postAbortWindowMs,
    maxTokensCeiling,
  ).effective;
  return isRunawayRetryAffordable(postAbortAffordableTokens);
}

/**
 * Must the adapter SKIP the final attempt and fail fast?
 *
 * TRUE when runaway aborts have already been spent and the final window cannot
 * fund a converged draft. Skipping is the honest outcome: the same typed error
 * the doomed attempt would throw ~25s later, thrown now, with the budget unspent
 * rather than burned.
 *
 * Gated on `runawayAbortCount >= 1`, so this gate ONLY ever judges an attempt
 * that follows a RUNAWAY ABORT — which is exactly why it must use the runaway
 * yardstick and not `isDraftRetryAffordable`'s prior-cap one. Attempt 1 — and any
 * small-timeout direct caller — always runs at least once.
 *
 * Deliberately takes NO `priorAttemptMaxTokens`: the aborted attempt never
 * reached the edges array, so its cap is not a demand signal and must not be
 * allowed back into this decision. The adapter still LOGS it (it is useful
 * forensics), it just does not decide on it.
 *
 * Flooring the cap UP instead of skipping is NOT an option: it re-opens the
 * wall-overflow 504 that deriving max_tokens from the timeout closed.
 */
export function shouldSkipDoomedFinalAttempt(params: {
  readonly runawayAbortCount: number;
  readonly willBeFinalAttempt: boolean;
  readonly thinkingEnabled: boolean;
  readonly finalAttemptAffordableTokens: number;
}): boolean {
  if (params.runawayAbortCount < 1) return false;
  if (!params.willBeFinalAttempt) return false;
  // Thinking keeps its clamped max_tokens and runs with detection off, so the
  // final-attempt squeeze this gate guards against never applies to it.
  if (params.thinkingEnabled) return false;
  return !isRunawayRetryAffordable(params.finalAttemptAffordableTokens);
}

// ---------------------------------------------------------------------------
// ⭐ ONE BUILDER FOR THE FAILED-CALL `_llm_meta` (2026-07-25)
//
// This shape was hand-written FOUR times. The 2026-07-25 projection lane killed
// the third copy (`anthropic.ts` ~:1678, "a field-for-field duplicate MINUS
// max_tokens, runaway_abort_count and time_to_edges_ms") — and a FOURTH was
// authored ~400 lines up in the SAME file on the SAME night, two keys short
// (`time_to_edges_ms`, `token_usage`), on the `skipped_unaffordable_final`
// throw. Same file, same night, same class, by the work fixing that class.
//
// The cost is exact: every key added to the canonical meta (three were added
// that night; `runaway_abort_triggers` is added by this lane) silently fails to
// reach whichever copy nobody remembered — so the observability just repaired is
// absent on one failure route, and absence reads as "the guard never fired".
//
// Deriving all of them from this one function means a new key lands on EVERY
// failure surface or on none. Response-derived fields are OPTIONAL because the
// skip path throws BEFORE any response exists — that is the only real difference
// between the sites, and it is expressed as an absent key rather than a
// different literal.
//
// This is the cross-provider seam by design: `openai.ts` builds the same shape.
// ---------------------------------------------------------------------------

export interface FailedCallLlmMetaInput {
  readonly model: string;
  readonly promptVersion?: string;
  readonly promptHash?: string;
  readonly temperature?: number;
  readonly providerLatencyMs: number;
  readonly finishReason?: string;
  readonly maxTokens?: number;
  readonly streamed?: boolean;
  readonly runawayAbortCount?: number;
  /** Ordered triggers of the runaway aborts spent on this call, oldest first. */
  readonly runawayAbortTriggers?: readonly string[];
  readonly timeToEdgesMs?: number | null;
  readonly tokenUsage?: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
    readonly total_tokens: number;
  };
}

/**
 * Build the `_llm_meta` bag attached to a FAILED draft call.
 *
 * Consumed by `parse.ts` into `ctx.llmMeta` and projected onto the wire by
 * `buildLlmMetadataProjection` — so a key omitted here is a key invisible on
 * `trace.pipeline.llm_metadata` for that failure route.
 */
export function buildFailedCallLlmMeta(input: FailedCallLlmMetaInput): Record<string, unknown> {
  return {
    model: input.model,
    prompt_version: input.promptVersion,
    prompt_hash: input.promptHash,
    temperature: input.temperature,
    provider_latency_ms: input.providerLatencyMs,
    finish_reason: input.finishReason,
    max_tokens: input.maxTokens,
    streamed: input.streamed,
    runaway_abort_count: input.runawayAbortCount,
    runaway_abort_triggers: input.runawayAbortTriggers,
    time_to_edges_ms: input.timeToEdgesMs,
    token_usage: input.tokenUsage,
  };
}

// ---------------------------------------------------------------------------
// ⭐⭐ ONE CLASSIFIER FOR "OUR BUDGET, NOT YOUR BRIEF" (F1, 2026-07-25)
//
// THE DEFECT IT REPLACES. The pipeline decided which recovery copy a failed
// draft gets by reading a property each throw site had to REMEMBER to attach:
//
//     (err as { truncated_at_max_tokens?: unknown }).truncated_at_max_tokens === true
//
// Five failure routes throw here; four set it and the fifth — the
// `skipped_unaffordable_final` gate, i.e. the runaway-abort budget running out —
// did not, because no generation was ever cut at max_tokens on that path so the
// flag's own name did not fit. The consequence was not a missing diagnostic. It
// was the user being told "Provide a clearer, more specific decision brief"
// (with `retryable: false`) for a failure caused entirely by CEE aborting its
// own generations — the CRUEL INVERSION that `unified-pipeline/index.ts` names
// by that phrase twelve lines above the branch that committed it. #682's fourth
// abort trigger, deliberately ungated on `edgesReached`, strictly raised the
// rate at which users reached it.
//
// WHY A PREDICATE AND NOT A FIFTH FLAG. Adding `truncated_at_max_tokens: true`
// to the skip throw fixes today's instance and leaves tomorrow's: the next
// failure route is one more thing to remember, and a forgotten flag fails
// SILENTLY toward blaming the user. That is the hand-maintained mirror class.
//
// THIS DERIVES INSTEAD, from `_llm_meta` — which every failure route already
// builds through `buildFailedCallLlmMeta` above, and which
// `tests/unit/cee.llm-metadata-projection.test.ts` already pins against
// hand-built copies. A new throw site that follows the existing rule ("build the
// meta with the builder") is classified correctly WITHOUT knowing this function
// exists. `runaway_abort_count >= 1` is the load-bearing signal because it is a
// FACT ABOUT WHAT HAPPENED (CEE abandoned N generations on its own guard), not a
// label someone chose — labels drift, and a `finish_reason` allowlist would be
// the same mirror one level down.
//
// The explicit flag is still honoured, first: the truncation routes set it, the
// OpenAI adapter sets it, and existing tests pin it.
// ---------------------------------------------------------------------------

/**
 * Was this draft failure caused by CEE's own demand/budget machinery rather
 * than by the brief?
 *
 * TRUE for: a generation cut at the derived token cap, and a call whose runaway
 * guard aborted one or more generations (including the skip-gate that fails
 * fast once those aborts have exhausted the window). Those failures share one
 * recovery story — retry once, then narrow scope — and must NEVER receive the
 * "be clearer / be more specific" copy, which increases output-token demand and
 * steers the user straight back into the same failure.
 *
 * FALSE for: a draft that produced unparseable or schema-invalid output with no
 * aborts and no truncation. That is the case the vague-brief copy was written
 * for, and it stays exactly as it was.
 */
export function isDemandNotBriefFailure(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const candidate = err as { truncated_at_max_tokens?: unknown; _llm_meta?: unknown };

  // 1. The explicit structured flag the truncation throw sites attach.
  if (candidate.truncated_at_max_tokens === true) return true;

  // 2. DERIVED from the canonical failed-call meta — no throw site has to
  //    remember anything for this arm to work.
  const meta = candidate._llm_meta;
  if (meta === null || typeof meta !== "object") return false;
  const bag = meta as { runaway_abort_count?: unknown; finish_reason?: unknown };

  // CEE abandoned at least one generation on its own runaway guard. Whatever
  // happened afterwards, the honest account is "the draft outgrew our budget",
  // never "your brief was vague".
  if (typeof bag.runaway_abort_count === "number" && bag.runaway_abort_count >= 1) return true;

  // Belt and braces for a truncation whose route forgot the explicit flag:
  // the same `isDraftTruncated` rule the adapters classify stop reasons with.
  if (typeof bag.finish_reason === "string" && isDraftTruncated(bag.finish_reason)) return true;

  return false;
}

// Structural "reached the edges array" probe over the accumulated stream text.
// Edge objects carry `"from":`; healthy drafts emit ≥1, runaways emit 0 (the
// same signal measureTruncatedDraftAnatomy tallies as approx_edges). NOT global
// (used with .test(); a global flag would advance lastIndex across calls).
export const DRAFT_EDGES_REACHED_RE = /"from"\s*:/;

// ---------------------------------------------------------------------------
// ⭐⭐ THE PER-STRING-VALUE CEILING — the CLASS closure (2026-07-25)
//
// WHAT THE CLASS ACTUALLY IS. `ea4229c1` dropped `data.display_value` from the
// sent grammar and took drafting 5/16 -> 16/16. That move CANNOT BE REPEATED:
// it was safe only because the field was display-only AND had a deterministic
// replacement (`synthesiseDisplayValue`, capped at 50 chars). Neither holds for
// what is left — `label` is REQUIRED and load-bearing, and
// `uncertainty_drivers[]` is an unbounded array of unbounded strings. Neither
// can be dropped; neither has a formatter. Without a mechanism, the 100% is one
// field-migration away from 69% with no grammar lever remaining.
//
// THE INVARIANT, true of 10 of 10 characterised failures: ONE JSON STRING VALUE
// CONSUMED THE ENTIRE TOKEN BUDGET. The repeated payload varied (U+200B runs,
// "← display only.  ", a whole repeated sentence); the SHAPE never did. That
// invariant is:
//   * period-agnostic — phrase loops, character runs AND a non-repeating ramble
//     all trip it, where an identical-char-run guard catches only 5 of 10;
//   * field-agnostic — it covers `label` and `uncertainty_drivers[]`, which the
//     grammar can NEVER bound (`maxLength` is accepted by the compiler but not
//     enforced at generation and is stripped by enforceAnthropicSchemaCompliance;
//     `maxItems` 400s outright — both re-probed at the wire 2026-07-25);
//   * DERIVED from a corpus we already collect, not a hand-picked number.
//
// NOT A NEW MECHANISM — a new TRIGGER on the existing detector. The stream loop
// already accumulates, already owns `perAttempt.abort()`, and already has a
// total-char gate. The scanner below is O(1) per delta character.
//
// ⚠ WHY THE TOTAL-CHAR GATE IS KEPT, NOT RETIRED — the "strictly dominates"
// premise is INCOMPLETE, and the difference matters. Both gates measure chars,
// but they cover DIFFERENT runaway classes:
//   * per-value  — ONE string consumes the budget. 10/10 characterised failures.
//   * total-char — MANY well-formed elements consume the budget (a CARDINALITY
//     explosion). No string is long; every string is fine. The per-value ceiling
//     is structurally blind to it.
// A count runaway is not hypothetical-only: the grammar cannot cap array length
// (`maxItems` 400s), which is exactly why DRAFT_SOFT_NODE_CAP / _EDGE_CAP exist
// as a post-parse drift alarm. Retiring the total gate would leave that class
// with NO early abort at all. It is kept as the backstop for the class only it
// can see, and the pin below asserts the two cannot collapse into one another.
// ---------------------------------------------------------------------------

/**
 * Incremental single-pass scanner for the longest JSON string token in a stream.
 *
 * Fed the raw text deltas in order; returns, per delta, the greatest number of
 * characters accumulated inside ANY single string token at any point during that
 * delta (including a string that opened in an earlier delta and is still open,
 * and one that opens and closes inside this delta). Zero when no string is open
 * and none was seen.
 *
 * Honours backslash escapes, so `\"` does NOT close the string — without that a
 * runaway containing an escaped quote would silently reset the counter and the
 * guard would never fire.
 *
 * Counts RAW STREAM CHARACTERS, not decoded ones: a `\u200b` escape counts 6, not 1. That
 * is deliberate — the quantity being bounded is the output budget the string is
 * consuming, and the raw form is what is actually spent.
 *
 * Counts every JSON string token, key or value. Keys in this grammar are bounded
 * by construction (the longest is `goal_threshold_unit`, 19 chars) and the
 * ceiling is orders of magnitude above that, so in practice it can only ever
 * fire on a value.
 *
 * Pure state machine, no regex, no allocation, O(1) per character — it runs on
 * every delta of every draft, so it must not be the thing that costs latency.
 */
/**
 * The gate that ended an abortable draft attempt.
 *  * `string` — ONE JSON string token passed DRAFT_RUNAWAY_MAX_STRING_CHARS
 *    (the per-value class: 10/10 characterised failures).
 *  * `chars`  — the TOTAL nodes-phase char gate (the cardinality class).
 *  * `stall`  — no delta for DRAFT_RUNAWAY_STALL_MS (constrained-decode thrash).
 *  * `time`   — the absolute no-edges hard ceiling.
 * Exported so the adapter's ledger, the wire meta and the tests share ONE
 * definition of the trigger set rather than three string unions.
 */
export type DraftRunawayTrigger = "string" | "chars" | "stall" | "time";

export interface JsonStringRunScanner {
  /** Feed the next delta. Returns the longest string-token run seen in it. */
  push(delta: string): number;
}

export function createJsonStringRunScanner(): JsonStringRunScanner {
  let inString = false;
  let escaped = false;
  let run = 0;

  return {
    push(delta: string): number {
      let maxRun = inString ? run : 0;
      for (let i = 0; i < delta.length; i++) {
        const c = delta[i];
        if (!inString) {
          if (c === '"') {
            inString = true;
            escaped = false;
            run = 0;
          }
          continue;
        }
        if (escaped) {
          escaped = false;
          run += 1;
        } else if (c === "\\") {
          escaped = true;
          run += 1;
        } else if (c === '"') {
          inString = false;
          run = 0;
          continue;
        } else {
          run += 1;
        }
        if (run > maxRun) maxRun = run;
      }
      return maxRun;
    },
  };
}

/**
 * The abort ceiling for a single JSON string token in the draft stream.
 *
 * DERIVED — observed healthy maximum x an explicit headroom factor, following
 * the shipped `OBSERVED_MAX_CONVERGED_DRAFT_TOKENS x DRAFT_RETRY_HEADROOM_FACTOR`
 * pattern. Never hand-picked; the corpus lives in `config/timeouts.ts` beside the
 * other observed maxima and the census is pinned in
 * `__tests__/draft-string-run-guard.test.ts`, so editing the constant without
 * editing the corpus FAILS LOUD.
 */
export const DRAFT_RUNAWAY_MAX_STRING_CHARS = Math.ceil(
  OBSERVED_MAX_HEALTHY_DRAFT_STRING_CHARS * DRAFT_STRING_RUN_HEADROOM_FACTOR,
);

// Fail-loud corpus pin: a ceiling at or below the longest string a healthy draft
// has ever emitted aborts healthy drafts — the 2026-07-24 revert class, one
// dimension along. Asserted at module load so no future edit can quietly produce
// a false-abort gate.
if (DRAFT_RUNAWAY_MAX_STRING_CHARS <= OBSERVED_MAX_HEALTHY_DRAFT_STRING_CHARS) {
  throw new Error(
    `draft-budget: DRAFT_RUNAWAY_MAX_STRING_CHARS (${DRAFT_RUNAWAY_MAX_STRING_CHARS}) must exceed the ` +
    `longest string a healthy draft has ever emitted (${OBSERVED_MAX_HEALTHY_DRAFT_STRING_CHARS}) — ` +
    `a lower ceiling false-aborts healthy drafts.`,
  );
}

// Fail-loud dead-alarm pin. A per-value ceiling at or above the TOTAL-char gate
// could never fire first inside the nodes phase: the total gate would always win
// and the per-value trigger would be a mechanism that exists but never executes —
// the guarantee-theatre class this lane exists to close. Strictly below, so the
// per-value gate is genuinely the earlier signal on the class it owns.
if (DRAFT_RUNAWAY_MAX_STRING_CHARS >= DRAFT_RUNAWAY_DETECT_CHARS) {
  throw new Error(
    `draft-budget: DRAFT_RUNAWAY_MAX_STRING_CHARS (${DRAFT_RUNAWAY_MAX_STRING_CHARS}) must be strictly ` +
    `below DRAFT_RUNAWAY_DETECT_CHARS (${DRAFT_RUNAWAY_DETECT_CHARS}) — a per-value ceiling the total-char ` +
    `gate always reaches first is a trigger that can never fire.`,
  );
}
