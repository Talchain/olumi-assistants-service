/**
 * DGAI #341 — analysis narration must name drivers from `influence_score`
 * (what ISL actually ranks and every UI surface displays), NEVER from the
 * elasticity / sensitivity_score heuristic, and must omit the driver claim
 * when no trustworthy influence signal exists.
 *
 * Live evidence reconstructed here (manual test 2026-07-15, build f5a22c1e,
 * debug bundle 4605a72b, traces 57c20759 / 97906856):
 *
 *   | Factor                        | influence_score | elasticity | sensitivity | zero_reason           |
 *   |-------------------------------|-----------------|------------|-------------|-----------------------|
 *   | Technical Leadership Capacity | 1.0 (rank 1)    | 0          | 0           | intervention_override |
 *   | Founder Equity Dilution       | 0.379           | 0          | 0           | intervention_override |
 *   | Market Timing Pressure        | 0.039 (LAST)    | 0.039      | 0.029       | —                     |
 *
 * The pre-fix heuristic latched onto the ONLY non-zero elasticity/sensitivity
 * (Market Timing Pressure — the LEAST influential factor on the board) and
 * narrated "because Market Timing Pressure is the strongest driver", then
 * self-contradicted on the what_would_flip turn ("would shift this result the
 * most. Today it has little effect on the lead"). Every UI surface correctly
 * showed Technical Leadership Capacity from influence_score.
 *
 * These tests assert the composed user-visible text through the real
 * composition path (top-level enrichment → top_drivers derivation →
 * projectTopDrivers → projection summary → fallback composer), not just a
 * formatter's return value.
 */

import { describe, expect, it } from 'vitest';

import {
  buildAnalysisResultHeadline,
  isAllowedRunAnalysisAssistantText,
} from '../analysis-result-headline.js';
import {
  applyTopLevelDriversOverride,
} from '../../context/analysis-fallback.js';
import { projectTopDrivers } from '../../context/context-pack-assembler.js';
import {
  composeExplainResultsFallback,
  composeWhatWouldFlipFallback,
} from '../../tools/handlers/explanation-fallback.js';
import type { AnalysisProjectionSummary } from '../../context/projection-summaries.js';
import {
  compactAnalysis,
  type AnalysisResponseSummary,
} from '../../../orchestrator/context/analysis-compact.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import { tryPostAnalysisAdviceGate } from '../../routing/post-analysis-advice-gate.js';

// ============================================================================
// Fixtures — minimal reconstruction of the DGAI #341 wire
// ============================================================================

// `zero_reason` is optional: the influence-top factors carry an
// intervention_override pin, the least-influential (Market Timing Pressure)
// does not — that asymmetry is load-bearing for the tests below (the
// "pin lifted" case strips it), so the element type must allow it to be absent.
interface FactorSensitivity341 {
  factor_id: string;
  factor_label: string;
  influence_score: number;
  influence_rank: number;
  sensitivity_score: number;
  elasticity: number;
  direction: 'positive' | 'negative';
  confidence: number;
  zero_reason?: string;
}

const FACTOR_SENSITIVITY_341: readonly FactorSensitivity341[] = [
  {
    factor_id: 'fac_tlc',
    factor_label: 'Technical Leadership Capacity',
    influence_score: 1.0,
    influence_rank: 1,
    sensitivity_score: 0,
    elasticity: 0,
    zero_reason: 'intervention_override',
    direction: 'positive',
    confidence: 0.3,
  },
  {
    factor_id: 'fac_fed',
    factor_label: 'Founder Equity Dilution',
    influence_score: 0.379,
    influence_rank: 2,
    sensitivity_score: 0,
    elasticity: 0,
    zero_reason: 'intervention_override',
    direction: 'negative',
    confidence: 0.3,
  },
  {
    factor_id: 'fac_mtp',
    factor_label: 'Market Timing Pressure',
    influence_score: 0.039,
    influence_rank: 3,
    sensitivity_score: 0.029,
    elasticity: 0.039,
    direction: 'positive',
    confidence: 0.3,
  },
];

const ENRICHMENT_341: Record<string, unknown> = {
  option_comparison: [
    {
      option_id: 'opt_cofounder',
      option_label: 'Bring On Technical Co-Founder',
      win_probability: 0.86,
    },
    {
      option_id: 'opt_solo',
      option_label: 'Continue Solo',
      win_probability: 0.14,
    },
  ],
  factor_sensitivity: FACTOR_SENSITIVITY_341.map((f) => ({ ...f })),
};

const EMPTY_SUMMARY: AnalysisResponseSummary = {
  winner: {
    option_id: 'opt_cofounder',
    option_label: 'Bring On Technical Co-Founder',
    win_probability: 0.86,
  },
  options: [],
  top_drivers: [],
  robustness_level: 'unknown',
  fragile_edge_count: 0,
  margin: 0.72,
  margin_pp: 72,
  analysis_status: 'complete',
};

function projectionFromEnrichment(
  enrichment: Record<string, unknown>,
  controlled?: ReadonlySet<string>,
): AnalysisProjectionSummary {
  // Real chain: top-level enrichment → deriveTopDriversFromTopLevel (via the
  // shared override seam) → projectTopDrivers → projection summary shape.
  const { summary } = applyTopLevelDriversOverride(EMPTY_SUMMARY, enrichment);
  const projected = projectTopDrivers(summary.top_drivers, controlled);
  return {
    status: 'success',
    leading_option: { label: 'Bring On Technical Co-Founder', probability: 0.86 },
    runner_up: { label: 'Continue Solo', probability: 0.14 },
    margin_pp: 72,
    robustness_band: null,
    top_drivers: projected,
  };
}

// ============================================================================
// 1. run_analysis headline — the "strongest driver" clause
// ============================================================================

describe('DGAI #341 — headline driver claim derives from influence_score', () => {
  it('the live board: influence-top is an intervention_override-pinned lever → driver clause OMITTED, and the elasticity artifact (Market Timing Pressure) is never named', () => {
    // The issue's ruled alternative fires here: "or omit the driver claim
    // when elasticities are suppressed by intervention_override". The
    // influence-top (Technical Leadership Capacity) carries the Mission A
    // envelope pin, so omit-not-substitute suppresses the whole clause —
    // it must never fall through to the artifact factor.
    const text = buildAnalysisResultHeadline({
      enrichment: ENRICHMENT_341,
      leading_option_id: 'opt_cofounder',
      status_kind: 'ok',
    });
    expect(text).not.toBeNull();
    expect(text).toContain('came out ahead in 86% of runs of this model');
    expect(text).not.toContain('strongest driver');
    expect(text).not.toContain('Market Timing Pressure');
    // Wiring check: the composed text passes the registry allowlist so the
    // wire actually carries it (copy shape unchanged).
    expect(isAllowedRunAnalysisAssistantText(text)).toBe(true);
  });

  it('names the influence_score top when it is NOT a pinned lever (same board, pin lifted)', () => {
    const enrichment = {
      ...ENRICHMENT_341,
      factor_sensitivity: FACTOR_SENSITIVITY_341.map((f) => {
        const { zero_reason: _lift, ...rest } = f;
        return { ...rest };
      }),
    };
    const text = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_cofounder',
      status_kind: 'ok',
    });
    expect(text).toContain(
      'because Technical Leadership Capacity is the strongest driver',
    );
    expect(text).not.toContain('Market Timing Pressure');
    expect(isAllowedRunAnalysisAssistantText(text)).toBe(true);
  });

  it('omit-not-substitute: when the influence-top is structurally option-controlled, no driver is named at all (never a weaker factor as "the strongest")', () => {
    const text = buildAnalysisResultHeadline({
      enrichment: ENRICHMENT_341,
      leading_option_id: 'opt_cofounder',
      status_kind: 'ok',
      interventionControlledFactorIds: new Set(['fac_tlc', 'fac_fed']),
    });
    expect(text).not.toBeNull();
    expect(text).not.toContain('strongest driver');
    expect(text).not.toContain('Market Timing Pressure');
  });

  it('omits the driver claim when no entry carries a usable influence_score (never falls back to the elasticity heuristic)', () => {
    const enrichment = {
      ...ENRICHMENT_341,
      factor_sensitivity: FACTOR_SENSITIVITY_341.map((f) => {
        const { influence_score: _drop, influence_rank: _drop2, ...rest } = f;
        return { ...rest };
      }),
    };
    const text = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_cofounder',
      status_kind: 'ok',
    });
    // Case D (margin) still fires — but no factor is named as a driver.
    expect(text).not.toBeNull();
    expect(text).not.toContain('strongest driver');
    expect(text).not.toContain('Market Timing Pressure');
  });

  it('zero influence_score is not a driver-of-change: all-zero influence board yields no driver clause', () => {
    const enrichment = {
      ...ENRICHMENT_341,
      factor_sensitivity: FACTOR_SENSITIVITY_341.map((f) => ({
        ...f,
        influence_score: 0,
      })),
    };
    const text = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_cofounder',
      status_kind: 'ok',
    });
    expect(text).not.toBeNull();
    expect(text).not.toContain('strongest driver');
  });
});

// ============================================================================
// 2. top_drivers derivation — top-level (staging-live) shape
// ============================================================================

describe('DGAI #341 — top_drivers rank by influence_score (top-level shape)', () => {
  it('orders the #341 board by influence_score, carrying the influence magnitude', () => {
    const { summary, source } = applyTopLevelDriversOverride(
      EMPTY_SUMMARY,
      ENRICHMENT_341,
    );
    expect(source).toBe('top_level');
    expect(summary.top_drivers.map((d) => d.factor_label)).toEqual([
      'Technical Leadership Capacity',
      'Founder Equity Dilution',
      'Market Timing Pressure',
    ]);
    expect(summary.top_drivers.map((d) => d.sensitivity)).toEqual([
      1.0, 0.379, 0.039,
    ]);
  });

  it('drops entries without a usable influence_score instead of ranking them by elasticity', () => {
    const enrichment = {
      factor_sensitivity: [
        // No influence_score at all — the pre-fix code ranked this top by
        // elasticity; it must now not be a driver candidate.
        { factor_id: 'fac_e', factor_label: 'Elasticity Only', elasticity: 0.9 },
        {
          factor_id: 'fac_i',
          factor_label: 'Influence Carrier',
          influence_score: 0.5,
          elasticity: 0.1,
        },
      ],
    };
    const { summary } = applyTopLevelDriversOverride(EMPTY_SUMMARY, enrichment);
    expect(summary.top_drivers.map((d) => d.factor_label)).toEqual([
      'Influence Carrier',
    ]);
  });
});

// ============================================================================
// 3. top_drivers derivation — per-option shape (compactAnalysis)
// ============================================================================

describe('DGAI #341 — top_drivers rank by influence_score (per-option shape)', () => {
  it('ranks per-option factor_sensitivity by influence_score, not sensitivity/elasticity', () => {
    const envelope = {
      analysis_status: 'complete',
      results: [
        {
          option_id: 'opt_cofounder',
          option_label: 'Bring On Technical Co-Founder',
          win_probability: 0.86,
          factor_sensitivity: FACTOR_SENSITIVITY_341.map((f) => ({
            ...f,
            node_id: f.factor_id,
            label: f.factor_label,
          })),
        },
      ],
    } as unknown as V2RunResponseEnvelope;
    const summary = compactAnalysis(envelope);
    expect(summary).not.toBeNull();
    expect(summary!.top_drivers.map((d) => d.factor_label)).toEqual([
      'Technical Leadership Capacity',
      'Founder Equity Dilution',
      'Market Timing Pressure',
    ]);
  });
});

// ============================================================================
// 4. what_would_flip deterministic fallback — the self-contradiction
// ============================================================================

describe('DGAI #341 — what_would_flip fallback names the influence top and never self-contradicts', () => {
  it('composed through the real chain, names Technical Leadership Capacity, not Market Timing Pressure', () => {
    const text = composeWhatWouldFlipFallback(projectionFromEnrichment(ENRICHMENT_341));
    expect(text).toContain(
      'Movement on Technical Leadership Capacity or Founder Equity Dilution would shift this result the most.',
    );
    expect(text).not.toContain('Market Timing Pressure');
    // The live self-contradiction: a "most" claim about a no-effect factor.
    expect(text).not.toMatch(
      /would shift this result the most\. Today it has little effect/,
    );
  });

  it('omits the "would shift this result the most" claim when the only surviving driver has near-zero influence', () => {
    // Structural suppression of the two influence-top levers leaves only the
    // 0.039 factor — a "most" claim about it would contradict the "has little
    // effect on the lead" band in the same breath. Omit instead.
    const projection = projectionFromEnrichment(
      ENRICHMENT_341,
      new Set(['fac_tlc', 'fac_fed']),
    );
    const text = composeWhatWouldFlipFallback(projection);
    expect(text).not.toContain('would shift this result the most');
    expect(text).not.toContain('Market Timing Pressure');
  });
});

// ============================================================================
// 5. explain_results deterministic fallback — same materiality rule
// ============================================================================

describe('DGAI #341 — explain_results fallback never says "driven mainly by" a no-effect factor', () => {
  it('omits the driver sentence when the only surviving driver has near-zero influence', () => {
    const projection = projectionFromEnrichment(
      ENRICHMENT_341,
      new Set(['fac_tlc', 'fac_fed']),
    );
    const text = composeExplainResultsFallback(projection);
    expect(text).not.toContain('driven mainly by');
    expect(text).not.toContain('Market Timing Pressure');
  });

  it('still names material drivers', () => {
    const text = composeExplainResultsFallback(projectionFromEnrichment(ENRICHMENT_341));
    expect(text).toContain('driven mainly by Technical Leadership Capacity');
  });
});

// ============================================================================
// 6. post-analysis advice gate — superlative driver claims
// ============================================================================

describe('DGAI #341 — advice gate does not superlativise a near-zero driver', () => {
  const NEAR_ZERO_ONLY_ANALYSIS = {
    status: 'success',
    leading_option: { label: 'Bring On Technical Co-Founder' },
    runner_up: { label: 'Continue Solo' },
    top_drivers: [
      { factor_label: 'Market Timing Pressure', sensitivity_value: 0.039 },
    ],
    fragile_edges: [],
  };

  it('evidence_gap fallback omits "the strongest sensitivity is on X" for a near-zero top driver', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What evidence is missing?',
      analysis: NEAR_ZERO_ONLY_ANALYSIS,
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).not.toContain('the strongest sensitivity is on');
      expect(out.assistant_text).not.toContain('Market Timing Pressure');
    }
  });

  it('drivers without a sensitivity_value stay nameable (no materiality verdict on missing data)', () => {
    const out = tryPostAnalysisAdviceGate({
      message: 'What evidence is missing?',
      analysis: {
        ...NEAR_ZERO_ONLY_ANALYSIS,
        top_drivers: [{ factor_label: 'Delivery risk' }],
      },
      freshness: 'fresh',
    });
    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain('the strongest sensitivity is on Delivery risk');
    }
  });
});
