/**
 * ⭐⭐⭐ A DRAFT THAT FAILS MUST STILL SPEAK. NO BARE 500 ON THIS PATH.
 *
 * Paul's ruling, 2026-09-15: *"Nothing should fail silently. Everything should
 * be an opportunity to coach the user and get them to help correct the data,
 * unless it is Olumi's fault, and then we just need to know that error."*
 *
 * A bare `HTTP 500 + BoundaryError` is the worst outcome available on the
 * draft path: a `BoundaryError` has no `assistant_text`, so the user gets
 * nothing, learns nothing, and hands us no reference to diagnose from. The
 * route already confessed this in terms (`route-v2.ts:5106-5112`) and named
 * the remedy — *"a turn-committing direct_answer 200 here"*. This module is
 * that turn.
 *
 * ── WHAT IT DOES NOT DO, AND WHY THAT IS THE WHOLE SAFETY ARGUMENT ─────────
 * It ships NO graph, NO partial model, NO synthesised edge and NO invented
 * strength. The drafted graph is discarded here exactly as it is discarded
 * today. The safety argument is therefore STRUCTURAL rather than a matter of
 * care: nothing can silently vanish from a comparison that was never
 * presented, no missing constraint can read as "no constraints", and there is
 * no gutted model to mistake for a whole one — the same argument
 * `route-v2.ts:4877-4882` makes for the goal-never-stated exit.
 *
 * The one thing that changes is that the user is TOLD, and we are told.
 *
 * ── THE SENTENCE IS IMPORTED, NEVER RESTATED ──────────────────────────────
 * The honest copy already exists and already rides the wire unread:
 * `selectEnforcementBlockRecovery` (`graph-enforcement.ts:239`) composes the
 * per-class sentence and the pipeline attaches it as `recovery.suggestion`.
 * This module takes that string as an INPUT and never re-spells it — a second
 * spelling of one sentence is how two producers drift (trap 12). Its own
 * fallbacks below fire only when the producer composed nothing at all.
 *
 * ── WHY `fault` IS DERIVED, NOT ASSERTED ──────────────────────────────────
 * `fault` answers Paul's ruling's own question: is this the user's data, or
 * ours? It is read off the PRODUCER's stamp (`details.goal_never_stated`),
 * never re-derived here — the graph is gone by the time the route holds the
 * failure, so nothing downstream can re-derive it and nothing should try.
 * Absent is `'olumi'`, and that is the fail-safe direction: measurement on
 * build `07da2c0b` says the connectivity class is OUR sampler under-supplying
 * edges (identical brief bytes gave 200/200/500; node count normal at
 * z=+0.70 n.s. while edges were short at z=-5.62), so blaming the user's
 * brief would demand work on a brief that is not deficient.
 */

import type { OlumiResponse } from '@talchain/schemas/boundary';
// The same chip type every other composer on this route uses, from the same
// module — a second spelling of one shape is how two producers drift apart.
import type { SuggestedAction } from './compose/types.js';

/**
 * Whose fault the user is being told this is.
 *
 * Exactly the two values Paul's ruling admits. There is deliberately no
 * `'unknown'`: a failure we cannot attribute is ours until we can show
 * otherwise, and an `'unknown'` bucket is where that obligation would go to
 * die.
 */
export type DraftFailureFault = 'your_data' | 'olumi';

/**
 * Is this failure the POST-ENFORCEMENT BLOCK — the class the captured 500s
 * came from?
 *
 * ⚠ IT IS THE PRODUCER'S OWN SIGNATURE, NOT A CODE LIST. Exactly one site in
 * the tree emits `details.validation_error_codes` — the post-enforcement gate
 * in `graph-enforcement.ts` — and it is the same site whose
 * `selectEnforcementBlockRecovery` composes the sentence this turn speaks. So
 * the presence of the key IS the class, and there is no list here that can
 * drift from the validator's (trap 12: a hand-maintained mirror of a code set
 * would go stale the first time a code is added).
 *
 * Empty is FALSE, deliberately and conservatively. Every other failure on the
 * draft path — timeouts, rate limits, upstream errors, truncations, plain
 * throws — keeps today's HTTP 500. Those are different failures with different
 * remedies and a different honest sentence; folding them in here would be two
 * questions under one predicate (trap 21), and making THEM speak is a
 * separate, separately-ruled increment.
 */
export function isPostEnforcementBlock(codes: readonly string[]): boolean {
  return codes.length > 0;
}

/** The one-tap retry affordance. */
export const DRAFT_FAILURE_RETRY_CHIP_ID = 'draft_failure_retry';
export const DRAFT_FAILURE_RETRY_CHIP_LABEL = 'Try again';
/**
 * ⚠ THIS STRING IS A RESUME KEY, NOT DECORATION. `resolveDraftOfferResume`
 * (`route-v2.ts:604`) claims the armed `draft_graph` pending by EXACT copy
 * replay of the chip's label/message, so changing either here without
 * changing the pending's `public_message` silently breaks the retry.
 */
export const DRAFT_FAILURE_RETRY_CHIP_MESSAGE =
  'Yes, try building the model again from what I have shared.';

/**
 * Fallback copy — reached ONLY when the pipeline composed no recovery
 * sentence of its own (a plain-`Error` throw with no attached metadata).
 *
 * No blame line, and no "be more specific": a vaguer brief makes the model
 * INFER more, which is the cruel inversion recorded in the 2026-07-23
 * firefight. No em dashes in product content (Paul, 2026-09-10).
 */
export const OLUMI_FAULT_FALLBACK_READABLE =
  'Something went wrong on our side while building your decision model, so nothing was shown to you. '
  + 'Nothing in what you wrote caused this.';

export const YOUR_DATA_FALLBACK_READABLE =
  'I got as far as drafting, but I could not tell what the alternatives should be judged against, '
  + 'so the model would not hold together. Naming the outcome you want will let me draft it.';

/** The closing line that makes the failure diagnosable by us. */
export function composeReferenceLine(requestId: string): string {
  return `If this keeps happening, send us this reference: ${requestId}`;
}

export interface DraftFailureRecoveryInput {
  /** Copyable diagnostic handle. Goes in the text AND in `details`. */
  readonly requestId: string;
  /** Read off the producer's stamp by the caller. Never re-derived here. */
  readonly fault: DraftFailureFault;
  /**
   * The pipeline's OWN recovery sentence (`recovery.suggestion`), or `null`
   * when it composed none. IMPORTED, never restated — see the module header.
   */
  readonly suggestion: string | null;
  /** The pipeline's own hints, in its own order. */
  readonly hints: readonly string[];
  /** Typed wire reason, e.g. `draft_graph_cee_graph_invalid`. */
  readonly reason: string;
  /** Post-enforcement blocking codes, when the producer emitted any. */
  readonly validationErrorCodes: readonly string[];
  /** The producer-authoritative retryability that reached the route. */
  readonly retryable: boolean;
  /**
   * Arm the one-tap retry. FALSE when nothing can seed a re-draft — an
   * offer we cannot honour is a dead end wearing a button.
   */
  readonly offerRetry: boolean;
}

/**
 * Compose the graphless, speaking failure turn.
 *
 * Shape matches the graphless turns already shipped on this route
 * (`composeGoalNeverStatedAsk`, the explicit-generate decline at
 * `route-v2.ts:4110`): `response_version: 2`, no `draft_graph` key,
 * `stage_indicator: 'frame'`.
 *
 * ⚠ `stage_indicator` is 'frame', NOT 'analyse'. The draft did not land, so
 * there is nothing to analyse; telling the UI otherwise would advance a stage
 * the model never reached.
 *
 * ⚠ `error_code` is `INTERNAL_ERROR` for every class, deliberately. A
 * reason-to-wire-code map here would be a hand-maintained mirror of producer
 * semantics (trap 12) whose first stale entry mislabels a failure; the
 * PRECISE cause already rides `details.reason` and
 * `details.validation_error_codes`, derived from the producer.
 *
 * ⚠ `details` IS THE PASSTHROUGH. `ErrorBlockSchema` is `.strict()` at the top
 * level (`type` / `error_code` / `severity` / `details` only) but its
 * `details` is `z.object({}).passthrough()`, so `request_id`, `fault` and
 * `readable` land with NO schema release and NO cross-repo bump — the same
 * sanctioned pattern `edit-graph-referee-gate.ts:740` already uses for
 * `blocker_readable`.
 */
export function composeDraftFailureRecoveryTurn(
  input: DraftFailureRecoveryInput,
): OlumiResponse {
  // The producer's sentence wins whenever it exists. The fallbacks below are
  // for the plain-throw path only, and they are the only bytes this module
  // authors.
  const readable =
    input.suggestion !== null && input.suggestion.trim().length > 0
      ? input.suggestion.trim()
      : input.fault === 'your_data'
        ? YOUR_DATA_FALLBACK_READABLE
        : OLUMI_FAULT_FALLBACK_READABLE;

  const hintLines = input.hints
    .filter((h) => typeof h === 'string' && h.trim().length > 0)
    .map((h) => `- ${h.trim()}`);

  const assistantText = [
    readable,
    ...(hintLines.length > 0 ? [hintLines.join('\n')] : []),
    composeReferenceLine(input.requestId),
  ].join('\n\n');

  const chips: SuggestedAction[] = input.offerRetry
    ? [
        {
          id: DRAFT_FAILURE_RETRY_CHIP_ID,
          label: DRAFT_FAILURE_RETRY_CHIP_LABEL,
          message: DRAFT_FAILURE_RETRY_CHIP_MESSAGE,
        },
      ]
    : [];

  return {
    response_version: 2,
    assistant_text: assistantText,
    blocks: [
      {
        type: 'error',
        error_code: 'INTERNAL_ERROR',
        severity: 'error',
        details: {
          // The three fields Paul's ruling requires of every failure.
          request_id: input.requestId,
          fault: input.fault,
          readable,
          // Machine-readable cause, for us rather than for the user.
          source: 'draft_graph',
          reason: input.reason,
          retryable: input.retryable,
          ...(input.validationErrorCodes.length > 0
            ? { validation_error_codes: [...input.validationErrorCodes] }
            : {}),
        },
      },
    ],
    suggested_actions: chips,
    insights: [],
    stage_indicator: 'frame',
  } as OlumiResponse;
}
