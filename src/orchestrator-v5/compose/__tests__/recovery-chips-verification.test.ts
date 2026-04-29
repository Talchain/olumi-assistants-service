/**
 * V5 recovery chips — verification of shipped Phase 1 behaviour.
 *
 * Brief tests:
 *  I  — TurnExecutor ⇒ UpstreamTimeoutError → friendly text + "Try again" chip,
 *       no action_type, message echoes previousUserMessage, error_code preserved.
 *  J1 — buildFailureResponse table-test for every InternalFailure value:
 *       suggested_actions.length >= 1 (DECISION_REVIEW_FAILED is NOT reachable
 *       through `recoveryFailureTypeFromInternal` — verified by code review of
 *       the translator at recovery-chips.ts:168-188 — so all InternalFailure
 *       values produce >= 1 chip on the failure-response path).
 *  J2 — TurnExecutor ⇒ HANDLER_INVOCATION_FAILED-equivalent (UpstreamHTTPError
 *       400 → maps to LLM_REQUEST_INVALID → HANDLER_ERROR recovery) → envelope
 *       carries chips, friendly assistant_text, error_code preserved.
 *
 * Mock pattern mirrors src/orchestrator-v5/__tests__/turn-executor-recovery-chips.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../../adapters/llm/types.js';
import { UpstreamHTTPError, UpstreamTimeoutError } from '../../../adapters/llm/errors.js';
import { FORBIDDEN_USER_TEXT_TERMS } from '../recovery-chips.js';
import { buildFailureResponse } from '../../failure-response.js';
import type { InternalFailure } from '../../types.js';

vi.mock('../../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({
      scope,
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../../turn-executor.js');

const PREVIOUS_USER_MESSAGE = 'Why does the leading option win?';

const BASE_PAYLOAD: MessageTurnPayload = {
  kind: 'message',
  source: 'composer',
  turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  message: PREVIOUS_USER_MESSAGE,
  turn_class: 'frame',
  stage: 'frame',
};

type ChatWithToolsMock = (
  args: ChatWithToolsArgs,
  opts: { requestId: string; timeoutMs?: number; signal?: AbortSignal },
) => Promise<ChatWithToolsResult>;

function mockRoutingAdapter(impl: ChatWithToolsMock) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(impl as never),
  };
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});
afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

function recoveryEvents(): Event[] {
  return events.filter((e) => e.event === 'v5.recovery_chip_served');
}

function expectNoForbiddenTerms(value: string, label: string): void {
  for (const term of FORBIDDEN_USER_TEXT_TERMS) {
    const re = new RegExp(`\\b${term}\\b`, 'i');
    expect(value, `${label} should not contain "${term}": ${value}`).not.toMatch(re);
  }
}

// ---------------------------------------------------------------------------
// Test I — UpstreamTimeoutError end-to-end
// ---------------------------------------------------------------------------

describe('Test I — TurnExecutor: LLM_TIMEOUT recovery chip end-to-end', () => {
  it('emits friendly text + single Try-again chip + preserved error_code + telemetry', async () => {
    const routingAdapter = mockRoutingAdapter(async () => {
      throw new UpstreamTimeoutError('read timeout', 'anthropic', 'chat', 'body', 5000);
    });

    const { response } = await runTurnExecutor(BASE_PAYLOAD, 'req-I', { routingAdapter });

    const parsed = OlumiResponseSchema.parse(response);

    // Friendly text override (recovery layer owns assistant_text).
    expect(parsed.assistant_text).toBe('That took longer than usual.');

    // Wire error_code preserved on blocks[0] (machine consumers).
    const errBlock = parsed.blocks[0];
    expect(errBlock?.type).toBe('error');
    if (errBlock?.type === 'error') {
      expect(errBlock.error_code).toBe('UPSTREAM_TIMEOUT');
    }

    // Single chip, prompt-style (no action_type), echoes previous user message.
    expect(parsed.suggested_actions).toHaveLength(1);
    expect(parsed.suggested_actions[0]?.label).toBe('Try again');
    expect(parsed.suggested_actions[0]?.action_type).toBeUndefined();
    expect(parsed.suggested_actions[0]?.message).toBe(PREVIOUS_USER_MESSAGE);

    // Forbidden terms sweep on assistant_text + chip labels.
    expectNoForbiddenTerms(parsed.assistant_text ?? '', 'assistant_text');
    for (const a of parsed.suggested_actions) expectNoForbiddenTerms(a.label, 'chip.label');

    // Telemetry: exactly one v5.recovery_chip_served, mapped to LLM_TIMEOUT.
    const events = recoveryEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.data.failure_type).toBe('LLM_TIMEOUT');
    expect(events[0]!.data.chip_labels).toEqual(['Try again']);
    expect(events[0]!.data.is_retry).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test J1 — buildFailureResponse table coverage of all InternalFailure values
// ---------------------------------------------------------------------------

const ALL_INTERNAL_FAILURES: readonly InternalFailure[] = [
  'LLM_TIMEOUT',
  'LLM_SCHEMA_VIOLATION',
  'LLM_REQUEST_INVALID',
  'LLM_RATE_LIMITED',
  'BUDGET_EXCEEDED',
  'STATE_COMMIT_FAILED',
  'HANDLER_INVOCATION_FAILED',
  'HANDLER_RESULT_INVALID',
  'UNHANDLED',
  'UNSUPPORTED_ACTION',
];

describe('Test J1 — buildFailureResponse: every InternalFailure produces >= 1 chip', () => {
  for (const internal of ALL_INTERNAL_FAILURES) {
    it(`${internal} → suggested_actions.length >= 1, no forbidden terms, telemetry fires once`, () => {
      const response = buildFailureResponse(
        internal,
        'frame',
        undefined,
        {
          previousUserMessage: PREVIOUS_USER_MESSAGE,
          analysisReady: false,
          scenarioId: 'scn-J1',
          turnId: 'turn-J1',
          isRetry: false,
          handlerId: null,
        },
      );

      // Chip count invariant — DECISION_REVIEW_FAILED (the only zero-chip recovery
      // type) is unreachable via recoveryFailureTypeFromInternal, so every
      // InternalFailure produces at least one chip.
      expect(response.suggested_actions.length).toBeGreaterThanOrEqual(1);

      // Wire code preserved.
      const errBlock = response.blocks[0];
      expect(errBlock?.type).toBe('error');

      // No forbidden user-facing terms in assistant_text or chip labels.
      expectNoForbiddenTerms(response.assistant_text ?? '', `${internal}: assistant_text`);
      for (const a of response.suggested_actions) {
        expectNoForbiddenTerms(a.label, `${internal}: chip.label`);
      }

      // Telemetry fires exactly once per buildFailureResponse call.
      expect(recoveryEvents()).toHaveLength(1);
    });
  }

  it('schema_repair_failed cause refines LLM_SCHEMA_VIOLATION → ZOD_REPAIR_FAILED', () => {
    const response = buildFailureResponse(
      'LLM_SCHEMA_VIOLATION',
      'frame',
      { routing_error_cause: 'schema_repair_failed' },
      {
        previousUserMessage: PREVIOUS_USER_MESSAGE,
        analysisReady: false,
        scenarioId: 'scn-J1b',
        turnId: 'turn-J1b',
        isRetry: false,
        handlerId: null,
      },
    );

    expect(response.assistant_text).toBe("I couldn't structure that response correctly.");
    expect(response.suggested_actions).toHaveLength(1);
    expect(response.suggested_actions[0]?.label).toBe('Try again');

    const ev = recoveryEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]!.data.failure_type).toBe('ZOD_REPAIR_FAILED');
  });
});

// ---------------------------------------------------------------------------
// Test J2 — TurnExecutor with a router 400 (LLM_REQUEST_INVALID → HANDLER_ERROR)
// ---------------------------------------------------------------------------

describe('Test J2 — TurnExecutor: handler-error-class failure carries chips + preserves error_code', () => {
  it('UpstreamHTTPError(400) → friendly text + Try again chip + INTERNAL_ERROR wire code', async () => {
    const routingAdapter = mockRoutingAdapter(async () => {
      throw new UpstreamHTTPError('bad request', 'anthropic', 400, 'bad_request', 'rid', 100);
    });

    const { response } = await runTurnExecutor(BASE_PAYLOAD, 'req-J2', { routingAdapter });

    const parsed = OlumiResponseSchema.parse(response);

    // Recovery type for LLM_REQUEST_INVALID is HANDLER_ERROR — text matches.
    expect(parsed.assistant_text).toBe("I couldn't complete that step.");

    // Single retry chip, no action_type.
    expect(parsed.suggested_actions).toHaveLength(1);
    expect(parsed.suggested_actions[0]?.label).toBe('Try again');
    expect(parsed.suggested_actions[0]?.action_type).toBeUndefined();
    expect(parsed.suggested_actions[0]?.message).toBe(PREVIOUS_USER_MESSAGE);

    // Wire error_code preserved (LLM_REQUEST_INVALID maps to INTERNAL_ERROR).
    const errBlock = parsed.blocks[0];
    expect(errBlock?.type).toBe('error');
    if (errBlock?.type === 'error') {
      expect(errBlock.error_code).toBe('INTERNAL_ERROR');
    }

    // Forbidden terms sweep.
    expectNoForbiddenTerms(parsed.assistant_text ?? '', 'assistant_text');
    for (const a of parsed.suggested_actions) expectNoForbiddenTerms(a.label, 'chip.label');

    // Telemetry mapping.
    const ev = recoveryEvents();
    expect(ev).toHaveLength(1);
    expect(ev[0]!.data.failure_type).toBe('HANDLER_ERROR');
  });
});
