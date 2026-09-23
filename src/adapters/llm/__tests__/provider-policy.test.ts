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

import { assertProviderAllowed, runWithProviderPolicy, OPENAI_ONLY, ForbiddenProviderError, currentProviderPolicy } from '../provider-policy.js';

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
});

describe('the Anthropic adapter is refused BEFORE network under an OpenAI-only policy', () => {
  beforeEach(() => {
    networkCalls.length = 0;
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-key-not-used';
  });

  it('RED: chatWithAnthropic under OPENAI_ONLY throws ForbiddenProviderError with ZERO network calls', async () => {
    const { chatWithAnthropic } = await import('../anthropic.js');
    const err = await runWithProviderPolicy(OPENAI_ONLY('agent_v1_turn'), () =>
      chatWithAnthropic({ system: 's', userMessage: 'u', model: 'claude-sonnet-5' } as never).then(() => null, (e: unknown) => e),
    );
    expect(err).toBeInstanceOf(ForbiddenProviderError);
    expect(networkCalls).toEqual([]);
  }, 60_000);

  it('CONTRAST: the same call outside the policy DOES reach the network (so the guard is what stopped it)', async () => {
    const { chatWithAnthropic } = await import('../anthropic.js');
    await chatWithAnthropic({ system: 's', userMessage: 'u', model: 'claude-sonnet-5' } as never).catch(() => undefined);
    expect(networkCalls.length).toBeGreaterThan(0);
  }, 60_000);
});
