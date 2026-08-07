/**
 * OpenAI provider — the request body actually carries what the config declares.
 *
 * ⚠ WHY THIS FILE EXISTS. `ModelConfig.params` is documented as "Arbitrary model
 * params (e.g. temperature)" and the Anthropic provider honours it
 * (`anthropic-provider.ts:40`). The OpenAI provider built its request body from
 * three fields and NEVER read `config.params` or `config.max_tokens` — so a
 * caller pinning `temperature: 0` got a silent no-op, and E1's bake-off could
 * not pin sampling on the OpenAI arm at all (recorded in
 * `experiment-e1-decision-review-models.md` §6.1).
 *
 * A declared capability that never executes is the guarantee-theatre class. The
 * assertions below are on the BODY, not on a live call, because the only honest
 * question is "what bytes did we send".
 *
 * ⚠ WHY IT LIVES UNDER orchestrator-eval AND NOT BESIDE THE PROVIDER.
 * `tools/graph-evaluator/**` has NO CI execution at all: it is excluded from the
 * required gate AND from the advisory Full Test Suite as a package boundary
 * (`vitest.required.config.ts` group 2 / `STANDALONE_TOOL_EXCLUSIONS`, which say
 * so explicitly). A test written beside the provider would never run — a dark
 * test asserting a fix is worse than no test, because it reads as coverage.
 * `pnpm eval:orchestrator:test` IS a required CI step, and this harness is the
 * provider's real caller (`candidate-run.ts` -> `providers/index.js`), so the
 * assertion runs where the dependency actually is.
 */

import { describe, it, expect } from 'vitest';
import { buildResponsesParams } from '../../graph-evaluator/src/providers/openai-provider.js';
import type { ModelConfig } from '../../graph-evaluator/src/providers/types.js';

const base: ModelConfig = { id: 't', provider: 'openai', model: 'gpt-4.1' };

describe('buildResponsesParams', () => {
  it('carries the three identity fields', () => {
    const p = buildResponsesParams('SYS', 'USR', base);
    expect(p).toMatchObject({ model: 'gpt-4.1', instructions: 'SYS', input: 'USR' });
  });

  it('SENDS a declared temperature (the defect: it was dropped)', () => {
    const p = buildResponsesParams('SYS', 'USR', { ...base, params: { temperature: 0 } });
    expect(p.temperature).toBe(0);
  });

  it('sends any other declared param verbatim (params is the escape hatch)', () => {
    const p = buildResponsesParams('SYS', 'USR', { ...base, params: { top_p: 0.9, seed: 42 } });
    expect(p.top_p).toBe(0.9);
    expect(p.seed).toBe(42);
  });

  it('maps max_tokens to the Responses API name', () => {
    const p = buildResponsesParams('SYS', 'USR', { ...base, max_tokens: 6000 });
    expect(p.max_output_tokens).toBe(6000);
  });

  it('an explicit max_output_tokens in params wins over the mapped max_tokens', () => {
    const p = buildResponsesParams('SYS', 'USR', {
      ...base,
      max_tokens: 6000,
      params: { max_output_tokens: 123 },
    });
    expect(p.max_output_tokens).toBe(123);
  });

  it('params can NEVER overwrite model / instructions / input', () => {
    // The escape hatch must not become a way to send a different prompt than
    // the caller passed — that would make every prompt-hash claim unfalsifiable.
    const p = buildResponsesParams('SYS', 'USR', {
      ...base,
      params: { model: 'evil', instructions: 'evil', input: 'evil' },
    });
    expect(p.model).toBe('gpt-4.1');
    expect(p.instructions).toBe('SYS');
    expect(p.input).toBe('USR');
  });

  it('omits temperature entirely when none is declared (the default posture)', () => {
    const p = buildResponsesParams('SYS', 'USR', base);
    expect('temperature' in p).toBe(false);
    expect('max_output_tokens' in p).toBe(false);
    expect('reasoning' in p).toBe(false);
  });

  it('still honours reasoning_effort, and only when set', () => {
    expect(buildResponsesParams('S', 'U', { ...base, reasoning_effort: 'high' }).reasoning).toEqual({
      effort: 'high',
    });
    expect('reasoning' in buildResponsesParams('S', 'U', { ...base, reasoning_effort: null })).toBe(
      false,
    );
  });
});
