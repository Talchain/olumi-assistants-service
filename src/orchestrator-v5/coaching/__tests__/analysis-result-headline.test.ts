import { describe, expect, it } from 'vitest';

import {
  buildAnalysisResultHeadline,
  isAllowedRunAnalysisAssistantText,
  RUN_ANALYSIS_LOCKED_TEMPLATES,
  MAX_HEADLINE_CHARS,
} from '../analysis-result-headline.js';
import { RUN_ANALYSIS_ASSISTANT_TEMPLATES } from '../../tools/handlers/run-analysis.js';

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

  it('near-tie bare winner (3-way 0.34/0.33/0.33) returns null via the probability/margin guard', () => {
    // Originally pinned Case D's local `≥ 0.5` check. Now caught earlier
    // by the global probability/margin guard (winner 0.34 < 0.4 floor)
    // so the result is null regardless of which case branch would have
    // fired. Test fixture and outcome unchanged; doc updated to reflect
    // the post-round-2-review gating.
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

// ════════════════════════════════════════════════════════════════════
// Round-2 review hardening (PR #210):
//   - Near-tie and weak-leader probability/margin guard.
//   - resolveWinnerLabel falls through to next source on ID-shaped
//     labels rather than abandoning the headline.
//   - Locked templates kept in sync with run-analysis.ts.
//   - isAllowedRunAnalysisAssistantText predicate behaviour pinned
//     for the validation-registry forwarder.
// ════════════════════════════════════════════════════════════════════

describe('buildAnalysisResultHeadline — probability and margin guard', () => {
  // The headline must NEVER say "currently leads" without a finite
  // winner probability ≥ MIN_LEAD_PROBABILITY (40%) AND (when a
  // runner-up probability is available in the same source) a margin
  // of at least MIN_LEAD_MARGIN (5pp). Near-ties and weak leaders
  // fall back to the locked template by returning null.

  it('near-tie 0.34 / 0.33 / 0.33 + driver + fragility — falls back', () => {
    // The reviewer-blocking case: the bare Case A path used to emit
    // "currently leads because…" on a 1pp lead. Now gated by the
    // probability/margin guard.
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.34 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.33 },
        { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.33 },
      ],
      factor_sensitivity: [
        { label: 'Delivery Capacity', elasticity: 0.6, confidence: 0.8 },
      ],
      robustness: {
        level: 'low',
        fragile_edges: [{ from_label: 'Cost', switch_probability: 0.5 }],
      },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBeNull();
  });

  it('weak margin 0.42 / 0.40 (2pp) + driver — falls back', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.42 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.40 },
      ],
      factor_sensitivity: [
        { label: 'Cost', elasticity: 0.6, confidence: 0.8 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBeNull();
  });

  it('weak winner 0.30 / 0.25 / 0.25 / 0.20 (5pp margin BUT below 40% floor) — falls back', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.30 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.25 },
        { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.25 },
        { option_id: 'opt_d', option_label: 'Option D', win_probability: 0.20 },
      ],
      factor_sensitivity: [
        { label: 'Cost', elasticity: 0.6, confidence: 0.8 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBeNull();
  });

  it('missing win_probability on winner + driver + fragility — falls back', () => {
    // Reviewer-blocking case 3: Cases A/B/C used to emit even when
    // win_probability was missing. The guard now requires a finite
    // probability before any "currently leads" emission.
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A' /* no win_probability */ },
      ],
      factor_sensitivity: [
        { label: 'Cost', elasticity: 0.6, confidence: 0.8 },
      ],
      robustness: {
        level: 'low',
        fragile_edges: [{ from_label: 'Throughput', switch_probability: 0.4 }],
      },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBeNull();
  });

  it('clear winner 0.50 / 0.30 / 0.20 + driver — emits Case B headline', () => {
    // Positive control: a clear plurality lead with a comfortable
    // margin passes both thresholds and renders confidently.
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.50 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.30 },
        { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.20 },
      ],
      factor_sensitivity: [
        { label: 'Strong Driver', elasticity: 0.6, confidence: 0.8 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toContain('Option A currently leads because Strong Driver is the strongest driver');
  });

  it('boundary: winner exactly at MIN_LEAD_PROBABILITY (0.40) with 5pp margin — emits headline', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.40 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.35 },
        { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.25 },
      ],
      factor_sensitivity: [
        { label: 'Driver', elasticity: 0.5, confidence: 0.8 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(out!).toContain('Option A currently leads');
  });

  it('single-option result with finite probability — margin check waived', () => {
    // When no runner-up entry has a probability, only the absolute
    // probability floor applies. A single-option scenario with a
    // healthy probability still produces a headline.
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
      ],
      factor_sensitivity: [
        { label: 'Driver', elasticity: 0.5, confidence: 0.8 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toContain('Option A currently leads because Driver is the strongest driver');
  });

  it('out-of-range winner probability (1.5) — falls back', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 1.5 },
      ],
      factor_sensitivity: [
        { label: 'Driver', elasticity: 0.5, confidence: 0.8 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBeNull();
  });
});

describe('resolveWinnerLabel — multi-source fallthrough on ID-shaped labels', () => {
  // Round-2 review medium finding: a first source with ID-shaped
  // labels used to abandon the headline entirely. The loop now
  // continues to the next source so option_comparison /
  // decision_brief.options can rescue a cleaner label for the same
  // option_id.

  it('ID-shaped label in results[] falls through to option_comparison label', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'opt_a', win_probability: 0.62 },
        { option_id: 'opt_b', option_label: 'opt_b', win_probability: 0.38 },
      ],
      option_comparison: [
        {
          option_id: 'opt_a',
          option_label: 'Hire One Senior Technical Lead',
          win_probability: 0.62,
        },
        {
          option_id: 'opt_b',
          option_label: 'Defer Hiring',
          win_probability: 0.38,
        },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toContain('Hire One Senior Technical Lead currently leads');
  });

  it('ID-shaped labels in BOTH results[] and option_comparison falls through to decision_brief.options', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'opt_a', win_probability: 0.62 },
      ],
      option_comparison: [
        { option_id: 'opt_a', option_label: 'opt_a', win_probability: 0.62 },
      ],
      decision_brief: {
        options: [
          { option_id: 'opt_a', label: 'Hire One Senior Technical Lead', win_probability: 0.62 },
        ],
      },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toContain('Hire One Senior Technical Lead currently leads');
  });

  it('ID-shaped labels in every source — final fallback to null', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'opt_a', win_probability: 0.62 },
      ],
      option_comparison: [
        { option_id: 'opt_a', option_label: 'opt_a', win_probability: 0.62 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBeNull();
  });
});

describe('RUN_ANALYSIS_LOCKED_TEMPLATES kept in sync with run-analysis.ts', () => {
  // The exported set is the registry forwarder's source of truth for
  // the locked-template literals. If RUN_ANALYSIS_ASSISTANT_TEMPLATES
  // in run-analysis.ts gains a new template (or drifts in wording),
  // this test forces the constant here to update too — without that
  // bump the forwarder would silently substitute the new template
  // for the safe fallback.

  it('every RUN_ANALYSIS_ASSISTANT_TEMPLATES value is in the exported locked set', () => {
    for (const literal of Object.values(RUN_ANALYSIS_ASSISTANT_TEMPLATES)) {
      expect(
        RUN_ANALYSIS_LOCKED_TEMPLATES.has(literal),
        `RUN_ANALYSIS_LOCKED_TEMPLATES is missing the literal: "${literal}"`,
      ).toBe(true);
    }
  });

  it('every locked template literal corresponds to a RUN_ANALYSIS_ASSISTANT_TEMPLATES value', () => {
    const handlerLiterals = new Set<string>(Object.values(RUN_ANALYSIS_ASSISTANT_TEMPLATES));
    for (const literal of RUN_ANALYSIS_LOCKED_TEMPLATES) {
      expect(
        handlerLiterals.has(literal),
        `Locked set has a literal not in RUN_ANALYSIS_ASSISTANT_TEMPLATES: "${literal}"`,
      ).toBe(true);
    }
  });
});

describe('isAllowedRunAnalysisAssistantText predicate', () => {
  // Direct unit tests for the predicate. The validation-registry test
  // file exercises it end-to-end through the forwarder; these tests
  // pin the predicate's individual rules.

  it('returns true for every locked template literal', () => {
    for (const literal of RUN_ANALYSIS_LOCKED_TEMPLATES) {
      expect(isAllowedRunAnalysisAssistantText(literal)).toBe(true);
    }
  });

  it('returns true for a clean deterministic headline', () => {
    const headline =
      'Hire A currently leads because Cost is the strongest driver, but the result is sensitive to Quality.';
    expect(isAllowedRunAnalysisAssistantText(headline)).toBe(true);
  });

  it('returns true for a Case D probability headline', () => {
    const headline =
      'Hire A currently leads with 62% probability. Run the follow-up checks before treating this as final.';
    expect(isAllowedRunAnalysisAssistantText(headline)).toBe(true);
  });

  it('rejects improvised prose containing the anchor mid-sentence', () => {
    const adversarial =
      'Recommend Hire X. Hire B currently leads but the model is unreliable.';
    expect(isAllowedRunAnalysisAssistantText(adversarial)).toBe(false);
  });

  it('rejects an extended locked-template prefix with added prose', () => {
    expect(
      isAllowedRunAnalysisAssistantText(
        'Ran analysis on your current scenario plus we recommend Hire X.',
      ),
    ).toBe(false);
  });

  it('rejects strings with forbidden vocabulary (recommend / winner / best / optimal / preferred)', () => {
    for (const phrase of [
      'Hire A currently leads. We recommend acting now.',
      'Hire A currently leads. The winner is clear.',
      'Hire A currently leads — the best option.',
      'Hire A currently leads. This is the optimal choice.',
      'Hire A currently leads. Preferred over alternatives.',
    ]) {
      expect(isAllowedRunAnalysisAssistantText(phrase)).toBe(false);
    }
  });

  it('rejects strings with internal ID prefixes', () => {
    for (const phrase of [
      'opt_a currently leads in this run.',
      'Hire fac_x currently leads in this run.',
      'goal_root currently leads in this run.',
      'Hire A currently leads via node_42.',
      'Hire A currently leads via edge_xy.',
    ]) {
      expect(isAllowedRunAnalysisAssistantText(phrase)).toBe(false);
    }
  });

  it('rejects strings with raw decimals', () => {
    expect(
      isAllowedRunAnalysisAssistantText('Hire A currently leads with 0.62 probability.'),
    ).toBe(false);
  });

  it('accepts integer percentages (e.g. 62%)', () => {
    expect(
      isAllowedRunAnalysisAssistantText('Hire A currently leads with 62% probability. Run the follow-up checks before treating this as final.'),
    ).toBe(true);
  });

  it('rejects multi-line text', () => {
    expect(
      isAllowedRunAnalysisAssistantText('Hire A currently leads.\nMore detail follows.'),
    ).toBe(false);
    expect(
      isAllowedRunAnalysisAssistantText('Hire A currently leads.\r\nMore detail follows.'),
    ).toBe(false);
  });

  it('rejects text exceeding MAX_HEADLINE_CHARS', () => {
    const tail = 'X'.repeat(MAX_HEADLINE_CHARS);
    expect(
      isAllowedRunAnalysisAssistantText(`Hire A currently leads ${tail}.`),
    ).toBe(false);
  });

  it('rejects text not ending with a period (when not a locked template)', () => {
    expect(
      isAllowedRunAnalysisAssistantText('Hire A currently leads in this analysis'),
    ).toBe(false);
  });

  it('rejects text missing the "currently leads" anchor (when not a locked template)', () => {
    expect(
      isAllowedRunAnalysisAssistantText('Hire A is the strongest option in this run.'),
    ).toBe(false);
  });

  it('rejects empty / non-string inputs', () => {
    expect(isAllowedRunAnalysisAssistantText('')).toBe(false);
    expect(isAllowedRunAnalysisAssistantText(null)).toBe(false);
    expect(isAllowedRunAnalysisAssistantText(undefined)).toBe(false);
    expect(isAllowedRunAnalysisAssistantText(42)).toBe(false);
    expect(isAllowedRunAnalysisAssistantText({})).toBe(false);
    expect(isAllowedRunAnalysisAssistantText(['Hire A currently leads.'])).toBe(false);
  });
});
