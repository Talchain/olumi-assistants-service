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
  const storeErrors = new Map<string, { code: string; message: string }>();
  const attempts = new Map<string, number>();
  const rpc = vi.fn(async (name: string, args: Record<string, any>) => {
    if (name.startsWith('append_')) return { data: 'committed-turn', error: null };
    if (name === 'finish_analysis_run_sweep') return { data: true, error: null };
    if (name === 'record_analysis_run_failure') {
      const count = (attempts.get(args.p_fact_id) ?? 0) + 1; attempts.set(args.p_fact_id, count);
      if (count >= 5) { quarantine.add(args.p_fact_id); pending.delete(args.p_fact_id); }
      return { data: count >= 5, error: null };
    }
    if (name === 'claim_analysis_run_facts') return { data: { facts: [...pending.values()].slice(0, args.p_sweep_limit),
      lease_id: 'lease', depth_estimate: pending.size, oldest_pending_age_seconds: 12 }, error: null };
    if (name === 'store_typed_analysis_run') {
      if (failStore.has(args.p_fact_id)) return { data: null, error: storeErrors.get(args.p_fact_id) ?? { code: '55P03', message: 'held storage lock' } };
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
  const store = new SupabaseSessionStore(client as never, { invalidateAll: vi.fn() } as never, { defaultReadLimit: 20, analysisRunDerivation: { rpc } });
  return { store, client, rpc, pending, stored, quarantine, failStore, attempts, storeErrors };
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
    await expect(f.store.deriveAnalysisRuns({ sweepLimit: 20 })).resolves.toMatchObject({ derived: 1, failed: 1 });
    expect([...f.stored]).toEqual([eligible[1]!.fact_id]);
    expect([...f.pending.keys()]).toEqual([eligible[0]!.fact_id]);
    f.failStore.clear();
    await expect(f.store.deriveAnalysisRuns({ sweepLimit: 20 })).resolves.toMatchObject({ derived: 1, failed: 0 });
    expect(f.pending.size).toBe(0);
    expect(log.info).toHaveBeenCalledTimes(2);
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ event: 'analysis_run.drain', depth_estimate: 2, attempts: 2,
      oldest_pending_age_seconds: 12, derived: 1, quarantined: 0, skipped: 0, failed: 1 }), expect.any(String));
  });
  it('quarantines options=[null] with the ONE mapper reason and no payload copy', async () => {
    const f = fixture();
    const row = f.pending.get(eligible[0]!.fact_id)!;
    const payload = structuredClone(row.payload) as Record<string, any>;
    payload.result.input_snapshot.options = [null];
    row.payload = payload;
    await expect(f.store.deriveAnalysisRuns({ sweepLimit: 20 })).resolves.toMatchObject({ derived: 1, quarantined: 1 });
    const call = f.rpc.mock.calls.find(([name]) => name === 'quarantine_analysis_fact')!;
    expect(call[1]).toEqual({ p_fact_id: row.fact_id, p_reason: expect.stringContaining('input_snapshot.options.0'), p_detail: null });
  });
  it('marks a refusal as terminal skipped work, so it cannot starve later sweeps', async () => {
    const f = fixture();
    const refusal = corpus[3]!;
    f.pending.set(refusal.fact_id, { fact_id: refusal.fact_id, scenario_id: refusal.scenario_id, payload: refusal.fact, noop: false });
    await expect(f.store.deriveAnalysisRuns({ sweepLimit: 20 })).resolves.toMatchObject({ derived: 2, skipped: 1, quarantined: 0 });
    expect(f.rpc).toHaveBeenCalledWith('quarantine_analysis_fact', { p_fact_id: refusal.fact_id, p_reason: 'skipped_refusal', p_detail: null });
    await expect(f.store.deriveAnalysisRuns({ sweepLimit: 20 })).resolves.toMatchObject({ derived: 0, skipped: 0 });
  });
  it('contains thrown transport failures and caps the sweep at 20', async () => {
    const f = fixture();
    f.rpc.mockRejectedValue(new Error('transport unavailable'));
    await expect(f.store.deriveAnalysisRuns({ sweepLimit: 999 })).resolves.toMatchObject({ failed: 1, derived: 0 });
    expect(f.rpc).toHaveBeenCalledWith('claim_analysis_run_facts', { p_sweep_limit: 20 });
    expect(log.info).toHaveBeenCalledTimes(1);
  });
  it('a committed turn resolves without waiting for a drain that never settles', async () => {
    vi.useFakeTimers({ toFake: ['setImmediate'] });
    const f = fixture();
    const drain = vi.spyOn(f.store, 'deriveAnalysisRuns').mockImplementation(() => new Promise(() => {}));
    await expect(f.store.append(turn())).resolves.toEqual({ id: 'committed-turn' });
    expect(drain).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(drain).toHaveBeenCalledWith({ sweepLimit: 20 });
    expect(f.client.from).not.toHaveBeenCalled();
  });
  it('turn unaffected by drain failure: append receipt stays committed and resolves', async () => {
    vi.useFakeTimers({ toFake: ['setImmediate'] });
    const f = fixture();
    vi.spyOn(f.store, 'deriveAnalysisRuns').mockRejectedValue(new Error('injected drain failure'));
    await expect(f.store.append(turn())).resolves.toEqual({ id: 'committed-turn' });
    await vi.runAllTimersAsync();
    expect(f.rpc.mock.calls.filter(([name]) => name.startsWith('append_'))).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'analysis_run.after_commit_failed' }), expect.any(String));
  });
  it('a completed turn with no own Run still sweeps older/prod facts after responding', async () => {
    vi.useFakeTimers({ toFake: ['setImmediate'] });
    const f = fixture();
    const drain = vi.spyOn(f.store, 'deriveAnalysisRuns');
    await expect(f.store.append({ ...turn(), turn_class: 'direct_answer', handler_id: null, handler_facts: [] })).resolves.toEqual({ id: 'committed-turn' });
    expect(drain).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(drain).toHaveBeenCalledWith({ sweepLimit: 20 });
    expect(f.client.from).not.toHaveBeenCalled();
    expect(f.stored.size).toBe(2);
  });
  it('has no autonomous timer until explicitly started; the interval derives a legacy writer fact and stops', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.rpc).not.toHaveBeenCalled();
    const stop = f.store.startAnalysisRunSweeper();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.stored.size).toBe(2); // no append or CEE nudge occurred
    const calls = f.rpc.mock.calls.length;
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.rpc).toHaveBeenCalledTimes(calls);
  });
  it('quarantines a poison fact on its fifth non-unique storage failure', async () => {
    const f = fixture(); const id = eligible[0]!.fact_id;
    f.failStore.add(id);
    for (let n = 1; n <= 5; n++) {
      await f.store.deriveAnalysisRuns({ sweepLimit: 20 });
      expect(f.attempts.get(id)).toBe(n);
      expect(f.quarantine.has(id)).toBe(n === 5);
    }
    await f.store.deriveAnalysisRuns({ sweepLimit: 20 });
    expect(f.attempts.get(id)).toBe(5);
    expect(f.rpc).toHaveBeenCalledWith('record_analysis_run_failure', {
      p_fact_id: id, p_error_code: '55P03', p_detail: 'held storage lock',
    });
  });
  it('a unique collision quarantines immediately without consuming poison attempts', async () => {
    const f = fixture(); const id = eligible[0]!.fact_id;
    f.failStore.add(id); f.storeErrors.set(id, { code: '23505', message: 'duplicate run identity' });
    await expect(f.store.deriveAnalysisRuns({ sweepLimit: 20 })).resolves.toMatchObject({ derived: 1, quarantined: 1, failed: 0 });
    expect(f.rpc).toHaveBeenCalledWith('quarantine_analysis_fact', { p_fact_id: id, p_reason: 'duplicate_run_id', p_detail: '23505' });
    expect(f.attempts.size).toBe(0);
  });
  it('single-flights interval and post-append nudges while a claim is outstanding', async () => {
    vi.useFakeTimers(); const f = fixture();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    f.rpc.mockImplementationOnce(async () => { await held; return { data: { facts: [], lease_id: 'lease', depth_estimate: 0, oldest_pending_age_seconds: 0 }, error: null }; });
    const stop = f.store.startAnalysisRunSweeper();
    const drain = f.store.deriveAnalysisRuns({ sweepLimit: 20 });
    await f.store.append(turn());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.rpc.mock.calls.filter(([name]) => name === 'claim_analysis_run_facts')).toHaveLength(1);
    release(); await drain; stop();
  });
  it('an append-only fake transport receives no derivation calls or table access', async () => {
    vi.useFakeTimers(); const rpc = vi.fn(async () => ({ data: 'committed-turn', error: null }));
    const client = { rpc, from: vi.fn() };
    const store = new SupabaseSessionStore(client as never, { invalidateAll: vi.fn() } as never, { defaultReadLimit: 20 });
    await expect(store.append(turn())).resolves.toEqual({ id: 'committed-turn' });
    const stop = store.startAnalysisRunSweeper();
    await vi.advanceTimersByTimeAsync(120_000); stop();
    await expect(store.deriveAnalysisRuns({ sweepLimit: 20 })).resolves.toMatchObject({ attempts: 0, failed: 0 });
    expect(rpc).toHaveBeenCalledTimes(1); expect(client.from).not.toHaveBeenCalled();
  });
  it('does not schedule a drain for a rejected append', async () => {
    vi.useFakeTimers({ toFake: ['setImmediate'] });
    const f = fixture();
    const drain = vi.spyOn(f.store, 'deriveAnalysisRuns');
    f.rpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'append canceled' } });
    await expect(f.store.append(turn())).rejects.toThrow('RPC failed');
    await vi.runAllTimersAsync();
    expect(drain).not.toHaveBeenCalled();
  });
});
