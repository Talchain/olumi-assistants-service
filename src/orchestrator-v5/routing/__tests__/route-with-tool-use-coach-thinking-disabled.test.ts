/**
 * routeWithToolUse — CEE_COACH_THINKING_DISABLED flag (POC-BOARD item 9).
 *
 * Latency lever: when ON, the coach/routing turn sends
 * `thinking: { type: 'disabled' }` on its chatWithTools call to suppress
 * Sonnet-5 adaptive thinking on THAT CALL ONLY.
 *
 * DEFAULT FLIPPED ON 18 Jul (Paul-ratified): the flag defaults ON now, so the
 * default path (env unset) SENDS thinking:disabled. The env var is the
 * kill-switch — CEE_COACH_THINKING_DISABLED=false restores the byte-identical
 * legacy path (the routing call omits `thinking`, so adaptive thinking stays on).
 *
 * Flag-toggle uses the env + _resetConfigCache pattern (the flag is read from
 * config.features.coachThinkingDisabled at call time, not import time), mirroring
 * tool-schema-answer-shape-enforced.test.ts.
 *
 * All tests use an injected mock adapter. No real Anthropic API calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../../adapters/llm/types.js';
import {
  assembleContextPack,
  type ContextPack,
} from '../../context/context-pack-assembler.js';
import { routeWithToolUse } from '../route-with-tool-use.js';
import { OLUMI_ACTION_TOOL_NAME } from '../tool-schema.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

// -----------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------

function minimalContextPack(): ContextPack {
  return assembleContextPack({
    payload: makeMessagePayload({
      turn_id: 't-thinking',
      scenario_id: 'scen-thinking',
      message: 'What now?',
    }),
    priorTurns: [],
  });
}

function textBlock(text: string): ToolResponseBlock {
  return { type: 'text', text };
}

function mkResult(
  content: ToolResponseBlock[],
  stop: ChatWithToolsResult['stop_reason'] = 'end_turn',
): ChatWithToolsResult {
  return {
    content,
    stop_reason: stop,
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 123,
  };
}

let priorFlag: string | undefined;

async function setFlag(value: 'true' | 'false' | undefined) {
  priorFlag = process.env.CEE_COACH_THINKING_DISABLED;
  if (value === undefined) {
    delete process.env.CEE_COACH_THINKING_DISABLED;
  } else {
    process.env.CEE_COACH_THINKING_DISABLED = value;
  }
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
}

async function restoreFlag() {
  if (priorFlag === undefined) {
    delete process.env.CEE_COACH_THINKING_DISABLED;
  } else {
    process.env.CEE_COACH_THINKING_DISABLED = priorFlag;
  }
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
}

// -----------------------------------------------------------------------
// DEFAULT (flag ON by default since 18 Jul, Paul-ratified) — env unset SENDS
// thinking:disabled. Converted from the former "OFF (default)" byte-identical
// assertion, which flipped when the config default went ON.
// -----------------------------------------------------------------------

describe('routeWithToolUse — CEE_COACH_THINKING_DISABLED default (ON)', () => {
  beforeEach(async () => {
    await setFlag(undefined);
  });
  afterEach(async () => {
    await restoreFlag();
  });

  it('default path (env unset): sends thinking:{type:\'disabled\'} on the chatWithTools call', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([textBlock('Hello — how can I help?')])),
    };

    await routeWithToolUse(minimalContextPack(), 'hi', { requestId: 'req-default', adapter });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    const args = adapter.chatWithTools.mock.calls[0]![0];
    expect(args.thinking).toEqual({ type: 'disabled' });
  });
});

// -----------------------------------------------------------------------
// KILL-SWITCH (CEE_COACH_THINKING_DISABLED=false) — env-override OFF restores the
// byte-identical legacy path: no thinking field on the adapter call.
// -----------------------------------------------------------------------

describe('routeWithToolUse — CEE_COACH_THINKING_DISABLED override OFF (kill-switch)', () => {
  beforeEach(async () => {
    await setFlag('false');
  });
  afterEach(async () => {
    await restoreFlag();
  });

  it('omits `thinking` from the chatWithTools call (adaptive thinking stays on)', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([textBlock('Hello — how can I help?')])),
    };

    await routeWithToolUse(minimalContextPack(), 'hi', { requestId: 'req-off', adapter });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    const args = adapter.chatWithTools.mock.calls[0]![0];
    expect(args.thinking).toBeUndefined();
    expect('thinking' in args).toBe(false);
  });
});

// -----------------------------------------------------------------------
// Flag ON — suppress adaptive thinking on the coach turn only
// -----------------------------------------------------------------------

describe('routeWithToolUse — CEE_COACH_THINKING_DISABLED ON', () => {
  beforeEach(async () => {
    await setFlag('true');
  });
  afterEach(async () => {
    await restoreFlag();
  });

  it('sends thinking:{type:\'disabled\'} on the initial chatWithTools call', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([textBlock('Hello — how can I help?')])),
    };

    await routeWithToolUse(minimalContextPack(), 'hi', { requestId: 'req-on', adapter });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    const args = adapter.chatWithTools.mock.calls[0]![0];
    expect(args.thinking).toEqual({ type: 'disabled' });
    // Suppressing thinking must not disturb the rest of the routing call shape.
    expect(args.temperature).toBe(0);
    expect(args.tools[0]!.name).toBe(OLUMI_ACTION_TOOL_NAME);
  });

  it('propagates the disable to the max_tokens retry call', async () => {
    // First call ends max_tokens → routing retries ONCE with a larger budget,
    // reusing firstCallArgs (which now carries thinking:{type:'disabled'}).
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([textBlock('partial')], 'max_tokens'))
        .mockResolvedValueOnce(mkResult([textBlock('Hello — how can I help?')])),
    };

    await routeWithToolUse(minimalContextPack(), 'hi', { requestId: 'req-retry', adapter });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2);
    const retryArgs = adapter.chatWithTools.mock.calls[1]![0];
    expect(retryArgs.thinking).toEqual({ type: 'disabled' });
  });
});
