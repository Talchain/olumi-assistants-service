/**
 * V5 Signature Loop Reliability — route-v2 integration proof.
 *
 * Drives `POST /orchestrate/v2/turn` end-to-end with mocked LLM + session store
 * and proves the route-level guards added by this lane:
 *   - behaviour #1: a confirmation phrase with a live, graph-safe proposal does
 *     NOT enter `dispatchEditGraph` (it falls through to TurnExecutor to apply);
 *   - amendment #3: a confirmation phrase with NO live proposal returns the
 *     helpful no-live-proposal clarification, NOT an edit_graph no-op;
 *   - amendment #4: a pending-read FAILURE is observable and degrades safely;
 *   - behaviour #4: expired / hash-stale proposals are not treated as live;
 *   - behaviour #3: "what did you just change?" / "what did that update do?"
 *     route as a question, not an edit;
 *   - behaviour #6: a concrete value edit still deflects via the value-update
 *     gate (and is NOT mistaken for a proposal confirmation);
 *   - Fix D: a refresh-continuation (prior turns exist, frame stage, no graph)
 *     suppresses draft_graph / frame-no-brief so memory is read; a fresh
 *     scenario still drafts.
 *
 * Mocking strategy mirrors `route-v2-edit-lifecycle.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import type { PendingAction } from '../../../src/orchestrator-v5/session/pending-action.js';

const dispatchEditGraphMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
}));

const dispatchDraftGraphMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: dispatchDraftGraphMock,
}));

// Mutable per-test session-store behaviour.
let pendingActionsForRead: readonly PendingAction[] = [];
let pendingReadShouldThrow = false;
let hasPriorTurnsResult = false;

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    readMostRecentPendingActions: async () => {
      if (pendingReadShouldThrow) throw new Error('simulated pending read failure');
      return pendingActionsForRead;
    },
    hasPriorTurns: async () => hasPriorTurnsResult,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: async () => ({
      content: [{ type: 'text', text: 'text-only response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: async () => ({
        content: [{ type: 'text', text: 'text-only response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'orchestratorV5') return true;
              if (featProp === 'pipelineV4Enabled') return false;
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

const telemetryEvents: Array<{ name: string; payload: Record<string, unknown> }> = [];
vi.mock('../../../src/utils/telemetry.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/utils/telemetry.js')>();
  return {
    ...original,
    emit: (name: string, payload: Record<string, unknown>) => {
      telemetryEvents.push({ name, payload });
      return original.emit(name as never, payload as never);
    },
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');

const SCENARIO_ID = '55555555-5555-4555-8555-555555555555';

const GRAPH_STATE = {
  nodes: [
    { id: 'opt-1', kind: 'option', label: 'Option A — Hire now' },
    { id: 'fac-1', kind: 'factor', label: 'Hiring and Salary Cost' },
    { id: 'fac-2', kind: 'factor', label: 'Revenue' },
  ],
  edges: [
    { from: 'fac-1', to: 'opt-1' },
    { from: 'fac-2', to: 'opt-1' },
  ],
};

const REQUEST_GRAPH_HASH = computeAnalysisAffectingGraphHash(GRAPH_STATE as never) ?? 'h_unset';

function liveProposal(overrides: {
  graphHash?: string;
  expiresAtIso?: string;
  ref?: string;
} = {}): PendingAction {
  const ref = overrides.ref ?? 'prop_signature';
  return {
    id: `pa-${ref}`,
    scenario_id: SCENARIO_ID,
    chip_id: ref,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: ref,
      inline_patch: {
        handler_id: 'set_factor_value',
        params: { value: 20 },
        target_entity_ids: ['fac-2'],
      },
      public_label: 'Set Revenue to around 20',
      public_message: 'Set Revenue to around 20.',
    },
    preconditions: { graph_hash: overrides.graphHash ?? REQUEST_GRAPH_HASH },
    expires_at_turn_count: 2,
    expires_at_iso: overrides.expiresAtIso ?? '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-06-10T11:59:00.000Z',
  } as PendingAction;
}

function payload(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: '22222222-2222-4222-8222-222222222222',
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    message: 'placeholder',
    turn_class: 'propose',
    source: 'composer',
    graph_state: GRAPH_STATE,
    ...overrides,
  };
}

function emittedNames(): string[] {
  return telemetryEvents.map((e) => e.name);
}
function findEvent(name: string): Record<string, unknown> | undefined {
  return telemetryEvents.find((e) => e.name === name)?.payload;
}

describe('POST /orchestrate/v2/turn — V5 Signature Loop guards', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    dispatchEditGraphMock.mockReset();
    dispatchDraftGraphMock.mockReset();
    appendMock.mockClear();
    telemetryEvents.length = 0;
    pendingActionsForRead = [];
    pendingReadShouldThrow = false;
    hasPriorTurnsResult = false;
  });

  // ── behaviour #1 + #2: confirmation beats edit routing ──────────────────
  // NB: once edit routing is suppressed the turn falls through to TurnExecutor
  // and ATTEMPTS the apply; the apply mechanics (stubbed handler registry) are
  // proven in proposed-change-route-level.test.ts, so here we assert only the
  // routing invariant + the suppression telemetry (the wire status of the apply
  // in this minimal harness is not the contract under test).
  // All three confirmation phrases ("update the model" included — it has
  // isValueUpdate=false / proposalConfirm=true, so it takes the resolver path,
  // NOT the value-update gate) are routed to APPLY: suppressed_live, NOT
  // edit_graph, and NOT the no-live-proposal clarification dead-end. The apply
  // itself (handler dispatch + consume) is proven against the stubbed registry
  // in proposed-change-route-level.test.ts.
  it.each(['make that update', 'make that change', 'update the model'])(
    'T1: confirmation "%s" + live proposal → suppressed_live (routed to apply, not edit_graph, not clarification)',
    async (message) => {
      pendingActionsForRead = [liveProposal()];
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: payload({ message, turn_id: '22222222-2222-4222-8222-2222222222b1' }),
      });
      expect(dispatchEditGraphMock).not.toHaveBeenCalled();
      const resolved = findEvent('v5.edit_graph.proposal_confirm_resolved');
      expect(resolved).toBeDefined();
      expect(resolved!.outcome).toBe('suppressed_live');
      const body = JSON.parse(res.body) as { assistant_text?: string };
      expect(body.assistant_text ?? '').not.toContain("I don't have a pending suggested update");
    },
  );

  // ── amendment #3: no-live-proposal clarification (no edit no-op dead-end) ─
  it('amendment #3: "make that update" with NO live proposal returns the clarification, not edit no-op', async () => {
    pendingActionsForRead = [];
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'make that update' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(findEvent('v5.edit_graph.proposal_confirm_resolved')!.outcome).toBe('clarify_none');
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain("I don't have a pending suggested update");
  });

  // ── amendment #4: pending-read failure is observable + degrades safely ───
  it('amendment #4: a pending-read FAILURE degrades to suppression with a distinct trace', async () => {
    pendingReadShouldThrow = true;
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'make that update' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(findEvent('v5.edit_graph.proposal_confirm_resolved')!.outcome).toBe('suppressed_read_failed');
  });

  // ── behaviour #4: stale proposals are not treated as live ───────────────
  it('behaviour #4: a hash-stale proposal yields the clarification, not an apply', async () => {
    pendingActionsForRead = [liveProposal({ graphHash: 'stale_hash_does_not_match' })];
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'make that update' }),
    });
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(findEvent('v5.edit_graph.proposal_confirm_resolved')!.outcome).toBe('clarify_hash_mismatch');
  });

  it('behaviour #4: an expired proposal yields the clarification', async () => {
    pendingActionsForRead = [liveProposal({ expiresAtIso: '2020-01-01T00:00:00.000Z' })];
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'make that update' }),
    });
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(findEvent('v5.edit_graph.proposal_confirm_resolved')!.outcome).toBe('clarify_expired');
  });

  // ── behaviour #3: "what changed?" is a question, not an edit ─────────────
  it.each([
    'what did you just change?',
    'what did that update do?',
  ])('behaviour #3: state-query "%s" does NOT enter edit_graph', async (message) => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message, turn_id: '22222222-2222-4222-8222-2222222222c1' }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(findEvent('v5.edit_graph.state_query_suppressed')).toBeDefined();
  });

  // ── behaviour #6: concrete value edit deflects via the value-update gate ─
  it('behaviour #6: "Set Revenue to 20" deflects to the value path, not edit_graph, not a confirmation', async () => {
    pendingActionsForRead = [liveProposal()]; // even with a live proposal, a concrete edit is NOT a confirmation
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({ message: 'Set Revenue to 20' }),
    });
    expect(dispatchEditGraphMock).not.toHaveBeenCalled();
    expect(emittedNames()).not.toContain('v5.edit_graph.proposal_confirm_resolved');
  });

  // ── Fix D: refresh-continuation routing ─────────────────────────────────
  it('D1: a brief at frame stage with prior turns is a CONTINUATION → no draft_graph', async () => {
    hasPriorTurnsResult = true;
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'Should we hire a tech lead or two developers this quarter?',
        stage: 'frame',
        graph_state: undefined,
        turn_id: '22222222-2222-4222-8222-2222222222d1',
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    const guard = findEvent('v5.continuation.guard_applied');
    expect(guard).toBeDefined();
    expect(guard!.guard).toBe('draft_graph');
    expect(guard!.prior_turns_present).toBe(true);
  });

  it('D1b: a non-brief follow-up at frame stage with prior turns does NOT get the "start over" framing prompt', async () => {
    hasPriorTurnsResult = true;
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'remind me what we decided',
        stage: 'frame',
        graph_state: undefined,
        turn_id: '22222222-2222-4222-8222-2222222222d2',
      }),
    });
    expect(res.statusCode).toBe(200);
    const guard = findEvent('v5.continuation.guard_applied');
    expect(guard).toBeDefined();
    expect(guard!.guard).toBe('frame_no_brief');
    const body = JSON.parse(res.body);
    expect(body.assistant_text).not.toContain('I need a single decision question');
  });

  it('D2: a fresh scenario (no prior turns) at frame stage STILL drafts', async () => {
    hasPriorTurnsResult = false;
    dispatchDraftGraphMock.mockResolvedValueOnce({
      response: {
        response_version: 2 as const,
        assistant_text: 'Here is a first model.',
        blocks: [] as const,
        suggested_actions: [] as const,
        insights: [] as const,
        stage_indicator: 'frame' as const,
      },
      commitPerformed: true,
      graph: null,
    });
    await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload({
        message: 'Should we hire a tech lead or two developers this quarter?',
        stage: 'frame',
        graph_state: undefined,
        turn_id: '22222222-2222-4222-8222-2222222222d3',
      }),
    });
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    expect(emittedNames()).not.toContain('v5.continuation.guard_applied');
  });
});
