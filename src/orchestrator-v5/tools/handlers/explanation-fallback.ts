/**
 * Deterministic fallback composers for the V5 explanation handlers.
 *
 * Called when Sonnet's `answer_text` is missing, too short, or fails the
 * side-band quality check. Each composer formats existing fields from the
 * already-assembled context pack into a natural paragraph that reads as
 * Olumi explaining — never a bullet list, never a template dump.
 *
 * F.6 invariant: format only. Sort and slice; do NOT calculate new metrics,
 * derive new margins, or synthesise causality. Probabilities are formatted
 * as percentages (existing convention used in user-visible copy throughout
 * V5); no derivation.
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
  StructureProjectionSummary,
} from '../../context/projection-summaries.js';

const PROBABILITY_FRACTION_DIGITS = 0;

function formatProbability(prob: number): string {
  // Probability stored as a 0–1 fraction. Format as a per-cent integer for
  // user-visible copy without introducing new derivation: this matches the
  // convention already used in the rest of V5 user-facing strings.
  const pct = prob * 100;
  return `${pct.toFixed(PROBABILITY_FRACTION_DIGITS)} per cent`;
}

function formatStrength(strength: number): string {
  // Match the strength-display convention used in graph-compact: two
  // significant decimals, signed.
  const sign = strength < 0 ? '-' : '';
  return `${sign}${Math.abs(strength).toFixed(2)}`;
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

  sentences.push(
    `${leading.label} performs best, with a probability of ${formatProbability(leading.probability)}.`,
  );

  if (projection.runner_up && projection.margin_pp !== null) {
    sentences.push(
      `That is ahead of ${projection.runner_up.label} by about ${Math.abs(
        projection.margin_pp,
      ).toFixed(0)} percentage points, so the lead is meaningful rather than marginal.`,
    );
  } else if (projection.runner_up) {
    sentences.push(
      `${projection.runner_up.label} sits in second place, with a probability of ${formatProbability(projection.runner_up.probability)}.`,
    );
  }

  if (projection.top_drivers.length > 0) {
    const driverLabels = projection.top_drivers
      .slice(0, 2)
      .map((d) => d.factor_label);
    if (driverLabels.length === 1) {
      sentences.push(
        `The result is driven mainly by ${driverLabels[0]}, which has the largest sensitivity in the model.`,
      );
    } else {
      sentences.push(
        `The result is driven mainly by ${driverLabels[0]} and ${driverLabels[1]}, which together carry the largest sensitivity in the model.`,
      );
    }
  }

  if (projection.robustness_band) {
    sentences.push(
      `The robustness band is ${projection.robustness_band}, so this view should hold under reasonable variation.`,
    );
  }

  if (projection.staleness_reason) {
    sentences.push(
      'Treat the figures as directional rather than definitive, since the analysis is loaded from a prior run with unknown freshness.',
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

  sentences.push(
    `${leading.label} is currently performing best, with a probability of ${formatProbability(leading.probability)}.`,
  );

  if (projection.runner_up && projection.margin_pp !== null) {
    sentences.push(
      `For ${projection.runner_up.label} to overtake it, the lead of about ${Math.abs(
        projection.margin_pp,
      ).toFixed(0)} percentage points would need to close.`,
    );
  } else if (projection.runner_up) {
    sentences.push(
      `${projection.runner_up.label} is the most likely contender to overtake it.`,
    );
  }

  if (projection.top_drivers.length > 0) {
    const driverLabels = projection.top_drivers.slice(0, 2).map((d) => d.factor_label);
    if (driverLabels.length === 1) {
      sentences.push(
        `Movement on ${driverLabels[0]} would shift this result the most, since it carries the largest sensitivity.`,
      );
    } else {
      sentences.push(
        `Movement on ${driverLabels[0]} or ${driverLabels[1]} would shift this result the most, since they carry the largest sensitivity.`,
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
 * `explain_from_structure` fallback — no analysis required. Format the
 * structure projection into prose: goal, top causal links, named-factor
 * pathways if the user mentioned a factor by name.
 */
export function composeExplainFromStructureFallback(
  projection: StructureProjectionSummary | undefined,
): string {
  if (!projection) {
    return 'The model structure could not be summarised from the available data. Would you like to run the analysis?';
  }

  const sentences: string[] = [];

  if (
    projection.named_factor_label &&
    projection.named_factor_pathways.length > 0
  ) {
    const factor = projection.named_factor_label;
    const pathways = projection.named_factor_pathways.slice(0, 2);
    const path = pathways
      .map((p) =>
        p.label_from === factor
          ? `${p.label_to} (strength ${formatStrength(p.strength)})`
          : `${p.label_from} (strength ${formatStrength(p.strength)})`,
      )
      .join(' and ');
    if (projection.goal_label) {
      sentences.push(
        `${factor} connects to ${path}, which feeds into ${projection.goal_label}.`,
      );
    } else {
      sentences.push(`${factor} connects to ${path} in the model.`);
    }
  } else if (projection.top_causal_links.length > 0) {
    const top = projection.top_causal_links.slice(0, 2);
    const linkText = top
      .map(
        (l) =>
          `${l.label_from} drives ${l.label_to} at strength ${formatStrength(l.strength)}`,
      )
      .join(', and ');
    if (projection.goal_label) {
      sentences.push(
        `Looking at the model, the strongest direct links shaping ${projection.goal_label} are ${linkText}.`,
      );
    } else {
      sentences.push(`The strongest direct links in the model are ${linkText}.`);
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

  sentences.push('Would you like to run the analysis to see how the options compare?');

  return sentences.join(' ');
}
