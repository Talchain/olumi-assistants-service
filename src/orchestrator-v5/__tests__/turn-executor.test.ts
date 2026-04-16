/**
 * TurnExecutor unit tests (A1 + A2).
 *
 * Covers:
 *   - BI-01 exactly-one-response (every `started` has a matching `completed`
 *     with response_emitted=true across every outcome path)
 *   - BI-02 contamination is handled in-band (response stays a success)
 *   - Paul's constraint 7: BUDGET_EXCEEDED wins over LLM_TIMEOUT when both apply
 *   - A2: `turn_class` in completed telemetry reflects classifier outcome
 *   - A2: classify stage appears in `stages_completed`
 *   - A2: classifier schema violation → LLM_UNAVAILABLE envelope
 *   - A2: llm_calls_used == 2 on success (classify + narrate)
 *   - Zod-validity of every returned envelope (happy + failure paths)
 *
 * The LLM adapter is mocked at the `getAdapter(...).chat` seam. The mock
 * distinguishes classify calls (`args.responseFormat === 'json_object'`) from
 * narrate calls. No live provider calls (Paul's constraint 9).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';

// ---------------------------------------------------------------------------
// Mock surface (shared classify + narrate via responseFormat routing)
// ---------------------------------------------------------------------------

type Phase = 'classify' | 'narrate';
type PhaseBehaviour =
  | { kind: 'success'; output: string; delayMs?: number }
  | { kind: 'upstream_timeout'; delayMs?: number }
  | { kind: 'abort'; delayMs?: number }
  | { kind: 'throw'; delayMs?: number };

const phaseState: Record<Phase, PhaseBehaviour> = {
  classify: { kind: 'success', output: '{"turn_class":"direct_answer"}' },
  narrate: { kind: 'success', output: 'hello world' },
};

vi.mock('../../adapters/llm/router.js', () => {
  return {
    getAdapter: () => ({
      name: 'test-mock',
      chat: async (
        args: { responseFormat?: string },
        opts: { signal?: AbortSignal },
      ) => {
        const phase: Phase = args.responseFormat === 'json_object' ? 'classify' : 'narrate';
        const behaviour = phaseState[phase];
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            try {
              dispatchBehaviour(phase, resolve, reject);
            } catch (e) {
              reject(e as Error);
            }
          }, behaviour.delayMs ?? 0);
          opts.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            const abortError = new Error('aborted');
            (abortError as Error & { name: string }).name = 'AbortError';
            reject(abortError);
          });
        });
        const output = behaviour.kind === 'success' ? behaviour.output : '';
        return {
          content: output,
          usage: { input_tokens: 1, output_tokens: 1 },
          model: 'test-mock',
          latencyMs: 0,
        };
      },
    }),
  };
});

vi.mock('../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'You are a test narrator.',
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { UpstreamTimeoutError } = await import('../../adapters/llm/errors.js');

function dispatchBehaviour(
  phase: Phase,
  resolve: () => void,
  reject: (err: Error) => void,
): void {
  const b = phaseState[phase];
  switch (b.kind) {
    case 'success':
      return resolve();
    case 'upstream_timeout':
      return reject(new UpstreamTimeoutError('test timeout', phase, 100));
    case 'throw':
      return reject(new Error('test-injected generic failure'));
    case 'abort': {
      const abortError = new Error('abort');
      (abortError as Error & { name: string }).name = 'AbortError';
      return reject(abortError);
    }
  }
}

function resetPhases(): void {
  phaseState.classify = { kind: 'success', output: '{"turn_class":"direct_answer"}' };
  phaseState.narrate = { kind: 'success', output: 'hello world' };
}

// ---------------------------------------------------------------------------
// Telemetry sink
// ---------------------------------------------------------------------------

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];
function installSink(): void {
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
}
function uninstallSink(): void {
  setTestSink(null);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_PAYLOAD: OrchestratorTurnPayload = {
  turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  message: 'frame the decision',
  turn_class: 'frame',
  stage: 'frame',
};

function startedCount(): number {
  return events.filter((e) => e.event === 'turn_executor.started').length;
}
function completedEvents(): Event[] {
  return events.filter((e) => e.event === 'turn_executor.completed');
}
function expectExactlyOneResponseInvariant(): void {
  const started = startedCount();
  const completed = completedEvents();
  expect(started).toBe(1);
  expect(completed).toHaveLength(1);
  expect(completed[0]!.data.response_emitted).toBe(true);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runTurnExecutor', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    events = [];
    installSink();
    resetPhases();
    delete process.env.TURN_BUDGET_MS;
    delete process.env.LLM_BUDGET_NARRATE_MS;
  });
  afterEach(() => {
    uninstallSink();
    process.env = { ...originalEnv };
  });

  describe('happy path (direct_answer success)', () => {
    it('returns a Zod-valid OlumiResponse with the LLM text', async () => {
      phaseState.narrate = { kind: 'success', output: 'The framing.' };
      const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-1');
      const parsed = OlumiResponseSchema.parse(response);
      expect(parsed.assistant_text).toBe('The framing.');
      expect(parsed.blocks).toEqual([]);
      expect(parsed.suggested_actions).toEqual([]);
      expect(parsed.insights).toEqual([]);
      expect(parsed.stage_indicator).toBe('frame');
      expect(telemetry.failure_type).toBeNull();
      expect(telemetry.commit_performed).toBe(true);
      // A2: classify + narrate = 2 LLM calls on success
      expect(telemetry.llm_calls_used).toBe(2);
      expect(telemetry.turn_class).toBe('direct_answer');
      expectExactlyOneResponseInvariant();
      const completed = completedEvents()[0]!;
      expect(completed.data.failure_type).toBeNull();
      expect(completed.data.commit_performed).toBe(true);
      expect(completed.data.turn_class).toBe('direct_answer');
      expect(completed.data.llm_calls_used).toBe(2);
      // stages_completed: presence-based (order-tolerant per Correction 2)
      const stages = completed.data.stages_completed as string[];
      expect(stages).toContain('classify');
      expect(stages).toContain('dispatch');
      expect(stages).toContain('compose');
      expect(stages).toContain('commit');
    });

    it('omits updated_session_state (constraint 6 — not in schema)', async () => {
      const { response } = await runTurnExecutor(BASE_PAYLOAD, 'req-1');
      expect((response as Record<string, unknown>).updated_session_state).toBeUndefined();
    });
  });

  describe('happy path (clarify success, A2)', () => {
    it('classifier=clarify → clarify envelope + turn_class telemetry', async () => {
      phaseState.classify = { kind: 'success', output: '{"turn_class":"clarify"}' };
      phaseState.narrate = { kind: 'success', output: 'What decision are you weighing?' };
      const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-1');
      const parsed = OlumiResponseSchema.parse(response);
      expect(parsed.assistant_text).toBe('What decision are you weighing?');
      expect(parsed.blocks).toEqual([]);
      expect(parsed.suggested_actions).toEqual([]);
      expect(parsed.insights).toEqual([]);
      expect(telemetry.failure_type).toBeNull();
      expect(telemetry.commit_performed).toBe(true);
      expect(telemetry.llm_calls_used).toBe(2);
      expect(telemetry.turn_class).toBe('clarify');
      expectExactlyOneResponseInvariant();
      const completed = completedEvents()[0]!;
      expect(completed.data.turn_class).toBe('clarify');
    });
  });

  describe('BI-02 contamination (sanitiser in-band)', () => {
    it('strips tags and em-dashes, response stays a success', async () => {
      phaseState.narrate = {
        kind: 'success',
        output: '<thinking>inner</thinking>Two forces \u2014 cost and speed.',
      };
      const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-1');
      OlumiResponseSchema.parse(response);
      expect(response.assistant_text).not.toMatch(/<[a-zA-Z]|\u2014/);
      expect(response.assistant_text).toContain('Two forces');
      expect(response.blocks).toEqual([]);
      expect(telemetry.failure_type).toBeNull();
      expectExactlyOneResponseInvariant();
      const contam = events.filter(
        (e) => e.event === 'turn_executor.contamination_narrate',
      );
      expect(contam).toHaveLength(1);
      // A2: contamination telemetry carries the resolved turn_class
      expect(contam[0]!.data.turn_class).toBe('direct_answer');
    });

    it('clarify-branch contamination also emits the telemetry event', async () => {
      phaseState.classify = { kind: 'success', output: '{"turn_class":"clarify"}' };
      phaseState.narrate = {
        kind: 'success',
        output: '<thinking>x</thinking>Which vendor are you comparing?',
      };
      await runTurnExecutor(BASE_PAYLOAD, 'req-1');
      const contam = events.filter(
        (e) => e.event === 'turn_executor.contamination_narrate',
      );
      expect(contam).toHaveLength(1);
      expect(contam[0]!.data.turn_class).toBe('clarify');
    });
  });

  describe('LLM_TIMEOUT', () => {
    it('maps narrate upstream timeout to UPSTREAM_TIMEOUT wire code', async () => {
      phaseState.narrate = { kind: 'upstream_timeout' };
      const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-1');
      OlumiResponseSchema.parse(response);
      expect(response.blocks).toHaveLength(1);
      const block = response.blocks[0]!;
      expect(block.type).toBe('error');
      if (block.type === 'error') {
        expect(block.error_code).toBe('UPSTREAM_TIMEOUT');
      }
      expect(telemetry.failure_type).toBe('UPSTREAM_TIMEOUT');
      expect(telemetry.commit_performed).toBe(false);
      expectExactlyOneResponseInvariant();
    });

    it('maps classify upstream timeout to UPSTREAM_TIMEOUT wire code', async () => {
      phaseState.classify = { kind: 'upstream_timeout' };
      const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-1');
      OlumiResponseSchema.parse(response);
      const block = response.blocks[0]!;
      if (block.type === 'error') {
        expect(block.error_code).toBe('UPSTREAM_TIMEOUT');
      }
      expect(telemetry.failure_type).toBe('UPSTREAM_TIMEOUT');
    });
  });

  describe('LLM_SCHEMA_VIOLATION (A2)', () => {
    it('classifier returns non-JSON → LLM_UNAVAILABLE envelope', async () => {
      phaseState.classify = { kind: 'success', output: 'not json at all' };
      const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-1');
      OlumiResponseSchema.parse(response);
      const block = response.blocks[0]!;
      expect(block.type).toBe('error');
      if (block.type === 'error') {
        expect(block.error_code).toBe('LLM_UNAVAILABLE');
        expect(block.details).toMatchObject({ phase: 'classify' });
      }
      expect(telemetry.failure_type).toBe('LLM_UNAVAILABLE');
      expect(telemetry.commit_performed).toBe(false);
      expectExactlyOneResponseInvariant();
    });

    it('classifier returns out-of-union value → LLM_UNAVAILABLE envelope', async () => {
      phaseState.classify = { kind: 'success', output: '{"turn_class":"propose"}' };
      const { telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-1');
      expect(telemetry.failure_type).toBe('LLM_UNAVAILABLE');
    });
  });

  describe("Paul's constraint 7 — BUDGET_EXCEEDED wins over LLM_TIMEOUT", () => {
    it('when outer budget aborts during a slow LLM call, classifies as BUDGET_EXCEEDED', async () => {
      process.env.TURN_BUDGET_MS = '10';
      process.env.LLM_BUDGET_NARRATE_MS = '60000';
      phaseState.classify = {
        kind: 'success',
        output: '{"turn_class":"direct_answer"}',
        delayMs: 200,
      };
      const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-1');
      OlumiResponseSchema.parse(response);
      const block = response.blocks[0]!;
      expect(block.type).toBe('error');
      if (block.type === 'error') {
        expect(block.error_code).toBe('TURN_BUDGET_EXCEEDED');
      }
      expect(telemetry.failure_type).toBe('TURN_BUDGET_EXCEEDED');
      expect(telemetry.commit_performed).toBe(false);
      expectExactlyOneResponseInvariant();
    });
  });

  describe('empty narrate output', () => {
    it('maps to UNHANDLED/INTERNAL_ERROR envelope', async () => {
      phaseState.narrate = { kind: 'success', output: '' };
      const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-1');
      OlumiResponseSchema.parse(response);
      const block = response.blocks[0]!;
      expect(block.type).toBe('error');
      if (block.type === 'error') {
        expect(block.error_code).toBe('INTERNAL_ERROR');
      }
      expect(telemetry.failure_type).toBe('INTERNAL_ERROR');
      expectExactlyOneResponseInvariant();
    });
  });

  describe('generic unexpected error', () => {
    it('maps to UNHANDLED/INTERNAL_ERROR envelope', async () => {
      phaseState.narrate = { kind: 'throw' };
      const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-1');
      OlumiResponseSchema.parse(response);
      const block = response.blocks[0]!;
      expect(block.type).toBe('error');
      if (block.type === 'error') {
        expect(block.error_code).toBe('INTERNAL_ERROR');
      }
      expect(telemetry.failure_type).toBe('INTERNAL_ERROR');
      expectExactlyOneResponseInvariant();
    });
  });

  describe("response_emitted=false is impossible (addendum §2.1.9)", () => {
    const cases: Array<{ name: string; setup: () => void }> = [
      { name: 'success_direct_answer', setup: () => { /* default */ } },
      {
        name: 'success_clarify',
        setup: () => {
          phaseState.classify = { kind: 'success', output: '{"turn_class":"clarify"}' };
          phaseState.narrate = { kind: 'success', output: 'what are you deciding?' };
        },
      },
      {
        name: 'contamination',
        setup: () => {
          phaseState.narrate = { kind: 'success', output: '<x>y</x>contam' };
        },
      },
      {
        name: 'upstream_timeout_classify',
        setup: () => { phaseState.classify = { kind: 'upstream_timeout' }; },
      },
      {
        name: 'upstream_timeout_narrate',
        setup: () => { phaseState.narrate = { kind: 'upstream_timeout' }; },
      },
      {
        name: 'budget_exceeded',
        setup: () => {
          process.env.TURN_BUDGET_MS = '5';
          phaseState.classify = {
            kind: 'success',
            output: '{"turn_class":"direct_answer"}',
            delayMs: 200,
          };
        },
      },
      {
        name: 'empty_output',
        setup: () => { phaseState.narrate = { kind: 'success', output: '' }; },
      },
      {
        name: 'generic_throw',
        setup: () => { phaseState.narrate = { kind: 'throw' }; },
      },
      {
        name: 'classifier_schema_violation',
        setup: () => {
          phaseState.classify = { kind: 'success', output: 'not json' };
        },
      },
    ];

    it.each(cases)('every outcome emits response_emitted=true: $name', async ({ setup }) => {
      setup();
      const { telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-1');
      expect(telemetry.response_emitted).toBe(true);
      expectExactlyOneResponseInvariant();
    });
  });
});
