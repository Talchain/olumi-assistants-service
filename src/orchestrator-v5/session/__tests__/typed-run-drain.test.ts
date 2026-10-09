import { afterEach, describe, expect, it, vi } from 'vitest';
import { HandlerFactSchema } from '@talchain/schemas/orchestrator';
import { loadCorpus } from '../../../../scripts/phase2/parity-2b.js';
import { SupabaseSessionStore } from '../supabase-store.js';
import type { SessionTurnWrite } from '../store.js';
import { log } from '../../../utils/telemetry.js';

vi.mock('../../../utils/telemetry.js', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const corpus = loadCorpus();
const eligible = [corpus[0]!, corpus[9]!];
function fixture() {
  const pending = new Map(eligible.map(c => [c.fact_id, { fact_id: c.fact_id, scenario_id: c.scenario_id, payload: c.fact, noop: false }]));
  const stored = new Set<string>();
  const quarantine = new Set<string>();
  const failStore = new Set<string>();
  const rpc = vi.fn(async (name: string, args: Record<string, any>) => {
    if (name.startsWith('append_')) return { data: 'committed-turn', error: null };
    if (name === 'claim_analysis_run_facts') return { data: { facts: [...pending.values()].slice(0, args.p_sweep_limit),
      queue_depth: pending.size, oldest_pending_age_seconds: 12 }, error: null };
    if (name === 'store_typed_analysis_run') {
      if (failStore.has(args.p_fact_id)) return { data: null, error: { code: '55P03', message: 'held storage lock' } };
      const existed = stored.has(args.p_fact_id);
      stored.add(args.p_fact_id); pending.delete(args.p_fact_id);
      return { data: !existed, error: null };
    }
    if (name === 'quarantine_analysis_fact') {
      quarantine.add(args.p_fact_id); pending.delete(args.p_fact_id);
      return { data: true, error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  const query = { select: vi.fn(() => query), eq: vi.fn(() => query),
    returns: vi.fn(async () => ({ data: [...pending.keys()].map(id => ({ id })), error: null })) };
  const client = { rpc, from: vi.fn(() => query) };
  const store = new SupabaseSessionStore(client as never, { invalidateAll: vi.fn() } as never, { defaultReadLimit: 20 });
  return { store, client, rpc, pending, stored, quarantine, failStore };
}
function turn(): SessionTurnWrite {
  return { scenario_id: eligible[0]!.scenario_id, turn_id: 'run-turn', turn_class: 'handler', handler_id: 'run_analysis',
    request_hash: 'hash', response_emitted: true, llm_calls_used: 0, duration_ms: 1,
    handler_facts: [HandlerFactSchema.parse(eligible[0]!.fact)] };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('typed Run drain outside the turn transaction', () => {
  it('isolates a failing store call and stores the other fact; next sweep recovers the pending work', async () => {
    const f = fixture();
    f.failStore.add(eligible[0]!.fact_id);
    await expect(f.store.deriveQueuedAnalysisRuns({ sweepLimit: 20 })).resolves.toMatchObject({ derived: 1, failed: 1 });
    expect([...f.stored]).toEqual([eligible[1]!.fact_id]);
    expect([...f.pending.keys()]).toEqual([eligible[0]!.fact_id]);
    f.failStore.clear();
    await expect(f.store.deriveQueuedAnalysisRuns({ sweepLimit: 20 })).resolves.toMatchObject({ derived: 1, failed: 0 });
    expect(f.pending.size).toBe(0);
    expect(log.info).toHaveBeenCalledTimes(2);
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ event: 'analysis_run.drain', queue_depth: 2,
      oldest_pending_age_seconds: 12, derived: 1, quarantined: 0, skipped: 0, failed: 1 }), expect.any(String));
  });
  it('quarantines options=[null] with the ONE mapper reason and no payload copy', async () => {
    const f = fixture();
    const row = f.pending.get(eligible[0]!.fact_id)!;
    const payload = structuredClone(row.payload) as Record<string, any>;
    payload.result.input_snapshot.options = [null];
    row.payload = payload;
    await expect(f.store.deriveQueuedAnalysisRuns({ sweepLimit: 20 })).resolves.toMatchObject({ derived: 1, quarantined: 1 });
    const call = f.rpc.mock.calls.find(([name]) => name === 'quarantine_analysis_fact')!;
    expect(call[1]).toEqual({ p_fact_id: row.fact_id, p_reason: expect.stringContaining('input_snapshot.options.0'), p_detail: null });
  });
  it('a fresh drain recovers facts left queued when a prior worker crashed after claiming', async () => {
    const f = fixture();
    await f.rpc('claim_analysis_run_facts', { p_fact_ids: [], p_sweep_limit: 20 });
    expect(f.stored.size).toBe(0); // prior worker stopped before mapping/storage
    // Models the next DB claim after lease expiry; SQL rehearsal proves the lease.
    const restarted = new SupabaseSessionStore(f.client as never, { invalidateAll: vi.fn() } as never, { defaultReadLimit: 20 });
    await expect(restarted.deriveQueuedAnalysisRuns({ sweepLimit: 20 })).resolves.toMatchObject({ derived: 2, failed: 0 });
    expect(f.pending.size).toBe(0);
  });
  it('marks a refusal as terminal skipped work, so it cannot starve later sweeps', async () => {
    const f = fixture();
    const refusal = corpus[3]!;
    f.pending.set(refusal.fact_id, { fact_id: refusal.fact_id, scenario_id: refusal.scenario_id, payload: refusal.fact, noop: false });
    await expect(f.store.deriveQueuedAnalysisRuns({ sweepLimit: 20 })).resolves.toMatchObject({ derived: 2, skipped: 1, quarantined: 0 });
    expect(f.rpc).toHaveBeenCalledWith('quarantine_analysis_fact', { p_fact_id: refusal.fact_id, p_reason: 'skipped_refusal', p_detail: null });
    await expect(f.store.deriveQueuedAnalysisRuns({ sweepLimit: 20 })).resolves.toMatchObject({ derived: 0, skipped: 0 });
  });
  it('clears an enqueue racing with completed storage without duplicating the Run', async () => {
    const f = fixture();
    f.stored.add(eligible[0]!.fact_id);
    await expect(f.store.deriveQueuedAnalysisRuns({ sweepLimit: 20 })).resolves.toMatchObject({ derived: 1, skipped: 1 });
    expect(f.stored.size).toBe(2); expect(f.pending.size).toBe(0);
  });
  it('contains thrown transport failures and caps the sweep at 20', async () => {
    const f = fixture();
    f.rpc.mockRejectedValue(new Error('transport unavailable'));
    await expect(f.store.deriveQueuedAnalysisRuns({ sweepLimit: 999 })).resolves.toMatchObject({ failed: 1, derived: 0 });
    expect(f.rpc).toHaveBeenCalledWith('claim_analysis_run_facts', { p_fact_ids: [], p_sweep_limit: 20 });
    expect(log.info).toHaveBeenCalledTimes(1);
  });
  it('a committed turn resolves without waiting for a drain that never settles', async () => {
    vi.useFakeTimers({ toFake: ['setImmediate'] });
    const f = fixture();
    const drain = vi.spyOn(f.store, 'deriveQueuedAnalysisRuns').mockImplementation(() => new Promise(() => {}));
    await expect(f.store.append(turn())).resolves.toEqual({ id: 'committed-turn' });
    expect(drain).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(drain).toHaveBeenCalledWith({ factIds: eligible.map(c => c.fact_id), sweepLimit: 20 });
    expect(f.client.from).toHaveBeenCalledWith('v5_handler_facts');
  });
  it('turn unaffected by drain failure: append receipt stays committed and resolves', async () => {
    vi.useFakeTimers({ toFake: ['setImmediate'] });
    const f = fixture();
    vi.spyOn(f.store, 'deriveQueuedAnalysisRuns').mockRejectedValue(new Error('injected drain failure'));
    await expect(f.store.append(turn())).resolves.toEqual({ id: 'committed-turn' });
    await vi.runAllTimersAsync();
    expect(f.rpc.mock.calls.filter(([name]) => name.startsWith('append_'))).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'analysis_run.after_commit_failed' }), expect.any(String));
  });
  it('a completed turn with no own Run still sweeps older/prod facts after responding', async () => {
    vi.useFakeTimers({ toFake: ['setImmediate'] });
    const f = fixture();
    const drain = vi.spyOn(f.store, 'deriveQueuedAnalysisRuns');
    await expect(f.store.append({ ...turn(), turn_class: 'direct_answer', handler_id: null, handler_facts: [] })).resolves.toEqual({ id: 'committed-turn' });
    expect(drain).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(drain).toHaveBeenCalledWith({ factIds: [], sweepLimit: 20 });
    expect(f.client.from).not.toHaveBeenCalled();
    expect(f.stored.size).toBe(2);
  });
  it('does not schedule a drain for a rejected append', async () => {
    vi.useFakeTimers({ toFake: ['setImmediate'] });
    const f = fixture();
    const drain = vi.spyOn(f.store, 'deriveQueuedAnalysisRuns');
    f.rpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'append canceled' } });
    await expect(f.store.append(turn())).rejects.toThrow('RPC failed');
    await vi.runAllTimersAsync();
    expect(drain).not.toHaveBeenCalled();
  });
});
