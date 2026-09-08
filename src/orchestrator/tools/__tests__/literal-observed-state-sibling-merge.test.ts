/**
 * CORRECTION INTEGRITY — the LITERAL `observed_state` whole-object write wipes
 * `unit` / `cap` / `raw_value`, while the ALIAS spelling of the SAME intent
 * merges them.
 *
 * ── The defect, derived at the bytes (staging ae6284b8) ────────────────────
 * `canonicaliseUpdateNodeValue` (`canonicalise-value-ops.ts:188`) branches on
 * `NODE_DECLARED_FIELDS`, which is `Object.keys(NodeV3.shape)` and therefore
 * CONTAINS `observed_state`:
 *
 *     if (NODE_DECLARED_FIELDS.has(key)) { out[key] = to; continue; }
 *
 * So the op key decides the semantics, and the two spellings of one intent
 * diverge:
 *
 *   · `{ 'data/value': 0.4 }`        → 2 segments, root in
 *     OBSERVED_ROOT_SPELLINGS → translated → MERGED onto the node's existing
 *     observed_state (`{ ...existing, ...explicit, ...observedPatch }`).
 *   · `{ 'observed_state/value': 0.4 }` → likewise MERGED (the whole key is
 *     not a declared field name).
 *   · `{ data: { value: 0.4 } }`     → not declared → whole-root branch →
 *     MERGED.
 *   · `{ observed_state: { value: 0.4 } }` → DECLARED → returned VERBATIM,
 *     `observedPatch` stays null, `canonicaliseUpdateNodeValue` returns null,
 *     and `canonicaliseValueOps` hands the op back BY REFERENCE.
 *
 * `applyUpdateNode` (`patch-applier.ts:128`) then whole-object replaces it:
 * `NODE_REQUIRED_NESTED_FIELDS` is `requiredNestedObjectFields(NodeV3)`, and
 * every object-typed NodeV3 field is `.optional()` (i.e. `ZodOptional`, not
 * `ZodObject`), so the set is EMPTY, `observed_state` lands in
 * `scalarUpdates`, and `Object.assign(node, scalarUpdates)` drops the
 * siblings outright.
 *
 * The module already RECORDS this, in `reconcileObservedValuePair`'s own
 * comment: "A literal nested `{ observed_state: { value } }` op takes the
 * declared-field branch, is never merged, and the applier's whole-object
 * replace then drops `unit`/`cap`/`raw_value` outright … That sibling WIPE is
 * a real and separate defect". This file closes it.
 *
 * ── Why the loss matters (named consumers, not a vibe) ─────────────────────
 * `buildFactorScaleMap` grants `normalisedConvention` only when `raw_value` is
 * present, and that flag is the sole evidence gate for the egress scale net's
 * `cap_denormalised` rule — dropping the pair changes what PLoT/ISL computes
 * on by a factor of `cap` (£20,000 → 0.2). `cap` itself is whitelisted as
 * analysis-affecting by `graph-hash.ts`.
 *
 * ── Why the assertions are POSITIVE and identity-bound ─────────────────────
 * Every expectation names the number it expects (never `not.toBe`), and every
 * lookup binds by node ID. `fac_other` carries a BYTE-IDENTICAL
 * observed_state precisely so a value-predicate assertion would be ambiguous
 * (trap 19) — it must come out untouched.
 *
 * The two spellings are asserted to AGREE. That agreement is the property:
 * one predicate, one outcome, whichever vocabulary the edit LLM reaches for.
 */
import { describe, it, expect } from 'vitest';

import {
  canonicaliseValueOps,
  stampUserEditProvenance,
  reconcileObservedValuePair,
} from '../../canonicalise-value-ops.js';
import { applyPatchOperations } from '../../patch-applier.js';
import type { PatchOperation } from '../../types.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

/**
 * TWO factors carrying an IDENTICAL observed_state. Identity binding is
 * therefore load-bearing: "the factor whose value is 0.4" could match either
 * after a mutation.
 */
function buildGraph() {
  return {
    nodes: [
      { id: 'dec_x', kind: 'decision', label: 'Budget' },
      { id: 'opt_a', kind: 'option', label: 'Increase spend' },
      {
        id: 'fac_spend',
        kind: 'factor',
        label: 'Marketing spend',
        observed_state: { value: 0.2, raw_value: 20000, unit: '£', cap: 100000 },
      },
      {
        id: 'fac_other',
        kind: 'factor',
        label: 'Support spend',
        observed_state: { value: 0.2, raw_value: 20000, unit: '£', cap: 100000 },
      },
      { id: 'goal_g', kind: 'goal', label: 'Total return' },
    ],
    edges: [
      { from: 'opt_a', to: 'fac_spend', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_a', to: 'fac_other', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'fac_spend', to: 'goal_g', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'fac_other', to: 'goal_g', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    ],
  };
}

function nodeOf(graph: unknown, id: string): Record<string, unknown> {
  const nodes = (graph as { nodes: Record<string, unknown>[] }).nodes;
  const found = nodes.find((n) => n.id === id);
  if (found === undefined) throw new Error(`node ${id} not in graph`);
  return found;
}

function observedOf(graph: unknown, id: string): Record<string, unknown> {
  return nodeOf(graph, id).observed_state as Record<string, unknown>;
}

/**
 * The COMPOSED chain both live apply seams run, in their order:
 * `edit-graph.ts:3018-3062` and `gm-held-execute.ts:495-510`. Composed here
 * rather than restated, so this file cannot drift from the seam it pins.
 */
function runChain(ops: PatchOperation[], graph: unknown): GraphV3T {
  const canonicalised = stampUserEditProvenance(
    canonicaliseValueOps(ops, graph).operations,
    ops,
  );
  const toApply = reconcileObservedValuePair(canonicalised, graph);
  return applyPatchOperations(graph as GraphV3T, toApply as PatchOperation[]);
}

describe('literal observed_state write — siblings survive (correction integrity)', () => {
  /**
   * PRECONDITION PINNED IN-TEST. If the fixture ever stopped carrying `cap`
   * and `raw_value`, every survival assertion below would pass vacuously
   * (trap 13b: a guard whose discrimination depends on an unpinned fixture).
   */
  it('the fixture really carries the siblings this test claims survive', () => {
    const before = observedOf(buildGraph(), 'fac_spend');
    expect(before.cap).toBe(100000);
    expect(before.raw_value).toBe(20000);
    expect(before.unit).toBe('£');
  });

  it('a LITERAL whole-object observed_state write keeps unit and cap', () => {
    const graph = buildGraph();
    const ops: PatchOperation[] = [
      { op: 'update_node', path: 'fac_spend', value: { observed_state: { value: 0.4 } } } as PatchOperation,
    ];

    const applied = runChain(ops, graph);
    const after = observedOf(applied, 'fac_spend');

    expect(after.value).toBe(0.4);
    expect(after.unit).toBe('£');
    expect(after.cap).toBe(100000);
    // `reconcileObservedValuePair` re-derives the denormalised sibling from the
    // NEW value (0.4 × cap 100000). The stale 20000 must never survive.
    expect(after.raw_value).toBe(40000);
  });

  it('the ALIAS spelling of the same intent produces the SAME observed_state', () => {
    const literal = observedOf(
      runChain(
        [{ op: 'update_node', path: 'fac_spend', value: { observed_state: { value: 0.4 } } } as PatchOperation],
        buildGraph(),
      ),
      'fac_spend',
    );
    const alias = observedOf(
      runChain(
        [{ op: 'update_node', path: 'fac_spend', value: { 'data/value': 0.4 } } as PatchOperation],
        buildGraph(),
      ),
      'fac_spend',
    );

    // The alias arm is the CONTRAST CONTROL: it passes at pristine, so a red
    // here is about the literal arm and not about the harness.
    expect(alias).toEqual({
      value: 0.4,
      unit: '£',
      cap: 100000,
      raw_value: 40000,
      source: 'user_override',
    });
    expect(literal).toEqual(alias);
  });

  it('the sibling factor with a byte-identical observed_state is untouched', () => {
    const applied = runChain(
      [{ op: 'update_node', path: 'fac_spend', value: { observed_state: { value: 0.4 } } } as PatchOperation],
      buildGraph(),
    );
    expect(observedOf(applied, 'fac_other')).toEqual({
      value: 0.2,
      raw_value: 20000,
      unit: '£',
      cap: 100000,
    });
  });

  /**
   * An EXPLICIT sibling write still wins over the node's stored value — the
   * merge is `{ ...existing, ...explicit }`, never the reverse. Without this,
   * the fix would make it impossible to CHANGE a unit, trading one silent
   * failure for another (trap 22b: two harms cannot share one predicate).
   */
  it('an explicit sibling in the same op still overrides the stored one', () => {
    const applied = runChain(
      [
        {
          op: 'update_node',
          path: 'fac_spend',
          value: { observed_state: { value: 0.4, cap: 200000 } },
        } as PatchOperation,
      ],
      buildGraph(),
    );
    const after = observedOf(applied, 'fac_spend');
    expect(after.cap).toBe(200000);
    expect(after.unit).toBe('£');
    expect(after.raw_value).toBe(80000);
  });
});
