import type { AnswerOffersRead } from '../session/store.js';
import type { SuggestedAction } from '../compose/types.js';
import { isPendingActionExpired, type PendingAction } from '../session/pending-action.js';
import { isDurableAnswerOffer, stillValidOffers } from '../../routes/agent-v1-turn.js';
import { typedApprovalOf } from './approval-chips.js';
import { liveOfferId } from './answer-offers-envelope.js';
import { RUN_EXPLANATION_PREFIX, runExplanationMatches, type RunExplanationRead } from './run-explanation.js';

/** Original offers only, revalidated by the turn's existing authority on this read's exact state. */
export function answerOffersForReload(stored: AnswerOffersRead, scenarioId: string, now: RunExplanationRead & {
  readonly outstandingProposalIds: ReadonlySet<string>;
  /** The latest pending carrier, as this read holds it. */
  readonly latestPending?: readonly PendingAction[];
  readonly nowMs?: number;
  readonly analysisReady: unknown;
  readonly modelExists: boolean;
}): SuggestedAction[] {
  // These presses belong to ONE Run: no bound Run, or a different Run selected now, restores nothing.
  if (stored.run_key === null
    || !runExplanationMatches(RUN_EXPLANATION_PREFIX + stored.run_key, scenarioId, now)) return [];
  // A proposal waiting for its yes is the step, whether or not its card can still be shown: every unexpired approval
  // in the latest pending carrier counts, so a cold worker that cannot recover the card still withholds (fail closed).
  const outstanding = new Set(now.outstandingProposalIds);
  const at = now.nowMs ?? Date.now();
  for (const pending of now.latestPending ?? []) {
    const proposalId = typedApprovalOf({ chip: { id: pending.chip_id } });
    if (proposalId !== undefined && !isPendingActionExpired(pending, at)) outstanding.add(proposalId);
  }
  if (outstanding.size > 0) return [];
  const offered = stored.suggested_actions.map(action => ({ ...action, id: liveOfferId(action.id) })).filter(isDurableAnswerOffer);
  const validIds = new Set(stillValidOffers(offered, {
    outstandingProposalIds: outstanding, analysisReady: now.analysisReady, analysisState: now.analysisState, modelExists: now.modelExists,
  }).map(action => action.id));
  return offered.filter(action => validIds.has(action.id));
}
