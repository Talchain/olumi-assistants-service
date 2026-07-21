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
 * Consumed by both the Anthropic and OpenAI draft paths, and by the boot-time
 * affordability assertion + value tests.
 */
export function resolveDraftMaxTokens(timeoutMs: number): {
  configured: number | null;
  affordable: number;
  effective: number;
} {
  // Anthropic requires max_tokens >= 1; a degenerate timeout still needs an
  // API-valid request (it will fail fast on time, not on a 400).
  const affordable = Math.max(1, getAffordableDraftTokens(timeoutMs));
  const configured = getMaxTokensFromConfig("draft_graph") ?? null;
  if (configured === null) {
    return { configured, affordable, effective: affordable };
  }
  const floor = Math.min(DRAFT_MAX_TOKENS_FLOOR, affordable);
  return {
    configured,
    affordable,
    effective: Math.min(Math.max(configured, floor), affordable),
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
