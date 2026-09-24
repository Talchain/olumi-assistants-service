/**
 * ⛔ Zero Anthropic calls on the OpenAI journey (provider-policy.ts).
 *
 * Release Control's acceptance asks for "a test-double negative control showing
 * Anthropic would be refused before network". This drives the REAL Anthropic chat
 * boundary (`chatWithAnthropic`) with the network mocked: under an OpenAI-only policy
 * it must throw ForbiddenProviderError with ZERO network calls; outside the policy the
 * same call reaches the (mocked) network — the contrast that proves the guard, not a
 * broken fixture, is what stopped it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const networkCalls: string[] = [];
vi.mock('undici', async (orig) => {
  const actual = await orig<typeof import('undici')>();
  return {
    ...actual,
    fetch: vi.fn(async (input: unknown) => {
      networkCalls.push(String(input));
      return new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'mocked' } }), { status: 500, headers: { 'content-type': 'application/json' } });
    }),
  };
});

import { assertProviderAllowed, runWithProviderPolicy, OPENAI_ONLY, ForbiddenProviderError, currentProviderPolicy, recordedProviderCalls, providerLedgerTruncated, MAX_RECORDED_CALLS } from '../provider-policy.js';

describe('the request-scoped provider policy', () => {
  it('outside any policy every provider is allowed (Conventional is unchanged)', () => {
    expect(() => assertProviderAllowed('anthropic')).not.toThrow();
    expect(currentProviderPolicy()).toBeUndefined();
  });

  it('under OPENAI_ONLY, Anthropic is refused and OpenAI is allowed — and the policy survives await', async () => {
    await runWithProviderPolicy(OPENAI_ONLY('test'), async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(() => assertProviderAllowed('openai')).not.toThrow();
      expect(() => assertProviderAllowed('anthropic', 'chat')).toThrow(ForbiddenProviderError);
    });
  });

  it('records every guarded attempt, allowed or refused, and nothing outside a policy', () => {
    assertProviderAllowed('anthropic', 'outside');
    expect(recordedProviderCalls()).toEqual([]);
    const calls = runWithProviderPolicy(OPENAI_ONLY('test'), () => {
      assertProviderAllowed('openai', 'agent-v1-turn.callModel', { model: 'gpt-5.6-terra', purpose: 'conversation' });
      try { assertProviderAllowed('anthropic', 'anthropic.client'); } catch { /* refused */ }
      return recordedProviderCalls();
    });
    expect(calls).toEqual([
      { site: 'agent-v1-turn.callModel', provider: 'openai', model: 'gpt-5.6-terra', purpose: 'conversation', outcome: 'allowed' },
      { site: 'anthropic.client', provider: 'anthropic', model: 'unknown', purpose: 'anthropic.client', outcome: 'refused_before_network' },
    ]);
  });
});

describe('the Anthropic adapter is refused BEFORE network under an OpenAI-only policy', () => {
  beforeEach(() => {
    networkCalls.length = 0;
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-key-not-used';
  });

  it('RED: chatWithAnthropic under OPENAI_ONLY throws ForbiddenProviderError with ZERO network calls', async () => {
    const { chatWithAnthropic } = await import('../anthropic.js');
    const policy = OPENAI_ONLY('agent_v1_turn');
    const err = await runWithProviderPolicy(policy, () =>
      chatWithAnthropic({ system: 's', userMessage: 'u', model: 'claude-sonnet-5' } as never).then(() => null, (e: unknown) => e),
    );
    expect(err).toBeInstanceOf(ForbiddenProviderError);
    expect(networkCalls).toEqual([]);
    // …and the refusal is itself the measurement.
    expect(policy.calls.map((c) => [c.provider, c.outcome])).toEqual([['anthropic', 'refused_before_network']]);
  }, 60_000);

  it('CONTRAST: the same call outside the policy DOES reach the network (so the guard is what stopped it)', async () => {
    const { chatWithAnthropic } = await import('../anthropic.js');
    await chatWithAnthropic({ system: 's', userMessage: 'u', model: 'claude-sonnet-5' } as never).catch(() => undefined);
    expect(networkCalls.length).toBeGreaterThan(0);
  }, 60_000);
});

/**
 * Independent review of #1749 (5796174445): (1) the TRANSPORT guard was unpinned —
 * deleting it left every test green, because every path today reaches it through the
 * guarded client; (2) a ledger past its cap dropped refusals WITHOUT SAYING SO, so "no
 * anthropic row" did not prove "no anthropic attempt".
 */
describe('the backstops the review found unpinned', () => {
  beforeEach(() => { networkCalls.length = 0; });

  it('RED: the Anthropic TRANSPORT itself refuses under the policy, with zero network calls', async () => {
    const { anthropicFetchForTests } = await import('../anthropic.js');
    const err = await runWithProviderPolicy(OPENAI_ONLY('agent_v1_turn'), async () => {
      try { await anthropicFetchForTests('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}' }); return null; }
      catch (e) { return e; }
    });
    expect(err).toBeInstanceOf(ForbiddenProviderError);
    expect(networkCalls).toEqual([]);
  }, 60_000);

  it('CONTRAST: the same transport outside a policy reaches the (mocked) network', async () => {
    const { anthropicFetchForTests } = await import('../anthropic.js');
    await anthropicFetchForTests('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}' }).catch(() => undefined);
    expect(networkCalls.length).toBe(1);
  }, 60_000);

  it('RED: a ledger that reached its cap SAYS it was truncated — and a refusal past the cap still throws', () => {
    const out = runWithProviderPolicy(OPENAI_ONLY('test'), () => {
      for (let i = 0; i < MAX_RECORDED_CALLS; i += 1) assertProviderAllowed('openai', 'agent-v1-turn.callModel', { model: 'gpt-5.6-terra', purpose: 'conversation' });
      let threw = false;
      try { assertProviderAllowed('anthropic', 'anthropic.client'); } catch { threw = true; }
      return { threw, calls: recordedProviderCalls(), truncated: providerLedgerTruncated() };
    });
    expect(out.threw).toBe(true);
    expect(out.calls).toHaveLength(MAX_RECORDED_CALLS);
    expect(out.calls.some((c) => c.provider === 'anthropic')).toBe(false);
    expect(out.truncated).toBe(true);
  });

  it('CONTRAST: a ledger within its cap is not truncated; outside a policy nothing is', () => {
    expect(providerLedgerTruncated()).toBe(false);
    const t = runWithProviderPolicy(OPENAI_ONLY('test'), () => { assertProviderAllowed('openai', 'x'); return providerLedgerTruncated(); });
    expect(t).toBe(false);
  });
});

