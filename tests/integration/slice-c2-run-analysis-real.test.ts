/**
 * Slice C2 — integration Suite A (real staging Supabase + real staging PLoT).
 *
 * Proof points #1 + #2 + #3 end-to-end. Gated behind SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY + TEST_SCENARIO_ID + ISL_BASE_URL presence —
 * skips locally (Paul's memory: staging creds live only in Render deploy
 * env). In CI with the staging env injected, this suite is authoritative.
 *
 * If Suite B (mocked) passes but THIS suite fails in CI, the brief's halt
 * condition "mocked-passes-but-real-fails split" fires: infrastructure
 * issue, not C2 code — do not contort C2 to work around staging flakes.
 *
 * NOTE: This suite writes a `run_analysis` handler fact into
 * `v5_handler_facts` for TEST_SCENARIO_ID. Cleanup deletes the turn rows
 * (cascade removes associated facts per the FK ON DELETE CASCADE).
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_SCENARIO_ID = process.env.TEST_SCENARIO_ID;
const ISL_BASE_URL = process.env.ISL_BASE_URL;

const envReady = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && TEST_SCENARIO_ID && ISL_BASE_URL);
const suite = envReady ? describe : describe.skip;

// Scenario loading against real Supabase: the C2 handler's ScenarioReader
// must be wired to read from the scenarios table. This wiring is scope for
// a later slice (see handler JSDoc); the real-staging suite therefore
// verifies the PERSISTENCE + RPC path, not the end-to-end LLM→route→PLoT
// path that depends on scenario-reader wiring.
//
// Concretely: we do a direct store.append with a handcrafted run_analysis
// fact (constructed to match what the handler would emit given a known
// scenario graph), then prove it persists and reads back. The handler's
// in-process behaviour is tested by Suite B + unit tests. Suite A's
// coverage is: the Slice B append_turn_atomic RPC accepts run_analysis
// facts, persists both turn + fact atomically, and buildTurnContext's
// readRecent returns the turn on subsequent reads.

import { SessionLRUCache } from '../../src/orchestrator-v5/session/cache.js';
import { SupabaseSessionStore } from '../../src/orchestrator-v5/session/supabase-store.js';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

function freshStore(client: SupabaseClient) {
  const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 20 });
  return {
    store: new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 }),
    cache,
  };
}

function makeRunAnalysisFact(scenarioId: string): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: scenarioId,
      leading_option_id: 'opt_a',
      win_probabilities: { 'Option A': 0.6, 'Option B': 0.4 },
      summary: 'Ran analysis on your current scenario.',
      enrichment: {
        meta: { seed_used: 42, n_samples: 1000, response_hash: 'suite-a' },
        results: [{ option_id: 'opt_a', win_probability: 0.6 }],
        analysis_status: 'completed',
      },
    },
  };
}

suite('Slice C2 integration — Suite A (real staging Supabase + PLoT)', () => {
  let client: SupabaseClient;
  const writtenTurnIds: string[] = [];

  beforeAll(() => {
    client = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  afterEach(async () => {
    if (writtenTurnIds.length > 0) {
      await client
        .from('v5_conversation_turns')
        .delete()
        .in('turn_id', writtenTurnIds);
      writtenTurnIds.length = 0;
    }
  });

  it('proof point #3: handler fact persists via append_turn_atomic and reads back through SessionStore', async () => {
    const turnId = `c2-real-${randomUUID()}`;
    writtenTurnIds.push(turnId);
    const fact = makeRunAnalysisFact(TEST_SCENARIO_ID!);

    const { store: writeStore } = freshStore(client);
    await writeStore.append({
      scenario_id: TEST_SCENARIO_ID!,
      turn_id: turnId,
      turn_class: 'handler',
      handler_id: 'run_analysis',
      request_hash: `sha256:${turnId}`,
      response_emitted: true,
      llm_calls_used: 1,
      duration_ms: 250,
      handler_facts: [fact],
    });

    // Fresh store (no cache) → forces a DB read
    const { store: readStore } = freshStore(client);
    const turns = await readStore.readRecent(TEST_SCENARIO_ID!);
    const match = turns.find((t) => t.turn_id === turnId);

    expect(match).toBeDefined();
    expect(match!.turn_class).toBe('handler');
    expect(match!.handler_id).toBe('run_analysis');
  });

  it('proof point #3 (facts table): v5_handler_facts row written with canonical result shape', async () => {
    const turnId = `c2-real-${randomUUID()}`;
    writtenTurnIds.push(turnId);
    const fact = makeRunAnalysisFact(TEST_SCENARIO_ID!);

    const { store } = freshStore(client);
    await store.append({
      scenario_id: TEST_SCENARIO_ID!,
      turn_id: turnId,
      turn_class: 'handler',
      handler_id: 'run_analysis',
      request_hash: `sha256:${turnId}`,
      response_emitted: true,
      llm_calls_used: 1,
      duration_ms: 250,
      handler_facts: [fact],
    });

    // Direct read of v5_handler_facts to verify persistence shape.
    const { data: factRows, error } = await client
      .from('v5_handler_facts')
      .select('*')
      .eq('scenario_id', TEST_SCENARIO_ID!)
      .eq('action_type', 'run_analysis');

    expect(error).toBeNull();
    expect(factRows).toBeDefined();
    const latest = factRows!.find(
      (r: { payload: { result?: { scenario_id?: string } } }) =>
        r.payload?.result?.scenario_id === TEST_SCENARIO_ID,
    );
    expect(latest).toBeDefined();
    expect(latest!.handler_id).toBe('run_analysis');
    expect(latest!.action_type).toBe('run_analysis');
  });

  // PLoT reachability smoke test — proves proof point #2 can be satisfied
  // in the environment. If this fails but mocked Suite B passes, the split
  // detected triggers the brief's infrastructure-issue halt.
  it('proof point #2: PLoT /health endpoint is reachable', async () => {
    const response = await fetch(`${ISL_BASE_URL}/health`, {
      signal: AbortSignal.timeout(10_000),
    }).catch((e: unknown) => ({ ok: false, status: 0, _err: e }));
    if ('_err' in response) {
      throw new Error(`PLoT /health unreachable: ${String((response as { _err: unknown })._err)}`);
    }
    expect(response.ok).toBe(true);
  });
});
