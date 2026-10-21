/**
 * SELECTION-AWARE ANSWERING (hop 4b) — `projectGroundedSelection`, the WIRE
 * projection, pinned as a pure function.
 *
 * WHAT THIS FILE PINS, AND WHY EACH ONE EXISTS
 * -------------------------------------------
 *  1. POSITIVE CONTROL (trap #13, and trap #16-inverse). Every fixture here is
 *     a `TurnSelection`, and a fixture you wrote yourself is not evidence about
 *     the producer. The first block therefore drives the REAL producer
 *     (`resolveTurnSelection` — the function `buildTurnContext` calls to build
 *     `context.selection`) over a REAL graph, and asserts the objects these
 *     tests feed the projection are the objects the producer actually emits.
 *     If the producer's shape moves, nothing below may keep passing against a
 *     fiction.
 *
 *  2. IDENTITY BINDING (trap #19). `element_ids` is asserted by EXACT id, never
 *     by a value predicate another element could satisfy, and with a
 *     DISCRIMINATING PAIR — a different selected element must produce a
 *     different `element_ids`, asserted UNEQUAL. Neither arm alone proves
 *     binding; the inequality does.
 *
 *  3. THE THREE-STATE `unresolved` DISCRIMINATION — the guard the whole design
 *     exists for. `not_in_model` ("the graph was read and does not hold it")
 *     and `could_not_check` ("the graph could not be read") MUST produce
 *     DIFFERENT values on OTHERWISE IDENTICAL input. Asserted as a PAIR, not
 *     one at a time: a mutant collapsing both to one constant passes every
 *     single-direction assertion (trap #22b — a guard watching one door).
 *
 *  4. ⭐ THE ID SOURCE. `projectFocus` runs every id through
 *     `boundText(el.id, FOCUS_ID_MAX_CHARS)` for prompt safety, so a long id
 *     reaches the prompt carrying an ellipsis — and an ellipsised id matches NO
 *     node on the canvas. The wire must therefore read the CANONICAL id from
 *     `TurnSelection`, not the prompt-bounded one from `focus.elements`. This
 *     is a real defect the implementation avoided (the ready-to-apply spec
 *     specified `focus.elements[].id`), and the test below is what keeps it
 *     avoided.
 *
 *  5. THE CAP IS NOT RECOMPUTED. `focus.elements.length` IS the element cap as
 *     it actually applied on this turn, so the wire set is the prompt set. A
 *     second cap here would be a second authority (trap #21).
 *
 *  6. FAIL CLOSED. A focus with no selection emits NO ids rather than a set the
 *     projection cannot vouch for — and never throws.
 */

/*
 * ⚠ DELETION 8 (track2, 22 Oct 2026): `projectGroundedSelection` has no non-test
 * caller (`route-v2.ts` and `debug-fields.ts` import only its TYPE), and the
 * focus it consumed came from the deleted `projectFocus`. Its rows were dropped
 * (original in `evidence/track2-deletion8-20261022/deleted/`). What stays is the
 * row that pins the LIVE producer, `resolveTurnSelection`.
 */

import { describe, expect, it } from 'vitest';

import { resolveTurnSelection, type TurnSelection } from '../../build-turn-context.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FACTOR_ID = 'factor_salary';
const FACTOR_LABEL = 'Engineer salary in the local market';
const OPTION_ID = 'opt_local';
const OPTION_LABEL = 'Hire locally';
const OTHER_FACTOR_ID = 'factor_ramp';
const OTHER_FACTOR_LABEL = 'Ramp-up time for a new joiner';

/** A persisted graph in the shape `resolveTurnSelection` parses (NodeV3). */
const GRAPH = {
  nodes: [
    {
      id: FACTOR_ID,
      kind: 'factor',
      label: FACTOR_LABEL,
      description: 'What a senior engineer costs in this market.',
      category: 'external',
      observed_state: { value: 95000, unit: 'GBP', source: 'user_edited' },
    },
    {
      id: OTHER_FACTOR_ID,
      kind: 'factor',
      label: OTHER_FACTOR_LABEL,
      observed_state: { value: 12, unit: 'weeks', source: 'cee_inference' },
    },
    { id: OPTION_ID, kind: 'option', label: OPTION_LABEL },
    { id: 'opt_offshore', kind: 'option', label: 'Offshore partner' },
    { id: 'goal_rev', kind: 'goal', label: 'Revenue growth over the next year' },
  ],
  edges: [{ from: FACTOR_ID, to: 'goal_rev', strength: { mean: 0.4, std: 0.1 } }],
};

/** The REAL producer, over the REAL graph — never a hand-shaped selection. */
function selectionFor(ids: readonly string[], graph: unknown = GRAPH): TurnSelection {
  const resolved = resolveTurnSelection(ids, graph, 'ok_present');
  if (resolved === null) throw new Error('fixture: resolveTurnSelection returned null');
  return resolved;
}

describe('POSITIVE CONTROL — the producer’s real shapes', () => {
  it('a `TurnSelection` from `resolveTurnSelection` itself carries the canonical id and label', () => {
    // `buildTurnContext` sets `context.selection` from this exact function, so
    // driving the producer here is driving the real input, not a lookalike.
    const selection: TurnSelection = selectionFor([FACTOR_ID]);
    expect(selection.graph_read).toBe('ok_present');
    expect(selection.requested_ids).toEqual([FACTOR_ID]);
    expect(selection.unresolved_ids).toEqual([]);
    // Bound by IDENTITY — the canonical id is present on the producer's own
    // element.
    expect(selection.elements.map((e) => e.id)).toEqual([FACTOR_ID]);
    expect(selection.elements[0]!.label).toBe(FACTOR_LABEL);
  });
});
