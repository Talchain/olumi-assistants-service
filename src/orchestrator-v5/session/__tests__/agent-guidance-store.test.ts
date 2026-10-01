/**
 * AI HARNESS G1 — the Agent's guidance record shares `v5_conversation_turns.coaching_state` with V5's coaching state.
 * CONTROL (Paul's approval, 1 Oct): Agent-guidance rows must leave route-v2's coaching read UNCHANGED. The fake client
 * below EVALUATES the query's filters over a row set (the shared harness in `supabase-store.test.ts` returns a canned
 * result whatever the filters say, so it cannot show which row a filter selects).
 */
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseSessionStore } from '../supabase-store.js';
import { SessionLRUCache } from '../cache.js';
import type { SessionTurnWrite } from '../store.js';
import { EMPTY_COACHING_STATE } from '../../coaching/coaching-state.js';
import { toPreDispatchSnapshot } from '../../coaching/coaching-state-snapshot.js';
import { EMPTY_AGENT_GUIDANCE, toAgentGuidanceSnapshot, withEntry } from '../../coaching/agent-guidance-snapshot.js';

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

const SCENARIO = '11111111-2222-4333-8444-555555555555';
type Row = { id: string; scenario_id: string; created_at: string; coaching_state: unknown };

/** PostgREST semantics for the filters these reads use: `eq` (incl. `col->>key`), `not(col,'is',null)`, order, limit. */
function evaluatingClient(rows: Row[], applied: string[][] = []): SupabaseClient {
  const read = (row: Row, col: string): unknown => {
    const m = /^([a-z_]+)->>([a-z_]+)$/.exec(col);
    if (m === null) return (row as Record<string, unknown>)[col];
    const obj = (row as Record<string, unknown>)[m[1]!];
    const v = obj !== null && typeof obj === 'object' ? (obj as Record<string, unknown>)[m[2]!] : undefined;
    return v === undefined || v === null ? null : String(v);
  };
  return {
    from: () => {
      const preds: Array<(r: Row) => boolean> = [];
      const log: string[] = [];
      applied.push(log);
      let order: { col: string; asc: boolean } | null = null;
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => { log.push(`eq:${col}=${String(val)}`); preds.push((r) => { const v = read(r, col); return v !== null && v === val; }); return chain; },
        not: (col: string, op: string, val: unknown) => { log.push(`not:${col}:${op}`); if (op !== 'is' || val !== null) throw new Error('unsupported'); preds.push((r) => read(r, col) !== null); return chain; },
        order: (col: string, opts: { ascending: boolean }) => { order = { col, asc: opts.ascending }; return chain; },
        limit: (n: number) => {
          let out = rows.filter((r) => preds.every((p) => p(r)));
          if (order !== null) { const o = order; out = [...out].sort((a, b) => (String(read(a, o.col)) < String(read(b, o.col)) ? -1 : 1) * (o.asc ? 1 : -1)); }
          return Promise.resolve({ data: out.slice(0, n).map((r) => ({ id: r.id, coaching_state: r.coaching_state })), error: null });
        },
      };
      return chain as never;
    },
  } as unknown as SupabaseClient;
}

const storeOver = (rows: Row[], applied?: string[][]) =>
  new SupabaseSessionStore(evaluatingClient(rows, applied), new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }), { defaultReadLimit: 20 });

const V5 = toPreDispatchSnapshot(EMPTY_COACHING_STATE);
const G1 = withEntry(EMPTY_AGENT_GUIDANCE, 'RC-STRENGTHEN-ITEM', { status: 'pressed', state_key_hash: 'abcdefabcdef', turn_id: 't2', at: '2026-10-01T12:01:00.000Z' });
const G2 = withEntry(G1, 'RC-PREMORTEM', { status: 'offered', state_key_hash: 'abcdefabcdef', turn_id: 't3', at: '2026-10-01T12:03:00.000Z' });
const v5Row: Row = { id: 'r1', scenario_id: SCENARIO, created_at: '2026-10-01T12:00:00.000Z', coaching_state: V5 };
const agentRows: Row[] = [
  { id: 'r2', scenario_id: SCENARIO, created_at: '2026-10-01T12:01:00.000Z', coaching_state: toAgentGuidanceSnapshot(G1) },
  { id: 'r3', scenario_id: SCENARIO, created_at: '2026-10-01T12:02:00.000Z', coaching_state: null },
  { id: 'r4', scenario_id: SCENARIO, created_at: '2026-10-01T12:03:00.000Z', coaching_state: toAgentGuidanceSnapshot(G2) },
];

describe('route-v2 coaching read beside Agent guidance rows', () => {
  it('CONTROL (Paul): interleaved Agent-guidance rows leave route-v2\'s coaching read byte-identical', async () => {
    const alone = await storeOver([v5Row]).readMostRecentCoachingState(SCENARIO);
    const interleaved = await storeOver([v5Row, ...agentRows]).readMostRecentCoachingState(SCENARIO);
    expect(alone).toEqual(V5);
    expect(JSON.stringify(interleaved)).toBe(JSON.stringify(alone));
  });

  it('the reader asks for V5\'s own pre_dispatch snapshots by the envelope, plus the original non-null filter', async () => {
    const applied: string[][] = [];
    await storeOver([v5Row], applied).readMostRecentCoachingState(SCENARIO);
    expect(applied[0]).toEqual(expect.arrayContaining(['not:coaching_state:is', 'eq:coaching_state->>snapshot_timing=pre_dispatch']));
  });

  it('CONTROL: with no Agent rows, a newer V5 snapshot still wins (the read is still newest-first)', async () => {
    const newer: Row = { ...v5Row, id: 'r9', created_at: '2026-10-01T12:09:00.000Z', coaching_state: { ...V5, coaching_state_version: 'v9' } };
    const snap = await storeOver([v5Row, ...agentRows, newer]).readMostRecentCoachingState(SCENARIO);
    expect(snap?.coaching_state_version).toBe('v9');
  });
});

describe('readMostRecentAgentGuidance', () => {
  it('returns the Agent records merged (latest `at` per entry), never a V5 row', async () => {
    expect(await storeOver([v5Row, ...agentRows]).readMostRecentAgentGuidance(SCENARIO)).toEqual(G2);
    expect(await storeOver([v5Row]).readMostRecentAgentGuidance(SCENARIO)).toBeNull();
  });

  it('RED (CODEX_CLI_OVERFLOW P1): a concurrent tab\'s older-row press survives a newer row that did not see it', async () => {
    const tabA = withEntry(EMPTY_AGENT_GUIDANCE, 'RC-STRENGTHEN-ITEM', { status: 'pressed', state_key_hash: 'abcdefabcdef', turn_id: 'tA', at: '2026-10-01T12:05:00.000Z' });
    const tabB = withEntry(EMPTY_AGENT_GUIDANCE, 'RC-PREMORTEM', { status: 'pressed', state_key_hash: 'abcdefabcdef', turn_id: 'tB', at: '2026-10-01T12:06:00.000Z' });
    const rows: Row[] = [
      { id: 'ra', scenario_id: SCENARIO, created_at: '2026-10-01T12:05:00.000Z', coaching_state: toAgentGuidanceSnapshot(tabA) },
      { id: 'rb', scenario_id: SCENARIO, created_at: '2026-10-01T12:06:00.000Z', coaching_state: toAgentGuidanceSnapshot(tabB) },
    ];
    const got = await storeOver(rows).readMostRecentAgentGuidance(SCENARIO);
    expect(Object.keys(got!.entries).sort()).toEqual(['RC-PREMORTEM', 'RC-STRENGTHEN-ITEM']);
  });
});

describe('the write: one column, two envelopes', () => {
  const base: SessionTurnWrite = {
    scenario_id: SCENARIO, turn_id: 't', turn_class: 'direct_answer', handler_id: null, request_hash: 'sha256:x',
    response_emitted: true, llm_calls_used: 1, duration_ms: 1, handler_facts: [],
  };
  const rpcArgs = async (write: SessionTurnWrite): Promise<Record<string, unknown>> => {
    const calls: Array<Record<string, unknown>> = [];
    const client = { rpc: vi.fn(async (_fn: string, args: Record<string, unknown>) => { calls.push(args); return { data: 'row-1', error: null }; }) } as unknown as SupabaseClient;
    const store = new SupabaseSessionStore(client, new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }), { defaultReadLimit: 20 });
    await store.append(write);
    return calls[0]!;
  };

  it('an Agent answer row with a guidance record writes the agent_guidance envelope', async () => {
    expect((await rpcArgs({ ...base, agent_guidance: G1 })).p_coaching_state).toEqual(toAgentGuidanceSnapshot(G1));
  });

  it('CONTROL: a V5 row writes its pre_dispatch snapshot as before (a guidance record never displaces it); neither → null', async () => {
    expect((await rpcArgs({ ...base, coaching_state: EMPTY_COACHING_STATE, agent_guidance: G1 })).p_coaching_state).toEqual(V5);
    expect((await rpcArgs(base)).p_coaching_state).toBeNull();
  });
});
