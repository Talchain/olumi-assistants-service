/**
 * Unit tests for the V5 recent-changes ContextPack projection.
 *
 * Covers:
 *   - empty / undefined input → empty array
 *   - successful add_constraint produces clean human summary
 *   - constraint update path (existing constraint mutated) produces "Updated …"
 *   - successful set_factor_value produces a "Updated <label> from … to …"
 *   - successful adjust_edge_strength produces a generic line
 *   - noop facts are filtered out
 *   - cap is hard at 3 entries (oldest fall off)
 *   - summary length is capped at RECENT_CHANGES_SUMMARY_MAX_CHARS
 *   - no raw IDs or internal terms appear in the rendered summary strings
 *   - non-mutation facts are skipped silently
 */
import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  RECENT_CHANGES_CAP,
  RECENT_CHANGES_HASH_EMPTY,
  RECENT_CHANGES_SUMMARY_MAX_CHARS,
  computeRecentChangesHash,
  deriveRecentChangesEvidence,
  projectRecentChanges,
  type RecentMutation,
} from '../recent-changes.js';

function mkAddConstraint(opts: {
  noop?: boolean;
  label?: string;
  operator?: '>=' | '<=';
  value?: number;
  unit?: string;
  isUpdate?: boolean;
}): HandlerFact {
  const label = opts.label ?? 'Total cost';
  const operator = opts.operator ?? '<=';
  const value = opts.value ?? 50000;
  const unit = opts.unit;
  const after = {
    constraint_id: 'gc-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    node_id: 'factor_total_cost',
    operator,
    value,
    label,
    provenance: 'explicit',
    ...(unit !== undefined ? { unit } : {}),
  };
  return {
    fact_type: 'add_constraint',
    fact_version: 1,
    noop: opts.noop ?? false,
    result: {
      target_id: after.constraint_id,
      status: opts.noop ? 'noop' : 'applied',
      before: opts.isUpdate ? { ...after, value: value + 1000 } : null,
      after,
    },
  };
}

function mkSetFactorValue(opts: {
  noop?: boolean;
  label?: string;
  beforeValue?: number;
  afterValue?: number;
  unit?: string;
}): HandlerFact {
  const label = opts.label ?? 'Engineering Time Commitment';
  const beforeValue = opts.beforeValue ?? 6;
  const afterValue = opts.afterValue ?? 9;
  const unit = opts.unit;
  return {
    fact_type: 'set_factor_value',
    fact_version: 1,
    noop: opts.noop ?? false,
    result: {
      target_id: 'factor_eng_time',
      status: opts.noop ? 'noop' : 'applied',
      before: {
        value: beforeValue,
        raw_value: beforeValue,
        label,
        ...(unit !== undefined ? { unit } : {}),
      },
      after: {
        value: afterValue,
        raw_value: afterValue,
        label,
        ...(unit !== undefined ? { unit } : {}),
      },
    },
  };
}

function mkAdjustEdge(opts: { noop?: boolean } = {}): HandlerFact {
  return {
    fact_type: 'adjust_edge_strength',
    fact_version: 1,
    noop: opts.noop ?? false,
    result: {
      target_id: 'factor_a→factor_b',
      status: opts.noop ? 'noop' : 'applied',
      before: {
        from: 'factor_a',
        to: 'factor_b',
        strength: { mean: 0.3, std: 0.1 },
        effect_direction: 'positive',
      },
      after: {
        from: 'factor_a',
        to: 'factor_b',
        strength: { mean: 0.6, std: 0.1 },
        effect_direction: 'positive',
      },
    },
  };
}

function mkRunAnalysis(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      leading_option_id: 'opt_a',
      win_probabilities: { opt_a: 0.55, opt_b: 0.45 },
      summary: 'Option A leads.',
      enrichment: {},
      computed_at: '2026-04-01T00:00:00.000Z',
    },
  };
}

describe('projectRecentChanges', () => {
  describe('empty inputs', () => {
    it('returns empty array when priorFacts is undefined', () => {
      expect(projectRecentChanges(undefined)).toEqual([]);
    });

    it('returns empty array when priorFacts is empty', () => {
      expect(projectRecentChanges([])).toEqual([]);
    });

    it('returns empty array when priorFacts contains only non-mutation facts', () => {
      expect(projectRecentChanges([mkRunAnalysis()])).toEqual([]);
    });
  });

  describe('add_constraint summarisation', () => {
    it('produces "Added constraint: <label> must be at most <value>" with currency formatting', () => {
      const result = projectRecentChanges([
        mkAddConstraint({ label: 'Total cost', value: 50000, unit: '£' }),
      ]);
      expect(result).toHaveLength(1);
      expect(result[0]!.action).toBe('constraint_added');
      // The £50,000 reference is the literal grounding the integration
      // test asserts on. If this format changes, update the integration
      // assertion in lockstep.
      expect(result[0]!.summary).toBe(
        'Added constraint: Total cost must be at most £50,000.',
      );
    });

    it('formats percentage values without a leading space', () => {
      const result = projectRecentChanges([
        mkAddConstraint({ label: 'Customer churn', value: 5, unit: '%', operator: '<=' }),
      ]);
      expect(result[0]!.summary).toBe(
        'Added constraint: Customer churn must be at most 5%.',
      );
    });

    it('renders "Updated constraint: …" when the fact carries a non-null `before`', () => {
      const result = projectRecentChanges([
        mkAddConstraint({
          isUpdate: true,
          label: 'Total cost',
          value: 50000,
          unit: '£',
        }),
      ]);
      expect(result[0]!.summary).toBe(
        'Updated constraint: Total cost must be at most £50,000.',
      );
    });

    it('uses a placeholder label when the fact lacks a constraint label', () => {
      // Should not throw and should not invent a label; falls back to a
      // generic phrase. Defensive — production constraints always carry
      // a label.
      const fact: HandlerFact = {
        fact_type: 'add_constraint',
        fact_version: 1,
        noop: false,
        result: {
          target_id: 'gc-x',
          status: 'applied',
          before: null,
          after: { node_id: 'n', operator: '<=', value: 10 },
        },
      };
      const result = projectRecentChanges([fact]);
      expect(result[0]!.summary).toContain('this factor');
      expect(result[0]!.summary).toContain('at most');
    });
  });

  describe('set_factor_value summarisation', () => {
    it('produces "Updated <label> from <before> to <after>" with units', () => {
      const result = projectRecentChanges([
        mkSetFactorValue({
          label: 'Engineering Time Commitment',
          beforeValue: 6,
          afterValue: 9,
          unit: 'months',
        }),
      ]);
      expect(result[0]!.action).toBe('factor_value_updated');
      expect(result[0]!.summary).toBe(
        'Updated Engineering Time Commitment from 6 months to 9 months.',
      );
    });

    it('renders without units when unit is absent', () => {
      const result = projectRecentChanges([
        mkSetFactorValue({
          label: 'Confidence',
          beforeValue: 0.6,
          afterValue: 0.8,
        }),
      ]);
      expect(result[0]!.summary).toBe('Updated Confidence from 0.6 to 0.8.');
    });
  });

  describe('adjust_edge_strength summarisation', () => {
    it('produces a generic decision-language line (no edge ids)', () => {
      const result = projectRecentChanges([mkAdjustEdge()]);
      expect(result[0]!.action).toBe('link_strength_updated');
      expect(result[0]!.summary).toBe('Adjusted a link in the decision model.');
    });
  });

  describe('noop filtering', () => {
    it('drops noop add_constraint facts', () => {
      expect(projectRecentChanges([mkAddConstraint({ noop: true })])).toEqual([]);
    });

    it('drops noop set_factor_value facts', () => {
      expect(projectRecentChanges([mkSetFactorValue({ noop: true })])).toEqual([]);
    });

    it('drops noop adjust_edge_strength facts', () => {
      expect(projectRecentChanges([mkAdjustEdge({ noop: true })])).toEqual([]);
    });
  });

  describe('budget cap', () => {
    it(`hard caps the projection at ${RECENT_CHANGES_CAP} entries`, () => {
      const five = [
        mkAddConstraint({ label: 'C1' }),
        mkAddConstraint({ label: 'C2' }),
        mkAddConstraint({ label: 'C3' }),
        mkAddConstraint({ label: 'C4' }),
        mkAddConstraint({ label: 'C5' }),
      ];
      const result = projectRecentChanges(five);
      expect(result).toHaveLength(RECENT_CHANGES_CAP);
      // Caller passes facts newest-first; the projection preserves order
      // and slices from the head, so the OLDEST drop off.
      expect(result[0]!.summary).toContain('C1');
      expect(result[1]!.summary).toContain('C2');
      expect(result[2]!.summary).toContain('C3');
    });

    it('caps each summary at RECENT_CHANGES_SUMMARY_MAX_CHARS characters', () => {
      const longLabel =
        'A pathologically verbose factor label that should never appear in production but defends the budget';
      const result = projectRecentChanges([
        mkAddConstraint({ label: longLabel, value: 1, unit: '%' }),
      ]);
      expect(result[0]!.summary.length).toBeLessThanOrEqual(
        RECENT_CHANGES_SUMMARY_MAX_CHARS,
      );
      // Truncation marker visible.
      expect(result[0]!.summary).toMatch(/…$/);
    });

    it('keeps short summaries unchanged (no spurious truncation)', () => {
      const result = projectRecentChanges([
        mkAddConstraint({ label: 'Cost', value: 50000, unit: '£' }),
      ]);
      expect(result[0]!.summary).not.toMatch(/…$/);
    });
  });

  describe('no raw identifiers leak into the projection', () => {
    it('omits constraint_id / node_id / operator strings / provenance', () => {
      const result = projectRecentChanges([
        mkAddConstraint({ label: 'Total cost', value: 50000, unit: '£' }),
      ]);
      const summary = result[0]!.summary;
      expect(summary).not.toMatch(/gc-/i);
      expect(summary).not.toMatch(/constraint_id/i);
      expect(summary).not.toMatch(/node_id/i);
      expect(summary).not.toMatch(/factor_total_cost/);
      expect(summary).not.toMatch(/provenance/i);
      // The user-facing operator phrase is "at most" / "at least" — not
      // the literal `<=` / `>=` characters.
      expect(summary).not.toContain('<=');
      expect(summary).not.toContain('>=');
    });

    it('edge summary omits node ids', () => {
      const result = projectRecentChanges([mkAdjustEdge()]);
      expect(result[0]!.summary).not.toContain('factor_a');
      expect(result[0]!.summary).not.toContain('→');
    });
  });

  describe('target_label', () => {
    it('exposes the constraint label as a structured field on add_constraint mutations', () => {
      const result = projectRecentChanges([
        mkAddConstraint({ label: 'Total cost', value: 50000, unit: '£' }),
      ]);
      expect(result[0]!.target_label).toBe('Total cost');
    });

    it('exposes the factor label as a structured field on set_factor_value mutations', () => {
      const result = projectRecentChanges([
        mkSetFactorValue({
          label: 'Engineering Time Commitment',
          beforeValue: 6,
          afterValue: 9,
          unit: 'months',
        }),
      ]);
      expect(result[0]!.target_label).toBe('Engineering Time Commitment');
    });

    it('falls back to a generic descriptor on edge mutations (no label available)', () => {
      const result = projectRecentChanges([mkAdjustEdge()]);
      expect(result[0]!.target_label).toBe('a link in the decision model');
    });
  });

  describe('mixed inputs', () => {
    it('skips non-mutation facts but preserves order of mutation facts', () => {
      const facts = [
        mkAddConstraint({ label: 'Cost', value: 50000, unit: '£' }),
        mkRunAnalysis(),
        mkSetFactorValue({ label: 'Time', beforeValue: 6, afterValue: 9, unit: 'months' }),
      ];
      const result = projectRecentChanges(facts);
      expect(result).toHaveLength(2);
      expect(result[0]!.action).toBe('constraint_added');
      expect(result[1]!.action).toBe('factor_value_updated');
    });
  });
});

// =========================================================================
// Assembler-level budget proof
// =========================================================================
//
// `projectRecentChanges` enforces a per-projection cap; the tests above
// verify that. This block proves the projection's contribution to the
// FULL ContextPack stays bounded even when the prior_facts array is
// pathologically large. The conversation section's token allocation
// (BUDGET_ALLOCATION.conversation in src/orchestrator/context/budget.ts)
// is ~30% of the 200K context window — recent_changes must be a
// rounding error against that.
describe('recent_changes — assembler-level budget proof', () => {
  // Imports kept inside the describe block to isolate the assembler
  // dependency from the projection-only tests above.
  it('caps recent_changes inside the assembled ContextPack at RECENT_CHANGES_CAP regardless of priorFacts size', async () => {
    const { assembleContextPack } = await import('../context-pack-assembler.js');

    // Build 100 distinct successful add_constraint facts. The
    // projection should slice down to 3.
    const manyFacts: HandlerFact[] = Array.from({ length: 100 }, (_, i) =>
      mkAddConstraint({
        label: `Constraint ${i}`,
        value: 1000 + i,
        unit: '£',
      }),
    );

    const contextPack = assembleContextPack({
      payload: {
        kind: 'message',
        source: 'composer',
        scenario_id: '00000000-0000-4000-8000-000000000000',
        turn_id: 't-budget-1',
        stage: 'analyse',
        turn_class: 'frame',
        message: 'budget probe',
      },
      priorTurns: [],
      priorFacts: manyFacts,
    });

    expect(contextPack.recent_changes).toHaveLength(RECENT_CHANGES_CAP);
    // Each summary still respects the per-entry char cap.
    for (const entry of contextPack.recent_changes) {
      expect(entry.summary.length).toBeLessThanOrEqual(
        RECENT_CHANGES_SUMMARY_MAX_CHARS,
      );
    }
  });

  it("recent_changes' contribution to the ContextPack is bounded (well under the conversation budget)", async () => {
    const { assembleContextPack } = await import('../context-pack-assembler.js');
    const { calculateTokenBudget, estimateTokens } = await import(
      '../../../orchestrator/context/budget.js'
    );

    // 100 facts again — pathological upstream input.
    const manyFacts: HandlerFact[] = Array.from({ length: 100 }, (_, i) =>
      mkAddConstraint({
        label: `Long constraint label ${i} that pads the projection`,
        value: 1000 + i,
        unit: '£',
      }),
    );

    const contextPack = assembleContextPack({
      payload: {
        kind: 'message',
        source: 'composer',
        scenario_id: '00000000-0000-4000-8000-000000000000',
        turn_id: 't-budget-2',
        stage: 'analyse',
        turn_class: 'frame',
        message: 'budget probe',
      },
      priorTurns: [],
      priorFacts: manyFacts,
    });

    // recent_changes contribution alone — must be ≤ a tiny fraction of
    // even the smallest reasonable conversation budget. Hard ceiling
    // chosen at 1 KB (~250 tokens) since 3 entries × 80 chars = 240
    // chars plus JSON overhead is ~400 chars in practice.
    const recentChangesJson = JSON.stringify(contextPack.recent_changes);
    expect(recentChangesJson.length).toBeLessThanOrEqual(1024);
    expect(estimateTokens(recentChangesJson)).toBeLessThanOrEqual(256);

    // And the full ContextPack still fits comfortably below the
    // conversation allocation. The conversation budget is ~30% of the
    // configured context window; with the default 200K window that's
    // ~60K tokens. Even on a very small (32K) configured window the
    // ContextPack with no graph / no analysis stays well under the
    // conversation share — assert against a deliberately tight ceiling
    // so any future growth in the projection is visible.
    const fullJson = JSON.stringify(contextPack);
    const tinyWindowBudget = calculateTokenBudget(32_000);
    expect(estimateTokens(fullJson)).toBeLessThanOrEqual(
      tinyWindowBudget.conversation,
    );
  });
});

describe('computeRecentChangesHash (V5 WS1 / E4)', () => {
  const mutationA: RecentMutation = {
    action: 'constraint_added',
    summary: 'Added constraint: Total cost must be at most £50,000.',
    target_label: 'Total cost',
  };
  const mutationB: RecentMutation = {
    action: 'factor_value_updated',
    summary: 'Updated Confidence from 0.6 to 0.8.',
    target_label: 'Confidence',
  };

  it('returns the empty sentinel when input has no entries', () => {
    expect(computeRecentChangesHash([])).toBe(RECENT_CHANGES_HASH_EMPTY);
  });

  it('returns a 12-char hex string for non-empty input', () => {
    const hash = computeRecentChangesHash([mutationA]);
    expect(hash).toMatch(/^[a-f0-9]{12}$/);
  });

  it('is stable for the same canonical input', () => {
    const a = computeRecentChangesHash([mutationA, mutationB]);
    const b = computeRecentChangesHash([mutationA, mutationB]);
    expect(a).toBe(b);
  });

  it('differs when entries differ', () => {
    expect(computeRecentChangesHash([mutationA])).not.toBe(
      computeRecentChangesHash([mutationB]),
    );
  });

  it('is order-sensitive (newest-first ordering matters)', () => {
    // Order is part of the canonical form — reversing the array yields
    // a different hash. This is intentional: order carries the "most
    // recent" semantics consumers depend on.
    expect(computeRecentChangesHash([mutationA, mutationB])).not.toBe(
      computeRecentChangesHash([mutationB, mutationA]),
    );
  });

  it('does not leak the curated summary content into the hash itself', () => {
    // Hash is deliberately short and one-way; the summary string must
    // not appear in the hex output. This is a smoke check, not a
    // cryptographic claim.
    const hash = computeRecentChangesHash([mutationA]);
    expect(hash).not.toContain('cost');
    expect(hash).not.toContain('£');
    expect(hash).not.toContain('Total');
  });
});

describe('deriveRecentChangesEvidence (V5 WS1 / E4 regression-detection helper)', () => {
  const mutationA: RecentMutation = {
    action: 'constraint_added',
    summary: 'Added constraint: Total cost must be at most £50,000.',
    target_label: 'Total cost',
  };

  it('healthy populated input — field_present true, count matches, hash is 12 hex', () => {
    const evidence = deriveRecentChangesEvidence({ recent_changes: [mutationA] });
    expect(evidence.field_present).toBe(true);
    expect(evidence.count).toBe(1);
    expect(evidence.hash).toMatch(/^[a-f0-9]{12}$/);
  });

  it('healthy empty input — field_present true, count 0, hash is "empty" sentinel', () => {
    const evidence = deriveRecentChangesEvidence({ recent_changes: [] });
    expect(evidence.field_present).toBe(true);
    expect(evidence.count).toBe(0);
    expect(evidence.hash).toBe(RECENT_CHANGES_HASH_EMPTY);
  });

  it('regression — missing field reports field_present false, count 0, empty hash', () => {
    // Future assembler regression that dropped recent_changes from the
    // ContextPack entirely. The helper must tolerate it and surface
    // the regression signal rather than crashing the emit site.
    const evidence = deriveRecentChangesEvidence({});
    expect(evidence.field_present).toBe(false);
    expect(evidence.count).toBe(0);
    expect(evidence.hash).toBe(RECENT_CHANGES_HASH_EMPTY);
  });

  it('regression — null field reports field_present false', () => {
    // Defensive: an assembler that left the field as null rather than
    // an empty array also counts as a regression.
    const evidence = deriveRecentChangesEvidence({ recent_changes: null });
    expect(evidence.field_present).toBe(false);
    expect(evidence.count).toBe(0);
    expect(evidence.hash).toBe(RECENT_CHANGES_HASH_EMPTY);
  });

  it('regression — non-array field (object) reports field_present false', () => {
    // Defensive: an assembler that emitted an object instead of an
    // array also counts as a regression.
    const evidence = deriveRecentChangesEvidence({
      recent_changes: { not: 'an array' },
    });
    expect(evidence.field_present).toBe(false);
    expect(evidence.count).toBe(0);
    expect(evidence.hash).toBe(RECENT_CHANGES_HASH_EMPTY);
  });

  it('regression — string field reports field_present false', () => {
    const evidence = deriveRecentChangesEvidence({
      recent_changes: 'malformed' as unknown,
    });
    expect(evidence.field_present).toBe(false);
    expect(evidence.count).toBe(0);
    expect(evidence.hash).toBe(RECENT_CHANGES_HASH_EMPTY);
  });
});
