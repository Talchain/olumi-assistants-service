/**
 * Unit tests for the ISL counterfactual transport client.
 *
 * Positive control FIRST (CLAUDE.md discipline #13): a well-formed 2xx that
 * validates against the typed contract returns `{ ok: true }`. Every other
 * path is fail-loud with a typed reason — the client never yields a value.
 * Also pins the reachable-seam auth: the correct route + `X-API-Key` header.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { makeCounterfactualClient, type CounterfactualRequestBody } from '../counterfactual-client.js';

const BASE = 'https://isl.example.test';
const REQUEST: CounterfactualRequestBody = {
  model: {
    variables: ['goal_fit', 'factor_capacity'],
    equations: { goal_fit: '0 + 0.6 * factor_capacity' },
    distributions: { factor_capacity: { type: 'uniform', parameters: { min: 20, max: 20 } } },
  },
  intervention: { factor_capacity: 20 },
  outcome: 'goal_fit',
};

function validResponseBody() {
  return {
    scenario: { intervention: { factor_capacity: 20 }, outcome: 'goal_fit' },
    prediction: {
      point_estimate: 12,
      confidence_interval: { lower: 12, upper: 12 },
      sensitivity_range: { optimistic: 14, pessimistic: 10, explanation: 'x' },
    },
    uncertainty: { overall: 'low', sources: [] },
    robustness: { score: 'robust', critical_assumptions: [] },
    explanation: { summary: 's', reasoning: 'r', technical_basis: 't', assumptions: [] },
  };
}

function stubFetch(impl: (url: string, init: globalThis.RequestInit) => Promise<Response> | Response) {
  const fn = vi.fn(impl as never);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function client() {
  return makeCounterfactualClient(BASE, 'secret-key', 5000);
}

describe('CounterfactualClient — positive control', () => {
  it('returns ok with the validated response on a well-formed 2xx', async () => {
    stubFetch(() => new Response(JSON.stringify(validResponseBody()), { status: 200 }));
    const result = await client().getCounterfactual(REQUEST, 'req-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.prediction.point_estimate).toBe(12);
      expect(result.response.scenario.outcome).toBe('goal_fit');
    }
  });

  it('posts to the counterfactual route with the X-API-Key header', async () => {
    const fn = stubFetch(() => new Response(JSON.stringify(validResponseBody()), { status: 200 }));
    await client().getCounterfactual(REQUEST, 'req-2');
    const [url, init] = fn.mock.calls[0] as [string, globalThis.RequestInit];
    expect(url).toBe('https://isl.example.test/api/v1/causal/counterfactual');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('secret-key');
  });
});

describe('CounterfactualClient — fail loud', () => {
  it('422 → invalid_input (honest limitation, never an apology)', async () => {
    stubFetch(() => new Response(JSON.stringify({ detail: 'do∩observe overlap' }), { status: 422 }));
    const result = await client().getCounterfactual(REQUEST, 'req-3');
    expect(result).toMatchObject({ ok: false, reason: 'invalid_input', status: 422 });
  });

  it('500 → non_2xx', async () => {
    stubFetch(() => new Response('boom', { status: 500 }));
    const result = await client().getCounterfactual(REQUEST, 'req-4');
    expect(result).toMatchObject({ ok: false, reason: 'non_2xx', status: 500 });
  });

  it('2xx that fails the typed contract → unparsable', async () => {
    stubFetch(() => new Response(JSON.stringify({ prediction: { point_estimate: 1 } }), { status: 200 }));
    const result = await client().getCounterfactual(REQUEST, 'req-5');
    expect(result).toMatchObject({ ok: false, reason: 'unparsable' });
  });

  it('network failure → network', async () => {
    stubFetch(() => {
      throw new Error('fetch failed');
    });
    const result = await client().getCounterfactual(REQUEST, 'req-6');
    expect(result).toMatchObject({ ok: false, reason: 'network' });
  });

  it('caller abort → timeout', async () => {
    const controller = new AbortController();
    controller.abort();
    stubFetch(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });
    const result = await client().getCounterfactual(REQUEST, 'req-7', { signal: controller.signal });
    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
  });
});
