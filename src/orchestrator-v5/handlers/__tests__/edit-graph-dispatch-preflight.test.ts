/**
 * Wave 3 — pre-LLM add-risk preflight test for `dispatchEditGraph`.
 *
 * Pins the brief's evidence #2 fix: at-limit add-risk requests must
 * NOT spend 16–18s in `handleEditGraph` only to be rejected by the
 * post-mutation validator. The preflight runs `wouldExceedAddRiskLimits`
 * synchronously and returns a structured rejection envelope with
 * specific recovery copy and executable chips.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({
  handleEditGraph: vi.fn().mockResolvedValue({
    blocks: [],
    assistantText: 'Mock LLM result.',
    latencyMs: 5,
    appliedGraph: null,
    wasRejected: false,
  }),
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn().mockResolvedValue({
    response: {},
    performed: true as const,
    persisted_row_id: 'row-1',
    graphPersisted: false,
  }),
  computeRequestHash: vi.fn().mockReturnValue('sha256:test'),
}));

vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({}),
}));

vi.mock('../../build-turn-context.js', () => ({
  buildTurnContext: vi.fn().mockResolvedValue({
    prior_turns: [],
    prior_facts: [],
    scenarioBriefText: null,
    persistedGraph: null,
    most_recent_pending_actions: [],
  }),
  // V5 P0 proposal-memory continuation — the pre-LLM intercept in
  // dispatchEditGraph calls this load helper. The mock returns an empty
  // array so the intercept's `findProposedConceptEntry` returns null,
  // the gate emits no telemetry, and control falls through to
  // handleEditGraph exactly as the test expects.
  loadMostRecentPendingActions: vi.fn().mockResolvedValue([]),
}));

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { setTestSink } from '../../../utils/telemetry.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function makePayload(message: string) {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: 'turn-1',
    stage: 'analyse' as const,
    message,
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

/**
 * Build a canonical GraphV3 with the requested counts. Includes the
 * required goal/decision/options so strict GraphV3 parse succeeds (the
 * preflight only fires when the ingress passed strict parse — otherwise
 * dispatchEditGraph falls through to the LLM path unconditionally).
 */
function makeAtLimitGraph(extraFactors: number, extraEdges: number): GraphStateIngress {
  const baseNodes = [
    { id: 'goal_g', kind: 'goal', label: 'Goal' },
    { id: 'dec_d', kind: 'decision', label: 'Decision' },
    { id: 'opt_a', kind: 'option', label: 'Option A' },
    { id: 'opt_b', kind: 'option', label: 'Option B' },
  ] as const;
  const factors = Array.from({ length: extraFactors }, (_, i) => ({
    id: `fac_${i}`,
    kind: 'factor' as const,
    label: `Factor ${i}`,
  }));
  const E = (from: string, to: string) => ({
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive' as const,
  });
  const baseEdges = [
    E('dec_d', 'opt_a'),
    E('dec_d', 'opt_b'),
    E('opt_a', 'goal_g'),
    E('opt_b', 'goal_g'),
  ];
  const padEdges = Array.from({ length: extraEdges }, (_, i) =>
    E(`fac_${i % Math.max(1, extraFactors)}`, 'goal_g'),
  );
  return {
    nodes: [...baseNodes, ...factors],
    edges: [...baseEdges, ...padEdges],
  };
}

const STUB_REQUEST = {} as FastifyRequest;

let capturedEvents: Array<{ event: string; data: Record<string, unknown> }> = [];
const editGraphTurnEvents = () => capturedEvents.filter((e) => e.event === 'v5.edit_graph.turn');

describe('dispatchEditGraph — pre-LLM add-risk preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedEvents = [];
    setTestSink((event, data) => capturedEvents.push({ event, data }));
  });
  afterEach(() => setTestSink(null));

  it('at node-limit, "add X as a risk" returns a preflight rejection without calling handleEditGraph', async () => {
    // 20-node graph: 4 base + 16 factors → next add would be 21 > 20 limit.
    const graph = makeAtLimitGraph(16, 5);
    const result = await dispatchEditGraph({
      payload: makePayload('Add cultural cohesion as a risk'),
      requestId: 'req-preflight-node',
      request: STUB_REQUEST,
      graphState: graph,
      analysisState: null,
    });

    expect(handleEditGraph as MockedFunction<typeof handleEditGraph>).not.toHaveBeenCalled();
    expect(result.response.assistant_text).toContain("can't add another risk");
    // Recovery suggestions are surfaced inline in assistant_text,
    // not as chips. The brief's "every chip must be actionable" rule
    // means we do not emit prompt-replay chips that promise flows
    // (deterministic rebuild, remove-then-add) that do not exist in
    // this tranche.
    expect(result.response.assistant_text).toContain('simplify the model');
    expect(result.response.assistant_text).toContain('replace');
    expect((result.response.suggested_actions ?? []).length).toBe(0);
  });

  it('at edge-limit, "add X as a risk" returns a preflight rejection without calling handleEditGraph', async () => {
    // 5 factors + 4 base + 25 pad edges = 29 edges; +2 projected = 31 > 30 limit.
    const graph = makeAtLimitGraph(5, 25);
    await dispatchEditGraph({
      payload: makePayload('Please add team dynamics as a risk'),
      requestId: 'req-preflight-edge',
      request: STUB_REQUEST,
      graphState: graph,
      analysisState: null,
    });
    expect(handleEditGraph as MockedFunction<typeof handleEditGraph>).not.toHaveBeenCalled();
  });

  it('under both limits, deterministic clarification is emitted (handler still NOT called for add_risk)', async () => {
    // 7-node graph — well under the 20 node and 30 edge limits.
    const graph = makeAtLimitGraph(3, 3);
    const result = await dispatchEditGraph({
      payload: makePayload('Add cultural cohesion as a risk'),
      requestId: 'req-under-limit',
      request: STUB_REQUEST,
      graphState: graph,
      analysisState: null,
    });
    // Even under-limit, the high-confidence add_risk classifier
    // intercepts and asks for the missing driver — handleEditGraph is
    // still skipped on this branch (pre-existing A4 behaviour).
    expect(handleEditGraph as MockedFunction<typeof handleEditGraph>).not.toHaveBeenCalled();
    expect(result.response.assistant_text).toContain('What factor drives it most');
    expect(result.response.assistant_text).not.toContain("can't add another risk");
  });

  it('non-add-risk requests still reach handleEditGraph regardless of limits', async () => {
    // At the node limit, but the message is a value update, not an
    // add-risk. Preflight only gates the add-risk path. The mock
    // returns a minimal applied result so the downstream pipeline runs.
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValueOnce({
      blocks: [],
      assistantText: 'Updated.',
      latencyMs: 5,
      appliedGraph: null,
      wasRejected: false,
    } satisfies EditGraphResult);
    const graph = makeAtLimitGraph(16, 5);
    await dispatchEditGraph({
      payload: makePayload('Increase the budget to £50,000'),
      requestId: 'req-non-add-risk',
      request: STUB_REQUEST,
      graphState: graph,
      analysisState: null,
    });
    expect(handleEditGraph as MockedFunction<typeof handleEditGraph>).toHaveBeenCalled();
  });

  // R7 dispatcher-wiring coverage (review follow-up): the helper unit tests pin
  // the outcome classification + precedence; these drive the REAL add-risk
  // branches through dispatchEditGraph and assert the emitted turn-event outcome.
  it('R7: edge-limit add-risk preflight emits one turn event with outcome=rejected + the cap failure_code', async () => {
    await dispatchEditGraph({
      payload: makePayload('Please add team dynamics as a risk'),
      requestId: 'req-ev-edge',
      request: STUB_REQUEST,
      graphState: makeAtLimitGraph(5, 25),
      analysisState: null,
    });
    const te = editGraphTurnEvents();
    expect(te).toHaveLength(1);
    expect(te[0]!.data.outcome).toBe('rejected');
    expect(te[0]!.data.failure_code).toBe('EDGE_LIMIT_EXCEEDED_PREFLIGHT');
  });

  it('R7 (NB-3): under-limit add-risk clarification emits one turn event with outcome=clarify', async () => {
    const result = await dispatchEditGraph({
      payload: makePayload('Add cultural cohesion as a risk'),
      requestId: 'req-ev-clarify',
      request: STUB_REQUEST,
      graphState: makeAtLimitGraph(3, 3),
      analysisState: null,
    });
    // Confirms the deterministic add-risk clarification branch actually ran
    // (not the LLM path or a no-op), so outcome='clarify' is the wired result.
    expect(result.response.assistant_text).toContain('What factor drives it most');
    const te = editGraphTurnEvents();
    expect(te).toHaveLength(1);
    expect(te[0]!.data.outcome).toBe('clarify');
  });
});
