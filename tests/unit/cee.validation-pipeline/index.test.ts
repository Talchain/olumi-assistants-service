/**
 * Integration-style tests for the validation pipeline orchestrator.
 * callValidateGraph is mocked to return canned Pass 2 JSON.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StageContext } from '../../../src/cee/unified-pipeline/types.js';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../src/utils/telemetry.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  emit: vi.fn(),
}));

vi.mock('../../../src/config/timeouts.js', () => ({
  VALIDATION_PIPELINE_TIMEOUT_MS: 30_000,
}));

// Mock the Pass 2 caller — we supply canned responses per test.
vi.mock('../../../src/cee/validation-pipeline/validate-graph.js', () => ({
  callValidateGraph: vi.fn(),
}));

const { runValidationPipeline } = await import(
  '../../../src/cee/validation-pipeline/index.js'
);
const { callValidateGraph } = await import(
  '../../../src/cee/validation-pipeline/validate-graph.js'
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeNode(id: string, kind: string) {
  return { id, kind, label: id };
}

function makeEdge(from: string, to: string, mean: number, std: number, ep: number, edgeType?: string) {
  return {
    from,
    to,
    strength: { mean, std },
    exists_probability: ep,
    effect_direction: mean >= 0 ? 'positive' : 'negative',
    ...(edgeType ? { edge_type: edgeType } : {}),
  };
}

function makeCtx(nodes: unknown[], edges: unknown[]): StageContext {
  return {
    input: { brief: 'Should I hire a VP?' } as any,
    rawBody: {},
    request: {} as any,
    requestId: 'test-req-1',
    opts: {} as any,
    start: Date.now(),
    graph: { nodes, edges } as any,
    validationSummary: undefined,
    rationales: [],
    draftCost: 0,
    draftAdapter: null,
    llmMeta: null,
    confidence: undefined,
    clarifierStatus: undefined,
    effectiveBrief: '',
    edgeFieldStash: undefined,
    skipRepairDueToBudget: false,
    repairTimeoutMs: 20000,
    draftDurationMs: 0,
    strpResult: null,
    riskCoefficientCorrections: [],
    transforms: [],
    enrichmentResult: null,
    hadCycles: false,
    nodeRenames: new Map(),
    goalConstraints: null,
    constraintStrpResult: null,
    repairCost: 0,
    repairFallbackReason: undefined,
    clarifierResult: null,
    structuralMeta: null,
    orchestratorRepairUsed: false,
    orchestratorWarnings: [],
    quality: undefined,
    archetype: null,
    draftWarnings: [],
    ceeResponse: undefined,
    pipelineTrace: null,
    finalResponse: undefined,
    collector: null,
    pipelineCheckpoints: [],
    checkpointsEnabled: false,
    stageSnapshots: {},
  } as unknown as StageContext;
}

function makeCannedPass2Response(edges: unknown[]) {
  return {
    edges,
    model_notes: ['Graph looks well structured'],
  };
}

function makePass2Edge(from: string, to: string, mean: number, std: number, ep: number) {
  return {
    from,
    to,
    strength: { mean, std },
    exists_probability: ep,
    reasoning: 'Based on the brief',
    basis: 'brief_explicit' as const,
    needs_user_input: false,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runValidationPipeline', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('attaches ValidationMetadata to causal edges', async () => {
    const nodes = [makeNode('fac_x', 'factor'), makeNode('out_y', 'outcome'), makeNode('goal_z', 'goal')];
    const edges = [
      makeEdge('fac_x', 'out_y', 0.4, 0.12, 0.80),
      makeEdge('out_y', 'goal_z', 0.6, 0.10, 0.85),
    ];
    const ctx = makeCtx(nodes, edges);

    (callValidateGraph as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeCannedPass2Response([
        makePass2Edge('fac_x', 'out_y', 0.4, 0.12, 0.80),
        makePass2Edge('out_y', 'goal_z', 0.6, 0.10, 0.85),
      ]),
    );

    await runValidationPipeline(ctx);

    expect((edges[0] as any).validation).toBeDefined();
    expect((edges[1] as any).validation).toBeDefined();
    expect((edges[0] as any).validation.pass1.strength_mean).toBeCloseTo(0.4);
    expect((edges[1] as any).validation.pass1.strength_mean).toBeCloseTo(0.6);
  });

  it('status is agreed when pass1 and pass2 parameters agree', async () => {
    const nodes = [makeNode('fac_x', 'factor'), makeNode('out_y', 'outcome'), makeNode('goal', 'goal')];
    const edges = [makeEdge('fac_x', 'out_y', 0.4, 0.12, 0.80)];
    const ctx = makeCtx(nodes, edges);

    (callValidateGraph as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeCannedPass2Response([makePass2Edge('fac_x', 'out_y', 0.4, 0.12, 0.80)]),
    );

    await runValidationPipeline(ctx);

    expect((edges[0] as any).validation.status).toBe('agreed');
  });

  it('status is contested when pass2 returns opposite sign', async () => {
    const nodes = [makeNode('fac_x', 'factor'), makeNode('out_y', 'outcome'), makeNode('goal', 'goal')];
    const edges = [makeEdge('fac_x', 'out_y', 0.4, 0.12, 0.80)];
    const ctx = makeCtx(nodes, edges);

    (callValidateGraph as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeCannedPass2Response([makePass2Edge('fac_x', 'out_y', -0.4, 0.12, 0.80)]),
    );

    await runValidationPipeline(ctx);

    const metadata = (edges[0] as any).validation;
    expect(metadata.status).toBe('contested');
    expect(metadata.contested_reasons).toContain('sign_flip');
    expect(metadata.sign_unstable).toBe(true);
  });

  it('marks edges with no Pass 2 match as pass2_missing=true, status=agreed', async () => {
    const nodes = [makeNode('fac_x', 'factor'), makeNode('out_y', 'outcome'), makeNode('goal', 'goal')];
    const edges = [makeEdge('fac_x', 'out_y', 0.4, 0.12, 0.80)];
    const ctx = makeCtx(nodes, edges);

    // Pass 2 returns empty edges list
    (callValidateGraph as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeCannedPass2Response([]),
    );

    await runValidationPipeline(ctx);

    const metadata = (edges[0] as any).validation;
    expect(metadata.pass2_missing).toBe(true);
    expect(metadata.status).toBe('agreed');
  });

  it('does not attach validation to bidirected edges', async () => {
    const nodes = [makeNode('fac_a', 'factor'), makeNode('fac_b', 'factor'), makeNode('goal', 'goal')];
    const edges = [
      makeEdge('fac_a', 'fac_b', 0.3, 0.1, 0.8, 'bidirected'),
      makeEdge('fac_a', 'goal', 0.5, 0.1, 0.85),
    ];
    const ctx = makeCtx(nodes, edges);

    (callValidateGraph as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeCannedPass2Response([makePass2Edge('fac_a', 'goal', 0.5, 0.1, 0.85)]),
    );

    await runValidationPipeline(ctx);

    // Bidirected edge gets no validation
    expect((edges[0] as any).validation).toBeUndefined();
    // Directed edge gets validation
    expect((edges[1] as any).validation).toBeDefined();
  });

  it('does not attach validation to structural sentinel edges', async () => {
    const nodes = [makeNode('dec_1', 'decision'), makeNode('opt_a', 'option'), makeNode('fac_x', 'factor'), makeNode('goal', 'goal')];
    const edges = [
      // Structural edge: mean=1.0, std=0.01, ep=1.0
      makeEdge('dec_1', 'opt_a', 1.0, 0.01, 1.0),
      // Causal edge
      makeEdge('fac_x', 'goal', 0.5, 0.1, 0.85),
    ];
    const ctx = makeCtx(nodes, edges);

    (callValidateGraph as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeCannedPass2Response([makePass2Edge('fac_x', 'goal', 0.5, 0.1, 0.85)]),
    );

    await runValidationPipeline(ctx);

    // Structural edge gets no validation metadata at all
    expect((edges[0] as any).validation).toBeUndefined();
    // Causal edge gets validation
    expect((edges[1] as any).validation).toBeDefined();
  });

  it('sets ctx.validationSummary with correct aggregate counts', async () => {
    const nodes = [makeNode('fac_x', 'factor'), makeNode('out_y', 'outcome'), makeNode('goal', 'goal')];
    const edges = [
      makeEdge('fac_x', 'out_y', 0.4, 0.12, 0.80),
      makeEdge('out_y', 'goal', 0.6, 0.10, 0.85),
    ];
    const ctx = makeCtx(nodes, edges);

    // One edge agrees, one is contested (sign flip)
    (callValidateGraph as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeCannedPass2Response([
        makePass2Edge('fac_x', 'out_y', 0.4, 0.12, 0.80),
        makePass2Edge('out_y', 'goal', -0.6, 0.10, 0.85), // sign flip → contested
      ]),
    );

    await runValidationPipeline(ctx);

    const summary = ctx.validationSummary as any;
    expect(summary.total_edges_validated).toBe(2);
    expect(summary.contested_count).toBe(1);
    expect(summary.model_notes).toHaveLength(1);
    expect(typeof summary.pass2_latency_ms).toBe('number');
    expect(typeof summary.total_pipeline_latency_ms).toBe('number');
    // Also attached to graph object for serialisation
    expect((ctx.graph as any).validation_summary).toBe(summary);
  });

  it('propagates errors from callValidateGraph (caller must catch)', async () => {
    const nodes = [makeNode('fac_x', 'factor'), makeNode('goal', 'goal')];
    const edges = [makeEdge('fac_x', 'goal', 0.5, 0.1, 0.8)];
    const ctx = makeCtx(nodes, edges);

    (callValidateGraph as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('ECONNREFUSED'),
    );

    await expect(runValidationPipeline(ctx)).rejects.toThrow('ECONNREFUSED');
    // Edge should not have validation attached on failure
    expect((edges[0] as any).validation).toBeUndefined();
  });

  it('bias correction offsets are stored in edge.validation.bias_correction', async () => {
    const nodes = [makeNode('fac_x', 'factor'), makeNode('goal', 'goal')];
    const edges = [makeEdge('fac_x', 'goal', 0.5, 0.12, 0.80)];
    const ctx = makeCtx(nodes, edges);

    // Pass 2 mean differs by 0.1 → bias offset = 0.1
    (callValidateGraph as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeCannedPass2Response([makePass2Edge('fac_x', 'goal', 0.4, 0.12, 0.80)]),
    );

    await runValidationPipeline(ctx);

    const bc = (edges[0] as any).validation.bias_correction;
    expect(typeof bc.strength_mean_offset).toBe('number');
    expect(typeof bc.strength_std_offset).toBe('number');
    expect(typeof bc.exists_probability_offset).toBe('number');
  });

  it('timeout error propagates and leaves edges without validation', async () => {
    const nodes = [makeNode('fac_x', 'factor'), makeNode('goal', 'goal')];
    const edges = [makeEdge('fac_x', 'goal', 0.5, 0.1, 0.8)];
    const ctx = makeCtx(nodes, edges);

    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    (callValidateGraph as ReturnType<typeof vi.fn>).mockRejectedValue(abortErr);

    await expect(runValidationPipeline(ctx)).rejects.toThrow('aborted');
    expect((edges[0] as any).validation).toBeUndefined();
  });

  it('invalid JSON parse error propagates and leaves edges clean', async () => {
    const nodes = [makeNode('fac_x', 'factor'), makeNode('goal', 'goal')];
    const edges = [makeEdge('fac_x', 'goal', 0.5, 0.1, 0.8)];
    const ctx = makeCtx(nodes, edges);

    (callValidateGraph as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('cee.validation_pipeline.parse_error: Pass 2 response is not an object'),
    );

    await expect(runValidationPipeline(ctx)).rejects.toThrow('parse_error');
    expect((edges[0] as any).validation).toBeUndefined();
  });

  it('partial Pass 2 coverage: matched edges get validation, unmatched get pass2_missing', async () => {
    const nodes = [
      makeNode('fac_a', 'factor'),
      makeNode('fac_b', 'factor'),
      makeNode('out_y', 'outcome'),
      makeNode('goal', 'goal'),
    ];
    const edges = [
      makeEdge('fac_a', 'out_y', 0.4, 0.12, 0.80),
      makeEdge('fac_b', 'out_y', 0.3, 0.10, 0.75),
      makeEdge('out_y', 'goal', 0.6, 0.10, 0.85),
    ];
    const ctx = makeCtx(nodes, edges);

    // Pass 2 only returns estimates for two of three causal edges
    (callValidateGraph as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeCannedPass2Response([
        makePass2Edge('fac_a', 'out_y', 0.4, 0.12, 0.80),
        makePass2Edge('out_y', 'goal', 0.6, 0.10, 0.85),
      ]),
    );

    await runValidationPipeline(ctx);

    // Matched edges have normal validation metadata
    expect((edges[0] as any).validation.pass2_missing).toBe(false);
    expect((edges[2] as any).validation.pass2_missing).toBe(false);
    // Unmatched edge gets pass2_missing=true, status=agreed
    expect((edges[1] as any).validation.pass2_missing).toBe(true);
    expect((edges[1] as any).validation.status).toBe('agreed');
  });
});
