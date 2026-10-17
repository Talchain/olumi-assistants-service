import { afterAll, describe, expect, it, vi } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { withConstructionStatements } from '../construction-source-map.js';
import { authorshipOf } from '../../../cee/provenance/provenance-of.js';
import { figureTheUserWrote } from '../stated-by-user.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { unsizedOlumiRiskIds, withoutUnsizedOlumiRisksRecorded, unsizedOlumiRiskLine } from '../unsized-risk.js';

type Rec = Record<string, any>;
const { outbound } = vi.hoisted(() => {
  const outbound = vi.fn(async () => { throw new Error('No provider, engine or database HTTP is permitted'); });
  vi.stubGlobal('fetch', outbound);
  return { outbound };
});
afterAll(() => { expect(outbound).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
const RISK = 'Specialist capacity below target';
const BASE = 'Should we keep the current team or add a specialist? Our output today is 80 projects per week. '
  + 'Our target is at least 100 projects per week. The current team has 1 team. Adding a specialist gives us 2 teams.';
const entry = (label: string, kind: string, field: string, quote: string, value: number, unit: string) => ({
  subject: { kind, label }, field, quote, form: 'point', value, unit,
});
function draft(statements: unknown[] = []): Rec {
  return {
    goal: { metric: 'Output', operator: '>=', target_stated: true, frame: 'level', value: 100, unit: 'projects per week',
      horizon_months: null, provenance: 'explicit', baseline_known: true, baseline_value: 80, baseline_provenance: 'explicit', scope: null },
    constraints: [],
    options: [
      { label: 'Current team', provenance: 'explicit', changes: [], is_status_quo: true, interventions: [
        { factor_label: 'Teams', value: 1, unit: 'teams', provenance: 'explicit', value_kind: 'absolute' }] },
      { label: 'Add a specialist', provenance: 'explicit', changes: [], is_status_quo: false, interventions: [
        { factor_label: 'Teams', value: 2, unit: 'teams', provenance: 'explicit', value_kind: 'absolute' }] },
    ],
    factors: [{ label: 'Teams', role: 'controllable', baseline_known: true, baseline_value: 1, unit: 'teams',
      provenance: 'explicit', plausible_max: 4 }],
    risks: [{ label: RISK, provenance: 'explicit' }], outcomes: [], identities: [], unknowns: [],
    decision_question: 'Should we keep the current team or add a specialist?',
    links: [
      { from: 'Teams', to: 'Output', direction: 'positive', provenance: 'inferred', effect_amount: 20,
        effect_per_source_change: 1, effect_provenance: 'ai_proposed', definitional: false },
      { from: RISK, to: 'Output', direction: 'negative', provenance: 'inferred', effect_amount: null,
        effect_per_source_change: null, effect_provenance: null, definitional: false },
    ],
    statements: [
      entry('Output', 'goal', 'level', 'Our output today is 80 projects per week.', 80, 'projects per week'),
      entry('Output', 'goal', 'target', 'Our target is at least 100 projects per week.', 100, 'projects per week'),
      entry('Teams', 'factor', 'level', 'The current team has 1 team.', 1, 'teams'),
      { ...entry('Current team', 'option', 'level', 'The current team has 1 team.', 1, 'teams'),
        subject: { kind: 'option', label: 'Current team', factor_label: 'Teams' } },
      { ...entry('Add a specialist', 'option', 'level', 'Adding a specialist gives us 2 teams.', 2, 'teams'),
        subject: { kind: 'option', label: 'Add a specialist', factor_label: 'Teams' } },
      ...statements,
    ],
  };
}
const riskStatement = (quote: string, changes: Rec = {}) => ({ subject: { kind: 'risk', label: RISK },
  field: 'holds_now', form: 'describes', quote, ...changes });
function admitted(model: Rec, brief = BASE) {
  const out = admitCandidateModel(model as CandidateModel, {}, brief, (v, u) => figureTheUserWrote(v, u, brief));
  const graph = withConstructionStatements({ nodes: [...out.nodes], edges: out.edges, goal_constraints: out.goal_constraints },
    model.statements, brief, '2026-10-16T21:30:00Z') as Rec;
  const risk = graph.nodes.find((n: Rec) => n.kind === 'risk' && n.label === RISK)!;
  return { out, graph, risk };
}
const issuesFor = (graph: Rec, id: string) => (resolveRunAdmission(graph).assessment.issues as unknown as Rec[])
  .filter(issue => issue.factor_id === id || issue.node_id === id);

describe('draft source → risk admission → retained participation → readiness', () => {
  it.each(['Output', 'Service throughput'])('an unstated drafted risk cannot claim human origin or hold the %s calculation', goal => {
    let model = draft(); let brief = BASE;
    if (goal !== 'Output') {
      model = JSON.parse(JSON.stringify(model).replaceAll('Output', goal).replaceAll('output', goal.toLowerCase()).replaceAll('projects', 'tickets'));
      brief = BASE.replaceAll('output', goal.toLowerCase()).replaceAll('projects', 'tickets');
    }
    const { graph, risk, out } = admitted(model, brief);
    expect(risk.provenance).toBe('ai_inferred');
    expect(authorshipOf({ nodeTag: risk.provenance }).origin).toBe('ai');
    expect(risk.analysis_participation).toBe('retained_excluded');
    expect(risk.observed_state).toBeUndefined();
    expect(out.inference_classes[risk.id]).toBe('model_proposed');
    expect(issuesFor(graph, risk.id)).toEqual([]);
    const readiness = resolveRunAdmission(graph);
    expect(readiness.willProceed, JSON.stringify(readiness.assessment.issues)).toBe(true);
    const cold = JSON.parse(JSON.stringify(graph));
    expect([...unsizedOlumiRiskIds(cold)]).toEqual([risk.id]);
    const projected = withoutUnsizedOlumiRisksRecorded(cold);
    expect(projected.omitted).toEqual([{ node_id: risk.id, label: RISK, reason: 'unsized_olumi_risk' }]);
    expect(projected.graph.nodes.some((n: Rec) => n.id === risk.id)).toBe(false);
    expect(projected.graph.edges.some((e: Rec) => e.from === risk.id || e.to === risk.id)).toBe(false);
    expect(cold.nodes.find((n: Rec) => n.id === risk.id)).toEqual(risk);
    expect(unsizedOlumiRiskLine(cold, risk.id, false)).toBe('This calculation covers the modelled effects only. ‘Specialist capacity below target’ is Olumi’s '
      + 'unsized risk suggestion and is not included in this calculation; its likelihood and impact remain unresolved.');
  });

  // ⭐ DL-3 23:52Z (BUDDY-A #3327 R2 B1, the CLASS): for a risk, a figure-free reading of any form is Olumi's reading of the user's words.
  // The GENUINE-DESCRIPTION POSITIVE: the whole conditional, dissenting words are kept, as human material (never Olumi's estimate, never
  // left out of the Run) that still asks for the risk's own size; never verified human, never a holds-now record of theirs.
  it('a human description of a risk keeps its whole conditional/dissenting words as Olumi\'s reading, and still asks for its own size', () => {
    const quote = 'If the supplier is late, specialist capacity could fall below target; our operations lead disagrees.';
    const statement = riskStatement(quote, { conditions: 'If the supplier is late', qualifier: 'could' });
    const { graph, risk, out } = admitted(draft([statement]), `${BASE} ${quote}`);
    expect(risk.provenance).toBe('unverified_brief');
    expect(authorshipOf({ nodeTag: risk.provenance })).toMatchObject({ origin: 'human', role: 'unverified' });
    expect(risk.analysis_participation).toBeUndefined();
    expect([...unsizedOlumiRiskIds(graph)]).toEqual([]);
    expect(resolveRunAdmission(graph).willProceed).toBe(false);
    expect(issuesFor(graph, risk.id).some(i => i.code === 'MISSING_FACTOR_LEVEL')).toBe(true);
    expect(JSON.stringify(out.loss)).toContain(quote);
    expect(JSON.stringify(out.loss)).toContain('If the supplier is late');
    expect(risk.user_statements).toBeUndefined();
    expect(risk.already_true_quote).toBeUndefined();
  });

  it('unknown source is neither a human stamp nor an Olumi exclusion', () => {
    const quote = 'The unverified stored notes say specialist capacity will fall below target.';
    const { graph, risk, out } = admitted(draft([riskStatement(quote)]));
    expect(risk.provenance).toBeUndefined();
    expect(authorshipOf({ nodeTag: risk.provenance }).origin).toBe('unknown');
    expect(risk.analysis_participation).toBeUndefined();
    expect(out.inference_classes[risk.id]).toBeUndefined();
    expect(risk.user_statements).toBeUndefined();
    expect([...unsizedOlumiRiskIds(graph)]).toEqual([]);
    expect(resolveRunAdmission(graph).willProceed).toBe(false);
    expect(JSON.stringify(out.loss)).toContain(quote);
  });

  it('known human words with an unverified figure stay unverified human material, never Olumi’s', () => {
    const quote = 'The specialist risk could cost 3 projects per week.';
    const { graph, risk, out } = admitted(draft([riskStatement(quote, { form: 'point', value: 8, unit: 'projects per week' })]), `${BASE} ${quote}`);
    expect(risk.provenance).toBe('unverified_brief');
    expect(authorshipOf({ nodeTag: risk.provenance })).toMatchObject({ origin: 'human', role: 'unverified' });
    expect(risk.analysis_participation).toBeUndefined();
    expect(risk.user_statements).toBeUndefined();
    expect([...unsizedOlumiRiskIds(graph)]).toEqual([]);
    expect(resolveRunAdmission(graph).willProceed).toBe(false);
    expect(JSON.stringify(out.loss)).toContain(quote);
  });

  it('a missing statement carrier is unknown; legacy explicit is not a bypass', () => {
    const model = draft(); delete model.statements;
    const { risk } = admitted(model);
    expect(authorshipOf({ nodeTag: risk.provenance }).origin).toBe('unknown');
    expect(risk.analysis_participation).toBeUndefined();
  });

  it('a neighbouring budget quote cannot supply an already-true claim or credit for the risk', () => {
    const model = draft(); model.risks[0].already_true_evidence = { quote: 'Our budget is £2 million as of 2026-09-01.' };
    model.statements.push(entry('Budget', 'factor', 'level', model.risks[0].already_true_evidence.quote, 2000000, 'GBP'));
    const { risk } = admitted(model, `${BASE} ${model.risks[0].already_true_evidence.quote} Our deadline is six months.`);
    // The receipt binds nothing, and a sentence another subject's statement claims lends no credit (no already-true quote,
    // never from_brief); the user's words stay unverified human material, never Olumi's.
    expect(risk.provenance).toBe('unverified_brief'); expect(risk.already_true_quote).toBeUndefined();
  });

  // ⭐ ONE BINDER (DL-3 22:53Z + RULING 23:12Z; BUDDY-A #3327 B1 N1 and its 22:59Z AMEND). A holds-now reading is OLUMI'S READING
  // of the user's whole sentence, from the receipt or from the AI's own {risk, holds_now} statement alike: the words stay the user's,
  // the risk is never made theirs by it, and the sentence is kept only for its card (the card IS the ask). Nothing reads it as true
  // until the press, which writes Olumi's derived block (`brief-holds-now.route.test.ts`). The unrelated budget sentence is the
  // sole-misbind counterexample, through the receipt and through a statement; the negated sentence is the omitted-negation one.
  const BUDGET = 'Our budget is £2 million as of 2026-09-01.';
  const NEGATED = 'The specialist role is not unfilled, and the team agrees about its impact.';
  const GENUINE = 'The specialist role is already unfilled, and the team disagrees about its impact.';
  const olumisReading = (risk: Rec, graph: Rec, out: { loss: unknown }, quote: string): void => {
    expect(risk.provenance, 'the user\'s words, Olumi\'s reading: never verified as theirs').toBe('unverified_brief');
    expect(authorshipOf({ nodeTag: risk.provenance })).toMatchObject({ origin: 'human', role: 'unverified' });
    expect(risk.already_true_quote, 'kept whole, for its card only').toBe(quote);
    expect(risk.event_risk, 'non-operative until the press').toBeUndefined();
    expect(risk.analysis_participation).toBeUndefined(); expect([...unsizedOlumiRiskIds(graph)]).toEqual([]);
    expect(JSON.stringify(out.loss)).toContain(quote);
    const said = JSON.stringify(issuesFor(graph, risk.id));
    expect(said).toContain('Olumi reads this as'); expect(said).not.toMatch(/you said|you stated/i);
  };
  it.each([['N1 sole misbind, receipt only', BUDGET, 'receipt'], ['sole misbind, the AI\'s own statement', BUDGET, 'statement'],
    ['omitted negation, receipt only', NEGATED, 'receipt'], ['genuine, receipt only', GENUINE, 'receipt'],
    ['genuine, receipt beside the AI\'s own statement', GENUINE, 'both']] as const)(
    '%s: Olumi\'s reading of the user\'s whole words, never theirs; non-operative until pressed', (_n, quote, via) => {
      const model = draft(via === 'receipt' ? [] : [riskStatement(quote, { form: 'holds_now' })]);
      if (via !== 'statement') model.risks[0].already_true_evidence = { quote };
      const { risk, graph, out } = admitted(model, `${BASE} ${quote}`);
      olumisReading(risk, graph, out, quote);
    });

  // ⭐ BUDDY-A #3327 R2 B1: a description verifies the user only where it NAMES the risk (the door's own subject check). The same
  // unrelated budget sentence, read as describing the risk (with or without the receipt), stays Olumi's reading of the user's words,
  // and no holds-now record of theirs is written; words that describe it loosely stay human material, never Olumi's.
  it.each([['with the receipt', true], ['alone', false]] as const)('sole misbind as a DESCRIPTION, %s: unverified human words, no record of theirs', (_n, receipt) => {
    const model = draft([riskStatement(BUDGET)]);
    if (receipt) model.risks[0].already_true_evidence = { quote: BUDGET };
    const { risk, graph, out } = admitted(model, `${BASE} ${BUDGET}`);
    expect(risk.provenance).toBe('unverified_brief');
    expect(risk.user_statements).toBeUndefined();
    expect(risk.event_risk).toBeUndefined();
    expect(JSON.stringify(out.loss)).toContain(BUDGET);
    expect(JSON.stringify(issuesFor(graph, risk.id))).not.toMatch(/you said|you stated/i);
  });
  it('CONTROL (BUDDY-A\'s genuine description): naming the risk does not make a figure-free reading the user\'s; its words are kept whole', () => {
    const quote = 'Specialist capacity below target is a concern for us.';
    const { risk, out } = admitted(draft([riskStatement(quote)]), `${BASE} ${quote}`);
    expect(risk.provenance).toBe('unverified_brief');
    expect(JSON.stringify(out.loss)).toContain(quote);
  });
  it('a loose description that does not name the risk stays human material (unverified), never Olumi\'s', () => {
    const quote = 'The specialist capacity risk is a concern for us.';
    const { risk, graph } = admitted(draft([riskStatement(quote)]), `${BASE} ${quote}`);
    expect(risk.provenance).toBe('unverified_brief');
    expect(risk.analysis_participation).toBeUndefined(); expect([...unsizedOlumiRiskIds(graph)]).toEqual([]);
  });

  it('a malformed statements list is no complete source: the risk is unknown, as with no list', () => {
    const model = draft(); model.statements = [...model.statements, null, 7];
    const { risk } = admitted(model);
    expect(authorshipOf({ nodeTag: risk.provenance }).origin).toBe('unknown');
    expect(risk.analysis_participation).toBeUndefined();
  });

  it('a quote claimed for a different subject cannot lend its human credit to the risk’s qualitative claim', () => {
    const quote = 'Revenue was £2 million as of 2026-09-01, and our deadline is six months.';
    const model = draft([riskStatement(quote), entry('Revenue', 'factor', 'level', quote, 2000000, 'GBP')]);
    const { risk, graph, out } = admitted(model, `${BASE} ${quote}`);
    expect(risk.provenance).toBe('unverified_brief');
    expect(authorshipOf({ nodeTag: risk.provenance })).toMatchObject({ origin: 'human', role: 'unverified' });
    expect(risk.analysis_participation).toBeUndefined(); expect([...unsizedOlumiRiskIds(graph)]).toEqual([]);
    expect(risk.user_statements).toBeUndefined();
    expect(JSON.stringify(out.loss)).toContain(quote);
  });

  // ⭐ GREEN CORE (DL-3 00:1xZ; BUDDY-A #3327 R3 B1): no construction statement makes a risk the user's, so the protection this row keeps
  // is the other half: the draft's own marks never make the user's words Olumi's suggestion or leave the risk out of the Run.
  it('draft participation/widening marks cannot make the user\'s words Olumi\'s or leave the risk out', () => {
    const quote = 'There is about a 30% chance that specialist capacity falls below target.';
    const model = draft([riskStatement(quote, { field: 'occurrence', form: 'point', value: 30, unit: '%' })]);
    model.risks[0].analysis_participation = 'retained_excluded'; model.risks[0].draft_widening = { basis: 'model suggestion' };
    const { risk, graph } = admitted(model, `${BASE} ${quote}`);
    expect(risk.provenance).toBe('unverified_brief'); expect(risk.proposed_by).toBeUndefined();
    expect(risk.analysis_participation).toBeUndefined(); expect([...unsizedOlumiRiskIds(graph)]).toEqual([]);
    expect(resolveRunAdmission(graph).willProceed).toBe(false);
  });

  it('reporting Olumi’s claim does not make the risk a human claim or an Olumi exclusion by default', () => {
    const quote = 'Olumi suggested that specialist capacity may be below target; I disagree.';
    const { risk, graph, out } = admitted(draft([riskStatement(quote)]), `${BASE} ${quote}`);
    expect(authorshipOf({ nodeTag: risk.provenance }).origin).toBe('unknown');
    expect(risk.analysis_participation).toBeUndefined(); expect([...unsizedOlumiRiskIds(graph)]).toEqual([]);
    expect(JSON.stringify(out.loss)).toContain(quote);
  });


  // The figure proves the number, not that it is THIS risk's chance: the whole words and conditions are kept as human material, and the
  // chance is recorded only by the door's own occurrence card, on the user's press (no construction occurrence record).
  it('a human occurrence range keeps its whole words and conditions as human material; no construction record of a chance', () => {
    const quote = 'If recruitment is delayed, I estimate between 10% and 30% likelihood of specialist capacity below target.';
    const st = { ...riskStatement(quote), field: 'occurrence', form: 'range', low: 10, high: 30, unit: '%', conditions: 'If recruitment is delayed' };
    const { risk, out } = admitted(draft([st]), `${BASE} ${quote}`);
    expect(risk.provenance).toBe('unverified_brief'); expect(risk.analysis_participation).toBeUndefined();
    expect(JSON.stringify(out.loss)).toContain(quote);
    expect(JSON.stringify(out.loss)).toContain('If recruitment is delayed');
    expect(risk.user_statements).toBeUndefined();
    expect(risk.event_risk).toBeUndefined();
  });

  it('BUDDY-A R3 numeric misbind: the budget\'s £2 million read as the risk\'s occurrence lends no number or credit to the risk', () => {
    const st = { ...riskStatement(BUDGET), field: 'occurrence', form: 'point', value: 2000000, unit: 'GBP' };
    const { risk, out } = admitted(draft([st]), `${BASE} ${BUDGET}`);
    expect(risk.provenance).toBe('unverified_brief');
    expect(risk.user_statements).toBeUndefined();
    expect(risk.event_risk).toBeUndefined();
    expect(JSON.stringify(out.loss)).toContain(BUDGET);
  });

  it.each(['included', 'sized', 'occurrence', 'option link', 'constraint', 'incoming cause', 'duplicate id'] as const)(
    'preserves the existing %s scientific/participation protection', fault => {
      const { graph, risk } = admitted(draft());
      expect(risk.provenance).toBe('ai_inferred');
      expect([...unsizedOlumiRiskIds(graph)]).toEqual([risk.id]);
      const g = structuredClone(graph);
      const r = g.nodes.find((n: Rec) => n.id === risk.id);
      delete r.analysis_participation;
      if (fault === 'included') r.analysis_participation = 'included';
      if (fault === 'sized') r.observed_state = { value: 0, raw_value: 0, source: 'user_override' };
      if (fault === 'occurrence') r.event_risk = { occurrence: { probability: 0.2, basis: 'user' } };
      if (fault === 'option link') g.edges.push({ from: g.nodes.find((n: Rec) => n.kind === 'option').id, to: risk.id });
      if (fault === 'incoming cause') g.edges.push({ from: g.nodes.find((n: Rec) => n.kind === 'factor').id, to: risk.id });
      if (fault === 'constraint') g.goal_constraints = [{ node_id: risk.id, operator: '<=', value: 1 }];
      if (fault === 'duplicate id') g.nodes.push(structuredClone(r));
      expect([...unsizedOlumiRiskIds(g)]).toEqual([]);
    });
});
