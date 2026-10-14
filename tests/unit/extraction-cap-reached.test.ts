/**
 * 8 Oct classification (Render 11:00–13:12Z): every "LLM extraction aborted" error was the agent factor review's
 * OWN 5 s cap (5,003–5,033 ms; completed reviews 2.1–4.6 s). A call stopped at its own cap is an expected budget
 * outcome: info `cee.extraction.cap_reached`, never `cee.extraction.openai_error`. A caller abort or a provider
 * failure stays an error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ openai: vi.fn() }));
vi.mock('openai', () => ({ default: class { chat = { completions: { create: sdk.openai } }; } }));

import { _resetConfigCache } from '../../src/config/index.js';
import { callLLMForExtraction, EXTRACTION_CAP_REACHED } from '../../src/adapters/llm/extraction.js';
import { OPENAI_ONLY, runWithProviderPolicy } from '../../src/adapters/llm/provider-policy.js';
import { log } from '../../src/utils/telemetry.js';
import { AGENT_FACTOR_REVIEW_TIMEOUT_MS } from '../../src/orchestrator-v5/agent-lane/factor-review.js';

const MODEL = 'gpt-4.1-2025-04-14';
const events = (spy: { mock: { calls: unknown[][] } }): (string | undefined)[] =>
  spy.mock.calls.map((c: unknown[]) => (c[0] as { event?: string } | undefined)?.event);

describe('extraction cap reached is info, not a provider error', () => {
  let info: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.stubEnv('LLM_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-not-real');
    _resetConfigCache();
    sdk.openai.mockReset();
    info = vi.spyOn(log, 'info');
    error = vi.spyOn(log, 'error');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    _resetConfigCache();
  });

  const call = (signal: AbortSignal, timeoutMs: number) => runWithProviderPolicy(OPENAI_ONLY('agent_v1_turn'),
    () => callLLMForExtraction('system', 'user', { modelOverride: MODEL, signal, timeoutMs }));

  it('a hung call stops at its own cap and logs cap_reached at info, with no openai_error', async () => {
    vi.useFakeTimers();
    sdk.openai.mockImplementationOnce(() => new Promise(() => {}));
    let settled = false;
    const pending = call(new AbortController().signal, 8_000).then((r) => { settled = true; return r; });
    await vi.advanceTimersByTimeAsync(7_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.success).toBe(false);
    const sdkSignal = sdk.openai.mock.calls[0]![1]?.signal as AbortSignal;
    expect(sdkSignal.reason).toBe(EXTRACTION_CAP_REACHED);
    expect(events(info)).toContain('cee.extraction.cap_reached');
    expect(events(error)).not.toContain('cee.extraction.openai_error');
  });

  it('CONTROL: a caller abort (not the cap) stays an error', async () => {
    sdk.openai.mockImplementationOnce(() => new Promise(() => {}));
    const outer = new AbortController();
    const pending = call(outer.signal, 8_000);
    outer.abort('client_gone');
    expect((await pending).success).toBe(false);
    expect(events(error)).toContain('cee.extraction.openai_error');
    expect(events(info)).not.toContain('cee.extraction.cap_reached');
  });

  it('CONTROL: a provider failure stays an error', async () => {
    sdk.openai.mockRejectedValueOnce(new Error('429 rate limit'));
    expect((await call(new AbortController().signal, 8_000)).success).toBe(false);
    expect(events(error)).toContain('cee.extraction.openai_error');
    expect(events(info)).not.toContain('cee.extraction.cap_reached');
  });

  it('the agent factor review cap is 8 s (5 s dropped 27% of reviews, 8 Oct)', () => {
    expect(AGENT_FACTOR_REVIEW_TIMEOUT_MS).toBe(8_000);
  });
});
