/**
 * F5 — a factor_value_edit REFUSED BY THE TURN FENCE is a KNOWN refusal, and
 * must be answered like one: the typed 409 the message path already returns
 * for the same error, never the retryable 500 that means "we do not know".
 *
 * SERVED EVIDENCE (the reason this file exists). Served CEE `caf7d1a`,
 * 25 Sep 2026, fresh guest scenario, two concurrent value edits on different
 * factors, 5 rounds (witness-canonical-state.sh S8): every round was TRUTHFUL
 * (the reread held exactly the writes whose replies said `applied`), but 3 of
 * the 5 refused racers answered `500 system_event_commit_failed,
 * retryable:true`. Render log for request 5bb2257f-c106-429d-85bc-cae61988f15b:
 * `TurnFenceRejectedError` — "a later turn has claimed this scenario
 * (generation 28146 < 28147) … the whole turn rolled back". The other two
 * refused racers lost the graph CAS instead and got the typed 409 (#1847).
 *
 * THE SPEC this pins is the repo's own, not a new one:
 * `turn-executor.ts` (V5 TURN FENCE — AMENDMENT A2) maps the same error on the
 * message path to the existing 409-class envelope — `GRAPH_DIVERGED`, with
 * `conflict_category: turn_fence_<verdict>` and a per-verdict
 * `recovery_action` (`superseded` → `refresh_and_reconfirm`, `stopped` →
 * `start_new_draft`). `dispatchFactorValueEdit`'s commit catch recognises only
 * `GraphStaleWriteError`, so the system-event path flattens a fence refusal to
 * the route's `system_event_commit_failed` 500 — the exact flattening A2 was
 * written to forbid. A retryable 500 invites a blind retry of a write another
 * turn has already superseded.
 *
 * WHERE THE FAKE THROWS: the real store raises `TurnFenceRejectedError` from
 * inside `append` (supabase-store.ts, the fence check inside the append
 * transaction), so the fake rejects `append` with the repo's own class.
 *
 *   CONTROL (positive): the same edit with an append that lands → 200, my
 *     target `applied`. Proves the harness reaches the commit.
 *   CONTROL (typed path works here): a graph-CAS refusal → 409 GRAPH_DIVERGED
 *     with no commit evidence (#1847, already served). Proves this harness can
 *     observe the typed envelope, so a RED below is the fence branch missing,
 *     not the harness.
 *   RED  superseded: 409 GRAPH_DIVERGED, not retryable, recovery_action
 *     refresh_and_reconfirm, conflict_category turn_fence_superseded, no
 *     commit evidence.
 *   RED  stopped: 409, recovery_action start_new_draft,
 *     conflict_category turn_fence_stopped, no commit evidence.
 *
 * NOT PINNED HERE (named so the fix is scoped knowingly):
 *   - `fence_verdict` on the 409 body: the system-event envelope in
 *     route-v2.ts forwards recovery_action / conflict_category /
 *     expected_base_graph_hash only; carrying fence_verdict there is a
 *     route-v2.ts change (a shared file, leased separately);
 *   - `unclaimed` / `unavailable` (infrastructure refusals): the message path
 *     answers 409 `retry_later`, the register route a 503 — an open design
 *     question, not decided by this fixture;
 *   - the other system-event writers (structural_*, edge_strength_edit,
 *     option_intervention_edit, goal_target_edit) share the gap by reading
 *     (`dispatch.ts` has no TurnFenceRejectedError branch); each needs its
 *     own case before its fix.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { GraphStaleWriteError } from '../../../src/orchestrator-v5/session/store.js';
import { TurnFenceRejectedError, type TurnFenceVerdict } from '../../../src/orchestrator-v5/session/turn-fence.js';

function buildPersistedGraph() {
  return {
    goal_node_id: 'g-revenue',
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: 'f-budget',
        kind: 'factor',
        label: 'Marketing budget',
        observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
      },
      { id: 'o-launch', kind: 'option', label: 'Launch now' },
    ],
    edges: [
      {
        from: 'f-budget',
        to: 'g-revenue',
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
  };
}

const appendMock = vi.fn();
let persisted: unknown = buildPersistedGraph();

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// The value edit is deterministic: any model call is itself a failure.
const llmChatMock = vi.fn();
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
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

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';
const TURN_ID_BASE = '44444444-4444-4444-8444-44444444444';
const SET_BUDGET_50K = { kind: 'factor_value_edit', target_id: 'f-budget', value: 0.5, raw_value: 50000, unit: '£' };

let app: FastifyInstance;

async function send(suffix: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'system_event',
      turn_id: `${TURN_ID_BASE}${suffix}`,
      scenario_id: SCENARIO_ID,
      stage: 'analyse',
      event: SET_BUDGET_50K,
    },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, unknown> };
}

function appliedTargets(body: Record<string, unknown>): unknown[] {
  const blocks = Array.isArray(body.blocks) ? (body.blocks as Array<Record<string, unknown>>) : [];
  return blocks.filter((b) => b?.type === 'graph_patch' && b.status === 'applied').map((b) => b.target_id);
}

function expectNoCommitEvidence(body: Record<string, unknown>) {
  expect(appliedTargets(body)).toEqual([]);
  expect(body.draft_graph).toBeUndefined();
  expect(body.model_version_receipt).toBeUndefined();
}

function details(body: Record<string, unknown>) {
  return body.details as
    | { retryable?: unknown; recovery_action?: unknown; conflict_category?: unknown; reason?: unknown }
    | undefined;
}

function fenceRefusal(verdict: TurnFenceVerdict): TurnFenceRejectedError {
  return new TurnFenceRejectedError(
    `fake append: V5 turn fence refused a graph write — verdict ${verdict}; the whole turn rolled back`,
    { verdict, generation: 28146, maxGeneration: 28147 },
  );
}

describe('POST /orchestrate/v2/turn — factor_value_edit refused by the turn fence (F5)', () => {
  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    appendMock.mockReset();
    llmChatMock.mockClear();
    persisted = buildPersistedGraph();
  });

  it('CONTROL — an append that lands: 200, my target applied (the harness reaches the commit)', async () => {
    appendMock.mockResolvedValue({ id: 'row-landed' });
    const { status, body } = await send('0');
    expect(status).toBe(200);
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(appliedTargets(body)).toEqual(['f-budget']);
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it('CONTROL — a graph-CAS refusal already gets the typed 409 here (#1847)', async () => {
    appendMock.mockRejectedValue(
      new GraphStaleWriteError('fake append: stale base — whole turn rolled back', {
        conflict_category: 'rpc_cas_conflict',
      }),
    );
    const { status, body } = await send('1');
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(status).toBe(409);
    expect(body.error).toBe('GRAPH_DIVERGED');
    expect(details(body)?.conflict_category).toBe('rpc_cas_conflict');
    expectNoCommitEvidence(body);
  });

  it('RED — superseded by a later turn: typed 409 refresh_and_reconfirm, never a retryable 500', async () => {
    appendMock.mockRejectedValue(fenceRefusal('superseded'));
    const { status, body } = await send('2');
    // premise: the refusal came from the store's append, as on the wire
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(status).toBe(409);
    expect(body.error).toBe('GRAPH_DIVERGED');
    expect(details(body)?.retryable).toBe(false);
    expect(details(body)?.recovery_action).toBe('refresh_and_reconfirm');
    expect(details(body)?.conflict_category).toBe('turn_fence_superseded');
    expectNoCommitEvidence(body);
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it('RED — stopped by the user: typed 409 start_new_draft, never a retryable 500', async () => {
    appendMock.mockRejectedValue(fenceRefusal('stopped'));
    const { status, body } = await send('3');
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(status).toBe(409);
    expect(body.error).toBe('GRAPH_DIVERGED');
    expect(details(body)?.retryable).toBe(false);
    expect(details(body)?.recovery_action).toBe('start_new_draft');
    expect(details(body)?.conflict_category).toBe('turn_fence_stopped');
    expectNoCommitEvidence(body);
  });
});
