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
  /**
   * Capability 2A (flag-gated): deterministic, structural-only next-step copy
   * for the unsupported add-risk / reachability rejection class. When present
   * (set ONLY by the flag-gated caller for that one class) it REPLACES the
   * generic structural-violation assistant_text. Absent on every other
   * rejection, so the default copy is byte-identical to before.
   */
  structural_guidance?: string;
  /**
   * Lane 22 — claim-safe, CALLER-VETTED actionable reasons for a
   * structural_violation rejection. The caller must populate this ONLY
   * from the user-facing VIOLATION_MESSAGES catalogue (never raw
   * validator detail — that stays in `violations`, which remains
   * suppressed from user copy exactly as before). When present and
   * non-empty, the first two distinct reasons are surfaced in
   * assistant_text so the user learns WHY the change was declined
   * ("This change would leave a node that cannot reach the goal.")
   * instead of only vague copy — the live 2026-07-07 session ended on
   * this suppression.
   */
  user_safe_reasons?: string[];
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

  // Capability 2A (flag-gated caller): for the unsupported add-risk /
  // reachability class ONLY, the caller supplies deterministic, structural-only
  // next-step copy that replaces the generic line. Absent for every other
  // rejection → the generic copy below is byte-identical to before.
  if (typeof ctx.structural_guidance === 'string' && ctx.structural_guidance.length > 0) {
    return ctx.structural_guidance;
  }

  // Lane 22 — surface the claim-safe actionable reason(s) when the caller
  // vetted them (VIOLATION_MESSAGES members only). Distinct reasons, first
  // two, replacing the vague generic line. Raw `violations` remain
  // suppressed above regardless.
  if (Array.isArray(ctx.user_safe_reasons) && ctx.user_safe_reasons.length > 0) {
    const distinct = [
      ...new Set(
        ctx.user_safe_reasons.filter((r) => typeof r === 'string' && r.length > 0),
      ),
    ].slice(0, 2);
    if (distinct.length > 0) {
      return (
        "I wasn't able to apply that change. "
        + distinct.join(' ')
        + ' You could describe the change differently, or I can rebuild the model from an updated brief.'
      );
    }
  }

  return "I wasn't able to apply that change — it would create an inconsistency in the model structure. You could try describing the change differently, or I can rebuild the model from an updated brief.";
}
