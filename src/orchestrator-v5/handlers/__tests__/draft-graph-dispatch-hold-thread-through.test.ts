/**
 * HOLD-WIPE fix (task_2e1b8c87) — draft-classified dispatch commits must
 * thread live holds through instead of silently wiping them.
 *
 * RED baseline (F-HELD round-2 KNOWN RESIDUAL): `dispatchDraftGraph`
 * commits with NO `priorPendingActions`, so a live consent hold is
 * destroyed by any draft/redraft turn — no notice, no telemetry.
 *
 * Doctrine at this seam mirrors the edit dispatcher
 * (edit-graph-dispatch-hold-thread-through.test.ts): a redraft replaces
 * the graph wholesale, so a hold whose operations no longer referee
 * cleanly against the NEW draft lapses HONESTLY (deterministic notice on
 * the wire response + redacted telemetry); a hold that still validates
 * threads through re-pinned; non-hold pendings pass through for the
 * commit carry-forward to bookkeep.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

vi.mock('../../../orchestrator/tools/draft-graph.js', () => ({
  handleDraftGraph: vi.fn(),
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../build-turn-context.js', () => ({
  buildTurnContext: vi.fn(),
  loadMostRecentPendingActions: vi.fn().mockResolvedValue([]),
  loadPersistedGraphStrict: vi.fn(),
  loadRecentConversationTurns: vi.fn().mockResolvedValue([]),
}));

import { dispatchDraftGraph } from '../draft-graph-dispatch.js';
import { handleDraftGraph } from '../../../orchestrator/tools/draft-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { loadMostRecentPendingActions } from '../../build-turn-context.js';
import { GM_HELD_HANDLER_ID } from '../edit-graph-referee-gate.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import type { PendingAction } from '../../session/pending-action.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import { setTestSink } from '../../../utils/telemetry.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUB_REQUEST = {} as FastifyRequest;

/** The graph the PRIOR session state was pinned against. */
const OLD_GRAPH = {
  nodes: [
    { id: 'goal_g', kind: 'goal', label: 'Goal' },
    { id: 'fac_team_size', kind: 'factor', label: 'Team size', observed_state: { value: 4 } },
  ],
  edges: [
    { from: 'fac_team_size', to: 'goal_g', strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
};

/** The NEW draft — a wholesale replacement with different node ids. */
const NEW_DRAFT_GRAPH = {
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'fac_demand', kind: 'factor', label: 'Demand', observed_state: { value: 0.5 } },
  ],
  edges: [
    { from: 'dec_launch', to: 'goal_revenue', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'fac_demand', to: 'goal_revenue', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
};

function hashOf(graph: unknown): string {
  const h = computeAnalysisAffectingGraphHash(graph as GraphStateIngress);
  if (h === null) throw new Error('fixture must hash');
  return h;
}

function makeGmHold(pin: string, operations: readonly unknown[]): PendingAction {
  const ref = 'gmh_abcdef123456';
  return {
    id: 'pend-hold-1',
    scenario_id: SCENARIO_ID,
    chip_id: ref,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: ref,
      inline_patch: {
        handler_id: GM_HELD_HANDLER_ID,
        apply_wiring: 'held_execute_v1',
        operations,
        operations_count: operations.length,
        candidate_id: 'cand-1',
        candidate_kind: 'update_node_field',
        mutation_class: 'tune',
        blocker_code: null,
        base_hash_match: true,
        params: {},
        target_entity_ids: [],
      },
      public_label: 'Continue with this change',
      public_message: 'Yes',
    },
    preconditions: { graph_hash: pin },
    expires_at_turn_count: 4,
    expires_at_iso: new Date(Date.now() + 600_000).toISOString(),
    emitted_at_iso: new Date().toISOString(),
  } as PendingAction;
}

function makePayload() {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'frame' as const,
    message: 'Should we launch the product now given demand and budget pressure?',
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

function makeDraftResult() {
  return {
    blocks: [],
    assistantText: 'Drafted a decision graph.',
    latencyMs: 1000,
    strengthenItems: [],
    coachingSummary: null,
    coachingWideningLog: null,
    coachingBiasSignals: null,
    draftWarnings: [],
    graphOutput: JSON.parse(JSON.stringify(NEW_DRAFT_GRAPH)),
  };
}

interface CapturedEvent {
  readonly name: string;
  readonly data: Record<string, unknown>;
}
let events: CapturedEvent[] = [];
const invalidatedEvents = () => events.filter((e) => e.name === 'v5.pending_action.invalidated');

type CommitMeta = {
  priorPendingActions?: readonly PendingAction[];
  graph_hash?: string;
};

function commitMeta(): CommitMeta {
  const calls = vi.mocked(commitDirectAnswer).mock.calls;
  expect(calls.length).toBe(1);
  return calls[0]![1] as CommitMeta;
}

beforeEach(() => {
  vi.clearAllMocks();
  events = [];
  setTestSink((name, data) => {
    events.push({ name, data });
  });
  vi.mocked(commitDirectAnswer).mockImplementation(async (resp) => ({
    response: resp,
    performed: true as const,
    persisted_row_id: 'row-1',
    graphPersisted: true,
    pendingLifecycle: {
      priorCount: 0,
      consumedCount: 0,
      supersededCount: 0,
      expiredWallCount: 0,
      expiredTurnsCount: 0,
      hashInvalidatedCount: 0,
      capDroppedCount: 0,
      survivedCount: 0,
    },
  }));
  vi.mocked(handleDraftGraph).mockResolvedValue(
    makeDraftResult() as Awaited<ReturnType<typeof handleDraftGraph>>,
  );
});

afterEach(() => setTestSink(null));

describe('dispatchDraftGraph — holds thread through draft commits (task_2e1b8c87)', () => {
  it('HONESTLY LAPSES a hold invalidated by the wholesale redraft: notice on the WIRE response + telemetry, hold excluded from the threaded priors', async () => {
    const pin = hashOf(OLD_GRAPH);
    const hold = makeGmHold(pin, [
      // Targets a node id that does not exist in the NEW draft.
      { op: 'update_node', path: 'fac_team_size', value: { observed_state: { value: 6 } } },
    ]);
    vi.mocked(loadMostRecentPendingActions).mockResolvedValue([hold]);

    const result = await dispatchDraftGraph({
      payload: makePayload(),
      requestId: 'req-draft-lapse',
      request: STUB_REQUEST,
    });

    const meta = commitMeta();
    // The prior pendings were read and threaded (the hold excluded, honestly).
    expect(meta.priorPendingActions).toBeDefined();
    expect((meta.priorPendingActions ?? []).map((p) => p.chip_id)).not.toContain(hold.chip_id);
    // The commit carries the NEW draft's hash for the carry-forward hash rule.
    expect(meta.graph_hash).toBe(hashOf(NEW_DRAFT_GRAPH));

    // The lapse notice ships on the FINAL wire response (the committed
    // provisional response is not sent to the client on this path).
    const text = result.response.assistant_text ?? '';
    expect(text).toContain("'Continue with this change'");
    expect(text).toContain('has lapsed because the model changed');

    const lapses = invalidatedEvents();
    expect(lapses).toHaveLength(1);
    expect(lapses[0]!.data).toMatchObject({
      scenario_id: SCENARIO_ID,
      reason: 'graph_hash_changed',
      kind: 'apply_proposed_change',
      site: 'draft_graph_dispatch',
    });
  });

  it('THREADS a hold whose operations still referee cleanly against the NEW draft, re-pinned to the new hash', async () => {
    const pin = hashOf(OLD_GRAPH);
    const hold = makeGmHold(pin, [
      // fac_demand EXISTS in the new draft — the tune is still coherent.
      { op: 'update_node', path: 'fac_demand', value: { observed_state: { value: 0.7 } } },
    ]);
    vi.mocked(loadMostRecentPendingActions).mockResolvedValue([hold]);

    const result = await dispatchDraftGraph({
      payload: makePayload(),
      requestId: 'req-draft-thread',
      request: STUB_REQUEST,
    });

    const meta = commitMeta();
    const threaded = meta.priorPendingActions ?? [];
    expect(threaded).toHaveLength(1);
    expect(threaded[0]!.chip_id).toBe(hold.chip_id);
    expect(threaded[0]!.preconditions.graph_hash).toBe(hashOf(NEW_DRAFT_GRAPH));

    expect(result.response.assistant_text ?? '').not.toContain('lapsed');
    expect(invalidatedEvents()).toHaveLength(0);
  });
});
