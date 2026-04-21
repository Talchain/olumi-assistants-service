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

const dispatchMockAdapter = {
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
};

vi.mock('../../adapters/llm/router.js', () => ({
  getAdapter: () => dispatchMockAdapter,
  // Group 3 Task C: classify.ts and llm-adapter.ts now call
  // getAdapterWithResolution. Mirror the mock with a stub resolution block.
  getAdapterWithResolution: (task?: string) => ({
    adapter: dispatchMockAdapter,
    resolution: {
      task,
      resolved_model: 'test-dispatch-mock',
      resolution_source: 'task_default' as const,
    },
  }),
}));

vi.mock('../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

const { dispatch, UnhandledTurnClassError } = await import('../dispatch.js');
const { ClassifierSchemaViolationError } = await import('../classify.js');
const { NarrateEmptyOutputError, NarrateTimeoutError } = await import('../llm-adapter.js');
const { EMPTY_HANDLER_REGISTRY } = await import('../tools/registry.js');

import type {
  HandlerFn,
  HandlerInvocation,
  HandlerOutcome,
  HandlerRegistry,
} from '../tools/registry.js';
import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';
import type { V5ActionType } from '@talchain/schemas/orchestrator';

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
      const err = new UnhandledTurnClassError('unhandled_turn_class', 'propose');
      expect(err.reason).toBe('unhandled_turn_class');
      expect(err.attempted).toBe('propose');
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

  // ---------------------------------------------------------------------------
  // Slice C1 — handler turn class routing (D5)
  // ---------------------------------------------------------------------------

  const BASE_PAYLOAD: OrchestratorTurnPayload = {
    turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    stage: 'frame',
    turn_class: 'frame',
    message: 'decide between vendors',
  };

  describe('C1 — handler turn routing against empty registry', () => {
    it('throws UnhandledTurnClassError(handler_not_registered) for an UN-registered handler against the default registry', async () => {
      // C2 registers `run_analysis` in the default registry; the other six
      // V5ActionType literals are still unregistered so the miss path remains
      // testable via any of them. `explain_result` is slated for D2 (later).
      phaseMocks.classify.content =
        '{"turn_class":"handler","handler_id":"explain_result"}';
      let caught: unknown;
      try {
        await dispatch(BASE_CONTEXT, { payload: BASE_PAYLOAD });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(UnhandledTurnClassError);
      const err = caught as InstanceType<typeof UnhandledTurnClassError>;
      expect(err.reason).toBe('handler_not_registered');
      expect(err.attempted).toBe('explain_result');
    });

    it('throws the same error when registry is explicitly the EMPTY singleton', async () => {
      phaseMocks.classify.content =
        '{"turn_class":"handler","handler_id":"explain_result"}';
      await expect(
        dispatch(BASE_CONTEXT, {
          payload: BASE_PAYLOAD,
          registry: EMPTY_HANDLER_REGISTRY,
        }),
      ).rejects.toMatchObject({ reason: 'handler_not_registered', attempted: 'explain_result' });
    });

    it('dispatch throws an invariant Error when a REGISTERED handler dispatches without a payload opt', async () => {
      phaseMocks.classify.content =
        '{"turn_class":"handler","handler_id":"run_analysis"}';
      // Registry resolves → payload guard is the next check → fires because
      // payload is absent. Caller-contract violation surfaced cleanly.
      const fakeHandler: HandlerFn = async () => ({
        assistant_text: 'x',
        handler_facts: [],
        llm_calls_used: 0,
      });
      const registry: HandlerRegistry = new Map([['run_analysis', fakeHandler]]);
      await expect(dispatch(BASE_CONTEXT, { registry })).rejects.toThrow(/payload/);
    });

    it('never calls narrate when handler class dispatches (short-circuits on registry miss)', async () => {
      // Use a C2-unregistered handler_id to keep the miss path under test.
      phaseMocks.classify.content =
        '{"turn_class":"handler","handler_id":"compare_options"}';
      phaseMocks.narrate.content = 'NARRATE MUST NOT RUN';
      await expect(
        dispatch(BASE_CONTEXT, { payload: BASE_PAYLOAD }),
      ).rejects.toBeInstanceOf(UnhandledTurnClassError);
    });
  });

  describe('C1 — handler turn routing against populated test registry', () => {
    it('invokes the resolved HandlerFn, returns DispatchResult with handler_outcome', async () => {
      const captured: HandlerInvocation[] = [];
      const fakeHandler: HandlerFn = async (invocation) => {
        captured.push(invocation);
        return {
          assistant_text: 'handler assistant text',
          handler_facts: [],
          llm_calls_used: 1,
        };
      };
      const registry: HandlerRegistry = new Map([['run_analysis', fakeHandler]]);
      phaseMocks.classify.content =
        '{"turn_class":"handler","handler_id":"run_analysis"}';

      const result = await dispatch(BASE_CONTEXT, {
        payload: BASE_PAYLOAD,
        registry,
      });
      expect(result.turn_class).toBe('handler');
      if (result.turn_class === 'handler') {
        expect(result.handler_id).toBe('run_analysis');
        expect(result.handler_outcome.assistant_text).toBe('handler assistant text');
        expect(result.handler_outcome.handler_facts).toEqual([]);
        expect(result.llm_calls_used).toBe(2); // classifier (1) + handler's declared (1)
      }
      expect(captured).toHaveLength(1);
    });

    it('HandlerInvocation carries context, payload, requestId, and signal through unchanged', async () => {
      let invocation: HandlerInvocation | undefined;
      const fakeHandler: HandlerFn = async (inv) => {
        invocation = inv;
        return { assistant_text: 'x', handler_facts: [], llm_calls_used: 0 };
      };
      const registry: HandlerRegistry = new Map([['explain_result', fakeHandler]]);
      phaseMocks.classify.content =
        '{"turn_class":"handler","handler_id":"explain_result"}';
      const externalController = new AbortController();

      await dispatch(BASE_CONTEXT, {
        payload: BASE_PAYLOAD,
        registry,
        signal: externalController.signal,
      });
      expect(invocation).toBeDefined();
      expect(invocation!.context).toBe(BASE_CONTEXT);
      expect(invocation!.payload).toBe(BASE_PAYLOAD);
      expect(invocation!.requestId).toBe('req-1');
      expect(invocation!.signal).toBe(externalController.signal);
    });

    it('llm_calls_used sums classifier (1) + HandlerOutcome.llm_calls_used', async () => {
      const fakeHandler: HandlerFn = async () => ({
        assistant_text: 'x',
        handler_facts: [],
        llm_calls_used: 3, // handler made 3 LLM calls
      });
      const registry: HandlerRegistry = new Map([['compare_options', fakeHandler]]);
      phaseMocks.classify.content =
        '{"turn_class":"handler","handler_id":"compare_options"}';
      const result = await dispatch(BASE_CONTEXT, {
        payload: BASE_PAYLOAD,
        registry,
      });
      expect(result.llm_calls_used).toBe(4);
    });

    it('llm_calls_used = 1 when handler makes zero LLM calls (deterministic path)', async () => {
      const fakeHandler: HandlerFn = async () => ({
        assistant_text: 'deterministic output',
        handler_facts: [],
        llm_calls_used: 0,
      });
      const registry: HandlerRegistry = new Map([['set_factor_value', fakeHandler]]);
      phaseMocks.classify.content =
        '{"turn_class":"handler","handler_id":"set_factor_value"}';
      const result = await dispatch(BASE_CONTEXT, {
        payload: BASE_PAYLOAD,
        registry,
      });
      expect(result.llm_calls_used).toBe(1);
    });

    it('onClassified callback receives both turn_class and handler_id', async () => {
      const observed: Array<{ cls: string; handlerId?: V5ActionType }> = [];
      const fakeHandler: HandlerFn = async () => ({
        assistant_text: 'x',
        handler_facts: [],
        llm_calls_used: 0,
      });
      const registry: HandlerRegistry = new Map([['run_analysis', fakeHandler]]);
      phaseMocks.classify.content =
        '{"turn_class":"handler","handler_id":"run_analysis"}';
      await dispatch(BASE_CONTEXT, {
        payload: BASE_PAYLOAD,
        registry,
        onClassified: (cls, handlerId) => {
          observed.push({ cls, handlerId });
        },
      });
      expect(observed).toEqual([{ cls: 'handler', handlerId: 'run_analysis' }]);
    });

    it('handler outcome is returned even if HandlerOutcome.handler_facts is populated', async () => {
      const fakeHandler: HandlerFn = async () => ({
        assistant_text: 'x',
        handler_facts: [
          {
            fact_type: 'run_analysis',
            fact_version: 1,
            noop: false,
            result: {} as unknown as HandlerOutcome['handler_facts'][number]['result'],
          },
        ],
        llm_calls_used: 1,
      });
      const registry: HandlerRegistry = new Map([['run_analysis', fakeHandler]]);
      phaseMocks.classify.content =
        '{"turn_class":"handler","handler_id":"run_analysis"}';
      const result = await dispatch(BASE_CONTEXT, {
        payload: BASE_PAYLOAD,
        registry,
      });
      if (result.turn_class === 'handler') {
        expect(result.handler_outcome.handler_facts).toHaveLength(1);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Slice C1 — A2 regression (Paul refinement #7)
  // Existing direct_answer / clarify DispatchResult shape preserved under the
  // extended discriminated union.
  // ---------------------------------------------------------------------------

  describe('C1 — A2 regression under extended discriminated DispatchResult', () => {
    it('direct_answer DispatchResult has sanitised + NO handler_outcome / handler_id', async () => {
      phaseMocks.classify.content = '{"turn_class":"direct_answer"}';
      phaseMocks.narrate.content = 'A2 path still works';
      const result = await dispatch(BASE_CONTEXT);
      expect(result.turn_class).toBe('direct_answer');
      if (result.turn_class === 'direct_answer') {
        expect(result.sanitised.output).toBe('A2 path still works');
        expect((result as unknown as { handler_outcome?: unknown }).handler_outcome).toBeUndefined();
        expect((result as unknown as { handler_id?: unknown }).handler_id).toBeUndefined();
      }
    });

    it('clarify DispatchResult has sanitised + NO handler_outcome / handler_id', async () => {
      phaseMocks.classify.content = '{"turn_class":"clarify"}';
      phaseMocks.narrate.content = 'clarify path still works';
      const result = await dispatch(BASE_CONTEXT);
      expect(result.turn_class).toBe('clarify');
      if (result.turn_class === 'clarify') {
        expect(result.sanitised.output).toBe('clarify path still works');
        expect((result as unknown as { handler_outcome?: unknown }).handler_outcome).toBeUndefined();
      }
    });

    it('direct_answer llm_calls_used still equals 2 on success (classify + narrate)', async () => {
      phaseMocks.classify.content = '{"turn_class":"direct_answer"}';
      phaseMocks.narrate.content = 'answer';
      const result = await dispatch(BASE_CONTEXT);
      expect(result.llm_calls_used).toBe(2);
    });

    it('clarify llm_calls_used still equals 2 on success', async () => {
      phaseMocks.classify.content = '{"turn_class":"clarify"}';
      phaseMocks.narrate.content = 'What is the decision?';
      const result = await dispatch(BASE_CONTEXT);
      expect(result.llm_calls_used).toBe(2);
    });
  });
});
