/**
 * Patch Rejection Helper
 *
 * Produces a consistent OrchestratorResponseEnvelope when an edit_graph
 * patch is rejected (budget exceeded or structural violation).
 *
 * Never includes a GraphPatchBlock. Always includes 1–2 suggested_actions.
 * Logs at warn level with structured fields.
 *
 * Used by both the budget check (Task 3) and the structural validator (Task 2).
 */

import { log } from "../utils/telemetry.js";
import type {
  OrchestratorResponseEnvelope,
  SuggestedAction,
  ConversationContext,
} from "./types.js";
import { assembleEnvelope } from "./envelope.js";

// ============================================================================
// Types
// ============================================================================

export interface PatchRejectionContext {
  reason: 'budget_exceeded' | 'structural_violation';
  /** Human-readable explanation of why the patch was rejected. */
  detail: string;
  /** Translated structural violation codes (for structural_violation reason). */
  violations?: string[];
  /** Node operation count (for budget_exceeded reason). */
  node_ops?: number;
  /** Edge operation count (for budget_exceeded reason). */
  edge_ops?: number;
  /** Effective node budget used for enforcement (for budget_exceeded reason). */
  max_node_ops?: number;
  /** Effective edge budget used for enforcement (for budget_exceeded reason). */
  max_edge_ops?: number;
  /** 1–2 suggested follow-up actions. */
  suggested_actions: SuggestedAction[];
}

// ============================================================================
// Builder
// ============================================================================

/**
 * Build a patch rejection envelope.
 *
 * Returns a valid OrchestratorResponseEnvelope with:
 * - assistant_text explaining what was attempted and why it was blocked
 * - No GraphPatchBlock
 * - suggested_actions offering alternatives
 */
export function buildPatchRejectionEnvelope(
  ctx: PatchRejectionContext,
  turnId: string,
  context: ConversationContext,
): OrchestratorResponseEnvelope {
  log.warn(
    {
      reason: ctx.reason,
      detail: ctx.detail,
      violations: ctx.violations,
      node_ops: ctx.node_ops,
      edge_ops: ctx.edge_ops,
    },
    'edit_graph patch rejected by pre-validation',
  );

  const assistantText = buildAssistantText(ctx);

  return assembleEnvelope({
    turnId,
    assistantText,
    blocks: [],
    suggestedActions: ctx.suggested_actions,
    context,
  });
}

// ============================================================================
// Assistant Text
// ============================================================================

function buildAssistantText(ctx: PatchRejectionContext): string {
  if (ctx.reason === 'budget_exceeded') {
    const maxNodes = ctx.max_node_ops ?? 3;
    const maxEdges = ctx.max_edge_ops ?? 4;
    return (
      `I tried to make that change, but it would require ${ctx.node_ops ?? '?'} node operations ` +
      `and ${ctx.edge_ops ?? '?'} edge operations — more than is safe in a single edit ` +
      `(limit: ${maxNodes} node ops, ${maxEdges} edge ops). ${ctx.detail}`
    );
  }

  // structural_violation — never surface raw violation text to the user.
  // Violations are logged at warn level above and stored in the block's
  // rejection.reason for debugging, but must not appear in assistant_text.
  if (ctx.violations?.length) {
    log.warn({ violations: ctx.violations }, 'edit_graph structural violations suppressed from user-facing text');
  }

  return "I wasn't able to apply that change — it would create an inconsistency in the model structure. You could try describing the change differently, or I can rebuild the model from an updated brief.";
}
