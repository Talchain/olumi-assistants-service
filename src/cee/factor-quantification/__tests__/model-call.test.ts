import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatArgs, CallOpts } from '../../../adapters/llm/types.js';

const h = vi.hoisted(() => ({ chat: vi.fn(), resolve: vi.fn(), structured: true }));
vi.mock('../../../adapters/llm/router.js', () => ({ getAdapterWithResolution: h.resolve }));
vi.mock('../../../config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/index.js')>();
  return { ...actual, config: { ...actual.config, cee: { ...actual.config.cee, get anthropicStructuredOutputs() { return h.structured; } } } };
});

import { callFactorQuantification, type FactorQuantificationCallInput } from '../model-call.js';
import { FACTOR_ESTIMATES_JSON_SCHEMA } from '../estimate-response.js';
import { FACTOR_QUANTIFICATION_SYSTEM_PROMPT } from '../prompt.js';
import { UpstreamTimeoutError } from '../../../adapters/llm/errors.js';

const estimate = { factor_id: 'duration', estimate_type: 'estimated', distribution: 'uniform', range_min: 4, range_max: 8, reasoning: 'The contract allocates production slots uniformly from month four to month eight, supporting equal density across those bounds.', basis: ['delivery_bound'] };
const abstention = { factor_id: 'duration', estimate_type: 'unknown', reasoning: 'No defensible delivery bound or reference class is provided.', basis: [] };
const input = (): FactorQuantificationCallInput => ({ requestId: 'quantify-test', deadlineMs: Date.now() + 5_000, brief: 'The contract allocates production slots uniformly from month four to month eight.', gaps: [{ factor_id: 'duration', label: 'Delivery', reason: 'Required', unit: 'months' }], context: { facts: [{ id: 'delivery_bound', text: 'production slots allocated uniformly from month four to month eight' }] } });
function response(item: unknown = estimate, model = 'claude-sonnet-5') {
  return { content: JSON.stringify({ estimates: [item] }), model, latencyMs: 17, usage: { input_tokens: 120, output_tokens: 80 } };
}
function wire(model = 'claude-sonnet-5', provider = 'anthropic') {
  h.resolve.mockReturnValue({ adapter: { chat: h.chat }, resolution: { provider, resolved_model: model, resolution_source: 'task_default' } });
}

beforeEach(() => { vi.useRealTimers(); h.chat.mockReset(); h.resolve.mockReset(); h.structured = true; wire(); h.chat.mockResolvedValue(response()); });
afterEach(() => { vi.useRealTimers(); });

describe('one quantification adapter invocation and exact contract', () => {
  it('routes the owned task, supplies schema, parses the output and reports measured identity/usage', async () => {
    const result = await callFactorQuantification(input());
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('Expected an estimate');
    expect(result.estimates).toEqual([estimate]);
    expect(h.resolve).toHaveBeenCalledExactlyOnceWith('factor_quantification');
    expect(h.chat).toHaveBeenCalledTimes(1);
    const [args, opts] = h.chat.mock.calls[0] as [ChatArgs, CallOpts];
    expect(args.system).toBe(FACTOR_QUANTIFICATION_SYSTEM_PROMPT);
    expect(args.outputSchema).toBe(FACTOR_ESTIMATES_JSON_SCHEMA);
    expect(args.thinking).toEqual({ type: 'disabled' });
    expect(args.userMessage).toContain('"factor_id":"duration"');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(opts.timeoutMs).toBeGreaterThan(0);
    expect(opts.timeoutMs).toBeLessThanOrEqual(5_000);
    expect(result.metadata).toMatchObject({ call_made: true, provider: 'anthropic', resolved_model: 'claude-sonnet-5', model: 'claude-sonnet-5', input_tokens: 120, output_tokens: 80, provider_latency_ms: 17, structured_output_requested: true, structured_output_enforced: null, cost_usd: null });
    expect(result.metadata.prompt_hash).toBe(createHash('sha256').update(args.system).digest('hex'));
    expect(result.metadata.request_hash).toBe(createHash('sha256').update(`${args.system}\n${args.userMessage}`).digest('hex'));
  });

  it('keeps model abstention successful and different from provider or parser failure', async () => {
    h.chat.mockResolvedValue(response(abstention));
    const result = await callFactorQuantification(input());
    expect(result).toMatchObject({ kind: 'ok', estimates: [abstention], metadata: { call_made: true } });
  });

  it.each(['missing', 'unrequested', 'numeric_unknown', 'non_json'])('broken estimator output (%s) never becomes accepted knowledge', async (fault) => {
    const bad = fault === 'missing' ? { estimates: [{ factor_id: 'duration', value: 6 }] }
      : fault === 'unrequested' ? { estimates: [{ ...estimate, factor_id: 'stated_cost' }] }
      : { estimates: [{ ...abstention, value: 0.5 }] };
    h.chat.mockResolvedValue({ ...response(), content: fault === 'non_json' ? 'not JSON' : JSON.stringify(bad) });
    const result = await callFactorQuantification(input());
    expect(result.kind).toBe('parse_failed');
    expect(result).not.toHaveProperty('estimates');
    expect(result.metadata.call_made).toBe(true);
    expect(h.chat).toHaveBeenCalledTimes(1);
  });

  it('changing an unrelated context label does not invalidate a legitimate estimate', async () => {
    const first = await callFactorQuantification(input());
    const second = await callFactorQuantification({ ...input(), context: { facts: [{ id: 'delivery_bound', text: 'four to eight months' }], unrelatedLabel: 'renamed note' } });
    expect(first.kind).toBe('ok');
    expect(second.kind).toBe('ok');
    expect(first.metadata.prompt_hash).toBe(second.metadata.prompt_hash);
    expect(first.metadata.request_hash).not.toBe(second.metadata.request_hash);
  });

  it('refuses a returned model identity that differs from the task resolution', async () => {
    h.chat.mockResolvedValue(response(estimate, 'another-model'));
    expect(await callFactorQuantification(input())).toMatchObject({ kind: 'llm_error', reason: 'model_mismatch', metadata: { model: 'another-model' } });
  });

  it('skips without a call for no gaps, spent budget or pre-aborted caller', async () => {
    const controller = new AbortController(); controller.abort();
    expect(await callFactorQuantification({ ...input(), gaps: [] })).toMatchObject({ kind: 'skipped', reason: 'no_gaps' });
    expect(await callFactorQuantification({ ...input(), deadlineMs: Date.now() - 1 })).toMatchObject({ kind: 'skipped', reason: 'deadline_expired' });
    expect(await callFactorQuantification({ ...input(), signal: controller.signal })).toMatchObject({ kind: 'skipped', reason: 'aborted' });
    expect(h.resolve).not.toHaveBeenCalled();
    expect(h.chat).not.toHaveBeenCalled();
  });

  it('refuses silent prompt-only operation before spending a call', async () => {
    h.structured = false;
    expect(await callFactorQuantification(input())).toMatchObject({ kind: 'skipped', reason: 'structured_outputs_disabled' });
    h.structured = true; wire('gpt-4.1', 'openai');
    expect(await callFactorQuantification(input())).toMatchObject({ kind: 'skipped', reason: 'unsupported_model_or_provider' });
    expect(h.chat).not.toHaveBeenCalled();
  });

  it('separates provider failures from adapter timeouts without retrying', async () => {
    h.chat.mockRejectedValueOnce(new Error('provider unavailable'));
    expect(await callFactorQuantification(input())).toMatchObject({ kind: 'llm_error', reason: 'provider_error' });
    h.chat.mockRejectedValueOnce(new UpstreamTimeoutError('timeout', 'anthropic', 'chat', 'body', 100));
    expect(await callFactorQuantification(input())).toMatchObject({ kind: 'timeout', reason: 'adapter_timeout' });
    expect(h.chat).toHaveBeenCalledTimes(2);
  });

  it('enforces the absolute deadline even if the adapter ignores its abort signal', async () => {
    vi.useFakeTimers();
    h.chat.mockImplementation(() => new Promise(() => undefined));
    const pending = callFactorQuantification({ ...input(), deadlineMs: Date.now() + 25 });
    await vi.advanceTimersByTimeAsync(25);
    expect(await pending).toMatchObject({ kind: 'timeout', reason: 'deadline', metadata: { call_made: true, latency_ms: 25 } });
    expect((h.chat.mock.calls[0] as [ChatArgs, CallOpts])[1].signal!.aborted).toBe(true);
  });

  it('caller cancellation cannot adopt a late successful provider response', async () => {
    const controller = new AbortController();
    let resolveCall!: (value: ReturnType<typeof response>) => void;
    h.chat.mockImplementation(() => new Promise((resolve) => { resolveCall = resolve; }));
    const pending = callFactorQuantification({ ...input(), signal: controller.signal });
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({ kind: 'llm_error', reason: 'aborted', metadata: { call_made: true } });
    resolveCall(response());
    await Promise.resolve();
    expect(result).not.toHaveProperty('estimates');
    expect(h.chat).toHaveBeenCalledTimes(1);
  });
});
