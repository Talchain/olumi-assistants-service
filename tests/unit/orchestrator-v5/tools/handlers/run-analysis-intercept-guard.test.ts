/**
 * Track S 0.13c-1 — `run_analysis` load-time intercept guard.
 *
 * Proves the seven required behaviours:
 *   1. duplicate observed-root intercept is stripped before PLoT;
 *   2. non-equal observed-root intercept is preserved;
 *   3. derived / non-root intercept is preserved;
 *   4. explicit zero intercept is preserved;
 *   5. the persisted graph (snapshot.graph + rawPersistedGraph) is unchanged;
 *   6. PLoT receives the repaired in-memory graph;
 *   7. telemetry/logging is redacted (IDs + counts only) and queryable.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { guardAnalysisGraphIntercepts } from '../../../../../src/orchestrator-v5/tools/handlers/run-analysis-intercept-guard.js';
import {
  createRunAnalysisHandler,
  type RunAnalysisScenarioSnapshot,
} from '../../../../../src/orchestrator-v5/tools/handlers/run-analysis.js';
import { setTestSink } from '../../../../../src/utils/telemetry.js';
import type { HandlerInvocation } from '../../../../../src/orchestrator-v5/tools/registry.js';
import type { PLoTClient } from '../../../../../src/orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../../src/orchestrator/types.js';

import minimalFixture from '../../../../fixtures/plot/v2-run-golden-minimal.json';

type TestNode = Record<string, unknown> & { id: string };
type TestGraph = { nodes: TestNode[]; edges: Array<Record<string, unknown>> };

/**
 * A graph exercising all four #263 dispositions:
 *   - fac_root_dup    : observed root, intercept === observed_state.value (≠0) → STRIPPED
 *   - fac_root_diff   : observed root, intercept ≠ observed_state.value         → PRESERVED
 *   - fac_root_zero   : observed root, intercept === 0                          → PRESERVED
 *   - fac_derived_dup : derived (causal parent), intercept === value           → PRESERVED
 * The `opt_x → fac_root_dup` edge proves option-source edges do NOT confer
 * derived-ness (PLoT strips option/decision nodes before ISL).
 */
function makeGraph(): TestGraph {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Goal' },
      { id: 'opt_x', kind: 'option', label: 'Option X' },
      { id: 'fac_root_dup', kind: 'factor', label: 'Root dup', observed_state: { value: 0.5 }, intercept: 0.5 },
      { id: 'fac_root_diff', kind: 'factor', label: 'Root diff', observed_state: { value: 0.5 }, intercept: 0.3 },
      { id: 'fac_root_zero', kind: 'factor', label: 'Root zero', observed_state: { value: 0.7 }, intercept: 0 },
      { id: 'fac_derived_dup', kind: 'factor', label: 'Derived dup', observed_state: { value: 0.4 }, intercept: 0.4 },
    ],
    edges: [
      // causal factor→factor edge makes fac_derived_dup a derived (non-root) node
      { from: 'fac_root_dup', to: 'fac_derived_dup', edge_type: 'directed' },
      // option→factor edge must NOT make fac_root_dup derived
      { from: 'opt_x', to: 'fac_root_dup', edge_type: 'directed' },
    ],
  };
}

const nodeById = (g: TestGraph, id: string): TestNode => {
  const n = g.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`node ${id} missing`);
  return n;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('guardAnalysisGraphIntercepts — #263 repair semantics on a clone', () => {
  it('1. strips a duplicate observed-root intercept (intercept === observed_state.value)', () => {
    const { graph, repairs } = guardAnalysisGraphIntercepts(makeGraph(), { requestId: 'req-1' });
    expect('intercept' in nodeById(graph, 'fac_root_dup')).toBe(false);
    expect(repairs.map((r) => r.node_id)).toEqual(['fac_root_dup']);
  });

  it('2. preserves a non-equal observed-root intercept', () => {
    const { graph } = guardAnalysisGraphIntercepts(makeGraph());
    expect(nodeById(graph, 'fac_root_diff').intercept).toBe(0.3);
  });

  it('3. preserves a derived (non-root) intercept even when it equals observed_state.value', () => {
    const { graph } = guardAnalysisGraphIntercepts(makeGraph());
    expect(nodeById(graph, 'fac_derived_dup').intercept).toBe(0.4);
  });

  it('4. preserves an explicit zero intercept', () => {
    const { graph } = guardAnalysisGraphIntercepts(makeGraph());
    expect(nodeById(graph, 'fac_root_zero').intercept).toBe(0);
  });

  it('5. does NOT mutate the input graph (operates on a clone)', () => {
    const input = makeGraph();
    guardAnalysisGraphIntercepts(input);
    expect(nodeById(input, 'fac_root_dup').intercept).toBe(0.5);
  });

  it('is a no-op (zero repairs) when no duplicate pattern is present', () => {
    const clean: TestGraph = {
      nodes: [{ id: 'fac_a', kind: 'factor', label: 'A', observed_state: { value: 0.2 } }],
      edges: [],
    };
    const { graph, repairs } = guardAnalysisGraphIntercepts(clean);
    expect(repairs).toHaveLength(0);
    // The clone is structurally identical to the input — nothing perturbed.
    expect(graph).toEqual(clean);
  });

  it('7. emits a redacted, queryable telemetry event (corrected_count + IDs only, no magnitudes)', () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    setTestSink((event, data) => events.push({ event, data }));
    try {
      guardAnalysisGraphIntercepts(makeGraph(), { requestId: 'req-7', scenarioId: 'sc-7' });
    } finally {
      setTestSink(null);
    }

    const summary = events.filter((e) => e.event === 'v5.run_analysis.intercept_guard');
    expect(summary).toHaveLength(1);
    const data = summary[0]!.data;
    expect(data).toMatchObject({
      request_id: 'req-7',
      scenario_id: 'sc-7',
      corrected_count: 1,
      node_ids: ['fac_root_dup'],
    });
    // Redaction: no observed magnitudes / before / after / value leak.
    for (const k of ['before', 'after', 'value', 'observed_state', 'observed_value', 'intercept']) {
      expect(data).not.toHaveProperty(k);
    }
  });
});

// ---------------------------------------------------------------------------
// Handler wiring — the guard is applied on the real run_analysis path.
// ---------------------------------------------------------------------------

function makeDupSnapshot(): RunAnalysisScenarioSnapshot {
  const legacyGraph = {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Goal' },
      { id: 'fac_root_dup', kind: 'factor', label: 'Root dup', observed_state: { value: 0.5 }, intercept: 0.5 },
    ],
    edges: [],
  };
  return {
    graph: JSON.parse(JSON.stringify(legacyGraph)),
    options: [{ id: 'opt_a', option_id: 'opt_a', label: 'A', interventions: { fac_root_dup: 1 } }],
    goal_node_id: 'goal_1',
    // raw persisted mirror — the freshness-hash source; must stay untouched
    rawPersistedGraph: JSON.parse(JSON.stringify(legacyGraph)),
  } as RunAnalysisScenarioSnapshot;
}

function makeInvocation(scenarioId: string): HandlerInvocation {
  return {
    payload: { scenario_id: scenarioId },
    requestId: 'req-handler',
    signal: new AbortController().signal,
    context: {},
    orientationText: '',
  } as unknown as HandlerInvocation;
}

const graphNode = (graph: unknown, id: string): Record<string, unknown> => {
  const nodes = (graph as { nodes: Array<Record<string, unknown>> }).nodes;
  const n = nodes.find((x) => x.id === id);
  if (!n) throw new Error(`node ${id} missing`);
  return n;
};

describe('run_analysis handler wiring (Track S 0.13c-1)', () => {
  it('6. sends PLoT the repaired graph; 5. leaves snapshot.graph + rawPersistedGraph unchanged', async () => {
    const snapshot = makeDupSnapshot();
    const runMock = vi.fn(
      async () => JSON.parse(JSON.stringify(minimalFixture)) as V2RunResponseEnvelope,
    );
    const plotClient = {
      run: runMock,
      validatePatch: vi.fn().mockResolvedValue({}),
    } as unknown as PLoTClient;

    const handler = createRunAnalysisHandler({
      plotClient,
      scenarioReader: async () => snapshot,
    });

    await handler(makeInvocation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));

    // 6 + 1 end-to-end: PLoT received the repaired graph (duplicate stripped).
    expect(runMock).toHaveBeenCalledTimes(1);
    const sentPayload = (runMock.mock.calls as Array<unknown[]>)[0]![0] as { graph: unknown };
    expect('intercept' in graphNode(sentPayload.graph, 'fac_root_dup')).toBe(false);

    // 5: the in-memory snapshot graph + raw persisted mirror are untouched —
    // the guard repaired a clone only; persisted state + freshness hash source
    // keep the legacy intercept (durable cleanup is the later migration).
    expect(graphNode(snapshot.graph, 'fac_root_dup').intercept).toBe(0.5);
    expect(graphNode(snapshot.rawPersistedGraph, 'fac_root_dup').intercept).toBe(0.5);
  });

  it('true-negative: clean graph → guard does not fire (0 corrections, no telemetry), PLoT gets the graph unchanged, run_analysis succeeds', async () => {
    // Clean observed root: no intercept at all → nothing to repair. Proves the
    // guard discriminates — a valid/current graph passes through untouched and
    // emits no correction telemetry (the false-positive direction).
    const cleanGraph = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Goal' },
        { id: 'fac_clean', kind: 'factor', label: 'Clean', observed_state: { value: 0.5 } },
      ],
      edges: [],
    };
    const snapshot = {
      graph: JSON.parse(JSON.stringify(cleanGraph)),
      options: [{ id: 'opt_a', option_id: 'opt_a', label: 'A', interventions: { fac_clean: 1 } }],
      goal_node_id: 'goal_1',
      rawPersistedGraph: JSON.parse(JSON.stringify(cleanGraph)),
    } as RunAnalysisScenarioSnapshot;

    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    setTestSink((event, data) => events.push({ event, data }));
    const runMock = vi.fn(
      async () => JSON.parse(JSON.stringify(minimalFixture)) as V2RunResponseEnvelope,
    );
    const plotClient = {
      run: runMock,
      validatePatch: vi.fn().mockResolvedValue({}),
    } as unknown as PLoTClient;
    const handler = createRunAnalysisHandler({
      plotClient,
      scenarioReader: async () => snapshot,
    });

    let outcome: unknown;
    try {
      outcome = await handler(makeInvocation('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
    } finally {
      setTestSink(null);
    }

    // run_analysis succeeds normally on a clean graph.
    expect(outcome).toBeTruthy();
    expect(runMock).toHaveBeenCalledTimes(1);
    // Guard made zero corrections → NO telemetry event emitted (true negative).
    expect(events.filter((e) => e.event === 'v5.run_analysis.intercept_guard')).toHaveLength(0);
    // PLoT received the clean graph structurally UNCHANGED (no field perturbation).
    const sentPayload = (runMock.mock.calls as Array<unknown[]>)[0]![0] as { graph: unknown };
    expect(sentPayload.graph).toEqual(cleanGraph);
  });
});
