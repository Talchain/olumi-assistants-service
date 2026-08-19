/**
 * V5 qualitative readiness summariser for the post-analysis advice gate.
 *
 * Projects the canonical whole-status payload through the shared readiness
 * recovery authority into a short "what is still open" answer.
 *
 * Hard constraint: never echo, claim, or imply a numeric readiness
 * percentage. DGAI computes its own 0-100 score client-side
 * (`computeReadiness()`); recomputing in CEE would drift from what the
 * user sees on screen. The gate answers "why is this only 35% ready?"
 * with WHAT is still open, not WHY a specific number was produced.
 *
 * Pure projection — no new algorithm, no contract changes. Reads what
 * already flows through the turn envelope.
 */

import type { GraphPatchBlockData } from '../../orchestrator/types.js';
import {
  projectReadinessRecovery,
  type ReadinessRecoveryKind,
} from '../coaching/readiness-recovery.js';

type AnalysisReadyPayload = NonNullable<GraphPatchBlockData['analysis_ready']>;
/**
 * Single canonical recovery item. `description` is user-safe prose produced
 * by `projectReadinessRecovery` from status + blockers.
 *
 * `goal_threshold_missing` is a quarantined compatibility member for historical
 * coaching-state/directive readers and is no longer emitted. `too_few_options`
 * is emitted only by projecting an exact canonical `FEWER_THAN_TWO_OPTIONS`
 * issue; this layer never re-derives option count or whole status. Exact
 * `analysis_ready.status === 'ready'` wins, including the valid
 * ready-without-threshold case.
 */
export interface ReadinessOpenItem {
  readonly kind:
    | 'too_few_options'
    | 'goal_node_missing'
    | 'option_needs_mapping'
    | 'option_needs_encoding'
    | 'goal_threshold_missing'
    | 'model_needs_review';
  readonly description: string;
  readonly option_label?: string;
}

/**
 * What the ContextPack carries. `status` is the canonical
 * `analysis_ready.status` VERBATIM (never re-derived); `open_items` is
 * {@link summariseReadiness}'s projection, which carries both the blocker
 * identity and the user's route out of it.
 */
export interface ContextPackReadinessProjection {
  readonly status: string;
  readonly open_items: readonly ReadinessOpenItem[];
}

export interface ReadinessSummary {
  readonly open_items: readonly ReadinessOpenItem[];
  /**
   * User-facing prose summary. Empty string when nothing is open
   * (caller should not surface a readiness response in that case).
   * The composer is deterministic — same inputs always produce the
   * same string.
   */
  readonly prose: string;
}

function recoveryKindToOpenItemKind(
  recoveryKind: Exclude<ReadinessRecoveryKind, 'run'>,
): ReadinessOpenItem['kind'] {
  switch (recoveryKind) {
    case 'map_option':
    case 'connect_option':
    case 'configure_option':
      return 'option_needs_mapping';
    case 'encode_option':
    case 'provide_value':
    case 'confirm_value':
      return 'option_needs_encoding';
    case 'resolve_model_issue':
    case 'review_constraint':
    case 'review_model':
      return 'model_needs_review';
  }
}

function asDescription(nextStep: string): string {
  return nextStep
    .replace(/^Next,\s*/i, '')
    .replace(/[.!?]+$/u, '');
}

/**
 * Project canonical readiness into one qualitative recovery. Returns an empty
 * `open_items` array (and empty prose) only when the shared projection admits
 * Run from exact status `ready`.
 *
 * REPLACED legacy authority: this function used to independently infer
 * readiness from `options.length`, per-option statuses, and goal-threshold
 * presence. That reconstructed a second whole-model verdict and could both
 * miss a canonical unreachable-factor blocker and invent a threshold blocker
 * on a payload whose canonical status was ready. The shared projection owns
 * both classification and copy now; this layer only maps its recovery family
 * to the stable low-cardinality presentation tag consumed downstream.
 */
export function summariseReadiness(
  analysisReady: AnalysisReadyPayload,
): ReadinessSummary {
  // A multi-blocker assessment is already exhaustive and user-safe. Preserve
  // every item instead of collapsing back to the historical first-blocker
  // projection. The established targeted projection remains byte-for-byte for
  // zero/one issue, so ordinary edits are unaffected.
  const canonicalIssues = Array.isArray(analysisReady.readiness_issues)
    ? analysisReady.readiness_issues.filter(
        (issue) => issue && typeof issue.message === 'string' && issue.message.trim().length > 0,
      )
    : [];
  const hasSpecificStructuralRecovery = canonicalIssues.some(
    (issue) => issue.code === 'NO_GOAL' || issue.code === 'FEWER_THAN_TWO_OPTIONS',
  );
  if (
    (analysisReady.repair_proposal && canonicalIssues.length >= 2)
    || hasSpecificStructuralRecovery
  ) {
    const openItems: ReadinessOpenItem[] = canonicalIssues
      .filter((issue) => issue.repairability === 'human_input_required')
      .map((issue) => ({
        kind:
          issue.code === 'NO_GOAL'
            ? 'goal_node_missing'
            : issue.code === 'FEWER_THAN_TWO_OPTIONS'
              ? 'too_few_options'
              : issue.category === 'option_mapping'
                ? 'option_needs_mapping'
                : issue.category === 'option_values' || issue.category === 'numeric_integrity'
                  ? 'option_needs_encoding'
                  : 'model_needs_review',
        description: asDescription(issue.message),
        ...(issue.option_label ? { option_label: issue.option_label } : {}),
      }));
    return { open_items: openItems, prose: composeReadinessProse(openItems) };
  }
  const recovery = projectReadinessRecovery(analysisReady);
  if (recovery.kind === 'run') return { open_items: [], prose: '' };
  const openItems: ReadinessOpenItem[] = [{
    kind: recoveryKindToOpenItemKind(recovery.kind),
    description: asDescription(recovery.nextStep),
    ...(recovery.optionLabel ? { option_label: recovery.optionLabel } : {}),
  }];
  return { open_items: openItems, prose: composeReadinessProse(openItems) };
}

/**
 * The ContextPack's readiness projection — status + the OPEN ITEMS behind it.
 *
 * WHY THIS EXISTS. The ContextPack already carried a readiness STATUS and a
 * blocker COUNT (`coaching_context.readiness_status` /
 * `.actionable_blocker_count`). It never carried the blocker IDENTITY, so the
 * model could know that something was blocking and still be unable to name
 * WHAT — which is how the assistant came to tell a user *"so nothing there is
 * blocking analysis"* while two factors were the only blockers.
 *
 * NOT A SECOND AUTHORITY. Every value here is taken VERBATIM from the
 * canonical readiness payload and from {@link summariseReadiness} (which
 * itself delegates to `projectReadinessRecovery`). This function classifies
 * nothing, counts nothing, and re-derives nothing — it is a projection, and
 * the moment it starts deciding readiness it becomes the drift this estate
 * keeps paying for.
 *
 * ⚠ `open_items: []` DOES NOT MEAN "MAY RUN". The canonical projection filters
 * out auto-repairable issues, so an empty list co-exists with a non-ready
 * `status`. That is exactly why `status` is carried ALONGSIDE the items rather
 * than a derived boolean: a consumer that reads emptiness as permission
 * re-creates the defect one level down.
 *
 * Returns `null` when there is no canonical payload to project — the caller
 * omits the pack key entirely, so an unknown readiness stays UNKNOWN instead
 * of serialising as an absence of blockers.
 */
export function projectContextPackReadiness(
  analysisReady: AnalysisReadyPayload | null | undefined,
): ContextPackReadinessProjection | null {
  if (!analysisReady) return null;
  const status = analysisReady.status;
  if (typeof status !== 'string' || status.trim().length === 0) return null;
  return {
    status,
    open_items: summariseReadiness(analysisReady).open_items,
  };
}

function composeReadinessProse(items: readonly ReadinessOpenItem[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) {
    return `Here's what's still open before this can run cleanly: ${items[0].description}.`;
  }
  const lead = "Here's what's still open before this can run cleanly:";
  const bullets = items.map((it) => `• ${it.description}`).join('\n');
  return `${lead}\n${bullets}`;
}

/**
 * Predicate variant for the gate's data-availability fallback path.
 * Returns true when the payload is structured enough for the gate to
 * compose meaningful readiness prose. False on empty / missing inputs
 * so the gate can route to the `data_unavailable_for_class` branch.
 */
export function hasSufficientReadinessData(
  analysisReady: AnalysisReadyPayload | null | undefined,
): analysisReady is AnalysisReadyPayload {
  if (!analysisReady) return false;
  if (!Array.isArray(analysisReady.options)) return false;
  return true;
}
