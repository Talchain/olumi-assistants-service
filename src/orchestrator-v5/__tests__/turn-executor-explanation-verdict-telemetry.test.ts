/**
 * CEE hygiene batch — FIX 1: `v5.explanation.answer_verdict` telemetry for
 * `forbidden_internal_term` verdicts was previously unauditable (length +
 * error code only, never WHAT internal-machinery term was flagged).
 *
 * This test drives a full `runTurnExecutor` turn where Sonnet's
 * `explanation.answer_text` trips the forbidden-internal-term rule, and
 * asserts the emitted `v5.explanation.answer_verdict` event carries the
 * matched term — WITHOUT leaking the surrounding user-authored
 * decision-graph content the model wove its prose around (Principle 3 /
 * `turn-executor-validator-log-privacy.test.ts`: no user decision text in
 * logs).
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { makeMessagePayload } from './fixtures.js';
import { setTestSink } from '../../utils/telemetry.js';
import { buildD1Fixture } from '../tools/handlers/d1-shared/__tests__/fixtures.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const TEST_SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const BASE_PAYLOAD = makeMessagePayload({
  turn_id: 'ffffffff-eeee-4eee-8eee-ffffffffffff',
  scenario_id: TEST_SCENARIO_ID,
  message: 'Tell me about the model',
  turn_class: 'decide',
  stage: 'analyse',
});

// Same carrier text as the validator-explanation unit test (verified there
// to trip `forbidden_internal_term` on "edge" ahead of any other rule).
// "Engineering Capacity" / "Throughput" stand in for real user-authored
// decision-graph entity labels — the assertions below prove neither
// leaks into telemetry even though they sit either side of the match.
const FORBIDDEN_TERM_ANSWER_TEXT =
  'Looking at the strongest edge in the graph, Engineering Capacity drives Throughput at 0.65 strength.';

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
    latencyMs: 50,
  };
}

function mockRoutingAdapter(
  impl: (args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>,
) {
  return { chatWithTools: vi.fn(impl as never) };
}

let events: Array<{ event: string; data: Record<string, unknown> }> = [];

beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('v5.explanation.answer_verdict — forbidden_term_matched auditability (FIX 1)', () => {
  it('carries the matched internal term, and never the user-authored labels either side of it', async () => {
    const graph = buildD1Fixture();
    const explanationToolCall = {
      intent_class: 'execute',
      action: {
        handler_id: 'explain_from_structure',
        entity: {
          id: 'g-revenue',
          kind: 'goal',
          resolution_status: 'resolved',
          resolution_method: 'id_match',
        },
        parameters: [],
        cited_context_fields: ['graph.nodes'],
        explanation: { answer_text: FORBIDDEN_TERM_ANSWER_TEXT },
      },
    };

    const routingAdapter = mockRoutingAdapter(async () => mkToolUseResult(explanationToolCall));

    await runTurnExecutor(BASE_PAYLOAD, 'req-verdict-telemetry', {
      routingAdapter,
      graphState: graph,
    });

    const verdictEvt = events.find((e) => e.event === 'v5.explanation.answer_verdict');
    expect(verdictEvt).toBeDefined();
    expect(verdictEvt!.data.answer_validation_error).toBe('forbidden_internal_term');
    expect(verdictEvt!.data.forbidden_term_matched).toBe('edge');

    // PII-safety: the event must not carry the user-authored entity
    // labels the model's prose was wrapped around, nor the raw
    // answer_text itself (only its length is telemetered).
    const serialisedEvent = JSON.stringify(verdictEvt!.data);
    expect(serialisedEvent).not.toContain('Engineering Capacity');
    expect(serialisedEvent).not.toContain('Throughput');
    expect(serialisedEvent).not.toContain(FORBIDDEN_TERM_ANSWER_TEXT);
    expect(Object.keys(verdictEvt!.data)).not.toContain('answer_text');
  });

  it('emits forbidden_term_matched: null on a valid (non-rejected) verdict', async () => {
    const graph = buildD1Fixture();
    const explanationToolCall = {
      intent_class: 'execute',
      action: {
        handler_id: 'explain_from_structure',
        entity: {
          id: 'g-revenue',
          kind: 'goal',
          resolution_status: 'resolved',
          resolution_method: 'id_match',
        },
        parameters: [],
        cited_context_fields: ['graph.nodes'],
        explanation: {
          answer_text:
            'Revenue is most influenced by product quality, which carries the strongest positive relationship in the model overall.',
        },
      },
    };

    const routingAdapter = mockRoutingAdapter(async () => mkToolUseResult(explanationToolCall));

    await runTurnExecutor(BASE_PAYLOAD, 'req-verdict-telemetry-valid', {
      routingAdapter,
      graphState: graph,
    });

    const verdictEvt = events.find((e) => e.event === 'v5.explanation.answer_verdict');
    expect(verdictEvt).toBeDefined();
    expect(verdictEvt!.data.answer_text_valid).toBe(true);
    expect(verdictEvt!.data.forbidden_term_matched).toBeNull();
  });
});
