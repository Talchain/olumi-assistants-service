/**
 * ⭐ THE DARK-SHIP GUARD. Every other test in this lane proves the card is
 * BUILT correctly. None of them would notice if the dispatcher stopped calling
 * the builder — the emitter would go silent with a fully green suite, which is
 * this estate's most-repeated failure and the reason the reachability question
 * has to be asserted separately from the construction question.
 *
 * So this drives the real `dispatchDraftGraph` over the founder's own captured
 * model and asserts the card arrives in `response.blocks`. It is not a source
 * grep: removing the call, the import, or the spread all RED it, and so does
 * gating it behind a readiness state the founder's model was not in.
 *
 * Mocks are the two module-level ones the sibling dispatcher suite already
 * uses — the LLM call and the commit — so nothing between the builder and the
 * response is stubbed.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { DraftGraphResult } from '../../../orchestrator/tools/draft-graph.js';

vi.mock('../../../orchestrator/tools/draft-graph.js', () => ({
  handleDraftGraph: vi.fn(),
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: vi.fn() };
});

import { dispatchDraftGraph } from '../draft-graph-dispatch.js';
import { handleDraftGraph } from '../../../orchestrator/tools/draft-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { DRAFT_CALIBRATION_SIGNAL_PREFIX } from '../draft-calibration-blocks.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUB_REQUEST = {} as FastifyRequest;

const FOUNDER = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../../cee/graph-readiness/__tests__/fixtures/founder-2026-09-03.graph.json',
        import.meta.url,
      ),
    ),
    'utf8',
  ),
) as Record<string, unknown>;

function makePayload() {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'frame' as const,
    message: 'We need to decide whether to hire a sales team.',
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

function makeDraftResult(graphOutput: unknown, analysisReady?: unknown) {
  return {
    blocks: [],
    assistantText: 'Drafted a model.',
    latencyMs: 1000,
    strengthenItems: [],
    coachingSummary: null,
    coachingWideningLog: null,
    coachingBiasSignals: null,
    draftWarnings: [],
    graphOutput,
    ...(analysisReady !== undefined ? { analysisReady } : {}),
  };
}

function mockCommit(graphPersisted: boolean) {
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue({
    response: {},
    performed: true as const,
    persisted_row_id: 'row-1',
    graphPersisted,
  } as Awaited<ReturnType<typeof commitDirectAnswer>>);
}

function mockDraft(graphOutput: unknown, analysisReady?: unknown) {
  (handleDraftGraph as MockedFunction<typeof handleDraftGraph>).mockResolvedValue(
    makeDraftResult(graphOutput, analysisReady) as Awaited<ReturnType<typeof handleDraftGraph>>,
  );
}

function calibrationBlocks(blocks: unknown): Record<string, unknown>[] {
  return (Array.isArray(blocks) ? blocks : [])
    .filter((b): b is Record<string, unknown> => typeof b === 'object' && b !== null)
    .filter((b) => String(b.signal_id ?? '').startsWith(DRAFT_CALIBRATION_SIGNAL_PREFIX));
}

describe('the calibration card reaches the wire from the real dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('the founder\'s captured model produces the ICP Clarity card on response.blocks', async () => {
    mockCommit(true);
    mockDraft(FOUNDER);

    const result = await dispatchDraftGraph({
      payload: makePayload(),
      requestId: 'req-calibration-1',
      request: STUB_REQUEST,
    });

    const found = calibrationBlocks(result.response.blocks);
    expect(found).toHaveLength(1);
    expect(found[0]!.signal_id).toBe(`${DRAFT_CALIBRATION_SIGNAL_PREFIX}16ec3d64`);
    expect(found[0]!.target_refs).toEqual([
      { id: '16ec3d64', label: 'ICP Clarity', kind: 'factor' },
    ]);
  });

  it('⭐ and it still arrives when the model is analysis-READY — the state the founder was in', async () => {
    // The three sibling draft emitters all gate on readiness. The founder's
    // model was READY and carried three defaulted roots, so a card that
    // disappeared in that state would miss the only case this lane is about.
    mockCommit(true);
    mockDraft(FOUNDER, { status: 'ready', options: [], goal_node_id: '552bd1c0' });

    const result = await dispatchDraftGraph({
      payload: makePayload(),
      requestId: 'req-calibration-2',
      request: STUB_REQUEST,
    });

    expect(calibrationBlocks(result.response.blocks)).toHaveLength(1);
  });

  it('a model with no unquantified root produces no calibration card', async () => {
    mockCommit(true);
    mockDraft({
      nodes: [
        { id: 'g', kind: 'goal', label: 'Goal' },
        { id: 'f', kind: 'factor', label: 'Priced in', observed_state: { value: 0.4 } },
      ],
      edges: [{ from: 'f', to: 'g', strength_mean: 0.5 }],
    });

    const result = await dispatchDraftGraph({
      payload: makePayload(),
      requestId: 'req-calibration-3',
      request: STUB_REQUEST,
    });

    expect(calibrationBlocks(result.response.blocks)).toHaveLength(0);
  });

  it('no card when the graph did not persist — the sibling emitters\' rule, shared', async () => {
    mockCommit(false);
    mockDraft(FOUNDER);

    const result = await dispatchDraftGraph({
      payload: makePayload(),
      requestId: 'req-calibration-4',
      request: STUB_REQUEST,
    });

    expect(calibrationBlocks(result.response.blocks)).toHaveLength(0);
  });
});
