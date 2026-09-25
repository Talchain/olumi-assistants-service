/**
 * option_intervention_edit REFUSED BY THE STORE FOR A KNOWN REASON — a graph-CAS
 * loss or a turn-fence refusal — is a KNOWN refusal, and must be answered like
 * one: the typed 409 every other system-event writer now returns for the same
 * two errors, never the retryable 500 that means "we do not know".
 *
 * THE GAP (read at `47b24735`, the F5-family head). `executeOptionInterventionEdit`
 * (`system-events/option-intervention-edit.ts`) wraps its `commitDirectAnswer`
 * in a bare `catch {}` and returns `unverified` / `commit_not_confirmed` for
 * EVERY throw. `dispatchOptionInterventionEdit` answers `unverified` with no skip
 * reason, and `route-v2` turns that into `500 system_event_commit_failed,
 * retryable: true`. So no error class survives to `dispatch.ts`: the writer's
 * own comment — "A transport error need not prove rollback" — is right about a
 * transport error and wrong about these two, whose producer states the rollback:
 *
 *   · `GraphStaleWriteError` — `session/supabase-store.ts`: "Atomic
 *     in-transaction CAS: the whole turn rolled back, nothing clobbered."
 *   · `TurnFenceRejectedError` — `session/supabase-store.ts` (the fence refusal):
 *     "REFUSING this graph write … Nothing was written; the turn row rolled back
 *     with it."
 *
 * A retryable 500 for either invites a blind retry over the other writer's
 * change (CAS) or over the turn that superseded this one (fence).
 *
 * THE SPEC is the repo's own, not a new one: the five structural writers and
 * fve map exactly these errors (`dispatch.ts` `turnFenceConflict` and each
 * writer's `GraphStaleWriteError` branch), and the existing wire test for this
 * writer (`route-v2-option-intervention-edit.test.ts`) already answers its
 * pre-write stale base with 409 GRAPH_DIVERGED + refresh_and_reconfirm.
 *
 * THE HARNESS is that wire test's: the REAL writer over the REAL route, the store
 * faked only at `append`, so the throw arrives exactly where the real store
 * raises it (inside the append transaction).
 *
 *   CONTROL (positive): the append lands → 200, and THIS edit's level is in the
 *     bytes the append received. Proves the harness reaches the commit.
 *   RED  CAS loss:      409 GRAPH_DIVERGED, rpc_cas_conflict, refresh_and_reconfirm.
 *   RED  superseded:    409, turn_fence_superseded, refresh_and_reconfirm.
 *   RED  stopped:       409, turn_fence_stopped, start_new_draft.
 *   CONTROL unavailable: an infrastructure refusal KEEPS the retryable 500, the
 *     same line the other writers draw — so a fix that typed every throw fails.
 *   CONTROL transport:  a plain Error KEEPS the retryable 500 — the writer's
 *     could-not-confirm contract, which this file must not erode.
 *
 * Every refusal case also asserts: append called exactly once (the premise), no
 * model call, no commit evidence on the wire, and the stored cell still holds
 * its prior value (identity-bound, not a hash predicate).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../src/orchestrator-v5/persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { GraphStaleWriteError } from '../../../src/orchestrator-v5/session/store.js';
import { TurnFenceRejectedError, type TurnFenceVerdict } from '../../../src/orchestrator-v5/session/turn-fence.js';

function intervention(factorId: string, value: number) {
  return {
    value,
    source: 'cee_hypothesis',
    target_match: { node_id: factorId, match_type: 'exact_id', confidence: 'high' },
  };
}

/** An option wired to two factors, already holding 0.2 on the one under edit. */
function buildPersistedGraph() {
  return projectGraphForPersistence({
    ...GraphV3.parse({
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Service quality', goal_threshold: 0.1 },
        {
          id: 'option', kind: 'option', label: 'Pilot', provenance: 'ai_inferred',
          interventions: {
            factor: intervention('factor', 0.2),
            other_factor: intervention('other_factor', 0.55),
          },
        },
        {
          id: 'factor', kind: 'factor', label: 'Coverage',
          observed_state: {
            value: 0.5, baseline: 0.4, unit: '%', raw_value: 50, cap: 100, source: 'user_override',
          },
        },
        { id: 'other_factor', kind: 'factor', label: 'Reach', observed_state: { value: 0.6, source: 'brief_extraction' } },
      ],
      edges: [
        ['option', 'factor'], ['option', 'other_factor'], ['factor', 'goal'], ['other_factor', 'goal'],
      ].map(([from, to]) => ({
        from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive',
      })),
    }),
    options: [] as Array<Record<string, unknown>>,
  });
}

type AppendWrite = Record<string, unknown>;

let persisted: unknown = buildPersistedGraph();
const rows = new Map<string, { id: string; write: AppendWrite }>();
const appendCalls: AppendWrite[] = [];

/** The landing append: what the real store does when the transaction commits. */
async function landingAppend(write: AppendWrite): Promise<{ id: string }> {
  const key = `${String(write.scenario_id)}/${String(write.turn_id)}`;
  const existing = rows.get(key);
  if (existing !== undefined) return { id: existing.id };
  const id = `row-${rows.size + 1}`;
  rows.set(key, { id, write: JSON.parse(JSON.stringify(write)) });
  if (write.graph !== undefined) persisted = write.graph;
  return { id };
}

let appendImpl: (write: AppendWrite) => Promise<{ id: string }> = landingAppend;

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    readMostRecentPendingActions: async () => [],
    readFactsFor: async () => [],
    readRecent: async () => [...rows.values()].reverse().map(r => ({
      id: r.id,
      scenario_id: r.write.scenario_id,
      turn_id: r.write.turn_id,
      turn_class: r.write.turn_class,
      handler_id: r.write.handler_id,
      request_hash: r.write.request_hash,
      response_emitted: r.write.response_emitted,
      llm_calls_used: r.write.llm_calls_used,
      duration_ms: r.write.duration_ms,
      assistant_message: r.write.assistantMessage ?? null,
      created_at: '2026-09-25T00:00:00.000Z',
    })),
    readFactsWithTurnFor: async (ids: readonly string[]) => [...rows.values()].flatMap(r => {
      if (!ids.includes(r.id)) return [];
      const facts = (r.write.handler_facts ?? []) as unknown[];
      return facts.map(fact => ({ turn_id: r.id, fact_created_at: '2026-09-25T00:00:00.000Z', fact }));
    }),
    append: async (write: AppendWrite) => {
      appendCalls.push(write);
      return await appendImpl(write);
    },
    getScenarioOwner: async () => null,
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

// Deterministic system event: any model call is itself a failure.
const llmChatMock = vi.fn();
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');

const SCENARIO_ID = '77777777-7777-4777-8777-777777777777';
let turnCounter = 0;

function turnId(): string {
  turnCounter += 1;
  return `88888888-8888-4888-8888-8888888888${String(turnCounter).padStart(2, '0')}`;
}

function currentHash(): string {
  const hash = computeAnalysisAffectingGraphHash(persisted as never);
  if (hash === null) throw new Error('fixture must have an analysis-affecting hash');
  return hash;
}

/** The edited cell, read by identity off the STORED graph. */
function storedLevel(): number {
  const option = (persisted as { nodes: Array<Record<string, unknown>> }).nodes
    .find(n => n.id === 'option') as { interventions: Record<string, { value: number }> };
  return option.interventions.factor.value;
}

/** The edited cell, read by identity off the bytes THIS turn handed to append. */
function levelInAppendedGraph(write: AppendWrite): number | undefined {
  const graph = write.graph as { nodes?: Array<Record<string, unknown>> } | undefined;
  const option = graph?.nodes?.find(n => n.id === 'option') as
    | { interventions?: Record<string, { value?: number }> }
    | undefined;
  return option?.interventions?.factor?.value;
}

const SET_LEVEL = 0.3;

async function sendEdit(app: FastifyInstance) {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'system_event', turn_id: turnId(), scenario_id: SCENARIO_ID, stage: 'analyse',
      event: {
        kind: 'option_intervention_edit',
        option_id: 'option', factor_id: 'factor', value: SET_LEVEL, base_graph_hash: currentHash(),
      },
    },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, unknown> };
}

function details(body: Record<string, unknown>) {
  return body.details as
    | { retryable?: unknown; recovery_action?: unknown; conflict_category?: unknown; expected_base_graph_hash?: unknown }
    | undefined;
}

function appliedPatches(body: Record<string, unknown>): unknown[] {
  const blocks = Array.isArray(body.blocks) ? (body.blocks as Array<Record<string, unknown>>) : [];
  return blocks.filter(b => b?.type === 'graph_patch' && b.status === 'applied');
}

/** Nothing on the wire that a client could read as "saved". */
function expectNoCommitEvidence(body: Record<string, unknown>) {
  expect(appliedPatches(body)).toEqual([]);
  expect(body.draft_graph).toBeUndefined();
  expect(body.graph_hash).toBeUndefined();
  expect(body.model_version_receipt).toBeUndefined();
}

function fenceRefusal(verdict: TurnFenceVerdict): TurnFenceRejectedError {
  return new TurnFenceRejectedError(
    `fake append: V5 turn fence refused a graph write — verdict ${verdict}; the whole turn rolled back`,
    { verdict, generation: 41, maxGeneration: 42 },
  );
}

describe('POST /orchestrate/v2/turn — option_intervention_edit refused by the store for a KNOWN reason', () => {
  let app: FastifyInstance;
  let hashBefore: string;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    persisted = buildPersistedGraph();
    rows.clear();
    appendCalls.length = 0;
    appendImpl = landingAppend;
    llmChatMock.mockClear();
    hashBefore = currentHash();
  });

  /** The premise every refusal case shares: the write reached append once, and nothing moved. */
  function expectRefusedAtAppendAndNothingStored() {
    expect(appendCalls, 'the refusal must come from the store\'s append, as on the wire').toHaveLength(1);
    expect(levelInAppendedGraph(appendCalls[0]!), 'the append carried THIS edit').toBe(SET_LEVEL);
    expect(storedLevel(), 'the stored cell keeps its prior value').toBe(0.2);
    expect(currentHash()).toBe(hashBefore);
    expect(rows.size).toBe(0);
    expect(llmChatMock).not.toHaveBeenCalled();
  }

  it('CONTROL — the append lands: 200, and this edit\'s level is in the bytes stored', async () => {
    const { status } = await sendEdit(app);
    expect(status).toBe(200);
    expect(appendCalls).toHaveLength(1);
    expect(levelInAppendedGraph(appendCalls[0]!)).toBe(SET_LEVEL);
    expect(storedLevel()).toBe(SET_LEVEL);
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it('RED — a graph-CAS loss is the typed 409 refresh_and_reconfirm, never a retryable 500', async () => {
    appendImpl = async () => {
      throw new GraphStaleWriteError('fake append: stale base — whole turn rolled back', {
        conflict_category: 'rpc_cas_conflict',
      });
    };
    const { status, body } = await sendEdit(app);
    expectRefusedAtAppendAndNothingStored();
    expect(status).toBe(409);
    expect(body.error).toBe('GRAPH_DIVERGED');
    expect(details(body)?.retryable).toBe(false);
    expect(details(body)?.recovery_action).toBe('refresh_and_reconfirm');
    expect(details(body)?.conflict_category).toBe('rpc_cas_conflict');
    // Followable: the hash the client can hold and resend, read from the CURRENT graph.
    expect(details(body)?.expected_base_graph_hash).toBe(hashBefore);
    expectNoCommitEvidence(body);
  });

  it('RED — superseded by a later turn: typed 409 refresh_and_reconfirm, never a retryable 500', async () => {
    appendImpl = async () => { throw fenceRefusal('superseded'); };
    const { status, body } = await sendEdit(app);
    expectRefusedAtAppendAndNothingStored();
    expect(status).toBe(409);
    expect(body.error).toBe('GRAPH_DIVERGED');
    expect(details(body)?.retryable).toBe(false);
    expect(details(body)?.recovery_action).toBe('refresh_and_reconfirm');
    expect(details(body)?.conflict_category).toBe('turn_fence_superseded');
    expectNoCommitEvidence(body);
  });

  it('RED — stopped by the user: typed 409 start_new_draft, never a retryable 500', async () => {
    appendImpl = async () => { throw fenceRefusal('stopped'); };
    const { status, body } = await sendEdit(app);
    expectRefusedAtAppendAndNothingStored();
    expect(status).toBe(409);
    expect(body.error).toBe('GRAPH_DIVERGED');
    expect(details(body)?.retryable).toBe(false);
    expect(details(body)?.recovery_action).toBe('start_new_draft');
    expect(details(body)?.conflict_category).toBe('turn_fence_stopped');
    expectNoCommitEvidence(body);
  });

  it('CONTROL — unavailable (an infrastructure refusal) KEEPS the retryable 500', async () => {
    appendImpl = async () => { throw fenceRefusal('unavailable'); };
    const { status, body } = await sendEdit(app);
    expectRefusedAtAppendAndNothingStored();
    expect(status).toBe(500);
    expect(details(body)?.retryable).toBe(true);
    expectNoCommitEvidence(body);
  });

  it('CONTROL — a transport error KEEPS the retryable 500 (could-not-confirm stays could-not-confirm)', async () => {
    appendImpl = async () => { throw new Error('fake append: socket hang up'); };
    const { status, body } = await sendEdit(app);
    expectRefusedAtAppendAndNothingStored();
    expect(status).toBe(500);
    expect(details(body)?.retryable).toBe(true);
    expectNoCommitEvidence(body);
  });
});
