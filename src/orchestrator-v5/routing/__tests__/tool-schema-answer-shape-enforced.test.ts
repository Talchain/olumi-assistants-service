/**
 * CEE_ANSWER_SHAPE_ENFORCED — schema-pressure layer unit tests (ROADMAP
 * 1.132, F2).
 *
 * Coach/converse answers get a schema-enforced SHAPE
 * `{ headline: 1 sentence, bullets: ≤3, detail: string }` so answers stop
 * arriving as walls of prose. Follows the CEE_ANSWER_TEXT_REQUIRED pattern
 * (tool-schema-answer-text-required.test.ts): the shape requirement is a
 * plain Zod validation failure that flows through the EXISTING REPAIR_ONCE
 * mechanism — that integration lives in
 * `route-with-tool-use-answer-shape-repair.test.ts`.
 *
 * Flag default OFF (config/index.ts `features.answerShapeEnforced`):
 *   - the served `olumi_action` tool definition is BYTE-IDENTICAL to the
 *     pre-flag definition (golden test below);
 *   - a legacy coach/converse tool call parses byte-identically;
 *   - `answer_shape` remains rejected at parse (same failure class as the
 *     pre-flag `.strict()` unknown-key rejection).
 *
 * Flag ON:
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
import { deriveAnswerTextFromShape } from '../answer-shape.js';

let priorFlag: string | undefined;
let priorAnswerTextFlag: string | undefined;

async function setFlag(value: 'true' | undefined) {
  priorFlag = process.env.CEE_ANSWER_SHAPE_ENFORCED;
  if (value === undefined) {
    delete process.env.CEE_ANSWER_SHAPE_ENFORCED;
  } else {
    process.env.CEE_ANSWER_SHAPE_ENFORCED = value;
  }
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
}

async function restoreFlag() {
  if (priorFlag === undefined) {
    delete process.env.CEE_ANSWER_SHAPE_ENFORCED;
  } else {
    process.env.CEE_ANSWER_SHAPE_ENFORCED = priorFlag;
  }
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
}

async function setAnswerTextFlag(value: 'true' | undefined) {
  priorAnswerTextFlag = process.env.CEE_ANSWER_TEXT_REQUIRED;
  if (value === undefined) {
    delete process.env.CEE_ANSWER_TEXT_REQUIRED;
  } else {
    process.env.CEE_ANSWER_TEXT_REQUIRED = value;
  }
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
}

async function restoreAnswerTextFlag() {
  if (priorAnswerTextFlag === undefined) {
    delete process.env.CEE_ANSWER_TEXT_REQUIRED;
  } else {
    process.env.CEE_ANSWER_TEXT_REQUIRED = priorAnswerTextFlag;
  }
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
}

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

describe('answer_shape — CEE_ANSWER_SHAPE_ENFORCED flag OFF (default)', () => {
  beforeEach(async () => {
    await setFlag(undefined);
  });
  afterEach(async () => {
    await restoreFlag();
  });

  it('serves a BYTE-IDENTICAL olumi_action tool definition (golden)', () => {
    const built = buildOlumiActionTool();
    // Same object, not a lookalike — flag-off must not even clone.
    expect(built).toBe(OLUMI_ACTION_TOOL);
    // And the definition itself must not have grown an answer_shape surface.
    expect(
      (OLUMI_ACTION_TOOL.input_schema.properties as Record<string, unknown>).answer_shape,
    ).toBeUndefined();
  });

  it('parses a legacy coach tool call byte-identically (answer_text preserved verbatim, no answer_shape key)', () => {
    const result = parseToolCallResponse({
      intent_class: 'coach',
      coaching_mode: 'reframe',
      answer_text: 'The full coaching answer.',
    });
    expect(result).toEqual({
      intent_class: 'coach',
      coaching_mode: 'reframe',
      answer_text: 'The full coaching answer.',
    });
    expect(Object.keys(result)).not.toContain('answer_shape');
  });

  it('parses a legacy converse tool call byte-identically', () => {
    const result = parseToolCallResponse({
      intent_class: 'converse',
      answer_text: 'The full conversational answer.',
    });
    expect(result).toEqual({
      intent_class: 'converse',
      answer_text: 'The full conversational answer.',
    });
  });

  it('still rejects a coach tool call carrying answer_shape (pre-flag rejection class preserved)', () => {
    expect(() =>
      parseToolCallResponse({
        intent_class: 'coach',
        coaching_mode: 'reframe',
        answer_text: 'x',
        answer_shape: VALID_SHAPE,
      }),
    ).toThrow(ToolCallParseError);
    expect(() =>
      parseToolCallResponse({
        intent_class: 'coach',
        coaching_mode: 'reframe',
        answer_text: 'x',
        answer_shape: VALID_SHAPE,
      }),
    ).toThrow(/answer_shape/);
  });
});

describe('answer_shape — CEE_ANSWER_SHAPE_ENFORCED flag ON', () => {
  beforeEach(async () => {
    await setFlag('true');
  });
  afterEach(async () => {
    await restoreFlag();
  });

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

  it('execute remains FORBIDDEN from carrying answer_shape (and unaffected without one)', () => {
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
    expect(() =>
      parseToolCallResponse({ ...validExecute, answer_shape: VALID_SHAPE }),
    ).toThrow(/answer_shape is forbidden/);
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

  it('with CEE_ANSWER_TEXT_REQUIRED also ON: a valid shape with NO model answer_text is accepted (derivation satisfies the requirement — no repair loop)', async () => {
    await setAnswerTextFlag('true');
    try {
      const result = parseToolCallResponse({
        intent_class: 'coach',
        coaching_mode: 'reframe',
        answer_shape: VALID_SHAPE,
      });
      if (result.intent_class === 'coach') {
        expect(result.answer_text).toBe(deriveAnswerTextFromShape(VALID_SHAPE));
      }
    } finally {
      await restoreAnswerTextFlag();
    }
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
