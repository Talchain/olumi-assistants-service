/**
 * routeWithToolUse — compound / parallel tool-call disclosure (POC-BOARD 5b).
 *
 * Regression cover for the CONFIRMED-LIVE silent-drop honesty defect: a
 * compound tunable edit ("set X to 70% AND set Y to 80%") makes the routing
 * model emit MORE THAN ONE `olumi_action` tool_use block in a single response.
 * `tryInterpret` applies only the first (`.find`), which is correct for the
 * one-op-per-turn execute path — but the extra actions were previously
 * discarded SILENTLY, so the user was told nothing about the un-applied op.
 *
 * These tests pin the router contract: the FIRST action still becomes the
 * applied `proposal`, AND every additional action is surfaced on
 * `droppedActions` so the turn can disclose it honestly. All tests use an
 * injected mock adapter — no real Anthropic call.
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
import { routeWithToolUse } from '../route-with-tool-use.js';
import { OLUMI_ACTION_TOOL_NAME } from '../tool-schema.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

function minimalContextPack(): ContextPack {
  return assembleContextPack({
    payload: makeMessagePayload({
      turn_id: 't-01',
      scenario_id: 'scen-abc',
      message:
        'Set Existing Customer Price Sensitivity to 70% and set ' +
        'Existing Customer Grandfathering to 80%.',
    }),
    priorTurns: [],
  });
}

/** A valid `set_factor_value` execute proposal (parses via parseToolCallResponse). */
function setFactorInput(id: string, label: string): Record<string, unknown> {
  return {
    intent_class: 'execute',
    action: {
      handler_id: 'set_factor_value',
      entity: {
        id,
        // A factor is a graph node (EntityKind has no 'factor' member).
        kind: 'node',
        label,
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [],
      cited_context_fields: [],
    },
  };
}

function toolCallBlock(id: string, input: Record<string, unknown>): ToolResponseBlock {
  return { type: 'tool_use', id, name: OLUMI_ACTION_TOOL_NAME, input };
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

function adapterReturning(result: ChatWithToolsResult) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
      .mockResolvedValueOnce(result),
  };
}

describe('routeWithToolUse — compound tool-call drop is disclosed, not silent (5b)', () => {
  it('reports the SECOND set_factor_value on droppedActions (Step-0 fixture shape)', async () => {
    const adapter = adapterReturning(
      mkResult([
        toolCallBlock('tu-1', setFactorInput('fac_price_sensitivity', 'Existing Customer Price Sensitivity')),
        toolCallBlock('tu-2', setFactorInput('fac_grandfathering', 'Existing Customer Grandfathering')),
      ]),
    );

    const result = await routeWithToolUse(
      minimalContextPack(),
      'Set Existing Customer Price Sensitivity to 70% and set Existing Customer Grandfathering to 80%.',
      { requestId: 'req-compound-1', adapter },
    );

    expect(result.type).toBe('tool_call');
    if (result.type !== 'tool_call') return;

    // The FIRST action is still the applied proposal (one op per turn preserved).
    expect(result.proposal.intent_class).toBe('execute');
    if (result.proposal.intent_class === 'execute') {
      expect(result.proposal.action.handler_id).toBe('set_factor_value');
      expect(result.proposal.action.entity.id).toBe('fac_price_sensitivity');
    }

    // The SECOND action is NOT silently dropped — it is surfaced for disclosure.
    expect(result.droppedActions).toHaveLength(1);
    expect(result.droppedActions[0]).toEqual({
      handler_id: 'set_factor_value',
      label: 'Existing Customer Grandfathering',
    });
  });

  it('a single-action response has an empty droppedActions (no false positive)', async () => {
    const adapter = adapterReturning(
      mkResult([
        toolCallBlock('tu-1', setFactorInput('fac_price_sensitivity', 'Existing Customer Price Sensitivity')),
      ]),
    );

    const result = await routeWithToolUse(minimalContextPack(), 'set price sensitivity to 70%', {
      requestId: 'req-single-1',
      adapter,
    });

    expect(result.type).toBe('tool_call');
    if (result.type !== 'tool_call') return;
    expect(result.droppedActions).toEqual([]);
  });

  it('reports every extra action when three set-value ops arrive at once', async () => {
    const adapter = adapterReturning(
      mkResult([
        toolCallBlock('tu-1', setFactorInput('fac_a', 'Factor A')),
        toolCallBlock('tu-2', setFactorInput('fac_b', 'Factor B')),
        toolCallBlock('tu-3', setFactorInput('fac_c', 'Factor C')),
      ]),
    );

    const result = await routeWithToolUse(minimalContextPack(), 'set A, B and C', {
      requestId: 'req-triple-1',
      adapter,
    });

    expect(result.type).toBe('tool_call');
    if (result.type !== 'tool_call') return;
    expect(result.proposal.intent_class).toBe('execute');
    if (result.proposal.intent_class === 'execute') {
      expect(result.proposal.action.entity.id).toBe('fac_a');
    }
    expect(result.droppedActions.map((d) => d.label)).toEqual(['Factor B', 'Factor C']);
  });

  it('counts an unparseable extra block so the drop is never under-reported', async () => {
    const adapter = adapterReturning(
      mkResult([
        toolCallBlock('tu-1', setFactorInput('fac_price_sensitivity', 'Existing Customer Price Sensitivity')),
        // A malformed extra action (missing intent_class) must still COUNT —
        // an absence assertion that under-reports the drop would re-hide it.
        toolCallBlock('tu-2', { not: 'a valid proposal' }),
      ]),
    );

    const result = await routeWithToolUse(minimalContextPack(), 'set two things', {
      requestId: 'req-malformed-1',
      adapter,
    });

    expect(result.type).toBe('tool_call');
    if (result.type !== 'tool_call') return;
    expect(result.droppedActions).toHaveLength(1);
    expect(result.droppedActions[0]).toEqual({ handler_id: null, label: null });
  });
});
