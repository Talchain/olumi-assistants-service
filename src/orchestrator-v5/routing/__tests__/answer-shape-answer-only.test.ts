/**
 * ANSWER-ONLY — a concise direct answer is a first-class outcome.
 *
 * THE DEFECT THIS CLOSES. `AnswerShapeSchema` required a NON-BLANK `detail`,
 * so a coach/converse turn could not emit a one-sentence answer: a model that
 * correctly answered "Your revenue factor is set to £2.4m." in one sentence
 * FAILED validation and was sent back through REPAIR_ONCE to pad the reply
 * with structure the user never asked for. Every converse turn was therefore
 * shaped into headline + supporting detail whether or not the question wanted
 * it — a mechanical cause of the product feeling like operating machinery
 * rather than talking to a reasoning partner.
 *
 * Note this contradicted the SERVED prompt's own SHARP SHAPE rule (routing
 * v121 line 32: "Lookups and state queries: 1 to 3 sentences"). The prompt
 * already granted concision; the schema made obeying it impossible.
 *
 * WHAT IS NOW TRUE. `bullets` and `detail` are OPTIONAL. A valid shape is
 * either:
 *   - ANSWER_ONLY — headline alone: the complete answer is one sentence; or
 *   - COACHED     — headline plus bullets and/or detail.
 * `classifyAnswerShape` names which one, DERIVED from the content so it can
 * never disagree with it (CLAUDE.md rule 12 — derive, don't mirror; a
 * model-authored `kind` field could claim "answer_only" beside a 400-word
 * detail, which is trap 21's two-authorities defect).
 *
 * ⭐ THE TWIN CASE IS REQUIRED IN BOTH DIRECTIONS, and half this file is the
 * second direction. Making a concise answer LEGAL must not make coaching
 * DISAPPEAR — a change that suppresses coaching everywhere is a different
 * defect, not a fix. This estate has repeatedly shipped a fix and its exact
 * inverse in consecutive rounds because the corpus only tested one direction
 * (CLAUDE.md traps 22b / 22f). So: every relaxation below is paired with the
 * invariant it must NOT have relaxed.
 *
 * Assertions bind to their object by IDENTITY (the exact headline/bullet/
 * detail strings of a named fixture), never by a value predicate another
 * shape could satisfy (trap 19).
 */

import { describe, expect, it } from 'vitest';

import {
  ANSWER_SHAPE_MAX_BULLETS,
  ANSWER_SHAPE_TOOL_PROPERTY,
  AnswerShapeSchema,
  classifyAnswerShape,
  deriveAnswerTextFromShape,
  synthesiseAnswerShapeFromText,
} from '../answer-shape.js';
import { ToolCallParseError, buildOlumiActionTool, parseToolCallResponse } from '../tool-schema.js';

/** The answer a user should be able to receive to "what is my revenue factor set to?" */
const ANSWER_ONLY_HEADLINE = 'Your revenue factor is set to £2.4m.';

/** A genuine coaching intervention — the shape that must SURVIVE this change. */
const COACHED_SHAPE = {
  headline: 'Focus on retention before pricing.',
  bullets: [
    'Churn is the dominant driver in your graph.',
    'Pricing effects are second-order today.',
  ],
  detail:
    'Your graph links churn to revenue with the strongest causal link, so ' +
    'improving retention moves the goal more than any pricing change.',
};

// ───────────────────────────────────────────────────────────────────────────
// DIRECTION A — a concise answer is now REPRESENTABLE.
// ───────────────────────────────────────────────────────────────────────────

describe('DIRECTION A — answer-only is a legal, named shape', () => {
  it('accepts a headline ALONE, with bullets and detail omitted entirely', () => {
    const parsed = AnswerShapeSchema.safeParse({ headline: ANSWER_ONLY_HEADLINE });
    expect(parsed.success).toBe(true);
    // The omitted fields are DEFAULTED, so the parsed output type is unchanged
    // for every existing consumer (`shape.detail.length`, `shape.bullets.map`).
    expect(parsed.success && parsed.data).toEqual({
      headline: ANSWER_ONLY_HEADLINE,
      bullets: [],
      detail: '',
    });
  });

  it('accepts an EXPLICITLY empty bullets + blank detail (the same outcome, spelled out)', () => {
    const parsed = AnswerShapeSchema.safeParse({
      headline: ANSWER_ONLY_HEADLINE,
      bullets: [],
      detail: '   ',
    });
    expect(parsed.success).toBe(true);
  });

  it('names the outcome: classifyAnswerShape → "answer_only"', () => {
    const shape = AnswerShapeSchema.parse({ headline: ANSWER_ONLY_HEADLINE });
    expect(classifyAnswerShape(shape)).toBe('answer_only');
  });

  it('a converse turn carrying an answer-only shape parses, and answer_text is EXACTLY the one sentence', () => {
    const result = parseToolCallResponse({
      intent_class: 'converse',
      answer_shape: { headline: ANSWER_ONLY_HEADLINE },
    });
    expect(result.intent_class).toBe('converse');
    // Bound by IDENTITY to the fixture's exact bytes — no manufactured
    // bullets, no padded detail, no trailing whitespace.
    expect(result.answer_text).toBe(ANSWER_ONLY_HEADLINE);
    expect(result.answer_shape).toEqual({
      headline: ANSWER_ONLY_HEADLINE,
      bullets: [],
      detail: '',
    });
  });

  it('a coach turn may also answer concisely (the relaxation is not converse-only)', () => {
    const result = parseToolCallResponse({
      intent_class: 'coach',
      coaching_mode: 'summarise',
      answer_shape: { headline: ANSWER_ONLY_HEADLINE },
    });
    expect(result.answer_text).toBe(ANSWER_ONLY_HEADLINE);
  });

  it('the tool advert requires ONLY headline, and names the answer-only outcome to the model', () => {
    expect(ANSWER_SHAPE_TOOL_PROPERTY.required).toEqual(['headline']);
    expect(ANSWER_SHAPE_TOOL_PROPERTY.description).toMatch(/ANSWER-ONLY/);
    // The advert served on the live tool must carry the same relaxation — a
    // relaxed validator behind a stale advert still tells the model to pad.
    const served = buildOlumiActionTool().input_schema.properties as Record<string, unknown>;
    expect((served.answer_shape as { required: string[] }).required).toEqual(['headline']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// DIRECTION B — the twin. Coaching must STILL arrive, and every invariant
// that was NOT the defect must still bite.
// ───────────────────────────────────────────────────────────────────────────

describe('DIRECTION B — coaching still arrives, and the other floors still bite', () => {
  it('a full coaching shape still parses and still classifies as "coached"', () => {
    const shape = AnswerShapeSchema.parse(COACHED_SHAPE);
    expect(classifyAnswerShape(shape)).toBe('coached');
  });

  it('the derived answer_text still carries headline, EVERY bullet and the detail, in order', () => {
    const result = parseToolCallResponse({
      intent_class: 'coach',
      coaching_mode: 'reframe',
      answer_shape: COACHED_SHAPE,
    });
    // Byte-identical to the pre-change derivation — bound by identity to each
    // fixture string, so a change that silently dropped bullets or detail
    // (i.e. suppressed coaching) REDs here.
    expect(result.answer_text).toBe(
      `${COACHED_SHAPE.headline}\n\n` +
        `• ${COACHED_SHAPE.bullets[0]}\n• ${COACHED_SHAPE.bullets[1]}\n\n` +
        `${COACHED_SHAPE.detail}`,
    );
  });

  it('bullets WITHOUT detail is now legal, and still classifies as coached (not answer_only)', () => {
    const shape = AnswerShapeSchema.parse({
      headline: COACHED_SHAPE.headline,
      bullets: COACHED_SHAPE.bullets,
    });
    expect(classifyAnswerShape(shape)).toBe('coached');
    expect(deriveAnswerTextFromShape(shape)).toBe(
      `${COACHED_SHAPE.headline}\n\n• ${COACHED_SHAPE.bullets[0]}\n• ${COACHED_SHAPE.bullets[1]}`,
    );
  });

  it('detail WITHOUT bullets is still legal and still coached', () => {
    const shape = AnswerShapeSchema.parse({
      headline: COACHED_SHAPE.headline,
      detail: COACHED_SHAPE.detail,
    });
    expect(classifyAnswerShape(shape)).toBe('coached');
  });

  it('answer_shape is STILL REQUIRED on coach/converse — the shape did not become optional', () => {
    expect(() =>
      parseToolCallResponse({ intent_class: 'coach', coaching_mode: 'reframe' }),
    ).toThrow(/answer_shape is required when intent_class === "coach"/);
    expect(() => parseToolCallResponse({ intent_class: 'converse' })).toThrow(
      /answer_shape is required when intent_class === "converse"/,
    );
  });

  it('a BLANK headline is still rejected — an answer-only shape cannot be an EMPTY shape', () => {
    expect(AnswerShapeSchema.safeParse({ headline: '   ' }).success).toBe(false);
    expect(() =>
      parseToolCallResponse({ intent_class: 'converse', answer_shape: { headline: '  ' } }),
    ).toThrow(/headline must be a non-blank single sentence/);
  });

  it('a MULTI-SENTENCE headline is still rejected — prose cannot smuggle itself in as a headline', () => {
    // Without this, "answer-only" would become the wall-of-prose channel the
    // whole answer_shape contract exists to prevent.
    expect(() =>
      parseToolCallResponse({
        intent_class: 'converse',
        answer_shape: { headline: 'It is £2.4m. That is above your target. You could raise it.' },
      }),
    ).toThrow(/headline must be exactly one sentence/);
  });

  it('the ≤3 bullet cap still bites', () => {
    expect(ANSWER_SHAPE_MAX_BULLETS).toBe(3);
    expect(() =>
      parseToolCallResponse({
        intent_class: 'coach',
        coaching_mode: 'reframe',
        answer_shape: { ...COACHED_SHAPE, bullets: ['a', 'b', 'c', 'd'] },
      }),
    ).toThrow(/at most 3 items/);
  });

  it('a BLANK bullet is still rejected (an empty bullet is furniture, not an answer)', () => {
    expect(() =>
      parseToolCallResponse({
        intent_class: 'coach',
        coaching_mode: 'reframe',
        answer_shape: { ...COACHED_SHAPE, bullets: ['fine', '   '] },
      }),
    ).toThrow(/bullets must be non-blank/);
  });

  it('an UNKNOWN key inside answer_shape is still a strict-mode failure', () => {
    expect(() =>
      parseToolCallResponse({
        intent_class: 'converse',
        answer_shape: { headline: ANSWER_ONLY_HEADLINE, summary: 'smuggled' },
      }),
    ).toThrow(ToolCallParseError);
  });

  it('answer_shape is still FORBIDDEN on clarify', () => {
    expect(() =>
      parseToolCallResponse({
        intent_class: 'clarify',
        // A COMPLETE, schema-valid clarification — so the only thing this
        // test can fail on is the answer_shape rule it names. (At pristine it
        // first failed on a missing `ambiguity_type`, i.e. it was passing
        // judgement on the wrong object — trap 19.)
        clarification: { ambiguity_type: 'entity', question: 'Which option did you mean?' },
        answer_shape: { headline: ANSWER_ONLY_HEADLINE },
      }),
    ).toThrow(/answer_shape is forbidden when intent_class === "clarify"/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// COUPLING — every OTHER reader of the relaxed predicate (CLAUDE.md trap 21b:
// "when you relax a predicate you have created a new concept; check every
// other reader of the old one"). These pin behaviour that must NOT move.
// ───────────────────────────────────────────────────────────────────────────

describe('COUPLING — the relaxation must not leak into the prose-synthesis path', () => {
  it('synthesiseAnswerShapeFromText still returns null for SINGLE-SENTENCE prose', () => {
    // It has its own explicit floor, deliberately independent of the schema:
    // a one-sentence answer is ALREADY concise, so shaping it would add a
    // "Show more" toggle with nothing behind it.
    expect(synthesiseAnswerShapeFromText('Your revenue factor is set to £2.4m.')).toBeNull();
  });

  it('synthesiseAnswerShapeFromText still returns null for lead-in + bullets with NO trailing prose', () => {
    expect(
      synthesiseAnswerShapeFromText('The biggest drivers are:\n- Team size.\n- Budget.'),
    ).toBeNull();
  });

  it('synthesiseAnswerShapeFromText still SHAPES genuinely multi-sentence prose (the positive control)', () => {
    // Without this the two nulls above would pass on a function that had
    // stopped working entirely (trap 13 — an absence probe needs a presence).
    const shape = synthesiseAnswerShapeFromText(
      'The uplift is 2.5 percent overall. That clears the bar.',
    );
    expect(shape).not.toBeNull();
    expect(shape!.headline).toBe('The uplift is 2.5 percent overall.');
    expect(shape!.detail).toBe('That clears the bar.');
  });

  it('deriveAnswerTextFromShape is still NON-BLANK by construction for an answer-only shape', () => {
    // The load-bearing guarantee that survives the relaxation: a valid shape
    // ALWAYS yields user-facing text, because `headline` is still required
    // and still non-blank. No consumer of assistant_text can receive ''.
    const shape = AnswerShapeSchema.parse({ headline: ANSWER_ONLY_HEADLINE });
    expect(deriveAnswerTextFromShape(shape)).toBe(ANSWER_ONLY_HEADLINE);
    expect(deriveAnswerTextFromShape(shape).trim().length).toBeGreaterThan(0);
  });
});
