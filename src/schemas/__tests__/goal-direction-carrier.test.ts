/**
 * THE GOAL'S STATED SENSE HAS A GraphV3 CARRIER — and only CEE writes it.
 *
 * `goal_direction` on a goal node is CEE-minted at construction from the operator
 * the USER stated (`agent-lane/admit-model.ts` `attestedGoalDirection`), and
 * `run_analysis` forwards it as PLoT's REQUEST-level `goal_direction`. Three
 * properties make that honest, and each is pinned here with a sibling that MUST go
 * the other way, so none can pass by its mechanism having stopped working:
 *
 *   1. SURVIVAL — `NodeV3` is a plain `z.object` and the run path calls
 *      `GraphV3.safeParse` on the reloaded graph, so an undeclared sense is deleted
 *      with no error anywhere.
 *   2. NEVER A NEW REFUSAL — an unrecognised value is dropped (`.catch`), and the
 *      stored graph still parses. A sense a UI or an old writer spelled differently
 *      must not make a user's whole model unloadable.
 *   3. NOT AI-AUTHORABLE — the edit path is deny-by-default (the root is absent from
 *      the shared contract's classed table), the ADD path screens and strips it (it
 *      is a CEE-owned root, `field-safety.ts` `CEE_ANALYSIS_OWNED_ROOTS`; review
 *      5844286953 NB1), and the draft path rebuilds each node field by field. A
 *      model-written sense would otherwise be forwarded as the USER'S attested sense
 *      — the one thing it must never be.
 */
import { describe, expect, it } from 'vitest';
import { aiEditableFieldRoots } from '@talchain/schemas/orchestrator';

import { NodeV3, GraphV3 } from '../cee-v3.js';
import {
  ALLOWED_NODE_FIELD_ROOTS,
  PIPELINE_OWNED_ROOTS,
  stripPipelineOwnedFromAddOperations,
} from '../../orchestrator-v5/graph-management/field-safety.js';
import { refereeMutation } from '../../orchestrator-v5/graph-management/referee.js';
import { PIPELINE_OWNED_FIELD, STRUCTURAL_APPLY_HELD } from '../../orchestrator-v5/graph-management/reason-codes.js';
import { buildReadyGraph, frameFor, hashOf, makeEnvelope } from '../../orchestrator-v5/graph-management/__tests__/fixtures.js';
import { transformNodeToV3 } from '../../cee/transforms/schema-v3.js';

const goal = (extra: Record<string, unknown> = {}) => ({
  id: 'monthly_churn_rate',
  kind: 'goal' as const,
  label: 'Monthly churn rate',
  goal_threshold_frame: 'level' as const,
  goal_threshold_raw: 10,
  ...extra,
});

describe('goal_direction survives the NodeV3 unknown-field strip', () => {
  it('POSITIVE CONTROL — NodeV3 really does strip an undeclared goal field (the raw operator)', () => {
    const parsed = NodeV3.parse(goal({ goal_operator: '<=' })) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('goal_operator');
    // …while a declared sibling survives the same parse.
    expect(parsed.goal_threshold_frame).toBe('level');
  });

  for (const sense of ['maximise', 'minimise'] as const) {
    it(`a ${sense} sense survives GraphV3.safeParse on the goal node`, () => {
      const parsed = GraphV3.safeParse({ nodes: [goal({ goal_direction: sense })], edges: [] });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.nodes[0].goal_direction).toBe(sense);
    });
  }

  it('absence stays absence — never defaulted', () => {
    const parsed = NodeV3.parse(goal()) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('goal_direction');
  });
});

describe('an unrecognised sense is dropped, never a new reason to refuse a stored graph', () => {
  for (const bad of ['target', 'maximize', 'up', 1, null, { sense: 'minimise' }] as const) {
    it(`${JSON.stringify(bad)} is dropped and the graph still parses`, () => {
      const parsed = GraphV3.safeParse({ nodes: [goal({ goal_direction: bad })], edges: [] });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.nodes[0].goal_direction).toBeUndefined();
      // Discrimination: the rest of the goal node is intact, so the drop is this
      // field's, not the parse discarding the node.
      expect(parsed.success && parsed.data.nodes[0].goal_threshold_raw).toBe(10);
    });
  }
});

describe('goal_direction is not AI-authorable — edit path', () => {
  it('is absent from the node field roots a model may update', () => {
    expect(ALLOWED_NODE_FIELD_ROOTS.has('goal_direction')).toBe(false);
    expect(aiEditableFieldRoots('node').has('goal_direction')).toBe(false);
    // DISCRIMINATION: the allowlist is populated and permissive about ordinary
    // fields, so the `false` above is a decision and not an empty set.
    expect(ALLOWED_NODE_FIELD_ROOTS.has('label')).toBe(true);
    expect(ALLOWED_NODE_FIELD_ROOTS.size).toBeGreaterThan(5);
  });

  it('stays absent from the whole AI-editable surface, on every entity', () => {
    for (const entity of ['node', 'edge'] as const) {
      expect(aiEditableFieldRoots(entity).has('goal_direction')).toBe(false);
    }
  });
});

describe('goal_direction is not AI-authorable — ADD path (review 5844286953 NB1)', () => {
  // The forwarder trusts the goal node's sense, so a model `add_node` must not be able
  // to supply one. The add path screens values only against the CEE-owned set.
  const G = buildReadyGraph();
  const addWith = (screened: Record<string, unknown>) =>
    refereeMutation(
      makeEnvelope(
        'add_node',
        { node: { id: 'n-new-goal', kind: 'factor', label: 'Monthly churn rate' }, screened_value: screened },
        { base_graph_hash: hashOf(G) },
      ),
      G,
      frameFor(G),
    );

  it('is a CEE-owned root', () => {
    expect(PIPELINE_OWNED_ROOTS.has('goal_direction')).toBe(true);
  });

  it('a model add_node whose value carries goal_direction is REFUSED at the referee', () => {
    const v = addWith({ goal_direction: 'maximise', description: 'A new goal' });
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
  });

  it('CONTROL: the same add without it reaches its ordinary held verdict (the refusal is this key\'s)', () => {
    const v = addWith({ description: 'A new goal' });
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(STRUCTURAL_APPLY_HELD);
  });

  it('the edit pipeline STRIPS it from a goal add, so the node lands without a sense the user never stated', () => {
    const value = { id: 'g-new', kind: 'goal', label: 'Monthly churn rate', goal_direction: 'maximise', goal_threshold_raw: 10 };
    const { operations, strippedKeyShapes } = stripPipelineOwnedFromAddOperations([{ op: 'add_node', value }]);
    expect(strippedKeyShapes).toEqual(['goal_direction']);
    expect(operations[0]!.value).toEqual({ id: 'g-new', kind: 'goal', label: 'Monthly churn rate', goal_threshold_raw: 10 });
    // Discrimination: an add with nothing owned is returned by reference.
    const clean = { op: 'add_node', value: { id: 'g-2', kind: 'goal', label: 'Pro MRR' } };
    expect(stripPipelineOwnedFromAddOperations([clean]).operations[0]).toBe(clean);
  });
});

describe('goal_direction is not AI-authorable — draft path', () => {
  it('drops a model-emitted sense on a drafted goal while carrying its threshold', () => {
    const drafted = transformNodeToV3({
      id: 'goal_churn',
      kind: 'goal',
      label: 'Monthly churn',
      goal_threshold: 0.1,
      goal_threshold_raw: 10,
      goal_threshold_cap: 100,
      goal_threshold_frame: 'level',
      // A model writing the user's sense for them.
      goal_direction: 'minimise',
    } as never) as Record<string, unknown>;
    expect(drafted).not.toHaveProperty('goal_direction');
    // THE DISCRIMINATION: the transform carries the goal fields it does copy.
    expect(drafted.goal_threshold_raw).toBe(10);
    expect(drafted.goal_threshold_frame).toBe('level');
    expect(drafted.kind).toBe('goal');
  });
});
