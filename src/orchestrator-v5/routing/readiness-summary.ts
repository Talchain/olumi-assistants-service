/**
 * V5 qualitative readiness summariser for the post-analysis advice gate.
 *
 * Projects the existing `computeStructuralReadiness` output into a short
 * prose list of "what is still open" before the graph can run cleanly.
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

type AnalysisReadyPayload = NonNullable<GraphPatchBlockData['analysis_ready']>;
type AnalysisReadyOption = AnalysisReadyPayload['options'][number];

/**
 * Single open item with a class so callers can group / count. `description`
 * is user-safe prose — quoted user labels and intervention names only.
 */
export interface ReadinessOpenItem {
  readonly kind:
    | 'too_few_options'
    | 'option_needs_mapping'
    | 'option_needs_encoding'
    | 'goal_threshold_missing';
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

const MIN_OPTION_COUNT = 2;

function describeOption(opt: AnalysisReadyOption): string {
  const label = opt.label?.trim();
  if (label && label.length > 0) return `"${label}"`;
  return 'one of the options';
}

/**
 * Project a `computeStructuralReadiness` payload into a qualitative
 * summary. Returns an empty `open_items` array (and empty prose) when
 * the payload status is `'ready'` — the caller should treat that as
 * "no readiness coaching to surface" and fall through rather than
 * emit a misleading "all set" message.
 */
export function summariseReadiness(
  analysisReady: AnalysisReadyPayload,
): ReadinessSummary {
  const openItems: ReadinessOpenItem[] = [];

  if (analysisReady.options.length < MIN_OPTION_COUNT) {
    openItems.push({
      kind: 'too_few_options',
      description: `you need at least ${MIN_OPTION_COUNT} options before the analysis can compare them`,
    });
  }

  for (const opt of analysisReady.options) {
    if (opt.status === 'needs_user_mapping') {
      openItems.push({
        kind: 'option_needs_mapping',
        description: `${describeOption(opt)} isn't connected to any factors yet`,
        option_label: opt.label,
      });
    } else if (opt.status === 'needs_encoding') {
      openItems.push({
        kind: 'option_needs_encoding',
        description: `${describeOption(opt)} is connected to factors but has no numeric values set`,
        option_label: opt.label,
      });
    }
  }

  if (analysisReady.goal_threshold == null) {
    openItems.push({
      kind: 'goal_threshold_missing',
      description:
        "the goal node doesn't have a measurable success threshold set",
    });
  }

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
