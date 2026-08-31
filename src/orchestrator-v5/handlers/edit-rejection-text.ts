/**
 * Centralised user-facing copy + recovery chips for edit_graph rejections.
 *
 * Strict invariants enforced by tests:
 *   - No raw IDs, operation counts, Zod paths, or schema language in the
 *     `assistantText` (snapshot-tested against a banned-token list).
 *   - Every reason emits at least one recovery chip.
 *   - Chips omit `action_type` so the boundary mapper drops to a plain
 *     prompt-replay button via the chip `message`/`prompt` field
 *     (BOUNDARY_ACTION_TYPES whitelist in edit-graph-dispatch.ts).
 *
 * Used by both the deterministic template path (apply-template.ts) and
 * the LLM path (edit-graph.ts rejection sites).
 */

import type { SuggestedAction } from "../../orchestrator/types.js";

/**
 * ⭐ THESE NAMES ARE CLAIMS ABOUT WHOSE FAILURE IT WAS, and the copy below is
 * only honest if the mapping respects that.
 *
 * `structural_validation` says *the change you asked for could not be made
 * safely* — a statement about the USER'S REQUEST. It was previously also
 * serving `PLOT_UNAVAILABLE` (the analysis service was unreachable) and, via
 * the `default` arm, five system-side failures. On every one of those the
 * product told the user their own change was the problem when the problem was
 * ours. `service_unavailable`, `internal_failure` and `unknown_failure` exist
 * so those failures have somewhere true to go.
 */
export type EditRejectionReason =
  | 'too_many_operations'
  | 'structural_validation'
  | 'parse_failure'
  | 'entity_not_found'
  /** An upstream service we depend on could not be reached. Not the user's doing. */
  | 'service_unavailable'
  /** We failed on our own side after the change was understood. Not the user's doing. */
  | 'internal_failure'
  /** Cause not established. Claims nothing about who or what was at fault. */
  | 'unknown_failure';

export interface EditRejectionResponse {
  assistantText: string;
  suggestedActions: SuggestedAction[];
}

export interface EditRejectionContext {
  /** Optional human-readable label of the missing entity, used by `entity_not_found`. */
  label?: string;
}

export function buildEditRejectionResponse(
  reason: EditRejectionReason,
  ctx: EditRejectionContext = {},
): EditRejectionResponse {
  switch (reason) {
    case 'too_many_operations':
      return {
        assistantText:
          "That change would require quite a few updates to the model. " +
          "Can we break it into smaller steps? I can start by adding the main element, " +
          "then help connect it.",
        suggestedActions: [
          {
            label: 'Add the main element first',
            prompt: 'Add just the main element to start.',
            role: 'facilitator',
          },
        ],
      };
    case 'structural_validation':
      return {
        assistantText:
          "I wasn't able to make that change safely. " +
          "Can you describe what you'd like to add or change in simpler terms?",
        suggestedActions: [
          {
            label: 'Describe what to change',
            prompt: 'Let me describe the change differently.',
            role: 'facilitator',
          },
        ],
      };
    case 'parse_failure':
      return {
        assistantText:
          "I had trouble understanding how to make that edit. " +
          "Could you try describing it differently?",
        suggestedActions: [
          {
            label: 'Try a different description',
            prompt: 'Let me try describing the edit differently.',
            role: 'facilitator',
          },
        ],
      };
    case 'service_unavailable':
      // "nothing in your model has changed" is a VERIFIED claim, not a
      // reassurance: every caller of this reason returns through
      // `buildRejectionResult`, which sets `appliedGraph: null` +
      // `wasRejected: true`; `isSuccessfulAppliedMutation` short-circuits on
      // `wasRejected` at its first check; and the whole persistence region in
      // edit-graph-dispatch.ts sits behind `if (successfulAppliedMutation)`.
      // Nothing is written, so the sentence is true.
      return {
        assistantText:
          "I couldn't reach the analysis service, so nothing in your model has changed. " +
          'Try again in a moment.',
        suggestedActions: [
          {
            label: 'Try that change again',
            prompt: 'Try that change again.',
            role: 'facilitator',
          },
        ],
      };
    case 'internal_failure':
      return {
        assistantText:
          'Something went wrong on my side, so nothing in your model has changed. ' +
          'Try again in a moment — and if it keeps happening, describing the change a ' +
          'different way may help.',
        suggestedActions: [
          {
            label: 'Try that change again',
            prompt: 'Try that change again.',
            role: 'facilitator',
          },
          {
            label: 'Describe it differently',
            prompt: 'Let me describe the change differently.',
            role: 'facilitator',
          },
        ],
      };
    case 'unknown_failure':
      // Deliberately attributes nothing. The only things this copy asserts are
      // the two that hold for EVERY rejection regardless of cause: the change
      // did not go through, and the model is untouched.
      return {
        assistantText:
          "I couldn't complete that change, and nothing in your model has changed. " +
          'Try again in a moment, or describe the change a different way.',
        suggestedActions: [
          {
            label: 'Try that change again',
            prompt: 'Try that change again.',
            role: 'facilitator',
          },
          {
            label: 'Describe it differently',
            prompt: 'Let me describe the change differently.',
            role: 'facilitator',
          },
        ],
      };
    case 'entity_not_found': {
      const safeLabel = (ctx.label ?? '').trim();
      const labelText = safeLabel.length > 0 ? safeLabel : 'that element';
      return {
        assistantText:
          `I can't find '${labelText}' in your model. Would you like me to add it first?`,
        suggestedActions: [
          {
            label: `Add ${labelText} to the model`,
            prompt: `Add ${labelText} to the model.`,
            role: 'facilitator',
          },
        ],
      };
    }
  }
}
