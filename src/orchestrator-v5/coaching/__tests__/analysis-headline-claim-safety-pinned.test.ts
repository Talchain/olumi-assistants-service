/**
 * Lane 3 (harness-prose-reliability) — Mission A + B fixtures.
 *
 * Mission A (prose claim-safety rule, provisional_doctrine_v0):
 *   Live defect reproduced from Paul's 2026-07 staging bundle: the
 *   deterministic run_analysis narration said "the result is sensitive to
 *   Tech Lead in Place" while that factor carried sensitivity_score=0,
 *   elasticity=0, zero_reason='intervention_override' (option-pinned).
 *   The grounding was influence_score=1 + a fragile EDGE (0.61), not factor
 *   sensitivity. The composer must NEVER describe a factor as "sensitive" /
 *   driver-of-change when sensitivity_score === 0 OR zero_reason ===
 *   'intervention_override'. Preferred safe alternatives, in order:
 *     1. a genuinely non-pinned named candidate,
 *     2. the fragile EDGE itself ("the link between X and Y is fragile"),
 *     3. generic provisional wording ("the result is not highly stable" —
 *        the mission's example said "the recommendation is not highly
 *        stable", but "recommendation" is forbidden vocabulary on this
 *        surface, so the noun is "result").
 *
 * Mission B (narration completeness, provisional_doctrine_v0):
 *   - robustness.is_robust === false or level === 'low' → the narration must
 *     say so plainly in one clause.
 *   - ≥ 2 options effectively eliminated (< 1% win probability) → one clause.
 *   Same single-block structure; no new block types.
 */
import { describe, expect, it } from 'vitest';

import {
  buildAnalysisResultHeadline,
  isAllowedRunAnalysisAssistantText,
} from '../analysis-result-headline.js';

// ============================================================================
// Mission A — Paul's exact bundle case (RED fixture)
// ============================================================================
//
// Leader opt_tech_lead; fac_tech_lead is option-pinned (sensitivity_score 0,
// elasticity 0, zero_reason 'intervention_override', influence_score 1); the
// only fragility grounding is the fragile edge fac_tech_lead → goal_delivery
// with switch_probability 0.61.
const PAUL_BUNDLE: Record<string, unknown> = {
  results: [
    {
      option_id: 'opt_tech_lead',
      option_label: 'Hire a Tech Lead',
      win_probability: 0.58,
    },
    {
      option_id: 'opt_defer',
      option_label: 'Defer Hiring',
      win_probability: 0.42,
    },
  ],
  factor_sensitivity: [
    {
      factor_id: 'fac_tech_lead',
      label: 'Tech Lead in Place',
      sensitivity_score: 0,
      elasticity: 0,
      zero_reason: 'intervention_override',
      influence_score: 1,
    },
  ],
  robustness: {
    level: 'moderate',
    fragile_edges: [
      {
        from_node_id: 'fac_tech_lead',
        from_label: 'Tech Lead in Place',
        to_node_id: 'goal_delivery',
        to_label: 'Delivery Confidence',
        switch_probability: 0.61,
      },
    ],
  },
};

describe('Mission A — pinned-factor claim safety (Paul bundle, provisional_doctrine_v0)', () => {
  it('never says "the result is sensitive to <pinned factor>" when the factor is option-pinned (sensitivity 0 + intervention_override)', () => {
    const out = buildAnalysisResultHeadline({
      enrichment: PAUL_BUNDLE,
      leading_option_id: 'opt_tech_lead',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    // The live defect: this exact phrase reached the wire.
    expect(out!).not.toContain('the result is sensitive to Tech Lead in Place');
    // The pinned factor must not be described as a driver either.
    expect(out!).not.toContain('is the strongest driver');
  });

  it('prefers the fragile-EDGE phrasing when the only named fragility candidate is pinned', () => {
    const out = buildAnalysisResultHeadline({
      enrichment: PAUL_BUNDLE,
      leading_option_id: 'opt_tech_lead',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    // The genuinely non-pinned candidate is the fragile edge itself: the
    // claim is about the LINK's fragility (switch_probability 0.61), which
    // is truthfully grounded, unlike factor sensitivity (which is 0).
    expect(out!).toContain(
      'the link between Tech Lead in Place and Delivery Confidence is fragile',
    );
    expect(out!).toContain('treat this as provisional');
  });

  it('the edge-phrased headline passes the registry allowlist gate', () => {
    const out = buildAnalysisResultHeadline({
      enrichment: PAUL_BUNDLE,
      leading_option_id: 'opt_tech_lead',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(isAllowedRunAnalysisAssistantText(out!)).toBe(true);
  });

  it('suppression also fires via interventionControlledFactorIds alone (structural pin, no zero_reason in envelope)', () => {
    const enrichment: Record<string, unknown> = {
      results: PAUL_BUNDLE.results,
      factor_sensitivity: [
        {
          factor_id: 'fac_tech_lead',
          label: 'Tech Lead in Place',
          // No zero_reason and a non-zero score: only the structural
          // controlled-set knows this factor is option-pinned.
          sensitivity_score: 0.4,
        },
      ],
      robustness: PAUL_BUNDLE.robustness,
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_tech_lead',
      status_kind: 'ok',
      interventionControlledFactorIds: new Set(['fac_tech_lead']),
    });
    expect(out).not.toBeNull();
    expect(out!).not.toContain('the result is sensitive to Tech Lead in Place');
  });

  it('falls back to generic provisional wording when no safe named candidate exists', () => {
    const enrichment: Record<string, unknown> = {
      results: PAUL_BUNDLE.results,
      factor_sensitivity: PAUL_BUNDLE.factor_sensitivity,
      robustness: {
        level: 'moderate',
        fragile_edges: [
          {
            // Pinned from-node; the to-side is unresolvable (no label, no
            // graph map) so the edge phrasing is unavailable too.
            from_node_id: 'fac_tech_lead',
            from_label: 'Tech Lead in Place',
            switch_probability: 0.61,
          },
        ],
      },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_tech_lead',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(out!).not.toContain('sensitive to Tech Lead in Place');
    expect(out!).toContain(
      'treat this as provisional: the result is not highly stable',
    );
    expect(isAllowedRunAnalysisAssistantText(out!)).toBe(true);
  });

  it('a genuinely non-pinned named candidate is still preferred over the edge phrasing (no behaviour change for safe cases)', () => {
    const enrichment: Record<string, unknown> = {
      results: PAUL_BUNDLE.results,
      factor_sensitivity: PAUL_BUNDLE.factor_sensitivity,
      robustness: {
        level: 'moderate',
        fragile_edges: [
          {
            from_node_id: 'fac_market',
            from_label: 'Market Demand',
            to_label: 'Delivery Confidence',
            switch_probability: 0.7,
          },
          {
            from_node_id: 'fac_tech_lead',
            from_label: 'Tech Lead in Place',
            to_label: 'Delivery Confidence',
            switch_probability: 0.61,
          },
        ],
      },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_tech_lead',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(out!).toContain('the result is sensitive to Market Demand');
    expect(out!).not.toContain('Tech Lead in Place');
  });

  it('a weaker non-pinned fragile edge is preferred as a NAMED candidate when the strongest edge is pinned and un-phrasable as a link', () => {
    const enrichment: Record<string, unknown> = {
      results: PAUL_BUNDLE.results,
      factor_sensitivity: PAUL_BUNDLE.factor_sensitivity,
      robustness: {
        level: 'moderate',
        fragile_edges: [
          {
            // Strongest edge names only the pinned factor; no to-side.
            from_node_id: 'fac_tech_lead',
            from_label: 'Tech Lead in Place',
            switch_probability: 0.61,
          },
          {
            from_node_id: 'fac_market',
            from_label: 'Market Demand',
            switch_probability: 0.3,
          },
        ],
      },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_tech_lead',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(out!).not.toContain('Tech Lead in Place');
    expect(out!).toContain('the result is sensitive to Market Demand');
  });

  it('never names a zero-sensitivity factor as "the strongest driver" (driver clause omitted when all drivers are pinned/zero)', () => {
    const enrichment: Record<string, unknown> = {
      results: PAUL_BUNDLE.results,
      factor_sensitivity: PAUL_BUNDLE.factor_sensitivity,
      // No fragility at all → composer would previously fall to the driver
      // clause and name the zero-sensitivity pinned factor.
      robustness: { level: 'moderate' },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_tech_lead',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(out!).not.toContain('Tech Lead in Place');
    expect(out!).not.toContain('strongest driver');
  });
});

// ============================================================================
// Mission B — narration completeness (provisional_doctrine_v0)
// ============================================================================

const NOT_ROBUST_CLAUSE =
  'the result is not yet robust — small changes could flip it';

describe('Mission B — robustness honesty clause', () => {
  const BASE: Record<string, unknown> = {
    results: [
      { option_id: 'opt_a', option_label: 'Hire a Tech Lead', win_probability: 0.58 },
      { option_id: 'opt_b', option_label: 'Defer Hiring', win_probability: 0.42 },
    ],
  };

  it('says plainly when robustness.is_robust === false', () => {
    const out = buildAnalysisResultHeadline({
      enrichment: { ...BASE, robustness: { level: 'moderate', is_robust: false } },
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(out!.toLowerCase()).toContain(NOT_ROBUST_CLAUSE);
    expect(isAllowedRunAnalysisAssistantText(out!)).toBe(true);
  });

  it("says plainly when robustness.level === 'low'", () => {
    const out = buildAnalysisResultHeadline({
      enrichment: { ...BASE, robustness: { level: 'low' } },
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(out!.toLowerCase()).toContain(NOT_ROBUST_CLAUSE);
  });

  it('stays silent when robust (level moderate, is_robust true)', () => {
    const out = buildAnalysisResultHeadline({
      enrichment: { ...BASE, robustness: { level: 'moderate', is_robust: true } },
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(out!.toLowerCase()).not.toContain('not yet robust');
  });

  it('keeps the clause alongside a partial status suffix (single block, ordered)', () => {
    const out = buildAnalysisResultHeadline({
      enrichment: { ...BASE, robustness: { level: 'low' } },
      leading_option_id: 'opt_a',
      status_kind: 'partial',
    });
    expect(out).not.toBeNull();
    expect(out!.toLowerCase()).toContain(NOT_ROBUST_CLAUSE);
    expect(out!).toContain('The run was flagged as partial');
    // Narration clause comes before the status suffix.
    expect(out!.toLowerCase().indexOf(NOT_ROBUST_CLAUSE)).toBeLessThan(
      out!.indexOf('The run was flagged as partial'),
    );
    expect(isAllowedRunAnalysisAssistantText(out!)).toBe(true);
  });
});

describe('Mission B — eliminated-options clause', () => {
  const FOUR_WAY: Record<string, unknown> = {
    results: [
      { option_id: 'opt_a', option_label: 'Hire a Tech Lead', win_probability: 0.55 },
      { option_id: 'opt_b', option_label: 'Defer Hiring', win_probability: 0.44 },
      { option_id: 'opt_c', option_label: 'Outsource', win_probability: 0.005 },
      { option_id: 'opt_d', option_label: 'Hiring Freeze', win_probability: 0.004 },
    ],
  };

  it('states when ≥2 options are effectively eliminated (<1% win probability)', () => {
    const out = buildAnalysisResultHeadline({
      enrichment: FOUR_WAY,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(out!).toContain(
      '2 options are effectively eliminated (each has less than a 1% chance of winning)',
    );
    expect(isAllowedRunAnalysisAssistantText(out!)).toBe(true);
  });

  it('stays silent when only one option is below 1%', () => {
    const out = buildAnalysisResultHeadline({
      enrichment: {
        results: [
          { option_id: 'opt_a', option_label: 'Hire a Tech Lead', win_probability: 0.6 },
          { option_id: 'opt_b', option_label: 'Defer Hiring', win_probability: 0.39 },
          { option_id: 'opt_c', option_label: 'Outsource', win_probability: 0.005 },
        ],
      },
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(out!).not.toContain('effectively eliminated');
  });

  it('composes with the robustness clause in one block (robustness first)', () => {
    const out = buildAnalysisResultHeadline({
      enrichment: { ...FOUR_WAY, robustness: { level: 'low' } },
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(out!.toLowerCase()).toContain(NOT_ROBUST_CLAUSE);
    expect(out!).toContain('2 options are effectively eliminated');
    expect(out!.toLowerCase().indexOf(NOT_ROBUST_CLAUSE)).toBeLessThan(
      out!.indexOf('2 options are effectively eliminated'),
    );
    expect(isAllowedRunAnalysisAssistantText(out!)).toBe(true);
  });
});
