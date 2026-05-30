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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

/**
 * V5 coaching-surface delivery: the canonical (v0.11.0+) widening_log OBJECT
 * shape. The legacy `coachingWideningLog` ARRAY extractor returns null for the
 * object shape (the Anthropic-adapter normaliser converts the LLM output to
 * `{elements_added, elements_considered_but_excluded, brief_completeness}`),
 * so without the object extractor the widening signal was dead on V5. These
 * tests prove `coachingWideningLogObject` carries the live object.
 */
describe('handleDraftGraph coaching widening_log object (v0.11.0 liveness fix)', () => {
  beforeEach(() => {
    mockRunUnifiedPipeline.mockReset();
  });

  it('narrows the canonical widening_log object onto coachingWideningLogObject', async () => {
    const widening = {
      elements_added: ['risk_runway', 'fac_integration_cost'],
      elements_considered_but_excluded: ['Regulatory pause unlikely in this horizon'],
      brief_completeness: 'partial' as const,
    };
    mockRunUnifiedPipeline.mockResolvedValueOnce(
      makePipelineSuccess({
        ...MINIMAL_GRAPH,
        coaching: { summary: 's', strengthen_items: [], widening_log: widening },
      }),
    );

    const result = await handleDraftGraph('a 30-character decision brief..........', mockRequest, 'turn-1');

    expect(result.coachingWideningLogObject).toEqual(widening);
    // The legacy array field stays null for the object shape — that is exactly
    // the dead-on-V5 path this fix routes around.
    expect(result.coachingWideningLog).toBeNull();
  });

  it('defaults an unknown brief_completeness to "thin" and string-filters the arrays', async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce(
      makePipelineSuccess({
        ...MINIMAL_GRAPH,
        coaching: {
          summary: 's',
          strengthen_items: [],
          widening_log: {
            elements_added: ['ok', 42, null],
            elements_considered_but_excluded: ['reason', {}],
            brief_completeness: 'bogus',
          },
        },
      }),
    );

    const result = await handleDraftGraph('a 30-character decision brief..........', mockRequest, 'turn-1');

    expect(result.coachingWideningLogObject).toEqual({
      elements_added: ['ok'],
      elements_considered_but_excluded: ['reason'],
      brief_completeness: 'thin',
    });
  });

  it('returns null coachingWideningLogObject for the legacy array shape and when absent', async () => {
    mockRunUnifiedPipeline.mockResolvedValueOnce(
      makePipelineSuccess({
        ...MINIMAL_GRAPH,
        coaching: { summary: 's', strengthen_items: [], widening_log: [{ node_id: 'n1', reason: 'r' }] },
      }),
    );
    const arrayResult = await handleDraftGraph('a 30-character decision brief..........', mockRequest, 'turn-1');
    expect(arrayResult.coachingWideningLogObject).toBeNull();

    mockRunUnifiedPipeline.mockResolvedValueOnce(
      makePipelineSuccess({ ...MINIMAL_GRAPH, coaching: { summary: 's', strengthen_items: [] } }),
    );
    const absentResult = await handleDraftGraph('a 30-character decision brief..........', mockRequest, 'turn-1');
    expect(absentResult.coachingWideningLogObject).toBeNull();
  });

  it('extracts the object from a real staging draft pipeline body (contract)', async () => {
    // Real staging capture: coaching.widening_log is the canonical OBJECT.
    const fixture = JSON.parse(
      readFileSync(
        join(process.cwd(), 'tests/fixtures/cross-service/draft-graph.coaching-populated.staging.json'),
        'utf8',
      ),
    ) as { graph: { nodes: unknown[]; edges: unknown[] }; coaching: Record<string, unknown> };

    mockRunUnifiedPipeline.mockResolvedValueOnce(
      makePipelineSuccess({
        nodes: fixture.graph.nodes,
        edges: fixture.graph.edges,
        coaching: fixture.coaching,
      }),
    );

    const result = await handleDraftGraph('a 30-character decision brief..........', mockRequest, 'turn-1');

    expect(result.coachingWideningLogObject).toEqual({
      elements_added: ['risk_runway'],
      elements_considered_but_excluded: [
        'Regulatory pause unlikely in this 12-month horizon',
        'FX exposure not material at projected revenue scale',
      ],
      brief_completeness: 'partial',
    });
  });
});
