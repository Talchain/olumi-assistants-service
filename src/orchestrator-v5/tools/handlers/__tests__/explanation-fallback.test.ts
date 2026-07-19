/**
 * Deterministic fallback composers — unit tests.
 *
 * These run independently of any handler and assert that the composers
 * produce natural-paragraph output that meets the brief's copy rules:
 *  - sentence case, British English
 *  - no bullet lists
 *  - no internal terms (handler, validator, node, edge, fact, projection)
 *  - no "winner" / "recommended"
 *  - no mutation language
 *  - cites the values present in the projection
 */

import { describe, expect, it } from 'vitest';

import type {
  AnalysisProjectionSummary,
  StructureProjectionSummary,
} from '../../../context/projection-summaries.js';
import type { RawRobustnessSignals } from '../../../coaching/pick-raw-robustness.js';
import type { FlipSummary } from '../../../compose/flip-proposal.js';
import { NEAR_TIE_PP_THRESHOLD } from '../../../coaching/robustness-honesty.js';
import {
  composeExplainFromStructureFallback,
  composeExplainResultsFallback,
  composeWhatWouldFlipFallback,
} from '../explanation-fallback.js';

const ANALYSIS: AnalysisProjectionSummary = {
  status: 'complete',
  leading_option: { label: 'Hire Senior Engineer', probability: 0.62 },
  runner_up: { label: 'Hire Two Mid-Level', probability: 0.27 },
  margin_pp: 35,
  robustness_band: 'stable',
  top_drivers: [
    { factor_label: 'Engineering Capacity', sensitivity_value: 0.65 },
    { factor_label: 'Hiring Cost', sensitivity_value: -0.42 },
  ],
  staleness_reason: null,
};

const STRUCTURE: StructureProjectionSummary = {
  goal_label: 'Q3 Throughput',
  top_causal_links: [
    { label_from: 'Engineering Capacity', label_to: 'Q3 Throughput', strength: 0.65 },
    { label_from: 'Hiring Cost', label_to: 'Q3 Throughput', strength: -0.42 },
  ],
  named_factor_label: undefined,
  named_factor_pathways: [],
  factor_count: 4,
  option_count: 2,
};

const FORBIDDEN_INTERNAL = [
  /\bhandlers?\b/i,
  /\bvalidators?\b/i,
  /\bnodes?\b/i,
  /\bedges?\b/i,
  /\bfacts?\b/i,
  /\bprojections?\b/i,
];
const FORBIDDEN_TONE = [/\bwinner\b/i, /\brecommended\b/i, /—/];

function expectNaturalProse(text: string) {
  expect(text.length).toBeGreaterThan(80);
  for (const pattern of FORBIDDEN_INTERNAL) expect(text).not.toMatch(pattern);
  for (const pattern of FORBIDDEN_TONE) expect(text).not.toMatch(pattern);
  // Sanity: paragraph not list.
  expect(text).not.toMatch(/^\s*[-*•]/m);
}

describe('composeExplainResultsFallback', () => {
  it('cites leading option label, probability as percentage, runner-up margin in percentage points, and top drivers with raw sensitivity values', () => {
    const text = composeExplainResultsFallback(ANALYSIS);
    expectNaturalProse(text);
    expect(text).toContain('Hire Senior Engineer');
    // Phase 2 workstream C: probabilities render as percentages, not raw
    // decimals. 0.62 → "62%". The legacy raw-decimal form must not appear
    // alongside the probability prose.
    expect(text).toContain('62%');
    expect(text).not.toContain('probability of 0.62');
    expect(text).not.toContain('per cent');
    // Runner-up label and margin in "N percentage points" prose form
    expect(text).toContain('Hire Two Mid-Level');
    expect(text).toContain('35 percentage points');
    // Driver labels surfaced; sensitivity values rendered as bucketed
    // lead-framing prose (formatSensitivityDirection composes adverb
    // + verb so the sentence reads "Cost moderately weakens the lead").
    // Thresholds delegate to bandFromMagnitude — the canonical helper
    // — so the fallback bands and the upstream display-safe projection
    // cannot drift. Raw decimals (0.65 / -0.42) must never reach the
    // user-facing wire.
    expect(text).toContain('Engineering Capacity');
    expect(text).toContain('Hiring Cost');
    expect(text).toMatch(/strengthens the lead/); // 0.65 → strengthens
    expect(text).toMatch(/weakens the lead/);     // -0.42 → weakens
    // No raw decimals in user-facing prose.
    expect(text).not.toMatch(/-?\d+\.\d/);
    // Humanised stability sentence — plain language, no "robustness" jargon.
    expect(text).toMatch(/looks stable, so it should hold under reasonable variation/);
    expect(text).not.toMatch(/robustness/i);
  });

  it('handles missing runner-up gracefully', () => {
    const text = composeExplainResultsFallback({
      ...ANALYSIS,
      runner_up: null,
      margin_pp: null,
    });
    expectNaturalProse(text);
    expect(text).toContain('Hire Senior Engineer');
    expect(text).not.toContain('runner_up');
  });

  it('returns generic fallback when projection lacks a leading option', () => {
    const text = composeExplainResultsFallback(undefined);
    expect(text).toContain('Would you like to');
  });

  // S4 near-tie honesty (V5-WAVE-2 PR-A): a near-zero / sub-threshold margin
  // must read as a close call, never "meaningful rather than marginal".
  // Regression for the baseline S4 contradiction where the explain fallback
  // said "ahead by 0 percentage points, so the lead is meaningful" while the
  // sibling flip fallback correctly said "effectively tied". Margin-only
  // near-tie (NEAR_TIE_PP_THRESHOLD = 1.0pp): 0 and 0.4 are near-tie; 12 is
  // decisive.
  it('describes a 0pp margin as effectively tied, never "meaningful rather than marginal"', () => {
    const text = composeExplainResultsFallback({
      ...ANALYSIS,
      margin_pp: 0,
      robustness_band: 'fragile',
    });
    expectNaturalProse(text);
    expect(text).toContain('effectively tied');
    expect(text).not.toContain('meaningful rather than marginal');
    // The awkward "0 percentage points" non sequitur must not be cited.
    expect(text).not.toContain('0 percentage points');
    // Both option labels are named in the closeness sentence.
    expect(text).toContain('Hire Senior Engineer');
    expect(text).toContain('Hire Two Mid-Level');
  });

  it('treats a sub-1pp margin (0.4) as a near-tie, not a meaningful lead', () => {
    const text = composeExplainResultsFallback({
      ...ANALYSIS,
      margin_pp: 0.4,
      robustness_band: 'fragile',
    });
    expect(text).toContain('effectively tied');
    expect(text).not.toContain('meaningful rather than marginal');
  });

  it('keeps the "meaningful rather than marginal" framing for a decisive margin (12pp)', () => {
    const text = composeExplainResultsFallback({
      ...ANALYSIS,
      margin_pp: 12,
    });
    expect(text).toContain('12 percentage points');
    expect(text).toContain('meaningful rather than marginal');
    expect(text).not.toContain('effectively tied');
  });

  // V5-LANE-B-STRUCTURAL-01: the handler-composed validation beat is placed
  // before the closing nudge; absent/null → byte-identical legacy output.
  it('places validationBeatText before the closing nudge', () => {
    const beat =
      "The evidence that would most improve confidence is firmer support for 'Engineering Capacity', since it carries the most weight in this result.";
    const text = composeExplainResultsFallback(ANALYSIS, beat);
    expectNaturalProse(text);
    const beatIndex = text.indexOf(beat);
    const nudgeIndex = text.indexOf('Would you like to explore what would change this result?');
    expect(beatIndex).toBeGreaterThan(-1);
    expect(nudgeIndex).toBeGreaterThan(beatIndex);
  });

  it('omitting validationBeatText (undefined or null) leaves the legacy output unchanged', () => {
    const legacy = composeExplainResultsFallback(ANALYSIS);
    expect(composeExplainResultsFallback(ANALYSIS, null)).toBe(legacy);
    expect(composeExplainResultsFallback(ANALYSIS, undefined)).toBe(legacy);
  });

  it('does NOT include the staleness caveat (handler prepends it via applyStalenessPrefix)', () => {
    // The composer is no longer responsible for the staleness caveat — the
    // handler's applyStalenessPrefix helper prepends it to the final
    // assistant_text. Asserting absence here keeps prose ordering decisions
    // in one place (the helper), so a future composer change cannot
    // double-prepend.
    const text = composeExplainResultsFallback({
      ...ANALYSIS,
      staleness_reason: 'loaded_from_prior_run_freshness_unknown',
    });
    expect(text.toLowerCase()).not.toContain('directional');
    expect(text.toLowerCase()).not.toContain('prior run');
  });
});

// ---------------------------------------------------------------------------
// Cross-composer near-tie threshold agreement (S4 mechanism-level guard).
//
// The explain and flip fallbacks must never contradict each other about
// whether a result is a near-tie: that contradiction (explain said "the lead
// is meaningful", flip said "effectively tied") is the exact S4 defect PR #270
// fixes. Rather than trust the two composers to stay in sync by hand, this
// pins that BOTH derive the near-tie verdict from the same SSOT threshold
// (`NEAR_TIE_PP_THRESHOLD` via `isNearTieByMargin`). The boundary value is
// DERIVED from the exported constant, not hardcoded, so if the threshold ever
// moves the test moves with it — it cannot silently mirror a stale 1.0.
//
// At the boundary (margin == threshold, still `<=` so a near-tie): both say
// "effectively tied". Just above it: neither does. If one composer ever
// diverged from the shared predicate, one side of this pair would flip.
// ---------------------------------------------------------------------------
describe('explain/flip near-tie agreement at the SSOT threshold boundary', () => {
  const EPS = 0.1;

  it('BOTH composers say "effectively tied" at exactly NEAR_TIE_PP_THRESHOLD', () => {
    const atBoundary: AnalysisProjectionSummary = {
      ...ANALYSIS,
      margin_pp: NEAR_TIE_PP_THRESHOLD,
      robustness_band: 'fragile',
    };
    const explain = composeExplainResultsFallback(atBoundary);
    const flip = composeWhatWouldFlipFallback(atBoundary);
    expect(explain).toContain('effectively tied');
    expect(explain).not.toContain('meaningful rather than marginal');
    expect(flip).toContain('effectively tied');
  });

  it('NEITHER composer says "effectively tied" just above NEAR_TIE_PP_THRESHOLD', () => {
    const justAbove: AnalysisProjectionSummary = {
      ...ANALYSIS,
      margin_pp: NEAR_TIE_PP_THRESHOLD + EPS,
      robustness_band: 'stable',
    };
    const explain = composeExplainResultsFallback(justAbove);
    const flip = composeWhatWouldFlipFallback(justAbove);
    expect(explain).not.toContain('effectively tied');
    expect(explain).toContain('meaningful rather than marginal');
    expect(flip).not.toContain('effectively tied');
  });
});

describe('composeWhatWouldFlipFallback', () => {
  it('cites leading option, margin in percentage points, and top drivers WITH sensitivity values — no mutation language', () => {
    const text = composeWhatWouldFlipFallback(ANALYSIS);
    expectNaturalProse(text);
    expect(text).toContain('Hire Senior Engineer');
    // Phase 2 workstream C: probability rendered as percentage
    expect(text).toContain('62%');
    expect(text).not.toContain('probability of 0.62');
    expect(text).not.toContain('per cent');
    expect(text).toContain('Hire Two Mid-Level');
    // Margin rendered as full "N percentage points" prose
    expect(text).toContain('35 percentage points');
    // Driver labels surfaced; sensitivities as bucketed lead-framing
    // prose. Thresholds align to bandFromMagnitude. No raw decimals.
    expect(text).toContain('Engineering Capacity');
    expect(text).toMatch(/strengthens the lead/);
    expect(text).toMatch(/weakens the lead/);
    expect(text).not.toMatch(/-?\d+\.\d/);
    expect(text).not.toMatch(/\bproposing to\b/i);
    expect(text).not.toMatch(/\bI'll\s+\b/i);
  });

  it('includes a plain-language stability sentence when projection has a stable band', () => {
    const text = composeWhatWouldFlipFallback(ANALYSIS);
    expect(text).toMatch(/looks stable, so smaller changes are less likely to flip/);
    // No internal jargon: the raw band token / the phrase "robustness band"
    // must never reach the user.
    expect(text).not.toMatch(/robustness/i);
  });

  it('returns generic fallback without leading option', () => {
    const text = composeWhatWouldFlipFallback({
      ...ANALYSIS,
      leading_option: null,
    });
    expect(text).toContain('Would you like to run the analysis');
  });

  it('does NOT include the staleness caveat (handler prepends it via applyStalenessPrefix)', () => {
    // Same contract as composeExplainResultsFallback — the handler's
    // applyStalenessPrefix helper owns the caveat. Asserting absence here
    // prevents accidental double-prefix when a future change lands.
    const text = composeWhatWouldFlipFallback({
      ...ANALYSIS,
      staleness_reason: 'loaded_from_prior_run_freshness_unknown',
    });
    expect(text.toLowerCase()).not.toContain('directional');
    expect(text.toLowerCase()).not.toContain('prior run');
  });
});

// ---------------------------------------------------------------------------
// Robustness honesty for the chip-click what_would_flip path (PR #193 SSOT
// reuse). The composer must suppress the "smaller changes are unlikely to
// flip" sentence on raw-fragile or near-tie results, and must reframe the
// runner-up sentence so a near-zero gap is never described as "the lead
// would need to close".
// ---------------------------------------------------------------------------
describe('composeWhatWouldFlipFallback — robustness-honesty (chip-click path)', () => {
  /** Reusable phrase guard for the buggy sentence the fix removes. */
  const UNLIKELY_TO_FLIP = /smaller changes are (un|not\s+)?likely to flip/i;
  const CLEAR_OR_STRONG_LEAD = /(clear|strong) lead/i;

  const FRAGILE_6PP: AnalysisProjectionSummary = {
    status: 'complete',
    leading_option: {
      label: 'Freelance Consultant + Moderate Ad Spend',
      probability: 0.49,
    },
    runner_up: { label: 'Hire Marketing Manager', probability: 0.433 },
    margin_pp: 5.7,
    robustness_band: 'fragile',
    top_drivers: [
      { factor_label: 'Acquisition Cost', sensitivity_value: 0.55 },
      { factor_label: 'Conversion Rate', sensitivity_value: -0.41 },
    ],
  };

  const RAW_FRAGILE: RawRobustnessSignals = { level: 'fragile', near_tie_is_tie: false };
  const RAW_VERY_LOW: RawRobustnessSignals = { level: 'very_low', near_tie_is_tie: false };
  const RAW_NEAR_TIE_OVERRIDE: RawRobustnessSignals = { level: 'moderate', near_tie_is_tie: true };

  it('fragile band + ~6pp margin: drops "smaller changes are unlikely" and emits fragility-sensitive copy (reproduces the staging bug)', () => {
    const text = composeWhatWouldFlipFallback(FRAGILE_6PP, RAW_FRAGILE);
    expectNaturalProse(text);
    // Exact-regression negative: the deterministic chip-click bug.
    expect(text).not.toMatch(UNLIKELY_TO_FLIP);
    expect(text).not.toContain(
      'The robustness band is currently fragile, so smaller changes are unlikely',
    );
    // Positive: the copy must describe the result as fragile/sensitive and
    // say small/modest changes could shift which option leads.
    expect(text.toLowerCase()).toMatch(/fragile|sensitive/);
    expect(text.toLowerCase()).toMatch(/small (adjustments|changes)/);
    expect(text.toLowerCase()).toMatch(/shift (which option leads|the (result|outcome))/);
  });

  it('canonical fragile band alone (no raw signal) still triggers fragility-aware copy', () => {
    // Older run_analysis facts may not carry the raw `enrichment.robustness`
    // block. The canonical projected band IS itself the upstream verdict,
    // so the composer should honour it.
    const text = composeWhatWouldFlipFallback(FRAGILE_6PP, null);
    expect(text).not.toMatch(UNLIKELY_TO_FLIP);
    expect(text.toLowerCase()).toMatch(/fragile/);
  });

  it('fragile band + near-tie margin (0.5pp) emits the effectively-tied reframe instead of "the lead would need to close"', () => {
    const text = composeWhatWouldFlipFallback(
      { ...FRAGILE_6PP, margin_pp: 0.5 },
      RAW_FRAGILE,
    );
    expectNaturalProse(text);
    expect(text).not.toMatch(UNLIKELY_TO_FLIP);
    expect(text).not.toMatch(/lead of .* would need to close/i);
    expect(text.toLowerCase()).toMatch(/effectively tied/);
    expect(text.toLowerCase()).toMatch(/fragile|small (adjustments|changes)/);
  });

  it('stable band + near-tie margin (0.5pp): no "clear/strong lead", no "smaller changes are unlikely", uses closeness reframe WITHOUT claiming fragility', () => {
    // Round-1 review: previously the composer said "the picture appears
    // fragile" even when the raw band was stable. That overclaims
    // fragility. Stable + near-tie should describe closeness only —
    // never invoke the robustness band.
    const text = composeWhatWouldFlipFallback(
      {
        ...FRAGILE_6PP,
        margin_pp: 0.5,
        robustness_band: 'stable',
      },
      null,
    );
    expectNaturalProse(text);
    expect(text).not.toMatch(CLEAR_OR_STRONG_LEAD);
    expect(text).not.toMatch(UNLIKELY_TO_FLIP);
    expect(text.toLowerCase()).toMatch(/effectively tied/);
    // Closeness sentence is emitted; fragility claim is NOT.
    expect(text.toLowerCase()).toMatch(/result is sensitive to small movements/);
    expect(text).not.toMatch(/picture appears fragile/i);
  });

  it('raw near_tie.is_tie=true on a stable band: closeness copy wins, no fragility claim', () => {
    const text = composeWhatWouldFlipFallback(
      {
        ...FRAGILE_6PP,
        margin_pp: 10, // wide
        robustness_band: 'stable',
      },
      RAW_NEAR_TIE_OVERRIDE,
    );
    expect(text).not.toMatch(UNLIKELY_TO_FLIP);
    // Override-driven near-tie path → closeness reframe at runner-up
    // sentence; stable band + override is NOT a fragile signal, so the
    // closing sentence must NOT claim fragility.
    expect(text.toLowerCase()).toMatch(/effectively tied/);
    expect(text.toLowerCase()).toMatch(/result is sensitive to small movements/);
    expect(text).not.toMatch(/picture appears fragile/i);
  });

  it('raw near_tie.is_tie=true on a fragile raw level: BOTH near-tie reframe and fragility claim hold', () => {
    // Sanity: when the raw signal is itself fragile (not just the override),
    // the fragility claim is honest and the closing sentence still uses it.
    const text = composeWhatWouldFlipFallback(
      {
        ...FRAGILE_6PP,
        margin_pp: 10,
        robustness_band: 'moderate',
      },
      { level: 'fragile', near_tie_is_tie: true },
    );
    expect(text).not.toMatch(UNLIKELY_TO_FLIP);
    expect(text.toLowerCase()).toMatch(/effectively tied/);
    expect(text.toLowerCase()).toMatch(/picture appears fragile/);
  });

  it('raw level=very_low overrides a projected moderate/stable band → fragility copy wins', () => {
    const text = composeWhatWouldFlipFallback(
      {
        ...FRAGILE_6PP,
        margin_pp: 12,
        robustness_band: 'moderate',
      },
      RAW_VERY_LOW,
    );
    expect(text).not.toMatch(UNLIKELY_TO_FLIP);
    expect(text.toLowerCase()).toMatch(/fragile/);
  });

  it('stable band + wide margin: stability language is acceptable (softened to "less likely")', () => {
    const text = composeWhatWouldFlipFallback(
      {
        ...FRAGILE_6PP,
        margin_pp: 18,
        robustness_band: 'stable',
      },
      { level: 'high', near_tie_is_tie: false },
    );
    expectNaturalProse(text);
    expect(text).toMatch(/looks stable/i);
    expect(text).not.toMatch(/robustness/i);
    // Softened wording: we say "less likely" not "unlikely".
    expect(text).toMatch(/less likely to flip/i);
    expect(text).not.toMatch(/are unlikely to flip/i);
    expect(text).not.toMatch(/effectively tied/i);
  });

  it('highly_stable band + wide margin: stability language permitted', () => {
    const text = composeWhatWouldFlipFallback(
      {
        ...FRAGILE_6PP,
        margin_pp: 25,
        robustness_band: 'highly_stable',
      },
      { level: 'very_high', near_tie_is_tie: false },
    );
    expect(text).toMatch(/less likely to flip/i);
    // The raw `highly_stable` token must NOT reach the user — it is humanised
    // to "very stable".
    expect(text).not.toContain('highly_stable');
    expect(text).toContain('very stable');
  });

  it('moderate band + wide margin: omits the closing robustness sentence (no overclaim)', () => {
    const text = composeWhatWouldFlipFallback(
      {
        ...FRAGILE_6PP,
        margin_pp: 14,
        robustness_band: 'moderate',
      },
      { level: 'medium', near_tie_is_tie: false },
    );
    expectNaturalProse(text);
    expect(text).not.toMatch(UNLIKELY_TO_FLIP);
    expect(text).not.toMatch(/less likely to flip/i);
    expect(text).not.toMatch(/effectively tied/i);
    // The driver/leading-option prose still includes "shift this result",
    // so only assert on the closing-sentence-specific phrase.
    expect(text).not.toMatch(/^The robustness band/m);
  });

  it('robustness_band=null and rawRobustness=null: omits closing robustness sentence', () => {
    const text = composeWhatWouldFlipFallback(
      {
        ...FRAGILE_6PP,
        margin_pp: 14,
        robustness_band: null,
      },
      null,
    );
    expect(text).not.toMatch(UNLIKELY_TO_FLIP);
    expect(text).not.toMatch(/^The robustness band/m);
    expect(text).not.toMatch(/picture appears fragile/i);
  });

  it('stable band + null margin: omits the closing stability sentence (no quantitative anchor for the lead)', () => {
    // Round-1 review: stability copy was previously emitted whenever the
    // band was stable and not near-tie — even when margin_pp was null. A
    // missing margin means we have no quantitative anchor for the lead's
    // size, so claiming "smaller changes are less likely to flip" is
    // unsupported. Omit instead.
    const text = composeWhatWouldFlipFallback(
      {
        ...FRAGILE_6PP,
        margin_pp: null,
        robustness_band: 'stable',
        runner_up: null,
      },
      { level: 'high', near_tie_is_tie: false },
    );
    expectNaturalProse(text);
    expect(text).not.toMatch(/less likely to flip/i);
    expect(text).not.toMatch(UNLIKELY_TO_FLIP);
    expect(text).not.toMatch(/^The robustness band/m);
  });

  it('stable band + NaN margin: omits the closing stability sentence and falls back to the neutral runner-up sentence', () => {
    const text = composeWhatWouldFlipFallback(
      {
        ...FRAGILE_6PP,
        margin_pp: Number.NaN,
        robustness_band: 'stable',
      },
      { level: 'high', near_tie_is_tie: false },
    );
    expect(text).not.toMatch(/less likely to flip/i);
    expect(text).not.toMatch(UNLIKELY_TO_FLIP);
    // Runner-up sentence must use the neutral "most likely contender"
    // fallback when margin is non-finite — never "lead of Not available
    // would need to close" (the bug improvement 1 fixed).
    expect(text).not.toMatch(/lead of .* would need to close/i);
    expect(text).toMatch(/most likely contender to overtake/i);
  });

  it('Infinity margin: same neutral runner-up fallback, no broken numeric copy', () => {
    const text = composeWhatWouldFlipFallback(
      {
        ...FRAGILE_6PP,
        margin_pp: Number.POSITIVE_INFINITY,
        robustness_band: 'stable',
      },
      { level: 'high', near_tie_is_tie: false },
    );
    expect(text).not.toMatch(/lead of .* would need to close/i);
    expect(text).not.toMatch(/Not available/i);
    expect(text).toMatch(/most likely contender to overtake/i);
  });

  it('unknown projected band with no raw signal: omits closing robustness sentence', () => {
    // After PR #193's `mapRobustnessToCanonical`, unknown projects to null
    // at the chip layer; this case guards a future regression where an
    // out-of-vocabulary band leaks through.
    const text = composeWhatWouldFlipFallback(
      {
        ...FRAGILE_6PP,
        margin_pp: 14,
        robustness_band: 'something_unrecognised',
      },
      null,
    );
    expect(text).not.toMatch(UNLIKELY_TO_FLIP);
    expect(text).not.toMatch(/picture appears fragile/i);
  });

  it('rawRobustness omitted entirely (undefined): falls back to projected-band ladder, no crash', () => {
    // Routed-path callers may not pass rawRobustness yet — the second
    // argument is optional. The composer must behave as if rawRobustness
    // were null in that case.
    const stable = composeWhatWouldFlipFallback({
      ...FRAGILE_6PP,
      margin_pp: 14,
      robustness_band: 'stable',
    });
    expect(stable).toMatch(/less likely to flip/i);

    const fragile = composeWhatWouldFlipFallback(FRAGILE_6PP);
    expect(fragile).not.toMatch(UNLIKELY_TO_FLIP);
    expect(fragile.toLowerCase()).toMatch(/fragile/);
  });
});

describe('composeExplainFromStructureFallback', () => {
  it('cites the strongest causal links and the goal label when no factor named', () => {
    const text = composeExplainFromStructureFallback(STRUCTURE, { canRunAnalysis: true });
    expectNaturalProse(text);
    expect(text).toContain('Q3 Throughput');
    expect(text).toContain('Engineering Capacity');
    expect(text).toContain('Hiring Cost');
    // Edge strength now rendered as a bucketed magnitude word
    // ("weak"/"moderate"/"strong"/"very strong" link) — Wave 4. No
    // raw decimals reach user-facing prose.
    expect(text).toMatch(/(weak|moderate|strong|very strong) (direct )?link/);
    expect(text).not.toMatch(/-?\d+\.\d/);
    // Olumi-style explanatory tone, not a system report.
    expect(text).toContain('shaped by several causal mechanisms');
  });

  it('length lands in [300, 600] for a typical 5-factor / 4-option graph', () => {
    const text = composeExplainFromStructureFallback(
      { ...STRUCTURE, factor_count: 5, option_count: 4 },
      { canRunAnalysis: true },
    );
    expect(text.length).toBeGreaterThanOrEqual(300);
    expect(text.length).toBeLessThanOrEqual(600);
  });

  it('canRunAnalysis=true → next-step nudge mentions "Running the analysis"', () => {
    const text = composeExplainFromStructureFallback(STRUCTURE, { canRunAnalysis: true });
    expect(text).toContain('Running the analysis');
  });

  it('canRunAnalysis=false → no "Running the analysis" nudge', () => {
    const text = composeExplainFromStructureFallback(STRUCTURE, { canRunAnalysis: false });
    expect(text).not.toContain('Running the analysis');
  });

  it('omitted options default to no nudge (safer than nudging on a non-runnable graph)', () => {
    const text = composeExplainFromStructureFallback(STRUCTURE);
    expect(text).not.toContain('Running the analysis');
  });

  it('uses named-factor pathways when the user mentioned a factor (path reaches goal)', () => {
    const text = composeExplainFromStructureFallback(
      {
        ...STRUCTURE,
        named_factor_label: 'Engineering Capacity',
        named_factor_pathways: [
          {
            label_from: 'Engineering Capacity',
            label_to: 'Q3 Throughput',
            strength: 0.65,
          },
        ],
      },
      { canRunAnalysis: true },
    );
    expectNaturalProse(text);
    expect(text).toContain('Engineering Capacity');
    expect(text).toContain('Q3 Throughput');
    // Goal-reaching pathway → reach-to-goal claim is allowed and surfaced.
    expect(text).toMatch(/runs to Q3 Throughput/);
  });

  it('does NOT claim a named factor reaches the goal when the cited pathway reaches a sibling', () => {
    // Over-claim guard: factor F is adjacent only to sibling F2 (no link
    // to the goal). The fallback must describe the structural connection
    // without asserting the factor reaches the goal — multi-hop
    // derivation would cross the F.6 line.
    const text = composeExplainFromStructureFallback(
      {
        ...STRUCTURE,
        named_factor_label: 'Hiring Cost',
        named_factor_pathways: [
          {
            label_from: 'Hiring Cost',
            label_to: 'Engineering Capacity', // sibling factor, NOT the goal
            strength: 0.3,
          },
        ],
      },
      { canRunAnalysis: false },
    );
    expect(text).toContain('Hiring Cost');
    expect(text).toContain('Engineering Capacity');
    // No reach-to-goal phrasing — the new prose uses "runs to <goal>" only
    // when reachesGoal is true.
    expect(text).not.toMatch(/runs to Q3 Throughput/);
    expect(text).not.toMatch(/effect on your goal/);
  });

  it('drops the reach-to-goal claim when goal_label is null even if pathways exist', () => {
    const text = composeExplainFromStructureFallback({
      ...STRUCTURE,
      goal_label: null,
      named_factor_label: 'Engineering Capacity',
      named_factor_pathways: [
        {
          label_from: 'Engineering Capacity',
          label_to: 'Some other node',
          strength: 0.65,
        },
      ],
    });
    expect(text).not.toMatch(/effect on your goal/);
    expect(text).toContain('Engineering Capacity');
  });

  it('handles an empty graph gracefully without crashing or leaking internal terms', () => {
    const text = composeExplainFromStructureFallback({
      goal_label: null,
      top_causal_links: [],
      named_factor_pathways: [],
      factor_count: 0,
      option_count: 0,
    });
    for (const pattern of FORBIDDEN_INTERNAL) expect(text).not.toMatch(pattern);
    expect(text).toContain('empty');
  });
});

// =========================================================================
// what_would_flip fallback parity (this workstream): the chip-click /
// LLM-invalid fallback must not reproduce the label-conjunction ambiguity
// or hedge-stacking the gate composer fixes. Bounded scope: label-quoting +
// hedge-consolidation + no "performing best"/"best" — no new inputs.
// =========================================================================
describe('composeWhatWouldFlipFallback — label-quoting + hedge-consolidation parity', () => {
  // Option labels that themselves contain "and".
  const AND_LABELS: AnalysisProjectionSummary = {
    status: 'complete',
    leading_option: { label: 'Hire One Tech Lead and One Developer', probability: 0.45 },
    runner_up: { label: 'Hire Two Developers', probability: 0.44 },
    margin_pp: 1.0,
    robustness_band: 'fragile',
    top_drivers: [{ factor_label: 'Acquisition Cost', sensitivity_value: 0.5 }],
  };
  const RAW_NEAR_TIE_FRAGILE: RawRobustnessSignals = { level: 'fragile', near_tie_is_tie: true };

  it('"and"-containing option labels produce unambiguous quoted comparison copy', () => {
    const text = composeWhatWouldFlipFallback(AND_LABELS, RAW_NEAR_TIE_FRAGILE);
    expectNaturalProse(text);
    // Labels are quoted, so the comparison stays parseable.
    expect(text).toContain("'Hire One Tech Lead and One Developer'");
    expect(text).toContain("'Hire Two Developers'");
    // The ambiguous unquoted run must NOT appear.
    expect(text).not.toContain(
      'Hire One Tech Lead and One Developer and Hire Two Developers are effectively tied',
    );
  });

  it('no "performing best" / "best" in the opener', () => {
    const text = composeWhatWouldFlipFallback(ANALYSIS);
    expect(text).not.toMatch(/performing best/i);
    expect(text).not.toMatch(/\bbest\b/i);
    expect(text).toMatch(/currently leads/);
  });

  it('near-tie + fragile: the lead drops its trailing "could shift" hedge (one caveat only)', () => {
    const text = composeWhatWouldFlipFallback(AND_LABELS, RAW_NEAR_TIE_FRAGILE);
    // The effectively-tied lead no longer carries the stacked tail …
    expect(text).not.toMatch(/effectively tied, so the outcome could shift/i);
    expect(text).not.toMatch(/could shift with small changes/i);
    // … and the single fragility caveat is the only one that fires.
    expect(text.toLowerCase()).toMatch(/picture appears fragile/);
    expect((text.match(/effectively tied/gi) ?? []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// V5 P0-B — honest flip-evidence composition.
//
// Reproduces the live staging failure (build cef69b0, scenario e22aa97b): a
// `what_would_flip` chip-click answered "the picture appears fragile, so even
// small adjustments to the strongest drivers could shift which option leads"
// while the flip analysis had found NO single-factor tipping point within
// bounds (`flip_value: null`, `flip_reason: 'no_effect_within_bounds'`, and a
// `margin_sensitivity` reporting `movement: 'none'`). The composer now reads
// the flip evidence (threaded as the 3rd arg) and answers honestly.
// ---------------------------------------------------------------------------
describe('composeWhatWouldFlipFallback — honest flip evidence (V5 P0-B)', () => {
  // Fragile band + finite margin: WITHOUT a flip summary this projection
  // produces the "picture appears fragile … could shift which option leads"
  // sentence, so it is the right control for proving the flip evidence
  // suppresses that contradiction.
  const FRAGILE_BAND: AnalysisProjectionSummary = {
    status: 'complete',
    leading_option: { label: 'Hire One Tech Lead', probability: 0.66 },
    runner_up: { label: 'Hire Two Developers', probability: 0.32 },
    margin_pp: 34,
    robustness_band: 'fragile',
    top_drivers: [
      { factor_label: 'Tech Lead in Place', sensitivity_value: 0.7 },
      { factor_label: 'Developer Headcount Added', sensitivity_value: 0.4 },
    ],
  };

  const NO_PRACTICAL_FLIP: FlipSummary = {
    overall_status: 'no_practical_flip',
    margin_supports_flip: false,
    entries: [
      {
        factor_id: 'fac_hiring_cost',
        factor_label: 'Hiring and Salary Cost',
        flip_value: null,
        flip_reason: 'no_effect_within_bounds',
        margin_supports_flip: false,
      },
    ],
  };

  const RAW_FRAGILE: RawRobustnessSignals = { level: 'fragile', near_tie_is_tie: false };
  const CONTRADICTORY = /could shift which option leads/i;
  const NAMES_FRAGILITY = /picture appears fragile/i;
  const HONEST_NO_FLIP = /no single factor on its own reached a tipping point/i;

  it('no_practical_flip + fragile band: says no single-factor tipping point and SUPPRESSES the "could flip" contradiction', () => {
    const text = composeWhatWouldFlipFallback(FRAGILE_BAND, RAW_FRAGILE, NO_PRACTICAL_FLIP);
    expectNaturalProse(text);
    expect(text).toMatch(HONEST_NO_FLIP);
    // The exact live-staging contradiction must be gone.
    expect(text).not.toMatch(CONTRADICTORY);
    expect(text).not.toMatch(NAMES_FRAGILITY);
  });

  it('CONTROL: the SAME fragile projection WITHOUT flip evidence still emits the fragility "could shift" copy (proves the flip verdict is what suppresses it)', () => {
    const text = composeWhatWouldFlipFallback(FRAGILE_BAND, RAW_FRAGILE);
    expect(text).toMatch(CONTRADICTORY);
    expect(text).not.toMatch(HONEST_NO_FLIP);
  });

  it('concrete flip: names the clearest single lever and frames it as something to test (no invented threshold value)', () => {
    const concrete: FlipSummary = {
      overall_status: 'concrete',
      margin_supports_flip: true,
      entries: [
        {
          factor_id: 'fac_capacity',
          factor_label: 'Engineering Capacity',
          flip_value: 0.42,
          flip_reason: null,
          margin_supports_flip: true,
        },
      ],
    };
    const text = composeWhatWouldFlipFallback(FRAGILE_BAND, RAW_FRAGILE, concrete);
    expectNaturalProse(text);
    expect(text).toMatch(/Engineering Capacity is the most likely single factor to change which option leads/i);
    expect(text).toMatch(/clearest one to test/i);
    expect(text).not.toMatch(HONEST_NO_FLIP);
  });

  it('insufficient_data: says it could not isolate a single-factor tipping point and makes no flippability claim', () => {
    const insufficient: FlipSummary = {
      overall_status: 'insufficient_data',
      margin_supports_flip: false,
      entries: [
        {
          factor_id: 'fac_x',
          factor_label: 'Some Factor',
          flip_value: null,
          flip_reason: 'max_iterations',
          margin_supports_flip: false,
        },
      ],
    };
    const text = composeWhatWouldFlipFallback(FRAGILE_BAND, RAW_FRAGILE, insufficient);
    expect(text).toMatch(/did not isolate a single-factor tipping point/i);
    expect(text).not.toMatch(CONTRADICTORY);
  });

  it('backward-compat: a 2-arg call equals a 3-arg call with flipSummary undefined / null / overall_status "none"', () => {
    const twoArg = composeWhatWouldFlipFallback(ANALYSIS, null);
    expect(composeWhatWouldFlipFallback(ANALYSIS, null, undefined)).toBe(twoArg);
    expect(composeWhatWouldFlipFallback(ANALYSIS, null, null)).toBe(twoArg);
    expect(
      composeWhatWouldFlipFallback(ANALYSIS, null, {
        overall_status: 'none',
        margin_supports_flip: false,
        entries: [],
      }),
    ).toBe(twoArg);
  });

  it('overall_status "none" on a fragile band is absent flip evidence, so it preserves the existing fragility fallback', () => {
    const noFlipEvidence: FlipSummary = {
      overall_status: 'none',
      margin_supports_flip: false,
      entries: [],
    };
    const text = composeWhatWouldFlipFallback(FRAGILE_BAND, RAW_FRAGILE, noFlipEvidence);
    expect(text).toMatch(CONTRADICTORY);
    expect(text).toMatch(NAMES_FRAGILITY);
    expect(text).not.toMatch(HONEST_NO_FLIP);
    expect(text).not.toMatch(/This result looks stable/i);
  });

  it('overall_status "none" on a NEAR-TIE (non-fragile) band is absent flip evidence, so it preserves the existing near-tie fallback (not masked by a stable-band assertion)', () => {
    // Distinct composer branch from the fragile one above. A stable band with a
    // near-zero margin + raw near_tie override emits the closeness fallback
    // "the result is sensitive to small movements … the leading option could
    // change without much shifting". 'none' must NOT suppress it.
    const nearTieProjection: AnalysisProjectionSummary = {
      ...FRAGILE_BAND,
      margin_pp: 0.5,
      robustness_band: 'stable',
    };
    const rawNearTie: RawRobustnessSignals = { level: 'stable', near_tie_is_tie: true };
    const noFlipEvidence: FlipSummary = {
      overall_status: 'none',
      margin_supports_flip: false,
      entries: [],
    };
    const withNone = composeWhatWouldFlipFallback(nearTieProjection, rawNearTie, noFlipEvidence);
    const withoutFlip = composeWhatWouldFlipFallback(nearTieProjection, rawNearTie);
    // 'none' behaves EXACTLY like absent flip evidence.
    expect(withNone).toBe(withoutFlip);
    // The near-tie closeness fallback is actually present (proving it is not
    // masked, and the band is NOT fragile here).
    expect(withNone.toLowerCase()).toMatch(/sensitive to small movements/);
    expect(withNone).not.toMatch(NAMES_FRAGILITY);
    expect(withNone).not.toMatch(HONEST_NO_FLIP);
  });
});
