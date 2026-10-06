/**
 * ⭐ MC D1 — THE REPLY NAMES THE TRUE CAUSE AND A REAL ASK, NEVER "RUN IT AGAIN" (DL 0df0e1, 6 Oct; Science d5 #87 6007736377).
 *
 * Served T1b (Acceptance, cut 5):
 *   - rehearsal 9 (CEE 1c88f3c): a Run that produced NO result (it returned the identity question) was labelled
 *     `constraint_verdict_withheld` — a limit verdict on a brief with no limit;
 *   - rehearsals 8 / 13 (1c88f3c / d40fd7b): PLoT withheld the goal figures (#422 the user's size cut to fit; #416 "‘Starter-tier
 *     MRR’ depends on … × …, but this run couldn't calculate it that way"), the claim read `separation_unavailable`, and the
 *     reply's closing was "ask me to run the analysis and I will measure it" — the same model gives the same withhold.
 * Bound by code identity and exact words.
 */
import { describe, it, expect } from 'vitest';
import {
  composeLeaderClaim, LEADER_CLAIM_REASON_KINDS, WITHHELD_CONSTRAINT_VERDICT, WITHHELD_LEADER_CAUSE_UNRECORDED, WITHHELD_NO_RESULT,
  WITHHELD_SEPARATION_UNAVAILABLE,
} from '../../compose/analysis-state-v1.js';
import { readMayNameLeadingOptionVerdictForFact } from '../../context/claim-safety-read.js';
import { goalFiguresLeaderWithheldWithoutConstraintCause } from '../unsized-path-cause.js';
import { agentNoLeaderSentence, goalFigureCoHoldOf } from '../withheld-leader-fail-closed.js';

type Rec = Record<string, any>;
const W416 = { code: 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED', severity: 'warning', node_ids: ['starter_mrr'],
  message: 'Not shown. \'Starter-tier MRR\' depends on Starter-tier subscribers × Starter monthly price, but this run couldn\'t calculate it that way, so the figures for each option would be wrong.' };
// PLoT #422's own words (as pinned in goal-chance-clamp-reason.test.ts).
const W422 = { code: 'GOAL_FIGURES_USER_EFFECT_CLAMPED', severity: 'warning', node_ids: ['starter_price', 'starter_mrr'],
  message: 'Not shown. Your size for how ‘Starter monthly price’ moves ‘Starter-tier MRR’ is bigger than this model\'s scale can hold, so the run couldn\'t use it at full size, and the figures that depend on it would be wrong.' };
const TARGET_ONLY = { code: 'GOAL_FIGURES_TARGET_NOT_TESTABLE', severity: 'warning', node_ids: ['mrr'], withheld_claims: ['goal_probability'],
  message: 'Not shown. The target cannot be tested yet.' };
const fact = (warnings: Rec[]): Rec => ({ fact_type: 'run_analysis', result: {
  constraint_verdict: { may_name_leading_option: true }, enrichment: { inference_warnings: warnings } } });
const blocks = (warnings: Rec[]): Rec[] => [{ type: 'analysis_result', enrichment: { inference_warnings: warnings } }];
const T1B = { nodes: [
  { id: 'mrr', kind: 'goal', label: 'Monthly recurring revenue' },
  { id: 'starter_mrr', kind: 'outcome', label: 'Starter-tier MRR', nonlinear_identity: { operation: 'product', factor_ids: ['starter_subscribers', 'starter_price'] } },
  { id: 'starter_subscribers', kind: 'outcome', label: 'Starter-tier subscribers' },
  { id: 'starter_price', kind: 'factor', label: 'Starter monthly price', observed_state: { value: 49, unit: 'GBP per month' } },
  { id: 'keep', kind: 'option', label: 'Keep pricing as it is', is_baseline: true },
  { id: 'launch', kind: 'option', label: 'Launch starter tier' },
], edges: [
  { from: 'launch', to: 'starter_subscribers' }, { from: 'starter_subscribers', to: 'starter_mrr' }, { from: 'starter_price', to: 'starter_mrr' },
  { from: 'starter_mrr', to: 'mrr' },
] };

describe('(a) a Run that produced no result is never called a limit verdict', () => {
  it.each(['never_run', 'running', 'refused', 'blocked'])('RED (rehearsal 9): run_state %s → analysis_no_result', (kind) => {
    const claim = composeLeaderClaim({ canonical: null, rawRobustness: null } as never, { kind } as never, false);
    expect(claim).toMatchObject({ permitted: false, withheld_reason: WITHHELD_NO_RESULT });
    expect(claim.withheld_reason).not.toBe(WITHHELD_CONSTRAINT_VERDICT);
  });

  it('CONTROL: a COMPLETE run that is not entitled keeps the existing chain (the constraint default)', () => {
    const claim = composeLeaderClaim({ canonical: null, rawRobustness: null } as never, { kind: 'complete_current' } as never, false);
    expect(claim.withheld_reason).toBe(WITHHELD_CONSTRAINT_VERDICT);
  });

  it('the code is classified: nothing was checked, so not_evaluated', () => {
    expect(LEADER_CLAIM_REASON_KINDS[WITHHELD_NO_RESULT]).toBe('not_evaluated');
    expect(agentNoLeaderSentence(WITHHELD_NO_RESULT, undefined)).toBe(
      'No single option can be put forward yet, because no analysis has produced a result for this model yet; ask me to run it.');
  });
});

describe('(b) a goal-figure withhold that took the shares withholds the leader, as the licence does', () => {
  it.each([['#416', W416], ['#422', W422]])('RED (rehearsals 13/8): PLoT %s → the leader may not be named, and the constraint is not the cause', (_n, w) => {
    expect(readMayNameLeadingOptionVerdictForFact(fact([w]) as never).may_name_leading_option).toBe(false);
    expect(goalFiguresLeaderWithheldWithoutConstraintCause(fact([w]).result)).toBe(true);
  });

  it('CONTROL: a target-only withhold that KEPT the shares withholds no leader (RT-10 B′ R2)', () => {
    expect(readMayNameLeadingOptionVerdictForFact(fact([TARGET_ONLY]) as never).may_name_leading_option).toBe(true);
    expect(goalFiguresLeaderWithheldWithoutConstraintCause(fact([TARGET_ONLY]).result)).toBe(false);
  });
});

describe('(b)+(c) the reply names the warning\'s own cause and its ask — never "run the analysis" again', () => {
  it('RED (rehearsal 13): #416 → PLoT\'s cause, then the ONE ask that would let the identity be worked out (Science\'s words)', () => {
    const hold = goalFigureCoHoldOf(blocks([W416]), T1B)!;
    const words = 'No single option can be put forward yet, because \'Starter-tier MRR\' depends on Starter-tier subscribers × Starter monthly price, '
      + 'but this run couldn\'t calculate it that way, so the figures for each option would be wrong. '
      + 'To work out “Starter-tier MRR” as “Starter-tier subscribers” × “Starter monthly price”: ‘Starter-tier subscribers’ is 0 today, since '
      + '‘Launch starter tier’ would start it. How many ‘Starter-tier subscribers’ would ‘Launch starter tier’ lead to? A best guess and a range is fine.';
    expect(hold.say).toBe(words);
    for (const claim of [WITHHELD_SEPARATION_UNAVAILABLE, WITHHELD_LEADER_CAUSE_UNRECORDED]) {
      expect(agentNoLeaderSentence(claim, undefined, [], undefined, undefined, undefined, hold)).toBe(words);
    }
    expect(words).not.toMatch(/run the analysis|run it again|what is it today/i);
  });

  it('RED (rehearsal 8): #422 → its own cause, with no "run the analysis"', () => {
    const hold = goalFigureCoHoldOf(blocks([W422]), T1B)!;
    expect(agentNoLeaderSentence(WITHHELD_LEADER_CAUSE_UNRECORDED, undefined, [], undefined, undefined, undefined, hold)).toBe(
      'No single option can be put forward yet, because your size for how ‘Starter monthly price’ moves ‘Starter-tier MRR’ is bigger than this model\'s scale can hold, so the run couldn\'t use it at full size, and the figures that depend on it would be wrong.');
  });

  it('CONTROL: no goal-figure warning → no co-hold, so the existing separation clause stands', () => {
    expect(goalFigureCoHoldOf(blocks([]), T1B)).toBeUndefined();
    expect(agentNoLeaderSentence(WITHHELD_SEPARATION_UNAVAILABLE, undefined)).toContain('ask me to run the analysis');
  });
});
