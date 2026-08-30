import type { FactorQuantitySelection } from '@talchain/schemas';
import type {
  FactorValueOperator,
  FactorValueProposalEvaluation,
} from './evaluate-factor-value-proposal.js';

/** A relative instruction supplies an operation, not its starting quantity. */
export function evaluateFactorDeltaAuthority(
  operator: FactorValueOperator,
  selection: FactorQuantitySelection | null | undefined,
): FactorValueProposalEvaluation {
  if (operator === 'set' ||
    (selection?.kind === 'point' && selection.carrier === 'observed_state')) {
    return { ok: true };
  }
  if (selection?.kind === 'missing') {
    return {
      ok: false,
      reason: 'delta_no_existing_value',
      specific_issue: 'This factor has no recorded current value to adjust from.',
    };
  }
  // Missing transport is not permission. `protected` concerns estimator
  // replacement; neither it nor a source literal establishes a usable LHS.
  return {
    ok: false,
    reason: 'delta_baseline_unresolved',
    specific_issue: 'Confirm a current baseline or provide the complete value before applying a relative change.',
  };
}
