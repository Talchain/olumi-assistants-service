/**
 * Lane 22 (live 2026-07-07 session, 3-for-3 edit-lane failure) —
 * proposal-continuation resume + telemetry visibility, end-to-end through
 * `dispatchEditGraph`.
 *
 * Three defects pinned here:
 *
 *   1. LIVE MISS: assistant proposed "add the 20% velocity target as a
 *      constraint" (captured OK), user replied "Yes, add that velocity
 *      target." → the agreement matcher said no-match → the turn fell
 *      through to the V4 edit LLM and no-oped. The reply must resume
 *      Stage 1 deterministically, without an LLM call.
 *
 *   2. SILENT PRE-LLM DECLINE: when a live, valid pending proposal exists
 *      but the matcher declines, the pre-LLM gate emitted NOTHING
 *      (rejection:null → no telemetry), so the matcher's miss rate was
 *      invisible. The gate must emit
 *      `V5ProposalContinuationResumed{outcome:'no_agreement', pre_llm:true}`.
 *
 *   3. INVISIBLE OPS-PRODUCED MISS: when the LLM went on to produce
 *      operations (applied OR rejected) while a valid pending proposal
 *      existed, no continuation outcome was emitted at all (the
 *      zero-operations recovery sub-case was the only emitter). The
 *      dispatch must emit the no-match outcome with `ops_produced:true`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

import type { PendingAction } from '../../session/pending-action.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

const editGraphMock = vi.fn();
vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({
  handleEditGraph: (...args: unknown[]) => editGraphMock(...args),
}));

const commitMock = vi.fn().mockResolvedValue({
  response: {},
  performed: true as const,
  persisted_row_id: 'row-1',
  graphPersisted: false,
});
vi.mock('../../commit.js', () => ({
  commitDirectAnswer: (...args: unknown[]) => commitMock(...args),
  computeRequestHash: vi.fn().mockReturnValue('sha256:test'),
}));

vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({}),
}));

// The exact live proposal concept class: captured from "add the 20%
// velocity target as a constraint". Far-future expiry, no graph_hash
// precondition → the resume gate is satisfied on every turn below.
const { validPending } = vi.hoisted(() => ({
  validPending: {
    id: 'pa_lane22_1',
    scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    chip_id: 'pa_lane22_1',
    action: {
      kind: 'proposed_concept',
      concept: 'velocity target',
      preferred_kind: 'either',
      public_label: 'Continue with the proposed update',
      public_message: 'Continue with velocity target.',
    },
    preconditions: {},
    expires_at_turn_count: 2,
    expires_at_iso: '2099-01-01T00:00:00.000Z',
    emitted_at_iso: '2026-07-07T00:00:00.000Z',
  } as PendingAction,
}));

vi.mock('../../build-turn-context.js', () => ({
  buildTurnContext: vi.fn().mockResolvedValue({
    prior_turns: [],
    prior_facts: [],
    scenarioBriefText: null,
    persistedGraph: null,
    most_recent_pending_actions: [validPending],
  }),
  loadMostRecentPendingActions: vi.fn().mockResolvedValue([validPending]),
  // ROADMAP 1.33: dispatchEditGraph reads this for the conversation-slice
  // feed. Empty — this suite exercises continuation telemetry, not
  // conversation history.
  loadRecentConversationTurns: vi.fn().mockResolvedValue([]),
}));

const emitMock = vi.fn();
vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: (...a: unknown[]) => emitMock(...a) };
});

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { TelemetryEvents } from '../../../utils/telemetry.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STUB_REQUEST = {} as FastifyRequest;

function makeGraph(): GraphStateIngress {
  const E = (from: string, to: string) => ({
    from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1,
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

function dispatch(message: string, requestId: string) {
  return dispatchEditGraph({
    payload: {
      kind: 'message', scenario_id: SCENARIO_ID, turn_id: 'turn-1',
      stage: 'analyse', message, turn_class: 'review', source: 'composer',
    },
    requestId,
    request: STUB_REQUEST,
    graphState: makeGraph(),
    analysisState: null,
  });
}

function resumedPayloads(): Record<string, unknown>[] {
  return emitMock.mock.calls
    .filter((c) => c[0] === TelemetryEvents.V5ProposalContinuationResumed)
    .map((c) => c[1] as Record<string, unknown>);
}

describe('dispatchEditGraph — Lane 22 continuation resume + telemetry visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default LLM result: legitimate zero-operations no-op.
    editGraphMock.mockResolvedValue({
      blocks: [],
      assistantText: 'No concrete change identified.',
      latencyMs: 5,
      appliedGraph: null,
      wasRejected: false,
    });
  });

  it('live miss #1: "Yes, add that velocity target." resumes Stage 1 pre-LLM (no LLM call)', async () => {
    const result = await dispatch('Yes, add that velocity target.', 'req-lane22-live-miss');

    expect(editGraphMock).not.toHaveBeenCalled();
    const text = result.response.assistant_text ?? '';
    expect(text).toContain('velocity target');
    const labels = (result.response.suggested_actions ?? []).map((c) => c.label);
    expect(labels).toEqual(['Add as risk', 'Add as factor', 'Keep as note']);

    const resumed = resumedPayloads();
    expect(resumed).toHaveLength(1);
    expect(resumed[0]).toMatchObject({ outcome: 'stage_one', pre_llm: true });
  });

  it('pre-LLM gate no-match is EMITTED (not silent) when a valid pending exists', async () => {
    await dispatch('Walk me through the market outlook.', 'req-lane22-nomatch');

    // The turn correctly fell through to the LLM…
    expect(editGraphMock).toHaveBeenCalledTimes(1);
    // …but the gate's decline is now measurable.
    const preLlm = resumedPayloads().filter(
      (p) => p.outcome === 'no_agreement' && p.pre_llm === true,
    );
    expect(preLlm).toHaveLength(1);
  });

  it('ops-produced path: a rejected LLM edit while a valid pending exists emits the missed-resume outcome', async () => {
    editGraphMock.mockResolvedValueOnce({
      blocks: [],
      assistantText: 'I was not able to apply that change.',
      latencyMs: 5,
      appliedGraph: null,
      wasRejected: true,
    });

    await dispatch('Rework the whole thing top to bottom.', 'req-lane22-rejected');

    const opsProduced = resumedPayloads().filter(
      (p) => p.outcome === 'no_agreement' && p.pre_llm === false && p.ops_produced === true,
    );
    expect(opsProduced).toHaveLength(1);
    expect(opsProduced[0]).toMatchObject({ edit_was_rejected: true });
  });
});
