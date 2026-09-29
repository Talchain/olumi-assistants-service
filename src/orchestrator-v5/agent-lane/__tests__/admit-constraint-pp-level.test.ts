/**
 * ⭐ A LEVEL LIMIT IN PERCENTAGE POINTS IS A PERCENT — Gate A F-C, joined run 2 (DL #70 5850702248, verdict 5850714093).
 *
 * SERVED (CEE f4596ca, `f-20260926T225444Z/01-F1-brief`, fixture verbatim in `tests/fixtures/magnitude/fc-pp-level-served.json`):
 * the drafter wrote churn in "percentage points" on BOTH the level limit (10) and the node (raw 7, `scale_frame` 100).
 * `canonicaliseLimitUnit` kept the limit verbatim, so the level-limit baseline carry (which needs `"%"`) sent nothing and
 * PLoT refused the level frame (`CONSTRAINT_NOT_CONVERTIBLE`: no `observed_state.baseline`): 0/3 decision-grade. Run 1
 * (`225029Z`, same brief) drafted "percent per month", was relabelled to `"%"`, and scored 4/4.
 *
 * THE SPEC: a limit framed `level` in a percentage-points spelling is that percent, under exactly the gates the percent
 * rung already applies (1 ≤ |v| ≤ 100; the node's level is the percentage ÷ 100). A delta, or an unframed limit, keeps
 * the spelling verbatim. Bound by identity: the node id, the constraint's unit/value/provenance, the carried id set.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  admitCandidateConstraints,
  canonicaliseLimitUnit,
  percentLevelFrame,
  type CandidateConstraint,
  type LimitTargetScale,
} from '../admit-constraint.js';
import { levelLimitBaselineNodeIds } from '../../tools/handlers/level-limit-baseline.js';

type Rec = Record<string, unknown>;
interface Run { goal_node_id: string; graph: { nodes: Rec[]; edges: Rec[]; goal_constraints: Rec[] } }

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../tests/fixtures/magnitude/fc-pp-level-served.json', import.meta.url)), 'utf8'),
) as { runs: Record<string, Run> };
const RUN2 = FIXTURE.runs.run2_225444Z;
const RUN1 = FIXTURE.runs.run1_225029Z;

/** The node's scale as admission reads it: its `observed_state` plus its `scale_frame`. */
function scaleOf(run: Run, id: string): LimitTargetScale {
  const n = run.graph.nodes.find((x) => x.id === id)!;
  const os = n.observed_state as Rec;
  return {
    unit: os.unit as string,
    value: os.value as number,
    raw_value: os.raw_value as number,
    scale_frame: n.scale_frame as number,
  };
}

/** The served limit as the drafter stated it (the verbatim row carries no relabel, so it IS the candidate). */
function candidateFrom(run: Run, over: Partial<CandidateConstraint> = {}): CandidateConstraint {
  const c = run.graph.goal_constraints[0];
  const pre = (c.provenance_unit_relabelled as Rec | undefined);
  return {
    metric: c.label as string,
    operator: c.operator as '<=',
    value: (pre?.pre_normalisation_value as number | undefined) ?? (c.value as number),
    unit: (pre?.pre_normalisation_unit as string | undefined) ?? (c.unit as string),
    provenance: 'explicit',
    frame: c.value_frame as 'level',
    ...over,
  };
}

function admit(run: Run, over: Partial<CandidateConstraint> = {}, scale: LimitTargetScale = scaleOf(run, 'monthly_churn')) {
  return admitCandidateConstraints([candidateFrom(run, over)], () => 'monthly_churn', () => scale).constraints[0];
}

describe('F-C: a LEVEL limit in percentage points is a percent', () => {
  it('[served run 2] the served limit was verbatim "percentage points" and the node is framed on 100', () => {
    expect(RUN2.graph.goal_constraints[0]).toMatchObject({ unit: 'percentage points', value: 10, value_frame: 'level', node_id: 'monthly_churn' });
    expect(scaleOf(RUN2, 'monthly_churn')).toEqual({ unit: 'percentage points', value: 0.07, raw_value: 7, scale_frame: 100 });
  });

  it('[served run 2] admission relabels it to "%", value unchanged, with the pp-level provenance stamped', () => {
    const c = admit(RUN2);
    expect(c.node_id).toBe('monthly_churn');
    expect(c.unit).toBe('%');
    expect(c.value).toBe(10);
    expect(c.value_frame).toBe('level');
    expect(c.provenance_unit_relabelled).toEqual({
      rule: 'agent_lane_limit_pp_level_v1', pre_normalisation_value: 10, pre_normalisation_unit: 'percentage points',
    });
  });

  it('[served run 2] OUTCOME (the scale proof, no option in play): the admitted limit carries churn\'s current level', () => {
    const served = levelLimitBaselineNodeIds(RUN2.graph, RUN2.graph.goal_constraints, RUN2.goal_node_id, []);
    expect([...served]).toEqual([]);
    const admitted = levelLimitBaselineNodeIds(RUN2.graph, [admit(RUN2)], RUN2.goal_node_id, []);
    expect([...admitted]).toEqual(['monthly_churn']);
  });

  it('[served run 2] R-c (AI Quality 5882087383): with the run\'s options it carries NOTHING — price also reaches churn through the unsized risk node', () => {
    const options = (RUN2.graph.nodes as Array<Record<string, unknown>>).filter((n) => n.kind === 'option').map((n) => ({ interventions: n.interventions ?? {} }));
    const unsized = (RUN2.graph.edges as Array<Record<string, any>>).filter((e) => e.to === 'monthly_churn' && e.provenance?.magnitude === undefined).map((e) => e.from);
    expect(unsized).toContain('price_sensitivity_risk');
    expect([...levelLimitBaselineNodeIds(RUN2.graph, [admit(RUN2)], RUN2.goal_node_id, options)]).toEqual([]);
  });

  it('[served run 1] contrast: "percent per month" is relabelled exactly as it was served', () => {
    const c = admit(RUN1);
    expect(c.unit).toBe(RUN1.graph.goal_constraints[0].unit);
    expect(c.provenance_unit_relabelled).toEqual(RUN1.graph.goal_constraints[0].provenance_unit_relabelled);
    expect(c.provenance_unit_relabelled?.rule).toBe('agent_lane_limit_unit_v1');
  });

  it('contrast: a DELTA in percentage points is a change, kept verbatim', () => {
    const c = admit(RUN2, { frame: 'delta' });
    expect(c.unit).toBe('percentage points');
    expect(c.provenance_unit_relabelled).toBeUndefined();
    // R1 S4-core: the pre-R1 drafter's `delta` ("a CHANGE from today") is written as `change_abs` (limit-frame.ts).
    expect(c.value_frame).toBe('change_abs');
  });

  it('contrast: an UNFRAMED limit in percentage points is kept verbatim', () => {
    const c = admit(RUN2, { frame: undefined });
    expect(c.unit).toBe('percentage points');
    expect(c.provenance_unit_relabelled).toBeUndefined();
  });

  it('provability gate holds: a node not framed on 100 keeps the limit verbatim', () => {
    const c = admit(RUN2, {}, { ...scaleOf(RUN2, 'monthly_churn'), scale_frame: 20 });
    expect(c.unit).toBe('percentage points');
    expect(c.provenance_unit_relabelled).toBeUndefined();
  });

  it('value gate holds: a level below 1 point abstains (PLoT reads "%" below 1 as a fraction)', () => {
    expect(canonicaliseLimitUnit(0.5, 'percentage points', scaleOf(RUN2, 'monthly_churn'), 'level')).toEqual({ value: 0.5, unit: 'percentage points' });
  });

  it('the classifier\'s own "pp" row is read the same way; "ppm" (parts per million) is not points', () => {
    expect(canonicaliseLimitUnit(10, 'pp', scaleOf(RUN2, 'monthly_churn'), 'level').unit).toBe('%');
    expect(canonicaliseLimitUnit(10, 'pp per month', scaleOf(RUN2, 'monthly_churn'), 'level').unit).toBe('%');
    expect(canonicaliseLimitUnit(10, 'ppm', scaleOf(RUN2, 'monthly_churn'), 'level').unit).toBe('ppm');
  });

  // MG's review probe (CEE #2057, 5850936126), pinned here so a later loosening of the tail is caught.
  it('a points spelling with a non-period tail stays verbatim on a LEVEL; a period tail is a percent', () => {
    const s = scaleOf(RUN2, 'monthly_churn');
    expect(canonicaliseLimitUnit(10, 'percentage points of revenue', s, 'level').unit).toBe('percentage points of revenue');
    expect(canonicaliseLimitUnit(10, 'pp change', s, 'level').unit).toBe('pp change');
    expect(canonicaliseLimitUnit(10, 'percentage points per month', s, 'level').unit).toBe('%');
  });

  it('percentLevelFrame is the same rule: a level in points pins 100, a delta does not', () => {
    expect(percentLevelFrame(10, 'percentage points', 'level')).toBe(100);
    expect(percentLevelFrame(10, 'pp', 'level')).toBe(100);
    expect(percentLevelFrame(10, 'percentage points', 'delta')).toBeUndefined();
    expect(percentLevelFrame(10, 'percentage points')).toBeUndefined();
    expect(percentLevelFrame(10, 'percent per month')).toBe(100);
  });
});
