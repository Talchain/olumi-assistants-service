/**
 * ⭐⭐ THE MIRROR THAT CANNOT DRIFT SILENTLY.
 *
 * `missing-value-answer.ts` needs "which words mark an approximation". The
 * estate already owns that: `APPROX` in `context/cqe/rules.ts`, which CQE uses
 * to set `quantity.approximate`. It is NOT exported — `CQE_NUMERIC_SOURCE`,
 * `CURRENCY_SYMBOL_SOURCE` and `NUMERIC_SUFFIX_SOURCE` are, precisely so
 * consumers outside CQE share the grammar rather than re-implement it, and
 * `rules.ts`'s own header records that *"every previous local copy of a CQE
 * fragment drifted (bare-`b` suffix, `¥` currency)"*.
 *
 * `rules.ts` is not this lane's file to change, so the alternatives are copied.
 * A copy is only acceptable here because THIS TEST DERIVES THE ORIGINAL and REDs
 * on drift: it reads `rules.ts`'s source, extracts the `APPROX` literal, and
 * asserts the binder reads every one of CQE's hedge words. If CQE gains a hedge,
 * this goes red by name rather than the binder quietly refusing a phrasing the
 * rest of the product treats as a hedge.
 *
 * ⚠ IT CARRIES ITS OWN POSITIVE AND CONTRAST CONTROLS. An extractor that
 * silently matched nothing would assert over an empty list and pass — trap 13,
 * in the one place where a false clean means the guard is off.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readMissingValueAnswer } from '../missing-value-answer.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = resolvePath(HERE, '../../context/cqe/rules.ts');

/** The `APPROX` alternatives, read out of CQE's source rather than restated. */
function deriveCqeApproxWords(): readonly string[] {
  const source = readFileSync(RULES_PATH, 'utf8');
  const match = /const\s+APPROX\s*=\s*String\.raw`([^`]+)`/.exec(source);
  if (match === null || match[1] === undefined) {
    throw new Error(
      `Could not locate the APPROX literal in ${RULES_PATH}. `
      + 'The extractor is blind — fix it rather than deleting this guard.',
    );
  }
  return match[1].split('|').map((w) => w.trim()).filter((w) => w.length > 0);
}

describe('CQE hedge vocabulary — derived, with controls', () => {
  const words = deriveCqeApproxWords();

  it('POSITIVE CONTROL: the extractor found a plausible number of hedge words', () => {
    // An implausible or convenient count is evidence about the instrument.
    // `roughly|about|approximately|around|nearly|circa` is six at the tip this
    // guard was written against; the floor is deliberately below that so a
    // legitimate addition does not red THIS assertion, and deliberately above
    // zero so a blind extractor cannot pass.
    expect(words.length).toBeGreaterThanOrEqual(4);
    expect(words).toContain('about');
    expect(words).toContain('roughly');
  });

  it('CONTRAST CONTROL: the extractor can still say no', () => {
    // A fabricated word must NOT appear. If it did, the extractor is matching
    // something other than what it names.
    expect(words).not.toContain('zzfabricatedhedge');
  });

  it.each(deriveCqeApproxWords())(
    'the binder reads "%s 0.6" as the user stating 0.6',
    (word) => {
      const reading = readMissingValueAnswer(`${word} 0.6`);
      expect(reading, `CQE treats "${word}" as a hedge and the binder does not`).not.toBeNull();
      expect(reading?.kind).toBe('numeric');
      if (reading?.kind !== 'numeric') return;
      expect(reading.valueText).toBe('0.6');
      expect(reading.modelUnitText).toBe('0.6');
    },
  );

  it('⚠ DISCRIMINATION: a word CQE does not treat as a hedge is not silently admitted', () => {
    // The binder's set is a superset of CQE's by design (it also carries the
    // estate's measured witnesses: "say", "I think", "(ish)"). What it must NOT
    // do is admit an arbitrary content word, which would mean the whole-message
    // anchor had stopped discriminating.
    for (const notAHedge of ['revenue', 'churn', 'headcount', 'the payroll cost']) {
      expect(readMissingValueAnswer(`${notAHedge} 0.6`), notAHedge).toBeNull();
    }
  });
});
