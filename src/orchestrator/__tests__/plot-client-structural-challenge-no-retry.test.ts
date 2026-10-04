import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/index.js', async (original) => {
  const source = await original<typeof import('../../config/index.js')>();
  return { ...source, config: new Proxy(source.config, { get(target, key) {
    return key === 'plot' ? { baseUrl: 'http://plot.test', authToken: 'local-test' } : Reflect.get(target, key);
  } }) };
});

import { createPLoTClient, PLoTError, PLoTTimeoutError } from '../plot-client.js';

const PAYLOAD = { graph: { nodes: [], edges: [] }, options: [{ id: 'a', option_id: 'a', interventions: {} }], goal_node_id: 'g' };
const RESPONSE = { meta: { seed_used: 42, n_samples: 100, response_hash: 'h' }, results: [{ option_id: 'a' }] };
const success = () => ({ ok: true, status: 200, json: async () => RESPONSE });

describe('structural candidate invocation issues exactly one request', () => {
  const fetch = vi.fn();
  beforeEach(() => { fetch.mockReset(); vi.stubGlobal('fetch', fetch); vi.useFakeTimers(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('success has one engine request and preserves the response', async () => {
    fetch.mockResolvedValue(success());
    const response = await createPLoTClient()!.run(PAYLOAD, 'candidate', { retryPolicy: 'no_retry' });
    expect(response.meta.seed_used).toBe(42);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([400, 422, 500, 503])('%s never retries the candidate', async (status) => {
    fetch.mockResolvedValue({ ok: false, status, json: async () => ({ message: 'unavailable' }) });
    await expect(createPLoTClient()!.run(PAYLOAD, 'candidate', { retryPolicy: 'no_retry' })).rejects.toBeInstanceOf(PLoTError);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a network reset never retries the candidate', async () => {
    fetch.mockRejectedValue(new TypeError('fetch failed: ECONNRESET'));
    await expect(createPLoTClient()!.run(PAYLOAD, 'candidate', { retryPolicy: 'no_retry' })).rejects.toThrow();
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['timeout', 'abort'] as const)('%s never retries the candidate', async (failure) => {
    fetch.mockImplementation((_url, opts: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      opts.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const controller = new AbortController();
    const request = createPLoTClient()!.run(PAYLOAD, 'candidate', { retryPolicy: 'no_retry', turnSignal: controller.signal });
    const assertion = failure === 'timeout' ? expect(request).rejects.toBeInstanceOf(PLoTTimeoutError) : expect(request).rejects.toThrow();
    if (failure === 'abort') controller.abort();
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([503, 'reset'] as const)('ordinary callers still retry a transient %s', async (failure) => {
    if (failure === 'reset') fetch.mockRejectedValueOnce(new TypeError('fetch failed: ECONNRESET'));
    else fetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ message: 'unavailable' }) });
    fetch.mockResolvedValueOnce(success());
    const request = createPLoTClient()!.run(PAYLOAD, 'ordinary');
    const assertion = expect(request).resolves.toMatchObject({ meta: { seed_used: 42 } });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
