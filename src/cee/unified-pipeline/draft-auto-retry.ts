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
import { isOptionsIdenticalBypassResult } from "./stages/repair/options-identical-bypass.js";
import type { UnifiedPipelineResult } from "./types.js";

/** How many pipeline attempts the auto-retry seam may run IN TOTAL. Bounded
 *  and named: the wrapper runs attempt 2 iff the decision says so, and there
 *  is no loop — a second failure is terminal by construction. */
export const ENFORCEMENT_AUTO_RETRY_MAX_ATTEMPTS = 2;

/**
 * The draft failure classes this seam funds a retry for.
 *
 * MEMBERSHIP RULE — a class belongs here iff its PRODUCER declares it
 * stochastic (emits `retryable: true` at the gate) and the failure completes
 * far enough inside the request budget to fund a fresh attempt. Both members
 * satisfy that at their own bytes; neither is a hand-list of validator codes.
 */
export type RetryableDraftFailureClass = "post_enforcement" | "options_identical";

/**
 * ⭐ THE CANONICAL OWNER of "is this failure one the server should re-draft?"
 *
 * ONE predicate, TWO delegated membership tests — each imported from the file
 * that EMITS the failure, never restated here (the `isEnforcementBlockedResult`
 * doctrine, extended rather than duplicated). Adding a parallel retry rule
 * beside this one is how the estate ends up with two authorities answering the
 * same question with different defaults (trap 21); there is exactly one.
 *
 * ⚠ ORDER IS NOT A TIE-BREAK: the two signatures are mutually exclusive by
 * construction (different status codes — 422 vs 400 — and the discriminating
 * `last_phase` / `violation_code` details keys). Pinned by the mutual-exclusion
 * case in `__tests__/draft-auto-retry.decision.test.ts`.
 *
 * Returns null when `result` is not a retryable draft failure — including every
 * success, every thrown error, and every other typed failure.
 */
export function classifyRetryableDraftFailure(
  result: UnifiedPipelineResult | undefined,
): RetryableDraftFailureClass | null {
  if (isEnforcementBlockedResult(result)) return "post_enforcement";
  if (isOptionsIdenticalBypassResult(result)) return "options_identical";
  return null;
}

export type DraftAutoRetryDecision =
  | { retry: true; retryBudgetMs: number; retryClass: RetryableDraftFailureClass }
  | {
      retry: false;
      reason: "not_retryable_class" | "budget_unaffordable";
      retryBudgetMs?: number;
    };

/**
 * Should the pipeline fund ONE fresh attempt after `result`?
 *
 * Two conjuncts, two different questions (trap 21), each named:
 *  - is this one of the self-declared-stochastic draft failure classes?
 *    (`classifyRetryableDraftFailure` — each producer's own bytes)
 *  - can the remaining request budget fund a window a healthy draft actually
 *    fits in? (the parse-path affordability rule, same primitives)
 *
 * ⚠ The budget conjunct is deliberately class-INDEPENDENT: both classes fail
 * fast (17–31s observed) and both re-draft through the same LLM call, so the
 * affordable window is the same question for both. If a future class needs a
 * different floor, that is a new parameter — not a second copy of this
 * function.
 */
export function decideDraftAutoRetry(
  result: UnifiedPipelineResult,
  elapsedMs: number,
): DraftAutoRetryDecision {
  const retryClass = classifyRetryableDraftFailure(result);
  if (retryClass === null) {
    return { retry: false, reason: "not_retryable_class" };
  }
  const retryBudgetMs = getDraftLlmRetryBudgetMs(elapsedMs);
  if (retryBudgetMs < MIN_DRAFT_RETRY_BUDGET_MS) {
    return { retry: false, reason: "budget_unaffordable", retryBudgetMs };
  }
  return { retry: true, retryBudgetMs, retryClass };
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
 * Post-retry copy for the OPTIONS_IDENTICAL class.
 *
 * ⚠ THE ENFORCEMENT COPY ABOVE IS NOT REUSABLE HERE, and reusing it would ship
 * a LIE: it tells the user "part of the drafted model was left unconnected to
 * your goal", which describes a topology failure this class did not have. The
 * options were connected fine — they came out with the same numbers.
 *
 * The single-attempt copy (`options-identical-bypass.ts`) leads with "this
 * often clears on a retry", which is TRUE before any retry has been spent and
 * STALE the moment the server has spent one. So this variant demotes retry from
 * the lead to a disclosed footnote and promotes the real user lever —
 * naming what separates the options. That is the trap-22f exit applied to a
 * draft: where the model cannot determine the difference, make the difference
 * the USER's question rather than guess one.
 *
 * Domain-neutral by ruling (2026-07-24, draft-honesty lane): name the KIND of
 * differentiator, never invent a domain. `retryable` stays true — a manual
 * retry remains mechanically possible; the honesty lives in the copy.
 */
export const OPTIONS_IDENTICAL_RETRY_EXHAUSTED_SUGGESTION =
  "Your options came out with the same values twice, so there was nothing to compare between them. " +
  "A second draft was tried automatically and came out the same way, so the clearest next step is to " +
  "say what separates your options — whichever dimension the decision turns on.";

export const OPTIONS_IDENTICAL_RETRY_EXHAUSTED_HINTS: readonly string[] = [
  "Give each option at least one value that differs — cost, time, scope, capacity or risk",
  "Or describe in plain language how each option differs from the others",
  "Trying the same brief again is still possible, but it has now produced identical options twice",
];

/** Per-class post-retry copy. One table, keyed by the class the classifier
 *  returned — so a new class cannot be added to `RetryableDraftFailureClass`
 *  without the typechecker demanding its copy here. */
const RETRY_EXHAUSTED_COPY: Record<
  RetryableDraftFailureClass,
  { suggestion: string; hints: readonly string[] }
> = {
  post_enforcement: {
    suggestion: ENFORCEMENT_RETRY_EXHAUSTED_SUGGESTION,
    hints: ENFORCEMENT_RETRY_EXHAUSTED_HINTS,
  },
  options_identical: {
    suggestion: OPTIONS_IDENTICAL_RETRY_EXHAUSTED_SUGGESTION,
    hints: OPTIONS_IDENTICAL_RETRY_EXHAUSTED_HINTS,
  },
};

/**
 * Return a copy of `result` (whose class the caller has already established
 * via `classifyRetryableDraftFailure`) whose recovery copy is honest about the
 * spent retry, and whose details disclose it on the wire
 * (`auto_retry: { attempted, attempts }` — fixed shape, no user content;
 * allowlisted in draft-graph.ts's PIPELINE_DETAILS_ALLOWLIST per the
 * ROADMAP 2.718 pattern). Everything else — code, retryable, the codes-only
 * validator mirror, `last_phase`, and the OPTIONS_IDENTICAL diagnostics
 * (`violation_code`, `identical_option_ids`, `intervention_signature`,
 * `repair_skip_reason`) — is preserved byte-for-byte. Pure: the input is not
 * mutated.
 */
export function applyRetryExhaustedCopy(
  result: UnifiedPipelineResult,
  retryClass: RetryableDraftFailureClass,
): UnifiedPipelineResult {
  const body = result.body as Record<string, unknown>;
  const details =
    body.details !== null && typeof body.details === "object" && !Array.isArray(body.details)
      ? (body.details as Record<string, unknown>)
      : {};
  const copy = RETRY_EXHAUSTED_COPY[retryClass];
  return {
    ...result,
    body: {
      ...body,
      recovery: {
        suggestion: copy.suggestion,
        hints: [...copy.hints],
      },
      // The PINNED flat mirror of the sentence (@talchain/schemas 0.19.0,
      // Wave-2 ask 7). `buildCeeErrorResponse` sets it beside `recovery` at
      // emission, so rewriting `recovery` alone leaves the body carrying two
      // DIFFERENT sentences — the flat one stale by a retry.
      //
      // ⚠ SCOPE, stated precisely: this is a consistency measure, NOT a fix for
      // a witnessed wire defect. Derived at this tip: NO reader of
      // `body.recovery_suggestion` exists in `src/` — route-v2 builds its own
      // `details.recovery_suggestion` from `recovery.suggestion` (the nested
      // object), so the wire was already honest by that derivation. Keeping the
      // two in agreement removes a latent trap for the next consumer that
      // reads the flat field, which is what it was pinned for.
      recovery_suggestion: copy.suggestion,
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
