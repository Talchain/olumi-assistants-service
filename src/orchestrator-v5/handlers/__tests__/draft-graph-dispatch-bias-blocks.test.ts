/**
 * RED-first pin: draftResultToOlumiResponse projects the draft's bias
 * signals into structured `bias_signal` coaching blocks on the wire, and
 * the whole envelope still satisfies the strict boundary contract.
 *
 * Before the wiring this fails — the composer shipped `blocks: []`, so the
 * DGAI #356 renderer had nothing to read.
 */
import { describe, it, expect, vi } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

// emit() is telemetry-only; silence it so the composer runs side-effect-free.
vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: vi.fn() };
});

import { draftResultToOlumiResponse } from '../draft-graph-dispatch.js';
import type { DraftGraphResult } from '../../../orchestrator/tools/draft-graph.js';

const PAYLOAD = {
  kind: 'message' as const,
  scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  stage: 'frame' as const,
  message: 'Should we switch supplier?',
  turn_class: 'frame' as const,
  source: 'composer' as const,
};

const GRAPH = {
  nodes: [
    { id: 'dec_supplier', kind: 'decision', label: 'Choose supplier strategy' },
    { id: 'opt_switch', kind: 'option', label: 'Switch supplier' },
    { id: 'fac_current_supplier', kind: 'factor', label: 'Current supplier terms' },
    { id: 'fac_initial_quote', kind: 'factor', label: 'Initial quote' },
    { id: 'goal_cost', kind: 'goal', label: 'Minimise total cost' },
  ],
  edges: [{ from: 'opt_switch', to: 'goal_cost' }],
};

const BIAS_SIGNALS = [
  {
    type: 'status_quo_bias',
    detail: 'The model leans on keeping the current supplier without weighing the switch on equal terms.',
    target: 'fac_current_supplier',
  },
  {
    type: 'anchoring',
    detail: 'Estimates cluster tightly around the initial quote rather than an independent range.',
    target: 'fac_initial_quote',
  },
];

function makeResult(overrides: Partial<Record<string, unknown>> = {}): DraftGraphResult {
  return {
    blocks: [],
    assistantText: 'Drafted a decision graph.',
    latencyMs: 1000,
    strengthenItems: [],
    coachingSummary: null,
    coachingWideningLog: null,
    coachingBiasSignals: BIAS_SIGNALS,
    draftWarnings: [],
    graphOutput: GRAPH,
    analysisReady: {
      status: 'ready',
      goal_node_id: 'goal_cost',
      options: [],
    },
    ...overrides,
  } as unknown as DraftGraphResult;
}

describe('draftResultToOlumiResponse — bias_signal coaching blocks', () => {
  it('emits 2 bias_signal coaching blocks when the graph persisted', () => {
    const res = draftResultToOlumiResponse(
      makeResult(),
      PAYLOAD,
      true,
      'req-1',
      PAYLOAD.message,
      undefined,
    );

    const biasBlocks = res.blocks.filter(
      (b) => b.type === 'coaching' && (b as { coaching_kind?: string }).coaching_kind === 'bias_signal',
    );
    expect(biasBlocks).toHaveLength(2);
    expect(biasBlocks.map((b) => (b as { title: string }).title)).toEqual([
      'Status quo bias',
      'Anchoring',
    ]);

    // The whole envelope still validates against the strict boundary schema.
    expect(OlumiResponseSchema.safeParse(res).success).toBe(true);
  });

  it('emits no bias blocks when the engine produced no signals (prose path unchanged)', () => {
    const res = draftResultToOlumiResponse(
      makeResult({ coachingBiasSignals: null }),
      PAYLOAD,
      true,
      'req-2',
      PAYLOAD.message,
      undefined,
    );
    expect(res.blocks).toEqual([]);
    // assistant_text (the prose bullet path) is still produced.
    expect(typeof res.assistant_text).toBe('string');
    expect(res.assistant_text.length).toBeGreaterThan(0);
  });

  it('emits no blocks on the non-persisted (failure) path', () => {
    const res = draftResultToOlumiResponse(
      makeResult(),
      PAYLOAD,
      false,
      'req-3',
      PAYLOAD.message,
      undefined,
    );
    expect(res.blocks).toEqual([]);
  });

  it.each(['needs_user_input', 'needs_user_mapping', 'needs_encoding', 'blocked'])(
    'quarantines valid free-form bias detail on the wire when readiness is %s',
    (status) => {
      const res = draftResultToOlumiResponse(
        makeResult({
          analysisReady: { status, goal_node_id: 'goal_cost', options: [] },
        }),
        PAYLOAD,
        true,
        `req-bias-${status}`,
        PAYLOAD.message,
        undefined,
      );
      expect(res.blocks).toEqual([]);
      expect(JSON.stringify(res)).not.toContain(BIAS_SIGNALS[0]!.detail);
      expect(JSON.stringify(res)).not.toContain(BIAS_SIGNALS[1]!.detail);
    },
  );

  it('quarantines bias detail when readiness is missing', () => {
    const res = draftResultToOlumiResponse(
      makeResult({ analysisReady: undefined }),
      PAYLOAD,
      true,
      'req-bias-missing-readiness',
      PAYLOAD.message,
      undefined,
    );
    expect(res.blocks).toEqual([]);
    expect(JSON.stringify(res)).not.toContain(BIAS_SIGNALS[0]!.detail);
  });
});
