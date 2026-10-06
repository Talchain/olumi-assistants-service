import type { AnswerOffersRead } from '../session/store.js';
import type { SuggestedAction } from '../compose/types.js';
import { isDurableAnswerOffer, METHOD_PRESS_IDS, RUN_OFFER_CHIP, stillValidOffers } from '../../routes/agent-v1-turn.js';
import { typedApprovalOf } from './approval-chips.js';
import { RUN_EXPLANATION_PREFIX, runExplanationMatches, type RunExplanationRead } from './run-explanation.js';

/** Original offers only, revalidated by the turn's existing authority on this read's exact state. */
export function answerOffersForReload(stored: AnswerOffersRead, scenarioId: string, now: RunExplanationRead & {
  readonly outstandingProposalIds: ReadonlySet<string>;
  readonly analysisReady: unknown;
  readonly modelExists: boolean;
}): SuggestedAction[] {
  if (stored.run_key !== null
    && !runExplanationMatches(RUN_EXPLANATION_PREFIX + stored.run_key, scenarioId, now)) return [];
  const offered = stored.suggested_actions.filter(isDurableAnswerOffer)
    .filter(action => stored.run_key !== null || !METHOD_PRESS_IDS.has(action.id));
  const valid = stillValidOffers(offered, { ...now, analysisState: now.analysisState });
  const validIds = new Set(valid.filter(action => typedApprovalOf({ chip: { id: action.id } }) === undefined
    && action.id !== RUN_OFFER_CHIP.id).map(action => action.id));
  return offered.filter(action => validIds.has(action.id));
}
