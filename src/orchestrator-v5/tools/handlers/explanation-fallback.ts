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
import { bandFromMagnitude } from '../../format/influence-bands.js';
import {
  formatSensitivityDirection,
  hasMaterialInfluence,
} from '../../format/sensitivity-phrases.js';
import {
  describeRobustnessBand,
  isNearTieByMargin,
  isRawFragile,
  quoteLabel,
  type RawRobustnessSignals,
} from '../../coaching/robustness-honesty.js';
import type { FlipSummary } from '../../compose/flip-proposal.js';

export { formatSensitivityDirection };

/**
 * Canonical robustness bands considered "stable" enough that the softened
 * "smaller changes are less likely to flip the outcome" sentence reads as
 * honest, provided the result is not also a near-tie. Mirrors the
 * canonical labels produced by `mapRobustnessToCanonical` in
 * `analysis-compact.ts`. The chip-click path receives the same canonical
 * band via the projection summary, so a Set is enough — no extra mapping
 * needed here. `'moderate'` is deliberately excluded so moderate-band
 * results get balanced copy that does not overclaim stability.
 */
const STABLE_ROBUSTNESS_BANDS: ReadonlySet<string> = new Set([
  'stable',
  'highly_stable',
]);

/**
 * Canonical `'fragile'` band — when the projection already canonicalises
 * the upstream verdict to fragile, treat that as a fragility signal even
 * when raw `enrichment.robustness` is unavailable (older facts, dropped
 * envelope). Kept as a tiny named constant so the equality check below
 * reads intentionally rather than as a magic string.
 */
const CANONICAL_FRAGILE_BAND = 'fragile';

function formatDriver(d: AnalysisProjectionDriver): string {
  return d.factor_label;
}

/**
 * DGAI #341 claim guard: drivers that may be NAMED in the superlative
 * sentences below ("driven mainly by …", "would shift this result the
 * most"). A near-zero driver renders as "has little effect on the lead",
 * which self-contradicts a "most/mainly" claim in the same breath (the live
 * #341 wire). Omit such drivers from the sentence — never substitute a
 * weaker candidate's band for an inflated claim. The projection is already
 * influence-ranked upstream, so filtering preserves rank order.
 */
function nameableDrivers(
  drivers: readonly AnalysisProjectionDriver[],
): readonly AnalysisProjectionDriver[] {
  return drivers.filter((d) => hasMaterialInfluence(d.sensitivity_value));
}

/**
 * Bucketed magnitude for edge strengths in structural explanations.
 * Delegates to `bandFromMagnitude` so structural prose, analysis prose,
 * and the upstream display-safe projection all read from the same
 * thresholds and vocabulary.
 *
 * Returns the bare adjective (`weak | moderate | strong | very strong`)
 * because edge-strength sentences compose it with a noun ("a {band}
 * link") rather than a verb-phrase.
 */
export function formatEdgeStrengthMagnitude(value: number): string {
  if (!Number.isFinite(value)) return 'weak';
  return bandFromMagnitude(Math.abs(value));
}

/**
 * `explain_results` happy-path fallback — analysis exists, Sonnet's
 * answer_text was unusable. Format the projection summary into prose.
 *
 * `validationBeatText` (V5-LANE-B-STRUCTURAL-01): the pre-composed
 * "what to validate" sentence from `coaching/validation-priority.ts`,
 * inserted before the closing nudge so the fallback carries the same beat
 * as the Sonnet-valid path. The handler owns composing it (it also reports
 * the mechanism); this composer only places it. No dedup is needed here —
 * this deterministic narrative never states a validation priority itself.
 * Null/absent → omitted (no-signal turns and legacy call sites).
 */
export function composeExplainResultsFallback(
  projection: AnalysisProjectionSummary | undefined,
  validationBeatText?: string | null,
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
    if (isNearTieByMargin(projection.margin_pp, null)) {
      // Near-tie honesty: a near-zero / sub-threshold margin is NOT a
      // meaningful lead. Mirror composeWhatWouldFlipFallback's
      // "effectively tied" framing so the explain and flip fallbacks never
      // contradict — the S4 case where flip correctly said "effectively
      // tied" while explain said "ahead by 0 percentage points, so the lead
      // is meaningful rather than marginal." The margin number is
      // deliberately not cited here: "0 percentage points" reads as a non
      // sequitur beside a closeness statement. Margin-only on purpose (no
      // rawRobustness param) to keep this fix isolated to the deterministic
      // composer; the wider raw-signal near-tie override stays the flip
      // composer's concern.
      sentences.push(
        `${leading.label} and ${projection.runner_up.label} are effectively tied, so the lead is too close to call without firming up the key assumptions.`,
      );
    } else {
      sentences.push(
        `That is ahead of ${projection.runner_up.label} by ${formatPercentagePoints(
          projection.margin_pp,
        )}, so the lead is meaningful rather than marginal.`,
      );
    }
  } else if (projection.runner_up) {
    sentences.push(
      `${projection.runner_up.label} sits in second place, with a probability of ${formatProbability(projection.runner_up.probability)}.`,
    );
  }

  // DGAI #341: only materially-influential drivers may carry the "driven
  // mainly by" claim — a near-zero driver would self-contradict ("driven
  // mainly by X, which has little effect on the lead"). Empty ⇒ omit the
  // sentence entirely.
  const explainDrivers = nameableDrivers(projection.top_drivers);
  if (explainDrivers.length > 0) {
    const drivers = explainDrivers.slice(0, 2);
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

  // Stability sentence — plain language only (never the raw band token or the
  // phrase "robustness band"). The phrase is bound once from the SSOT
  // describeRobustnessBand and the sentence is omitted if it is unexpectedly
  // null (so an SSOT regression surfaces rather than being masked by a
  // hardcoded fallback). The confident "should hold" reassurance is honest only
  // for genuinely stable bands; a moderate band gets a softer worth-checking
  // line; fragile / unknown bands produce no sentence here.
  const stabilityPhrase = describeRobustnessBand(projection.robustness_band);
  if (stabilityPhrase !== null) {
    if (
      projection.robustness_band === 'stable'
      || projection.robustness_band === 'highly_stable'
    ) {
      sentences.push(
        `This result looks ${stabilityPhrase}, so it should hold under reasonable variation.`,
      );
    } else if (projection.robustness_band === 'moderate') {
      sentences.push(
        `This result looks ${stabilityPhrase}, but it is worth checking the main assumptions before deciding.`,
      );
    }
  }

  if (typeof validationBeatText === 'string' && validationBeatText.length > 0) {
    sentences.push(validationBeatText);
  }

  sentences.push('Would you like to explore what would change this result?');

  return sentences.join(' ');
}

/**
 * `what_would_flip` happy-path fallback — analysis exists, answer_text
 * was unusable. Cite margins, top drivers, and robustness; gesture at
 * "what could change the outcome" without inventing scenarios.
 *
 * Robustness honesty (PR #193 SSOT reuse): when `rawRobustness` is
 * available the composer prefers the raw signal over the projected band
 * because canonicalisation can flatten a `very_low`/`low` raw level into
 * a moderate-sounding label. The chip-click path threads the raw signal
 * through (`dispatchChipClickNoopExplanation` → handler → here); routed
 * callers may pass `null` and the composer falls back to projected-band
 * copy, gated on `STABLE_ROBUSTNESS_BANDS`.
 *
 * Copy ladder for the closing robustness sentence (post round-1 review):
 *   - **Fragile signal** (raw fragile OR canonical `'fragile'` band) →
 *     "the picture appears fragile, so even small adjustments to the
 *     strongest drivers could shift which option leads". This is the
 *     only branch that names *fragility* — invoking the robustness band
 *     itself.
 *   - **Near-tie WITHOUT a fragile signal** (raw band is stable/highly
 *     stable/moderate/unknown/null AND not raw-fragile) → "the result is
 *     sensitive to small movements in the strongest drivers". Closeness
 *     framing only; never implies the robustness band is fragile when it
 *     is not.
 *   - **Stable / highly stable AND not near-tie AND finite margin** →
 *     softened "smaller changes are less likely to flip" (dropping
 *     "unlikely" to avoid overclaim; gated on `Number.isFinite(margin_pp)`
 *     so we never claim stability when the margin itself is unknown).
 *   - **Everything else** (moderate, unknown, null band; stable band
 *     with null margin) → omit the closing robustness sentence entirely.
 *
 * The "ahead of by Npp, so the lead is meaningful" framing is reused
 * from the explain-results fallback; here we keep neutral "the lead of
 * Npp would need to close" wording. We additionally swap that to the
 * effectively-tied phrasing when `isNearTieByMargin` fires, so we never
 * say "the lead would need to close" about a near-zero gap.
 */
export function composeWhatWouldFlipFallback(
  projection: AnalysisProjectionSummary | undefined,
  rawRobustness?: RawRobustnessSignals | null,
  flipSummary?: FlipSummary | null,
): string {
  if (!projection || !projection.leading_option) {
    return 'The analysis has finished, but the sensitivity picture could not be summarised from the available data. Would you like to run the analysis again?';
  }

  const leading = projection.leading_option;
  const sentences: string[] = [];
  const raw = rawRobustness ?? null;
  const nearTie = isNearTieByMargin(projection.margin_pp, raw);
  const rawFragile = isRawFragile(raw);
  // Treat the canonical `'fragile'` band as fragility evidence even when
  // raw signals are absent — older run_analysis facts may not carry the
  // raw `enrichment.robustness` block, but a canonicalised `'fragile'`
  // band is itself the upstream's verdict.
  const projectedFragile = projection.robustness_band === CANONICAL_FRAGILE_BAND;
  const fragileSignal = rawFragile || projectedFragile;
  // Margin must be finite for any quantitative-leaning closing sentence
  // (stable-band stability claim, runner-up "would need to close" reframe).
  // `null` / NaN / Infinity → omit so we never anchor copy on a phantom lead.
  // Holding the narrowed value (not a parallel boolean) lets call sites
  // use TypeScript's `!== null` narrowing — no `as number` cast needed.
  const finiteMargin: number | null =
    typeof projection.margin_pp === 'number' && Number.isFinite(projection.margin_pp)
      ? projection.margin_pp
      : null;

  // Staleness caveat is no longer composed here — see the parallel note in
  // composeExplainResultsFallback. The handler's applyStalenessPrefix
  // helper prepends it to the final assistant_text when staleness_reason
  // is set on the projection.

  sentences.push(
    `${quoteLabel(leading.label)} currently leads, with a probability of ${formatProbability(leading.probability)}.`,
  );

  if (nearTie && projection.runner_up) {
    // Near-tie: never describe a near-zero gap as "the lead would need to
    // close". Option labels are quoted so "and"-containing labels stay
    // readable. The caveat is consolidated into the single robustness/near-tie
    // sentence below — this lead carries no trailing "could shift" hedge.
    sentences.push(
      `${quoteLabel(leading.label)} and ${quoteLabel(projection.runner_up.label)} are effectively tied.`,
    );
  } else if (projection.runner_up && finiteMargin !== null) {
    // Reuse the finite-margin guard: a `!== null` check on `margin_pp`
    // was previously insufficient because `NaN !== null` and
    // `Infinity !== null` both slip past, and `formatPercentagePoints(NaN)`
    // renders as "Not available" — producing "the lead of Not available
    // would need to close". `finiteMargin` is the narrowed value (only
    // ever a finite number when non-null), so TypeScript narrows
    // cleanly here without a cast.
    sentences.push(
      `For ${quoteLabel(projection.runner_up.label)} to overtake it, the lead of ${formatPercentagePoints(
        finiteMargin,
      )} would need to close.`,
    );
  } else if (projection.runner_up) {
    sentences.push(
      `${quoteLabel(projection.runner_up.label)} is the most likely contender to overtake it.`,
    );
  }

  // DGAI #341: only materially-influential drivers may carry the "would
  // shift this result the most" claim. The live defect paired that claim
  // with "Today it has little effect on the lead" about the SAME factor —
  // a self-contradiction. A near-zero driver is omitted from this sentence,
  // never re-billed as the top mover. Empty ⇒ omit the sentence entirely.
  const flipDrivers = nameableDrivers(projection.top_drivers);
  if (flipDrivers.length > 0) {
    const drivers = flipDrivers.slice(0, 2);
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

  // Closing sentence — flip-threshold evidence first, robustness band second.
  //
  // `enrichment.flip_thresholds[]` is the most direct signal for "what could
  // change the outcome", so when it is available (`flipSummary` present and
  // not `'none'`) it OWNS the closing sentence and the robustness-band
  // heuristic is bypassed. Critically, this is where we stop the live staging
  // contradiction (build cef69b0): the band said `fragile` and the composer
  // claimed "small adjustments could shift which option leads", while the
  // flip analysis had found NO single-factor tipping point within bounds.
  //
  // The flippability claims (fragile / near-tie branches) are additionally
  // gated on `flip.margin_supports_flip`: a `margin_sensitivity` block that
  // reports `movement: 'none'` is NOT evidence that small changes could flip.
  // When `flipSummary` is absent (routed/Sonnet path, older facts with no
  // flip thresholds, or an explicit `'none'` summary) the ladder is unchanged
  // — backward-compatible verbatim.
  const flip =
    flipSummary !== null && flipSummary !== undefined && flipSummary.overall_status !== 'none'
      ? flipSummary
      : null;
  const flipVerdict = flip !== null ? flip.overall_status : null;
  const flippabilityClaimAllowed = flip === null || flip.margin_supports_flip;

  if (flipVerdict === 'no_practical_flip') {
    // flip_value null + reason no_effect_within_bounds across the tested
    // factors: say so plainly. No fragility/flippability claim.
    sentences.push(
      'Within the tested range, no single factor on its own reached a tipping point that would change which option leads.',
    );
  } else if (flipVerdict === 'concrete') {
    // A real single-factor tipping point exists. Name the clearest lever(s)
    // and frame as something to TEST. We deliberately do not quote a
    // threshold value here (the scale-safe "Test X at N" number is surfaced
    // by the separate flip-proposal chip, which honours the value_scale
    // contract); the prose names the factor so we never misprint a scale.
    const concrete = flip!.entries
      .filter((e) => typeof e.flip_value === 'number' && Number.isFinite(e.flip_value))
      .slice(0, 2)
      .map((e) => e.factor_label);
    if (concrete.length === 1) {
      sentences.push(
        `${concrete[0]} is the most likely single factor to change which option leads, so it is the clearest one to test.`,
      );
    } else if (concrete.length >= 2) {
      sentences.push(
        `${concrete[0]} and ${concrete[1]} are the most likely single factors to change which option leads, so they are the clearest ones to test.`,
      );
    }
  } else if (flipVerdict === 'insufficient_data') {
    sentences.push(
      'The analysis did not isolate a single-factor tipping point here, so it is not clear that any one change on its own would change which option leads.',
    );
  } else if (fragileSignal && flippabilityClaimAllowed) {
    // Fragility claim — only when there is an actual fragile signal AND no
    // flip evidence contradicts easy flippability. Naming fragility here is
    // honest because the robustness band itself is fragile.
    sentences.push(
      'The picture appears fragile, so even small adjustments to the strongest drivers could shift which option leads.',
    );
  } else if (nearTie && flippabilityClaimAllowed) {
    // Near-tie WITHOUT a fragile signal — say the result is close /
    // sensitive without invoking the robustness band. Avoids the
    // overclaim where a stable + near-tie result was previously told
    // "the picture appears fragile" (the band is stable).
    sentences.push(
      'The result is sensitive to small movements in the strongest drivers, so the leading option could change without much shifting.',
    );
  } else if (
    finiteMargin !== null
    && projection.robustness_band !== null
    && STABLE_ROBUSTNESS_BANDS.has(projection.robustness_band)
  ) {
    // Phrase from the SSOT describeRobustnessBand; omit if unexpectedly null
    // rather than masking an SSOT regression with a hardcoded fallback.
    const stabilityPhrase = describeRobustnessBand(projection.robustness_band);
    if (stabilityPhrase !== null) {
      sentences.push(
        `This result looks ${stabilityPhrase}, so smaller changes are less likely to flip the outcome on their own.`,
      );
    }
  }
  // Moderate, unknown, or null band, or stable with non-finite margin →
  // omit the closing stability sentence so we never overclaim.

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
