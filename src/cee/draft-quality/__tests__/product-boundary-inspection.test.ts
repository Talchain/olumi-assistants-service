/**
 * ⭐⭐ [P1a] THE INSPECTION ROUTE, PROVEN AT THE PRODUCT BOUNDARY.
 *
 * ## Why this file exists, and why the pipeline-hook test was not enough
 *
 * `pipeline-hook.test.ts` proves that `applyDraftQualityPass` attaches the
 * discarded draw to `body.trace.pipeline.draft_quality`. That is a claim about
 * an INTERNAL OBJECT, and it was the only claim the lane had. The product
 * owner's requirement is different and larger: *a repair pass that silently
 * hides bad drafts destroys the only signal we have about draft quality.* An
 * inspection route that stops inside the pipeline is not an inspection route.
 *
 * Measured at the bytes before this file was written, the route DID stop there:
 *   · `DraftGraphResult` (`orchestrator/tools/draft-graph.ts:71`) carried
 *     neither the raw pipeline trace nor any `draft_quality` field, and
 *   · the return literal of `handleDraftGraph` NAMES ITS KEYS — the same
 *     construct that file's own comment calls the "THIRD SILENT-DROP POINT"
 *     for `record_disclosures`, closed there and reopened here.
 * So the rejected original draft disappeared before the V5 response and before
 * the debug export, and no test in the lane could see it.
 *
 * ## What this file pins, and why every hop is real code
 *
 * The chain below runs PRODUCTION functions at every hop and stubs only the LLM
 * boundary (`runUnifiedPipeline`, the one thing a unit test cannot call):
 *
 *   applyDraftQualityPass  → the real pipeline body, trace attached
 *     → handleDraftGraph   → the real DraftGraphResult projection
 *       → buildV5DiagnosticTrace → the real V5 trace the route ships
 *
 * The last hop is the product boundary: `route-v2` strips `_diagnostic_trace`
 * before the egress validator and re-attaches the builder's output verbatim
 * afterwards (`route-v2.ts:1235`, `:1299`), so what `buildV5DiagnosticTrace`
 * returns is what the wire carries. That strip-validate-reattach pattern is
 * also why a new key here breaks no published contract.
 *
 * ## Contrast controls (trap 13e)
 *
 * Every absence assertion below has a presence twin in the SAME run: a body
 * with no `draft_quality` must project `undefined` while the identical chain
 * carrying one projects the graph. An assertion that the field arrives is
 * evidence only if the same probe can report it missing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { UnifiedPipelineResult } from '../../unified-pipeline/types.js';

const runUnifiedPipelineMock = vi.fn();
vi.mock('../../unified-pipeline/index.js', () => ({
  runUnifiedPipeline: (...args: unknown[]) => runUnifiedPipelineMock(...args),
}));

import { applyDraftQualityPass } from '../pipeline-hook.js';
import { handleDraftGraph } from '../../../orchestrator/tools/draft-graph.js';
import { buildV5DiagnosticTrace } from '../../../orchestrator-v5/diagnostics/v5-diagnostic-trace.js';
import type { CommitResult } from '../../../orchestrator-v5/commit.js';

const STUB_REQUEST = {} as FastifyRequest;
const BRIEF =
  'Four things matter here: dilution, speed to close, strategic value and board control.';

/** The motivating defect: five options funnelling through ONE factor. */
const THIN_GRAPH = Object.freeze({
  version: 'v3',
  nodes: [
    { id: 'dec_1', kind: 'decision', label: 'How do we raise?' },
    { id: 'opt_a', kind: 'option', label: 'Top-tier VC' },
    { id: 'opt_b', kind: 'option', label: 'Mid-tier VC' },
    { id: 'opt_c', kind: 'option', label: 'Strategic investor' },
    { id: 'opt_d', kind: 'option', label: 'Revenue-based financing' },
    { id: 'opt_e', kind: 'option', label: 'Bootstrap another year' },
    { id: 'fac_dilution', kind: 'factor', label: 'Equity dilution' },
    { id: 'out_own', kind: 'outcome', label: 'Founder ownership' },
    { id: 'goal_1', kind: 'goal', label: 'Fund on the best terms' },
  ],
  edges: [
    { from: 'dec_1', to: 'opt_a', strength_mean: 0.5, strength_std: 0.1 },
    { from: 'dec_1', to: 'opt_b', strength_mean: 0.5, strength_std: 0.1 },
    { from: 'dec_1', to: 'opt_c', strength_mean: 0.5, strength_std: 0.1 },
    { from: 'dec_1', to: 'opt_d', strength_mean: 0.5, strength_std: 0.1 },
    { from: 'dec_1', to: 'opt_e', strength_mean: 0.5, strength_std: 0.1 },
    { from: 'opt_a', to: 'fac_dilution', strength_mean: 0.5, strength_std: 0.1 },
    { from: 'opt_b', to: 'fac_dilution', strength_mean: 0.5, strength_std: 0.1 },
    { from: 'opt_c', to: 'fac_dilution', strength_mean: 0.5, strength_std: 0.1 },
    { from: 'opt_d', to: 'fac_dilution', strength_mean: 0.5, strength_std: 0.1 },
    { from: 'opt_e', to: 'fac_dilution', strength_mean: 0.5, strength_std: 0.1 },
    { from: 'fac_dilution', to: 'out_own', strength_mean: 0.5, strength_std: 0.1 },
    { from: 'out_own', to: 'goal_1', strength_mean: 0.5, strength_std: 0.1 },
  ],
});

/** A second draw whose options act through DIFFERENT dimensions, all named in
 *  the brief. Structurally richer AND on-brief — the arm that legitimately
 *  wins. (Its off-brief twin lives in `redraw-selection-grounding.test.ts`.) */
const RICH_ON_BRIEF_GRAPH = Object.freeze({
  version: 'v3',
  nodes: [
    { id: 'dec_1', kind: 'decision', label: 'How do we raise?' },
    { id: 'opt_a', kind: 'option', label: 'Top-tier VC' },
    { id: 'opt_b', kind: 'option', label: 'Bootstrap another year' },
    { id: 'fac_dilution', kind: 'factor', label: 'Equity dilution' },
    { id: 'fac_speed', kind: 'factor', label: 'Speed to close' },
    { id: 'out_own', kind: 'outcome', label: 'Founder ownership' },
    { id: 'goal_1', kind: 'goal', label: 'Fund on the best terms' },
  ],
  edges: [
    { from: 'dec_1', to: 'opt_a', strength_mean: 0.5, strength_std: 0.1 },
    { from: 'dec_1', to: 'opt_b', strength_mean: 0.5, strength_std: 0.1 },
    { from: 'opt_a', to: 'fac_dilution', strength_mean: 0.5, strength_std: 0.1 },
    { from: 'opt_b', to: 'fac_speed', strength_mean: 0.5, strength_std: 0.1 },
    { from: 'fac_dilution', to: 'out_own', strength_mean: 0.5, strength_std: 0.1 },
    { from: 'fac_speed', to: 'out_own', strength_mean: 0.5, strength_std: 0.1 },
    { from: 'out_own', to: 'goal_1', strength_mean: 0.5, strength_std: 0.1 },
  ],
});

const ok = (graph: unknown): UnifiedPipelineResult => ({ statusCode: 200, body: { graph } });

/** A judge that reads the model, not a constant. A judge returning the same
 *  answer for every input is a non-discriminating instrument (trap 20). */
const graphAwareJudge = async ({ graph }: { graph: unknown }) => {
  const ids = JSON.stringify(graph);
  return ids.includes('fac_speed')
    ? ({ kind: 'adequate' } as const)
    : ({ kind: 'impoverished', grounds: ['collapsed_dimensions'] } as const);
};

/** Run the REAL quality pass and hand back the REAL pipeline body it produced. */
async function pipelineBodyAfterRedraw(): Promise<unknown> {
  const result = await applyDraftQualityPass({
    first: ok(THIN_GRAPH),
    brief: BRIEF,
    requestId: 'p1a-1',
    elapsedMs: 1_000,
    retryBaselineMs: Date.now(),
    redraw: async () => ok(RICH_ON_BRIEF_GRAPH),
    judge: graphAwareJudge as never,
  });
  return result.body;
}

const COMMIT_RESULT = {
  graphPersisted: true,
  versionCreated: false,
} as unknown as CommitResult;

describe('[P1a] the discarded draw reaches the DraftGraphResult projection', () => {
  beforeEach(() => {
    runUnifiedPipelineMock.mockReset();
  });

  it('⭐ handleDraftGraph carries draft_quality off the pipeline body — discarded graph intact', async () => {
    const body = await pipelineBodyAfterRedraw();
    runUnifiedPipelineMock.mockResolvedValue({ statusCode: 200, body });

    const result = await handleDraftGraph(
      'A decision brief that is comfortably longer than thirty characters.',
      STUB_REQUEST,
      'turn-p1a-1',
    );

    expect(result.draftQuality).toBeDefined();
    expect(result.draftQuality?.redraw_spent).toBe(true);
    expect(result.draftQuality?.shipped).toBe('second');
    // ⭐ THE REJECTED ORIGINAL. This is the signal the owner's ruling is about.
    expect(result.draftQuality?.discarded_graph).toEqual(THIN_GRAPH);
    expect(result.draftQuality?.first_coverage).toMatchObject({
      option_count: 5,
      causal_waist: 1,
    });
  });

  it('CONTRAST CONTROL — the same chain projects undefined when the pass never ran', async () => {
    // Identical call, a body with no `trace.pipeline.draft_quality`. If this
    // also reported a value, the assertion above would be measuring nothing.
    runUnifiedPipelineMock.mockResolvedValue({
      statusCode: 200,
      body: { graph: RICH_ON_BRIEF_GRAPH },
    });

    const result = await handleDraftGraph(
      'A decision brief that is comfortably longer than thirty characters.',
      STUB_REQUEST,
      'turn-p1a-2',
    );

    expect(result.draftQuality).toBeUndefined();
  });
});

describe('[P1a] the discarded draw reaches the V5 diagnostic trace — the product boundary', () => {
  const originalFlag = process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;

  beforeEach(() => {
    runUnifiedPipelineMock.mockReset();
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    else process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = originalFlag;
  });

  it('⭐⭐ the rejected original arrives in the trace the route ships on the wire', async () => {
    const body = await pipelineBodyAfterRedraw();
    runUnifiedPipelineMock.mockResolvedValue({ statusCode: 200, body });

    const draftResult = await handleDraftGraph(
      'A decision brief that is comfortably longer than thirty characters.',
      STUB_REQUEST,
      'turn-p1a-3',
    );

    const trace = buildV5DiagnosticTrace({
      startedAt: Date.now() - 100,
      draftResult,
      commitResult: COMMIT_RESULT,
      persistenceMs: 5,
      scenarioId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      turnId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      requestId: 'p1a-3',
    });

    expect(trace).toBeDefined();
    expect(trace?.draft_quality).toBeDefined();
    // The whole point of the requirement: the pre-redraw graph is inspectable
    // at the product boundary, not only inside the pipeline.
    expect(trace?.draft_quality?.discarded_graph).toEqual(THIN_GRAPH);
    expect(trace?.draft_quality?.shipped).toBe('second');
    expect(trace?.draft_quality?.improved).toBe(true);
    expect(trace?.draft_quality?.second_coverage).toMatchObject({ causal_waist: 2 });
  });

  it('CONTRAST CONTROL — a turn on which no redraw was spent carries no draft_quality block', async () => {
    runUnifiedPipelineMock.mockResolvedValue({
      statusCode: 200,
      body: { graph: RICH_ON_BRIEF_GRAPH },
    });
    const draftResult = await handleDraftGraph(
      'A decision brief that is comfortably longer than thirty characters.',
      STUB_REQUEST,
      'turn-p1a-4',
    );

    const trace = buildV5DiagnosticTrace({
      startedAt: Date.now() - 100,
      draftResult,
      commitResult: COMMIT_RESULT,
      persistenceMs: 5,
      scenarioId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      turnId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      requestId: 'p1a-4',
    });

    // The trace itself is present — so this control proves the ABSENCE of the
    // block, not the absence of the trace.
    expect(trace).toBeDefined();
    expect(trace?.draft_quality).toBeUndefined();
  });
});
