/**
 * ROADMAP 2.1086 — ONE bounded server-side auto-retry when post-enforcement
 * draft validation fails.
 *
 * WHY (BASELINE.md, draft-reliability-2026-08-12, deployed CEE a9022e7):
 * 5/15 first-attempt drafting failures were ALL `CEE_GRAPH_INVALID` at
 * `last_phase="deterministic_enforcement"` — the gate's own emission declares
 * `retryable: true` and its comment names the cause: stochastic model
 * topology, not a bad brief. Failures complete in 17.2–28.3s (uniformly
 * FASTER than any success, 40–81s), and a same-brief retry recovered 3/5.
 * The user was being asked to click "try again" to spend a retry the server
 * could spend for them — with most of the request budget still unspent.
 *
 * BUDGET DERIVATION (all from config/timeouts.ts, the same primitives the
 * draft path already enforces — nothing re-encoded here):
 *   remaining LLM window after `elapsedMs` = getDraftLlmRetryBudgetMs(e)
 *     = min(DRAFT_LLM_TIMEOUT_MS, DRAFT_REQUEST_BUDGET_MS − headroom − e)
 *   fund the retry iff that window ≥ MIN_DRAFT_RETRY_BUDGET_MS — the estate's
 *   standing "minimum window worth funding a fresh LLM attempt into"
 *   (anchored at/above the slowest healthy draft ever observed; the same gate
 *   parse.ts uses for its strength-default retry). At the observed failure
 *   latencies (≤28.3s) the window is ≥81.7s: a retry fits with wide margin.
 *   Composition safety: the wrapper threads the ORIGINAL requestStartMs into
 *   attempt 2, so every window inside it (parse F1 per-attempt clamp, the
 *   Step-11 budget guard, the runaway-abort funding rules) measures elapsed
 *   from request start and the whole composition stays inside
 *   DRAFT_REQUEST_BUDGET_MS by construction.
 *
 * The TRIGGER is the producer's own signature (`isEnforcementBlockedResult`,
 * exported by graph-enforcement.ts beside the emission, sharing its
 * constants) — never a hand-list of validator codes: the retryable code set
 * is whatever the post-enforcement validator classifies as blocking, by
 * construction.
 */

import {
  getDraftLlmRetryBudgetMs,
  MIN_DRAFT_RETRY_BUDGET_MS,
} from "../../config/timeouts.js";
import { isEnforcementBlockedResult } from "./stages/repair/graph-enforcement.js";
import type { UnifiedPipelineResult } from "./types.js";

/** How many pipeline attempts the auto-retry seam may run IN TOTAL. Bounded
 *  and named: the wrapper runs attempt 2 iff the decision says so, and there
 *  is no loop — a second failure is terminal by construction. */
export const ENFORCEMENT_AUTO_RETRY_MAX_ATTEMPTS = 2;

export type EnforcementAutoRetryDecision =
  | { retry: true; retryBudgetMs: number }
  | {
      retry: false;
      reason: "not_enforcement_blocked" | "budget_unaffordable";
      retryBudgetMs?: number;
    };

/**
 * Should the pipeline fund ONE fresh attempt after `result`?
 *
 * Two conjuncts, two different questions (trap 21), each named:
 *  - is this the post-enforcement fail-closed class the producer itself
 *    declared retryable? (`isEnforcementBlockedResult` — the producer's bytes)
 *  - can the remaining request budget fund a window a healthy draft actually
 *    fits in? (the parse-path affordability rule, same primitives)
 */
export function decideEnforcementAutoRetry(
  result: UnifiedPipelineResult,
  elapsedMs: number,
): EnforcementAutoRetryDecision {
  if (!isEnforcementBlockedResult(result)) {
    return { retry: false, reason: "not_enforcement_blocked" };
  }
  const retryBudgetMs = getDraftLlmRetryBudgetMs(elapsedMs);
  if (retryBudgetMs < MIN_DRAFT_RETRY_BUDGET_MS) {
    return { retry: false, reason: "budget_unaffordable", retryBudgetMs };
  }
  return { retry: true, retryBudgetMs };
}

/**
 * Post-retry honest copy. The single-attempt copy says "this is usually
 * transient. Try again." / "Retrying the same brief usually succeeds" — TRUE
 * before any retry has been spent (BASELINE: 3/5 recovered), and STALE after
 * two consecutive identical failures (the two briefs that failed twice never
 * recovered on further attempts: S3 0/3, M2 0/2). After the server has spent
 * the retry, the copy must disclose that and promote strengthening the brief
 * over blind re-clicking. `retryable` stays true — a manual retry remains
 * mechanically possible and the failure is brief-conditional, not
 * brief-caused; the honesty lives in the copy, not in a flipped flag.
 */
export const ENFORCEMENT_RETRY_EXHAUSTED_SUGGESTION =
  "Part of the drafted decision model was left unconnected to your goal, so it was rejected instead of being shown to you. A second draft was tried automatically and hit the same problem, so a small change to the brief is the best next step.";

export const ENFORCEMENT_RETRY_EXHAUSTED_HINTS: readonly string[] = [
  "State the outcome you are optimising for explicitly",
  "Naming how each consideration affects that outcome helps the model connect them",
  "Trying the same brief again is still possible, but it has now failed twice in a row",
];

/**
 * Return a copy of `result` (which MUST satisfy `isEnforcementBlockedResult`
 * — the caller gates on it) whose recovery copy is honest about the spent
 * retry, and whose details disclose it on the wire
 * (`auto_retry: { attempted, attempts }` — fixed shape, no user content;
 * allowlisted in draft-graph.ts's PIPELINE_DETAILS_ALLOWLIST per the
 * ROADMAP 2.718 pattern). Everything else — code, retryable, the codes-only
 * validator mirror, last_phase — is preserved byte-for-byte. Pure: the input
 * is not mutated.
 */
export function applyEnforcementRetryExhaustedCopy(
  result: UnifiedPipelineResult,
): UnifiedPipelineResult {
  const body = result.body as Record<string, unknown>;
  const details =
    body.details !== null && typeof body.details === "object" && !Array.isArray(body.details)
      ? (body.details as Record<string, unknown>)
      : {};
  return {
    ...result,
    body: {
      ...body,
      recovery: {
        suggestion: ENFORCEMENT_RETRY_EXHAUSTED_SUGGESTION,
        hints: [...ENFORCEMENT_RETRY_EXHAUSTED_HINTS],
      },
      details: {
        ...details,
        auto_retry: {
          attempted: true,
          attempts: ENFORCEMENT_AUTO_RETRY_MAX_ATTEMPTS,
        },
      },
    },
  };
}
