/**
 * Slice B — D6 concurrent-writes.
 *
 * Proves: write idempotency holds under real concurrency (DoD item 3).
 * Two Promise.all() appends with identical (scenario_id, turn_id) reach
 * the RPC concurrently; ON CONFLICT (scenario_id, turn_id) DO NOTHING
 * ensures exactly one row is materialised and both callers receive the
 * same row id with no surfaced error.
 *
 * This is the actual race-condition test — not sequential writes dressed
 * up as "concurrent". The Promise.all is what fires both RPCs before
 * either returns.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { SessionLRUCache } from '../../src/orchestrator-v5/session/cache.js';
import { SupabaseSessionStore } from '../../src/orchestrator-v5/session/supabase-store.js';
import { ModelManagementService } from '../../src/orchestrator-v5/model-management/service.js';
import { SupabaseModelVersionStore } from '../../src/orchestrator-v5/model-management/store-adapter.js';
import { bindWriteCaller } from '../../src/orchestrator-v5/ownership/door-ownership.js';
import { computeGraphIdentityHash } from '../../src/orchestrator-v5/context/graph-identity.js';
import type { VersionWriteOutcome, AtomicRestoreVersionOutcome } from '../../src/orchestrator-v5/model-management/types.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_SCENARIO_ID = process.env.TEST_SCENARIO_ID;

const envReady = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && TEST_SCENARIO_ID);
const suite = envReady ? describe : describe.skip;

suite('Slice B concurrent-writes — idempotency under real concurrency', () => {
  let client: SupabaseClient;
  const writtenTurnIds: string[] = [];

  beforeEach(() => {
    client = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  afterEach(async () => {
    if (writtenTurnIds.length > 0) {
      await client.from('v5_conversation_turns').delete().in('turn_id', writtenTurnIds);
      writtenTurnIds.length = 0;
    }
  });

  it('two concurrent appends with identical (scenario_id, turn_id) produce exactly one row', async () => {
    const turnId = `concurrent-${randomUUID()}`;
    writtenTurnIds.push(turnId);

    const makeStore = () => {
      const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 20 });
      return new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });
    };
    const storeA = makeStore();
    const storeB = makeStore();

    const write = {
      scenario_id: TEST_SCENARIO_ID!,
      turn_id: turnId,
      turn_class: 'direct_answer' as const,
      handler_id: null,
      request_hash: `sha256:${turnId}`,
      response_emitted: true,
      llm_calls_used: 2,
      duration_ms: 100,
      handler_facts: [],
    };

    // Fire both concurrently — Promise.all triggers both RPCs before either
    // resolves. One wins the INSERT, the other hits ON CONFLICT and returns
    // the existing row's id (per append_turn_atomic body: the IF NOT FOUND
    // branch looks up the row by (scenario_id, turn_id)).
    const [ra, rb] = await Promise.all([storeA.append(write), storeB.append(write)]);

    // Both callers receive the same row id — ON CONFLICT path returned the
    // winner's id from the SELECT branch.
    expect(ra.id).toBe(rb.id);

    // Exactly one row in DB.
    const { data: rows, error } = await client
      .from('v5_conversation_turns')
      .select('id, turn_id')
      .eq('turn_id', turnId);
    expect(error).toBeNull();
    expect(rows).not.toBeNull();
    expect(rows!.length).toBe(1);
    expect(rows![0].id).toBe(ra.id);
  });

  it('sequential append of same (scenario_id, turn_id) is also idempotent (retry semantics)', async () => {
    const turnId = `retry-${randomUUID()}`;
    writtenTurnIds.push(turnId);

    const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 20 });
    const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });

    const write = {
      scenario_id: TEST_SCENARIO_ID!,
      turn_id: turnId,
      turn_class: 'direct_answer' as const,
      handler_id: null,
      request_hash: `sha256:${turnId}`,
      response_emitted: true,
      llm_calls_used: 2,
      duration_ms: 100,
      handler_facts: [],
    };

    const first = await store.append(write);
    const second = await store.append(write);
    const third = await store.append(write);

    expect(first.id).toBe(second.id);
    expect(second.id).toBe(third.id);

    const { data: rows } = await client
      .from('v5_conversation_turns')
      .select('id')
      .eq('turn_id', turnId);
    expect(rows!.length).toBe(1);
  });
});

// describe.skip above already handles the env-missing case.

// SYS10 A/B transaction bodies replace the empty physical-spec skip. Reuse
// the EXISTING Supabase gate/credentials above, without a new skip construct.
// This WRITES to SUPABASE_URL's project when the service-role environment is
// supplied (normally shared staging). TEST_SCENARIO_ID is read only, for its
// authenticated owner; all writes and cleanup use our random scenario IDs.
// No DDL/failure triggers: failures use existing SQL operations/constraints.
// UNRUN locally; a green advisory job without these env vars is not DB proof.
suite('SYS10 version door — real CAS, rollback/retry and cold reload', () => {
  const ownScenarioIds: string[] = [];
  const currentGraph = { nodes: [{ id: 'factor', kind: 'factor', label: 'Current working bytes' }], edges: [] };
  const targetGraph = { nodes: [{ id: 'factor', kind: 'factor', label: 'Target snapshot bytes' }], edges: [] };
  let db: SupabaseClient;

  beforeEach(() => {
    db = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  afterEach(async () => {
    // Clear the scenario's head reference before deleting its version lineage.
    // Each mutation is constrained to this test's IDs, never TEST_SCENARIO_ID.
    for (const id of ownScenarioIds.splice(0)) {
      const head = await db.from('scenarios').update({ current_model_version_id: null }).eq('id', id);
      expect(head.error, `cleanup head ${id}`).toBeNull();
      const versions = await db.from('model_versions').delete().eq('scenario_id', id);
      expect(versions.error, `cleanup versions ${id}`).toBeNull();
      const scenario = await db.from('scenarios').delete().eq('id', id);
      expect(scenario.error, `cleanup scenario ${id}`).toBeNull();
      const leftovers = await db.from('scenarios').select('id').eq('id', id);
      expect(leftovers.error).toBeNull(); expect(leftovers.data).toEqual([]);
    }
  });

  function service() {
    // Fresh real adapter/service for each writer and reload; no storage double.
    return new ModelManagementService({ store: new SupabaseModelVersionStore(db), isEnabled: () => true });
  }
  function asOwner<T>(owner: string, run: () => T) {
    return bindWriteCaller({ userId: owner, verified: true }, run);
  }
  async function scenario(id: string) {
    const read = await db.from('scenarios').select('*').eq('id', id).single();
    expect(read.error).toBeNull(); expect(read.data).not.toBeNull();
    return read.data!;
  }
  async function snapshot(id: string) {
    const row = await scenario(id);
    const versions = await db.from('model_versions').select('*').eq('scenario_id', id).order('version_number');
    expect(versions.error).toBeNull();
    return { scenario: row, versions: versions.data! };
  }
  async function fixture(op: 'A' | 'B') {
    const ownerRead = await db.from('scenarios').select('user_id').eq('id', TEST_SCENARIO_ID!).single();
    expect(ownerRead.error).toBeNull();
    const owner: unknown = ownerRead.data?.user_id;
    expect(typeof owner, 'version fixture requires an OWNED TEST_SCENARIO_ID').toBe('string');
    if (typeof owner !== 'string') throw new Error('Owned integration fixture unavailable');
    const id = randomUUID(); ownScenarioIds.push(id);
    const graph = op === 'A' ? currentGraph : targetGraph;
    const inserted = await db.from('scenarios').insert({ id, user_id: owner, graph,
      graph_identity_hash: computeGraphIdentityHash(graph)!.value,
      brief_text: `sys10-version-door-${id}` });
    expect(inserted.error).toBeNull();
    let targetId: string | null = null;
    if (op === 'B') {
      const initial = await scenario(id);
      const saved = await asOwner(owner, () => service().saveVersion({ scenario_id: id,
        expected_revision: initial.revision, graph: targetGraph, expected_head_version_id: null }));
      expect(saved.status).toBe('ok');
      if (saved.status !== 'ok') throw new Error(`fixture version refused: ${JSON.stringify(saved)}`);
      targetId = saved.value.version_id;
      // Force a real undo INSERT: the saved head does not capture these bytes.
      const working = await db.from('scenarios').update({ graph: currentGraph,
        graph_identity_hash: computeGraphIdentityHash(currentGraph)!.value }).eq('id', id);
      expect(working.error).toBeNull();
    }
    const base = await snapshot(id);
    return { id, owner, targetId, base, mutation: randomUUID() };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function write(f: Fixture, op: 'A' | 'B', mutation = f.mutation, authoredBy = 'owner') {
    return asOwner(f.owner, () => op === 'A'
      ? service().saveVersion({ scenario_id: f.id, graph: currentGraph,
        expected_revision: f.base.scenario.revision,
        expected_head_version_id: f.base.scenario.current_model_version_id })
      : service().restoreVersionAtomic({ scenario_id: f.id, version_id: f.targetId!, mutation_id: mutation,
        expected_revision: f.base.scenario.revision, graph: targetGraph, current_graph: currentGraph,
        expected_graph_identity_hash: computeGraphIdentityHash(currentGraph)!.value,
        source_graph_identity_hash: computeGraphIdentityHash(targetGraph)!.value,
        actor_kind: 'known', authored_by: authoredBy }));
  }
  type Receipt = VersionWriteOutcome | AtomicRestoreVersionOutcome;
  async function coldReload(f: Fixture, op: 'A' | 'B', receipt: Receipt) {
    const cold = service();
    const list = await cold.listVersions(f.id);
    expect(list.status).toBe('ok');
    if (list.status !== 'ok') throw new Error('cold version list unavailable');
    const head = await cold.getCurrentVersion(f.id);
    expect(head.status).toBe('ok');
    if (head.status !== 'ok' || head.value === null) throw new Error('cold head unavailable');
    expect(head.value.id).toBe(receipt.version_id);
    expect(head.value.graph).toEqual(op === 'A' ? currentGraph : targetGraph);
    expect(head.value.graph_identity_hash).toBe(receipt.graph_identity_hash);
    expect(list.value.map(v => v.id)).toContain(receipt.version_id);
    const reloaded = await snapshot(f.id);
    expect(reloaded.scenario.current_model_version_id).toBe(receipt.version_id);
    expect(reloaded.scenario.graph).toEqual(op === 'A' ? currentGraph : targetGraph);
    expect(reloaded.scenario.revision).toBe(f.base.scenario.revision + 1);
    const event = reloaded.scenario.events.find((e: { event_id: string }) => e.event_id === receipt.event_id);
    expect(event).toMatchObject({ event_type: op === 'A' ? 'model_version_created' : 'model_version_restored',
      details: { version_id: receipt.version_id }, hashes: { graph_identity_hash: receipt.graph_identity_hash } });
    expect(reloaded.scenario.events).toHaveLength(f.base.scenario.events.length + 1);
    expect(reloaded.versions).toHaveLength(f.base.versions.length + (op === 'A' ? 1 : 2));
    if (op === 'B') {
      if (!('undo_version_id' in receipt) || receipt.undo_version_id === null) throw new Error('restore omitted its undo');
      const undo = await cold.getVersion(f.id, receipt.undo_version_id);
      expect(undo.status).toBe('ok');
      if (undo.status !== 'ok') throw new Error('cold undo unavailable');
      expect(undo.value.graph).toEqual(currentGraph);
      expect(undo.value.provenance).toBe('pre_restore');
      expect(head.value.parent_version_id).toBe(undo.value.id);
      expect(event.details.undo_version_id).toBe(undo.value.id);
      expect(reloaded.scenario.analysis_invalidated_at).not.toBeNull();
    }
  }

  for (const op of ['A', 'B'] as const) {
    it(`${op}: concurrent writers on one expected revision have exactly one winner, no partial rows`, async () => {
      const f = await fixture(op);
      const replies = await Promise.all([write(f, op, randomUUID()), write(f, op, randomUUID())]);
      const wins = replies.filter(r => r.status === 'ok');
      const losses = replies.filter(r => r.status === 'conflict');
      expect(wins).toHaveLength(1); expect(losses).toHaveLength(1);
      expect(losses[0]!.conflict.kind).toBe('revision_conflict');
      expect(losses[0]!.conflict).toMatchObject({ expected: f.base.scenario.revision, current: f.base.scenario.revision + 1 });
      await coldReload(f, op, wins[0]!.value);
    });

    it(`${op}: SQL failure after checked admission rolls back all rows; same-revision retry works`, async () => {
      const f = await fixture(op);
      if (op === 'A') {
        // jsonb_array_elements fails AFTER version INSERT + head UPDATE in the
        // save RPC. Only this throwaway row's events are affected; no DDL.
        const injected = await db.from('scenarios').update({ events: {} }).eq('id', f.id);
        expect(injected.error).toBeNull();
      }
      const before = await snapshot(f.id);
      // For B this value passes RPC's non-null actor guard but violates the
      // EXISTING model_versions_actor_consistency_ck after the undo INSERT.
      const failed = await write(f, op, f.mutation, 'sys10-invalid-author');
      expect(failed.status).toBe('error');
      if (failed.status !== 'error') throw new Error('failure control did not fire');
      expect(failed.error.code).toBe('store_error');
      expect(await snapshot(f.id)).toEqual(before); // Includes graph/head/undo/event/revision and all version columns.
      if (op === 'A') {
        const reset = await db.from('scenarios').update({ events: [] }).eq('id', f.id);
        expect(reset.error).toBeNull();
      }
      const retry = await write(f, op); // Same expected revision; same B mutation id, valid actor.
      expect(retry.status).toBe('ok');
      if (retry.status !== 'ok') throw new Error(`retry refused: ${JSON.stringify(retry)}`);
      await coldReload(f, op, retry.value);
    });

    it(`${op}: cold version list/head/graph/undo/event equal the committed receipt`, async () => {
      const f = await fixture(op);
      const accepted = await write(f, op);
      expect(accepted.status).toBe('ok');
      if (accepted.status !== 'ok') throw new Error('cold reload write refused');
      await coldReload(f, op, accepted.value);
    });
  }
});
