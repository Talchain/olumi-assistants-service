/**
 * V5 TurnExecutor — recovery chips on the egress safety layer.
 *
 * Asserts that every internal failure routed through buildFailureResponse
 * (the audit's §6.1 P0 hot spot) now produces an actionable chip with
 * friendly assistant_text, while the wire `error_code` is preserved for
 * machine consumers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../adapters/llm/types.js';
import { UpstreamHTTPError, UpstreamTimeoutError } from '../../adapters/llm/errors.js';
import { FORBIDDEN_USER_TEXT_TERMS } from '../compose/recovery-chips.js';

// ---------------------------------------------------------------------------
// Session store mock — no Supabase
// ---------------------------------------------------------------------------

vi.mock('../session/index.js', () => ({
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

const { runTurnExecutor } = await import('../turn-executor.js');

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

function installSink(): void {
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
}
function uninstallSink(): void {
  setTestSink(null);
}
function recoveryEvent(): Event | undefined {
  return events.find((e) => e.event === 'v5.recovery_chip_served');
}

function expectNoForbiddenTerms(value: string, label: string): void {
  for (const term of FORBIDDEN_USER_TEXT_TERMS) {
    const re = new RegExp(`\\b${term}\\b`, 'i');
    expect(value, `${label} should not contain "${term}": ${value}`).not.toMatch(re);
  }
}

beforeEach(() => {
  events = [];
  installSink();
});
afterEach(() => {
  uninstallSink();
  vi.restoreAllMocks();
});

describe('TurnExecutor recovery chips — egress safety layer', () => {
  it('LLM_TIMEOUT — friendly text + "Try again" prompt-style chip + preserved error_code', async () => {
    const routingAdapter = mockRoutingAdapter(async () => {
      throw new UpstreamTimeoutError('read timeout', 'anthropic', 'chat', 'body', 5000);
    });

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-rt1', {
      routingAdapter,
    });

    const parsed = OlumiResponseSchema.parse(response);

    // The brief's KEY assertion split: human-readable text overridden,
    // machine-readable error_code preserved.
    expect(parsed.assistant_text).toBe('That took longer than usual.');
    const errBlock = parsed.blocks[0];
    expect(errBlock?.type).toBe('error');
    if (errBlock?.type === 'error') {
      expect(errBlock.error_code).toBe('UPSTREAM_TIMEOUT');
    }

    expect(parsed.suggested_actions).toHaveLength(1);
    expect(parsed.suggested_actions[0]?.label).toBe('Try again');
    expect(parsed.suggested_actions[0]?.action_type).toBeUndefined();
    expect(parsed.suggested_actions[0]?.message).toBe(PREVIOUS_USER_MESSAGE);

    expect(telemetry.failure_type).toBe('UPSTREAM_TIMEOUT');

    const ev = recoveryEvent();
    expect(ev).toBeDefined();
    expect(ev!.data.failure_type).toBe('LLM_TIMEOUT');
    expect(ev!.data.chip_labels).toEqual(['Try again']);
    expect(ev!.data.is_retry).toBe(false);
  });

  it('LLM_UNAVAILABLE (429) — friendly text + retry chip', async () => {
    const routingAdapter = mockRoutingAdapter(async () => {
      throw new UpstreamHTTPError('rate limited', 'anthropic', 429, 'rate_limit', 'rid', 100);
    });

    const { response } = await runTurnExecutor(BASE_PAYLOAD, 'req-rt2', {
      routingAdapter,
    });

    const parsed = OlumiResponseSchema.parse(response);
    expect(parsed.assistant_text).toBe("I couldn't complete that just now.");
    expect(parsed.suggested_actions[0]?.label).toBe('Try again');
    expect(parsed.suggested_actions[0]?.action_type).toBeUndefined();
    expect(parsed.suggested_actions[0]?.message).toBe(PREVIOUS_USER_MESSAGE);

    const errBlock = parsed.blocks[0];
    if (errBlock?.type === 'error') {
      expect(errBlock.error_code).toBe('LLM_UNAVAILABLE');
    }
  });

  it('LLM_REQUEST_INVALID (400) — friendly text + retry chip', async () => {
    const routingAdapter = mockRoutingAdapter(async () => {
      throw new UpstreamHTTPError('bad request', 'anthropic', 400, 'bad_request', 'rid', 100);
    });

    const { response } = await runTurnExecutor(BASE_PAYLOAD, 'req-rt3', {
      routingAdapter,
    });

    const parsed = OlumiResponseSchema.parse(response);
    expect(parsed.assistant_text).toBe("I couldn't complete that step.");
    expect(parsed.suggested_actions[0]?.label).toBe('Try again');
    expect(parsed.suggested_actions[0]?.action_type).toBeUndefined();
  });

  it('LLM_SCHEMA_VIOLATION (5xx) — friendly text + retry chip', async () => {
    const routingAdapter = mockRoutingAdapter(async () => {
      throw new UpstreamHTTPError('server error', 'anthropic', 503, 'unavailable', 'rid', 100);
    });

    const { response } = await runTurnExecutor(BASE_PAYLOAD, 'req-rt4', {
      routingAdapter,
    });

    const parsed = OlumiResponseSchema.parse(response);
    // 5xx → LLM_SCHEMA_VIOLATION (no schema_repair_failed cause) → LLM_UNAVAILABLE recovery
    expect(parsed.assistant_text).toBe("I couldn't complete that just now.");
    expect(parsed.suggested_actions[0]?.label).toBe('Try again');
  });

  it('schema_repair_failed (router cause) — friendly text + retry chip', async () => {
    // Two bad tool-use responses → RoutingError(schema_repair_failed).
    const routingAdapter = mockRoutingAdapter(
      vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkToolUseResult({ intent_class: 'execute' }))
        .mockResolvedValueOnce(mkToolUseResult({ intent_class: 'clarify' })) as unknown as ChatWithToolsMock,
    );

    const { response } = await runTurnExecutor(BASE_PAYLOAD, 'req-rt5', {
      routingAdapter,
    });

    const parsed = OlumiResponseSchema.parse(response);
    expect(parsed.assistant_text).toBe("I couldn't structure that response correctly.");
    expect(parsed.suggested_actions[0]?.label).toBe('Try again');
    expect(parsed.suggested_actions[0]?.action_type).toBeUndefined();
    expect(parsed.suggested_actions[0]?.message).toBe(PREVIOUS_USER_MESSAGE);

    const ev = recoveryEvent();
    expect(ev).toBeDefined();
    expect(ev!.data.failure_type).toBe('ZOD_REPAIR_FAILED');
  });

  it('split-assertion: assistant_text is friendly preface AND blocks[0].error_code is wire code', async () => {
    // Dedicated test for the user-decided text override — both must be true
    // simultaneously so machine consumers (UI parser, dashboards) don't
    // regress while humans get the warmer copy.
    const routingAdapter = mockRoutingAdapter(async () => {
      throw new UpstreamTimeoutError('read timeout', 'anthropic', 'chat', 'body', 5000);
    });

    const { response } = await runTurnExecutor(BASE_PAYLOAD, 'req-split', {
      routingAdapter,
    });

    const parsed = OlumiResponseSchema.parse(response);
    expect(parsed.assistant_text).toBe('That took longer than usual.');
    const errBlock = parsed.blocks[0];
    expect(errBlock?.type).toBe('error');
    if (errBlock?.type === 'error') {
      expect(errBlock.error_code).toBe('UPSTREAM_TIMEOUT');
    }
  });

  it('no forbidden user-facing terms in any string of the failure envelope', async () => {
    const routingAdapter = mockRoutingAdapter(async () => {
      throw new UpstreamTimeoutError('read timeout', 'anthropic', 'chat', 'body', 5000);
    });

    const { response } = await runTurnExecutor(BASE_PAYLOAD, 'req-tone', {
      routingAdapter,
    });

    const parsed = OlumiResponseSchema.parse(response);
    expectNoForbiddenTerms(parsed.assistant_text, 'assistant_text');
    for (const action of parsed.suggested_actions) {
      expectNoForbiddenTerms(action.label, 'action.label');
      // action.message echoes the previous user message, which may legitimately
      // contain words like "option" — we only sweep for forbidden terms on the
      // chip label itself; previous-user-message echo is the user's own text.
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkToolUseResult(input: unknown): ChatWithToolsResult {
  return {
    content: [
      {
        type: 'tool_use',
        id: 'tu-1',
        name: 'olumi_action',
        input: input as Record<string, unknown>,
      },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}
