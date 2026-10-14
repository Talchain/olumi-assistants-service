import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import historical from './fixtures/runtime-l1-captured-logical-ledger.json';
import type { ProviderPolicy } from '../../src/adapters/llm/provider-policy.js';

const network = vi.hoisted(() => vi.fn());
// Real SDKs and their retry loops; both transports are completely offline.
vi.mock('undici', async () => ({ ...await vi.importActual<typeof import('undici')>('undici'), fetch: network }));

let events: Array<{ event: string; data: Record<string, any> }>;
let bodies: Record<string, any>[];
let telemetry: typeof import('../../src/utils/telemetry.js');
let openaiAdapter: typeof import('../../src/adapters/llm/openai.js');

function response(provider: 'openai' | 'anthropic', status = 200, requestId?: string): Response {
  const payload = status !== 200 ? { error: { message: 'service unavailable', type: 'server_error' } }
    : provider === 'openai'
      ? { id: 'offline-chat', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }
      : { id: 'offline-message', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text: '{"ok":true}' }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 1 } };
  return new Response(JSON.stringify(payload), { status, headers: {
    'content-type': 'application/json', 'retry-after-ms': '0', 'retry-after': '0',
    ...(requestId ? { [provider === 'openai' ? 'x-request-id' : 'request-id']: requestId } : {}),
  } });
}

async function openai(model = 'o4-mini', requestId = 'offline-openai', effort: 'low' | 'medium' | 'high' = 'high') {
  return new openaiAdapter.OpenAIAdapter(model).chat({ system: 'offline system', userMessage: 'offline user', maxTokens: 32, reasoningEffort: effort }, { requestId, timeoutMs: 30_000 });
}

function traces() {
  return events.filter(e => e.event === telemetry.TelemetryEvents.LlmCall).map(e => e.data.provider_trace);
}

describe('L1 connected adapter SDK attempts (offline, not current-turn measurement)', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('OPENAI_API_KEY', 'sk-offline-test');
    vi.stubEnv('ANTHROPIC_API_KEY', 'offline-test');
    vi.stubEnv('RETRY_BASE_DELAY_MS', '1');
    vi.stubEnv('RETRY_MAX_DELAY_MS', '1');
    events = []; bodies = [];
    network.mockReset();
    network.mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      expect(url).toMatch(/^https:\/\/api\.(openai|anthropic)\.com\//);
      bodies.push(JSON.parse(init.body));
      return response(url.includes('anthropic') ? 'anthropic' : 'openai', 200, 'offline-provider-request');
    });
    vi.stubGlobal('fetch', network);
    telemetry = await import('../../src/utils/telemetry.js');
    telemetry.setTestSink((event, data) => events.push({ event, data }));
    // Cold adapter transformation belongs to setup, not a timed provider control.
    openaiAdapter = await import('../../src/adapters/llm/openai.js');
  });
  afterEach(() => {
    telemetry.setTestSink(null);
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
  });

  it('CONTROL: real SDK success preserves the caller result and exact effort/body', async () => {
    expect((await openai()).content).toBe('{"ok":true}');
    expect(network).toHaveBeenCalledTimes(1);
    expect(bodies[0]).toMatchObject({ model: 'o4-mini', reasoning_effort: 'high' });
  });

  it('RED: a single success joins the unchanged policy handle to one physical request', async () => {
    const policy = await import('../../src/adapters/llm/provider-policy.js');
    const scope = policy.OPENAI_ONLY('offline-l1');
    await policy.runWithProviderPolicy(scope, () => openai());
    expect(scope.calls).toHaveLength(1);
    expect(network).toHaveBeenCalledTimes(1);
    const trace = traces()[0];
    expect(trace).toBeDefined();
    expect(trace).toMatchObject({ request_id: 'offline-openai', provider_policy_index: 0, outcome: 'success', usage: { input_tokens: 3, output_tokens: 1 } });
    expect(trace.attempts).toHaveLength(1);
    expect(trace.attempts[0]).toMatchObject({ logical_call_id: trace.logical_call_id, provider_policy_index: 0, provider_request_id: 'offline-provider-request', outcome: 'response', sent_identity: { provider: 'openai', model: 'o4-mini', reasoning_effort: 'high' } });
    const sent = network.mock.calls[0][1].body;
    expect(trace.attempts[0].sent_identity.body_sha256).toBe(createHash('sha256').update(sent).digest('hex'));
  });

  it('RED: existing SDK retries and repository retry share one logical call, distinct attempts', async () => {
    let n = 0;
    network.mockImplementation(async (_input, init) => { bodies.push(JSON.parse(init.body)); return response('openai', ++n <= 3 ? 503 : 200); });
    const policy = await import('../../src/adapters/llm/provider-policy.js');
    const scope = policy.OPENAI_ONLY('offline-retry');
    expect((await policy.runWithProviderPolicy(scope, () => openai())).content).toBe('{"ok":true}');
    expect(network).toHaveBeenCalledTimes(4); // unchanged default SDK 2 retries, then existing outer retry
    expect(scope.calls).toHaveLength(1);
    expect(bodies.every(b => JSON.stringify(b) === JSON.stringify(bodies[0]))).toBe(true);
    const all = traces(); expect(all).toHaveLength(1);
    const trace = all[0]; expect(trace).toBeDefined();
    expect(trace.outcome).toBe('success');
    expect(trace.attempts.map((a: any) => a.logical_call_id)).toEqual(Array(4).fill(trace.logical_call_id));
    expect(new Set(trace.attempts.map((a: any) => a.physical_attempt_id)).size).toBe(4);
    expect(trace.attempts.map((a: any) => a.outcome)).toEqual(['http_error', 'http_error', 'http_error', 'response']);
  });

  it('RED: retry exhaustion retains a failed terminal without changing the thrown adapter error', async () => {
    network.mockImplementation(async () => response('openai', 503));
    await expect(openai()).rejects.toMatchObject({ provider: 'openai', status: 503 });
    expect(network).toHaveBeenCalledTimes(9);
    const all = traces(); expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ outcome: 'failure', error_status: 503 });
    expect(all[0].attempts).toHaveLength(9);
  });

  it('RED: Anthropic client and existing transport guard handles are joined separately', async () => {
    const policy = await import('../../src/adapters/llm/provider-policy.js');
    const scope = { allowed: new Set<'anthropic'>(['anthropic']), route: 'offline-anthropic', calls: [], truncated: false };
    const { chatWithAnthropic } = await import('../../src/adapters/llm/anthropic.js');
    await policy.runWithProviderPolicy(scope, () => chatWithAnthropic({ model: 'claude-sonnet-5', system: 'offline system', userMessage: 'offline user', requestId: 'offline-anthropic', maxTokens: 32 }));
    expect(scope.calls).toHaveLength(2); // the existing client and transport guards, no added guard
    const trace = traces()[0]; expect(trace).toBeDefined();
    expect(trace).toMatchObject({ provider_policy_index: 0, request_id: 'offline-anthropic', outcome: 'success' });
    expect(trace.attempts[0]).toMatchObject({ provider_policy_index: 1, sent_identity: { provider: 'anthropic', model: bodies[0].model, thinking_mode: 'disabled' } });
  });

  it('CONTROL: forbidden Anthropic remains refused before transport', async () => {
    const policy = await import('../../src/adapters/llm/provider-policy.js');
    const scope = policy.OPENAI_ONLY('offline-refusal');
    const { chatWithAnthropic } = await import('../../src/adapters/llm/anthropic.js');
    await expect(policy.runWithProviderPolicy(scope, () => chatWithAnthropic({ model: 'claude-sonnet-5', system: 's', userMessage: 'u', maxTokens: 32 }))).rejects.toBeDefined();
    expect(network).not.toHaveBeenCalled();
    expect(scope.calls).toHaveLength(1);
    expect(scope.calls[0]?.outcome).toBe('refused_before_network');
  });

  it('RED: a capped transport guard is unknown, never assigned the earlier client handle', async () => {
    const policy = await import('../../src/adapters/llm/provider-policy.js');
    const scope: ProviderPolicy = {
      allowed: new Set(['anthropic']), route: 'offline-capped', truncated: false,
      calls: Array.from({ length: policy.MAX_RECORDED_CALLS - 1 }, () => ({
        provider: 'anthropic', site: 'offline-existing', model: 'offline', purpose: 'offline', outcome: 'allowed',
      })),
    };
    const { chatWithAnthropic } = await import('../../src/adapters/llm/anthropic.js');
    await policy.runWithProviderPolicy(scope, () => chatWithAnthropic({ model: 'claude-sonnet-5', system: 's', userMessage: 'u', maxTokens: 32 }));
    expect(scope.truncated).toBe(true);
    const trace = traces()[0];
    expect(trace.provider_policy_index).toBe(policy.MAX_RECORDED_CALLS - 1);
    expect(trace.attempts[0].provider_policy_index).toBeNull();
    expect(trace.attempts[0].policy_index_source).toBe('transport_guard');
  });

  it('RED: unavailable prompt/version/effort/cost/quality identities remain null', async () => {
    network.mockImplementation(async () => response('openai'));
    await openai('gpt-4.1', '');
    const trace = traces()[0]; expect(trace).toBeDefined();
    expect(trace).toMatchObject({ request_id: null, provider_policy_index: null, prompt_version: null, prompt_source: null, quality: null, cost: null });
    expect(trace.attempts[0]).toMatchObject({ provider_request_id: null, sent_identity: { reasoning_effort: null, thinking_mode: null } });
  });

  it('RED: concurrent invocations cannot attach both responses to the latest policy row', async () => {
    const policy = await import('../../src/adapters/llm/provider-policy.js');
    const scope = policy.OPENAI_ONLY('offline-concurrent');
    await policy.runWithProviderPolicy(scope, () => Promise.all([openai('o4-mini', 'A'), openai('gpt-4.1', 'B')]));
    expect(scope.calls).toHaveLength(2);
    const all = traces(); expect(all).toHaveLength(2);
    const [a, b] = all.sort((x, y) => x.request_id.localeCompare(y.request_id));
    expect(a).toMatchObject({ request_id: 'A', provider_policy_index: 0 });
    expect(b).toMatchObject({ request_id: 'B', provider_policy_index: 1 });
    expect(a.logical_call_id).not.toBe(b.logical_call_id);
    expect(a.attempts[0].logical_call_id).toBe(a.logical_call_id);
    expect(b.attempts[0].logical_call_id).toBe(b.logical_call_id);
  });

  it('RED: fixture-derived model/effort attribution does not invent historical physical identities', async () => {
    const row = historical.records.find(r => r.recorded_identity.provider === 'openai')!;
    expect(row.physical_attempt_ids).toBeNull(); expect(row.physical_attempt_count).toBeNull();
    await openai(row.recorded_identity.model!, 'offline-fixture', row.recorded_identity.reasoning_effort as 'low');
    const trace = traces()[0]; expect(trace).toBeDefined();
    expect(trace.attempts[0].sent_identity.model).toBe(bodies[0].model);
    expect(trace.attempts[0].sent_identity.reasoning_effort).toBe(bodies[0].reasoning_effort ?? null);
  });

  it('CONTROL: observational sink failure cannot turn success into a retry', async () => {
    telemetry.setTestSink((event) => { if (event === telemetry.TelemetryEvents.LlmCall) throw new Error('offline sink failure'); });
    expect((await openai()).content).toBe('{"ok":true}');
    expect(network).toHaveBeenCalledTimes(1);
  });
});
