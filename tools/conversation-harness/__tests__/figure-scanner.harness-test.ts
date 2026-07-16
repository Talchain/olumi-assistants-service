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

  it("'percentile' / 'percentage' do not anchor", () => {
    expect(vals('the 90 percentile case')).toEqual([]);
    expect(vals('62 percentage points')).toEqual([]);
  });

  it("a markdown bullet dash is not a sign ('- 20%')", () => {
    expect(vals('- 20% on the downside path')).toEqual([20]);
  });

  it('a lone spaced hyphen before a signed figure is not a range', () => {
    // '60 -70%': the '-' is adjacent to 70 -> signed figure; 60 stays bare.
    expect(vals('60 -70%')).toEqual([-70]);
  });

  // ---------- FAIL-CLOSED refusals: unparseable, never absent ----------

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
];
const NEG_SINGLE = [
  (m: string) => `you lose ${m}%`,
  (m: string) => `it fell ${m} percent`,
  (m: string) => `down ${m}%`,
  (m: string) => `stated as -${m}%`,
];
const POS_RANGE = [
  (a: string, b: string) => `expect ${a}-${b}% success`,
  (a: string, b: string) => `expect ${a} to ${b}%`,
  (a: string, b: string) => `between ${a} and ${b}%`,
  (a: string, b: string) => `${a}%-${b}%`,
];
const NEG_RANGE = [(a: string, b: string) => `it falls ${a}-${b}%`];

const UNPARSEABLE_POOL = [
  'roughly 70-60% odds',
  'about 1,25% there',
  'a 10-20-30% swing',
  'gained -3% overall',
  'it fell +2% today',
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
