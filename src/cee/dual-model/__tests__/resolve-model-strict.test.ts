/**
 * resolveModelStrict tests — injected fake resolvers only. A real
 * getAdapterWithResolution call constructs provider adapters, whose success
 * depends on ambient env (API keys, LLM_PROVIDER) — deliberately NOT
 * exercised here to keep the suite deterministic; the pure decision logic it
 * delegates to is parity-tested in model-resolution.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import type { AdapterWithResolution, ResolutionSource } from '../../../adapters/llm/router.js';
import { resolveModelStrict } from '../resolve-model-strict.js';

const FAKE_ADAPTER = { chat: vi.fn(), model: 'fake' } as unknown as AdapterWithResolution['adapter'];

function fakeResolver(
  resolved_model: string,
  provider: 'anthropic' | 'openai' | 'fixtures' | undefined,
  resolution_source: ResolutionSource = 'env_var',
) {
  return (task: string): AdapterWithResolution =>
    ({
      adapter: FAKE_ADAPTER,
      resolution: { task, resolved_model, resolution_source, provider },
    }) as AdapterWithResolution;
}

describe('resolveModelStrict — coded outcomes (m2 gate parity)', () => {
  it('unset expected model → model_unset; the resolver is never invoked', () => {
    const resolver = vi.fn(fakeResolver('claude-opus-4-8', 'anthropic'));
    const res = resolveModelStrict('m2_graph_review', undefined, { resolver });
    expect(res.kind).toBe('model_unset');
    expect(resolver).not.toHaveBeenCalled();
  });

  it('empty-string expected model → model_unset', () => {
    expect(resolveModelStrict('m2_graph_review', '', { resolver: fakeResolver('x', 'anthropic') }).kind).toBe(
      'model_unset',
    );
  });

  it('openai provider → provider_unsupported (structured-outputs default allowlist)', () => {
    const res = resolveModelStrict('m2_graph_review', 'gpt-5.2', {
      resolver: fakeResolver('gpt-5.2', 'openai'),
    });
    expect(res).toMatchObject({ kind: 'provider_unsupported', provider: 'openai' });
  });

  it('undefined provider → provider_unsupported with "unknown"', () => {
    const res = resolveModelStrict('m2_graph_review', 'claude-opus-4-8', {
      resolver: fakeResolver('claude-opus-4-8', undefined),
    });
    expect(res).toMatchObject({ kind: 'provider_unsupported', provider: 'unknown' });
  });

  it('failover interception (resolved ≠ expected) → model_mismatch carrying resolved + source', () => {
    const res = resolveModelStrict('m2_graph_review', 'claude-opus-4-8', {
      resolver: fakeResolver('failover-model', 'anthropic', 'llm_model_fallback'),
    });
    expect(res).toMatchObject({
      kind: 'model_mismatch',
      resolved: 'failover-model',
      source: 'llm_model_fallback',
    });
    expect((res as { detail: string }).detail).toContain('llm_model_fallback');
  });

  it('exact match on anthropic → ok with the adapter attached (constructed, never called)', () => {
    const res = resolveModelStrict('m2_graph_review', 'claude-opus-4-8', {
      resolver: fakeResolver('claude-opus-4-8', 'anthropic', 'env_var'),
    });
    expect(res).toMatchObject({
      kind: 'ok',
      model: 'claude-opus-4-8',
      provider: 'anthropic',
      source: 'env_var',
    });
    expect((res as { adapter: unknown }).adapter).toBe(FAKE_ADAPTER);
    expect((FAKE_ADAPTER as unknown as { chat: ReturnType<typeof vi.fn> }).chat).not.toHaveBeenCalled();
  });

  it('fixtures provider passes the default allowlist → ok', () => {
    const res = resolveModelStrict('m2_graph_review', 'fixture-model', {
      resolver: fakeResolver('fixture-model', 'fixtures'),
    });
    expect(res.kind).toBe('ok');
  });

  it('custom allowlist admits openai when a future slot opts in', () => {
    const res = resolveModelStrict('some_future_slot', 'gpt-5.2', {
      resolver: fakeResolver('gpt-5.2', 'openai'),
      allowedProviders: ['openai'],
    });
    expect(res.kind).toBe('ok');
  });

  it('resolver exceptions propagate (parity: m2-review lets them reach the internal_error backstop)', () => {
    expect(() =>
      resolveModelStrict('m2_graph_review', 'claude-opus-4-8', {
        resolver: () => {
          throw new Error('adapter construction failed');
        },
      }),
    ).toThrow('adapter construction failed');
  });
});
