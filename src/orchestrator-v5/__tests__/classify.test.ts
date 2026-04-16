/**
 * classifyTurn unit tests (A2).
 *
 * Covers:
 *   - Happy path: LLM returns `{"turn_class":"direct_answer"}` / `"clarify"`.
 *   - JSON parse failure → ClassifierSchemaViolationError.
 *   - Invalid union value → ClassifierSchemaViolationError.
 *   - Empty output → ClassifierSchemaViolationError.
 *   - Extra keys (strict schema) → ClassifierSchemaViolationError.
 *   - Upstream timeout → NarrateTimeoutError.
 *   - Caller abort → NarrateTimeoutError.
 *
 * LLM adapter mocked at the getAdapter seam (same pattern as A1 tests).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type ClassifierMock = {
  content: string;
  throws?: 'upstream_timeout' | 'abort' | 'generic';
  delayMs?: number;
};
const classifierMock: ClassifierMock = { content: '' };

vi.mock('../../adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test-classifier-mock',
    chat: async (_args: unknown, opts: { signal?: AbortSignal }) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (classifierMock.throws === 'upstream_timeout') {
            import('../../adapters/llm/errors.js').then((errs) => {
              reject(new errs.UpstreamTimeoutError('test timeout', 'classify', 1));
            });
            return;
          }
          if (classifierMock.throws === 'abort') {
            const abortError = new Error('abort');
            (abortError as Error & { name: string }).name = 'AbortError';
            reject(abortError);
            return;
          }
          if (classifierMock.throws === 'generic') {
            reject(new Error('generic failure'));
            return;
          }
          resolve();
        }, classifierMock.delayMs ?? 0);
        opts.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          const abortError = new Error('aborted');
          (abortError as Error & { name: string }).name = 'AbortError';
          reject(abortError);
        });
      });
      return {
        content: classifierMock.content,
        usage: { input_tokens: 1, output_tokens: 1 },
        model: 'test-classifier-mock',
        latencyMs: 0,
      };
    },
  }),
}));

vi.mock('../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test classifier system prompt',
}));

const { classifyTurn, ClassifierSchemaViolationError } = await import('../classify.js');
const { NarrateTimeoutError } = await import('../llm-adapter.js');

const BASE_INPUT = {
  user_message: 'help me decide',
  request_id: 'req-classify-1',
  budget_ms: 1000,
};

describe('classifyTurn', () => {
  beforeEach(() => {
    classifierMock.content = '';
    classifierMock.throws = undefined;
    classifierMock.delayMs = 0;
  });

  describe('happy path', () => {
    it('returns turn_class=direct_answer for well-formed direct_answer JSON', async () => {
      classifierMock.content = '{"turn_class":"direct_answer"}';
      const { turn_class } = await classifyTurn(BASE_INPUT);
      expect(turn_class).toBe('direct_answer');
    });

    it('returns turn_class=clarify for well-formed clarify JSON', async () => {
      classifierMock.content = '{"turn_class":"clarify"}';
      const { turn_class } = await classifyTurn(BASE_INPUT);
      expect(turn_class).toBe('clarify');
    });

    it('tolerates leading/trailing whitespace in model output', async () => {
      classifierMock.content = '  \n{"turn_class":"clarify"}\n  ';
      const { turn_class } = await classifyTurn(BASE_INPUT);
      expect(turn_class).toBe('clarify');
    });
  });

  describe('schema violations → ClassifierSchemaViolationError', () => {
    it('empty output', async () => {
      classifierMock.content = '';
      await expect(classifyTurn(BASE_INPUT)).rejects.toBeInstanceOf(
        ClassifierSchemaViolationError,
      );
    });

    it('invalid JSON', async () => {
      classifierMock.content = 'not json at all';
      await expect(classifyTurn(BASE_INPUT)).rejects.toBeInstanceOf(
        ClassifierSchemaViolationError,
      );
    });

    it('invalid union value', async () => {
      classifierMock.content = '{"turn_class":"propose"}';
      await expect(classifyTurn(BASE_INPUT)).rejects.toBeInstanceOf(
        ClassifierSchemaViolationError,
      );
    });

    it('missing turn_class key', async () => {
      classifierMock.content = '{"other":"value"}';
      await expect(classifyTurn(BASE_INPUT)).rejects.toBeInstanceOf(
        ClassifierSchemaViolationError,
      );
    });

    it('extra keys (strict schema rejects)', async () => {
      classifierMock.content = '{"turn_class":"clarify","extra":1}';
      await expect(classifyTurn(BASE_INPUT)).rejects.toBeInstanceOf(
        ClassifierSchemaViolationError,
      );
    });
  });

  describe('timeouts → NarrateTimeoutError', () => {
    it('maps upstream timeout', async () => {
      classifierMock.throws = 'upstream_timeout';
      await expect(classifyTurn(BASE_INPUT)).rejects.toBeInstanceOf(NarrateTimeoutError);
    });

    it('maps caller abort', async () => {
      classifierMock.throws = 'abort';
      await expect(classifyTurn(BASE_INPUT)).rejects.toBeInstanceOf(NarrateTimeoutError);
    });
  });

  describe('generic errors propagate', () => {
    it('rethrows unexpected failures for TurnExecutor to catch', async () => {
      classifierMock.throws = 'generic';
      await expect(classifyTurn(BASE_INPUT)).rejects.toThrow('generic failure');
    });
  });
});
