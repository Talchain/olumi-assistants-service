/**
 * V5 alpha hardening follow-up (P1-2 / improvement 2) — validation-log
 * privacy regression.
 *
 * Principle 3 of the resilience contract forbids user decision text in
 * logs. The raw `ValidationError.details` payload previously landed in
 * the pino log at turn-executor.ts unchanged — it carries user-authored
 * labels (candidate labels, entity_label, proposed_label) and free-text
 * parameter values. This test bakes a distinctive label into the graph,
 * drives a validator rejection that would have surfaced that label in
 * `details.candidates[].label`, and asserts the label does NOT appear
 * anywhere in any captured log call.
 *
 * Covers: ENTITY_RESOLUTION_SUSPICIOUS (both chosen + closer_candidate
 * labels are dropped), ENTITY_RESOLUTION_AMBIGUOUS (candidate labels →
 * only count retained), and ENTITY_NOT_FOUND (entity_label dropped).
 */

import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeMessagePayload } from './fixtures.js';

import { log, setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import { UpstreamHTTPError } from '../../adapters/llm/errors.js';

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const SCENARIO_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const BASE_PAYLOAD = makeMessagePayload({
  turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scenario_id: SCENARIO_ID,
  message: 'run the analysis',
  turn_class: 'decide',
  stage: 'analyse',
});

// Distinctive strings that must NEVER appear in any log call. These
// stand in for real user-authored decision content — if they leak, a
// real user's labels would too.
const SECRET_LABEL_CHOSEN = 'Acquire-ShadowCo-for-50M-USD';
const SECRET_LABEL_CLOSER = 'Acquire-ShadowCo-for-50M-USD-NOW';
const SECRET_LABEL_MISSING = 'top-secret-option-that-does-not-exist';
const SECRET_LABEL_CANDIDATE_A = 'poison-candidate-alpha';
const SECRET_LABEL_CANDIDATE_B = 'poison-candidate-beta';

function mkToolUseResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    {
      type: 'tool_use',
      id: 'tu-1',
      name: OLUMI_ACTION_TOOL_NAME,
      input: input as Record<string, unknown>,
    },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 42,
  };
}

function mockAdapter(input: unknown) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValue(mkToolUseResult(input)),
  };
}

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;
let debugSpy: ReturnType<typeof vi.spyOn>;

function allLogPayloads(): string {
  // Concatenate every log call's first argument (the structured payload)
  // plus the second argument (the message string) into one stringified
  // blob so a single .toContain assertion covers every sink.
  const allCalls: unknown[][] = [
    ...warnSpy.mock.calls,
    ...errorSpy.mock.calls,
    ...infoSpy.mock.calls,
    ...debugSpy.mock.calls,
  ];
  return JSON.stringify(allCalls);
}

beforeEach(() => {
  setTestSink(() => {}); // drain telemetry sink
  warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
  infoSpy = vi.spyOn(log, 'info').mockImplementation(() => {});
  debugSpy = vi.spyOn(log, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  setTestSink(null);
  warnSpy.mockRestore();
  errorSpy.mockRestore();
  infoSpy.mockRestore();
  debugSpy.mockRestore();
  vi.restoreAllMocks();
});

describe('TurnExecutor — validator-log privacy (P1-2)', () => {
  it('ENTITY_RESOLUTION_SUSPICIOUS: neither chosen nor closer-candidate label leaks into any log', async () => {
    // Graph with two options whose labels are the secret strings. The
    // suspicious-label check fires on label_match resolutions with a
    // Dice delta ≥ 0.15; picking a user phrasing that favours the
    // closer candidate triggers the branch.
    const graph: GraphStateIngress = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Profit' },
        { id: 'opt_chosen', kind: 'option', label: SECRET_LABEL_CHOSEN },
        { id: 'opt_closer', kind: 'option', label: SECRET_LABEL_CLOSER },
      ],
      edges: [],
      options: [
        { id: 'opt_chosen', status: 'ready', interventions: { f1: { value: 1 } } },
        { id: 'opt_closer', status: 'ready', interventions: { f1: { value: 0 } } },
      ],
    } as GraphStateIngress;

    const adapter = mockAdapter({
      intent_class: 'execute',
      action: {
        handler_id: 'run_analysis',
        entity: {
          id: 'opt_chosen',
          kind: 'option',
          resolution_status: 'resolved',
          resolution_method: 'label_match',
          label: `${SECRET_LABEL_CHOSEN}-NOW`,
        },
        parameters: [],
        cited_context_fields: [],
      },
    });

    await runTurnExecutor(BASE_PAYLOAD, 'req-privacy-susp', {
      routingAdapter: adapter,
      graphState: graph,
    });

    const payloads = allLogPayloads();
    // The labels must not appear anywhere — not in the warn payload's
    // details, not in a composer log, not in a message string.
    expect(payloads).not.toContain(SECRET_LABEL_CHOSEN);
    expect(payloads).not.toContain(SECRET_LABEL_CLOSER);
  });

  it('ENTITY_RESOLUTION_AMBIGUOUS: candidate labels dropped, only count retained', async () => {
    const adapter = mockAdapter({
      intent_class: 'execute',
      action: {
        handler_id: 'run_analysis',
        entity: {
          id: 'opt_a',
          kind: 'option',
          resolution_status: 'ambiguous',
          resolution_method: 'label_match',
          candidates: [
            { id: 'opt_a', label: SECRET_LABEL_CANDIDATE_A },
            { id: 'opt_b', label: SECRET_LABEL_CANDIDATE_B },
          ],
        },
        parameters: [],
        cited_context_fields: [],
      },
    });

    await runTurnExecutor(BASE_PAYLOAD, 'req-privacy-amb', {
      routingAdapter: adapter,
    });

    const payloads = allLogPayloads();
    expect(payloads).not.toContain(SECRET_LABEL_CANDIDATE_A);
    expect(payloads).not.toContain(SECRET_LABEL_CANDIDATE_B);
    // Positive assertion: the count field DID land — log queries can
    // still reason about candidate cardinality without exposing labels.
    const warnCalls = warnSpy.mock.calls.filter((c) => {
      const msg = typeof c[1] === 'string' ? c[1] : '';
      return msg.includes('validation rejected');
    });
    expect(warnCalls.length).toBeGreaterThan(0);
    const payload = warnCalls[0]![0] as Record<string, unknown>;
    const safe = payload.safe_details as Record<string, unknown>;
    expect(safe.candidate_count).toBe(2);
  });

  it('ENTITY_NOT_FOUND: entity_label dropped from log', async () => {
    const graph: GraphStateIngress = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Profit' },
        { id: 'opt_a', kind: 'option', label: 'Existing option' },
      ],
      edges: [],
      options: [{ id: 'opt_a', status: 'ready', interventions: { f1: { value: 1 } } }],
    } as GraphStateIngress;

    const adapter = mockAdapter({
      intent_class: 'execute',
      action: {
        handler_id: 'run_analysis',
        entity: {
          id: 'opt_does_not_exist',
          kind: 'option',
          resolution_status: 'resolved',
          resolution_method: 'id_match',
          label: SECRET_LABEL_MISSING,
        },
        parameters: [],
        cited_context_fields: [],
      },
    });

    await runTurnExecutor(BASE_PAYLOAD, 'req-privacy-enf', {
      routingAdapter: adapter,
      graphState: graph,
    });

    const payloads = allLogPayloads();
    expect(payloads).not.toContain(SECRET_LABEL_MISSING);
  });

  it('safe_details retains code-token fields that are NOT user prose', async () => {
    // Positive complement to the redaction tests above: the whitelist
    // must NOT over-redact. handler_id, entity_kind, resolution_status,
    // reason (when it's a code token like no_options_defined) are all
    // safe to log and enable log-query filtering.
    const graph: GraphStateIngress = {
      nodes: [{ id: 'goal_1', kind: 'goal', label: 'Profit' }],
      edges: [],
    } as GraphStateIngress;

    const adapter = mockAdapter({
      intent_class: 'execute',
      action: {
        handler_id: 'run_analysis',
        entity: {
          id: 'goal_1',
          kind: 'goal',
          resolution_status: 'resolved',
          resolution_method: 'id_match',
          label: 'Profit',
        },
        parameters: [],
        cited_context_fields: [],
      },
    });

    await runTurnExecutor(BASE_PAYLOAD, 'req-privacy-precond', {
      routingAdapter: adapter,
      graphState: graph,
    });

    const warnCalls = warnSpy.mock.calls.filter((c) => {
      const msg = typeof c[1] === 'string' ? c[1] : '';
      return msg.includes('validation rejected');
    });
    expect(warnCalls.length).toBeGreaterThan(0);
    const payload = warnCalls[0]![0] as Record<string, unknown>;
    const safe = payload.safe_details as Record<string, unknown>;
    // PRECONDITION_UNMET's reason is a handler-supplied code token.
    expect(safe.reason).toBe('no_options_defined');
    expect(safe.handler_id).toBe('run_analysis');
    // Raw details fields that COULD carry user prose are absent.
    expect(safe).not.toHaveProperty('entity_label');
    expect(safe).not.toHaveProperty('proposed_label');
    expect(safe).not.toHaveProperty('actual_value');
    expect(safe).not.toHaveProperty('candidates');
  });
});

// ---------------------------------------------------------------------------
// R-004: provider_message redaction on routing api_error
// ---------------------------------------------------------------------------

describe('TurnExecutor — provider_message redaction (R-004)', () => {
  it('logs provider_message_hash + provider_error_class; raw provider_message is absent', async () => {
    // Distinctive provider error string standing in for a real upstream
    // message that could echo prompt content (e.g. "tools.0.custom: ...
    // user-text-leaked-here ..."). If it appears anywhere in the log
    // payloads, the redaction has regressed.
    const SECRET_PROVIDER_MESSAGE =
      'tools.0.custom: leaked-user-decision-text-launch-product-now-at-50M';
    const expectedHash = createHash('sha256').update(SECRET_PROVIDER_MESSAGE).digest('hex').slice(0, 12);

    const routingAdapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
        .mockRejectedValue(
          new UpstreamHTTPError(
            SECRET_PROVIDER_MESSAGE,
            'anthropic',
            400,
            'invalid_request_error',
            'req-upstream-id',
            10,
          ),
        ),
    };

    await runTurnExecutor(BASE_PAYLOAD, 'req-provider-redaction', { routingAdapter });

    const payloads = allLogPayloads();

    // The raw provider_message string MUST NOT appear in any captured log
    // call (warn / error / info / debug payloads or message strings).
    expect(payloads).not.toContain(SECRET_PROVIDER_MESSAGE);
    expect(payloads).not.toContain('leaked-user-decision-text');

    // The redaction is observable: the api_error warn payload must carry
    // the truncated sha256 hash of the provider message and the typed
    // error class, so on-call still has correlation handles.
    const apiErrorWarn = warnSpy.mock.calls.find((c) => {
      const msg = typeof c[1] === 'string' ? c[1] : '';
      return msg.includes('routing api_error');
    });
    expect(apiErrorWarn).toBeDefined();
    const payload = apiErrorWarn![0] as Record<string, unknown>;
    expect(payload.provider_message_hash).toBe(expectedHash);
    expect(payload.provider_error_class).toBe('api_error');
    expect(payload.provider_status).toBe(400);
    // Negative: legacy raw field must be gone.
    expect(payload).not.toHaveProperty('provider_message');
  });
});
