/** Production tool extraction and V5 composition; pipeline/commit are not live. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

const { pipeline } = vi.hoisted(() => ({ pipeline: vi.fn() }));
vi.mock('../../../cee/unified-pipeline/index.js', () => ({ runUnifiedPipeline: pipeline }));
vi.mock('../../../utils/telemetry.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../utils/telemetry.js')>(),
  emit: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { handleDraftGraph } from '../../../orchestrator/tools/draft-graph.js';
import { draftResultToOlumiResponse } from '../draft-graph-dispatch.js';
import { optionFramingRecovery, optionFramingWarnings } from '../../../cee/draft/records/option-framing-recovery.js';
import { buildModelBuildingNotices } from '../../../cee/draft/records/model-building-notices.js';

const QUESTION = 'We need to decide whether to raise prices 15% next quarter';
const GAP = { reason: 'decision_framing_not_an_option', node_id: 'opt_question', label: QUESTION };
const PAYLOAD = {
  kind: 'message' as const,
  scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  stage: 'frame' as const, message: QUESTION, turn_class: 'frame' as const, source: 'composer' as const,
};
const OPTIONS = [
  { id: 'opt_raise', label: 'Raise prices 15%', status: 'ready', is_baseline: false,
    interventions: { fac_price: 0.575 }, raw_interventions: { fac_price: 1.15 },
    provenance: { source: 'brief_extraction', brief_quote: 'raise prices 15%' } },
  { id: 'opt_pilot', label: 'Run a pilot, then decide whether to expand', status: 'ready', is_baseline: false,
    interventions: { fac_price: 0.525 }, raw_interventions: { fac_price: 1.05 },
    provenance: { source: 'brief_extraction', brief_quote: 'Run a pilot, then decide whether to expand' } },
];
const GRAPH = {
  nodes: [
    { id: 'dec_pricing', kind: 'decision', label: 'Pricing strategy' },
    ...OPTIONS.map(({ id, label }) => ({ id, label, kind: 'option' })),
    { id: 'fac_price', kind: 'factor', label: 'Price multiplier' },
    { id: 'goal_arr', kind: 'goal', label: 'Grow recurring revenue' },
  ],
  edges: [{ from: 'fac_price', to: 'goal_arr' }],
  options: OPTIONS,
};

async function makeToolResult(disclosures: unknown[] = [], warnings = optionFramingWarnings(disclosures)) {
  pipeline.mockResolvedValue({
    statusCode: 200,
    body: {
      graph: structuredClone(GRAPH),
      analysis_ready: { status: 'ready', goal_node_id: 'goal_arr', options: structuredClone(OPTIONS) },
      draft_warnings: warnings,
      record_disclosures: disclosures,
    },
  });
  return handleDraftGraph(PAYLOAD.message, { headers: {} } as FastifyRequest, PAYLOAD.turn_id);
}

describe('draft option framing receipt on native V5', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('carries the exact producer warning through the real tool into visible reply, preserving alternatives', async () => {
    const warnings = optionFramingWarnings([GAP]);
    const result = await makeToolResult([GAP], warnings);
    expect(result.draftWarnings).toEqual(warnings);
    expect(result.graphOutput).toEqual(GRAPH);
    expect(result.analysisReady?.status).toBe('ready');
    expect(result.analysisReady?.options.map((option) => option.option_id)).toEqual(OPTIONS.map((option) => option.id));

    const response = draftResultToOlumiResponse(result, PAYLOAD, true, 'framing-receipt', PAYLOAD.message);
    expect(response.assistant_text).toContain(warnings[0]!.explanation);
    expect(response.assistant_text).toContain(warnings[0]!.fix_hint);
    expect(response.assistant_text).toContain(QUESTION);
    expect(response.draft_graph?.nodes).toEqual(GRAPH.nodes);
    expect(response.draft_graph?.nodes.some((node: any) => node.id === GAP.node_id)).toBe(false);
    expect(OlumiResponseSchema.safeParse(response).success).toBe(true);
  });

  it('does not turn generic omissions or unrelated warnings into a framing accusation', async () => {
    const clean = await makeToolResult();
    const cleanResponse = draftResultToOlumiResponse(clean, PAYLOAD, true, 'framing-clean', PAYLOAD.message);
    const unrelated = {
      ...clean,
      draftWarnings: [{ id: 'UNRELATED_WARNING', severity: 'medium' as const, explanation: 'Unrelated detail.', fix_hint: 'Review it.' }],
      modelBuildingNotices: buildModelBuildingNotices([{ reason: 'option_budget_exceeded', label: QUESTION }]),
    };
    const response = draftResultToOlumiResponse(unrelated, PAYLOAD, true, 'framing-unrelated', PAYLOAD.message);

    expect(response.assistant_text).toBe(cleanResponse.assistant_text);
    expect(response.assistant_text).not.toMatch(/excluded from the comparison|no baseline has been invented/i);
    expect(response.draft_graph?.nodes).toEqual(GRAPH.nodes);
    expect(response.draft_graph?.nodes).toContainEqual(expect.objectContaining({ id: 'opt_pilot', label: OPTIONS[1]!.label }));
    expect(OlumiResponseSchema.safeParse(response).success).toBe(true);
  });

  it('carries incomplete-set recovery as a typed failure without returning a persistable draft result', async () => {
    const recovery = optionFramingRecovery([{ kind: 'option' }], [GAP], 'framing-incomplete');
    expect(recovery).toBeDefined();
    pipeline.mockResolvedValue(recovery);
    await expect(handleDraftGraph(PAYLOAD.message, { headers: {} } as FastifyRequest, PAYLOAD.turn_id))
      .rejects.toMatchObject({
        pipelineStatusCode: 400, pipelineErrorCode: 'CEE_GRAPH_INVALID', pipelineRetryable: true,
        pipelineReason: 'option_framing_incomplete',
        pipelineRecovery: {
          suggestion: expect.stringMatching(/without inventing one/i),
          hints: expect.arrayContaining([expect.stringMatching(/at least two courses of action/i)]),
        },
      });
  });
});
