/**
 * The edit lane hands a turn back PRE-COMMIT when it resolved nothing.
 *
 * `dispatchEditGraph` commits via `commitDirectAnswer`, and `runTurnExecutor`
 * commits as well. So the ONLY safe place to decide "this lane cannot serve
 * this turn" is BEFORE the commit region — a fall-through decided after it
 * would write TWO turn rows for ONE turn.
 *
 * ⭐ WHY THIS FILE EXISTS SEPARATELY FROM THE ROUTE-LEVEL SUITE. The route
 * suite (`orchestrator/__tests__/route-v2-edit-lane-unresolved-fallthrough.test.ts`)
 * mocks `dispatchEditGraph`, so its commit count can only ever observe the
 * EXECUTOR's commit — it is structurally incapable of seeing this dispatch
 * commit as well. The double-commit hazard is fail-open and silent (two rows,
 * no exception, green suite), so it has to be pinned where the real dispatch
 * runs. `commitDirectAnswer` is mocked here purely as a COUNTER.
 *
 * ⛔ NARROWNESS, and it is derived from the producer rather than restated.
 * `pendingClarification` is assigned at exactly ONE site in
 * `orchestrator/tools/edit-graph.ts` (:2033/:2045, the `resolutionMode ===
 * 'clarify'` branch) and its `candidate_labels` IS
 * `targetResolution.alternatives.map(a => a.label)`. Zero labels is therefore
 * exactly "asked which one, with nothing to offer" — the witnessed shape. A
 * clarification that DID resolve alternatives keeps its current route and must
 * still commit.
 *
 * MUTATION-CHECK (each must RED the named test):
 *  - move the early return BELOW the commit region → 'does not commit' REDs.
 *  - drop the `candidate_labels.length === 0` conjunct → 'a clarification WITH
 *    alternatives still commits' REDs.
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

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { setTestSink } from '../../../utils/telemetry.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUB_REQUEST = {} as FastifyRequest;

/** The witnessed copy: `buildClarificationQuestion` with an EMPTY alternatives list. */
const BARE_QUESTION = 'Which option should I update?';
/** The same builder WITH alternatives — a clarification that resolved something. */
const RESOLVED_QUESTION = 'Which option should I update: Launch now or Wait?';

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

/**
 * The `resolutionMode === 'clarify'` return shape, reproduced from the producer
 * (`orchestrator/tools/edit-graph.ts:2036-2048`): `appliedGraph: null`,
 * `wasRejected: true`, and a `pendingClarification` whose `candidate_labels` is
 * the alternatives list.
 */
function makeClarifyResult(candidateLabels: string[], assistantText: string): EditGraphResult {
  return {
    blocks: [],
    assistantText,
    latencyMs: 50,
    appliedGraph: null,
    wasRejected: true,
    pendingClarification: {
      tool: 'edit_graph',
      original_edit_request: 'did my edit change which option comes out ahead',
      candidate_labels: candidateLabels,
    },
  } as EditGraphResult;
}

const hg = handleEditGraph as MockedFunction<typeof handleEditGraph>;
const commit = commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;

beforeEach(() => {
  vi.clearAllMocks();
  commit.mockResolvedValue({
    response: {},
    performed: true,
    persisted_row_id: 'r',
    graphPersisted: false,
  } as Awaited<ReturnType<typeof commitDirectAnswer>>);
  setTestSink(() => {});
});
afterEach(() => setTestSink(null));

async function run(message: string) {
  return dispatchEditGraph({
    payload: makePayload(message),
    requestId: 'req-fallthrough',
    request: STUB_REQUEST,
    graphState: INGRESS_GRAPH,
    analysisState: null,
  });
}

describe('dispatchEditGraph — the lane hands back a turn it could not resolve, PRE-COMMIT', () => {
  it('a clarification with ZERO candidate labels does not commit, and flags the hand-back', async () => {
    hg.mockResolvedValue(makeClarifyResult([], BARE_QUESTION));

    const result = await run('Did my edit change which option comes out ahead?');

    // ⭐ THE HAZARD, pinned by COUNTING. Nothing was persisted here, so the
    // executor's own commit downstream is the turn's only one.
    expect(commit).toHaveBeenCalledTimes(0);
    // The hand-back is explicit, and self-consistent: nothing committed,
    // nothing applied.
    expect(result.unresolvedClarificationFellThrough).toBe(true);
    expect(result.commitPerformed).toBe(false);
    expect(result.graph).toBeNull();
  });

  it('a clarification attached to an APPLIED graph does NOT fall through — the fail-closed belt', async () => {
    // Today no producer branch can reach this: the ONE site that sets
    // `pendingClarification` also sets `appliedGraph: null`. The
    // `appliedGraph === null` conjunct is therefore a belt against a FUTURE
    // branch attaching a clarification to a real mutation — falling through
    // there would discard an applied edit. Pinned rather than left as an
    // "equivalent mutant": without this case, deleting the conjunct is
    // invisible.
    const withApplied = {
      ...makeClarifyResult([], BARE_QUESTION),
      appliedGraph: { nodes: [], edges: [] },
    } as unknown as EditGraphResult;
    hg.mockResolvedValue(withApplied);

    const result = await run('Did my edit change which option comes out ahead?');

    expect(result.unresolvedClarificationFellThrough).toBeUndefined();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('a clarification WITH alternatives still commits and does NOT fall through', async () => {
    hg.mockResolvedValue(makeClarifyResult(['Launch now', 'Wait'], RESOLVED_QUESTION));

    const result = await run('change the launch option');

    // It resolved something — a useful "which of these two?" with chips is
    // worth more than a run delta, so this keeps its current route.
    expect(result.unresolvedClarificationFellThrough).toBeUndefined();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(result.commitPerformed).toBe(true);
  });
});
