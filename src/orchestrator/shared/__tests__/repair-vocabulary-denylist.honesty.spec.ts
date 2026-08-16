/**
 * P1 HONESTY — the repair-vocabulary scrubber was itself the leak.
 *
 * Three defects, all user-visible, all pinned here:
 *
 *   A1  Four of the twelve patterns were ORDINARY ENGLISH (`inbound`,
 *       `bridge`, `ceiling`, `rescale`). A user's own words were struck out
 *       of the assistant's reply. Live server logs caught the scrubber firing
 *       with `replacement_count: 2` on a real turn.
 *
 *   A2  The substitution was the literal `[REDACTED]` — a placeholder token
 *       is operator vocabulary too, and the loudest kind: it tells the user
 *       something was hidden on a surface where nothing sensitive exists.
 *
 *   A3  The patterns were NON-GLOBAL, so `String.replace` swapped only the
 *       FIRST occurrence and a two-occurrence sentence shipped half-scrubbed.
 *
 * Every assertion binds by IDENTITY (the exact rule, the exact input word),
 * never by a value predicate another rule could satisfy.
 */
import { describe, expect, it } from 'vitest';

import {
  enforceRepairVocabularyDenylist,
  FORBIDDEN_USER_FACING_REDACTION_MARKER,
  REPAIR_VOCABULARY_DENYLIST,
  REPAIR_VOCABULARY_RULES,
} from '../repair-vocabulary-denylist.js';

/**
 * The four ordinary-English words removed in 2026-08-16, each in a sentence a
 * real user could plausibly type. Written OUTSIDE the module's own vocabulary
 * (CLAUDE.md trap 22: a corpus drawn from the author's head cannot see the
 * class the author did not imagine — these come from ordinary business
 * English, not from the denylist).
 */
const ORDINARY_ENGLISH_SENTENCES: ReadonlyArray<readonly [string, string]> = [
  ['inbound', 'Inbound lead volume drives most of our pipeline, and inbound quality is rising.'],
  ['bridge', 'The bridge loan closes the funding gap until the Series B.'],
  ['ceiling', 'We agreed a hiring ceiling of forty people for this year.'],
  ['rescale', 'If demand holds we can rescale the team upward in Q3.'],
];

describe('A1 — ordinary English survives the scrubber untouched', () => {
  it.each(ORDINARY_ENGLISH_SENTENCES)(
    'the word "%s" passes through unchanged, with zero replacements',
    (word, sentence) => {
      const result = enforceRepairVocabularyDenylist(sentence);
      expect(result.text).toBe(sentence);
      expect(result.replacements).toBe(0);
      // Bind by identity: the specific word, still present, in its own case.
      expect(result.text).toContain(word);
    },
  );

  it('the four removed patterns are absent from the rule set, while the operator tokens that shared their sentences remain (contrast control)', () => {
    const sources = REPAIR_VOCABULARY_RULES.map((r) => r.pattern.source);
    // Target: absent.
    expect(sources).not.toContain('\\binbound\\b');
    expect(sources).not.toContain('\\bbridge\\b');
    expect(sources).not.toContain('\\bceiling\\b');
    expect(sources).not.toContain('\\brescale');
    // CONTRAST CONTROL — an absence claim needs a same-family presence claim
    // in the same probe, or it is evidence about the probe (trap 13e).
    expect(sources).toContain('\\bsum=');
    expect(sources).toContain('Σ');
  });
});

describe('A2 — no placeholder token ever reaches user-facing prose', () => {
  it('no rule substitutes the redaction marker', () => {
    for (const rule of REPAIR_VOCABULARY_RULES) {
      expect(rule.replacement).not.toContain(FORBIDDEN_USER_FACING_REDACTION_MARKER);
      expect(rule.replacement).not.toMatch(/[[\]]/);
    }
  });

  it('the historic live sentence scrubs to readable prose, not to a redaction notice', () => {
    // The sentence graph-enforcement.ts:237 actually emitted.
    const operatorSentence = 'Rescaled 3 causal inbound edges from sum=1.240 to 1.0';
    const result = enforceRepairVocabularyDenylist(operatorSentence);
    expect(result.text).not.toContain(FORBIDDEN_USER_FACING_REDACTION_MARKER);
    // `sum=` is the genuinely-distinctive token and it IS replaced…
    expect(result.text).not.toContain('sum=');
    expect(result.text).toContain('total 1.240');
    // …while the ordinary English around it is left alone.
    expect(result.text).toContain('inbound');
  });

  it.each(REPAIR_VOCABULARY_RULES.map((r) => [r.pattern.source, r] as const))(
    'rule /%s/ replaces its token with its OWN neutral term',
    (_source, rule) => {
      expect(rule.replacement.length).toBeGreaterThan(0);
      // The replacement must not itself be re-caught by the denylist: a
      // scrubber whose output trips its own detector is not converging.
      for (const detector of REPAIR_VOCABULARY_DENYLIST) {
        expect(rule.replacement).not.toMatch(detector);
      }
    },
  );

  it('each surviving operator token maps to its documented neutral term', () => {
    // Bound by identity — the exact token, the exact expected phrase.
    expect(enforceRepairVocabularyDenylist('Σ|mean|').text).toBe(
      'the total of the average values',
    );
    expect(enforceRepairVocabularyDenylist('|mean| drift').text).toBe(
      'the average value drift',
    );
    expect(enforceRepairVocabularyDenylist('BUDGET_TARGET exceeded').text).toBe(
      'the budget target exceeded',
    );
    expect(enforceRepairVocabularyDenylist('[INBOUND_BUDGET_RESCALED]').text).toBe(
      'an internal adjustment',
    );
    expect(enforceRepairVocabularyDenylist('[BRIDGE_CHAIN_FIXED]').text).toBe(
      'an internal adjustment',
    );
    expect(enforceRepairVocabularyDenylist('[STRENGTH_CLAMPED]').text).toBe(
      'an internal adjustment',
    );
    expect(enforceRepairVocabularyDenylist('PLoT applied 2 repairs').text).toBe(
      'I made 2 repairs',
    );
  });

  it('a bracketed code is consumed THROUGH its closing bracket — no dangling tail', () => {
    // The prefix pattern `/\[INBOUND_/` left `BUDGET_RESCALED]` in the
    // sentence: the scrub produced the leak it was written to prevent.
    const result = enforceRepairVocabularyDenylist('We hit [INBOUND_BUDGET_RESCALED] here.');
    expect(result.text).toBe('We hit an internal adjustment here.');
    expect(result.text).not.toContain('BUDGET_RESCALED');
    expect(result.text).not.toContain(']');
  });
});

describe('A3 — EVERY occurrence is replaced, not just the first', () => {
  it('a double-occurrence sentence is fully scrubbed and counts both', () => {
    const result = enforceRepairVocabularyDenylist(
      'First sum=1.100 then sum=2.200 in one sentence.',
    );
    expect(result.text).toBe('First total 1.100 then total 2.200 in one sentence.');
    expect(result.text).not.toContain('sum=');
    expect(result.replacements).toBe(2);
  });

  it('three occurrences of a bracketed code all go', () => {
    const result = enforceRepairVocabularyDenylist(
      '[STRENGTH_CLAMPED] [STRENGTH_CLAMPED] [STRENGTH_CLAMPED]',
    );
    expect(result.replacements).toBe(3);
    expect(result.text).not.toContain('STRENGTH_CLAMPED');
  });

  it('every substitution rule carries the global flag', () => {
    for (const rule of REPAIR_VOCABULARY_RULES) {
      expect(rule.pattern.flags).toContain('g');
    }
  });

  it('the DETECTION view is stateless — the same input answers the same way twice', () => {
    // A global RegExp carries `lastIndex`, so a leak assertion built on one
    // passes every other call. Pin that the detection view has no `g`.
    for (const detector of REPAIR_VOCABULARY_DENYLIST) {
      expect(detector.flags).not.toContain('g');
      const first = detector.test('Σ sum= |mean| BUDGET_TARGET [STRENGTH_CLAMPED] PLoT applied');
      const second = detector.test('Σ sum= |mean| BUDGET_TARGET [STRENGTH_CLAMPED] PLoT applied');
      expect(second).toBe(first);
    }
  });

  it('the detection view is DERIVED from the rules — same length, same sources', () => {
    expect(REPAIR_VOCABULARY_DENYLIST).toHaveLength(REPAIR_VOCABULARY_RULES.length);
    expect(REPAIR_VOCABULARY_DENYLIST.map((r) => r.source)).toEqual(
      REPAIR_VOCABULARY_RULES.map((r) => r.pattern.source),
    );
  });
});
