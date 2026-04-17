/**
 * dispatch() unit tests (A2).
 *
 * Covers:
 *   - Happy path: classify=direct_answer → narrate → sanitised DispatchResult
 *   - Happy path: classify=clarify → narrate (via dispatchClarify) → result
 *   - Classifier returns invalid union → ClassifierSchemaViolationError
 *   - Classifier upstream timeout → NarrateTimeoutError
 *   - Narrate upstream timeout (after successful classify) → NarrateTimeoutError
 *   - Narrate empty output → NarrateEmptyOutputError
 *   - llm_calls_used accounting: 2 on success (classify + narrate)
 *
 * Both LLM calls share the same getAdapter mock; we route behaviour based on
 * whether `responseFormat: 'json_object'` is present in chat args (the
 * classifier's signature). This mirrors the seam-splitting pattern real adapters
 * would use to switch output modes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TurnContext } from '@talchain/schemas/orchestrator';

type Phase = 'classify' | 'narrate';
type PhaseMock = {
  content: string;
  throws?: 'upstream_timeout';
  delayMs?: number;
};
const phaseMocks: Record<Phase, PhaseMock> = {
  classify: { content: '' },
  narrate: { content: '' },
};

vi.mock('../../adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test-dispatch-mock',
    chat: async (
      args: { responseFormat?: string },
      opts: { signal?: AbortSignal },
    ) => {
      const phase: Phase = args.responseFormat === 'json_object' ? 'classify' : 'narrate';
      const m = phaseMocks[phase];
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (m.throws === 'upstream_timeout') {
            import('../../adapters/llm/errors.js').then((errs) => {
              reject(new errs.UpstreamTimeoutError('test', phase, 1));
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
        content: m.content,
        usage: { input_tokens: 1, output_tokens: 1 },
        model: 'test-dispatch-mock',
        latencyMs: 0,
      };
    },
  }),
}));

vi.mock('../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

const { dispatch, UnhandledTurnClassError } = await import('../dispatch.js');
const { ClassifierSchemaViolationError } = await import('../classify.js');
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
  messages: [{ role: 'user', content: 'decide between vendors' }],
  session_id: 'sess-1',
  request_id: 'req-1',
  budgets: { turn_ms: 180000, llm_narrate_ms: 60000 },
};

describe('dispatch', () => {
  beforeEach(() => {
    phaseMocks.classify = { content: '' };
    phaseMocks.narrate = { content: '' };
  });

  describe('happy path: direct_answer', () => {
    it('classifies + narrates, returns sanitised result with llm_calls_used=2', async () => {
      phaseMocks.classify.content = '{"turn_class":"direct_answer"}';
      phaseMocks.narrate.content = 'Here is a framing answer.';
      const result = await dispatch(BASE_CONTEXT);
      expect(result.turn_class).toBe('direct_answer');
      expect(result.sanitised.output).toBe('Here is a framing answer.');
      expect(result.llm_calls_used).toBe(2);
      expect(result.raw_text_length).toBe('Here is a framing answer.'.length);
    });
  });

  describe('happy path: clarify', () => {
    it('routes clarify via dispatchClarify, llm_calls_used=2', async () => {
      phaseMocks.classify.content = '{"turn_class":"clarify"}';
      phaseMocks.narrate.content = 'What decision are you weighing?';
      const result = await dispatch(BASE_CONTEXT);
      expect(result.turn_class).toBe('clarify');
      expect(result.sanitised.output).toBe('What decision are you weighing?');
      expect(result.llm_calls_used).toBe(2);
    });

    it('preserves contamination flag through the clarify branch', async () => {
      phaseMocks.classify.content = '{"turn_class":"clarify"}';
      phaseMocks.narrate.content = '<thinking>x</thinking>What are you deciding?';
      const result = await dispatch(BASE_CONTEXT);
      expect(result.turn_class).toBe('clarify');
      expect(result.sanitised.contamination_detected).toBe(true);
      expect(result.sanitised.output).not.toMatch(/<[a-zA-Z]/);
    });
  });

  describe('classifier failures', () => {
    it('invalid JSON → ClassifierSchemaViolationError, narrate never called', async () => {
      phaseMocks.classify.content = 'not json';
      phaseMocks.narrate.content = 'should never be read';
      await expect(dispatch(BASE_CONTEXT)).rejects.toBeInstanceOf(
        ClassifierSchemaViolationError,
      );
    });

    /**
     * Paul's correction 3 (P0): well-formed JSON whose `turn_class` is not in
     * the A2TurnClass union is an invariant breach (UNHANDLED), NOT a
     * recoverable schema violation. Regression guard — prevents drift back
     * to the earlier conflation.
     */
    it('valid JSON with unsupported class → UnhandledTurnClassError (P0)', async () => {
      phaseMocks.classify.content = '{"turn_class":"propose"}';
      await expect(dispatch(BASE_CONTEXT)).rejects.toBeInstanceOf(UnhandledTurnClassError);
    });

    it('upstream timeout on classify → NarrateTimeoutError with phase="classify"', async () => {
      phaseMocks.classify.throws = 'upstream_timeout';
      let caught: unknown;
      try {
        await dispatch(BASE_CONTEXT);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(NarrateTimeoutError);
      expect((caught as InstanceType<typeof NarrateTimeoutError>).phase).toBe('classify');
    });
  });

  describe('narrate failures after successful classify', () => {
    it('upstream timeout on narrate → NarrateTimeoutError with phase="narrate"', async () => {
      phaseMocks.classify.content = '{"turn_class":"direct_answer"}';
      phaseMocks.narrate.throws = 'upstream_timeout';
      let caught: unknown;
      try {
        await dispatch(BASE_CONTEXT);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(NarrateTimeoutError);
      expect((caught as InstanceType<typeof NarrateTimeoutError>).phase).toBe('narrate');
    });

    it('empty narrate output → NarrateEmptyOutputError', async () => {
      phaseMocks.classify.content = '{"turn_class":"direct_answer"}';
      phaseMocks.narrate.content = '';
      await expect(dispatch(BASE_CONTEXT)).rejects.toBeInstanceOf(NarrateEmptyOutputError);
    });

    it('empty narrate output on clarify branch → NarrateEmptyOutputError', async () => {
      phaseMocks.classify.content = '{"turn_class":"clarify"}';
      phaseMocks.narrate.content = '';
      await expect(dispatch(BASE_CONTEXT)).rejects.toBeInstanceOf(NarrateEmptyOutputError);
    });
  });

  describe('UnhandledTurnClassError (schema tripwire)', () => {
    it('is exported for TurnExecutor to catch', () => {
      const err = new UnhandledTurnClassError('propose');
      expect(err.reason).toBe('unhandled_turn_class');
      expect(err.message).toMatch(/propose/);
      expect(err.name).toBe('UnhandledTurnClassError');
    });
  });

  /**
   * Phase 0 wiring guard. The 7 V5 handler operations
   * (run_analysis / set_factor_value / add_constraint / adjust_edge_strength /
   * explain_result / compare_options / what_would_flip) are now wired into
   * the prompt-loader (CeeTaskId + OPERATION_TO_TASK_ID + default fragments),
   * but no handler *code* exists yet — that's tranche B/C/D work. If the
   * classifier were to return any of these names today, dispatch MUST reject
   * with UnhandledTurnClassError. This test proves the placeholder wiring
   * cannot be accidentally reached via the A2 dispatcher.
   */
  describe('Phase 0 handler-operation guard (wiring without handler code)', () => {
    const HANDLER_OPERATIONS = [
      'run_analysis',
      'set_factor_value',
      'add_constraint',
      'adjust_edge_strength',
      'explain_result',
      'compare_options',
      'what_would_flip',
    ] as const;

    for (const op of HANDLER_OPERATIONS) {
      it(`classifier returning "${op}" → UnhandledTurnClassError (no handler wired in A2)`, async () => {
        phaseMocks.classify.content = `{"turn_class":"${op}"}`;
        phaseMocks.narrate.content = 'this narrate MUST NOT run';
        let caught: unknown;
        try {
          await dispatch(BASE_CONTEXT);
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(UnhandledTurnClassError);
        expect((caught as InstanceType<typeof UnhandledTurnClassError>).message).toContain(op);
        // Narrate must not have been called: if it had, its output would have
        // been sanitised and returned. The throw short-circuits that path.
      });
    }
  });
});
