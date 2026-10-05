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
import { readinessSentence, readinessViewOf, stillNeededLine } from '../../../agent-lane/readiness-view.js';
import { AnalysisReadyPayload as AnalysisReadyPayloadSchema } from '../../../../schemas/analysis-ready.js';
import {
  assessCanonicalAnalysisReadiness,
  buildCanonicalAnalysisReadyFromGraph,
  carryCanonicalOnlyFields,
} from '../../../../orchestrator/tools/analysis-ready-helper.js';

type Rec = Record<string, unknown>;
const TECH = 'hire_lead';
const DEVS = 'hire_two';
const BASE = 'carry_on';
const NO_CHANGE = "Hire Two Developers was left out: it sets Developers to today's level, so it changes nothing. Edit its value if you meant a change.";
const MISSING = "'Explore another hire' was left out of this comparison because it has no values set. To include it, say 'Help me configure Explore another hire.'";
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
const unvaluedRoots = (g: unknown) => assessCanonicalAnalysisReadiness(g).analysisReady?.unvalued_roots ?? [];

describe('every sampled unvalued root kind on the goal path has a typed gap', () => {
  it('R1: a RISK root runs with zero disclosed and the exact risk ask', () => {
    const g = withRoot('risk');
    expect(rootIssues(g)).toEqual([]);
    expect(unvaluedRoots(g)).toEqual([{
      node_id: 'root_gap', label: 'Lack of AI experience', kind: 'risk', treated_as: 'zero',
    }]);
    expect(buildCanonicalAnalysisReadyFromGraph(g)?.blockers ?? []).not.toContainEqual(expect.objectContaining({ factor_id: 'root_gap' }));
    expect(resolveRunAdmission(g).willProceed).toBe(true);
    expect(assessRouteAdmission(g).may_run).toBe(true);
    expect(assessRouteAdmission(g).unvalued_roots).toEqual(unvaluedRoots(g));
    expect(assessRouteAdmission(g).readiness_issues).not.toContainEqual(expect.objectContaining({ factor_id: 'root_gap' }));
    expect(stillNeededLine(readinessViewOf(g))).toBe('No figure is set for "Lack of AI experience" yet, so the analysis treats it as zero. How likely or how large is it today?');
  });

  it('R1-contrast: the same risk with a finite level has no gap and runs', () => {
    const g = withRoot('risk', true);
    expect(rootIssues(g)).toEqual([]);
    expect(unvaluedRoots(g)).toEqual([]);
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
    expect(unvaluedRoots(withRoot('risk', false, false))).toEqual([]);
  });

  it.each(['outcome', 'action'])('an unvalued %s root runs with a separate zero carrier and ask', (kind) => {
    const g = withRoot(kind);
    expect(rootIssues(g)).toEqual([]);
    expect(assessRouteAdmission(g).unvalued_roots).toEqual(unvaluedRoots(g));
    expect(assessRouteAdmission(g).readiness_issues).not.toContainEqual(expect.objectContaining({ factor_id: 'root_gap' }));
    expect(stillNeededLine(readinessViewOf(g))).toBe('No figure is set for "Current delivery capacity" yet, so the analysis treats it as zero. How likely or how large is it today?');
    expect(buildCanonicalAnalysisReadyFromGraph(g)?.unvalued_roots).toEqual([{ node_id: 'root_gap', label: 'Current delivery capacity', kind, treated_as: 'zero' }]);
    expect(assessRouteAdmission(g).may_run).toBe(true);
  });

  it('sampled priors, causal parents, legacy finite levels and switches keep their existing exemptions', () => {
    const prior = withRoot('risk');
    prior.nodes.at(-1)!.prior = { distribution: 'uniform', range_min: 0.1, range_max: 0.5 };
    expect(rootIssues(prior)).toEqual([]);
    expect(unvaluedRoots(prior)).toEqual([]);
    const child = withRoot('risk'); child.edges.push(edge('productivity', 'root_gap'));
    expect(rootIssues(child)).toEqual([]);
    expect(unvaluedRoots(child)).toEqual([]);
    const legacy = withRoot('risk'); legacy.nodes.at(-1)!.data = { value: 0.3 };
    expect(rootIssues(legacy)).toEqual([]);
    expect(unvaluedRoots(legacy)).toEqual([]);
    // The switch exemption is base's FACTOR exemption (the projection carries option levels on factors only); a risk
    // the options set is still disclosed as treated as zero, which is literally what the engine does with it.
    const sw = withRoot('factor'); sw.nodes.at(-1)!.scale_frame = 1;
    sw.options.forEach((o) => { (o.interventions as Rec).root_gap = 1; sw.edges.push(edge(String(o.id), 'root_gap')); });
    expect(rootIssues(sw)).toEqual([]);
    expect(unvaluedRoots(sw)).toEqual([]);
  });
});

const RISK_IDS = ['risk:ai_experience', 'risk:hiring_mismatch'] as const;
const RISK_LABELS = ['Lack of AI experience', 'Hiring mismatch'] as const;
const TWO_RISK_LINE = 'No figures are set for "Lack of AI experience" and "Hiring mismatch" yet, so the analysis treats them as zero. How likely or how large is each today?';

/** Paul's fresh hiring shape: both levers valued; the risks have no figure. */
function freshHiringDraft(withRisks = true, valuedRisks = false) {
  const options = [
    option(BASE, 'Carry On', {}, true),
    option(DEVS, 'Hire Two Developers', { developer_headcount: { value: 6 / 30, source: 'brief_extraction' } }),
    option(TECH, 'Hire a Tech Lead', { tech_lead_headcount: { value: 2 / 10, source: 'brief_extraction' } }),
  ];
  const nodes: Rec[] = [
    { id: 'decision', kind: 'decision', label: 'Hiring approach' },
    { id: 'goal', kind: 'goal', label: 'Meet our next feature-launch deadline' },
    { id: 'developer_headcount', kind: 'factor', label: 'Developers', category: 'controllable',
      observed_state: { value: 4 / 30, raw_value: 4, unit: 'people', source: 'brief_extraction' } },
    { id: 'tech_lead_headcount', kind: 'factor', label: 'Tech leads', category: 'controllable',
      observed_state: { value: 1 / 10, raw_value: 1, unit: 'people', source: 'brief_extraction' } },
    ...options,
    ...(withRisks ? RISK_IDS.map((id, i) => ({ id, kind: 'risk', label: RISK_LABELS[i],
      ...(valuedRisks ? { observed_state: { value: 0.35, source: 'brief_extraction' } } : {}),
    })) : []),
  ];
  const edges = [
    ...options.map((o) => edge('decision', String(o.id))),
    edge(DEVS, 'developer_headcount'), edge(TECH, 'tech_lead_headcount'),
    edge(BASE, 'developer_headcount'), edge(BASE, 'tech_lead_headcount'),
    edge('developer_headcount', 'goal'), edge('tech_lead_headcount', 'goal'),
    ...(withRisks ? RISK_IDS.map((id) => edge(id, 'goal', true)) : []),
  ];
  return { nodes, edges, options, goal_node_id: 'goal' };
}

describe('DL gate 2: non-factor roots disclose zero and ask without refusing Run', () => {
  it('U1: the fresh a994-shaped hiring draft runs and discloses both risk roots by id', () => {
    const g = freshHiringDraft();
    const assessment = assessCanonicalAnalysisReadiness(g);
    const withoutRisks = assessCanonicalAnalysisReadiness(freshHiringDraft(false));
    const ready = buildCanonicalAnalysisReadyFromGraph(g)!;
    const verdict = assessRouteAdmission(g);
    expect(ready.may_run).toBe(true);
    expect(verdict.may_run).toBe(true);
    expect(assessment.analysisReady?.status).toBe(withoutRisks.analysisReady?.status);
    expect(assessment.safeToAnalyse).toBe(withoutRisks.safeToAnalyse);
    const expected = RISK_IDS.map((node_id, i) => ({ node_id, label: RISK_LABELS[i], kind: 'risk', treated_as: 'zero' }));
    // Bind by id; graph order must not stand in for node identity.
    expect(Object.fromEntries(ready.unvalued_roots!.map((r) => [r.node_id, r])))
      .toEqual(Object.fromEntries(expected.map((r) => [r.node_id, r])));
    expect(ready.unvalued_roots).toHaveLength(2);
    expect(assessment.blockingIssues.filter((i) => i.code === 'MISSING_FACTOR_LEVEL')).toEqual([]);
    expect(Object.fromEntries(verdict.unvalued_roots!.map((r) => [r.node_id, r])))
      .toEqual(Object.fromEntries(expected.map((r) => [r.node_id, r])));
    expect(verdict.unvalued_roots).toHaveLength(2);
    for (const factor_id of RISK_IDS) {
      // G9: a disclosure may never enter any readiness issue array, regardless of code.
      expect(assessment.issues).not.toContainEqual(expect.objectContaining({ factor_id }));
      expect(assessment.blockingIssues).not.toContainEqual(expect.objectContaining({ factor_id }));
      expect(assessment.analysisReady?.readiness_issues ?? []).not.toContainEqual(expect.objectContaining({ factor_id }));
      expect(ready.readiness_issues ?? []).not.toContainEqual(expect.objectContaining({ factor_id }));
      expect(verdict.readiness_issues).not.toContainEqual(expect.objectContaining({ factor_id }));
    }
    expect(ready.blockers ?? []).toEqual(withoutRisks.analysisReady?.blockers ?? []);
    expect(stillNeededLine(readinessViewOf(g))).toBe(TWO_RISK_LINE);
    // Differential: the risks add the disclosure and nothing else (the draft's own Carry On asks are unchanged).
    expect(assessment.repairProposal).toEqual(withoutRisks.repairProposal);
    // The schema declares the field (an undeclared key would be stripped by z.object).
    expect(AnalysisReadyPayloadSchema.pick({ unvalued_roots: true }).parse({ unvalued_roots: ready.unvalued_roots }).unvalued_roots)
      .toEqual(expected);
    const pipeline = { ...ready };
    delete pipeline.unvalued_roots;
    expect((carryCanonicalOnlyFields(pipeline, ready) as typeof ready).unvalued_roots).toBe(ready.unvalued_roots);
  });

  it('U2: giving both risks a likelihood removes the notices and the ask', () => {
    const g = freshHiringDraft(true, true);
    expect(buildCanonicalAnalysisReadyFromGraph(g)?.unvalued_roots).toBeUndefined();
    expect(unvaluedRoots(g)).toEqual([]);
    expect(assessRouteAdmission(g).unvalued_roots).toBeUndefined();
    for (const factor_id of RISK_IDS) {
      expect(assessRouteAdmission(g).readiness_issues).not.toContainEqual(expect.objectContaining({ factor_id }));
    }
    expect(readinessViewOf(g).treated_as_zero).toBeUndefined();
    expect(stillNeededLine(readinessViewOf(g))).toBeNull();
    expect(assessRouteAdmission(g).may_run).toBe(true);
  });

  it('U3: an unvalued factor keeps base status, refusal and the byte-identical today ask', () => {
    const g = withRoot('factor');
    const ready = buildCanonicalAnalysisReadyFromGraph(g)!;
    expect(rootIssues(g)).toEqual([expect.objectContaining({
      code: 'MISSING_FACTOR_LEVEL', factor_id: 'root_gap', message: FACTOR_ASK, obligation: 'required',
    })]);
    expect(ready.status).toBe('needs_user_input');
    expect(ready.may_run).toBe(false);
    expect(assessRouteAdmission(g).may_run).toBe(false);
    expect(ready.blockers).toContainEqual(expect.objectContaining({ factor_id: 'root_gap', blocker_type: 'missing_value', message: FACTOR_ASK }));
    expect(ready.unvalued_roots).toBeUndefined();
    expect(assessRouteAdmission(g).unvalued_roots).toBeUndefined();
    expect(unvaluedRoots(g)).toEqual([]);
  });

  it('U4: an unvalued risk outside the goal path has neither carrier nor issue', () => {
    const g = withRoot('risk', false, false);
    expect(buildCanonicalAnalysisReadyFromGraph(g)?.unvalued_roots).toBeUndefined();
    expect(assessRouteAdmission(g).unvalued_roots).toBeUndefined();
    expect(assessRouteAdmission(g).readiness_issues).not.toContainEqual(expect.objectContaining({ factor_id: 'root_gap' }));
    expect(unvaluedRoots(g)).toEqual([]);
    expect(readinessViewOf(g).treated_as_zero).toBeUndefined();
    expect(stillNeededLine(readinessViewOf(g))).toBeNull();
  });

  it('U5: the two zero-treated risks are never user demands or a cannot-run sentence', () => {
    const g = freshHiringDraft();
    expect(assessRouteAdmission(g).unvalued_roots).toEqual(unvaluedRoots(g));
    const view = readinessViewOf(g);
    expect(view.treated_as_zero).toEqual([...RISK_LABELS]);
    const plain = readinessViewOf(freshHiringDraft(false));
    expect(view.may_run).toBe(true);
    expect(view.needs_from_user).toEqual(plain.needs_from_user);
    expect(view.olumi_can_offer).toEqual(plain.olumi_can_offer);
    const asks = JSON.stringify([...view.needs_from_user, ...view.olumi_can_offer]);
    for (const label of RISK_LABELS) expect(asks).not.toContain(label);
    expect(readinessSentence(view)).toBe(readinessSentence(plain));
    expect(`${readinessSentence(view)} ${stillNeededLine(view)}`).not.toMatch(/can(?:'|’|no)t run/i);
  });

  it('zero notices never create a multi-blocker repair proposal or become its inputs', () => {
    const withGaps = (withRisks: boolean, n: number) => {
      const g = freshHiringDraft(withRisks);
      for (let k = 1; k <= n; k += 1) {
        g.nodes.push({ id: `factor_gap_${k}`, kind: 'factor', label: `Capacity ${k}`, category: 'observable' });
        g.edges.push(edge(`factor_gap_${k}`, 'goal'));
      }
      return g;
    };
    // Differential over 0, 1 and 2 factor gaps: the risks never change the proposal.
    for (const n of [0, 1, 2]) {
      expect(assessCanonicalAnalysisReadiness(withGaps(true, n)).repairProposal)
        .toEqual(assessCanonicalAnalysisReadiness(withGaps(false, n)).repairProposal);
    }
    const assessment = assessCanonicalAnalysisReadiness(withGaps(true, 2));
    expect(assessment.repairProposal).not.toBeNull();
    const inputs = assessment.repairProposal!.unresolved_inputs.map((i) => i.factor_id);
    expect(inputs).toEqual(expect.arrayContaining(['factor_gap_1', 'factor_gap_2']));
    for (const factor_id of RISK_IDS) expect(inputs).not.toContain(factor_id);
    expect(assessment.analysisReady?.unvalued_roots?.map((r) => r.node_id).sort()).toEqual([...RISK_IDS].sort());
    expect(assessment.repairProposal!.issue_ids).toEqual(assessment.issues.map((i) => i.issue_id));
    for (const factor_id of RISK_IDS) {
      expect(assessment.issues).not.toContainEqual(expect.objectContaining({ factor_id }));
    }
  });

  it('the deterministic ask names two plus the remainder and puts levels first', () => {
    const view = readinessViewOf(freshHiringDraft());
    expect(stillNeededLine({ ...view, treated_as_zero: [...RISK_LABELS, 'Technical debt', 'Overload'] }))
      .toBe('No figures are set for "Lack of AI experience" and "Hiring mismatch" and 2 more yet, so the analysis treats them as zero. How likely or how large is each today?');
    expect(stillNeededLine({ ...view, levels_not_set: [{ option: 'Hire a Tech Lead', factor: 'Tech leads' }] }))
      .toBe(`One level is not set yet: what does "Hire a Tech Lead" set Tech leads to? ${TWO_RISK_LINE}`);
    expect(stillNeededLine({ ...view, may_run: false })).toBeNull();
  });
});
