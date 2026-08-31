/**
 * `structural_add` — the writer, pinned at the adapter seam.
 *
 * ⭐ THE PROPERTY THIS FILE DEFENDS, and it is not "does the node appear".
 *
 * A user drawing a factor on the canvas has told us THREE things — an id, a kind
 * and a label — and nothing else. Everything beyond those three must therefore
 * be either an explicit admission of ignorance or absent. The estate has an
 * ACTIVE defect in which 20 of 21 factor values are exactly `0.5`, and the
 * cheapest way to add to it is a writer that "helpfully" gives a new factor a
 * midpoint. So the cases below are written in two directions:
 *
 *   A. THE ADD DOES NOT LAND     → the user's node vanishes on reload.
 *   B. THE ADD INVENTS SOMETHING → a number, a category, a level the user never
 *                                  gave, presented as their model.
 *
 * ⚠ THE HONESTY ASSERTION IS WRITTEN AGAINST THE SPEC, NOT AGAINST `0.5`
 * (CLAUDE.md trap 13d). The rule is that NO level may be invented, so the guard
 * and its tests reject ANY numeric level on an unvalued factor — `0`, `1`, `0.5`
 * or anything else. A guard shaped like the failure mode in hand is a guard
 * agreeing with the code it tests.
 */
import { describe, it, expect } from 'vitest';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';
import { EditGraphHandlerFactSchema } from '@talchain/schemas/orchestrator';

import {
  applyStructuralAdd,
  buildAddedNode,
  findFabricatedLevel,
  findMissingOptionRosterEntry,
  InvalidPersistedAddGraphError,
  type StructuralAddResult,
} from '../structural-add.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { BASE_HASH_DIVERGED } from '../../graph-management/reason-codes.js';
import { NodeKindV3 } from '../../../schemas/cee-v3.js';
import { reconcileTopLevelOptionsFromNodes } from '../../reconcile-top-level-options.js';

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';
const TURN_ID = '44444444-4444-4444-8444-444444444444';

function persistedGraph(): Record<string, unknown> {
  return {
    schema_version: '3.0',
    goal_node_id: 'goal_revenue',
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Grow revenue' },
      {
        id: 'fac_price',
        kind: 'factor',
        label: 'Unit price',
        category: 'controllable',
        observed_state: { value: 0.4, raw_value: 40000, cap: 100000 },
      },
      {
        id: 'opt_launch',
        kind: 'option',
        label: 'Launch now',
        interventions: { fac_price: { value: 0.4, raw_value: 40000 } },
      },
    ],
    edges: [
      {
        from: 'opt_launch',
        to: 'fac_price',
        strength: { mean: 0.6, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
      {
        from: 'fac_price',
        to: 'goal_revenue',
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
    options: [
      {
        id: 'opt_launch',
        label: 'Launch now',
        status: 'ready',
        interventions: { fac_price: { value: 0.4, raw_value: 40000 } },
      },
    ],
    meta: { roots: ['opt_launch'], leaves: ['goal_revenue'] },
  };
}

function baseHashOf(graph: unknown): string {
  const hash = computeAnalysisAffectingGraphHash(
    graph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  );
  if (hash === null) throw new Error('fixture is unhashable — the fixture is wrong, not the code');
  return hash;
}

function run(
  overrides: Record<string, unknown> = {},
  graph: unknown = persistedGraph(),
): StructuralAddResult {
  const event = {
    kind: 'structural_add' as const,
    node_id: 'fac_churn',
    node_kind: 'factor',
    label: 'Customer churn',
    base_graph_hash: baseHashOf(persistedGraph()),
    ...overrides,
  };
  const payload = {
    kind: 'system_event',
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    stage: 'frame',
    event,
  } as unknown as SystemEventTurnPayload;
  return applyStructuralAdd({
    payload,
    event: event as never,
    requestId: 'req-add-test',
    persistedGraph: graph,
  });
}

function mutated(result: StructuralAddResult) {
  if (result.kind !== 'mutated') throw new Error(`expected a mutation, got ${result.reason}`);
  return result;
}

function addedNodeIn(result: StructuralAddResult, id: string): Record<string, unknown> {
  const node = mutated(result).graph.nodes.find((n) => n.id === id);
  if (node === undefined) throw new Error(`node ${id} is missing from the mutated graph`);
  return node as unknown as Record<string, unknown>;
}

// ───────────────────────────────────────────────────────────────────────────
describe('structural_add — fixture preconditions', () => {
  it('⭐ the fixture is a real, analysable-shaped model the add must not disturb', () => {
    const g = persistedGraph();
    expect((g.nodes as unknown[]).length).toBe(3);
    expect((g.edges as unknown[]).length).toBe(2);
    expect((g.options as unknown[]).length).toBe(1);
    // The id under test is genuinely NEW — otherwise every "it landed" case
    // would be testing the collision branch instead (trap 13b).
    expect((g.nodes as Array<{ id: string }>).some((n) => n.id === 'fac_churn')).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('structural_add — the add LANDS (defect class A)', () => {
  it('⭐ the new entry is in the graph that would persist, with the stated kind and label', () => {
    const node = addedNodeIn(run(), 'fac_churn');
    expect(node.kind).toBe('factor');
    expect(node.label).toBe('Customer churn');
  });

  it('⭐ exactly ONE node was added and no edge was touched', () => {
    const result = mutated(run());
    expect(result.graph.nodes.map((n) => n.id).sort()).toEqual([
      'fac_churn',
      'fac_price',
      'goal_revenue',
      'opt_launch',
    ]);
    // A new node has no incident edges by construction — the contract's own
    // stated reason this member is SINGULAR rather than a batch.
    expect(result.graph.edges.map((e) => `${e.from}::${e.to}`).sort()).toEqual([
      'fac_price::goal_revenue',
      'opt_launch::fac_price',
    ]);
  });

  it('⭐ top-level fields the applier does not return are preserved', () => {
    const merged = mutated(run()).mutatedGraph as Record<string, unknown>;
    expect(merged.goal_node_id).toBe('goal_revenue');
    expect(merged.schema_version).toBe('3.0');
    expect(merged.meta).toEqual({ roots: ['opt_launch'], leaves: ['goal_revenue'] });
  });

  it('⭐ the existing model is untouched — no value, label or edge moved', () => {
    const price = addedNodeIn(run(), 'fac_price');
    expect(price.observed_state).toEqual({ value: 0.4, raw_value: 40000, cap: 100000 });
    expect(price.label).toBe('Unit price');
    const options = (mutated(run()).mutatedGraph as Record<string, unknown>).options as Array<
      Record<string, unknown>
    >;
    expect(options.find((o) => o.id === 'opt_launch')).toEqual({
      id: 'opt_launch',
      label: 'Launch now',
      status: 'ready',
      interventions: { fac_price: { value: 0.4, raw_value: 40000 } },
    });
  });

  it('⭐ the receipt is a contract-valid edit_graph fact naming the new entry', () => {
    const result = mutated(run());
    expect(result.handlerFacts).toHaveLength(1);
    expect(EditGraphHandlerFactSchema.safeParse(result.handlerFacts[0]).success).toBe(true);
    const fact = result.handlerFacts[0] as {
      result: {
        edit_kind: string;
        affected_entities: Array<{ kind: string; label: string }>;
        rerun_recommended: boolean;
        graph_hash_before: string | null;
        graph_hash_after: string | null;
        safe_summary: string;
      };
    };
    expect(fact.result.edit_kind).toBe('structural');
    expect(fact.result.affected_entities).toEqual([
      { kind: 'factor', label: 'Customer churn' },
    ]);
    expect(fact.result.safe_summary.length).toBeLessThanOrEqual(80);
  });

  it('⭐ the receipt says a re-run IS needed, and the hash really moved', () => {
    // The OPPOSITE of the rename sibling, and derived rather than copied:
    // `nodes` is inside the analysis-hash projection, so an add moves the hash
    // by construction. The second assertion is what stops the first being a
    // claim the code contradicts.
    const result = mutated(run());
    const fact = result.handlerFacts[0] as {
      result: { rerun_recommended: boolean; graph_hash_before: string | null; graph_hash_after: string | null };
    };
    expect(fact.result.rerun_recommended).toBe(true);
    expect(fact.result.graph_hash_after).not.toBe(fact.result.graph_hash_before);
    expect(baseHashOf(result.mutatedGraph)).not.toBe(baseHashOf(persistedGraph()));
  });

  it('⭐ the trusted base is NOT mutated — the CAS expected base stays honest', () => {
    const graph = persistedGraph();
    const snapshot = JSON.stringify(graph);
    mutated(run({}, graph));
    expect(JSON.stringify(graph)).toBe(snapshot);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('structural_add — it INVENTS NOTHING (defect class B)', () => {
  it('⭐⭐ a new factor carries NO value — not 0.5, not anything', () => {
    // The rule, stated against the spec. The estate has 20/21 factor values at
    // exactly 0.5; this writer must not add to that pile.
    const node = addedNodeIn(run(), 'fac_churn');
    expect(node.observed_state).toBeUndefined();
    expect(node.intercept).toBeUndefined();
  });

  it('⭐⭐ it carries the EXPLICIT unknown instead — uniform(0,1), marked', () => {
    // MARK, NEVER SUPPRESS. Withholding the prior entirely would strip the node
    // of support and leave a constraint on it evaluating trivially; a NARROWED
    // range would be an information claim, and there is no information.
    expect(addedNodeIn(run(), 'fac_churn').prior).toEqual({
      distribution: 'uniform',
      range_min: 0,
      range_max: 1,
      prior_is_unquantified: true,
    });
  });

  it('⭐ `category` is NOT guessed', () => {
    // `FactorCategoryV3` is derived from whether an OPTION edge reaches the
    // factor. A brand-new node has no edges, so any value would be an inference
    // dressed as a fact — it becomes derivable when the user draws the edge.
    expect(addedNodeIn(run(), 'fac_churn').category).toBeUndefined();
  });

  it('⭐ the node claims user provenance, because the user really did put it there', () => {
    expect(addedNodeIn(run(), 'fac_churn').provenance).toBe('user_set');
  });

  it('⭐ a NON-factor gets no prior — a prior on an option is meaningless', () => {
    const node = addedNodeIn(
      run({ node_id: 'opt_wait', node_kind: 'option', label: 'Wait a quarter' }),
      'opt_wait',
    );
    expect(node.prior).toBeUndefined();
    expect(node.observed_state).toBeUndefined();
  });

  it('⭐⭐ the confirmation SAYS the value is missing and names the route', () => {
    // Saying "Added X" and stopping would leave the user to discover a stalled
    // model on their next run. The honest half is the half that is easy to drop.
    const text = mutated(run()).response.assistant_text;
    expect(text).toContain('Customer churn');
    expect(text.toLowerCase()).toContain("haven't given it a value");
    expect(text.toLowerCase()).toContain("won't invent a number");
    // …and no internal vocabulary or raw id ever reaches the user.
    expect(text).not.toContain('fac_churn');
    expect(text.toLowerCase()).not.toContain('patch');
  });

  it('⭐ an added OPTION is told it is not yet comparable', () => {
    const text = mutated(
      run({ node_id: 'opt_wait', node_kind: 'option', label: 'Wait a quarter' }),
    ).response.assistant_text;
    expect(text).toContain('Wait a quarter');
    expect(text.toLowerCase()).toContain("isn't connected to anything yet");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('structural_add — the options[] roster', () => {
  it('⭐⭐ adding an OPTION node appends its top-level roster entry', () => {
    // This writer does NOT write the roster — `reconcileTopLevelOptionsFromNodes`
    // appends the entry during projection. The postcondition asserts that
    // reliance rather than trusting it, and this case proves the reliance holds.
    const result = mutated(
      run({ node_id: 'opt_wait', node_kind: 'option', label: 'Wait a quarter' }),
    );
    const options = (result.mutatedGraph as Record<string, unknown>).options as Array<
      Record<string, unknown>
    >;
    const entry = options.find((o) => o.id === 'opt_wait');
    expect(entry?.label).toBe('Wait a quarter');
    // `needs_encoding`, not `ready` — the honest state for an option with no
    // configured effects. An over-optimistic `ready` would mislead every
    // `options[]` reader.
    expect(entry?.status).toBe('needs_encoding');
    expect(entry?.interventions).toEqual({});
    // …and the existing entry is untouched.
    expect(options.find((o) => o.id === 'opt_launch')?.label).toBe('Launch now');
  });

  it('⭐ adding an OPTION node ALSO leaves the trusted base unmutated', () => {
    // The option path is the one that touches `options[]` at all, so the
    // factor-only purity case above cannot speak for it. Same lesson the rename
    // sibling learned by mutation: a base-purity test that never exercises the
    // write-through proves nothing about it.
    const graph = persistedGraph();
    const snapshot = JSON.stringify(graph);
    const result = mutated(
      run({ node_id: 'opt_wait', node_kind: 'option', label: 'Wait a quarter' }, graph),
    );
    // Precondition: the roster really did gain the entry, so this is not passing
    // by doing nothing (trap 13b).
    const options = (result.mutatedGraph as Record<string, unknown>).options as unknown[];
    expect(options).toHaveLength(2);
    expect(JSON.stringify(graph)).toBe(snapshot);
  });

  it('⭐⭐ the roster pass this writer RELIES ON is pure — pinned, because it is why the clone reads as redundant', () => {
    // ⚠ THIS IS AN HONESTY PIN, NOT A UNIT TEST OF SOMEONE ELSE'S MODULE.
    //
    // A mutation battery removed the `structuredClone` around the persist merge
    // and the whole suite stayed GREEN. That is a TRUE result and it rests
    // entirely on one fact about a module this writer does not own:
    // `reconcileTopLevelOptionsFromNodes` returns a NEW `options` array and
    // leaves its input untouched. `mergeAppliedGraphForPersistence` composes
    // with a shallow spread, so `merged.options` IS the trusted base's array —
    // the moment that pass starts mutating in place, removing the clone would
    // rewrite `persistedGraph`, which `dispatch.ts` hashes as the atomic-CAS
    // expected base. That is a 409 on every subsequent write, at rest, forever:
    // the P0 the delete lane paid for.
    //
    // So the equivalence is DEMONSTRATED here rather than asserted, and it REDs
    // if it ever stops being true — at which point the clone stops being
    // defence-in-depth and becomes load-bearing.
    const base = {
      nodes: [
        { id: 'o1', kind: 'option', label: 'A', interventions: {} },
        { id: 'o2', kind: 'option', label: 'B', interventions: {} },
      ],
      edges: [],
      options: [{ id: 'o1', label: 'A', status: 'ready', interventions: {} }],
    };
    const before = JSON.stringify(base);
    const out = reconcileTopLevelOptionsFromNodes(base) as { options: unknown[] };
    // The pass really did something — otherwise purity is vacuous (trap 13).
    expect(out.options).toHaveLength(2);
    // …and it did it without touching the input.
    expect(JSON.stringify(base)).toBe(before);
    expect(out.options).not.toBe(base.options);
  });

  it('adding a NON-option leaves the roster byte-identical', () => {
    expect((mutated(run()).mutatedGraph as Record<string, unknown>).options).toEqual(
      persistedGraph().options,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('structural_add — refuses LOUDLY, and never writes on a refusal', () => {
  function expectRefusal(result: StructuralAddResult, reason: string) {
    if (result.kind !== 'refused') throw new Error('expected a refusal, got a mutation');
    expect(result.reason).toBe(reason);
    expect('mutatedGraph' in result).toBe(false);
    expect(result.response.assistant_text.length).toBeGreaterThan(0);
    return result;
  }

  it('⭐ no persisted model at all', () => {
    expectRefusal(run({}, null), 'no_persisted_graph');
  });

  it('⭐ a malformed persisted model THROWS rather than refusing politely', () => {
    expect(() => run({}, { nodes: [{ id: 'x' }], edges: [] })).toThrow(
      InvalidPersistedAddGraphError,
    );
  });

  it('⭐ a diverged base_graph_hash refuses AND asks for a 409, naming the server hash', () => {
    const refused = expectRefusal(
      run({ base_graph_hash: 'deadbeefdeadbeef' }),
      BASE_HASH_DIVERGED,
    );
    expect(refused.baseHashConflict?.recovery_action).toBe('refresh_and_reconfirm');
    expect(refused.baseHashConflict?.expected_base_graph_hash).toBe(baseHashOf(persistedGraph()));
  });

  it('⭐⭐ a COLLIDING id refuses rather than overwriting — the hash cannot catch this', () => {
    // The contract is explicit: a colliding id is already present in the very
    // graph the user was looking at, so `base_graph_hash` is FRESH and the add
    // is still destructive. This case sends a VALID hash deliberately.
    const refused = expectRefusal(
      run({ node_id: 'fac_price', node_kind: 'factor', label: 'Something else' }),
      'node_id_collision',
    );
    expect(refused.baseHashConflict).toBeUndefined();
  });

  it('⭐⭐ the collision refusal is reached with a FRESH hash — proving the gates are independent', () => {
    // trap 13b: without this the case above could be passing because the stale
    // gate fired first, i.e. testing the wrong branch entirely.
    const stale = run({ node_id: 'fac_price', base_graph_hash: 'deadbeefdeadbeef' });
    if (stale.kind !== 'refused') throw new Error('expected a refusal');
    expect(stale.reason).toBe(BASE_HASH_DIVERGED);
    const fresh = run({ node_id: 'fac_price' });
    if (fresh.kind !== 'refused') throw new Error('expected a refusal');
    expect(fresh.reason).toBe('node_id_collision');
  });

  it('⭐⭐ a kind CEE cannot persist is refused BEFORE the write, with its own sentence', () => {
    // The wire's `NodeKind` has EIGHT members; CEE's `NodeKindV3` has SEVEN.
    // `constraint` is a valid payload CEE cannot store, and without this gate it
    // would die at the post-mutation parse with a generic save error.
    const refused = expectRefusal(
      run({ node_id: 'con_budget', node_kind: 'constraint', label: 'Stay under 250k' }),
      'unpersistable_node_kind',
    );
    expect(refused.response.assistant_text.toLowerCase()).toContain('in chat');
  });

  it('⭐ the two kind vocabularies really DO disagree — the gate is not hypothetical', () => {
    // trap 13b again, and this is the precondition the case above rests on. If
    // CEE ever gains `constraint`, this REDs and the gate above becomes dead
    // copy that must be revisited rather than silently kept.
    expect(NodeKindV3.options).not.toContain('constraint');
    expect(NodeKindV3.options).toContain('factor');
  });

  it('every persistable kind is actually accepted — the gate is not too wide', () => {
    // The opposite-direction twin. A gate that refuses everything would satisfy
    // the case above and break the product.
    for (const kind of NodeKindV3.options) {
      const result = run({ node_id: `new_${kind}`, node_kind: kind, label: `A ${kind}` });
      expect({ kind, outcome: result.kind }).toEqual({ kind, outcome: 'mutated' });
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('buildAddedNode — every field is stated or an admission of ignorance', () => {
  it('a factor gets exactly id, kind, label, provenance and the ignorance prior', () => {
    expect(buildAddedNode('fac_x', 'factor', 'X')).toEqual({
      id: 'fac_x',
      kind: 'factor',
      label: 'X',
      provenance: 'user_set',
      prior: { distribution: 'uniform', range_min: 0, range_max: 1, prior_is_unquantified: true },
    });
  });

  it('a non-factor gets exactly id, kind, label and provenance', () => {
    expect(buildAddedNode('opt_x', 'option', 'X')).toEqual({
      id: 'opt_x',
      kind: 'option',
      label: 'X',
      provenance: 'user_set',
    });
  });

  it('the prior is a FRESH object per call — never a shared frozen instance', () => {
    // A shared instance aliased onto many nodes means a repair pass mutating one
    // silently moves all of them.
    const a = buildAddedNode('fac_a', 'factor', 'A').prior;
    const b = buildAddedNode('fac_b', 'factor', 'B').prior;
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('findFabricatedLevel — the honesty postcondition, pinned directly', () => {
  const honest = {
    nodes: [
      {
        id: 'f',
        kind: 'factor',
        label: 'F',
        prior: { distribution: 'uniform', range_min: 0, range_max: 1, prior_is_unquantified: true },
      },
    ],
  };

  it('the honest shape is clean', () => {
    expect(findFabricatedLevel(honest, 'f')).toBeNull();
  });

  it('a non-factor is never judged on a level it cannot have', () => {
    expect(findFabricatedLevel({ nodes: [{ id: 'o', kind: 'option', label: 'O' }] }, 'o')).toBeNull();
  });

  // ⭐⭐ WRITTEN AGAINST THE SPEC, NOT AGAINST 0.5. The rule is that no level may
  // be invented, so every one of these must be caught — a guard shaped like the
  // one failure mode in hand is a guard agreeing with the code it tests.
  it.each([0.5, 0, 1, 0.42, -0.3])('catches an invented observed value of %s', (v) => {
    const g = structuredClone(honest);
    (g.nodes[0] as Record<string, unknown>).observed_state = { value: v };
    expect(findFabricatedLevel(g, 'f')).toBe('observed_state.value');
  });

  it('catches an invented raw_value even with no value beside it', () => {
    const g = structuredClone(honest);
    (g.nodes[0] as Record<string, unknown>).observed_state = { raw_value: 40000 };
    expect(findFabricatedLevel(g, 'f')).toBe('observed_state.raw_value');
  });

  it('catches an invented intercept', () => {
    const g = structuredClone(honest);
    (g.nodes[0] as Record<string, unknown>).intercept = 0.5;
    expect(findFabricatedLevel(g, 'f')).toBe('intercept');
  });

  it('catches a MISSING prior — support withheld is not the same as ignorance stated', () => {
    const g = structuredClone(honest);
    delete (g.nodes[0] as Record<string, unknown>).prior;
    expect(findFabricatedLevel(g, 'f')).toBe('prior_missing');
  });

  it('⭐ catches an UNMARKED uniform(0,1) — the discriminator the UI needs', () => {
    // Without `prior_is_unquantified` the UI's `isFactorNeedsInput` exemption
    // for genuine external priors swallows this node, and the amber "needs your
    // judgement" affordance stays dark on exactly the factor that needs it.
    const g = structuredClone(honest);
    (g.nodes[0] as Record<string, unknown>).prior = {
      distribution: 'uniform',
      range_min: 0,
      range_max: 1,
    };
    expect(findFabricatedLevel(g, 'f')).toBe('prior_not_marked_unquantified');
  });

  it('⭐ catches a NARROWED range — a narrowed prior is an information claim', () => {
    const g = structuredClone(honest);
    (g.nodes[0] as Record<string, unknown>).prior = {
      distribution: 'uniform',
      range_min: 0.4,
      range_max: 0.9,
      prior_is_unquantified: true,
    };
    expect(findFabricatedLevel(g, 'f')).toBe('prior_range_narrowed');
  });

  it('catches the node having vanished entirely', () => {
    expect(findFabricatedLevel({ nodes: [] }, 'f')).toBe('node_missing');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('findMissingOptionRosterEntry — the two option views must agree', () => {
  const g = (options: unknown) => ({ options } as Record<string, unknown>);

  it('an appended entry is clean', () => {
    expect(findMissingOptionRosterEntry(g([{ id: 'o', label: 'O' }]), 'o', 'option', 'O')).toBeNull();
  });

  it('catches a missing entry', () => {
    expect(findMissingOptionRosterEntry(g([]), 'o', 'option', 'O')).toBe('options_entry_missing');
  });

  it('catches an entry whose label disagrees', () => {
    expect(findMissingOptionRosterEntry(g([{ id: 'o', label: 'Other' }]), 'o', 'option', 'O')).toBe(
      'options_entry_label_disagrees',
    );
  });

  it('⭐ an ABSENT roster is not a gap — the projection never invents one', () => {
    // Demanding an entry where no roster exists would refuse an honest add, on
    // every graph that has never carried an `options[]` array.
    expect(findMissingOptionRosterEntry({}, 'o', 'option', 'O')).toBeNull();
  });

  it('a NON-option node is never judged against the roster', () => {
    expect(findMissingOptionRosterEntry(g([]), 'f', 'factor', 'F')).toBeNull();
  });
});
