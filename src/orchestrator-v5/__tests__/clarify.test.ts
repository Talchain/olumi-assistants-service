/**
 * dispatchClarify unit tests (A2).
 *
 * Covers:
 *   - Happy path: narrate returns clarifying question, sanitised text.
 *   - Contamination: XML tags stripped, response still succeeds, flag set.
 *   - Empty output → NarrateEmptyOutputError.
 *   - Upstream timeout → NarrateTimeoutError.
 *
 * Same mock seam as the A1 dispatch tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TurnContext } from '@talchain/schemas/orchestrator';

type Mock = {
  output: string;
  throws?: 'upstream_timeout';
  delayMs?: number;
};
const m: Mock = { output: '' };

const clarifyMockAdapter = {
  name: 'test-clarify-mock',
  chat: async (_args: unknown, opts: { signal?: AbortSignal }) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (m.throws === 'upstream_timeout') {
          import('../../adapters/llm/errors.js').then((errs) => {
            reject(new errs.UpstreamTimeoutError('test', 'narrate', 1));
          });
          return;
        }
        resolve();
      }, m.delayMs ?? 0);
      opts.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        const abortError = new Error('aborted');
        (abortError as Error & { name: string }).name = 'AbortError';
        reject(abortError);
      });
    });
    return {
      content: m.output,
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'test-clarify-mock',
      latencyMs: 0,
    };
  },
};

vi.mock('../../adapters/llm/router.js', () => ({
  getAdapter: () => clarifyMockAdapter,
  // Group 3 Task C: llm-adapter.ts (invokeNarrate) now calls
  // getAdapterWithResolution. Stub the new export with a minimal resolution.
  getAdapterWithResolution: (task?: string) => ({
    adapter: clarifyMockAdapter,
    resolution: {
      task,
      resolved_model: 'test-clarify-mock',
      resolution_source: 'task_default' as const,
    },
  }),
}));

vi.mock('../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test clarify system prompt',
}));

const { dispatchClarify } = await import('../clarify.js');
const { NarrateEmptyOutputError, NarrateTimeoutError } = await import('../llm-adapter.js');

const BASE_CONTEXT: TurnContext = {
  stage: 'frame',
  entity_registry: { option_ids: [], goal_id: null },
  capabilities: {
    can_run_analysis: false,
    can_edit_graph: false,
    can_run_decision_review: false,
    can_generate_coaching: false,
    can_invoke_tools: false,
    can_commit_session_state: false,
  },
  messages: [{ role: 'user', content: 'help me' }],
  session_id: 'sess-1',
  request_id: 'req-1',
  budgets: { turn_ms: 180000, llm_narrate_ms: 60000 },
};

describe('dispatchClarify', () => {
  beforeEach(() => {
    m.output = '';
    m.throws = undefined;
    m.delayMs = 0;
  });

  describe('happy path', () => {
    it('returns sanitised output with llm_calls_used=1', async () => {
      m.output = 'What decision are you weighing?';
      const result = await dispatchClarify(BASE_CONTEXT);
      expect(result.sanitised.output).toBe('What decision are you weighing?');
      expect(result.sanitised.contamination_detected).toBe(false);
      expect(result.llm_calls_used).toBe(1);
      expect(result.raw_text_length).toBe('What decision are you weighing?'.length);
    });
  });

  describe('contamination (BI-02)', () => {
    it('strips XML tags, marks contamination, response still succeeds', async () => {
      m.output = '<thinking>hmm</thinking>What are you deciding between?';
      const result = await dispatchClarify(BASE_CONTEXT);
      expect(result.sanitised.output).not.toMatch(/<[a-zA-Z]/);
      expect(result.sanitised.output).toContain('What are you deciding between?');
      expect(result.sanitised.contamination_detected).toBe(true);
    });

    it('replaces em-dash (style normalisation, no contamination flag)', async () => {
      m.output = 'Two options \u2014 cost versus speed. Which matters more?';
      const result = await dispatchClarify(BASE_CONTEXT);
      expect(result.sanitised.output).not.toContain('\u2014');
      expect(result.sanitised.contamination_detected).toBe(false);
    });
  });

  describe('empty output', () => {
    it('throws NarrateEmptyOutputError when LLM returns nothing', async () => {
      m.output = '';
      await expect(dispatchClarify(BASE_CONTEXT)).rejects.toBeInstanceOf(
        NarrateEmptyOutputError,
      );
    });

    it('throws NarrateEmptyOutputError when sanitiser consumes everything', async () => {
      m.output = '<thinking></thinking>';
      await expect(dispatchClarify(BASE_CONTEXT)).rejects.toBeInstanceOf(
        NarrateEmptyOutputError,
      );
    });
  });

  describe('upstream timeout', () => {
    it('propagates NarrateTimeoutError', async () => {
      m.throws = 'upstream_timeout';
      await expect(dispatchClarify(BASE_CONTEXT)).rejects.toBeInstanceOf(
        NarrateTimeoutError,
      );
    });
  });

  describe('invariants', () => {
    it('errors when TurnContext has no user message', async () => {
      const ctxNoUser: TurnContext = {
        ...BASE_CONTEXT,
        messages: [{ role: 'assistant', content: 'unused' }],
      };
      m.output = 'should not reach LLM';
      await expect(dispatchClarify(ctxNoUser)).rejects.toThrow(/no user message/);
    });
  });
});
