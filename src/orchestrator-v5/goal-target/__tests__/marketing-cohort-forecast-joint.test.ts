/**
 * ⭐ MARKETING'S JOINT FROM THE SAME-COHORT FORECAST (AIE laws ruling 13 Oct; science PR-4; ISL #234 → PLoT #450 → here).
 * "Conversion over 15% and 20 new customers within the first three months after launch": once each option holds its cohort
 * forecast (people reached, the conversion's likely range) and the user has said the customers come from those same people,
 * the Run's licence says the chance of meeting BOTH targets, per option, from that forecast, and names the limits it leaves out.
 *
 * Corpus: the served marketing Run press (`tests/fixtures/marketing-withheld-once/run-08.json`, `_source`) through the real
 * producer (`withholdGoalFiguresForMissingCurrentLevel`) and licence (`withGoalChanceLicence`), with each option's
 * `target_forecast` as ISL a5725a15 + PLoT #450 actually returned it (`tests/fixtures/marketing-cohort-forecast/…`, `_source`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { withholdGoalFiguresForMissingCurrentLevel, wireGoalConstraints } from '../../tools/handlers/run-analysis.js';
import { withGoalChanceLicence } from '../goal-chance-licence.js';
import { targetForecastWireOf } from '../cohort-forecast.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

type Rec = Record<string, any>;
const F = JSON.parse(readFileSync('tests/fixtures/marketing-withheld-once/run-08.json', 'utf8')) as Rec;
const E = JSON.parse(readFileSync('tests/fixtures/marketing-cohort-forecast/plot-target-forecast.json', 'utf8')) as Rec;
const OPTIONS = ['carry_on_as_now', 'hire_marketing_manager', 'use_ai_and_boost_ads', 'ai_pilot_with_moderate_ads'];
const CONV = 'agent-lane:conversion_rate:>=';
const CUST = 'agent-lane:new_customers_in_first_3_months:>=';
const SAME = { rate_target_node_id: 'conversion_rate', count_target_node_id: 'new_customers_in_first_3_months', stated_by: 'user' };
const JOINT_WORDS = '‘Conversion rate’ being above 15% and ‘New customers in first 3 months’ being at least 20 customers over the first three months after launch';
const LIMITS_LEFT_OUT = 'This covers your two targets only. Your limits on ‘Annual marketing spend’, ‘Founder marketing time’, ‘Annual marketing budget used’ and ‘Founder marketing time share’ are not included, because the forecast it rests on is of the people reached and how many of them convert; the reasons the model gives for each limit are below.';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The served graph with each named option holding its forecast (as the user gave it, unless `author` says otherwise). */
function graphWith(ids: readonly string[] = OPTIONS, edit: (id: string, f: Rec) => Rec = (_id, f) => f): Rec {
  const g = clone(F.graph);
  for (const n of g.nodes as Rec[]) {
    if (n.kind === 'option' && ids.includes(n.id)) n.cohort_forecast = edit(n.id, { ...E.inputs[n.id], same_cohort: SAME, author: 'user' });
  }
  return g;
}

/** The served Run's enrichment, each named option's record carrying the forecast PLoT returned (optionally altered). */
function enrichmentWith(ids: readonly string[] = OPTIONS, edit: (id: string, tf: Rec) => Rec = (_id, tf) => tf): Rec {
  const pre = clone({ ...F.enrichment, inference_warnings: (F.enrichment.inference_warnings as Rec[])
    .filter((w) => w.code !== 'GOAL_FIGURES_MISSING_CURRENT_LEVEL' && w.code !== 'GOAL_CHANCE_LICENSED') });
  for (const r of pre.option_comparison as Rec[]) {
    if (ids.includes(r.option_id)) r.target_forecast = edit(r.option_id, clone(E.target_forecast_by_option[r.option_id]));
  }
  return pre;
}

function licence(graph: Rec, pre: Rec, stored: Rec[] = graph.goal_constraints): Rec {
  const env = withholdGoalFiguresForMissingCurrentLevel(pre, graph, stored) as Rec;
  const enrichment = withGoalChanceLicence(env, graph, 'conversion_rate', () => false, undefined, graph, {
    storedConstraints: stored, sentConstraints: wireGoalConstraints(stored), perLimit: F.limit_verdicts.per_limit,
  }) as Rec;
  return (enrichment.inference_warnings as Rec[]).find((w) => w.code === 'GOAL_CHANCE_LICENSED')!;
}

describe('marketing: the chance of meeting both targets, from each option’s same-cohort forecast', () => {
  it('PRECONDITION: as served (no forecast held), the joint is withheld and the goal’s missing level is said', () => {
    const l = licence(clone(F.graph), enrichmentWith([]));
    expect(l.targets.basis).toBeUndefined();
    expect(l.targets.joint.status).toBe('withheld');
    expect((l.targets.notes as string[]).some((n) => n.includes('has no level today'))).toBe(true);
  });

  it('RED: every option holds a forecast → the joint of the two targets is licensed per option, with each target beneath', () => {
    const l = licence(graphWith(), enrichmentWith());
    expect(l.targets.basis).toBe('same_cohort_forecast');
    expect(l.targets.joint).toMatchObject({ status: 'licensed', words: JOINT_WORDS });
    // ISL: 0.07 / 0.507 / 0.3135 / 0.273 on 2,000 draws. Meeting both is meeting the harder one (here the conversion), never a
    // product of the two chances (0.07 × 0.8675 would say 6%).
    expect(l.targets.joint.pct_by_option).toEqual({ carry_on_as_now: 7, hire_marketing_manager: 51, use_ai_and_boost_ads: 31, ai_pilot_with_moderate_ads: 27 });
    expect(l.pct_by_option).toEqual(l.targets.joint.pct_by_option);
    expect(l.chance_words).toBe(`chance of ${JOINT_WORDS}`);
    expect(l).not.toHaveProperty('withheld_option_ids');
    const own = Object.fromEntries((l.targets.per_target as Rec[]).map((t) => [t.constraint_id, t.pct_by_option]));
    expect(own[CONV]).toEqual(l.targets.joint.pct_by_option);
    expect(own[CUST]).toEqual({ carry_on_as_now: 87, hire_marketing_manager: 100, use_ai_and_boost_ads: 100, ai_pilot_with_moderate_ads: 100 });
  });

  it('RED: the notes name every limit left out, keep each limit’s own reason, give the inputs, and drop the model’s target reasons', () => {
    const notes = licence(graphWith(), enrichmentWith()).targets.notes as string[];
    expect(notes).toContain(LIMITS_LEFT_OUT);
    expect(notes.filter((n) => n.startsWith('‘Annual marketing spend’ is at most'))).toHaveLength(1);
    const law = notes.find((n) => n.startsWith('These chances rest on a forecast, not on the model’s links'))!;
    // AIE 6180618773 C4: the user's reach is their FORECAST, never a certainty.
    expect(law).toContain('your forecast that ‘Hire marketing manager’ reaches 500 people over the first three months after launch, with your ‘Conversion rate’ estimates of 12% and 18%');
    // AIE 6176433015: the user's quartiles are theirs; the Beta curve through them is Olumi's approximation, said as such.
    expect(law).toContain('Each pair of conversion figures is your own estimate, with about one chance in four below the lower and one in four above the upper');
    expect(law).toContain('a smooth curve through them (a Beta distribution), with each person converting at that same chance, is Olumi’s approximation');
    expect(law).not.toMatch(/as likely to fall inside|middle half|even chance/);
    expect(law).not.toContain('read as');
    // C4: holding the reach fixed is Olumi's explicit conditional scenario, and its uncertainty is said to be left out.
    expect(law).toContain('Each chance is Olumi’s scenario in which exactly that many people are reached; how many are actually reached may differ, and that uncertainty isn’t included.');
    expect(law).not.toContain('is held fixed');
    expect(law).toContain('so with that many reached, meeting both is the same as meeting the harder of the two');
    expect(law).toContain('‘New customers in first 3 months’ counts the people who convert among those same people, as you said');
    // The model's reasons for the targets describe the links, not this figure: never said beside it.
    expect(notes.filter((n) => n.includes('has no level today') || n.startsWith('‘New customers in first 3 months’ being'))).toEqual([]);
  });

  it('RED: Olumi’s figures stay Olumi’s → named, and the licence is provisional', () => {
    const l = licence(graphWith(OPTIONS, (id, f) => (id === 'hire_marketing_manager' ? { ...f, author: 'olumi' } : f)), enrichmentWith());
    expect(l.provisional).toBe(true);
    expect(l.targets.notes).toContain('The figures for ‘Hire marketing manager’ are Olumi’s estimates, not yours, so the chances that rest on them are provisional.');
    // ⛔ The inputs say whose each forecast is (never "your" for Olumi's), and the pair of figures is not called the user's.
    const law = (l.targets.notes as string[]).find((n) => n.startsWith('These chances rest on a forecast'))!;
    expect(law).toContain('Olumi’s estimate that ‘Hire marketing manager’ reaches 500 people over the first three months after launch, with Olumi’s ‘Conversion rate’ estimates of 12% and 18%');
    expect(law).toContain('your forecast that ‘Use AI and boost ads’ reaches');
    expect(law).toContain('Each pair of conversion figures is an estimate, with');
    expect(law).not.toContain('your forecast that ‘Hire marketing manager’');
    const users = licence(graphWith(), enrichmentWith());
    expect(users).not.toHaveProperty('provisional');
  });

  it('CONTRAST: an option with no forecast is withheld by name; the others keep their figures', () => {
    const rest = OPTIONS.filter((id) => id !== 'carry_on_as_now');
    const l = licence(graphWith(rest), enrichmentWith(rest));
    expect(l.targets.joint.pct_by_option).toEqual({ hire_marketing_manager: 51, use_ai_and_boost_ads: 31, ai_pilot_with_moderate_ads: 27 });
    expect(l.withheld_option_ids).toEqual(['carry_on_as_now']);
    expect(l.targets.notes).toContain('‘Carry on as now’ has no forecast of the people reached and how many convert in this Run, so its chance isn’t shown.');
  });

  it('CONTRAST: a forecast scored on another comparison, threshold, cohort or quartiles than the one held is never said', () => {
    const cases: [string, (id: string, tf: Rec) => Rec][] = [
      ['at least 15% for "above 15%"', (_id, tf) => ({ ...tf, conditions: tf.conditions.map((c: Rec) => c.constraint_id === CONV ? { ...c, operator: '>=' } : c) })],
      ['14% for 15%', (_id, tf) => ({ ...tf, conditions: tf.conditions.map((c: Rec) => c.constraint_id === CONV ? { ...c, threshold: 0.14 } : c) })],
      ['another cohort size', (_id, tf) => ({ ...tf, law: { ...tf.law, exposure: tf.law.exposure + 1 } })],
      ['other quartiles', (_id, tf) => ({ ...tf, law: { ...tf.law, rate_quartiles: [0.1, 0.2] } })],
      ['one target only', (_id, tf) => ({ ...tf, conditions: tf.conditions.filter((c: Rec) => c.constraint_id === CONV) })],
    ];
    for (const [name, edit] of cases) {
      const l = licence(graphWith(), enrichmentWith(OPTIONS, edit));
      expect([name, l.targets.joint.status]).toEqual([name, 'withheld']);
      expect([name, l.pct_by_option]).toEqual([name, {}]);
      expect([name, l.targets.per_target]).toEqual([name, []]);
    }
  });

  it('CONTRAST: without the user’s same-cohort answer the stored forecast is absent; one stated target is not this law', () => {
    const unanswered = graphWith(OPTIONS, (_id, f) => { const { same_cohort: _s, ...rest } = f; return rest; });
    expect(licence(unanswered, enrichmentWith()).targets.joint.status).toBe('withheld');
    const oneTarget = (F.graph.goal_constraints as Rec[]).filter((r) => r.constraint_id !== CUST);
    expect(licence(graphWith(), enrichmentWith(), oneTarget).targets?.basis).toBeUndefined();
  });
});

describe('the Run sends each option’s forecast for exactly the two targets the user’s answer names', () => {
  const targets = (F.graph.goal_constraints as Rec[]).filter((r) => r.role === 'goal_target');
  const node = (g: Rec, id: string): Rec => (g.nodes as Rec[]).find((n) => n.id === id)!;

  it('RED: the wire block is the held forecast, in ISL’s units, on the stored rows the Run sends', () => {
    const wire = targetForecastWireOf(node(graphWith(), 'hire_marketing_manager'), targets);
    expect(wire).toEqual({ law: 'same_cohort_beta_binomial', exposure: 500, rate_quartiles: [0.12, 0.18],
      conditions: [{ constraint_id: CONV, quantity: 'rate', threshold: 0.15 }, { constraint_id: CUST, quantity: 'count', threshold: 20 }] });
    const sent = new Set((wireGoalConstraints(F.graph.goal_constraints) as Rec[]).map((r) => r.constraint_id));
    expect(wire!.conditions.every((c) => sent.has(c.constraint_id))).toBe(true);
  });

  it('CONTRAST: no forecast, no answer, a range the wrong way round, or targets the answer does not name → nothing is sent', () => {
    expect(targetForecastWireOf(node(clone(F.graph), 'hire_marketing_manager'), targets)).toBeUndefined();
    const bad: Rec[] = [
      { same_cohort: undefined },
      { conversion_middle_half_pct: [18, 12] },
      { people_reached: 12.5 },
      { same_cohort: { ...SAME, count_target_node_id: 'annual_marketing_spend' } },
      { same_cohort: { ...SAME, stated_by: 'olumi' } },
    ];
    for (const b of bad) {
      expect([b, targetForecastWireOf(node(graphWith(OPTIONS, (_id, f) => ({ ...f, ...b })), 'hire_marketing_manager'), targets)]).toEqual([b, undefined]);
    }
    expect(targetForecastWireOf(node(graphWith(), 'hire_marketing_manager'), targets.slice(0, 1))).toBeUndefined();
  });

  it('a change to a held forecast stales a stored Run; a graph without one hashes as before', () => {
    const plain = clone(F.graph);
    const held = graphWith();
    const changed = graphWith(OPTIONS, (id, f) => (id === 'hire_marketing_manager' ? { ...f, people_reached: 501 } : f));
    const malformed = graphWith(OPTIONS, (_id, f) => ({ ...f, people_reached: -1 }));
    const h = (g: Rec) => computeAnalysisAffectingGraphHash(g as never);
    expect(h(held)).not.toBe(h(plain));
    expect(h(changed)).not.toBe(h(held));
    expect(h(malformed)).toBe(h(plain));
  });
});
