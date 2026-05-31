import { describe, expect, it } from 'vitest';

import {
  buildAnalysisResultHeadline,
  describeAnalysisHeadline,
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
  it('full data — Case A: winner + margin + provisional caution naming the fragile reason (no driver)', () => {
    const out = buildAnalysisResultHeadline({
      enrichment: HIRING_FULL,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(out!).toBe(
      'Hire One Senior Technical Lead currently leads by 24 percentage points, but treat this as provisional: the result is sensitive to Hiring and Salary Cost.',
    );
    // The driver is intentionally NOT named in the caution shape — the fragile
    // assumption is the single validation reason, so the same factor can never
    // appear as both the driver and the caveat.
    expect(out!).not.toContain('is the strongest driver');
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
      'Hire One Senior Technical Lead currently leads by 24 percentage points because Technical Leadership in Place is the strongest driver.',
    );
  });

  it('fragility, no driver — caution shape with margin (no driver clause)', () => {
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
      'Hire One Senior Technical Lead currently leads by 24 percentage points, but treat this as provisional: the result is sensitive to Hiring and Salary Cost.',
    );
    expect(out!).not.toContain('is the strongest driver');
  });

  it('single-option winner, no driver/fragility — Case D renders integer percentage', () => {
    // Single option: no runner-up means no margin, so the probability
    // sentence is the most informative honest floor.
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
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

  it('near-tie bare winner (3-way 0.34/0.33/0.33) falls back to Case E label-only floor', () => {
    // Originally pinned Case D's local `≥ 0.5` check. The probability/
    // margin guard still catches the weak lead (0.34 < 0.4 floor), so
    // strong cases A/B/C/D do not fire. The link-safe Case-E floor
    // (link-safe response floor workstream) now produces the minimum
    // non-overclaiming "{label} currently leads." instead of null.
    // The label-only output cannot overclaim by construction — it has
    // no driver/fragility clause and no probability number.
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
    expect(out).toBe('Option A currently leads.');
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

  it('near-tie 0.34 / 0.33 / 0.33 + driver + fragility — falls back to Case E label-only floor (no overclaim)', () => {
    // The reviewer-blocking case: the bare Case A path used to emit
    // "currently leads because…" on a 1pp lead. The probability/margin
    // guard still suppresses Case A — Case E now provides the minimum
    // "{label} currently leads." floor (link-safe response floor
    // workstream). Driver and fragility clauses are intentionally
    // dropped at soft confidence to avoid overclaiming.
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
    expect(out).toBe('Option A currently leads.');
    // The strong-case clauses must NOT appear.
    expect(out).not.toContain('because');
    expect(out).not.toContain('sensitive to');
    expect(out).not.toMatch(/\d+%/);
  });

  it('weak margin 0.42 / 0.40 (2pp) + driver — near-tie close-call line, not a confident lead', () => {
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
    expect(out).toBe('Option A currently leads by 2 percentage points, but the options are close.');
    // A near-tie never names a driver or implies a strong lead.
    expect(out).not.toContain('because');
    expect(out).not.toContain('strongest driver');
  });

  it('weak winner 0.30 / 0.25 / 0.25 / 0.20 (5pp margin BUT below 40% floor) — falls back to Case E label-only floor', () => {
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
    expect(out).toBe('Option A currently leads.');
    expect(out).not.toContain('because');
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
    expect(out).toContain('Option A currently leads by 20 percentage points because Strong Driver is the strongest driver');
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

describe('resolveWinner — same-source label + probability invariant', () => {
  // Round-3 review medium finding: previously `resolveWinnerLabel`
  // and `resolveWinnerProbabilities` walked sources independently,
  // so a clean label from one source could be paired with a
  // probability from a different source if the two disagreed. The
  // resolver is now a single pass that returns label + winner prob
  // + runner-up prob from the SAME source per candidate.

  it('skips a source whose label is ID-shaped EVEN IF its probability is finite — uses next source for both', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        // ID-shaped label, distinctive probability. The probability
        // would leak into the headline under cross-source mixing.
        { option_id: 'opt_a', option_label: 'opt_a', win_probability: 0.99 },
      ],
      option_comparison: [
        // Clean label, different probability. Same-source contract:
        // the headline must use this source's probability (62%), not
        // results[]'s 99%.
        { option_id: 'opt_a', option_label: 'Hire X', win_probability: 0.62 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(out!).toContain('Hire X currently leads with 62% probability');
    // Distinctive 99% from results[] must NOT appear — that would
    // signal cross-source mixing.
    expect(out!).not.toContain('99');
  });

  it('skips a source whose probability is missing EVEN IF its label is clean — uses next source for both', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        // Clean label, NO probability. Source skipped entirely.
        { option_id: 'opt_a', option_label: 'Hire X' /* no win_probability */ },
        { option_id: 'opt_b', option_label: 'Plan B' /* no win_probability */ },
      ],
      option_comparison: [
        { option_id: 'opt_a', option_label: 'Hire X', win_probability: 0.62 },
        { option_id: 'opt_b', option_label: 'Plan B', win_probability: 0.38 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(out!).toContain('Hire X currently leads by 24 percentage points');
  });

  it('runner-up probability comes from the same source as the winner', () => {
    // The first accepted source provides BOTH probabilities together.
    // The second source has mismatched numbers — a near-tie that would
    // otherwise gate out the lead via the margin guard. The headline
    // must use the first source's numbers (62% / 38%, margin 24pp).
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Hire X', win_probability: 0.62 },
        { option_id: 'opt_b', option_label: 'Plan B', win_probability: 0.38 },
      ],
      option_comparison: [
        { option_id: 'opt_a', option_label: 'Hire X', win_probability: 0.50 },
        { option_id: 'opt_b', option_label: 'Plan B', win_probability: 0.49 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(out!).toContain('Hire X currently leads by 24 percentage points');
  });

  it('first source is a near-tie — guard fires on THAT source; Case E fires on the first source, does NOT silently switch to a later source with a wider margin', () => {
    // The first source is internally consistent (clean label, finite
    // probability) but the margin is too narrow. The same-source
    // resolver returns it; hasMeaningfulLead rejects it; Case E now
    // takes over with the minimum "{label} currently leads." floor
    // (link-safe response floor workstream). The resolver does NOT
    // cherry-pick a later source's wider margin — that would be a
    // different form of cross-source mixing on the maths side. Pins
    // "first acceptable source wins" so the guards apply to a single
    // coherent set of numbers.
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Hire X', win_probability: 0.41 },
        { option_id: 'opt_b', option_label: 'Plan B', win_probability: 0.40 },
      ],
      option_comparison: [
        { option_id: 'opt_a', option_label: 'Hire X', win_probability: 0.80 },
        { option_id: 'opt_b', option_label: 'Plan B', win_probability: 0.20 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    // Near-tie effectively-tied output (1pp). Crucially the 80% from
    // option_comparison must NOT leak — the same-source invariant still holds.
    expect(out).toBe('Hire X is currently only fractionally ahead, so the options are effectively tied.');
    expect(out).not.toContain('80%');
    expect(out).not.toMatch(/\d+%/);
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

  it('returns true for a clean deterministic headline (caution shape with margin)', () => {
    const headline =
      'Hire A currently leads by 24 percentage points, but treat this as provisional: the result is sensitive to Quality.';
    expect(isAllowedRunAnalysisAssistantText(headline)).toBe(true);
  });

  it('returns true for a Case D probability headline', () => {
    const headline =
      'Hire A currently leads with 62% probability. Run the follow-up checks before treating this as final.';
    expect(isAllowedRunAnalysisAssistantText(headline)).toBe(true);
  });

  it('returns true for every emitted headline shape with every status suffix', () => {
    // Every shape buildAnalysisResultHeadline can emit, crossed with the
    // three suffix states (none / partial / unknown). The predicate MUST
    // accept all of them — a regex/allowlist drift here would silently force
    // the locked-template fallback, making the enriched copy a no-op.
    const PARTIAL = ' The run was flagged as partial — treat as provisional.';
    const UNKNOWN =
      ' The analysis engine reported an unfamiliar status — treat the result with caution.';
    const baseShapes = [
      // Case A — caution + margin
      'Hire A currently leads by 24 percentage points, but treat this as provisional: the result is sensitive to Quality.',
      // Case C — caution, no margin
      'Hire A currently leads, but treat this as provisional: the result is sensitive to Quality.',
      // Case B — driver + margin
      'Hire A currently leads by 24 percentage points because Cost is the strongest driver.',
      // Case B — driver, no margin
      'Hire A currently leads because Cost is the strongest driver.',
      // Case D — margin only
      'Hire A currently leads by 24 percentage points.',
      // Case D — probability (single-option)
      'Hire A currently leads with 62% probability. Run the follow-up checks before treating this as final.',
      // Case NT — small but real lead, flagged close
      'Hire A currently leads by 2 percentage points, but the options are close.',
      // Case NT — effectively tied
      'Hire A is currently only fractionally ahead, so the options are effectively tied.',
      // Case E — link-safe floor
      'Hire A currently leads.',
    ];
    for (const base of baseShapes) {
      for (const suffix of ['', PARTIAL, UNKNOWN]) {
        const text = base + suffix;
        expect(isAllowedRunAnalysisAssistantText(text), `should accept: "${text}"`).toBe(true);
      }
    }
  });

  it('rejects anchor-shaped prose that does not match any case grammar (round-3 reviewer example)', () => {
    // Was previously accepted by the anchor-plus-blacklist predicate.
    // Now rejected because none of the Case A/B/C/D grammars match.
    expect(
      isAllowedRunAnalysisAssistantText(
        'Hire A currently leads for reasons outside the deterministic headline grammar.',
      ),
    ).toBe(false);
  });

  it('rejects Case-A-shaped prose with the wrong driver-clause wording', () => {
    expect(
      isAllowedRunAnalysisAssistantText(
        'Hire A currently leads because Cost is the dominant factor, but the result is sensitive to Quality.',
      ),
    ).toBe(false);
  });

  it('rejects Case-D-shaped prose with the wrong follow-up sentence', () => {
    expect(
      isAllowedRunAnalysisAssistantText(
        'Hire A currently leads with 62% probability. Please run more tests before deciding.',
      ),
    ).toBe(false);
  });

  it('rejects Case-D-shaped prose with a 4-digit percentage', () => {
    expect(
      isAllowedRunAnalysisAssistantText(
        'Hire A currently leads with 1234% probability. Run the follow-up checks before treating this as final.',
      ),
    ).toBe(false);
  });

  it('rejects status-suffix variants with the wrong wording', () => {
    expect(
      isAllowedRunAnalysisAssistantText(
        'Hire A currently leads because Cost is the strongest driver. The run was a bit unusual.',
      ),
    ).toBe(false);
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

// ════════════════════════════════════════════════════════════════════
// V5 link-safe response floor — Case E (label-only fallback).
// Fires when a clean leading-option label exists but stronger cases
// (A/B/C/D) failed because of soft confidence, low margin, or length
// cap. The deterministic output is "{label} currently leads." plus
// the existing status suffix when applicable.
// ════════════════════════════════════════════════════════════════════

describe('buildAnalysisResultHeadline — Case E link-safe floor', () => {
  it('soft confidence (winner 0.34) + clean label → "{label} currently leads."', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Hire X', win_probability: 0.34 },
        { option_id: 'opt_b', option_label: 'Plan B', win_probability: 0.33 },
        { option_id: 'opt_c', option_label: 'Plan C', win_probability: 0.33 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBe('Hire X currently leads.');
  });

  it('low margin (0.42 / 0.40, 2pp) + clean label → near-tie close-call line', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.42 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.40 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBe('Option A currently leads by 2 percentage points, but the options are close.');
  });

  it('soft confidence + driver + fragility → still Case E (no overclaim)', () => {
    // The data has driver + fragility BUT the lead is too weak. Case E
    // intentionally drops the driver/fragility clauses to avoid
    // overclaiming on a soft lead — the lead itself is the only safe
    // signal at this confidence level.
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Hire X', win_probability: 0.34 },
        { option_id: 'opt_b', option_label: 'Plan B', win_probability: 0.33 },
      ],
      factor_sensitivity: [
        { label: 'Cost', elasticity: 0.6, confidence: 0.8 },
      ],
      robustness: {
        level: 'low',
        fragile_edges: [{ from_label: 'Throughput', switch_probability: 0.5 }],
      },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBe('Hire X currently leads.');
  });

  it('Case E preserves partial status suffix', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Hire X', win_probability: 0.34 },
        { option_id: 'opt_b', option_label: 'Plan B', win_probability: 0.33 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'partial',
    });
    expect(out).toBe(
      'Hire X currently leads. The run was flagged as partial — treat as provisional.',
    );
  });

  it('Case E preserves unknown status suffix', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Hire X', win_probability: 0.34 },
        { option_id: 'opt_b', option_label: 'Plan B', win_probability: 0.33 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'unknown',
    });
    expect(out).toBe(
      'Hire X currently leads. The analysis engine reported an unfamiliar status — treat the result with caution.',
    );
  });

  it('Case E never uses "best", "winner", "recommended", "optimal", or "preferred"', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.34 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.33 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(out!).not.toMatch(/\b(best|winner|winners|recommend|recommends|recommended|recommendation|recommendations|optimal|preferred)\b/i);
  });

  it('Case E never emits a probability number (no overclaim)', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.34 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.33 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(out!).not.toMatch(/\d+%/);
    expect(out!).not.toMatch(/\d+\.\d+/);
  });

  it('Case E output passes isAllowedRunAnalysisAssistantText (5th grammar regex registered)', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Hire X', win_probability: 0.34 },
        { option_id: 'opt_b', option_label: 'Plan B', win_probability: 0.33 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(isAllowedRunAnalysisAssistantText(out!)).toBe(true);
  });

  it('Case E output is ≤ MAX_HEADLINE_CHARS', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Hire X', win_probability: 0.34 },
        { option_id: 'opt_b', option_label: 'Plan B', win_probability: 0.33 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'unknown',  // longest suffix
    });
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(MAX_HEADLINE_CHARS);
  });

  it('strong cases A/B/C/D still win when their data + meaningful lead is present', () => {
    // Regression: with Case E added, strong cases must remain the first
    // choice. A clear lead (62% vs 38%, 24pp margin) with driver +
    // fragility data must produce Case A, not Case E.
    const out = buildAnalysisResultHeadline({
      enrichment: HIRING_FULL,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    // A clear lead with fragility data produces the rich caution shape
    // (margin + provisional + fragile reason), never the Case E floor.
    expect(out).toContain('Hire One Senior Technical Lead currently leads by 24 percentage points');
    expect(out).toContain('but treat this as provisional: the result is sensitive to');
    // Case E literal form must NOT show up.
    expect(out).not.toBe('Hire One Senior Technical Lead currently leads.');
  });

  it('ID-shaped leading label still returns null (Case E does not paper over unsafe labels)', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'opt_a', win_probability: 0.34 },
        { option_id: 'opt_b', option_label: 'opt_b', win_probability: 0.33 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBeNull();
  });

  it('UUID leading label still returns null', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        {
          option_id: 'opt_a',
          option_label: '6b3c2a90-1f4d-4b1a-9c2e-d5f1a2b3c4d5',
          win_probability: 0.34,
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

  it('missing label still returns null', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', win_probability: 0.34 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBeNull();
  });

  it('missing win_probability still returns null even with clean label (resolveWinner requires probability)', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Hire X' /* no win_probability */ },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBeNull();
  });

  it('isAllowedRunAnalysisAssistantText accepts every Case-E shape with every status suffix', () => {
    const acceptedShapes = [
      'Hire A currently leads.',
      'Hire A currently leads. The run was flagged as partial — treat as provisional.',
      'Hire A currently leads. The analysis engine reported an unfamiliar status — treat the result with caution.',
    ];
    for (const text of acceptedShapes) {
      expect(isAllowedRunAnalysisAssistantText(text), `should accept: "${text}"`).toBe(true);
    }
  });

  it('isAllowedRunAnalysisAssistantText still rejects anchor-shaped prose despite Case-E (e.g. "currently leads for reasons…")', () => {
    // The Case-E regex requires a literal period right after "currently leads".
    // Prose like "currently leads for reasons …" extends with extra tokens
    // and is rejected.
    expect(
      isAllowedRunAnalysisAssistantText(
        'Hire A currently leads for reasons outside the deterministic headline grammar.',
      ),
    ).toBe(false);
  });

  it('isAllowedRunAnalysisAssistantText still rejects forbidden vocabulary even in Case-E shape', () => {
    // "Hire A currently leads. We recommend acting now." — regex matches
    // the Case-E shape via the leading "Hire A currently leads." prefix,
    // but the trailing " We recommend acting now." causes the full-string
    // match to fail (the regex anchors with `$`). And even if grammar
    // matched, defence-in-depth catches "recommend".
    expect(
      isAllowedRunAnalysisAssistantText('Hire A currently leads. We recommend acting now.'),
    ).toBe(false);
    // Standalone Case-E forbidden vocab check.
    expect(
      isAllowedRunAnalysisAssistantText('Recommend Hire A currently leads.'),
    ).toBe(false);
  });
});

describe('describeAnalysisHeadline — descriptor metadata for telemetry', () => {
  it('Case E from soft confidence — reason: soft_confidence', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Hire X', win_probability: 0.34 },
        { option_id: 'opt_b', option_label: 'Plan B', win_probability: 0.33 },
      ],
    };
    const descriptor = describeAnalysisHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(descriptor.case).toBe('E');
    expect(descriptor.reason).toBe('soft_confidence');
    expect(descriptor.has_leading_option).toBe(true);
    expect(descriptor.has_clean_label).toBe(true);
    expect(descriptor.has_driver).toBe(false);
    expect(descriptor.has_fragility).toBe(false);
  });

  it('near-tie low margin (0.42 / 0.40) — case NT, reason: low_margin', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.42 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.40 },
      ],
    };
    const descriptor = describeAnalysisHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(descriptor.case).toBe('NT');
    expect(descriptor.reason).toBe('low_margin');
    expect(descriptor.margin_bucket).toBe('tight');
  });

  it('Case A (strong lead with driver + fragility) — reason: unknown', () => {
    const descriptor = describeAnalysisHeadline({
      enrichment: HIRING_FULL,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(descriptor.case).toBe('A');
    expect(descriptor.reason).toBe('unknown');
    expect(descriptor.has_driver).toBe(true);
    expect(descriptor.has_fragility).toBe(true);
    expect(descriptor.margin_bucket).toBe('comfortable');  // 62 - 38 = 24pp
  });

  it('Case D — reason: unknown, has_driver false, has_fragility false', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.38 },
      ],
    };
    const descriptor = describeAnalysisHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(descriptor.case).toBe('D');
    expect(descriptor.reason).toBe('unknown');
    expect(descriptor.has_driver).toBe(false);
    expect(descriptor.has_fragility).toBe(false);
  });

  it('No clean leading option (ID-shaped label) — case: null, reason: unsafe_label', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'opt_a', win_probability: 0.62 },
      ],
    };
    const descriptor = describeAnalysisHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(descriptor.case).toBeNull();
    expect(descriptor.reason).toBe('unsafe_label');
    expect(descriptor.has_leading_option).toBe(false);
    expect(descriptor.has_clean_label).toBe(false);
  });

  it('margin buckets reflect margin size (comfortable / moderate / tight)', () => {
    // Comfortable (24pp)
    const comfortable = describeAnalysisHeadline({
      enrichment: HIRING_FULL,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(comfortable.margin_bucket).toBe('comfortable');

    // Moderate (10pp): 0.5 / 0.4
    const moderate = describeAnalysisHeadline({
      enrichment: {
        results: [
          { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.5 },
          { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.4 },
        ],
      } as Record<string, unknown>,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(moderate.margin_bucket).toBe('moderate');

    // Tight (2pp): 0.42 / 0.40
    const tight = describeAnalysisHeadline({
      enrichment: {
        results: [
          { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.42 },
          { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.40 },
        ],
      } as Record<string, unknown>,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(tight.margin_bucket).toBe('tight');
  });

  it('single-option result — margin_bucket null', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
      ],
    };
    const descriptor = describeAnalysisHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(descriptor.margin_bucket).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════
// Tier 1 enrichment (this workstream): margin, provisional caution,
// near-tie / close-call branch, driver/fragility de-duplication, single
// clean fragile label, and the allowlist <-> emission lockstep proof.
// ════════════════════════════════════════════════════════════════════

describe('buildAnalysisResultHeadline — margin rendering (units)', () => {
  it('renders the margin as an integer "N percentage points", never a fraction', () => {
    // 0.70 - 0.08 = 0.62 fraction -> 62 percentage points. 62 must appear as
    // percentage POINTS; the raw fraction (0.62 / "0.62 points") must never.
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Hire One Tech Lead', win_probability: 0.70 },
        { option_id: 'opt_b', option_label: 'Defer', win_probability: 0.08 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBe('Hire One Tech Lead currently leads by 62 percentage points.');
    expect(out!).toContain('62 percentage points');
    expect(out!).not.toContain('0.62');
    expect(out!).not.toContain('0.62 points');
    expect(out!).not.toMatch(/\d+\.\d+/);
    expect(isAllowedRunAnalysisAssistantText(out!)).toBe(true);
  });

  it('caution shape carries the margin and the provisional framing together', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Hire One Tech Lead', win_probability: 0.70 },
        { option_id: 'opt_b', option_label: 'Defer', win_probability: 0.08 },
      ],
      robustness: {
        level: 'moderate',
        fragile_edges: [{ from_label: 'Delivery Speed Assumption', switch_probability: 0.5 }],
      },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBe(
      'Hire One Tech Lead currently leads by 62 percentage points, but treat this as provisional: the result is sensitive to Delivery Speed Assumption.',
    );
    expect(isAllowedRunAnalysisAssistantText(out!)).toBe(true);
  });
});

describe('buildAnalysisResultHeadline — near-tie / close-call branch', () => {
  it('1pp lead (0.41 / 0.40) -> effectively tied, no margin number', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.41 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.40 },
      ],
      factor_sensitivity: [{ label: 'Cost', elasticity: 0.6, confidence: 0.8 }],
      robustness: { level: 'low', fragile_edges: [{ from_label: 'Risk', switch_probability: 0.5 }] },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBe('Option A is currently only fractionally ahead, so the options are effectively tied.');
    // No driver / fragility / probability / margin number at a near-tie.
    expect(out!).not.toContain('because');
    expect(out!).not.toContain('sensitive to');
    expect(out!).not.toMatch(/\d/);
    expect(isAllowedRunAnalysisAssistantText(out!)).toBe(true);
  });

  it('3pp lead (0.45 / 0.42) -> close-call line naming the margin', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.45 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.42 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBe('Option A currently leads by 3 percentage points, but the options are close.');
    expect(isAllowedRunAnalysisAssistantText(out!)).toBe(true);
  });

  it('near-tie preserves the status suffix', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.45 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.42 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'partial',
    });
    expect(out).toBe(
      'Option A currently leads by 3 percentage points, but the options are close. The run was flagged as partial — treat as provisional.',
    );
  });

  it('designated leader not actually ahead (margin <= 0) -> null (locked template), no false lead', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.40 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.45 },
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

describe('buildAnalysisResultHeadline — driver / fragility de-duplication', () => {
  it('when the top driver and the fragile assumption are the SAME factor, it is named once (no repetition)', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Hire One Tech Lead', win_probability: 0.62 },
        { option_id: 'opt_b', option_label: 'Defer', win_probability: 0.38 },
      ],
      factor_sensitivity: [{ label: 'Delivery Speed', elasticity: 0.6, confidence: 0.8 }],
      robustness: {
        level: 'moderate',
        fragile_edges: [{ from_label: 'Delivery Speed', switch_probability: 0.5 }],
      },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    // The caution shape names the fragile reason ONLY — the driver clause is
    // never added, so "Delivery Speed" appears exactly once.
    expect(out).toBe(
      'Hire One Tech Lead currently leads by 24 percentage points, but treat this as provisional: the result is sensitive to Delivery Speed.',
    );
    const occurrences = out!.split('Delivery Speed').length - 1;
    expect(occurrences).toBe(1);
    expect(out!).not.toContain('is the strongest driver');
    expect(isAllowedRunAnalysisAssistantText(out!)).toBe(true);
  });
});

describe('buildAnalysisResultHeadline — fragile reason is a single clean label (no arrow/pair leak)', () => {
  it('renders a single node label, never an edge pair or arrow', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.38 },
      ],
      robustness: {
        level: 'low',
        fragile_edges: [
          { from_label: 'Delivery Speed', to_label: 'Revenue Goal', switch_probability: 0.6 },
        ],
      },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out!).toContain('the result is sensitive to Delivery Speed.');
    // No raw edge structure leaks (no arrow, no to-label concatenation).
    expect(out!).not.toContain('->');
    expect(out!).not.toContain('→');
    expect(out!).not.toContain('Revenue Goal');
    expect(isAllowedRunAnalysisAssistantText(out!)).toBe(true);
  });
});

describe('isAllowedRunAnalysisAssistantText <-> emission lockstep (allowlist proof)', () => {
  // The safety gate can silently reject the new headline and force the locked
  // fallback, making the feature look like it works while doing nothing. These
  // tests prove BOTH directions: (1) every shape the composer actually emits
  // across a fixture matrix x suffixes passes the gate; (2) the composer no
  // longer emits the retired combined driver+caution shape.
  const SUFFIXES = ['ok', 'partial', 'unknown'] as const;

  const matrix: Array<{ name: string; enrichment: Record<string, unknown>; id: string }> = [
    { name: 'caution + margin (A)', id: 'opt_a', enrichment: HIRING_FULL },
    {
      name: 'driver + margin (B)',
      id: 'opt_a',
      enrichment: { ...HIRING_FULL, robustness: { level: 'moderate' } },
    },
    {
      name: 'caution, no margin (C)',
      id: 'opt_a',
      enrichment: {
        results: [{ option_id: 'opt_a', option_label: 'Hire One Tech Lead', win_probability: 0.62 }],
        robustness: { level: 'low', fragile_edges: [{ from_label: 'Cost', switch_probability: 0.5 }] },
      },
    },
    {
      name: 'margin only (D)',
      id: 'opt_a',
      enrichment: {
        results: [
          { option_id: 'opt_a', option_label: 'Hire One Tech Lead', win_probability: 0.62 },
          { option_id: 'opt_b', option_label: 'Defer', win_probability: 0.38 },
        ],
      },
    },
    {
      name: 'probability, single-option (D)',
      id: 'opt_a',
      enrichment: {
        results: [{ option_id: 'opt_a', option_label: 'Hire One Tech Lead', win_probability: 0.62 }],
      },
    },
    {
      name: 'near-tie close (NT)',
      id: 'opt_a',
      enrichment: {
        results: [
          { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.45 },
          { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.42 },
        ],
      },
    },
    {
      name: 'near-tie tied (NT)',
      id: 'opt_a',
      enrichment: {
        results: [
          { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.41 },
          { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.40 },
        ],
      },
    },
    {
      name: 'soft confidence floor (E)',
      id: 'opt_a',
      enrichment: {
        results: [
          { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.34 },
          { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.33 },
        ],
      },
    },
  ];

  // The retired combined driver+caution shape must never be emitted.
  const RETIRED_COMBINED_SHAPE =
    /currently leads(?: by \d+ percentage points?)? because .+ is the strongest driver, but the result is sensitive to/;

  it('every emitted headline across the fixture matrix x suffixes passes the gate, and never emits the retired combined shape', () => {
    for (const { name, enrichment, id } of matrix) {
      for (const status of SUFFIXES) {
        const out = buildAnalysisResultHeadline({
          enrichment,
          leading_option_id: id,
          status_kind: status,
        });
        expect(out, `${name} / ${status} should emit a headline`).not.toBeNull();
        expect(
          isAllowedRunAnalysisAssistantText(out!),
          `${name} / ${status} must pass the allowlist gate: "${out}"`,
        ).toBe(true);
        expect(
          out!,
          `${name} / ${status} must not emit the retired combined driver+caution shape`,
        ).not.toMatch(RETIRED_COMBINED_SHAPE);
      }
    }
  });

  it('the retired combined driver+caution shape is no longer accepted by the gate', () => {
    expect(
      isAllowedRunAnalysisAssistantText(
        'Hire A currently leads because Cost is the strongest driver, but the result is sensitive to Quality.',
      ),
    ).toBe(false);
  });
});
