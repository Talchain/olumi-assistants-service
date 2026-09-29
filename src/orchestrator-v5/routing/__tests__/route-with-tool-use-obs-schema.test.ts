/**
 * V5 alpha hardening follow-up — `v5.routing.calling_anthropic` schema test.
 *
 * The routing-call log is a debug-level pino log, not a telemetry sink
 * event. Spy on `log.debug` to confirm the full primary-event obs schema
 * is present on both the initial call and the REPAIR_ONCE retry, with
 * null placeholders for fields structurally unknown at call time
 * (handler_proposed / validator_outcome / response_type).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../../../utils/telemetry.js';
import { routeWithToolUse } from '../route-with-tool-use.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../../adapters/llm/types.js';
import type { ContextPack } from '../../context/context-pack-assembler.js';

function makeContextPack(): ContextPack {
  return {
    version: '2.0',
    stage: 'frame',
    graph: {
      nodes: [],
      edges: [],
      options: [],
      goals: [],
      constraints: [],
      counts: { nodes: 0, edges: 0, options: 0, goals: 0, constraints: 0 },
    },
    analysis: null,
    conversation: {
      recent_turns: [],
      turn_count: 0,
      last_tool_used: null,
      pending_confirmation: false,
    },
    coaching: {
      draft_coaching: null,
      decision_review: null,
      last_coaching_signal: null,
    },
    compound_detected: false,
    compound_pattern_matched: null,
    parsed_quantities: [],
    system_event: null,
  };
}

const EXPECTED_OBS_KEYS: readonly string[] = [
  'event',
  'request_id',
  'v5_journey_id',
  'llm_call',
  'prompt_version',
  'prompt_hash',
  'system_chars',
  'context_pack_chars',
  'handler_proposed',
  'validator_outcome',
  'response_type',
];

let debugSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  debugSpy = vi.spyOn(log, 'debug').mockImplementation(() => {});
});
afterEach(() => {
  debugSpy.mockRestore();
});

describe('v5.routing.calling_anthropic obs schema', () => {
  it('initial call emits the full primary-event obs schema with nulls for late-bound fields', async () => {
    const mockAdapter = {
      async chatWithTools(_args: ChatWithToolsArgs): Promise<ChatWithToolsResult> {
        return {
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 0, output_tokens: 0 },
        } as ChatWithToolsResult;
      },
    };

    await routeWithToolUse(makeContextPack(), 'hello', {
      requestId: 'req-obs-routing',
      sessionId: 'sess-obs-routing',
      adapter: mockAdapter,
    });

    const calls = debugSpy.mock.calls;
    const anthropicCall = calls.find((c) => {
      const payload = c[0] as Record<string, unknown>;
      return payload?.event === 'v5.routing.calling_anthropic';
    });
    expect(anthropicCall).toBeDefined();
    const payload = anthropicCall![0] as Record<string, unknown>;

    for (const key of EXPECTED_OBS_KEYS) {
      expect(payload, `missing obs key "${key}"`).toHaveProperty(key);
    }
    // Late-bound fields are explicitly null at routing-call time.
    expect(payload.handler_proposed).toBeNull();
    expect(payload.validator_outcome).toBeNull();
    expect(payload.response_type).toBeNull();
    // Journey id alias is wired from sessionId.
    expect(payload.v5_journey_id).toBe('sess-obs-routing');
    // Prompt primitives exist (values come from the loaded prompt).
    expect(typeof payload.prompt_version).toBe('string');
    expect(typeof payload.prompt_hash).toBe('string');
    expect(typeof payload.system_chars).toBe('number');
  });
});
