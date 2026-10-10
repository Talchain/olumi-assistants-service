/**
 * S4 TIME, the steady path (buddy r1 P1 on #2952): with a stated onset the build admits no accumulation carrier, so the untested
 * month used to open the steady-horizon card, and the user's attestation then licensed a chance the onset was never part of.
 * A detection can only WITHHOLD: no steady card is offered for such a brief, and an attestation already on the graph is withheld too.
 */
import { describe, expect, it, vi } from 'vitest';
import { applyGoalSteadyEdit } from '../goal-steady-write.js';
import { goalHorizonVerdict, withholdGoalFiguresForUntestedHorizon } from '../goal-horizon-verdict.js';
import { steadyHorizonCard } from '../../agent-lane/steady-horizon-card.js';
import { GOAL_FIGURES_HORIZON_NOT_TESTED } from '../../../orchestrator/context/option-result-source.js';

vi.mock('../../../config/index.js', async original => {
  const actual = await original<typeof import('../../../config/index.js')>();
  return { ...actual, config: new Proxy(actual.config, { get(target, key) {
    if (key === 'auth') return { ...target.auth, hmacSecret: 'time-class-steady-test-only-secret' };
    return Reflect.get(target, key);
  } }) };
});

type Rec = Record<string, any>;
const ONSET_BRIEF = 'We have 200 customers and gain a net 30 a month. Reach 500 within 10 months. We can add a partner channel, starting in month 3.';
const PLAIN_BRIEF = 'We have 200 customers and gain a net 30 a month. Reach 500 within 10 months. We can add a partner channel.';
const seed = (): Rec => ({ nodes: [
  { id: 'mrr', kind: 'goal', label: 'monthly recurring revenue', goal_horizon_months: 9, goal_threshold_unit: '£/month', goal_horizon: { deadline: '2027-03-31' } },
  { id: 'raise', kind: 'option', label: 'Raise prices' }, { id: 'keep', kind: 'option', label: 'Keep pricing' },
], edges: [] });
const attested = (): Rec => {
  const issued = applyGoalSteadyEdit(seed(), { goal_id: 'mrr', months: 9 }, 'time-class-steady');
  if (issued.kind !== 'mutated') throw new Error('real door mint refused');
  return JSON.parse(JSON.stringify(issued.mutatedGraph));
};
const response = (): Rec => ({ option_comparison: [
  { option_id: 'raise', probability_of_goal: 0.62, win_probability: 0.7 }, { option_id: 'keep', probability_of_goal: 0.41, win_probability: 0.3 }],
inference_warnings: [] });
const figureMap = (r: unknown): Record<string, number> => Object.fromEntries(((r as Rec).option_comparison ?? [])
  .filter((o: Rec) => typeof o.probability_of_goal === 'number').map((o: Rec) => [o.option_id, o.probability_of_goal]));

describe('an attested-steady month is withheld when the brief states a timing shape', () => {
  it('the fixture is really steady_attested, and a brief with no shape keeps both figures (same object)', () => {
    expect(goalHorizonVerdict(attested(), response())).toBe('steady_attested');
    const before = response();
    for (const brief of [PLAIN_BRIEF, 'We should review in month 3.', undefined, null, '']) {
      expect(withholdGoalFiguresForUntestedHorizon(before, attested(), brief)).toBe(before);
    }
  });
  it('the same attested graph with a stated onset withholds every figure and says the user\'s own words', () => {
    const out = withholdGoalFiguresForUntestedHorizon(structuredClone(response()), attested(), ONSET_BRIEF) as Rec;
    expect(figureMap(out)).toEqual({});
    const warning = out.inference_warnings.find((w: Rec) => w.code === GOAL_FIGURES_HORIZON_NOT_TESTED);
    expect(warning?.say).toBe("You said ‘starting in month 3’. Olumi can't yet model when a change starts, so it won't give a chance for month 9.");
  });
  it('MONOTONE: no retained figure differs from the figure the same attested graph carries without a shape', () => {
    const without = figureMap(withholdGoalFiguresForUntestedHorizon(structuredClone(response()), attested()));
    expect(without).toEqual({ raise: 0.62, keep: 0.41 });
    for (const brief of [ONSET_BRIEF, 'Demand is seasonal.', 'Sign-ups ramp up.']) {
      for (const [id, value] of Object.entries(figureMap(withholdGoalFiguresForUntestedHorizon(structuredClone(response()), attested(), brief)))) {
        expect(without[id]).toBe(value);
      }
    }
  });
});

describe('no steady-horizon card is offered for a brief outside the class', () => {
  const run = (brief: string | null | undefined) => steadyHorizonCard({ graph: seed(), graphHash: 'a'.repeat(64), scenarioId: 's', userId: null,
    runReply: true, runResult: { inference_warnings: [{ code: GOAL_FIGURES_HORIZON_NOT_TESTED }] }, approvalHeld: false, brief });
  it('CONTRAST: the card IS offered with no brief, a plain brief and a review date (the null below is the boundary, not the fixture)', () => {
    for (const brief of [undefined, null, PLAIN_BRIEF, 'We should review in month 3.']) expect(run(brief), String(brief)).not.toBeNull();
  });
  it('a stated onset, seasonality or a gradual build-up is offered no card', () => {
    for (const brief of [ONSET_BRIEF, 'Demand is seasonal.', 'Sign-ups ramp up once the campaign is live.']) expect(run(brief), brief).toBeNull();
  });
});
