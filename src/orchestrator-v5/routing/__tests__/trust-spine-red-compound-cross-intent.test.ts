/**
 * TRUST-SPINE RED — T5 / board item #5: compound cross-intent atomic-or-refuse.
 *
 * Acceptance floor (Paul-approved plan agile-finding-harp.md §3 item 5):
 *   "'add X and run' either one transaction or a clear decline; never partial.
 *    Test: compound fixture → no partial-apply state."
 *
 * DEFECT + HONEST DIVERGENCE FROM THE PLAN'S TRACE (documented deliberately):
 * The plan cited compound-detector.ts:5-8 as the code that "defers to chips". On
 * the LIVE V5 estate that is NOT the mechanism:
 *   - `detectCompound` is advisory only; `compound_segments` is a WRITE-ONLY field
 *     with ZERO downstream readers (a dead-machinery defect in its own right), and
 *     `compound_detected` is read only by telemetry.
 *   - The literal CHIP_REMAINDER "defer to a chip" pipeline is DEAD V4 code (the
 *     /orchestrate/v1/turn route returns 410 with pipelineV4Enabled=false).
 *   - The one LIVE, deterministic silent-partial-apply seam is the V5 router:
 *     route-with-tool-use.ts:819 `result.content.find((b) => b.type === 'tool_use')`
 *     keeps the FIRST tool_use block and SILENTLY DROPS any additional executable
 *     actions — no count, no log, no signal in the RoutingResult.
 * So a compound "add a risk factor … and run the analysis" that yields two
 * executable actions is reduced to the first, with the remainder erased silently.
 *
 * SCOPE NOTE: in production the single `olumi_action` tool + the COMPOUND-INTENT
 * prompt steer the model toward one action, so the silent defer most often happens
 * inside the (untestable-in-process) LLM choice; route-with-tool-use.ts:819 is the
 * deterministic BACKSTOP that erases a second action if one IS emitted. This test
 * pins that backstop — the strongest pure, in-process seam available.
 *
 * it.fails semantics: the body asserts the HONEST-FUTURE behaviour (a compound turn
 * that produced two distinct executable actions is NOT silently reduced to the
 * first), which THROWS today (it IS silently reduced) — so `it.fails` reports GREEN
 * while the defect stands. When board #5 lands (both actions represented, or a
 * typed bounded refusal), the body passes, `it.fails` fails loudly, and the fixer
 * converts it to `it()`.
 */
import { describe, it, expect, vi } from 'vitest';

import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../../adapters/llm/types.js';
import { assembleContextPack, type ContextPack } from '../../context/context-pack-assembler.js';
import { routeWithToolUse } from '../route-with-tool-use.js';
import { OLUMI_ACTION_TOOL_NAME } from '../tool-schema.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

const COMPOUND_MESSAGE = 'add a risk factor for supply chain and run the analysis';

function compoundContextPack(): ContextPack {
  return assembleContextPack({
    payload: makeMessagePayload({
      turn_id: 't-compound',
      scenario_id: 'scen-abc',
      message: COMPOUND_MESSAGE,
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

function mkResult(content: ToolResponseBlock[]): ChatWithToolsResult {
  return {
    content,
    stop_reason: 'tool_use',
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

/** The "run the analysis" half — a known-parseable execute action (first block). */
const RUN_ANALYSIS_ACTION = {
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

/** The "add a risk factor" half — the SECOND executable action, silently dropped. */
const ADD_FACTOR_ACTION = {
  intent_class: 'execute' as const,
  action: {
    handler_id: 'edit_graph',
    entity: {
      id: 'scen-abc',
      kind: 'option' as const,
      resolution_status: 'resolved' as const,
      resolution_method: 'id_match' as const,
    },
    parameters: [],
    cited_context_fields: ['graph.nodes'],
  },
};

describe('TRUST-SPINE T5 — compound cross-intent: atomic or bounded refusal, never silent partial (board #5)', () => {
  // POSITIVE CONTROL (regular it — GREEN today): a single-action turn routes to a
  // tool_call cleanly. Proves the harness drives the real router and that a
  // tool_call result is observable — so the RED assertion below is not vacuous.
  it('positive control: a single executable action routes to a tool_call', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(a: ChatWithToolsArgs, o: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([toolCallBlock(RUN_ANALYSIS_ACTION)])),
    };
    const result = await routeWithToolUse(compoundContextPack(), 'run the analysis', {
      requestId: 'req-single',
      adapter,
    });
    expect(result.type).toBe('tool_call');
  });

  // TRUST-SPINE RED: flips to it() when board-item 5 lands.
  // The model emitted TWO distinct executable actions for the compound message.
  // TODAY the router keeps the first (run_analysis) and silently drops the second
  // (edit_graph) with no trace in the result. Honest future: never a single-action
  // tool_call that erases the remainder — both represented, or a typed bounded
  // refusal.
  it.fails(
    'a compound turn with two executable actions is not silently reduced to the first',
    async () => {
      const adapter = {
        chatWithTools: vi
          .fn<(a: ChatWithToolsArgs, o: unknown) => Promise<ChatWithToolsResult>>()
          .mockResolvedValueOnce(
            mkResult([
              toolCallBlock(RUN_ANALYSIS_ACTION), // first tool_use → kept
              toolCallBlock(ADD_FACTOR_ACTION), // second tool_use → silently dropped
            ]),
          ),
      };

      const result = await routeWithToolUse(compoundContextPack(), COMPOUND_MESSAGE, {
        requestId: 'req-compound',
        adapter,
      });

      // Assert on the ACTIONABLE proposal, not the whole RoutingResult: the result
      // retains the raw LLM response (`rawResult`) which still contains both tool
      // blocks, but the acted-upon `proposal` is parsed from the FIRST tool_use
      // only — the second action is dropped from what actually executes.
      const proposalStr =
        result.type === 'tool_call' ? JSON.stringify(result.proposal) : '';
      // TODAY: type === 'tool_call', the executed proposal is run_analysis only, and
      // the second action (edit_graph) is absent from the proposal — silently gone.
      const silentlyDroppedRemainder =
        result.type === 'tool_call' && !proposalStr.includes('edit_graph');

      // Honest future: this must be false — the remainder is represented in what
      // executes (atomic-in-effect) OR the turn is a typed bounded refusal
      // (result.type !== 'tool_call').
      expect(silentlyDroppedRemainder).toBe(false);
    },
  );
});
