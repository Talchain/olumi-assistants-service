/**
 * N26 — unit spec for the CANONICAL label elider.
 *
 * ⚠ SCOPE NOTE, so nobody mistakes this file for the acceptance red: this
 * spec imports the new module, so at pristine it fails to COLLECT rather than
 * failing behaviourally. The behavioural red lives in
 * `orchestrator-v5/coaching/__tests__/label-elision-callers.acceptance.test.ts`,
 * which imports only the product entry points. This file's job is the
 * properties the callers cannot reach: the whole-label branch, the delimiter
 * discipline, termination, and the predicate's two directions.
 */
import { describe, it, expect } from 'vitest';
import {
  LABEL_ELISION_MARKER,
  LABEL_RETENTION_FLOOR_RATIO,
  elideLabelAtWordBoundary,
  hasUnclosedDelimiter,
} from '../label-elision.js';

const USER_OPTION_85 =
  'double down on enterprise sales (higher margins but longer cycles and more headcount)';
const USER_OPTION_101 =
  'invest heavily in a self-serve product (lower CAC but requires significant engineering spend upfront)';
const WITNESSED_1 = 'double down on enterprise sales (higher';

function floorFor(max: number): number {
  return Math.ceil((max - LABEL_ELISION_MARKER.length) * LABEL_RETENTION_FLOOR_RATIO);
}

describe('the marker', () => {
  it('is exactly one U+2026, never three dots', () => {
    expect(LABEL_ELISION_MARKER).toBe('…');
    expect(LABEL_ELISION_MARKER.length).toBe(1);
  });

  it('is appended when and only when something was removed', () => {
    expect(elideLabelAtWordBoundary('Ship it', 40)).toBe('Ship it');
    expect(elideLabelAtWordBoundary('  Ship it  ', 40)).toBe('Ship it');
    expect(elideLabelAtWordBoundary(USER_OPTION_85, 40).endsWith('…')).toBe(true);
  });

  it('does not append when the trimmed label lands exactly on the cap', () => {
    const exact = 'a'.repeat(40);
    expect(elideLabelAtWordBoundary(exact, 40)).toBe(exact);
  });
});

describe('hasUnclosedDelimiter — ONE discipline, both directions', () => {
  it('CONVICTS the emitted witnessed string', () => {
    expect(hasUnclosedDelimiter(WITNESSED_1)).toBe(true);
  });

  it('ACQUITS the source the witnessed string was cut from', () => {
    expect(hasUnclosedDelimiter(USER_OPTION_85)).toBe(false);
    expect(hasUnclosedDelimiter(USER_OPTION_101)).toBe(false);
  });

  it('convicts each opener class and acquits its closed form', () => {
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}'], ['“', '”']]) {
      expect(hasUnclosedDelimiter(`a ${open}b`), `${open} unclosed`).toBe(true);
      expect(hasUnclosedDelimiter(`a ${open}b${close}`), `${open}${close} closed`).toBe(false);
    }
  });

  it('convicts an odd straight quote and acquits an even one', () => {
    expect(hasUnclosedDelimiter('A "quoted phrase')).toBe(true);
    expect(hasUnclosedDelimiter('A "quoted phrase"')).toBe(false);
  });

  it('STRAY CLOSER — a closer with no opener is ordinary text, not an imbalance', () => {
    // The pinned answer. A counter-based discipline would return true here and
    // the two would disagree on an input this contract admits. See the module
    // header on DELIMITER_PAIRS for why the stack reading is the correct one:
    // an elision cuts from the RIGHT and can only ever orphan an OPENER.
    expect(hasUnclosedDelimiter('we will ship the thing) and then')).toBe(false);
    expect(hasUnclosedDelimiter(')')).toBe(false);
  });

  it("treats ' and the curly apostrophe as apostrophes, not quotes", () => {
    expect(hasUnclosedDelimiter("don't stop believing")).toBe(false);
    expect(hasUnclosedDelimiter('don’t stop believing')).toBe(false);
  });
});

describe('the elider and the predicate agree — the same discipline drives both', () => {
  it('leaves the stray-closer label long instead of backing off past it', () => {
    const label = 'we will ship the thing) and then celebrate loudly';
    expect(label.length).toBeGreaterThan(40);
    const out = elideLabelAtWordBoundary(label, 40);
    expect(out).toBe('we will ship the thing) and then…');
    expect(out.length).toBeLessThanOrEqual(40);
  });

  it('backs off past an orphaned opener on the witnessed 85-char label', () => {
    const out = elideLabelAtWordBoundary(USER_OPTION_85, 40);
    expect(out).toBe('double down on enterprise sales…');
    expect(hasUnclosedDelimiter(out)).toBe(false);
  });
});

describe('INVERSE (b) — too permissive: the LAST-RESORT branch stays inside the budget', () => {
  it('cuts a single over-budget token to the cap and MARKS it, by exact string', () => {
    const token = 'a'.repeat(49);
    expect(token.length).toBe(49);
    const out = elideLabelAtWordBoundary(token, 10);
    // Identity, not a length predicate another string could satisfy.
    expect(out).toBe(`${'a'.repeat(9)}${LABEL_ELISION_MARKER}`);
    // ⚠ This assertion used to read `toBe(token)`: the whole 49-character
    // label through a 10-character budget, unmarked, on the promise that the
    // caller would clip afterwards. None of the seven callers did.
    expect(out).not.toBe(token);
    expect(out.length).toBeLessThanOrEqual(10);
    // It admits the cut, and stays a genuine prefix of what the user wrote.
    expect(out.endsWith(LABEL_ELISION_MARKER)).toBe(true);
    expect(token.startsWith(out.slice(0, -1))).toBe(true);
  });

  it('does NOT take the last-resort branch when a boundary above the floor exists', () => {
    const label = `${'a'.repeat(30)} ${'b'.repeat(40)}`;
    const out = elideLabelAtWordBoundary(label, 40);
    expect(out).not.toBe(label);
    expect(out).toBe(`${'a'.repeat(30)}${LABEL_ELISION_MARKER}`);
  });

  it('returns the trimmed label for a budget too small to hold text plus a marker', () => {
    // The documented exception to `<= max`: there is no honest elision at a
    // budget with no room for text AND a marker, and the return carries no
    // marker, so it does not claim to have elided.
    expect(elideLabelAtWordBoundary('alpha beta', 1)).toBe('alpha beta');
    expect(elideLabelAtWordBoundary('alpha beta', 0)).toBe('alpha beta');
    expect(elideLabelAtWordBoundary('alpha beta', 1).endsWith(LABEL_ELISION_MARKER)).toBe(false);
  });
});

describe('INVERSE (a) — too aggressive: the retention floor outranks delimiter closure', () => {
  const NESTED = 'Migrate (everything except the payments platform … which is a lot)';

  it('keeps the label instead of collapsing to a stub', () => {
    const out = elideLabelAtWordBoundary(NESTED, 40);
    expect(out).not.toBe(`Migrate${LABEL_ELISION_MARKER}`);
    expect(out).toBe('Migrate (everything except the payments…');
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.slice(0, -1).length).toBeGreaterThanOrEqual(floorFor(40));
  });

  it('is documented as a deliberate trade: the floor branch may leave a delimiter open', () => {
    const out = elideLabelAtWordBoundary(NESTED, 40);
    expect(hasUnclosedDelimiter(out)).toBe(true);
    // It never invents a closing character to hide that.
    expect(out.endsWith(`${LABEL_ELISION_MARKER}`)).toBe(true);
    expect(NESTED.startsWith(out.slice(0, -1))).toBe(true);
  });

  it('an already-unbalanced SOURCE cannot be fixed by any cut, and is not destroyed trying', () => {
    const adversarial = 'Ship [the (nested {thing} here] and more words after it all';
    expect(hasUnclosedDelimiter(adversarial)).toBe(true);
    const out = elideLabelAtWordBoundary(adversarial, 40);
    expect(out.slice(0, -1).length).toBeGreaterThanOrEqual(floorFor(40));
    expect(out.length).toBeLessThanOrEqual(40);
    expect(adversarial.startsWith(out.slice(0, -1))).toBe(true);
  });
});

describe('TERMINATION — the back-off runs on user text every draft turn', () => {
  it('terminates on a 20,000-case adversarial delimiter sweep within a wall-clock bound', () => {
    const alphabet = ' ()[]{}"“”’abc';
    let seed = 20260819;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    const CASES = 20000;
    let checked = 0;
    let elided = 0;
    let wholeLabel = 0;
    const started = Date.now();

    for (let n = 0; n < CASES; n += 1) {
      const len = 1 + Math.floor(next() * 120);
      let label = '';
      for (let i = 0; i < len; i += 1) {
        label += alphabet.charAt(Math.floor(next() * alphabet.length));
      }
      const max = 2 + Math.floor(next() * 60);
      const out = elideLabelAtWordBoundary(label, max);
      const trimmed = label.trim();

      checked += 1;
      if (trimmed.length <= max) {
        expect(out).toBe(trimmed);
        continue;
      }
      // ⚠ NO BARE `continue` HERE, and the reason is measured. This line used
      // to read `if (out === trimmed) continue;` — sitting ABOVE the `<= max`
      // assertion, so every over-budget label taking that branch (~44% of the
      // over-budget corpus) was exempted from the budget check AND from every
      // count, leaving the sweep green while the elider returned 56–76-char
      // labels through a 40-char budget. An exemption that shrinks its own
      // sample without saying so is the same defect as a spec that collects
      // zero tests.
      //
      // The branch is now COUNTED, SHAPE-CHECKED and BOUNDED. Under the
      // restored guarantee it is unreachable for an integer `max >= 2`, so
      // `wholeLabel` must be exactly 0 — and if the branch is ever reopened
      // this sweep REDs here and on the bound below, instead of quietly
      // measuring less.
      if (out === trimmed) {
        wholeLabel += 1;
        // Shape, so nothing else can inflate the counter: identity with the
        // trimmed label, and no claim to have elided.
        expect(out, `whole-label return at max=${max}`).toBe(trimmed);
        expect(
          out.endsWith(LABEL_ELISION_MARKER),
          `whole-label return must not claim an elision: ${JSON.stringify(out)}`,
        ).toBe(false);
        // The budget check the old `continue` skipped, applied here too.
        expect(
          out.length,
          `whole-label return overran max=${max}: ${JSON.stringify(out)}`,
        ).toBeLessThanOrEqual(max);
        continue;
      }
      elided += 1;
      expect(out.endsWith(LABEL_ELISION_MARKER), `no marker on ${JSON.stringify(out)}`).toBe(true);
      expect(out.length, `overran max=${max}: ${JSON.stringify(out)}`).toBeLessThanOrEqual(max);
      expect(trimmed.startsWith(out.slice(0, -1))).toBe(true);
    }

    const elapsed = Date.now() - started;
    // Non-empty inputs: an assertion that ran on nothing proves nothing.
    expect(checked).toBe(CASES);
    expect(elided, 'the sweep must actually exercise the elision path').toBeGreaterThan(1000);
    // EXPLICIT BOUND. `<= max` is unconditional for an integer `max >= 2`, so
    // no over-budget label may come back whole. A widening of that branch REDs
    // this line by name rather than silently exempting part of the corpus.
    expect(
      wholeLabel,
      'no over-budget label may be returned whole — the <= max guarantee is unconditional',
    ).toBe(0);
    // And the two counters must account for the WHOLE over-budget corpus.
    expect(elided + wholeLabel, 'every over-budget case must be classified').toBeGreaterThan(1000);
    expect(elapsed, `sweep took ${elapsed}ms`).toBeLessThan(10000);
  });

  it('terminates on pathological all-opener and all-space inputs, INSIDE the budget', () => {
    // ⚠ All three assertions here used to pin the whole input as the intended
    // return — the first pinned a 500-character overrun through a 40-character
    // budget as correct behaviour. Under the restored `<= max` guarantee they
    // RED, and that red is the point, not a failure.
    const openers = '('.repeat(500);
    expect(elideLabelAtWordBoundary(openers, 40)).toBe(
      `${'('.repeat(39)}${LABEL_ELISION_MARKER}`,
    );
    expect(elideLabelAtWordBoundary(openers, 40).length).toBe(40);

    // Same class: the only word boundary sits at index 60, outside the budget.
    const spaced = `${'x'.repeat(60)} ${'y'.repeat(60)}`;
    expect(elideLabelAtWordBoundary(spaced, 40)).toBe(
      `${'x'.repeat(39)}${LABEL_ELISION_MARKER}`,
    );

    // Boundaries exist but every one of them is below the floor.
    const manySpaces = `a${' '.repeat(200)}b${' '.repeat(200)}c`;
    expect(elideLabelAtWordBoundary(manySpaces, 40)).toBe(`a${LABEL_ELISION_MARKER}`);
    expect(elideLabelAtWordBoundary(manySpaces, 40).length).toBeLessThanOrEqual(40);
  });
});

describe('non-string and degenerate inputs never throw', () => {
  it('handles a non-string label defensively', () => {
    expect(elideLabelAtWordBoundary(undefined as unknown as string, 40)).toBe('');
    expect(elideLabelAtWordBoundary(null as unknown as string, 40)).toBe('');
  });

  it('handles a non-integer max defensively', () => {
    expect(elideLabelAtWordBoundary(USER_OPTION_85, Number.NaN)).toBe(USER_OPTION_85);
    expect(elideLabelAtWordBoundary(USER_OPTION_85, 40.5)).toBe(USER_OPTION_85);
  });
});

// ---------------------------------------------------------------------------
// UX-GATE-4 — THE PHRASE BOUNDARY (the half of the 18 Aug prescription that
// N26 did not land)
// ---------------------------------------------------------------------------
/**
 * N26 made the cut ADMIT itself (one U+2026) and made it land on a WORD
 * boundary. The UX gate re-witnessed the seam on 19 AND 20 August and found
 * the remaining half open: a word boundary is not a PHRASE boundary, so the
 * product still stops on a word that cannot end a phrase.
 *
 * Both strings below were reproduced BYTE-FOR-BYTE by executing the shipped
 * `elideLabelAtWordBoundary` at staging `2b6ec553` / CEE `19a60fd` before this
 * change — they are the witness, not an invention of this spec.
 *
 * ⭐ THESE ASSERTIONS ARE WRITTEN AGAINST THE SPEC, NOT THE FAILURE MODE.
 * The property is "the retained text does not end on a word that cannot end a
 * phrase", expressed through the module's own exported predicate so this file
 * cannot mirror the rule wrong (platform trap 12). The exact-output pins are
 * kept alongside because a predicate-only assertion would pass against an
 * implementation that backed off to a stub.
 */
import { endsOnDanglingWord } from '../label-elision.js';

const WITNESS_GOAL_80 =
  'Several of our largest enterprise customers are asking for a self-hosted deployment option before they will renew';
const WITNESS_LABEL_40 = 'hold the line on cloud-only for another two quarters';

describe('UX-GATE-4 — an elision never ends on a word that cannot end a phrase', () => {
  it('backs off a trailing DETERMINER and the preposition behind it (witnessed option label @40)', () => {
    const out = elideLabelAtWordBoundary(WITNESS_LABEL_40, 40);
    // The witnessed defect, pinned as the thing that must NOT come back.
    expect(out).not.toBe('hold the line on cloud-only for another…');
    expect(out).toBe('hold the line on cloud-only…');
  });

  it('rejects every dangling tail class: determiner, preposition, conjunction, auxiliary', () => {
    const cases: Array<[string, number]> = [
      ['hold the line on cloud-only for another two quarters', 40],
      ['Reduce onboarding time for new enterprise customers', 32],
      ['Migrate the billing platform to the cloud before the audit', 40],
      ['Grow the mid-market segment and the enterprise segment', 36],
      ['Decide whether the pricing model is worth defending now', 34],
    ];
    for (const [label, max] of cases) {
      const out = elideLabelAtWordBoundary(label, max);
      const retained = out.endsWith(LABEL_ELISION_MARKER)
        ? out.slice(0, -LABEL_ELISION_MARKER.length)
        : out;
      expect(
        endsOnDanglingWord(retained),
        `elision of ${JSON.stringify(label)} @${max} ended on a dangling word: ${JSON.stringify(out)}`,
      ).toBe(false);
    }
  });

  it('folds case — a Title Case label dangles on "Another" exactly as a lowercase one does', () => {
    /**
     * Added because a mutant that DELETED the `.toLowerCase()` survived the
     * first kit: every corpus label was lowercase, so the guard could not
     * observe its own case-folding. Title Case is an ordinary way for a user
     * to write an option name, so the survivor was a corpus gap rather than an
     * equivalent mutant — demonstrated by execution before this case was
     * written, not assumed.
     */
    expect(endsOnDanglingWord('Hold The Line On Cloud-Only For Another')).toBe(true);
    expect(elideLabelAtWordBoundary('Hold The Line On Cloud-Only For Another Year', 40)).toBe(
      'Hold The Line On Cloud-Only…',
    );
  });

  it('never lets the phrase preference breach the budget guarantee', () => {
    for (const max of [12, 20, 32, 40, 80]) {
      const out = elideLabelAtWordBoundary(WITNESS_LABEL_40, max);
      expect(out.length, `budget ${max} overrun by ${JSON.stringify(out)}`).toBeLessThanOrEqual(max);
    }
  });

  it('leaves a label that ends on a CONTENT word untouched — the rule never deletes user words it need not', () => {
    // Opposite-direction twin: the guard must not fire on a good cut.
    const out = elideLabelAtWordBoundary('Invest in a major sales push into the NHS market', 40);
    expect(out).toBe('Invest in a major sales push…');
    expect(endsOnDanglingWord('Invest in a major sales push')).toBe(false);
  });

  it('KNOWN LIMIT, pinned by execution: a content-word tail left dangling by an EARLIER determiner is not detected', () => {
    /**
     * ⚠ THE WITNESSED GOAL STRING IS NOT FIXED BY THIS CHANGE, and that is a
     * measured decision rather than an oversight.
     *
     * `"…are asking for a self-hosted"` ends on a CONTENT word. It reads broken
     * only because the determiner `a` two tokens back has no noun — which needs
     * a part-of-speech lexicon to know, because the identical shape
     * `<determiner> <token>` is a perfectly good phrase ending in
     * `"Defend and hold the line"`.
     *
     * The obvious next round (also reject a head whose second-to-last token is
     * a determiner) was RUN BEFORE BEING COMMISSIONED, per platform trap 22f:
     * it fixes this string and simultaneously breaks the legitimate one,
     * turning `"Defend and hold the line…"` into `"Defend and hold…"`. That is
     * an oscillation, not a fix, so it is deliberately NOT shipped.
     *
     * This test pins the gap EXACTLY: it REDs if the limit is closed (so the
     * comment stops being true) and it REDs if the output degrades further.
     */
    const out = elideLabelAtWordBoundary(WITNESS_GOAL_80, 80);
    expect(out).toBe('Several of our largest enterprise customers are asking for a self-hosted…');
    // The dangling-word rule is genuinely not firing here — not silently absent.
    expect(endsOnDanglingWord('Several of our largest enterprise customers are asking for a self-hosted')).toBe(false);
    // And the oscillating alternative is pinned as REJECTED by execution:
    expect(elideLabelAtWordBoundary('Defend and hold the line against the incumbent', 30)).toBe(
      'Defend and hold the line…',
    );
  });
});
