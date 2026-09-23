/**
 * PASS 2 MUST ASK FOR LOW REASONING EFFORT, AND THE KNOB MUST REACH THE ADAPTER.
 *
 * ⛔ THE DEFECT THIS PINS IS A DEAD PARAMETER, NOT A WRONG VALUE.
 * `buildModelParams` has accepted `reasoningEffort` since it was written,
 * defaults it to `"medium"` (`openai.ts:181`) and applies it to the request at
 * `openai.ts:196` inside the `isReasoningModel` branch. But NONE of its six call
 * sites ever passed one — `:492, :957, :1083, :1329, :1469`. So the knob was
 * fully built and unreachable: every reasoning-model call in production shipped
 * the `??` fallback, and no caller could say otherwise. There was no flag to
 * flip and no config to set.
 *
 * ⚠ SO `"medium"` IS NOT A MEASURED BASELINE. It is the fallback. That matters
 * for how this change should be judged: it is not overriding a tuned value.
 *
 * WHY PASS 2 SPECIFICALLY. Measured on 795 joined
 * pass2_call_start/pass2_call_complete pairs, 19–23 Sep, o4-mini 800/800:
 * output_tokens p50 4,241 at p50 153.5 tok/s = 27.6s, against a measured p50
 * latency of 28.0s. The call is entirely OUTPUT-bound — network, the
 * 2,609-token prefill and any prompt cache together are under 2% — so input-side
 * work cannot move it and effort is the only knob that can. Reasoning is ≥90% of
 * those output tokens by `validate-graph.ts`'s own banked measurement (:36-95):
 * at a 4,096 cap the same call "returned empty content in 30,092 ms with the
 * request otherwise successful" — the cap was exhausted during reasoning before
 * any content was emitted.
 *
 * ⭐ AND IT COSTS CAPABILITY, NOT ONLY TIME: 24 of 800 turns (3.0%) carry
 * `validation_pipeline_abandoned_after_ms` and shipped with NO contested-edge
 * metadata at all, because the 25s attach deadline expired first.
 *
 * WHAT THESE TESTS BIND, and deliberately not more: that the CALL SITE asks for
 * 'low' and that the ADAPTER CONTRACT carries it. They do not assert a latency
 * number — that is measured from `pass2_call_complete`, which already logs
 * `latency_ms` and the token counts, against the n=795 baseline above.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CallOpts, ChatArgs } from '../../../src/adapters/llm/types.js';

vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('You are a validation assistant.'),
  getSystemPromptSnapshot: vi.fn().mockResolvedValue({
    content: 'You are a validation assistant.',
    meta: {
      taskId: 'validate_graph',
      source: 'default',
      prompt_version: 'validate_graph_default@v4',
      prompt_hash: 'validatehash02',
    },
  }),
}));

// ⚠ HOISTED SPY, referenced inside the factory — the shape the sibling
// `pass2-budget.test.ts` already uses and CI already typechecks. The previous
// version of this file reached the adapter by casting `getAdapter` to
// `ReturnType<typeof vi.fn>`, which is a TS2352: a real function type and
// vitest's `Mock` do not sufficiently overlap. That single cast was the +1 in
// `Typecheck Drift (ratchet)` — current 292 vs baseline 291.
const chatSpy = vi.hoisted(() => vi.fn());

vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({ name: 'openai', model: 'o4-mini', chat: chatSpy }),
  getMaxTokensFromConfig: vi.fn().mockReturnValue(4096),
}));

vi.mock('../../../src/utils/json-extractor.js', () => ({
  extractJsonFromResponse: vi.fn((content: string) => ({
    json: JSON.parse(content),
    wasExtracted: false,
  })),
}));

vi.mock('../../../src/utils/telemetry.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  emit: vi.fn(),
}));

// ⚠ importOriginal SPREAD, not a hand-listed factory — a factory REPLACES the
// module, and validate-graph.ts reads several constants from timeouts.js at
// load, so a two-key mock dies at COLLECTION the moment it reaches for another.
vi.mock('../../../src/config/timeouts.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/config/timeouts.js')>()),
  VALIDATION_PIPELINE_TIMEOUT_MS: 30_000,
}));

const { callValidateGraph } = await import(
  '../../../src/cee/validation-pipeline/validate-graph.js'
);
const { buildModelParams } = await import('../../../src/adapters/llm/openai.js');

const CALL_OPTS: CallOpts = { requestId: 'effort-req-1', timeoutMs: 30_000 };

const validPass2 = () => ({
  edges: [{
    from: 'fac_x', to: 'out_y',
    strength: { mean: 0.4, std: 0.1 },
    exists_probability: 0.8,
    reasoning: 'Direct causal link in the brief',
    basis: 'brief_explicit',
    needs_user_input: false,
  }],
  model_notes: [],
});

const chatResult = (parsed: unknown) => ({
  content: JSON.stringify(parsed),
  latencyMs: 200,
  model: 'o4-mini',
  stopReason: 'stop',
  usage: { input_tokens: 100, output_tokens: 200 },
});

/** Runs a real Pass-2 call and returns the args the adapter was handed. */
async function captureChatArgs(): Promise<ChatArgs> {
  chatSpy.mockReset();
  chatSpy.mockResolvedValue(chatResult(validPass2()));
  await callValidateGraph(
    'Should we migrate the checkout service off the monolith?',
    [{ id: 'fac_x', kind: 'factor', label: 'X' }],
    [{ from: 'fac_x', to: 'out_y' }],
    CALL_OPTS,
  );
  // non-vacuity: a zero-call run would satisfy every assertion below vacuously
  expect(chatSpy).toHaveBeenCalledTimes(1);
  return chatSpy.mock.calls[0][0] as ChatArgs;
}

describe('Pass 2 asks the adapter for LOW reasoning effort', () => {
  it('⛔ the call site passes reasoningEffort: low', async () => {
    const args = await captureChatArgs();
    expect(args.reasoningEffort).toBe('low');
  });

  it('does not disturb the other Pass-2 chat arguments', async () => {
    // Binds by identity, so a change that swapped effort for something else
    // cannot pass. `responseFormat` is what makes the JSON contract work.
    const args = await captureChatArgs();
    expect(args.responseFormat).toBe('json_object');
    expect(typeof args.system).toBe('string');
    expect(args.system.length).toBeGreaterThan(0);
    expect(typeof args.maxTokens).toBe('number');
  });
});

describe('the adapter contract actually carries the effort through', () => {
  // No `as Record<string, unknown>` cast: buildModelParams already RETURNS a
  // typed object carrying `reasoning_effort?`, so the cast was both redundant
  // and a second conversion the ratchet could charge for.
  it('⛔ buildModelParams emits the requested effort for a reasoning model', () => {
    const p = buildModelParams('o4-mini', 0, { maxTokens: 4096, reasoningEffort: 'low' });
    expect(p.reasoning_effort).toBe('low');
  });

  it('CONTRAST CONTROL — omitting it still yields the pre-existing default', () => {
    // Proves this change is additive: every caller that says nothing is
    // byte-identical to before, which is why no existing suite had to move.
    const p = buildModelParams('o4-mini', 0, { maxTokens: 4096 });
    expect(p.reasoning_effort).toBe('medium');
  });

  it('CONTRAST CONTROL — a NON-reasoning model gets no effort at all', () => {
    // The `isReasoningModel` branch is what makes this safe to thread from a
    // shared `chat()`: a gpt-4o call must not acquire a reasoning parameter.
    const p = buildModelParams('gpt-4o', 0, { maxTokens: 4096, reasoningEffort: 'low' });
    expect('reasoning_effort' in p).toBe(false);
  });
});
