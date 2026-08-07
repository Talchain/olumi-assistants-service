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
import { log, setTestSink } from '../../../utils/telemetry.js';
import { deriveAnswerTextFromShape } from '../answer-shape.js';
import { routeWithToolUse } from '../route-with-tool-use.js';
import {
  coerceFirstPassToolCall,
  MAX_LOGGED_KEY_NAME_LENGTH,
  OLUMI_ACTION_TOOL_NAME,
  sanitiseLoggedKeyName,
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

// =======================================================================
// FOURTH CLASS (attribution-proven) — the stray TOP-LEVEL key + the forced
// intent_class default. See PILL-LATENCY-EVIDENCE-2026-07-22.md
// §EXPLAIN-PATH ATTRIBUTION: the failing path is `unrecognized_keys @ ""`
// (a stray top-level sibling key, class d), plus on the 494e4a0b exhaustion's
// first pass `invalid_type @ intent_class` (class e).
// =======================================================================

/** A valid execute action for an explanation handler (parses on its own). */
function validExplainAction(answerText?: string) {
  return {
    handler_id: 'explain_results',
    entity: {
      id: 'opt-a',
      kind: 'option',
      resolution_status: 'resolved',
      resolution_method: 'context_inference',
    },
    ...(answerText !== undefined ? { explanation: { answer_text: answerText } } : {}),
  };
}

/**
 * The 26a8d56e shape: a VALID execute (explanation handler, answer authored)
 * carrying exactly ONE stray unknown TOP-LEVEL key. Under the old validator the
 * root `unrecognized_keys` rejected the whole proposal → REPAIR_ONCE.
 */
function shape26a8d56e() {
  return {
    intent_class: 'execute',
    action: validExplainAction(
      'Option A leads because the churn driver favours it and the margin holds under the robustness band.',
    ),
    // The stray top-level sibling the model hoists under forced tool_choice +
    // disabled thinking — NOT one of the six the strict schema accepts, and NOT
    // answer_shape/answer_text (those are class (a), which fired 0× on these
    // pills). A non-answer diagnostic value → stripped, not lifted.
    reasoning_scratch: { note: 'internal chain-of-thought the model spilled at the top level' },
  };
}

describe('coerceFirstPassToolCall — class (d): stray top-level key strip (pure)', () => {
  it('strips a stray unknown top-level key on execute, carrying its NAME (value untouched)', () => {
    const { value, coercions } = coerceFirstPassToolCall(shape26a8d56e());
    const v = value as { reasoning_scratch?: unknown; action: { explanation?: { answer_text?: string } } };
    expect(v.reasoning_scratch).toBeUndefined();
    // The authored answer is preserved (no lift needed — it was already there).
    expect(v.action.explanation?.answer_text).toBe(
      'Option A leads because the churn driver favours it and the margin holds under the robustness band.',
    );
    const stray = coercions.find((c) => c.reason === 'stray_top_level_key');
    expect(stray?.key).toBe('reasoning_scratch');
  });

  it('lifts an answer-looking stray STRING into an empty explanation slot before stripping', () => {
    const { value, coercions } = coerceFirstPassToolCall({
      intent_class: 'execute',
      action: validExplainAction(), // no explanation.answer_text
      answer: 'The complete answer the model put under a stray "answer" key.',
    });
    const v = value as { answer?: unknown; action: { explanation?: { answer_text?: string } } };
    expect(v.answer).toBeUndefined();
    expect(v.action.explanation?.answer_text).toBe(
      'The complete answer the model put under a stray "answer" key.',
    );
    expect(coercions.find((c) => c.reason === 'stray_top_level_key')?.key).toBe('answer');
  });

  it('lifts a hoisted top-level `explanation` object { answer_text } into the action', () => {
    const { value } = coerceFirstPassToolCall({
      intent_class: 'execute',
      action: validExplainAction(),
      // The model put `explanation` at the TOP LEVEL instead of inside action.
      explanation: { answer_text: 'The hoisted explanation body.' },
    });
    const v = value as { explanation?: unknown; action: { explanation?: { answer_text?: string } } };
    expect(v.explanation).toBeUndefined();
    expect(v.action.explanation?.answer_text).toBe('The hoisted explanation body.');
  });

  it('does NOT overwrite an explanation.answer_text the model already authored', () => {
    const { value } = coerceFirstPassToolCall({
      intent_class: 'execute',
      action: validExplainAction('The real authored answer.'),
      answer: 'A stray runner-up that must NOT clobber the authored answer.',
    });
    const v = value as { action: { explanation?: { answer_text?: string } } };
    expect(v.action.explanation?.answer_text).toBe('The real authored answer.');
  });

  it('does NOT lift a stray into a MUTATION handler (run_analysis carries no prose)', () => {
    const { value } = coerceFirstPassToolCall({
      intent_class: 'execute',
      action: {
        handler_id: 'run_analysis',
        entity: { id: 'opt-a', kind: 'option', resolution_status: 'resolved', resolution_method: 'id_match' },
      },
      answer: 'should not be lifted onto a mutation handler',
    });
    const v = value as { answer?: unknown; action: { explanation?: unknown } };
    expect(v.answer).toBeUndefined();
    expect(v.action.explanation).toBeUndefined();
  });

  it('leaves the six allowed top-level keys untouched (only true strays are stripped)', () => {
    // answer_shape is handled by class (a); a genuine stray alongside it is (d).
    const { value, coercions } = coerceFirstPassToolCall({
      intent_class: 'execute',
      action: validExplainAction('Authored answer.'),
      answer_shape: STRAY_SHAPE, // class (a)
      telemetry_blob: { spilled: true }, // class (d)
    });
    const v = value as { answer_shape?: unknown; telemetry_blob?: unknown };
    expect(v.answer_shape).toBeUndefined();
    expect(v.telemetry_blob).toBeUndefined();
    expect(coercions.map((c) => c.reason).sort()).toEqual([
      'stray_answer_shape',
      'stray_top_level_key',
    ]);
  });

  it('strips MULTIPLE stray keys, one coercion (with its name) per key', () => {
    const { coercions } = coerceFirstPassToolCall({
      intent_class: 'execute',
      action: validExplainAction('Authored answer.'),
      foo: 1,
      bar: 2,
    });
    const strays = coercions
      .filter((c) => c.reason === 'stray_top_level_key')
      .map((c) => c.key)
      .sort();
    expect(strays).toEqual(['bar', 'foo']);
  });

  it('does not mutate the caller-supplied input object', () => {
    const input = shape26a8d56e();
    const snapshot = JSON.stringify(input);
    coerceFirstPassToolCall(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('coerceFirstPassToolCall — class (e): forced intent_class default (pure)', () => {
  it('defaults a MISSING intent_class to execute on a FORCED turn', () => {
    const { value, coercions } = coerceFirstPassToolCall(
      { action: validExplainAction('Authored answer.') },
      { forced: true },
    );
    const v = value as { intent_class?: string };
    expect(v.intent_class).toBe('execute');
    expect(coercions.map((c) => c.reason)).toContain('missing_intent_class_forced');
  });

  it('defaults an INVALID-TYPE (non-string) intent_class to execute on a FORCED turn', () => {
    const { value, coercions } = coerceFirstPassToolCall(
      { intent_class: 42, action: validExplainAction('Authored answer.') },
      { forced: true },
    );
    expect((value as { intent_class?: unknown }).intent_class).toBe('execute');
    expect(coercions.some((c) => c.reason === 'missing_intent_class_forced')).toBe(true);
  });

  it('does NOT default a VALID non-execute intent (coach) even when forced — byte-identical', () => {
    // This is the guard that keeps the #628 coach/converse-bypass assert intact:
    // a schema-valid coach on a forced turn must reach enforceForcedExecute, not
    // be silently rewritten to execute here.
    const coach = { intent_class: 'coach', coaching_mode: 'reframe', answer_shape: STRAY_SHAPE };
    const { value, coercions } = coerceFirstPassToolCall(coach, { forced: true });
    expect(coercions).toHaveLength(0);
    expect(value).toBe(coach); // same reference — no copy, no coercion
  });

  it('is INERT when the turn is NOT forced (missing intent stays missing)', () => {
    const missing = { action: validExplainAction('Authored answer.') };
    const { value, coercions } = coerceFirstPassToolCall(missing); // no opts
    expect(coercions).toHaveLength(0);
    expect(value).toBe(missing); // same reference — no coercion off the forced path
  });

  it('(d)+(e) together: the 494e4a0b shape (missing intent + stray key) coerces on a forced turn', () => {
    const { value, coercions } = coerceFirstPassToolCall(
      {
        // intent_class MISSING (the invalid_type @ intent_class first pass)
        action: validExplainAction('A complete plain-language explanation of the results.'),
        unexpected_top: { note: 'stray sibling' },
      },
      { forced: true },
    );
    const v = value as { intent_class?: string; unexpected_top?: unknown };
    expect(v.intent_class).toBe('execute');
    expect(v.unexpected_top).toBeUndefined();
    expect(coercions.map((c) => c.reason).sort()).toEqual([
      'missing_intent_class_forced',
      'stray_top_level_key',
    ]);
  });
});

describe('parseToolCallResponse — the named repair-tax shapes parse FIRST-PASS', () => {
  let events: Array<{ event: string; payload: Record<string, unknown> }>;
  beforeEach(() => {
    events = [];
    setTestSink((event, payload) => events.push({ event, payload }));
  });
  afterEach(() => setTestSink(null));

  it('the 26a8d56e shape (valid execute + one stray top-level key) parses, event names the key', () => {
    const parsed = parseToolCallResponse(shape26a8d56e(), {
      requestId: 'req-26',
      sessionId: 'scen-26',
      llmCall: 1,
    });
    expect(parsed.intent_class).toBe('execute');
    if (parsed.intent_class !== 'execute') return;
    expect(parsed.action.explanation?.answer_text).toBe(
      'Option A leads because the churn driver favours it and the margin holds under the robustness band.',
    );
    const stray = events.find(
      (e) => e.event === 'v5.routing.first_pass_coerced' && e.payload.reason === 'stray_top_level_key',
    );
    expect(stray?.payload.stray_key).toBe('reasoning_scratch');
    // R-004: the stripped VALUE never appears in telemetry, only the key name.
    expect(JSON.stringify(stray?.payload)).not.toContain('chain-of-thought');
  });

  it('the 494e4a0b shape (missing intent_class + stray key) parses FIRST-PASS when FORCED', () => {
    const parsed = parseToolCallResponse(
      {
        action: validExplainAction('A complete plain-language explanation of the results.'),
        unexpected_top: 'stray',
      },
      { requestId: 'req-49', sessionId: 'scen-49', llmCall: 1, forcedHandlerId: 'explain_results' },
    );
    expect(parsed.intent_class).toBe('execute');
    const reasons = events
      .filter((e) => e.event === 'v5.routing.first_pass_coerced')
      .map((e) => e.payload.reason)
      .sort();
    expect(reasons).toEqual(['missing_intent_class_forced', 'stray_top_level_key']);
  });

  it('the 494e4a0b shape is NOT coerced when NOT forced (still throws — class (e) is forced-only)', () => {
    expect(() =>
      parseToolCallResponse(
        {
          action: validExplainAction('answer'),
          unexpected_top: 'stray',
        },
        { requestId: 'req-49b', sessionId: 'scen-49b', llmCall: 1 }, // no forcedHandlerId
      ),
    ).toThrow(ToolCallParseError);
  });
});

describe('routeWithToolUse — the forced 494e4a0b shape resolves in ONE call (no repair / no exhaustion)', () => {
  let events: Array<{ event: string; payload: Record<string, unknown> }>;
  beforeEach(() => {
    events = [];
    setTestSink((event, payload) => events.push({ event, payload }));
  });
  afterEach(() => setTestSink(null));

  it('a forced pill whose first pass has a missing intent_class + stray key does NOT repair', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(
          mkResult([
            {
              type: 'tool_use',
              id: 'tu-49',
              name: OLUMI_ACTION_TOOL_NAME,
              input: {
                action: validExplainAction('A complete plain-language explanation of the results.'),
                unexpected_top: { note: 'stray' },
              } as Record<string, unknown>,
            },
          ]),
        ),
    };

    const result = await routeWithToolUse(minimalContextPack(), 'Why did A win?', {
      requestId: 'req-forced-49',
      sessionId: 'scen-abc',
      adapter,
      forcedExplanationHandlerId: 'explain_results',
    });

    // The whole point: NO REPAIR_ONCE second call, NO bounded-fallback exhaustion.
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    expect(result.type).toBe('tool_call');
    if (result.type === 'tool_call' && result.proposal.intent_class === 'execute') {
      expect(result.llmCallCount).toBe(1);
      expect(result.proposal.action.handler_id).toBe('explain_results');
    }
    const reasons = events
      .filter((e) => e.event === 'v5.routing.first_pass_coerced')
      .map((e) => e.payload.reason)
      .sort();
    expect(reasons).toEqual(['missing_intent_class_forced', 'stray_top_level_key']);
  });
});

describe('companion — forced_pill_parse_failed names the offending unrecognized_keys', () => {
  afterEach(() => {
    setTestSink(null);
    vi.restoreAllMocks();
  });

  it('carries the stray key NAMES on a residual unrecognized_keys parse failure (structural, no values)', async () => {
    // A forced turn returning a schema-VALID coach + one stray key. class (e)
    // does not touch a valid coach (guard above), class (d) is execute-only, so
    // the stray survives to the strict parse → root `unrecognized_keys` → the
    // #628 forced_pill_parse_failed log. The companion now names the key(s).
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => log);
    const coachWithStray = {
      intent_class: 'coach',
      coaching_mode: 'reframe',
      answer_shape: STRAY_SHAPE,
      made_up_sibling: 'x',
    };
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValue(
          mkResult([
            { type: 'tool_use', id: 'tu-c', name: OLUMI_ACTION_TOOL_NAME, input: coachWithStray as Record<string, unknown> },
          ]),
        ),
    };

    await expect(
      routeWithToolUse(minimalContextPack(), 'Explain these results.', {
        requestId: 'req-companion',
        sessionId: 'scen-companion',
        adapter,
        forcedExplanationHandlerId: 'explain_results',
      }),
    ).rejects.toMatchObject({ name: 'RoutingError', cause: 'schema_repair_failed' });

    const parseFailedCalls = warnSpy.mock.calls.filter(
      (call) => (call[0] as { event?: string })?.event === 'v5.routing.forced_pill_parse_failed',
    );
    expect(parseFailedCalls.length).toBeGreaterThan(0);
    const payload = parseFailedCalls[0]![0] as { issues?: Array<{ code: string; keys?: string[] }> };
    const unrec = payload.issues?.find((i) => i.code === 'unrecognized_keys');
    expect(unrec?.keys).toEqual(['made_up_sibling']);
  });
});

// =======================================================================
// #633 REVIEW BLOCK — telemetry hygiene: a MODEL-AUTHORED key name is, by
// definition, a string NOT in the schema (100% model-invented, possibly
// reflected user content, unbounded length). The review proved a 5014-char
// key name emitted VERBATIM. Both log sites MUST cap + sanitise the name so
// the raw model string can never reach a log line. The false "R-004-safe —
// a key name is a structural schema identifier" comments were INVERTED for
// this population (rule-14 class) and are corrected in the source.
// =======================================================================

const HUGE_KEY = 'a'.repeat(5014); // clean chars, over the cap → truncation
const DIRTY_KEY = 'answer</system>\n{leak: true}  <script>alert(1)</script>'; // user-text / injection chars

/** Body is the allowed alphabet only; an optional single `~` marker may trail. */
const SANITISED_SHAPE = /^[A-Za-z0-9_.-]*~?$/;

describe('#633 sanitiseLoggedKeyName — pure', () => {
  it('passes a clean, short key through unchanged (no marker)', () => {
    expect(sanitiseLoggedKeyName('reasoning_scratch')).toBe('reasoning_scratch');
    expect(sanitiseLoggedKeyName('a.b-c_1')).toBe('a.b-c_1');
  });

  it('replaces every out-of-alphabet char with `_` and appends the marker', () => {
    const out = sanitiseLoggedKeyName('a b<c>d');
    expect(out).toBe('a_b_c_d~');
    expect(out).toMatch(SANITISED_SHAPE);
  });

  it('caps an over-length key at MAX + 1 (body + marker) and marks it', () => {
    const out = sanitiseLoggedKeyName(HUGE_KEY);
    expect(out.length).toBe(MAX_LOGGED_KEY_NAME_LENGTH + 1);
    expect(out.endsWith('~')).toBe(true);
    expect(out).not.toBe(HUGE_KEY);
  });

  it('marks a key that is both truncated AND replaced', () => {
    const out = sanitiseLoggedKeyName('x '.repeat(200)); // long + spaces
    expect(out.length).toBe(MAX_LOGGED_KEY_NAME_LENGTH + 1);
    expect(out.endsWith('~')).toBe(true);
    expect(out).toMatch(SANITISED_SHAPE);
  });

  it('never emits the raw injection payload verbatim', () => {
    const out = sanitiseLoggedKeyName(DIRTY_KEY);
    expect(out).toMatch(SANITISED_SHAPE);
    expect(out.endsWith('~')).toBe(true);
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('</system>');
    expect(out).not.toContain(' ');
    expect(out).not.toContain('\n');
  });
});

describe('#633 tool-schema site — v5.routing.first_pass_coerced.stray_key is capped + sanitised', () => {
  let events: Array<{ event: string; payload: Record<string, unknown> }>;
  beforeEach(() => {
    events = [];
    setTestSink((event, payload) => events.push({ event, payload }));
  });
  afterEach(() => setTestSink(null));

  function strayKeyFor(name: string) {
    parseToolCallResponse(
      {
        intent_class: 'execute',
        action: validExplainAction('Authored answer.'),
        [name]: { note: 'internal chain-of-thought the model spilled' },
      },
      { requestId: 'req-633', sessionId: 'scen-633', llmCall: 1 },
    );
    const ev = events.find(
      (e) =>
        e.event === 'v5.routing.first_pass_coerced' &&
        e.payload.reason === 'stray_top_level_key',
    );
    return ev?.payload.stray_key as string | undefined;
  }

  it('a 5000+-char stray key is emitted capped (≤65), marked, never verbatim', () => {
    const emitted = strayKeyFor(HUGE_KEY);
    expect(typeof emitted).toBe('string');
    expect(emitted!.length).toBeLessThanOrEqual(MAX_LOGGED_KEY_NAME_LENGTH + 1);
    expect(emitted!.endsWith('~')).toBe(true);
    expect(emitted).toMatch(SANITISED_SHAPE);
    // The raw 5014-char name never reaches the payload.
    const serialised = JSON.stringify(events.map((e) => e.payload));
    expect(serialised).not.toContain(HUGE_KEY);
  });

  it('a stray key with spaces / user-text chars is emitted sanitised + marked', () => {
    const emitted = strayKeyFor(DIRTY_KEY);
    expect(emitted).toMatch(SANITISED_SHAPE);
    expect(emitted!.endsWith('~')).toBe(true);
    const serialised = JSON.stringify(events.map((e) => e.payload));
    expect(serialised).not.toContain('<script>');
    expect(serialised).not.toContain('</system>');
  });
});

describe('#633 route-with-tool-use site — forced_pill_parse_failed.issues[].keys are capped + sanitised', () => {
  afterEach(() => {
    setTestSink(null);
    vi.restoreAllMocks();
  });

  it('a residual unrecognized_keys carrying a 5014-char key logs it capped + sanitised, never verbatim', async () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => log);
    // A forced turn returning a schema-VALID coach + one HUGE stray key: class
    // (d) is execute-only and (e) leaves a valid coach untouched, so the stray
    // survives to the strict parse → root `unrecognized_keys` → the #628
    // forced_pill_parse_failed log, where its NAME must be sanitised.
    const coachWithHugeStray = {
      intent_class: 'coach',
      coaching_mode: 'reframe',
      answer_shape: STRAY_SHAPE,
      [HUGE_KEY]: 'x',
    };
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValue(
          mkResult([
            { type: 'tool_use', id: 'tu-h', name: OLUMI_ACTION_TOOL_NAME, input: coachWithHugeStray as Record<string, unknown> },
          ]),
        ),
    };

    await expect(
      routeWithToolUse(minimalContextPack(), 'Explain these results.', {
        requestId: 'req-633-route',
        sessionId: 'scen-633-route',
        adapter,
        forcedExplanationHandlerId: 'explain_results',
      }),
    ).rejects.toMatchObject({ name: 'RoutingError', cause: 'schema_repair_failed' });

    const parseFailedCalls = warnSpy.mock.calls.filter(
      (call) => (call[0] as { event?: string })?.event === 'v5.routing.forced_pill_parse_failed',
    );
    expect(parseFailedCalls.length).toBeGreaterThan(0);
    const payload = parseFailedCalls[0]![0] as {
      issues?: Array<{ code: string; keys?: string[] }>;
    };
    const unrec = payload.issues?.find((i) => i.code === 'unrecognized_keys');
    expect(unrec?.keys).toBeDefined();
    for (const k of unrec!.keys!) {
      expect(k.length).toBeLessThanOrEqual(MAX_LOGGED_KEY_NAME_LENGTH + 1);
      expect(k.endsWith('~')).toBe(true);
      expect(k).toMatch(SANITISED_SHAPE);
    }
    // The raw 5014-char key never reaches the logged payload.
    expect(JSON.stringify(payload)).not.toContain(HUGE_KEY);
  });
});
