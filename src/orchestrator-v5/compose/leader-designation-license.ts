import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  readRawRobustnessFromRunAnalysisFact,
  type RawRobustnessSignals,
} from '../coaching/pick-raw-robustness.js';
import { mayNameLeadingOptionForFact } from './withheld-claim-projection.js';

/**
 * The one conjunction that licenses a categorical leader designation.
 *
 * The entitlement and separation facts are supplied by their canonical
 * readers. This leaf only combines them; it never derives a tie from option
 * probabilities or treats missing robustness as permission.
 */
export function mayDesignateLeadingOption(
  entitled: boolean,
  rawRobustness: RawRobustnessSignals | null,
): boolean {
  return entitled && rawRobustness?.near_tie_is_tie === false;
}

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
  if (fact.fact_type !== 'run_analysis') return false;
  return mayDesignateLeadingOption(
    mayNameLeadingOptionForFact(fact),
    readRawRobustnessFromRunAnalysisFact(fact),
  );
}
