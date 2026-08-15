/**
 * Shared "what to validate" beat for the post-analysis explain surfaces.
 *
 * Single source of truth for the validation-priority sentence introduced by
 * PR #256 on the deterministic advice-gate path (`composeExplainResults`),
 * now also appended on the LLM `explain_results` handler path so the
 * canonical J1 journey ("Why?") carries the same beat as the J1b free-text
 * phrasings ("Explain the results.") — V5-LANE-B-STRUCTURAL-01.
 *
 * Two rhetorical contexts, two variants:
 *
 *  - {@link describeValidationPriority} — the IN-FLOW variant used by the
 *    advice gate, where the immediately preceding beat
 *    (`describeFragileAssumption`) has already NAMED the fragile link, so the
 *    copy may reference "that link" without re-quoting the endpoints. Moved
 *    here verbatim from `post-analysis-advice-gate.ts`; the gate re-imports
 *    it, so its output is byte-for-byte unchanged.
 *
 *  - {@link composeStandaloneValidationPriority} — the STANDALONE variant
 *    appended after free LLM prose, which carries no guarantee that the link
 *    was named above. "that link" would dangle there, so this variant names
 *    both endpoints explicitly (quoted via `quoteLabel`).
 *
 * Both share the same degrade ladder (F.6 — existing signals only, no new
 * metric, no invented evidence, no causal/sign claim):
 *
 *   named fragile link → most-weighted factor (top driver) → omit.
 *
 * Omission is the contract on no-signal: never generic "gather more data"
 * filler. The standalone variant additionally rejects ID-shaped labels
 * (`isSlugShapedEntityId`) because its inputs arrive via the handler
 * projection rather than the advice gate's stricter availability checks.
 */

import { quoteLabel } from './robustness-honesty.js';
import { isSlugShapedEntityId } from '../../orchestrator/shared/output-safety.js';

/**
 * Structural fragile-edge shape shared by `AdviceGateAnalysisFragileEdge`
 * (advice gate) and `AnalysisProjectionFragileEdge` (handler projection) —
 * both are assignable without mapping.
 */
export interface ValidationFragileEdge {
  readonly from_label: string;
  readonly to_label: string;
}

function hasNonEmptyLabel(s: string | undefined | null): boolean {
  return typeof s === 'string' && s.trim().length > 0;
}

/**
 * Per-edge renderability check shared with the advice gate. Both endpoint
 * labels are interpolated into prose ("the link from <from> to <to>"); a
 * blank label on either side would emit a malformed sentence.
 */
export function isRenderableValidationEdge(edge: ValidationFragileEdge): boolean {
  return hasNonEmptyLabel(edge.from_label) && hasNonEmptyLabel(edge.to_label);
}

/**
 * Display-safety check for labels the STANDALONE variant interpolates:
 * non-empty AND not ID-shaped. The in-flow gate variant does not need this
 * (its labels already passed the gate's availability checks), but the
 * handler projection's labels come straight from the context pack, so the
 * slug guard holds the no-raw-IDs invariant by construction.
 */
export function isCleanDisplayLabel(label: string | undefined | null): label is string {
  if (!hasNonEmptyLabel(label)) return false;
  return !isSlugShapedEntityId((label as string).trim());
}

/**
 * The in-flow "what to validate" sentence for the advice gate's
 * `explain_results` composer — one useful confidence check grounded in the
 * selected signal, stated concretely rather than as generic "gather more
 * data" filler.
 * Distinct rhetorical job from its two neighbours in that composer: it
 * states the validation PRIORITY and why it matters, where
 * `describeFragileAssumption` DIAGNOSES the fragile link and
 * `interpretationNextStep` is the re-run ACTION.
 *
 * Specific by construction, from existing signals only (no new metric, no
 * invented evidence, no causal/sign claim — F.6):
 *   - when a fragile link was NAMED above (`hasNamedFragileEdge`), point at
 *     real-world support for THAT link. The projected link may not carry the
 *     producer metric, so the copy says only what membership in the fragile set
 *     proves; it never promotes arrival order into a superlative.
 *     References "that link" rather than re-quoting the endpoints, so it
 *     neither paraphrases the diagnosis sentence nor risks a second label
 *     render;
 *   - otherwise name the most-weighted factor (the projection's top driver),
 *     quoted so "and"-containing labels stay readable and the egress
 *     ID/decimal guards hold by construction.
 *
 * Returns null when neither signal is renderable, so the composer omits the
 * sentence rather than emitting generic copy. Mirrors the next-step fallback
 * ladder exactly, so it never introduces a NEW required input — the gate's
 * `needs_fragile_edges` stays false for `explain_results_free_text`.
 */
export const VALIDATE_LINK_EVIDENCE =
  'One useful confidence check is real-world support for that link rather than the current model estimate, since the robustness check flagged it as fragile.';

export function describeValidationPriority(
  hasNamedFragileEdge: boolean,
  topDriverLabel: string | null,
): string | null {
  if (hasNamedFragileEdge) return VALIDATE_LINK_EVIDENCE;
  return topDriverLabel !== null
    ? `The evidence that would most improve confidence is firmer support for ${quoteLabel(topDriverLabel)}, since it carries the most weight in this result.`
    : null;
}

/**
 * Outcome of composing the standalone beat: which rung of the ladder fired
 * and the evidence it names, so the handler can report the mechanism
 * (telemetry) without re-deriving it.
 */
export type ValidationPriorityBeat =
  | {
      readonly variant: 'link';
      readonly text: string;
      readonly from_label: string;
      readonly to_label: string;
    }
  | {
      readonly variant: 'driver';
      readonly text: string;
      readonly driver_label: string;
    };

/**
 * Standalone variant for append-after-LLM use. Same ladder and the same
 * sentence frame as {@link describeValidationPriority}, but the link rung
 * names both endpoints because the surrounding prose (free LLM narrative)
 * carries no guarantee the link was named above.
 */
export function composeStandaloneValidationPriority(
  fragileEdge: ValidationFragileEdge | null,
  topDriverLabel: string | null,
): ValidationPriorityBeat | null {
  if (
    fragileEdge !== null
    && isCleanDisplayLabel(fragileEdge.from_label)
    && isCleanDisplayLabel(fragileEdge.to_label)
  ) {
    const from = fragileEdge.from_label.trim();
    const to = fragileEdge.to_label.trim();
    return {
      variant: 'link',
      from_label: from,
      to_label: to,
      text: `One useful confidence check is real-world support for the link from ${quoteLabel(from)} to ${quoteLabel(to)} rather than the current model estimate, since the robustness check flagged it as fragile.`,
    };
  }
  if (isCleanDisplayLabel(topDriverLabel)) {
    const driver = topDriverLabel.trim();
    return {
      variant: 'driver',
      driver_label: driver,
      text: `The evidence that would most improve confidence is firmer support for ${quoteLabel(driver)}, since it carries the most weight in this result.`,
    };
  }
  return null;
}

/**
 * Validation/evidence/checking vocabulary used by the dedup guard.
 *
 * COARSE HEURISTIC — documented as such by design (V5-LANE-B-STRUCTURAL-01
 * addendum). It tests for the vocabulary anywhere in the answer, not for a
 * grammatical tie to the specific link, because reliably proving "clearly
 * tied to that same link" over free LLM prose is not achievable with a
 * reviewable regex. The bias within this guard is deliberate:
 * under-suppression is safer than over-suppression — a duplicated validation
 * beat reads mildly templated, but a wrongly suppressed beat silently
 * deletes the feature.
 */
const VALIDATION_VOCAB_PATTERN =
  /\b(?:validat\w*|evidence|verif\w*|confirm\w*|check\w*|corroborat\w*)\b/i;

function answerContainsLabel(answerText: string, label: string): boolean {
  return answerText.toLowerCase().includes(label.trim().toLowerCase());
}

/**
 * Decision record for the handler path: exactly one mechanism per turn.
 *
 *  - `appended`      — the standalone beat was composed and should be
 *                      appended as a final paragraph.
 *  - `dedup_skipped` — a beat was available but the existing narrative
 *                      already covers that validation priority (per the
 *                      coarse heuristic above), so it was intentionally
 *                      skipped. Carries the evidence that matched.
 *  - `omitted`       — no renderable fragile link AND no clean top-driver
 *                      label; nothing honest to say, so nothing is said.
 */
export type ValidationBeatDecision =
  | { readonly mechanism: 'appended'; readonly beat: ValidationPriorityBeat }
  | {
      readonly mechanism: 'dedup_skipped';
      readonly variant: 'link' | 'driver';
      readonly from_label?: string;
      readonly to_label?: string;
      readonly driver_label?: string;
    }
  | { readonly mechanism: 'omitted'; readonly reason: 'no_renderable_signal' };

/**
 * Decide whether to append the standalone validation beat after an
 * LLM-composed answer.
 *
 * Ladder with dedup (addendum rules, kept simple and reviewable):
 *
 *  1. Link rung. Skip ONLY when the answer already contains BOTH endpoint
 *     labels AND validation vocabulary — both labels alone are not enough
 *     (a narrative that mentions the endpoints without a validation framing
 *     has not stated the validation priority).
 *  2. If the link rung was dedup-skipped, the driver rung fires only when it
 *     adds a DISTINCT priority: the driver label must differ from both
 *     endpoint labels and must not itself already appear in the answer
 *     (validation vocabulary is already known present at that point).
 *  3. If no link rung exists at all, the driver rung dedups on the same
 *     rule as the link rung: driver label present AND vocabulary present.
 *  4. Nothing renderable → omitted.
 */
export function decideValidationBeat(opts: {
  readonly answerText: string;
  readonly fragileEdge: ValidationFragileEdge | null;
  readonly topDriverLabel: string | null;
}): ValidationBeatDecision {
  const { answerText, fragileEdge, topDriverLabel } = opts;
  const vocabPresent = VALIDATION_VOCAB_PATTERN.test(answerText);

  const linkRenderable =
    fragileEdge !== null
    && isCleanDisplayLabel(fragileEdge.from_label)
    && isCleanDisplayLabel(fragileEdge.to_label);
  const driverLabel = isCleanDisplayLabel(topDriverLabel)
    ? topDriverLabel.trim()
    : null;

  if (linkRenderable) {
    const from = fragileEdge.from_label.trim();
    const to = fragileEdge.to_label.trim();
    const linkAlreadyCovered =
      vocabPresent
      && answerContainsLabel(answerText, from)
      && answerContainsLabel(answerText, to);
    if (!linkAlreadyCovered) {
      // composeStandaloneValidationPriority re-runs the same ladder; the
      // link rung is renderable here, so the result is always the link beat.
      const beat = composeStandaloneValidationPriority(fragileEdge, driverLabel);
      return beat !== null
        ? { mechanism: 'appended', beat }
        : { mechanism: 'omitted', reason: 'no_renderable_signal' };
    }
    // Link rung dedup-skipped — try the driver rung only if it adds a
    // distinct validation priority.
    if (
      driverLabel !== null
      && driverLabel.toLowerCase() !== from.toLowerCase()
      && driverLabel.toLowerCase() !== to.toLowerCase()
      && !answerContainsLabel(answerText, driverLabel)
    ) {
      const beat = composeStandaloneValidationPriority(null, driverLabel);
      if (beat !== null) return { mechanism: 'appended', beat };
    }
    return {
      mechanism: 'dedup_skipped',
      variant: 'link',
      from_label: from,
      to_label: to,
    };
  }

  if (driverLabel !== null) {
    const driverAlreadyCovered =
      vocabPresent && answerContainsLabel(answerText, driverLabel);
    if (!driverAlreadyCovered) {
      const beat = composeStandaloneValidationPriority(null, driverLabel);
      if (beat !== null) return { mechanism: 'appended', beat };
    } else {
      return {
        mechanism: 'dedup_skipped',
        variant: 'driver',
        driver_label: driverLabel,
      };
    }
  }

  return { mechanism: 'omitted', reason: 'no_renderable_signal' };
}
