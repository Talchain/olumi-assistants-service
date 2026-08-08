/**
 * ROADMAP 2.579 — the intake reconciliation producer.
 *
 * ⚠ THE PRIMARY CORPUS MEMBER IS A REAL CAPTURE, NOT A FIXTURE I WROTE.
 * CLAUDE.md trap 22: "a corpus drawn from the author's head cannot see the
 * class the author did not imagine — and a 25/25 mutant kit will certify it".
 * {@link BAKERY_BRIEF} is the verbatim brief driven against deployed staging in
 * `PHASE0-EVIDENCE-2026-07-28/expert-session-2026-08-05-raw/expert-pass.mjs:5`,
 * and {@link BAKERY_GRAPH_LABELS} are the option labels the drafter actually
 * produced from it, read out of that session's own wire capture
 * (`run3/wire.json`). Neither was written for this test.
 *
 * The adversarial negatives below ARE mine, and they are stated as such: they
 * exist to hold the extractor's precision, which is the property whose failure
 * mode (suppressing a TRUE ranking) is worse than the defect being fixed.
 */

import { describe, expect, it } from 'vitest';
import {
  INTAKE_MAY_NAME_LEADING_OPTION,
  applyIntakeToLeaderPermission,
  deriveIntakeOptionReconciliation,
  extractEnumeratedOptions,
  normaliseOptionTokens,
  readGraphOptionLabels,
  type IntakeCompletenessState,
} from '../intake-option-reconciliation.js';

/** Verbatim from expert-pass.mjs:5 — the brief that produced the defect. */
const BAKERY_BRIEF =
  'We are a UK regional bakery group choosing which single capital project to fund this year. ' +
  'The options are a second production oven line, an automated packing cell, refrigerated ' +
  'delivery vans, a new retail concession, or an energy-efficiency retrofit. The goal is to ' +
  'raise operating profit by at least 8 percent within 18 months. Keep the model deliberately ' +
  'simple: contracted costs, energy tariffs and labour rates are known constants. The one ' +
  "important uncertainty is next year's average wholesale flour price, now 340 pounds per " +
  'tonne and plausibly between 250 and 520. Use sensible defaults for anything else.';

/** The four labels the drafter actually produced (run3/wire.json). */
const BAKERY_GRAPH_LABELS: readonly string[] = Object.freeze([
  'Second Production Oven Line',
  'Automated Packing Cell',
  'Refrigerated Delivery Vans',
  'Energy-Efficiency Retrofit',
]);

/** The same four plus the one that went missing. */
const BAKERY_GRAPH_LABELS_COMPLETE: readonly string[] = Object.freeze([
  ...BAKERY_GRAPH_LABELS,
  'New Retail Concession',
]);

describe('2.579 producer — the measured defect, identity-matched', () => {
  it('names the DROPPED option from the real five-option bakery brief', () => {
    const result = deriveIntakeOptionReconciliation(BAKERY_BRIEF, BAKERY_GRAPH_LABELS);

    expect(result.state).toBe('options_missing');
    expect(result.mayNameLeadingOption).toBe(false);

    // BOUND BY IDENTITY, NOT BY COUNT (CLAUDE.md trap 19). Asserting
    // `missing.length === 1` would pass just as happily if the reconciler had
    // named the oven line and lost the concession — a different object
    // satisfying the same predicate. The claim is about WHICH option.
    expect(result.missing.map((m) => m.text)).toEqual(['a new retail concession']);
    expect(result.enumerated.map((e) => e.text)).toEqual([
      'a second production oven line',
      'an automated packing cell',
      'refrigerated delivery vans',
      'a new retail concession',
      'an energy-efficiency retrofit',
    ]);
  });

  it('withholds NOTHING once the same brief has all five options on the graph', () => {
    // The positive control for the assertion above: same brief, same extractor,
    // and the ONLY thing that changed is the graph. Without this, "missing is
    // non-empty" could be an extractor that never matches anything.
    const result = deriveIntakeOptionReconciliation(
      BAKERY_BRIEF,
      BAKERY_GRAPH_LABELS_COMPLETE,
    );
    expect(result.state).toBe('reconciled');
    expect(result.mayNameLeadingOption).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('reconciles the four survivors individually, so the gap is the concession alone', () => {
    // PIN THE PRECONDITION IN-TEST (trap 13b): the verdict above is only
    // evidence about the concession if the other four genuinely matched. A
    // reconciler that matched nothing would return `not_applicable`, but one
    // that matched only ONE would still return `options_missing` with four
    // entries — so assert the matched set, not just the state.
    const result = deriveIntakeOptionReconciliation(BAKERY_BRIEF, BAKERY_GRAPH_LABELS);
    const matched = result.enumerated
      .filter((e) => !result.missing.includes(e))
      .map((e) => e.text);
    expect(matched).toEqual([
      'a second production oven line',
      'an automated packing cell',
      'refrigerated delivery vans',
      'an energy-efficiency retrofit',
    ]);
  });
});

describe('2.579 producer — the SECOND corpus case, for the discriminating mutant pair', () => {
  /**
   * A different brief losing a DIFFERENT option. Its only job is to make the
   * binding of the bakery assertion PROVABLE (CLAUDE.md trap 19): a mutant that
   * loosens the match for THIS case must turn this test RED and leave the
   * bakery test GREEN. Without a second named object, "loosen for a different
   * object only" has no object to loosen for, and the GREEN half of the pair
   * proves nothing.
   */
  const CAFE_BRIEF =
    'We run three city-centre cafés and must pick one growth move this year. ' +
    'The options are a station kiosk, a delivery partnership, or a weekend bakery counter. ' +
    'The goal is to raise contribution margin.';

  it('names the KIOSK when the kiosk is the one the graph lost', () => {
    const result = deriveIntakeOptionReconciliation(CAFE_BRIEF, [
      'Delivery Partnership',
      'Weekend Bakery Counter',
    ]);
    expect(result.state).toBe('options_missing');
    expect(result.missing.map((m) => m.text)).toEqual(['a station kiosk']);
  });

  it('POSITIVE CONTROL — reconciles once the kiosk is on the graph', () => {
    const result = deriveIntakeOptionReconciliation(CAFE_BRIEF, [
      'Station Kiosk',
      'Delivery Partnership',
      'Weekend Bakery Counter',
    ]);
    expect(result.state).toBe('reconciled');
  });
});

describe('2.579 producer — precision guards (a false positive suppresses a TRUE ranking)', () => {
  it('has NO OPINION on a brief that never enumerates its options', () => {
    const brief =
      'We need to decide how to grow revenue next year. Marketing spend, hiring and pricing ' +
      'all matter, and the flour price is uncertain.';
    const result = deriveIntakeOptionReconciliation(brief, BAKERY_GRAPH_LABELS);
    expect(result.state).toBe('not_applicable');
    expect(result.mayNameLeadingOption).toBe(true);
  });

  it('has NO OPINION when NOT ONE enumerated candidate reconciles with the graph', () => {
    // The load-bearing guard, and the same rule `deriveConstraintVerdict` uses
    // at its own unenforced seam: zero overlap is a statement about THIS
    // MODULE'S reading of the brief, not about the graph. Asserting a missing
    // option from it would be "suppress on a say-so" — the exact failure the
    // row warned against.
    const result = deriveIntakeOptionReconciliation(BAKERY_BRIEF, [
      'Alpha',
      'Beta',
      'Gamma',
      'Delta',
    ]);
    expect(result.state).toBe('not_applicable');
    expect(result.mayNameLeadingOption).toBe(true);
  });

  it('has NO OPINION with no brief, a blank brief, or no graph labels', () => {
    for (const brief of [null, undefined, '', '   ']) {
      expect(deriveIntakeOptionReconciliation(brief, BAKERY_GRAPH_LABELS).state).toBe(
        'not_applicable',
      );
    }
    expect(deriveIntakeOptionReconciliation(BAKERY_BRIEF, []).state).toBe('not_applicable');
    expect(deriveIntakeOptionReconciliation(BAKERY_BRIEF, ['   ']).state).toBe(
      'not_applicable',
    );
  });

  it('has NO OPINION on a single-item "enumeration"', () => {
    const result = deriveIntakeOptionReconciliation(
      'The options are a second production oven line.',
      BAKERY_GRAPH_LABELS,
    );
    expect(result.state).toBe('not_applicable');
  });

  it('does not open an enumeration on a cue that is not one ("the options aren\'t")', () => {
    expect(
      extractEnumeratedOptions("Whatever we do, the options aren't obvious, so advise us."),
    ).toEqual([]);
  });

  it('reconciles a drafter that SHORTENED or LENGTHENED the label', () => {
    // Real drafter behaviour: it re-words. A reconciler that demanded an exact
    // string would report four missing options on a perfect graph.
    const result = deriveIntakeOptionReconciliation(BAKERY_BRIEF, [
      'Oven Line', // shortened
      'Automated Packing Cell Programme', // lengthened
      'Refrigerated Delivery Van Fleet', // singular + lengthened
      'Energy Efficiency Retrofit', // hyphen dropped
      'Retail Concession', // present, article dropped
    ]);
    expect(result.state).toBe('reconciled');
    expect(result.missing).toEqual([]);
  });
});

describe('2.579 producer — the decimal-point trap (CLAUDE.md trap 22)', () => {
  it('does not cut the enumeration at a decimal point', () => {
    // Trap 22 shipped six live defects because a window cut at the first
    // `[.!?]` truncated "£1.5 million" to "1" — the guard was correct and
    // pointed at the wrong bytes. An options list can carry a decimal.
    const extracted = extractEnumeratedOptions(
      'The options are a 2.5 tonne dough mixer, a second oven line, or a packing cell. ' +
        'The goal is profit.',
    );
    expect(extracted.map((e) => e.text)).toEqual([
      'a 2.5 tonne dough mixer',
      'a second oven line',
      'a packing cell',
    ]);
  });

  it('does not cut the enumeration at an abbreviation', () => {
    const extracted = extractEnumeratedOptions(
      'The options are a new van, a retrofit, or a concession (e.g. a station kiosk). Then we decide.',
    );
    expect(extracted.map((e) => e.text)).toContain('a new van');
    expect(extracted.some((e) => e.text.includes('kiosk'))).toBe(true);
  });

  it('DOES stop at a genuine sentence boundary', () => {
    const extracted = extractEnumeratedOptions(
      'The options are a new van or a retrofit. The goal is to raise profit by 8 percent.',
    );
    expect(extracted.map((e) => e.text)).toEqual(['a new van', 'a retrofit']);
  });
});

describe('2.579 producer — the tables and the leaves', () => {
  it('declares an answer for EVERY state, exhaustively', () => {
    const states: IntakeCompletenessState[] = [
      'not_applicable',
      'reconciled',
      'options_missing',
    ];
    for (const state of states) {
      expect(typeof INTAKE_MAY_NAME_LEADING_OPTION[state]).toBe('boolean');
    }
    // Derived from the table, not hand-listed: a new state added without a
    // declared answer is a compile error, and a state that flips its answer
    // shows up here rather than silently.
    expect(
      Object.keys(INTAKE_MAY_NAME_LEADING_OPTION).filter(
        (s) => !INTAKE_MAY_NAME_LEADING_OPTION[s as IntakeCompletenessState],
      ),
    ).toEqual(['options_missing']);
  });

  it('every reconciliation carries the state table’s own answer', () => {
    for (const [brief, labels] of [
      [BAKERY_BRIEF, BAKERY_GRAPH_LABELS],
      [BAKERY_BRIEF, BAKERY_GRAPH_LABELS_COMPLETE],
      ['no enumeration here', BAKERY_GRAPH_LABELS],
    ] as ReadonlyArray<readonly [string, readonly string[]]>) {
      const result = deriveIntakeOptionReconciliation(brief, labels);
      expect(result.mayNameLeadingOption).toBe(
        INTAKE_MAY_NAME_LEADING_OPTION[result.state],
      );
    }
  });

  it('normalises articles, hyphens, case and plurals to identity tokens', () => {
    expect(normaliseOptionTokens('an energy-efficiency retrofit')).toEqual([
      'energy',
      'efficiency',
      'retrofit',
    ]);
    expect(normaliseOptionTokens('Refrigerated Delivery Vans')).toEqual([
      'refrigerated',
      'delivery',
      'van',
    ]);
    // A candidate made only of stopwords has no identity and must not match
    // everything.
    expect(normaliseOptionTokens('the other options')).toEqual(['other']);
    expect(normaliseOptionTokens('a new option')).toEqual([]);
  });

  it('reads labels from both the PLoT-shape array and a graph object', () => {
    const options = [
      { id: 'o1', label: 'Second Production Oven Line' },
      { id: 'o2', label: '  ' },
      { id: 'o3' },
      null,
      { id: 'o4', label: 'Automated Packing Cell' },
    ];
    expect(readGraphOptionLabels(options)).toEqual([
      'Second Production Oven Line',
      'Automated Packing Cell',
    ]);
    expect(readGraphOptionLabels({ options })).toEqual([
      'Second Production Oven Line',
      'Automated Packing Cell',
    ]);
    expect(readGraphOptionLabels(undefined)).toEqual([]);
    expect(readGraphOptionLabels({ nodes: [] })).toEqual([]);
  });
});

describe('2.579 gate — the fold into the ratified leader permission (row 1.215)', () => {
  const permitted = {
    may_name_leading_option: true,
    constraint_verdict_state: 'evaluated_feasible',
  } as const;
  const withheld = {
    may_name_leading_option: false,
    constraint_verdict_state: 'unevaluated',
  } as const;

  it('REMOVES the permission when the intake is incomplete', () => {
    const intake = deriveIntakeOptionReconciliation(BAKERY_BRIEF, BAKERY_GRAPH_LABELS);
    expect(applyIntakeToLeaderPermission(permitted, intake)).toEqual({
      may_name_leading_option: false,
      // ⚠ THE STATE IS NOT REWRITTEN. It is a statement about the CONSTRAINT
      // evidence and the intake axis has nothing true to say about it
      // (CLAUDE.md trap 21). Asserting the pass-through here is what stops a
      // later "tidy-up" from aligning the two and re-opening the seam.
      constraint_verdict_state: 'evaluated_feasible',
    });
  });

  it('is TRANSPARENT on every permitting intake state', () => {
    for (const labels of [BAKERY_GRAPH_LABELS_COMPLETE, [] as readonly string[]]) {
      const intake = deriveIntakeOptionReconciliation(BAKERY_BRIEF, labels);
      expect(intake.mayNameLeadingOption).toBe(true);
      expect(applyIntakeToLeaderPermission(permitted, intake)).toBe(permitted);
      expect(applyIntakeToLeaderPermission(withheld, intake)).toBe(withheld);
    }
  });

  it('never GRANTS a permission the constraint verdict withheld', () => {
    const intake = deriveIntakeOptionReconciliation(
      BAKERY_BRIEF,
      BAKERY_GRAPH_LABELS_COMPLETE,
    );
    expect(applyIntakeToLeaderPermission(withheld, intake).may_name_leading_option).toBe(
      false,
    );
  });
});
