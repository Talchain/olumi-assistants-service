/**
 * ⛔ THE ASSERTION THIS PR CANNOT MERGE WITHOUT.
 *
 * `buildModelParams` has accepted a `reasoningEffort` option since it was
 * written and defaults it to `"medium"`. MEASURED on `origin/staging`: all five
 * call sites passed `{ maxTokens }` and nothing else, against a contrast
 * control of `maxTokens` threaded five times — so the knob was
 * reachable-by-signature and unreachable-in-fact, and `"medium"` was never a
 * tuned value, only the `??` fallback.
 *
 * ⚠ MY FIRST ATTEMPT AT THIS FILE WAS VACUOUS AND A MUTANT CAUGHT IT. It called
 * `buildModelParams` directly, which ALREADY honoured the option on staging —
 * so it passed with the threading removed (132/132 under the mutant) and proved
 * nothing about this change. The change is the THREADING at the chat site, so
 * the assertion has to be made at the WIRE: what did the SDK actually receive.
 *
 * ⚠ What is deliberately NOT here: the companion change asking Pass 2 for
 * `'low'`. That is a behaviour change to Conventional's validation pipeline and
 * is held on its own PR with its own test. This file asserts only that a caller
 * CAN choose, that omitting the choice is byte-identical to today, and that the
 * challenger's choice survives to the request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createSpy = vi.hoisted(() => vi.fn());

vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: createSpy } };
  }
  return { default: MockOpenAI };
});

/** Minimal well-formed critique payload — `issues` must be an array or the adapter fails closed. */
const CRITIQUE_JSON = JSON.stringify({
  issues: [{ level: 'OBSERVATION', note: 'The goal has no stated threshold.' }],
  suggested_fixes: [],
  overall_quality: 'acceptable',
});

function ok(content: string) {
  return {
    choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  };
}

/** The body the SDK was called with, for the most recent call. */
function sentBody(): Record<string, unknown> {
  expect(createSpy, 'the SDK must have been called at all').toHaveBeenCalled();
  return createSpy.mock.calls.at(-1)![0] as Record<string, unknown>;
}

const REASONING_MODEL = 'o4-mini';
const originalEnv = { ...process.env };

describe('a caller can choose the reasoning effort, and it reaches the request', () => {
  beforeEach(() => {
    process.env = { ...originalEnv, OPENAI_API_KEY: 'sk-test-openai' };
    createSpy.mockReset();
    createSpy.mockResolvedValue(ok('{"ok":true}'));
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('⛔ an explicit high REACHES THE WIRE — REDs when the threading is removed', async () => {
    const { OpenAIAdapter } = await import('../../src/adapters/llm/openai.js');
    await new OpenAIAdapter(REASONING_MODEL).chat(
      { system: 'sys', userMessage: 'msg', maxTokens: 512, reasoningEffort: 'high' },
      { requestId: 'effort-high', timeoutMs: 30_000 },
    );
    expect(sentBody().reasoning_effort).toBe('high');
  });

  it('⚠ OMITTING it sends "medium" — every existing caller is byte-identical', async () => {
    // The load-bearing safety assertion for this PR. All five pre-existing call
    // sites pass no effort; if this ever changed, the PR would silently re-tune
    // every reasoning call in the service rather than only adding a choice.
    const { OpenAIAdapter } = await import('../../src/adapters/llm/openai.js');
    await new OpenAIAdapter(REASONING_MODEL).chat(
      { system: 'sys', userMessage: 'msg', maxTokens: 512 },
      { requestId: 'effort-default', timeoutMs: 30_000 },
    );
    expect(sentBody().reasoning_effort).toBe('medium');
  });

  it('POSITIVE CONTROL — a NON-reasoning model never receives the field, even when asked', async () => {
    // Without this, the assertions above would pass on an implementation that
    // attached reasoning_effort to every model — which the chat-completions
    // family rejects.
    const { OpenAIAdapter } = await import('../../src/adapters/llm/openai.js');
    await new OpenAIAdapter('gpt-4o').chat(
      { system: 'sys', userMessage: 'msg', maxTokens: 512, reasoningEffort: 'low' },
      { requestId: 'effort-nonreasoning', timeoutMs: 30_000 },
    );
    expect('reasoning_effort' in sentBody()).toBe(false);
  });
});

describe('the challenger spends MORE deliberation, and that is the point of the knob', () => {
  beforeEach(() => {
    process.env = { ...originalEnv, OPENAI_API_KEY: 'sk-test-openai' };
    createSpy.mockReset();
    createSpy.mockResolvedValue(ok(CRITIQUE_JSON));
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("⭐ critiqueGraph's 'high' survives to the request — the knob and the challenger are one change", async () => {
    // critique is a read-only reviewer OFF the user's critical path, so more
    // deliberation is exactly where it is worth paying for — the opposite trade
    // from a latency-bound call. Neither setting was expressible before this.
    const { OpenAIAdapter } = await import('../../src/adapters/llm/openai.js');
    const result = await new OpenAIAdapter(REASONING_MODEL).critiqueGraph(
      { graph: { nodes: [], edges: [] } } as never,
      {
        requestId: 'critique-effort',
        preloadedSystemPrompt: { operation: 'critique_graph', content: 'critique system prompt' },
      } as never,
    );
    expect(sentBody().reasoning_effort).toBe('high');
    // NON-VACUITY: the call really produced a parsed critique, so this cannot
    // pass by the adapter having thrown before reaching the request.
    expect(Array.isArray(result.issues)).toBe(true);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});
