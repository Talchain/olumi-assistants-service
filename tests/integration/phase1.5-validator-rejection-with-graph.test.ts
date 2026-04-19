/**
 * Phase 1.5 — Validator rejection with a real graph (D6 Suite 2).
 *
 * Each test exercises one validator error code end-to-end and asserts the
 * MUST-PASS behavioural quality signals from plan D6:
 *
 *   • ENTITY_NOT_FOUND          — structured details name the missing entity
 *   • PRECONDITION_UNMET (distinguish no_options_defined vs
 *                                    options_lack_intervention_data)
 *   • ENTITY_RESOLUTION_SUSPICIOUS — details carry both candidates
 *   • ENTITY_RESOLUTION_AMBIGUOUS  — must short-circuit, handler never runs
 *   • No raw internal text leaks to assistant_text
 *
 * Tests use runTurnExecutor directly (faster, narrower assertions); the HTTP
 * boundary is covered in phase1.5-graph-routing.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../src/utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../src/adapters/llm/types.js';
import type { GraphV3T } from '../../src/schemas/cee-v3.js';

vi.mock('../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ scope: {}, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../../src/orchestrator-v5/turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../../src/orchestrator-v5/routing/tool-schema.js');

function toolUseResult(input: unknown, orientationText?: string): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [];
  if (orientationText) content.push({ type: 'text', text: orientationText });
  content.push({
    type: 'tool_use',
    id: 'tu-1',
    name: OLUMI_ACTION_TOOL_NAME,
    input: input as Record<string, unknown>,
  });
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function mockAdapter(result: ChatWithToolsResult) {
  return {
    chatWithTools: vi.fn<
      (a: ChatWithToolsArgs, o: { requestId: string }) => Promise<ChatWithToolsResult>
    >().mockResolvedValue(result),
  };
}

const BASE_PAYLOAD: OrchestratorTurnPayload = {
  turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  message: 'run analysis on option A',
  turn_class: 'decide',
  stage: 'analyse',
};

function mkGraph(
  nodes: Array<{ id: string; kind: string; label: string }>,
  options?: Array<Record<string, unknown>>,
): GraphV3T {
  const g = { nodes, edges: [] } as Record<string, unknown>;
  if (options) g.options = options;
  return g as unknown as GraphV3T;
}

function handlerSpy() {
  return vi.fn(async () => ({
    assistant_text: 'handler ran',
    handler_facts: [],
    llm_calls_used: 0,
  }));
}

describe('Phase 1.5 — validator rejection (graph threaded)', () => {
  beforeEach(() => setTestSink(() => {}));
  afterEach(() => setTestSink(null));

  it('ENTITY_NOT_FOUND — details name the missing id, handler never runs, no raw text in assistant_text', async () => {
    const graph = mkGraph(
      [
        { id: 'goal_1', kind: 'goal', label: 'Profit' },
        { id: 'opt_a', kind: 'option', label: 'Expand' },
      ],
      [{ id: 'opt_a', interventions: { fac_1: { value: 1 } } }],
    );
    const handler = handlerSpy();
    const registry = new Map([['run_analysis', handler]]) as unknown as Parameters<typeof runTurnExecutor>[2]['handlerRegistry'];

    const routingAdapter = mockAdapter(
      toolUseResult(
        {
          intent_class: 'execute',
          action: {
            handler_id: 'run_analysis',
            entity: {
              id: 'opt_nonexistent',
              kind: 'option',
              resolution_status: 'resolved',
              resolution_method: 'id_match',
              label: 'Ghost',
            },
            parameters: [],
            cited_context_fields: [],
          },
        },
        'Running analysis',
      ),
    );

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-enf', {
      routingAdapter,
      handlerRegistry: registry,
      graphState: graph,
    });

    expect(telemetry.validation_error_code).toBe('ENTITY_NOT_FOUND');
    expect(handler).not.toHaveBeenCalled();
    // Structured details name the missing entity for UI routing.
    const r = response as {
      assistant_text: string;
      blocks: Array<{ type: string; details?: { entity_id?: string; validation_error_code?: string } }>;
    };
    const errBlock = r.blocks.find((b) => b.type === 'error');
    expect(errBlock?.details?.validation_error_code).toBe('ENTITY_NOT_FOUND');
    expect(errBlock?.details?.entity_id).toBe('opt_nonexistent');
    // assistant_text stays generic — user-facing copy, no internal codes.
    expect(r.assistant_text).not.toContain('opt_nonexistent');
    expect(r.assistant_text).not.toContain('ENTITY_NOT_FOUND');
  });

  it('PRECONDITION_UNMET — no_options_defined when the graph has no option nodes AND no options[]', async () => {
    const graph = mkGraph([{ id: 'goal_1', kind: 'goal', label: 'Profit' }]);
    const routingAdapter = mockAdapter(
      toolUseResult(
        {
          intent_class: 'execute',
          action: {
            handler_id: 'run_analysis',
            entity: {
              id: 'goal_1',
              kind: 'goal',
              resolution_status: 'resolved',
              resolution_method: 'id_match',
              label: 'Profit',
            },
            parameters: [],
            cited_context_fields: [],
          },
        },
        'Running...',
      ),
    );

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-pu1', {
      routingAdapter,
      graphState: graph,
    });

    expect(telemetry.validation_error_code).toBe('PRECONDITION_UNMET');
    const r = response as {
      assistant_text: string;
      blocks: Array<{ type: string; details?: { reason?: string; handler_id?: string } }>;
    };
    const errBlock = r.blocks.find((b) => b.type === 'error');
    expect(errBlock?.details?.reason).toBe('no_options_defined');
    expect(errBlock?.details?.handler_id).toBe('run_analysis');
    // Distinct from the other precondition reason — plan correction #4.
    expect(errBlock?.details?.reason).not.toBe('options_lack_intervention_data');
    expect(r.assistant_text).not.toContain('no_options_defined');
  });

  it('PRECONDITION_UNMET — options_lack_intervention_data when options exist but no interventions configured', async () => {
    const graph = mkGraph([
      { id: 'goal_1', kind: 'goal', label: 'Profit' },
      { id: 'opt_a', kind: 'option', label: 'A' },
      { id: 'opt_b', kind: 'option', label: 'B' },
    ]);
    const routingAdapter = mockAdapter(
      toolUseResult(
        {
          intent_class: 'execute',
          action: {
            handler_id: 'run_analysis',
            entity: {
              id: 'opt_a',
              kind: 'option',
              resolution_status: 'resolved',
              resolution_method: 'id_match',
              label: 'A',
            },
            parameters: [],
            cited_context_fields: [],
          },
        },
        'Running...',
      ),
    );

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-pu2', {
      routingAdapter,
      graphState: graph,
    });

    expect(telemetry.validation_error_code).toBe('PRECONDITION_UNMET');
    const r = response as { blocks: Array<{ type: string; details?: { reason?: string } }> };
    const errBlock = r.blocks.find((b) => b.type === 'error');
    // Distinct from the no-options case.
    expect(errBlock?.details?.reason).toBe('options_lack_intervention_data');
    expect(errBlock?.details?.reason).not.toBe('no_options_defined');
  });

  it('ENTITY_RESOLUTION_SUSPICIOUS — details carry both chosen + closer candidates', async () => {
    // Dice suspicion fires when resolution_method is 'label_match' and a
    // sibling of the same kind has a closer label (Δ ≥ 0.15).
    const graph = mkGraph(
      [
        { id: 'goal_1', kind: 'goal', label: 'Profit' },
        { id: 'opt_a', kind: 'option', label: 'Expand into the United Kingdom' },
        { id: 'opt_b', kind: 'option', label: 'Expand UK' },
      ],
      [{ id: 'opt_a', interventions: { fac_1: { value: 1 } } }],
    );
    const routingAdapter = mockAdapter(
      toolUseResult(
        {
          intent_class: 'execute',
          action: {
            handler_id: 'run_analysis',
            entity: {
              id: 'opt_a',
              kind: 'option',
              resolution_status: 'resolved',
              resolution_method: 'label_match',
              label: 'Expand UK',
            },
            parameters: [],
            cited_context_fields: [],
          },
        },
        'Running...',
      ),
    );

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-susp', {
      routingAdapter,
      graphState: graph,
    });

    expect(telemetry.validation_error_code).toBe('ENTITY_RESOLUTION_SUSPICIOUS');
    const r = response as {
      assistant_text: string;
      blocks: Array<{
        type: string;
        details?: {
          chosen?: { id: string; label: string };
          closer_candidate?: { id: string; label: string };
        };
      }>;
    };
    const errBlock = r.blocks.find((b) => b.type === 'error');
    // Both candidates must be present so UI can render a disambiguation chip.
    expect(errBlock?.details?.chosen?.id).toBe('opt_a');
    expect(errBlock?.details?.closer_candidate?.id).toBe('opt_b');
    expect(errBlock?.details?.closer_candidate?.label).toBe('Expand UK');
    expect(r.assistant_text).not.toContain('opt_b');
  });

  it('ENTITY_RESOLUTION_AMBIGUOUS — handler never runs (regression guard from Phase 1)', async () => {
    const graph = mkGraph([
      { id: 'goal_1', kind: 'goal', label: 'Profit' },
      { id: 'opt_a', kind: 'option', label: 'A' },
    ]);
    const handler = handlerSpy();
    const registry = new Map([['run_analysis', handler]]) as unknown as Parameters<typeof runTurnExecutor>[2]['handlerRegistry'];
    const routingAdapter = mockAdapter(
      toolUseResult(
        {
          intent_class: 'execute',
          action: {
            handler_id: 'run_analysis',
            entity: {
              id: 'opt_a',
              kind: 'option',
              resolution_status: 'ambiguous',
              resolution_method: 'label_match',
              label: 'A',
            },
            parameters: [],
            cited_context_fields: [],
          },
        },
        'Running...',
      ),
    );

    const { telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-amb', {
      routingAdapter,
      handlerRegistry: registry,
      graphState: graph,
    });

    expect(telemetry.validation_error_code).toBe('ENTITY_RESOLUTION_AMBIGUOUS');
    expect(handler).not.toHaveBeenCalled();
  });
});
