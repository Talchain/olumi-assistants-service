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
const { UnhandledTurnClassError } = await import('../types.js');

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

  /**
   * STRUCTURAL failures → ClassifierSchemaViolationError → recoverable LLM
   * fault. These cases cover malformed output where the LLM did not produce
   * a JSON object with a string `turn_class` field.
   */
  describe('structural failures → ClassifierSchemaViolationError', () => {
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

    it('missing turn_class key', async () => {
      classifierMock.content = '{"other":"value"}';
      await expect(classifyTurn(BASE_INPUT)).rejects.toBeInstanceOf(
        ClassifierSchemaViolationError,
      );
    });

    it('turn_class is not a string (wrong type)', async () => {
      classifierMock.content = '{"turn_class":42}';
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

  /**
   * UNSUPPORTED CLASS → UnhandledTurnClassError → P0 invariant breach.
   * Well-formed JSON with a string `turn_class` whose value is not in the
   * A2TurnClass union. Per Paul's correction 3, this is NOT a recoverable
   * schema violation. Regression guard for the P0 tripwire.
   */
  describe('unsupported class → UnhandledTurnClassError (P0)', () => {
    it('rejects a classifier-returned unknown class (e.g. "propose")', async () => {
      classifierMock.content = '{"turn_class":"propose"}';
      await expect(classifyTurn(BASE_INPUT)).rejects.toBeInstanceOf(UnhandledTurnClassError);
    });

    it('rejects a wire-enum value that is not in A2TurnClass (e.g. "frame")', async () => {
      classifierMock.content = '{"turn_class":"frame"}';
      await expect(classifyTurn(BASE_INPUT)).rejects.toBeInstanceOf(UnhandledTurnClassError);
    });

    it('rejects an arbitrary string (e.g. "nonsense-value")', async () => {
      classifierMock.content = '{"turn_class":"nonsense-value"}';
      await expect(classifyTurn(BASE_INPUT)).rejects.toBeInstanceOf(UnhandledTurnClassError);
    });

    it('error carries the rejected value in `attempted` for debug', async () => {
      classifierMock.content = '{"turn_class":"propose"}';
      let caught: unknown;
      try {
        await classifyTurn(BASE_INPUT);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(UnhandledTurnClassError);
      expect((caught as InstanceType<typeof UnhandledTurnClassError>).attempted).toBe('propose');
    });
  });

  describe('timeouts → NarrateTimeoutError with phase="classify"', () => {
    it('maps upstream timeout', async () => {
      classifierMock.throws = 'upstream_timeout';
      let caught: unknown;
      try {
        await classifyTurn(BASE_INPUT);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(NarrateTimeoutError);
      expect((caught as InstanceType<typeof NarrateTimeoutError>).phase).toBe('classify');
    });

    it('maps caller abort', async () => {
      classifierMock.throws = 'abort';
      let caught: unknown;
      try {
        await classifyTurn(BASE_INPUT);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(NarrateTimeoutError);
      expect((caught as InstanceType<typeof NarrateTimeoutError>).phase).toBe('classify');
    });
  });

  describe('generic errors propagate', () => {
    it('rethrows unexpected failures for TurnExecutor to catch', async () => {
      classifierMock.throws = 'generic';
      await expect(classifyTurn(BASE_INPUT)).rejects.toThrow('generic failure');
    });
  });

  // -------------------------------------------------------------------------
  // Slice C1: handler class extension
  // -------------------------------------------------------------------------

  describe('C1 — handler turn class', () => {
    it('returns turn_class=handler + handler_id for a valid handler+id pair', async () => {
      classifierMock.content = '{"turn_class":"handler","handler_id":"run_analysis"}';
      const result = await classifyTurn(BASE_INPUT);
      expect(result.turn_class).toBe('handler');
      expect(result.handler_id).toBe('run_analysis');
    });

    it('accepts every V5ActionType literal as a valid handler_id', async () => {
      const handlerIds = [
        'run_analysis',
        'set_factor_value',
        'add_constraint',
        'adjust_edge_strength',
        'explain_result',
        'compare_options',
        'what_would_flip',
      ] as const;
      for (const id of handlerIds) {
        classifierMock.content = `{"turn_class":"handler","handler_id":"${id}"}`;
        const result = await classifyTurn(BASE_INPUT);
        expect(result.turn_class).toBe('handler');
        expect(result.handler_id).toBe(id);
      }
    });

    it('does not include handler_id on the result for direct_answer turns', async () => {
      classifierMock.content = '{"turn_class":"direct_answer"}';
      const result = await classifyTurn(BASE_INPUT);
      expect(result.handler_id).toBeUndefined();
    });

    it('does not include handler_id on the result for clarify turns', async () => {
      classifierMock.content = '{"turn_class":"clarify"}';
      const result = await classifyTurn(BASE_INPUT);
      expect(result.handler_id).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Slice C1 — biconditional refinement (Paul refinement #6)
  // handler_id must be present iff turn_class === 'handler'
  // -------------------------------------------------------------------------

  describe('C1 — biconditional: handler_id present iff turn_class=handler', () => {
    it('rejects stray handler_id on a direct_answer turn (forward direction)', async () => {
      classifierMock.content = '{"turn_class":"direct_answer","handler_id":"run_analysis"}';
      await expect(classifyTurn(BASE_INPUT)).rejects.toBeInstanceOf(
        ClassifierSchemaViolationError,
      );
    });

    it('rejects stray handler_id on a clarify turn (forward direction)', async () => {
      classifierMock.content = '{"turn_class":"clarify","handler_id":"set_factor_value"}';
      await expect(classifyTurn(BASE_INPUT)).rejects.toBeInstanceOf(
        ClassifierSchemaViolationError,
      );
    });

    it('rejects handler turn without handler_id (reverse direction)', async () => {
      classifierMock.content = '{"turn_class":"handler"}';
      await expect(classifyTurn(BASE_INPUT)).rejects.toBeInstanceOf(
        ClassifierSchemaViolationError,
      );
    });

    it('rejects empty-string handler_id on a handler turn (z.string().min(1))', async () => {
      classifierMock.content = '{"turn_class":"handler","handler_id":""}';
      await expect(classifyTurn(BASE_INPUT)).rejects.toBeInstanceOf(
        ClassifierSchemaViolationError,
      );
    });

    it('rejects null handler_id on a handler turn (not a string)', async () => {
      classifierMock.content = '{"turn_class":"handler","handler_id":null}';
      await expect(classifyTurn(BASE_INPUT)).rejects.toBeInstanceOf(
        ClassifierSchemaViolationError,
      );
    });

    it('rejects stray handler_id on an unsupported turn_class (biconditional fires before union check)', async () => {
      // "propose" is not in C1TurnClass; handler_id present. Structural Zod
      // refinement fires first (handler_id present → turn_class must equal
      // 'handler', else biconditional fails).
      classifierMock.content = '{"turn_class":"propose","handler_id":"run_analysis"}';
      await expect(classifyTurn(BASE_INPUT)).rejects.toBeInstanceOf(
        ClassifierSchemaViolationError,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Slice C1 — invalid handler_id → UnhandledTurnClassError('missing_handler_id')
  // Biconditional schema passes (handler_id present), but the value is not
  // a valid V5ActionType literal.
  // -------------------------------------------------------------------------

  describe('C1 — invalid handler_id semantic → UnhandledTurnClassError(missing_handler_id)', () => {
    it('rejects a hallucinated handler_id value ("make_coffee")', async () => {
      classifierMock.content = '{"turn_class":"handler","handler_id":"make_coffee"}';
      let caught: unknown;
      try {
        await classifyTurn(BASE_INPUT);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(UnhandledTurnClassError);
      const err = caught as InstanceType<typeof UnhandledTurnClassError>;
      expect(err.reason).toBe('missing_handler_id');
      expect(err.attempted).toBe('make_coffee');
    });

    it('rejects a wrong-casing handler_id ("RUN_ANALYSIS")', async () => {
      classifierMock.content = '{"turn_class":"handler","handler_id":"RUN_ANALYSIS"}';
      let caught: unknown;
      try {
        await classifyTurn(BASE_INPUT);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(UnhandledTurnClassError);
      const err = caught as InstanceType<typeof UnhandledTurnClassError>;
      expect(err.reason).toBe('missing_handler_id');
      expect(err.attempted).toBe('RUN_ANALYSIS');
    });

    it('rejects a handler_id that drops the underscore ("runanalysis")', async () => {
      classifierMock.content = '{"turn_class":"handler","handler_id":"runanalysis"}';
      await expect(classifyTurn(BASE_INPUT)).rejects.toMatchObject({
        reason: 'missing_handler_id',
      });
    });
  });
});
