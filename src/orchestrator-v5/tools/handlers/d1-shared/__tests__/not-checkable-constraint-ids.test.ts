/**
 * ⭐ THE SPEAKABLE VERDICT, COLLECTED OVER A WHOLE GRAPH.
 *
 * `collectNotCheckableConstraintIds` is the read-later-turns companion to the
 * write-time `classifyConstraintWriteAdmissibility`: same verdict function,
 * same goal exemption, applied to every row in `goal_constraints` instead of to
 * the one row being written.
 *
 * ⚠ IT IS NOT A TWIN OF `collectUnmeasuredConstraintTargetIds`, AND THE
 * DIFFERENCE IS THE POINT (CLAUDE.md trap 21 — two authorities, two questions).
 * That one RELAXES a withholding and deliberately has NO goal exemption, so a
 * false `true` there costs at most a withholding it would have made anyway.
 * This one SPEAKS, so a goal target must be exempted: PLoT skips PU injection
 * for the goal node with reason `goal_node` precisely because ISL computes that
 * node's outcome distribution and the constraint IS evaluated against it.
 * Telling a user their perfectly good limit will be ignored is the one error
 * this must never make.
 */
import { describe, expect, it } from 'vitest';

import { collectNotCheckableConstraintIds } from '../constraint-write-admissibility.js';

const CHURN_NODE = 'risk_churn';
const COST_NODE = 'f_support_cost';
const GOAL_NODE = 'goal_margin';
const DATA_ONLY_NODE = 'f_legacy_data_carrier';

const GRAPH = {
  nodes: [
    // Records NOTHING — the measured 44e349fa shape: kind `risk`, every
    // quantity field null.
    { id: CHURN_NODE, kind: 'risk', label: 'Subscriber Churn Rate' },
    // Records a number.
    {
      id: COST_NODE,
      kind: 'factor',
      label: 'Support cost',
      observed_state: { value: 180000, unit: '£' },
    },
    // The goal. Carries no quantity, and is STILL checkable.
    { id: GOAL_NODE, kind: 'goal', label: 'Protect operating margin' },
    // ⚠ The V1 quantity carrier. `NodeV3` is a plain `z.object` and STRIPS
    // `data`, so a parsed node would read this as carrying nothing. The
    // ingress schema is `.passthrough()`, which is why this collector must be
    // handed the RAW selected graph.
    { id: DATA_ONLY_NODE, kind: 'factor', label: 'Legacy carrier', data: { value: 3 } },
  ],
  edges: [],
};

function constraint(id: string, nodeId: string): Record<string, unknown> {
  return { constraint_id: id, node_id: nodeId, operator: '<=', value: 1 };
}

describe('collectNotCheckableConstraintIds', () => {
  it('names the constraint whose target records no value', () => {
    const out = collectNotCheckableConstraintIds(
      [constraint('c_churn', CHURN_NODE)],
      GRAPH,
    );
    expect([...out]).toEqual(['c_churn']);
  });

  it('stays silent about a target that records a value', () => {
    const out = collectNotCheckableConstraintIds([constraint('c_cost', COST_NODE)], GRAPH);
    expect([...out]).toEqual([]);
  });

  it('exempts a goal target — ISL computes its distribution, so the limit IS evaluated', () => {
    const out = collectNotCheckableConstraintIds([constraint('c_goal', GOAL_NODE)], GRAPH);
    expect([...out]).toEqual([]);
  });

  it('stays silent about a `data`-only node — the raw carrier NodeV3 would strip', () => {
    const out = collectNotCheckableConstraintIds(
      [constraint('c_legacy', DATA_ONLY_NODE)],
      GRAPH,
    );
    expect([...out]).toEqual([]);
  });

  it('discriminates within one call', () => {
    // ⭐ The arm a stamp-everything and a stamp-nothing implementation both
    // fail. Neither of the single-row arms above can do this alone.
    const out = collectNotCheckableConstraintIds(
      [
        constraint('c_churn', CHURN_NODE),
        constraint('c_cost', COST_NODE),
        constraint('c_goal', GOAL_NODE),
      ],
      GRAPH,
    );
    expect([...out].sort()).toEqual(['c_churn']);
  });

  it('accepts the graph-shaped constraints source as well as the bare array', () => {
    const out = collectNotCheckableConstraintIds(
      { goal_constraints: [constraint('c_churn', CHURN_NODE)] },
      GRAPH,
    );
    expect([...out]).toEqual(['c_churn']);
  });

  describe('a sweep that could not look returns nothing, never a clean zero dressed as a verdict', () => {
    it('no graph', () => {
      expect([...collectNotCheckableConstraintIds([constraint('c_churn', CHURN_NODE)], null)])
        .toEqual([]);
    });

    it('no nodes array', () => {
      expect([
        ...collectNotCheckableConstraintIds([constraint('c_churn', CHURN_NODE)], { nodes: 'x' }),
      ]).toEqual([]);
    });

    it('no constraints', () => {
      expect([...collectNotCheckableConstraintIds(null, GRAPH)]).toEqual([]);
      expect([...collectNotCheckableConstraintIds([], GRAPH)]).toEqual([]);
    });

    it('a target the graph does not contain — we could not look, so we say nothing', () => {
      // Same rule as `collectUnmeasuredConstraintTargetIds`: an absent node is
      // not an unmeasured node.
      expect([
        ...collectNotCheckableConstraintIds([constraint('c_ghost', 'no_such_node')], GRAPH),
      ]).toEqual([]);
    });

    it('rows missing an id of either kind are skipped, not guessed at', () => {
      expect([
        ...collectNotCheckableConstraintIds(
          [
            { node_id: CHURN_NODE, operator: '<=', value: 1 },
            { constraint_id: 'c_no_node', operator: '<=', value: 1 },
            null,
            'not an object',
          ],
          GRAPH,
        ),
      ]).toEqual([]);
    });
  });
});
