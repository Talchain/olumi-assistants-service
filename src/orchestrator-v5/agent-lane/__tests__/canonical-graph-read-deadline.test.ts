import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANALYSIS_REREAD_TIMEOUT_MS, AnalysisReadDeadlineError } from '../../session/analysis-read-deadline.js';
import { FRESH_READ, turnReadCache } from '../turn-read-cache.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const PATH = '/assist/v1/scenarios/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/graph';
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('graph reread deadline: cache lifetime', () => {
  it('a late healthy response after timeout is never cached as FRESH', async () => {
    let resolve!: (read: Awaited<ReturnType<InternalDispatch>>) => void;
    const pending = new Promise<Awaited<ReturnType<InternalDispatch>>>(done => { resolve = done; });
    const inner = vi.fn<InternalDispatch>().mockReturnValueOnce(pending).mockResolvedValue({ status: 503, json: {} });
    const cache = turnReadCache(inner, PATH);
    const timed = cache.dispatch(PATH, FRESH_READ).catch(error => error);
    await vi.advanceTimersByTimeAsync(ANALYSIS_REREAD_TIMEOUT_MS);
    expect(await timed).toBeInstanceOf(AnalysisReadDeadlineError);
    resolve({ status: 200, json: { graph_hash: 'timed-out-run', analysis_state: { run_state: { kind: 'complete_current' } } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(await cache.dispatch(PATH, {})).toEqual({ status: 503, json: {} });
    expect(inner).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('joining a stranded prefetch and retrying cannot restart the whole graph-read budget', async () => {
    const inner = vi.fn<InternalDispatch>().mockImplementation(() => new Promise(() => {}));
    const cache = turnReadCache(inner, PATH);
    cache.prefetch();
    await vi.advanceTimersByTimeAsync(300);
    let error: unknown;
    const read = cache.dispatch(PATH, {}).catch(value => { error = value; });
    await vi.advanceTimersByTimeAsync(ANALYSIS_REREAD_TIMEOUT_MS - 1);
    expect(error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await read;
    expect(error).toBeInstanceOf(AnalysisReadDeadlineError);
    expect(inner).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
