/**
 * ⭐ ROADMAP 2.1261 — `editInstructionOverride` substitutes ONLY the edit
 * LLM's instruction; the RECORD stays the user's own bytes.
 *
 * Two properties, each with its opposite-direction twin:
 *   1. With the override set, `handleEditGraph` receives the override — and
 *      the commit's `userMessage` remains `payload.message` (trap 14b: a
 *      synthesised sentence must never be persisted as what the user typed).
 *   2. Without it, `handleEditGraph` receives `payload.message`, byte-
 *      identical to the pre-2.1261 dispatch.
 *
 * Harness modelled on `edit-graph-dispatch-turn-event.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
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
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    loadPersistedGraphStrict: vi.fn().mockResolvedValue(null),
  };
});
vi.mock('../../../adapters/llm/prompt-loader.js', () => ({
  getSystemPromptMeta: vi.fn(() => ({
    taskId: 'edit_graph',
    source: 'store',
    promptId: 'edit_graph_default',
    version: 9,
    prompt_version: 'edit_graph_default@v9 (production)',
    prompt_hash: '313665a4',
  })),
}));

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { setTestSink } from '../../../utils/telemetry.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc';
const STUB_REQUEST = {} as FastifyRequest;

/** The witnessed trapped message, byte-verbatim (a2-turn3-request.json). */
const USER_MESSAGE = 'Set it to 0.12.';
/** The bind instruction the route derives (probe P1 format, user value). */
const INSTRUCTION =
  "Set the subcontracting inner-city deliveries to a green courier option's " +
  'effect on Subcontractor cost as share of affected revenue to 0.12.';

function makePayload() {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'frame' as const,
    message: USER_MESSAGE,
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

const INGRESS_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Protect margin' },
    { id: 'fac_sub_cost', kind: 'factor', label: 'Subcontractor cost as share of affected revenue' },
    { id: 'opt_sub', kind: 'option', label: 'subcontracting inner-city deliveries to a green courier' },
  ],
  edges: [
    { from: 'opt_sub', to: 'fac_sub_cost' },
    { from: 'fac_sub_cost', to: 'goal_1' },
  ],
};

function makeNoOpResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Nothing to change.',
    latencyMs: 50,
    appliedGraph: null,
    wasRejected: false,
  };
}

const hg = handleEditGraph as MockedFunction<typeof handleEditGraph>;
const commit = commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;

beforeEach(() => {
  vi.clearAllMocks();
  commit.mockResolvedValue({
    response: {},
    performed: true as const,
    persisted_row_id: 'row-1',
    graphPersisted: false,
  } as Awaited<ReturnType<typeof commitDirectAnswer>>);
  hg.mockResolvedValue(makeNoOpResult());
  setTestSink(() => {});
});

afterEach(() => {
  setTestSink(null);
});

async function run(withOverride: boolean) {
  return dispatchEditGraph({
    payload: makePayload(),
    requestId: 'req-override',
    request: STUB_REQUEST,
    graphState: INGRESS_GRAPH,
    analysisState: null,
    ...(withOverride ? { editInstructionOverride: INSTRUCTION } : {}),
  });
}

describe('editInstructionOverride (ROADMAP 2.1261)', () => {
  it('substitutes the edit instruction — and ONLY the instruction', async () => {
    await run(true);
    expect(hg).toHaveBeenCalledTimes(1);
    // handleEditGraph(context, editDescription, adapter, requestId, turnId)
    expect(hg.mock.calls[0]![1]).toBe(INSTRUCTION);
    // Trap 14b — the record: the commit persists the USER's bytes, never the
    // synthesised instruction.
    expect(commit).toHaveBeenCalledTimes(1);
    const commitOpts = commit.mock.calls[0]![1] as { userMessage?: string };
    expect(commitOpts.userMessage).toBe(USER_MESSAGE);
  });

  it('without the override the dispatch is byte-identical to before', async () => {
    await run(false);
    expect(hg).toHaveBeenCalledTimes(1);
    expect(hg.mock.calls[0]![1]).toBe(USER_MESSAGE);
    const commitOpts = commit.mock.calls[0]![1] as { userMessage?: string };
    expect(commitOpts.userMessage).toBe(USER_MESSAGE);
  });
});
