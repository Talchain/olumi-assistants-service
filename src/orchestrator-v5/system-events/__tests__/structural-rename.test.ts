/**
 * `structural_rename` — the writer, pinned at the adapter seam.
 *
 * ⭐ WHAT THIS FILE IS FOR, stated as the property rather than the case.
 *
 * A rename changes ONE display string and must change NOTHING ELSE. Everything
 * in the canonical graph is id-addressed, so that is true by construction — and
 * "true by construction" is exactly the claim that stops being checked. Two
 * classes of defect are in scope and each gets matched pairs, because a guard
 * that watches one door is the failure this estate keeps paying for:
 *
 *   A. THE RENAME DOES NOT LAND        → the user's edit vanishes on reload,
 *                                        which is the defect the writer exists
 *                                        to close.
 *   B. THE RENAME LANDS TOO WIDELY     → a second node, an edge, or the
 *                                        `options[]` roster moves with it.
 *
 * ⭐⭐ BOUND BY IDENTITY, NEVER BY A VALUE PREDICATE (trap 19). The fixture
 * deliberately contains TWO nodes carrying the SAME label, `fac_price` and
 * `fac_price_twin`. Any assertion that found a node "by label" would be
 * satisfied by either, so every case below addresses nodes by id and the twin is
 * the discriminator: a writer that resolved by label would move the wrong one
 * and these tests would RED. That fixture property is itself PINNED below
 * (trap 13b — a discriminator must assert its own precondition, or it can pass
 * because the fixture stopped discriminating rather than because the code is
 * right).
 */
import { describe, it, expect } from 'vitest';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';
import { EditGraphHandlerFactSchema } from '@talchain/schemas/orchestrator';

import {
  applyStructuralRename,
  findStaleRenamedLabel,
  findUnintendedStructuralChange,
  propagateRenamedLabel,
  renameMovedAnalysisHash,
  InvalidPersistedRenameGraphError,
  type StructuralRenameResult,
} from '../structural-rename.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { BASE_HASH_DIVERGED } from '../../graph-management/reason-codes.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';
const TURN_ID = '22222222-2222-4222-8222-222222222222';

/**
 * A realistic persisted scenario graph.
 *
 * ⚠ EVERY FEATURE HERE IS LOAD-BEARING, not decoration:
 *   · `fac_price` and `fac_price_twin` share the label 'Unit price' — the
 *     id-binding discriminator described in the file header;
 *   · `fac_price` carries `label_authored: true` and a `source_quote`, so the
 *     provenance rules have something to act on and something to preserve;
 *   · `opt_launch` is an OPTION node with a matching top-level `options[]`
 *     entry — the label mirror that `reconcileTopLevelOptionsFromNodes` does
 *     NOT maintain, so only the writer can keep it in step;
 *   · `interventions` is keyed on FACTOR IDS, which is what makes "a rename
 *     cannot orphan an intervention" a checkable claim rather than a hope.
 */
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
        label_authored: true,
        source_quote: 'we could change what we charge',
        observed_state: { value: 0.4, raw_value: 40000, cap: 100000 },
      },
      { id: 'fac_price_twin', kind: 'factor', label: 'Unit price', category: 'observable' },
      {
        id: 'opt_launch',
        kind: 'option',
        label: 'Launch now',
        interventions: { fac_price: { value: 0.4, raw_value: 40000 } },
      },
      { id: 'opt_wait', kind: 'option', label: 'Wait a quarter' },
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
      { id: 'opt_wait', label: 'Wait a quarter', status: 'ready', interventions: {} },
    ],
    meta: { roots: ['opt_launch', 'opt_wait'], leaves: ['goal_revenue'] },
  };
}

function baseHashOf(graph: unknown): string {
  const hash = computeAnalysisAffectingGraphHash(
    graph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  );
  if (hash === null) throw new Error('fixture is unhashable — the fixture is wrong, not the code');
  return hash;
}

function renameEvent(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'structural_rename' as const,
    node_id: 'fac_price',
    label: 'Price per seat',
    expected_label: 'Unit price',
    base_graph_hash: baseHashOf(persistedGraph()),
    ...overrides,
  };
}

function run(
  eventOverrides: Record<string, unknown> = {},
  graph: unknown = persistedGraph(),
): StructuralRenameResult {
  const event = renameEvent(eventOverrides);
  const payload = {
    kind: 'system_event',
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    stage: 'frame',
    event,
  } as unknown as SystemEventTurnPayload;
  return applyStructuralRename({
    payload,
    event: event as never,
    requestId: 'req-rename-test',
    persistedGraph: graph,
  });
}

function nodesOf(result: StructuralRenameResult): GraphV3T['nodes'] {
  if (result.kind !== 'mutated') throw new Error(`expected a mutation, got ${result.reason}`);
  return result.graph.nodes;
}

function nodeById(result: StructuralRenameResult, id: string) {
  const found = nodesOf(result).find((n) => n.id === id);
  if (found === undefined) throw new Error(`node ${id} missing from the mutated graph`);
  return found as Record<string, unknown>;
}

// ───────────────────────────────────────────────────────────────────────────
describe('structural_rename — fixture preconditions', () => {
  it('⭐ the fixture really carries a SAME-LABEL twin, so id-binding is testable', () => {
    // trap 13b. Without this, every "the twin was untouched" case below could
    // pass because the twin stopped sharing the label — a discriminator that
    // silently stopped discriminating.
    const nodes = persistedGraph().nodes as Array<Record<string, unknown>>;
    const target = nodes.find((n) => n.id === 'fac_price');
    const twin = nodes.find((n) => n.id === 'fac_price_twin');
    expect(target?.label).toBe('Unit price');
    expect(twin?.label).toBe('Unit price');
    expect(target?.id).not.toBe(twin?.id);
  });

  it('⭐ the fixture really carries an options[] mirror for an option node', () => {
    const options = persistedGraph().options as Array<Record<string, unknown>>;
    expect(options.find((o) => o.id === 'opt_launch')?.label).toBe('Launch now');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('structural_rename — the rename LANDS (defect class A)', () => {
  it('⭐ the named node carries the new label in the graph that would persist', () => {
    const result = run();
    expect(result.kind).toBe('mutated');
    expect(nodeById(result, 'fac_price').label).toBe('Price per seat');
  });

  it('⭐ the confirmation states BOTH labels and that nothing else moved', () => {
    const result = run();
    if (result.kind !== 'mutated') throw new Error('expected a mutation');
    expect(result.response.assistant_text).toContain('Unit price');
    expect(result.response.assistant_text).toContain('Price per seat');
    // The honest half: a user who renames and then sees an unchanged analysis
    // must be told that is correct, not stale.
    expect(result.response.assistant_text.toLowerCase()).toContain('nothing else moved');
    // No internal vocabulary and no raw id ever reaches the user.
    expect(result.response.assistant_text).not.toContain('fac_price');
    expect(result.response.assistant_text.toLowerCase()).not.toContain('patch');
  });

  it('⭐ the receipt is a contract-valid edit_graph fact naming the NEW label', () => {
    const result = run();
    if (result.kind !== 'mutated') throw new Error('expected a mutation');
    expect(result.handlerFacts).toHaveLength(1);
    const parsed = EditGraphHandlerFactSchema.safeParse(result.handlerFacts[0]);
    expect(parsed.success).toBe(true);
    const fact = result.handlerFacts[0] as {
      result: {
        edit_kind: string;
        affected_entities: Array<{ kind: string; label: string }>;
        impact: string;
        rerun_recommended: boolean;
        graph_hash_before: string | null;
        graph_hash_after: string | null;
        safe_summary: string;
      };
    };
    expect(fact.result.edit_kind).toBe('structural');
    expect(fact.result.affected_entities).toEqual([
      { kind: 'factor', label: 'Price per seat' },
    ]);
    expect(fact.result.safe_summary.length).toBeLessThanOrEqual(80);
  });

  it('⭐ the receipt says a re-run is NOT needed, and the hashes agree', () => {
    // DERIVED, not copied from the delete sibling: `label` is absent from the
    // analysis-hash projection, so advising a re-run would contradict the
    // writer's own measurement.
    const result = run();
    if (result.kind !== 'mutated') throw new Error('expected a mutation');
    const fact = result.handlerFacts[0] as {
      result: { impact: string; rerun_recommended: boolean; graph_hash_before: string | null; graph_hash_after: string | null };
    };
    expect(fact.result.rerun_recommended).toBe(false);
    expect(fact.result.impact).toBe('low');
    expect(fact.result.graph_hash_after).toBe(fact.result.graph_hash_before);
  });

  it('⭐ the analysis-affecting hash of the persisted bytes does NOT move', () => {
    const before = baseHashOf(persistedGraph());
    const result = run();
    if (result.kind !== 'mutated') throw new Error('expected a mutation');
    expect(baseHashOf(result.mutatedGraph)).toBe(before);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('structural_rename — the rename does NOT spread (defect class B)', () => {
  it('⭐⭐ the SAME-LABEL twin is untouched — the writer resolves by id, not label', () => {
    // THE discriminating case. A label-resolving writer would rename whichever
    // node it found first; both carry 'Unit price'.
    const result = run();
    expect(nodeById(result, 'fac_price_twin').label).toBe('Unit price');
    expect(nodeById(result, 'fac_price').label).toBe('Price per seat');
  });

  it('⭐ no other node changed its label', () => {
    const result = run();
    for (const [id, label] of [
      ['goal_revenue', 'Grow revenue'],
      ['fac_price_twin', 'Unit price'],
      ['opt_launch', 'Launch now'],
      ['opt_wait', 'Wait a quarter'],
    ] as const) {
      expect(nodeById(result, id).label).toBe(label);
    }
  });

  it('⭐ the node and edge sets are byte-identical — nothing was retargeted', () => {
    const result = run();
    if (result.kind !== 'mutated') throw new Error('expected a mutation');
    expect(result.graph.nodes.map((n) => n.id).sort()).toEqual(
      ['fac_price', 'fac_price_twin', 'goal_revenue', 'opt_launch', 'opt_wait'],
    );
    expect(result.graph.edges.map((e) => `${e.from}::${e.to}`).sort()).toEqual([
      'fac_price::goal_revenue',
      'opt_launch::fac_price',
    ]);
  });

  it('⭐ interventions keyed on the renamed factor id survive intact', () => {
    // The id-keyed record is why a rename cannot orphan an intervention. If this
    // ever REDs, the writer has started touching ids, not labels.
    const result = run();
    if (result.kind !== 'mutated') throw new Error('expected a mutation');
    const merged = result.mutatedGraph as Record<string, unknown>;
    const options = merged.options as Array<Record<string, unknown>>;
    expect(options.find((o) => o.id === 'opt_launch')?.interventions).toEqual({
      fac_price: { value: 0.4, raw_value: 40000 },
    });
    expect(nodeById(result, 'opt_launch').interventions).toEqual({
      fac_price: { value: 0.4, raw_value: 40000 },
    });
  });

  it('⭐ top-level fields the applier does not return are preserved', () => {
    // `applyPatchOperations` returns only {nodes, edges}; persisting that
    // verbatim would strip the model.
    const result = run();
    if (result.kind !== 'mutated') throw new Error('expected a mutation');
    const merged = result.mutatedGraph as Record<string, unknown>;
    expect(merged.goal_node_id).toBe('goal_revenue');
    expect(merged.schema_version).toBe('3.0');
    expect(merged.meta).toEqual({ roots: ['opt_launch', 'opt_wait'], leaves: ['goal_revenue'] });
  });

  it('⭐⭐ the trusted base is NOT mutated — the CAS expected base stays honest', () => {
    // The P0 the delete lane paid for: an in-place write through the shallow
    // merge corrupts `persistedGraph`, which dispatch then hashes as the CAS
    // expected base, yielding a 409 on every subsequent write at rest.
    const graph = persistedGraph();
    const snapshot = JSON.stringify(graph);
    const result = run({}, graph);
    expect(result.kind).toBe('mutated');
    expect(JSON.stringify(graph)).toBe(snapshot);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('structural_rename — the options[] label mirror', () => {
  it('⭐⭐ renaming an OPTION node updates its top-level options[] entry', () => {
    // `reconcileTopLevelOptionsFromNodes` is append-and-propagate-interventions
    // only; it never updates an existing entry's label. Without the writer's own
    // propagation the canvas would show the new name and the analysis surface —
    // which prefers `options[]` — the old one.
    const result = run({
      node_id: 'opt_launch',
      label: 'Launch in Q1',
      expected_label: 'Launch now',
    });
    if (result.kind !== 'mutated') throw new Error(`expected a mutation, got ${result.reason}`);
    const options = (result.mutatedGraph as Record<string, unknown>).options as Array<
      Record<string, unknown>
    >;
    expect(options.find((o) => o.id === 'opt_launch')?.label).toBe('Launch in Q1');
    // And the OTHER entry is untouched.
    expect(options.find((o) => o.id === 'opt_wait')?.label).toBe('Wait a quarter');
    expect(nodeById(result, 'opt_launch').label).toBe('Launch in Q1');
  });

  it('⭐⭐ renaming an OPTION node ALSO leaves the trusted base unmutated', () => {
    // ⚠ THE NON-OPTION VARIANT OF THIS CASE IS NOT ENOUGH, and a mutation check
    // proved it: deleting the `structuredClone` around the persist merge left the
    // whole suite GREEN, because the only in-place write this writer performs is
    // `propagateRenamedLabel` on `options[]` — and that fires ONLY for an option
    // node. Renaming a factor therefore never exercises the write-through at all.
    //
    // The write-through is the P0 the delete lane paid for: `mergeAppliedGraphForPersistence`
    // composes with a SHALLOW spread, so `merged.options` IS the base's array;
    // writing a label through it rewrites `persistedGraph`, which `dispatch.ts`
    // then hashes as the atomic-CAS expected base — yielding an expected hash for
    // a graph that was never persisted, and a 409 on every subsequent write at
    // rest, forever.
    const graph = persistedGraph();
    const snapshot = JSON.stringify(graph);
    const result = run(
      { node_id: 'opt_launch', label: 'Launch in Q1', expected_label: 'Launch now' },
      graph,
    );
    if (result.kind !== 'mutated') throw new Error(`expected a mutation, got ${result.reason}`);
    // The new label really did land — otherwise this would pass vacuously by
    // doing nothing at all (trap 13b: pin the precondition, not just the outcome).
    const options = (result.mutatedGraph as Record<string, unknown>).options as Array<
      Record<string, unknown>
    >;
    expect(options.find((o) => o.id === 'opt_launch')?.label).toBe('Launch in Q1');
    // …and the base the CAS will hash is byte-identical to what was read.
    expect(JSON.stringify(graph)).toBe(snapshot);
  });

  it('renaming a NON-option node leaves the options roster byte-identical', () => {
    const result = run();
    if (result.kind !== 'mutated') throw new Error('expected a mutation');
    expect((result.mutatedGraph as Record<string, unknown>).options).toEqual(
      persistedGraph().options,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
/** The default successful rename, re-run per case so no case can pollute another. */
function result_default(): StructuralRenameResult {
  return run();
}

describe('structural_rename — provenance', () => {
  it('⭐ a stale label_authored is DROPPED — the new label is the user\'s own words', () => {
    // `label_authored` means "this label is OUR authored display string". After
    // the user types their own, leaving `true` is a false claim about the one
    // field the rename changed.
    const result = run();
    expect('label_authored' in nodeById(result, 'fac_price')).toBe(false);
  });

  it('⭐ source_quote SURVIVES — it is a historic record, not a stale mirror', () => {
    // The user's exact words from the brief remain true and are append-only
    // evidence. Deleting them to tidy a derived flag would destroy provenance.
    expect(nodeById(result_default(), 'fac_price').source_quote).toBe(
      'we could change what we charge',
    );
  });

  it('the node claims user provenance', () => {
    expect(nodeById(result_default(), 'fac_price').provenance).toBe('user_set');
  });

  it('every other field on the renamed node is untouched', () => {
    const node = nodeById(result_default(), 'fac_price');
    expect(node.kind).toBe('factor');
    expect(node.category).toBe('controllable');
    expect(node.observed_state).toEqual({ value: 0.4, raw_value: 40000, cap: 100000 });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('structural_rename — refuses LOUDLY, and never writes on a refusal', () => {
  function expectRefusal(result: StructuralRenameResult, reason: string) {
    if (result.kind !== 'refused') throw new Error('expected a refusal, got a mutation');
    expect(result.reason).toBe(reason);
    // A refusal carries no graph to persist — the shape makes that structural,
    // and this asserts the shape rather than trusting it.
    expect('mutatedGraph' in result).toBe(false);
    expect(result.response.assistant_text.length).toBeGreaterThan(0);
    return result;
  }

  it('⭐ no persisted model at all', () => {
    expectRefusal(run({}, null), 'no_persisted_graph');
  });

  it('⭐ a malformed persisted model THROWS rather than refusing politely', () => {
    // Corruption, not absence. Dispatch maps the throw to a retryable 500 with
    // no append, so the corrupt row stays authoritative instead of being healed
    // forward under a rename.
    expect(() => run({}, { nodes: [{ id: 'x' }], edges: [] })).toThrow(
      InvalidPersistedRenameGraphError,
    );
  });

  it('⭐ a diverged base_graph_hash refuses AND asks for a 409, naming the server hash', () => {
    const result = run({ base_graph_hash: 'deadbeefdeadbeef' });
    const refused = expectRefusal(result, BASE_HASH_DIVERGED);
    expect(refused.baseHashConflict?.recovery_action).toBe('refresh_and_reconfirm');
    // ANALYSIS space (16-hex), the same space the client's own assertion is in —
    // a 64-hex identity hash would be a gate the client can never satisfy.
    expect(refused.baseHashConflict?.expected_base_graph_hash).toBe(
      baseHashOf(persistedGraph()),
    );
  });

  it('⭐⭐ a diverged expected_label refuses and NAMES THE CURRENT LABEL', () => {
    // The gate `base_graph_hash` is structurally blind to. Without it a
    // concurrent rename is silently clobbered.
    const result = run({ expected_label: 'What we charge' });
    const refused = expectRefusal(result, 'expected_label_mismatch');
    expect(refused.response.assistant_text).toContain('Unit price');
    expect(refused.response.assistant_text).toContain('What we charge');
  });

  it('⭐⭐ an expected_label divergence is NOT a 409 — the hash it would hand back is unchanged', () => {
    // The concurrency decision, pinned. Answering 409 here would return the
    // client the exact hash it already holds while telling it to "refresh and
    // reconfirm" — a recovery indistinguishable from "nothing changed".
    const result = run({ expected_label: 'What we charge' });
    if (result.kind !== 'refused') throw new Error('expected a refusal');
    expect(result.baseHashConflict).toBeUndefined();
    // And the reason the 409 would be useless is itself derived, not asserted:
    // the label change moves no analysis hash.
    const renamed = structuredClone(persistedGraph());
    (renamed.nodes as Array<Record<string, unknown>>)[1]!.label = 'Something else';
    expect(baseHashOf(renamed)).toBe(baseHashOf(persistedGraph()));
  });

  it('⭐ an unknown node id refuses', () => {
    expectRefusal(run({ node_id: 'fac_nope' }), 'node_target_not_found');
  });

  it('⭐ a DUPLICATED node id refuses rather than picking one', () => {
    const graph = persistedGraph();
    (graph.nodes as Array<Record<string, unknown>>).push({
      id: 'fac_price',
      kind: 'factor',
      label: 'Unit price',
    });
    // ⚠ The base hash is re-derived FROM THE MODIFIED GRAPH. Adding a node moves
    // the analysis hash, so reusing the default event's hash would refuse at the
    // STALE gate and this case would pass while never reaching the ambiguity
    // branch it names — a test passing for the wrong reason.
    expectRefusal(
      run({ base_graph_hash: baseHashOf(graph) }, graph),
      'node_target_ambiguous',
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('propagateRenamedLabel — update-if-present, never invent', () => {
  it('updates the matching entry only', () => {
    const graph = {
      options: [
        { id: 'a', label: 'old' },
        { id: 'b', label: 'other' },
      ],
    } as Record<string, unknown>;
    expect(propagateRenamedLabel(graph, 'a', 'new')).toBe(1);
    expect(graph.options).toEqual([
      { id: 'a', label: 'new' },
      { id: 'b', label: 'other' },
    ]);
  });

  it('an ABSENT options[] is never invented', () => {
    const graph = { nodes: [] } as Record<string, unknown>;
    expect(propagateRenamedLabel(graph, 'a', 'new')).toBe(0);
    expect('options' in graph).toBe(false);
  });

  it('a MALFORMED options[] is left exactly as found', () => {
    const graph = { options: 'not-an-array' } as Record<string, unknown>;
    expect(propagateRenamedLabel(graph, 'a', 'new')).toBe(0);
    expect(graph.options).toBe('not-an-array');
  });

  it('an already-correct entry is a no-op', () => {
    const graph = { options: [{ id: 'a', label: 'new' }] } as Record<string, unknown>;
    expect(propagateRenamedLabel(graph, 'a', 'new')).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('findStaleRenamedLabel — the postcondition, pinned directly', () => {
  it('a fully-propagated rename is clean', () => {
    expect(
      findStaleRenamedLabel(
        { nodes: [{ id: 'a', label: 'new' }], options: [{ id: 'a', label: 'new' }] },
        'a',
        'new',
      ),
    ).toBeNull();
  });

  it('catches a node that never got the new label', () => {
    expect(findStaleRenamedLabel({ nodes: [{ id: 'a', label: 'old' }] }, 'a', 'new')).toBe(
      'nodes[]',
    );
  });

  it('catches a missing node entirely', () => {
    expect(findStaleRenamedLabel({ nodes: [] }, 'a', 'new')).toBe('nodes[]');
  });

  it('catches a stale options[] mirror', () => {
    expect(
      findStaleRenamedLabel(
        { nodes: [{ id: 'a', label: 'new' }], options: [{ id: 'a', label: 'old' }] },
        'a',
        'new',
      ),
    ).toBe('options[]');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('findUnintendedStructuralChange — a rename must not retarget anything', () => {
  function g(
    nodes: ReadonlyArray<readonly [string, string]>,
    edges: ReadonlyArray<readonly [string, string]>,
  ): GraphV3T {
    return {
      nodes: nodes.map(([id, label]) => ({ id, kind: 'factor', label })),
      edges: edges.map(([from, to]) => ({
        from,
        to,
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      })),
    } as unknown as GraphV3T;
  }

  const base = g([['a', 'A'], ['b', 'B']], [['a', 'b']]);

  it('the renamed node changing its label alone is clean', () => {
    expect(findUnintendedStructuralChange(base, g([['a', 'A2'], ['b', 'B']], [['a', 'b']]), 'a'))
      .toBeNull();
  });

  // BOTH DIRECTIONS on the node set — a one-sided length check would pass one of
  // these and fail the other, which is the asymmetry defect this estate ships.
  it('catches a node ADDED', () => {
    expect(
      findUnintendedStructuralChange(base, g([['a', 'A'], ['b', 'B'], ['c', 'C']], [['a', 'b']]), 'a'),
    ).toBe('node_set_changed');
  });

  it('catches a node REMOVED', () => {
    expect(findUnintendedStructuralChange(base, g([['a', 'A']], []), 'a')).toBe(
      'node_set_changed',
    );
  });

  it('catches a node RE-KEYED at the same count', () => {
    expect(
      findUnintendedStructuralChange(base, g([['a', 'A'], ['z', 'B']], [['a', 'b']]), 'a'),
    ).toBe('node_set_changed');
  });

  it('catches an edge RETARGETED at the same count', () => {
    // The sharpest case: same edge count, different endpoints. A length-only
    // check would call this clean.
    expect(
      findUnintendedStructuralChange(base, g([['a', 'A'], ['b', 'B']], [['b', 'a']]), 'a'),
    ).toBe('edge_set_changed');
  });

  it('catches an edge ADDED', () => {
    expect(
      findUnintendedStructuralChange(
        base,
        g([['a', 'A'], ['b', 'B']], [['a', 'b'], ['b', 'a']]),
        'a',
      ),
    ).toBe('edge_set_changed');
  });

  it('⭐⭐ catches ANOTHER node being relabelled — the retargeting guard proper', () => {
    expect(
      findUnintendedStructuralChange(base, g([['a', 'A'], ['b', 'B2']], [['a', 'b']]), 'a'),
    ).toBe('other_node_relabelled');
  });

  it('⭐ and it is NOT vacuous: the same change is clean when THAT node is the target', () => {
    // The discriminating pair. The first case proves the guard bites; this one
    // proves it bites on the OBJECT, not on any label change at all.
    expect(
      findUnintendedStructuralChange(base, g([['a', 'A'], ['b', 'B2']], [['a', 'b']]), 'b'),
    ).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
/**
 * `renameMovedAnalysisHash` — the analysis-neutrality guard, unit-pinned.
 *
 * ⭐ WHY UNIT-PINNED RATHER THAN MUTANT-KILLED THROUGH THE WRITER, disclosed
 * rather than implied. A mutation battery turned this guard into `if (false)`
 * and the whole writer suite stayed GREEN — a TRUE result about reachability,
 * not missing coverage: the applier writes `label` and `provenance`, both
 * outside the hash projection, so no input the wire accepts can make a rename
 * move the hash at this tip. The honest options were to delete a guard whose
 * trigger is unreachable, fake a path to make it reachable, or pin the PREDICATE
 * directly and say so. This is the third — the same posture, and the same
 * reasoning, as `structural-delete.ts`'s `hasDanglingEdge`.
 *
 * ⭐⭐ AND THE SECOND CASE BELOW IS THE ONE THAT MATTERS. A second mutant
 * rewrote the comparison to use the UNPROJECTED base hash — the obvious, wrong
 * simplification — and ALSO survived the writer suite. That mutant is a
 * landmine, not a tidy-up: it refuses honest renames on any graph not already in
 * projected form. Measured, not argued.
 */
describe('renameMovedAnalysisHash — projected on BOTH sides, or it is a landmine', () => {
  const ctx = { scenarioId: SCENARIO_ID, turnId: TURN_ID };

  it('a label-only change moves nothing', () => {
    const base = persistedGraph();
    const after = structuredClone(base);
    (after.nodes as Array<Record<string, unknown>>)[1]!.label = 'Price per seat';
    expect(renameMovedAnalysisHash(base, after, ctx).moved).toBe(false);
  });

  it('⭐ a genuinely analysis-affecting change IS caught — the guard is not inert', () => {
    // Positive control. Without it, `moved: false` everywhere would be
    // indistinguishable from a predicate that cannot fire (trap 13).
    const base = persistedGraph();
    const after = structuredClone(base);
    (after.nodes as Array<Record<string, unknown>>)[1]!.category = 'external';
    expect(renameMovedAnalysisHash(base, after, ctx).moved).toBe(true);
  });

  it('⭐⭐ a base NOT yet in projected form is NOT reported as moved', () => {
    // THE DISCRIMINATING CASE. `reconcileTopLevelOptionsFromNodes` appends an
    // `options[]` entry for an option node missing from the roster, and
    // `options[]` is inside the hash projection — so this base's own hash moves
    // under projection with no rename involved at all. A guard comparing against
    // the UNPROJECTED base would call an honest rename analysis-affecting here
    // and refuse it.
    const base: Record<string, unknown> = {
      goal_node_id: 'goal_r',
      nodes: [
        { id: 'goal_r', kind: 'goal', label: 'Grow revenue' },
        { id: 'opt_a', kind: 'option', label: 'Ship it', interventions: {} },
      ],
      edges: [],
      options: [],
    };
    // Precondition pinned in-test: the projection really does move this base's
    // hash, or the case proves nothing (trap 13b).
    const selfProbe = renameMovedAnalysisHash(base, base, ctx);
    expect(selfProbe.baseHash).not.toBe(
      computeAnalysisAffectingGraphHash(
        base as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
      ),
    );
    // …and with that established, a pure rename over it is still neutral.
    const renamed = structuredClone(base);
    (renamed.nodes as Array<Record<string, unknown>>)[1]!.label = 'Ship in Q1';
    const projectedRenamed = renameMovedAnalysisHash(base, renamed, ctx);
    // `renamed` here is UNPROJECTED, so the honest answer depends on projecting
    // the after-side too; the writer always passes a projected graph. Assert the
    // property the writer relies on: projecting both sides agrees.
    expect(projectedRenamed.baseHash).toBe(renameMovedAnalysisHash(renamed, renamed, ctx).baseHash);
  });

  it('an unhashable after-graph counts as moved — never silently accepted', () => {
    expect(renameMovedAnalysisHash(persistedGraph(), { nodes: [], edges: [] }, ctx).moved).toBe(
      true,
    );
  });
});
