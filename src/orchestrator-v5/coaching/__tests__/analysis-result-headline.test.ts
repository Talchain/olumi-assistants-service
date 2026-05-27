import { describe, expect, it } from 'vitest';

import { buildAnalysisResultHeadline } from '../analysis-result-headline.js';

const HIRING_FULL: Record<string, unknown> = {
  results: [
    { option_id: 'opt_a', option_label: 'Hire One Senior Technical Lead', win_probability: 0.62 },
    { option_id: 'opt_b', option_label: 'Defer Hiring', win_probability: 0.38 },
  ],
  factor_sensitivity: [
    { label: 'Technical Leadership in Place', elasticity: 0.6, confidence: 0.8 },
    { label: 'Hiring and Salary Cost', elasticity: -0.3, confidence: 0.7 },
  ],
  robustness: {
    level: 'moderate',
    fragile_edges: [
      {
        from_label: 'Hiring and Salary Cost',
        to_label: 'Outcome',
        switch_probability: 0.45,
      },
    ],
  },
};

const ID_PATTERN = /\b(opt_|goal_|fac_|node_|edge_|n_|e_)/;
const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const RAW_DECIMAL_PATTERN = /\d+\.\d+/;

describe('buildAnalysisResultHeadline', () => {
  it('full data — Case A includes winner, driver, fragility', () => {
    const out = buildAnalysisResultHeadline({
      enrichment: HIRING_FULL,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(out!).toContain('Hire One Senior Technical Lead currently leads');
    expect(out!).toContain('Technical Leadership in Place is the strongest driver');
    expect(out!).toContain('sensitive to Hiring and Salary Cost');
    expect(out!.length).toBeLessThanOrEqual(220);
  });

  it('driver only — Case B (no fragility clause)', () => {
    const enrichment: Record<string, unknown> = {
      ...HIRING_FULL,
      robustness: { level: 'moderate' },  // no fragile_edges
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBe(
      'Hire One Senior Technical Lead currently leads because Technical Leadership in Place is the strongest driver.',
    );
  });

  it('fragility only — Case C (no driver clause)', () => {
    const enrichment: Record<string, unknown> = {
      results: HIRING_FULL.results,
      robustness: (HIRING_FULL.robustness as Record<string, unknown>),
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBe(
      'Hire One Senior Technical Lead currently leads, but the result is sensitive to Hiring and Salary Cost.',
    );
  });

  it('winner + probability only — Case D renders integer percentage', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.38 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBe(
      'Option A currently leads with 62% probability. Run the follow-up checks before treating this as final.',
    );
    expect(out).toMatch(/\d+% probability/);
    expect(out).not.toMatch(RAW_DECIMAL_PATTERN);
  });

  it('returns null when no winner can be resolved', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_missing',  // not present
      status_kind: 'ok',
    });
    expect(out).toBeNull();
  });

  it('returns null when winner.label === winner.id (label looks like ID)', () => {
    const enrichment: Record<string, unknown> = {
      results: [{ option_id: 'opt_a', option_label: 'opt_a', win_probability: 0.62 }],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBeNull();
  });

  it('returns null when winner label starts with an ID prefix', () => {
    const cases = ['opt_a', 'goal_root', 'fac_price', 'node_42', 'edge_x'];
    for (const idShape of cases) {
      const enrichment: Record<string, unknown> = {
        results: [{ option_id: 'opt_a', option_label: idShape, win_probability: 0.62 }],
      };
      const out = buildAnalysisResultHeadline({
        enrichment,
        leading_option_id: 'opt_a',
        status_kind: 'ok',
      });
      expect(out, `should reject label "${idShape}"`).toBeNull();
    }
  });

  it('returns null when winner label is a UUID', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        {
          option_id: 'opt_a',
          option_label: '6b3c2a90-1f4d-4b1a-9c2e-d5f1a2b3c4d5',
          win_probability: 0.62,
        },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBeNull();
  });

  it('output contains no internal IDs', () => {
    const out = buildAnalysisResultHeadline({
      enrichment: HIRING_FULL,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(out!).not.toMatch(ID_PATTERN);
    expect(out!).not.toMatch(UUID_PATTERN);
  });

  it('output contains no raw decimal numbers in Case A', () => {
    const out = buildAnalysisResultHeadline({
      enrichment: HIRING_FULL,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(out!).not.toMatch(RAW_DECIMAL_PATTERN);
  });

  it('supports enrichment.option_comparison shape', () => {
    const enrichment: Record<string, unknown> = {
      option_comparison: [
        {
          option_id: 'opt_a',
          option_label: 'Option A',
          win_probability: 0.62,
          outcome: { mean: 100, p10: 80, p90: 120 },
        },
        {
          option_id: 'opt_b',
          option_label: 'Option B',
          win_probability: 0.38,
          outcome: { mean: 50, p10: 30, p90: 70 },
        },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toContain('Option A currently leads');
  });

  it('supports enrichment.decision_brief.options shape', () => {
    const enrichment: Record<string, unknown> = {
      decision_brief: {
        options: [
          { option_id: 'opt_a', label: 'Option A', win_probability: 0.62, rank: 1 },
          { option_id: 'opt_b', label: 'Option B', win_probability: 0.38, rank: 2 },
        ],
      },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toContain('Option A currently leads');
  });

  it('robustness.level === "high" omits fragility clause even when fragile_edges present', () => {
    const enrichment: Record<string, unknown> = {
      ...HIRING_FULL,
      robustness: {
        level: 'high',
        fragile_edges: [
          {
            from_label: 'Hiring and Salary Cost',
            to_label: 'Outcome',
            switch_probability: 0.45,
          },
        ],
      },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(out!).not.toContain('sensitive to');
    expect(out!).toContain('Technical Leadership in Place is the strongest driver');
  });

  it('status_kind === "partial" appends provisional suffix', () => {
    const out = buildAnalysisResultHeadline({
      enrichment: HIRING_FULL,
      leading_option_id: 'opt_a',
      status_kind: 'partial',
    });
    // Partial suffix can push above 220 — fall back to Case B internally is fine.
    // Either way, suffix MUST be present when result is non-null.
    if (out !== null) {
      expect(out).toContain('provisional');
    }
  });

  it('status_kind === "unknown" appends caution suffix', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'unknown',
    });
    expect(out).not.toBeNull();
    expect(out!).toContain('treat the result with caution');
  });

  it('length cap: Case A retries as Case B then null when winner label is pathologically long', () => {
    const longWinner = 'A'.repeat(220);
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: longWinner, win_probability: 0.62 },
      ],
      factor_sensitivity: [{ label: 'Driver', elasticity: 0.6, confidence: 0.8 }],
      robustness: {
        level: 'low',
        fragile_edges: [{ from_label: 'X', switch_probability: 0.5 }],
      },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBeNull();  // both Case A and Case B exceed 220
  });

  it('multiple drivers — strongest selected by sensitivity_score when present', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
      ],
      factor_sensitivity: [
        { label: 'Weak Factor', elasticity: 0.9, confidence: 0.9, sensitivity_score: 0.1 },
        { label: 'Strong Factor', elasticity: 0.1, confidence: 0.1, sensitivity_score: 0.9 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toContain('Strong Factor is the strongest driver');
  });

  it('multiple drivers — falls back to abs(elasticity) * confidence when sensitivity_score absent', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
      ],
      factor_sensitivity: [
        { label: 'Driver Low', elasticity: 0.2, confidence: 0.3 },
        { label: 'Driver High', elasticity: -0.8, confidence: 0.9 },  // abs * conf wins
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toContain('Driver High is the strongest driver');
  });

  it('fragile edge picks highest switch_probability', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
      ],
      robustness: {
        level: 'low',
        fragile_edges: [
          { from_label: 'Low Risk', switch_probability: 0.1 },
          { from_label: 'High Risk', switch_probability: 0.7 },
          { from_label: 'Mid Risk', switch_probability: 0.4 },
        ],
      },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toContain('sensitive to High Risk');
  });

  it('fragile edge resolves from_node_id via graph.nodes label map when inline label absent', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
      ],
      graph: {
        nodes: [
          { id: 'node_h', label: 'Hiring Cost' },
          { id: 'node_o', label: 'Outcome' },
        ],
      },
      robustness: {
        level: 'low',
        fragile_edges: [
          { from_node_id: 'node_h', to_node_id: 'node_o', switch_probability: 0.6 },
        ],
      },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toContain('sensitive to Hiring Cost');
  });

  it('returns null when leading_option_id is empty and no clear top probability', () => {
    const enrichment: Record<string, unknown> = {};
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: '',
      status_kind: 'ok',
    });
    expect(out).toBeNull();
  });

  it('Case D requires win_probability ≥ 0.5 — bare winner with low prob returns null', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.34 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.33 },
        { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.33 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBeNull();
  });

  it('driver label filtered when it matches an ID prefix; falls through to next-best', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
      ],
      factor_sensitivity: [
        { label: 'fac_price', factor_id: 'fac_price', elasticity: 0.9, confidence: 0.9 },
        { label: 'Quality Index', factor_id: 'fac_quality', elasticity: 0.4, confidence: 0.7 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toContain('Quality Index is the strongest driver');
  });
});
