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
    // provisional_doctrine_v0 (Mission B): level 'low' now appends the
    // robustness-honesty sentence; the Case E floor itself is unchanged.
    expect(out).toBe(
      'Option A currently leads. The result is not yet robust — small changes could flip it.',
    );
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

  it('soft confidence 0.30 / 0.25 / 0.25 / 0.20 (5pp margin, below 40% floor) + driver — emits a CAUTIOUS provisional headline (Area F policy change)', () => {
    // POLICY CHANGE (V5 deterministic-copy hardening, Area F). Previously a
    // soft-confidence leader (< MIN_LEAD_PROBABILITY) fell back to the bare
    // Case E floor ("Option A currently leads.") with driver/fragility
    // intentionally dropped. New policy: when a REAL margin (>= MIN_LEAD_MARGIN)
    // and a driver/fragility exist, soft confidence INCREASES caveating
    // ("treat this as provisional") instead of suppressing the ingredients.
    // Honest: states the factual plurality margin, names one driver as the
    // sensitivity, makes no confident / recommendation claim.
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
    expect(out).toBe(
      'Option A currently leads by 5 percentage points, but treat this as provisional: the result is sensitive to Cost.',
    );
    // Cautious, not confident: no "because ... strongest driver" framing.
    expect(out).not.toContain('because');
    expect(out).not.toMatch(/\bbest\b|\bwinner\b|\brecommend/i);
    // No raw decimals — integer percentage points only.
    expect(out).not.toMatch(RAW_DECIMAL_PATTERN);
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
    // provisional_doctrine_v0 (Mission B): level 'low' appends the
    // robustness-honesty sentence; the Case E floor itself is unchanged.
    expect(out).toBe(
      'Hire X currently leads. The result is not yet robust — small changes could flip it.',
    );
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
    // provisional_doctrine_v0 (Mission B): level 'low' appends the
    // robustness-honesty sentence; the near-tie line itself is unchanged.
    expect(out).toBe(
      'Option A is currently only fractionally ahead, so the options are effectively tied. The result is not yet robust — small changes could flip it.',
    );
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

  it('near-tie (<=1pp) with a label too long for the tied sentence returns null, not the Case E confident floor', () => {
    // PR #223 review blocker regression: a long winner label makes the
    // effectively-tied sentence exceed MAX_HEADLINE_CHARS while the much
    // shorter "{label} currently leads." (Case E) still fits (~148-203 chars).
    // The near-tie branch must return null (-> neutral locked template), NEVER
    // fall through to the confident Case E floor.
    const longLabel = 'A'.repeat(180);
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: longLabel, win_probability: 0.41 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.40 },
      ],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBeNull();
  });

  it('near-tie close-call with a label too long for the close sentence returns null, not the Case E confident floor', () => {
    const longLabel = 'A'.repeat(180);
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: longLabel, win_probability: 0.45 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.42 },
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

describe('soft-confidence enriched headline (Area F — deterministic-copy hardening)', () => {
  // POLICY: a soft-confidence leader (winner < MIN_LEAD_PROBABILITY) with a
  // REAL margin (>= MIN_LEAD_MARGIN) and a driver and/or fragility now emits a
  // cautious provisional headline (case 'SC') instead of the bare Case E floor.
  // This stops `v5.headline.fell_back reason:"soft_confidence"` from firing
  // when the enriched ingredients were actually present (the staging defect).

  it('soft confidence + fragility (+ driver) + moderate margin — names the fragile reason, provisional', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Hire Contractor', win_probability: 0.36 },
        { option_id: 'opt_b', option_label: 'Defer', win_probability: 0.22 },
        { option_id: 'opt_c', option_label: 'Status Quo', win_probability: 0.21 },
        { option_id: 'opt_d', option_label: 'Outsource', win_probability: 0.21 },
      ],
      factor_sensitivity: [
        { label: 'Overtime Intensity', elasticity: 0.7, confidence: 0.9 },
      ],
      robustness: {
        level: 'low',
        fragile_edges: [{ from_label: 'Overtime Intensity', switch_probability: 0.5 }],
      },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    // Fragility is preferred over the driver as the single named sensitivity.
    // provisional_doctrine_v0 (Mission B): level 'low' appends the
    // robustness-honesty sentence after the caution shape.
    expect(out).toBe(
      'Hire Contractor currently leads by 14 percentage points, but treat this as provisional: the result is sensitive to Overtime Intensity. The result is not yet robust — small changes could flip it.',
    );
    expect(out).not.toContain('because'); // never the confident driver framing
    // Descriptor reports the enriched case (NOT 'E'), so the handler does not
    // emit v5.headline.fell_back for this turn.
    const desc = describeAnalysisHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(desc.case).toBe('SC');
    expect(desc.has_driver).toBe(true);
    expect(desc.has_fragility).toBe(true);
    // The emitted text is accepted by the registry grammar allowlist (reuses
    // the Case A shape — no new pattern required).
    expect(isAllowedRunAnalysisAssistantText(out)).toBe(true);
  });

  it('soft confidence + driver only (no fragility) — names the driver as the sensitivity, provisional', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.33 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.25 },
        { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.22 },
        { option_id: 'opt_d', option_label: 'Option D', win_probability: 0.20 },
      ],
      factor_sensitivity: [{ label: 'Launch Timing', elasticity: 0.6, confidence: 0.8 }],
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBe(
      'Option A currently leads by 8 percentage points, but treat this as provisional: the result is sensitive to Launch Timing.',
    );
    expect(describeAnalysisHeadline({ enrichment, leading_option_id: 'opt_a', status_kind: 'ok' }).case).toBe('SC');
  });

  it('soft confidence + real margin but NO driver and NO fragility — stays Case E (no fabricated reason)', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.33 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.25 },
        { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.22 },
        { option_id: 'opt_d', option_label: 'Option D', win_probability: 0.20 },
      ],
      // No factor_sensitivity, no robustness → no driver, no fragility.
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).toBe('Option A currently leads.');
    expect(describeAnalysisHeadline({ enrichment, leading_option_id: 'opt_a', status_kind: 'ok' }).case).toBe('E');
  });

  it('soft confidence + near-tie margin (< 5pp) + driver + fragility — stays Case E (never reads a tie as a lead)', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.34 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.33 },
        { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.33 },
      ],
      factor_sensitivity: [{ label: 'Cost', elasticity: 0.6, confidence: 0.8 }],
      robustness: { level: 'low', fragile_edges: [{ from_label: 'Cost', switch_probability: 0.5 }] },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    // provisional_doctrine_v0 (Mission B): level 'low' appends the
    // robustness-honesty sentence; the Case E floor itself is unchanged.
    expect(out).toBe(
      'Option A currently leads. The result is not yet robust — small changes could flip it.',
    );
    expect(out).not.toContain('sensitive to');
  });

  it('soft-confidence enriched headline carries no raw decimals, no internal IDs, no forbidden vocab', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Hire Contractor + Moderate Overtime', win_probability: 0.37 },
        { option_id: 'opt_b', option_label: 'Defer', win_probability: 0.23 },
        { option_id: 'opt_c', option_label: 'Status Quo', win_probability: 0.21 },
        { option_id: 'opt_d', option_label: 'Outsource', win_probability: 0.19 },
      ],
      factor_sensitivity: [{ label: 'Overtime Intensity', elasticity: 0.7, confidence: 0.9 }],
      robustness: { level: 'low', fragile_edges: [{ from_label: 'Overtime Intensity', switch_probability: 0.5 }] },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out).not.toBeNull();
    expect(out as string).not.toMatch(RAW_DECIMAL_PATTERN);
    expect(out as string).not.toMatch(ID_PATTERN);
    expect(out as string).not.toMatch(UUID_PATTERN);
    expect(out as string).not.toMatch(/\bbest\b|\bwinner\b|\brecommend|\boptimal\b|\bpreferred\b/i);
    expect((out as string).length).toBeLessThanOrEqual(MAX_HEADLINE_CHARS);
  });
});

describe('soft-confidence lower floor — SC_MIN_LEAD_PROBABILITY = 0.30 (inclusive)', () => {
  // Two-floor structure: [0.30, 0.40) is the soft-confidence enriched band;
  // below 0.30 even a real margin + driver/fragility reverts to bare Case E.

  const driver = [{ label: 'Cost', elasticity: 0.6, confidence: 0.8 }];

  it('winner exactly 0.30 (boundary, inclusive) + 5pp margin + driver — qualifies for SC', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.30 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.25 },
        { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.25 },
        { option_id: 'opt_d', option_label: 'Option D', win_probability: 0.20 },
      ],
      factor_sensitivity: driver,
    };
    const input = { enrichment, leading_option_id: 'opt_a', status_kind: 'ok' as const };
    expect(buildAnalysisResultHeadline(input)).toBe(
      'Option A currently leads by 5 percentage points, but treat this as provisional: the result is sensitive to Cost.',
    );
    expect(describeAnalysisHeadline(input).case).toBe('SC');
  });

  it('winner 0.29 (below floor) + 5pp margin + driver — falls to conservative Case E, NOT enriched', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.29 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.24 },
        { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.24 },
        { option_id: 'opt_d', option_label: 'Option D', win_probability: 0.23 },
      ],
      factor_sensitivity: driver,
    };
    const input = { enrichment, leading_option_id: 'opt_a', status_kind: 'ok' as const };
    expect(buildAnalysisResultHeadline(input)).toBe('Option A currently leads.');
    expect(describeAnalysisHeadline(input).case).toBe('E');
  });

  it('winner 0.299 (a 0.29x value, below floor) + 6pp margin + driver — falls to Case E (NOT enriched), proving no pp-rounding leak', () => {
    // 0.299 would round to 30pp; the floor deliberately does NOT pp-round the
    // probability, so 0.299 stays below 0.30 and is excluded.
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.299 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.235 },
        { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.233 },
        { option_id: 'opt_d', option_label: 'Option D', win_probability: 0.233 },
      ],
      factor_sensitivity: driver,
    };
    const input = { enrichment, leading_option_id: 'opt_a', status_kind: 'ok' as const };
    expect(buildAnalysisResultHeadline(input)).toBe('Option A currently leads.');
    expect(describeAnalysisHeadline(input).case).toBe('E');
  });

  it('floor is FP-safe: 0.30 via (0.1 + 0.2) still qualifies; a value 1e-8 below 0.30 does not', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754 — must qualify (>= 0.30).
    const above = {
      enrichment: {
        results: [
          { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.1 + 0.2 },
          { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.25 },
          { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.25 },
          { option_id: 'opt_d', option_label: 'Option D', win_probability: 0.2 },
        ],
        factor_sensitivity: driver,
      },
      leading_option_id: 'opt_a',
      status_kind: 'ok' as const,
    };
    expect(describeAnalysisHeadline(above).case).toBe('SC');

    // 0.3 - 1e-8 === 0.29999999 — below the floor (epsilon is only 1e-9) → Case E.
    const below = {
      enrichment: {
        results: [
          { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.3 - 1e-8 },
          { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.24 },
          { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.23 },
          { option_id: 'opt_d', option_label: 'Option D', win_probability: 0.23 },
        ],
        factor_sensitivity: driver,
      },
      leading_option_id: 'opt_a',
      status_kind: 'ok' as const,
    };
    expect(describeAnalysisHeadline(below).case).toBe('E');
  });

  it('winner 0.24 in a fragmented 5-way race (the motivating case) — bare Case E, no enriched margin headline', () => {
    const enrichment: Record<string, unknown> = {
      results: [
        { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.24 },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.19 },
        { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.19 },
        { option_id: 'opt_d', option_label: 'Option D', win_probability: 0.19 },
        { option_id: 'opt_e', option_label: 'Option E', win_probability: 0.19 },
      ],
      factor_sensitivity: driver,
      robustness: { level: 'low', fragile_edges: [{ from_label: 'Cost', switch_probability: 0.5 }] },
    };
    const input = { enrichment, leading_option_id: 'opt_a', status_kind: 'ok' as const };
    const out = buildAnalysisResultHeadline(input);
    // provisional_doctrine_v0 (Mission B): level 'low' appends the
    // robustness-honesty sentence; the Case E floor itself is unchanged.
    expect(out).toBe(
      'Option A currently leads. The result is not yet robust — small changes could flip it.',
    );
    expect(out).not.toContain('percentage points');
    expect(out).not.toContain('sensitive to');
    expect(describeAnalysisHeadline(input).case).toBe('E');
  });
});

describe('buildAnalysisResultHeadline — Spine A option-controlled-driver suppression', () => {
  // `fac_capacity` is the LARGER-score driver and would lead the "strongest
  // driver" clause; it is option-controlled. `fac_market` is external/tunable.
  const ENRICH_CONTROLLED: Record<string, unknown> = {
    results: [
      { option_id: 'opt_a', option_label: 'Hire One Senior Technical Lead', win_probability: 0.62 },
      { option_id: 'opt_b', option_label: 'Defer Hiring', win_probability: 0.38 },
    ],
    factor_sensitivity: [
      { factor_id: 'fac_capacity', label: 'Engineering Capacity', elasticity: 0.9, confidence: 1 },
      { factor_id: 'fac_market', label: 'Market Demand', elasticity: 0.4, confidence: 1 },
    ],
    robustness: { level: 'moderate' }, // no fragility → Case B driver clause
  };

  it('omits the driver clause when the raw strongest driver is option-controlled', () => {
    // fac_capacity (0.9) is the raw strongest but option-controlled; naming the
    // weaker external fac_market (0.4) as "the strongest driver" would be false,
    // so the clause is omitted entirely (headline falls to a no-driver shape).
    const out = buildAnalysisResultHeadline({
      enrichment: ENRICH_CONTROLLED,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
      interventionControlledFactorIds: new Set(['fac_capacity']),
    });
    expect(out).not.toBeNull();
    expect(out!).not.toContain('Engineering Capacity');
    expect(out!).not.toContain('Market Demand');
    expect(out!).not.toContain('strongest driver');
  });

  it('matches the controlled set on node_id — a node_id-only controlled top entry is still recognised', () => {
    // PLoT keys factor_sensitivity entries by `node_id` (compactAnalysis reads
    // `node_id ?? factor_id`); a node_id-only entry must still be recognised as
    // the raw strongest, so the clause is omitted.
    const enrichment: Record<string, unknown> = {
      results: ENRICH_CONTROLLED.results,
      factor_sensitivity: [
        { node_id: 'fac_capacity', label: 'Engineering Capacity', elasticity: 0.9, confidence: 1 },
        { node_id: 'fac_market', label: 'Market Demand', elasticity: 0.4, confidence: 1 },
      ],
      robustness: { level: 'moderate' },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
      interventionControlledFactorIds: new Set(['fac_capacity']),
    });
    expect(out!).not.toContain('Engineering Capacity');
    expect(out!).not.toContain('Market Demand');
  });

  it('names the strongest driver when it is genuinely external (weaker controlled present — no over-omit)', () => {
    const enrichment: Record<string, unknown> = {
      results: ENRICH_CONTROLLED.results,
      factor_sensitivity: [
        { node_id: 'fac_market', label: 'Market Demand', elasticity: 0.9, confidence: 1 },
        { node_id: 'fac_capacity', label: 'Engineering Capacity', elasticity: 0.4, confidence: 1 },
      ],
      robustness: { level: 'moderate' },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
      interventionControlledFactorIds: new Set(['fac_capacity']),
    });
    // The genuine strongest (fac_market) is external → it IS named.
    expect(out!).toContain('Market Demand');
    expect(out!).not.toContain('Engineering Capacity');
  });

  it('omits the driver clause on an equal-score tie with a controlled lever (order-independent)', () => {
    // External listed FIRST, controlled SECOND, with identical score. Because a
    // controlled lever ties for strongest, the clause is omitted rather than
    // naming the external as "the strongest" — deterministic regardless of array
    // order (the prior first-seen logic would have named the external here).
    const enrichment: Record<string, unknown> = {
      results: ENRICH_CONTROLLED.results,
      factor_sensitivity: [
        { node_id: 'fac_market', label: 'Market Demand', elasticity: 0.7, confidence: 1 },
        { node_id: 'fac_capacity', label: 'Engineering Capacity', elasticity: 0.7, confidence: 1 },
      ],
      robustness: { level: 'moderate' },
    };
    const out = buildAnalysisResultHeadline({
      enrichment,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
      interventionControlledFactorIds: new Set(['fac_capacity']),
    });
    expect(out!).not.toContain('Engineering Capacity');
    expect(out!).not.toContain('Market Demand');
    expect(out!).not.toContain('strongest driver');
  });

  it('without the controlled set, the controlled lever WOULD be named (guard is load-bearing)', () => {
    const out = buildAnalysisResultHeadline({
      enrichment: ENRICH_CONTROLLED,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(out!).toContain('Engineering Capacity');
  });

  it('omits the driver clause entirely when every driver is option-controlled', () => {
    const out = buildAnalysisResultHeadline({
      enrichment: {
        results: ENRICH_CONTROLLED.results,
        factor_sensitivity: [
          { node_id: 'fac_capacity', label: 'Engineering Capacity', elasticity: 0.9, confidence: 1 },
        ],
        robustness: { level: 'moderate' },
      },
      leading_option_id: 'opt_a',
      status_kind: 'ok',
      interventionControlledFactorIds: new Set(['fac_capacity']),
    });
    // Still a valid headline (winner clause), just without naming the lever.
    expect(out).not.toBeNull();
    expect(out!).not.toContain('Engineering Capacity');
    expect(out!).not.toContain('strongest driver');
  });
});

describe('samples_reduced suffix (seam item 3 — SAMPLES_REDUCED_FOR_COMPLEXITY disclosure)', () => {
  const REDUCED_SUFFIX =
    ' Because this model is complex, the analysis ran fewer simulations than usual, so results may be less precise.';
  const CASE_A_BASE =
    'Hire One Senior Technical Lead currently leads by 24 percentage points, but treat this as provisional: the result is sensitive to Hiring and Salary Cost.';

  it('samples_reduced: true appends the reduced-samples suffix to the emitted headline', () => {
    const out = buildAnalysisResultHeadline({
      enrichment: HIRING_FULL,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
      samples_reduced: true,
    });
    expect(out).toBe(`${CASE_A_BASE}${REDUCED_SUFFIX}`);
  });

  it('suffixed headline passes isAllowedRunAnalysisAssistantText', () => {
    expect(isAllowedRunAnalysisAssistantText(`${CASE_A_BASE}${REDUCED_SUFFIX}`)).toBe(true);
  });

  it('reduced suffix composes BEFORE the status suffix (grammar order)', () => {
    const out = buildAnalysisResultHeadline({
      enrichment: HIRING_FULL,
      leading_option_id: 'opt_a',
      status_kind: 'partial',
      samples_reduced: true,
    });
    expect(out).toBe(
      `${CASE_A_BASE}${REDUCED_SUFFIX} The run was flagged as partial — treat as provisional.`,
    );
    expect(isAllowedRunAnalysisAssistantText(out)).toBe(true);
  });

  it('flag absent or false → headline unchanged (default posture)', () => {
    const withoutFlag = buildAnalysisResultHeadline({
      enrichment: HIRING_FULL,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    const withFalse = buildAnalysisResultHeadline({
      enrichment: HIRING_FULL,
      leading_option_id: 'opt_a',
      status_kind: 'ok',
      samples_reduced: false,
    });
    expect(withoutFlag).toBe(CASE_A_BASE);
    expect(withFalse).toBe(CASE_A_BASE);
  });

  it('REDUCED_SAMPLES locked template is registered in the mirror set and allowed', () => {
    const template =
      'Ran analysis on your current scenario. Because this model is complex, the analysis ran fewer simulations than usual, so results may be less precise.';
    expect(RUN_ANALYSIS_LOCKED_TEMPLATES.has(template)).toBe(true);
    expect(isAllowedRunAnalysisAssistantText(template)).toBe(true);
    expect(RUN_ANALYSIS_ASSISTANT_TEMPLATES.REDUCED_SAMPLES).toBe(template);
  });
});
