/**
 * ROUND 6 (CEE #1328) — SECOND HOP: the goal-label CANDIDATE reaches the field
 * the V5 orchestration seam actually reads.
 *
 * `StageContext` never leaves `runUnifiedPipeline` (it returns
 * `{ statusCode, body }`), and `turn-executor.ts` reads `DraftGraphResult`,
 * not the pipeline. So a candidate that reaches `ctx` (proved one hop earlier
 * in stages/__tests__/enrich-goal-target-candidate-arrival.test.ts) is NOT yet
 * anywhere a consumer can see. This test pins the hop from
 * `UnifiedPipelineResult.goal_target_candidate` to
 * `DraftGraphResult.goalTargetCandidate`, through the real `handleDraftGraph`,
 * with a NEGATIVE twin so "nothing arrives" cannot pass by nothing being sent.
 *
 * The pipeline is mocked at its boundary (the same seam
 * may-run-on-draft-turn.test.ts mocks); the draft-graph tool is real.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

const runUnifiedPipelineMock = vi.fn();
vi.mock('../../../cee/unified-pipeline/index.js', () => ({
  runUnifiedPipeline: (...args: unknown[]) => runUnifiedPipelineMock(...args),
}));

import { buildCanonicalAnalysisReadyFromGraph } from '../analysis-ready-helper.js';
import { handleDraftGraph } from '../draft-graph.js';

const CAPTURE = 'src/cee/context-integrity/__tests__/fixtures/live-4day-week.cold-read.json';
const STUB_REQUEST = {} as FastifyRequest;
const BRIEF = 'Given our goal of reaching £20k MRR within 12 months, should we raise the Pro plan price?';

function captureGraph(): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(CAPTURE, 'utf8')) as { graph: Record<string, unknown> };
  return JSON.parse(JSON.stringify(parsed.graph)) as Record<string, unknown>;
}

function pipelineBody(): Record<string, unknown> {
  const graph = captureGraph();
  const analysisReady: Record<string, unknown> = { ...buildCanonicalAnalysisReadyFromGraph(graph as any) };
  delete analysisReady.may_run;
  return { graph, analysis_ready: analysisReady };
}

const CANDIDATE = {
  goal_node_id: 'goal_mrr',
  value_user_units: 20000,
  unit: '£',
  label_span: '£20k',
  brief_span: '£20k',
  binding: 'governed' as const,
  reason: 'governed' as const,
};

beforeEach(() => {
  runUnifiedPipelineMock.mockReset();
});

describe('round 6 — DraftGraphResult.goalTargetCandidate is the V5-visible hop', () => {
  it('a candidate beside the pipeline body arrives on DraftGraphResult, by identity and exact value', async () => {
    runUnifiedPipelineMock.mockResolvedValue({ statusCode: 200, body: pipelineBody(), goal_target_candidate: CANDIDATE });
    const result = await handleDraftGraph(BRIEF, STUB_REQUEST, 'turn-draft-candidate-1');
    expect(result.goalTargetCandidate).toEqual(CANDIDATE);
    // PRECONDITION pinned: the draft itself succeeded (a failed draft returns
    // early and could never carry the field), so the assertion above is about
    // the hop and not about an error path.
    expect(result.graphOutput).not.toBeNull();
  });

  it('⭐ NEGATIVE TWIN: a pipeline result WITHOUT the candidate yields no field at all', async () => {
    runUnifiedPipelineMock.mockResolvedValue({ statusCode: 200, body: pipelineBody() });
    const result = await handleDraftGraph(BRIEF, STUB_REQUEST, 'turn-draft-candidate-2');
    expect(result.goalTargetCandidate).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result, 'goalTargetCandidate')).toBe(false);
    expect(result.graphOutput).not.toBeNull();
  });

  it('the candidate is NOT copied onto the body and never becomes a goal write', async () => {
    // The body is the legacy wire; the candidate must travel beside it, and
    // nothing in the draft-graph tool may turn a candidate into goal_threshold.
    runUnifiedPipelineMock.mockResolvedValue({ statusCode: 200, body: pipelineBody(), goal_target_candidate: CANDIDATE });
    const result = await handleDraftGraph(BRIEF, STUB_REQUEST, 'turn-draft-candidate-3');
    const goalNodes = (result.graphOutput?.nodes ?? []).filter((n: any) => n.kind === 'goal');
    for (const g of goalNodes as any[]) {
      expect(g.goal_threshold_raw ?? undefined, `goal ${g.id} must not be written from a candidate`).toBeUndefined();
    }
    expect((result as any).goal_target_candidate).toBeUndefined();
  });
});
