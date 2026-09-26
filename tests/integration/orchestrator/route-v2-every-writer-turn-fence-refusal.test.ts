/**
 * F5 FAMILY — every structural system-event writer answers a TURN-FENCE
 * REFUSAL like the known refusal it is: the typed 409 the message path and
 * (after F5, #1868) the factor_value_edit writer already return, never the
 * retryable 500 that means "we do not know whether it was saved".
 *
 * WHY. Served CEE `caf7d1a`, 25 Sep 2026 (witness-canonical-state.sh S8): of
 * five refused racers, three answered `500 system_event_commit_failed,
 * retryable:true`; Render logged `TurnFenceRejectedError` for them (request
 * 5bb2257f-…, "a later turn has claimed this scenario … the whole turn rolled
 * back"). F5 fixed the value edit. Its fixture header names the rest of the
 * family: `edge_strength_edit`, `structural_delete`, `structural_rename`,
 * `structural_add`, `structural_add_edge` each catch `GraphStaleWriteError`
 * and nothing else, so a fence refusal of any of them still flattens to the
 * retryable 500 — an invitation to retry blindly over the turn that
 * superseded it.
 *
 * THE SPEC is the repo's own (turn-executor.ts, V5 TURN FENCE — AMENDMENT A2,
 * as F5 applies it to system events): `superseded` → 409 GRAPH_DIVERGED,
 * `turn_fence_superseded`, `refresh_and_reconfirm`; `stopped` →
 * `turn_fence_stopped`, `start_new_draft`. `unclaimed` / `unavailable` are
 * infrastructure refusals and stay the retryable 500 until their code is
 * decided — pinned below as a CONTROL so the fix cannot widen past the two
 * conflict verdicts.
 *
 * WHERE THE FAKE THROWS: the real store raises `TurnFenceRejectedError` from
 * inside `append` (the fence check inside the append transaction), so the
 * fake rejects `append` with the repo's own class.
 *
 * Per writer:
 *   CONTROL  the append lands → 200, the writer's own change is in the bytes
 *            handed to the store (the harness reaches each commit);
 *   CONTROL  a graph-CAS loss → the typed 409 already (the envelope is
 *            observable here, so a RED below is the missing fence branch);
 *   RED      superseded → 409 refresh_and_reconfirm, turn_fence_superseded;
 *   RED      stopped    → 409 start_new_draft, turn_fence_stopped;
 *   CONTROL  unavailable → still the retryable 500 (scope of the fix).
 *
 * NOT HERE, named so the scope is known:
 *   - `option_intervention_edit`: its writer (option-intervention-edit.ts)
 *     catches every commit throw and returns `unverified /
 *     commit_not_confirmed`, so no error type reaches dispatch.ts. Fixing it
 *     is a change to that writer, outside this fix's files;
 *   - the refusal-transcript commits (a domain refusal whose no-graph turn row
 *     is fenced) keep their 500: the operation was refused either way.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { GraphStaleWriteError } from '../../../src/orchestrator-v5/session/store.js';
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
  'edge_strength_edit',
  'structural_delete',
  'structural_rename',
  'structural_add',
  'structural_add_edge',
] as const;
type Writer = (typeof WRITERS)[number];

function eventFor(writer: Writer): Record<string, unknown> {
  switch (writer) {
    case 'edge_strength_edit':
      return { kind: 'edge_strength_edit', from: 'f-budget', to: 'g-revenue', magnitude: 0.7,
        direction_intent: 'preserve', expected: { mean: 0.4, effect_direction: 'positive' }, intent: 'set' };
    case 'structural_delete':
      return { kind: 'structural_delete', removed_node_ids: ['o-launch'], removed_edges: [], base_graph_hash: PRE_HASH };
    case 'structural_rename':
      return { kind: 'structural_rename', node_id: 'f-budget', label: 'Marketing spend',
        expected_label: 'Marketing budget', base_graph_hash: PRE_HASH };
    case 'structural_add':
      return { kind: 'structural_add', node_id: 'f-new', node_kind: 'factor', label: 'Hiring pace', base_graph_hash: PRE_HASH };
    case 'structural_add_edge':
      return { kind: 'structural_add_edge', from: 'o-launch', to: 'f-budget', magnitude: 0.5,
        effect_direction: 'positive', base_graph_hash: PRE_HASH };
  }
}

type Graph = { nodes?: Array<Record<string, unknown>>; edges?: Array<Record<string, unknown>> };

/** The writer's OWN change, read from the bytes handed to the store — bound by identity. */
function ownChangeLanded(writer: Writer, graph: Graph | undefined): boolean {
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  switch (writer) {
    case 'edge_strength_edit': {
      const e = edges.find((x) => x.from === 'f-budget' && x.to === 'g-revenue');
      return (e?.strength as { mean?: number } | undefined)?.mean === 0.7;
    }
    case 'structural_delete':
      return !nodes.some((n) => n.id === 'o-launch') && nodes.some((n) => n.id === 'f-budget');
    case 'structural_rename':
      return nodes.find((n) => n.id === 'f-budget')?.label === 'Marketing spend';
    case 'structural_add':
      return nodes.find((n) => n.id === 'f-new')?.label === 'Hiring pace';
    case 'structural_add_edge':
      return edges.some((x) => x.from === 'o-launch' && x.to === 'f-budget');
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
      event: eventFor(writer),
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

describe('POST /orchestrate/v2/turn — every structural writer refused by the turn fence (F5 family)', () => {
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
    it('CONTROL — the append lands: 200, and this writer\'s own change is in the bytes stored', async () => {
      appendMock.mockResolvedValue({ id: 'row-landed' });
      const { status, body } = await send(writer);
      expect(status, JSON.stringify(body).slice(0, 400)).toBe(200);
      expect(appendMock).toHaveBeenCalledTimes(1);
      const stored = (appendMock.mock.calls[0]?.[0] as { graph?: Graph } | undefined)?.graph;
      expect(ownChangeLanded(writer, stored), `${writer}'s change is not in the stored bytes`).toBe(true);
      expect(typeof body.graph_hash).toBe('string');
      expect(llmChatMock).not.toHaveBeenCalled();
    });

    it('CONTROL — a graph-CAS loss already gets the typed 409 here', async () => {
      appendMock.mockRejectedValue(
        new GraphStaleWriteError('fake append: stale base — whole turn rolled back', {
          conflict_category: 'rpc_cas_conflict',
        }),
      );
      const { status, body } = await send(writer);
      expect(appendMock).toHaveBeenCalledTimes(1);
      expect(status).toBe(409);
      expect(body.error).toBe('GRAPH_DIVERGED');
      expect(body.details?.conflict_category).toBe('rpc_cas_conflict');
      expectNoCommitEvidence(body);
    });

    it('RED — superseded by a later turn: typed 409 refresh_and_reconfirm, never a retryable 500', async () => {
      appendMock.mockRejectedValue(fenceRefusal('superseded'));
      const { status, body } = await send(writer);
      // premise: the refusal came from the store's append, as on the wire
      expect(appendMock).toHaveBeenCalledTimes(1);
      expect(status, JSON.stringify(body).slice(0, 300)).toBe(409);
      expect(body.error).toBe('GRAPH_DIVERGED');
      expect(body.details?.retryable).toBe(false);
      expect(body.details?.recovery_action).toBe('refresh_and_reconfirm');
      expect(body.details?.conflict_category).toBe('turn_fence_superseded');
      expect(body.details?.event_kind).toBe(writer);
      // From a FRESH read of the graph the server still holds (the append rolled back).
      expect(body.details?.expected_base_graph_hash).toBe(PRE_HASH);
      expectNoCommitEvidence(body);
      expect(llmChatMock).not.toHaveBeenCalled();
    });

    it('RED — stopped by the user: typed 409 start_new_draft, never a retryable 500', async () => {
      appendMock.mockRejectedValue(fenceRefusal('stopped'));
      const { status, body } = await send(writer);
      expect(appendMock).toHaveBeenCalledTimes(1);
      expect(status, JSON.stringify(body).slice(0, 300)).toBe(409);
      expect(body.error).toBe('GRAPH_DIVERGED');
      expect(body.details?.retryable).toBe(false);
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
