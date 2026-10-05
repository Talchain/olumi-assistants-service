import { describe, expect, it } from 'vitest';
import {
  computeScaffoldPlan,
  gateAnalysableOptions,
  PLOT_MIN_COMPARISON_OPTIONS,
} from '../analysable-option-gate.js';
import { resolveRunAdmission } from '../analysis-ready-core.js';
import { resolveAnalysisAdmission } from '../../../admission/analysis-admission.js';
import {
  buildAnalysisSubmissionDisclosure,
  SCAFFOLD_ANY_DISCLOSURE_RE_SRC,
  SCAFFOLD_DISCLOSURE_MAX_CHARS,
} from '../../../coaching/scaffold-disclosure.js';
import { assessRouteAdmission } from '../../../../cee/graph-readiness/canonical-readiness.js';
import { CEEGraphReadinessResponseV1Schema } from '../../../../schemas/ceeResponses.js';
import { readinessSentence, readinessViewOf } from '../../../agent-lane/readiness-view.js';
import {
  assessCanonicalAnalysisReadiness,
  buildCanonicalAnalysisReadyFromGraph,
} from '../../../../orchestrator/tools/analysis-ready-helper.js';

type Rec = Record<string, unknown>;
const TECH = 'hire_lead';
const DEVS = 'hire_two';
const BASE = 'carry_on';
const NO_CHANGE = "Hire Two Developers was left out: it sets Developers to today's level, so it changes nothing. Edit its value if you meant a change.";
const MISSING = "'Explore another hire' was left out of this comparison because it has no values set. To include it, say 'Help me configure Explore another hire.'";
const RISK_ASK = 'How likely or how large is "Lack of AI experience" today? Without a figure it would be treated as zero.';
const FACTOR_ASK = 'What is "Current delivery capacity" today, before any option changes it? Without a current level the analysis would treat it as zero.';

const option = (id: string, label: string, interventions: Rec, is_baseline = false): Rec => ({
  id, option_id: id, kind: 'option', label, interventions, is_baseline,
});
const edge = (from: string, to: string, negative = false): Rec => ({
  from, to, strength: { mean: negative ? -0.4 : 0.4, std: 0.1 },
  exists_probability: 1, effect_direction: negative ? 'negative' : 'positive',
});

/** Held-out-shaped replica. All numbers/frames/edges are authored HERE,
 * independently of production scale, hold, graph-construction or fixture helpers.
 * Option levels are absolute build-time levels; editing today never rewrites them.
 */
function replica(developersToday = 6, baseline = true) {
  const options = [
    option(TECH, 'Hire a Tech Lead', { tech_leads: { value: 2 / 10, source: 'brief_extraction' } }),
    option(DEVS, 'Hire Two Developers', { developers: { value: 6 / 30, source: 'brief_extraction' } }),
    ...(baseline ? [option(BASE, 'Carry On as Now', {}, true)] : []),
  ];
  const nodes: Rec[] = [
    { id: 'decision', kind: 'decision', label: 'Hiring approach' },
    { id: 'goal', kind: 'goal', label: 'Meet our next feature-launch deadline' },
    { id: 'tech_leads', kind: 'factor', label: 'Tech leads', category: 'controllable',
      observed_state: { value: 1 / 10, raw_value: 1, unit: 'people', source: 'brief_extraction' } },
    { id: 'developers', kind: 'factor', label: 'Developers', category: 'controllable',
      observed_state: { value: developersToday / 30, raw_value: developersToday, unit: 'people', source: 'brief_extraction' } },
    { id: 'productivity', kind: 'factor', label: 'Delivery productivity', category: 'observable',
      observed_state: { value: 20 / 100, raw_value: 20, unit: 'feature points/week', source: 'brief_extraction' } },
    { id: 'overhead', kind: 'factor', label: 'Coordination overhead', category: 'observable',
      observed_state: { value: 15 / 100, raw_value: 15, unit: '%', source: 'brief_extraction' } },
    ...options,
  ];
  const edges = [
    ...options.map((o) => edge('decision', String(o.id))),
    edge(TECH, 'tech_leads'), edge(DEVS, 'developers'),
    ...(baseline ? [edge(BASE, 'tech_leads'), edge(BASE, 'developers')] : []),
    edge('tech_leads', 'productivity'), edge('developers', 'productivity'),
    edge('tech_leads', 'overhead'), edge('developers', 'overhead'),
    edge('overhead', 'productivity', true), edge('productivity', 'goal'),
  ];
  return { nodes, edges, options, goal_node_id: 'goal' };
}
const gateOf = (g: ReturnType<typeof replica>) => gateAnalysableOptions({
  options: g.options, graph: g, rawPersistedGraph: g, scaleNetEnabled: true,
});
const ids = (options: readonly Rec[]) => options.map((o) => o.option_id);
const disclosureOf = (g: ReturnType<typeof replica>) => buildAnalysisSubmissionDisclosure(
  { analysed: [], omitted: [], stamped: [] }, gateOf(g).excluded,
);
function addEmptyOption(g: ReturnType<typeof replica>) {
  const o = option('explore', 'Explore another hire', {});
  g.nodes.push(o); g.options.push(o);
  g.edges.push(edge('decision', 'explore'), edge('explore', 'developers'));
  return g;
}
const reasonOf = (g: unknown) => resolveAnalysisAdmission(g).reasons.find((r) => r.code === 'RUN_WILL_EXCLUDE_OPTIONS');

describe('absolute option levels compared with today (a994c38a replica)', () => {
  it('N1: Developers 6 makes Hire Two Developers a disclosed, unsubmitted no-change arm', () => {
    const g = replica();
    const before = structuredClone(g);
    const outcome = gateOf(g);
    expect(outcome.excluded).toEqual([{
      option_id: DEVS, label: 'Hire Two Developers', reason: 'no_change_from_today', factor_labels: ['Developers'],
    }]);
    expect(ids(outcome.options)).toEqual([TECH, BASE]);
    expect(disclosureOf(g)).toBe(` ${NO_CHANGE}`);
    expect(new RegExp(`^(?:${SCAFFOLD_ANY_DISCLOSURE_RE_SRC})$`).test(disclosureOf(g))).toBe(true);
    expect(disclosureOf(g).length).toBeLessThanOrEqual(SCAFFOLD_DISCLOSURE_MAX_CHARS);
    expect(g).toEqual(before);
  });

  it('N1-contrast: Developers 4 keeps the build-time intervention at 6/30', () => {
    const g = replica(4);
    expect(ids(gateOf(g).options)).toEqual([TECH, DEVS, BASE]);
    expect(gateOf(g).excluded).toEqual([]);
  });

  it('N2: without a baseline, the only no-change arm is kept as today', () => {
    const g = replica(6, false);
    g.options[1]!.label = 'Keep current team';
    // Include another changing arm so removing today does not hit the minimum:
    // this separates G2 from G4 rather than letting the floor mask G2.
    const third = option('hire_three', 'Hire Three Developers', { developers: { value: 7 / 30 } });
    g.options.push(third); g.nodes.push(third);
    g.edges.push(edge('decision', 'hire_three'), edge('hire_three', 'developers'));
    expect(ids(gateOf(g).options)).toEqual([TECH, DEVS, 'hire_three']);
    expect(gateOf(g).excluded).toEqual([]);
  });

  it('N3: without a baseline, first no-change arm stays and second is excluded', () => {
    const g = replica(6, false);
    const second = option('keep_team', 'Keep current team', { developers: { value: 6 / 30 } });
    g.options.push(second); g.nodes.push(second);
    g.edges.push(edge('decision', 'keep_team'), edge('keep_team', 'developers'));
    expect(ids(gateOf(g).options)).toEqual([TECH, DEVS]);
    expect(gateOf(g).excluded).toMatchObject([{ option_id: 'keep_team', reason: 'no_change_from_today' }]);
  });

  it('N4: arithmetic float noise is equal within tolerance; a real small change is included', () => {
    const g = replica();
    const computedAnotherWay = (6 / 10) / 3;
    expect(computedAnotherWay).not.toBe(6 / 30); // G3 must discriminate exact equality
    g.options[1]!.interventions = { developers: { value: computedAnotherWay } };
    expect(gateOf(g).excluded).toMatchObject([{ option_id: DEVS, reason: 'no_change_from_today' }]);
    g.options[1]!.interventions = { developers: { value: 6.1 / 30 } };
    expect(gateOf(g).excluded).toEqual([]);
    expect(ids(gateOf(g).options)).toContain(DEVS);
  });

  it('N5: a no-change exclusion must not cross the minimum submitted count', () => {
    const g = replica();
    g.options.splice(0, 1); // configured no-change arm + held baseline, two submitted arms
    expect(g.options).toHaveLength(PLOT_MIN_COMPARISON_OPTIONS);
    const outcome = gateOf(g);
    expect(ids(outcome.options)).toEqual([DEVS, BASE]);
    expect(outcome.excluded).toEqual([]);
  });

  it('N6: admission, route, schema and readiness carry the true no-change reason', () => {
    const g = replica();
    expect(resolveRunAdmission(g).willProceed).toBe(true);
    const expected = `Analysis can run, leaving out one option. ${NO_CHANGE}`;
    expect(reasonOf(g)).toMatchObject({ code: 'RUN_WILL_EXCLUDE_OPTIONS', message: expected });
    const plan = assessRouteAdmission(g).scaffold_plan;
    expect(plan.excluded_option_ids).toEqual([DEVS]);
    expect(plan.excluded_options).toEqual(gateOf(g).excluded);
    expect(computeScaffoldPlan({ options: g.options, graph: g, scaleNetEnabled: true }).excluded_options).toEqual(gateOf(g).excluded);
    expect(readinessSentence(readinessViewOf(g))).toBe(`The analysis can run now. ${NO_CHANGE}`);
    const schema = CEEGraphReadinessResponseV1Schema.shape.scaffold_plan;
    expect(schema.parse(plan)?.excluded_options).toEqual(gateOf(g).excluded);
  });

  it('N6-ready: an explicitly valued baseline also discloses the exclusion on strict-ready admission', () => {
    const g = replica();
    g.options[2]!.interventions = { tech_leads: { value: 1 / 10 }, developers: { value: 6 / 30 } };
    expect(resolveRunAdmission(g).willProceed).toBe(true);
    expect(reasonOf(g)?.message).toBe(`Analysis can run, leaving out one option. ${NO_CHANGE}`);
  });

  it('N6-mixed: every excluded option has its own true reason and unchanged missing-values words', () => {
    const g = addEmptyOption(replica());
    expect(resolveRunAdmission(g).willProceed).toBe(true);
    expect(reasonOf(g)?.message).toBe(`Analysis can run, leaving out 2 options. ${MISSING} ${NO_CHANGE}`);
    expect(disclosureOf(g)).toBe(` ${MISSING} ${NO_CHANGE}`);
    expect(readinessSentence(readinessViewOf(g))).toBe(`The analysis can run now. ${MISSING} ${NO_CHANGE}`);
    expect(new RegExp(`^(?:${SCAFFOLD_ANY_DISCLOSURE_RE_SRC})$`).test(disclosureOf(g))).toBe(true);
    expect(assessRouteAdmission(g).scaffold_plan.excluded_option_ids).toEqual(['explore', DEVS]);
  });

  it('N6-no_interventions-only: today\'s admission message and disclosure are byte-identical', () => {
    const g = addEmptyOption(replica(4));
    expect(reasonOf(g)?.message).toBe('Analysis can run, leaving out one option you have not set values for.');
    expect(disclosureOf(g)).toBe(` ${MISSING}`);
    expect(readinessSentence(readinessViewOf(g))).toBe('The analysis can run now; it will leave out "Explore another hire" until its levels are set.');
  });

  it('only fully known factor targets qualify: missing and partly changed maps stay', () => {
    const g = replica();
    for (const interventions of [{ missing: 0.2 }, { developers: 0.2, missing: 0.2 }, { developers: 0.2, tech_leads: 0.2 }]) {
      g.options[1]!.interventions = interventions;
      expect(gateOf(g).excluded).toEqual([]);
    }
    const explicit = replica();
    explicit.options[2]!.interventions = { developers: { value: 0.2 } };
    expect(ids(gateOf(explicit).options)).toContain(BASE);
    expect(gateOf(explicit).excluded).toMatchObject([{ option_id: DEVS, reason: 'no_change_from_today' }]);
  });
});

function withRoot(kind: string, valued = false, reaches = true) {
  const g = replica(4);
  g.nodes.push({ id: 'root_gap', kind, label: kind === 'risk' ? 'Lack of AI experience' : 'Current delivery capacity',
    category: 'observable', ...(valued ? { observed_state: { value: 0.35, source: 'brief_extraction' } } : {}),
  });
  if (reaches) g.edges.push(edge('root_gap', 'goal', kind === 'risk'));
  return g;
}
const rootIssues = (g: unknown) => assessCanonicalAnalysisReadiness(g).blockingIssues.filter((i) => i.code === 'MISSING_FACTOR_LEVEL' && i.factor_id === 'root_gap');

describe('every sampled unvalued root kind on the goal path has a typed gap', () => {
  it('R1: a RISK root blocks the run with the exact risk ask on every existing readiness carrier', () => {
    const g = withRoot('risk');
    expect(rootIssues(g)).toEqual([expect.objectContaining({
      code: 'MISSING_FACTOR_LEVEL', factor_id: 'root_gap', factor_label: 'Lack of AI experience',
      message: RISK_ASK, repairability: 'human_input_required', obligation: 'required',
    })]);
    expect(rootIssues(g)[0]?.option_id).toBeUndefined();
    expect(buildCanonicalAnalysisReadyFromGraph(g)?.blockers).toContainEqual(expect.objectContaining({
      factor_id: 'root_gap', blocker_type: 'missing_value', message: RISK_ASK,
    }));
    expect(resolveRunAdmission(g).willProceed).toBe(false);
    expect(assessRouteAdmission(g).may_run).toBe(false);
    expect(readinessSentence(readinessViewOf(g))).toContain(RISK_ASK);
  });

  it('R1-contrast: the same risk with a finite level has no gap and runs', () => {
    const g = withRoot('risk', true);
    expect(rootIssues(g)).toEqual([]);
    expect(resolveRunAdmission(g).willProceed).toBe(true);
  });

  it('R2: FACTOR root keeps the exact existing question', () => {
    const g = withRoot('factor');
    expect(rootIssues(g)).toContainEqual(expect.objectContaining({ code: 'MISSING_FACTOR_LEVEL', message: FACTOR_ASK }));
    expect(buildCanonicalAnalysisReadyFromGraph(g)?.blockers).toContainEqual(expect.objectContaining({ factor_id: 'root_gap', message: FACTOR_ASK }));
    expect(resolveRunAdmission(g).willProceed).toBe(false);
  });

  it('R3: a risk that does not reach the goal produces no level gap', () => {
    expect(rootIssues(withRoot('risk', false, false))).toEqual([]);
  });

  it.each(['outcome', 'action'])('the engine also samples a %s root; non-risk asks reuse today\'s level question', (kind) => {
    expect(rootIssues(withRoot(kind))).toContainEqual(expect.objectContaining({ code: 'MISSING_FACTOR_LEVEL', message: FACTOR_ASK }));
  });

  it('sampled priors, causal parents, legacy finite levels and switches keep their existing exemptions', () => {
    const prior = withRoot('risk');
    prior.nodes.at(-1)!.prior = { distribution: 'uniform', range_min: 0.1, range_max: 0.5 };
    expect(rootIssues(prior)).toEqual([]);
    const child = withRoot('risk'); child.edges.push(edge('productivity', 'root_gap'));
    expect(rootIssues(child)).toEqual([]);
    const legacy = withRoot('risk'); legacy.nodes.at(-1)!.data = { value: 0.3 };
    expect(rootIssues(legacy)).toEqual([]);
    const sw = withRoot('risk'); sw.nodes.at(-1)!.scale_frame = 1;
    sw.options.forEach((o) => { (o.interventions as Rec).root_gap = 1; });
    expect(rootIssues(sw)).toEqual([]);
  });
});
