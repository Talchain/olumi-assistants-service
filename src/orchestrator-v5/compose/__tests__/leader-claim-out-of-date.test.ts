/**
 * ⛔ P1-d (AI Quality #70 5850056041, DL 5850069309) — AN OUT-OF-DATE RUN IS NOT "WITHHELD FOR A LIMIT".
 *
 * SERVED (DL `f-20260926T201724Z`, CEE d6b09c0, the churn brief): turn 10, `run_state.kind: complete_current`,
 * `leader_claim.withheld_reason: nonlinear_identity_sign_unproven`. Turn 11 is the SAME run
 * (`computed_at 20:19:45.167Z`) after the user approved a change: `complete_stale` / `graph_changed`, and the reason
 * became `constraint_verdict_withheld`. The canvas card keys `· Goal only` on exactly that code
 * (`OptionNode.tsx`, `producer_cause === 'constraint_verdict_withheld'`), and the Agent's no-leader sentence said
 * "a limit on your model was not shown to be met on this run, and running the analysis again as it stands will not
 * change that". Both are false. Turn 10 proves the run's constraint verdict PERMITTED a leader
 * (`nonlinear_identity_sign_unproven` is only emitted when `MAY_NAME_LEADING_OPTION[state] === true`), and a rerun
 * is exactly what an out-of-date run needs.
 *
 * WHY: the read route presents no fact for an out-of-date run (`selected = fresh ? historical : null`), so the
 * compose input has `mayNameLeadingOption: false` and no stated cause, and `composeLeaderClaim` fell through to
 * the constraint token for EVERY out-of-date run, including one whose leader was permitted.
 *
 * RULE: when the run is `complete_stale` and no caller stated a cause, the reason is `analysis_out_of_date`. A cause
 * the caller DID state still outranks it (unrequested, then nonlinear identity), and a current run keeps the
 * constraint token (CONTRAST).
 */
import { describe, it, expect } from 'vitest';

import {
  LEADER_CLAIM_REASON_KINDS,
  WITHHELD_CONSTRAINT_VERDICT,
  WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN,
  WITHHELD_RUN_OUT_OF_DATE,
  WITHHELD_UNREQUESTED_ANALYSIS,
  composeAnalysisStateV1,
  leaderClaimReasonKind,
} from '../analysis-state-v1.js';
import { agentNoLeaderSentence } from '../../agent-lane/withheld-leader-fail-closed.js';
import { leaderWithheldForALimit } from '../../coaching/limit-unchecked-card.js';

/** The served turn-11 canonical verdict: a completed run whose graph changed since (`computed_at` is the run's). */
const canonicalFor = (freshness: 'fresh' | 'stale') => ({
  status: 'needs_user_input',
  usableForProse: true,
  usableForChips: true,
  usableForFollowupContext: true,
  requiresRerun: freshness === 'stale',
  blockedUnusable: false,
  contradictions: [],
  freshness,
  freshness_reason: freshness === 'stale' ? 'graph_changed' : undefined,
  computed_at: '2026-09-26T20:19:45.167Z',
  selected_fact_index: freshness === 'fresh' ? 0 : null,
}) as never;

function compose(freshness: 'fresh' | 'stale', causes: { unrequested?: boolean; identity?: boolean } = {}) {
  return composeAnalysisStateV1({
    canonical: canonicalFor(freshness),
    mayNameLeadingOption: false,
    withheldBecauseUnrequested: causes.unrequested === true,
    withheldBecauseNonlinearIdentity: causes.identity === true,
    rawRobustness: null,
  } as never)!;
}

describe('P1-d — an out-of-date run is never labelled "withheld for a limit"', () => {
  it('PREMISE: the served turn-11 shape composes as complete_stale / graph_changed', () => {
    expect(compose('stale').run_state).toMatchObject({ kind: 'complete_stale', cause: 'graph_changed' });
  });

  it('RED (served turn 11): an out-of-date run with no stated cause reads analysis_out_of_date, not the constraint token', () => {
    const claim = compose('stale').leader_claim;
    expect(claim).toEqual({ permitted: false, withheld_reason: WITHHELD_RUN_OUT_OF_DATE });
    expect(leaderWithheldForALimit(compose('stale')), 'no limit card on a run that is merely out of date').toBe(false);
  });

  it('CONTRAST: a CURRENT run with no stated cause keeps the constraint token (the fallback is unchanged)', () => {
    expect(compose('fresh').leader_claim).toEqual({ permitted: false, withheld_reason: WITHHELD_CONSTRAINT_VERDICT });
  });

  it('PRECEDENCE: a cause the caller stated outranks out-of-date (unrequested, then nonlinear identity)', () => {
    expect(compose('stale', { unrequested: true }).leader_claim.withheld_reason).toBe(WITHHELD_UNREQUESTED_ANALYSIS);
    expect(compose('stale', { identity: true }).leader_claim.withheld_reason).toBe(WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN);
  });

  it('the code is classified: the current model was not evaluated (like an unconfirmed run identity)', () => {
    expect(Object.prototype.hasOwnProperty.call(LEADER_CLAIM_REASON_KINDS, WITHHELD_RUN_OUT_OF_DATE)).toBe(true);
    expect(leaderClaimReasonKind(WITHHELD_RUN_OUT_OF_DATE)).toBe('not_evaluated');
  });

  it('RED (served turn 11, the chat): the Agent says the result predates the change and asks for a rerun — never the limit sentence', () => {
    const said = agentNoLeaderSentence(WITHHELD_RUN_OUT_OF_DATE, undefined);
    const limit = agentNoLeaderSentence(WITHHELD_CONSTRAINT_VERDICT, undefined);
    expect(said).not.toBe(limit);
    expect(said).toMatch(/before your latest change/);
    expect(said).toMatch(/run the analysis again/i);
    expect(said).not.toMatch(/limit/i);
    expect(said).not.toMatch(/will not change/);
  });
});
