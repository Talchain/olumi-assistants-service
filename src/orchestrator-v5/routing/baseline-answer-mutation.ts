import { omitStatedCurrentLevels, subjectBindsToLabel } from '../../cee/factor-extraction/stated-level.js';
import { extractCompoundGoals, normaliseConstraintUnits } from '../../cee/compound-goal/index.js';
import { valuesMatch } from '../../utils/reduction-framing.js';
import { runExtraction } from '../context/cqe/extract-quantities.js';
import { preNormalise } from '../context/cqe/pre-normalise.js';
import { detectMutationWarrant, EDIT_VERB_BASES } from './mutation-warrant.js';

export interface BaselineLimitChange {
  readonly constraint_type: 'at_most' | 'at_least';
  readonly value: number;
  readonly unit: '%';
  readonly value_frame: 'level';
}

/** Reuse the mutation warrant on the words outside the observed statements. */
export function baselineIndependentInstruction(message: string): string {
  return omitStatedCurrentLevels(message).trim().replace(/^[.,;!\s]+/, '');
}

export function hasBaselineIndependentMutationWarrant(message: string): boolean {
  return detectMutationWarrant({
    message: baselineIndependentInstruction(message),
    turnSource: 'message',
    chipActionType: undefined,
    isConfirmResume: false,
  }, new Set()).granted;
}

/**
 * Evidence for changing this question's limit, separate from answering it.
 * Named constraints use the existing subject binder; "the limit" can refer
 * only to the question whose subject the baseline classifier already bound.
 * This narrows an existing warrant, and never grants one from a number alone.
 */
export function deriveBaselineLimitChange(
  message: string,
  targetLabel: string,
  competingLabels: readonly string[],
): BaselineLimitChange | undefined {
  if (!hasBaselineIndependentMutationWarrant(message)) return undefined;
  const instruction = baselineIndependentInstruction(message);
  const parsed = normaliseConstraintUnits(
    extractCompoundGoals(instruction, { includeProxies: false }).constraints,
  ).filter((c) => c.deadlineMetadata === undefined && c.valueFrame === 'level' &&
    c.provenance === 'explicit' && (c.unit === '%' || c.unit === 'fraction') &&
    hasBaselineIndependentMutationWarrant(c.sourceQuote) &&
    subjectBindsToLabel(c.targetName.split(/\s+/), targetLabel) &&
    !competingLabels.some((label) => subjectBindsToLabel(c.targetName.split(/\s+/), label)));
  const candidates: BaselineLimitChange[] = parsed.map((c) => ({
    constraint_type: c.operator === '<=' ? 'at_most' : 'at_least',
    value: c.value * 100,
    unit: '%',
    value_frame: 'level',
  }));

  // CQE owns the comparator, amount and units. The anchored remainder below
  // supplies only the anaphoric subject; it cannot hide another named target,
  // instruction, number, conditional, or prohibition in the same statement.
  const extraction = runExtraction(instruction);
  if (!extraction.summary.degraded && extraction.results.length === 1) {
    const quantity = extraction.results[0]!;
    if (quantity.value !== null && quantity.unit === 'percentage' &&
        (quantity.comparator === 'at_most' || quantity.comparator === 'at_least')) {
      const quote = quantity.raw_text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const scope = new RegExp(
        `^(?:${EDIT_VERB_BASES.join('|')})\\s+(?:the|this|that)\\s+(?:limit|constraint|cap)\\s+(?:to|at)\\s+${quote}[.!]?\\s*$`,
        'i',
      );
      if (scope.test(preNormalise(instruction).text)) {
        candidates.push({ constraint_type: quantity.comparator, value: quantity.value * 100,
          unit: '%', value_frame: 'level' });
      }
    }
  }
  const first = candidates[0];
  if (!first || !Number.isFinite(first.value) || first.value < 0 || first.value > 100 ||
      candidates.some((c) => c.constraint_type !== first.constraint_type || !valuesMatch(c.value, first.value))) {
    return undefined;
  }
  return first;
}
