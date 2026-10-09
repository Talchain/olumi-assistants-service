/** B2 producer-c: real read B → handler → both commit paths → RPC fact element; no providers. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RunAnalysisHandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import type { PLoTClient } from '../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../orchestrator/types.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { SessionLRUCache } from '../session/cache.js';
import { SupabaseSessionStore } from '../session/supabase-store.js';
import type { SessionStore, SessionTurnWrite } from '../session/store.js';
import type { HandlerOutcome, HandlerRegistry } from '../tools/registry.js';
import { makeMessagePayload } from './fixtures.js';
import { withholdOptionGoalFigures } from '../../orchestrator/context/constraint-feasibility.js';
import { GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED } from '../../orchestrator/context/option-result-source.js';
import { _resetConfigCache } from '../../config/index.js';

const holder: { current: SessionStore } = { current: createNoopSessionStore() };
vi.mock('../session/index.js', () => ({ getSessionStore: () => holder.current, resetSessionStoreForTests: () => {} }));
const { loadScenarioSnapshotForRunAnalysis } = await import('../build-turn-context.js');
const { createRunAnalysisHandler } = await import('../tools/handlers/run-analysis.js');
const { runTurnExecutor } = await import('../turn-executor.js');
const { dispatchChipClickRunAnalysis } = await import('../handlers/chip-click-dispatch.js');
const { computeAnalysisAffectingGraphHash } = await import('../context/graph-hash.js');
const { buildAnalysisRefusalFact } = await import('../context/analysis-refusal-continuity.js');
const { runWithBoundAnalysisSnapshot, AnalysisSnapshotDivergedError } = await import('../run-analysis-snapshot-binding.js');

type Rec = Record<string, any>;
type Element = { handler_id: string; payload: Rec; evaluated_scenario_revision?: number };
const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tm = { node_id: 'f', match_type: 'exact_id', confidence: 'high' };
function graphAt(value = 0.6) {
  return {
    nodes: [
      { id: 'g', kind: 'goal', label: 'Growth' },
      { id: 'd', kind: 'decision', label: 'Growth plan' },
      { id: 'a', kind: 'option', label: 'Expand', interventions: { f: { value, source: 'user_specified', target_match: tm } } },
      { id: 'b', kind: 'option', label: 'Maintain', interventions: { f: { value: 0.4, source: 'user_specified', target_match: tm } } },
      { id: 'f', kind: 'factor', label: 'Capacity', category: 'controllable', observed_state: { value: 0.5 } },
    ],
    edges: [['d', 'a'], ['d', 'b'], ['a', 'f'], ['b', 'f'], ['f', 'g']].map(([from, to]) => ({
      from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive',
    })),
  };
}
function serialisingStore() {
  const calls: Rec[] = [];
  const client = { rpc: vi.fn(async (_fn: string, args: Rec) => {
    calls.push(args); return { data: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', error: null };
  }) } as unknown as SupabaseClient;
  const store = new SupabaseSessionStore(client, new SessionLRUCache({ maxScenarios: 10, maxTurnsPerScenario: 20 }), { defaultReadLimit: 20 });
  return { store, calls };
}
function harness(opts: { revision?: number; legacy?: boolean; status?: string; editDuringAnalysis?: boolean; divergence?: boolean; withheld?: boolean } = {}) {
  let revision: number | undefined = opts.legacy ? undefined : opts.revision ?? 41;
  let graph = graphAt();
  const originalHash = computeAnalysisAffectingGraphHash(graph);
  const writes: SessionTurnWrite[] = [];
  const outcomes: HandlerOutcome[] = [];
  const snapshots: Rec[] = [];
  const serial = serialisingStore();
  const reads: Array<{ revision: number | undefined; graph: unknown }> = [];
  const base = createNoopSessionStore();
  const store: SessionStore = {
    ...base,
    loadGraph: async () => structuredClone(graph),
    loadGraphAndBriefText: async () => {
      reads.push({ revision, graph: structuredClone(graph) });
      return { graph: structuredClone(graph), briefText: null, ...(revision !== undefined ? { revision } : {}) };
    },
    append: async (w) => { writes.push(w); return serial.store.append(w); },
  };
  holder.current = store;
  const plotClient = { validatePatch: vi.fn(), run: vi.fn(async (body: Rec) => {
    if (opts.editDuringAnalysis !== false) {
      // A concurrent ANALYSIS-AFFECTING committed edit while PLoT is in flight.
      graph = graphAt(0.8); revision = 42;
      expect(computeAnalysisAffectingGraphHash(graph)).not.toBe(originalHash);
    }
    const response = {
      meta: { seed_used: 1, n_samples: 100, response_hash: 'sha256:b2' },
      results: body.options.map((o: Rec, i: number) => ({ option_id: o.option_id, option_label: o.label, win_probability: i === 0 ? 0.6 : 0.4 })),
      response_hash: 'sha256:b2', analysis_status: opts.status ?? 'completed',
    } as V2RunResponseEnvelope;
    return opts.withheld ? withholdOptionGoalFigures(response, new Set(['a', 'b']), {
      code: GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED, severity: 'warning', message: 'Identity not evaluated',
      option_ids: ['a', 'b'], node_ids: ['g'],
    }) : response;
  }) } as unknown as PLoTClient;
  const handler = createRunAnalysisHandler({ plotClient, scenarioReader: async (id) => {
    if (opts.divergence) { graph = graphAt(0.8); revision = 42; }
    const snapshot = await loadScenarioSnapshotForRunAnalysis(id, 'b2', store);
    snapshots.push(snapshot); return snapshot;
  } });
  const registry: HandlerRegistry = new Map([['run_analysis', async (invocation) => {
    const outcome = await handler(invocation); outcomes.push(outcome); return outcome;
  }]]);
  const routingAdapter = { chatWithTools: vi.fn(async () => ({
    content: [{ type: 'tool_use', id: 'b2-route', name: 'olumi_action', input: {
      intent_class: 'execute', action: { handler_id: 'run_analysis',
        entity: { id: 'a', kind: 'option', resolution_status: 'resolved', resolution_method: 'id_match' },
        parameters: [], cited_context_fields: [] },
    } }], stopReason: 'tool_use', usage: { input_tokens: 10, output_tokens: 20 }, model: 'test', latencyMs: 1,
  })) };
  const run = async (path: 'routed' | 'chip', turn = '00000000-0000-4000-8000-000000000041') => {
    const payload = makeMessagePayload({ scenario_id: SCENARIO, turn_id: turn, stage: 'analyse', turn_class: 'decide', message: 'run analysis',
      ...(path === 'chip' ? { source: 'chip_click', chip: { action_type: 'run_analysis' } } : {}) });
    if (path === 'chip') return dispatchChipClickRunAnalysis({ payload, requestId: turn, handlerRegistry: registry });
    return runTurnExecutor(payload, turn, { routingAdapter: routingAdapter as never, handlerRegistry: registry, graphState: structuredClone(graph) as never });
  };
  return { run, store, writes, outcomes, snapshots, reads, plotClient, calls: serial.calls, currentRevision: () => revision };
}
function elements(h: { calls: Rec[] }): Element[] { return h.calls.flatMap((c) => c.p_handler_facts ?? []); }
function runElement(h: { calls: Rec[] }): Element {
  const element = elements(h).find((e) => typeof e.payload.result.run_id === 'string');
  expect(element, 'the real commit reaches serialiseHandlerFacts with a Run').toBeDefined();
  return element!;
}
function assertStrict(element: Element) {
  expect(RunAnalysisHandlerFactSchema.safeParse({ ...element.payload, noop: false }).success).toBe(true);
  expect(element.payload).not.toHaveProperty('evaluated_scenario_revision');
  expect(element.payload.result).not.toHaveProperty('evaluated_scenario_revision');
}
afterEach(() => { vi.restoreAllMocks(); _resetConfigCache(); });

describe('B2 frozen evaluated revision on the fact ROW', () => {
  it.each(['routed', 'chip'] as const)('DECISIVE %s: read B 41, affecting edit 42 during PLoT, row 41; rerun 42/new id', async (path) => {
    const h = harness();
    await h.run(path);
    const first = runElement(h);
    expect(h.currentRevision()).toBe(42);
    expect((await h.store.loadGraphAndBriefText(SCENARIO)).revision).toBe(42);
    expect(h.snapshots[0].evaluatedScenarioRevision).toBe(41);
    expect(first.evaluated_scenario_revision).toBe(41);
    expect(first.payload.result.graph_hash_at_run).toBe(computeAnalysisAffectingGraphHash(graphAt()));
    assertStrict(first);
    // SAME fact through the real serializer with and without the side carrier: payload bytes identical.
    const baseline = serialisingStore();
    await baseline.store.append({ ...h.writes[0], run_evaluated_revisions: undefined } as SessionTurnWrite);
    expect(JSON.stringify(first.payload)).toBe(JSON.stringify(runElement(baseline).payload));
    expect(runElement(baseline)).not.toHaveProperty('evaluated_scenario_revision');
    await h.run(path, '00000000-0000-4000-8000-000000000042');
    const second = elements(h).filter((e) => e.payload.result.run_id).at(-1)!;
    expect(second.evaluated_scenario_revision).toBe(42);
    expect(second.payload.result.run_id).not.toBe(first.payload.result.run_id);
  });

  it('strictness: the sibling carrier leaves the 0.82 fact/payload unchanged', async () => {
    const h = harness(); await h.run('chip');
    const row = runElement(h);
    assertStrict(row);
    expect(row.evaluated_scenario_revision).toBe(41);
  });

  it('legacy read B has no revision: omit the element key (DB contract → NULL)', async () => {
    const h = harness({ legacy: true }); await h.run('chip');
    expect(h.snapshots[0]).not.toHaveProperty('evaluatedScenarioRevision');
    expect(h.outcomes[0]).not.toHaveProperty('__run_evaluated_revision');
    expect(runElement(h)).not.toHaveProperty('evaluated_scenario_revision');
    assertStrict(runElement(h));
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('invalid read B revision %s is absent', async (revision) => {
    const h = harness({ revision, editDuringAnalysis: false }); await h.run('chip');
    expect(h.snapshots[0]).not.toHaveProperty('evaluatedScenarioRevision');
    expect(runElement(h)).not.toHaveProperty('evaluated_scenario_revision');
  });

  it('zero is a recorded revision, never confused with absence', async () => {
    const h = harness({ revision: 0 }); await h.run('chip');
    expect(runElement(h).evaluated_scenario_revision).toBe(0);
  });

  it('withheld figures still produce a Run stamped from the analysed snapshot', async () => {
    const h = harness({ withheld: true }); await h.run('chip');
    const row = runElement(h);
    expect(row.payload.result.leading_option_id).toBeNull();
    expect(row.payload.result).not.toHaveProperty('win_probabilities');
    expect(row.evaluated_scenario_revision).toBe(41); assertStrict(row);
  });

  it.each(['partial', 'unknown'])('usable %s Run keeps its snapshot stamp', async (status) => {
    const h = harness({ status }); await h.run('chip');
    expect(runElement(h).evaluated_scenario_revision).toBe(41); assertStrict(runElement(h));
  });

  it.each(['failed', 'blocked'])('%s PLoT status produces no Run element and no stamp', async (status) => {
    const h = harness({ status }); await h.run('chip');
    expect(h.plotClient.run).toHaveBeenCalledOnce();
    expect(h.outcomes).toHaveLength(0);
    for (const e of elements(h)) expect(e).not.toHaveProperty('evaluated_scenario_revision');
    expect(elements(h).some((e) => e.payload.result.run_id)).toBe(false);
  });

  it('read A/read B divergence uses the existing recovery, without a stamped element', async () => {
    const h = harness({ divergence: true }); const out = await h.run('routed') as Rec;
    expect(h.plotClient.run).not.toHaveBeenCalled();
    expect(out.telemetry.commit_performed).toBe(true);
    expect(out.telemetry.failure_type).toBeNull();
    expect(h.outcomes).toHaveLength(0);
    for (const e of elements(h)) expect(e).not.toHaveProperty('evaluated_scenario_revision');
    await expect(runWithBoundAnalysisSnapshot({ scenarioId: SCENARIO, analysisGraphHash: computeAnalysisAffectingGraphHash(graphAt()) },
      () => loadScenarioSnapshotForRunAnalysis(SCENARIO, 'divergence', h.store))).rejects.toBeInstanceOf(AnalysisSnapshotDivergedError);
  });

  it('two Runs in one write use their own ids; non-analysis/refusal/unmapped facts have no key', async () => {
    const h = harness(); await h.run('chip'); const fact = h.outcomes[0].handler_facts[0];
    const id = (fact.result as Rec).run_id as string;
    const second: HandlerFact = { ...fact, result: { ...fact.result, run_id: 'second-run' } } as HandlerFact;
    const unmapped: HandlerFact = { ...fact, result: { ...fact.result, run_id: 'unmapped-run' } } as HandlerFact;
    const refusal = buildAnalysisRefusalFact({ scenarioId: SCENARIO, reasonCode: 'analysis_blocked' });
    const nonAnalysis: HandlerFact = { fact_type: 'clarify', fact_version: 1, noop: false, result: { run_id: id } } as unknown as HandlerFact;
    const serial = serialisingStore();
    await serial.store.append({ ...h.writes[0], handler_facts: [fact, second, unmapped, nonAnalysis, refusal],
      run_evaluated_revisions: { [id]: 41, 'second-run': 42, undefined: 99 } } as SessionTurnWrite);
    const rows = elements(serial);
    expect(rows[0].evaluated_scenario_revision).toBe(41);
    expect(rows[1].evaluated_scenario_revision).toBe(42);
    for (const row of rows.slice(2)) expect(row).not.toHaveProperty('evaluated_scenario_revision');
    expect(refusal.result).not.toHaveProperty('run_id');
    assertStrict(rows[0]); assertStrict(rows[1]); assertStrict(rows[4]);
  });
});
