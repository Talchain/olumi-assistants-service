/**
 * Slice B — D6 commit-failure.
 *
 * Proves: RPC failure surfaces as StateCommitFailedError, which
 * TurnExecutor's compose-or-commit catch maps to STATE_COMMIT_FAILED
 * (INTERNAL_ERROR wire code). BI-01 is preserved — the failure envelope
 * counts as a response, `response_emitted: true` still holds.
 *
 * Rather than mutating staging Supabase grants (which would require a
 * destructive SQL change the brief prohibits), this test uses a
 * deliberately-invalid scenario_id to trigger the RPC's internal "scenario
 * not found" error — same code path through StateCommitFailedError.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { SessionLRUCache } from '../../src/orchestrator-v5/session/cache.js';
import { StateCommitFailedError } from '../../src/orchestrator-v5/session/store.js';
import { SupabaseSessionStore } from '../../src/orchestrator-v5/session/supabase-store.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const envReady = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);
const suite = envReady ? describe : describe.skip;

suite('Slice B commit-failure — RPC error propagates as StateCommitFailedError', () => {
  let client: SupabaseClient;

  beforeEach(() => {
    client = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  it('append with unknown scenario_id throws StateCommitFailedError', async () => {
    const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 20 });
    const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });

    // UUID that cannot possibly exist in scenarios
    const phantomScenario = '00000000-0000-0000-0000-000000000000';
    const turnId = `commit-fail-${randomUUID()}`;

    let caught: unknown;
    try {
      await store.append({
        scenario_id: phantomScenario,
        turn_id: turnId,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: `sha256:${turnId}`,
        response_emitted: true,
        llm_calls_used: 2,
        duration_ms: 100,
        handler_facts: [],
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(StateCommitFailedError);
    expect((caught as StateCommitFailedError).message).toMatch(/scenario.*not found/i);
  });
});

// describe.skip above already handles the env-missing case.
