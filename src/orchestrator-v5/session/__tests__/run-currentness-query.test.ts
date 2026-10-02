import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { SessionLRUCache } from '../cache.js';
import { SupabaseSessionStore } from '../supabase-store.js';
import { SessionReadError } from '../store.js';

const SCENARIO = '4d2c1b0a-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const FACT = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/served-run-analysis-fact-for-binding.json', import.meta.url), 'utf8'));
const row = () => ({ id: 'fact-row', scenario_id: SCENARIO, v5_conversation_turn_id: 'turn-row',
  handler_id: 'run_analysis', action_type: 'run_analysis', noop: false, created_at: '2026-10-01T12:00:01.000Z',
  payload: { ...FACT, result: { ...FACT.result, scenario_id: SCENARIO } },
  scenario: { id: SCENARIO, user_id: null, graph: { nodes: [], edges: [] }, brief_text: 'The strategic brief', analysis_invalidated_at: null },
});
function build(data: unknown, status = 200) {
  const urls: URL[] = [];
  const client = createClient('https://query.invalid', 'local-test-placeholder', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input) => {
      urls.push(new URL(input instanceof Request ? input.url : String(input)));
      return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  return { store: new SupabaseSessionStore(client, new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }), { defaultReadLimit: 20 }), urls };
}

describe('one-query Run currentness through the real Supabase client (stub fetch only)', () => {
  it('joins the owner/model/restore row and selects newest Run time, not commit time', async () => {
    const value = row();
    const { store, urls } = build(value);
    const read = await store.readRunCurrentness(SCENARIO);
    expect(read).toMatchObject({ userId: null, graph: value.scenario.graph, analysisInvalidatedAt: null,
      fact: { fact_type: 'run_analysis', result: { scenario_id: SCENARIO } } });
    expect(urls).toHaveLength(1);
    const query = urls[0]!.searchParams;
    expect(urls[0]!.pathname).toBe('/rest/v1/v5_handler_facts');
    expect(query.get('select')).toContain('scenario:scenarios!inner(id,user_id,graph,brief_text,analysis_invalidated_at)');
    expect(query.get('scenario_id')).toBe(`eq.${SCENARIO}`);
    expect(query.get('handler_id')).toBe('eq.run_analysis');
    expect(query.get('noop')).toBe('eq.false');
    expect(query.get('order')).toBe('payload->result->>computed_at.desc.nullslast,created_at.desc,id.desc');
    expect(query.get('limit')).toBe('1');
  });
  it('no joined Run is an absence, never a fabricated current result', async () => {
    const { store, urls } = build(null);
    expect(await store.readRunCurrentness(SCENARIO)).toBeNull();
    expect(urls).toHaveLength(1);
  });
  it.each([
    { ...row(), scenario: null },
    { ...row(), scenario: { ...row().scenario, user_id: undefined } },
    { ...row(), scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    { ...row(), handler_id: 'set_goal' },
    { ...row(), action_type: 'set_goal' },
    { ...row(), noop: true },
    { ...row(), payload: {} },
    { ...row(), created_at: 'bad-date' },
  ])('rejects malformed joined authority: %j', async (value) => {
    const { store } = build(value);
    await expect(store.readRunCurrentness(SCENARIO)).rejects.toBeInstanceOf(SessionReadError);
  });
  it('a failed query is unknown, not an absent Run', async () => {
    const { store, urls } = build({ message: 'unavailable', code: 'XX000' }, 500);
    await expect(store.readRunCurrentness(SCENARIO)).rejects.toBeInstanceOf(SessionReadError);
    expect(urls).toHaveLength(1);
  });
});
