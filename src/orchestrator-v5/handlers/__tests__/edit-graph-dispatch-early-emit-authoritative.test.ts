/**
 * PR #216 review BLOCKER regression — end-to-end `dispatchEditGraph`.
 *
 * The pre-LLM proposal intercept emits an authoritative Stage 1 / Stage 2
 * response. The later no-op recovery layer must NOT overwrite or append
 * to it via ANY branch. Before the fix, the exact failing-style
 * agreement (which also satisfies `looksLikeVagueEdit`) caused the
 * recovery to return "I haven't changed the model yet. Tell me which
 * factor or edge..." copy that overwrote the Stage 1 text while leaving
 * the proposal chips in place.
 *
 * This drives the FULL dispatch (not just decideNoOpRecovery) and pins:
 *   - final assistant_text is the Stage 1 copy (clean concept, no
 *     "I haven't changed the model", no "factor or edge");
 *   - exactly 3 chips with the Stage 1 labels, no duplicates;
 *   - the commit persisted a refreshed `proposed_concept` pending;
 *   - exactly one `V5ProposalContinuationResumed` emit, pre_llm: true;
 *   - llm_calls_used === 0 (no LLM call on the early-emit path).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

import type { PendingAction } from '../../session/pending-action.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({
  // Must NOT be called on the early-emit path. If it is, the intercept
  // failed to short-circuit and the test's handleEditGraph assertion
  // catches it.
  handleEditGraph: vi.fn().mockResolvedValue({
    blocks: [],
    assistantText: 'Mock LLM result (should not be used on early-emit).',
    latencyMs: 5,
    appliedGraph: null,
    wasRejected: false,
  }),
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

// `vi.mock` is hoisted above module-body consts, so the fixture must be
// created inside a `vi.hoisted` block to be referenceable from the mock
// factory. The test body reads it back from the same binding.
const { validPending } = vi.hoisted(() => ({
  validPending: {
    id: 'pa_valid_1',
    scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    chip_id: 'pa_valid_1',
    action: {
      kind: 'proposed_concept',
      concept: 'team morale',
      preferred_kind: 'factor',
      public_label: 'Continue with the proposed update',
      public_message: 'Continue with team morale.',
    },
    // No graph_hash precondition → no divergence rejection; far-future
    // expiry → not expired. The resume gate is satisfied.
    preconditions: {},
    expires_at_turn_count: 2,
    expires_at_iso: '2099-01-01T00:00:00.000Z',
    emitted_at_iso: '2026-05-29T00:00:00.000Z',
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
}));

const emitMock = vi.fn();
vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: (...a: unknown[]) => emitMock(...a) };
});

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { buildTurnContext } from '../../build-turn-context.js';
import { TelemetryEvents } from '../../../utils/telemetry.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STUB_REQUEST = {} as FastifyRequest;

const TRANSCRIPT =
  "That's a good idea. Let's involve the team in the hiring process. "
  + 'For that risk, how should we update the decision model?';

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

function emitCount(name: string): number {
  return emitMock.mock.calls.filter((c) => c[0] === name).length;
}
function emitPayloads(name: string): Record<string, unknown>[] {
  return emitMock.mock.calls
    .filter((c) => c[0] === name)
    .map((c) => c[1] as Record<string, unknown>);
}

describe('dispatchEditGraph — pre-LLM early-emit is authoritative (BLOCKER regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('the exact failing transcript: Stage 1 survives; recovery does not overwrite', async () => {
    const result = await dispatchEditGraph({
      payload: {
        kind: 'message', scenario_id: SCENARIO_ID, turn_id: 'turn-1',
        stage: 'analyse', message: TRANSCRIPT, turn_class: 'review', source: 'composer',
      },
      requestId: 'req-early-emit-1',
      request: STUB_REQUEST,
      graphState: makeGraph(),
      analysisState: null,
    });

    const text = result.response.assistant_text ?? '';
    const chips = result.response.suggested_actions ?? [];
    const labels = chips.map((c) => c.label);

    // handleEditGraph must NOT have been called (intercept short-circuit).
    expect(handleEditGraph).not.toHaveBeenCalled();

    // Final text is the Stage 1 copy — NOT the vague-edit overwrite.
    expect(text).toContain('team morale');
    expect(text).toContain('carry that forward');
    expect(text).not.toContain("haven't changed the model");
    expect(text).not.toContain('factor or edge');

    // Exactly the 3 Stage 1 chips, no duplicates.
    expect(chips).toHaveLength(3);
    expect(labels).toEqual(['Add as risk', 'Add as factor', 'Keep as note']);
    expect(new Set(labels).size).toBe(3);

    // Exactly one resumed telemetry, pre_llm: true (no duplicate
    // pre_llm:false from the recovery layer).
    expect(emitCount(TelemetryEvents.V5ProposalContinuationResumed)).toBe(1);
    expect(emitPayloads(TelemetryEvents.V5ProposalContinuationResumed)[0]).toMatchObject({
      outcome: 'stage_one',
      pre_llm: true,
    });

    // Commit persisted a refreshed proposed_concept pending action, and
    // recorded zero LLM calls for the deterministic early-emit path.
    expect(commitMock).toHaveBeenCalledTimes(1);
    const meta = commitMock.mock.calls[0][1] as {
      llm_calls_used: number;
      pending_actions?: readonly PendingAction[];
    };
    expect(meta.llm_calls_used).toBe(0);
    expect(meta.pending_actions).toBeDefined();
    expect(meta.pending_actions!.some((p) => p.action.kind === 'proposed_concept')).toBe(true);
  });

  // PR #216 round-3 review (SHOULD-FIX): the early-emit refresh must NOT
  // depend on the later buildTurnContext pending read. Here the
  // intercept's loadMostRecentPendingActions returns the valid pending
  // (so Stage 1 emits), but buildTurnContext degrades — its
  // most_recent_pending_actions comes back empty. The refreshed
  // proposed_concept pending must STILL be persisted (built in the
  // intercept), so the next Stage 1 → Stage 2 click can resume.
  it('refreshes the pending even when the later buildTurnContext read degrades', async () => {
    vi.mocked(buildTurnContext).mockResolvedValueOnce({
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
      most_recent_pending_actions: [], // ← degraded: no pending returned
    } as unknown as Awaited<ReturnType<typeof buildTurnContext>>);

    const result = await dispatchEditGraph({
      payload: {
        kind: 'message', scenario_id: SCENARIO_ID, turn_id: 'turn-1',
        stage: 'analyse', message: TRANSCRIPT, turn_class: 'review', source: 'composer',
      },
      requestId: 'req-early-emit-degraded',
      request: STUB_REQUEST,
      graphState: makeGraph(),
      analysisState: null,
    });

    // Stage 1 still authoritative.
    expect(result.response.assistant_text ?? '').toContain('team morale');
    expect(result.response.suggested_actions ?? []).toHaveLength(3);

    // Pending STILL refreshed despite the degraded second read.
    const meta = commitMock.mock.calls[0][1] as {
      pending_actions?: readonly PendingAction[];
    };
    expect(meta.pending_actions).toBeDefined();
    expect(meta.pending_actions!.some((p) => p.action.kind === 'proposed_concept')).toBe(true);
  });

  it('does NOT emit V5EditGraphNoOpRecovery on the early-emit path', async () => {
    await dispatchEditGraph({
      payload: {
        kind: 'message', scenario_id: SCENARIO_ID, turn_id: 'turn-1',
        stage: 'analyse', message: TRANSCRIPT, turn_class: 'review', source: 'composer',
      },
      requestId: 'req-early-emit-no-noise',
      request: STUB_REQUEST,
      graphState: makeGraph(),
      analysisState: null,
    });
    expect(emitCount(TelemetryEvents.V5EditGraphNoOpRecovery)).toBe(0);
  });
});
