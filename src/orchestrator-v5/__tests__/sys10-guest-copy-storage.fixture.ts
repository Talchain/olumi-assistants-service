// PostgREST transport script only. It does NOT emulate transactions or locks.
export const SOURCE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const DEST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const OTHER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const GRAPH = { nodes: [{ id: 'goal', kind: 'goal', label: 'Keep my exact words' }], edges: [], extra: { words: 'unchanged' } };
export type Mode = 'success' | 'replay' | 'replay_race' | 'owned' | 'missing' | 'no_model' | 'too_large' | 'unknown_user' | 'stale' | 'missing_rpc' | 'fail' | 'throw';
export function guestStorage(mode: Mode = 'success') {
  const reads: Array<Record<string, unknown>> = [];
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const state = { source: { user_id: null as string | null, graph: structuredClone(GRAPH) as unknown, revision: 7 },
    copies: [] as Array<{ user_id: string; graph: unknown; revision: number }>, calls };
  if (mode === 'owned') state.source.user_id = OTHER;
  if (mode === 'no_model') state.source.graph = null;
  if (mode === 'too_large') state.source.graph = { nodes: [{ id: 'n', label: 'x'.repeat(1048577) }], edges: [] };
  if (mode === 'replay' || mode === 'replay_race') state.copies.push({ user_id: USER, graph: structuredClone(GRAPH), revision: 0 });
  const errors: Partial<Record<Mode, string>> = { owned: 'CG409', missing: 'CG404', no_model: 'CG422', too_large: 'CG413', unknown_user: '22023', stale: 'CG412', missing_rpc: 'PGRST202', fail: 'XX000' };
  const client = {
    from: (_table: string) => {
      const filters: Record<string, unknown> = {};
      const q = {
        select: (_columns: string) => q,
        eq: (key: string, value: unknown) => { filters[key] = value; return q; },
        order: (_key: string) => q,
        limit: (_n: number) => q,
        maybeSingle: async () => { reads.push({ ...filters }); return { data: structuredClone('source_scenario_id' in filters
          ? mode === 'replay_race' ? null : state.copies.find(c => c.user_id === filters.user_id) ?? null : mode === 'missing' ? null : state.source), error: null }; },
      };
      return q;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args: structuredClone(args) });
      if (mode === 'throw') throw new Error('original transport throw');
      if (errors[mode]) return { data: null, error: { code: errors[mode] } };
      if (mode !== 'replay' && mode !== 'replay_race') state.copies.push({ user_id: args.p_user_id as string, graph: structuredClone(args.p_checked_source_graph ?? state.source.graph), revision: 0 });
      return { data: { scenario_id: DEST, created: mode !== 'replay' && mode !== 'replay_race' }, error: null };
    },
  };
  return { state, client, calls, reads, mode };
}
