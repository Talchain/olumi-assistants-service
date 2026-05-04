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

export type EditRejectionReason =
  | 'too_many_operations'
  | 'structural_validation'
  | 'parse_failure'
  | 'entity_not_found';

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
