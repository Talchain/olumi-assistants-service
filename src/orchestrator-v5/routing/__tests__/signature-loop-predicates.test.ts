/**
 * V5 Signature Loop — unit tests for the route-level predicates and the
 * extended confirmation / dismissal logic introduced by Fix A + Fix B3.
 *
 *   - `isStateQueryQuestionShape` (behaviour #3 route suppression)
 *   - `PROPOSAL_CONFIRM_PATTERN` additions: try that / test that / update the
 *     model (behaviour #1) and `tryShortConfirmResume` resolving them
 *   - `tryProposalDismissal.dismissed_refs` (Fix B3 — rejected proposals are
 *     excluded from carry-forward so they cannot become zombies)
 */
import { describe,expect,it } from 'vitest';

import { isStateQueryQuestionShape } from '../state-query-guard.js';





describe('isStateQueryQuestionShape — behaviour #3 route suppression', () => {
  it.each([
    'what changed?',
    'What did you just change?',
    'what was updated?',
    'what did that update do?',
    'what update did you make?',
    'did you change it?',
  ])('recognises state-query question "%s"', (m) => {
    expect(isStateQueryQuestionShape(m)).toBe(true);
  });

  it.each([
    'update market demand to 20', // concrete value edit — NOT a question
    'set Revenue to 20',
    'add a constraint below 50000',
    'increase the budget',
    'make that update', // a confirmation, owned by the proposal-confirm path
    'hello',
    'what should I do next?',
  ])('does NOT treat "%s" as a state-query question', (m) => {
    expect(isStateQueryQuestionShape(m)).toBe(false);
  });
});
