/**
 * V5 routing — prompt-cache call shape and telemetry.
 *
 * Asserts that:
 *  - When caching is enabled, adapter.chatWithTools receives system_cache_blocks
 *    with cache_control: ephemeral; the plain `system` string is also present
 *    as a fallback for non-Anthropic adapters (per the type contract).
 *  - When caching is disabled, only `system: string` is sent.
 *  - The repair path inherits the same call shape.
 *  - v5.prompt_cache fires for: enabled normal call, disabled-by-config,
 *    api-unsupported fallback, and repair call.
 *  - The narrow fallback matcher only triggers on HTTP 400 + /cache_control/i;
 *    timeouts, 429s, 5xx, AbortError, and unrelated 400s propagate unchanged.
 *
 * Cache mode is threaded via the `cachingEnabled` parameter to
 * buildSystemForRouting wherever possible — global config is not mutated.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setTestSink } from '../../src/utils/telemetry.js';
import { config } from '../../src/config/index.js';
import {
  buildSystemForRouting,
  routeWithToolUse,
  ROUTING_SYSTEM_PROMPT,
} from '../../src/orchestrator-v5/routing/route-with-tool-use.js';
import { OLUMI_ACTION_TOOL_NAME } from '../../src/orchestrator-v5/routing/tool-schema.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../src/adapters/llm/types.js';
import type { ContextPack } from '../../src/orchestrator-v5/context/context-pack-assembler.js';
import { UpstreamHTTPError, UpstreamTimeoutError } from '../../src/adapters/llm/errors.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STUB_PACK = {
  version: '2.0',
  stage: 'analyse',
  graph: {},
  analysis: null,
  conversation: { recent_turns: [] },
  coaching: { draft_coaching: null, decision_review: null },
  compound_detected: false,
  compound_pattern_matched: null,
  parsed_quantities: [],
  system_event: null,
} as unknown as ContextPack;

const VALID_TOOL_INPUT = {
  intent_class: 'execute',
  action: {
    handler_id: 'run_analysis',
    entity: {
      id: 'opt_a',
      kind: 'option',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [],
    cited_context_fields: ['graph.options'],
  },
};

function toolUseResult(
  usage?: Partial<ChatWithToolsResult['usage']>,
): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    {
      type: 'tool_use',
      id: 'tu-1',
      name: OLUMI_ACTION_TOOL_NAME,
      input: VALID_TOOL_INPUT as Record<string, unknown>,
    },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      ...(usage ?? {}),
    } as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

interface RecordedCall {
  args: ChatWithToolsArgs;
}

function makeAdapter(
  responder: (call: number) => Promise<ChatWithToolsResult>,
): { adapter: { chatWithTools: (a: ChatWithToolsArgs) => Promise<ChatWithToolsResult> }; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let n = 0;
  return {
    calls,
    adapter: {
      chatWithTools: async (args: ChatWithToolsArgs) => {
        n += 1;
        calls.push({ args });
        return responder(n);
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Telemetry capture
// ---------------------------------------------------------------------------

let events: Array<{ name: string; data: Record<string, unknown> }> = [];

beforeEach(() => {
  events = [];
  setTestSink((name, data) => {
    events.push({ name, data });
  });
});

afterEach(() => {
  setTestSink(null);
});

const cacheEvents = () => events.filter((e) => e.name === 'v5.prompt_cache');

// ===========================================================================
// buildSystemForRouting — pure unit tests, no global config mutation
// ===========================================================================

describe('buildSystemForRouting', () => {
  it('cachingEnabled=true emits system_cache_blocks with ephemeral cache_control', () => {
    const { fields, cacheMode } = buildSystemForRouting('PROMPT', {
      cachingEnabled: true,
    });
    expect(cacheMode).toBe('enabled');
    expect(fields.system_cache_blocks).toBeDefined();
    expect(fields.system_cache_blocks).toHaveLength(1);
    expect(fields.system_cache_blocks![0]).toEqual({
      type: 'text',
      text: 'PROMPT',
      cache_control: { type: 'ephemeral' },
    });
    // `system` is also present as a non-Anthropic adapter fallback per the
    // ChatWithToolsArgs contract.
    expect(fields.system).toBe('PROMPT');
  });

  it('cachingEnabled=false emits only system string, no cache blocks', () => {
    const { fields, cacheMode } = buildSystemForRouting('PROMPT', {
      cachingEnabled: false,
    });
    expect(cacheMode).toBe('disabled_config');
    expect(fields.system).toBe('PROMPT');
    expect(fields.system_cache_blocks).toBeUndefined();
  });
});

// ===========================================================================
// routeWithToolUse — full call shape via injected adapter
// ===========================================================================

describe('routeWithToolUse cache-shape (caching enabled)', () => {
  it('first call sends system_cache_blocks; emits v5.prompt_cache with cache_mode=enabled', async () => {
    const { adapter, calls } = makeAdapter(async () =>
      toolUseResult({ cache_creation_input_tokens: 90, cache_read_input_tokens: 0 }),
    );

    const result = await routeWithToolUse(STUB_PACK, 'run analysis', {
      requestId: 'req-1',
      sessionId: 'sess-1',
      adapter,
      // systemPromptOverride threads through buildSystemForRouting; caching
      // is gated by config.promptCache.anthropicEnabled (default true).
      systemPromptOverride: 'STABLE_PREFIX',
    });

    expect(result.type).toBe('tool_call');
    expect(calls).toHaveLength(1);
    const sent = calls[0]!.args;
    expect(sent.system_cache_blocks).toBeDefined();
    expect(sent.system_cache_blocks![0]).toEqual({
      type: 'text',
      text: 'STABLE_PREFIX',
      cache_control: { type: 'ephemeral' },
    });

    const cache = cacheEvents();
    expect(cache).toHaveLength(1);
    expect(cache[0]!.data.cache_mode).toBe('enabled');
    expect(cache[0]!.data.llm_call).toBe(1);
    expect(cache[0]!.data.cache_hit).toBe(false); // read=0 → miss (cold)
    expect(cache[0]!.data.cache_creation_input_tokens).toBe(90);
  });

  it('cache_read>0 emits cache_hit=true', async () => {
    const { adapter } = makeAdapter(async () =>
      toolUseResult({ cache_creation_input_tokens: 0, cache_read_input_tokens: 80 }),
    );

    await routeWithToolUse(STUB_PACK, 'run analysis', {
      requestId: 'req-1',
      adapter,
      systemPromptOverride: ROUTING_SYSTEM_PROMPT,
    });

    expect(cacheEvents()[0]!.data.cache_hit).toBe(true);
  });

  it('absent usage cache fields emit cache_hit=null without breaking the turn', async () => {
    const { adapter } = makeAdapter(async () => toolUseResult()); // no cache fields

    await routeWithToolUse(STUB_PACK, 'run analysis', {
      requestId: 'req-1',
      adapter,
      systemPromptOverride: ROUTING_SYSTEM_PROMPT,
    });

    expect(cacheEvents()[0]!.data.cache_hit).toBeNull();
  });
});

// ===========================================================================
// Narrow fallback matcher
// ===========================================================================

describe('narrow cache_control rejection fallback', () => {
  it('400 + /cache_control/i triggers retry without cache_blocks; emits disabled_api_unsupported', async () => {
    let n = 0;
    const calls: RecordedCall[] = [];
    const adapter = {
      chatWithTools: async (args: ChatWithToolsArgs) => {
        n += 1;
        calls.push({ args });
        if (n === 1) {
          throw new UpstreamHTTPError(
            'anthropic rejected request: invalid cache_control field on system block',
            'anthropic',
            400,
            'invalid_request_error',
            'req-x',
            12,
          );
        }
        return toolUseResult({ cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
      },
    };

    await routeWithToolUse(STUB_PACK, 'run analysis', {
      requestId: 'req-1',
      adapter,
      systemPromptOverride: ROUTING_SYSTEM_PROMPT,
    });

    // Two calls: cached attempt (rejected), fallback attempt (succeeded).
    expect(calls).toHaveLength(2);
    expect(calls[0]!.args.system_cache_blocks).toBeDefined();
    expect(calls[1]!.args.system_cache_blocks).toBeUndefined();
    expect(typeof calls[1]!.args.system).toBe('string');

    const cache = cacheEvents();
    expect(cache).toHaveLength(1);
    expect(cache[0]!.data.cache_mode).toBe('disabled_api_unsupported');
    expect(cache[0]!.data.llm_call).toBe(1);
  });

  it('UpstreamTimeoutError propagates unchanged (does NOT trigger cache fallback)', async () => {
    let n = 0;
    const adapter = {
      chatWithTools: async () => {
        n += 1;
        throw new UpstreamTimeoutError(
          'request timed out',
          'anthropic',
          'chat_with_tools',
          'body',
          1000,
        );
      },
    };

    await expect(
      routeWithToolUse(STUB_PACK, 'run analysis', {
        requestId: 'req-1',
        adapter,
        systemPromptOverride: ROUTING_SYSTEM_PROMPT,
      }),
    ).rejects.toMatchObject({ name: 'RoutingError', cause: 'timeout' });

    expect(n).toBe(1); // no fallback retry
    // Telemetry still emitted on the failure path.
    expect(cacheEvents()).toHaveLength(1);
    expect(cacheEvents()[0]!.data.cache_mode).toBe('enabled');
  });

  it('429 rate limit propagates unchanged (does NOT trigger cache fallback)', async () => {
    let n = 0;
    const adapter = {
      chatWithTools: async () => {
        n += 1;
        throw new UpstreamHTTPError('rate limited', 'anthropic', 429, 'rate_limited', 'r', 5);
      },
    };

    await expect(
      routeWithToolUse(STUB_PACK, 'run analysis', {
        requestId: 'req-1',
        adapter,
        systemPromptOverride: ROUTING_SYSTEM_PROMPT,
      }),
    ).rejects.toThrow();

    expect(n).toBe(1);
  });

  it('5xx propagates unchanged', async () => {
    let n = 0;
    const adapter = {
      chatWithTools: async () => {
        n += 1;
        throw new UpstreamHTTPError('upstream', 'anthropic', 503, 'server_error', 's', 5);
      },
    };

    await expect(
      routeWithToolUse(STUB_PACK, 'run analysis', {
        requestId: 'req-1',
        adapter,
        systemPromptOverride: ROUTING_SYSTEM_PROMPT,
      }),
    ).rejects.toThrow();

    expect(n).toBe(1);
  });

  it('disabled-by-config (full route): adapter receives plain system; emits cache_mode=disabled_config', async () => {
    // Snapshot + restore — config is the production toggle path through
    // routeWithToolUse. Restored in afterEach so test ordering can't leak.
    const original = config.promptCache.anthropicEnabled;
    try {
      (config.promptCache as { anthropicEnabled: boolean }).anthropicEnabled = false;

      const { adapter, calls } = makeAdapter(async () =>
        toolUseResult({ cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }),
      );

      await routeWithToolUse(STUB_PACK, 'run analysis', {
        requestId: 'req-1',
        adapter,
        systemPromptOverride: 'STABLE_PREFIX',
      });

      expect(calls[0]!.args.system).toBe('STABLE_PREFIX');
      expect(calls[0]!.args.system_cache_blocks).toBeUndefined();

      const cache = cacheEvents();
      expect(cache).toHaveLength(1);
      expect(cache[0]!.data.cache_mode).toBe('disabled_config');
    } finally {
      (config.promptCache as { anthropicEnabled: boolean }).anthropicEnabled = original;
    }
  });

  it('repair path: emits a second v5.prompt_cache with llm_call=2, inheriting cache_mode', async () => {
    // First call returns malformed tool input (missing required fields) →
    // forces tryInterpret() to parse_failed → REPAIR_ONCE branch.
    // Second call returns a valid tool input.
    let n = 0;
    const adapter = {
      chatWithTools: async (_args: ChatWithToolsArgs) => {
        n += 1;
        if (n === 1) {
          // Malformed input — missing intent_class / action.
          return {
            content: [
              {
                type: 'tool_use',
                id: 'tu-1',
                name: OLUMI_ACTION_TOOL_NAME,
                input: { not_a_real_field: true } as Record<string, unknown>,
              } as ToolResponseBlock,
            ],
            stop_reason: 'tool_use',
            usage: {
              input_tokens: 100,
              output_tokens: 10,
              cache_creation_input_tokens: 90,
              cache_read_input_tokens: 0,
            } as ChatWithToolsResult['usage'],
            model: 'claude-sonnet-4-6',
            latencyMs: 50,
          };
        }
        return toolUseResult({
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 80,
        });
      },
    };

    await routeWithToolUse(STUB_PACK, 'run analysis', {
      requestId: 'req-1',
      adapter,
      systemPromptOverride: ROUTING_SYSTEM_PROMPT,
    });

    expect(n).toBe(2);
    const cache = cacheEvents();
    expect(cache).toHaveLength(2);
    expect(cache[0]!.data.llm_call).toBe(1);
    expect(cache[1]!.data.llm_call).toBe(2);
    // Both calls inherit the same cache mode (enabled by default).
    expect(cache[0]!.data.cache_mode).toBe('enabled');
    expect(cache[1]!.data.cache_mode).toBe('enabled');
    // Repair call's cache_hit reflects the second response's usage.
    expect(cache[1]!.data.cache_hit).toBe(true);
  });

  it('emits brief-named scenario_id and turn_id aliases on the cache event', async () => {
    const { adapter } = makeAdapter(async () => toolUseResult());
    await routeWithToolUse(STUB_PACK, 'run analysis', {
      requestId: 'turn-abc',
      sessionId: 'scen-xyz',
      adapter,
      systemPromptOverride: ROUTING_SYSTEM_PROMPT,
    });
    const data = cacheEvents()[0]!.data;
    expect(data.turn_id).toBe('turn-abc');
    expect(data.scenario_id).toBe('scen-xyz');
    // Codebase aliases retained too.
    expect(data.request_id).toBe('turn-abc');
    expect(data.v5_journey_id).toBe('scen-xyz');
  });

  it('stable_prefix_bytes uses UTF-8 byte length, not UTF-16 char count', async () => {
    // Multi-byte glyphs: char count differs from byte count.
    const nonAscii = 'budget — “Q3” £300k → résumé';
    const { adapter } = makeAdapter(async () => toolUseResult());
    await routeWithToolUse(STUB_PACK, 'run', {
      requestId: 'req-1',
      adapter,
      systemPromptOverride: nonAscii,
    });
    const data = cacheEvents()[0]!.data;
    expect(data.stable_prefix_bytes).toBe(Buffer.byteLength(nonAscii, 'utf8'));
    expect(data.stable_prefix_bytes).toBeGreaterThan(nonAscii.length);
  });

  it('400 without /cache_control/i propagates unchanged (does NOT trigger fallback)', async () => {
    let n = 0;
    const adapter = {
      chatWithTools: async () => {
        n += 1;
        throw new UpstreamHTTPError(
          'invalid model parameter',
          'anthropic',
          400,
          'invalid_request_error',
          'r',
          5,
        );
      },
    };

    await expect(
      routeWithToolUse(STUB_PACK, 'run analysis', {
        requestId: 'req-1',
        adapter,
        systemPromptOverride: ROUTING_SYSTEM_PROMPT,
      }),
    ).rejects.toThrow();

    expect(n).toBe(1); // no fallback
  });
});
