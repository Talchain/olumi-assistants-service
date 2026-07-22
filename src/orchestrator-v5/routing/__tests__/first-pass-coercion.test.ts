/**
 * First-pass coercion — repair-tax fix (2026-07-22).
 *
 * The routing tool call's three artifacts had drifted: the served prompt
 * v118 + the descriptive `olumi_action` tool schema instruct the coach to
 * emit fields (a top-level `answer_shape`, free-string `cited_context_fields`,
 * a `parameter_source: "explicit"`) that the enforcing Zod validator
 * (`RawToolCallSchema`) REJECTS on the execute branch. On every forced-pill
 * (execute) turn that rejection cost a ~4-5s REPAIR_ONCE second LLM call that
 * only ever STRIPPED or FIXED those non-load-bearing fields.
 *
 * The fix makes the parse COERCE (never silently — every coercion is
 * telemetered) instead of reject, so the first pass validates and the repair
 * call is not paid. These tests pin:
 *   1. the EXACT first-pass shape the diagnosis names now parses first-pass,
 *      content preserved, with the right drift-alarm events;
 *   2. each coercion in isolation (pure `coerceFirstPassToolCall`);
 *   3. a genuinely malformed execute action STILL rejects → repair intact;
 *   4. non-execute turns are untouched (byte-identical);
 *   5. end-to-end: the shape resolves in ONE LLM call (no repair).
 *
 * See REPAIR-TAX-ROOT-CAUSE-2026-07-22.md.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../../adapters/llm/types.js';
import { assembleContextPack, type ContextPack } from '../../context/context-pack-assembler.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { setTestSink } from '../../../utils/telemetry.js';
import { deriveAnswerTextFromShape } from '../answer-shape.js';
import { routeWithToolUse } from '../route-with-tool-use.js';
import {
  coerceFirstPassToolCall,
  OLUMI_ACTION_TOOL_NAME,
  ToolCallParseError,
  parseToolCallResponse,
} from '../tool-schema.js';

// The stray answer_shape the model authored INSTEAD of putting the answer in
// explanation.answer_text (the prompt drills answer_shape as "the answer
// channel" — the candidate-1 divergence). Valid per AnswerShapeSchema so the
// lift can recover its text.
const STRAY_SHAPE = {
  headline: 'Option A leads on the current analysis.',
  bullets: ['Its margin is comfortable under the robustness band.'],
  detail:
    'Option A wins because the churn driver favours it, and the result holds ' +
    'across the robustness band.',
};

/**
 * The EXACT first-pass shape the diagnosis names: an execute action
 * (explanation handler) carrying (a) a stray top-level `answer_shape`, (b)
 * out-of-enum `cited_context_fields`, and (c) a `source: "explicit"` alias —
 * and NO explanation.answer_text (the model put the whole answer in the stray
 * shape). Under the old validator every one of these threw; the whole
 * proposal was rejected → REPAIR_ONCE.
 */
function firstPassExecuteShape() {
  return {
    intent_class: 'execute',
    action: {
      handler_id: 'explain_results',
      entity: {
        id: 'scen-1',
        kind: 'option',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [{ name: 'threshold', value: 5, source: 'explicit' }],
      cited_context_fields: [
        'analysis.leading_option', // in the 16-value enum
        'analysis.margin', // NOT in the enum
        'analysis.robustness', // NOT in the enum (enum has robustness_band)
      ],
    },
    answer_shape: STRAY_SHAPE,
  };
}

describe('parseToolCallResponse — first-pass coercion of the exact repair-tax shape', () => {
  let events: Array<{ event: string; payload: Record<string, unknown> }>;
  beforeEach(() => {
    events = [];
    setTestSink((event, payload) => events.push({ event, payload }));
  });
  afterEach(() => setTestSink(null));

  it('parses the divergent execute shape FIRST-PASS (no throw), preserving content', () => {
    const parsed = parseToolCallResponse(firstPassExecuteShape(), {
      requestId: 'req-1',
      sessionId: 'scen-1',
      llmCall: 1,
    });

    expect(parsed.intent_class).toBe('execute');
    if (parsed.intent_class !== 'execute') return;

    // (c) parameter source alias "explicit" → "user_explicit".
    expect(parsed.action.parameters[0]?.source).toBe('user_explicit');

    // (b) out-of-enum cited fields filtered, valid one kept.
    expect(parsed.action.cited_context_fields).toEqual(['analysis.leading_option']);

    // (a) the stray answer_shape is gone from the top level, and its text was
    // LIFTED into explanation.answer_text (nothing lost).
    expect((parsed as { answer_shape?: unknown }).answer_shape).toBeUndefined();
    expect(parsed.action.explanation?.answer_text).toBe(
      deriveAnswerTextFromShape(STRAY_SHAPE),
    );
  });

  it('emits one drift-alarm event per coercion with the right reason tags (no user text)', () => {
    parseToolCallResponse(firstPassExecuteShape(), {
      requestId: 'req-1',
      sessionId: 'scen-1',
      llmCall: 1,
    });

    const coerced = events.filter((e) => e.event === 'v5.routing.first_pass_coerced');
    const reasons = coerced.map((e) => e.payload.reason).sort();
    expect(reasons).toEqual([
      'parameter_source_alias',
      'stray_answer_shape',
      'unknown_cited_field',
    ]);

    // Counted + correlated, and NO user text anywhere in the payloads.
    for (const e of coerced) {
      expect(e.payload.request_id).toBe('req-1');
      expect(e.payload.scenario_id).toBe('scen-1');
      expect(e.payload.llm_call).toBe(1);
      const serialized = JSON.stringify(e.payload);
      expect(serialized).not.toContain(STRAY_SHAPE.headline);
      expect(serialized).not.toContain(STRAY_SHAPE.detail);
    }
    const unknownCited = coerced.find((e) => e.payload.reason === 'unknown_cited_field');
    expect(unknownCited?.payload.dropped_count).toBe(2);
  });

  it('does NOT emit when no telemetry context is supplied (dropped-action path stays silent)', () => {
    parseToolCallResponse(firstPassExecuteShape());
    expect(events.filter((e) => e.event === 'v5.routing.first_pass_coerced')).toHaveLength(0);
  });
});

describe('coerceFirstPassToolCall — each coercion in isolation (pure)', () => {
  it('(a) strips a stray top-level answer_shape and lifts its text on an explanation handler', () => {
    const { value, coercions } = coerceFirstPassToolCall({
      intent_class: 'execute',
      action: {
        handler_id: 'what_would_flip',
        entity: { id: 'n1', kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
      },
      answer_shape: STRAY_SHAPE,
    });
    const v = value as { answer_shape?: unknown; action: { explanation?: { answer_text?: string } } };
    expect(v.answer_shape).toBeUndefined();
    expect(v.action.explanation?.answer_text).toBe(deriveAnswerTextFromShape(STRAY_SHAPE));
    expect(coercions.map((c) => c.reason)).toContain('stray_answer_shape');
  });

  it('(a) strips a stray top-level answer_text and lifts it (distinct reason)', () => {
    const { value, coercions } = coerceFirstPassToolCall({
      intent_class: 'execute',
      action: {
        handler_id: 'explain_results',
        entity: { id: 'n1', kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
      },
      answer_text: 'The leading option holds across the robustness band.',
    });
    const v = value as { answer_text?: unknown; action: { explanation?: { answer_text?: string } } };
    expect(v.answer_text).toBeUndefined();
    expect(v.action.explanation?.answer_text).toBe(
      'The leading option holds across the robustness band.',
    );
    expect(coercions.map((c) => c.reason)).toContain('stray_answer_text');
  });

  it('(a) does NOT lift into a mutation handler (run_analysis carries no user-facing prose)', () => {
    const { value } = coerceFirstPassToolCall({
      intent_class: 'execute',
      action: {
        handler_id: 'run_analysis',
        entity: { id: 'n1', kind: 'option', resolution_status: 'resolved', resolution_method: 'id_match' },
      },
      answer_shape: STRAY_SHAPE,
    });
    const v = value as { answer_shape?: unknown; action: { explanation?: unknown } };
    expect(v.answer_shape).toBeUndefined();
    expect(v.action.explanation).toBeUndefined();
  });

  it('(a) does NOT overwrite an explanation.answer_text the model already authored', () => {
    const { value } = coerceFirstPassToolCall({
      intent_class: 'execute',
      action: {
        handler_id: 'explain_results',
        entity: { id: 'n1', kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
        explanation: { answer_text: 'The real authored answer.' },
      },
      answer_shape: STRAY_SHAPE,
    });
    const v = value as { action: { explanation?: { answer_text?: string } } };
    expect(v.action.explanation?.answer_text).toBe('The real authored answer.');
  });

  it('(b) filters unknown cited_context_fields, counting the drops', () => {
    const { value, coercions } = coerceFirstPassToolCall({
      intent_class: 'execute',
      action: {
        handler_id: 'explain_results',
        entity: { id: 'n1', kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
        cited_context_fields: ['analysis.top_drivers', 'analysis.margin', 'not.a.field'],
      },
    });
    const v = value as { action: { cited_context_fields: string[] } };
    expect(v.action.cited_context_fields).toEqual(['analysis.top_drivers']);
    expect(coercions.find((c) => c.reason === 'unknown_cited_field')?.count).toBe(2);
  });

  it('(c) normalises parameter source "explicit" → "user_explicit", counting the aliases', () => {
    const { value, coercions } = coerceFirstPassToolCall({
      intent_class: 'execute',
      action: {
        handler_id: 'add_constraint',
        entity: { id: 'n1', kind: 'constraint', resolution_status: 'resolved', resolution_method: 'id_match' },
        parameters: [
          { name: 'value', value: 50000, source: 'explicit' },
          { name: 'other', value: 1, source: 'inferred' },
        ],
      },
    });
    const v = value as { action: { parameters: Array<{ source: string }> } };
    expect(v.action.parameters.map((p) => p.source)).toEqual(['user_explicit', 'inferred']);
    expect(coercions.find((c) => c.reason === 'parameter_source_alias')?.count).toBe(1);
  });

  it('leaves a clean execute action untouched (no coercions, deep-equal value)', () => {
    const clean = {
      intent_class: 'execute',
      action: {
        handler_id: 'run_analysis',
        entity: { id: 'n1', kind: 'option', resolution_status: 'resolved', resolution_method: 'id_match' },
        parameters: [],
        cited_context_fields: ['analysis.status'],
      },
    };
    const { value, coercions } = coerceFirstPassToolCall(clean);
    expect(coercions).toHaveLength(0);
    expect(value).toEqual(clean);
  });

  it('leaves a NON-execute (coach) turn untouched — coercion is execute-branch only', () => {
    const coach = { intent_class: 'coach', coaching_mode: 'reframe', answer_shape: STRAY_SHAPE };
    const { value, coercions } = coerceFirstPassToolCall(coach);
    expect(coercions).toHaveLength(0);
    expect(value).toBe(coach); // same reference — no copy, no mutation
  });

  it('does not mutate the caller-supplied input object', () => {
    const input = firstPassExecuteShape();
    const snapshot = JSON.stringify(input);
    coerceFirstPassToolCall(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('negative control — a genuinely malformed execute action STILL rejects (repair path intact)', () => {
  it('missing handler_id throws ToolCallParseError even after coercion', () => {
    expect(() =>
      parseToolCallResponse({
        intent_class: 'execute',
        action: {
          // handler_id omitted — genuinely malformed, not a coercible divergence
          entity: { id: 'n1', kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
        },
        answer_shape: STRAY_SHAPE,
      }),
    ).toThrow(ToolCallParseError);
  });

  it('missing action entirely throws (execute requires action)', () => {
    expect(() =>
      parseToolCallResponse({ intent_class: 'execute', answer_text: 'stray' }),
    ).toThrow(/action is required/);
  });
});

// -----------------------------------------------------------------------
// End-to-end — the divergent pill shape resolves in ONE LLM call (no repair)
// -----------------------------------------------------------------------

function minimalContextPack(): ContextPack {
  return assembleContextPack({
    payload: makeMessagePayload({ turn_id: 't-01', scenario_id: 'scen-abc', message: 'Why did A win?' }),
    priorTurns: [],
  });
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

describe('routeWithToolUse — the forced-pill first-pass shape no longer repairs', () => {
  let events: Array<{ event: string; payload: Record<string, unknown> }>;
  beforeEach(() => {
    events = [];
    setTestSink((event, payload) => events.push({ event, payload }));
  });
  afterEach(() => setTestSink(null));

  it('resolves in EXACTLY ONE chatWithTools call and emits the coercion drift alarm', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(
          mkResult([
            {
              type: 'tool_use',
              id: 'tu-1',
              name: OLUMI_ACTION_TOOL_NAME,
              input: firstPassExecuteShape() as Record<string, unknown>,
            },
          ]),
        ),
    };

    const result = await routeWithToolUse(minimalContextPack(), 'Why did A win?', {
      requestId: 'req-pill',
      sessionId: 'scen-abc',
      adapter,
      forcedExplanationHandlerId: 'explain_results',
    });

    // The whole point: NO REPAIR_ONCE second call.
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    expect(result.type).toBe('tool_call');
    if (result.type === 'tool_call' && result.proposal.intent_class === 'execute') {
      expect(result.llmCallCount).toBe(1);
      expect(result.proposal.action.handler_id).toBe('explain_results');
      expect(result.proposal.action.explanation?.answer_text).toBe(
        deriveAnswerTextFromShape(STRAY_SHAPE),
      );
    }

    const coerced = events.filter((e) => e.event === 'v5.routing.first_pass_coerced');
    expect(coerced.map((e) => e.payload.reason).sort()).toEqual([
      'parameter_source_alias',
      'stray_answer_shape',
      'unknown_cited_field',
    ]);
  });
});
