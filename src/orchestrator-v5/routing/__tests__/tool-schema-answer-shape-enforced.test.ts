/**
 * Answer-shape enforcement — schema-pressure layer unit tests (ROADMAP
 * 1.132, F2). UNCONDITIONAL since the F1 flag deletion (no-dark-launches
 * doctrine): `CEE_ANSWER_SHAPE_ENFORCED` is gone, so the shape contract is
 * always live.
 *
 * Coach/converse answers get a schema-enforced SHAPE
 * `{ headline: 1 sentence, bullets: ≤3, detail: string }` so answers stop
 * arriving as walls of prose. The shape requirement is a plain Zod validation
 * failure that flows through the EXISTING REPAIR_ONCE mechanism — that
 * integration lives in `route-with-tool-use-answer-shape-repair.test.ts`.
 *
 * Contract (always on):
 *   - the served `olumi_action` tool definition ALWAYS advertises
 *     `answer_shape` (no env toggle can suppress it — the dark gate is gone);
 *   - coach/converse tool calls MUST carry a valid `answer_shape`;
 *   - `answer_text` is DERIVED from the shape (single source of truth) so
 *     legacy consumers keep a populated answer_text;
 *   - execute/clarify remain forbidden from carrying `answer_shape`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ToolCallParseError,
  parseToolCallResponse,
  buildOlumiActionTool,
  OLUMI_ACTION_TOOL,
} from '../tool-schema.js';
import { AnswerShapeSchema, deriveAnswerTextFromShape } from '../answer-shape.js';

const VALID_SHAPE = {
  headline: 'Focus on retention before pricing.',
  bullets: [
    'Churn is the dominant driver in your graph.',
    'Pricing effects are second-order today.',
  ],
  detail:
    'Your graph links churn to revenue with the strongest causal link, so ' +
    'improving retention moves the goal more than any pricing change.',
};

describe('answer_shape — the dark gate is gone (F1: CEE_ANSWER_SHAPE_ENFORCED deleted)', () => {
  // Prove the deleted env var can no longer suppress the shape. This is the
  // no-dark-launches pin: setting the retired flag to any value must not
  // change behaviour, because nothing reads it any more.
  let priorFlag: string | undefined;
  beforeEach(async () => {
    priorFlag = process.env.CEE_ANSWER_SHAPE_ENFORCED;
    process.env.CEE_ANSWER_SHAPE_ENFORCED = 'false';
    const { _resetConfigCache } = await import('../../../config/index.js');
    _resetConfigCache();
  });
  afterEach(async () => {
    if (priorFlag === undefined) delete process.env.CEE_ANSWER_SHAPE_ENFORCED;
    else process.env.CEE_ANSWER_SHAPE_ENFORCED = priorFlag;
    const { _resetConfigCache } = await import('../../../config/index.js');
    _resetConfigCache();
  });

  it('serves the EXTENDED tool definition even with the retired flag set to "false"', () => {
    const built = buildOlumiActionTool();
    const builtProps = built.input_schema.properties as Record<string, unknown>;
    expect(builtProps.answer_shape).toBeDefined();
  });

  it('still REQUIRES answer_shape on a coach turn with the retired flag set to "false"', () => {
    expect(() =>
      parseToolCallResponse({
        intent_class: 'coach',
        coaching_mode: 'reframe',
        answer_text: 'prose only',
      }),
    ).toThrow(/answer_shape is required when intent_class === "coach"/);
  });
});

describe('answer_shape — schema pressure (unconditional)', () => {
  it('advertises answer_shape on the served tool definition — and changes NOTHING else', () => {
    const built = buildOlumiActionTool();
    const builtProps = built.input_schema.properties as Record<string, unknown>;
    expect(builtProps.answer_shape).toBeDefined();
    const { answer_shape: _drop, ...rest } = builtProps;
    expect(rest).toEqual(OLUMI_ACTION_TOOL.input_schema.properties);
    expect(built.input_schema.required).toEqual(OLUMI_ACTION_TOOL.input_schema.required);
    expect(built.name).toBe(OLUMI_ACTION_TOOL.name);
  });

  it('accepts a coach tool call with a valid shape; answer_text is DERIVED from the shape', () => {
    const result = parseToolCallResponse({
      intent_class: 'coach',
      coaching_mode: 'reframe',
      answer_shape: VALID_SHAPE,
    });
    expect(result.intent_class).toBe('coach');
    if (result.intent_class === 'coach') {
      expect(result.answer_shape).toEqual(VALID_SHAPE);
      expect(result.answer_text).toBe(deriveAnswerTextFromShape(VALID_SHAPE));
      expect(result.answer_text).toBe(
        'Focus on retention before pricing.\n\n' +
          '• Churn is the dominant driver in your graph.\n' +
          '• Pricing effects are second-order today.\n\n' +
          'Your graph links churn to revenue with the strongest causal link, so ' +
          'improving retention moves the goal more than any pricing change.',
      );
    }
  });

  it('the derived answer_text OVERRIDES any model-authored answer_text (shape is the single source of truth)', () => {
    const result = parseToolCallResponse({
      intent_class: 'converse',
      answer_text: 'A rambling wall of prose that should not ship.',
      answer_shape: VALID_SHAPE,
    });
    if (result.intent_class === 'converse') {
      expect(result.answer_text).toBe(deriveAnswerTextFromShape(VALID_SHAPE));
    }
  });

  it('rejects a coach tool call with NO answer_shape (message drives the REPAIR_ONCE retry)', () => {
    expect(() =>
      parseToolCallResponse({
        intent_class: 'coach',
        coaching_mode: 'reframe',
        answer_text: 'prose only',
      }),
    ).toThrow(/answer_shape is required when intent_class === "coach"/);
  });

  it('rejects a converse tool call with NO answer_shape', () => {
    expect(() =>
      parseToolCallResponse({ intent_class: 'converse', answer_text: 'prose only' }),
    ).toThrow(/answer_shape is required when intent_class === "converse"/);
  });

  it('rejects a multi-sentence headline', () => {
    expect(() =>
      parseToolCallResponse({
        intent_class: 'coach',
        coaching_mode: 'reframe',
        answer_shape: {
          ...VALID_SHAPE,
          headline: 'Focus on retention. Pricing can wait until next quarter.',
        },
      }),
    ).toThrow(/exactly one sentence/);
  });

  it('accepts a headline containing a decimal (no bare-decimal false positive)', () => {
    expect(() =>
      parseToolCallResponse({
        intent_class: 'coach',
        coaching_mode: 'reframe',
        answer_shape: { ...VALID_SHAPE, headline: 'Set churn to 2.5% before rerunning.' },
      }),
    ).not.toThrow();
  });

  it('rejects a blank headline', () => {
    expect(() =>
      parseToolCallResponse({
        intent_class: 'coach',
        coaching_mode: 'reframe',
        answer_shape: { ...VALID_SHAPE, headline: '   ' },
      }),
    ).toThrow(/headline/);
  });

  it('rejects MORE than 3 bullets', () => {
    expect(() =>
      parseToolCallResponse({
        intent_class: 'coach',
        coaching_mode: 'reframe',
        answer_shape: { ...VALID_SHAPE, bullets: ['a', 'b', 'c', 'd'] },
      }),
    ).toThrow(/at most 3/);
  });

  it('accepts an EMPTY bullets array (bullets are optional content, the field is not)', () => {
    const result = parseToolCallResponse({
      intent_class: 'coach',
      coaching_mode: 'reframe',
      answer_shape: { ...VALID_SHAPE, bullets: [] },
    });
    if (result.intent_class === 'coach') {
      expect(result.answer_text).toBe(
        `${VALID_SHAPE.headline}\n\n${VALID_SHAPE.detail}`,
      );
    }
  });

  it('rejects a blank bullet', () => {
    expect(() =>
      parseToolCallResponse({
        intent_class: 'coach',
        coaching_mode: 'reframe',
        answer_shape: { ...VALID_SHAPE, bullets: ['fine', '   '] },
      }),
    ).toThrow(/bullets must be non-blank/);
  });

  it('rejects a missing/blank detail', () => {
    expect(() =>
      parseToolCallResponse({
        intent_class: 'coach',
        coaching_mode: 'reframe',
        answer_shape: { headline: VALID_SHAPE.headline, bullets: [], detail: ' ' },
      }),
    ).toThrow(/detail/);
    expect(() =>
      parseToolCallResponse({
        intent_class: 'coach',
        coaching_mode: 'reframe',
        answer_shape: { headline: VALID_SHAPE.headline, bullets: [] },
      }),
    ).toThrow(ToolCallParseError);
  });

  it('execute with a stray answer_shape is now COERCED (stripped), not rejected — repair-tax fix 2026-07-22', () => {
    // BEHAVIOUR CHANGE (repair-tax fix): a stray top-level answer_shape on an
    // execute action used to be a hard Zod rejection → a ~4-5s REPAIR_ONCE
    // second LLM call on ~every forced pill. It is now STRIPPED on the first
    // pass (answer_shape is forbidden on execute, and non-load-bearing there).
    // On a MUTATION handler (run_analysis) there is no user-facing prose to
    // lift, so it is dropped outright. See REPAIR-TAX-ROOT-CAUSE-2026-07-22.md
    // and first-pass-coercion.test.ts for the full coercion + telemetry pins.
    const validExecute = {
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
        cited_context_fields: [],
      },
    };
    expect(() => parseToolCallResponse(validExecute)).not.toThrow();
    const coerced = parseToolCallResponse({ ...validExecute, answer_shape: VALID_SHAPE });
    expect(coerced.intent_class).toBe('execute');
    expect((coerced as { answer_shape?: unknown }).answer_shape).toBeUndefined();
  });

  it('clarify remains FORBIDDEN from carrying answer_shape (and unaffected without one)', () => {
    const validClarify = {
      intent_class: 'clarify' as const,
      clarification: { ambiguity_type: 'entity' as const, question: 'Which one?' },
    };
    expect(() => parseToolCallResponse(validClarify)).not.toThrow();
    expect(() =>
      parseToolCallResponse({ ...validClarify, answer_shape: VALID_SHAPE }),
    ).toThrow(/answer_shape is forbidden/);
  });

  it('a valid shape with NO model answer_text is accepted (derivation satisfies the unconditional answer_text requirement — no repair loop)', () => {
    const result = parseToolCallResponse({
      intent_class: 'coach',
      coaching_mode: 'reframe',
      answer_shape: VALID_SHAPE,
    });
    if (result.intent_class === 'coach') {
      expect(result.answer_text).toBe(deriveAnswerTextFromShape(VALID_SHAPE));
    }
  });
});

/**
 * A2 CONSUMER CONTRACT — the stable shape the UI renderer will consume.
 * Pins the field names and per-field constraints of `_answer_shape` /
 * `answer_shape` so the DGAI renderer build (lane A2) has a fixed target.
 * If this changes, the wire contract the UI depends on has changed — that is
 * a coordinated cross-repo change, not a silent one.
 */
describe('answer_shape — A2 consumer contract (headline / bullets / detail)', () => {
  it('the shape has exactly these three fields, no more', () => {
    const parsed = AnswerShapeSchema.parse(VALID_SHAPE);
    expect(Object.keys(parsed).sort()).toEqual(['bullets', 'detail', 'headline']);
  });

  it('headline is a string, bullets is a string[], detail is a string', () => {
    const parsed = AnswerShapeSchema.parse(VALID_SHAPE);
    expect(typeof parsed.headline).toBe('string');
    expect(Array.isArray(parsed.bullets)).toBe(true);
    expect(parsed.bullets.every((b) => typeof b === 'string')).toBe(true);
    expect(typeof parsed.detail).toBe('string');
  });

  it('an unknown field inside the shape is REJECTED (the shape is strict — additive UI keys must be coordinated)', () => {
    expect(() =>
      AnswerShapeSchema.parse({ ...VALID_SHAPE, cta: 'Run analysis' }),
    ).toThrow();
  });

  it('bullets are capped at 3 (the renderer can rely on ≤3 items)', () => {
    expect(() =>
      AnswerShapeSchema.parse({ ...VALID_SHAPE, bullets: ['a', 'b', 'c', 'd'] }),
    ).toThrow(/at most 3/);
  });
});

describe('deriveAnswerTextFromShape', () => {
  it('joins headline, bulleted points and detail with blank lines, trimming each part', () => {
    expect(
      deriveAnswerTextFromShape({
        headline: '  Headline sentence.  ',
        bullets: [' first point ', 'second point'],
        detail: ' The detail. ',
      }),
    ).toBe('Headline sentence.\n\n• first point\n• second point\n\nThe detail.');
  });

  it('omits the bullets section when bullets is empty', () => {
    expect(
      deriveAnswerTextFromShape({ headline: 'H.', bullets: [], detail: 'D.' }),
    ).toBe('H.\n\nD.');
  });
});
