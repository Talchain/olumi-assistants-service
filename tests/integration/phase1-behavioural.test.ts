/**
 * Phase 1 — Behavioural guarantees (Suite E).
 *
 * Assertions about how the system behaves, not just about which APIs are
 * called. Covers:
 *   - right-tool-for-job: validator accepts/rejects based on handler declarations
 *   - blocked state → RECOVER with specific fix path in error details
 *   - unresolved entity → clarification with candidates
 *   - coach vs converse distinction in telemetry (Phase 2 measurability)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../src/utils/telemetry.js';
import type {
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../src/adapters/llm/types.js';

vi.mock('../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../../src/orchestrator-v5/turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../../src/orchestrator-v5/routing/tool-schema.js');

const BASE_PAYLOAD: OrchestratorTurnPayload = {
  turn_id: '99999999-9999-4999-8999-999999999999',
  scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  message: 'do something',
  turn_class: 'frame',
  stage: 'frame',
};

function textResult(text: string): ChatWithToolsResult {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 5, output_tokens: 5 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 20,
  };
}

function toolResult(input: unknown, prefaceText?: string): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [];
  if (prefaceText) content.push({ type: 'text', text: prefaceText });
  content.push({
    type: 'tool_use',
    id: 'tu-1',
    name: OLUMI_ACTION_TOOL_NAME,
    input: input as Record<string, unknown>,
  });
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 5, output_tokens: 5 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 20,
  };
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
});

describe('phase 1 behavioural — right-tool-for-job', () => {
  it('"set churn to 5%" routed to a parameter handler validates; routed to run_analysis mismatches by entity kind', async () => {
    // Right tool: Sonnet routes "set churn" to set_factor_value with a node entity.
    // Use a validation registry that only has set_factor_value.
    const graphLookup = {
      findEntityById: () => ({ id: 'n-churn', kind: 'node' as never, label: 'Customer Churn' }),
      listEntitiesByKind: () => [{ id: 'n-churn', label: 'Customer Churn' }],
    };

    const validationRegistry = {
      set_factor_value: {
        handler_id: 'set_factor_value',
        accepted_entity_kinds: ['node'] as const,
        confirmation_template: 'Updated the factor value.',
      },
    } as never;

    const handlerRegistry = new Map([
      ['set_factor_value', (async () => ({
        assistant_text: 'Updated.',
        handler_facts: [],
        llm_calls_used: 0,
      })) as never],
    ]) as unknown as Parameters<typeof runTurnExecutor>[2]['handlerRegistry'];

    const adapterRight = {
      chatWithTools: vi.fn().mockResolvedValueOnce(
        toolResult({
          intent_class: 'execute',
          action: {
            handler_id: 'set_factor_value',
            entity: {
              id: 'n-churn',
              kind: 'node',
              resolution_status: 'resolved',
              resolution_method: 'id_match',
            },
            parameters: [{ name: 'value', value: 0.05, source: 'user_explicit' }],
            cited_context_fields: ['graph.nodes'],
          },
        }),
      ),
    };
    const rightTool = await runTurnExecutor(BASE_PAYLOAD, 'req-rt-right', {
      routingAdapter: adapterRight,
      handlerRegistry,
      validationRegistry,
      graphLookup,
    });
    expect(rightTool.telemetry.failure_type).toBeNull();
    expect(rightTool.telemetry.intent_class).toBe('execute');

    // Wrong tool: same message but Sonnet mistakenly routes to a handler
    // that doesn't accept node entities → validation rejects.
    const validationRegistryWithRunAnalysis = {
      run_analysis: {
        handler_id: 'run_analysis',
        accepted_entity_kinds: ['option', 'goal'] as const,
        confirmation_template: 'Ran analysis.',
      },
    } as never;

    const adapterWrong = {
      chatWithTools: vi.fn().mockResolvedValueOnce(
        toolResult({
          intent_class: 'execute',
          action: {
            handler_id: 'run_analysis',
            entity: {
              id: 'n-churn',
              kind: 'node', // run_analysis doesn't accept node
              resolution_status: 'resolved',
              resolution_method: 'id_match',
            },
            parameters: [{ name: 'value', value: 0.05, source: 'user_explicit' }],
            cited_context_fields: [],
          },
        }),
      ),
    };
    const wrongTool = await runTurnExecutor(BASE_PAYLOAD, 'req-rt-wrong', {
      routingAdapter: adapterWrong,
      handlerRegistry,
      validationRegistry: validationRegistryWithRunAnalysis,
      graphLookup,
    });
    expect(wrongTool.telemetry.validation_error_code).toBe('ENTITY_KIND_MISMATCH');
  });
});

describe('phase 1 behavioural — blocked state / unresolved entity', () => {
  it('PRECONDITION_UNMET produces a specific fix path in details.reason, not a generic error', async () => {
    const graphLookup = {
      findEntityById: () => ({ id: 'n-blk', kind: 'node' as never, label: 'Blocked Factor' }),
      listEntitiesByKind: () => [{ id: 'n-blk', label: 'Blocked Factor' }],
    };

    const validationRegistry = {
      set_factor_value: {
        handler_id: 'set_factor_value',
        accepted_entity_kinds: ['node'] as const,
        preconditions: ({ entity }: { entity: { label?: string } }) => {
          if (entity.label === 'Blocked Factor') {
            return { ok: false as const, reason: 'factor is frozen by user edit' };
          }
          return { ok: true as const };
        },
        confirmation_template: 'Updated.',
      },
    } as never;

    const adapter = {
      chatWithTools: vi.fn().mockResolvedValueOnce(
        toolResult({
          intent_class: 'execute',
          action: {
            handler_id: 'set_factor_value',
            entity: {
              id: 'n-blk',
              kind: 'node',
              label: 'Blocked Factor',
              resolution_status: 'resolved',
              resolution_method: 'id_match',
            },
            parameters: [{ name: 'value', value: 0.1, source: 'user_explicit' }],
            cited_context_fields: [],
          },
        }),
      ),
    };

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-blk', {
      routingAdapter: adapter,
      validationRegistry,
      graphLookup,
    });

    OlumiResponseSchema.parse(response);
    expect(telemetry.validation_error_code).toBe('PRECONDITION_UNMET');
    const block = response.blocks[0]!;
    if (block.type === 'error') {
      // Specific fix path — not a generic error
      expect(block.details).toMatchObject({ cause_kind: 'validation_failed' });
      expect((block.details as { reason: string }).reason).toMatch(/frozen/);
    }
  });

  it('clarify intent surfaces candidates so user can disambiguate', async () => {
    const adapter = {
      chatWithTools: vi.fn().mockResolvedValueOnce(
        toolResult({
          intent_class: 'clarify',
          clarification: {
            ambiguity_type: 'entity',
            question: 'Which factor did you mean?',
            candidates: [
              { id: 'f-churn', label: 'Customer Churn' },
              { id: 'f-cac', label: 'Customer Acquisition Cost' },
            ],
          },
        }),
      ),
    };

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-cl-b', {
      routingAdapter: adapter,
    });

    OlumiResponseSchema.parse(response);
    expect(telemetry.intent_class).toBe('clarify');
    expect(response.assistant_text).toBe('Which factor did you mean?');
  });
});

describe('phase 1 behavioural — coach vs converse distinction', () => {
  it('intent_class="coach" is logged distinctly from "converse" on text-only turns', async () => {
    // Same user-facing text, different intent classification:
    //   - Tool-call with intent_class="coach" (+coaching_mode)
    //   - Text-only response (inferred "converse")
    // The two MUST be distinguishable in telemetry for Phase 2 evaluation.
    const adapterCoach = {
      chatWithTools: vi.fn().mockResolvedValueOnce(
        toolResult({ intent_class: 'coach', coaching_mode: 'deepen' }, 'Think about what matters most.'),
      ),
    };
    const adapterConverse = {
      chatWithTools: vi.fn().mockResolvedValueOnce(textResult('Think about what matters most.')),
    };

    const coachRun = await runTurnExecutor(BASE_PAYLOAD, 'req-co', { routingAdapter: adapterCoach });
    const converseRun = await runTurnExecutor(BASE_PAYLOAD, 'req-cv', { routingAdapter: adapterConverse });

    // Runtime text identical
    expect(coachRun.response.assistant_text).toBe('Think about what matters most.');
    expect(converseRun.response.assistant_text).toBe('Think about what matters most.');

    // Intent classification DISTINCT
    expect(coachRun.telemetry.intent_class).toBe('coach');
    expect(converseRun.telemetry.intent_class).toBe('converse');

    // Coaching mode metadata only on coach
    expect(coachRun.telemetry.coaching_mode).toBe('deepen');
    expect(converseRun.telemetry.coaching_mode).toBeNull();

    // turn_class is the same (direct_answer) — runtime behaviour matches
    expect(coachRun.telemetry.turn_class).toBe(converseRun.telemetry.turn_class);
  });
});
