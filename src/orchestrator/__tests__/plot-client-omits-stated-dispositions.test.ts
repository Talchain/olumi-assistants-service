/**
 * ⛔ PLoT NEVER RECEIVES THE RECORDS COMPILER'S RECEIPT (DL ruling 5 Oct 2026 — the key is CEE GraphV3 ONLY).
 *
 * `GraphV3` now declares `graph.stated_dispositions`, so the Run snapshot's `GraphV3.safeParse`
 * (`build-turn-context.ts`) keeps it where the base commit stripped it. It is CEE bookkeeping, not model content:
 * PLoT's request must stay byte-identical to the base, so the client drops it at the wire, on every endpoint
 * that posts a graph.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/index.js', async (original) => {
  const source = await original<typeof import('../../config/index.js')>();
  return { ...source, config: new Proxy(source.config, { get(target, key) {
    return key === 'plot' ? { baseUrl: 'http://plot.test', authToken: 'local-test' } : Reflect.get(target, key);
  } }) };
});

import { createPLoTClient } from '../plot-client.js';

const GRAPH = { nodes: [{ id: 'g', kind: 'goal', label: 'G' }], edges: [] };
const RECEIPT = [{ stated_index: 0, stated_item: { kind: 'figure', source_quote: 'x' }, disposition: 'rejected', reason: 'stated_value_not_carried' }];
const payload = (graph: unknown) => ({ graph, options: [{ id: 'a', option_id: 'a', interventions: {} }], goal_node_id: 'g' });
const RESPONSE = { meta: { seed_used: 42, n_samples: 100, response_hash: 'h' }, results: [{ option_id: 'a' }] };

describe('the PLoT client posts no stated_dispositions', () => {
  const fetch = vi.fn();
  beforeEach(() => { fetch.mockReset(); fetch.mockResolvedValue({ ok: true, status: 200, json: async () => RESPONSE }); vi.stubGlobal('fetch', fetch); });
  afterEach(() => { vi.unstubAllGlobals(); });
  const sentBody = (call = 0) => JSON.parse(String((fetch.mock.calls[call]![1] as { body: string }).body)) as Record<string, unknown>;

  it('⭐ RED: /v2/run receives the graph without the receipt', async () => {
    await createPLoTClient()!.run(payload({ ...GRAPH, stated_dispositions: RECEIPT }), 'r1', { retryPolicy: 'no_retry' });
    expect(sentBody().graph).toEqual(GRAPH);
  });

  it('⭐ RED: the decision-flip /v2/run receives the graph without the receipt', async () => {
    await createPLoTClient()!.decisionFlip!(payload({ ...GRAPH, stated_dispositions: RECEIPT }), 'r2').catch(() => undefined);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sentBody().graph).toEqual(GRAPH);
  });

  it('CONTROL: a payload without the key is posted byte-identically', async () => {
    const p = payload(GRAPH);
    await createPLoTClient()!.run(p, 'r3', { retryPolicy: 'no_retry' });
    expect((fetch.mock.calls[0]![1] as { body: string }).body).toBe(JSON.stringify(p));
  });
});
