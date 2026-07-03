/**
 * checkModelResolution parity tests — table mirrors the m2-review gate cases
 * (m2-review.test.ts model-resolution describe) so a future extraction of the
 * inline gate onto this helper is a provable no-op. Parity is asserted
 * against the DOCUMENTED m2 semantics, not by importing m2-review.
 */
import { describe, it, expect } from 'vitest';
import {
  checkModelResolution,
  STRUCTURED_OUTPUT_PROVIDERS,
  type ModelGateResult,
} from '../model-resolution.js';

function resolution(provider: string, resolved_model: string, resolution_source = 'env_var') {
  return { provider, resolved_model, resolution_source };
}

describe('checkModelResolution — m2 gate parity table', () => {
  const CASES: Array<[string, Parameters<typeof checkModelResolution>, Partial<ModelGateResult>]> = [
    [
      'unset configured model → model_unset (checked before resolution is even read)',
      [undefined, resolution('anthropic', 'claude-opus-4-8')],
      { ok: false, cause: 'model_unset' },
    ],
    [
      'empty-string configured model → model_unset',
      ['', resolution('anthropic', 'claude-opus-4-8')],
      { ok: false, cause: 'model_unset' },
    ],
    [
      'non-structured-outputs provider → provider_unsupported',
      ['gpt-5.2', resolution('openai', 'gpt-5.2')],
      { ok: false, cause: 'provider_unsupported' },
    ],
    [
      'resolved model differs from configured (blocked/failover/override) → model_mismatch',
      ['claude-opus-4-8', resolution('anthropic', 'claude-sonnet-5', 'llm_model_fallback')],
      { ok: false, cause: 'model_mismatch' },
    ],
    [
      'exact match on anthropic → ok',
      ['claude-opus-4-8', resolution('anthropic', 'claude-opus-4-8')],
      { ok: true, model: 'claude-opus-4-8' },
    ],
    [
      'fixtures provider is structured-outputs-capable → ok',
      ['fixture-model', resolution('fixtures', 'fixture-model')],
      { ok: true, model: 'fixture-model' },
    ],
  ];

  for (const [label, args, expected] of CASES) {
    it(label, () => {
      expect(checkModelResolution(...args)).toMatchObject(expected);
    });
  }

  it('null resolution with a configured model → model_mismatch (no resolution available)', () => {
    const res = checkModelResolution('claude-opus-4-8', null);
    expect(res).toMatchObject({ ok: false, cause: 'model_mismatch' });
  });

  it('model_mismatch detail carries the resolution source for operator triage', () => {
    const res = checkModelResolution(
      'claude-opus-4-8',
      resolution('anthropic', 'claude-sonnet-5', 'llm_model_fallback'),
    );
    expect(res.ok).toBe(false);
    expect((res as { detail: string }).detail).toContain('llm_model_fallback');
    expect((res as { detail: string }).detail).toContain('claude-sonnet-5');
  });
});

describe('checkModelResolution — provider allowlist override', () => {
  it('a custom allowlist replaces the structured-outputs default', () => {
    const res = checkModelResolution('gpt-5.2', resolution('openai', 'gpt-5.2'), {
      allowedProviders: ['openai'],
    });
    expect(res).toMatchObject({ ok: true, model: 'gpt-5.2' });
  });

  it('the default allowlist is exactly anthropic + fixtures (D2 ruling pin)', () => {
    expect([...STRUCTURED_OUTPUT_PROVIDERS].sort()).toEqual(['anthropic', 'fixtures']);
  });
});
