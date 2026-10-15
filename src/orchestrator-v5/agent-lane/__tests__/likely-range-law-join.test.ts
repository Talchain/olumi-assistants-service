/**
 * ⭐ C2 JOIN (AIE 6184022140; DL 15 Oct: disclose + provisional for every likely range). A `likely_range` is two ends (the
 * person's, the brief's or Olumi's) that the analysis reads with Olumi's equal-tail approximation (ISL samples it as the
 * quartiles of a lognormal). No writer elicits that law, so a result resting on it is provisional and says so, the ends stay
 * whose they are, and the law is never called the person's calibration. Two served briefs:
 *  · pricing (scenario 5e0fbc03, CEE f8ed674d; `b2-zero-spread` fixture): the brief's "between 80 and 250" new subscribers on
 *    'Launch starter tier', on the goal's path: the GOAL CHANCE's licence;
 *  · cloud migration (R3 r1, `b6-cloud-r1-20260930`): the user's "somewhere between 2 and 5 weeks" on the limited downtime
 *    'Switch to GCP' sets: the LIMIT row.
 * Plus the card's tool result: the user's ends and Olumi's law, kept apart for the Agent.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goalChanceLicenceOf, withGoalChanceLicence } from '../../goal-target/goal-chance-licence.js';
import { projectGoalProbabilitiesForTransport } from '../../compose/goal-probability-transport.js';
import { runFactsOf } from '../run-facts.js';
import { limitChecksForAgent } from '../limit-checks.js';
import { likelyRangeLawWords, likelyRangeUseOf } from '../../intervention-range.js';
import { LIKELY_RANGE_LAW_NOTE } from '../runtime/agent-capabilities.js';

type Rec = Record<string, any>;
const clone = <T>(x: T): T => structuredClone(x);

// ── pricing, served (the b2 lane's own stored bytes) ─────────────────────────────────────────────────────────────────
const B2 = new URL('../../../routes/__tests__/fixtures/b2-zero-spread/', import.meta.url);
const RUN = JSON.parse(readFileSync(new URL('run.json', B2), 'utf8')) as Rec;
const READ = (JSON.parse(readFileSync(new URL('read-graph-1791489457020.json', B2), 'utf8')) as Rec).j as Rec;
const GOAL = 'monthly_recurring_revenue';
const STARTER = 'launch_starter_tier';
const SUBS = 'new_starter_subscribers';
/** The b2 Starter-point control's envelope: Starter's stored P(goal) at 0.97 (the lane's own derivation, no new draw). */
function envelope(): Rec {
  const e = clone(RUN.blocks.find((b: Rec) => b.type === 'analysis_result').enrichment);
  e.option_comparison.find((r: Rec) => r.option_id === 'keep_current_pricing').probability_of_goal = 0;
  e.option_comparison.find((r: Rec) => r.option_id === STARTER).probability_of_goal = 0.97;
  return e;
}
const starterCell = (g: Rec): Rec => g.nodes.find((n: Rec) => n.id === STARTER).interventions[SUBS];
const BRIEF_LINE = '‘Launch starter tier’ uses your range for ‘New starter subscribers’, 80 subscribers to 250 subscribers, read with '
  + 'Olumi’s equal-tail approximation: about one chance in four below 80 subscribers and one in four above 250 subscribers, a modelling '
  + 'convention, not your own calibration.';

describe('the goal chance on the served pricing brief: the brief\'s range is read with Olumi\'s approximation, said once', () => {
  it('PRECONDITION: Starter sets new starter subscribers with the brief\'s 80–250, a likely range from the brief, on the goal\'s path', () => {
    expect(starterCell(READ.graph).range).toMatchObject({ low: 80, high: 250, meaning: 'likely_range', source: 'brief_extraction' });
    expect(likelyRangeUseOf(SUBS, starterCell(READ.graph))).toMatchObject({ low: 80, high: 250, persons_own: true });
    expect(READ.graph.nodes.find((n: Rec) => n.id === SUBS).label).toBe('New starter subscribers');
  });

  it('RED: Starter\'s licensed chance is provisional and its notes say the range is read with Olumi\'s approximation', () => {
    const l = goalChanceLicenceOf(envelope(), READ.graph, GOAL) as Rec;
    expect(l.option_ids).toContain(STARTER);
    expect(l.notes).toContain(BRIEF_LINE);
    expect(l.provisional).toBe(true);
    // Never the person's calibration, and never "middle half".
    expect(JSON.stringify(l.notes)).not.toMatch(/middle half|your quartiles|your calibration of/i);
  });

  it('RED (the AI): with Starter\'s chance shown as a point, the selected Run\'s must_say carries the line, once', () => {
    // The b2 spec's licensed-point control: Keep and Starter, Starter's stored P at 0.97 with an outcome, no stored warnings.
    const e = envelope();
    e.option_comparison = e.option_comparison.filter((r: Rec) => ['keep_current_pricing', STARTER].includes(r.option_id));
    e.option_comparison.find((r: Rec) => r.option_id === STARTER).outcome = { p10: 130000, p50: 140000, p90: 150000, std: 10000, mean: 140000 };
    e.option_comparison.find((r: Rec) => r.option_id === 'keep_current_pricing').outcome = { p10: 110000, p50: 120000, p90: 130000, std: 10000, mean: 120000 };
    e.inference_warnings = [];
    const published = projectGoalProbabilitiesForTransport(withGoalChanceLicence(e, READ.graph, GOAL), RUN.goal_certainty);
    const block = RUN.blocks.find((b: Rec) => b.type === 'analysis_result');
    const facts = runFactsOf({ ...block, enrichment: published }, READ.graph, true) as Rec;
    expect(facts.chances.goal_chance_display).toHaveProperty(STARTER);
    expect((facts.must_say as string[]).filter((x) => x === BRIEF_LINE)).toHaveLength(1);
  });

  it('CONTRAST: the same served Run with no range on Starter\'s setting says no such line', () => {
    const g = clone(READ.graph);
    delete starterCell(g).range;
    const l = goalChanceLicenceOf(envelope(), g, GOAL) as Rec;
    expect(JSON.stringify(l.notes ?? [])).not.toContain('equal-tail approximation');
  });

  it('CONTRAST: a range Olumi wrote is said as Olumi\'s range, never "your"', () => {
    const g = clone(READ.graph);
    starterCell(g).range.source = 'cee_hypothesis';
    const l = goalChanceLicenceOf(envelope(), g, GOAL) as Rec;
    expect(l.notes).toContain(BRIEF_LINE.replace('uses your range', 'uses Olumi’s range').replace('not your own calibration', 'not a measured calibration'));
  });
});

// ── cloud migration, served (R3 r1) ──────────────────────────────────────────────────────────────────────────────────
const B6 = JSON.parse(readFileSync(new URL('../../../orchestrator/context/__tests__/fixtures/b6-cloud-r1-20260930.json', import.meta.url), 'utf8')) as {
  user_limit: { graph: Rec };
};
const LIMIT = 'agent-lane:migration_downtime:<=';
const TARGET = 'migration_downtime';
/** The cloud spec's own shape: 'Switch to GCP' sets the limited downtime to Olumi's 3 weeks, with the user's stated range. */
function ranged(range: Rec | undefined): Rec {
  const g = clone(B6.user_limit.graph);
  g.nodes.find((n: Rec) => n.id === 'switch_to_gcp').interventions = { [TARGET]: { value: 0.25, raw_value: 3, unit: 'weeks', source: 'cee_hypothesis',
    ...(range !== undefined ? { range } : {}) } };
  return g;
}
const USERS_RANGE = { low: 2, high: 5, meaning: 'likely_range', source: 'user_specified', source_quote: 'somewhere between 2 and 5 weeks' };
const SCORED = { per_limit: [{ constraint_id: LIMIT, state: 'scored' }], joint: { state: 'scored' } } as never;
const CLOUD_LINE = '‘Switch to GCP’ uses your range for ‘Migration downtime’, 2 weeks to 5 weeks, read with Olumi’s equal-tail '
  + 'approximation: about one chance in four below 2 weeks and one in four above 5 weeks, a modelling convention, not your own calibration.';

describe('the limit row on the served cloud brief: an option checked through the user\'s range says the law is Olumi\'s', () => {
  it('RED: the downtime limit, checked on Switch to GCP through the user\'s 2–5 weeks, says the range is read with Olumi\'s approximation', () => {
    const [row] = limitChecksForAgent(ranged(USERS_RANGE), SCORED) ?? [];
    expect(row?.withheld_for ?? []).not.toContain('Switch to GCP');
    expect(row?.say).toContain(CLOUD_LINE);
  });

  it('CONTRAST: with no range the option is withheld for Olumi\'s point, and no range line is said', () => {
    const [row] = limitChecksForAgent(ranged(undefined), SCORED) ?? [];
    expect(row?.withheld_for).toEqual(['Switch to GCP']);
    expect(row?.say).not.toContain('equal-tail approximation');
  });

  it('CONTRAST: a range with another meaning (a hard min–max) is not a likely range: no approximation line', () => {
    const [row] = limitChecksForAgent(ranged({ ...USERS_RANGE, meaning: 'min_max' }), SCORED) ?? [];
    expect(row?.say ?? '').not.toContain('equal-tail approximation');
  });
});

describe('the words are one producer', () => {
  it('likelyRangeLawWords says the ends\' owner and the law as Olumi\'s', () => {
    expect(likelyRangeLawWords('Switch to GCP', 'Migration downtime', { factor_id: TARGET, low: 2, high: 5, unit: 'weeks', persons_own: true }))
      .toBe(CLOUD_LINE);
  });
  it('the card\'s tool-result note keeps the user\'s ends and Olumi\'s law apart', () => {
    expect(LIKELY_RANGE_LAW_NOTE).toContain('The two ends are the user’s.');
    expect(LIKELY_RANGE_LAW_NOTE).toContain('is Olumi’s modelling convention, adopted only by the press: never call it the user’s calibration.');
  });
});
