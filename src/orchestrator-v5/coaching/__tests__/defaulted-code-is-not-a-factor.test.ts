/**
 * F6 — A DISCLOSURE CODE IS NOT A FACTOR, AND MUST NOT BE COUNTED AS ONE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE MEASURED DEFECT
 *
 * `enrichment.decision_brief.defaulted_assumptions[]` carries TWO producer
 * shapes, and only one of them names a factor:
 *
 *   FACTOR-LEVEL   { factor_label: 'Market Conditions', source: 'value_defaulted' }
 *   ENGINE-LEVEL   { factor_label: null, code: 'ROOT_NODE_DEFAULT_VALUE',
 *                    source: 'default_disclosure',
 *                    note: "No observed value provided for root node '099f7ecf'…" }
 *
 * The normaliser counted BOTH as entries and the builder spent that one number
 * as a count of FACTORS, so a payload carrying two engine-level codes and no
 * factor at all rendered:
 *
 *     "The analysis used a default value for 2 of the factors in your model,
 *      which have no value set, …"
 *
 * — where neither entry is a factor. A product that exists to help someone
 * reason about their own model told them a false thing about that model, in
 * the one sentence whose whole job is to be honest about what was guessed.
 *
 * ⚠ AND THE FIX MUST NOT INVENT THE MIRROR HARM (CLAUDE.md trap 22b — one
 * predicate, two opposite harms). An engine-level code is still EVIDENCE that
 * a value was defaulted, so it must keep standing the stability assertion
 * down. Under-counting the evidence would silently restore a confidence claim
 * over defaulted inputs, which is the defect this whole layer was built to
 * close. Both directions are asserted below.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SCOPE OF THE EVIDENCE, STATED (CLAUDE.md trap 20)
 *
 * Every ENTRY below is read VERBATIM out of a dated capture on disk — none is
 * authored here, because a fixture you write yourself is not evidence about
 * the wire (trap 16-inverse), and that is the exact instrument defect that let
 * this module's original read path ship dead.
 *
 * What IS composed here: the multi-entry ARRAYS. No committed capture holds
 * two entries at once, so the two-code and mixed cases place two real entries
 * side by side. The entries are the producer's; the arity is this suite's, and
 * it is named rather than implied.
 *
 * ⚠ FIXTURES ARE READ, NEVER EDITED (trap 14b) — they record what the producer
 * actually sent on a dated run.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildDefaultedAssumptionsDisclosure,
  DEFAULTED_DISCLOSURE_TAIL,
  MAX_NAMED_DEFAULTED_FACTORS,
  readDefaultedAssumptions,
  readDefaultedAssumptionsFromEnrichment,
} from '../pick-defaulted-assumptions.js';
import {
  applyDefaultedValueEgress,
  findStabilityAssertion,
} from '../../compose/defaulted-value-egress.js';

function readJson(relative: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >;
}

function entriesOf(enrichment: Record<string, unknown>): readonly Record<string, unknown>[] {
  const brief = enrichment['decision_brief'] as Record<string, unknown> | undefined;
  const raw = brief?.['defaulted_assumptions'];
  expect(Array.isArray(raw)).toBe(true);
  return raw as readonly Record<string, unknown>[];
}

/** `ROOT_NODE_DEFAULT_VALUE`, root node '099f7ecf' — 3 Sep 2026 live analysis. */
const CODE_ENTRY_A = entriesOf(
  readJson('../../compose/__tests__/fixtures/analysis-result-live-2026-09-03.json')[
    'enrichment'
  ] as Record<string, unknown>,
)[0]!;

/** `ROOT_NODE_DEFAULT_VALUE`, root node '16ec3d64' — 3 Sep 2026 decision review. */
const CODE_ENTRY_B = entriesOf(
  readJson('../../../cee/decision-review/__tests__/fixtures/live-decision-review-2026-09-03.json')[
    'enrichment'
  ] as Record<string, unknown>,
)[0]!;

/** `value_defaulted` on 'Market Conditions' — the DSK walk, session A. */
const FACTOR_ENTRY = entriesOf(
  readJson('../../compose/__tests__/fixtures/dsk-walk/session-a.enrichment.json'),
)[0]!;

describe('PRECONDITION — these captures really are the discriminating pair', () => {
  /**
   * Without this the whole suite could be measuring one shape twice, and every
   * assertion below would pass by not being exercised (trap 13b).
   */
  it('the engine-level entries name NO factor and carry a code', () => {
    for (const entry of [CODE_ENTRY_A, CODE_ENTRY_B]) {
      expect(entry['factor_label']).toBeNull();
      expect(typeof entry['code']).toBe('string');
      expect(entry['source']).toBe('default_disclosure');
    }
    expect(CODE_ENTRY_A['code']).toBe('ROOT_NODE_DEFAULT_VALUE');
    // Two DIFFERENT captures, or the two-entry array below is one entry twice.
    expect(CODE_ENTRY_A['note']).not.toBe(CODE_ENTRY_B['note']);
  });

  it('the factor-level entry names a factor and carries NO code', () => {
    expect(FACTOR_ENTRY['factor_label']).toBe('Market Conditions');
    expect(FACTOR_ENTRY['code']).toBeUndefined();
    expect(FACTOR_ENTRY['source']).toBe('value_defaulted');
  });
});

describe('the count separates EVIDENCE from FACTORS', () => {
  it('a real named factor still counts as a factor', () => {
    const signal = readDefaultedAssumptions([FACTOR_ENTRY])!;
    expect(signal.count).toBe(1);
    expect(signal.factorCount).toBe(1);
    expect(signal.named).toEqual(['Market Conditions']);
  });

  it('a bare engine code is evidence, and is NOT a factor', () => {
    const signal = readDefaultedAssumptions([CODE_ENTRY_A])!;
    // EVIDENCE — unchanged, so the stability suppression keeps firing.
    expect(signal.count).toBe(1);
    // FACTORS — zero, because the entry names none.
    expect(signal.factorCount).toBe(0);
    expect(signal.named).toEqual([]);
  });

  it('two engine codes are two pieces of evidence and ZERO factors', () => {
    const signal = readDefaultedAssumptions([CODE_ENTRY_A, CODE_ENTRY_B])!;
    expect(signal.count).toBe(2);
    expect(signal.factorCount).toBe(0);
  });

  it('a mixed payload counts only the factor as a factor', () => {
    const signal = readDefaultedAssumptions([FACTOR_ENTRY, CODE_ENTRY_A])!;
    expect(signal.count).toBe(2);
    expect(signal.factorCount).toBe(1);
    expect(signal.named).toEqual(['Market Conditions']);
  });

  /**
   * ⚠ AUTHORED, AND SAID SO. The seam is `z.record` — untyped — so the contract
   * admits a blank label, and a corpus is only evidence over the classes it
   * contains (trap 13d). This entry is a SHAPE PROBE over what the seam admits,
   * not a claim that the producer emits it. A blank label names no factor, and
   * counting it as one would print "one of the factors in your model" with
   * nothing behind it.
   */
  it('a blank label names no factor either', () => {
    const signal = readDefaultedAssumptions([{ factor_label: '   ', source: 'value_defaulted' }])!;
    expect(signal.count).toBe(1);
    expect(signal.factorCount).toBe(0);
    expect(buildDefaultedAssumptionsDisclosure(signal)).not.toContain(
      'of the factors in your model',
    );
  });

  it('reads the same verdict through the producer path, not just the array', () => {
    const enrichment = readJson(
      '../../compose/__tests__/fixtures/analysis-result-live-2026-09-03.json',
    )['enrichment'];
    const signal = readDefaultedAssumptionsFromEnrichment(enrichment)!;
    expect(signal.count).toBe(1);
    expect(signal.factorCount).toBe(0);
  });
});

describe('the sentence never claims a factor the payload did not name', () => {
  it('THE DEFECT — two engine codes must not render “2 of the factors”', () => {
    const text = buildDefaultedAssumptionsDisclosure(
      readDefaultedAssumptions([CODE_ENTRY_A, CODE_ENTRY_B])!,
    );
    expect(text).not.toContain('2 of the factors in your model');
    expect(text).not.toContain('of the factors in your model');
    // No count of anything at all: if nothing nameable arrived, the honest
    // sentence says so without asserting a number.
    expect(text).not.toMatch(/\d/);
    expect(text.endsWith(DEFAULTED_DISCLOSURE_TAIL)).toBe(true);
  });

  it('one engine code must not render “one of the factors” either', () => {
    const text = buildDefaultedAssumptionsDisclosure(readDefaultedAssumptions([CODE_ENTRY_A])!);
    expect(text).not.toContain('one of the factors in your model');
    expect(text).not.toContain('of the factors in your model');
    expect(text.endsWith(DEFAULTED_DISCLOSURE_TAIL)).toBe(true);
  });

  it('DISCRIMINATING TWIN — a real factor is still named', () => {
    const text = buildDefaultedAssumptionsDisclosure(readDefaultedAssumptions([FACTOR_ENTRY])!);
    expect(text).toContain("The analysis used a default value for 'Market Conditions'");
    expect(text).toContain('which has no value set');
    expect(text.endsWith(DEFAULTED_DISCLOSURE_TAIL)).toBe(true);
  });

  it('a mixed payload names the factor AND discloses the rest, without inflating', () => {
    const text = buildDefaultedAssumptionsDisclosure(
      readDefaultedAssumptions([FACTOR_ENTRY, CODE_ENTRY_A])!,
    );
    expect(text).toContain("'Market Conditions'");
    expect(text).not.toContain('2 of the factors in your model');
    // The engine-level default is not silently dropped: a half-list read as a
    // complete one is the under-disclosure the cap rule already guards against.
    expect(text).toContain('did not attribute to a named factor');
    expect(text.endsWith(DEFAULTED_DISCLOSURE_TAIL)).toBe(true);
  });

  /**
   * ⭐⭐ THE BRANCH WHERE THE TWO NUMBERS CAN VISIBLY DISAGREE — and the reason
   * this test exists is that a mutant found the hole, not a reading.
   *
   * Restoring the defect (subject built from `count`) SURVIVED the first
   * version of this suite. Every mixed case it held was NAMED, and the named
   * branch prints labels rather than a number, so it hides the difference by
   * construction. The count form is reached only when the factors cannot all
   * be shown — past the naming cap, or unnameable — and until that case sat
   * beside an engine-level code, nothing here could see `count` being spent as
   * a factor count. A corpus that cannot reach the branch is not coverage of
   * it (trap 22: the defect lived in the breadth, not the invariant).
   */
  it('the COUNT form spends the factor count, not the evidence count', () => {
    const signal = readDefaultedAssumptions([
      FACTOR_ENTRY,
      FACTOR_ENTRY,
      FACTOR_ENTRY,
      FACTOR_ENTRY,
      CODE_ENTRY_A,
    ])!;
    // PRECONDITION: past the naming cap (so the count form is reached) AND
    // carrying an engine-level code (so the two numbers differ). Without both,
    // this test cannot discriminate.
    expect(signal.count).toBe(5);
    expect(signal.factorCount).toBe(4);
    expect(signal.named).toHaveLength(MAX_NAMED_DEFAULTED_FACTORS);

    const text = buildDefaultedAssumptionsDisclosure(signal);
    expect(text).toContain('4 of the factors in your model');
    expect(text).not.toContain('5 of the factors in your model');
    expect(text).toContain('which have no value set');
  });

  /**
   * The same branch at count 1 — the VERB is the second reader of the number,
   * and a fix applied to the subject alone would leave it disagreeing.
   *
   * ⚠ AUTHORED SHAPE PROBE, said so: an id-shaped `factor_label` identifies a
   * factor without being showable. The seam is untyped and `sanitiseLabel`
   * exists precisely because ids arrive on it; no committed capture pairs one
   * with a code, so the pairing is composed here.
   */
  it('the verb agrees with the factor count, not the evidence count', () => {
    const signal = readDefaultedAssumptions([
      { factor_label: 'fac_7809def4', source: 'value_defaulted' },
      CODE_ENTRY_A,
    ])!;
    expect(signal.count).toBe(2);
    expect(signal.factorCount).toBe(1);
    expect(signal.named).toEqual([]);

    const text = buildDefaultedAssumptionsDisclosure(signal);
    expect(text).toContain('one of the factors in your model, which has no value set');
    expect(text).not.toContain('2 of the factors');
    expect(text).not.toContain('which have no value set');
    // The id is identified, never printed.
    expect(text).not.toContain('fac_7809def4');
  });

  it('never blames the user, on any permutation', () => {
    for (const entries of [
      [FACTOR_ENTRY],
      [CODE_ENTRY_A],
      [CODE_ENTRY_A, CODE_ENTRY_B],
      [FACTOR_ENTRY, CODE_ENTRY_A],
    ]) {
      const text = buildDefaultedAssumptionsDisclosure(readDefaultedAssumptions(entries)!);
      expect(text).toMatch(/^The analysis used /);
      expect(text.toLowerCase()).not.toContain('you ');
      expect(text.toLowerCase()).not.toContain('because');
    }
  });

  /**
   * ⭐ THE EVIDENCE COUNT MAY NEVER BECOME A NUMBER OF FACTORS. `count` and
   * `factorCount` answer two different questions under one object (trap 21);
   * this is the guard that stops a later reader spending the first on the
   * second again, which is exactly how the defect arrived.
   *
   * Raising `count` while holding `factorCount` fixed may add the unattributed
   * clause — it may not move the factor claim by one.
   */
  it('raising the EVIDENCE count never raises the number of factors claimed', () => {
    const one = readDefaultedAssumptions([FACTOR_ENTRY])!;
    const many = readDefaultedAssumptions([FACTOR_ENTRY, CODE_ENTRY_A, CODE_ENTRY_B])!;
    // PRECONDITION: the two signals really do differ in `count` and agree in
    // `factorCount`, or this asserts nothing.
    expect(one.count).toBe(1);
    expect(many.count).toBe(3);
    expect(one.factorCount).toBe(many.factorCount);

    const oneText = buildDefaultedAssumptionsDisclosure(one);
    const manyText = buildDefaultedAssumptionsDisclosure(many);
    // The factor claim is the SAME claim in both: one named factor.
    for (const text of [oneText, manyText]) {
      expect(text).toContain("a default value for 'Market Conditions', which has no value set");
      expect(text).not.toContain('3 of the factors');
      expect(text).not.toContain('2 of the factors');
    }
    // …and the extra evidence is disclosed as what it is, not folded in.
    expect(oneText).not.toContain('did not attribute to a named factor');
    expect(manyText).toContain('did not attribute to a named factor');

    // Codes only: the count moves, the sentence does not move at all.
    const oneCode = readDefaultedAssumptions([CODE_ENTRY_A])!;
    const twoCodes = readDefaultedAssumptions([CODE_ENTRY_A, CODE_ENTRY_B])!;
    expect(oneCode.count).not.toBe(twoCodes.count);
    expect(buildDefaultedAssumptionsDisclosure(oneCode)).toBe(
      buildDefaultedAssumptionsDisclosure(twoCodes),
    );
  });
});

describe('THE OPPOSITE HARM — evidence still suppresses the stability claim', () => {
  const STABLE = 'Launch leads with a probability of 82%. This result looks stable.';

  it('PRECONDITION — the fixture really does carry a stability assertion', () => {
    expect(findStabilityAssertion('This result looks stable.')).not.toBeNull();
  });

  it('a codes-only run still stands the stability assertion down', () => {
    const signal = readDefaultedAssumptions([CODE_ENTRY_A, CODE_ENTRY_B])!;
    const out = applyDefaultedValueEgress(STABLE, signal);
    expect(out.mode).toBe('applied');
    expect(out.text).not.toContain('This result looks stable');
    expect(out.text).toContain(DEFAULTED_DISCLOSURE_TAIL);
  });

  it('NO defaults ⇒ not one byte (the fail-safe direction, unchanged)', () => {
    expect(applyDefaultedValueEgress(STABLE, null).text).toBe(STABLE);
  });
});
