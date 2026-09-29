/**
 * ⭐ A LEVEL LIMIT IN "% of <population>" IS A PERCENT — the unit-spelling CLASS after #2057 (DL #70 5851043488).
 *
 * SERVED (`f-20260926T174453Z/01-F1-brief`, fixture verbatim in `tests/fixtures/magnitude/fc-pct-of-level-served.json`):
 * churn spelled "% of Pro subscribers per month" on BOTH the level limit (10) and the node (raw 6, `scale_frame` 100). The
 * limit stayed verbatim, the baseline carry (needs `"%"`) sent nothing, and PLoT refused it (`CONSTRAINT_NOT_CONVERTIBLE`).
 *
 * THE SPEC: the one percent-level rule reads a percent head qualified by its population as that percent on a LEVEL, under
 * the same gates; an "of" limit reads only a node of the SAME population (or a plain percent). Delta, other qualifiers and
 * other populations stay verbatim. Bound by identity: node id, the constraint's unit/provenance, the carried id set.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { admitCandidateConstraints, canonicaliseLimitUnit, percentLevelFrame, type LimitTargetScale } from '../admit-constraint.js';
import { levelLimitBaselineNodeIds } from '../../tools/handlers/level-limit-baseline.js';

type Rec = Record<string, unknown>;
const RUN = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../tests/fixtures/magnitude/fc-pct-of-level-served.json', import.meta.url)), 'utf8'),
) as { goal_node_id: string; graph: { nodes: Rec[]; edges: Rec[]; goal_constraints: Rec[] } };

const UNIT = '% of Pro subscribers per month';
const node = RUN.graph.nodes.find((n) => n.id === 'monthly_churn')!;
const os = node.observed_state as Rec;
const SCALE: LimitTargetScale = { unit: os.unit as string, value: os.value as number, raw_value: os.raw_value as number, scale_frame: node.scale_frame as number };

const admit = (unit = UNIT, frame: 'level' | 'delta' | undefined = 'level', scale = SCALE) =>
  admitCandidateConstraints([{ metric: 'Monthly churn', operator: '<=', value: 10, unit, provenance: 'explicit', frame }],
    () => 'monthly_churn', () => scale).constraints[0];

describe('the unit-spelling class: a LEVEL in "% of <population>" is a percent', () => {
  it('[served 174453Z] the served limit and node are both "% of Pro subscribers per month", node framed on 100', () => {
    expect(RUN.graph.goal_constraints[0]).toMatchObject({ unit: UNIT, value: 10, value_frame: 'level', node_id: 'monthly_churn' });
    expect(SCALE).toEqual({ unit: UNIT, value: 0.06, raw_value: 6, scale_frame: 100 });
  });

  it('[served 174453Z] admission relabels it to "%", value unchanged, provenance stamped', () => {
    const c = admit();
    expect(c.unit).toBe('%');
    expect(c.value).toBe(10);
    expect(c.provenance_unit_relabelled).toEqual({ rule: 'agent_lane_limit_pct_of_level_v1', pre_normalisation_value: 10, pre_normalisation_unit: UNIT });
  });

  it('[served 174453Z] OUTCOME: the admitted limit now carries churn\'s level as the baseline PLoT needs', () => {
    // With the options the run scores (price and the release move churn on links Olumi sized in churn's unit).
    const options = (RUN.graph.nodes as Array<Record<string, unknown>>).filter((n) => n.kind === 'option').map((n) => ({ interventions: n.interventions ?? {} }));
    expect([...levelLimitBaselineNodeIds(RUN.graph, RUN.graph.goal_constraints, RUN.goal_node_id, options)]).toEqual([]);
    expect([...levelLimitBaselineNodeIds(RUN.graph, [admit()], RUN.goal_node_id, options)]).toEqual(['monthly_churn']);
  });

  it('"percent of customers" is the same shape; percentLevelFrame agrees on a level and not on a delta', () => {
    expect(canonicaliseLimitUnit(10, 'percent of customers', { ...SCALE, unit: 'percent of customers' }, 'level').unit).toBe('%');
    expect(percentLevelFrame(10, UNIT, 'level')).toBe(100);
    expect(percentLevelFrame(10, UNIT, 'delta')).toBeUndefined();
  });

  it('contrasts stay verbatim: a delta, another population on the node, "% change vs …", "percentage points of …"', () => {
    expect(admit(UNIT, 'delta').unit).toBe(UNIT);
    expect(admit('% of revenue', 'level').unit).toBe('% of revenue');
    expect(canonicaliseLimitUnit(10, "% change vs this year's costs", SCALE, 'level').unit).toBe("% change vs this year's costs");
    expect(canonicaliseLimitUnit(10, 'percentage points of revenue', SCALE, 'level').unit).toBe('percentage points of revenue');
  });

  // MG #2061 B1 (5851093410): "% of X" can name a reference, not a population; only the node's own spelling proves it.
  it('B1: an "of" limit on a plain-percent or unitless node stays verbatim ("90% of last year\'s churn" is not churn ≤ 90%)', () => {
    const limit = "% of last year's churn";
    expect(canonicaliseLimitUnit(90, limit, { unit: '% per month', value: 0.07, raw_value: 7, scale_frame: 100 }, 'level').unit).toBe(limit);
    expect(canonicaliseLimitUnit(90, limit, { value: 0.07 }, 'level').unit).toBe(limit);
  });

  it('provability gate holds: a node not framed on 100 keeps the limit verbatim', () => {
    expect(admit(UNIT, 'level', { ...SCALE, scale_frame: 20 }).unit).toBe(UNIT);
  });
});
