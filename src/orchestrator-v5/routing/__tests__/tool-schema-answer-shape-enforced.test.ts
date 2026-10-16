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

import { describe,expect,it } from 'vitest';


import { AnswerShapeSchema,deriveAnswerTextFromShape } from '../answer-shape.js';

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
