/**
 * Cap-doctrine unification (ROADMAP 1.18, analysis-credibility hygiene
 * batch, PR "cap-doctrine unification").
 *
 * Pins that a raw goal-success target scores IDENTICALLY regardless of
 * registration path:
 *   - chat: `resolveGoalThresholdCap` (utils/goal-threshold-cap.ts), the
 *     doctrine sanctioned by the add_constraint handler
 *     (orchestrator-v5/tools/handlers/add-constraint.ts).
 *   - draft: the factor-extraction enricher's goal-threshold redirection
 *     (cee/factor-extraction/enricher.ts, `enrichGraphWithFactorsAsync`),
 *     which now delegates to the SAME function.
 *
 * Before this unification the enricher used a unit-blind next-power-of-10
 * cap (`computeNormalisationCap`) instead — for raw=150 (no unit) that gave
 * cap 1000 -> goal_threshold 0.15, vs the chat-path doctrine's cap 187.5 ->
 * goal_threshold 0.8. Same target, ~5.3x different score.
 */

import { describe, it, expect } from 'vitest';
import { resolveGoalThresholdCap } from '../../src/utils/goal-threshold-cap.js';
import { enrichGraphWithFactorsAsync } from '../../src/cee/factor-extraction/enricher.js';
import type { GraphT } from '../../src/schemas/graph.js';

describe('cap-doctrine unification: resolveGoalThresholdCap (chat-path doctrine)', () => {
  it('applies 25% headroom for a raw absolute target with no existing cap', () => {
    // The exact divergence case: old draft-path cap (next-power-of-10) gave
    // 1000 for raw=150; the doctrine gives 187.5.
    expect(resolveGoalThresholdCap(undefined, 150, undefined, undefined)).toBe(187.5);
  });

  it('normalises a raw percentage target against 100', () => {
    expect(resolveGoalThresholdCap(undefined, 15, '%', undefined)).toBe(100);
  });

  // ⚠ ROADMAP 2.239 — the title of this case read ">= the raw target" until
  // 2026-08-01, mirroring the `>=` in the code. The ASSERTION was never wrong
  // (1000 > 150 strictly, so it passes unchanged) but the title asserted the
  // boundary the fix removed — a trap-14 label that would have gone false and
  // taught the next reader that an equal cap is sanctioned. Title corrected;
  // the equal-cap boundary is pinned in
  // `cee.goal-threshold-degenerate-cap.test.ts`, and the strictly-greater
  // boundary is pinned here so both sides of the new `>` are covered.
  it('reuses a compatible existing cap that is STRICTLY GREATER than the raw target', () => {
    expect(resolveGoalThresholdCap(1000, 150, undefined, undefined)).toBe(1000);
    expect(resolveGoalThresholdCap(151, 150, undefined, undefined)).toBe(151);
  });

  it('ignores an incompatible-unit existing cap and re-derives headroom', () => {
    expect(resolveGoalThresholdCap(1000, 150, '£', undefined)).toBe(187.5);
  });

  it('returns null for a non-positive target', () => {
    expect(resolveGoalThresholdCap(undefined, 0, undefined, undefined)).toBeNull();
    expect(resolveGoalThresholdCap(undefined, -5, undefined, undefined)).toBeNull();
  });
});

describe('cap-doctrine unification: draft path (enricher) matches chat-path doctrine', () => {
  it('scores an identical raw absolute target the same via the draft path as resolveGoalThresholdCap', async () => {
    const graph: GraphT = {
      version: '1',
      default_seed: 42,
      nodes: [
        { id: 'goal_growth', kind: 'goal', label: 'Grow the business' },
        { id: 'decision_1', kind: 'decision', label: 'How to expand' },
      ],
      edges: [],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
    };

    const brief = 'Target 150 customers by Q2.';
    const result = await enrichGraphWithFactorsAsync(graph, brief);
    const goalNode = result.graph.nodes.find((n) => n.id === 'goal_growth');

    expect(goalNode?.goal_threshold_raw).toBe(150);

    // The chat-path doctrine for the SAME raw target/unit/no-existing-cap.
    const chatPathCap = resolveGoalThresholdCap(undefined, 150, undefined, undefined);
    const chatPathThreshold = chatPathCap !== null ? 150 / chatPathCap : undefined;

    expect(goalNode?.goal_threshold_cap).toBe(chatPathCap);
    expect(goalNode?.goal_threshold).toBe(chatPathThreshold);
    // Pin the concrete regression value so a future doctrine change is
    // caught here, not just via the cross-path equality assertion above.
    expect(goalNode?.goal_threshold_cap).toBe(187.5);
    expect(goalNode?.goal_threshold).toBeCloseTo(0.8, 10);
  });

  it('still produces the correct 0.8 order-of-magnitude-coincidence case (raw=800) unchanged', async () => {
    // Regression pin: raw=800 happens to give cap 1000 under BOTH the old
    // (order-of-magnitude) and new (25% headroom) doctrines (800*1.25=1000),
    // so this existing-fixture value is unaffected by the swap.
    const graph: GraphT = {
      version: '1',
      default_seed: 42,
      nodes: [
        { id: 'goal_growth', kind: 'goal', label: 'Grow the business' },
        { id: 'decision_1', kind: 'decision', label: 'How to expand' },
      ],
      edges: [],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
    };

    const result = await enrichGraphWithFactorsAsync(graph, 'Target 800 customers by Q2.');
    const goalNode = result.graph.nodes.find((n) => n.id === 'goal_growth');

    expect(goalNode?.goal_threshold_cap).toBe(1000);
    expect(goalNode?.goal_threshold).toBeCloseTo(0.8, 10);
  });

  it('routes percentage goal-threshold redirection through the doctrine (raw percent, cap 100)', async () => {
    const graph: GraphT = {
      version: '1',
      default_seed: 42,
      nodes: [{ id: 'goal_1', kind: 'goal', label: 'Improve conversion' }],
      edges: [],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: 'assistant' },
    };

    const result = await enrichGraphWithFactorsAsync(graph, 'Target 15% conversion rate.');
    const goalNode = result.graph.nodes.find((n) => n.id === 'goal_1');

    // ROADMAP 1.18 completion: the enricher reconstructs the raw percent
    // number (0.15 fraction -> 15) before delegating, so BOTH paths persist
    // the same raw/cap contract. The scored threshold (0.15) is unchanged.
    if (goalNode?.goal_threshold !== undefined) {
      expect(goalNode.goal_threshold).toBe(0.15);
      expect(goalNode.goal_threshold_raw).toBe(15);
      expect(goalNode.goal_threshold_cap).toBe(100);
    }
  });
});
