/**
 * Capability 2A — conservative add-risk rejection classifier tests.
 *
 * Drives the REAL `validateGraphStructure` for the realistic shapes and
 * hand-crafts violations only to exercise the gates. Proves the classifier
 * fires for the unsupported add-risk / reachability shape and stays silent for
 * every other rejection (generic invalid graph, orphan non-risk, cycle, limits,
 * properly-hosted risk, mixed codes).
 */

import { describe, expect, it } from 'vitest';

import type { GraphV3T } from '../../schemas/cee-v3.js';
import {
  validateGraphStructure,
  type StructuralViolation,
} from '../graph-structure-validator.js';
import {
  classifyAddRiskToOptionRejection,
  ADD_RISK_REJECTION_GUIDANCE_PLACEHOLDER,
} from '../add-risk-rejection-guidance.js';

const n = (id: string, kind: string, label: string) => ({ id, kind, label });
const e = (from: string, to: string) => ({
  from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const,
});

const BASE_NODES = [
  n('dec_1', 'decision', 'Hiring decision'),
  n('goal_q3', 'goal', 'Q3 launch'),
  n('fac_capacity', 'factor', 'Technical Leadership Capacity'),
  n('fac_velocity', 'factor', 'Feature Delivery Velocity'),
  n('opt_hire', 'option', 'Hire One Tech Lead'),
  n('opt_hold', 'option', 'Hold'),
];
const BASE_EDGES = [
  e('dec_1', 'opt_hire'), e('dec_1', 'opt_hold'),
  e('opt_hire', 'fac_capacity'), e('opt_hold', 'fac_capacity'),
  e('fac_capacity', 'fac_velocity'), e('fac_velocity', 'goal_q3'),
];
const RISK = n('risk_resent', 'risk', 'Team resents new tech lead');

const g = (nodes: ReturnType<typeof n>[], edges: ReturnType<typeof e>[]): GraphV3T =>
  ({ nodes, edges } as unknown as GraphV3T);

/** Run the real validator and return only its violations. */
function violationsFor(graph: GraphV3T): StructuralViolation[] {
  return validateGraphStructure(graph).violations;
}

describe('classifyAddRiskToOptionRejection — conservative', () => {
  it('POSITIVE: risk wired only to an option (NO_PATH_TO_GOAL) → matches', () => {
    const graph = g([...BASE_NODES, RISK], [...BASE_EDGES, e('risk_resent', 'opt_hire')]);
    const v = violationsFor(graph);
    expect(v.map((x) => x.code)).toEqual(['NO_PATH_TO_GOAL']);
    const m = classifyAddRiskToOptionRejection(graph, v);
    expect(m).not.toBeNull();
    expect(m!.risk_labels).toContain('Team resents new tech lead');
    expect(m!.example_factor_labels.length).toBeGreaterThan(0); // reachable factors offered as examples
  });

  it('POSITIVE: orphan risk (ORPHAN_NODE) → matches', () => {
    const graph = g([...BASE_NODES, RISK], [...BASE_EDGES]);
    const v = violationsFor(graph);
    expect(v.map((x) => x.code)).toEqual(['ORPHAN_NODE']);
    expect(classifyAddRiskToOptionRejection(graph, v)).not.toBeNull();
  });

  it('NEGATIVE: generic invalid graph (NO_GOAL) → null', () => {
    const noGoal = g(BASE_NODES.filter((x) => x.kind !== 'goal'), BASE_EDGES.filter((x) => x.to !== 'goal_q3'));
    const v = violationsFor(noGoal);
    expect(v.some((x) => x.code === 'NO_GOAL')).toBe(true);
    expect(classifyAddRiskToOptionRejection(noGoal, v)).toBeNull();
  });

  it('NEGATIVE: cycle (CYCLE_DETECTED) → null', () => {
    const graph = g([...BASE_NODES], [...BASE_EDGES, e('goal_q3', 'fac_capacity')]); // goal→factor closes a cycle
    const v = violationsFor(graph);
    expect(v.some((x) => x.code === 'CYCLE_DETECTED')).toBe(true);
    expect(classifyAddRiskToOptionRejection(graph, v)).toBeNull();
  });

  it('NEGATIVE: orphan NON-risk node (factor) → null (gate 2)', () => {
    const orphanFactor = n('fac_orphan', 'factor', 'Unconnected factor');
    const graph = g([...BASE_NODES, orphanFactor], [...BASE_EDGES]);
    const v = violationsFor(graph);
    expect(v.map((x) => x.code)).toEqual(['ORPHAN_NODE']);
    expect(v[0]!.detail).toContain('fac_orphan');
    expect(classifyAddRiskToOptionRejection(graph, v)).toBeNull();
  });

  it('NEGATIVE: mixed codes (reachability + a non-reachability code) → null (gate 1)', () => {
    const graph = g([...BASE_NODES, RISK], [...BASE_EDGES, e('risk_resent', 'opt_hire')]);
    const real = violationsFor(graph); // [NO_PATH_TO_GOAL]
    const mixed: StructuralViolation[] = [...real, { code: 'NODE_LIMIT_EXCEEDED', detail: '21 nodes exceeds limit of 20' }];
    expect(classifyAddRiskToOptionRejection(graph, mixed)).toBeNull();
  });

  it('NEGATIVE: risk already hosted by a factor → null (gate 2, hand-crafted violation)', () => {
    // factor → risk inbound exists; a synthetic reachability violation naming it
    // must still NOT match because the risk is already connected through a factor.
    const graph = g([...BASE_NODES, RISK], [...BASE_EDGES, e('fac_velocity', 'risk_resent')]);
    const synthetic: StructuralViolation[] = [
      { code: 'NO_PATH_TO_GOAL', detail: 'Node "risk_resent" (Team resents new tech lead) not reachable from decision via directed paths' },
    ];
    expect(classifyAddRiskToOptionRejection(graph, synthetic)).toBeNull();
  });

  it('NEGATIVE: empty violations → null', () => {
    const graph = g([...BASE_NODES, RISK], [...BASE_EDGES, e('risk_resent', 'opt_hire')]);
    expect(classifyAddRiskToOptionRejection(graph, [])).toBeNull();
  });

  it('operations gate + observability: add/wire the risk → match; absent → match (fallback); add_node risk → added_new_risk true', () => {
    const graph = g([...BASE_NODES, RISK], [...BASE_EDGES, e('risk_resent', 'opt_hire')]);
    const v = violationsFor(graph);
    // absent → fallback match, added_new_risk null
    expect(classifyAddRiskToOptionRejection(graph, v)!.added_new_risk).toBeNull();
    // add_node of the risk → match, added_new_risk true
    expect(classifyAddRiskToOptionRejection(graph, v, [{ op: 'add_node', value: { kind: 'risk', id: 'risk_resent', label: 'r' } }])!.added_new_risk).toBe(true);
    // add_edge touching the risk (no add_node) → match, added_new_risk false
    expect(classifyAddRiskToOptionRejection(graph, v, [{ op: 'add_edge', value: { from: 'risk_resent', to: 'opt_hire' } }])!.added_new_risk).toBe(false);
  });

  // ── Adversarial false-positive probes (review-requested) ──────────────────
  it('ADVERSARIAL: factor removal orphans a PRE-EXISTING risk (not an add) → null (operations gate)', () => {
    // Same orphaned-risk graph shape as the positive case, BUT the operations
    // are a removal that did not add/wire the risk — so it must NOT enrich.
    const graph = g([...BASE_NODES, RISK], [...BASE_EDGES]); // risk orphaned → ORPHAN_NODE
    const v = violationsFor(graph);
    expect(v.map((x) => x.code)).toEqual(['ORPHAN_NODE']);
    const removalOps = [
      { op: 'remove_node', value: { id: 'fac_old' } },
      { op: 'remove_edge', value: { from: 'fac_old', to: 'risk_resent' } },
    ];
    expect(classifyAddRiskToOptionRejection(graph, v, removalOps)).toBeNull();
    // sanity: the SAME graph WITH an add of the risk DOES match (true positive)
    expect(classifyAddRiskToOptionRejection(graph, v, [{ op: 'add_node', value: { id: 'risk_resent', kind: 'risk', label: 'r' } }])).not.toBeNull();
  });

  it('ADVERSARIAL: a new risk exists but a DIFFERENT (non-risk) node is the violated one → null', () => {
    // Risk is properly hosted + reachable (no violation); a separate factor is
    // orphaned (ORPHAN_NODE names the factor, not the risk).
    const orphanFactor = n('fac_orphan', 'factor', 'Unconnected factor');
    const graph = g(
      [...BASE_NODES, RISK, orphanFactor],
      [...BASE_EDGES, e('fac_velocity', 'risk_resent'), e('risk_resent', 'goal_q3')], // risk reachable
    );
    const v = violationsFor(graph);
    expect(v.map((x) => x.code)).toEqual(['ORPHAN_NODE']);
    expect(v[0]!.detail).toContain('fac_orphan');
    expect(classifyAddRiskToOptionRejection(graph, v, [{ op: 'add_node', value: { id: 'risk_resent', kind: 'risk', label: 'r' } }])).toBeNull();
  });

  it('ADVERSARIAL: real multi-violation (reachability + cycle) → null even with add-risk ops (gate 1)', () => {
    const graph = g(
      [...BASE_NODES, RISK],
      [...BASE_EDGES, e('risk_resent', 'opt_hire'), e('goal_q3', 'fac_capacity')], // NO_PATH_TO_GOAL + CYCLE
    );
    const v = violationsFor(graph);
    expect(v.some((x) => x.code === 'NO_PATH_TO_GOAL')).toBe(true);
    expect(v.some((x) => x.code === 'CYCLE_DETECTED')).toBe(true);
    expect(classifyAddRiskToOptionRejection(graph, v, [
      { op: 'add_node', value: { id: 'risk_resent', kind: 'risk', label: 'r' } },
      { op: 'add_edge', value: { from: 'risk_resent', to: 'opt_hire' } },
    ])).toBeNull();
  });

  it('POSITIVE amid noise: two risks, one wired-to-option (bad) + one properly hosted (good) → matches only the bad one', () => {
    const riskGood = n('risk_good', 'risk', 'Properly hosted risk');
    const graph = g(
      [...BASE_NODES, RISK, riskGood],
      [...BASE_EDGES, e('fac_velocity', 'risk_good'), e('risk_good', 'goal_q3'), e('risk_resent', 'opt_hire')],
    );
    const v = violationsFor(graph);
    expect(v.map((x) => x.code)).toEqual(['NO_PATH_TO_GOAL']);
    const m = classifyAddRiskToOptionRejection(graph, v, [
      { op: 'add_node', value: { id: 'risk_resent', kind: 'risk', label: 'Team resents new tech lead' } },
      { op: 'add_edge', value: { from: 'risk_resent', to: 'opt_hire' } },
    ]);
    expect(m).not.toBeNull();
    expect(m!.risk_labels).toEqual(['Team resents new tech lead']); // only the bad one
  });

  it('placeholder copy is structural-only: no held-science / no invented-rule / no internal vocab', () => {
    const text = ADD_RISK_REJECTION_GUIDANCE_PLACEHOLDER;
    expect(text).not.toMatch(/\b(sensitiv\w*|fragile|fragility|flip|robustness|vulnerable|influence|elasticity)\b/i);
    // No invented "risks must flow through factors" rule.
    expect(text.toLowerCase()).not.toContain('must flow through');
    expect(text.toLowerCase()).not.toContain('risks must');
    // No internal vocabulary.
    expect(text).not.toMatch(/\b(validator|schema|patch|node|edge|graph|recommend)\b/i);
  });
});
