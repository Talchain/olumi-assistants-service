/**
 * V5 Group 1, Task A.2: draft_graph parser preserves raw coaching fields
 * (summary, widening_log, bias_signals) for V5 ContextPack threading.
 *
 * Pre-V5: parser only extracted narrationHint (flattened summary) and
 * strengthenItems (structured). widening_log and bias_signals were silently
 * dropped by the CEE V3 Zod strip.
 *
 * V5: the Zod schema now preserves these fields, and the parser surfaces
 * them on DraftGraphResult as coachingSummary / coachingWideningLog /
 * coachingBiasSignals.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRunUnifiedPipeline } = vi.hoisted(() => ({
  mockRunUnifiedPipeline: vi.fn(),
}));

vi.mock('../../../../src/cee/unified-pipeline/index.js', () => ({
  runUnifiedPipeline: mockRunUnifiedPipeline,
}));

import { handleDraftGraph } from '../../../../src/orchestrator/tools/draft-graph.js';
import type { FastifyRequest } from 'fastify';

const mockRequest = {} as FastifyRequest;

function makePipelineSuccess(body: Record<string, unknown>) {
  return { statusCode: 200, body };
}

const MINIMAL_GRAPH = {
  nodes: [{ id: 'goal_1', kind: 'goal', label: 'Revenue' }],
  edges: [],
};

describe('handleDraftGraph coaching field preservation (V5 Group 1)', () => {
  beforeEach(() => {
    mockRunUnifiedPipeline.mockReset();
  });

  it('returns coachingSummary when coaching.summary is present', async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce(
      makePipelineSuccess({
        ...MINIMAL_GRAPH,
        coaching: { summary: 'headline text', strengthen_items: [] },
      }),
    );

    const result = await handleDraftGraph('a 30-character decision brief..........', mockRequest, 'turn-1');

    expect(result.coachingSummary).toBe('headline text');
  });

  it('returns coachingWideningLog and coachingBiasSignals when present in coaching', async () => {
    const widening = [{ step: 1, note: 'added reversible option' }];
    const bias = [{ type: 'anchoring' }];
    mockRunUnifiedPipeline.mockResolvedValueOnce(
      makePipelineSuccess({
        ...MINIMAL_GRAPH,
        coaching: {
          summary: 's',
          strengthen_items: [],
          widening_log: widening,
          bias_signals: bias,
        },
      }),
    );

    const result = await handleDraftGraph('a 30-character decision brief..........', mockRequest, 'turn-1');

    expect(result.coachingWideningLog).toEqual(widening);
    expect(result.coachingBiasSignals).toEqual(bias);
  });

  it('returns null coaching fields when body lacks a coaching block', async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce(makePipelineSuccess({ ...MINIMAL_GRAPH }));

    const result = await handleDraftGraph('a 30-character decision brief..........', mockRequest, 'turn-1');

    expect(result.coachingSummary).toBeNull();
    expect(result.coachingWideningLog).toBeNull();
    expect(result.coachingBiasSignals).toBeNull();
  });

  it('returns null for widening_log and bias_signals when coaching has only summary', async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce(
      makePipelineSuccess({
        ...MINIMAL_GRAPH,
        coaching: { summary: 's', strengthen_items: [] },
      }),
    );

    const result = await handleDraftGraph('a 30-character decision brief..........', mockRequest, 'turn-1');

    expect(result.coachingSummary).toBe('s');
    expect(result.coachingWideningLog).toBeNull();
    expect(result.coachingBiasSignals).toBeNull();
  });

  it('returns null for widening_log / bias_signals when their values are not arrays (defensive)', async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce(
      makePipelineSuccess({
        ...MINIMAL_GRAPH,
        coaching: {
          summary: 's',
          strengthen_items: [],
          widening_log: 'not-an-array',
          bias_signals: { object: 'not-array' },
        },
      }),
    );

    const result = await handleDraftGraph('a 30-character decision brief..........', mockRequest, 'turn-1');

    expect(result.coachingWideningLog).toBeNull();
    expect(result.coachingBiasSignals).toBeNull();
  });
});
