/**
 * Deterministic fallback composers for the V5 explanation handlers.
 *
 * Called when Sonnet's `answer_text` is missing, too short, or fails the
 * side-band quality check. Each composer formats existing fields from the
 * already-assembled context pack into a natural paragraph that reads as
 * Olumi explaining — never a bullet list, never a template dump.
 *
 * F.6 invariant: format only. Sort and slice; do NOT calculate new metrics,
 * derive new margins, or synthesise causality. Numeric values are surfaced
 * via the centralised formatters in `format-analysis-value.ts` (Phase 2
 * workstream C): probabilities render as percentages, margins as
 * percentage points, sensitivities and edge strengths pass through raw
 * (their range is not normalised; surfacing them as percentages would
 * misrepresent the underlying signal).
 *
 * Copy rules:
 *  - Sentence case, British English.
 *  - No em dashes (use commas or full stops).
 *  - No tone words like winner or recommended; say leading option, performs best.
 *  - No internal vocabulary; never reference graph internals or pipeline stages.
 *  - One next-step nudge at the end so the response is actionable.
 */

import type {
  AnalysisProjectionSummary,
  AnalysisProjectionDriver,
  StructureProjectionSummary,
} from '../../context/projection-summaries.js';
import {
  formatPercentagePoints,
  formatProbability,
} from '../../format/format-analysis-value.js';

/**
 * Convert a raw sensitivity coefficient into calm, readable prose.
 *
 * The previous `formatRawNumber` passthrough surfaced values like
 * `-0.7346938775510203` directly to the user, which the brief lists as
 * forbidden output. Sensitivity coefficients are unitless signed
 * magnitudes; the natural user-facing rendering is bucketed magnitude
 * plus a plain-English direction.
 *
 * Buckets (calm business language):
 *   |v| < 0.02         → "has little effect on the result"
 *   0.02 ≤ |v| < 0.1   → "slightly {strengthens|weakens} the lead"
 *   0.1  ≤ |v| < 0.3   → "moderately ..."
 *   0.3  ≤ |v| < 0.6   → "strongly ..."
 *   |v| ≥ 0.6          → "very strongly ..."
 *
 * Direction maps to the leading-option framing the rest of the prose
 * already uses: positive sensitivity strengthens the lead, negative
 * weakens it. We do not say "up/down" because the underlying value
 * is not on a probability scale and a direction word without a frame
 * of reference is misleading.
 *
 * Telemetry (where it exists for sensitivity values) retains the raw
 * number; this helper only governs USER-FACING prose.
 */
export function formatSensitivityDirection(value: number): string {
  const absV = Math.abs(value);
  if (absV < 0.02) return 'has little effect on the result';
  let magnitude: string;
  if (absV < 0.1) magnitude = 'slightly';
  else if (absV < 0.3) magnitude = 'moderately';
  else if (absV < 0.6) magnitude = 'strongly';
  else magnitude = 'very strongly';
  return value > 0
    ? `${magnitude} strengthens the lead`
    : `${magnitude} weakens the lead`;
}

function formatDriver(d: AnalysisProjectionDriver): string {
  return d.factor_label;
}

/**
 * Bucketed magnitude for edge strengths in structural explanations.
 * Same calm business vocabulary as `formatSensitivityDirection`,
 * minus the direction (edge strengths are connection magnitudes,
 * not effect-on-leading-option signed quantities).
 */
export function formatEdgeStrengthMagnitude(value: number): string {
  const absV = Math.abs(value);
  if (absV < 0.1) return 'weak';
  if (absV < 0.3) return 'moderate';
  if (absV < 0.6) return 'strong';
  return 'very strong';
}

/**
 * `explain_results` happy-path fallback — analysis exists, Sonnet's
 * answer_text was unusable. Format the projection summary into prose.
 */
export function composeExplainResultsFallback(
  projection: AnalysisProjectionSummary | undefined,
): string {
  if (!projection || !projection.leading_option) {
    // Defensive — the handler should not reach this branch without a
    // projection because the precondition bypass already guards the
    // no-analysis case. If the assembler produced no leading option even
    // with an analysis fact present, fall through to a generic line.
    return 'The analysis has finished, but the leading option could not be summarised from the available data. Would you like to explore what would change this result?';
  }

  const leading = projection.leading_option;
  const sentences: string[] = [];

  // Staleness caveat is no longer composed here. The handler's
  // `applyStalenessPrefix` helper prepends it to the final assistant_text
  // (whether this fallback or Sonnet's answer_text) when the analysis
  // projection carries a `staleness_reason`. Keeping the composer free of
  // the caveat sentence avoids duplication when prefix + composer both
  // ran, and keeps prose ordering decisions in one place.

  sentences.push(
    `${leading.label} performs best, with a probability of ${formatProbability(leading.probability)}.`,
  );

  if (projection.runner_up && projection.margin_pp !== null) {
    sentences.push(
      `That is ahead of ${projection.runner_up.label} by ${formatPercentagePoints(
        projection.margin_pp,
      )}, so the lead is meaningful rather than marginal.`,
    );
  } else if (projection.runner_up) {
    sentences.push(
      `${projection.runner_up.label} sits in second place, with a probability of ${formatProbability(projection.runner_up.probability)}.`,
    );
  }

  if (projection.top_drivers.length > 0) {
    const drivers = projection.top_drivers.slice(0, 2);
    if (drivers.length === 1) {
      const d = drivers[0]!;
      sentences.push(
        `The result is driven mainly by ${formatDriver(d)}, which ${formatSensitivityDirection(d.sensitivity_value)}.`,
      );
    } else {
      const a = drivers[0]!;
      const b = drivers[1]!;
      sentences.push(
        `The result is driven mainly by ${formatDriver(a)}, which ${formatSensitivityDirection(a.sensitivity_value)}, and ${formatDriver(b)}, which ${formatSensitivityDirection(b.sensitivity_value)}.`,
      );
    }
  }

  if (projection.robustness_band) {
    sentences.push(
      `The robustness band is ${projection.robustness_band}, so this view should hold under reasonable variation.`,
    );
  }

  sentences.push('Would you like to explore what would change this result?');

  return sentences.join(' ');
}

/**
 * `what_would_flip` happy-path fallback — analysis exists, answer_text
 * was unusable. Cite margins, top drivers, and robustness; gesture at
 * "what could change the outcome" without inventing scenarios.
 */
export function composeWhatWouldFlipFallback(
  projection: AnalysisProjectionSummary | undefined,
): string {
  if (!projection || !projection.leading_option) {
    return 'The analysis has finished, but the sensitivity picture could not be summarised from the available data. Would you like to run the analysis again?';
  }

  const leading = projection.leading_option;
  const sentences: string[] = [];

  // Staleness caveat is no longer composed here — see the parallel note in
  // composeExplainResultsFallback. The handler's applyStalenessPrefix
  // helper prepends it to the final assistant_text when staleness_reason
  // is set on the projection.

  sentences.push(
    `${leading.label} is currently performing best, with a probability of ${formatProbability(leading.probability)}.`,
  );

  if (projection.runner_up && projection.margin_pp !== null) {
    sentences.push(
      `For ${projection.runner_up.label} to overtake it, the lead of ${formatPercentagePoints(
        projection.margin_pp,
      )} would need to close.`,
    );
  } else if (projection.runner_up) {
    sentences.push(
      `${projection.runner_up.label} is the most likely contender to overtake it.`,
    );
  }

  if (projection.top_drivers.length > 0) {
    const drivers = projection.top_drivers.slice(0, 2);
    if (drivers.length === 1) {
      const d = drivers[0]!;
      sentences.push(
        `Movement on ${formatDriver(d)} would shift this result the most. Today it ${formatSensitivityDirection(d.sensitivity_value)}.`,
      );
    } else {
      const a = drivers[0]!;
      const b = drivers[1]!;
      sentences.push(
        `Movement on ${formatDriver(a)} or ${formatDriver(b)} would shift this result the most. ${formatDriver(a)} ${formatSensitivityDirection(a.sensitivity_value)}; ${formatDriver(b)} ${formatSensitivityDirection(b.sensitivity_value)}.`,
      );
    }
  }

  if (projection.robustness_band) {
    sentences.push(
      `The robustness band is currently ${projection.robustness_band}, so smaller changes are unlikely to flip the outcome on their own.`,
    );
  }

  sentences.push('Which of those would you like to explore changing?');

  return sentences.join(' ');
}

/**
 * `explain_from_structure` fallback — no analysis required. Sonnet rarely
 * populates `answer_text` for generic structural prompts ("what factor
 * most influences my decision?"); this composer therefore acts as the
 * primary user-facing prose for those turns. Reads as Olumi explaining
 * causal structure, not a system reporting.
 *
 * Two prose branches:
 *  - **Named-factor branch** when the user mentioned a factor by label:
 *    open with the factor and its strongest pathway, preserving the F.6
 *    over-claim guard so we only assert reach-to-goal when a cited
 *    pathway actually terminates at the goal node.
 *  - **Generic branch** when no factor was named: open with the goal and
 *    walk through the strongest 1-2 direct causal links shaping it.
 *
 * The next-step nudge ("Running the analysis would show…") is only
 * appended when `options.canRunAnalysis === true`. The handler should
 * pass `invocation.analysisReady?.status === 'ready'` so Sonnet's
 * suggestion stays grounded in the structural-readiness signal — we do
 * not nudge the user toward an analysis the precondition will not let
 * run.
 *
 * Length target: 300–600 chars on a typical 5-factor / 4-option graph;
 * sparse graphs (1 factor / 1 option) may produce shorter prose, which is
 * fine — do not pad.
 */
export interface ExplainFromStructureFallbackOptions {
  readonly canRunAnalysis?: boolean;
}

export function composeExplainFromStructureFallback(
  projection: StructureProjectionSummary | undefined,
  options?: ExplainFromStructureFallbackOptions,
): string {
  const canRunAnalysis = options?.canRunAnalysis === true;
  if (!projection) {
    // No projection at all — extremely thin context. Give a neutral one-
    // sentence response and only nudge toward analysis when readiness says
    // it's actually runnable.
    return canRunAnalysis
      ? 'The model structure could not be summarised from the available data. Would you like to run the analysis?'
      : 'The model structure could not be summarised from the available data.';
  }

  const sentences: string[] = [];

  if (
    projection.named_factor_label &&
    projection.named_factor_pathways.length > 0
  ) {
    const factor = projection.named_factor_label;
    const pathways = projection.named_factor_pathways.slice(0, 2);

    // Over-claim guard: only assert the named factor "feeds into" the goal
    // when at least one cited pathway actually terminates at the goal node
    // (1-hop, structurally verified from the projection). If the named
    // factor is only adjacent to sibling factors or other non-goal nodes,
    // describe the structural connection without claiming it reaches the
    // goal — multi-hop derivation crosses the F.6 line.
    const reachesGoal =
      projection.goal_label !== null &&
      pathways.some(
        (p) =>
          (p.label_from === factor && p.label_to === projection.goal_label) ||
          (p.label_to === factor && p.label_from === projection.goal_label),
      );

    const top = pathways[0];
    const otherEnd =
      top.label_from === factor ? top.label_to : top.label_from;
    sentences.push(
      `${factor} shapes this decision through its causal links in the model.`,
    );
    if (reachesGoal && projection.goal_label) {
      sentences.push(
        `Its strongest direct influence runs to ${projection.goal_label} as a ${formatEdgeStrengthMagnitude(top.strength)} link, meaning movement here would have the most structural effect on your goal.`,
      );
    } else {
      sentences.push(
        `Its strongest direct connection is to ${otherEnd} as a ${formatEdgeStrengthMagnitude(top.strength)} link, so changes there would propagate first.`,
      );
    }
    if (pathways.length > 1) {
      const second = pathways[1];
      const secondOther =
        second.label_from === factor ? second.label_to : second.label_from;
      sentences.push(
        `A second pathway runs to ${secondOther} as a ${formatEdgeStrengthMagnitude(second.strength)} link, giving you a secondary lever if the first proves hard to move.`,
      );
    }
  } else if (projection.top_causal_links.length > 0) {
    const top = projection.top_causal_links.slice(0, 2);
    const goalIntro = projection.goal_label
      ? `Your decision around ${projection.goal_label} is shaped by several causal mechanisms.`
      : 'This decision is shaped by several causal mechanisms.';
    sentences.push(goalIntro);
    const first = top[0];
    sentences.push(
      `${first.label_from} has the strongest visible direct influence on ${first.label_to} via a ${formatEdgeStrengthMagnitude(first.strength)} link, meaning changes here would have the most structural effect.`,
    );
    if (top.length > 1) {
      const second = top[1];
      sentences.push(
        `${second.label_from} also contributes meaningfully through a ${formatEdgeStrengthMagnitude(second.strength)} direct link to ${second.label_to}, so it is worth keeping in view as a secondary lever.`,
      );
    }
  } else if (projection.goal_label) {
    sentences.push(
      `Your goal in this model is ${projection.goal_label}, but no causal links are recorded yet to drive it.`,
    );
  } else {
    sentences.push('The model structure is currently empty.');
  }

  if (projection.factor_count > 0 && projection.option_count > 0) {
    sentences.push(
      `Across the model there are ${projection.factor_count} factors influencing ${projection.option_count} ${
        projection.option_count === 1 ? 'option' : 'options'
      }.`,
    );
  }

  if (canRunAnalysis) {
    sentences.push(
      'Running the analysis would show how these structural relationships translate into option-level probabilities.',
    );
  }

  return sentences.join(' ');
}
