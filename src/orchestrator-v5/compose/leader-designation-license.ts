import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { readRawRobustnessFromRunAnalysisFact } from '../coaching/pick-raw-robustness.js';
import { mayNameLeadingOptionForFact } from './withheld-claim-projection.js';

/**
 * Whether one persisted analysis fact licenses a categorical leader
 * designation.
 *
 * Constraint entitlement and producer-attested separation are independent
 * conjuncts. This function reads both through their existing canonical leaves;
 * it does not infer a tie from probabilities or a local threshold. Missing,
 * malformed or non-computed robustness therefore fails weakly to no
 * designation while leaving independently licensed numerical evidence intact.
 */
export function mayDesignateLeadingOptionForFact(
  fact: HandlerFact,
): boolean {
  if (!mayNameLeadingOptionForFact(fact)) return false;
  return readRawRobustnessFromRunAnalysisFact(fact)?.near_tie_is_tie === false;
}
