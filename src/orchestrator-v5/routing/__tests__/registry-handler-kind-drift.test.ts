/**
 * Registry ⇄ handler kind-capability drift gate.
 *
 * `HANDLER_VALIDATION_REGISTRY.<h>.accepted_entity_kinds` is a HAND-MAINTAINED
 * MIRROR of what handler `<h>` can actually target. Nothing derived it and
 * nothing checked it, and a mirror drifts silently in the direction that reads
 * as green: the routing gate quietly refuses a request the handler would have
 * served, and the user sees "I wasn't sure what you meant".
 *
 * THE TAXONOMY TRAP THIS GATE EXISTS TO PREVENT — read before editing either
 * list. The two lists are in DIFFERENT taxonomies:
 *
 *   handler  ALLOWED_TARGET_KINDS = ['factor','outcome','goal','risk']  (GRAPH kinds)
 *   registry accepted_entity_kinds = ['node','goal']                    (WIRE kinds)
 *
 * They are not comparable directly. `toEntityKind` collapses
 * factor/outcome/decision/risk/action → 'node', so the projection of the
 * handler list is exactly {'node','goal'} and the two AGREE. Reading them
 * side-by-side without the projection makes the registry look like it is
 * missing 'outcome', and "widening" it on that reading would be a real
 * loosening of the gate. This gate asserts the projected relationship so the
 * question is answered by the code and not by eyeballing two lists.
 *
 * Asserted BOTH directions, separately, so a failure says which invariant broke:
 *   SAFETY   registry ⊆ project(handler) — never admit what the handler can't do
 *   LIVENESS project(handler) ⊆ registry — never refuse what the handler can do
 *
 * Exhaustiveness: every registered handler must appear in HANDLER_TARGET_KINDS
 * below. A new handler that nobody classified FAILS here rather than silently
 * defaulting to "assume fine" (CLAUDE.md trap 12 — where you cannot derive,
 * the mirror must fail loud).
 */

import { describe, expect, it } from 'vitest';

import { toEntityKind } from '../graph-lookup-adapter.js';
import { HANDLER_VALIDATION_REGISTRY } from '../validation-registry.js';
import { ALLOWED_TARGET_KINDS as ADD_CONSTRAINT_TARGET_KINDS } from '../../tools/handlers/add-constraint.js';
import { SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS } from '../../tools/handlers/set-factor-value.js';
import type { EntityKind } from '../types.js';

/**
 * Declared graph-kind capability per registered handler, imported from the
 * handler itself wherever the handler HAS such a gate.
 *
 * `null` means "this handler applies no graph-kind gate of its own" — it
 * either ignores the proposal entity entirely (the no-op explanation
 * handlers) or resolves its target by another route (adjust_edge_strength
 * does its own (from,to) edge resolution at execute time). For those the
 * registry is the only gate and there is nothing to derive from, so the
 * projected assertions are skipped and only exhaustiveness applies.
 */
const HANDLER_TARGET_KINDS: Readonly<Record<string, readonly string[] | null>> = {
  add_constraint: ADD_CONSTRAINT_TARGET_KINDS,
  set_factor_value: SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS,
  run_analysis: null,
  explain_from_structure: null,
  explain_results: null,
  what_would_flip: null,
  adjust_edge_strength: null,
};

function project(graphKinds: readonly string[]): Set<EntityKind> {
  const out = new Set<EntityKind>();
  for (const k of graphKinds) {
    const wire = toEntityKind(k);
    // A handler declaring a graph kind the adapter cannot map is itself a
    // defect: the entity would be dropped from the lookup and could never be
    // targeted. Fail loudly rather than silently skipping it.
    expect(wire, `handler declares graph kind "${k}" that toEntityKind cannot map`).not.toBeNull();
    if (wire) out.add(wire);
  }
  return out;
}

describe('registry ⇄ handler kind-capability drift', () => {
  it('every registered handler is classified — a new handler cannot slip through unclassified', () => {
    const registered = Object.keys(HANDLER_VALIDATION_REGISTRY).sort();
    const classified = Object.keys(HANDLER_TARGET_KINDS).sort();
    expect(
      registered,
      'A handler was added to HANDLER_VALIDATION_REGISTRY without declaring its graph-kind ' +
        'capability here. Add it to HANDLER_TARGET_KINDS — export the handler\'s own allowlist ' +
        'if it has one, or null if it applies no graph-kind gate.',
    ).toEqual(classified);
  });

  for (const [handlerId, graphKinds] of Object.entries(HANDLER_TARGET_KINDS)) {
    if (graphKinds === null) continue;

    describe(handlerId, () => {
      const decl = HANDLER_VALIDATION_REGISTRY[handlerId];
      const projected = project(graphKinds);
      const accepted = new Set(decl?.accepted_entity_kinds ?? []);

      it('SAFETY: registry ⊆ project(handler) — the gate never admits a kind the handler cannot target', () => {
        const extra = [...accepted].filter((k) => !projected.has(k));
        expect(
          extra,
          `registry accepts ${JSON.stringify(extra)} which projects to no declared handler kind ` +
            `(handler declares ${JSON.stringify(graphKinds)})`,
        ).toEqual([]);
      });

      it('LIVENESS: project(handler) ⊆ registry — the gate never refuses a kind the handler CAN target', () => {
        const missing = [...projected].filter((k) => !accepted.has(k));
        expect(
          missing,
          `handler can target ${JSON.stringify(graphKinds)} which projects to ` +
            `${JSON.stringify([...projected])}, but the registry omits ${JSON.stringify(missing)} — ` +
            'the routing gate will refuse requests this handler would have served',
        ).toEqual([]);
      });
    });
  }

  it('pins the taxonomy projection itself — a new graph node kind must be classified deliberately', () => {
    // If a node kind is added to the graph schema and NOT added to
    // toEntityKind, buildGraphLookup drops it (dropped_by_unknown_kind) and it
    // becomes untargetable — a silent capability loss. Pin the mapping so that
    // change has to be made on purpose.
    expect({
      option: toEntityKind('option'),
      goal: toEntityKind('goal'),
      factor: toEntityKind('factor'),
      outcome: toEntityKind('outcome'),
      decision: toEntityKind('decision'),
      risk: toEntityKind('risk'),
      action: toEntityKind('action'),
      unknown_future_kind: toEntityKind('unknown_future_kind'),
    }).toEqual({
      option: 'option',
      goal: 'goal',
      factor: 'node',
      outcome: 'node',
      decision: 'node',
      risk: 'node',
      action: 'node',
      unknown_future_kind: null,
    });
  });

  it('add_constraint specifically: the projection is exactly the registry entry (the refuted "widen it" reading)', () => {
    // Recorded because a diagnosis proposed widening this entry on the reading
    // that the handler "also accepts outcome" while the registry did not.
    // 'outcome' IS accepted — via 'node'. The lists already agree exactly.
    expect([...project(ADD_CONSTRAINT_TARGET_KINDS)].sort()).toEqual(['goal', 'node']);
    expect([...(HANDLER_VALIDATION_REGISTRY.add_constraint?.accepted_entity_kinds ?? [])].sort()).toEqual(
      ['goal', 'node'],
    );
  });
});
