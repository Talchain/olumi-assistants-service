import { describe, expect, it } from 'vitest';
import { resolveRunAdmission } from '../analysis-ready-core.js';
import { assessRouteAdmission } from '../../../../cee/graph-readiness/canonical-readiness.js';
import { readinessSentence, readinessViewOf, stillNeededLine } from '../../../agent-lane/readiness-view.js';
import { AnalysisReadyPayload as AnalysisReadyPayloadSchema } from '../../../../schemas/analysis-ready.js';
import {
  assessCanonicalAnalysisReadiness,
  buildCanonicalAnalysisReadyFromGraph,
  carryCanonicalOnlyFields,
} from '../../../../orchestrator/tools/analysis-ready-helper.js';

/**
 * DL GATE 2 (5 Oct 2026, Science 0df0e1): an unvalued root on the goal path.
 * - A FACTOR root keeps base behaviour exactly: the blocking MISSING_FACTOR_LEVEL ask.
 * - A NON-factor root (risk, outcome, action…) NEVER blocks: ISL already runs it at zero mean. It rides ONLY the typed
 *   `analysis_ready.unvalued_roots` carrier (never a `readiness_issues` array — DGAI lists those as refusal items),
 *   and `stillNeededLine` says it and asks for the figure.
 * Measured (0 LLM, 129 newest stored scenarios): status / may_run / level gaps identical to base 129/129.
 */

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
