/**
 * routeWithToolUse — unit tests.
 *
 * All tests use an injected mock adapter. No real Anthropic API calls. Floor
 * per brief §4 D5: 10 tests; target 15.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  UpstreamHTTPError,
  UpstreamTimeoutError,
} from '../../../adapters/llm/errors.js';
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
  ROUTING_SYSTEM_PROMPT,
  RoutingError,
  routeWithToolUse,
  assertAnthropicMessageProtocol,
} from '../route-with-tool-use.js';
import { OLUMI_ACTION_TOOL_NAME } from '../tool-schema.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

// -----------------------------------------------------------------------
// Fixture builders
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
  return { type: 'tool_use', id: 'tu-1', name: OLUMI_ACTION_TOOL_NAME, input: input as Record<string, unknown> };
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
    model: 'claude-sonnet-4-6',
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
// Happy paths
// -----------------------------------------------------------------------

describe('routeWithToolUse — happy paths', () => {
  it('tool call response yields a RoutingResult with proposal + orientationText', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(
          mkResult([textBlock('Running analysis on your current scenario...'), toolCallBlock(VALID_EXECUTE_INPUT)]),
        ),
    };

    const result = await routeWithToolUse(minimalContextPack(), 'run analysis', {
      requestId: 'req-1',
      adapter,
    });

    expect(result.type).toBe('tool_call');
    if (result.type === 'tool_call') {
      expect(result.proposal.intent_class).toBe('execute');
      expect(result.orientationText).toBe('Running analysis on your current scenario...');
      expect(result.llmCallCount).toBe(1);
    }
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
  });

  it('text-only response yields a RoutingResult with inferredIntent "converse"', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([textBlock('Hello — how can I help?')], 'end_turn')),
    };

    const result = await routeWithToolUse(minimalContextPack(), 'hi', {
      requestId: 'req-2',
      adapter,
    });

    expect(result.type).toBe('text_only');
    if (result.type === 'text_only') {
      expect(result.inferredIntent).toBe('converse');
      expect(result.text).toBe('Hello — how can I help?');
    }
  });

  it('passes the routing system prompt + olumi_action tool on the adapter call', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([textBlock('ok')], 'end_turn')),
    };

    await routeWithToolUse(minimalContextPack(), 'hi', { requestId: 'req-3', adapter });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    const args = adapter.chatWithTools.mock.calls[0]![0];
    expect(args.system).toBe(ROUTING_SYSTEM_PROMPT);
    expect(args.tools.length).toBe(1);
    expect(args.tools[0]!.name).toBe(OLUMI_ACTION_TOOL_NAME);
    expect(args.tool_choice).toEqual({ type: 'auto' });
  });

  it('serialises the ContextPack fields into the user message', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([textBlock('ok')], 'end_turn')),
    };

    await routeWithToolUse(minimalContextPack(), 'hi', { requestId: 'req-4', adapter });

    const args = adapter.chatWithTools.mock.calls[0]![0];
    const userContent = args.messages[0]!.content;
    expect(typeof userContent).toBe('string');
    expect(userContent).toContain('## ContextPack');
    expect(userContent).toContain('"version": "2.0"');
    expect(userContent).toContain('## User turn');
    expect(userContent).toContain('hi');
  });

  // V5 product-state continuity (foamy-bee tranche) — recent_changes
  // must survive `buildUserMessage`'s display-safe transform and reach
  // the JSON Sonnet actually receives. The transform strips raw
  // `analysis` and `graph` and substitutes display-safe variants;
  // `recent_changes` falls into the rest-spread and must be preserved
  // unchanged.
  it('serialised user message includes recent_changes verbatim with structured target_label and clean summary', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([textBlock('ok')], 'end_turn')),
    };

    const pack = assembleContextPack({
      payload: makeMessagePayload({
        turn_id: 't-rc',
        scenario_id: 'scen-rc',
        message: 'placeholder',
        turn_class: 'frame',
        stage: 'analyse',
      }),
      priorTurns: [],
      priorFacts: [
        {
          fact_type: 'add_constraint',
          fact_version: 1,
          noop: false,
          result: {
            target_id: 'gc-llm-1',
            status: 'applied',
            before: null,
            after: {
              constraint_id: 'gc-llm-1',
              node_id: 'factor_total_cost',
              operator: '<=',
              value: 50000,
              label: 'Total cost',
              unit: '£',
              provenance: 'explicit',
            },
          },
        },
      ],
    });

    await routeWithToolUse(pack, 'What update did you make?', {
      requestId: 'req-recent-changes',
      adapter,
    });

    const args = adapter.chatWithTools.mock.calls[0]![0];
    const userContent = args.messages[0]!.content as string;

    // The clean summary survives the transform and reaches Sonnet.
    expect(userContent).toContain(
      'Added constraint: Total cost must be at most £50,000.',
    );
    // The structured target_label field survives — future deterministic
    // copy paths (re-run-analysis chip body, follow-up receipts) can
    // reference it without parsing the summary string.
    expect(userContent).toContain('"target_label": "Total cost"');
    // No raw structural identifiers leak into the LLM payload — the
    // projection drops them at source (recent-changes.ts).
    expect(userContent).not.toContain('gc-llm-1');
    expect(userContent).not.toContain('factor_total_cost');
    expect(userContent).not.toContain('"constraint_id"');
    expect(userContent).not.toContain('"node_id"');
    expect(userContent).not.toContain('"provenance"');
  });

  // brief brief-display-safe-analysis A2 — outbound payload assertion
  it('serialised user message contains display-safe analysis only — no raw analysis floats', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([textBlock('ok')], 'end_turn')),
    };

    // Graph fixture deliberately carries edge `strength.mean` and other
    // raw coefficients on edges, so the scoped-analysis assertions below
    // are proven robust: a naive un-scoped substring check would fail on
    // these legitimate graph fields, but the brace-walked analysis slice
    // must NOT pick them up.
    const graph = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Maximise revenue' },
        { id: 'budget', kind: 'factor', label: 'Budget' },
        { id: 'opt-a', kind: 'option', label: 'Option A' },
        { id: 'opt-b', kind: 'option', label: 'Option B' },
      ],
      edges: [
        // Real edge with structural coefficients — these MUST appear
        // in the graph section but MUST NOT appear in the analysis slice.
        { from: 'budget', to: 'goal', strength: { mean: 0.55, std: 0.12 }, exists_probability: 0.91 },
        { from: 'opt-a', to: 'budget', strength: { mean: 0.733, std: 0.04 }, exists_probability: 0.99 },
      ],
    };
    const pack = assembleContextPack({
      payload: {
        turn_id: 't-da-01',
        scenario_id: 'scen-display-safe',
        message: 'How is option A doing?',
        turn_class: 'analyse',
        stage: 'analyse',
      },
      priorTurns: [],
      graph,
      analysis: {
        winner: { option_id: 'opt-a', option_label: 'Option A', win_probability: 0.862 },
        options: [
          { option_id: 'opt-a', option_label: 'Option A', win_probability: 0.862, outcome_mean: 100 },
          { option_id: 'opt-b', option_label: 'Option B', win_probability: 0.791, outcome_mean: 80 },
        ],
        top_drivers: [
          { factor_id: 'price', factor_label: 'Price', sensitivity: 1.0, direction: 'positive' },
          { factor_id: 'demand', factor_label: 'Demand', sensitivity: 0.4, direction: 'negative' },
        ],
        robustness_level: 'moderate',
        fragile_edge_count: 1,
        top_fragile_edges: [{ from_label: 'Marketing Spend', to_label: 'New Leads' }],
        margin: 0.071,
        margin_pp: 7.1,
        analysis_status: 'complete',
      },
    });

    await routeWithToolUse(pack, 'How is option A doing?', { requestId: 'req-display-safe', adapter });

    const args = adapter.chatWithTools.mock.calls[0]![0];
    const userContent = args.messages[0]!.content as string;

    // Locate the analysis object and walk braces to its matching close,
    // so subsequent assertions are scoped to the analysis section only.
    // (The graph section legitimately carries `strength` / `mean` fields
    // on edges; only the analysis section is the LLM-display boundary
    // this brief is policing.)
    const analysisKeyStart = userContent.indexOf('"analysis":');
    expect(analysisKeyStart).toBeGreaterThan(-1);
    const objectStart = userContent.indexOf('{', analysisKeyStart);
    expect(objectStart).toBeGreaterThan(analysisKeyStart);
    let depth = 0;
    let objectEnd = -1;
    for (let i = objectStart; i < userContent.length; i++) {
      const ch = userContent[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          objectEnd = i + 1;
          break;
        }
      }
    }
    expect(objectEnd).toBeGreaterThan(objectStart);
    const analysisSection = userContent.slice(objectStart, objectEnd);

    // Sonnet must see decision-language values inside the analysis section.
    expect(analysisSection).toContain('"win_probability": "86%"');
    expect(analysisSection).toContain('"win_probability": "79%"');
    expect(analysisSection).toContain('"margin": "7 percentage points"');
    expect(analysisSection).toContain('"influence": "very strong positive influence"');
    expect(analysisSection).toContain('"influence": "moderate negative influence"');
    expect(analysisSection).toContain('"from_label": "Marketing Spend"');

    // Sonnet must NOT see raw analysis floats or internal coefficients
    // anywhere inside the analysis section.
    expect(analysisSection).not.toContain('0.862');
    expect(analysisSection).not.toContain('0.791');
    expect(analysisSection).not.toContain('"sensitivity_value"');
    expect(analysisSection).not.toContain('"probability":');
    expect(analysisSection).not.toContain('"strength"');
    expect(analysisSection).not.toContain('"mean":');
    expect(analysisSection).not.toContain('mean=');
    expect(analysisSection).not.toContain('exists_probability');

    // Targeted invariant from the brief: no raw decimal floats anywhere
    // inside the serialised analysis object.
    expect(analysisSection).not.toMatch(/\b0\.\d{2,}/);

    // Sanity check the test is not trivially satisfied: the brace-walked
    // extraction must actually be isolating a sub-slice, not the whole
    // user message. Brief A2.1 stripped raw `strength` / `exists` from
    // the graph section as well, so the legacy "raw decimals must exist
    // outside the slice" check no longer applies — the routing prompt
    // and CQE block are now the only sources of decimal-bearing content.
    // We assert instead that the analysis slice is strictly smaller than
    // the user content (proves we extracted, not echoed) and that
    // surrounding sections (`graph`, `conversation`) survive outside it.
    expect(analysisSection.length).toBeLessThan(userContent.length);
    expect(userContent).toContain('"graph":');
    expect(userContent).toContain('"conversation":');
  });
});

// -----------------------------------------------------------------------
// Error paths — every path is typed; no raw error leaks
// -----------------------------------------------------------------------

describe('routeWithToolUse — error paths', () => {
  it('UpstreamTimeoutError from adapter → RoutingError{cause:"timeout"}', async () => {
    const adapter = {
      chatWithTools: vi.fn().mockRejectedValueOnce(new UpstreamTimeoutError('read timeout')),
    };

    await expect(
      routeWithToolUse(minimalContextPack(), 'x', { requestId: 'req-t', adapter }),
    ).rejects.toMatchObject({ name: 'RoutingError', cause: 'timeout' });
  });

  it('AbortSignal abort from adapter → RoutingError{cause:"aborted"}', async () => {
    const abortErr = Object.assign(new Error('abort'), { name: 'AbortError' });
    const adapter = { chatWithTools: vi.fn().mockRejectedValueOnce(abortErr) };

    await expect(
      routeWithToolUse(minimalContextPack(), 'x', { requestId: 'req-a', adapter }),
    ).rejects.toMatchObject({ name: 'RoutingError', cause: 'aborted' });
  });

  it('UpstreamHTTPError from adapter → RoutingError{cause:"api_error"} with provider_message', async () => {
    const httpErr = new UpstreamHTTPError('5xx status', { status: 502 } as never);
    const adapter = { chatWithTools: vi.fn().mockRejectedValueOnce(httpErr) };

    let caught: unknown;
    try {
      await routeWithToolUse(minimalContextPack(), 'x', { requestId: 'req-h', adapter });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RoutingError);
    expect((caught as RoutingError).cause).toBe('api_error');
    expect((caught as RoutingError).provider_message).toBe('5xx status');
  });

  it('generic Error from adapter still produces a typed RoutingError (no raw leak)', async () => {
    const adapter = { chatWithTools: vi.fn().mockRejectedValueOnce(new Error('weird')) };

    await expect(
      routeWithToolUse(minimalContextPack(), 'x', { requestId: 'req-g', adapter }),
    ).rejects.toBeInstanceOf(RoutingError);
  });

  it('non-Error thrown value still produces a typed RoutingError', async () => {
    const adapter = { chatWithTools: vi.fn().mockRejectedValueOnce('string not error') };

    await expect(
      routeWithToolUse(minimalContextPack(), 'x', { requestId: 'req-s', adapter }),
    ).rejects.toBeInstanceOf(RoutingError);
  });

  it('max_tokens stop reason → RoutingError{cause:"unexpected_stop_reason"}', async () => {
    const adapter = {
      chatWithTools: vi.fn().mockResolvedValueOnce(mkResult([textBlock('partial')], 'max_tokens')),
    };

    let caught: unknown;
    try {
      await routeWithToolUse(minimalContextPack(), 'x', { requestId: 'req-mx', adapter });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RoutingError);
    expect((caught as RoutingError).cause).toBe('unexpected_stop_reason');
  });

  it('empty response (no text, no tool) → RoutingError{cause:"empty_response"}', async () => {
    const adapter = { chatWithTools: vi.fn().mockResolvedValueOnce(mkResult([], 'end_turn')) };

    await expect(
      routeWithToolUse(minimalContextPack(), 'x', { requestId: 'req-e', adapter }),
    ).rejects.toMatchObject({ name: 'RoutingError', cause: 'empty_response' });
  });

  it('wrong tool name called by Sonnet → RoutingError{cause:"api_error"}', async () => {
    const adapter = {
      chatWithTools: vi
        .fn()
        .mockResolvedValueOnce(
          mkResult([{ type: 'tool_use', id: 'x', name: 'not_olumi_action', input: {} } as ToolResponseBlock]),
        ),
    };

    await expect(
      routeWithToolUse(minimalContextPack(), 'x', { requestId: 'req-w', adapter }),
    ).rejects.toMatchObject({ name: 'RoutingError', cause: 'api_error' });
  });
});

// -----------------------------------------------------------------------
// REPAIR_ONCE
// -----------------------------------------------------------------------

describe('routeWithToolUse — REPAIR_ONCE', () => {
  it('invalid schema on first attempt triggers ONE repair call with structured feedback', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([toolCallBlock({ intent_class: 'execute' /* missing action */ })]))
        .mockResolvedValueOnce(mkResult([toolCallBlock(VALID_EXECUTE_INPUT)])),
    };

    const result = await routeWithToolUse(minimalContextPack(), 'go', {
      requestId: 'req-r',
      adapter,
    });

    expect(result.type).toBe('tool_call');
    if (result.type === 'tool_call') {
      // Improvement-1: count must reflect both attempts
      expect(result.llmCallCount).toBe(2);
    }
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2);

    // Repair messages must include tool_result blocks matching the tool_use IDs
    const repairArgs = adapter.chatWithTools.mock.calls[1]![0];
    const messages = repairArgs.messages;

    // assistant message at index 1 should contain the tool_use block
    const assistantMsg = messages[1]!;
    expect(assistantMsg.role).toBe('assistant');
    const assistantContent = assistantMsg.content as ToolResponseBlock[];
    const toolUseBlock = assistantContent.find((b) => b.type === 'tool_use');
    expect(toolUseBlock).toBeDefined();

    // user message at index 2 should contain a tool_result with matching ID
    const userMsg = messages[2]!;
    expect(userMsg.role).toBe('user');
    expect(Array.isArray(userMsg.content)).toBe(true);
    const userContent = userMsg.content as ToolResponseBlock[];
    const toolResultBlock = userContent.find((b) => b.type === 'tool_result');
    expect(toolResultBlock).toBeDefined();
    if (toolResultBlock?.type === 'tool_result' && toolUseBlock?.type === 'tool_use') {
      expect(toolResultBlock.tool_use_id).toBe(toolUseBlock.id);
      expect(toolResultBlock.is_error).toBe(true);
      expect(typeof toolResultBlock.content).toBe('string');
      expect(toolResultBlock.content).toContain('Validation failed');
    }
  });

  it('second schema failure → RoutingError{cause:"schema_repair_failed"}', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([toolCallBlock({ intent_class: 'execute' })]))
        .mockResolvedValueOnce(mkResult([toolCallBlock({ intent_class: 'clarify' })])), // still wrong
    };

    await expect(
      routeWithToolUse(minimalContextPack(), 'x', { requestId: 'req-r2', adapter }),
    ).rejects.toMatchObject({ name: 'RoutingError', cause: 'schema_repair_failed' });
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2);
  });

  it('abort during the repair call also produces a typed RoutingError', async () => {
    const abortErr = Object.assign(new Error('abort'), { name: 'AbortError' });
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([toolCallBlock({ intent_class: 'execute' /* missing action */ })]))
        .mockRejectedValueOnce(abortErr),
    };

    await expect(
      routeWithToolUse(minimalContextPack(), 'x', { requestId: 'req-r3', adapter }),
    ).rejects.toMatchObject({ name: 'RoutingError', cause: 'aborted' });
  });

  it('includes tool_result for each tool_use when multiple are returned', async () => {
    const multiToolContent: ToolResponseBlock[] = [
      { type: 'tool_use', id: 'tu-A', name: OLUMI_ACTION_TOOL_NAME, input: { intent_class: 'execute' } },
      { type: 'tool_use', id: 'tu-B', name: OLUMI_ACTION_TOOL_NAME, input: { intent_class: 'execute' } },
    ];
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult(multiToolContent))
        .mockResolvedValueOnce(mkResult([toolCallBlock(VALID_EXECUTE_INPUT)])),
    };

    await routeWithToolUse(minimalContextPack(), 'go', { requestId: 'req-multi', adapter });

    const repairArgs = adapter.chatWithTools.mock.calls[1]![0];
    const userMsg = repairArgs.messages[2]!;
    expect(Array.isArray(userMsg.content)).toBe(true);
    const userContent = userMsg.content as ToolResponseBlock[];
    const resultBlocks = userContent.filter((b) => b.type === 'tool_result');
    expect(resultBlocks).toHaveLength(2);
    const resultIds = resultBlocks.map((b) => b.type === 'tool_result' ? b.tool_use_id : '');
    expect(resultIds).toContain('tu-A');
    expect(resultIds).toContain('tu-B');
    expect(new Set(resultIds).size).toBe(2);
  });

  it('does not insert tool_result when first call returns valid tool_use', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([toolCallBlock(VALID_EXECUTE_INPUT)])),
    };

    const result = await routeWithToolUse(minimalContextPack(), 'go', { requestId: 'req-noop', adapter });

    expect(result.type).toBe('tool_call');
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
  });

  it('stops after one repair attempt and returns failure envelope', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([toolCallBlock({ intent_class: 'execute' })]))
        .mockResolvedValueOnce(mkResult([toolCallBlock({ intent_class: 'execute' })])),
    };

    await expect(
      routeWithToolUse(minimalContextPack(), 'x', { requestId: 'req-ceil', adapter }),
    ).rejects.toMatchObject({ name: 'RoutingError', cause: 'schema_repair_failed' });
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2);
  });
});

// -----------------------------------------------------------------------
// assertAnthropicMessageProtocol
// -----------------------------------------------------------------------

describe('assertAnthropicMessageProtocol', () => {
  it('catches missing tool_result after assistant tool_use', () => {
    const messages: ChatWithToolsArgs['messages'] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu-1', name: 'olumi_action', input: {} },
        ],
      },
      { role: 'user', content: 'next turn' },
    ];
    expect(() => assertAnthropicMessageProtocol(messages)).toThrow(
      /tool_use tu-1 has no matching tool_result/,
    );
  });

  it('catches duplicate tool_result IDs', () => {
    const messages: ChatWithToolsArgs['messages'] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu-1', name: 'olumi_action', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'ok', is_error: false },
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'dup', is_error: false },
        ],
      },
    ];
    expect(() => assertAnthropicMessageProtocol(messages)).toThrow(
      /duplicate tool_result IDs/,
    );
  });

  it('catches missing user message after assistant tool_use at end', () => {
    const messages: ChatWithToolsArgs['messages'] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu-1', name: 'olumi_action', input: {} },
        ],
      },
    ];
    expect(() => assertAnthropicMessageProtocol(messages)).toThrow(
      /not followed by user message/,
    );
  });

  it('passes valid sequence: user → assistant(tool_use) → user(tool_result) → assistant(text)', () => {
    const messages: ChatWithToolsArgs['messages'] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu-1', name: 'olumi_action', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'ok', is_error: false },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ];
    expect(() => assertAnthropicMessageProtocol(messages)).not.toThrow();
  });

  it('passes when assistant message has no tool_use blocks', () => {
    const messages: ChatWithToolsArgs['messages'] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] },
    ];
    expect(() => assertAnthropicMessageProtocol(messages)).not.toThrow();
  });

  it('catches orphaned tool_result with no matching tool_use', () => {
    const messages: ChatWithToolsArgs['messages'] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu-1', name: 'olumi_action', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'ok' },
          { type: 'tool_result', tool_use_id: 'tu-orphan', content: 'no match' },
        ],
      },
    ];
    expect(() => assertAnthropicMessageProtocol(messages)).toThrow(
      /tool_result tu-orphan.*has no matching tool_use/,
    );
  });
});
