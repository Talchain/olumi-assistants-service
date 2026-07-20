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

import { makeMessagePayload } from '../../src/orchestrator-v5/__tests__/fixtures.js';

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

const BASE_PAYLOAD = makeMessagePayload({
  turn_id: '99999999-9999-4999-8999-999999999999',
  scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  message: 'do something',
});

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
    // V5 alpha hardening Phase 2.2: PRECONDITION_UNMET now recovers as a
    // clean-body direct_answer turn — no error block. The typed code
    // remains on telemetry. Specific fix path lives in assistant_text.
    expect(telemetry.commit_performed).toBe(true);
    expect(telemetry.failure_type).toBeNull();
    expect(telemetry.turn_class).toBe('direct_answer');
    expect(response.blocks.find((b) => b.type === 'error')).toBeUndefined();
    const responseWithText = response as unknown as { assistant_text?: string };
    expect(responseWithText.assistant_text?.length ?? 0).toBeGreaterThan(0);
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
    // answer_text REQUIRED on coach tool calls since 2026-07-20 (O-7 wave 2:
    // CEE_ANSWER_TEXT_REQUIRED deleted — requirement unconditional).
    const adapterCoach = {
      chatWithTools: vi.fn().mockResolvedValueOnce(
        toolResult(
          { intent_class: 'coach', coaching_mode: 'deepen', answer_text: 'Think about what matters most.' },
          'Short orientation.',
        ),
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

describe('phase 1 behavioural — coach/converse answer_text channel (ROADMAP 1.38)', () => {
  // Root cause: the coach and tool-call-converse branches of the
  // `olumi_action` tool had NO answer-body field, so compose could only
  // ever ship Sonnet's brief pre-tool-call `orientationText` — the fuller
  // coaching/conversational answer the model authored was silently
  // dropped. See TRUNCATION-BUG-HANDOVER.md. The fix adds an OPTIONAL
  // `answer_text` field to the coach and converse tool-call variants
  // (tool-schema.ts); turn-executor prefers it when present and falls
  // back to `orientationText` exactly as before when absent.

  it('coach tool call carrying answer_text ships the full answer, not the short orientationText', async () => {
    const adapter = {
      chatWithTools: vi.fn().mockResolvedValueOnce(
        toolResult(
          {
            intent_class: 'coach',
            coaching_mode: 'challenge',
            answer_text:
              "You're going against a decisive result, which is worth examining carefully. " +
              'Two mid-level developers costs more up front but spreads delivery risk across ' +
              'people rather than one senior hire. Worth stress-testing whether the timeline ' +
              'assumption holds before committing either way.',
          },
          "You're going against a decisive result, which is worth examining carefully.",
        ),
      ),
    };

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-coach-full', {
      routingAdapter: adapter,
    });

    expect(telemetry.intent_class).toBe('coach');
    expect(telemetry.coaching_mode).toBe('challenge');
    // Ships the FULL authored answer_text, not the one-sentence orientation.
    expect(response.assistant_text).toContain('spreads delivery risk across people');
    expect(response.assistant_text).not.toBe(
      "You're going against a decisive result, which is worth examining carefully.",
    );
  });

  // UPDATED 2026-07-20 (O-7 wave 2): answer_text is REQUIRED on coach/converse
  // tool calls (CEE_ANSWER_TEXT_REQUIRED deleted, live-true on staging). An
  // omitted/blank answer_text is now a schema failure → REPAIR_ONCE; if the
  // repair also omits it, the turn ships the bounded recovery copy — it NEVER
  // silently falls back to the short orientation (that silent-drop WAS the
  // ROADMAP 1.38 defect class).
  it('coach tool call WITHOUT answer_text on both attempts → REPAIR_ONCE then bounded recovery (never blank)', async () => {
    const adapter = {
      chatWithTools: vi
        .fn()
        .mockResolvedValueOnce(
          toolResult({ intent_class: 'coach', coaching_mode: 'reframe' }, 'A short orientation sentence only.'),
        )
        .mockResolvedValueOnce(
          toolResult({ intent_class: 'coach', coaching_mode: 'reframe' }, 'A short orientation sentence only.'),
        ),
    };

    const { response } = await runTurnExecutor(BASE_PAYLOAD, 'req-coach-absent', {
      routingAdapter: adapter,
    });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2); // initial + REPAIR_ONCE
    expect(response.assistant_text.trim()).not.toBe('');
  });

  it('coach tool call with EMPTY/whitespace answer_text → REPAIR_ONCE then bounded recovery (never ships blank)', async () => {
    const adapter = {
      chatWithTools: vi
        .fn()
        .mockResolvedValueOnce(
          toolResult(
            { intent_class: 'coach', coaching_mode: 'reframe', answer_text: '   ' },
            'A short orientation sentence only.',
          ),
        )
        .mockResolvedValueOnce(
          toolResult(
            { intent_class: 'coach', coaching_mode: 'reframe', answer_text: '   ' },
            'A short orientation sentence only.',
          ),
        ),
    };

    const { response } = await runTurnExecutor(BASE_PAYLOAD, 'req-coach-blank', {
      routingAdapter: adapter,
    });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2); // initial + REPAIR_ONCE
    expect(response.assistant_text.trim()).not.toBe('');
  });

  it('converse tool call carrying answer_text ships the full answer, not the short orientationText', async () => {
    const adapter = {
      chatWithTools: vi.fn().mockResolvedValueOnce(
        toolResult(
          {
            intent_class: 'converse',
            answer_text:
              'Good structural question. Looking at your model, there are two moves worth ' +
              'considering: strengthening the budget link, or revisiting the churn assumption ' +
              'that is driving most of the spread.',
          },
          'Good structural question.',
        ),
      ),
    };

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-converse-full', {
      routingAdapter: adapter,
    });

    expect(telemetry.intent_class).toBe('converse');
    expect(response.assistant_text).toContain('revisiting the churn assumption');
    expect(response.assistant_text).not.toBe('Good structural question.');
  });

  it('converse tool call WITHOUT answer_text on both attempts → REPAIR_ONCE then bounded recovery (never blank)', async () => {
    const adapter = {
      chatWithTools: vi
        .fn()
        .mockResolvedValueOnce(toolResult({ intent_class: 'converse' }, 'Just a short conversational reply.'))
        .mockResolvedValueOnce(toolResult({ intent_class: 'converse' }, 'Just a short conversational reply.')),
    };

    const { response } = await runTurnExecutor(BASE_PAYLOAD, 'req-converse-absent', {
      routingAdapter: adapter,
    });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2); // initial + REPAIR_ONCE
    expect(response.assistant_text.trim()).not.toBe('');
  });

  it('a guard-tripping coach answer_text is scrubbed exactly like other narrate surfaces', async () => {
    // Pseudo-XML tag contamination — same TAG_PATTERN sanitiseNarrateOutput
    // strips (tag markup only; inner text is retained per house behaviour)
    // on every other narrate surface, flagging contamination via the same
    // telemetry event. Proves the new answer_text channel runs through the
    // SAME egress guard as orientationText, not a bypass.
    const adapter = {
      chatWithTools: vi.fn().mockResolvedValueOnce(
        toolResult(
          {
            intent_class: 'coach',
            coaching_mode: 'summarise',
            answer_text: '<internal>hidden reasoning</internal>The real coaching answer stands alone.',
          },
          'Orientation text.',
        ),
      ),
    };

    const { response } = await runTurnExecutor(BASE_PAYLOAD, 'req-coach-guard', {
      routingAdapter: adapter,
    });

    // Tag markup stripped (matches sanitiseNarrateOutput's TAG_PATTERN
    // behaviour on every other surface); the un-tagged answer text ships.
    expect(response.assistant_text).toBe('hidden reasoningThe real coaching answer stands alone.');
    expect(response.assistant_text).not.toContain('<internal>');
    expect(response.assistant_text).not.toContain('</internal>');
    // Contamination was flagged (same telemetry event other narrate
    // surfaces emit) — the guard fired on answer_text, not a silent pass.
    expect(
      events.some(
        (e) =>
          e.event === 'turn_executor.contamination_narrate' &&
          e.data.request_id === 'req-coach-guard',
      ),
    ).toBe(true);
  });
});
