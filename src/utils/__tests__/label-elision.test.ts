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

describe('INVERSE (b) — too permissive: the whole-label branch, bounded', () => {
  it('returns the whole label BY IDENTITY when a single token exceeds the budget', () => {
    const token = 'a'.repeat(49);
    expect(token.length).toBe(49);
    const out = elideLabelAtWordBoundary(token, 10);
    // Identity, not a length predicate another string could satisfy.
    expect(out).toBe(token);
    // Bounded overrun: it returns the label, never more than the label.
    expect(out.length).toBe(token.length);
    expect(out.length).toBeLessThanOrEqual(token.length);
    // And it does NOT claim to have elided.
    expect(out.endsWith(LABEL_ELISION_MARKER)).toBe(false);
  });

  it('does NOT take the whole-label branch when a boundary above the floor exists', () => {
    const label = `${'a'.repeat(30)} ${'b'.repeat(40)}`;
    const out = elideLabelAtWordBoundary(label, 40);
    expect(out).not.toBe(label);
    expect(out).toBe(`${'a'.repeat(30)}${LABEL_ELISION_MARKER}`);
  });

  it('returns the trimmed label for a budget too small to hold text plus a marker', () => {
    expect(elideLabelAtWordBoundary('alpha beta', 1)).toBe('alpha beta');
    expect(elideLabelAtWordBoundary('alpha beta', 0)).toBe('alpha beta');
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
      if (out === trimmed) continue; // documented whole-label branch
      elided += 1;
      expect(out.endsWith(LABEL_ELISION_MARKER), `no marker on ${JSON.stringify(out)}`).toBe(true);
      expect(out.length, `overran max=${max}: ${JSON.stringify(out)}`).toBeLessThanOrEqual(max);
      expect(trimmed.startsWith(out.slice(0, -1))).toBe(true);
    }

    const elapsed = Date.now() - started;
    // Non-empty inputs: an assertion that ran on nothing proves nothing.
    expect(checked).toBe(CASES);
    expect(elided, 'the sweep must actually exercise the elision path').toBeGreaterThan(1000);
    expect(elapsed, `sweep took ${elapsed}ms`).toBeLessThan(10000);
  });

  it('terminates on pathological all-opener and all-space inputs', () => {
    const openers = '('.repeat(500);
    expect(elideLabelAtWordBoundary(openers, 40)).toBe(openers);
    const spaced = `${'x'.repeat(60)} ${'y'.repeat(60)}`;
    expect(elideLabelAtWordBoundary(spaced, 40)).toBe(spaced);
    const manySpaces = `a${' '.repeat(200)}b${' '.repeat(200)}c`;
    expect(elideLabelAtWordBoundary(manySpaces, 40).length).toBeLessThanOrEqual(
      manySpaces.trim().length,
    );
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
