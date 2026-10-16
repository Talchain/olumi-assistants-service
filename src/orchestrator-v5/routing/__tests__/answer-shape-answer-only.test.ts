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

import { describe,expect,it } from 'vitest';

import {
AnswerShapeSchema,
classifyAnswerShape,
deriveAnswerTextFromShape,
synthesiseAnswerShapeFromText
} from '../answer-shape.js';


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














});

// ───────────────────────────────────────────────────────────────────────────
// COUPLING — every OTHER reader of the relaxed predicate (CLAUDE.md trap 21b:
// "when you relax a predicate you have created a new concept; check every
// other reader of the old one"). These pin behaviour that must NOT move.
// ───────────────────────────────────────────────────────────────────────────

describe('COUPLING — the relaxation must not leak into the prose-synthesis path', () => {
  // These bite: the mutant that lets the relaxation leak in here (a
  // single-sentence prose synthesising into a headline-only shape instead of
  // being shipped as prose) REDs two of the cases below.
  //
  // ⚠ Note which line they bind to. `synthesiseAnswerShapeFromText`'s
  // `if (!headline || !detail)` limb is UNREACHABLE — removing it is a
  // demonstrated equivalent mutant (differential probe, 2026-09-01). The
  // floor these cases actually exercise is `split === null`: no internal
  // sentence boundary, so there is nothing to disclose. Naming the wrong
  // mechanism here would leave the next reader guarding a line that cannot
  // fire.
  it('synthesiseAnswerShapeFromText still returns null for SINGLE-SENTENCE prose', () => {
    // A one-sentence answer is ALREADY concise; shaping it would add a "Show
    // more" toggle with nothing behind it.
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
