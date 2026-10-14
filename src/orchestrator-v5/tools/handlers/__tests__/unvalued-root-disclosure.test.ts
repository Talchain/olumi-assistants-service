import { describe, expect, it } from 'vitest';
import { resolveRunAdmission } from '../analysis-ready-core.js';
import { assessRouteAdmission } from '../../../../cee/graph-readiness/canonical-readiness.js';
import { readinessViewOf, stillNeededLine } from '../../../agent-lane/readiness-view.js';
import {
  assessCanonicalAnalysisReadiness,
  buildCanonicalAnalysisReadyFromGraph,
} from '../../../../orchestrator/tools/analysis-ready-helper.js';

/** T4e AMEND / AIE 6144041136: every relevant unknown sampled root withholds
 * numerical analysis; an optional prior must use the existing proposal path. */

type Rec = Record<string, unknown>;
const TECH = 'hire_lead';
const DEVS = 'hire_two';
const BASE = 'carry_on';
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
  it('R1: a RISK root withholds and names the risk in its next step', () => {
    const g = withRoot('risk');
    const message = 'How likely or how large is "Lack of AI experience" today? The numerical analysis is withheld until this risk has a supported value. You can also ask Olumi to propose a labelled starting assumption for review.';
    expect(rootIssues(g).map(i => [i.code, i.factor_id, i.message])).toEqual([['MISSING_FACTOR_LEVEL', 'root_gap', message]]);
    expect(buildCanonicalAnalysisReadyFromGraph(g)?.blockers?.map(b =>
      typeof b === 'object' && b !== null && 'message' in b ? b.message : undefined)).toEqual([
      'Factor "Tech leads" is currently 1 people. What should option "Carry On as Now" set it to?',
      'Factor "Developers" is currently 4 people. What should option "Carry On as Now" set it to?',
      message,
    ]);
    expect(resolveRunAdmission(g).willProceed).toBe(false);
    expect(assessRouteAdmission(g).may_run).toBe(false);
    expect(unvaluedRoots(g)).toEqual([]);
    expect(stillNeededLine(readinessViewOf(g))).toBeNull();
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

  it.each(['outcome', 'action'])('an unvalued %s root withholds with the current-level ask', (kind) => {
    const g = withRoot(kind);
    expect(rootIssues(g).map(i => [i.code, i.factor_id, i.message])).toEqual([['MISSING_FACTOR_LEVEL', 'root_gap', FACTOR_ASK]]);
    expect(assessRouteAdmission(g).may_run).toBe(false);
    expect(unvaluedRoots(g)).toEqual([]);
    expect(stillNeededLine(readinessViewOf(g))).toBeNull();
  });

  it('sampled priors, causal parents, legacy finite levels and explicitly held switch levels remain supported', () => {
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
    // Positive fixture premise: this switch has an explicitly held Olumi state.
    const sw = withRoot('factor'); sw.nodes.at(-1)!.scale_frame = 1;
    sw.nodes.at(-1)!.observed_state = { value: 1, raw_value: 1, source: 'cee_inference', extractionType: 'inferred' };
    sw.options.forEach((o) => { (o.interventions as Rec).root_gap = 1; sw.edges.push(edge(String(o.id), 'root_gap')); });
    expect(rootIssues(sw)).toEqual([]);
    expect(unvaluedRoots(sw)).toEqual([]);
  });
});

const RISK_IDS = ['risk:ai_experience', 'risk:hiring_mismatch'] as const;
const RISK_LABELS = ['Lack of AI experience', 'Hiring mismatch'] as const;

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

describe('T4e K1: non-factor roots withhold and offer a next step', () => {
  it('U1: the fresh a994-shaped hiring draft withholds both risk roots by id', () => {
    const g = freshHiringDraft();
    const assessment = assessCanonicalAnalysisReadiness(g);
    const ready = buildCanonicalAnalysisReadyFromGraph(g)!;
    expect(ready.may_run).toBe(false);
    expect(assessRouteAdmission(g).may_run).toBe(false);
    expect(assessment.safeToAnalyse).toBe(false);
    expect(ready.status).toBe('needs_user_input');
    expect(ready.unvalued_roots).toBeUndefined();
    expect(assessment.blockingIssues.map(i => [i.code, i.factor_id])).toEqual([
      ['MISSING_OPTION_VALUE', 'developer_headcount'], ['MISSING_OPTION_VALUE', 'tech_lead_headcount'],
      ...RISK_IDS.map(id => ['MISSING_FACTOR_LEVEL', id]),
    ]);
    expect(ready.blockers?.map(b =>
      typeof b === 'object' && b !== null && 'factor_id' in b ? b.factor_id : undefined)).toEqual(['developer_headcount', 'tech_lead_headcount', ...RISK_IDS]);
    expect(assessment.repairProposal?.unresolved_inputs.map(i => i.factor_id)).toEqual(['developer_headcount', 'tech_lead_headcount', ...RISK_IDS]);
    expect(assessment.repairProposal?.issue_ids).toEqual(assessment.issues.map(i => i.issue_id));
    expect(stillNeededLine(readinessViewOf(g))).toBeNull();
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

  it('U5: no zero treatment or automatic prior is manufactured for unknown risks', () => {
    const g = freshHiringDraft(); const before = structuredClone(g);
    const view = readinessViewOf(g);
    expect(view.may_run).toBe(false);
    expect(view.treated_as_zero).toBeUndefined();
    expect(assessCanonicalAnalysisReadiness(g).blockingIssues.map(i => i.message)).toEqual([
      'Factor "Developers" is currently 4 people. What should option "Carry On" set it to?',
      'Factor "Tech leads" is currently 1 people. What should option "Carry On" set it to?',
      ...RISK_LABELS.map(label =>
      `How likely or how large is "${label}" today? The numerical analysis is withheld until this risk has a supported value. You can also ask Olumi to propose a labelled starting assumption for review.`)]);
    expect(g).toEqual(before);
  });

  it('risk gaps join the repair proposal without losing existing factor gaps', () => {
    for (const count of [0, 1, 2]) {
      const g = freshHiringDraft();
      for (let k = 1; k <= count; k++) {
        g.nodes.push({ id: `factor_gap_${k}`, kind: 'factor', label: `Capacity ${k}`, category: 'observable' });
        g.edges.push(edge(`factor_gap_${k}`, 'goal'));
      }
      const assessment = assessCanonicalAnalysisReadiness(g);
      expect(assessment.repairProposal?.unresolved_inputs.map(i => i.factor_id)).toEqual([
        'developer_headcount', 'tech_lead_headcount', ...RISK_IDS, ...Array.from({ length: count }, (_, i) => `factor_gap_${i + 1}`),
      ]);
      expect(assessment.repairProposal?.issue_ids).toEqual(assessment.issues.map(i => i.issue_id));
      expect(assessment.analysisReady?.unvalued_roots).toBeUndefined();
    }
  });

  it('the deterministic ask names two plus the remainder and puts levels first', () => {
    const view = readinessViewOf(freshHiringDraft(false));
    expect(stillNeededLine({ ...view, treated_as_zero: [...RISK_LABELS, 'Technical debt', 'Overload'] }))
      .toBe('No figures are set for "Lack of AI experience" and "Hiring mismatch" and 2 more yet, so the analysis treats them as zero. How likely or how large is each of "Lack of AI experience" and "Hiring mismatch" and 2 more today?');
    expect(stillNeededLine({ ...view, treated_as_zero: [...RISK_LABELS], levels_not_set: [{ option: 'Hire a Tech Lead', factor: 'Tech leads' }] }))
      .toBe(`One level is not set yet: what does "Hire a Tech Lead" set Tech leads to? No figures are set for "Lack of AI experience" and "Hiring mismatch" yet, so the analysis treats them as zero. How likely or how large is each of "Lack of AI experience" and "Hiring mismatch" today?`);
    expect(stillNeededLine({ ...view, may_run: false })).toBeNull();
  });
});
