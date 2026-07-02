/**
 * Phase 3 fail-open tests for the post-merge safety net (RED-first).
 *
 * The real merge is constructed so these conditions cannot arise (options are
 * never touched, output is re-validated) — that is exactly why the orchestrator
 * must STILL fail open if they ever do. The merge module is mocked here to
 * force each impossible-by-construction condition and prove the guards win:
 *   - post-merge GraphV3 invalid  → discard all merges, return M1;
 *   - option surface changed      → return M1 (G12i);
 *   - readiness downgraded        → return M1 (G12ii).
 *
 * Standing activation ruling: these structural guards are necessary but NOT
 * sufficient — flag activation beyond local/dev additionally requires a
 * proven merged-graph run_analysis SUCCESS (amendment #2).
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

vi.mock('../m2-review.js', () => ({
  reviewDraftGraph: vi.fn(),
}));
vi.mock('../merge.js', () => ({
  mergeProposals: vi.fn(),
}));
vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: vi.fn() };
});

import { reviewDraftGraph } from '../m2-review.js';
import { mergeProposals } from '../merge.js';
import { enrichDraftGraph } from '../index.js';
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

function makeInput(): EnrichmentInput {
  return {
    graph: baseGraph(),
    brief: 'brief',
    analysisReady: null,
    requestId: 'req-g',
    scenarioId: 'scen-1',
    turnId: 'turn-1',
    pipelineElapsedMs: 20_000,
  };
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    proposals_total: 1,
    applied: 1,
    artifacts: 0,
    failures: [],
    post_merge_valid: true,
    post_merge_errors: [],
    ...overrides,
  };
}

const M2_OK = { kind: 'ok', proposals: [{ any: 'proposal' }], latencyMs: 100, model: 'm' };

describe('enrichDraftGraph — post-merge fail-open safety net', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (reviewDraftGraph as MockedFunction<typeof reviewDraftGraph>).mockResolvedValue(
      M2_OK as Awaited<ReturnType<typeof reviewDraftGraph>>,
    );
  });

  it('post-merge invalid → ALL merges discarded, M1 returned (post_merge_invalid)', async () => {
    const mangled = baseGraph();
    mangled.nodes.push({ id: 'risk_new', kind: 'risk', label: 'New' });
    (mergeProposals as MockedFunction<typeof mergeProposals>).mockReturnValue({
      merged: mangled,
      report: report({ post_merge_valid: false, post_merge_errors: ['nodes.5: boom'] }),
      artifacts: [],
    } as ReturnType<typeof mergeProposals>);

    const input = makeInput();
    const res = await enrichDraftGraph(input);
    expect(res.enriched).toBe(false);
    expect(res.reason).toBe('post_merge_invalid');
    expect(res.graph).toEqual(input.graph);
  });

  it('option surface mutated by merge → M1 returned (option_surface_changed, G12i)', async () => {
    const mutated = baseGraph();
    (mutated.nodes[1] as { label: string }).label = 'Launch immediately';
    (mergeProposals as MockedFunction<typeof mergeProposals>).mockReturnValue({
      merged: mutated,
      report: report(),
      artifacts: [],
    } as ReturnType<typeof mergeProposals>);

    const input = makeInput();
    const res = await enrichDraftGraph(input);
    expect(res.enriched).toBe(false);
    expect(res.reason).toBe('option_surface_changed');
    expect(res.graph).toEqual(input.graph);
  });

  it('value-less option node lands (readiness ready → needs_user_mapping) → M1 returned (readiness_downgrade, G12ii)', async () => {
    const downgraded = baseGraph();
    downgraded.nodes.push({ id: 'opt_new', kind: 'option', label: 'Third way' });
    (mergeProposals as MockedFunction<typeof mergeProposals>).mockReturnValue({
      merged: downgraded,
      report: report(),
      artifacts: [],
    } as ReturnType<typeof mergeProposals>);

    const input = makeInput();
    const res = await enrichDraftGraph(input);
    expect(res.enriched).toBe(false);
    // Option-surface invariance fires first (an option node was added) — both
    // guards protect the same invariant; either reason is a correct fail-open.
    expect(['option_surface_changed', 'readiness_downgrade']).toContain(res.reason);
    expect(res.graph).toEqual(input.graph);
  });

  it('readiness downgrade without option-surface change (goal node dropped) → readiness_downgrade', async () => {
    const goalless = baseGraph();
    goalless.nodes = goalless.nodes.filter((n) => n.kind !== 'goal');
    (mergeProposals as MockedFunction<typeof mergeProposals>).mockReturnValue({
      merged: goalless,
      report: report(),
      artifacts: [],
    } as ReturnType<typeof mergeProposals>);

    const input = makeInput();
    const res = await enrichDraftGraph(input);
    expect(res.enriched).toBe(false);
    expect(res.reason).toBe('readiness_downgrade');
    expect(res.graph).toEqual(input.graph);
  });
});
