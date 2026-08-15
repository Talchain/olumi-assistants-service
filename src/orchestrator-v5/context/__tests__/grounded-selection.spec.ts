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

import { describe, expect, it } from 'vitest';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { resolveTurnSelection, type TurnSelection } from '../../build-turn-context.js';
import {
  assembleContextPack,
  buildAnalysisIdentityIndex,
  projectFocus,
  FOCUS_ID_MAX_CHARS,
  FOCUS_MAX_ELEMENTS,
  type ContextPackFocus,
} from '../context-pack-assembler.js';
import { formatAnalysisForContext } from '../../format/format-analysis-for-context.js';
import { projectGroundedSelection } from '../grounded-selection.js';

// ---------------------------------------------------------------------------
// Fixtures — the same graph/analysis pair the hop-4 focus suite uses, so the
// two files describe ONE producer rather than two private worlds.
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

const ANALYSIS = {
  winner: { option_id: OPTION_ID, option_label: OPTION_LABEL, win_probability: 0.62 },
  options: [
    { option_id: OPTION_ID, option_label: OPTION_LABEL, win_probability: 0.62 },
    { option_id: 'opt_offshore', option_label: 'Offshore partner', win_probability: 0.38 },
  ],
  top_drivers: [
    { factor_id: FACTOR_ID, factor_label: FACTOR_LABEL, sensitivity: 0.42, direction: 'positive' },
    {
      factor_id: OTHER_FACTOR_ID,
      factor_label: OTHER_FACTOR_LABEL,
      sensitivity: 0.11,
      direction: 'negative',
    },
  ],
  robustness_level: 'moderate',
  fragile_edge_count: 1,
  margin: 0.24,
  margin_pp: 24,
  analysis_status: 'computed',
} as unknown as Parameters<typeof assembleContextPack>[0]['analysis'];

const DISPLAY = formatAnalysisForContext(
  assembleContextPack({
    payload: makeMessagePayload({ scenario_id: 'scen-grounded-display', message: 'why?' }),
    priorTurns: [],
    priorFacts: [],
    analysis: ANALYSIS,
    graph: GRAPH as never,
  }).analysis,
);

const LABEL_INDEX = buildAnalysisIdentityIndex(ANALYSIS);

/** The REAL producer, over the REAL graph — never a hand-shaped selection. */
function selectionFor(ids: readonly string[], graph: unknown = GRAPH): TurnSelection {
  const resolved = resolveTurnSelection(ids, graph, 'ok_present');
  if (resolved === null) throw new Error('fixture: resolveTurnSelection returned null');
  return resolved;
}

/** The focus this turn's routing prompt would have carried, from the REAL projection. */
function focusFor(selection: TurnSelection): ContextPackFocus {
  const focus = projectFocus(selection, DISPLAY, LABEL_INDEX, true);
  if (focus === null) throw new Error('fixture: projectFocus returned null');
  return focus;
}

// ---------------------------------------------------------------------------
// 1. POSITIVE CONTROL — the inputs are what the producer really emits
// ---------------------------------------------------------------------------

describe('POSITIVE CONTROL — the fixtures are the producer’s real shapes', () => {
  it('the selection fed to the projection is a `TurnSelection` from `resolveTurnSelection` itself', () => {
    // `buildTurnContext` sets `context.selection` from this exact function
    // (build-turn-context.ts: `const turnSelection = resolveTurnSelection(...)`
    // → `...(turnSelection !== null ? { selection: turnSelection } : {})`), and
    // the turn-executor hands THAT object to `projectGroundedSelection`. So
    // driving the producer here is driving the real input, not a lookalike.
    const selection: TurnSelection = selectionFor([FACTOR_ID]);
    expect(selection.graph_read).toBe('ok_present');
    expect(selection.requested_ids).toEqual([FACTOR_ID]);
    expect(selection.unresolved_ids).toEqual([]);
    // Bound by IDENTITY — the canonical id is present on the producer's own
    // element, which is the premise the whole wire projection rests on.
    expect(selection.elements.map((e) => e.id)).toEqual([FACTOR_ID]);
    expect(selection.elements[0]!.label).toBe(FACTOR_LABEL);
  });

  it('the focus fed to the projection is a `ContextPackFocus` from `projectFocus` itself', () => {
    // The other half of the same premise: the turn-executor captures
    // `contextPack.focus`, which `assembleContextPack` sets from `projectFocus`.
    const focus = focusFor(selectionFor([FACTOR_ID]));
    expect(focus.elements.map((e) => e.id)).toEqual([FACTOR_ID]);
    expect(focus.unresolved).toBe('none');
    expect(focus.requested_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. IDENTITY BINDING + THE DISCRIMINATING PAIR
// ---------------------------------------------------------------------------

describe('projectGroundedSelection — `element_ids` is bound by IDENTITY', () => {
  it('a resolved selection projects the selected element’s EXACT canonical id', () => {
    const selection = selectionFor([FACTOR_ID]);
    const grounded = projectGroundedSelection(focusFor(selection), selection);
    expect(grounded).not.toBeNull();
    // Exact equality against the exact id — not `toContain`, which cannot see
    // an extra id, and not a value predicate another element could satisfy.
    expect(grounded!.element_ids).toEqual([FACTOR_ID]);
    expect(grounded!.unresolved).toBe('none');
  });

  it('DISCRIMINATING PAIR — a DIFFERENT selected element projects DIFFERENT `element_ids`', () => {
    const a = selectionFor([FACTOR_ID]);
    const b = selectionFor([OPTION_ID]);
    const groundedA = projectGroundedSelection(focusFor(a), a)!;
    const groundedB = projectGroundedSelection(focusFor(b), b)!;
    // Both arms asserted positively…
    expect(groundedA.element_ids).toEqual([FACTOR_ID]);
    expect(groundedB.element_ids).toEqual([OPTION_ID]);
    // …and the INEQUALITY, which is the half that proves binding rather than
    // mere sensitivity. A projection returning a constant passes each arm's
    // "is defined" shape check and dies here.
    expect(groundedA.element_ids).not.toEqual(groundedB.element_ids);
  });

  it('a MULTI-element selection carries every resolved id, and only those', () => {
    const selection = selectionFor([FACTOR_ID, OPTION_ID]);
    const grounded = projectGroundedSelection(focusFor(selection), selection)!;
    expect([...grounded.element_ids].sort()).toEqual([FACTOR_ID, OPTION_ID].sort());
    expect(grounded.element_ids).toHaveLength(2);
  });

  it('an UNRESOLVED id contributes NO id — nothing is invented for a node the graph lacks', () => {
    const selection = selectionFor([FACTOR_ID, 'ghost_node']);
    const grounded = projectGroundedSelection(focusFor(selection), selection)!;
    expect(grounded.element_ids).toEqual([FACTOR_ID]);
    expect(grounded.unresolved).toBe('not_in_model');
  });

  /**
   * ⚠ CORRECTED PREMISE, PINNED RATHER THAN INHERITED.
   *
   * `GroundedSelection.element_ids`'s docstring says the ids arrive "in the
   * order the turn requested them". They do not: `resolveTurnSelection` walks
   * the PERSISTED GRAPH's node array and pushes matches in GRAPH order, so a
   * turn requesting [option, factor] against a graph storing [factor, …,
   * option] yields [factor, option].
   *
   * That is not a defect — the wire order is identical to the PROMPT order,
   * because both slice the same `selection.elements` array, and that identity
   * is the property the field actually needs. It IS a false sentence in a
   * docstring, which is this estate's dominant defect class, so it is pinned
   * here at the behaviour rather than left to be re-derived by whoever next
   * relies on the comment.
   */
  it('ORDER — `element_ids` follows the PERSISTED GRAPH order, not the request order (the docstring says otherwise)', () => {
    const requested = [OPTION_ID, FACTOR_ID];
    const selection = selectionFor(requested);
    const focus = focusFor(selection);
    const grounded = projectGroundedSelection(focus, selection)!;
    // The request order, pinned in-test so this cannot pass by coincidence.
    expect(selection.requested_ids).toEqual(requested);
    // The graph stores the factor first.
    expect(grounded.element_ids).toEqual([FACTOR_ID, OPTION_ID]);
    expect(grounded.element_ids).not.toEqual(requested);
    // THE PROPERTY THAT ACTUALLY MATTERS: wire order === prompt order, so a
    // consumer highlighting `element_ids[i]` is highlighting the element the
    // model saw at `focus.elements[i]`.
    expect(grounded.element_ids).toEqual(focus.elements.map((e) => e.id));
  });
});

// ---------------------------------------------------------------------------
// 3. ABSENCE — no focus ⇒ null ⇒ KEY ABSENT, never a null-valued key
// ---------------------------------------------------------------------------

describe('projectGroundedSelection — absence', () => {
  it('`focus === undefined` ⇒ returns null (the caller omits the key entirely)', () => {
    expect(projectGroundedSelection(undefined, selectionFor([FACTOR_ID]))).toBeNull();
  });

  it('`focus === undefined` AND no selection ⇒ still null, never a shaped empty object', () => {
    const grounded = projectGroundedSelection(undefined, undefined);
    expect(grounded).toBeNull();
    // Explicitly NOT an object with empty ids: `{element_ids: []}` would ride
    // the wire as `_grounded_selection` on every un-selected turn and break the
    // byte-identity guarantee the sidecar is sold on.
    expect(grounded).not.toEqual({ element_ids: [], unresolved: 'none' });
  });
});

// ---------------------------------------------------------------------------
// 4. THE THREE-STATE DISCRIMINATION — the guard this design exists for
// ---------------------------------------------------------------------------

describe('projectGroundedSelection — `unresolved` never conflates "not there" with "could not look"', () => {
  /**
   * Three selections identical in EVERY field except `graph_read`. Hand-built
   * on purpose: `resolveTurnSelection` takes `graph_read` as a parameter and
   * copies it through unchanged (pinned by the positive control above), and a
   * `degraded` read is precisely the case where no graph is available to
   * resolve against.
   */
  function unresolvedSelection(graphRead: TurnSelection['graph_read']): TurnSelection {
    return {
      requested_ids: ['ghost_a', 'ghost_b'],
      elements: [],
      unresolved_ids: ['ghost_a', 'ghost_b'],
      graph_read: graphRead,
    };
  }

  function groundedFor(graphRead: TurnSelection['graph_read']) {
    const selection = unresolvedSelection(graphRead);
    return projectGroundedSelection(focusFor(selection), selection)!;
  }

  it('ok_present + unresolved ids ⇒ not_in_model, with an HONESTLY EMPTY id list', () => {
    const grounded = groundedFor('ok_present');
    expect(grounded.unresolved).toBe('not_in_model');
    // Empty is meaningful, not a failure: the turn pointed at something and
    // nothing resolvable came back. `unresolved` is what says why.
    expect(grounded.element_ids).toEqual([]);
  });

  it('ok_absent + unresolved ids ⇒ not_in_model (the graph WAS read; it stores none)', () => {
    expect(groundedFor('ok_absent').unresolved).toBe('not_in_model');
  });

  it('degraded + unresolved ids ⇒ could_not_check (the graph could NOT be read)', () => {
    expect(groundedFor('degraded').unresolved).toBe('could_not_check');
  });

  it('THE PAIR — ok_present and degraded produce DIFFERENT values on OTHERWISE IDENTICAL input', () => {
    const present = groundedFor('ok_present');
    const degraded = groundedFor('degraded');
    // PRECONDITION, pinned in-test (trap #13b): the two inputs really are
    // identical apart from `graph_read`, so the difference below can only be
    // the projection's doing.
    expect({ ...unresolvedSelection('ok_present'), graph_read: 'X' }).toEqual({
      ...unresolvedSelection('degraded'),
      graph_read: 'X',
    });
    // A mutant collapsing `unresolved` to one constant passes every
    // single-direction assertion above and dies HERE.
    expect(present.unresolved).not.toBe(degraded.unresolved);
  });

  it('THE PAIR — ok_absent and degraded ALSO differ (a read that found nothing ≠ a read that failed)', () => {
    expect(groundedFor('ok_absent').unresolved).not.toBe(groundedFor('degraded').unresolved);
  });

  it('THE PAIR — `none` and `not_in_model` differ (a fully-resolved turn is not an unresolved one)', () => {
    const resolved = selectionFor([FACTOR_ID]);
    const groundedResolved = projectGroundedSelection(focusFor(resolved), resolved)!;
    expect(groundedResolved.unresolved).toBe('none');
    expect(groundedResolved.unresolved).not.toBe(groundedFor('ok_present').unresolved);
  });

  it('COPIED VERBATIM — the wire value is the focus value, never a second derivation', () => {
    // One authority (trap #21). If this projection ever re-derived the reason
    // from `graph_read` itself, the two could disagree the first time
    // `deriveUnresolved` changed. Asserted for every state.
    for (const graphRead of ['ok_present', 'ok_absent', 'degraded'] as const) {
      const selection = unresolvedSelection(graphRead);
      const focus = focusFor(selection);
      expect(projectGroundedSelection(focus, selection)!.unresolved).toBe(focus.unresolved);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. ⭐ THE ID SOURCE — the defect the implementation avoided
// ---------------------------------------------------------------------------

describe('projectGroundedSelection — the ids are the CANONICAL ones, not the prompt-bounded ones', () => {
  // Longer than FOCUS_ID_MAX_CHARS (96), so `boundText` MUST truncate it on the
  // prompt side. Long ids are not a contrivance: `TurnSelection.requested_ids`
  // is unbounded at ingress, which is exactly why `projectFocus` bounds them.
  const LONG_ID = `factor_${'x'.repeat(140)}`;
  const LONG_GRAPH = {
    nodes: [
      { id: LONG_ID, kind: 'factor', label: 'A factor with a very long id' },
      { id: 'goal_long', kind: 'goal', label: 'Some goal' },
    ],
    edges: [],
  };

  it('PRECONDITION — the id genuinely exceeds the prompt bound, so the truncation below is real', () => {
    // Without this the test could pass because nothing was ever truncated
    // (trap #13: an absence/difference assertion needs its presence proven).
    expect(LONG_ID.length).toBeGreaterThan(FOCUS_ID_MAX_CHARS);
    const selection = selectionFor([LONG_ID], LONG_GRAPH);
    expect(selection.elements.map((e) => e.id)).toEqual([LONG_ID]);
  });

  it('⭐ the PROMPT carries a TRUNCATED id while the WIRE carries the FULL one', () => {
    const selection = selectionFor([LONG_ID], LONG_GRAPH);
    const focus = focusFor(selection);
    const grounded = projectGroundedSelection(focus, selection)!;

    // The prompt side: bounded, and the ellipsis is the evidence.
    const promptId = focus.elements[0]!.id;
    expect(promptId).toHaveLength(FOCUS_ID_MAX_CHARS);
    expect(promptId.endsWith('…')).toBe(true);
    expect(promptId).not.toBe(LONG_ID);

    // The wire side: the canonical id, byte-for-byte.
    expect(grounded.element_ids).toEqual([LONG_ID]);
    expect(grounded.element_ids[0]).not.toBe(promptId);
    // An ellipsised id matches NO node on the canvas — this is the whole
    // reason the wire reads `TurnSelection` and not `focus.elements`.
    expect(grounded.element_ids[0]!.includes('…')).toBe(false);
  });

  it('the id it carries is the one the PERSISTED GRAPH holds (a consumer can find the node with it)', () => {
    const selection = selectionFor([LONG_ID], LONG_GRAPH);
    const grounded = projectGroundedSelection(focusFor(selection), selection)!;
    // The honest test of a canvas id: does it match a node in the graph?
    const matched = LONG_GRAPH.nodes.filter((n) => n.id === grounded.element_ids[0]);
    expect(matched).toHaveLength(1);
    // …and the bounded one does NOT, which is the harm being prevented.
    const promptId = focusFor(selection).elements[0]!.id;
    expect(LONG_GRAPH.nodes.filter((n) => n.id === promptId)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. THE CAP — the wire set IS the prompt set; nothing recomputes it
// ---------------------------------------------------------------------------

describe('projectGroundedSelection — the element cap is the focus’s, never a second one', () => {
  const OVER = FOCUS_MAX_ELEMENTS + 7;
  const BIG_GRAPH = {
    nodes: [
      ...Array.from({ length: OVER }, (_, i) => ({
        id: `factor_capped_${i}`,
        kind: 'factor',
        label: `Factor ${i}`,
      })),
      { id: 'goal_capped', kind: 'goal', label: 'Some goal' },
    ],
    edges: [],
  };
  const ALL_IDS = Array.from({ length: OVER }, (_, i) => `factor_capped_${i}`);

  it('PRECONDITION — the selection genuinely exceeds the cap and the focus genuinely cuts it', () => {
    const selection = selectionFor(ALL_IDS, BIG_GRAPH);
    expect(selection.elements).toHaveLength(OVER);
    const focus = focusFor(selection);
    expect(focus.elements).toHaveLength(FOCUS_MAX_ELEMENTS);
    expect(focus.elements_omitted).toBe(7);
  });

  it('`element_ids.length === focus.elements.length` — the wire set IS the prompt set', () => {
    const selection = selectionFor(ALL_IDS, BIG_GRAPH);
    const focus = focusFor(selection);
    const grounded = projectGroundedSelection(focus, selection)!;
    expect(grounded.element_ids).toHaveLength(focus.elements.length);
    // And not merely the same LENGTH — the same ELEMENTS, positionally. A
    // second cap applied here would have to slice the same array the same way
    // by accident to survive this.
    expect(grounded.element_ids).toEqual(
      selection.elements.slice(0, FOCUS_MAX_ELEMENTS).map((e) => e.id),
    );
    // Nothing beyond the cap leaked onto the wire.
    expect(grounded.element_ids).not.toContain(`factor_capped_${FOCUS_MAX_ELEMENTS}`);
  });

  it('an UNDER-cap selection is not truncated at all', () => {
    // The negative half of the pair: the cap must bite only when it applies.
    const selection = selectionFor([FACTOR_ID, OPTION_ID]);
    const grounded = projectGroundedSelection(focusFor(selection), selection)!;
    expect(grounded.element_ids).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 7. DEFENSIVE — fails CLOSED, never throws
// ---------------------------------------------------------------------------

describe('projectGroundedSelection — a focus without its selection fails CLOSED', () => {
  it('`selection === undefined` with a focus present ⇒ empty `element_ids`, not a throw', () => {
    const focus = focusFor(selectionFor([FACTOR_ID]));
    let grounded: ReturnType<typeof projectGroundedSelection>;
    expect(() => {
      grounded = projectGroundedSelection(focus, undefined);
    }).not.toThrow();
    expect(grounded!).not.toBeNull();
    // No ids it cannot vouch for — and the reason still comes from the focus.
    expect(grounded!.element_ids).toEqual([]);
    expect(grounded!.unresolved).toBe(focus.unresolved);
  });

  it('the fail-closed path does NOT silently invent the focus’s bounded ids', () => {
    // The tempting "fix" for the branch above is to fall back to
    // `focus.elements.map(e => e.id)` — which reintroduces the truncation
    // defect section 5 exists to prevent. Empty is the honest answer.
    const focus = focusFor(selectionFor([FACTOR_ID]));
    expect(projectGroundedSelection(focus, undefined)!.element_ids).not.toContain(FACTOR_ID);
  });
});
