/**
 * ⭐ SYS1 (B2, row 3): THE FACTOR REVIEW'S RECEIPT. The agent factor review (`factor-review.ts` → `enrichFactors` →
 * `callLLMForExtraction`) is the one OpenAI call an Agent turn reaches outside `postResponses`. It was counted, but its
 * ledger row carried only site/model/purpose/outcome: served 50530b5f, live run 2026-10-11T222932Z, every Run and every
 * first brief showed `{"site":"extraction.openai",…,"outcome":"allowed"}` with no duration, usage, attempt, prompt
 * identity or turn correlation, so the one call on every Run whose time could not be seen. The row now carries them, on
 * the handle `assertProviderAllowed` already returns: no second wrapper.
 */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ openai: vi.fn() }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create: sdk.openai } }; } }));

import { _resetConfigCache } from '../../src/config/index.js';
import { callLLMForExtraction } from '../../src/adapters/llm/extraction.js';
import { OPENAI_ONLY, recordedProviderCalls, runWithProviderPolicy, type GenerativeCall } from '../../src/adapters/llm/provider-policy.js';

const MODEL = 'gpt-4.1-2025-04-14';
const SYSTEM = 'You review factors. Reply in JSON.';
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const policy = () => ({ ...OPENAI_ONLY('agent_v1_turn'), request_id: 'req-sys1', scenario_id: 'scn-sys1', turn_id: 'turn-sys1' });

/** The one row this call made, found by its site: never "the last row". */
const reviewRow = (rows: readonly GenerativeCall[]): GenerativeCall => {
  const hits = rows.filter((r) => r.site === 'extraction.openai');
  expect(hits).toHaveLength(1);
  return hits[0]!;
};

describe('the factor review call carries a full receipt on its existing ledger row', () => {
  beforeEach(() => {
    vi.stubEnv('LLM_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-not-real');
    _resetConfigCache();
    sdk.openai.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    _resetConfigCache();
  });

  it('a completed call records duration, usage, a success attempt, the prompt sha, its settings and the turn ids', async () => {
    sdk.openai.mockResolvedValueOnce({ choices: [{ message: { content: '{"enrichments":[]}' } }],
      usage: { prompt_tokens: 1234, completion_tokens: 321, total_tokens: 1555 } });
    const rows = await runWithProviderPolicy(policy(), async () => {
      const r = await callLLMForExtraction(SYSTEM, 'user words', { modelOverride: MODEL, maxTokens: 4000, temperature: 0, timeoutMs: 8_000 });
      expect(r.success).toBe(true);
      return recordedProviderCalls();
    });
    const row = reviewRow(rows);
    expect(row).toMatchObject({ provider: 'openai', model: MODEL, purpose: 'extraction', outcome: 'allowed',
      request_id: 'req-sys1', scenario_id: 'scn-sys1', turn_id: 'turn-sys1',
      prompt_sha256: sha(SYSTEM), max_output_tokens: 4000,
      settings: { max_tokens: 4000, temperature: 0, response_format: { type: 'json_object' } },
      usage: { input_tokens: 1234, output_tokens: 321 },
      attempt: { outcome: 'success', retry: false } });
    expect(typeof row.duration_ms).toBe('number');
    expect(row.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('a call stopped at its own cap still records how long it took, as a timeout attempt', async () => {
    vi.useFakeTimers();
    sdk.openai.mockImplementationOnce(() => new Promise(() => {}));
    const pending = runWithProviderPolicy(policy(), async () => {
      const r = await callLLMForExtraction(SYSTEM, 'user words', { modelOverride: MODEL, timeoutMs: 8_000, signal: new AbortController().signal });
      expect(r.success).toBe(false);
      return recordedProviderCalls();
    });
    await vi.advanceTimersByTimeAsync(8_000);
    const row = reviewRow(await pending);
    expect(row.attempt).toMatchObject({ outcome: 'timeout', transport_status: null, retry: false });
    expect(typeof row.duration_ms).toBe('number');
    expect(row.usage).toBeUndefined();
  });

  it('a provider failure records an error attempt with its duration, never a success', async () => {
    sdk.openai.mockRejectedValueOnce(Object.assign(new Error('429 rate limit'), { status: 429 }));
    const rows = await runWithProviderPolicy(policy(), async () => {
      expect((await callLLMForExtraction(SYSTEM, 'u', { modelOverride: MODEL, timeoutMs: 8_000 })).success).toBe(false);
      return recordedProviderCalls();
    });
    const row = reviewRow(rows);
    expect(row.attempt).toMatchObject({ outcome: 'rate_limited', transport_status: 429, retry: false });
    expect(typeof row.duration_ms).toBe('number');
  });

  it('CONTROL: outside a provider policy nothing is recorded and the call still succeeds', async () => {
    sdk.openai.mockResolvedValueOnce({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const r = await callLLMForExtraction(SYSTEM, 'u', { modelOverride: MODEL, timeoutMs: 8_000 });
    expect(r.success).toBe(true);
    expect(recordedProviderCalls()).toEqual([]);
  });
});
