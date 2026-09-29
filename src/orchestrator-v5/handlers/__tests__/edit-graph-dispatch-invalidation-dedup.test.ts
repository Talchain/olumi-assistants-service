/**
 * PR #216 review follow-up — `V5ProposalContinuationInvalidated`
 * single-emit guard.
 *
 * The proposal-resume gate runs in two places inside `dispatchEditGraph`:
 *   1. the pre-LLM intercept (before `handleEditGraph`); and
 *   2. the no-op recovery block (after `handleEditGraph` no-ops).
 *
 * Both read the SAME most-recent prior-turn pending. When that pending is
 * expired / graph-hash-diverged AND `handleEditGraph` no-ops, the gate
 * rejects in both places and (before the fix) emitted
 * `V5ProposalContinuationInvalidated` twice for one logical invalidation
 * — double-counting the metric.
 *
 * These tests pin:
 *   - exactly ONE invalidation emit when the intercept already reported it;
 *   - the recovery block STILL emits when the intercept did NOT
 *     (no over-suppression).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

import type { PendingAction } from '../../session/pending-action.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({
  // No-op result (wasRejected false, no operations, appliedGraph null)
  // → `successfulAppliedMutation` is false → the no-op recovery block
  // runs, which is where the second (duplicate) gate lives.
  handleEditGraph: vi.fn().mockResolvedValue({
    blocks: [],
    assistantText: 'Mock LLM no-op.',
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

// build-turn-context is mocked per-test (the pending actions differ
// between the two scenarios), so the factory is defined with mutable
// vars the tests reassign in beforeEach.
const buildTurnContextMock = vi.fn();
const loadMostRecentPendingActionsMock = vi.fn();
vi.mock('../../build-turn-context.js', () => ({
  buildTurnContext: (...args: unknown[]) => buildTurnContextMock(...args),
  loadMostRecentPendingActions: (...args: unknown[]) =>
    loadMostRecentPendingActionsMock(...args),
  // ROADMAP 1.33: dispatchEditGraph reads this for the conversation-slice
  // feed. Empty — this suite exercises invalidation-dedup, not
  // conversation history.
  loadRecentConversationTurns: vi.fn().mockResolvedValue([]),
}));

// Spy on `emit` while preserving TelemetryEvents + log + everything else.
vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return {
    ...actual,
    emit: vi.fn(),
  };
});

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { emit, TelemetryEvents } from '../../../utils/telemetry.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STUB_REQUEST = {} as FastifyRequest;

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

// Minimal canonical graph so freshness/hash derivation has something to
// chew on. Shape is not load-bearing for this test (the pending rejects
// on wall-clock TTL, which `resolveProposalResume` checks before the
// graph hash), but a parseable graph keeps the recovery block on its
// normal path.
function makeGraph(): GraphStateIngress {
  const E = (from: string, to: string) => ({
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive' as const,
  });
  return {
    nodes: [
      { id: 'goal_g', kind: 'goal', label: 'Goal' },
      { id: 'dec_d', kind: 'decision', label: 'Decision' },
      { id: 'opt_a', kind: 'option', label: 'Option A' },
      { id: 'opt_b', kind: 'option', label: 'Option B' },
    ],
    edges: [E('dec_d', 'opt_a'), E('dec_d', 'opt_b'), E('opt_a', 'goal_g'), E('opt_b', 'goal_g')],
  } as unknown as GraphStateIngress;
}

function expiredPending(): PendingAction {
  return {
    id: 'pa_expired_1',
    scenario_id: SCENARIO_ID,
    chip_id: 'pa_expired_1',
    action: {
      kind: 'proposed_concept',
      concept: 'team morale',
      preferred_kind: 'factor',
      public_label: 'Continue with the proposed update',
      public_message: 'Continue with team morale.',
    },
    // No graph_hash precondition → the gate cannot reject on hash; it
    // rejects on wall-clock TTL alone, isolating the expired_wall path.
    preconditions: {},
    expires_at_turn_count: 2,
    // Far in the past → isProposedConceptExpired(now) === true.
    expires_at_iso: '2000-01-01T00:00:00.000Z',
    emitted_at_iso: '2000-01-01T00:00:00.000Z',
  };
}

function countInvalidationEmits(): number {
  const mock = emit as unknown as { mock: { calls: unknown[][] } };
  return mock.mock.calls.filter(
    (c) => c[0] === TelemetryEvents.V5ProposalContinuationInvalidated,
  ).length;
}

describe('dispatchEditGraph — V5ProposalContinuationInvalidated single-emit guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits invalidated exactly ONCE when both gates see the same expired pending', async () => {
    const pending = expiredPending();
    // Intercept reads via loadMostRecentPendingActions; recovery reads
    // via buildTurnContext.most_recent_pending_actions — both return the
    // SAME expired pending, the production reality.
    loadMostRecentPendingActionsMock.mockResolvedValue([pending]);
    buildTurnContextMock.mockResolvedValue({
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
      most_recent_pending_actions: [pending],
    });

    await dispatchEditGraph({
      // Non-add-risk, non-agreement message → reaches the else branch;
      // expired short-circuits the gate before the agreement check.
      payload: makePayload('Tweak something in the model please.'),
      requestId: 'req-dedup-1',
      request: STUB_REQUEST,
      graphState: makeGraph(),
      analysisState: null,
    });

    expect(countInvalidationEmits()).toBe(1);
  });

  it('recovery block STILL emits invalidated when the intercept saw no pending (no over-suppression)', async () => {
    // Intercept sees nothing → no intercept emit, flag stays false.
    // Recovery sees the expired pending → must emit exactly once.
    loadMostRecentPendingActionsMock.mockResolvedValue([]);
    buildTurnContextMock.mockResolvedValue({
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
      most_recent_pending_actions: [expiredPending()],
    });

    await dispatchEditGraph({
      payload: makePayload('Tweak something in the model please.'),
      requestId: 'req-dedup-2',
      request: STUB_REQUEST,
      graphState: makeGraph(),
      analysisState: null,
    });

    expect(countInvalidationEmits()).toBe(1);
  });

  it('emits zero invalidations when there is no prior pending at all', async () => {
    loadMostRecentPendingActionsMock.mockResolvedValue([]);
    buildTurnContextMock.mockResolvedValue({
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
      most_recent_pending_actions: [],
    });

    await dispatchEditGraph({
      payload: makePayload('Tweak something in the model please.'),
      requestId: 'req-dedup-3',
      request: STUB_REQUEST,
      graphState: makeGraph(),
      analysisState: null,
    });

    expect(countInvalidationEmits()).toBe(0);
  });
});
