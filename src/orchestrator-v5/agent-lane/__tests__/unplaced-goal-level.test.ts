/**
 * The brief's level that never reached a change goal (R3-B #72 5894575583; MG 5894657102 / 5894719651; AIQ (b) ACK
 * 5894808343 (1), rows (a)–(d)). Shapes from the served `7c23be87` draft and the saved corpus (18/44 change goals with no
 * level: "costs" 11/12). 0 LLM. The real-build rows (words, staleness, mutant (e)) are in `goal-level-reading.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { briefGoalLevel } from '../unplaced-goal-level.js';
import type { CandidateModel } from '../admit-model.js';

const CLOUD = 'Should we switch our cloud provider from AWS to GCP? Monthly spend is £45k; we want to cut costs by 20% without more than 2 weeks of migration downtime risk.';

function draft(goal: Record<string, unknown> = {}, factors: Record<string, unknown>[] = []): CandidateModel {
  return {
    goal: {
      metric: 'costs', operator: '<=', target_stated: true, frame: 'change_rel', value: -20, unit: '£/month', horizon_months: null,
      provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: null, scope: null, ...goal,
    },
    constraints: [],
    options: [],
    factors: [{ label: 'GCP workload share', role: 'controllable', baseline_known: false, baseline_value: null, unit: '%', provenance: 'inferred', plausible_max: 100 }, ...factors],
    risks: [], outcomes: [], links: [], unknowns: [],
  } as unknown as CandidateModel;
}
const ADOPT_45K = { kind: 'adopt', value: 45000, written: '£45k', quote: 'Monthly spend is £45k' };
const refused = (...written: string[]) => ({ kind: 'refused', written });

describe('briefGoalLevel: AIQ (b) — the sole same-terms figure, in the change\'s own sentence', () => {
  it('(a) RED (the saved "costs" shape): a change goal with no level, the brief\'s £45k on no node → adopted, with its clause', () => {
    expect(briefGoalLevel(draft(), CLOUD)).toEqual(ADOPT_45K);
  });
  it('(a) the served "Monthly cloud spend" shape, in "GBP per month" → the same', () => {
    expect(briefGoalLevel(draft({ metric: 'Monthly cloud spend', unit: 'GBP per month' }), CLOUD)).toEqual(ADOPT_45K);
  });
  it('(a) change_abs: today\'s level beside the change → today\'s level, never the change', () => {
    expect(briefGoalLevel(draft({ frame: 'change_abs', value: -9000 }), 'Monthly spend is £45k; we want to cut it by £9k.')).toEqual(ADOPT_45K);
  });
  it.each<[string, CandidateModel, string, unknown]>([
    ['(b) TWO figures in the goal\'s currency (a guess)', draft(), CLOUD.replace('Monthly spend is £45k', 'Monthly spend is £45k, of which £12k is storage'), refused('£45k', '£12k')],
    ['(c) "£540k a year" beside a MONTHLY goal', draft(), CLOUD.replace('Monthly spend is £45k', 'We spend £540k a year'), refused('£540k')],
    ['(c) a clause naming no period ("Spend is £45k")', draft(), CLOUD.replace('Monthly spend', 'Spend'), refused('£45k')],
    ['(c) a goal naming no period (unit "£", metric "costs")', draft({ unit: '£' }), CLOUD, refused('£45k')],
    ['(d) a "USD per month" goal beside the brief\'s £45k (the cross-read)', draft({ unit: 'USD per month' }), CLOUD, refused('£45k')],
    ['the goal unit is not money ("%")', draft({ unit: '%' }), CLOUD, refused('£45k')],
    ['a SCALED goal unit ("£k/month"): money totals are read unscaled only (the #2305 rule)', draft({ unit: '£k/month' }), CLOUD, refused('£45k')],
    ['S4G-8b: the figure stated in ANOTHER sentence, for another quantity', draft({ metric: 'Monthly cloud bill', value: -15, unit: 'GBP per month' }),
      'Our support team costs £45,000 a month. Cut our monthly cloud bill by 15% within 6 months.', refused('£45,000')],
    ['the change figure is not written in the brief (the drafter\'s −0.2)', draft({ value: -0.2 }), CLOUD, refused('£45k')],
    ['a factor already holds the £45k (the drafter gave it to another quantity)',
      draft({}, [{ label: 'Current AWS monthly spend', role: 'observable', baseline_known: true, baseline_value: 45000, unit: '£/month', provenance: 'explicit' }]), CLOUD, refused('£45k')],
  ])('REFUSED: %s', (_why, d, brief, expected) => {
    expect(briefGoalLevel(d, brief)).toEqual(expected);
  });
  it.each<[string, CandidateModel, string]>([
    ['a LEVEL target, not a change', draft({ frame: 'level', value: 36000 }), CLOUD],
    ['no money figure in the brief at all', draft(), 'We want to cut our cloud costs by 20% this year.'],
    ['the only £ amount is the change itself (change_abs "by £9k")', draft({ frame: 'change_abs', value: -9000 }), 'We want to cut our monthly cloud spend by £9k.'],
    ['no brief', draft(), ''],
  ])('NULL (nothing the brief gives in money to account for): %s', (_why, d, brief) => {
    expect(briefGoalLevel(d, brief)).toBeNull();
  });
  it('NAMED RESIDUAL (an over-claim this cannot see): one sentence, the sole figure, stated for a quantity the model does not hold', () => {
    const brief = 'Our support team costs £45,000 a month and we want to cut our cloud bill by 15%.';
    expect(briefGoalLevel(draft({ metric: 'Monthly cloud bill', value: -15, unit: 'GBP per month' }), brief)).toMatchObject({ kind: 'adopt', value: 45000 });
  });
});
