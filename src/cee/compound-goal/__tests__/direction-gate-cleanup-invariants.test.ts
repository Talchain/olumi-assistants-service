/**
 * THE PRECONDITIONS THE BEHAVIOUR-PRESERVING CLEANUP OF `direction-gate.ts`
 * RESTS ON — asserted, not assumed.
 *
 * Every optimisation in that pass replaced a repeated derivation with a hoisted
 * one. Each replacement is sound only because of a property that was previously
 * nowhere stated, and an unstated precondition is exactly what a later refactor
 * removes without going red (CLAUDE.md trap 12). The four are:
 *
 *   1. `normaliseEvidenceText` is IDEMPOTENT — the screens are now handed
 *      already-normalised text and normalise it again internally;
 *   2. `String.prototype.matchAll` does NOT advance the `lastIndex` of the
 *      regex it is given — the per-call `new RegExp(re.source, re.flags)`
 *      clones were removed on that basis;
 *   3. threading a PREPARED brief is observationally identical to letting each
 *      entry point prepare its own;
 *   4. the floor-or-ceiling question is ONE sentence, and the three sites that
 *      used to type it out are byte-identical to each other.
 *
 * Plus the one deliberate BEHAVIOUR CHANGE of the pass, pinned with its
 * before/after so it can never be mistaken for an accident.
 *
 * ⚠ THE IDEMPOTENCY CORPUS COMES FROM OUTSIDE THIS LANE'S HEAD (trap 22): it is
 * every string literal in the gate's two existing corpus suites, whose cases
 * come from the Codex F1 audit and the #888 review corpora. A corpus I wrote
 * would test the typography I happened to think of.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildUnresolvedItem,
  deriveAmountText,
  detectUncoveredNegatedBounds,
  detectorItem,
  findProvenUncoveredBounds,
  findT1Matches,
  normaliseEvidenceText,
  partitionUnprovenDirection,
  prepareBrief,
  renderDirectionClarifications,
  type GateableConstraint,
} from '../direction-gate.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** Every quoted string in a source file — single, double and backtick. */
function stringLiteralsIn(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of src.matchAll(/'([^'\\\n]{4,200})'|"([^"\\\n]{4,200})"|`([^`\\$]{4,200})`/g)) {
    const t = m[1] ?? m[2] ?? m[3];
    if (typeof t === 'string') out.push(t);
  }
  return out;
}

const EXTERNAL_CORPUS: readonly string[] = [
  ...stringLiteralsIn(`${HERE}direction-gate-corpus.test.ts`),
  ...stringLiteralsIn(`${HERE}direction-gate-lexicon-completeness.test.ts`),
];

/** Typography the corpus above may not happen to spell. */
const TYPOGRAPHY_CORPUS: readonly string[] = [
  '',
  '   ',
  '\n\n',
  'Don’t let gross margin drop below 78%.',
  '  Keep   churn    under\t4%.  ',
  '“Retention” must not fall below 92%',
  'Keep spend under 1,500,000 next year.',
  'Do not let the £1.5m marketing spend push gross margin below 78%',
];

describe('precondition 1 — normaliseEvidenceText is idempotent', () => {
  it('normalise(normalise(x)) === normalise(x) over the external corpus', () => {
    // Non-vacuity (trap 13b): a corpus that silently extracted nothing would
    // agree with every claim made about it.
    expect(
      EXTERNAL_CORPUS.length,
      'extracted no string literals from the gate corpus suites — the corpus is blind',
    ).toBeGreaterThan(100);

    for (const raw of [...EXTERNAL_CORPUS, ...TYPOGRAPHY_CORPUS]) {
      const once = normaliseEvidenceText(raw);
      expect(normaliseEvidenceText(once), `not idempotent on: ${JSON.stringify(raw)}`).toBe(once);
    }
  });

  it('the corpus actually exercises normalisation (the probe is not a no-op)', () => {
    // The discriminating half. Without it, `normaliseEvidenceText = x => x`
    // would satisfy the assertion above perfectly (trap 13b).
    const changed = [...EXTERNAL_CORPUS, ...TYPOGRAPHY_CORPUS].filter(
      (raw) => normaliseEvidenceText(raw) !== raw,
    );
    expect(
      changed.length,
      'no corpus member is changed by normalisation — idempotency is being asserted vacuously',
    ).toBeGreaterThan(0);
  });
});

describe('precondition 2 — matchAll never advances the source regex', () => {
  it('a global regex driven to exhaustion by matchAll still reads lastIndex 0', () => {
    // The language guarantee the clone removal rests on, asserted directly:
    // `RegExp.prototype[Symbol.matchAll]` builds its OWN matcher and advances
    // that one. If a future runtime broke this, the gate's screens would start
    // skipping the head of every second sentence — silently.
    const re = /\d+/g;
    const first = [...'a 1 b 22 c 333'.matchAll(re)].map((m) => m[0]);
    expect(first).toEqual(['1', '22', '333']);
    expect(re.lastIndex, 'matchAll advanced the source regex — the clone removal is unsound').toBe(0);
    const second = [...'a 1 b 22 c 333'.matchAll(re)].map((m) => m[0]);
    expect(second, 'a second matchAll over the same regex produced different results').toEqual(first);
  });

  it('findT1Matches is repeatable, and interleaving sentences does not shift results', () => {
    const a = 'Do not let gross margin drop below 78%.';
    const b = 'Keep churn from rising above 4% and do not let CSAT drop below 85%.';
    const a1 = findT1Matches(a);
    const b1 = findT1Matches(b);
    expect(a1.length, 'the fixture must carry a construction, or this proves nothing').toBeGreaterThan(0);
    expect(b1.length).toBeGreaterThan(1);
    expect(findT1Matches(a)).toEqual(a1);
    expect(findT1Matches(b)).toEqual(b1);
    // Interleave: a leaked lastIndex would make the second reading of `a` short.
    findT1Matches(b);
    expect(findT1Matches(a)).toEqual(a1);
  });

  it('detectUncoveredNegatedBounds is repeatable across interleaved briefs', () => {
    const brief = 'Retention must not — even during migration — fall below 92%.';
    const other = 'We have not decided whether 4% churn is a floor or a ceiling.';
    const first = detectUncoveredNegatedBounds(brief, [], new Set<number>());
    expect(first.length, 'the fixture must produce a finding').toBeGreaterThan(0);
    detectUncoveredNegatedBounds(other, [], new Set<number>());
    expect(detectUncoveredNegatedBounds(brief, [], new Set<number>())).toEqual(first);
  });
});

describe('precondition 3 — a prepared brief is observationally identical', () => {
  const BRIEFS: readonly string[] = [
    'Do not let gross margin drop below 78%. Keep churn under 4%.',
    'Retention must not — even during migration — fall below 92%.',
    'We have not decided whether 78% is a floor or a ceiling for gross margin.',
    'Keep cash runway from shrinking below 250000 and hold spend under £50k.',
    'Without letting gross margin drop below 78% or churn fall below 90%.',
    '',
    '   ',
  ];

  const ROWS: readonly GateableConstraint[] = [
    { node_id: 'fac_gross_margin', operator: '<=', value: 0.78, unit: 'fraction', source_quote: 'gross margin drop below 78%', label: 'gross margin' },
    { node_id: 'fac_churn', operator: '<=', value: 0.04, unit: 'fraction', source_quote: 'Keep churn under 4%', label: 'churn' },
    { node_id: 'out_retention', operator: '<=', value: 0.92, unit: 'fraction', source_quote: 'fall below 92%', label: 'retention' },
    { node_id: 'fac_runway', operator: '<=', value: 250000, unit: '£', source_quote: 'cash runway from shrinking below 250000', label: 'cash runway' },
    { node_id: 'fac_spend', operator: '>=', value: 50000, unit: '£', label: 'spend' },
  ];

  it('partitionUnprovenDirection agrees with and without the prepared argument', () => {
    let nonTrivial = 0;
    for (const brief of BRIEFS) {
      const withoutPrep = partitionUnprovenDirection(ROWS, brief);
      const withPrep = partitionUnprovenDirection(ROWS, brief, undefined, prepareBrief(brief));
      expect(withPrep, `prepared threading changed the partition for: ${brief}`).toEqual(withoutPrep);
      if (withoutPrep.unresolved.length > 0 || withoutPrep.nonLimit.length > 0) nonTrivial++;
    }
    // Non-vacuity: at least one brief must actually withhold something, or the
    // equality above is comparing two all-proven partitions and proves nothing.
    expect(nonTrivial, 'no brief produced a withheld row — the parity check is vacuous').toBeGreaterThan(0);
  });

  it('the two detectors agree with and without the prepared argument', () => {
    let findings = 0;
    for (const brief of BRIEFS) {
      const prepared = prepareBrief(brief);
      const dA = detectUncoveredNegatedBounds(brief, [], new Set<number>());
      const dB = detectUncoveredNegatedBounds(brief, [], new Set<number>(), prepared);
      expect(dB, `prepared threading changed the detector for: ${brief}`).toEqual(dA);

      const pA = findProvenUncoveredBounds(brief, []);
      const pB = findProvenUncoveredBounds(brief, [], prepared);
      expect(pB, `prepared threading changed the mint for: ${brief}`).toEqual(pA);
      findings += dA.length + pA.length;
    }
    expect(findings, 'no brief produced any finding — the parity check is vacuous').toBeGreaterThan(0);
  });
});

describe('precondition 4 — the floor-or-ceiling question is ONE sentence', () => {
  // The literal, copied here as the expected value on purpose: this spec is the
  // byte-identity pin that licensed collapsing three copies into one composer.
  const QUESTION = 'Should gross margin stay at or above 78%, or at or below it?';

  it('the record, the detector and the coaching card all state it identically', () => {
    const fromRecord = buildUnresolvedItem(
      'unspent_negation',
      'Do not let gross margin drop below 78%.',
      { value: 0.78, unit: 'fraction', label: 'gross margin', source_quote: 'gross margin drop below 78%' },
      'gross margin',
    );
    expect(fromRecord.question).toBe(QUESTION);

    const fromDetector = detectorItem({
      metric_text: 'gross margin',
      amount_text: '78%',
      sentence_index: 0,
    });
    expect(fromDetector.question).toBe(QUESTION);

    const [card] = renderDirectionClarifications([fromDetector]);
    expect(card).toBeDefined();
    expect(card!.detail).toBe(
      'You mentioned 78% for gross margin. ' +
        QUESTION +
        ' I could not tell from the wording, so it is not being enforced yet. ' +
        'Add it as a constraint to make it binding.',
    );
  });

  it('a reason with its OWN question is not overwritten by the shared one', () => {
    // The renderer deliberately does NOT interpolate `item.question`, because
    // `question` varies with `reason`. This pins that the two really do differ,
    // so the decision is a real one rather than a distinction without one.
    const ambiguous = buildUnresolvedItem(
      'explicit_ambiguity',
      "We have not decided whether 78% is a floor or a ceiling for gross margin.",
      { value: 0.78, unit: 'fraction', label: 'gross margin' },
      null,
    );
    expect(ambiguous.question).not.toBe(QUESTION);
    expect(ambiguous.question).toContain("hadn't settled");
  });
});

describe('THE ONE DELIBERATE BEHAVIOUR CHANGE — the currency class is derived', () => {
  const NO_AMOUNTS = 'the board agreed a hard limit on this';

  it('the three symbols the old `/^[£$€]$/` matched are unchanged', () => {
    expect(deriveAmountText(NO_AMOUNTS, 5000, '£')).toBe('£5,000');
    expect(deriveAmountText(NO_AMOUNTS, 5000, '$')).toBe('$5,000');
    expect(deriveAmountText(NO_AMOUNTS, 5000, '€')).toBe('€5,000');
  });

  it('the other canonical currencies now render as the user wrote them', () => {
    // BEFORE: `¥5000` — the symbol was dropped and a bare `String(value)`
    // shipped, because the hand-written class was three symbols wide.
    // AFTER: the user's own symbol, from the canonical ten-entry map.
    expect(deriveAmountText(NO_AMOUNTS, 5000, '¥')).toBe('¥5,000');
    expect(deriveAmountText(NO_AMOUNTS, 5000, '₹')).toBe('₹5,000');
    expect(deriveAmountText(NO_AMOUNTS, 5000, 'A$')).toBe('A$5,000');
    expect(deriveAmountText(NO_AMOUNTS, 5000, 'CHF')).toBe('CHF5,000');
  });

  it('a non-currency unit still falls through to the bare value', () => {
    // The discriminating half: without it, a class of "everything" would pass
    // the two assertions above.
    expect(deriveAmountText(NO_AMOUNTS, 5000, 'users')).toBe('5000');
    expect(deriveAmountText(NO_AMOUNTS, 5000, null)).toBe('5000');
  });
});
