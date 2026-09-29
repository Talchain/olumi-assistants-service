/**
 * F-HELD fix 4a (A-variant) — the deterministic add-risk clarification must
 * persist the documented-but-never-emitted `edit_graph_add_risk` pending
 * action alongside the clarify turn, carrying the original risk label
 * (session/pending-action.ts kind doc: "preserves the original risk label
 * across the A4 missing-driver clarify turn") and the emit-time graph hash
 * so the driver-answer resume (routing/clarification-resume.ts) can hash-gate
 * the reply turn.
 *
 * RED baseline (wire capture 04c→10c, 2026-07-11): the clarify turn commits
 * with NO pending action, so the driver answer one turn later has nothing to
 * resume against and is dropped.
 *
 * Mock pattern mirrors edit-graph-dispatch-preflight.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

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
  loadMostRecentPendingActions: vi.fn().mockResolvedValue([]),
  loadRecentConversationTurns: vi.fn().mockResolvedValue([]),
}));

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { commitDirectAnswer } from '../../commit.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { parsePendingAction } from '../../session/pending-action.js';
import { GRAPH_MAX_NODES } from '../../../config/graphCaps.js';
import type { PendingAction } from '../../session/pending-action.js';
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

/** Small canonical GraphV3 so strict parse succeeds and limits are far away. */
const SMALL_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'goal_g', kind: 'goal', label: 'Goal' },
    { id: 'dec_d', kind: 'decision', label: 'Decision' },
    { id: 'opt_a', kind: 'option', label: 'Option A' },
    { id: 'opt_b', kind: 'option', label: 'Option B' },
    { id: 'fac_team_size', kind: 'factor', label: 'Team size' },
  ],
  edges: [
    {
      from: 'dec_d',
      to: 'opt_a',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_a',
      to: 'goal_g',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
} as GraphStateIngress;

const STUB_REQUEST = {} as FastifyRequest;

describe('dispatchEditGraph — add-risk clarify persists the edit_graph_add_risk pending (F-HELD 4a)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTestSink(() => {});
  });
  afterEach(() => setTestSink(null));

  it('persists ONE parse-valid edit_graph_add_risk pending carrying the risk label + emit-time graph hash', async () => {
    await dispatchEditGraph({
      payload: makePayload('Add client concentration as a risk'),
      requestId: 'req-add-risk-pending',
      request: STUB_REQUEST,
      graphState: SMALL_GRAPH,
      analysisState: null,
    });
    expect(handleEditGraph).not.toHaveBeenCalled();
    expect(commitDirectAnswer).toHaveBeenCalledTimes(1);
    const metadata = vi.mocked(commitDirectAnswer).mock.calls[0]![1] as {
      pending_actions?: readonly PendingAction[];
    };
    const pendings = metadata.pending_actions ?? [];
    expect(pendings).toHaveLength(1);
    const pending = pendings[0]!;
    expect(pending.action.kind).toBe('edit_graph_add_risk');
    if (pending.action.kind === 'edit_graph_add_risk') {
      expect(pending.action.label).toBe('client concentration');
    }
    // Hash-gated per house style: the resume is a mutating kind, so the
    // pending MUST carry the emit-time analysis-affecting graph hash.
    expect(pending.preconditions.graph_hash).toBe(
      computeAnalysisAffectingGraphHash(SMALL_GRAPH),
    );
    expect(pending.scenario_id).toBe(SCENARIO_ID);
    // Round-trips the session parser (the read side drops invalid entries).
    expect(parsePendingAction(pending)).not.toBeNull();
  });

  it('does NOT emit the pending on the preflight-rejection path (nothing to resume)', async () => {
    // ⚠ 2026-08-18: sized to the node cap rather than to the 20-node ceiling
    // that used to live in `graph-structure-validator.ts` (removed — absolute
    // graph size is `config/graphCaps.ts`' question now). Behaviour asserted is
    // unchanged: sit exactly ON the cap so the next add would exceed it.
    const factors = Array.from({ length: GRAPH_MAX_NODES - 4 }, (_, i) => ({
      id: `fac_${i}`,
      kind: 'factor' as const,
      label: `Factor ${i}`,
    }));
    const atLimit = {
      nodes: [...(SMALL_GRAPH.nodes as unknown[]).slice(0, 4), ...factors],
      edges: SMALL_GRAPH.edges,
    } as GraphStateIngress;
    await dispatchEditGraph({
      payload: makePayload('Add cultural cohesion as a risk'),
      requestId: 'req-add-risk-preflight',
      request: STUB_REQUEST,
      graphState: atLimit,
      analysisState: null,
    });
    expect(commitDirectAnswer).toHaveBeenCalledTimes(1);
    const metadata = vi.mocked(commitDirectAnswer).mock.calls[0]![1] as {
      pending_actions?: readonly PendingAction[];
    };
    expect(metadata.pending_actions ?? []).toHaveLength(0);
  });

  it('non-add-risk edits are unchanged (no pending_actions injected)', async () => {
    await dispatchEditGraph({
      payload: makePayload('Rename the team size factor to headcount please'),
      requestId: 'req-non-add-risk',
      request: STUB_REQUEST,
      graphState: SMALL_GRAPH,
      analysisState: null,
    });
    expect(commitDirectAnswer).toHaveBeenCalledTimes(1);
    const metadata = vi.mocked(commitDirectAnswer).mock.calls[0]![1] as {
      pending_actions?: readonly PendingAction[];
    };
    expect(metadata.pending_actions).toBeUndefined();
  });
});
