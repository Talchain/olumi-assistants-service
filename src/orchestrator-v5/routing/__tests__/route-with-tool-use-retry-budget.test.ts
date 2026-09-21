/**
 * ROADMAP 1.55(c) — retry-cap / timeout coherence for the max_tokens retry.
 *
 * PR #384 set the caps to 3072 (first attempt) / 8192 (retry), but both
 * calls ran under the same per-call budget (ORCHESTRATOR_TIMEOUT_MS, 30s
 * default). At the measured Sonnet 5 output rate (~114 tok/s, 2026-07-08
 * staging evidence) a 30s window can serve ~3,400 output tokens — so the
 * 8192 retry cap was UNREACHABLE: a deep truncation surfaced as LLM_TIMEOUT
 * on the retry instead of either a rescue or the designed bounded-fallback
 * (max_tokens again). Live retry rate was 0%, so nothing was broken in
 * production; this is a coherence fix.
 *
 * Chosen fix (the safer of the two options): give the RETRY its own timeout
 * budget sized to its cap. Rationale, from the code structure:
 *   - The V5 turn budget is TURN_BUDGET_MS (default 180s, budgets.ts) — a
 *     truncated first attempt (~30s) + a full retry window (~80s) fits with
 *     ~70s of headroom for handlers.
 *   - The alternative (lowering the retry cap to what 30s can serve,
 *     ~3,400 tokens) would make the escalated cap ≈ the 3072 first cap and
 *     silently gut #384's rescue intent.
 *
 * The arithmetic is ENCODED below so the next model-speed / cap / budget
 * change re-fires these assertions consciously.
 */

import { describe, expect, it, vi } from 'vitest';

import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../../adapters/llm/types.js';
import { ORCHESTRATOR_TIMEOUT_MS } from '../../../config/timeouts.js';
import { getTurnExecutorBudgets } from '../../budgets.js';

import {
  assembleContextPack,
  type ContextPack,
} from '../../context/context-pack-assembler.js';
import {
  routeWithToolUse,
  V5_ROUTING_ASSUMED_OUTPUT_TOKENS_PER_SEC,
  V5_ROUTING_MAX_OUTPUT_TOKENS,
  V5_ROUTING_MAX_OUTPUT_TOKENS_RETRY,
  V5_ROUTING_RETRY_TIMEOUT_MS,
} from '../route-with-tool-use.js';
import { OLUMI_ACTION_TOOL_NAME } from '../tool-schema.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

// -----------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------

function minimalContextPack(): ContextPack {
  return assembleContextPack({
    payload: makeMessagePayload({
      turn_id: 't-01',
      scenario_id: 'scen-abc',
      message: 'What now?',
    }),
    priorTurns: [],
  });
}

function toolCallBlock(input: unknown): ToolResponseBlock {
  return {
    type: 'tool_use',
    id: 'tu-1',
    name: OLUMI_ACTION_TOOL_NAME,
    input: input as Record<string, unknown>,
  };
}

function textBlock(text: string): ToolResponseBlock {
  return { type: 'text', text };
}

function mkResult(
  content: ToolResponseBlock[],
  stop: ChatWithToolsResult['stop_reason'] = 'tool_use',
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
    model: 'claude-sonnet-5',
    latencyMs: 123,
  };
}

const VALID_EXECUTE_INPUT = {
  intent_class: 'execute' as const,
  action: {
    handler_id: 'run_analysis',
    entity: {
      id: 'scen-abc',
      kind: 'option' as const,
      resolution_status: 'resolved' as const,
      resolution_method: 'id_match' as const,
    },
    parameters: [],
    cited_context_fields: ['graph.options'],
  },
};

// -----------------------------------------------------------------------
// The arithmetic — re-fires on any model-speed / cap / budget change
// -----------------------------------------------------------------------

describe('V5 routing retry budget arithmetic (ROADMAP 1.55c)', () => {
  it('the retry timeout can actually serve the full retry cap at the assumed output rate', () => {
    const fullRetryGenerationMs =
      (V5_ROUTING_MAX_OUTPUT_TOKENS_RETRY / V5_ROUTING_ASSUMED_OUTPUT_TOKENS_PER_SEC) * 1000;
    // 8192 tok / 114 tok/s ≈ 71.9s of pure generation — the retry timeout
    // must cover it plus a time-to-first-token allowance.
    expect(V5_ROUTING_RETRY_TIMEOUT_MS).toBeGreaterThanOrEqual(fullRetryGenerationMs);
  });

  it('the first-attempt timeout can serve the full first-attempt cap at the assumed output rate', () => {
    const fullFirstGenerationMs =
      (V5_ROUTING_MAX_OUTPUT_TOKENS / V5_ROUTING_ASSUMED_OUTPUT_TOKENS_PER_SEC) * 1000;
    // 3072 tok / 114 tok/s ≈ 27s < 30s ORCHESTRATOR_TIMEOUT_MS — tight but
    // servable. If a cap bump or a slower model breaks this, the first
    // attempt becomes timeout-bound and #384's whole retry design needs
    // re-deriving, not just this constant.
    expect(ORCHESTRATOR_TIMEOUT_MS).toBeGreaterThanOrEqual(fullFirstGenerationMs);
  });

  it('a truncated first attempt plus a full retry window still fits the V5 turn budget (routing leg alone)', () => {
    // THIS ASSERTION RE-FIRED CONSCIOUSLY, 2026-07-19 — exactly as the file
    // header asks. Re-derived rather than re-baselined:
    //
    // The turn budget is now clamped to the browser-proxy deadline
    // (125s - 10s headroom = 115s) so CEE always returns its own typed error
    // before the proxy returns a generic one. The old comparand was the 180s
    // default, and against 180s the "+45s handler headroom" form passed.
    //
    // It passed against a number that WAS NEVER REACHABLE. Worst-case routing
    // plus one handler window is 30,000 + 79,860 + 45,000 = 154,860ms, which
    // exceeds the 125s browser-proxy deadline by ~30s. On the canonical
    // UI -> CEE path that turn was already being killed by the proxy; the 180s
    // budget concealed the over-subscription rather than accommodating it.
    // The clamp did not create this gap — it made it visible.
    //
    // What is still TRUE and worth pinning: the routing leg ALONE fits, with
    // ~5.1s to spare. That is genuinely tight, and it is the assertion that
    // should re-fire if a cap bump or a slower model grows the retry window.
    const turnBudgetMs = getTurnExecutorBudgets().turn_ms;
    const worstCaseRoutingMs = ORCHESTRATOR_TIMEOUT_MS + V5_ROUTING_RETRY_TIMEOUT_MS;
    expect(worstCaseRoutingMs).toBeLessThanOrEqual(turnBudgetMs);
  });

  it('DOCUMENTS AN OPEN OVER-SUBSCRIPTION: worst-case routing + a handler window does NOT fit', () => {
    // Recorded as an executable statement of a known gap rather than left as
    // prose nobody re-checks. If someone later shrinks the routing retry
    // window or raises the ceiling enough that this DOES fit, this test fails
    // and the gap gets closed deliberately instead of drifting shut unnoticed.
    //
    // OWNER DECISION NEEDED (routing / #384): either shrink
    // V5_ROUTING_RETRY_TIMEOUT_MS so the rescue path can coexist with a
    // handler inside one turn, or accept that a max_tokens-truncated routing
    // retry followed by handler work cannot complete and will surface as
    // TURN_BUDGET_EXCEEDED. Live max_tokens retry rate was measured at 0%, so
    // this is a latent coherence gap, not an active production failure.
    const turnBudgetMs = getTurnExecutorBudgets().turn_ms;
    const worstCaseRoutingMs = ORCHESTRATOR_TIMEOUT_MS + V5_ROUTING_RETRY_TIMEOUT_MS;
    const oneHandlerWindowMs = 45_000;
    expect(worstCaseRoutingMs + oneHandlerWindowMs).toBeGreaterThan(turnBudgetMs);
  });
});

// -----------------------------------------------------------------------
// Behaviour — the retry call gets the escalated per-call timeout
// -----------------------------------------------------------------------

describe('routeWithToolUse — max_tokens retry timeout escalation (ROADMAP 1.55c)', () => {
  it('the max_tokens retry call receives the escalated timeout; the first call keeps the base timeout', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { timeoutMs?: number }) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([textBlock('partial')], 'max_tokens'))
        .mockResolvedValueOnce(mkResult([toolCallBlock(VALID_EXECUTE_INPUT)])),
    };

    const result = await routeWithToolUse(minimalContextPack(), 'run analysis', {
      requestId: 'req-retry-budget',
      adapter,
    });

    expect(result.type).toBe('tool_call');
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2);

    const firstOpts = adapter.chatWithTools.mock.calls[0]![1] as { timeoutMs?: number };
    const retryOpts = adapter.chatWithTools.mock.calls[1]![1] as { timeoutMs?: number };
    expect(firstOpts.timeoutMs).toBe(ORCHESTRATOR_TIMEOUT_MS);
    expect(retryOpts.timeoutMs).toBe(
      Math.max(ORCHESTRATOR_TIMEOUT_MS, V5_ROUTING_RETRY_TIMEOUT_MS),
    );
    // The escalated window must exceed the base — otherwise the 8192 cap is
    // unreachable and this fix is a no-op.
    expect(retryOpts.timeoutMs!).toBeGreaterThan(ORCHESTRATOR_TIMEOUT_MS);
  });

  it('a caller-supplied timeout larger than the escalated one is respected on the retry (never shrunk)', async () => {
    const bigTimeout = V5_ROUTING_RETRY_TIMEOUT_MS + 60_000;
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { timeoutMs?: number }) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([textBlock('partial')], 'max_tokens'))
        .mockResolvedValueOnce(mkResult([toolCallBlock(VALID_EXECUTE_INPUT)])),
    };

    await routeWithToolUse(minimalContextPack(), 'run analysis', {
      requestId: 'req-retry-budget-big',
      timeoutMs: bigTimeout,
      adapter,
    });

    const retryOpts = adapter.chatWithTools.mock.calls[1]![1] as { timeoutMs?: number };
    expect(retryOpts.timeoutMs).toBe(bigTimeout);
  });

  it('the REPAIR_ONCE call is NOT escalated — schema repair keeps the base timeout', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: { timeoutMs?: number }) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([toolCallBlock({ intent_class: 'execute' /* missing action */ })]))
        .mockResolvedValueOnce(mkResult([toolCallBlock(VALID_EXECUTE_INPUT)])),
    };

    await routeWithToolUse(minimalContextPack(), 'go', {
      requestId: 'req-repair-timeout',
      adapter,
    });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2);
    const repairOpts = adapter.chatWithTools.mock.calls[1]![1] as { timeoutMs?: number };
    expect(repairOpts.timeoutMs).toBe(ORCHESTRATOR_TIMEOUT_MS);
  });
});
