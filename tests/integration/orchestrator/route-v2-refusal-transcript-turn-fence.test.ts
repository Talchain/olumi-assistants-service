/**
 * F5 RESIDUAL — a writer's REFUSAL whose transcript commit is refused by the
 * TURN FENCE answers the typed 409, not the retryable 500.
 *
 * WHY. A domain refusal ("above the cap", "no such link", …) writes no graph,
 * but it still commits a transcript turn row so the record says the user tried
 * and was refused. When a later turn has claimed the scenario, that append is
 * refused by the fence (`TurnFenceRejectedError`, verdict superseded/stopped).
 * Every refusal catch in `system-events/dispatch.ts` then returns
 * `commitPerformed: false` with no skip reason, and `route-v2` maps that to
 * `500 system_event_commit_failed, retryable: true` — "we do not know whether
 * it was saved", although nothing can have been saved (the operation was
 * refused, and the transcript rolled back), and a blind retry cannot succeed
 * (a later turn owns the scenario). The F5 family (#1868, #1882) gave the
 * writers' OWN commits the typed 409; its fixture header named these refusal
 * commits as out of scope. This closes them with the same helper.
 *
 * THE SPEC is F5's: `superseded` → 409 GRAPH_DIVERGED `turn_fence_superseded`
 * `refresh_and_reconfirm`; `stopped` → `turn_fence_stopped` `start_new_draft`;
 * `unclaimed` / `unavailable` stay the retryable 500 (infrastructure).
 *
 * Per writer (all six that commit a refusal transcript):
 *   CONTROL  the refusal lands: 200, exactly ONE append (the transcript row),
 *            no applied patch (the harness reaches the refusal commit);
 *   RED      superseded → 409 refresh_and_reconfirm, turn_fence_superseded;
 *   RED      stopped    → 409 start_new_draft, turn_fence_stopped;
 *   CONTROL  unavailable → still the retryable 500 (scope of the fix).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { TurnFenceRejectedError, type TurnFenceVerdict } from '../../../src/orchestrator-v5/session/turn-fence.js';

// ── the persisted model (route-v2-every-writer-reply-freshness.test.ts shape) ──
function buildPersistedGraph(): Record<string, unknown> {
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

let persisted: unknown = buildPersistedGraph();
const appendMock = vi.fn();

const fakeStore = {
  append: appendMock,
  readRecent: async () => [],
  readFactsFor: async () => [],
  readFactsWithTurnFor: async () => [],
  readScenarioRunAnalysisFactsFor: async () => ({ facts: [], total_count: 0 }),
  loadGraph: async () => persisted,
  // The structural writers read the newest pending set (integrity-strict)
  // before any append; a healthy empty read.
  readMostRecentPendingActions: async () => [],
  loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
  invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
  invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
};

vi.mock('../../../src/orchestrator-v5/session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/orchestrator-v5/session/index.js')>()),
  getSessionStore: () => fakeStore,
}));

// Deterministic events: any model call is itself a failure.
const llmChatMock = vi.fn();
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

// The commit seam fires the (Anthropic) rolling summariser after every commit.
// Replaced outright so this file can never reach a provider through it.
const rollingSummaryMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../src/orchestrator-v5/rolling-summary/capture.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/orchestrator-v5/rolling-summary/capture.js')>()),
  maintainRollingSummaryForCommit: rollingSummaryMock,
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
              // The SERVED posture (/healthz graph_cas: rpc_mode enforce), which is also
              // what opens the edge_strength_edit writer (reader-only otherwise).
              if (featProp === 'graphCas') {
                return { appMode: 'observe', rpcMode: 'enforce', rpcEnforce: true, requiresExpectedHash: true };
              }
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

const SCENARIO_ID = '88888888-8888-4888-8888-888888888888';
const TURN_ID_BASE = '99999999-9999-4999-8999-9999999999';
const PRE_HASH = computeAnalysisAffectingGraphHash(buildPersistedGraph() as never)!;

const WRITERS = [
  'factor_value_edit',
  'edge_strength_edit',
  'structural_delete',
  'structural_rename',
  'structural_add',
  'structural_add_edge',
] as const;
type Writer = (typeof WRITERS)[number];

/** An event each writer REFUSES on domain grounds (validated by CONTROL 1). */
function refusedEventFor(writer: Writer): Record<string, unknown> {
  switch (writer) {
    case 'factor_value_edit': // above the factor's cap (100000)
      return { kind: 'factor_value_edit', target_id: 'f-budget', value: 1.5, raw_value: 150000, unit: '£' };
    case 'edge_strength_edit': // set_target_unchanged: exactly the link's current strength and direction
      return { kind: 'edge_strength_edit', from: 'f-budget', to: 'g-revenue', magnitude: 0.4,
        direction_intent: 'preserve', expected: { mean: 0.4, effect_direction: 'positive' }, intent: 'set' };
    case 'structural_delete': // the goal cannot be deleted (refused, transcript recorded)
      return { kind: 'structural_delete', removed_node_ids: ['g-revenue'], removed_edges: [], base_graph_hash: PRE_HASH };
    case 'structural_rename': // no such node (refused, transcript recorded)
      return { kind: 'structural_rename', node_id: 'f-missing', label: 'Anything',
        expected_label: 'Missing', base_graph_hash: PRE_HASH };
    case 'structural_add': // the id is already taken (refused, transcript recorded)
      return { kind: 'structural_add', node_id: 'f-budget', node_kind: 'factor', label: 'Duplicate', base_graph_hash: PRE_HASH };
    case 'structural_add_edge': // edge_already_exists
      return { kind: 'structural_add_edge', from: 'f-budget', to: 'g-revenue', magnitude: 0.5,
        effect_direction: 'positive', base_graph_hash: PRE_HASH };
  }
}

let turnSeq = 0;
async function send(writer: Writer) {
  turnSeq += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'system_event',
      turn_id: `${TURN_ID_BASE}${turnSeq.toString(16).padStart(2, '0')}`,
      scenario_id: SCENARIO_ID,
      stage: 'analyse',
      event: refusedEventFor(writer),
    },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

function appliedTargets(body: Record<string, any>): unknown[] {
  const blocks = Array.isArray(body.blocks) ? (body.blocks as Array<Record<string, unknown>>) : [];
  return blocks.filter((b) => b?.type === 'graph_patch' && b.status === 'applied').map((b) => b.target_id);
}

function expectNoCommitEvidence(body: Record<string, any>) {
  expect(appliedTargets(body)).toEqual([]);
  expect(body.draft_graph).toBeUndefined();
  expect(body.graph_hash).toBeUndefined();
  expect(body.model_version_receipt).toBeUndefined();
}

function fenceRefusal(verdict: TurnFenceVerdict): TurnFenceRejectedError {
  return new TurnFenceRejectedError(
    `fake append: V5 turn fence refused a graph write — verdict ${verdict}; the whole turn rolled back`,
    { verdict, generation: 28146, maxGeneration: 28147 },
  );
}

let app: FastifyInstance;

describe('POST /orchestrate/v2/turn — a writer\'s refusal transcript refused by the turn fence (F5 residual)', () => {
  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    persisted = buildPersistedGraph();
    appendMock.mockReset();
    llmChatMock.mockClear();
    rollingSummaryMock.mockClear();
  });

  describe.each(WRITERS.map((w) => [w] as const))('%s', (writer) => {
    it('CONTROL — the refusal lands: 200, one transcript append, nothing applied', async () => {
      appendMock.mockResolvedValue({ id: 'row-refusal' });
      const { status, body } = await send(writer);
      const diag = JSON.stringify({
        status,
        appends: appendMock.mock.calls.length,
        appendKeys: Object.keys((appendMock.mock.calls[0]?.[0] as object | undefined) ?? {}),
        appendGraph: (appendMock.mock.calls[0]?.[0] as { graph?: unknown } | undefined)?.graph != null,
        blocks: (Array.isArray(body.blocks) ? body.blocks : []).map((b: Record<string, unknown>) => `${String(b.type)}:${String(b.status ?? '')}:${String(b.target_id ?? '')}`),
        text: String(body.assistant_text ?? body.error ?? '').slice(0, 120),
        graph_hash: body.graph_hash,
      });
      expect(status, diag).toBe(200);
      // premise: this event reaches the REFUSAL commit (a transcript row, no graph)
      expect(appendMock).toHaveBeenCalledTimes(1);
      expect((appendMock.mock.calls[0]?.[0] as { graph?: unknown } | undefined)?.graph ?? null).toBeNull();
      expect(appliedTargets(body)).toEqual([]);
      expect(body.draft_graph).toBeUndefined();
      expect(body.model_version_receipt).toBeUndefined();
      // A refusal may state the graph it left untouched, never a moved one.
      expect([undefined, PRE_HASH]).toContain(body.graph_hash);
      expect(llmChatMock).not.toHaveBeenCalled();
    });

    it('RED — the transcript is fenced (superseded): typed 409 refresh_and_reconfirm, never a retryable 500', async () => {
      appendMock.mockRejectedValue(fenceRefusal('superseded'));
      const { status, body } = await send(writer);
      expect(appendMock).toHaveBeenCalledTimes(1);
      expect(status, JSON.stringify(body).slice(0, 300)).toBe(409);
      expect(body.error).toBe('GRAPH_DIVERGED');
      expect(body.details?.retryable).toBe(false);
      expect(body.details?.recovery_action).toBe('refresh_and_reconfirm');
      expect(body.details?.conflict_category).toBe('turn_fence_superseded');
      expect(body.details?.event_kind).toBe(writer);
      expectNoCommitEvidence(body);
      expect(llmChatMock).not.toHaveBeenCalled();
    });

    it('RED — the transcript is fenced (stopped): typed 409 start_new_draft, never a retryable 500', async () => {
      appendMock.mockRejectedValue(fenceRefusal('stopped'));
      const { status, body } = await send(writer);
      expect(appendMock).toHaveBeenCalledTimes(1);
      expect(status, JSON.stringify(body).slice(0, 300)).toBe(409);
      expect(body.error).toBe('GRAPH_DIVERGED');
      expect(body.details?.recovery_action).toBe('start_new_draft');
      expect(body.details?.conflict_category).toBe('turn_fence_stopped');
      expectNoCommitEvidence(body);
    });

    it('CONTROL — unavailable (infrastructure refusal) stays the retryable 500', async () => {
      appendMock.mockRejectedValue(fenceRefusal('unavailable'));
      const { status, body } = await send(writer);
      expect(appendMock).toHaveBeenCalledTimes(1);
      expect(status).toBe(500);
      expect(body.details?.retryable).toBe(true);
      expectNoCommitEvidence(body);
    });
  });
});
