import { describe, expect, it, vi } from 'vitest';
const savedRun = vi.hoisted(() => ({ fact: null as Record<string, any> | null }));
vi.mock('../../session/index.js', async original => ({
  ...(await original<typeof import('../../session/index.js')>()),
  getSessionStore: () => createMockSessionStore({
    readScenarioRunAnalysisFactsFor: async () => ({ facts: savedRun.fact === null ? [] : [{ fact: savedRun.fact as never, fact_row_id: 'run-row', fact_created_at: savedRun.fact.result.computed_at }], total_count: savedRun.fact === null ? 0 : 1 }),
  }),
}));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => { throw new Error('No LLM calls in time-close harness'); },
  getAdapterWithResolution: () => { throw new Error('No LLM calls in time-close harness'); },
  getMaxTokensFromConfig: () => undefined,
}));
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { holdStatedGoalAttributes, withdrawUnstatedBaselineStamps, figureTheUserWroteFor } from '../stated-by-user.js';
import { attestHorizon } from '../horizon-attestation.js';
import { admitStructuralGoalAccumulation } from '../accumulation-identity.js';
import { proposeProductIdentity } from '../identity-proposal.js';
import { identityApproveMessage } from '../identity-card.js';
import { approvalChipsFor } from '../approval-chips.js';
import type { ToolResult } from '../runtime/agent-tools.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { constructionOperationId } from '../runtime/build-model.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { ProposalStore } from '../proposal.js';
import { applyGoalHorizonEdit, goalHorizonPostimageIsScoped, goalHorizonLandedWriteIsScoped } from '../../goal-target/goal-horizon-write.js';
import { readGoalRecord } from '../../goal-target/goal-record.js';
import { goalHorizonVerdict } from '../../goal-target/goal-horizon-verdict.js';
import { goalStockAccumulationOf } from '../../goal-target/goal-horizon-detail.js';
import { executeOptionInterventionBatch } from '../../system-events/option-intervention-edit.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { deriveAnalysisFreshness } from '../../context/freshness.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { buildAnalysisResultBlock } from '../../compose.js';
import { readScenarioAnalysis } from '../../../routes/scenario-graph-analysis-read.js';
import { GOAL_FIGURES_HORIZON_NOT_TESTED } from '../../../orchestrator/context/option-result-source.js';
import minimalFixture from '../../../../tests/fixtures/plot/v2-run-golden-minimal.json';

type Rec = Record<string, any>;
const SID = '550e8400-e29b-41d4-a716-4466554400c9';
const R = '2026-10-09';
const BRIEF = 'Current cash is £12,000. Monthly additions are £2,000 a month. Our goal is cash of £30,000 by 31 March 2027. Compare a bonus or no bonus.';
const hash = (graph: Rec): string => computeAnalysisAffectingGraphHash(graph as never)!;
const goal = (graph: Rec): Rec => graph.nodes.find((n: Rec) => n.kind === 'goal')!;
const node = (graph: Rec, id: string): Rec => graph.nodes.find((n: Rec) => n.id === id)!;
function draft(): Rec {
  const c: CandidateModel = {
    goal: { metric: 'Cash', operator: '>=', target_stated: true, value: 30000, unit: 'GBP', frame: 'level', horizon_months: 9,
      provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: undefined },
    factors: [
      { label: 'Current cash', role: 'external', baseline_known: true, baseline_value: 12000, unit: 'GBP', provenance: 'explicit', plausible_max: 50000 },
      { label: 'Monthly additions', role: 'external', baseline_known: true, baseline_value: 2000, unit: 'GBP/month', provenance: 'explicit', plausible_max: 10000 },
      { label: 'Bonus', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'GBP', provenance: 'inferred', plausible_max: 10000 },
    ],
    options: [
      { label: 'Give bonus', provenance: 'explicit', interventions: [{ factor_label: 'Bonus', value: 1000, unit: 'GBP', provenance: 'explicit' }] },
      { label: 'No bonus', provenance: 'explicit', is_status_quo: true, interventions: [{ factor_label: 'Bonus', value: 0, unit: 'GBP', provenance: 'explicit' }] },
    ], links: [
      { from: 'Current cash', to: 'Cash', direction: 'positive', provenance: 'inferred' },
      { from: 'Monthly additions', to: 'Cash', direction: 'positive', provenance: 'inferred' },
      { from: 'Bonus', to: 'Cash', direction: 'positive', provenance: 'explicit', effect_amount: 1000, effect_per_source_change: 1000, effect_provenance: 'explicit' },
    ], constraints: [], risks: [], outcomes: [],
  };
  const admitted = admitCandidateModel(c, {});
  const held = holdStatedGoalAttributes(withdrawUnstatedBaselineStamps(admitted.nodes, BRIEF), c.goal, BRIEF);
  const graph = GraphV3.parse(projectGraphForPersistence({ nodes: held.nodes, edges: admitted.edges, goal_constraints: admitted.goal_constraints })) as Rec;
  expect(figureTheUserWroteFor(12000, 'GBP', BRIEF, { target: ['Current cash'], others: ['Monthly additions', 'Cash'], strict: true })).toBe(true);
  expect(node(graph, 'current_cash').observed_state.source).toBe('brief_extraction');
  expect(node(graph, 'monthly_additions').observed_state.source).toBe('brief_extraction');
  return graph;
}
function world(initial = draft(), badZero = false, reference: string | null = `${R}T12:00:00Z`, recovery?: 'unconfirmed' | 'failed-read') {
  let bytes = JSON.stringify(initial);
  const proposals = new ProposalStore();
  const writes: Rec[] = [];
  let failedReadbacks = 0;
  const read = (): Rec => JSON.parse(bytes);
  const store = createMockSessionStore({
    loadGraph: async () => read(), loadGraphAndBriefText: async () => ({ graph: read(), briefText: BRIEF }),
    append: async write => { writes.push(write); if (write.graph !== undefined) bytes = JSON.stringify(write.graph); return { id: `row-${writes.length}` }; },
    readRecent: async () => writes.map((w, i) => makeSessionTurnRow({ id: `row-${i + 1}`, scenario_id: w.scenario_id, turn_id: w.turn_id, turn_class: w.turn_class, handler_id: w.handler_id, request_hash: w.request_hash, response_emitted: w.response_emitted, llm_calls_used: w.llm_calls_used, duration_ms: w.duration_ms })),
    readFactsWithTurnFor: async ids => writes.flatMap((w, i) => ids.includes(`row-${i + 1}`) ? w.handler_facts.map((fact: Rec) => ({ turn_id: `row-${i + 1}`, fact_created_at: `${R}T12:00:00Z`, fact })) : []),
  });
  const dispatch: InternalDispatch = async path => {
    if (failedReadbacks > 0 && path.endsWith('/graph')) { failedReadbacks--; return { status: 503, json: {} }; }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: reference === null ? [] : [{ version_id: 'draft-v1', sequence: 1, created_at: reference,
      creation: { kind: 'initial', source_turn_id: registrationTurnId(SID, constructionOperationId(SID, BRIEF)) } }] } };
    if (path.endsWith('/graph')) return { status: 200, json: { graph: read(), graph_hash: hash(read()), brief_text: BRIEF } };
    throw new Error(path);
  };
  const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    const out = await executeOptionInterventionBatch({ scenarioId: SID, turnId: input.turn_id, requestId: 'time-close', requestHash: input.turn_id,
      stage: 'frame', freshness: 'none', hasExistingAnalysis: false, expectedGraphHash: input.base_graph_hash,
      targets: [], goalHorizon: input.goal_horizon, identityConfirm: input.identity_confirm }, store);
    if (out.kind === 'refused') return { status: 'refused', reason: out.reason };
    if (out.kind === 'unchanged') return { status: 'committed', graph_hash: hash(read()), receipt: null, already_applied: true, committed_levels: [], links_resized: [] };
    if (out.kind !== 'committed') throw new Error(JSON.stringify(out));
    if (badZero) {
      const g = read(); const held = goalStockAccumulationOf(g)!;
      node(g, String(held.netZero!.id)).observed_state.source = 'cee_inference'; bytes = JSON.stringify(g);
    }
    if (recovery === 'failed-read') failedReadbacks = 1;
    if (recovery === 'unconfirmed') return { status: 'unconfirmed' };
    return { status: 'committed', graph_hash: hash(read()), receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
  };
  const caps = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { commitOptionLevels, now: () => new Date('2027-02-01T12:00:00Z') });
  const ctx = (text: string) => ({ scenario_id: SID, authenticated_user_id: null, request_id: 'time-close', user_text: text, user_turn_text: text });
  const deadline = async (words = '31 March 2027'): Promise<Rec> => {
    const offered: Rec = await caps.proposeGoalDeadline!(ctx(words), { deadline_words: words, rationale: 'The user stated this deadline.' });
    expect(offered.ok, JSON.stringify(offered)).toBe(true);
    expect(offered.public_label).toContain('from 9 October 2026');
    const result = await caps.authoriseChange(ctx('Yes'), { proposal_id: offered.proposal_id });
    expect(result.applied, JSON.stringify(result)).toBe(true);
    return result;
  };
  const offer = async (): Promise<ToolResult & Rec> => caps.proposeIdentity!(ctx('Confirm the reading'));
  const confirm = async (offered: Rec, oneOff = false): Promise<Rec> => {
    const text = oneOff ? `No — ${offered.card.words}` : identityApproveMessage(offered.card.words);
    return caps.authoriseChange({ ...ctx(text), typed_approval_of: offered.proposal_id, typed_approval_words: text }, { proposal_id: offered.proposal_id });
  };
  return { read, replace: (graph: Rec) => { bytes = JSON.stringify(graph); }, writes, caps, proposals, deadline, offer, confirm };
}
async function run(graph: Rec): Promise<Rec> {
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SID, 'time-close', createMockSessionStore({ loadGraph: async () => graph,
    loadGraphAndBriefText: async () => ({ graph, briefText: BRIEF }) }));
  const options = graph.nodes.filter((n: Rec) => n.kind === 'option');
  const body = { ...structuredClone(minimalFixture), inference_warnings: [], results: options.map((n: Rec, i: number) => ({ option_id: n.id, win_probability: i === 0 ? 0.7 : 0.3 })),
    option_comparison: options.map((n: Rec, i: number) => ({ option_id: n.id, option_label: n.label, probability_of_goal: 0.6 - i * 0.2, win_probability: i === 0 ? 0.7 : 0.3,
      outcome: { p10: 25000 + i * 1000, p50: 32000 + i * 1000, p90: 40000 + i * 1000, mean: 32000 + i * 1000, std: 3000, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1, percentiles_source: 'samples' } })),
    identity_evaluations: graph.nodes.filter((n: Rec) => n.nonlinear_identity).map((n: Rec) => ({ node_id: n.id, ...n.nonlinear_identity, evaluated: true, ...(n.kind === 'goal' ? { level_source: 'identity_inputs' } : {}) })),
  };
  const plotRun = vi.fn(async () => body);
  const handler = createRunAnalysisHandler({ plotClient: { run: plotRun, validatePatch: vi.fn().mockResolvedValue({}) } as never, scenarioReader: async () => snapshot });
  const outcome = await handler({ payload: { scenario_id: SID, turn_id: 'time-close-run' }, requestId: 'time-close-run', signal: new AbortController().signal, context: {}, orientationText: '' } as never);
  expect(plotRun).toHaveBeenCalledTimes(1);
  const fact = outcome.handler_facts.find((f: Rec) => f.fact_type === 'run_analysis');
  expect(fact).toBeDefined();
  return fact as Rec;
}
function dateWrite(graph: Rec, deadline: string, stated_months?: number): Rec {
  const out = applyGoalHorizonEdit(graph, { goal_id: String(goal(graph).id), deadline, expected_deadline: null, reference_date: R, stated_months });
  expect(out.kind, JSON.stringify(out)).toBe('mutated');
  if (out.kind !== 'mutated') throw new Error('date refused');
  expect(goalHorizonPostimageIsScoped(graph, out.mutatedGraph, String(goal(graph).id), R)).toBe(true);
  return GraphV3.parse(JSON.parse(JSON.stringify(out.mutatedGraph))) as Rec;
}
describe('S4 time close, real deadline and identity doors plus real Run', () => {
  it('chain: draft has no H; deadline Yes records H; structural card; confirm; Run; canonical reload holds Why', async () => {
    const w = world();
    expect(readGoalRecord(w.read(), String(goal(w.read()).id))?.horizon?.months).toBeUndefined();
    expect(goalStockAccumulationOf(w.read())).toBeNull();
    expect((await w.deadline()).applied).toBe(true);
    expect(readGoalRecord(w.read(), String(goal(w.read()).id))?.horizon?.months).toBe(5);
    const offered = await w.offer(); expect(offered.ok, JSON.stringify(offered)).toBe(true);
    expect(goalHorizonVerdict(w.read())).toBe('withhold');
    expect((await w.confirm(offered)).applied).toBe(true);
    const fact = await run(w.read());
    expect(goalHorizonVerdict(w.read(), fact.result.enrichment)).toBe('computed_at_h');
    const stored = JSON.parse(JSON.stringify(fact));
    const block = buildAnalysisResultBlock(stored as never);
    expect(JSON.stringify(block)).toContain('Whole months completed from 9 October 2026. Month 5 is the last full month before 31 March 2027.');
    const derivation = deriveAnalysisFreshness([stored], hash(w.read()), undefined, { currentGraph: w.read() });
    expect(derivation.freshness).toBe('fresh');
    savedRun.fact = stored;
    const cold = await readScenarioAnalysis({ scenarioId: SID, graph: w.read() as never, requestId: 'time-close-reload' });
    expect(cold.analysis_state?.run_state.kind).toBe('complete_current');
    expect(JSON.stringify(cold.analysis_result)).toContain('Whole months completed from 9 October 2026. Month 5 is the last full month before 31 March 2027.');
    expect(goalStockAccumulationOf(GraphV3.parse(JSON.parse(JSON.stringify(w.read()))))).not.toBeNull();
  });
  it.each([['2027-03-31', 5, true], ['2027-04-09', 6, false], ['2027-04-08', 5, true]] as const)('date %s floors to %s; disclosure %s', async (date, months, disclosure) => {
    const g = dateWrite(draft(), date); expect(readGoalRecord(g, String(goal(g).id))?.horizon?.months).toBe(months);
    expect(goal(g).goal_horizon_reference_date).toBe(R);
    expect(goal(g).goal_horizon_stated_months).toBeUndefined();
    const w = world(g); const offered = await w.offer(); expect(offered.ok).toBe(true);
    expect((await w.confirm(offered)).applied).toBe(true);
    const fact = await run(w.read());
    const text = JSON.stringify(buildAnalysisResultBlock(fact as never));
    expect(text).toContain('Whole months completed from 9 October 2026.');
    expect(text.includes('is the last full month before')).toBe(disclosure);
    savedRun.fact = JSON.parse(JSON.stringify(fact));
    const cold = await readScenarioAnalysis({ scenarioId: SID, graph: w.read() as never, requestId: 'date-reload' });
    expect(JSON.stringify(cold.analysis_result)).toContain('Whole months completed from 9 October 2026.');
  });
  it('within 9 months stays exactly 9, no arithmetic', async () => {
    const w = world(); expect((await w.deadline('within 9 months')).applied).toBe(true);
    expect(readGoalRecord(w.read(), String(goal(w.read()).id))?.horizon?.months).toBe(9);
  });
  it.each(['2026-10-08', '2026-10-09', '2026-11-08'])('refuses deadline %s, writes no months', date => {
    const g = draft(); const before = structuredClone(g);
    expect(applyGoalHorizonEdit(g, { goal_id: String(goal(g).id), deadline: date, expected_deadline: null, reference_date: R }).kind).toBe('refused'); expect(g).toEqual(before);
  });
  it('no reference writes only the HEAD date postimage; both scoped checks reject added H', () => {
    const before = draft(), goalId = String(goal(before).id);
    const out = applyGoalHorizonEdit(before, { goal_id: goalId, deadline: '2027-03-31', expected_deadline: null });
    expect(out.kind).toBe('mutated');
    if (out.kind !== 'mutated') throw new Error('date refused');
    const expected = structuredClone(before); goal(expected).goal_horizon = { deadline: '2027-03-31' };
    expect(out.mutatedGraph).toEqual(expected);
    expect(goalHorizonPostimageIsScoped(before, out.mutatedGraph, goalId)).toBe(true);
    const renamed = structuredClone(out.mutatedGraph); goal(renamed).label = 'Renamed cash';
    expect(goalHorizonLandedWriteIsScoped(out.mutatedGraph, renamed, goalId)).toBe(true);
    const forged = structuredClone(out.mutatedGraph); goal(forged).goal_horizon_months = 6;
    expect(goalHorizonPostimageIsScoped(before, forged, goalId)).toBe(false);
    expect(goalHorizonLandedWriteIsScoped(out.mutatedGraph, forged, goalId)).toBe(false);
    goal(forged).goal_horizon_reference_date = R;
    expect(goalHorizonPostimageIsScoped(before, forged, goalId, null)).toBe(false);
  });
  it('no versions: HEAD from today card; Yes writes only the date; no identity offer; canonical reload withholds', async () => {
    const before = draft(), old = await run(before), w = world(before, false, null);
    const context = { scenario_id: SID, authenticated_user_id: null, request_id: 'no-R', user_text: 'within 6 months', user_turn_text: 'within 6 months' };
    const offered = await w.caps.proposeGoalDeadline!(context, { deadline_words: 'within 6 months', rationale: 'The user stated this deadline.' });
    expect(offered).toMatchObject({ ok: true, public_label: 'Is your deadline 1 August 2027 (6 months from today)?' });
    const operation = w.proposals.get(String(offered.proposal_id))!.operations[0]!;
    expect(operation.value).toEqual({ deadline: '2027-08-01', expected_deadline: null, words: 'within 6 months' });
    expect(await w.caps.authoriseChange({ ...context, user_text: 'Yes', user_turn_text: 'Yes' }, { proposal_id: String(offered.proposal_id) })).toMatchObject({ ok: true, applied: true });
    const after = w.read(), expected = structuredClone(before); goal(expected).goal_horizon = { deadline: '2027-08-01' };
    expect(after).toEqual(expected);
    expect(goal(after).goal_horizon_months).toBeUndefined();
    expect(goal(after).goal_horizon_reference_date).toBeUndefined();
    expect(goal(after).goal_horizon_stated_months).toBeUndefined();
    expect(goalStockAccumulationOf(after)).toBeNull(); expect((await w.offer()).ok).toBe(false);
    expect(hash(after)).toBe(hash(before));
    expect(w.writes[0].handler_facts.find((f: Rec) => f.fact_type === 'edit_graph').result.rerun_recommended).toBe(false);
    savedRun.fact = JSON.parse(JSON.stringify(old));
    const cold = await readScenarioAnalysis({ scenarioId: SID, graph: after as never, requestId: 'no-R-reload' });
    expect(cold.analysis_state?.run_state.kind).toBe('complete_current');
    expect(cold.canonical_analysis_view?.options).toHaveLength(2);
    expect(cold.canonical_analysis_view?.options.every(row => row.cell.kind === 'withheld'
      && row.cell.reasons.some(r => r.code === GOAL_FIGURES_HORIZON_NOT_TESTED))).toBe(true);
  });
  it('CONTRAST same brief with a construction version: from R card; Yes holds H and offers the reading', async () => {
    const w = world(); expect((await w.deadline('within 6 months')).applied).toBe(true);
    expect(goal(w.read())).toMatchObject({ goal_horizon: { deadline: '2027-04-09' }, goal_horizon_months: 6,
      goal_horizon_reference_date: R, goal_horizon_stated_months: 6 });
    expect((await w.offer()).ok).toBe(true);
  });
  it('no versions CONTRAST: explicit as of on the card supplies R only after Yes', async () => {
    const w = world(draft(), false, null);
    const context = { scenario_id: SID, authenticated_user_id: null, request_id: 'as-of', user_text: `within 6 months as of ${R}`, user_turn_text: `within 6 months as of ${R}` };
    const offered = await w.caps.proposeGoalDeadline!(context, { deadline_words: 'within 6 months', reference_date: R, rationale: 'The user stated this deadline.' });
    expect(offered).toMatchObject({ ok: true, public_label: 'Is your deadline 9 April 2027 (6 months from 9 October 2026)?' });
    expect(goal(w.read()).goal_horizon_months).toBeUndefined();
    expect(await w.caps.authoriseChange({ ...context, user_text: 'Yes', user_turn_text: 'Yes' }, { proposal_id: String(offered.proposal_id) })).toMatchObject({ ok: true, applied: true });
    expect(goal(w.read())).toMatchObject({ goal_horizon_months: 6, goal_horizon_reference_date: R });
    expect((await w.offer()).ok).toBe(true);
  });
  it.each(['unconfirmed', 'failed-read'] as const)('no versions date-only landed recovery: %s; rename accepted, one append', async recovery => {
    const w = world(draft(), false, null, recovery);
    const context = { scenario_id: SID, authenticated_user_id: null, request_id: 'no-R-retry', user_text: 'within 6 months', user_turn_text: 'within 6 months' };
    const offered = await w.caps.proposeGoalDeadline!(context, { deadline_words: 'within 6 months', rationale: 'The user stated this deadline.' });
    expect(offered.ok).toBe(true);
    const yes = { ...context, user_text: 'Yes', user_turn_text: 'Yes' };
    expect(await w.caps.authoriseChange(yes, { proposal_id: String(offered.proposal_id) })).toMatchObject({ applied: false, refusal: 'not_confirmed' });
    expect(w.writes).toHaveLength(1);
    // Recovery owns only the date; a later unrelated rename must not supersede its landed write.
    const actual = w.read(); goal(actual).label = 'Our renamed cash';
    expect(goalHorizonLandedWriteIsScoped(w.read(), actual, String(goal(actual).id))).toBe(true);
    w.replace(actual);
    expect(await w.caps.authoriseChange(yes, { proposal_id: String(offered.proposal_id) })).toMatchObject({ ok: true, applied: true, mutated: false });
    expect(w.writes).toHaveLength(1); expect(goal(w.read()).goal_horizon_months).toBeUndefined();
  });
  it('month N and number words are proposed, never silently held', async () => {
    expect(attestHorizon('Reach cash at month 9', { horizon_months: 9 })).toMatchObject({ status: 'unresolved', months: null, proposed_months: 9 });
    expect(attestHorizon('Reach cash in nine months', { horizon_months: 9 })).toMatchObject({ status: 'unresolved', months: null, proposed_months: 9 });
    const w = world(); expect((await w.deadline('month 9')).applied).toBe(true); expect(goal(w.read()).goal_horizon_months).toBe(9);
  });
  it.each(['olumi', 'second-flow', 'per-time-level', 'mismatched-unit', 'zero-inflow'])('no structural offer: %s; existing honest line', async why => {
    const g = draft();
    if (why === 'olumi') node(g, 'monthly_additions').observed_state.source = 'cee_inference';
    if (why === 'per-time-level') node(g, 'current_cash').observed_state.unit = 'GBP/week';
    if (why === 'mismatched-unit') node(g, 'monthly_additions').observed_state.unit = 'USD/month';
    if (why === 'zero-inflow') node(g, 'monthly_additions').observed_state.raw_value = 0;
    if (why === 'second-flow') { g.nodes.push({ ...structuredClone(node(g, 'monthly_additions')), id: 'other', label: 'Second flow' }); g.edges.push({ ...g.edges[0], from: 'other', to: String(goal(g).id) }); }
    const w = world(g); expect((await w.deadline()).applied).toBe(true); expect(goalStockAccumulationOf(w.read())).toBeNull();
    const offered = await w.offer(); expect(offered.ok).toBe(false); expect(offered.detail).toBe('The model holds no reading of the goal for the user to confirm. Nothing was offered; say nothing about one.');
  });
  it('saved zero missing user confirmation refuses Recorded', async () => {
    const w = world(dateWrite(draft(), '2027-03-31'), true); const offered = await w.offer(); expect(offered.ok).toBe(true);
    const result = await w.confirm(offered); expect(result.applied).toBe(false); expect(result.refusal).toBe('not_verified'); expect(result.follow_up).toBeUndefined();
  });
  it('unconfirmed carrier cannot earn computed_at_h even if a provider reports it evaluated', () => {
    const g = dateWrite(draft(), '2027-03-31');
    const evaluations = g.nodes.filter((n: Rec) => n.nonlinear_identity).map((n: Rec) => ({ node_id: n.id, ...n.nonlinear_identity, evaluated: true, level_source: 'identity_inputs' }));
    expect(goalHorizonVerdict(g, { identity_evaluations: evaluations })).toBe('withhold');
  });
  it('rate goal offers graph-derived consequence and unselected one-off choice; one-off saves a plain level and never reoffers', async () => {
    const g = draft(); goal(g).label = 'MRR'; goal(g).goal_threshold_unit = 'GBP/month';
    node(g, 'current_cash').observed_state.unit = 'GBP/month'; node(g, 'monthly_additions').observed_state.unit = 'GBP/month/month';
    const w = world(g); expect((await w.deadline('within 9 months')).applied).toBe(true);
    const offered = await w.offer(); expect(offered.ok, JSON.stringify(offered)).toBe(true);
    expect(offered.card.words).toContain('Olumi read ‘£2,000 a month’ as ‘MRR’ growing by £2,000 every month (about £18,000 more by month 9), after any losses.');
    const proposal = w.proposals.get(offered.proposal_id)!;
    const chips = approvalChipsFor([{ name: 'propose_identity', ok: true, mutated: false, proposal_id: offered.proposal_id }], () => ({ proposal, result: offered }));
    expect(chips).toHaveLength(2); expect(chips[1]!.label).toBe("No, it's a one-off £2,000 a month"); expect(chips.some(c => 'selected' in c)).toBe(false);
    const answer = await w.confirm(offered, true); expect(answer.applied, JSON.stringify(answer)).toBe(true);
    expect(goalStockAccumulationOf(w.read())).toBeNull(); expect(goal(w.read()).nonlinear_identity).toBeUndefined(); expect(goal(w.read()).observed_state.raw_value).toBe(12000);
    const saved = goal(w.read()).observed_state; const frame = readGoalRecord(w.read(), String(goal(w.read()).id))?.target?.cap;
    expect(saved.cap).toBe(frame); expect(saved.value).toBe(12000 / frame!); expect(saved.baseline).toBe(saved.value);
    expect(proposeProductIdentity(w.read())).toBeNull(); expect(admitStructuralGoalAccumulation(w.read().nodes, w.read().edges).nodes).toEqual(w.read().nodes);
  });
  it('D1a deadline Yes WITH the structural pair moves the analysis hash; earlier Run reload is stale', async () => {
    const g = draft(); const old = await run(g); const before = hash(g);
    expect(deriveAnalysisFreshness([old as never], before, undefined, { currentGraph: g }).freshness).toBe('fresh');
    const w = world(g); expect((await w.deadline()).applied).toBe(true); const after = w.read();
    expect(goalStockAccumulationOf(after)).not.toBeNull(); expect(hash(after)).not.toBe(before);
    savedRun.fact = JSON.parse(JSON.stringify(old));
    const cold = await readScenarioAnalysis({ scenarioId: SID, graph: after as never, requestId: 'D1a-reload' });
    expect(cold.analysis_state?.run_state.kind).toBe('complete_stale'); expect(cold.analysis_result).toBeNull();
    expect(cold.canonical_analysis_view?.staleness.stale).toBe(true);
  });
  it('R1-structural-partial: landed date must retain the admitted carrier, zero and goal sum', async () => {
    const before = draft();
    const w = world(before); await w.deadline();
    const expected = w.read(); const held = goalStockAccumulationOf(expected)!;
    for (const kind of ['carrier', 'zero', 'sum']) {
      for (const missing of [true, false]) {
        const partial = structuredClone(expected);
        if (kind === 'sum') {
          if (missing) delete goal(partial).nonlinear_identity;
          else goal(partial).nonlinear_identity.factor_ids = ['other'];
        } else {
          const id = String(kind === 'carrier' ? held.carrier.id : held.netZero!.id);
          if (missing) partial.nodes = partial.nodes.filter((n: Rec) => n.id !== id);
          else if (kind === 'carrier') node(partial, id).nonlinear_identity.horizon_months = 6;
          else node(partial, id).observed_state.value = 1;
        }
        expect(goalHorizonPostimageIsScoped(before, partial, String(goal(before).id), R), `${kind} missing=${missing}`).toBe(false);
      }
    }
  });
  it('D1b deadline Yes WITHOUT a pair leaves the hash unchanged; canonical earlier-Run reload withholds at read time', async () => {
    const g = draft(); node(g, 'monthly_additions').observed_state.unit = 'USD/month';
    const cap = readGoalRecord(g, String(goal(g).id))?.target?.cap;
    expect(cap).toBeGreaterThan(0);
    goal(g).observed_state = { ...structuredClone(node(g, 'current_cash').observed_state), cap, value: 12000 / cap!, baseline: 12000 / cap! };
    const old = await run(g); const before = hash(g);
    const oldText = JSON.stringify(old); expect(oldText).not.toContain(GOAL_FIGURES_HORIZON_NOT_TESTED);
    expect(old.result.enrichment.option_comparison.some((r: Rec) => r.probability_of_goal !== undefined)).toBe(true);
    const w = world(g); expect((await w.deadline()).applied).toBe(true); const after = w.read();
    expect(goalStockAccumulationOf(after)).toBeNull(); expect(hash(after)).toBe(before);
    savedRun.fact = JSON.parse(oldText);
    const cold = await readScenarioAnalysis({ scenarioId: SID, graph: after as never, requestId: 'D1b-reload' });
    expect(cold.analysis_state?.run_state.kind).toBe('complete_current');
    expect(cold.canonical_analysis_view?.options.map(row => row.cell)).toMatchObject([
      { kind: 'withheld', face: 'Not shown yet: needs month-by-month changes', why: "Your goal is for month 5, and this model only has today's numbers." },
      { kind: 'withheld', face: 'Not shown yet: needs month-by-month changes', why: "Your goal is for month 5, and this model only has today's numbers." },
    ]);
    expect(JSON.stringify(cold.analysis_result)).toContain(GOAL_FIGURES_HORIZON_NOT_TESTED);
    expect(cold.canonical_analysis_view?.staleness.stale).toBe(false);
    const rows = cold.canonical_analysis_view?.options;
    expect(rows?.length).toBe(2); expect(rows?.every(row => row.cell.kind === 'withheld')).toBe(true);
    expect(rows?.every(row => row.cell.kind === 'withheld' && row.cell.reasons.some(r => r.code === GOAL_FIGURES_HORIZON_NOT_TESTED))).toBe(true);
    expect(JSON.stringify(savedRun.fact)).toBe(oldText);
    expect(w.writes[0].handler_facts.find((fact: Rec) => fact.fact_type === 'edit_graph').result.rerun_recommended).toBe(false);
  });
});
