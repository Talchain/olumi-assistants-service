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
// --- round-5 additions: surfaces found by the INVERTED search ---
import { buildAnalysisResultHeadline } from '../../coaching/analysis-result-headline.js';
import { compareOptionsAction } from '../../../orchestrator/deterministic/actions/compare-options.js';
import { whatWouldFlipAction } from '../../../orchestrator/deterministic/actions/what-would-flip.js';
import type { DeterministicTurnContext } from '../../../orchestrator/deterministic/types.js';

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
  render(m: MarginCat, b: BandCat, raw: RawRobustnessSignals | null): string | Promise<string>;
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

// ---------------------------------------------------------------------------
// ROUND-5 ADAPTERS.
//
// These three surfaces classify closeness from their OWN thresholds and were
// therefore invisible to the round-1..4 caller-greps. They do not take an
// `AnalysisProjectionSummary`, so each needs an adapter that maps the matrix
// cell onto the shape that surface actually reads:
//
//   - buildAnalysisResultHeadline  -> raw `enrichment` (probabilities +
//                                     `enrichment.robustness`)
//   - compare_options   (V4)       -> DeterministicTurnContext
//   - what_would_flip   (V4)       -> DeterministicTurnContext
//
// The V4 pair read the raw robustness object at `ctx.analysis.robustness`
// (top level of the PLoT `/v2/run` envelope), NOT under `enrichment` — which
// is exactly why they could not reach the `near_tie.is_tie` override before
// `readRawRobustnessSignals` normalised both addresses.
// ---------------------------------------------------------------------------

/** Winner/runner probabilities that realise the matrix's margin cell. */
function probsFor(m: MarginCat): { winner: number; runner: number } {
  const marginPp = MARGINS[m];
  // `indeterminate` has no finite margin; give the two options identical
  // probabilities so no surface can read a gap out of it.
  if (marginPp === null) return { winner: 0.5, runner: 0.5 };
  return { winner: 0.5 + marginPp / 200, runner: 0.5 - marginPp / 200 };
}

/** The raw robustness object as the PLoT envelope carries it. */
function rawRobustnessObject(b: BandCat, raw: RawRobustnessSignals | null): Record<string, unknown> {
  return {
    level: raw?.level ?? BANDS[b] ?? 'moderate',
    near_tie: { is_tie: raw?.near_tie_is_tie === true },
  };
}

function enrichmentFor(
  m: MarginCat,
  b: BandCat,
  raw: RawRobustnessSignals | null,
): Record<string, unknown> {
  const { winner, runner } = probsFor(m);
  return {
    option_comparison: [
      { option_id: 'opt-alpha', option_label: LEADING.label, win_probability: winner },
      { option_id: 'opt-beta', option_label: RUNNER.label, win_probability: runner },
    ],
    robustness: rawRobustnessObject(b, raw),
  };
}

function v4CtxFor(
  m: MarginCat,
  b: BandCat,
  raw: RawRobustnessSignals | null,
): DeterministicTurnContext {
  const { winner, runner } = probsFor(m);
  return {
    turn_id: 'turn-matrix',
    scenario_id: 'scn-matrix',
    entities: { nodes: new Map() },
    signals: { weak_edges: [], close_call: false },
    analysis: {
      meta: { seed_used: 1, n_samples: 1000, response_hash: 'h' },
      results: [
        { option_id: 'opt-alpha', option_label: LEADING.label, win_probability: winner },
        { option_id: 'opt-beta', option_label: RUNNER.label, win_probability: runner },
      ],
      robustness: rawRobustnessObject(b, raw),
    },
    analysis_summary: {
      winner: LEADING.label,
      winner_probability: winner,
      runner_up: RUNNER.label,
      runner_up_probability: runner,
      fragile_edge_count: 0,
      factor_sensitivity: [],
      top_drivers: DRIVERS.map((d) => ({
        label: d.factor_label,
        sensitivity: Math.abs(d.sensitivity_value),
      })),
    },
  } as unknown as DeterministicTurnContext;
}

async function renderV4(
  action: typeof compareOptionsAction,
  m: MarginCat,
  b: BandCat,
  raw: RawRobustnessSignals | null,
): Promise<string> {
  const result = await action.execute({}, v4CtxFor(m, b, raw));
  const blockNarrative = result.blocks
    .map((blk) => JSON.stringify((blk as { data?: unknown }).data ?? ''))
    .join(' ');
  return `${result.assistantText} ${blockNarrative}`;
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
  // --- surfaces found by the ROUND-5 INVERTED search (local classifiers) ---
  {
    // The single most-seen post-analysis surface: the run_analysis headline.
    name: 'buildAnalysisResultHeadline (run_analysis headline)',
    mode: 'explain',
    render: (m, b, raw) =>
      buildAnalysisResultHeadline({
        enrichment: enrichmentFor(m, b, raw),
        leading_option_id: 'opt-alpha',
        status_kind: 'ok',
      }) ?? '',
  },
  {
    name: 'compare_options (V4 deterministic action)',
    mode: 'explain',
    render: (m, b, raw) => renderV4(compareOptionsAction, m, b, raw),
  },
  {
    name: 'what_would_flip (V4 deterministic action)',
    mode: 'flip',
    render: (m, b, raw) => renderV4(whatWouldFlipAction, m, b, raw),
  },
];

// ---------------------------------------------------------------------------
// Predicates. Each is positive-controlled below — an absence assertion built on
// a predicate that cannot SEE a presence is vacuous (memory rule 13).
// ---------------------------------------------------------------------------

const saysTied = (t: string) =>
  /effectively tied|too close to call|close call|treats this as a close call/i.test(t);
const saysHolds = (t: string) =>
  /should hold under reasonable variation|may not move the picture much/i.test(t);
const claimsFragile = (t: string) => /appears fragile/i.test(t);
// ROUND-5: the predicate must SEE the vocabulary of the newly-routed surfaces
// too, or the new rows in the table assert nothing (memory rule 13). The three
// added alternates are the exact strings the round-5 sites emit on a
// confident-lead branch: the V4 compare_options verb, the V4 what_would_flip
// difficulty claim, and compare_options' clear-lead sentence.
const claimsStrongLead = (t: string) =>
  /meaningful rather than marginal|would need to close|clearly leads|a significant shift would be needed|has a clear lead/i.test(t);

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

  it('every surface in the table actually produces prose (no silent empty render)', async () => {
    for (const s of SURFACES) {
      const text = await s.render('clear', 'moderate', null);
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
        it(`${s.name} — cell ${m} x ${b} is self-consistent and matches the shared verdict`, async () => {
          const raw: RawRobustnessSignals | null = null;
          const verdict = composeRobustnessVerdict(projectionFor(m, b), raw, s.mode);
          // The shared composer is the authority on which cell this is.
          expect(verdict.headline).toBe(`${m}:${b}`);

          const text = await s.render(m, b, raw);

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
  it('no surface calls a stable near-tie fragile, and none reassures that it holds', async () => {
    const verdict = composeRobustnessVerdict(projectionFor('near_tie', 'stable'), null, 'explain');
    expect(verdict.headline).toBe('near_tie:stable');
    expect(verdict.margin_category).toBe('near_tie');
    expect(verdict.stability_category).toBe('stable');

    for (const s of SURFACES) {
      const text = await s.render('near_tie', 'stable', null);
      expect(claimsFragile(text), `${s.name} called a stable near-tie fragile`).toBe(false);
      expect(saysHolds(text), `${s.name} reassured on a near-tie`).toBe(false);
      expect(claimsStrongLead(text), `${s.name} claimed a strong lead on a near-tie`).toBe(false);
    }
  });

  it('the raw near_tie override reaches every surface identically', async () => {
    // Margin is WIDE (20pp) but upstream flags a tie — every surface must take
    // the near-tie branch, because the override lives in the shared classifier.
    const raw: RawRobustnessSignals = { level: 'stable', near_tie_is_tie: true };
    const verdict = composeRobustnessVerdict(projectionFor('clear', 'stable'), raw, 'explain');
    expect(verdict.margin_category).toBe('near_tie');
    expect(verdict.stability_category).toBe('stable');

    for (const s of SURFACES) {
      const text = await s.render('clear', 'stable', raw);
      expect(claimsStrongLead(text), `${s.name} claimed a strong lead despite the tie override`).toBe(
        false,
      );
      expect(saysHolds(text), `${s.name} reassured despite the tie override`).toBe(false);
      expect(claimsFragile(text), `${s.name} called a stable result fragile`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// ROUND 5 — the override, at margins that ACTUALLY trip each site's own band.
//
// Why this block exists separately from the table above: the table's `clear`
// cell is 20pp, and two of the round-5 sites gate their confident copy on
// `margin > 20` / `margin >= 10`. At exactly 20pp the compare_options
// clear-lead sentence does not fire at all, so a "no strong-lead claim"
// assertion there would pass WITHOUT the fix — vacuously true, testing
// nothing (memory rule 13). Each case below is pinned at a margin that
// provably trips that specific site's own confident branch, and each is
// paired with a positive control proving the branch fires when the override
// is ABSENT. An absence assertion that cannot first see a presence is theatre.
// ---------------------------------------------------------------------------

const TIE_OVERRIDE: RawRobustnessSignals = { level: 'stable', near_tie_is_tie: true };
const NO_OVERRIDE: RawRobustnessSignals = { level: 'stable', near_tie_is_tie: false };

/** A ctx/enrichment pair at an ARBITRARY margin (the matrix cells are fixed). */
function wideCtx(marginPp: number, raw: RawRobustnessSignals): DeterministicTurnContext {
  const winner = 0.5 + marginPp / 200;
  const runner = 0.5 - marginPp / 200;
  return {
    turn_id: 't', scenario_id: 's',
    entities: { nodes: new Map() },
    signals: { weak_edges: [], close_call: false },
    analysis: {
      meta: { seed_used: 1, n_samples: 1000, response_hash: 'h' },
      results: [
        { option_id: 'opt-alpha', option_label: LEADING.label, win_probability: winner },
        { option_id: 'opt-beta', option_label: RUNNER.label, win_probability: runner },
      ],
      robustness: { level: raw.level, near_tie: { is_tie: raw.near_tie_is_tie } },
    },
    analysis_summary: {
      winner: LEADING.label, winner_probability: winner,
      runner_up: RUNNER.label, runner_up_probability: runner,
      fragile_edge_count: 0, factor_sensitivity: [],
      top_drivers: DRIVERS.map((d) => ({ label: d.factor_label, sensitivity: Math.abs(d.sensitivity_value) })),
    },
  } as unknown as DeterministicTurnContext;
}

function wideEnrichment(marginPp: number, raw: RawRobustnessSignals): Record<string, unknown> {
  const winner = 0.5 + marginPp / 200;
  const runner = 0.5 - marginPp / 200;
  return {
    option_comparison: [
      { option_id: 'opt-alpha', option_label: LEADING.label, win_probability: winner },
      { option_id: 'opt-beta', option_label: RUNNER.label, win_probability: runner },
    ],
    robustness: { level: raw.level, near_tie: { is_tie: raw.near_tie_is_tie } },
  };
}

async function v4Text(action: typeof compareOptionsAction, ctx: DeterministicTurnContext): Promise<string> {
  const r = await action.execute({}, ctx);
  const blocks = r.blocks.map((b) => JSON.stringify((b as { data?: unknown }).data ?? '')).join(' ');
  return `${r.assistantText} ${blocks}`;
}

describe('S4 round-5 — the raw is_tie override bites at wide margins on every newly-routed site', () => {
  it('compare_options: 30pp — positive control fires "clearly leads", override suppresses it', async () => {
    // POSITIVE CONTROL: without the override this site DOES make the claim.
    const control = await v4Text(compareOptionsAction, wideCtx(30, NO_OVERRIDE));
    expect(control, 'positive control did not trip the clear-lead branch').toMatch(/clearly leads/i);
    expect(control).toMatch(/has a clear lead/i);

    // With the override the same 30pp gap must NOT read as a clear lead.
    const tied = await v4Text(compareOptionsAction, wideCtx(30, TIE_OVERRIDE));
    expect(tied, 'clear-lead claim survived the tie override').not.toMatch(/clearly leads/i);
    expect(tied, 'clear-lead sentence survived the tie override').not.toMatch(/has a clear lead/i);
    expect(tied, 'the tie verdict was not narrated').toMatch(/close call/i);
    // The REAL gap is still stated — routing must not suppress the number (F.6).
    expect(tied).toMatch(/30/);
  });

  it('what_would_flip: 30pp — positive control fires "significant shift", override suppresses it', async () => {
    const control = await v4Text(whatWouldFlipAction, wideCtx(30, NO_OVERRIDE));
    expect(control, 'positive control did not trip the hard-to-flip branch').toMatch(
      /a significant shift would be needed/i,
    );

    const tied = await v4Text(whatWouldFlipAction, wideCtx(30, TIE_OVERRIDE));
    expect(tied, 'hard-to-flip claim survived the tie override').not.toMatch(
      /a significant shift would be needed/i,
    );
    expect(tied, 'the tie verdict was not narrated').toMatch(/close call/i);
    expect(tied, 'flippability was not corrected').toMatch(/relatively easy to flip/i);
  });

  it('run_analysis headline: 8pp — positive control claims a lead, override downgrades it', () => {
    // 8pp clears MIN_LEAD_MARGIN (5pp), so WITHOUT the override the headline
    // takes the confident branch. This is the case the round-4 review named:
    // the headline said "leads by N points" while every other surface said
    // tied. Note it could never have been fixed inside the low-margin branch —
    // at 8pp the code never reaches that branch.
    const control = buildAnalysisResultHeadline({
      enrichment: wideEnrichment(8, NO_OVERRIDE),
      leading_option_id: 'opt-alpha',
      status_kind: 'ok',
    });
    expect(control, 'positive control produced no headline').not.toBeNull();
    expect(control!, 'positive control did not claim a lead').toMatch(/currently leads/i);
    expect(control!).not.toMatch(/close call/i);

    const tied = buildAnalysisResultHeadline({
      enrichment: wideEnrichment(8, TIE_OVERRIDE),
      leading_option_id: 'opt-alpha',
      status_kind: 'ok',
    });
    expect(tied, 'headline vanished instead of being corrected').not.toBeNull();
    expect(tied!, 'the tie verdict never reached the headline').toMatch(/close call/i);
    // Honesty in BOTH directions: an 8pp gap is NOT "fractional", so the
    // margin-tie copy would be a false claim here. The override branch must
    // state the real gap instead of overclaiming a dead heat.
    expect(tied!, 'overclaimed a fractional gap on an 8pp margin').not.toMatch(
      /only fractionally ahead/i,
    );
    expect(tied!, 'the real margin was suppressed').toMatch(/8 percentage points/i);
  });

  it('run_analysis headline: sub-1pp margin still gets the true "effectively tied" copy', () => {
    // The other side of the discrimination — a genuine ≤1pp gap must keep the
    // number-free tie sentence, not the override wording.
    const tied = buildAnalysisResultHeadline({
      enrichment: wideEnrichment(0.4, NO_OVERRIDE),
      leading_option_id: 'opt-alpha',
      status_kind: 'ok',
    });
    expect(tied, 'no headline on a genuine near-tie').not.toBeNull();
    expect(tied!).toMatch(/effectively tied/i);
    expect(tied!, 'a real sub-1pp tie must not quote a margin').not.toMatch(/percentage points/i);
  });
});
