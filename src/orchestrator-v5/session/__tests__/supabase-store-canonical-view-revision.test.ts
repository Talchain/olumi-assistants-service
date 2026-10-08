import { describe, expect, it, vi } from 'vitest';
import { SupabaseSessionStore } from '../supabase-store.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
describe('canonical view scenario snapshot revision', () => {
  it('DATA-REVISION: reads graph and revision in one existing-scenario SELECT', async () => {
    const row = { id: SCENARIO, user_id: null, graph: { nodes: [], edges: [] }, brief_text: 'A brief', analysis_invalidated_at: null, revision: 7 };
    const select = vi.fn();
    const query = { select, eq: vi.fn(), maybeSingle: vi.fn(async () => ({ data: row, error: null })) };
    select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const client = { from: vi.fn(() => query) };
    const store = new SupabaseSessionStore(client as never, {} as never, {} as never);
    const snapshot = await store.readExistingScenario(SCENARIO);
    expect(select).toHaveBeenCalledExactlyOnceWith('id, user_id, graph, brief_text, analysis_invalidated_at, revision');
    expect(snapshot).toMatchObject({ graph: row.graph, revision: 7 });
    expect(client.from).toHaveBeenCalledExactlyOnceWith('scenarios');
    expect(query.maybeSingle).toHaveBeenCalledTimes(1);
  });
});
