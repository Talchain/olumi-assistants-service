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
 *     route-with-tool-use.ts `result.content.find((b) => b.type === 'tool_use')`
 *     kept the FIRST tool_use block and SILENTLY DROPPED any additional executable
 *     actions — no count, no log, no signal in the RoutingResult.
 * So a compound "add a risk factor … and run the analysis" that yields two
 * executable actions was reduced to the first, with the remainder erased silently.
 *
 * SCOPE NOTE: in production the single `olumi_action` tool + the COMPOUND-INTENT
 * prompt steer the model toward one action, so the silent defer most often happens
 * inside the (untestable-in-process) LLM choice; the router capture is the
 * deterministic BACKSTOP that decides what happens if a second action IS emitted.
 * This test pins that backstop — the strongest pure, in-process seam available.
 *
 * ⚠ CONVERTED RED→GREEN 17 Jul under the ratified disclosed-partial doctrine;
 * strict atomic-or-refuse remains a future upgrade (row it). Board item #5 was
 * ratified by Paul (17 Jul) as "disclosed-partial accepted; strict atomic-or-
 * refuse deferred as a future upgrade": #504 applies the first op AND surfaces the
 * remainder on `RoutingResult.droppedActions` so it is DISCLOSED, not erased. The
 * `it.fails` body below therefore no longer holds (the remainder is no longer
 * silently gone), so it is now a real `it()` whose criterion is the honest floor
 * we actually shipped: "never SILENTLY reduced". When the strict atomic-or-refuse
 * upgrade lands (both actions in one transaction, or a typed bounded refusal),
 * tighten this test's criterion accordingly. The original `it.fails` semantics
 * note is preserved below for provenance.
 *
 * ORIGINAL it.fails semantics (pre-conversion, for provenance): the body asserted
 * the HONEST-FUTURE behaviour (a compound turn that produced two distinct
 * executable actions is NOT silently reduced to the first), which THREW while the
 * defect stood — so `it.fails` reported GREEN. When board #5 landed the body
 * passed, `it.fails` would fail loudly, and the fixer converts it to `it()`.
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

function toolCallBlock(input: unknown, id: string): ToolResponseBlock {
  return {
    type: 'tool_use',
    id,
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

/** The "add a risk factor" half — the SECOND executable action, now DISCLOSED. */
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

describe('TRUST-SPINE T5 — compound cross-intent: disclosed-partial, never silent (board #5)', () => {
  // POSITIVE CONTROL (regular it — GREEN today): a single-action turn routes to a
  // tool_call cleanly. Proves the harness drives the real router and that a
  // tool_call result is observable — so the assertion below is not vacuous.
  it('positive control: a single executable action routes to a tool_call', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(a: ChatWithToolsArgs, o: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([toolCallBlock(RUN_ANALYSIS_ACTION, 'tu-1')])),
    };
    const result = await routeWithToolUse(compoundContextPack(), 'run the analysis', {
      requestId: 'req-single',
      adapter,
    });
    expect(result.type).toBe('tool_call');
  });

  // TRUST-SPINE (converted RED→GREEN, 17 Jul — disclosed-partial doctrine).
  // The model emitted TWO distinct executable actions for the compound message.
  // #504's router keeps the first (run_analysis) as the applied `proposal` AND
  // surfaces the second (edit_graph) on `droppedActions` — so the remainder is
  // REPRESENTED, not erased. Criterion = "never SILENTLY reduced": if the router
  // took the partial-apply path (`type === 'tool_call'`), the dropped remainder
  // MUST be disclosed and must identify the un-applied action.
  it('a compound turn with two executable actions is not silently reduced — the remainder is disclosed', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(a: ChatWithToolsArgs, o: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(
          mkResult([
            toolCallBlock(RUN_ANALYSIS_ACTION, 'tu-1'), // first tool_use → applied proposal
            toolCallBlock(ADD_FACTOR_ACTION, 'tu-2'), // second tool_use → DISCLOSED on droppedActions
          ]),
        ),
    };

    const result = await routeWithToolUse(compoundContextPack(), COMPOUND_MESSAGE, {
      requestId: 'req-compound',
      adapter,
    });

    // The router took the (one-op-per-turn) partial-apply path — the first action
    // is what executes.
    expect(result.type).toBe('tool_call');
    if (result.type !== 'tool_call') return;
    expect(result.proposal.intent_class).toBe('execute');
    if (result.proposal.intent_class === 'execute') {
      expect(result.proposal.action.handler_id).toBe('run_analysis');
    }

    // DISCLOSED-PARTIAL floor: the remainder is REPRESENTED (never silently gone).
    // Exactly one extra action, and it IDENTIFIES the un-applied edit_graph op —
    // this is the disclosure the turn executor narrates to the user.
    expect(result.droppedActions).toHaveLength(1);
    expect(result.droppedActions[0]).toEqual({ handler_id: 'edit_graph', label: null });
  });
});
