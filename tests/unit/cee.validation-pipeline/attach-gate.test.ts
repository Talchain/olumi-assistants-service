/**
 * ROADMAP 2.1250, half 1 of 2 — the validation pipeline's ATTACH GATE.
 *
 * The delivery-path fix (half 2, `tests/unit/cee.validation-attach-deadline.test.ts`)
 * stops the terminal frame waiting indefinitely for Pass 2. That alone would be
 * unsafe: steps 3–9 of this pipeline MUTATE `ctx.graph` edges in place and
 * overwrite `ctx.validationSummary`, so a landing the caller had given up on
 * would write into a graph the response was already being built from. The
 * response bytes would then depend on where Package happened to be between its
 * awaits — a value produced by scheduling, presented as a measurement.
 *
 * This suite pins the gate that makes the outcome BINARY: asked once, the
 * instant Pass 2 returns and before the first byte of mutation, either
 * everything attaches or nothing does.
 *
 * ── WHY THE "NOTHING" ASSERTIONS ARE ENUMERATED ────────────────────────────
 * The abandonment test does not merely assert "no edge metadata". It asserts
 * every one of the three writes the pipeline performs — edge metadata, the
 * graph-level summary key, and the `ctx.validationSummary` mirror. A gate placed
 * one step too late would leave exactly one of them behind, and a test that
 * checked only the first would call that a pass.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StageContext } from '../../../src/cee/unified-pipeline/types.js';

vi.mock('../../../src/utils/telemetry.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  emit: vi.fn(),
}));

// importOriginal spread, never a hand-listed factory — a two-key factory
// REPLACES the module and dies at collection the moment the subject reaches for
// any other export (CLAUDE.md trap 12; this exact failure has happened in the
// sibling suite).
vi.mock('../../../src/config/timeouts.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/config/timeouts.js')>()),
}));

vi.mock('../../../src/cee/validation-pipeline/validate-graph.js', () => ({
  callValidateGraph: vi.fn(),
}));

const { runValidationPipeline } = await import(
  '../../../src/cee/validation-pipeline/index.js'
);
const { callValidateGraph } = await import(
  '../../../src/cee/validation-pipeline/validate-graph.js'
);
const { VALIDATION_EDGE_METADATA_KEY, VALIDATION_GRAPH_SUMMARY_KEY } = await import(
  '../../../src/cee/validation-pipeline/types.js'
);
const { log } = await import('../../../src/utils/telemetry.js');

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeCtx(): StageContext {
  return {
    requestId: 'attach-gate-req',
    effectiveBrief: 'Should we open a second site?',
    graph: {
      nodes: [
        { id: 'fac_x', kind: 'factor', label: 'fac_x' },
        { id: 'out_y', kind: 'outcome', label: 'out_y' },
        { id: 'goal_z', kind: 'goal', label: 'goal_z' },
      ],
      edges: [
        {
          from: 'fac_x',
          to: 'out_y',
          strength: { mean: 0.4, std: 0.12 },
          exists_probability: 0.8,
          effect_direction: 'positive',
        },
      ],
    },
    validationSummary: undefined,
  } as unknown as StageContext;
}

const CANNED_PASS2 = {
  edges: [
    {
      from: 'fac_x',
      to: 'out_y',
      strength: { mean: 0.45, std: 0.11 },
      exists_probability: 0.82,
      reasoning: 'Based on the brief',
      basis: 'brief_explicit' as const,
      needs_user_input: false,
    },
  ],
  model_notes: ['Structure looks sound'],
};

function graphOf(ctx: StageContext): Record<string, any> {
  return ctx.graph as unknown as Record<string, any>;
}

describe('ROADMAP 2.1250 — runValidationPipeline attach gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (callValidateGraph as any).mockResolvedValue(CANNED_PASS2);
  });

  it('attaches everything when the caller is still waiting', async () => {
    const ctx = makeCtx();

    const outcome = await runValidationPipeline(ctx, { shouldAttach: () => true });

    expect(outcome.attached).toBe(true);
    expect(outcome.pass2LatencyMs).toBeGreaterThanOrEqual(0);
    expect(graphOf(ctx).edges[0][VALIDATION_EDGE_METADATA_KEY]).toBeDefined();
    expect(graphOf(ctx)[VALIDATION_GRAPH_SUMMARY_KEY]).toBeDefined();
    expect(ctx.validationSummary).toBeDefined();
  });

  it('attaches NOTHING — all three writes — when the caller has stopped waiting', async () => {
    const ctx = makeCtx();

    const outcome = await runValidationPipeline(ctx, { shouldAttach: () => false });

    expect(outcome.attached).toBe(false);
    expect(graphOf(ctx).edges[0][VALIDATION_EDGE_METADATA_KEY]).toBeUndefined();
    expect(graphOf(ctx)[VALIDATION_GRAPH_SUMMARY_KEY]).toBeUndefined();
    expect(ctx.validationSummary).toBeUndefined();
  });

  it('an abandoned run is a WARN with the Pass-2 latency, not a silent return', async () => {
    // An abandonment that leaves no trace is indistinguishable from a Pass 2
    // that never ran. The latency is the operator's evidence for whether the
    // deadline is set correctly, so it must be on the line.
    const ctx = makeCtx();

    await runValidationPipeline(ctx, { shouldAttach: () => false });

    const warned = (log.warn as any).mock.calls
      .map((c: unknown[]) => c[0] as Record<string, unknown>)
      .filter((a: Record<string, unknown>) => a?.event === 'cee.validation_pipeline.abandoned');
    expect(warned).toHaveLength(1);
    expect(typeof warned[0].pass2_latency_ms).toBe('number');
    expect(warned[0].request_id).toBe('attach-gate-req');
  });

  it('the gate is asked AFTER Pass 2 returns, never instead of calling it', async () => {
    // A "cheaper" implementation would check the predicate before dispatching
    // the model call. That would be a different product: Pass 2 is already in
    // flight by the time the deadline exists, and skipping the call would lose
    // the latency evidence the deadline is tuned from.
    const ctx = makeCtx();

    await runValidationPipeline(ctx, { shouldAttach: () => false });

    expect(callValidateGraph).toHaveBeenCalledTimes(1);
  });

  it('the gate is asked EXACTLY ONCE — a predicate polled twice could straddle the deadline', async () => {
    const ctx = makeCtx();
    const shouldAttach = vi.fn(() => true);

    await runValidationPipeline(ctx, { shouldAttach });

    expect(shouldAttach).toHaveBeenCalledTimes(1);
  });

  it('every pre-2.1250 caller (no options at all) still attaches', async () => {
    // The gate must be opt-in. `runValidationPipeline(ctx)` is the signature
    // every other call site and test in the repo uses.
    const ctx = makeCtx();

    const outcome = await runValidationPipeline(ctx);

    expect(outcome.attached).toBe(true);
    expect(graphOf(ctx).edges[0][VALIDATION_EDGE_METADATA_KEY]).toBeDefined();
  });
});
