/**
 * ⭐⭐ A PERCENTAGE THE USER SETS ON THE OP PATH MUST STILL BE ANALYSABLE.
 *
 * ── THE DEFECT, REPRODUCED LIVE (2026-09-02, CEE `3575b18` / UI `05ca160b`) ──
 * A fresh guest model refused every analysis attempt with, verbatim on screen:
 *
 *   "I can't run this analysis safely. Sales say the product is too shallow
 *    for the enterprise deals we're now chasing is recorded as a bare amount
 *    with no range for me to measure it against ... Telling me the same amount
 *    again won't clear it; ask me to run it again after any change and I'll
 *    re-check."
 *
 * The named factor's PERSISTED record, read out of the deployed session:
 *
 *   83c01b53  { value: 40, unit: '%', source: 'user_override' }   display "40%"
 *
 * — no `raw_value`. Its FOUR sibling percent factors in the same graph all
 * carried `{ value: 0.x, unit: '%', raw_value: x0 }`. That 4-to-1 split in one
 * live graph is the contrast control: the convention is `value` = the analysis
 * level, `raw_value` = the user's magnitude, and this one record has the raw
 * magnitude sitting in the LEVEL slot.
 *
 * ── WHICH AUTHORITY IS WRONG, AND WHY IT IS NOT THE GATE ───────────────────
 * The analysis seam's baseline gate (`findScaleIncoherentBaselineFactorIds`)
 * refuses it, and it is RIGHT to: CEE's own percent-inversion authority
 * `resolveExistingRawValue` independently classifies `{value: 40, unit: '%'}`
 * as `ambiguous` — "a `%` value OUTSIDE [0,1] ... is genuinely ambiguous →
 * fail closed". Two independent readers agree the RECORD is incoherent. The
 * gate is not loosened here and is not touched.
 *
 * The first failure is the WRITER. `normaliseFactorValue` — the V5
 * `set_factor_value` writer — given the same "40%" writes `{value: 0.4,
 * raw_value: 40}` through `unitPinnedScaleFrame`. `canonicaliseValueOps` — the
 * V4/op writer — returned the op UNTOUCHED, persisting `{value: 40}`. Two
 * writers, one input, two different answers: the twins defect (trap 12), and
 * the fix is to make the second consult the SAME authority as the first, not
 * to hold a new opinion about frames.
 *
 * ── WHY `unitPinnedScaleFrame` AND NOTHING ELSE ────────────────────────────
 * It returns a CONSTANT that is a function of the UNIT ALONE (percent → 100,
 * basis points → 10,000) and abstains everywhere else, so it can never hand
 * back a laddered, sibling-dependent number and can never silently rescale a
 * sibling intervention. Critically it abstains ABOVE 100 — which is exactly
 * the class a prior lane fought to keep refusing (NRR 115%, ROI 300% frame at
 * 200/500, where a hard-coded 100 is a 2-5x error). That exclusion is
 * PRESERVED here by the authority itself, not by a second guard that could
 * drift from it.
 *
 * ── THE MATRIX IS THE POINT: EXACTLY ONE CELL MOVES ────────────────────────
 * Measured at pristine, all five cells; only the first changes.
 *
 *   payload -> % factor, 40    BLOCKS  ->  computes   ← the defect
 *   payload -> % factor, 150   BLOCKS  ->  BLOCKS     ← above the pinned bound
 *   payload -> % factor, 0.4   computes -> computes   ← already a level
 *   payload -> £ factor, 40    BLOCKS  ->  BLOCKS     ← the currency lie stays shut
 *   payload -> unitless, 40    BLOCKS  ->  BLOCKS     ← no stated scale
 *
 * ── BINDING (trap 19) ─────────────────────────────────────────────────────
 * `fac_decoy` carries `{value: 0.4, raw_value: 40, unit: '%'}` — the SAME
 * magnitudes as the target's expected post-fix pair — so no value predicate
 * can tell target from decoy. Every assertion names `fac_share` by id, and the
 * preconditions are pinned in-test so a fixture that stopped exercising the
 * canonicaliser could not make this agree for the wrong reason (trap 13b).
 */
import { describe, it, expect, vi } from 'vitest';

import {
  canonicaliseValueOps,
  stampUserEditProvenance,
  reconcileObservedValuePair,
} from '../../canonicalise-value-ops.js';
import {
  findScaleIncoherentBaselineFactorIds,
  decideAnalysisScaleBlock,
} from '../../../orchestrator-v5/tools/plot-intervention-scale.js';
import { handleEditGraph } from '../edit-graph.js';
import type { PatchOperation } from '../../types.js';
import type { ConversationContext } from '../../types.js';
import type { LLMAdapter } from '../../../adapters/llm/types.js';

const TARGET = 'fac_share';
const DECOY = 'fac_decoy';

function buildGraph(unit: string | undefined): unknown {
  return {
    nodes: [
      {
        id: TARGET,
        kind: 'factor',
        label: 'Share of deals the product is too shallow for',
        observed_state: unit !== undefined ? { unit } : {},
      },
      {
        // Same magnitudes as the target's expected post-fix pair.
        id: DECOY,
        kind: 'factor',
        label: 'Decoy',
        observed_state: { value: 0.4, raw_value: 40, unit: '%' },
      },
    ],
  };
}

/** The post-`normalisePath` op spelling the handler feeds the canonicaliser. */
function leafPatch(nodeId: string, to: unknown): PatchOperation {
  return {
    op: 'update_node',
    path: nodeId,
    value: { 'data/value': to },
  } as unknown as PatchOperation;
}

/** EXACTLY the composition both apply seams run (edit-graph.ts, gm-held-execute.ts). */
function walk(to: unknown, unit: string | undefined) {
  const graph = buildGraph(unit) as { nodes: Record<string, unknown>[] };
  const ops = [leafPatch(TARGET, to)];
  const applied = reconcileObservedValuePair(
    stampUserEditProvenance(canonicaliseValueOps(ops, graph).operations, ops),
    graph,
  );
  const written =
    ((applied[0]!.value as Record<string, unknown>).observed_state as Record<string, unknown>) ?? {};
  // Persist exactly as the applier would: the write merges onto the node.
  const persistedTarget = {
    ...graph.nodes[0],
    observed_state: {
      ...(graph.nodes[0]!.observed_state as Record<string, unknown>),
      ...written,
    },
  };
  const blockedIds = findScaleIncoherentBaselineFactorIds([persistedTarget, graph.nodes[1]], []);
  return {
    written,
    blockedIds,
    verdict: decideAnalysisScaleBlock(
      { mixedUnresolved: false, unresolvedFactorIds: [] },
      blockedIds,
    ),
  };
}

describe('a percentage set through the op path survives to the analysis seam', () => {
  it('⭐ 40 on a % factor is recorded as the LEVEL 0.4 beside raw 40, and the analysis runs', () => {
    const out = walk(40, '%');

    // ── PRECONDITION PINNED IN-TEST (trap 13b) ────────────────────────────
    // The verdict below is only about this fix if the canonicaliser really
    // produced a write for this op. A fixture that silently stopped
    // exercising it would leave `written` empty and make everything agree.
    expect(Object.keys(out.written).length).toBeGreaterThan(0);
    expect(out.written.source).toBe('user_override');

    // The record the estate's other writer (`normaliseFactorValue`) already
    // produces for the same input, and the shape all four live siblings hold.
    expect(out.written.value).toBeCloseTo(0.4, 12);
    expect(out.written.raw_value).toBe(40);
    expect(out.written.unit).toBe('%');

    // Bound by IDENTITY: the decoy carries the same magnitudes.
    expect(out.blockedIds).not.toContain(TARGET);
    expect(out.blockedIds).not.toContain(DECOY);
    expect(out.verdict).toEqual({ blocked: false });
  });

  it('150 on a % factor is ABOVE the pinned bound — still refused, loudly (the 2-5x class)', () => {
    const out = walk(150, '%');
    expect(out.written.value).toBe(150);
    expect(out.written.raw_value).toBeUndefined();
    expect(out.verdict).toEqual({
      blocked: true,
      reason_code: 'baseline_scale_unresolved',
      unresolvedFactorIds: [TARGET],
    });
  });

  it('0.4 on a % factor is ALREADY a level — untouched, and it computed before and after', () => {
    const out = walk(0.4, '%');
    expect(out.written.value).toBe(0.4);
    expect(out.blockedIds).not.toContain(TARGET);
    expect(out.verdict).toEqual({ blocked: false });
  });

  it('40 on a CURRENCY factor pins no divisor — still refused (closing the percent gap must not open the currency lie)', () => {
    const out = walk(40, '£');
    expect(out.written.value).toBe(40);
    expect(out.written.raw_value).toBeUndefined();
    expect(out.verdict).toEqual({
      blocked: true,
      reason_code: 'baseline_scale_unresolved',
      unresolvedFactorIds: [TARGET],
    });
  });

  it('40 on a factor with NO stated unit states no scale — still refused', () => {
    const out = walk(40, undefined);
    expect(out.written.value).toBe(40);
    expect(out.written.raw_value).toBeUndefined();
    expect(out.verdict).toEqual({
      blocked: true,
      reason_code: 'baseline_scale_unresolved',
      unresolvedFactorIds: [TARGET],
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ⭐⭐ THE SEQUENCE, THROUGH THE REAL SEAM — the case the rest of this file was
// STRUCTURALLY UNABLE TO CONTAIN.
//
// Every case above builds a FRESH graph, so every fixture starts with no
// `raw_value` — which was exactly the first version of the fix's precondition.
// A corpus that shares the code's asymmetry cannot see the code's defect
// (CLAUDE.md trap 13d), and this one could not: the first version's own
// successful write ADDS `raw_value`, so the NEXT edit on that same factor was
// excluded by that very conjunct, fell through to `resolveExistingRawValue`,
// resolved `ambiguous`, deleted `raw_value` — and left the raw magnitude in
// the level slot. The witnessed P0 record, re-created by its own fix, on every
// second edit. Measured: 40 -> COMPUTES, 55 -> BLOCKED, 60 -> COMPUTES.
//
// The predicate is now about whether the INCOMING VALUE needs re-framing —
// a function of (unit, newValue) alone — so it is idempotent across repeated
// edits by construction rather than by a second patch to the conjunct.
// ────────────────────────────────────────────────────────────────────────────

function buildSeqGraph(): Record<string, unknown> {
  return {
    nodes: [
      { id: 'dec_x', kind: 'decision', label: 'Budget' },
      { id: 'opt_a', kind: 'option', label: 'Push enterprise' },
      {
        id: 'fac_share',
        kind: 'factor',
        label: 'Share of deals the product is too shallow for',
        display_value: '20%',
        observed_state: { value: 20, unit: '%' },
      },
      { id: 'goal_g', kind: 'goal', label: 'Net revenue retention' },
    ],
    edges: [
      { from: 'dec_x', to: 'opt_a', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_a', to: 'fac_share', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'fac_share', to: 'goal_g', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    ],
  };
}

function seqAdapter(to: number, from: number): LLMAdapter {
  return {
    name: 'fixtures',
    model: 'test-model',
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        operations: [
          {
            op: 'update_node',
            path: `/nodes/${TARGET}/data/value`,
            value: to,
            old_value: from,
            impact: 'moderate',
            rationale: 'User set the value.',
          },
        ],
        removed_edges: [],
        warnings: [],
      }),
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      model: 'test-model',
      latencyMs: 1,
      stopReason: 'end_turn',
    }),
  } as unknown as LLMAdapter;
}

describe('the SAME factor edited repeatedly stays analysable after EVERY edit', () => {
  it('⭐ 20% -> 40 -> 55 -> 60 through handleEditGraph: coherent and computable at each step', async () => {
    let graph = buildSeqGraph();

    // PRECONDITION PINNED IN-TEST: the fixture really does start in the
    // witnessed P0 shape (raw magnitude in the level slot, no pair).
    const pre = (graph.nodes as Record<string, unknown>[]).find((n) => n.id === TARGET)!;
    expect((pre.observed_state as Record<string, unknown>).value).toBe(20);
    expect((pre.observed_state as Record<string, unknown>).raw_value).toBeUndefined();

    const steps: Array<{ to: number; from: number }> = [
      { to: 40, from: 20 },
      { to: 55, from: 40 },
      { to: 60, from: 55 },
    ];

    for (const step of steps) {
      const result = await handleEditGraph(
        { graph, analysis_response: null, framing: null, messages: [], scenario_id: 'scn-seq' } as unknown as ConversationContext,
        `Change it to ${step.to}`,
        seqAdapter(step.to, step.from),
        `req-seq-${step.to}`,
        `turn-seq-${step.to}`,
      );

      expect(result.wasRejected, `edit -> ${step.to} was rejected`).toBe(false);
      expect(result.appliedGraph, `edit -> ${step.to} produced no graph`).not.toBeNull();

      graph = result.appliedGraph as Record<string, unknown>;
      const nodes = graph.nodes as Record<string, unknown>[];
      // IDENTITY BINDING: by id, never by a value predicate.
      const edited = nodes.find((n) => n.id === TARGET)!;
      const obs = edited.observed_state as Record<string, unknown>;

      // The record is on the analysis scale after EVERY edit — this is the
      // assertion the alternation defect failed on the SECOND iteration.
      expect(obs.value, `after edit -> ${step.to}, value`).toBeCloseTo(step.to / 100, 12);
      expect(obs.raw_value, `after edit -> ${step.to}, raw_value`).toBe(step.to);

      // And the analysis seam admits it after EVERY edit.
      const blockedIds = findScaleIncoherentBaselineFactorIds(nodes, []);
      expect(blockedIds, `after edit -> ${step.to}, gate`).not.toContain(TARGET);
      expect(
        decideAnalysisScaleBlock({ mixedUnresolved: false, unresolvedFactorIds: [] }, blockedIds),
      ).toEqual({ blocked: false });
    }
  });
});
