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

  it('round 5: word-number recognition does not double-count or false-fire', () => {
    // A digit figure sharing the sentence is unaffected…
    expect(scanProseFigures('ninety percent, and 20% elsewhere')).toEqual({ values: [20], unparseable: 1 });
    // …non-number words before an anchor do not fire…
    expect(scanProseFigures('expressed as a percent')).toEqual({ values: [], unparseable: 0 });
    // …and 'percentile'/'percentage' still do not anchor.
    expect(scanProseFigures('the ninety percentile case')).toEqual({ values: [], unparseable: 0 });
    expect(scanProseFigures('twenty percentage points')).toEqual({ values: [], unparseable: 0 });
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
