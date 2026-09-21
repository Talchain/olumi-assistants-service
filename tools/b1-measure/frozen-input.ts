/**
 * ROADMAP 1.77 (B1) — the frozen measurement input, shared by `measure.ts`
 * (latency/cost) and `diagnose.ts` (fallback-cause), so both tools are
 * demonstrably describing the SAME decision. Sized to the design pack's own
 * stated arithmetic basis — "a MODEST 4-option/5-factor/15-edge decision"
 * (invoke.ts:151-153) — which is the basis the ~4x / ~3x claims were derived
 * from and therefore the only size at which they can be fairly tested.
 */

import type { DecisionReviewInvokeInput } from '../../src/cee/decision-review/invoke.js';

// ---------------------------------------------------------------------------
// The frozen input. Sized to the design pack's OWN stated arithmetic basis —
// "a MODEST 4-option/5-factor/15-edge decision" (invoke.ts:151-153) — so the
// measured monolith prompt is comparable to the ~9.9k-token figure the ~4x and
// ~3x claims were derived from. Every number is internally consistent so that
// a grounded review is achievable by both arms (an input that FORCED ungrounded
// numbers would manufacture fallbacks and understate the decomposed arm).
// ---------------------------------------------------------------------------
const FACTOR_LABELS = [
  'Customer demand elasticity',
  'Competitor price response',
  'Supplier cost inflation',
  'Churn among long-tenure accounts',
  'Sales-team capacity',
] as const;

export function buildFrozenInput(): DecisionReviewInvokeInput {
  const optionComparison = [
    { option_id: 'opt-hold', option_label: 'Hold current pricing', win_probability: 0.21, outcome: { mean: 1840000, p10: 1610000, p90: 2070000 } },
    { option_id: 'opt-raise-8', option_label: 'Raise prices by 8 percent', win_probability: 0.46, outcome: { mean: 2130000, p10: 1720000, p90: 2540000 } },
    { option_id: 'opt-raise-15', option_label: 'Raise prices by 15 percent', win_probability: 0.24, outcome: { mean: 2050000, p10: 1390000, p90: 2710000 } },
    { option_id: 'opt-tiered', option_label: 'Introduce tiered pricing', win_probability: 0.09, outcome: { mean: 1930000, p10: 1550000, p90: 2310000 } },
  ];

  const factorSensitivity = FACTOR_LABELS.map((label, i) => ({
    factor_id: `fac-${i + 1}`,
    factor_label: label,
    elasticity: [0.62, -0.41, -0.28, -0.19, 0.11][i]!,
    confidence: [0.55, 0.48, 0.71, 0.39, 0.66][i]!,
  }));

  // 15 edges in the graph; the 4 the engine ranked as fragile carry switch data.
  const fragileEdges = [
    { edge_id: 'edg-3', from_label: 'Customer demand elasticity', to_label: 'Revenue', switch_probability: 0.31, marginal_switch_probability: 0.12, alternative_winner_id: 'opt-hold', alternative_winner_label: 'Hold current pricing' },
    { edge_id: 'edg-7', from_label: 'Competitor price response', to_label: 'Customer demand elasticity', switch_probability: 0.22, marginal_switch_probability: 0.08, alternative_winner_id: 'opt-raise-15', alternative_winner_label: 'Raise prices by 15 percent' },
    { edge_id: 'edg-11', from_label: 'Churn among long-tenure accounts', to_label: 'Revenue', switch_probability: 0.17, marginal_switch_probability: 0.05, alternative_winner_id: 'opt-hold', alternative_winner_label: 'Hold current pricing' },
    { edge_id: 'edg-14', from_label: 'Supplier cost inflation', to_label: 'Margin', switch_probability: 0.13, marginal_switch_probability: 0.04, alternative_winner_id: 'opt-tiered', alternative_winner_label: 'Introduce tiered pricing' },
  ];

  const nodes = [
    { id: 'opt-hold', kind: 'option', label: 'Hold current pricing' },
    { id: 'opt-raise-8', kind: 'option', label: 'Raise prices by 8 percent' },
    { id: 'opt-raise-15', kind: 'option', label: 'Raise prices by 15 percent' },
    { id: 'opt-tiered', kind: 'option', label: 'Introduce tiered pricing' },
    ...FACTOR_LABELS.map((label, i) => ({ id: `fac-${i + 1}`, kind: 'factor', label })),
    { id: 'out-revenue', kind: 'outcome', label: 'Revenue' },
    { id: 'out-margin', kind: 'outcome', label: 'Margin' },
  ];

  const edges = Array.from({ length: 15 }, (_, i) => ({
    id: `edg-${i + 1}`,
    from: i < 5 ? `fac-${(i % 5) + 1}` : i < 10 ? `opt-raise-8` : `fac-${(i % 5) + 1}`,
    to: i % 2 === 0 ? 'out-revenue' : 'out-margin',
    weight: Number((0.1 + (i % 7) * 0.09).toFixed(2)),
  }));

  return {
    brief:
      'We are a B2B analytics company with about 900 mid-market customers and annual recurring revenue of 1840000 GBP. ' +
      'Our prices have not moved for three years while supplier and hosting costs have risen. Sales leadership wants a rise ' +
      'of 8 percent from the next renewal cycle; customer success is worried that our longest-tenure accounts, which are ' +
      'also our least price-sensitive on paper, will read a rise as a signal to re-tender. Two competitors repriced ' +
      'downward last quarter. We must decide before the renewal window opens in eleven weeks, and we would rather protect ' +
      'retention than maximise short-term revenue if the two genuinely conflict.',
    brief_hash: 'b1-measure-frozen-v1',
    graph: { nodes, edges },
    isl_results: {
      option_comparison: optionComparison,
      factor_sensitivity: factorSensitivity,
      fragile_edges: fragileEdges,
      robustness: { recommendation_stability: 0.58, overall_confidence: 0.52, level: 'moderate' },
    },
    deterministic_coaching: {
      readiness: 'needs_work',
      headline_type: 'close_call',
      evidence_gaps: [
        { factor_id: 'fac-1', factor_label: 'Customer demand elasticity', voi: 0.74, confidence: 0.55 },
        { factor_id: 'fac-4', factor_label: 'Churn among long-tenure accounts', voi: 0.61, confidence: 0.39 },
        { factor_id: 'fac-2', factor_label: 'Competitor price response', voi: 0.44, confidence: 0.48 },
      ],
      model_critiques: [
        { critique_id: 'crt-1', text: 'Retention and revenue are modelled as independent outcomes; the brief describes them as coupled.' },
        { critique_id: 'crt-2', text: 'No option represents a partial or staged rise, so the comparison may be coarser than the real choice set.' },
      ],
    },
    winner: { id: 'opt-raise-8', label: 'Raise prices by 8 percent', win_probability: 0.46, outcome_mean: 2130000 },
    runner_up: { id: 'opt-raise-15', label: 'Raise prices by 15 percent', win_probability: 0.24, outcome_mean: 2050000 },
    // FROZEN HISTORY — not a live shape. These rows are the B1 measurement
    // baseline and are deliberately left in the pre-2.228 form so the recorded
    // latency/cost figures stay comparable; the production derivation now
    // reads PLoT's top-level `enrichment.flip_thresholds[]` instead.
    flip_threshold_data: [
      { factor_id: 'fac-1', factor_label: 'Customer demand elasticity', current_value: 0.62, flip_value: 0.38, direction: 'decrease', unit: 'elasticity' },
      { factor_id: 'fac-4', factor_label: 'Churn among long-tenure accounts', current_value: 0.19, flip_value: 0.34, direction: 'increase', unit: 'elasticity' },
    ],
    _meta: {
      input_shape_version: 'v5-normalised',
      flip_threshold_count: 2,
      factor_sensitivity_count: 5,
      fragile_edge_count: 4,
      model_critique_count: 2,
      evidence_gaps_dropped_count: 0,
      margin: 0.22,
    },
  } as DecisionReviewInvokeInput;
}

