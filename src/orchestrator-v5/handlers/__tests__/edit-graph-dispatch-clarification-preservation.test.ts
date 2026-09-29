/**
 * R10 — end-to-end: a preserved no-op clarifying question survives to the wire.
 *
 *  - decideNoOpRecovery stays INERT when noOpClarificationPreserved=true, even
 *    for a vague-edit message that would otherwise take the vague_edit branch.
 *  - dispatchEditGraph leaves the preserved question as the FINAL
 *    response.assistant_text (amendment 3 — assert the response CONTAINS the
 *    question, not merely that the decision returned null).
 *  - the turn-event branch distinguishes noop_clarification_preserved from
 *    noop_fallback_copy so the preservation rate is measurable.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({
  handleEditGraph: vi.fn(),
}));
vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({}),
}));
vi.mock('../../../adapters/llm/prompt-loader.js', () => ({
  getSystemPromptMeta: vi.fn(() => ({
    taskId: 'edit_graph',
    source: 'store',
    promptId: 'edit_graph_default',
    version: 9,
    prompt_version: 'edit_graph_default@v9',
    prompt_hash: '313665a4',
  })),
}));

import { dispatchEditGraph, decideNoOpRecovery } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { setTestSink } from '../../../utils/telemetry.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUB_REQUEST = {} as FastifyRequest;
const QUESTION = 'Which factor did you mean — the one driving cost, or the one driving time?';

const INGRESS_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
  ],
  edges: [{ from: 'dec_launch', to: 'goal_revenue' }],
};

function makePayload(message: string) {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse' as const,
    message,
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

function makeNoOpResult(preserved: boolean, assistantText: string): EditGraphResult {
  return {
    blocks: [],
    assistantText,
    latencyMs: 50,
    appliedGraph: null,
    wasRejected: false,
    noOpClarificationPreserved: preserved,
  };
}

const hg = handleEditGraph as MockedFunction<typeof handleEditGraph>;
const commit = commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;
let events: Array<{ event: string; data: Record<string, unknown> }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  commit.mockResolvedValue({ response: {}, performed: true, persisted_row_id: 'r', graphPersisted: false } as Awaited<ReturnType<typeof commitDirectAnswer>>);
  events = [];
  setTestSink((event, data) => events.push({ event, data }));
});
afterEach(() => setTestSink(null));

function turnBranch(): string | null {
  const te = events.filter((e) => e.event === 'v5.edit_graph.turn');
  return te.length === 1 ? (te[0]!.data.branch as string | null) : `EXPECTED_ONE_EVENT_GOT_${te.length}`;
}

async function run(message: string) {
  return dispatchEditGraph({
    payload: makePayload(message),
    requestId: 'req-r10',
    request: STUB_REQUEST,
    graphState: INGRESS_GRAPH,
    analysisState: null,
  });
}

describe('decideNoOpRecovery — R10 inert guard', () => {
  it('stays inert when noOpClarificationPreserved=true, even for a vague-edit message', () => {
    const result = decideNoOpRecovery({
      message: 'make it better', // would otherwise take vague_edit
      priorFacts: [] as readonly HandlerFact[],
      freshness: 'none',
      graphReady: true,
      noOpClarificationPreserved: true,
    });
    expect(result.branch).toBe('noop_clarification_preserved');
    expect(result.assistantText).toBeNull(); // null = keep the upstream (V4) preserved text
    expect(result.suggestedActions).toHaveLength(0);
  });
});

describe('dispatchEditGraph — R10 preservation end-to-end', () => {
  it('keeps the preserved clarifying question as the final response (vague message does not clobber it)', async () => {
    hg.mockResolvedValue(makeNoOpResult(true, QUESTION));
    const result = await run('make it better');
    // Amendment 3: assert the FINAL response contains the question, not just
    // that the recovery decision returned null.
    expect(result.response.assistant_text).toBe(QUESTION);
    expect(turnBranch()).toBe('noop_clarification_preserved');
  });

  it('falls back: a non-preserved no-op with an ambiguous message emits noop_fallback_copy', async () => {
    const FALLBACK = "I couldn't see a concrete change to make from that description. Tell me the specific factor and value you'd like, and I'll apply it directly.";
    hg.mockResolvedValue(makeNoOpResult(false, FALLBACK));
    const result = await run('hmm, not sure');
    expect(result.response.assistant_text).toBe(FALLBACK);
    expect(turnBranch()).toBe('noop_fallback_copy');
  });
});
