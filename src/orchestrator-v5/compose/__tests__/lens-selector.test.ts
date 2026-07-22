/**
 * Capability layer P0 — deterministic lens selector tests (ROADMAP 1.183).
 *
 * Proves each rule picks its lens under the triggering state, the priority
 * order (sensitivity → pre-mortem → EVPI), the threshold boundaries, and — the
 * load-bearing negative control — that weak / absent evidence recommends
 * NOTHING. These tests are the mutation witnesses for every selector rule:
 * flipping a threshold or a comparator turns the matching case RED.
 */

import { describe, expect, it } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import {
  DOMINANCE_SHARE_MIN,
  EVPI_MATERIAL_MIN_PP,
  PREMORTEM_WINPROB_MAX,
  PREMORTEM_WINPROB_MIN,
  selectLens,
} from '../lens-selector.js';

// ============================================================================
// Fixtures
// ============================================================================

interface FactorInput {
  readonly factor_id?: string;
  readonly influence_score?: number;
  readonly influence_rank?: number;
  readonly evpi_percentage_points?: number;
  readonly evpi_status?: string;
  readonly confidence?: number | null;
  readonly flip_risk_category?: string;
}

interface OptionInput {
  readonly win_probability?: number;
}

interface EnrichmentInput {
  readonly factor_sensitivity?: readonly FactorInput[];
  readonly option_comparison?: readonly OptionInput[];
  readonly confidence_tier?: string;
  /** When true, omit the `enrichment` key entirely (no analysis at all). */
  readonly noEnrichment?: boolean;
}

function makeFact(input: EnrichmentInput = {}): RunAnalysisHandlerFact {
  const result: Record<string, unknown> = {
    scenario_id: 'scen-test',
    leading_option_id: 'opt_a',
    summary: 'Ran analysis on your current scenario.',
    graph_hash_at_run: 'gh_a1b2c3d4e5f60001',
    computed_at: '2026-07-22T14:59:00.000Z',
  };
  if (!input.noEnrichment) {
    const enrichment: Record<string, unknown> = {};
    if (input.factor_sensitivity !== undefined) {
      enrichment.factor_sensitivity = input.factor_sensitivity;
    }
    if (input.option_comparison !== undefined) {
      enrichment.option_comparison = input.option_comparison;
    }
    if (input.confidence_tier !== undefined) {
      enrichment.confidence_tier = input.confidence_tier;
    }
    result.enrichment = enrichment;
  }
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result,
  } as unknown as RunAnalysisHandlerFact;
}

// A "strong / decisive / no-fragility" baseline that MUST recommend nothing.
// Individual tests perturb one dimension to trip exactly one rule.
const HEALTHY: EnrichmentInput = {
  confidence_tier: 'strong',
  factor_sensitivity: [
    { factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9 },
    { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
    { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
  ],
  option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
};

// ============================================================================
// The load-bearing negative control
// ============================================================================

describe('selectLens — recommends NOTHING when evidence is weak', () => {
  it('returns null on a healthy, decisive, non-fragile analysis', () => {
    expect(selectLens(makeFact(HEALTHY))).toBeNull();
  });

  it('returns null when there is no enrichment at all', () => {
    expect(selectLens(makeFact({ noEnrichment: true }))).toBeNull();
  });

  it('returns null when enrichment is present but empty', () => {
    expect(selectLens(makeFact({}))).toBeNull();
  });

  it('returns null when factor_sensitivity is an empty array', () => {
    expect(selectLens(makeFact({ factor_sensitivity: [], confidence_tier: 'strong' }))).toBeNull();
  });

  it('returns null when EVPI is present but below the resolution floor', () => {
    // Just under the material threshold — no lens.
    const fact = makeFact({
      confidence_tier: 'strong',
      factor_sensitivity: [
        {
          factor_id: 'fac_a',
          influence_score: 0.34,
          influence_rank: 1,
          confidence: 0.9,
          evpi_percentage_points: EVPI_MATERIAL_MIN_PP - 0.5,
        },
        { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
        { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
      ],
      option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
    });
    expect(selectLens(fact)).toBeNull();
  });

  it('ignores EVPI marked below_resolution even when the pp value looks material', () => {
    const fact = makeFact({
      confidence_tier: 'strong',
      factor_sensitivity: [
        {
          factor_id: 'fac_a',
          influence_score: 0.34,
          influence_rank: 1,
          confidence: 0.9,
          // A stale/garbage pp value that must NOT count because status says so.
          evpi_percentage_points: 99,
          evpi_status: 'below_resolution',
        },
        { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
        { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
      ],
      option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
    });
    expect(selectLens(fact)).toBeNull();
  });
});

// ============================================================================
// Rule 1 — sensitivity / flip-risk
// ============================================================================

describe('selectLens — rule 1: sensitivity / flip-risk', () => {
  it("picks sensitivity when a factor is 'isolated' (can flip on its own)", () => {
    // PLoT flip_risk_category 'isolated' = this factor ALONE can flip the result
    // (max marginal_switch_probability over threshold) — the strongest signal.
    const fact = makeFact({
      ...HEALTHY,
      factor_sensitivity: [
        {
          factor_id: 'fac_a',
          influence_score: 0.34,
          influence_rank: 1,
          confidence: 0.9,
          flip_risk_category: 'isolated',
        },
        { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
        { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
      ],
    });
    const sel = selectLens(fact);
    expect(sel?.lens).toBe('sensitivity_flip_risk');
    expect(sel?.rationaleCode).toBe('FLIP_RISK_ISOLATED');
    // The single-factor rationale is the ONE that may claim "on its own".
    expect(sel?.body).toMatch(/on its own/i);
  });

  it("picks sensitivity with the COMBINATION rationale when a factor is 'correlated'", () => {
    // PLoT 'correlated' = flips only in combination with other factors (marginal
    // below threshold). It must NEVER carry the single-factor "on its own" claim.
    const fact = makeFact({
      ...HEALTHY,
      factor_sensitivity: [
        {
          factor_id: 'fac_a',
          influence_score: 0.34,
          influence_rank: 1,
          confidence: 0.9,
          flip_risk_category: 'correlated',
        },
        { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
        { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
      ],
    });
    const sel = selectLens(fact);
    expect(sel?.lens).toBe('sensitivity_flip_risk');
    expect(sel?.rationaleCode).toBe('FLIP_RISK_CORRELATED');
    // Honest wording: combination, and NOT the single-factor "on its own" claim.
    expect(sel?.body).toMatch(/combination/i);
    expect(sel?.body).not.toMatch(/on its own/i);
  });

  it("prefers isolated over correlated when both are present", () => {
    // isolated is the stronger single-factor signal, so it wins the slot even if
    // another factor is only correlated.
    const fact = makeFact({
      ...HEALTHY,
      factor_sensitivity: [
        { factor_id: 'fac_a', influence_score: 0.33, influence_rank: 2, confidence: 0.9, flip_risk_category: 'correlated' },
        { factor_id: 'fac_b', influence_score: 0.34, influence_rank: 1, confidence: 0.9, flip_risk_category: 'isolated' },
        { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
      ],
    });
    expect(selectLens(fact)?.rationaleCode).toBe('FLIP_RISK_ISOLATED');
  });

  it("never fires flip-risk on 'negligible'", () => {
    // 'negligible' is the third enum value: minimal flip risk — no lens from 1a.
    // With a healthy, decisive graph this must recommend NOTHING.
    const fact = makeFact({
      ...HEALTHY,
      factor_sensitivity: [
        { factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9, flip_risk_category: 'negligible' },
        { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9, flip_risk_category: 'negligible' },
        { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9, flip_risk_category: 'negligible' },
      ],
    });
    expect(selectLens(fact)).toBeNull();
  });

  it("regression: fires on the reviewer's staging scenario — an isolated rank-1 factor", () => {
    // Real PLoT enrichment (fac_eng_capacity, isolated, rank 1). The old trigger
    // set ['fragile','correlated'] MATCHED NEITHER 'isolated' nor these tokens, so
    // no lens fired exactly when a single-factor flip signal was strongest. This
    // factor is not a dominant driver (0.34 share) and the graph is otherwise
    // strong/decisive, so 1a-isolated is the ONLY thing that can fire — a clean
    // mutation witness: revert the isolated branch and this reds.
    const fact = makeFact({
      confidence_tier: 'strong',
      factor_sensitivity: [
        { factor_id: 'fac_eng_capacity', influence_score: 0.34, influence_rank: 1, confidence: 0.9, flip_risk_category: 'isolated' },
        { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
        { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
      ],
      option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
    });
    const sel = selectLens(fact);
    expect(sel?.lens).toBe('sensitivity_flip_risk');
    expect(sel?.rationaleCode).toBe('FLIP_RISK_ISOLATED');
  });

  it('picks sensitivity when one driver carries a strict majority share', () => {
    const fact = makeFact({
      confidence_tier: 'strong',
      // 0.7 / (0.7+0.2+0.1) = 0.7 share > 0.5 → dominant.
      factor_sensitivity: [
        { factor_id: 'fac_a', influence_score: 0.7, influence_rank: 1, confidence: 0.9 },
        { factor_id: 'fac_b', influence_score: 0.2, influence_rank: 2, confidence: 0.9 },
        { factor_id: 'fac_c', influence_score: 0.1, influence_rank: 3, confidence: 0.9 },
      ],
      option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
    });
    const sel = selectLens(fact);
    expect(sel?.lens).toBe('sensitivity_flip_risk');
    expect(sel?.rationaleCode).toBe('DOMINANT_DRIVER');
  });

  it('does NOT treat two equal drivers (0.5 share) as dominant', () => {
    // Exactly at the share boundary — strict `>` means no trigger. With strong
    // confidence + decisive win-prob + no material EVPI, this is NOTHING.
    const fact = makeFact({
      confidence_tier: 'strong',
      factor_sensitivity: [
        { factor_id: 'fac_a', influence_score: 0.5, influence_rank: 1, confidence: 0.9 },
        { factor_id: 'fac_b', influence_score: 0.5, influence_rank: 2, confidence: 0.9 },
      ],
      option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
    });
    expect(selectLens(fact)).toBeNull();
    // Guard the constant so a future edit that lowers it is caught here.
    expect(DOMINANCE_SHARE_MIN).toBe(0.5);
  });
});

// ============================================================================
// Rule 2 — pre-mortem
// ============================================================================

describe('selectLens — rule 2: pre-mortem', () => {
  it('picks pre-mortem when the confidence tier needs work', () => {
    const fact = makeFact({
      confidence_tier: 'needs_work',
      factor_sensitivity: [
        { factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9 },
        { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
        { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
      ],
      option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
    });
    const sel = selectLens(fact);
    expect(sel?.lens).toBe('pre_mortem');
    expect(sel?.rationaleCode).toBe('CONFIDENCE_NEEDS_WORK');
  });

  it('picks pre-mortem when the top-influence factor is low confidence', () => {
    const fact = makeFact({
      confidence_tier: 'fair',
      factor_sensitivity: [
        // rank 1 but low confidence (< 0.3) → fragile top driver.
        { factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.2 },
        { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
        { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
      ],
      option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
    });
    const sel = selectLens(fact);
    expect(sel?.lens).toBe('pre_mortem');
    expect(sel?.rationaleCode).toBe('TOP_FACTOR_LOW_CONFIDENCE');
  });

  it('picks pre-mortem when the leading option is ahead but not decisive', () => {
    const fact = makeFact({
      confidence_tier: 'fair',
      factor_sensitivity: [
        { factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9 },
        { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
        { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
      ],
      // Leader at 0.55 → within [0.4, 0.7).
      option_comparison: [{ win_probability: 0.55 }, { win_probability: 0.45 }],
    });
    const sel = selectLens(fact);
    expect(sel?.lens).toBe('pre_mortem');
    expect(sel?.rationaleCode).toBe('WIN_PROB_MODERATE');
  });

  it('does NOT fire WIN_PROB_MODERATE at/above the decisive boundary', () => {
    const fact = makeFact({
      confidence_tier: 'fair',
      factor_sensitivity: [
        { factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9 },
        { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
        { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
      ],
      option_comparison: [{ win_probability: PREMORTEM_WINPROB_MAX }, { win_probability: 0.3 }],
    });
    expect(selectLens(fact)).toBeNull();
  });

  it('does NOT fire WIN_PROB_MODERATE below the "leader exists" floor', () => {
    const fact = makeFact({
      confidence_tier: 'fair',
      factor_sensitivity: [
        { factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9 },
        { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
        { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
      ],
      option_comparison: [
        { win_probability: PREMORTEM_WINPROB_MIN - 0.05 },
        { win_probability: 0.35 },
      ],
    });
    expect(selectLens(fact)).toBeNull();
  });
});

// ============================================================================
// Rule 3 — EVPI evidence priority
// ============================================================================

describe('selectLens — rule 3: EVPI evidence priority', () => {
  it('picks EVPI when a factor has material value of information', () => {
    const fact = makeFact({
      confidence_tier: 'strong',
      factor_sensitivity: [
        {
          factor_id: 'fac_a',
          influence_score: 0.34,
          influence_rank: 1,
          confidence: 0.9,
          evpi_percentage_points: EVPI_MATERIAL_MIN_PP + 2,
        },
        { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
        { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
      ],
      option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
    });
    const sel = selectLens(fact);
    expect(sel?.lens).toBe('evpi_evidence_priority');
    expect(sel?.rationaleCode).toBe('MATERIAL_EVPI');
  });

  it('fires exactly at the material EVPI boundary', () => {
    const fact = makeFact({
      confidence_tier: 'strong',
      factor_sensitivity: [
        {
          factor_id: 'fac_a',
          influence_score: 0.34,
          influence_rank: 1,
          confidence: 0.9,
          evpi_percentage_points: EVPI_MATERIAL_MIN_PP,
        },
        { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
        { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
      ],
      option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
    });
    expect(selectLens(fact)?.rationaleCode).toBe('MATERIAL_EVPI');
  });
});

// ============================================================================
// Priority ordering — the first rule that fires wins the single slot
// ============================================================================

describe('selectLens — priority ordering (at most one)', () => {
  it('sensitivity outranks pre-mortem and EVPI when all three could fire', () => {
    const fact = makeFact({
      confidence_tier: 'needs_work', // would trip pre-mortem
      factor_sensitivity: [
        {
          factor_id: 'fac_a',
          influence_score: 0.7, // dominant → sensitivity
          influence_rank: 1,
          confidence: 0.2, // low → would trip pre-mortem
          evpi_percentage_points: 5, // material → would trip EVPI
          flip_risk_category: 'isolated', // isolated → sensitivity (rule 1a)
        },
        { factor_id: 'fac_b', influence_score: 0.2, influence_rank: 2, confidence: 0.9 },
        { factor_id: 'fac_c', influence_score: 0.1, influence_rank: 3, confidence: 0.9 },
      ],
      option_comparison: [{ win_probability: 0.55 }, { win_probability: 0.45 }],
    });
    expect(selectLens(fact)?.lens).toBe('sensitivity_flip_risk');
  });

  it('pre-mortem outranks EVPI when both could fire (no sensitivity trigger)', () => {
    const fact = makeFact({
      confidence_tier: 'needs_work', // pre-mortem
      factor_sensitivity: [
        // Even split (no dominant driver), no fragility flag.
        {
          factor_id: 'fac_a',
          influence_score: 0.34,
          influence_rank: 1,
          confidence: 0.9,
          evpi_percentage_points: 5, // material → EVPI
        },
        { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
        { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
      ],
      option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
    });
    expect(selectLens(fact)?.lens).toBe('pre_mortem');
  });
});

// ============================================================================
// Copy hygiene — every emitted string is prose-guard-safe
// ============================================================================

describe('selectLens — copy is prose-guard clean', () => {
  const FORBIDDEN = [
    /\brecommendations?\b/i,
    /\brecommended\b/i,
    /\bthe\s+winners?\b/i,
    /\bwinning\s+(?:option|probability|side|choice|outcome)\b/i,
    /\bbest\b/i,
    /\boptimal\b/i,
  ];
  // Raw internal decimals (0.x / .x) must never appear in prose.
  const RAW_DECIMAL = /(?:^|[\s(=,])(?:0\.\d|\.\d)/;
  const ID_LIKE = /\b(?:fac|opt|edge|con|out|node)_[a-z0-9]+\b/i;

  // One fact per rationale code, to sweep the copy for all seven codes.
  const cases: ReadonlyArray<EnrichmentInput> = [
    { ...HEALTHY, factor_sensitivity: [{ factor_id: 'fac_a', influence_score: 0.7, influence_rank: 1, confidence: 0.9, flip_risk_category: 'isolated' }, { factor_id: 'fac_b', influence_score: 0.2, influence_rank: 2, confidence: 0.9 }] },
    { confidence_tier: 'strong', factor_sensitivity: [{ factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9, flip_risk_category: 'correlated' }, { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 }, { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 }], option_comparison: [{ win_probability: 0.85 }] },
    { confidence_tier: 'strong', factor_sensitivity: [{ factor_id: 'fac_a', influence_score: 0.7, influence_rank: 1, confidence: 0.9 }, { factor_id: 'fac_b', influence_score: 0.2, influence_rank: 2, confidence: 0.9 }, { factor_id: 'fac_c', influence_score: 0.1, influence_rank: 3, confidence: 0.9 }], option_comparison: [{ win_probability: 0.85 }] },
    { confidence_tier: 'needs_work', factor_sensitivity: [{ factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9 }, { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 }, { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 }] },
    { confidence_tier: 'fair', factor_sensitivity: [{ factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.2 }, { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 }, { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 }] },
    { confidence_tier: 'fair', factor_sensitivity: [{ factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9 }, { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 }, { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 }], option_comparison: [{ win_probability: 0.55 }] },
    { confidence_tier: 'strong', factor_sensitivity: [{ factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9, evpi_percentage_points: 5 }, { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 }, { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 }], option_comparison: [{ win_probability: 0.85 }] },
  ];

  it('emits no forbidden vocabulary, raw decimals, or entity ids in any lens copy', () => {
    for (const input of cases) {
      const sel = selectLens(makeFact(input));
      expect(sel).not.toBeNull();
      for (const text of [sel!.title, sel!.body]) {
        for (const re of FORBIDDEN) expect(text).not.toMatch(re);
        expect(text).not.toMatch(RAW_DECIMAL);
        expect(text).not.toMatch(ID_LIKE);
      }
    }
  });
});
