import { describe, expect, it, vi } from 'vitest';
const liveStore = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../../session/index.js', async original => ({
  ...(await original<typeof import('../../session/index.js')>()), getSessionStore: () => liveStore.value,
}));
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: async () => undefined }));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => { throw new Error('Ceiling chain forbids providers'); },
  getAdapterWithResolution: () => { throw new Error('Ceiling chain forbids providers'); },
  getMaxTokensFromConfig: () => undefined,
}));
import fixture from '../../../../tests/fixtures/ceiling-stock-t3.json';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { identityApproveMessage, identityReadingOf } from '../identity-card.js';
import { commitOptionLevelsInProcess } from '../../system-events/dispatch.js';
import { applyGoalHorizonEdit } from '../../goal-target/goal-horizon-write.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { goalStockAccumulationOf } from '../../goal-target/goal-horizon-detail.js';
import { CeilingStockPendingSchema, ceilingStockPostimage, ceilingStockRecorded, proposeCeilingStock } from '../ceiling-stock.js';
import { applyIdentityConfirmEdit, identityConfirmPostimageIsScoped, identityConfirmReadingToken } from '../../system-events/identity-confirm-edit.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { approvalChipsFor } from '../approval-chips.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import minimalFixture from '../../../../tests/fixtures/plot/v2-run-golden-minimal.json';
import { targetTestabilityOf } from '../../admission/target-testability.js';

type Rec = Record<string, any>;
const SID = '550e8400-e29b-41d4-a716-4466554400c6';
const hash = (g: Rec) => computeAnalysisAffectingGraphHash(g as never)!;
const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id);
const goal = (g: Rec): Rec => g.nodes.find((n: Rec) => n.kind === 'goal');
function held(): Rec {
  const result = applyGoalHorizonEdit(fixture.graph, { goal_id: goal(fixture.graph).id, deadline: '2027-08-10', expected_deadline: null,
    reference_date: '2026-10-10', stated_months: 10 });
  if (result.kind !== 'mutated') throw new Error(JSON.stringify(result));
  return result.mutatedGraph as Rec;
}
function world(initial = held(), brief = fixture.brief) {
  let bytes = JSON.stringify(initial);
  const read = (): Rec => JSON.parse(bytes);
  const proposals = new ProposalStore(); const writes: Rec[] = [];
  const store = createMockSessionStore({
    loadGraph: async () => read(), loadGraphAndBriefText: async () => ({ graph: read(), briefText: brief }),
    append: async write => { writes.push(write); if (write.graph !== undefined) bytes = JSON.stringify(write.graph); return { id: `row-${writes.length}` }; },
    readRecent: async () => writes.map((w, i) => makeSessionTurnRow({ id: `row-${i+1}`, scenario_id: w.scenario_id, turn_id: w.turn_id,
      turn_class: w.turn_class, handler_id: w.handler_id, request_hash: w.request_hash, response_emitted: w.response_emitted,
      llm_calls_used: w.llm_calls_used, duration_ms: w.duration_ms })),
    readFactsWithTurnFor: async ids => writes.flatMap((w, i) => ids.includes(`row-${i+1}`)
      ? w.handler_facts.map((fact: Rec) => ({ turn_id: `row-${i+1}`, fact_created_at: '2026-10-10T12:00:00Z', fact })) : []),
  });
  const dispatch: InternalDispatch = async path => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: read(), graph_hash: hash(read()), brief_text: brief, scenario_created_at: fixture.scenario_created_at } };
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    throw new Error(`Unexpected local path ${path}`);
  };
  liveStore.value = store;
  const caps = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, {
    commitOptionLevels: input => commitOptionLevelsInProcess(input, 'ceiling-chain'),
  });
  const ctx = (text: string) => ({ scenario_id: SID, authenticated_user_id: null, request_id: 'ceiling-chain', user_text: text, user_turn_text: text });
  const offer = () => caps.proposeIdentity!(ctx('Confirm the reading'));
  const confirm = (offered: Rec) => {
    const text = identityApproveMessage(offered.card.words);
    return caps.authoriseChange({ ...ctx(text), typed_approval_of: offered.proposal_id, typed_approval_words: text }, { proposal_id: offered.proposal_id });
  };
  return { read, writes, proposals, offer, confirm, replace: (g: Rec) => { bytes = JSON.stringify(g); } };
}
describe('typed ceiling-stock confirmation chain', () => {
  it('T3: offers on held H, preserves the derived goal until Yes, atomically records stock ≤ stated ceiling, and reloads', async () => {
    const w = world(); const before = w.read();
    const offered = await w.offer() as Rec;
    expect(offered.ok, JSON.stringify(offered)).toBe(true);
    expect(offered.card.words).toContain('1,900 riders');
    expect(offered.card.words).toContain('month 10');
    expect(offered.card.words).toBe('Olumi reads ‘Rider capacity surplus at month 10’ as ‘Registered riders at month 10’ at or under 1,900 riders if nothing changes (under the ceiling throughout). Is that how you work it out?');
    expect(offered.card.words).toContain('if nothing changes');
    expect(offered.card.words).not.toContain('2,500'); expect(offered.card.words).not.toContain('2,050');
    expect(w.read()).toEqual(before); expect(w.writes).toHaveLength(0);
    expect(goal(w.read()).label).toBe('Rider capacity surplus at month 10');
    const pending = identityReadingOf(w.proposals.get(offered.proposal_id)!) as Rec;
    expect(pending.ceiling_stock).toMatchObject({ comparator: '<=', horizon_months: 10, coverage: 'throughout',
      stock: { id: 'registered_riders_today', raw_value: 1400 }, flow: { id: 'net_rider_growth_per_month', raw_value: 30 },
      ceiling: { id: 'serviceable_rider_capacity', raw_value: 1900 } });
    const yes = await w.confirm(offered);
    expect(yes.applied, JSON.stringify(yes)).toBe(true); expect(w.writes).toHaveLength(1);
    const reloaded = w.read();
    expect(targetTestabilityOf(reloaded), JSON.stringify(targetTestabilityOf(reloaded))).toMatchObject({ kind: 'unchecked' });
    expect(goal(reloaded)).toMatchObject({ goal_direction: '<=', goal_threshold_raw: 1900, goal_threshold_unit: 'riders', goal_horizon_months: 10 });
    expect(goalStockAccumulationOf(reloaded)).not.toBeNull();
    expect(node(reloaded, 'serviceable_rider_capacity')).toEqual(node(before, 'serviceable_rider_capacity'));
    expect(GraphV3.parse(reloaded).nodes.find(n => n.kind === 'goal')?.nonlinear_identity).toEqual(goal(reloaded).nonlinear_identity);
    const chips = approvalChipsFor([{ name: 'propose_identity', ok: true, mutated: false, proposal_id: offered.proposal_id }],
      () => ({ proposal: w.proposals.get(offered.proposal_id)!, result: offered as never }));
    expect(JSON.stringify(chips)).toContain(offered.card.words);
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SID, 'ceiling-run', createMockSessionStore({ loadGraph: async () => reloaded,
      loadGraphAndBriefText: async () => ({ graph: reloaded, briefText: fixture.brief }) }));
    // Local arithmetic test double, NOT an external PLoT/ISL run. The real handler must submit the held carrier/bound.
    let computed: number | undefined, computedProbability: number | undefined;
    const plotRun = vi.fn(async (request: Rec) => {
      expect(request.goal_direction).toBe('minimise');
      const wireGoal = node(request.graph, goal(reloaded).id);
      expect(wireGoal).toMatchObject({ goal_threshold_raw: 1900, goal_threshold_unit: 'riders' });
      const carrier = node(request.graph, wireGoal.nonlinear_identity.factor_ids[0]);
      expect(carrier.nonlinear_identity).toMatchObject({ operation: 'accumulation', horizon_months: 10 });
      const [stock, rate, flow] = carrier.nonlinear_identity.factor_ids.map((id: string) => node(request.graph, id));
      expect(rate.observed_state.raw_value).toBe(0);
      const total: number = stock.observed_state.raw_value + flow.observed_state.raw_value * carrier.nonlinear_identity.horizon_months;
      computed = total;
      expect(total).toBe(1700);
      const probability = computedProbability = total <= wireGoal.goal_threshold_raw ? 1 : 0;
      return { ...structuredClone(minimalFixture), inference_warnings: [], results: request.options.map((o: Rec) => ({ option_id: o.id, win_probability: 1/3 })),
        option_comparison: request.options.map((o: Rec) => ({ option_id: o.id, option_label: o.label, probability_of_goal: probability, win_probability: 1/3,
          outcome: { p10: computed, p50: computed, p90: computed, mean: computed, std: 0, n_samples: 100, n_valid_samples: 100, validity_ratio: 1, percentiles_source: 'samples' } })),
        identity_evaluations: request.graph.nodes.filter((n: Rec) => n.nonlinear_identity).map((n: Rec) => ({ node_id: n.id, ...n.nonlinear_identity, evaluated: true,
          ...(n.kind === 'goal' ? { level_source: 'identity_inputs' } : {}) })) };
    });
    const handler = createRunAnalysisHandler({ plotClient: { run: plotRun, validatePatch: vi.fn().mockResolvedValue({}) } as never, scenarioReader: async () => snapshot });
    const run = await handler({ payload: { scenario_id: SID, turn_id: 'ceiling-run' }, requestId: 'ceiling-run', signal: new AbortController().signal, context: {}, orientationText: '' } as never);
    expect(plotRun).toHaveBeenCalledTimes(1);
    const fact = run.handler_facts.find((f: Rec) => f.fact_type === 'run_analysis') as Rec;
    expect(fact).toBeDefined(); expect(computed).toBe(1700);
    expect(computedProbability).toBe(1);
    expect(fact.result.enrichment.option_comparison.find((o: Rec) => o.option_id === 'carry_on_as_now').outcome.mean).toBe(1700);
    // The existing identical-arms policy still withholds comparative chances; this test does not bypass it.
    expect(fact.result.enrichment.inference_warnings).toContainEqual(expect.objectContaining({ code: 'GOAL_FIGURES_OPTIONS_IDENTICAL' }));
    expect(fact.result.enrichment.option_comparison.every((o: Rec) => o.probability_of_goal === undefined)).toBe(true);
  });

  it.each([
    ['two current stocks', (g: Rec) => { g.nodes.push({ ...structuredClone(node(g, 'registered_riders_today')), id: 'other_current_stock',
      label: 'Other registered riders today', observed_state: { ...node(g, 'registered_riders_today').observed_state, raw_value: 1500, value: .5 } }); },
    (s: string) => s+' Today we have 1,500 other registered riders.'],
    ['weekly flow', (g: Rec) => { node(g, 'net_rider_growth_per_month').observed_state.unit = 'riders/week'; }, (s: string) => s.replace('every month', 'every week')],
    ['different flow noun', (g: Rec) => { node(g, 'net_rider_growth_per_month').observed_state.unit = 'bikes/month'; }, (s: string) => s.replace('net 30 riders', 'net 30 bikes')],
    ['drafter unit claim disagrees with typed flow noun', (_g: Rec) => {}, (s: string) => s.replace('net 30 riders', 'net 30 bikes')],
    ['drafter unit claim disagrees with typed ceiling noun', (_g: Rec) => {}, (s: string) => s.replace('1,900 riders', '1,900 bikes')],
    ['flow not stated as net', (_g: Rec) => {}, (s: string) => s.replace('a net 30', '30')],
    ['missing unit connector', (g: Rec) => { node(g, 'net_rider_growth_per_month').observed_state.unit = 'riders by month'; }, (s: string) => s],
    ['target is not ceiling', (_g: Rec) => {}, (s: string) => s.replace('Our depot can service at most 1,900 riders', 'We want 1,900 riders')],
    ['inferred ceiling despite from_brief provenance', (g: Rec) => { node(g, 'serviceable_rider_capacity').observed_state.source = 'cee_inference'; }, (s: string) => s],
    ['flow absent', (g: Rec) => { g.nodes = g.nodes.filter((n: Rec) => n.id !== 'net_rider_growth_per_month'); }, (s: string) => s],
    ['two net monthly flows', (g: Rec) => { g.nodes.push({ ...structuredClone(node(g, 'net_rider_growth_per_month')), id: 'second_net_flow',
      observed_state: { ...node(g, 'net_rider_growth_per_month').observed_state, raw_value: 50, value: .25 } }); }, (s: string) => s+' We are gaining a net 50 riders every month.'],
    ['stock not user stated despite from_brief provenance', (g: Rec) => { node(g, 'registered_riders_today').observed_state.source = 'cee_inference'; }, (s: string) => s],
    ['already above ceiling', (g: Rec) => { Object.assign(node(g, 'registered_riders_today').observed_state, { raw_value: 2000, value: 2/3 }); }, (s: string) => s.replace('1,400', '2,000')],
    ['unknown flow', (g: Rec) => { delete node(g, 'net_rider_growth_per_month').observed_state.raw_value; }, (s: string) => s],
    ['positive drafter value contradicts typed minus', (_g: Rec) => {}, (s: string) => s.replace('net 30', 'net -30')],
    ['positive drafter value contradicts typed loss', (_g: Rec) => {}, (s: string) => s.replace('gaining a net 30', 'suffering a net loss of 30')],
    ['negative flow deferred at admission boundary', (g: Rec) => { Object.assign(node(g, 'net_rider_growth_per_month').observed_state, { raw_value: -30, value: -.15 }); }, (s: string) => s.replace('net 30', 'net -30')],
    ['no held H', (g: Rec) => { delete goal(g).goal_horizon_months; delete goal(g).goal_horizon; }, (s: string) => s],
    // The user's own goal authority is never overridden by a reading prepared from a stated ceiling.
    ['goal already carries an explicit user constraint', (g: Rec) => { g.goal_constraints = [...(g.goal_constraints ?? []), { node_id: goal(g).id,
      label: goal(g).label, operator: '>=', value: 100, unit: 'riders', value_frame: 'level', provenance: 'explicit', constraint_id: 'user-set-target' }]; }, (s: string) => s],
    ['goal threshold already user stated', (g: Rec) => { goal(g).threshold_source = 'user'; }, (s: string) => s],
    ['goal read as a one-off', (g: Rec) => { goal(g).goal_stock_reading = 'one_off'; }, (s: string) => s],
    ['goal already holds a current level', (g: Rec) => { goal(g).observed_state = { value: 0.5, raw_value: 1000, unit: 'riders', source: 'user_stated' }; }, (s: string) => s],
  ] as const)('offers nothing: %s', async (_label, change, text) => {
    const g = held(); change(g); const w = world(g, text(fixture.brief));
    expect(await w.offer()).toMatchObject({ ok: false, mutated: false, refusal: 'no_reading_to_confirm' });
    expect(w.read()).toEqual(g); expect(w.writes).toHaveLength(0);
  });

  it('uncertain positive net flow uses at-month-only wording; zero net flow remains throughout', async () => {
    const uncertain = world(held(), fixture.brief.replace('net 30', 'net about 30'));
    const offered = await uncertain.offer() as Rec;
    expect(offered.ok).toBe(true); expect(offered.card.words).toContain('at month 10 only');
    expect(offered.card.words).not.toContain('throughout');
    expect((identityReadingOf(uncertain.proposals.get(offered.proposal_id)!) as Rec).ceiling_stock.coverage).toBe('at_month_only');
    expect((await uncertain.confirm(offered)).applied).toBe(true);
    const g = held(); Object.assign(node(g, 'net_rider_growth_per_month').observed_state, { raw_value: 0, value: 0 });
    const zero = await world(g, fixture.brief.replace('net 30', 'net 0')).offer() as Rec;
    expect(zero.ok).toBe(true); expect(zero.card.words).toContain('throughout');
  });
  it('currency stock, monthly net flow and ceiling use the same typed amount authority', async () => {
    const g = held(); goal(g).goal_threshold_unit = 'GBP'; goal(g).label = 'Cash surplus at month 10';
    node(g, 'registered_riders_today').observed_state.unit = 'GBP'; node(g, 'registered_riders_today').label = 'Cash today';
    node(g, 'net_rider_growth_per_month').observed_state.unit = 'GBP/month'; node(g, 'net_rider_growth_per_month').label = 'Net cash growth per month';
    node(g, 'serviceable_rider_capacity').observed_state.unit = 'GBP'; node(g, 'serviceable_rider_capacity').label = 'Cash ceiling';
    const text = 'At the moment we have £1,400 cash. We are gaining a net £30 every month. We must hold at most £1,900 cash over ten months.';
    const w = world(g, text), offered = await w.offer() as Rec;
    expect(offered.ok, JSON.stringify(offered)).toBe(true);
    expect(offered.card.words).toContain('£1,900'); expect((await w.confirm(offered)).applied).toBe(true);
    node(g, 'net_rider_growth_per_month').observed_state.unit = 'USD/month';
    expect((await world(g, text).offer()).ok).toBe(false);
  });

  it.each(['ceiling', 'stock', 'flow', 'horizon_months'] as const)('token binds %s and rejects a changed pending with unchanged words', key => {
    const g = held(), card = proposeCeilingStock(g, fixture.brief)!;
    const changed = structuredClone(card);
    if (key === 'horizon_months') changed.ceiling_stock!.horizon_months++;
    else changed.ceiling_stock![key].raw_value += 100;
    expect(identityConfirmReadingToken(changed)).not.toBe(identityConfirmReadingToken(card));
    const result = applyIdentityConfirmEdit({ persistedGraph: g, brief_text: fixture.brief, ...changed,
      expected_graph_hash: hash(g), reading_token: identityConfirmReadingToken(card) });
    expect(result).toMatchObject({ kind: 'refused', reason: 'reading_not_confirmed' });
  });
  it.each(['stock', 'flow', 'ceiling'] as const)('token also binds %s id', key => {
    const card = proposeCeilingStock(held(), fixture.brief)!, changed = structuredClone(card);
    changed.ceiling_stock![key].id += '_swapped';
    expect(identityConfirmReadingToken(changed)).not.toBe(identityConfirmReadingToken(card));
  });

  it('canonical writer reattests against its own brief and rejects stale/changed inputs even with a fresh token', () => {
    const g = held(), card = proposeCeilingStock(g, fixture.brief)!;
    const params = { persistedGraph: g, brief_text: fixture.brief, ...card, expected_graph_hash: hash(g), reading_token: identityConfirmReadingToken(card) };
    expect(applyIdentityConfirmEdit({ ...params, brief_text: fixture.brief.replace('at most', 'we want') })).toMatchObject({ kind: 'refused', reason: 'reading_not_confirmed' });
    const changed = structuredClone(g); node(changed, 'registered_riders_today').observed_state.raw_value = 1500;
    expect(applyIdentityConfirmEdit({ ...params, persistedGraph: changed })).toMatchObject({ kind: 'refused', reason: 'superseded' });
    expect(applyIdentityConfirmEdit({ ...params, persistedGraph: changed, expected_graph_hash: hash(changed) })).toMatchObject({ kind: 'refused', reason: 'reading_not_confirmed' });
  });

  it('scope permits precisely the typed plan; untyped bound changes and arbitrary typed postimages are refused', () => {
    const g = held(), card = proposeCeilingStock(g, fixture.brief)!, p = card.ceiling_stock!;
    const after = projectGraphForPersistence(ceilingStockPostimage(g, p, fixture.brief)!);
    expect(identityConfirmPostimageIsScoped(g, after, card.outcome_id, undefined, p, fixture.brief)).toBe(true);
    expect(identityConfirmPostimageIsScoped(g, after, card.outcome_id)).toBe(false);
    const { ceiling_stock: _pending, ...untyped } = card;
    expect(applyIdentityConfirmEdit({ ...untyped, persistedGraph: g, brief_text: fixture.brief, expected_graph_hash: hash(g), reading_token: identityConfirmReadingToken(untyped) })).toMatchObject({ kind: 'refused' });
    for (const change of [(v: Rec) => { goal(v).goal_threshold_raw = 2000; }, (v: Rec) => { goal(v).goal_direction = '>='; },
      (v: Rec) => { v.nodes.push({ id: 'unapproved', kind: 'factor', label: 'unapproved' }); },
      (v: Rec) => { node(v, 'serviceable_rider_capacity').observed_state.raw_value = 2500; }]) {
      const invalid = structuredClone(after); change(invalid);
      expect(identityConfirmPostimageIsScoped(g, invalid, card.outcome_id, undefined, p, fixture.brief)).toBe(false);
    }
    expect(ceilingStockRecorded(after, p)).toBe(true);
    const wrong = structuredClone(after); goal(wrong).goal_threshold_raw = 2000;
    expect(ceilingStockRecorded(wrong, p)).toBe(false);
    expect(CeilingStockPendingSchema.safeParse({ ...p, comparator: '>=' }).success).toBe(false);
    expect(CeilingStockPendingSchema.safeParse({ ...p, transformation: { ...p.transformation, surprise_node: {} } }).success).toBe(false);
  });
  it('parser refuses malformed, mismatched, or compound pending readings instead of falling back to an ordinary identity', async () => {
    const w = world(), offered = await w.offer() as Rec, proposal = w.proposals.get(offered.proposal_id)!;
    for (const change of [(p: Rec) => { p.operations[0].value.ceiling_stock.ceiling.raw_value = '1900'; },
      (p: Rec) => { p.operations[0].value.ceiling_stock.goal_id = 'other_goal'; },
      (p: Rec) => { p.operations.push({ op: 'update_node', path: goal(held()).id, value: { goal_direction: '<=' } }); }]) {
      const invalid = structuredClone(proposal); change(invalid); expect(identityReadingOf(invalid)).toBeUndefined();
    }
  });

  it('approval refuses a changed stored graph and writes nothing', async () => {
    const w = world(), offered = await w.offer() as Rec;
    const changed = w.read(); node(changed, 'net_rider_growth_per_month').observed_state.raw_value = 40; w.replace(changed);
    const result = await w.confirm(offered);
    expect(result.applied).not.toBe(true); expect(w.writes).toHaveLength(0);
  });
});
