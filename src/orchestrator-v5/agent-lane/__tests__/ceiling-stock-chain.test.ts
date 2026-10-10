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
import { admitAccumulationIdentities, withAdmittedAccumulations } from '../accumulation-identity.js';
import { reachedGoalPaths, targetTestabilityOf } from '../../admission/target-testability.js';

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
    expect(offered.card.words).toBe('Olumi reads ‘Rider capacity surplus at month 10’ as ‘Registered riders at month 10’ staying at or under 1,900 riders if nothing changes. Is that how you work it out?');
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
    expect(zero.ok).toBe(true); expect(zero.card.words).toContain('staying at or under');
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
  // Each replacement has its own unmodified control; these rows do not borrow role evidence from another sentence.
  it.each([
    ['stock hope', 'At the moment we have 1,400 registered riders.', 'Today we hope to reach 1,400 registered riders.'],
    ['stock neighbour', 'At the moment we have 1,400 registered riders.', 'Currently our neighbour has 1,400 registered riders.'],
    ['stock forecast', 'At the moment we have 1,400 registered riders.', 'Today we forecast 1,400 registered riders next year.'],
    ['stock past', 'At the moment we have 1,400 registered riders.', "Today we reviewed last year's total of 1,400 registered riders."],
    ['stock conditional', 'At the moment we have 1,400 registered riders.', 'If we rent another depot, we have room for 1,400 registered riders.'],
    ['ceiling conditional', 'Our depot can service at most 1,900 riders over ten months.', 'If we rent another depot, we can service at most 1,900 riders over ten months.'],
    ['ceiling neighbour', 'Our depot can service at most 1,900 riders over ten months.', 'Our neighbour can service at most 1,900 riders over ten months.'],
    ['flow forecast', 'We are gaining a net 30 riders every month.', 'We forecast a net 30 riders every month.'],
    ['flow competitor', 'We are gaining a net 30 riders every month.', 'Our competitor is gaining a net 30 riders every month.'],
    ['flow complaints', 'We are gaining a net 30 riders every month.', 'We get a net 30 riders per month complaining about maintenance.'],
    ['flow decrease', 'We are gaining a net 30 riders every month.', 'We have a net 30 riders fewer every month.'],
    ['flow week reviewed monthly', 'We are gaining a net 30 riders every month.', 'We are gaining a net 30 riders per week, reviewed every month.'],
    ['flow year reviewed monthly', 'We are gaining a net 30 riders every month.', 'We are gaining a net 30 riders per year, reviewed every month.'],
    ['flow quarter reviewed monthly', 'We are gaining a net 30 riders every month.', 'We are gaining a net 30 riders per quarter, reviewed every month.'],
    ['flow alternate months', 'We are gaining a net 30 riders every month.', 'We are gaining a net 30 riders every other month, with a review each month.'],
  ] as const)('R6 role/period: %s refuses with paired control', async (_name, original, replacement) => {
    const brief = 'At the moment we have 1,400 registered riders. We are gaining a net 30 riders every month. Our depot can service at most 1,900 riders over ten months.';
    expect((await world(held(), brief).offer()).ok).toBe(true);
    expect(await world(held(), brief.replace(original, replacement)).offer()).toMatchObject({ ok: false, refusal: 'no_reading_to_confirm' });
  });
  it.each(['every month', 'per month', 'a month', 'each month'])('R6 own monthly tail control: %s', tail => {
    expect(proposeCeilingStock(held(), fixture.brief.replace('every month', tail))).not.toBeNull();
  });
  it('R6 exceeded projection is a requirement card with ceiling 1600', async () => {
    const g = held(); node(g, 'serviceable_rider_capacity').observed_state.raw_value = 1600;
    const w = world(g, fixture.brief.replace('1,900', '1,600')), offered = await w.offer() as Rec;
    expect(offered.ok).toBe(true);
    expect(offered.card.words).toBe('Olumi reads ‘Rider capacity surplus at month 10’ as ‘Registered riders at month 10’ staying at or under 1,600 riders if nothing changes. Is that how you work it out?');
    expect((identityReadingOf(w.proposals.get(offered.proposal_id)!) as Rec).ceiling_stock.ceiling.raw_value).toBe(1600);
    expect((await w.confirm(offered)).applied).toBe(true);
    expect(goal(w.read()).goal_threshold_raw).toBe(1600);
  });
  it('R6 awaiting accumulation preserves not_testable / goal_path_placeholder', () => {
    const g = held();
    for (const from of ['registered_riders_today', 'net_rider_growth_per_month']) g.edges.push({ from, to: goal(g).id, strength: { mean: 1, std: .01 }, exists_probability: 1 });
    const admission = admitAccumulationIdentities(g.nodes, g.edges, [{ outcome: 'Rider capacity surplus at month 10', operation: 'accumulation',
      factors: ['Registered riders today', 'Net rider growth per month'], reading: 'net', provenance: 'explicit' }]);
    expect(admission.loss).toEqual([]);
    const admitted = { ...g, ...withAdmittedAccumulations(g.nodes, g.edges, admission) };
    const stock = goalStockAccumulationOf(admitted)!;
    expect(stock.identity.stated_in_brief).toBe(true); expect(stock.accumulation.stated_in_brief).toBe(false);
    const ids = admitted.nodes.filter((n: Rec) => n.kind === 'option').map((n: Rec) => n.id as string);
    expect(reachedGoalPaths(admitted, ids, new Map(ids.map(id => [id, [id]]))).paths.some(p => p.links.length > 0)).toBe(true);
    expect(targetTestabilityOf(admitted)).toMatchObject({ kind: 'not_testable', failures: expect.arrayContaining([expect.objectContaining({ code: 'goal_path_placeholder' })]) });
  });
  it('R6 pending accumulation retains the prior off-goal placeholder check', () => {
    const g = held();
    for (const from of ['registered_riders_today', 'net_rider_growth_per_month']) g.edges.push({ from, to: goal(g).id, strength: { mean: 1, std: .01 }, exists_probability: 1 });
    const admission = admitAccumulationIdentities(g.nodes, g.edges, [{ outcome: goal(g).label, operation: 'accumulation',
      factors: ['Registered riders today', 'Net rider growth per month'], reading: 'net', provenance: 'explicit' }]);
    const admitted: Rec = { ...g, ...withAdmittedAccumulations(g.nodes, g.edges, admission) };
    admitted.edges.forEach((e: Rec) => { delete e.defaulted; e.provenance = { ...e.provenance, magnitude: 'user_stated', mean_projected: false }; });
    admitted.nodes.push({ id: 'off_goal', kind: 'outcome', label: 'Off goal' });
    admitted.edges.push({ from: 'serviceable_rider_capacity', to: 'off_goal', strength: { mean: 1, std: .01 }, exists_probability: 1,
      provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } });
    expect(targetTestabilityOf(admitted)).toMatchObject({ kind: 'not_testable', failures: expect.arrayContaining([expect.objectContaining({ code: 'goal_path_placeholder' })]) });
  });
  it('R6 typed ceiling noun cannot borrow a compatible label', () => {
    const g = held(); node(g, 'serviceable_rider_capacity').label = 'Bikes capacity';
    expect(proposeCeilingStock(g, fixture.brief.replace('1,900 riders', '1,900 bikes'))).toBeNull();
  });
  it('R6 scoped amount must name its quantity', () => {
    const g = held(); node(g, 'registered_riders_today').label = 'Current stock';
    const brief = fixture.brief.replace('1,400 registered riders', '1,400 riders');
    expect(proposeCeilingStock(g, brief)).toBeNull();
  });
  it.each(['awaiting ceiling id', 'confirmed other id'] as const)('R6 filter scope: %s retains surplus paths', variant => {
    const g = held();
    for (const from of ['registered_riders_today', 'net_rider_growth_per_month']) g.edges.push({ from, to: goal(g).id, strength: { mean: 1, std: .01 }, exists_probability: 1 });
    const admission = admitAccumulationIdentities(g.nodes, g.edges, [{ outcome: goal(g).label, operation: 'accumulation',
      factors: ['Registered riders today', 'Net rider growth per month'], reading: 'net', provenance: 'explicit' }]);
    const admitted = { ...g, ...withAdmittedAccumulations(g.nodes, g.edges, admission) };
    const stock = goalStockAccumulationOf(admitted)!;
    if (variant === 'awaiting ceiling id') {
      const oldId = stock.carrier.id, newId = `${goal(g).id}_ceiling_stock_at_month_10`;
      node(admitted, String(oldId)).id = newId;
      goal(admitted).nonlinear_identity.factor_ids = [newId];
      admitted.edges.forEach((e: Rec) => { if (e.from === oldId) e.from = newId; if (e.to === oldId) e.to = newId; });
    } else node(admitted, String(stock.carrier.id)).nonlinear_identity.stated_in_brief = true;
    const ids = admitted.nodes.filter((n: Rec) => n.kind === 'option').map((n: Rec) => n.id as string);
    expect(reachedGoalPaths(admitted, ids, new Map(ids.map(id => [id, [id]]))).paths.some(p => p.links.length > 0)).toBe(true);
    expect(targetTestabilityOf(admitted)).toMatchObject({ kind: 'not_testable', failures: expect.arrayContaining([expect.objectContaining({ code: 'goal_path_placeholder' })]) });
  });
  it('R6 duplicate own stock writing is ambiguous', () => {
    expect(proposeCeilingStock(held(), fixture.brief + ' Today we have 1,400 registered riders.')).toBeNull();
  });
  it('R6 stock tail must describe the named present level', () => {
    expect(proposeCeilingStock(held(), fixture.brief.replace('1,400 registered riders.', '1,400 registered riders forecast next year.'))).toBeNull();
  });
  it.each(['last', 'nine'])('R6 ceiling duration: %s is not the held future period', duration => {
    const brief = 'At the moment we have 1,400 registered riders. We are gaining a net 30 riders every month. Our depot can service at most 1,900 riders over ten months.';
    expect(proposeCeilingStock(held(), brief)).not.toBeNull();
    expect(proposeCeilingStock(held(), brief.replace('over ten months', `over ${duration} months`))).toBeNull();
  });
  it('R6 ceiling tail must describe the stated present capacity', () => {
    expect(proposeCeilingStock(held(), fixture.brief.replace('1,900 riders without breaking its maintenance targets', '1,900 riders forecast next year'))).toBeNull();
  });
  it.each([
    ['flow typed source', (g: Rec) => { node(g, 'net_rider_growth_per_month').observed_state.source = 'cee_inference'; }],
    ['two ceilings', (g: Rec) => { g.nodes.push({ ...structuredClone(node(g, 'serviceable_rider_capacity')), id: 'second_ceiling' }); }],
    ['negative raw stock', (g: Rec) => { node(g, 'registered_riders_today').observed_state.raw_value = -1400; }],
    ['goal unit mismatch', (g: Rec) => { goal(g).goal_threshold_unit = 'bikes'; }],
    ['incoming stock', (g: Rec) => { g.edges.push({ from: 'second_depot', to: 'registered_riders_today' }); }],
    ['incoming flow', (g: Rec) => { g.edges.push({ from: 'second_depot', to: 'net_rider_growth_per_month' }); }],
    ['carrier id collision', (g: Rec) => { g.nodes.push({ id: `${goal(g).id}_ceiling_stock_at_month_10`, kind: 'outcome' }); }],
    ['zero id collision', (g: Rec) => { g.nodes.push({ id: `${goal(g).id}_ceiling_stock_at_month_10_net_zero_rate`, kind: 'factor' }); }],
    ['negative raw flow positive words', (g: Rec) => { node(g, 'net_rider_growth_per_month').observed_state.raw_value = -30; }],
    ['overlong card', (g: Rec) => { goal(g).label = 'R'.repeat(401); }],
  ] as const)('R6 guard: %s', (_name, mutate) => {
    const g = held(); mutate(g); expect(proposeCeilingStock(g, fixture.brief)).toBeNull();
  });
  it('R6 likely_range selects verbatim month-only card accepted by the shell', async () => {
    const g = held(); node(g, 'net_rider_growth_per_month').observed_state.likely_range = { min: 20, max: 40 };
    const w = world(g), offered = await w.offer() as Rec;
    expect(offered.ok).toBe(true);
    expect(offered.card.words).toBe('Olumi reads ‘Rider capacity surplus at month 10’ as ‘Registered riders at month 10’ at or under 1,900 riders at month 10 only, if nothing changes. Is that how you work it out?');
    expect((identityReadingOf(w.proposals.get(offered.proposal_id)!) as Rec).ceiling_stock.coverage).toBe('at_month_only');
    expect((await w.confirm(offered)).applied).toBe(true);
  });
  it.each(['coverage', 'ceiling unit', 'carrier_id', 'zero_id', 'carrier_label', 'scale_frame'] as const)('R6 token field: %s', key => {
    const card = proposeCeilingStock(held(), fixture.brief)!, changed = structuredClone(card), p = changed.ceiling_stock!;
    if (key === 'coverage') p.coverage = 'at_month_only';
    else if (key === 'ceiling unit') p.ceiling.unit = 'bikes';
    else if (key === 'scale_frame') p.transformation.scale_frame++;
    else p.transformation[key] += '_changed';
    expect(identityConfirmReadingToken(changed)).not.toBe(identityConfirmReadingToken(card));
  });
  it.each(['words', 'extra factor', 'part_levels', 'choice'] as const)('R6 direct writer refuses: %s with fresh token', key => {
    const g = held(), card = proposeCeilingStock(g, fixture.brief)!;
    const changed = { ...card, ...(key === 'words' ? { words: card.words.replace('1,900', '2,500') } : {}),
      ...(key === 'extra factor' ? { factor_ids: [...card.factor_ids, 'registered_riders_today'] } : {}),
      ...(key === 'part_levels' ? { part_levels: [] } : {}), ...(key === 'choice' ? { choice: 'one_off' as const } : {}) };
    expect(applyIdentityConfirmEdit({ persistedGraph: g, brief_text: fixture.brief, ...changed, expected_graph_hash: hash(g),
      reading_token: identityConfirmReadingToken(changed) })).toMatchObject({ kind: 'refused', reason: 'reading_not_confirmed' });
  });

});
