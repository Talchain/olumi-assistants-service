/**
 * ⭐ M4-cohort: the WHOLE cohort ask chain, walked through the real producers, so the next break shows (DL 15 Oct). Served
 * break it closes (target-testability, before): readiness asked the same-people question until some option held a FULL forecast;
 * after the user's "yes" the never-re-ask egress stripped it, the step had no question, and the per-option forecast ask never came.
 * Now each step is: readiness's question → the user's words, bound to that ask on the ONE door → the row's writer → the stored
 * graph (through the persistence projection) → readiness's NEXT question. Two briefs: Paul's marketing (served run-08, every
 * option's figures as ISL/PLoT actually scored them, ending in the licensed joint) and a recruitment funnel (ending at the wire).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import { targetTestabilityOf, untestableTargetParts } from '../../admission/target-testability.js';
import { applyCohortForecastEdit, applyGoalRelationEdit, cohortForecastAskWords, cohortWindowOf, sameCohortStatementOf, storedTargetRowsOf } from '../../goal-target/cohort-forecast-write.js';
import { readCohortForecast, targetForecastWireOf } from '../../goal-target/cohort-forecast.js';
import { goalTargetBasisOf, launchWindowQuestion, periodWords } from '../../goal-target/goal-target-basis.js';
import { withholdGoalFiguresForMissingCurrentLevel, wireGoalConstraints } from '../../tools/handlers/run-analysis.js';
import { withGoalChanceLicence } from '../../goal-target/goal-chance-licence.js';
import { cohortForecastAsks } from '../fields/cohort-relation.js';
import { readStatement } from '../read.js';
import { doorRowFor } from '../role-table.js';

type Rec = Record<string, any>;
const persisted = (g: unknown): Rec => assignEntityRefs(projectGraphForPersistence(GraphV3.parse(g)), { nodes: [], edges: [] }).graph as Rec;
const edge = (from: string, to: string): Rec => ({ from, to, strength: { std: 0.1, mean: 0.5 }, provenance: { source: 'cee_hypothesis' }, effect_direction: 'positive', exists_probability: 1 });
const F = JSON.parse(readFileSync('tests/fixtures/marketing-withheld-once/run-08.json', 'utf8')) as Rec;
const E = JSON.parse(readFileSync('tests/fixtures/marketing-cohort-forecast/plot-target-forecast.json', 'utf8')) as Rec;

/** A recruitment funnel over the first four months after the job ads go live ("launch"): its own labels, units and figures. */
const RECRUITMENT = (): Rec => persisted({
  nodes: [
    { id: 'how_should_we_hire_engineers', kind: 'decision', label: 'Should we use an agency or a referral scheme to hire engineers?', provenance: 'from_brief' },
    { id: 'offer_acceptance_rate', kind: 'goal', label: 'Offer acceptance rate', provenance: 'from_brief', goal_direction: '>', goal_threshold: 0.6,
      goal_threshold_raw: 60, goal_threshold_unit: '%', goal_threshold_frame: 'level', goal_threshold_cap: 100, goal_threshold_cap_provenance: 'metric_scale',
      goal_horizon_months: 4,
      goal_target_basis: { source: 'olumi_reading', reference: 'launch', target_raw: 60, target_frame: 'level', quantity_frame: 'level',
        effect_unit: 'percentage points of offer acceptance rate over the first four months after launch', period_kind: 'over_period', period_months: 4,
        effects_at_period_end: true, also_required: ['hire at least 5 engineers within the first four months'] } },
    { id: 'carry_on_as_now', kind: 'option', label: 'Carry on as now', provenance: 'ai_inferred', is_baseline: true },
    { id: 'start_a_referral_scheme', kind: 'option', label: 'Start a referral scheme', provenance: 'from_brief' },
    { id: 'candidate_quality', kind: 'factor', label: 'Candidate quality', provenance: 'ai_inferred' },
    { id: 'engineers_hired', kind: 'outcome', label: 'Engineers hired', provenance: 'from_brief', scale_frame: 100 },
  ],
  edges: [edge('how_should_we_hire_engineers', 'carry_on_as_now'), edge('how_should_we_hire_engineers', 'start_a_referral_scheme'),
    edge('start_a_referral_scheme', 'candidate_quality'), edge('candidate_quality', 'offer_acceptance_rate'), edge('candidate_quality', 'engineers_hired')],
  goal_constraints: [
    { role: 'goal_target', unit: '%', label: 'Offer acceptance rate', value: 60, node_id: 'offer_acceptance_rate', operator: '>=', operator_as_stated: '>',
      provenance: 'explicit', value_frame: 'level', constraint_id: 'agent-lane:offer_acceptance_rate:>=' },
    { role: 'goal_target', unit: 'engineers', label: 'Engineers hired', value: 5, node_id: 'engineers_hired', operator: '>=',
      provenance: 'explicit', value_frame: 'level', constraint_id: 'agent-lane:engineers_hired:>=' },
  ],
});

const BRIEFS = [
  { name: 'marketing (served run-08)', graph: () => persisted(F.graph), rate: 'Conversion rate', count: 'New customers in first 3 months',
    same: 'Yes, the new customers will come from the same people we measure the conversion rate on.',
    figures: E.inputs as Record<string, { people_reached: number; conversion_middle_half_pct: [number, number] }> },
  { name: 'recruitment funnel', graph: RECRUITMENT, rate: 'Offer acceptance rate', count: 'Engineers hired',
    same: 'Yes, the engineers we hire are the candidates who accept our offers.',
    figures: { carry_on_as_now: { people_reached: 6, conversion_middle_half_pct: [40, 65] }, start_a_referral_scheme: { people_reached: 9, conversion_middle_half_pct: [55, 80] } } },
];

const goalOf = (g: Rec): Rec => g.nodes.find((n: Rec) => n.kind === 'goal');
const question = (g: Rec): string | null => untestableTargetParts(g, targetTestabilityOf(g))?.question ?? null;

describe.each(BRIEFS)('the cohort ask chain, walked: $name', (b) => {
  /** Walks the chain; returns the final graph and every question readiness asked, in order. */
  function walk(): { g: Rec; asked: string[] } {
    let g = b.graph();
    const asked: string[] = [];
    const said: string[] = [];
    const basis = goalTargetBasisOf(goalOf(g))!;
    const window = cohortWindowOf(g)!;
    const sameQ = launchWindowQuestion(b.rate, basis, b.count);
    // 1. The same-people question, answered once, recorded on the GOAL.
    let q = question(g);
    asked.push(q!);
    expect(q, 'readiness asks the same-people question first').toBe(sameQ);
    said.push(b.same);
    const goalSubject = { kind: 'goal' as const, id: goalOf(g).id, field: 'relation' as const };
    const v0 = readStatement(g, goalSubject, goalOf(g).label, [{ quote: b.same, answering: q! }], { now: b.same } as never, { asks: cohortForecastAsks(g, sameQ) });
    if (v0.kind !== 'read') throw new Error(JSON.stringify(v0));
    const w0 = doorRowFor(goalSubject, g)!.writer.approve(v0.reading, g) as Rec;
    expect(w0.member).toBe('goal_relation');
    const g0 = applyGoalRelationEdit(g, w0.payload) as Rec;
    expect(g0.kind).toBe('mutated');
    g = persisted(g0.mutatedGraph);
    expect(w0.holds(g), 'the read-back holds the words after the persistence projection').toBe(true);
    expect(sameCohortStatementOf(g)?.quote).toBe(b.same);
    // 2. Each option's forecast ask, in readiness's order, answered with the people and the one-in-four range.
    for (let guard = 0; guard < 10; guard += 1) {
      q = question(g);
      const waiting = g.nodes.filter((n: Rec) => n.kind === 'option' && readCohortForecast(n) === undefined);
      if (waiting.length === 0) break;
      const option = waiting[0];
      asked.push(q!);
      expect(q, 'never the same-people question again').not.toBe(sameQ);
      expect(q).toBe(cohortForecastAskWords(option.label, periodWords(basis), window));
      const f = b.figures[option.id]!;
      const people = `I think it would reach about ${f.people_reached} people.`;
      const range = `Between ${f.conversion_middle_half_pct[0]} and ${f.conversion_middle_half_pct[1]}%.`;
      said.push(people, range);
      const subject = { kind: 'option' as const, id: option.id, field: 'relation' as const };
      const v = readStatement(g, subject, option.label, [{ quote: people, answering: q! }, { quote: range, answering: q! }],
        { conversation: said.slice(0, -2).join('\n\n'), now: `${people} ${range}` } as never, { asks: cohortForecastAsks(g, sameQ) });
      if (v.kind !== 'read') throw new Error(`${option.id}: ${JSON.stringify(v)}`);
      const w = doorRowFor(subject, g)!.writer.approve(v.reading, g) as Rec;
      expect(w.member, JSON.stringify(w)).toBe('cohort_forecast');
      const written = applyCohortForecastEdit(g, w.payload) as Rec;
      expect(written.kind).toBe('mutated');
      g = persisted(written.mutatedGraph);
      expect(w.holds(g)).toBe(true);
    }
    return { g, asked };
  }

  it('RED (the break): after the same-people answer, readiness asks each option\'s forecast once, in turn, then no cohort question', () => {
    const { g, asked } = walk();
    const options = g.nodes.filter((n: Rec) => n.kind === 'option');
    expect(asked).toHaveLength(1 + options.length);
    expect(new Set(asked).size, 'no question asked twice').toBe(asked.length);
    const last = question(g);
    expect(last === null || !(last.includes('come from the same people') || last.includes('how many people would it reach'))).toBe(true);
    for (const n of options) {
      const f = b.figures[n.id]!;
      expect(readCohortForecast(n)).toMatchObject({ people_reached: f.people_reached, conversion_middle_half_pct: f.conversion_middle_half_pct, author: 'user',
        same_cohort: { stated_by: 'user' } });
      expect(targetForecastWireOf(n, storedTargetRowsOf(g))).toMatchObject({ exposure: f.people_reached,
        rate_quartiles: [f.conversion_middle_half_pct[0] / 100, f.conversion_middle_half_pct[1] / 100] });
    }
  });

  it.runIf(b.name.startsWith('marketing'))('RED (the end of the chain): the Run\'s licence gives the joint of both targets per option, the limits named as left out', () => {
    const { g } = walk();
    const pre = JSON.parse(JSON.stringify({ ...F.enrichment, inference_warnings: (F.enrichment.inference_warnings as Rec[])
      .filter((w) => w.code !== 'GOAL_FIGURES_MISSING_CURRENT_LEVEL' && w.code !== 'GOAL_CHANCE_LICENSED') }));
    for (const r of pre.option_comparison as Rec[]) r.target_forecast = JSON.parse(JSON.stringify(E.target_forecast_by_option[r.option_id]));
    const stored = g.goal_constraints;
    const env = withholdGoalFiguresForMissingCurrentLevel(pre, g, stored) as Rec;
    const enrichment = withGoalChanceLicence(env, g, 'conversion_rate', () => false, undefined, g, {
      storedConstraints: stored, sentConstraints: wireGoalConstraints(stored), perLimit: F.limit_verdicts.per_limit }) as Rec;
    const l = (enrichment.inference_warnings as Rec[]).find((w) => w.code === 'GOAL_CHANCE_LICENSED')!;
    expect(l.targets.basis).toBe('same_cohort_forecast');
    expect(l.targets.joint).toMatchObject({ status: 'licensed' });
    expect(l.targets.joint.pct_by_option).toEqual({ carry_on_as_now: 7, hire_marketing_manager: 51, use_ai_and_boost_ads: 31, ai_pilot_with_moderate_ads: 27 });
    expect((l.targets.notes as string[]).some((n) => n.startsWith('This covers your two targets only.'))).toBe(true);
  });

  it('CONTRAST: before the same-people answer is recorded, readiness keeps asking it (nothing is assumed from silence)', () => {
    const g = b.graph();
    expect(sameCohortStatementOf(g)).toBeUndefined();
    expect(question(g)).toBe(launchWindowQuestion(b.rate, goalTargetBasisOf(goalOf(g))!, b.count));
  });
});
