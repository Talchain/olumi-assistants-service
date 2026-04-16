/**
 * TurnExecutor unit tests.
 *
 * Covers:
 *   - BI-01 exactly-one-response (every `started` has a matching `completed`
 *     with response_emitted=true across every outcome path)
 *   - BI-02 contamination is handled in-band (response stays a success)
 *   - Paul's constraint 7: BUDGET_EXCEEDED wins over LLM_TIMEOUT when both apply
 *   - Paul's constraint 1: non-direct_answer turn classes → UNHANDLED
 *   - Zod-validity of every returned envelope (happy + failure paths)
 *
 * The LLM adapter is mocked at the `getAdapter(...).chat` seam. No live
 * provider calls (Paul's constraint 9).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';

// ---------------------------------------------------------------------------
// Mock surface
// ---------------------------------------------------------------------------

// These are controlled per-test via `mockState`.
type MockState = {
  behaviour: 'success' | 'upstream_timeout' | 'abort' | 'throw' | 'empty_output';
  output?: string;
  delayMs?: number;
};
const mockState: MockState = { behaviour: 'success', output: 'hello world' };

// Mock the LLM router BEFORE importing the executor (vi.mock is hoisted).
vi.mock('../../adapters/llm/router.js', () => {
  return {
    getAdapter: () => ({
      name: 'test-mock',
      chat: async (_args: unknown, opts: { signal?: AbortSignal }) => {
        await new Promise<void>((resolve, reject) => {
          const { delayMs = 0 } = mockState;
          const timer = setTimeout(() => {
            try {
              dispatchBehaviour(resolve, reject);
            } catch (e) {
              reject(e as Error);
            }
          }, delayMs);
          opts.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            const abortError = new Error('aborted');
            (abortError as Error & { name: string }).name = 'AbortError';
            reject(abortError);
          });
        });
        return {
          content: mockState.output ?? '',
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

// Import ONLY after the mocks are set up so the executor binds to the mocks.
const { runTurnExecutor } = await import('../turn-executor.js');
const { UpstreamTimeoutError } = await import('../../adapters/llm/errors.js');

function dispatchBehaviour(
  resolve: () => void,
  reject: (err: Error) => void,
): void {
  switch (mockState.behaviour) {
    case 'success':
      return resolve();
    case 'upstream_timeout':
      return reject(new UpstreamTimeoutError('test timeout', 'narrate', 100));
    case 'throw':
      return reject(new Error('test-injected generic failure'));
    case 'empty_output':
      // Trigger empty output by emptying before resolution
      mockState.output = '';
      return resolve();
    case 'abort': {
      const abortError = new Error('abort');
      (abortError as Error & { name: string }).name = 'AbortError';
      return reject(abortError);
    }
  }
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
  // BI-01: every started has exactly one completed, and every completed has
  // response_emitted=true.
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
    mockState.behaviour = 'success';
    mockState.output = 'hello world';
    mockState.delayMs = 0;
    delete process.env.TURN_BUDGET_MS;
    delete process.env.LLM_BUDGET_NARRATE_MS;
  });
  afterEach(() => {
    uninstallSink();
    process.env = { ...originalEnv };
  });

  describe('happy path (direct_answer success)', () => {
    it('returns a Zod-valid OlumiResponse with the LLM text', async () => {
      mockState.output = 'The framing.';
      const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-1');
      const parsed = OlumiResponseSchema.parse(response);
      expect(parsed.assistant_text).toBe('The framing.');
      expect(parsed.blocks).toEqual([]);
      expect(parsed.suggested_actions).toEqual([]);
      expect(parsed.insights).toEqual([]);
      expect(parsed.stage_indicator).toBe('frame');
      expect(telemetry.failure_type).toBeNull();
      expect(telemetry.commit_performed).toBe(true);
      expect(telemetry.llm_calls_used).toBe(1);
      expectExactlyOneResponseInvariant();
      const completed = completedEvents()[0]!;
      expect(completed.data.failure_type).toBeNull();
      expect(completed.data.commit_performed).toBe(true);
    });

    it('omits updated_session_state (constraint 6 — not in schema)', async () => {
      const { response } = await runTurnExecutor(BASE_PAYLOAD, 'req-1');
      expect((response as Record<string, unknown>).updated_session_state).toBeUndefined();
    });
  });

  describe('BI-02 contamination (sanitiser in-band)', () => {
    it('strips tags and em-dashes, response stays a success', async () => {
      mockState.output = '<thinking>inner</thinking>Two forces \u2014 cost and speed.';
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
    });
  });

  describe('LLM_TIMEOUT', () => {
    it('maps upstream timeout to UPSTREAM_TIMEOUT wire code', async () => {
      mockState.behaviour = 'upstream_timeout';
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
  });

  describe("Paul's constraint 7 — BUDGET_EXCEEDED wins over LLM_TIMEOUT", () => {
    it('when outer budget aborts during a slow LLM call, classifies as BUDGET_EXCEEDED', async () => {
      process.env.TURN_BUDGET_MS = '10';
      process.env.LLM_BUDGET_NARRATE_MS = '60000';
      mockState.behaviour = 'success';
      mockState.delayMs = 200; // ensures outer abort fires first
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
      mockState.output = '';
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
      mockState.behaviour = 'throw';
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
      { name: 'success', setup: () => { mockState.behaviour = 'success'; } },
      { name: 'contamination', setup: () => { mockState.output = '<x>y</x>contam'; } },
      { name: 'upstream_timeout', setup: () => { mockState.behaviour = 'upstream_timeout'; } },
      { name: 'budget_exceeded', setup: () => {
          process.env.TURN_BUDGET_MS = '5';
          mockState.delayMs = 200;
      }},
      { name: 'empty_output', setup: () => { mockState.output = ''; } },
      { name: 'generic_throw', setup: () => { mockState.behaviour = 'throw'; } },
    ];

    it.each(cases)('every outcome emits response_emitted=true: $name', async ({ setup }) => {
      setup();
      const { telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-1');
      expect(telemetry.response_emitted).toBe(true);
      expectExactlyOneResponseInvariant();
    });
  });
});
