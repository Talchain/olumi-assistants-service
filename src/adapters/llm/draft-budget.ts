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

import { getAffordableDraftTokens, DRAFT_LLM_TIMEOUT_MS } from "../../config/timeouts.js";
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

// ── EARLY RUNAWAY DETECTION (Lane C, 2026-07-23) ─────────────────────────────
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
// Thresholds DERIVED from the wave1 capture corpus (n=19 healthy successes +
// 4 runaways), recorded here so they are not a hand-picked sentinel (the 6800
// lesson — CLAUDE.md trap; derive from measured data, never a magic number):
//   - healthy draft-call TOTAL wall duration:  23.6s – 34.8s   (max 34,803ms)
//   - healthy nodes-section serialized chars:  4141 – 6896     (max 6896)
//   - runaway:  8550 tok, 0 edges, 82-91s, visible output 9526-23281 chars
//
// NONE of these are env-gated (no new flags; the streamed abort-retry ships ON,
// rollback = code revert — consistent with the rest of this seam).

// Time deadline: a draft still in the nodes array (no edges) at this point
// cannot be a healthy draft. Armed as a timer, so a silent-thrash runaway that
// stops emitting deltas is still caught.
//
// TIGHTENED 30s → 20s (2026-07-23, from LIVE round-1 streaming data on build
// 85b8e0e). The day-1 30s was the conservative value derived from the ONLY data
// then available — the wave1 healthy TOTAL-duration ceiling (34.8s) — because
// streaming time-to-edges could not be measured pre-deploy. Round-1 measured it:
//   - every runaway aborted at the 30s gate while still at only 3153-6659 partial
//     chars (a slow ~125 char/s nodes thrash), i.e. detectable well before 30s;
//   - the largest healthy draft in the corpus completes its ENTIRE structure
//     (nodes+edges) in 31.8-34.8s, so it reaches the edges array (a ~40%-of-
//     output milestone) by ~14s — leaving ~6s of margin below 20s.
// A 30s abort cost 2 doomed attempts ~60s and, with the ~20s post-draft coaching
// pass competing for the 120s request budget, tipped unlucky briefs into a 110s
// `anthropic_timeout` (4 seen in round 1). At 20s, even a 3-abort sequence
// (60s) + a 30s final draft + 20s coaching = 110s < 120s, so the runaway class
// no longer exhausts the budget. `cee.llm.draft_edges_reached` is logged on
// success to keep validating this floor live.
export const DRAFT_RUNAWAY_DETECT_MS = 20_000;

// Char budget: max healthy nodes-section = 6896 chars; runaway visible minimum
// = 9526 chars. 8000 sits above the healthy max (+16%) and below the runaway
// min (-16%), catching a TEXT-heavy runaway before the time deadline. Gated on
// "no edges yet", so it only ever fires while still in the nodes array.
export const DRAFT_RUNAWAY_DETECT_CHARS = 8_000;

// Defensive backstop on the number of runaway retries (independent of the
// budget guard): the budget guard alone terminates the loop only because real
// streaming consumes wall-clock, so a pathological provider that returned an
// instant char-gate runaway every time (0ms elapsed) could otherwise spin. On
// hitting this cap the next attempt runs to the full remaining budget with no
// early abort (final-attempt semantics), so the loop always terminates. In the
// real budget this cap never binds (only ~3 attempts fit the ~110s window).
export const DRAFT_MAX_RUNAWAY_RETRIES = 5;

// Stop early-aborting once the remaining budget is below DETECT_MS + this: the
// FINAL attempt then runs to the full remaining window with NO early abort, so
// a late-but-legitimate completion is never discarded and the existing salvage
// (closeTruncatedJson) still applies to a natural max_tokens truncation. 35s is
// the observed healthy ceiling (~34.8s), so the final attempt gets a full
// healthy window. With the ~110s draft budget this affords ~3 attempts
// (30 + 30 + ≤50); at the corpus runaway rate this is the abort-retry lever.
export const DRAFT_RUNAWAY_MIN_RETRY_MS = 35_000;

// Structural "reached the edges array" probe over the accumulated stream text.
// Edge objects carry `"from":`; healthy drafts emit ≥1, runaways emit 0 (the
// same signal measureTruncatedDraftAnatomy tallies as approx_edges). NOT global
// (used with .test(); a global flag would advance lastIndex across calls).
export const DRAFT_EDGES_REACHED_RE = /"from"\s*:/;
