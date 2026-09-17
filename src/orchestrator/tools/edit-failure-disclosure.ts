/**
 * ⭐⭐ NOTHING FAILS SILENTLY (Paul's ruling, 2026-09-15).
 *
 * When an edit is refused because a write did not survive canonicalisation, the
 * product used to tell the user one sentence — *"That change could not be
 * applied to the model. Try describing it a different way."* — and put the only
 * diagnosable detail in a server `warn` line. So a user hitting the dominant
 * refusal class on staging had:
 *   · no request id to quote,
 *   · no statement of WHOSE fault it was, and
 *   · no plain-English account of what happened to their change.
 * Measured on the serving tip `07da2c0b`: 100 of 100 refusals in a 20h window
 * were this class, and every one of them was silent in exactly that way.
 *
 * This module is the vocabulary for saying it out loud. It rides in the
 * `ErrorBlock`'s `details` — which is `z.object({}).passthrough().optional()`
 * while the block itself is `.strict()` at the top level
 * (`@talchain/schemas/boundary/blocks`) — so NO schema release is needed and no
 * boundary enum is widened.
 */

import type { NonLandingReason } from '../canonicalise-value-ops.js';

/**
 * ⛔⛔ WHOSE FAULT IT WAS, AND THE DEFAULT IS OURS.
 *
 * `olumi` is the default and it is not a formality. Attributing a failure to
 * the user BY ELIMINATION — "we could not do it, so you must have asked for
 * something wrong" — is the exact shape of the `ai_inferred` defect this
 * codebase has now paid for twice (`format-graph-for-context.ts`,
 * `graph-compact.ts`): an inverted default that reads as a finding. A failed
 * conversion, an unsupported but perfectly valid request, and a discarded
 * intended change are ALL Olumi's fault.
 *
 * `needs_input` is reserved for the genuinely different case: we understood the
 * request, we can act on it, and the USER'S MEANING is ambiguous between two
 * readings we must not guess between.
 */
export type EditFailureFault = 'olumi' | 'needs_input';

/**
 * The disclosure carried inside the `ErrorBlock`'s passthrough `details`.
 *
 * ⚠ CONTENT-FREE BY CONSTRUCTION, and that is not incidental — `op.path` and
 * the failing op key are slug-shaped renderings of the USER'S OWN LABELS in
 * this codebase (`fac_delivery_cost`, `goal_revenue`), which is why
 * `firstOperationThatDidNotLand` masks them before they reach a log line. None
 * of them is carried here either: `readable` is fixed copy selected by a closed
 * reason enum, never interpolated from the model, the graph or the op.
 */
export interface EditFailureDisclosure {
  /** The request id, so a user can quote it verbatim when they report this. */
  readonly request_id: string;
  /** Whose fault. Defaults to `olumi`; see {@link EditFailureFault}. */
  readonly fault: EditFailureFault;
  /** Plain English, British, for a person — never a code, never a field name. */
  readonly readable: string;
}

/**
 * Plain-English account of a non-landing refusal, DERIVED from the reason enum
 * rather than from a hand-kept table.
 *
 * ⭐ THE COMPLETENESS GUARD IS THE COMPILER. `NonLandingReason` is a closed
 * union and this switch closes on a `never` arm, so a reason added to
 * `canonicalise-value-ops.ts` without copy here is a TYPE ERROR — it cannot
 * silently fall through to a generic sentence, which is how a "safe default"
 * becomes a claim nobody checked (trap 12: derive, or fail loud).
 *
 * ⚠ EVERY ARM SAYS THE SAME THING ABOUT TWO FACTS, because both are true of
 * every member of this enum and a user needs both: the model was NOT changed,
 * and this is our fault. The arms differ only in what actually happened.
 */
export function readableNonLandingFailure(reason: NonLandingReason): string {
  switch (reason) {
    case 'update_writes_did_not_survive':
      return (
        'Your change named a part of the model that Olumi cannot store in that ' +
        'form, so it was discarded instead of being saved. Nothing in your ' +
        'model has changed. This is a fault on our side, not a problem with ' +
        'what you asked for.'
      );
    case 'added_entity_missing_from_canonical':
      return (
        'Olumi tried to add something to your model and it was not there ' +
        'afterwards, so the whole change was refused rather than saved half ' +
        'done. Nothing in your model has changed. This is a fault on our side.'
      );
    case 'added_edge_missing_from_canonical':
      return (
        'Olumi tried to add a link between two parts of your model and it was ' +
        'not there afterwards, so the whole change was refused rather than ' +
        'saved half done. Nothing in your model has changed. This is a fault ' +
        'on our side.'
      );
    case 'removed_entity_still_present':
      return (
        'Olumi tried to remove something from your model and it was still ' +
        'there afterwards, so the whole change was refused rather than saved ' +
        'half done. Nothing in your model has changed. This is a fault on our ' +
        'side.'
      );
    case 'edge_target_path_unparseable':
      return (
        'Olumi could not work out which link in your model the change was ' +
        'meant for, so it was refused rather than applied to the wrong one. ' +
        'Nothing in your model has changed. This is a fault on our side.'
      );
    case 'unknown_op_kind':
      return (
        'Olumi produced a kind of change it cannot check, so it was refused ' +
        'rather than saved unverified. Nothing in your model has changed. This ' +
        'is a fault on our side.'
      );
    case 'check_threw':
      return (
        'Olumi could not confirm that your change had actually been saved, so ' +
        'it was refused rather than reported as done. Nothing in your model ' +
        'has changed. This is a fault on our side.'
      );
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

/**
 * Build the disclosure for a non-landing refusal.
 *
 * ⚠ `fault` IS FIXED AT `olumi` HERE, and that is a decision rather than an
 * omission. Every member of `NonLandingReason` is a change the user validly
 * asked for that this service then discarded or could not verify — which the
 * fault rule names explicitly as OUR fault. There is no arm of this enum where
 * the user's meaning is the thing in doubt.
 *
 * ⚠ AND `needs_input` DELIBERATELY HAS NO PRODUCER AT THIS SEAM. The genuinely
 * ambiguous edit class — a bare sub-1 value on a factor recorded as an amount —
 * is caught EARLIER by `findAmbiguousScaleValueOps` and ships as a
 * CLARIFICATION (a patch-rejection envelope with `blocks: []` and a suggested
 * action), not as an error block. Attaching an error block to it would be
 * actively wrong: `classifyUserVisibleRefusal`
 * (`orchestrator-v5/compose/user-visible-refusal.ts`) counts an `error` block
 * as a user-visible REFUSAL, and that module states the distinction in its own
 * words — *"A clarify is the product working; a refusal is the product
 * declining. They must not share a counter."* So the member exists in the
 * vocabulary (a field that can only say one thing is indistinguishable from a
 * constant, and would invite exactly the blame-by-elimination default this rule
 * bans), and the ask keeps shipping down its own channel.
 */
export function buildNonLandingDisclosure(
  requestId: string,
  reason: NonLandingReason,
): EditFailureDisclosure {
  return {
    request_id: requestId,
    fault: 'olumi',
    readable: readableNonLandingFailure(reason),
  };
}
