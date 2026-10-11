// Storage transport script ONLY: no SQL, locking, revision increment, CAS or rollback emulation.
// A scripted successful RPC makes fixture rows visible to the real adapter's read paths.
import type { SupabaseClient } from '@supabase/supabase-js';
import { BASE_GRAPH, LABEL_ONLY_EDIT, FIX_OWNER, FIX_SCENARIO, FIX_VERSION_ID,
  identityOf, versionRecord, writeOutcome } from '../model-management/__tests__/fixtures.js';
import { computeVersionAnalysisAffectingHashRecord } from '../context/graph-identity.js';

export const NEW_ID = '33333333-3333-4333-8333-333333333333';
export const UNDO_ID = '22222222-2222-4222-8222-222222222222';
export const MUTATION = '44444444-4444-4444-8444-444444444444';
export const NOW = '2026-10-11T12:00:00.000Z';
export type Op = 'A' | 'B';
export type Mode = 'success' | 'userSave' | 'dedupe' | 'replay' | 'fail' | 'throw' | 'conflict' | 'missing' | 'reuse';

export function storageFixture(op: Op, mode: Mode = 'success') {
  const shaped = (g: typeof BASE_GRAPH) => ({ ...structuredClone(g), edges: g.edges.map(e => ({ ...e,
    strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' as const })) });
  const graph = shaped(op === 'A' ? BASE_GRAPH : LABEL_ONLY_EDIT);
  const current = shaped(BASE_GRAPH);
  const id = identityOf(graph);
  const currentId = identityOf(current);
  const analysis = computeVersionAnalysisAffectingHashRecord(graph)!;
  const created = writeOutcome(graph, { version_id: NEW_ID, version_number: 3,
    event_id: mode === 'userSave' ? `model_version_created_${NEW_ID}` : 'sys10-saved-event' });
  const restored = {
    ...created, mutation_id: MUTATION, analysis_affecting_hash: analysis.value,
    hash_algorithm: id.algorithm, identity_projection_version: id.projection_version,
    identity_normaliser_version: id.normaliser_version, graph_schema_version: id.graph_schema_version,
    restored_from_version_id: FIX_VERSION_ID, undo_version_id: UNDO_ID,
    parent_version_id: UNDO_ID, root_version_id: UNDO_ID, actor_kind: 'known', authored_by: 'owner',
    creation_kind: 'restore', source_version_id: FIX_VERSION_ID, source_turn_id: null,
    graph, replayed: mode === 'replay', analysis_invalidated_at: NOW,
    event_id: `model_version_restored_mutation_${MUTATION}`,
  };
  const savedRow = versionRecord(graph, { id: NEW_ID, version_number: 3,
    label: mode === 'userSave' ? 'My version' : 'Panel round',
    provenance: mode === 'userSave' ? 'user_save' : 'elicitation_round_mint' });
  const restoredRow = versionRecord(graph, { id: NEW_ID, version_number: 3, provenance: 'restore',
    parent_version_id: UNDO_ID, root_version_id: UNDO_ID, mutation_id: MUTATION, creation_kind: 'restore',
    source_version_id: FIX_VERSION_ID, restored_from_version_id: FIX_VERSION_ID,
    actor_kind: 'known', authored_by: 'owner' });
  const state = { owner: FIX_OWNER as string | null, graph: current, revision: 7,
    head: (op === 'B' ? UNDO_ID : null) as string | null,
    versions: op === 'B' ? [versionRecord(graph), versionRecord(current, { id: UNDO_ID, version_number: 2,
      root_version_id: UNDO_ID, creation_kind: 'initial', actor_kind: 'known', authored_by: 'owner' })] : [],
    events: [] as string[] };
  if (mode === 'dedupe') { state.head = NEW_ID; state.versions = [savedRow]; }
  if (mode === 'replay') {
    state.head = NEW_ID; state.graph = graph; state.revision = 8;
    state.versions.push(restoredRow); state.events.push(restored.event_id);
  }
  const request: any = op === 'A' ? {
    expected_revision: 7, scenario_id: FIX_SCENARIO, graph,
    label: savedRow.label, provenance: savedRow.provenance,
    expected_head_version_id: mode === 'dedupe' ? NEW_ID : null,
    ...(mode === 'userSave' ? {} : { event_id: created.event_id }),
  } : {
    expected_revision: 7, scenario_id: FIX_SCENARIO, version_id: FIX_VERSION_ID,
    mutation_id: MUTATION, graph, current_graph: current,
    source_graph_identity_hash: id.value, expected_graph_identity_hash: currentId.value,
    actor_kind: 'known', authored_by: 'owner', source_turn_id: null, label: 'Restore pricing',
  };
  const calls: Array<{ fn: string; args: Record<string, any> }> = [];
  const reads: Array<{ table: string; columns: string }> = [];
  const events: unknown[] = [];
  const plan: Mode[] = [mode];
  const client = {
    rpc: async (fn: string, args: Record<string, any>) => {
      calls.push({ fn, args: structuredClone(args) });
      const reply = plan.shift() ?? mode;
      if (reply === 'throw') throw new Error('wire disconnected');
      if (['fail', 'conflict', 'missing', 'reuse'].includes(reply)) {
        const code = reply === 'conflict' ? op === 'A' ? 'MV409' : 'OLRV1'
          : reply === 'missing' ? 'MV404' : reply === 'reuse' ? 'MV422' : '57014';
        return { data: null, error: { code, message: 'scripted storage refusal',
          details: JSON.stringify({ reason: 'revision_conflict', expected: 7, current: 8 }) } };
      }
      if (op === 'A') {
        if (reply === 'dedupe') return { data: { ...created, deduped: true, event_id: null }, error: null };
        state.versions.push(savedRow); state.head = NEW_ID; state.events.push(created.event_id!);
        return { data: created, error: null };
      }
      if (reply !== 'replay') {
        state.versions.push(restoredRow); state.head = NEW_ID; state.graph = graph; state.events.push(restored.event_id);
      }
      return { data: { ...restored, replayed: reply === 'replay' }, error: null };
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const result = (single = false) => {
        if (table === 'scenarios') return { data: { user_id: state.owner, graph: state.graph,
          revision: state.revision, current_model_version_id: state.head }, error: null };
        const rows = state.versions.filter(r => Object.entries(filters).every(([key, value]) => (r as any)[key] === value));
        return { data: single ? rows[0] ?? null : rows, error: null };
      };
      const query: any = {
        select: (columns: string) => { reads.push({ table, columns }); return query; },
        eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        order: () => query, lt: () => query, limit: () => query, abortSignal: () => query,
        maybeSingle: async () => result(true),
        then: (resolve: (value: unknown) => unknown, reject: (err: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, state, request, calls, reads, plan, events, graph, current,
    sink: { emit: async (event: unknown) => { events.push(event); } } };
}

export function captureResult(h: ReturnType<typeof storageFixture>, result: unknown) {
  // The same event contract generates a new wall-clock timestamp on each execution.
  // Retain all other fields verbatim and verify the timestamp separately in the physical spec.
  return { result, calls: h.calls, state: h.state,
    events: h.events.map(event => ({ ...event as Record<string, unknown>, occurred_at_iso: '<runtime clock>' })) };
}
