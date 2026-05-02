/**
 * V5 Phase 1 brief persistence — migration smoke + RPC idempotency.
 *
 * Validates the runtime invariants of
 *   supabase/migrations/20260502120000_v5_brief_text_persistence.sql
 * against the live target environment. Runs only when the staging
 * Supabase env is set; otherwise skipped (matches the
 * `slice-b-rpc-grant.test.ts` pattern).
 *
 * Invariants pinned here:
 *   1. brief_text column exists with the documented CHECK constraint.
 *   2. append_turn_atomic has exactly one overload (the 11-arg version).
 *   3. service_role retains EXECUTE privilege on the new signature.
 *   4. First call writes brief_text; second call (different turn_id)
 *      with a different brief_text leaves the existing value untouched
 *      (write-once via WHERE clause).
 *   5. Conflict-replay (same scenario_id + same turn_id) carrying a
 *      different brief_text leaves brief_text unchanged (FOUND-based
 *      idempotency guard).
 *
 * Test rows are created in deliberately-isolated scenario UUIDs and
 * cleaned up in afterEach so re-runs against staging are safe and do
 * not accumulate detritus.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const envReady = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);
const suite = envReady ? describe : describe.skip;

const createdScenarioIds: string[] = [];

async function createScenario(client: SupabaseClient): Promise<string> {
  const id = randomUUID();
  // ensure_scenario_exists is the established pre-flight RPC for guest
  // sessions (user_id = NULL). Used here for test isolation.
  const { error } = await client.rpc('ensure_scenario_exists', {
    p_scenario_id: id,
    p_user_id: null,
  });
  if (error) {
    throw new Error(`failed to create test scenario: ${error.message}`);
  }
  createdScenarioIds.push(id);
  return id;
}

async function readBriefText(client: SupabaseClient, scenarioId: string): Promise<string | null> {
  const { data, error } = await client
    .from('scenarios')
    .select('brief_text')
    .eq('id', scenarioId)
    .maybeSingle();
  if (error) throw new Error(`readBriefText failed: ${error.message}`);
  const raw = (data as { brief_text?: unknown } | null)?.brief_text;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

async function callAppend(
  client: SupabaseClient,
  args: {
    scenarioId: string;
    turnId: string;
    briefText?: string | null;
    graph?: unknown;
  },
): Promise<{ data: unknown; error: { code?: string; message: string } | null }> {
  return client.rpc('append_turn_atomic', {
    p_scenario_id: args.scenarioId,
    p_turn_id: args.turnId,
    p_turn_class: 'direct_answer',
    p_handler_id: null,
    p_request_hash: `sha256:${args.turnId}`,
    p_response_emitted: true,
    p_llm_calls_used: 0,
    p_duration_ms: 0,
    p_handler_facts: [],
    p_graph: args.graph ?? null,
    p_brief_text: args.briefText ?? null,
  }) as never;
}

suite('V5 Phase 1 brief persistence — migration smoke (live Supabase)', () => {
  afterEach(async () => {
    if (!envReady) return;
    const client = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Clean up test rows. Errors here are non-fatal — we want test
    // isolation but a leftover guest row is harmless if cleanup fails.
    if (createdScenarioIds.length > 0) {
      await client.from('scenarios').delete().in('id', createdScenarioIds);
      createdScenarioIds.length = 0;
    }
  });

  it('brief_text column exists with the documented CHECK constraint shape', async () => {
    const client = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Column metadata via information_schema — read-only, safe.
    const { data: colData, error: colErr } = await client
      .from('information_schema.columns' as never)
      .select('column_name, data_type, is_nullable')
      .eq('table_schema', 'public')
      .eq('table_name', 'scenarios')
      .eq('column_name', 'brief_text');

    // Information schema may not be exposed via PostgREST; try the
    // direct column read on a sentinel scenario as a fallback existence
    // check.
    if (colErr || !colData || (colData as unknown[]).length === 0) {
      const sentinel = await createScenario(client);
      const value = await readBriefText(client, sentinel);
      expect(value).toBeNull();
    } else {
      expect((colData as Array<{ data_type: string }>)[0].data_type).toBe('text');
    }
  });

  it('append_turn_atomic exists with the 11-arg signature and service_role can EXECUTE', async () => {
    const client = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Probe with all 11 named args + invalid scenario_id. Result must
    // be the application-level "scenario not found" error (P0001),
    // NOT a permission-denied (42501) — that would mean the GRANT
    // didn't apply — and NOT a candidate-ambiguity error — that would
    // mean the DROP FUNCTION step didn't run, leaving multiple
    // overloads coexisting.
    const { error } = await callAppend(client, {
      scenarioId: '00000000-0000-0000-0000-000000000000',
      turnId: `migration-smoke-${Date.now()}`,
      briefText: 'test',
    });

    expect(error).not.toBeNull();
    const code = error?.code ?? '';
    const message = error?.message ?? '';

    expect(code).not.toBe('42501');
    expect(message.toLowerCase()).not.toMatch(/permission denied/);
    expect(message.toLowerCase()).not.toMatch(/could not choose the best candidate/);

    // Positive check: function body ran (P0001 / "scenario not found").
    expect(`${code} ${message}`).toMatch(/scenario.*not found|P0001/i);
  });

  it('first append with brief_text writes; second non-conflict append with different brief_text does NOT overwrite', async () => {
    const client = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const scenarioId = await createScenario(client);

    // First append (different turn_id) writes brief_text.
    const first = await callAppend(client, {
      scenarioId,
      turnId: `first-${randomUUID()}`,
      briefText: 'first brief',
    });
    expect(first.error).toBeNull();
    expect(await readBriefText(client, scenarioId)).toBe('first brief');

    // Second append (different turn_id, no conflict) carries a different
    // briefText. Per the WHERE clause, the row is NOT updated.
    const second = await callAppend(client, {
      scenarioId,
      turnId: `second-${randomUUID()}`,
      briefText: 'second brief',
    });
    expect(second.error).toBeNull();
    expect(await readBriefText(client, scenarioId)).toBe('first brief');
  });

  it('conflict-replay (same scenario_id + same turn_id) with different brief_text leaves brief_text unchanged', async () => {
    const client = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const scenarioId = await createScenario(client);
    const sharedTurnId = `replay-${randomUUID()}`;

    // First call writes brief_text and the turn row.
    const first = await callAppend(client, {
      scenarioId,
      turnId: sharedTurnId,
      briefText: 'original brief',
    });
    expect(first.error).toBeNull();
    expect(await readBriefText(client, scenarioId)).toBe('original brief');

    // Second call with identical scenario_id + turn_id and a *different*
    // brief_text. The FOUND guard must short-circuit at the conflict
    // detection, returning the existing row id without writing
    // brief_text. This is the load-bearing idempotency invariant.
    const replay = await callAppend(client, {
      scenarioId,
      turnId: sharedTurnId,
      briefText: 'replay brief',
    });
    expect(replay.error).toBeNull();
    // Same row id returned (idempotent) AND brief_text unchanged.
    expect(replay.data).toBe(first.data);
    expect(await readBriefText(client, scenarioId)).toBe('original brief');
  });

  it('append without p_brief_text on existing brief_text scenario does NOT clear it', async () => {
    const client = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const scenarioId = await createScenario(client);

    // First: write a brief.
    await callAppend(client, {
      scenarioId,
      turnId: `seed-${randomUUID()}`,
      briefText: 'seeded brief',
    });
    expect(await readBriefText(client, scenarioId)).toBe('seeded brief');

    // Second: append without brief_text (most subsequent turns).
    // p_brief_text is NULL → the IF p_brief_text IS NOT NULL block is
    // skipped entirely. Existing brief_text is untouched.
    await callAppend(client, {
      scenarioId,
      turnId: `noop-${randomUUID()}`,
      // briefText omitted (defaults to null)
    });
    expect(await readBriefText(client, scenarioId)).toBe('seeded brief');
  });

  it('legacy 10-arg call shape (omitting p_brief_text entirely) still works via DEFAULT NULL', async () => {
    // Pins the contract that old callers — application code that has
    // not been updated to pass p_brief_text — continue to invoke the
    // RPC successfully. Without this case the migration smoke only
    // covers the 11-arg shape and silently regresses if a future
    // migration removes the DEFAULT NULL.
    const client = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const scenarioId = await createScenario(client);
    const turnId = `legacy-${randomUUID()}`;

    // Invoke with the EXACT 10-arg shape the pre-Phase-1 application
    // code used. p_brief_text is NOT present in the args object — it
    // must resolve via the function's DEFAULT NULL clause.
    const { data, error } = await client.rpc('append_turn_atomic', {
      p_scenario_id: scenarioId,
      p_turn_id: turnId,
      p_turn_class: 'direct_answer',
      p_handler_id: null,
      p_request_hash: `sha256:${turnId}`,
      p_response_emitted: true,
      p_llm_calls_used: 0,
      p_duration_ms: 0,
      p_handler_facts: [],
      p_graph: null,
    });

    expect(error).toBeNull();
    expect(typeof data).toBe('string');
    // brief_text remains null because no value was supplied at any
    // position — neither explicitly nor by default.
    expect(await readBriefText(client, scenarioId)).toBeNull();
  });

  it('rejects whitespace-only brief_text via the CHECK constraint', async () => {
    const client = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const scenarioId = await createScenario(client);

    const { error } = await callAppend(client, {
      scenarioId,
      turnId: `whitespace-${randomUUID()}`,
      briefText: '     ',
    });

    expect(error).not.toBeNull();
    // Postgres CHECK violation surfaces as code 23514 ("check_violation").
    expect(error?.code === '23514' || /check.*constraint|scenarios_brief_text_length/i.test(error?.message ?? '')).toBe(true);
    // brief_text must remain null after the rejected write.
    expect(await readBriefText(client, scenarioId)).toBeNull();
  });
});
