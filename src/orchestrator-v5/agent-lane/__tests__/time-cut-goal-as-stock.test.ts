/** S4 §(ai), deterministic admission → the real S4 Run handler harness. PLoT draws use ISL's stated formula. */
import { describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { goalHorizonVerdict } from '../../goal-target/goal-horizon-verdict.js';
import { goalChanceLicenceOf } from '../../goal-target/goal-chance-licence.js';
import { evaluatedIdentityCarriers } from '../../admission/identity-evaluations.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { withGoalLevelInGoalUnits } from '../goal-level-in-goal-units.js';
import { accumulationOptionScopes, admitAccumulationIdentities } from '../accumulation-identity.js';
import { buildModelFromBrief } from '../runtime/build-model.js';
import type { CandidateModel } from '../admit-model.js';
import minimalFixture from '../../../../tests/fixtures/plot/v2-run-golden-minimal.json';

import { commitOptionLevelsInProcess } from '../../system-events/dispatch.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyIdentityConfirmEdit, identityConfirmReadingToken, identityConfirmPostimageIsScoped } from '../../system-events/identity-confirm-edit.js';
import { createAgentCapabilities } from '../runtime/agent-capabilities.js';
import { proposeProductIdentity } from '../identity-proposal.js';
import { ProposalStore } from '../proposal.js';
import { approvalChipsFor } from '../approval-chips.js';
import { composeReplyShape } from '../reply/compose-reply.js';
import { readScenarioAnalysis } from '../../../routes/scenario-graph-analysis-read.js';
import { projectCanonicalAnalysisCells } from '../../../routes/canonical-analysis-view.js';
import { buildAnalysisResultBlock } from '../../compose.js';
import { goalChanceFactsForAgent } from '../../goal-target/goal-chance-range-agent.js';
import { buildCandidateSchema, strictForTheDrafter } from '../runtime/build-model.js';

const memory = vi.hoisted(() => ({ graph: null as any, rows: [] as any[], run: null as any }));
vi.mock('../../session/index.js', async original => ({
  ...(await original<typeof import('../../session/index.js')>()),
  getSessionStore: () => ({
    loadGraph: async () => memory.graph,
    loadGraphAndBriefText: async () => ({ graph: memory.graph, briefText: null }),
    readMostRecentPendingActions: async () => [], readFactsFor: async () => [],
    readRecent: async () => memory.rows.map((write, i) => ({ id: `row-${i + 1}`, scenario_id: write.scenario_id,
      turn_id: write.turn_id, turn_class: write.turn_class, handler_id: write.handler_id, request_hash: write.request_hash,
      response_emitted: write.response_emitted, llm_calls_used: write.llm_calls_used, duration_ms: write.duration_ms,
      assistant_message: write.assistantMessage ?? null, created_at: '2026-10-09T00:00:00.000Z' })).reverse(),
    readFactsWithTurnFor: async (ids: string[]) => memory.rows.flatMap((write, i) => ids.includes(`row-${i + 1}`)
      ? (write.handler_facts ?? []).map((fact: any) => ({ turn_id: `row-${i + 1}`, fact_created_at: '2026-10-09T00:00:00.000Z', fact })) : []), readAnalysisInvalidatedAt: async () => null,
    readNewestRunDeliveryFor: async () => null,
    readScenarioRunAnalysisFactsFor: async () => ({ facts: memory.run === null ? [] : [{ fact: memory.run,
      fact_row_id: 'run-row', fact_created_at: memory.run.result.computed_at }], total_count: memory.run === null ? 0 : 1 }),
    append: async (write: any) => { memory.rows.push(structuredClone(write));
      if (write.graph !== undefined) memory.graph = write.graph; return { id: `row-${memory.rows.length}` }; },
    getScenarioOwner: async () => null, ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' }, entries_invalidated: [] }),
  }),
}));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => { throw new Error('LLM calls are forbidden in this harness'); },
  getAdapterWithResolution: () => { throw new Error('LLM calls are forbidden in this harness'); },
  getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../utils/telemetry.js', async original => ({
  ...(await original<typeof import('../../../utils/telemetry.js')>()),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type Rec = Record<string, any>;
const SCENARIO = '62626262-6262-4626-8626-626262626262';
const BRIEF = 'MRR is £120,000 a month today, with a net change of £2,000 each month. Our goal is £150,000 MRR within 9 months. '
  + 'Keep the price at £49 or raise it to £59. Each £10 price rise adds £5,000 MRR a month.';
const REFUSAL = 'it needs exactly three quantities: the level today, the rate lost each month and the amount added each month';
const goalOf = (g: Rec): Rec => g.nodes.find((n: Rec) => n.kind === 'goal');
const carrierOf = (g: Rec): Rec => g.nodes.find((n: Rec) => n.nonlinear_identity?.operation === 'accumulation');
const zeroOf = (g: Rec): Rec => g.nodes.find((n: Rec) => n.id === carrierOf(g).nonlinear_identity.factor_ids[1]);

function candidate(reading: 'net' | 'gross' | undefined, explicit = true): CandidateModel {
  return {
    goal: { metric: 'MRR', operator: '>=', target_stated: true, value: 150000, unit: 'GBP/month', horizon_months: 9,
      provenance: 'explicit', baseline_known: true, baseline_value: 120000, baseline_provenance: 'explicit', scope: null },
    constraints: [], options: [
      { label: 'Keep price', provenance: 'explicit', is_status_quo: true, changes: [],
        interventions: [{ factor_label: 'Price', value: 49, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
      { label: 'Raise price', provenance: 'explicit', is_status_quo: false, changes: ['Price'],
        interventions: [{ factor_label: 'Price', value: 59, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
    ], factors: [
      { label: 'MRR today', role: 'external', baseline_known: true, baseline_value: 120000, unit: 'GBP/month', provenance: 'explicit', plausible_max: 300000 },
      { label: 'Monthly change', role: 'external', baseline_known: true, baseline_value: 2000, unit: 'GBP/month', provenance: 'explicit', plausible_max: 10000 },
      { label: 'Price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 100 },
    ], risks: [], outcomes: [], unknowns: [], links: [
      ...['MRR today', 'Monthly change'].map(from => ({ from, to: 'MRR', direction: 'positive', provenance: 'inferred',
        effect_amount: null, effect_per_source_change: null, effect_provenance: null })),
      { from: 'Price', to: 'MRR', direction: 'positive', provenance: 'explicit',
        effect_amount: 5000, effect_amount_unit: 'GBP/month', effect_per_source_change: 10,
        effect_per_source_change_unit: 'GBP', effect_provenance: 'explicit' },
    ], identities: [{ outcome: 'MRR', operation: 'accumulation', factors: ['MRR today', 'Monthly change'],
      provenance: explicit ? 'explicit' : 'inferred', ...(reading !== undefined ? { reading } : {}) }],
  };
}

async function build(reading: 'net' | 'gross' | undefined, explicit = true, change = 2000): Promise<{ graph: Rec; result: Rec }> {
  const c = candidate(reading, explicit);
  (c.factors[1] as Rec).baseline_value = change;
  let stored: Rec | undefined;
  const result = await buildModelFromBrief(SCENARIO, BRIEF, async (path, body) => {
    if (path.endsWith('/graph/register')) {
      stored = GraphV3.parse((body as Rec).graph);
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }, async () => ({ text: JSON.stringify(c) })) as Rec;
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(stored).toBeDefined();
  return { graph: stored!, result };
}
function ratify(g: Rec): Rec {
  const graph = structuredClone(g);
  zeroOf(graph).observed_state.source = 'user_confirmed';
  return graph;
}

/** The S4 harness: load the actual snapshot, dispatch through createRunAnalysisHandler, collect its actual Run fact. */
async function run(graph: Rec): Promise<{ fact: Rec; payload: Rec; draws: Rec[]; envelope: Rec }> {
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-ai-load', {
    readMostRecentPendingActions: async () => [], loadGraphAndBriefText: async () => ({ graph: structuredClone(graph), briefText: BRIEF }),
    loadGraph: async () => structuredClone(graph),
  } as never);
  let payload!: Rec;
  let draws!: Rec[];
  let envelope!: Rec;
  const plotRun = vi.fn(async (sent: unknown) => {
    payload = sent as Rec;
    const g = payload.graph;
    const byId = new Map<string, Rec>(g.nodes.map((n: Rec) => [n.id, n]));
    const level = (id: string, interventions: Rec): number => {
      const n = byId.get(id)!;
      const v = interventions[id];
      return (typeof v === 'number' ? v : n.observed_state?.raw_value ?? n.observed_state?.value ?? 0);
    };
    const goal = byId.get(payload.goal_node_id)!;
    const carrier = g.nodes.find((n: Rec) => n.nonlinear_identity?.operation === 'accumulation');
    const identity = carrier?.nonlinear_identity;
    const tuple = identity?.factor_ids ?? [];
    // Outbound values are raw units. ISL holds S0 exact and multiplies each rate by exp(σz).
    draws = [-1.2816, 0, 1.2816].map(z => ({ z,
      stock: identity ? level(tuple[0], {}) : 120000,
      rate: identity ? level(tuple[1], {}) * Math.exp(identity.rate_sigma_log[0] * z) : 0,
      inflow: identity ? level(tuple[2], {}) * Math.exp(identity.rate_sigma_log[1] * z) : 2000,
    }));
    const price = g.nodes.find((n: Rec) => n.label === 'Price');
    const values = payload.options.map((option: Rec) => draws.map(draw => {
      const c = draw.rate * (identity?.rate_scale ?? 0.01);
      const H = identity?.horizon_months ?? 0;
      const SH = Math.abs(c) < 1e-9 ? draw.stock + draw.inflow * H
        : draw.stock * (1 - c) ** H + draw.inflow * (1 - (1 - c) ** H) / c;
      const held = goal.observed_state?.raw_value ?? goal.observed_state?.value;
      // ISL sum with a held level is o + (term - term_sq) + (L - L_sq); without it, term + L.
      const anchor = held === undefined ? SH : held;
      return anchor + (level(price.id, option.interventions) - level(price.id, {})) * 500;
    }));
    envelope = { ...structuredClone(minimalFixture), inference_warnings: [],
      results: payload.options.map((option: Rec, i: number) => ({ option_id: option.id ?? option.option_id,
        option_label: option.label, win_probability: i === 0 ? 0.4 : 0.6 })),
      option_comparison: payload.options.map((option: Rec, i: number) => ({ option_id: option.id ?? option.option_id,
        option_label: option.label, win_probability: i === 0 ? 0.4 : 0.6, probability_of_goal: 0.4 + i * 0.1,
        outcome: { p10: values[i][0], p50: values[i][1], p90: values[i][2], mean: values[i][1], std: 2000,
          n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1, percentiles_source: 'samples' } })),
      identity_evaluations: g.nodes.filter((n: Rec) => n.nonlinear_identity).map((n: Rec) => ({
        node_id: n.id, ...n.nonlinear_identity, evaluated: true, ...(n.kind === 'goal' ? { level_source: 'identity_inputs' } : {}),
      })),
    };
    return envelope as V2RunResponseEnvelope;
  });
  const handler = createRunAnalysisHandler({ plotClient: { run: plotRun, validatePatch: vi.fn().mockResolvedValue({}) } as PLoTClient,
    scenarioReader: async () => snapshot });
  const outcome = await handler({ payload: { scenario_id: SCENARIO, turn_id: 't-ai-producer' }, requestId: 'req-ai-run',
    signal: new AbortController().signal, context: {}, orientationText: '' } as HandlerInvocation);
  expect(plotRun).toHaveBeenCalledOnce();
  const fact = outcome.handler_facts.find((f: Rec) => f.fact_type === 'run_analysis') as Rec;
  expect(fact).toBeDefined();
  return { fact, payload, draws, envelope };
}

describe('S4 time cut Q1 + Q2 through real admission and real Run', () => {
  it('R1 admits a typed unary goal carrier at the held month and computes at H after confirmation', async () => {
    const { graph } = await build('net');
    const carrier = carrierOf(graph);
    expect(carrier).toMatchObject({ kind: 'outcome', label: 'MRR at month 9', scale_frame: expect.any(Number) });
    expect(carrier.scale_frame).toBeGreaterThan(0);
    expect(goalOf(graph).nonlinear_identity).toEqual({ operation: 'sum', factor_ids: [carrier.id], stated_in_brief: true });
    expect(graph.edges.find((e: Rec) => e.from === carrier.id && e.to === goalOf(graph).id)).toMatchObject({ exists_probability: 1 });
    const confirmed = ratify(graph);
    const { fact } = await run(confirmed);
    expect(goalHorizonVerdict(confirmed, fact.result.enrichment)).toBe('computed_at_h');
  });
  it('R2 anchors Keep at SH = 138000 and applies only each option’s own post-horizon effect', async () => {
    const { graph } = await build('net');
    expect(goalOf(graph)).not.toHaveProperty('observed_state');
    const { envelope, payload } = await run(ratify(graph));
    expect(goalOf(payload.graph)).not.toHaveProperty('observed_state');
    expect(envelope.option_comparison.map((r: Rec) => r.outcome.p50)).toEqual([138000, 143000]);
  });
  it('R3 mutating the definitional 1:1 edge strength leaves figures byte-identical', async () => {
    const graph = ratify((await build('net')).graph);
    const original = await run(graph);
    const edge = graph.edges.find((e: Rec) => e.from === carrierOf(graph).id && e.to === goalOf(graph).id);
    edge.strength = { mean: -0.37, std: 0.93 };
    const mutated = await run(graph);
    expect(JSON.stringify(mutated.envelope.option_comparison)).toBe(JSON.stringify(original.envelope.option_comparison));
  });
  it('R4 sends [stock, zero rate, change], keeps zero exact at both sigmas, spreads I and holds S0 exact', async () => {
    const { graph } = await build('net');
    for (const g of [graph, ratify(graph)]) {
      const { payload, draws } = await run(g);
      const carrier = carrierOf(payload.graph);
      const zero = zeroOf(payload.graph);
      expect(carrier.nonlinear_identity.factor_ids).toHaveLength(3);
      expect(zero.observed_state).toMatchObject({ value: 0, raw_value: 0, unit: '%' });
      expect(carrier.nonlinear_identity.rate_sigma_log).toEqual([g === graph ? 0.246 : 0.136, 0.136]);
      expect(draws.map(d => d.rate)).toEqual([0, 0, 0]);
      expect(draws.map(d => d.stock)).toEqual([120000, 120000, 120000]);
      expect(new Set(draws.map(d => d.inflow)).size).toBe(3);
      expect(JSON.stringify(payload.graph)).not.toContain('"reading"');
    }
  });
  it.each(['gross', undefined] as const)('R5 %s with two inputs refuses with the unchanged text and withholds the goal', async reading => {
    // Pass undefined through candidate explicitly: build's default only applies to omitted arguments.
    const { graph, result } = await build(reading === undefined ? undefined : reading);
    expect(carrierOf(graph)).toBeUndefined();
    expect(JSON.stringify(result)).toContain(REFUSAL);
    const { fact } = await run(graph);
    expect(fact.result.enrichment.inference_warnings).toContainEqual(expect.objectContaining({ code: 'GOAL_FIGURES_HORIZON_NOT_TESTED' }));
    expect(fact.result.enrichment.option_comparison.every((r: Rec) => r.probability_of_goal === undefined)).toBe(true);
  });
  it('R6 inference zero earns no chance; the same source-ratified graph is licensed', async () => {
    const graph = (await build('net')).graph;
    const inferred = await run(graph);
    expect(zeroOf(graph).observed_state.source).toBe('cee_inference');
    expect(evaluatedIdentityCarriers(graph.nodes, inferred.envelope.identity_evaluations).has(carrierOf(graph).id)).toBe(false);
    expect(inferred.fact.result.enrichment.option_comparison.every((r: Rec) => r.probability_of_goal === undefined)).toBe(true);
    const confirmed = ratify(graph);
    const licensed = await run(confirmed);
    expect(evaluatedIdentityCarriers(confirmed.nodes, licensed.envelope.identity_evaluations).has(carrierOf(confirmed).id)).toBe(true);
    expect(targetTestabilityOf(confirmed, licensed.envelope.identity_evaluations).kind).not.toBe('not_testable');
    expect(licensed.fact.result.enrichment.option_comparison.map((r: Rec) => r.probability_of_goal)).toEqual([0.4, 0.5]);
    expect(Object.keys(goalChanceLicenceOf(licensed.fact.result.enrichment, confirmed, goalOf(confirmed).id)!.pct_by_option)).toHaveLength(2);
  });
  it('R7 D5 follows inflow parents over the final submitted options; post-horizon-only options record true', async () => {
    const graph = ratify((await build('net')).graph);
    const post = await run(graph);
    const scopes = (g: Rec, r: { payload: Rec }) => accumulationOptionScopes(g.nodes, g.edges, r.payload.options, 'h');
    expect(scopes(post.payload.graph, post)).toEqual([{ graph_hash: 'h', carrier_id: carrierOf(graph).id, horizon_months: 9,
      sameForEveryOption: true }]);
    const price = graph.nodes.find((n: Rec) => n.label === 'Price');
    const inflowId = carrierOf(graph).nonlinear_identity.factor_ids[2];
    graph.edges.push({ from: price.id, to: inflowId, exists_probability: 1, strength: { mean: 0.1, std: 0.01 },
      effect_direction: 'positive', provenance: { source: 'user_specified' } });
    const upstream = await run(graph);
    expect(upstream.payload.options.some((o: Rec) => Object.keys(o.interventions).includes(price.id))).toBe(true);
    expect(scopes(upstream.payload.graph, upstream)[0]).toMatchObject({ sameForEveryOption: false,
      carrier_id: carrierOf(graph).id, horizon_months: 9 });
  });
  it('a proposed goal identity remains unconfirmed even after the zero’s source is ratified', async () => {
    const graph = ratify((await build('net', false)).graph);
    expect(goalOf(graph).nonlinear_identity.stated_in_brief).toBe(false);
    const { fact } = await run(graph);
    expect(fact.result.enrichment.option_comparison.every((r: Rec) => r.probability_of_goal === undefined)).toBe(true);
  });
  it('a negative net change retains the existing nonnegative-input refusal', async () => {
    const graph = (await build('net')).graph;
    const carrier = carrierOf(graph);
    const stock = graph.nodes.find((n: Rec) => n.id === carrier.nonlinear_identity.factor_ids[0]);
    const change = graph.nodes.find((n: Rec) => n.id === carrier.nonlinear_identity.factor_ids[2]);
    const goal: Rec = { ...goalOf(graph), nonlinear_identity: undefined };
    const rejected = admitAccumulationIdentities([goal, stock, { ...change,
      observed_state: { ...change.observed_state, value: -2000, raw_value: -2000 } }],
      [{ from: stock.id, to: goal.id }, { from: change.id, to: goal.id }],
      [{ outcome: goal.label, operation: 'accumulation', reading: 'net', factors: [stock.label, change.label], provenance: 'explicit' }]);
    expect(rejected.carriers.size).toBe(0);
    expect(rejected.loss[0].reason).toContain('its levels today are outside what a count, a monthly rate and a monthly amount can be');
    expect(rejected.addedNodes).toEqual([]);
  });
  it('an ISL derived-horizon warning never calls the unary goal level today', async () => {
    const graph = (await build('net')).graph;
    const envelope = { inference_warnings: [{ code: 'GOAL_LEVEL_FROM_IDENTITY_INPUTS', node_id: goalOf(graph).id,
      message: 'The goal uses the level its inputs give today: 138,000.00 in its own units;' }] };
    const result = withGoalLevelInGoalUnits(envelope, graph);
    expect(result.inference_warnings[0].message).toBe('The goal uses the level its inputs give at month 9: £138,000 a month;');
    expect(result.inference_warnings[0].message).not.toContain('today');
  });
  it('the unary schema arm is limited to the goal’s accumulation operand at H', async () => {
    const graph = (await build('net')).graph;
    for (const mutate of [
      (g: Rec) => { goalOf(g).kind = 'factor'; },
      (g: Rec) => { carrierOf(g).nonlinear_identity.horizon_months = 8; },
      (g: Rec) => { goalOf(g).nonlinear_identity.factor_ids = [zeroOf(g).id]; },
    ]) {
      const other = structuredClone(graph); const id = goalOf(other).id; mutate(other);
      expect(GraphV3.parse(other).nodes.find(n => n.id === id)?.nonlinear_identity).toBeUndefined();
    }
  });
});

const FACE = 'Worked out month by month to month 9';
const WHY = "Starts from today's £120,000 a month and adds £2,000 each month (Olumi read that as the change after any losses), give or take about a quarter, up to month 9, the same for every option. Each option then changes ‘Price’ from there.";
const NET = 'Olumi read ‘+£2,000 a month’ as the change after any losses.';

/** Issue and press the existing card; its writer is the actual CAS/append commit door. */
async function press(graph: Rec): Promise<Rec> {
  memory.graph = structuredClone(graph); memory.rows = []; memory.run = null;
  const proposals = new ProposalStore();
  const capabilities = createAgentCapabilities(async path => {
    expect(path).toMatch(/\/graph$/);
    return { status: 200, json: { graph: memory.graph,
      graph_hash: computeAnalysisAffectingGraphHash(memory.graph as never) } };
  }, proposals, undefined, 'full', undefined, { commitOptionLevels: input => commitOptionLevelsInProcess(input, 'req-time-confirm') });
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'req-time-card', user_text: '' };
  const offered = await capabilities.proposeIdentity!(ctx) as Rec;
  expect(offered.ok, JSON.stringify(offered)).toBe(true);
  expect(offered.card.words).toBe(`Olumi reads ‘MRR’ as ‘MRR at month 9’. ${NET} Is that how you work it out?`);
  const chips = approvalChipsFor([{ name: 'propose_identity', ok: true, mutated: false, proposal_id: offered.proposal_id }],
    id => ({ proposal: proposals.get(id), result: offered as never }))[0];
  expect(chips!.label).toBe('Yes, calculate it that way');
  expect(approvalChipsFor([{ name: 'propose_identity', ok: true, mutated: false, proposal_id: offered.proposal_id }],
    id => ({ proposal: proposals.get(id), result: offered as never }))[1]?.label).toBe('Change something first');
  const approved = await capabilities.authoriseChange({ ...ctx, typed_approval_of: offered.proposal_id,
    typed_approval_words: chips!.message }, { proposal_id: offered.proposal_id }) as Rec;
  expect(approved.applied, JSON.stringify(approved)).toBe(true);
  expect(memory.rows).toHaveLength(1);
  expect(identityConfirmPostimageIsScoped(graph, memory.graph, goalOf(graph).id)).toBe(true);
  return structuredClone(memory.graph);
}

describe('slices B + C through the existing card, Run and canonical read', () => {
  it('B1 declares reading in the schema-to-candidate path and preserves the goal carrier through the real build', async () => {
    const schema = buildCandidateSchema() as Rec;
    const items = schema.properties.identities.items;
    expect(items.properties.reading).toEqual({ anyOf: [{ type: 'string', enum: ['net', 'gross'] }, { type: 'null' }] });
    expect(items.required).not.toContain('reading');
    const { graph } = await build('net');
    expect(goalOf(graph).nonlinear_identity.factor_ids).toEqual([carrierOf(graph).id]);
    expect(zeroOf(graph).observed_state.source).toBe('cee_inference');
    expect((strictForTheDrafter(schema) as Rec).properties.identities.items.properties.reading).toEqual(items.properties.reading);
  });
  it('B2 press ratifies the goal and net zero, credits the carrier, and licenses every real scored option', async () => {
    const graph = (await build('net', false)).graph;
    const before = await run(graph);
    expect(before.fact.result.enrichment.option_comparison.every((r: Rec) => r.probability_of_goal === undefined)).toBe(true);
    const confirmed = await press(graph);
    expect(goalOf(confirmed).nonlinear_identity.stated_in_brief).toBe(true);
    expect(zeroOf(confirmed).observed_state.source).toBe('user_confirmed');
    const { fact, envelope } = await run(confirmed);
    expect(evaluatedIdentityCarriers(confirmed.nodes, envelope.identity_evaluations).has(carrierOf(confirmed).id)).toBe(true);
    expect(goalHorizonVerdict(confirmed, fact.result.enrichment)).toBe('computed_at_h');
    expect(Object.keys(goalChanceLicenceOf(fact.result.enrichment, confirmed, goalOf(confirmed).id)!.pct_by_option))
      .toHaveLength(fact.result.enrichment.option_comparison.length);
    // Control for the door-source mutant: the confirmed identity alone cannot earn credit.
    zeroOf(confirmed).observed_state.source = 'cee_inference';
    expect((await run(confirmed)).fact.result.enrichment.option_comparison.every((r: Rec) => r.probability_of_goal === undefined)).toBe(true);
  });
  it('B2 a stated unary goal still offers its net reading until the zero is confirmed; postimage bars every other change', async () => {
    const graph = (await build('net')).graph;
    const confirmed = await press(graph);
    const drift = structuredClone(confirmed);
    drift.edges[0].exists_probability = .123;
    expect(identityConfirmPostimageIsScoped(graph, drift, goalOf(graph).id)).toBe(false);
    const missingSource = structuredClone(confirmed);
    zeroOf(missingSource).observed_state.source = 'cee_inference';
    expect(identityConfirmPostimageIsScoped(graph, missingSource, goalOf(graph).id)).toBe(false);
  });
  it('C exact graph-derived words appear once on each reply surface and survive the canonical stored-Run read', async () => {
    const graph = await press((await build('net', false)).graph);
    const { fact } = await run(graph);
    const warnings = fact.result.enrichment.inference_warnings;
    expect(warnings.filter((w: Rec) => w.code === 'GOAL_HORIZON_STEADY_ATTESTED').map((w: Rec) => w.message)).toEqual([WHY]);
    const result = buildAnalysisResultBlock(fact as never);
    const cells = projectCanonicalAnalysisCells(result, graph).map(row => row.cell);
    const reply = composeReplyShape({ text: 'Your results are ready.', faceContract: 'run', graph,
      analysisResult: result, chanceCells: cells });
    expect(reply.shape, JSON.stringify({ reply, cells, result })).not.toBeNull();
    const face = JSON.stringify({ headline: reply.shape!.headline, bullets: reply.shape!.bullets });
    expect(face.split(FACE)).toHaveLength(2);
    expect(reply.shape!.detail!.split(WHY)).toHaveLength(2);
    expect(reply.text.split(FACE)).toHaveLength(2);
    expect(reply.text.split(WHY)).toHaveLength(2);
    expect(reply.text).not.toContain("This model doesn't yet say");
    // The existing A7/horizon producer must remain silent on this computed method.
    const { untestedHorizonLineForCells } = await import('../decision-input-ask.js');
    expect(untestedHorizonLineForCells(graph, cells)).toBeNull();
    memory.run = JSON.parse(JSON.stringify(fact));
    const cold = await readScenarioAnalysis({ scenarioId: SCENARIO, graph: graph as never, requestId: 'req-time-reload' });
    expect(cold.analysis_state.run_state.kind).toBe('complete_current');
    expect(goalChanceFactsForAgent(cold.analysis_result, graph, true).goal_horizon_line).toBe(WHY);
    expect(JSON.stringify(cold.analysis_result).split(WHY)).toHaveLength(2);
  });
  it('C option scope toggles from stored submitted options; different intervened factors omit the final sentence', async () => {
    const graph = await press((await build('net', false)).graph);
    const price = graph.nodes.find((n: Rec) => n.label === 'Price');
    const inflow = carrierOf(graph).nonlinear_identity.factor_ids[2];
    graph.edges.push({ from: price.id, to: inflow, exists_probability: 1, strength: { mean: .1, std: .01 }, effect_direction: 'positive' });
    const { fact } = await run(graph);
    const line = goalChanceFactsForAgent(buildAnalysisResultBlock(fact as never), graph, true).goal_horizon_line;
    expect(line).toBe(WHY.replace(', the same for every option', ''));
    // Stored submitted settings, not options remaining on today's graph, choose the scope.
    const altered = structuredClone(fact.result.input_snapshot);
    altered.options[1].settings.push({ factor_id: inflow, encoded: 2000 });
    const { goalStockMethodWhyLine, submittedOptionsForMethod } = await import('../../goal-target/goal-horizon-detail.js');
    expect(goalStockMethodWhyLine(graph, submittedOptionsForMethod({ input_snapshot: altered })))
      .toBe(WHY.replace(', the same for every option', '').replace(' Each option then changes ‘Price’ from there.', ''));
  });
});

it('C the net parenthesis is absent without the slice-A net-zero node', async () => {
  const graph = ratify((await build('net')).graph);
  const { goalStockMethodWhyLine } = await import('../../goal-target/goal-horizon-detail.js');
  const price = graph.nodes.find((n: Rec) => n.label === 'Price');
  const zero = zeroOf(graph); const previous = zero.id;
  zero.id = 'explicit-loss-rate';
  carrierOf(graph).nonlinear_identity.factor_ids[1] = zero.id;
  for (const edge of graph.edges) { if (edge.from === previous) edge.from = zero.id; if (edge.to === previous) edge.to = zero.id; }
  expect(goalStockMethodWhyLine(graph, [{ interventions: { [price.id]: 59 } }]))
    .toBe(WHY.replace(' (Olumi read that as the change after any losses)', ''));
});

it('B2 the identity door postimage itself licenses the real Run only after its zero source is written', async () => {
  const graph = (await build('net', false)).graph;
  const card = proposeProductIdentity(graph)!;
  const written = applyIdentityConfirmEdit({ ...card, persistedGraph: graph,
    expected_graph_hash: computeAnalysisAffectingGraphHash(graph as never)!, reading_token: identityConfirmReadingToken(card) });
  expect(written.kind).toBe('mutated');
  if (written.kind !== 'mutated') return;
  const postimage = written.mutatedGraph as Rec;
  const { fact } = await run(postimage);
  expect(goalHorizonVerdict(postimage, fact.result.enrichment)).toBe('computed_at_h');
  expect(fact.result.enrichment.option_comparison.every((r: Rec) => r.probability_of_goal !== undefined)).toBe(true);
});
