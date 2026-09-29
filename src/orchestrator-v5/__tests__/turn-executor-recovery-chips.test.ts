/**
 * V5 TurnExecutor — recovery chips on the egress safety layer.
 *
 * Asserts that every internal failure routed through buildFailureResponse
 * (the audit's §6.1 P0 hot spot) now produces an actionable chip with
 * friendly assistant_text, while the wire `error_code` is preserved for
 * machine consumers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { V5_ROUTING_MAX_OUTPUT_TOKENS, V5_ROUTING_MAX_OUTPUT_TOKENS_RETRY } from '../routing/route-with-tool-use.js';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink, log } from '../../utils/telemetry.js';
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
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
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

  it('schema_repair_failed (router cause) — bounded fallback to 200 direct_answer (V5 P0)', async () => {
    // V5 P0 stabilisation: model-output failures (schema_repair_failed /
    // empty_response / unexpected_stop_reason) used to surface as a 500
    // BoundaryError. They now degrade to a deterministic direct_answer
    // envelope so the user's session and prior analysis survive. The
    // assistant_text differs from the legacy recovery-chip wording, no
    // error block is emitted, and chips are conditional on freshness
    // (none here — fresh-frame turn has no prior analysis).
    const routingAdapter = mockRoutingAdapter(
      vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkToolUseResult({ intent_class: 'execute' }))
        .mockResolvedValueOnce(mkToolUseResult({ intent_class: 'clarify' })) as unknown as ChatWithToolsMock,
    );

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-rt5', {
      routingAdapter,
    });

    const parsed = OlumiResponseSchema.parse(response);
    expect(parsed.assistant_text).toBe(
      "I couldn't complete that turn cleanly. Try again, or rephrase what you'd like to do.",
    );
    // No analysis in the fresh-frame fixture → no action chips.
    expect(parsed.suggested_actions).toHaveLength(0);
    // No error block — the turn is a successful direct_answer envelope.
    expect(parsed.blocks.some((b) => b.type === 'error')).toBe(false);
    // Telemetry still records the underlying cause for ops dashboards.
    expect(telemetry.failure_type).toBe('LLM_UNAVAILABLE');
    expect(telemetry.commit_performed).toBe(true);

    const bf = events.find((e) => e.event === 'v5.routing_bounded_fallback');
    expect(bf).toBeDefined();
    expect(bf!.data.routing_error_cause).toBe('schema_repair_failed');
    expect(bf!.data.analysis_ready).toBe(false);
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

  it('max_tokens on the first routing call — ONE retry at the escalated budget (V5_ROUTING_MAX_OUTPUT_TOKENS_RETRY) rescues the turn (prompt-workstream fix)', async () => {
    // Live evidence (2026-07-08 staging-parity runs): ~4-5% of routing
    // calls die with stop_reason === 'max_tokens' at the first-attempt cap
    // (a failed call burned exactly that many completion tokens) and each
    // one shipped the bounded-fallback apology. The fix keeps the
    // V5_ROUTING_MAX_OUTPUT_TOKENS first attempt and, on max_tokens,
    // retries ONCE with maxTokens V5_ROUTING_MAX_OUTPUT_TOKENS_RETRY —
    // same messages, same tools. Asserts: two adapter calls with the
    // escalated budget, identical messages/tools, turn succeeds as a
    // normal text_only converse (no bounded fallback, no error block),
    // and the retry is observable via the plain pino event
    // 'v5.routing.max_tokens_retry' with attempt latency + token counts.
    const logInfoSpy = vi.spyOn(log, 'info');
    const adapterMock = vi
      .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Partial answer cut off at...' }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 10, output_tokens: V5_ROUTING_MAX_OUTPUT_TOKENS } as unknown as ChatWithToolsResult['usage'],
        model: 'claude-sonnet-4-6',
        latencyMs: 200,
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Here is the full answer to your question.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 90 } as unknown as ChatWithToolsResult['usage'],
        model: 'claude-sonnet-4-6',
        latencyMs: 150,
      });
    const routingAdapter = mockRoutingAdapter(adapterMock as unknown as ChatWithToolsMock);

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-max-tokens-retry', {
      routingAdapter,
    });

    expect(adapterMock).toHaveBeenCalledTimes(2);
    const firstArgs = adapterMock.mock.calls[0]![0];
    const retryArgs = adapterMock.mock.calls[1]![0];
    expect(firstArgs.maxTokens).toBe(V5_ROUTING_MAX_OUTPUT_TOKENS);
    expect(retryArgs.maxTokens).toBe(V5_ROUTING_MAX_OUTPUT_TOKENS_RETRY);
    // Same messages, same tools — only the output budget changes.
    expect(retryArgs.messages).toEqual(firstArgs.messages);
    expect(retryArgs.tools).toEqual(firstArgs.tools);

    const parsed = OlumiResponseSchema.parse(response);
    expect(parsed.blocks.some((b) => b.type === 'error')).toBe(false);
    expect(parsed.assistant_text).toContain('Here is the full answer');
    expect(telemetry.failure_type).toBeNull();
    expect(telemetry.commit_performed).toBe(true);
    expect(events.find((e) => e.event === 'v5.routing_bounded_fallback')).toBeUndefined();

    // Retry observability: plain pino event-string pattern, NOT a new
    // TelemetryEvents registry member.
    const retryLog = logInfoSpy.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>)?.event === 'v5.routing.max_tokens_retry',
    );
    expect(retryLog).toBeDefined();
    const retryPayload = retryLog![0] as Record<string, unknown>;
    expect(retryPayload.request_id).toBe('req-max-tokens-retry');
    expect(retryPayload.first_attempt_latency_ms).toBe(200);
    expect(retryPayload.first_attempt_input_tokens).toBe(10);
    expect(retryPayload.first_attempt_output_tokens).toBe(V5_ROUTING_MAX_OUTPUT_TOKENS);
    expect(retryPayload.first_attempt_max_tokens).toBe(V5_ROUTING_MAX_OUTPUT_TOKENS);
    expect(retryPayload.retry_max_tokens).toBe(V5_ROUTING_MAX_OUTPUT_TOKENS_RETRY);
  });

  it('max_tokens on BOTH routing calls — bounded fallback 200, no further retry (V5 P0 review-P2)', async () => {
    // When the escalated-budget retry ALSO ends max_tokens, we fall through to the
    // pre-existing error path unchanged: `tryInterpret` classifies it as
    // non_repairable `unexpected_stop_reason` → bounded fallback to a
    // 200 direct_answer envelope. Asserts: exactly two adapter calls
    // (one retry, no REPAIR_ONCE), no error block, fallback copy,
    // fallback telemetry, and the underlying failure cause preserved.
    const adapterMock = vi
      .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
      .mockResolvedValue({
        content: [{ type: 'text', text: 'Partial answer cut off at...' }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 10, output_tokens: 2048 } as unknown as ChatWithToolsResult['usage'],
        model: 'claude-sonnet-4-6',
        latencyMs: 200,
      });
    const routingAdapter = mockRoutingAdapter(adapterMock as unknown as ChatWithToolsMock);

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-max-tokens', {
      routingAdapter,
    });

    expect(adapterMock).toHaveBeenCalledTimes(2);

    const parsed = OlumiResponseSchema.parse(response);
    expect(parsed.blocks.some((b) => b.type === 'error')).toBe(false);
    expect(parsed.assistant_text).toContain("I couldn't complete that turn cleanly");
    expect(telemetry.failure_type).toBe('LLM_UNAVAILABLE');
    expect(telemetry.commit_performed).toBe(true);

    const bf = events.find((e) => e.event === 'v5.routing_bounded_fallback');
    expect(bf).toBeDefined();
    expect(bf!.data.routing_error_cause).toBe('unexpected_stop_reason');
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
