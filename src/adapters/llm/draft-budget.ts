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
 * NONE of these constants are env-gated (no new flags): affordability is derived
 * from config/timeouts.ts, the clamp is arithmetic over the derived affordable
 * value, and the truncation signal is a provider fact.
 */

import {
  getAffordableDraftTokens,
  DRAFT_LLM_TIMEOUT_MS,
  LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR,
  DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S,
  DRAFT_TTFB_SAFETY_OVERHEAD_S,
} from "../../config/timeouts.js";
import { getMaxTokensFromConfig } from "./router.js";

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
// hard upper limit on time consumed before an abort). DERIVED from the fresh
// live distribution: p100 19.57s + ~10.4s margin = 30s. Clearing the live
// healthy p100 with comfortable headroom is what removes the false-abort of the
// slow-healthy tail (edges reached at up to 19.57s, and a hair beyond under
// drift): a still-emitting healthy draft has until 30s to reach edges before the
// ceiling fires, versus the old 20s blanket gate that clipped it. The drift
// tripwire (DRAFT_RUNAWAY_DRIFT_WARN_MS) warns long before the live p90 could
// creep up to this. Catches the (unobserved) slow-sparse runaway the stall and
// char gates would miss.
export const DRAFT_RUNAWAY_HARD_CEILING_MS = 30_000;

// Char budget: max healthy nodes-section = 7078 chars (fresh); runaway visible
// minimum = 9526 chars. 8000 sits above the healthy max (+13%) and below the
// runaway min (-16%), catching a TEXT-heavy (ballooning) runaway independent of
// wall-clock. Gated on "no edges yet", so it only ever fires while still in the
// nodes array. This is the signal that catches a runaway which keeps emitting
// (and so is NOT stalled) before it can blow the hard ceiling.
export const DRAFT_RUNAWAY_DETECT_CHARS = 8_000;

// DRIFT TRIPWIRE (the alarm that was MISSING on 2026-07-24). Derived from the
// hard ceiling (0.6× = 60% of the way to an abort) rather than a hand-mirrored
// corpus constant, so it cannot silently drift out of sync with the gate. A
// healthy draft reaching edges past this point is in the slow tail (fresh p50
// 15.4s < 18s < fresh p90 19.3s — it fires on today's slow-healthy quartile,
// 4/16 ≥18s, exactly the population the stale 20s gate was clipping). A RISING
// rate of these WARNs is the early signal that the live p90 is creeping toward
// the ceiling and the corpus is drifting — surface it BEFORE it becomes a
// false-abort, which is precisely what did not happen today.
export const DRAFT_RUNAWAY_DRIFT_WARN_MS = Math.round(DRAFT_RUNAWAY_HARD_CEILING_MS * 0.6);

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
// actually afford a converged graph. Evaluates to 45,000ms today; it tracks the
// floor automatically if any of those primitives change (derive, never mirror).
export const DRAFT_RUNAWAY_MIN_RETRY_MS = Math.ceil(
  (LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR / DRAFT_THROUGHPUT_FLOOR_TOKENS_PER_S +
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

// Structural "reached the edges array" probe over the accumulated stream text.
// Edge objects carry `"from":`; healthy drafts emit ≥1, runaways emit 0 (the
// same signal measureTruncatedDraftAnatomy tallies as approx_edges). NOT global
// (used with .test(); a global flag would advance lastIndex across calls).
export const DRAFT_EDGES_REACHED_RE = /"from"\s*:/;
