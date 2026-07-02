/**
 * Phase 2/3 orchestration tests for enrichDraftGraph (RED-first).
 *
 * Only the M2 review caller is mocked — merge and guards run REAL, so these
 * tests pin the true end-to-end deterministic behaviour: every M2 failure
 * mode degrades to the untouched M1 graph with a recorded reason; a valid
 * proposal batch merges and returns enriched=true; option proposals defer;
 * zero-applied batches degrade honestly. enrichDraftGraph must never throw.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

vi.mock('../m2-review.js', () => ({
  reviewDraftGraph: vi.fn(),
}));
vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: vi.fn() };
});

import { reviewDraftGraph } from '../m2-review.js';
import { enrichDraftGraph } from '../index.js';
import { emit, TelemetryEvents } from '../../../utils/telemetry.js';
import type { EnrichmentInput } from '../types.js';

function baseGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
      { id: 'opt_launch', kind: 'option', label: 'Launch now', interventions: { fac_price: 0.8 } },
      { id: 'opt_wait', kind: 'option', label: 'Wait 6 months', interventions: { fac_price: 0.2 } },
      { id: 'fac_price', kind: 'factor', label: 'Price point' },
    ],
    edges: [
      {
        from: 'fac_price',
        to: 'goal_revenue',
        strength: { mean: 0.6, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
  } as GraphV3T;
}

function makeInput(graph: GraphV3T = baseGraph()): EnrichmentInput {
  return {
    graph,
    brief: 'Should we launch now?',
    analysisReady: null,
    requestId: 'req-e',
    scenarioId: 'scen-1',
    turnId: 'turn-1',
    pipelineElapsedMs: 20_000,
  };
}

function mockM2(outcome: unknown) {
  (reviewDraftGraph as MockedFunction<typeof reviewDraftGraph>).mockResolvedValue(
    outcome as Awaited<ReturnType<typeof reviewDraftGraph>>,
  );
}

describe('enrichDraftGraph — M2 degrade paths (all return the untouched M1 graph)', () => {
  beforeEach(() => vi.clearAllMocks());

  const CASES: Array<[string, unknown, string]> = [
    ['prompt sentinel', { kind: 'prompt_not_provisioned' }, 'prompt_not_provisioned'],
    ['headroom', { kind: 'insufficient_headroom', pipelineElapsedMs: 999_999 }, 'insufficient_headroom'],
    ['timeout', { kind: 'timeout', latencyMs: 25_000 }, 'm2_timeout'],
    ['llm error', { kind: 'llm_error', message: 'boom' }, 'm2_llm_error'],
    ['parse failure', { kind: 'parse_failed', message: 'not json' }, 'm2_parse_failed'],
    // Model-resolution gate maps to the first-class, activation-critical
    // reason (accepted additive contract extension #2) — distinct from
    // m2_llm_error so config/failover conditions do not read as adapter
    // instability. The M2ReviewResult kind also rides on the degraded `detail`.
    ['model gate', { kind: 'model_not_resolved', detail: 'CEE_MODEL_M2_REVIEW unset' }, 'm2_model_not_resolved'],
  ];

  for (const [label, m2Outcome, reason] of CASES) {
    it(`${label} → enriched=false, reason=${reason}, graph unchanged`, async () => {
      mockM2(m2Outcome);
      const input = makeInput();
      const res = await enrichDraftGraph(input);
      expect(res.enriched).toBe(false);
      expect(res.reason).toBe(reason);
      expect(res.graph).toEqual(input.graph);
    });
  }

  it('reviewDraftGraph throwing unexpectedly → internal_error, never propagates', async () => {
    (reviewDraftGraph as MockedFunction<typeof reviewDraftGraph>).mockRejectedValue(new Error('boom'));
    const input = makeInput();
    const res = await enrichDraftGraph(input);
    expect(res.enriched).toBe(false);
    expect(res.reason).toBe('internal_error');
    expect(res.graph).toEqual(input.graph);
  });

  it('emits a degraded telemetry event with the reason', async () => {
    mockM2({ kind: 'timeout', latencyMs: 25_000 });
    await enrichDraftGraph(makeInput());
    const calls = (emit as unknown as MockedFunction<typeof emit>).mock.calls.filter(
      (c) => c[0] === TelemetryEvents.V6DualDraftDegraded,
    );
    expect(calls).toHaveLength(1);
    expect((calls[0][1] as Record<string, unknown>).reason).toBe('m2_timeout');
  });

  it('model gate degrades with the first-class reason AND a detail sub-cause on the degraded event', async () => {
    mockM2({ kind: 'model_not_resolved', detail: 'CEE_MODEL_M2_REVIEW unset' });
    const res = await enrichDraftGraph(makeInput());
    // First-class reason, NOT hidden under m2_llm_error.
    expect(res.reason).toBe('m2_model_not_resolved');
    const calls = (emit as unknown as MockedFunction<typeof emit>).mock.calls.filter(
      (c) => c[0] === TelemetryEvents.V6DualDraftDegraded,
    );
    expect(calls).toHaveLength(1);
    const payload = calls[0][1] as Record<string, unknown>;
    expect(payload.reason).toBe('m2_model_not_resolved');
    // The M2ReviewResult kind rides along so the degraded event alone
    // distinguishes static-config conditions from real LLM instability.
    expect(payload.detail).toBe('model_not_resolved');
  });
});

describe('enrichDraftGraph — merge paths (real merge + guards)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('valid risk proposal → enriched=true, reason=applied, merged graph returned, input untouched', async () => {
    mockM2({
      kind: 'ok',
      proposals: [
        {
          type: 'added_risk',
          delta: { node: { id: 'risk_regulatory', kind: 'risk', label: 'Regulatory delay' } },
          evidence_pointer: 'brief: approval timeline',
        },
      ],
      latencyMs: 5000,
      model: 'test-model',
    });
    const input = makeInput();
    const snapshot = structuredClone(input.graph);
    const res = await enrichDraftGraph(input);
    expect(res.enriched).toBe(true);
    expect(res.reason).toBe('applied');
    expect(res.graph.nodes.some((n) => n.id === 'risk_regulatory')).toBe(true);
    expect(input.graph).toEqual(snapshot);
  });

  it('emits a merge_report telemetry event with the accounting', async () => {
    mockM2({
      kind: 'ok',
      proposals: [
        {
          type: 'added_risk',
          delta: { node: { id: 'risk_x', kind: 'risk', label: 'X' } },
          evidence_pointer: 'e',
        },
        { type: 'added_risk', delta: {} }, // malformed
      ],
      latencyMs: 5000,
      model: 'test-model',
    });
    await enrichDraftGraph(makeInput());
    const calls = (emit as unknown as MockedFunction<typeof emit>).mock.calls.filter(
      (c) => c[0] === TelemetryEvents.V6DualDraftMergeReport,
    );
    expect(calls).toHaveLength(1);
    const payload = calls[0][1] as Record<string, unknown>;
    expect(payload.proposals_total).toBe(2);
    expect(payload.applied).toBe(1);
  });

  it('all-garbage proposals → applied 0 → no_proposals_applied, M1 graph returned', async () => {
    mockM2({ kind: 'ok', proposals: [null, 42, { type: 'nope' }], latencyMs: 100, model: 'm' });
    const input = makeInput();
    const res = await enrichDraftGraph(input);
    expect(res.enriched).toBe(false);
    expect(res.reason).toBe('no_proposals_applied');
    expect(res.graph).toEqual(input.graph);
  });

  it('option-only proposals defer (D1): applied 0, graph unchanged, artifacts recorded in telemetry', async () => {
    mockM2({
      kind: 'ok',
      proposals: [
        {
          type: 'added_option',
          delta: { node: { id: 'opt_partner', kind: 'option', label: 'Partner up' } },
          evidence_pointer: 'brief: partnership',
        },
      ],
      latencyMs: 100,
      model: 'm',
    });
    const input = makeInput();
    const res = await enrichDraftGraph(input);
    expect(res.enriched).toBe(false);
    expect(res.reason).toBe('no_proposals_applied');
    expect(res.graph).toEqual(input.graph);
    const reportCall = (emit as unknown as MockedFunction<typeof emit>).mock.calls.find(
      (c) => c[0] === TelemetryEvents.V6DualDraftMergeReport,
    );
    expect((reportCall?.[1] as Record<string, unknown>).artifacts).toBe(1);
  });

  it('empty proposal set is a valid M2 success → no_proposals_applied, no failure recorded', async () => {
    mockM2({ kind: 'ok', proposals: [], latencyMs: 100, model: 'm' });
    const res = await enrichDraftGraph(makeInput());
    expect(res.enriched).toBe(false);
    expect(res.reason).toBe('no_proposals_applied');
  });

  it('raw-graph fidelity: undeclared fields and non-schema key order survive enrichment (no spurious option_surface_changed, no stripping)', async () => {
    // NodeV3/EdgeV3 are STRIP-mode schemas and Zod rebuilds keys in schema
    // order. The enrichment stage must merge onto the RAW ingress graph (parse
    // is validation only) — otherwise (a) the option-surface guard compares
    // raw vs reparsed canonicalisations and trips on every applied merge, and
    // (b) enriched turns silently commit a field-stripped graph while
    // flag-off/degraded turns commit the raw one (schema-skew hazard).
    mockM2({
      kind: 'ok',
      proposals: [
        {
          type: 'added_risk',
          delta: { node: { id: 'risk_new', kind: 'risk', label: 'New risk' } },
          evidence_pointer: 'e',
        },
      ],
      latencyMs: 100,
      model: 'm',
    });
    const graph = baseGraph();
    // Option node: undeclared (pipeline-ahead-of-schema) field + label-first
    // key order (differs from NodeV3 declaration order id,kind,label).
    graph.nodes[1] = {
      label: 'Launch now',
      kind: 'option',
      id: 'opt_launch',
      interventions: { fac_price: 0.8 },
      pipeline_extra_field: 'must-survive',
    } as unknown as (typeof graph.nodes)[number];

    // Top-level fields beyond GraphV3's declared {nodes, edges,
    // goal_constraints}: graphOutput is the WHOLE parsed pipeline body —
    // options[] and goal_node_id included — and run_analysis re-reads them
    // from the persisted graph. Merging on a GraphV3-reparsed copy would
    // strip them exactly (and only) on enriched turns.
    (graph as unknown as Record<string, unknown>).options = [
      { id: 'opt_launch', label: 'Launch now', interventions: { fac_price: 0.8 } },
    ];
    (graph as unknown as Record<string, unknown>).goal_node_id = 'goal_revenue';

    const res = await enrichDraftGraph(makeInput(graph));

    expect(res.reason).toBe('applied');
    expect(res.enriched).toBe(true);
    const opt = res.graph.nodes.find((n) => n.id === 'opt_launch') as Record<string, unknown>;
    expect(opt.pipeline_extra_field).toBe('must-survive');
    expect(res.graph.nodes.some((n) => n.id === 'risk_new')).toBe(true);
    const top = res.graph as unknown as Record<string, unknown>;
    expect(top.goal_node_id).toBe('goal_revenue');
    expect(Array.isArray(top.options)).toBe(true);
  });

  it('invalid ingress graph → invalid_ingress_graph, M2 never called', async () => {
    const res = await enrichDraftGraph(makeInput({ nodes: 'not-an-array' } as unknown as GraphV3T));
    expect(res.enriched).toBe(false);
    expect(res.reason).toBe('invalid_ingress_graph');
    expect(reviewDraftGraph).not.toHaveBeenCalled();
  });
});
