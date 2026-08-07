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
import type { PatchBudgetDimension } from "./tools/patch-budget-limits.js";

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
  /**
   * ROADMAP 2.655 — WHICH budget was actually breached. Supplied by the
   * enforcer, which is the only thing that knows; the copy says it in plain
   * words and never in numbers.
   *
   * ⚠ THIS IS NOT `PatchBudgetResult.breachedLimit`, AND THE DIFFERENCE MATTERS.
   * That field answers a narrower question (which OPTION-ADDITION BUCKET
   * breached) and is measurably incomplete for this purpose: on a plain
   * edge-only breach with no option addition it stays `null`, and when node AND
   * edge both breach under an option addition it reports only the edge bucket.
   * Copy driven off it would go silent exactly where it needed to speak. This
   * field is derived from the two allow/deny verdicts themselves, so it cannot
   * disagree with what was enforced.
   */
  breached_dimensions?: readonly PatchBudgetDimension[];
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

/**
 * ⭐⭐ ROADMAP 2.655 — WHAT THE USER IS TOLD WHEN THE COMPLEXITY BUDGET REFUSES.
 *
 * ── THE SENTENCE THIS REPLACES, VERBATIM (walk 2.634, 2026-08-07) ──────────
 *   "I tried to make that change, but it would require 6 node operations and 6
 *    edge operations — more than is safe in a single edit (limit: 4 node ops,
 *    8 edge ops). Consider breaking this into smaller steps ..."
 *
 * Three faults, and the fix addresses each:
 *   1. TWO INTERNAL CAPS the user cannot act on, in engineering vocabulary.
 *   2. THE WRONG CONSTRAINT NAMED. Six edge operations were UNDER the eight it
 *      quotes; only the node budget tripped, and the copy never said so. A
 *      user who reads it removes links that were never the problem.
 *   3. THE WORK PUSHED BACK. "Consider breaking this into smaller steps" asks
 *      the user to compute a decomposition the server can compute itself.
 *
 * ── WHY THE COUNTS GO ENTIRELY, NOT JUST THE CAPS ─────────────────────────
 * A count without its cap ("it would require six additions") is no more
 * actionable than the pair, because the user still has no way to know what
 * number would have been accepted. What IS actionable is the SHAPE of a
 * smaller ask, so that is what the sentence names.
 *
 * ── ⚠ THIS COPY IS NOT THE END OF THE STORY, AND MUST NOT READ AS IF IT IS ─
 * On the live V5 path a budget refusal is followed by the structural-edit tool,
 * which splits the request and proposes the first part. This sentence is what
 * ships when that second path also declines, so it must stand alone AND must
 * never contradict a split that did fire. It therefore claims nothing about
 * what was or was not attempted beyond the refusal itself.
 */
function budgetExceededText(ctx: PatchRejectionContext): string {
  const dims = new Set(ctx.breached_dimensions ?? []);
  const subject =
    dims.has('node') && dims.has('edge')
      ? 'more separate additions, and more links between them, than'
      : dims.has('node')
        ? 'more separate additions than'
        : dims.has('edge')
          ? 'more links between the pieces of your model than'
          : 'more than';
  return (
    `That is ${subject} I can put into a single change, so I have not made it. ` +
    'Ask me for one part of it and I will do that part: the changes for a ' +
    'single option, for example, or just the new factors without the links.'
  );
}

function buildAssistantText(ctx: PatchRejectionContext): string {
  if (ctx.reason === 'budget_exceeded') {
    // ROADMAP 2.655 — the counts, the caps and the appended `detail` have all
    // left this sentence. `detail` stays on the context because it is still
    // the internal `failure_message` the enforcer logs; it is no longer USER
    // copy, which is why the previous version's "Consider breaking this into
    // smaller steps" is gone from the wire.
    //
    // ⚠ HISTORICAL NOTE, KEPT DELIBERATELY (ROADMAP 2.624). The cap numbers
    // here were once hardcoded `?? 3` / `?? 4` — a fourth copy of the budget,
    // and a WRONG one, since the caps are 4 and 8. That stale "4-edge limit"
    // propagated into a comment in `edit-graph.ts` and survived for months.
    // Deriving them from the enforcer's leaf fixed the drift; 2.655 removes
    // the reason to name them at all. The lesson is why the note stays: a
    // number in user copy is a mirror of an internal rule, and the safest
    // mirror is the one that is not there.
    return budgetExceededText(ctx);
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
