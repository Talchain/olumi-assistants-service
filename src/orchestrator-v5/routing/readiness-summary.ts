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
 * `too_few_options` and `goal_threshold_missing` are quarantined compatibility
 * members for historical coaching-state/directive readers. This producer no
 * longer emits them: option count and threshold presence are not independent
 * whole-status authorities. Exact `analysis_ready.status === 'ready'` wins,
 * including the valid ready-without-threshold case.
 */
export interface ReadinessOpenItem {
  readonly kind:
    | 'too_few_options'
    | 'option_needs_mapping'
    | 'option_needs_encoding'
    | 'goal_threshold_missing'
    | 'model_needs_review';
  readonly description: string;
  readonly option_label?: string;
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
  const recovery = projectReadinessRecovery(analysisReady);
  if (recovery.kind === 'run') return { open_items: [], prose: '' };
  const openItems: ReadinessOpenItem[] = [{
    kind: recoveryKindToOpenItemKind(recovery.kind),
    description: asDescription(recovery.nextStep),
    ...(recovery.optionLabel ? { option_label: recovery.optionLabel } : {}),
  }];
  return { open_items: openItems, prose: composeReadinessProse(openItems) };
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
