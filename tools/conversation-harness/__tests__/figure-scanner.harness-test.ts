import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { scanProseFigures } from '../scorer/figure-scanner.js';
import { gateCanonicalStateUse, type GateTurn } from '../scorer/gate-dims.js';
import type { TurnRow } from '../scorer/dims.js';
import type { TurnSurfaces } from '../scorer/prompt-dims.js';

// ============================================================
// Grammar corners — the exact forms the two dead regexes missed,
// plus the fail-closed refusals.
// ============================================================

describe('figure-scanner grammar', () => {
  const vals = (t: string) => scanProseFigures(t).values;
  const unp = (t: string) => scanProseFigures(t).unparseable;

  it('integers, decimals, thousands, word anchors', () => {
    expect(vals('62%')).toEqual([62]);
    expect(vals('62 %')).toEqual([62]);
    expect(vals('62.5%')).toEqual([62.5]);
    expect(vals('0.5%')).toEqual([0.5]);
    expect(vals('.5%')).toEqual([0.5]);
    expect(vals('1,250%')).toEqual([1250]);
    expect(vals('12,345,678%')).toEqual([12345678]);
    expect(vals('62.5 percent')).toEqual([62.5]);
    expect(vals('62 per cent.')).toEqual([62]);
  });

  it('signs: explicit ASCII, Unicode minus, plus, plus-minus', () => {
    expect(vals('-20%')).toEqual([-20]);
    expect(vals('−20%')).toEqual([-20]);
    expect(vals('+20%')).toEqual([20]);
    expect(vals('±5%')).toEqual([5, -5]);
  });

  it('directional cues sign the figure (backward window)', () => {
    expect(vals('you lose 20%')).toEqual([-20]);
    expect(vals('it fell 20 percent')).toEqual([-20]);
    expect(vals('down 20%')).toEqual([-20]);
    expect(vals('minus 20%')).toEqual([-20]);
    expect(vals('gains 20%')).toEqual([20]);
  });

  it("the hedge bigram 'up to' is neutral, not a positive cue", () => {
    expect(vals('fell by up to 20%')).toEqual([-20]);
    expect(vals('wins up to 20%')).toEqual([20]);
  });

  it("round 5: '<cue> TO X%' is a LEVEL, not a change — no sign flip", () => {
    // 'fell BY 20%' states a change (-20); 'fell TO 20%' states where the
    // metric now sits (+20). Round 4 flipped both: faithful level prose
    // hard-blocked, and a fabricated negative could trace through the flip.
    expect(vals('it fell to 20%')).toEqual([20]);
    expect(vals('churn dropped to 8%')).toEqual([8]);
    expect(vals('down to 20%')).toEqual([20]);
    expect(vals('demand declined to 30 percent')).toEqual([30]);
    // ...while the change readings keep the cue sign:
    expect(vals('it fell by 20%')).toEqual([-20]);
    expect(vals('it fell 20%')).toEqual([-20]);
    // ...and an explicit sign on a level still applies:
    expect(vals('it fell to -20%')).toEqual([-20]);
  });

  it('round 5: a negative-cued LEVEL range is not sign-flipped either', () => {
    expect(vals('it fell to 20-30%')).toEqual([20, 30]);
  });

  it('HONEST LIMIT (documented): post-noun forms are not signed', () => {
    // "a 20% drop" / "21% downside" name the metric after the figure; signing
    // them would false-block faithful restatements. Backward window only.
    expect(vals('a 20% drop')).toEqual([20]);
    expect(vals('with 21% downside')).toEqual([21]);
  });

  it('a cue outside the 3-word window does not reach the figure', () => {
    expect(vals('the losses we modelled earlier suggest maybe 20%')).toEqual([20]);
  });

  it('sentence stops isolate the cue window', () => {
    expect(vals('Sales fell. The rate is 20%.')).toEqual([20]);
  });

  it('ranges expand to BOTH bounds, across every clean form', () => {
    expect(vals('60-70%')).toEqual([60, 70]);
    expect(vals('60 - 70%')).toEqual([60, 70]);
    expect(vals('60–70%')).toEqual([60, 70]);
    expect(vals('60 — 70%')).toEqual([60, 70]);
    expect(vals('60%-70%')).toEqual([60, 70]);
    expect(vals('60 to 70%')).toEqual([60, 70]);
    expect(vals('between 60 and 70%')).toEqual([60, 70]);
  });

  it('a negative-cued range signs both bounds', () => {
    expect(vals('it falls 20-30%')).toEqual([-20, -30]);
  });

  it('a conjunction list distributes the shared anchor', () => {
    expect(vals('10, 20 and 30%')).toEqual([10, 20, 30]);
    expect(vals('10%, 20%, and 30%')).toEqual([10, 20, 30]);
  });

  it("round 5: explicit-sign 'to'-ranges are unambiguous — both bounds resolve", () => {
    // The natural phrasing for the signed p10-p90 percentile surface; round 4
    // refused it and hard-blocked faithful candidates.
    expect(scanProseFigures('outcomes range from -20% to 35%')).toEqual({ values: [-20, 35], unparseable: 0 });
    expect(scanProseFigures('-20% to 35%')).toEqual({ values: [-20, 35], unparseable: 0 });
    expect(scanProseFigures('from -20 to 35%')).toEqual({ values: [-20, 35], unparseable: 0 });
    expect(scanProseFigures('from -30% to -10%')).toEqual({ values: [-30, -10], unparseable: 0 });
    expect(scanProseFigures('+10 to 20%')).toEqual({ values: [10, 20], unparseable: 0 });
  });

  it('round 5: the % anchor must not cross a clause comma backward', () => {
    // 'In 2024, 25%…' — the year is clause context, not a shared-anchor list
    // member; round 4 pulled it into the denominator and hard-blocked
    // faithful prose. A comma is list glue only when a conjunction follows.
    expect(scanProseFigures('In 2024, 25% of users churned')).toEqual({ values: [25], unparseable: 0 });
    expect(scanProseFigures('Across 3 cohorts, 40% converted')).toEqual({ values: [40], unparseable: 0 });
    expect(scanProseFigures('In 2024, 25 to 30% of users churned')).toEqual({ values: [25, 30], unparseable: 0 });
  });

  it('bare numbers, currency, dates, identifiers are NOT figures', () => {
    expect(scanProseFigures('1,250')).toEqual({ values: [], unparseable: 0 });
    expect(scanProseFigures('it costs $1,250 overall')).toEqual({ values: [], unparseable: 0 });
    expect(scanProseFigures('£62.5 up front')).toEqual({ values: [], unparseable: 0 });
    expect(scanProseFigures('the year 2026')).toEqual({ values: [], unparseable: 0 });
    expect(scanProseFigures('a top-10 pick for utf8 v2')).toEqual({ values: [], unparseable: 0 });
    expect(scanProseFigures('rated 3.5 stars')).toEqual({ values: [], unparseable: 0 });
  });

  it('currency never chains into a percent list', () => {
    // '$5' is a money amount; it must not inherit the % from its neighbour.
    expect(vals('$5 and 20%')).toEqual([20]);
    expect(unp('$5 and 20%')).toBe(0);
  });

  it("'percentile' and BARE 'percentage' do not anchor; 'percentage points' is a pp figure", () => {
    expect(scanProseFigures('the 90 percentile case')).toEqual({ values: [], unparseable: 0 });
    expect(scanProseFigures('a large percentage of users')).toEqual({ values: [], unparseable: 0 });
    // ROUND 6: '62 percentage points' is a RECOGNISED pp-unit figure — it must
    // never be valued as 62% and never be invisible (see the round-6 block).
    expect(scanProseFigures('62 percentage points')).toEqual({ values: [], unparseable: 1 });
  });

  it("a markdown bullet dash is not a sign ('- 20%')", () => {
    expect(vals('- 20% on the downside path')).toEqual([20]);
  });

  it('a lone spaced hyphen before a signed figure is not a range', () => {
    // '60 -70%': the '-' is adjacent to 70 -> signed figure; 60 stays bare.
    expect(vals('60 -70%')).toEqual([-70]);
  });

  // ---------- FAIL-CLOSED refusals: unparseable, never absent ----------

  it('round 5: %-anchored WORD-NUMBERS are UNTRACEABLE, never invisible', () => {
    // Round 4 could not see 'ninety percent' at all — neither value nor
    // unparseable — so a fabricated word-figure passed G4 at 1.000 (fail-OPEN,
    // against the module's own contract). Recognise-and-fail-closed.
    expect(scanProseFigures('the odds are ninety percent')).toEqual({ values: [], unparseable: 1 });
    expect(scanProseFigures('twenty-five per cent of runs')).toEqual({ values: [], unparseable: 1 });
    expect(scanProseFigures('ninety five percent of the time')).toEqual({ values: [], unparseable: 1 });
    expect(scanProseFigures('about half a percent either way')).toEqual({ values: [], unparseable: 1 });
    expect(scanProseFigures('a hundred percent certain')).toEqual({ values: [], unparseable: 1 });
    expect(scanProseFigures('ninety%')).toEqual({ values: [], unparseable: 1 });
  });

  it('round 5/6: word-number recognition does not double-count', () => {
    // A digit figure sharing the sentence is unaffected, and the word figure
    // counts EXACTLY once (word-number pass and reconciliation must not both
    // count the same anchor).
    expect(scanProseFigures('ninety percent, and 20% elsewhere')).toEqual({ values: [20], unparseable: 1 });
    // ROUND 6: a bare anchor with NO adjacent number ('expressed as a percent')
    // is now an UNCONSUMED Layer-1 anchor and fails CLOSED (round 5 scanned it
    // as clean). Deliberate calibration cost: over-blocking beats the invisible
    // class. 'percentile' still anchors nothing.
    expect(scanProseFigures('expressed as a percent')).toEqual({ values: [], unparseable: 1 });
    expect(scanProseFigures('the ninety percentile case')).toEqual({ values: [], unparseable: 0 });
    // ROUND 6: word-number pp figures are recognised-and-fail-closed too.
    expect(scanProseFigures('twenty percentage points')).toEqual({ values: [], unparseable: 1 });
  });

  it("round 5: sign-in-HYPHEN-range and cue-vs-signed-'to'-range stay refused", () => {
    expect(scanProseFigures('a -20-35% swing').unparseable).toBe(1);
    expect(scanProseFigures('it falls -20 to 35%').unparseable).toBe(1); // cue contradicts explicit signs
    expect(scanProseFigures('from 35% to -20%').unparseable).toBe(1); // descending signed bounds
    expect(scanProseFigures('±5 to 10%').unparseable).toBe(1); // '±' in a range
  });

  it('descending bounds are refused, not guessed', () => {
    expect(scanProseFigures('roughly 70-60% odds')).toEqual({ values: [], unparseable: 1 });
  });

  it('malformed thousands grouping is refused, not reinterpreted', () => {
    expect(scanProseFigures('about 1,25% there')).toEqual({ values: [], unparseable: 1 });
    expect(scanProseFigures('about 1,2500% there')).toEqual({ values: [], unparseable: 1 });
  });

  it('a multi-bound chain is refused', () => {
    expect(scanProseFigures('a 10-20-30% swing')).toEqual({ values: [], unparseable: 1 });
  });

  it('an explicit sign inside a range is refused', () => {
    expect(scanProseFigures('a -20-30% swing').unparseable).toBe(1);
  });

  it('asymmetric dash spacing is refused', () => {
    expect(scanProseFigures('60- 70%')).toEqual({ values: [], unparseable: 1 });
  });

  it('an explicit sign contradicting a directional cue is refused', () => {
    expect(scanProseFigures('gained -3% overall')).toEqual({ values: [], unparseable: 1 });
    expect(scanProseFigures('it fell +2% today')).toEqual({ values: [], unparseable: 1 });
  });

  it('both cue directions in the window are refused', () => {
    expect(scanProseFigures('gains dropped 20%').unparseable).toBe(1);
  });

  it('multi-dot decimals are refused', () => {
    expect(scanProseFigures('62.5.3%')).toEqual({ values: [], unparseable: 1 });
  });

  it('a refusal does not leak into neighbouring clean figures', () => {
    const s = scanProseFigures('roughly 70-60% odds. It wins 62% of the time.');
    expect(s.values).toEqual([62]);
    expect(s.unparseable).toBe(1);
  });

  it('empty / null-ish text scans clean', () => {
    expect(scanProseFigures('')).toEqual({ values: [], unparseable: 0 });
  });
});

// ============================================================
// Property/fuzz corpus — the round-4 mandate. Prose is GENERATED from figures
// whose classification is known by construction (canonical vs fabricated vs
// unparseable; both signs; decimals; ranges), and the gate must produce ZERO
// misclassifications: every faithful figure traces, every fabricated or
// unparseable figure counts against, nothing enters or leaves the denominator
// silently. This is the test shape that would have caught rounds 2 AND 3: both
// regressions were figures that never entered the denominator at all.
// ============================================================

function row(partial: Partial<TurnRow> & { turn: string }): TurnRow {
  return {
    turnClassHint: null,
    editIntent: false,
    onlyIf: null,
    skipped: false,
    duplicateOf: null,
    httpStatus: 200,
    startedAt: null,
    wallClockMs: 1000,
    assistantText: '',
    chips: [],
    substageTimings: null,
    ...partial,
  };
}

function surfaces(partial: Partial<TurnSurfaces> = {}): TurnSurfaces {
  return {
    hasHeldProposal: false,
    winProbabilities: null,
    leadingOptionLabel: null,
    optionLabels: [],
    winPctByLabel: {},
    payloadPercentages: [],
    ...partial,
  };
}

function gateTurn(assistantText: string, payloadPercentages: number[]): GateTurn {
  return { row: row({ turn: 'T1', assistantText }), surfaces: surfaces({ payloadPercentages }), userMessage: 'x' };
}

/** One generated snippet plus its known-by-construction accounting. */
interface Snippet {
  text: string;
  traceable: number;
  untraceable: number;
}

/** Decimal that Math.round()s back to n, for |off| <= 0.4 (both signs). */
function decimalNear(n: number, off: number): string {
  return Math.abs(n + off).toFixed(1);
}

const POS_SINGLE = [
  (m: string) => `It wins ${m}% of the time`,
  (m: string) => `Success sits at ${m} percent`,
  (m: string) => `The payload shows ${m}%`,
  (m: string) => `at +${m}%`,
  // Round 5: a clause-boundary year — the comma must stop the anchor, so the
  // year contributes NOTHING (neither traceable nor untraceable).
  (m: string) => `In 2024, ${m}% of users churned`,
  (m: string) => `Across 3 cohorts, ${m}% converted`,
];
const NEG_SINGLE = [
  (m: string) => `you lose ${m}%`,
  (m: string) => `it fell ${m} percent`,
  (m: string) => `down ${m}%`,
  (m: string) => `stated as -${m}%`,
];
// Round 5: '<cue> TO X%' is a LEVEL — extracts +X, no sign flip.
const LEVEL_SINGLE = [
  (m: string) => `it fell to ${m}%`,
  (m: string) => `churn dropped to ${m} percent`,
  (m: string) => `demand declined to ${m}%`,
  (m: string) => `down to ${m}%`,
];
const POS_RANGE = [
  (a: string, b: string) => `expect ${a}-${b}% success`,
  (a: string, b: string) => `expect ${a} to ${b}%`,
  (a: string, b: string) => `between ${a} and ${b}%`,
  (a: string, b: string) => `${a}%-${b}%`,
];
const NEG_RANGE = [(a: string, b: string) => `it falls ${a}-${b}%`];
// Round 5: explicit-sign 'to'-ranges (the natural signed-percentile phrasing).
// Bounds arrive as SIGNED strings ('-20', '35').
const SIGNED_RANGE = [
  (a: string, b: string) => `outcomes range from ${a}% to ${b}%`,
  (a: string, b: string) => `from ${a} to ${b}%`,
  (a: string, b: string) => `${a}% to ${b}%`,
];

const UNPARSEABLE_POOL = [
  'roughly 70-60% odds',
  'about 1,25% there',
  'a 10-20-30% swing',
  'gained -3% overall',
  'it fell +2% today',
  // Round 5: sign-in-hyphen-range and cue-vs-signed-'to'-range stay refused.
  'a -20-35% swing',
  'it falls -20 to 35%',
];

// Round 5: %-anchored word-numbers — recognised and counted UNTRACEABLE
// (fail-closed), never valued, never invisible.
const WORD_NUMBER_POOL = [
  'the odds are ninety percent',
  'twenty-five per cent of runs',
  'about a hundred percent certain',
  'ninety five percent of the time',
  'roughly half a percent either way',
];

const DISTRACTOR_POOL = [
  'the year 2026 begins',
  'it costs $1,250 overall',
  'option 3 remains open',
  'rated 3.5 stars',
  'a top-10 pick',
];

describe('figure-scanner property/fuzz corpus (zero misclassifications)', () => {
  // Canonical magnitudes are DISTINCT so a sign flip can never accidentally
  // land on another canonical value; fabricated magnitudes are drawn from a
  // disjoint band so no rounding collision is possible by construction.
  const canonicalMagArb = fc.uniqueArray(fc.integer({ min: 2, max: 40 }), { minLength: 2, maxLength: 5 });
  const fabricatedMagArb = fc.integer({ min: 50, max: 95 });
  const offArb = fc.constantFrom(-0.4, -0.3, -0.2, 0.2, 0.3, 0.4, 0);
  const signArb = fc.boolean();

  const itemArb = fc.record({
    kind: fc.constantFrom(
      'faithful-single', 'faithful-single', 'faithful-range',
      'fabricated-single', 'fabricated-single', 'fabricated-range',
      // Round 5 classes:
      'faithful-level', 'fabricated-level',
      'faithful-signed-range', 'fabricated-signed-range',
      'word-number',
      'unparseable', 'distractor',
    ),
    negative: signArb,
    off: offArb,
    pick: fc.nat(1000),
  });

  it('every generated figure classifies exactly as constructed', () => {
    fc.assert(
      fc.property(
        canonicalMagArb,
        fc.array(itemArb, { minLength: 1, maxLength: 8 }),
        fc.array(fabricatedMagArb, { minLength: 8, maxLength: 8 }),
        (mags, items, fabMags) => {
          // Canonical set: each magnitude appears with ONE sign.
          const canonical: number[] = mags.map((m, i) => (i % 2 === 0 ? m : -m));
          const posCanon = canonical.filter((c) => c > 0);
          const negCanon = canonical.filter((c) => c < 0);

          const snippets: Snippet[] = [];
          let fi = 0;
          for (const item of items) {
            const nextFab = () => fabMags[fi++ % fabMags.length];
            switch (item.kind) {
              case 'faithful-single': {
                const pool = item.negative && negCanon.length > 0 ? negCanon : posCanon;
                if (pool.length === 0) break;
                const c = pool[item.pick % pool.length];
                const m = decimalNear(c, item.off);
                const tpl = c < 0 ? NEG_SINGLE[item.pick % NEG_SINGLE.length] : POS_SINGLE[item.pick % POS_SINGLE.length];
                snippets.push({ text: tpl(m), traceable: 1, untraceable: 0 });
                break;
              }
              case 'fabricated-single': {
                const mag = nextFab();
                const m = decimalNear(mag, item.off);
                const tpl = item.negative ? NEG_SINGLE[item.pick % NEG_SINGLE.length] : POS_SINGLE[item.pick % POS_SINGLE.length];
                snippets.push({ text: tpl(m), traceable: 0, untraceable: 1 });
                break;
              }
              case 'faithful-range': {
                if (item.negative && negCanon.length >= 2) {
                  const sorted = [...negCanon].sort((a, b) => b - a); // e.g. [-10, -30]
                  const a = Math.abs(sorted[0]);
                  const b = Math.abs(sorted[sorted.length - 1]);
                  snippets.push({ text: NEG_RANGE[0](String(a), String(b)), traceable: 2, untraceable: 0 });
                } else if (posCanon.length >= 2) {
                  const sorted = [...posCanon].sort((a, b) => a - b);
                  const tpl = POS_RANGE[item.pick % POS_RANGE.length];
                  snippets.push({
                    text: tpl(String(sorted[0]), String(sorted[sorted.length - 1])),
                    traceable: 2,
                    untraceable: 0,
                  });
                }
                break;
              }
              case 'fabricated-range': {
                // Lower bound canonical, upper bound fabricated: EXACTLY the
                // round-3 hole, inverted — the fabricated bound must count.
                if (posCanon.length === 0) break;
                const lo = Math.min(...posCanon);
                const hi = nextFab();
                const tpl = POS_RANGE[item.pick % POS_RANGE.length];
                snippets.push({ text: tpl(String(lo), String(hi)), traceable: 1, untraceable: 1 });
                break;
              }
              case 'faithful-level': {
                // Round 5: 'fell TO c%' restates a POSITIVE canonical level.
                // The pre-fix scanner sign-flipped it to -c ⇒ untraceable, so
                // this arm is RED on round-4 code in the faithful direction.
                if (posCanon.length === 0) break;
                const c = posCanon[item.pick % posCanon.length];
                const m = decimalNear(c, item.off);
                snippets.push({ text: LEVEL_SINGLE[item.pick % LEVEL_SINGLE.length](m), traceable: 1, untraceable: 0 });
                break;
              }
              case 'fabricated-level': {
                // Round 5, fabricated direction: a level restatement whose +X
                // exists NOWHERE in canon. The sharpest case is X = |c| for a
                // NEGATIVE canonical c — the pre-fix sign flip made it TRACE
                // (fail-open); it must count untraceable.
                const mag = item.negative && negCanon.length > 0
                  ? Math.abs(negCanon[item.pick % negCanon.length])
                  : nextFab();
                const m = decimalNear(mag, item.off);
                snippets.push({ text: LEVEL_SINGLE[item.pick % LEVEL_SINGLE.length](m), traceable: 0, untraceable: 1 });
                break;
              }
              case 'faithful-signed-range': {
                // Round 5: the natural signed p10-p90 phrasing. Both bounds
                // canonical ⇒ both trace; the pre-fix scanner refused the
                // whole form (unparseable) and hard-blocked faithful prose.
                const lo = Math.min(...negCanon);
                const hi = Math.max(...posCanon);
                const tpl = SIGNED_RANGE[item.pick % SIGNED_RANGE.length];
                snippets.push({ text: tpl(String(lo), String(hi)), traceable: 2, untraceable: 0 });
                break;
              }
              case 'fabricated-signed-range': {
                // Canonical negative lower bound, fabricated upper bound: the
                // fabricated bound must count against, the real one must trace.
                const lo = Math.min(...negCanon);
                const hi = nextFab();
                const tpl = SIGNED_RANGE[item.pick % SIGNED_RANGE.length];
                snippets.push({ text: tpl(String(lo), String(hi)), traceable: 1, untraceable: 1 });
                break;
              }
              case 'word-number':
                // Round 5: recognised, never valued — always untraceable. The
                // pre-fix scanner saw NOTHING here (fail-open at 1.000).
                snippets.push({ text: WORD_NUMBER_POOL[item.pick % WORD_NUMBER_POOL.length], traceable: 0, untraceable: 1 });
                break;
              case 'unparseable':
                snippets.push({ text: UNPARSEABLE_POOL[item.pick % UNPARSEABLE_POOL.length], traceable: 0, untraceable: 1 });
                break;
              case 'distractor':
                snippets.push({ text: DISTRACTOR_POOL[item.pick % DISTRACTOR_POOL.length], traceable: 0, untraceable: 0 });
                break;
            }
          }

          const prose = snippets.map((s) => s.text).join('. ') + '.';
          const expectedTraceable = snippets.reduce((a, s) => a + s.traceable, 0);
          const expectedTotal = snippets.reduce((a, s) => a + s.traceable + s.untraceable, 0);

          const d = gateCanonicalStateUse([gateTurn(prose, canonical)]);
          if (expectedTotal === 0) {
            expect(d.value).toBeNull();
          } else {
            expect(d.details.figures_stated).toBe(expectedTotal);
            expect(d.details.traceable).toBe(expectedTraceable);
            expect(d.value).toBe(Number((expectedTraceable / expectedTotal).toFixed(3)));
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('positive control: the corpus machinery can SEE a misclassification', () => {
    // An absence-of-misclassification assertion is vacuous unless the harness
    // can detect a presence. Feed a deliberately wrong expectation shape: a
    // fabricated figure with the canonical set EMPTIED must not trace.
    const d = gateCanonicalStateUse([gateTurn('It wins 62% of the time.', [])]);
    expect(d.details.figures_stated).toBe(1);
    expect(d.details.traceable).toBe(0);
  });
});

// ============================================================
// ROUND 6 — permanent corpus for the round-5 review findings.
// Five consecutive rounds leaked NEW fail-open holes; round 6 replaced
// hole-patching with TWO-LAYER ANCHOR ACCOUNTING (see figure-scanner.ts).
// Every entry here is a verified round-5 finding, pinned in BOTH directions
// (fabricated must block; faithful must trace).
// ============================================================

describe('round 6 corpus: the five verified round-5 P1s', () => {
  it("F1: a word-number bound in a mixed word/digit 'to'-range fails CLOSED", () => {
    // Round 5: scanProseFigures('from ninety to 95%') -> {values:[95], unparseable:0}
    // — the fabricated lower bound 'ninety' contributed NOTHING and the
    // candidate scored a perfect G4.
    expect(scanProseFigures('from ninety to 95%')).toEqual({ values: [], unparseable: 1 });
    expect(scanProseFigures('Expect from ninety to 95% success.')).toEqual({ values: [], unparseable: 1 });
    expect(scanProseFigures('from twenty-five to 95%')).toEqual({ values: [], unparseable: 1 });
    // Word bound on the anchor side stays closed too.
    const rev = scanProseFigures('from 60 to seventy percent');
    expect(rev.values).toEqual([]);
    expect(rev.unparseable).toBeGreaterThanOrEqual(1);
    // Faithful digit ranges and level-'to' forms are untouched.
    expect(scanProseFigures('from 60 to 70%')).toEqual({ values: [60, 70], unparseable: 0 });
    expect(scanProseFigures('it fell to 20%')).toEqual({ values: [20], unparseable: 0 });
    expect(scanProseFigures('wins up to 20%')).toEqual({ values: [20], unparseable: 0 });
  });

  it('F1 gate: the fabricated word bound now blocks (was 1.000 fail-open)', () => {
    const d = gateCanonicalStateUse([gateTurn('Expect from ninety to 95% success.', [95])]);
    expect(d.details.figures_stated).toBe(1);
    expect(d.details.traceable).toBe(0);
    expect(d.value).toBe(0);
  });

  it('F2: hyphenated and newline-separated anchors are visible', () => {
    // Round 5: all four forms scanned {values:[], unparseable:0} — a run
    // stating SOLELY fabricated hyphen-anchored figures was UNMEASURABLE.
    expect(scanProseFigures('A 25-percent drop is possible')).toEqual({ values: [25], unparseable: 0 });
    expect(scanProseFigures('a ninety-percent chance of success')).toEqual({ values: [], unparseable: 1 });
    expect(scanProseFigures('a 9-per-cent gain')).toEqual({ values: [9], unparseable: 0 });
    expect(scanProseFigures('the odds are 62\npercent overall')).toEqual({ values: [62], unparseable: 0 });
  });

  it('F2 gate: hyphen-anchored figures block when fabricated, trace when faithful', () => {
    // Fabricated, as the ONLY figure: must be MEASURED at 0, never null.
    const fab = gateCanonicalStateUse([gateTurn('A 25-percent drop is possible.', [62])]);
    expect(fab.details.figures_stated).toBe(1);
    expect(fab.value).toBe(0);
    // Faithful: traces at 1.000.
    const ok = gateCanonicalStateUse([gateTurn('A 25-percent drop is possible.', [25])]);
    expect(ok.value).toBe(1);
  });

  it('F3: percentage points are a DISTINCT UNIT — never valued as %', () => {
    // Round 5: '12 percentage points' was invisible AND '9 percent points'
    // was VALUED as 9% — a pp figure traced against a % canonical.
    expect(scanProseFigures('improved by 12 percentage points')).toEqual({ values: [], unparseable: 1 });
    expect(scanProseFigures('the win rate rose 9 percent points')).toEqual({ values: [], unparseable: 1 });
    expect(scanProseFigures('a 12pp swing')).toEqual({ values: [], unparseable: 1 });
    expect(scanProseFigures('a 12 pp swing')).toEqual({ values: [], unparseable: 1 });
    expect(scanProseFigures('a single percentage point either way')).toEqual({ values: [], unparseable: 1 });
    // Abbreviations the round-5 review verified invisible: recognised by the
    // Layer-1 detector, unconsumed by the strict extractor -> fail closed.
    expect(scanProseFigures('roughly 12 pct of runs')).toEqual({ values: [], unparseable: 1 });
  });

  it('F3 gate: a pp figure can never trace against a % canonical', () => {
    // Round 5 verified: this exact prose scored 1.000 with a fabricated 12pp.
    const d = gateCanonicalStateUse([
      gateTurn('Your win probability improved by 12 percentage points. It sits at 62%.', [62]),
    ]);
    expect(d.details.figures_stated).toBe(2);
    expect(d.details.traceable).toBe(1);
    expect(d.value).toBe(0.5);
    // The conflation case: canonical 9 (a 9% figure) must NOT absorb '9
    // percent points'.
    const conf = gateCanonicalStateUse([gateTurn('the win rate rose 9 percent points.', [9])]);
    expect(conf.details.traceable).toBe(0);
    expect(conf.value).toBe(0);
  });

  it("F4: 'fell X% to Y%' is change-then-level — X a negative CHANGE, Y a positive LEVEL", () => {
    // Round 5: read as a negative RANGE, both bounds sign-flipped -> the
    // faithful level 55 became -55 silently.
    expect(scanProseFigures('revenue fell 10% to 55%')).toEqual({ values: [-10, 55], unparseable: 0 });
    expect(scanProseFigures('churn dropped 5% to 12%')).toEqual({ values: [-5, 12], unparseable: 0 });
    // 'from' keeps the level-transition reading (descending still refused,
    // documented P2 calibration cost).
    expect(scanProseFigures('down from 30% to 20%')).toEqual({ values: [], unparseable: 1 });
    // A shared-anchor change range is NOT the idiom: 'fell 10 to 55%' states a
    // change of between 10 and 55 points down.
    expect(scanProseFigures('it fell 10 to 55%')).toEqual({ values: [-10, -55], unparseable: 0 });
    // Idiom shape without an anchor on the level: ambiguous -> fail closed.
    expect(scanProseFigures('revenue fell 10% to 55')).toEqual({ values: [], unparseable: 1 });
  });

  it('F4 gate: faithful change-then-level prose traces; the flipped trace is dead', () => {
    // Faithful: canonical holds the -10 change and the 55 level -> 1.000
    // (round 5 scored this 0.500 silently).
    const ok = gateCanonicalStateUse([gateTurn('Revenue fell 10% to 55%.', [55, -10])]);
    expect(ok.details.figures_stated).toBe(2);
    expect(ok.value).toBe(1);
    // Fabricated direction: a canonical -55 must NOT validate the stated
    // level '55%' through a sign flip.
    const fab = gateCanonicalStateUse([gateTurn('Revenue fell 10% to 55%.', [-55])]);
    expect(fab.details.traceable).toBe(0);
    expect(fab.value).toBe(0);
  });

  it('F5: the directional-cue window stops at the same clause comma as the anchor rule', () => {
    // Round 5: 'Margins fell 5%, 30% of users churned' -> [-5, -30] — the cue
    // crossed the exact comma boundary the round-5 anchor rule declared
    // uncrossable.
    expect(scanProseFigures('Margins fell 5%, 30% of users churned')).toEqual({ values: [-5, 30], unparseable: 0 });
    expect(scanProseFigures('Win rate dropped 10%, 60% of runs still succeed')).toEqual({ values: [-10, 60], unparseable: 0 });
    // The cue still binds inside its own clause.
    expect(scanProseFigures('it fell 20%')).toEqual({ values: [-20], unparseable: 0 });
    expect(scanProseFigures('Margins fell 5%, and it fell 3% again')).toEqual({ values: [-5, -3], unparseable: 0 });
  });

  it('F5 gate: comma-splice faithful prose traces at 1.000 (was 0.500 silently)', () => {
    const d = gateCanonicalStateUse([gateTurn('Margins fell 5%, 30% of users churned.', [-5, 30])]);
    expect(d.value).toBe(1);
  });

  it('P2: full-width ％, bare anchors and abbreviation anchors fail CLOSED by construction', () => {
    expect(scanProseFigures('the odds are 62％')).toEqual({ values: [], unparseable: 1 });
    expect(scanProseFigures('a share (%) of the total')).toEqual({ values: [], unparseable: 1 });
    expect(scanProseFigures('expressed in pct terms')).toEqual({ values: [], unparseable: 1 });
    // Still outside the anchor contract (no anchor token present): implicit
    // and ratio figures. Documented, not silently dropped — the module doc
    // routes them to the stated-scope note.
    expect(scanProseFigures('your win probability halved')).toEqual({ values: [], unparseable: 0 });
    expect(scanProseFigures('one in five runs fails')).toEqual({ values: [], unparseable: 0 });
  });
});

// ============================================================
// ROUND 6 — THE RECONCILIATION INVARIANT (the test that makes round 7
// impossible for the invisible-figure class): generate anchor tokens in
// randomised UNKNOWN shapes; the scanner must NEVER account an
// anchor-containing snippet as zero figures. Unknown phrasings fail CLOSED
// by construction — the class is eliminated, not enumerated.
// ============================================================

describe('round 6 INVARIANT: an anchor token can never vanish', () => {
  const WORD_TOKENS = [
    'percent', 'Percent', 'PERCENT', 'per cent', 'per-cent', 'per\ncent',
    'percentage points', 'percentage point', 'percentage-points',
    'percent points', 'pct', 'PCT', 'pp', 'PP',
  ];
  const SYMBOL_TOKENS = ['%', '％'];
  // Number renderings: clean digits, decimals, word-numbers, malformed
  // groupings, chains, signed, released punctuation, absent entirely.
  const NUM_RENDERS = [
    '62', '62.5', '0.5', '1,250', '2024', '-20', '+7', '62.', '1,25',
    '10-20-30', 'ninety', 'twenty-five', 'sixty two', '',
  ];
  const SEPS_NONEMPTY = [' ', '\n', '\t', '-', ' - ', '  ', '\n\n', '- ', ' -'];
  const SEPS_ANY = [...SEPS_NONEMPTY, ''];
  const PREFIXES = [
    'The odds are', 'it fell', 'roughly', 'a', 'we expect about',
    'somewhere near', 'gains reached', 'between runs,', '',
  ];
  const SUFFIXES = [' overall.', ' of the time.', ', give or take.', '.', ''];

  interface Item { word: boolean; token: string; num: string; sepIdx: number; pre: string; suf: string }

  const itemArb: fc.Arbitrary<Item> = fc.record({
    tok: fc.oneof(
      fc.constantFrom(...WORD_TOKENS).map((t) => ({ t, word: true })),
      fc.constantFrom(...SYMBOL_TOKENS).map((t) => ({ t, word: false })),
    ),
    num: fc.constantFrom(...NUM_RENDERS),
    sepIdx: fc.nat(1000),
    pre: fc.constantFrom(...PREFIXES),
    suf: fc.constantFrom(...SUFFIXES),
  }).map(({ tok, num, sepIdx, pre, suf }) => ({ word: tok.word, token: tok.t, num, sepIdx, pre, suf }));

  /** Build a snippet guaranteed to contain >= 1 Layer-1 anchor token: a word
   * token is always detached from letters (never glued to a word), matching
   * the detector's word-boundary; a symbol token anchors anywhere. */
  function buildSnippet(it: Item): string {
    const seps = it.word ? SEPS_NONEMPTY : SEPS_ANY;
    const sep = seps[it.sepIdx % seps.length];
    const pre = it.pre === '' ? '' : `${it.pre} `;
    const body = it.num === '' ? `${pre}${it.token}` : `${pre}${it.num}${sep}${it.token}`;
    return `${body}${it.suf}`;
  }

  it('NEVER {values:[], unparseable:0} when an anchor token is present', () => {
    fc.assert(
      fc.property(itemArb, (item) => {
        const text = buildSnippet(item);
        const scan = scanProseFigures(text);
        // The reconciliation invariant: every Layer-1 anchor is consumed by
        // exactly one Layer-2 outcome (a value or an explicit unparseable).
        // An anchor-bearing snippet accounting to ZERO outcomes is the
        // fail-open class rounds 2-5 kept leaking.
        expect(scan.values.length + scan.unparseable).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 800 },
    );
  });

  it('outcomes are additive across sentence-separated snippets', () => {
    fc.assert(
      fc.property(fc.array(itemArb, { minLength: 1, maxLength: 4 }), (items) => {
        const joined = items.map(buildSnippet).join(' Plain filler words follow here. ');
        const scan = scanProseFigures(joined);
        expect(scan.values.length + scan.unparseable).toBeGreaterThanOrEqual(items.length);
      }),
      { numRuns: 300 },
    );
  });

  it('positive control: the invariant harness can SEE a vanished anchor', () => {
    // Prove the assertion shape detects a zero-accounting result: bare prose
    // with no anchor genuinely accounts to zero, so the >= 1 assertion is
    // doing real work when an anchor IS present.
    const clean = scanProseFigures('plain words with a number 42 and no anchor');
    expect(clean.values.length + clean.unparseable).toBe(0);
  });
});
