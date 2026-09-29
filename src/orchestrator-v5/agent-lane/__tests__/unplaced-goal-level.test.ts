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
const refused = (...written: string[]) => expect.objectContaining({ kind: 'refused', written });

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
    ['a "%" goal unit with TWO money figures (no one figure supplies the level\'s terms)', draft({ unit: '%' }), CLOUD.replace('Monthly spend is £45k', 'Monthly spend is £45k, of which £12k is storage'), refused('£45k', '£12k')],
    ['a "%" goal unit whose figure\'s clause names no period ("Spend is £45k")', draft({ unit: '%' }), CLOUD.replace('Monthly spend', 'Spend'), refused('£45k')],
    ['a SCALED goal unit ("£k/month"): money totals are read unscaled only (the #2305 rule)', draft({ unit: '£k/month' }), CLOUD, refused('£45k')],
    ['S4G-8b: the figure stated in ANOTHER sentence, for another quantity', draft({ metric: 'Monthly cloud bill', value: -15, unit: 'GBP per month' }),
      'Our support team costs £45,000 a month. Cut our monthly cloud bill by 15% within 6 months.', refused('£45,000')],
    ['the change figure is not written in the brief (the drafter\'s −0.2)', draft({ value: -0.2 }), CLOUD, refused('£45k')],
  ])('REFUSED: %s', (_why, d, brief, expected) => {
    expect(briefGoalLevel(d, brief)).toEqual(expected);
  });
  // ⛔ AIQ 5897443539: served cut-costs runs 0 and 1 (a20cfd6) had no base, so no chance.
  it('(run 0) a "%"-typed percentage change: the level\'s terms come from the brief\'s ONE figure → adopted, in GBP per month', () => {
    expect(briefGoalLevel(draft({ metric: 'Monthly spend', unit: '%' }), CLOUD)).toEqual({ ...ADOPT_45K, unit: 'GBP per month' });
  });
  it('(run 1) the drafter ALSO put the £45k on a factor ("AWS-equivalent monthly cloud spend"): the brief\'s phrase decides → adopted', () => {
    expect(briefGoalLevel(draft({ metric: 'Monthly spend' }, [{ label: 'AWS-equivalent monthly cloud spend', role: 'observable', baseline_known: true, baseline_value: 45000, unit: '£/month', provenance: 'explicit' }]), CLOUD)).toEqual(ADOPT_45K);
  });
  it('CONTROL (run 1): a factor holding a figure whose phrase names ANOTHER quantity → still refused', () => {
    const brief = 'Our support team costs £45,000 a month and we want to cut our cloud bill by 15%.';
    expect(briefGoalLevel(draft({ metric: 'Monthly cloud bill', value: -15, unit: 'GBP per month' }, [{ label: 'Support team cost', role: 'observable', baseline_known: true, baseline_value: 45000, unit: 'GBP per month', provenance: 'explicit' }]), brief)).toMatchObject({ kind: 'refused' });
  });
  it.each<[string, CandidateModel, string]>([
    ['a LEVEL target, not a change', draft({ frame: 'level', value: 36000 }), CLOUD],
    ['no money figure in the brief at all', draft(), 'We want to cut our cloud costs by 20% this year.'],
    ['the only £ amount is the change itself (change_abs "by £9k")', draft({ frame: 'change_abs', value: -9000 }), 'We want to cut our monthly cloud spend by £9k.'],
    ['no brief', draft(), ''],
  ])('NULL (nothing the brief gives in money to account for): %s', (_why, d, brief) => {
    expect(briefGoalLevel(d, brief)).toBeNull();
  });
  // ⛔ PTL 5895711185: this was the NAMED RESIDUAL (adopted as the cloud bill's level). The figure's own phrase must name
  // nothing but the goal (`phraseNamesOnlyTheGoal`).
  it.each<[string, string, string, unknown]>([
    ['RED (was the residual): "Our support team costs £45,000 a month and we want to cut our cloud bill by 15%"', 'Monthly cloud bill',
      'Our support team costs £45,000 a month and we want to cut our cloud bill by 15%.', refused('£45,000')],
    ['"We spend £45k a month on support; we want to cut cloud costs by 20%"', 'Monthly cloud costs',
      'We spend £45k a month on support; we want to cut cloud costs by 20%.', refused('£45k')],
    ['AIQ 5895823531: a PART is not the total ("Marketing spend is £45k/month; cut costs by 20%")', 'costs',
      'Marketing spend is £45k/month; we want to cut costs by 20%.', refused('£45k')],
    ['named under-claim: the goal named by a word its name lacks ("Our AWS bill is £45k a month")', 'Monthly cloud costs',
      'Our AWS bill is £45k a month; we want to cut cloud costs by 20%.', refused('£45k')],
  ])('REFUSED (the figure is stated for another quantity): %s', (_why, metric, brief, expected) => {
    const got = briefGoalLevel(draft({ metric, value: /15%/.test(brief) ? -15 : -20, unit: 'GBP per month' }), brief);
    expect(got).toEqual(expected);
    // ⛔ PR Review CR @ 23ebebd2: the figure is named as another quantity's, so admission refuses it on every route.
    expect(got).toMatchObject({ otherQuantity: [45000] });
  });
  it.each<[string, string, string, string]>([
    ['the goal\'s own words ("Our cloud bill is £45k a month; cut it by 15%")', 'Monthly cloud bill', 'Our cloud bill is £45k a month; we want to cut it by 15%.', 'Our cloud bill is £45k a month'],
    ['one phrase for the level and its change ("cut our £45k monthly cloud spend by 20%")', 'Monthly cloud spend', 'We want to cut our £45k monthly cloud spend by 20%.', 'We want to cut our £45k monthly cloud spend by 20%'],
    ['no quantity named beside the figure ("We spend £45k a month; …cut costs by 20%")', 'costs', 'We spend £45k a month; we want to cut costs by 20%.', 'We spend £45k a month'],
    ['AIQ 5895823531: the goal\'s own quantity after the figure ("We spend £45k a month on the cloud; cut cloud costs by 20%")', 'Monthly cloud costs',
      'We spend £45k a month on the cloud; cut cloud costs by 20%.', 'We spend £45k a month on the cloud'],
  ])('ADOPTED (the phrase names the goal or nothing): %s', (_why, metric, brief, quote) => {
    expect(briefGoalLevel(draft({ metric, value: /15%/.test(brief) ? -15 : -20, unit: 'GBP per month' }), brief)).toMatchObject({ kind: 'adopt', value: 45000, quote });
  });
});
