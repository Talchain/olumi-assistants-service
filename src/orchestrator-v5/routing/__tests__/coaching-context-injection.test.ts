/**
 * Coaching Context Pack v1 — prompt injection + flag-off byte-identity.
 *
 * The pack reaches the LLM only as the ContextPack `coaching_context` field
 * (plus a narrow receive-vs-author instruction). When the field is absent (flag
 * off), the serialised user message is byte-identical to today: no pack, no
 * instruction. Exercised through the public `routeWithToolUse` with a mock
 * adapter that captures the user message, exactly like route-with-tool-use.test.
 */

import { describe, expect, it, vi } from 'vitest';

import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../../adapters/llm/types.js';
import {
  assembleContextPack,
  type ContextPack,
} from '../../context/context-pack-assembler.js';
import {
  canonicalStateFromFreshness,
  summariseCoachingStatePack,
  type CoachingStatePack,
} from '../../context/canonical-analysis-state.js';
import { routeWithToolUse, COACHING_CONTEXT_INSTRUCTION } from '../route-with-tool-use.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

function mkResult(content: ToolResponseBlock[]): ChatWithToolsResult {
  return {
    content,
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 1,
  };
}

function mockAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
      .mockResolvedValueOnce(mkResult([{ type: 'text', text: 'ok' }])),
  };
}

function stalePack(): CoachingStatePack {
  return summariseCoachingStatePack(
    canonicalStateFromFreshness(
      {
        freshness: 'stale',
        reason: 'graph_hash_diverged',
        selected_fact_index: 0,
        graph_hash_at_run: 'a1b2c3d4e5f60718',
        current_graph_hash: 'ffeeddccbbaa9988',
        computed_at: '2026-06-23T10:00:00.000Z',
      },
      { readiness: { status: 'ready', blockers: [] } },
    ),
  );
}

function packWith(coachingContext: CoachingStatePack | undefined): ContextPack {
  return assembleContextPack({
    payload: makeMessagePayload({ turn_id: 't-1', scenario_id: 'scen-1', message: 'hi' }),
    priorTurns: [],
    priorFacts: [],
    ...(coachingContext ? { coachingContext } : {}),
  });
}

async function userMessageFor(coachingContext: CoachingStatePack | undefined): Promise<string> {
  const adapter = mockAdapter();
  await routeWithToolUse(packWith(coachingContext), 'hi', { requestId: 'req-1', adapter });
  const args = adapter.chatWithTools.mock.calls[0]![0];
  return args.messages[0]!.content as string;
}

const COACHING_HEADER = '## Coaching state (deterministic — authoritative)';

describe('Coaching Context Pack v1 — prompt injection (flag-on)', () => {
  it('injects the pack JSON and the receive-vs-author instruction', async () => {
    const msg = await userMessageFor(stalePack());
    expect(msg).toContain('"coaching_context"');
    expect(msg).toContain('"freshness": "stale"');
    expect(msg).toContain(COACHING_HEADER);
    expect(msg).toContain('do not present the results as current');
    // Base sections still present + ordered before the user turn.
    expect(msg).toContain('## ContextPack');
    expect(msg.indexOf(COACHING_HEADER)).toBeLessThan(msg.indexOf('## User turn'));
  });

  it('the injected pack carries no hash digest (prompt-safe)', async () => {
    const msg = await userMessageFor(stalePack());
    expect(msg).not.toContain('a1b2c3d4e5f60718');
    expect(msg).not.toContain('ffeeddccbbaa9988');
  });

  it('none-state coaching guidance is honest — no false "out of date" pre-analysis (review r2)', () => {
    // Pre-analysis (`freshness` "none") NOTHING has run, so instructing the model
    // to say the results "may be out of date" / to "re-run" is a false claim and
    // makes the T1/T2 dead-end partially recur live (the model self-nudges).
    const lines = COACHING_CONTEXT_INSTRUCTION.split('\n');
    const noneLine = lines.find((l) => /`freshness`\s+is\s+"none"/i.test(l));
    expect(noneLine, 'a none-state bullet exists').toBeDefined();
    expect(noneLine).toMatch(/no analysis has been run/i);
    expect(noneLine).not.toMatch(/out of date/i);
    expect(noneLine).not.toMatch(/re-?run/i);
    // The OTHER unsafe states (an analysis exists but is stale/unusable) still
    // legitimately suggest re-running.
    const otherLine = lines.find((l) => /^- Otherwise,/i.test(l));
    expect(otherLine, 'the non-none unsafe bullet is retained').toBeDefined();
    expect(otherLine).toMatch(/out of date/i);
    expect(otherLine).toMatch(/re-?run/i);
  });
});

describe('Coaching Context Pack v1 — flag-off byte-identity', () => {
  it('omits the pack and the instruction entirely when no field is supplied', async () => {
    const msg = await userMessageFor(undefined);
    expect(msg).not.toContain('coaching_context');
    expect(msg).not.toContain(COACHING_HEADER);
    expect(msg).toContain('## ContextPack');
    expect(msg).toContain('## User turn');
  });

  it('flag-off user message is byte-identical to the legacy 4-section shape', async () => {
    const msg = await userMessageFor(undefined);
    const pack = packWith(undefined);
    // Reconstruct the exact pre-lane serialisation: ## ContextPack / <json> /
    // '' / ## User turn / message — with raw analysis|graph|analysis_state +
    // the display_* originals stripped and display variants substituted under
    // analysis|graph (mirrors buildUserMessage's destructure exactly).
    const {
      analysis,
      display_analysis,
      graph,
      display_graph,
      analysis_state,
      ...rest
    } = pack;
    void analysis;
    void graph;
    void analysis_state;
    const llmFacing = { ...rest, analysis: display_analysis, graph: display_graph };
    const expected = [
      '## ContextPack',
      JSON.stringify(llmFacing, null, 2),
      '',
      '## User turn',
      'hi',
    ].join('\n');
    expect(msg).toBe(expected);
  });

  it('still strips raw analysis / graph / analysis_state from the prompt', async () => {
    const msg = await userMessageFor(stalePack());
    // analysis_state (hash-bearing) must never reach the prompt even flag-on.
    expect(msg).not.toContain('"analysis_state"');
    expect(msg).not.toContain('graph_hash_at_run');
  });
});
