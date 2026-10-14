import { describe, expect, it, vi } from 'vitest';
import { SupabaseSessionStore } from '../supabase-store.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECORD = 'record-1';
function fixture(decision: unknown = { record_id: RECORD, scenario_id: SCENARIO }, decisionError: unknown = null) {
  const queries: { table: string; columns: string; filters: Record<string, unknown> }[] = [];
  const client = { from(table: string) {
    const query = { table, columns: '', filters: {} as Record<string, unknown> };
    queries.push(query);
    const chain = {
      select(columns: string) { query.columns = columns; return chain; },
      eq(key: string, value: unknown) { query.filters[key] = value; return chain; },
      async maybeSingle() {
        if (table === 'scenarios') return { data: { id: SCENARIO, user_id: null, brief: 'brief', analysis_provenance: {} }, error: null };
        // Model the verified schema, including a wrong-column database error, without a database.
        if (query.columns.split(',').map(x => x.trim()).includes('id') || 'id' in query.filters) {
          return { data: null, error: { code: '42703', message: 'column decision_records.id does not exist' } };
        }
        return { data: decision, error: decisionError };
      },
    };
    return chain;
  } };
  return { queries, store: new SupabaseSessionStore(client as never, { invalidateAll: vi.fn() } as never, { defaultReadLimit: 20 } as never) };
}
describe('readRunRecordingRows uses decision_records.record_id', () => {
  it('selects and filters the real key and recognises the owned recording', async () => {
    const { store, queries } = fixture();
    await expect(store.readRunRecordingRows(SCENARIO, RECORD)).resolves.toMatchObject({ decisionRecordPresent: true, guest: true });
    expect(queries).toContainEqual({ table: 'decision_records', columns: 'record_id, scenario_id', filters: { scenario_id: SCENARIO, record_id: RECORD } });
  });
  it.each([null, { record_id: 'other-record', scenario_id: SCENARIO }, { record_id: RECORD, scenario_id: 'other-scenario' }])('a genuinely absent or mismatched recording remains unavailable: %j', async row => {
    await expect(fixture(row).store.readRunRecordingRows(SCENARIO, RECORD)).resolves.toMatchObject({ decisionRecordPresent: false });
  });
  it('does not query decision_records when no record was written', async () => {
    const { store, queries } = fixture();
    await expect(store.readRunRecordingRows(SCENARIO, null)).resolves.toMatchObject({ decisionRecordPresent: false });
    expect(queries.map(q => q.table)).toEqual(['scenarios']);
  });
  it('still throws on a storage failure', async () => {
    await expect(fixture(null, { message: 'unavailable' }).store.readRunRecordingRows(SCENARIO, RECORD)).rejects.toThrow('Run recording rows could not be read');
  });
});
