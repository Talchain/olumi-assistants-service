/**
 * ROADMAP 2.653 (I-B) — the constraint a user sees is named in words they can
 * recognise.
 *
 * WITNESSED DEFECT, verbatim from walk-2634 J5 and reproduced byte-identically
 * in `consent-witness-findings-2026-08-07.md` §2:
 *
 *     "churn could rise floor"
 *
 * quoted back at the tester, in the primary analysis message, as one of "the
 * conditions you set". Two leaks in four words: `${targetName} floor` welded
 * the internal direction word onto a raw regex capture, and the capture was a
 * verb phrase rather than a measure. The tester's own note: *"A user cannot
 * recognise this as their own constraint."*
 *
 * The corpus here is HAND-WRITTEN from the subjects the extractor's fixed-width
 * captures actually produce on real briefs. Nothing derived from
 * `SCAFFOLD_WORDS` could tell that the list is short, and nothing derived from
 * it could tell that a name reads badly to a person — only spelled-out cases
 * can (CLAUDE.md trap 12d, second face).
 */
import { describe, it, expect } from 'vitest';

import {
  buildBoundDisplayName,
  buildReductionDisplayName,
  cleanConstraintSubject,
} from '../constraint-display-name.js';

describe('2.653 — no machine word ever reaches a display name', () => {
  /**
   * The bug in one assertion. "floor" and "ceiling" are this codebase's words
   * for `>=` and `<=`; a user never wrote either, and neither belongs in copy.
   */
  const SUBJECTS = [
    'churn could rise',
    'churn',
    'Customer Churn Rate',
    'while keeping churn',
    'above 50000 and NPS',
    'unspecified',
    '',
    'cost of goods sold',
  ];

  it.each(SUBJECTS)('bound name for subject %j carries no floor/ceiling', (subject) => {
    for (const operator of ['<=', '>='] as const) {
      const name = buildBoundDisplayName(subject, operator, '3%');
      expect(name).not.toMatch(/\b(floor|ceiling)\b/i);
    }
  });

  it.each(SUBJECTS)('reduction name for subject %j carries no machine word', (subject) => {
    const name = buildReductionDisplayName(subject, '15%');
    expect(name).not.toMatch(/\b(floor|ceiling|reduction target)\b/i);
  });
});

describe('2.653 — the name states the measure, the side, and the user’s own number', () => {
  it('the walk’s constraint, correctly directed, reads as a person would say it', () => {
    expect(buildBoundDisplayName('churn', '<=', '3%')).toBe('Keep churn at or below 3%');
  });

  it('the opposite side reads as its own sentence, not a negation of the first', () => {
    expect(buildBoundDisplayName('retention', '>=', '90%')).toBe(
      'Keep retention at or above 90%',
    );
  });

  it('the VALUE is the user’s text, never the normalised model number', () => {
    // The extractor normalises "3%" to 0.03 before the wire. A name built from
    // the numeric field would read "0.03" — or would force this module to own a
    // unit conversion it has no business owning, and to drift from it later.
    const name = buildBoundDisplayName('churn', '<=', '3%');
    expect(name).toContain('3%');
    expect(name).not.toContain('0.03');
  });

  it('the name AGREES with the operator it ships beside — both read from one argument', () => {
    // Trap 19's shape: the direction word and the operator must be impossible to
    // pair wrongly. They come from the same parameter, so this is a pin on that
    // structure, not a hope about call sites.
    expect(buildBoundDisplayName('churn', '<=', '3%')).toContain('at or below');
    expect(buildBoundDisplayName('churn', '<=', '3%')).not.toContain('at or above');
    expect(buildBoundDisplayName('churn', '>=', '3%')).toContain('at or above');
    expect(buildBoundDisplayName('churn', '>=', '3%')).not.toContain('at or below');
  });

  it('an acronym survives intact — only the first character is ever capitalised', () => {
    expect(buildBoundDisplayName('NPS', '>=', '40')).toBe('Keep NPS at or above 40');
    expect(buildBoundDisplayName('MRR', '>=', '£250,000')).toBe(
      'Keep MRR at or above £250,000',
    );
  });

  it('a reduction is named as a CHANGE, never as a level', () => {
    // A reduction ships `<=` with a NEGATIVE value (ROADMAP 1.52). The level
    // phrasing would render "keep churn at or below -5%", which is
    // unrecognisable and, read literally, false.
    expect(buildReductionDisplayName('churn', '5%')).toBe('Reduce churn by at least 5%');
  });

  it('the phrasing is imperative, so it cannot be ungrammatical for a plural measure', () => {
    // "Costs stays at or below £50k" was the third-person form's failure mode,
    // and mass/plural measures are common in briefs. This is why the copy is
    // imperative rather than declarative.
    expect(buildBoundDisplayName('costs', '<=', '£50k')).toBe('Keep costs at or below £50k');
    expect(buildBoundDisplayName('sales', '>=', '100')).toBe('Keep sales at or above 100');
  });
});

describe('2.653 — cleanConstraintSubject: what the regex captures vs what a user reads', () => {
  it.each([
    ['while keeping churn', 'churn'],
    ['so keep churn', 'churn'],
    ['ensuring retention stays', 'retention'],
    ['above 50000 and NPS', 'NPS'],
    ['and costs', 'costs'],
    ['Revenue rises', 'Revenue'],
    ['the sales team', 'sales team'],
    ['Customer Churn Rate', 'Customer Churn Rate'],
    ['NPS', 'NPS'],
  ])('%j -> %j', (raw, expected) => {
    expect(cleanConstraintSubject(raw)).toBe(expected);
  });

  it('a subject that is nothing but scaffold degrades to null, not to a wrong name', () => {
    expect(cleanConstraintSubject('while keeping')).toBeNull();
    expect(cleanConstraintSubject('unspecified')).toBeNull();
    expect(cleanConstraintSubject('   ')).toBeNull();
    expect(cleanConstraintSubject(null)).toBeNull();
  });

  it('and the name then states the bound alone rather than naming it "unspecified"', () => {
    expect(buildBoundDisplayName('unspecified', '<=', '3%')).toBe('At or below 3%');
    expect(buildReductionDisplayName('unspecified', '5%')).toBe('Reduce by at least 5%');
  });

  it('trimming is END-ONLY — a scaffold word inside a real measure survives', () => {
    // Stripping from the middle would rewrite multi-word measures into
    // nonsense, which is the same class of unrecognisability being fixed.
    expect(cleanConstraintSubject('cost of goods sold')).toBe('cost of goods sold');
    expect(cleanConstraintSubject('return on ad spend')).toBe('return on ad spend');
  });
});
