/**
 * `synthesiseAnswerShapeFromText` — the deterministic F1 answer-shape
 * fallback (ROADMAP 1.132). Unit-level coverage of the helper the route-v2
 * egress chokepoint calls on any un-shaped, non-empty `assistant_text`.
 *
 * The load-bearing property: for every text that yields a shape, the shape is
 * schema-valid AND `deriveAnswerTextFromShape(shape)` is what the caller SETS
 * as the new assistant_text — so the byte-equality tie holds by construction.
 */
import { describe, expect, it } from 'vitest';

import {
  AnswerShapeSchema,
  deriveAnswerTextFromShape,
  synthesiseAnswerShapeFromText,
} from '../answer-shape.js';

describe('synthesiseAnswerShapeFromText', () => {
  it('HARD CASE — single paragraph, no blank lines: headline = first sentence, detail = remainder, bullets = []', () => {
    const prose =
      'Team size is the biggest driver of the outcome. Raise it to twelve before deciding anything else.';
    // Precondition of the hard case: zero blank-line breaks in the input.
    expect(prose.includes('\n\n')).toBe(false);

    const shape = synthesiseAnswerShapeFromText(prose);
    expect(shape).not.toBeNull();
    expect(shape).toEqual({
      headline: 'Team size is the biggest driver of the outcome.',
      bullets: [],
      detail: 'Raise it to twelve before deciding anything else.',
    });
    // The shape is schema-valid.
    expect(AnswerShapeSchema.safeParse(shape).success).toBe(true);
    // Byte-equality BY CONSTRUCTION: the caller SETS assistant_text to this,
    // and every derived text contains exactly one blank-line break — which the
    // single-paragraph input (zero `\n\n`) provably could never equal, so
    // approach (a) is impossible and (b) is the only route.
    const derived = deriveAnswerTextFromShape(shape!);
    expect(derived).toBe(
      'Team size is the biggest driver of the outcome.\n\nRaise it to twelve before deciding anything else.',
    );
    expect((derived.match(/\n\n/g) ?? []).length).toBe(1);
  });

  it('extracts already-bulleted lines (glyph, dash, star) in order, cap 3, rest → detail', () => {
    const prose =
      'Weigh these before deciding.\n- Team size dominates.\n* Budget is second.\n• Timing is third.\n- Overflow beyond the cap.\nThen choose.';
    const shape = synthesiseAnswerShapeFromText(prose);
    expect(shape).not.toBeNull();
    expect(shape!.headline).toBe('Weigh these before deciding.');
    // Cap at 3, in original order.
    expect(shape!.bullets).toEqual([
      'Team size dominates.',
      'Budget is second.',
      'Timing is third.',
    ]);
    // The 4th bullet is NOT dropped — it is kept verbatim (glyph and all) and
    // folded into detail, so no content is lost.
    expect(shape!.detail).toContain('Overflow beyond the cap.');
    expect(shape!.detail).toContain('Then choose.');
    expect(AnswerShapeSchema.safeParse(shape).success).toBe(true);
  });

  it('single sentence (nothing to disclose) → null', () => {
    expect(synthesiseAnswerShapeFromText('Raise team size to twelve before deciding.')).toBeNull();
  });

  it('blank / whitespace-only → null', () => {
    expect(synthesiseAnswerShapeFromText('   \n  ')).toBeNull();
    expect(synthesiseAnswerShapeFromText('')).toBeNull();
  });

  it('decimals never split the headline (2.5 is not a sentence boundary)', () => {
    const shape = synthesiseAnswerShapeFromText(
      'The uplift is 2.5 percent overall. That clears the bar.',
    );
    expect(shape).not.toBeNull();
    expect(shape!.headline).toBe('The uplift is 2.5 percent overall.');
    expect(shape!.detail).toBe('That clears the bar.');
  });

  it('lead-in sentence + bullets with NO trailing prose → null (schema needs non-blank detail; fail-closed, ship as-is)', () => {
    const shape = synthesiseAnswerShapeFromText('The biggest drivers are:\n- Team size.\n- Budget.');
    expect(shape).toBeNull();
  });
});
