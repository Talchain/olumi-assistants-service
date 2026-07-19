/**
 * S4 round-4 — the margin × stability verdict matrix, parameterised over EVERY
 * routed composer entry point.
 *
 * Round 3 proved the invariants for `composeRobustnessVerdict` itself and for
 * the two deterministic explanation FALLBACKS. The round-3 review found the
 * hole: the LIVE free-text advice-gate composers
 * (`composeExplainResults`, `composeImprovement`, `composeMeaning`,
 * `composeWhatWouldFlip`, `composeAdvice` in `post-analysis-advice-gate.ts`)
 * built their margin and stability sentences OUTSIDE the shared composer, from
 * their own `isNearTieByMargin` / `isRawFragile` / `robustness_band` reads. So
 * the "near-tie × stable is unrepresentable" claim held only on the surfaces
 * the round-3 test happened to enumerate.
 *
 * This table closes that by construction: it drives the SAME (margin, band, raw)
 * cell through every user-facing surface that composes robustness prose and
 * asserts the same invariants on each. Adding a new surface without routing it
 * through `composeRobustnessVerdict` makes this table go red on the near-tie
 * cells.
 *
 * The reviewer's exact case is `near_tie × stable`: the shared composer
 * classifies that cell as `near_tie:stable` (the GAP is inside noise while each
 * option's OWN score is steady), so NO surface may answer it with a fragility
 * claim, and none may answer it with the confident "should hold" reassurance.
 * Before round 4 the advice-gate composers answered it "The picture appears
 * fragile" — a fragility claim on a genuinely stable band.
 */

import { describe, it, expect } from 'vitest';

import {
  composeRobustnessVerdict,
  composeExplainResultsFallback,
  composeWhatWouldFlipFallback,
} from '../../tools/handlers/explanation-fallback.js';
import type { AnalysisProjectionSummary } from '../../context/projection-summaries.js';
import type { RawRobustnessSignals } from '../../coaching/robustness-honesty.js';
import {
  tryPostAnalysisAdviceGate,
  type AdviceGateAnalysis,
} from '../post-analysis-advice-gate.js';

// ---------------------------------------------------------------------------
// The matrix axes. Held identical to the round-3 table so the two tables
// describe the same cells.
// ---------------------------------------------------------------------------

const MARGINS = {
  near_tie: 0.4, // sub-threshold
  clear: 20,
  indeterminate: null as number | null,
} as const;

const BANDS = {
  fragile: 'fragile',
  stable: 'stable',
  moderate: 'moderate',
  unknown: null as string | null,
} as const;

type MarginCat = keyof typeof MARGINS;
type BandCat = keyof typeof BANDS;

const marginCats = Object.keys(MARGINS) as MarginCat[];
const bandCats = Object.keys(BANDS) as BandCat[];

const LEADING = { label: 'Alpha', probability: 0.52 } as const;
const RUNNER = { label: 'Beta', probability: 0.48 } as const;
const DRIVERS = [
  { factor_label: 'Delivery risk', sensitivity_value: 0.45 },
  { factor_label: 'Cost overrun risk', sensitivity_value: -0.32 },
] as const;

function projectionFor(m: MarginCat, b: BandCat): AnalysisProjectionSummary {
  return {
    status: 'complete',
    leading_option: { ...LEADING },
    runner_up: { ...RUNNER },
    margin_pp: MARGINS[m],
    robustness_band: BANDS[b],
    top_drivers: DRIVERS.map((d) => ({ ...d })),
    staleness_reason: null,
  } as AnalysisProjectionSummary;
}

function adviceAnalysisFor(m: MarginCat, b: BandCat): AdviceGateAnalysis {
  return {
    status: 'success',
    leading_option: { ...LEADING },
    runner_up: { ...RUNNER },
    margin_pp: MARGINS[m],
    robustness_band: BANDS[b],
    top_drivers: DRIVERS.map((d) => ({ ...d })),
  };
}

/**
 * Every user-facing surface that composes margin / stability prose about an
 * analysis. `mode` records which voice of the shared verdict the surface is
 * expected to speak, so a mis-routed surface is visible in the failure name.
 */
interface Surface {
  readonly name: string;
  readonly mode: 'explain' | 'flip';
  render(m: MarginCat, b: BandCat, raw: RawRobustnessSignals | null): string;
}

function gate(message: string) {
  return (m: MarginCat, b: BandCat, raw: RawRobustnessSignals | null): string => {
    const out = tryPostAnalysisAdviceGate({
      message,
      analysis: adviceAnalysisFor(m, b),
      freshness: 'fresh',
      rawRobustness: raw,
    });
    // The gate must MATCH for these classes on this data — an unmatched gate
    // would make every assertion below vacuously true (memory rule 13).
    expect(out.matched).toBe(true);
    return out.matched ? out.assistant_text : '';
  };
}

const SURFACES: readonly Surface[] = [
  // --- deterministic explanation fallbacks (routed in round 3) ---
  {
    name: 'composeExplainResultsFallback',
    mode: 'explain',
    render: (m, b, raw) => composeExplainResultsFallback(projectionFor(m, b), null, raw),
  },
  {
    name: 'composeWhatWouldFlipFallback',
    mode: 'flip',
    render: (m, b, raw) => composeWhatWouldFlipFallback(projectionFor(m, b), raw, null),
  },
  // --- LIVE free-text advice-gate composers (routed in round 4) ---
  {
    name: 'composeExplainResults (advice gate)',
    mode: 'explain',
    render: gate('Explain the results.'),
  },
  {
    name: 'composeImprovement (advice gate)',
    mode: 'explain',
    render: gate('How can we improve the outcome?'),
  },
  {
    name: 'composeMeaning (advice gate)',
    mode: 'explain',
    render: gate('What does this mean?'),
  },
  {
    name: 'composeAdvice (advice gate)',
    mode: 'explain',
    render: gate('What should we do?'),
  },
  {
    name: 'composeWhatWouldFlip (advice gate)',
    mode: 'flip',
    render: gate('What would flip this?'),
  },
];

// ---------------------------------------------------------------------------
// Predicates. Each is positive-controlled below — an absence assertion built on
// a predicate that cannot SEE a presence is vacuous (memory rule 13).
// ---------------------------------------------------------------------------

const saysTied = (t: string) => /effectively tied|too close to call/i.test(t);
const saysHolds = (t: string) =>
  /should hold under reasonable variation|may not move the picture much/i.test(t);
const claimsFragile = (t: string) => /appears fragile/i.test(t);
const claimsStrongLead = (t: string) =>
  /meaningful rather than marginal|would need to close/i.test(t);

describe('S4 round-4 — predicates are not vacuous (positive control)', () => {
  it('every predicate fires on a string that genuinely contains the claim', () => {
    expect(saysTied("'Alpha' and 'Beta' are effectively tied.")).toBe(true);
    expect(saysTied('the lead is too close to call without firming up')).toBe(true);
    expect(saysHolds('so it should hold under reasonable variation.')).toBe(true);
    expect(saysHolds('so smaller adjustments may not move the picture much.')).toBe(true);
    expect(claimsFragile('The picture appears fragile, so even small adjustments could shift it.')).toBe(
      true,
    );
    expect(claimsStrongLead('so the lead is meaningful rather than marginal.')).toBe(true);
    expect(claimsStrongLead('the lead of 20 percentage points would need to close.')).toBe(true);
  });

  it('and stays quiet on prose that makes none of those claims', () => {
    const neutral = 'Alpha performs best, with a probability of 52%.';
    expect(saysTied(neutral)).toBe(false);
    expect(saysHolds(neutral)).toBe(false);
    expect(claimsFragile(neutral)).toBe(false);
    expect(claimsStrongLead(neutral)).toBe(false);
  });

  it('every surface in the table actually produces prose (no silent empty render)', () => {
    for (const s of SURFACES) {
      const text = s.render('clear', 'moderate', null);
      expect(text.length, `${s.name} produced no prose`).toBeGreaterThan(40);
    }
  });
});

// ---------------------------------------------------------------------------
// The table.
// ---------------------------------------------------------------------------

describe('S4 round-4 — margin × stability matrix across EVERY routed surface', () => {
  for (const s of SURFACES) {
    for (const m of marginCats) {
      for (const b of bandCats) {
        it(`${s.name} — cell ${m} x ${b} is self-consistent and matches the shared verdict`, () => {
          const raw: RawRobustnessSignals | null = null;
          const verdict = composeRobustnessVerdict(projectionFor(m, b), raw, s.mode);
          // The shared composer is the authority on which cell this is.
          expect(verdict.headline).toBe(`${m}:${b}`);

          const text = s.render(m, b, raw);

          // INVARIANT 1: never assert closeness AND a stability reassurance in
          // the same message.
          expect(saysTied(text) && saysHolds(text), 'tied + holds contradiction').toBe(false);

          // INVARIANT 2: a near-tie never earns a stability reassurance.
          if (m === 'near_tie') {
            expect(saysHolds(text), 'stability reassurance on a near-tie').toBe(false);
            // ...nor a lead-strength claim.
            expect(claimsStrongLead(text), 'lead-strength claim on a near-tie').toBe(false);
          }

          // INVARIANT 3 (the round-3 reviewer's case): a genuinely stable,
          // non-fragile band NEVER earns a fragility claim — including on a
          // near-tie, where the GAP is inside noise but each option's OWN score
          // is steady. This is the assertion the advice-gate composers failed
          // before they were routed through composeRobustnessVerdict.
          if (b === 'stable') {
            expect(claimsFragile(text), 'fragility claim on a stable band').toBe(false);
          }

          // INVARIANT 4: fragility is claimed only where the shared verdict
          // classifies the STABILITY axis as fragile — never inferred from the
          // margin axis.
          if (claimsFragile(text)) {
            expect(verdict.stability_category, 'fragility claimed off a non-fragile verdict').toBe(
              'fragile',
            );
          }
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// The reviewer's exact cell, called out on its own so a regression names itself.
// ---------------------------------------------------------------------------

describe('S4 round-4 — the reviewer cell (near-tie × stable) on every surface', () => {
  it('no surface calls a stable near-tie fragile, and none reassures that it holds', () => {
    const verdict = composeRobustnessVerdict(projectionFor('near_tie', 'stable'), null, 'explain');
    expect(verdict.headline).toBe('near_tie:stable');
    expect(verdict.margin_category).toBe('near_tie');
    expect(verdict.stability_category).toBe('stable');

    for (const s of SURFACES) {
      const text = s.render('near_tie', 'stable', null);
      expect(claimsFragile(text), `${s.name} called a stable near-tie fragile`).toBe(false);
      expect(saysHolds(text), `${s.name} reassured on a near-tie`).toBe(false);
      expect(claimsStrongLead(text), `${s.name} claimed a strong lead on a near-tie`).toBe(false);
    }
  });

  it('the raw near_tie override reaches every surface identically', () => {
    // Margin is WIDE (20pp) but upstream flags a tie — every surface must take
    // the near-tie branch, because the override lives in the shared classifier.
    const raw: RawRobustnessSignals = { level: 'stable', near_tie_is_tie: true };
    const verdict = composeRobustnessVerdict(projectionFor('clear', 'stable'), raw, 'explain');
    expect(verdict.margin_category).toBe('near_tie');
    expect(verdict.stability_category).toBe('stable');

    for (const s of SURFACES) {
      const text = s.render('clear', 'stable', raw);
      expect(claimsStrongLead(text), `${s.name} claimed a strong lead despite the tie override`).toBe(
        false,
      );
      expect(saysHolds(text), `${s.name} reassured despite the tie override`).toBe(false);
      expect(claimsFragile(text), `${s.name} called a stable result fragile`).toBe(false);
    }
  });
});
