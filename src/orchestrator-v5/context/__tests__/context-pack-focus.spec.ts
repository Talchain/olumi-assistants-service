/**
 * SELECTION-AWARE ANSWERING (hop 4) — the `focus` ContextPack projection.
 *
 * Hop 3 resolved the user's canvas selection against canonical state
 * (`resolveTurnSelection`, build-turn-context.ts). Hop 4 PLACES that resolved
 * selection on the ContextPack, so the answer the model authors can be grounded
 * in the element the user actually pointed at — and in that element's ANALYSIS
 * outputs, not merely its label.
 *
 * WHAT THIS FILE PINS, AND WHY EACH ONE EXISTS
 * -------------------------------------------
 *  1. POSITIVE CONTROL (trap #13). Every fixture below is a hand-written
 *     `TurnSelection`. A fixture you wrote yourself is not evidence about the
 *     producer (trap #16-inverse), so the first test drives the REAL
 *     `resolveTurnSelection` over a REAL graph and asserts the fixture shape is
 *     what the producer actually emits. If the producer's shape moves, these
 *     tests must not keep passing against a fiction.
 *
 *  2. THE THREE-STATE `graph_read` DISCRIMINATION. `ok_absent`/`ok_present`
 *     ("the element is genuinely not in the model") and `degraded` ("the model
 *     could not be read") MUST project to DIFFERENT values on OTHERWISE
 *     IDENTICAL input. This is the whole reason the field exists: without it a
 *     composer tells a user their node is gone when the truth is that CEE could
 *     not look. The tests assert the pair, not each alone — a guard that checks
 *     one direction is a guard watching one door (trap #22b).
 *
 *  3. IDENTITY BINDING (trap #19). Elements are found by ID, never by a value
 *     predicate another element could satisfy, and the discriminating pair
 *     (different selected id ⇒ different projected element, asserted UNEQUAL)
 *     proves the binding rather than mere sensitivity.
 *
 *  4. BOUNDS. The widened ingress carries NO `.max(20)` (the contract's cap is
 *     absent on `TurnSelection.requested_ids`/`unresolved_ids`), so everything
 *     serialised into a prompt is capped HERE, with disclosed omission. A
 *     hostile label must not balloon the prompt.
 *
 *  5. THE ANALYSIS JOIN, AND ITS FAIL-CLOSED AMBIGUITY RULE. See
 *     `projectFocus`'s own note: the pack's analysis projection is LABEL-KEYED
 *     (ids are discarded upstream in `projectAnalysis`), so the join is by
 *     label and is made ONLY when that label identifies exactly one thing on
 *     both sides. Ambiguous ⇒ withhold and disclose. Never guess.
 */

import { describe, expect, it } from 'vitest';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { resolveTurnSelection, type TurnSelection } from '../../build-turn-context.js';
import {
  assembleContextPack,
  projectFocus,
  FOCUS_MAX_ELEMENTS,
  FOCUS_LABEL_MAX_CHARS,
  FOCUS_DESCRIPTION_MAX_CHARS,
  buildAnalysisIdentityIndex,
  type ContextPack,
} from '../context-pack-assembler.js';
import { ContextPackSchema } from '../context-pack-schema.js';
import { formatAnalysisForContext } from '../../format/format-analysis-for-context.js';

// ---------------------------------------------------------------------------
// Fixtures — a graph, an analysis, and the selection the producer emits over it
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
  // The REAL upstream `DriverSummary` shape: `{factor_id, factor_label,
  // sensitivity, direction}`. An earlier draft of this fixture used
  // `sensitivity_value`, which `projectTopDrivers` silently filters out via
  // `isFiniteSensitivity(d.sensitivity)` — the POSITIVE CONTROL is what caught
  // it. `factor_id` is what makes the focus join an identity join.
  top_drivers: [
    { factor_id: FACTOR_ID, factor_label: FACTOR_LABEL, sensitivity: 0.42, direction: 'positive' },
    { factor_id: OTHER_FACTOR_ID, factor_label: OTHER_FACTOR_LABEL, sensitivity: 0.11, direction: 'negative' },
  ],
  robustness_level: 'moderate',
  fragile_edge_count: 1,
  margin: 0.24,
  margin_pp: 24,
  analysis_status: 'computed',
} as unknown as Parameters<typeof assembleContextPack>[0]['analysis'];

const DISPLAY = formatAnalysisForContext(
  // The assembler's own raw projection is what the display formatter consumes;
  // driving it through the REAL assembler keeps this fixture honest rather than
  // hand-shaped.
  assembleContextPack({
    payload: makeMessagePayload({ scenario_id: 'scen-focus-display', message: 'why?' }),
    priorTurns: [],
    priorFacts: [],
    analysis: ANALYSIS,
    graph: GRAPH as never,
  }).analysis,
);

/**
 * The IDENTITY INDEX the assembler builds from the UPSTREAM analysis — `node id
 * → the analysis's own label`. Built with the REAL builder over the REAL
 * fixture, never hand-written, so it cannot encode a shape the producer does
 * not emit.
 */
const LABEL_INDEX = buildAnalysisIdentityIndex(ANALYSIS);

function selectionFor(ids: readonly string[]): TurnSelection {
  const resolved = resolveTurnSelection(ids, GRAPH, 'ok_present');
  if (resolved === null) throw new Error('fixture: resolveTurnSelection returned null');
  return resolved;
}

// ---------------------------------------------------------------------------
// 1. POSITIVE CONTROL — the fixtures are the producer's real shape
// ---------------------------------------------------------------------------

describe('POSITIVE CONTROL — fixtures are what `resolveTurnSelection` actually emits', () => {
  it('a resolved element round-trips from the REAL producer with the fields focus projects', () => {
    const selection = selectionFor([FACTOR_ID]);
    expect(selection.graph_read).toBe('ok_present');
    expect(selection.unresolved_ids).toEqual([]);
    expect(selection.elements).toHaveLength(1);
    // Bound by IDENTITY, not by a value predicate another node could satisfy.
    const el = selection.elements.find((e) => e.id === FACTOR_ID);
    expect(el).toBeDefined();
    expect(el!.label).toBe(FACTOR_LABEL);
    expect(el!.kind).toBe('factor');
    expect(el!.value).toBe(95000);
    expect(el!.unit).toBe('GBP');
    expect(el!.value_source).toBe('user_edited');
  });

  it('the producer reports an unresolvable id as unresolved rather than inventing one', () => {
    const selection = resolveTurnSelection([FACTOR_ID, 'ghost_node'], GRAPH, 'ok_present');
    expect(selection!.unresolved_ids).toEqual(['ghost_node']);
    expect(selection!.elements.map((e) => e.id)).toEqual([FACTOR_ID]);
  });
});

// ---------------------------------------------------------------------------
// 2. Identity binding + the discriminating pair
// ---------------------------------------------------------------------------

describe('projectFocus — elements are bound by IDENTITY', () => {
  it('projects the selected element with its exact id, label and value', () => {
    const focus = projectFocus(selectionFor([FACTOR_ID]), DISPLAY, LABEL_INDEX);
    expect(focus).not.toBeNull();
    const el = focus!.elements.find((e) => e.id === FACTOR_ID);
    expect(el).toBeDefined();
    expect(el!.label).toBe(FACTOR_LABEL);
    expect(el!.value).toBe(95000);
    expect(el!.unit).toBe('GBP');
  });

  it('DISCRIMINATING PAIR — a different selected id projects a DIFFERENT element', () => {
    const a = projectFocus(selectionFor([FACTOR_ID]), DISPLAY, LABEL_INDEX)!;
    const b = projectFocus(selectionFor([OTHER_FACTOR_ID]), DISPLAY, LABEL_INDEX)!;
    expect(a.elements.map((e) => e.id)).toEqual([FACTOR_ID]);
    expect(b.elements.map((e) => e.id)).toEqual([OTHER_FACTOR_ID]);
    // Neither alone proves binding; the INEQUALITY does.
    expect(a.elements[0]).not.toEqual(b.elements[0]);
    expect(a.elements[0]!.label).not.toBe(b.elements[0]!.label);
  });

  it('projects the PERSISTED label, never a client-claimed one (there is no client label here to adopt)', () => {
    // The producer copies out of the persisted node; a client label that
    // disagrees cannot reach the pack because it is never an input to the
    // projection. Asserting the persisted value is what pins that.
    const focus = projectFocus(selectionFor([OPTION_ID]), DISPLAY, LABEL_INDEX)!;
    expect(focus.elements[0]!.label).toBe(OPTION_LABEL);
  });
});

// ---------------------------------------------------------------------------
// 3. Absence ⇒ key absent ⇒ byte-identity
// ---------------------------------------------------------------------------

describe('projectFocus — absence', () => {
  it('returns null when the turn carried no selection', () => {
    expect(projectFocus(undefined, DISPLAY, LABEL_INDEX)).toBeNull();
  });

  it('returns null for a selection that requested nothing (an empty selection is not a selection)', () => {
    const empty: TurnSelection = {
      requested_ids: [],
      elements: [],
      unresolved_ids: [],
      graph_read: 'ok_present',
    };
    expect(projectFocus(empty, DISPLAY, LABEL_INDEX)).toBeNull();
  });
});

describe('assembleContextPack — focus threading', () => {
  function assembleWith(selection?: TurnSelection): ContextPack {
    return assembleContextPack({
      payload: makeMessagePayload({ scenario_id: 'scen-focus', message: 'why does this matter?' }),
      priorTurns: [],
      priorFacts: [],
      analysis: ANALYSIS,
      graph: GRAPH as never,
      ...(selection !== undefined ? { selection } : {}),
    });
  }

  it('OMITS the focus key entirely when no selection was carried', () => {
    const pack = assembleWith(undefined);
    expect('focus' in pack).toBe(false);
  });

  it('BYTE-IDENTITY — a no-selection pack serialises exactly as it did before focus existed', () => {
    // The same guarantee `conversation_summary` and `older_relevant_facts` are
    // pinned by: absence is a MISSING KEY, never `focus: null`.
    const withoutField = assembleWith(undefined);
    expect(JSON.stringify(withoutField)).not.toContain('"focus"');
  });

  it('places focus on the pack when a selection was carried, and the pack still validates', () => {
    const pack = assembleWith(selectionFor([FACTOR_ID]));
    expect(pack.focus).toBeDefined();
    expect(pack.focus!.elements.map((e) => e.id)).toEqual([FACTOR_ID]);
    const parsed = ContextPackSchema.safeParse(pack);
    expect(parsed.success, JSON.stringify((parsed as { error?: unknown }).error)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4/5. THE THREE-STATE DISCRIMINATION — the mutant this design exists for
// ---------------------------------------------------------------------------

describe('projectFocus — `unresolved` never conflates "not there" with "could not look"', () => {
  /** Identical except for `graph_read`. */
  function unresolvedSelection(graphRead: TurnSelection['graph_read']): TurnSelection {
    return {
      requested_ids: ['ghost_a', 'ghost_b'],
      elements: [],
      unresolved_ids: ['ghost_a', 'ghost_b'],
      graph_read: graphRead,
    };
  }

  it('ok_present + unresolved ids ⇒ not_in_model', () => {
    const focus = projectFocus(unresolvedSelection('ok_present'), DISPLAY, LABEL_INDEX)!;
    expect(focus.unresolved).toBe('not_in_model');
    expect(focus.unresolved_count).toBe(2);
  });

  it('ok_absent + unresolved ids ⇒ not_in_model (the model was read; there is none stored)', () => {
    const focus = projectFocus(unresolvedSelection('ok_absent'), DISPLAY, LABEL_INDEX)!;
    expect(focus.unresolved).toBe('not_in_model');
  });

  it('degraded + unresolved ids ⇒ could_not_check', () => {
    const focus = projectFocus(unresolvedSelection('degraded'), DISPLAY, LABEL_INDEX)!;
    expect(focus.unresolved).toBe('could_not_check');
    expect(focus.unresolved_count).toBe(2);
  });

  it('THE PAIR — ok_present and degraded produce DIFFERENT values on otherwise IDENTICAL input', () => {
    // Asserted as a pair on purpose. Each alone passes under a mutant that
    // collapses the two states to one constant; only the inequality bites.
    const present = projectFocus(unresolvedSelection('ok_present'), DISPLAY, LABEL_INDEX)!;
    const degraded = projectFocus(unresolvedSelection('degraded'), DISPLAY, LABEL_INDEX)!;
    expect(present.unresolved).not.toBe(degraded.unresolved);
  });

  it('THE PAIR — ok_absent and degraded also differ (a read that found nothing ≠ a read that failed)', () => {
    const absent = projectFocus(unresolvedSelection('ok_absent'), DISPLAY, LABEL_INDEX)!;
    const degraded = projectFocus(unresolvedSelection('degraded'), DISPLAY, LABEL_INDEX)!;
    expect(absent.unresolved).not.toBe(degraded.unresolved);
  });

  it('everything resolved ⇒ none, and the count is zero', () => {
    const focus = projectFocus(selectionFor([FACTOR_ID, OPTION_ID]), DISPLAY, LABEL_INDEX)!;
    expect(focus.unresolved).toBe('none');
    expect(focus.unresolved_count).toBe(0);
  });

  it('a PARTIAL resolution discloses the unresolved remainder rather than dropping it silently', () => {
    const selection = resolveTurnSelection([FACTOR_ID, 'ghost'], GRAPH, 'ok_present')!;
    const focus = projectFocus(selection, DISPLAY, LABEL_INDEX)!;
    expect(focus.elements.map((e) => e.id)).toEqual([FACTOR_ID]);
    expect(focus.unresolved).toBe('not_in_model');
    expect(focus.unresolved_count).toBe(1);
    expect(focus.requested_count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 6. No raw internal coefficient leaks
// ---------------------------------------------------------------------------

describe('projectFocus — display-safe only', () => {
  const DECLARED_ELEMENT_KEYS = [
    'id',
    'kind',
    'label',
    'description',
    'category',
    'value',
    'unit',
    'display_value',
    'value_source',
    'analysis_link',
    'analysis',
  ];

  it('the projected element carries ONLY declared keys (an extra key is how a raw value leaks)', () => {
    const focus = projectFocus(selectionFor([FACTOR_ID]), DISPLAY, LABEL_INDEX)!;
    for (const el of focus.elements) {
      // EQUALITY against the declared set, not `toContain` — containment
      // cannot see an extra key, which is exactly the leak shape.
      expect(Object.keys(el).filter((k) => !DECLARED_ELEMENT_KEYS.includes(k))).toEqual([]);
    }
  });

  it('no raw edge strength / exists probability reaches focus', () => {
    const focus = projectFocus(selectionFor([FACTOR_ID, OPTION_ID]), DISPLAY, LABEL_INDEX)!;
    const serialised = JSON.stringify(focus);
    expect(serialised).not.toContain('strength');
    expect(serialised).not.toContain('exists');
    expect(serialised).not.toContain('sensitivity_value');
  });
});

// ---------------------------------------------------------------------------
// 7. BOUNDS — the ingress has no `.max(20)`, so this projection is the cap
// ---------------------------------------------------------------------------

describe('projectFocus — everything serialised into a prompt is bounded', () => {
  it('caps the projected elements at FOCUS_MAX_ELEMENTS with DISCLOSED omission', () => {
    const many = Array.from({ length: FOCUS_MAX_ELEMENTS + 7 }, (_, i) => ({
      id: `n_${i}`,
      kind: 'factor',
      label: `Factor ${i}`,
    }));
    const selection: TurnSelection = {
      requested_ids: many.map((n) => n.id),
      elements: many,
      unresolved_ids: [],
      graph_read: 'ok_present',
    };
    const focus = projectFocus(selection, DISPLAY, LABEL_INDEX)!;
    expect(focus.elements).toHaveLength(FOCUS_MAX_ELEMENTS);
    // Never a silent slice.
    expect(focus.elements_omitted).toBe(7);
    expect(focus.requested_count).toBe(FOCUS_MAX_ELEMENTS + 7);
  });

  it('omits the disclosure key entirely when nothing was cut', () => {
    const focus = projectFocus(selectionFor([FACTOR_ID]), DISPLAY, LABEL_INDEX)!;
    expect('elements_omitted' in focus).toBe(false);
  });

  it('a hostile label cannot balloon the prompt', () => {
    const selection: TurnSelection = {
      requested_ids: ['hostile'],
      elements: [
        {
          id: 'hostile',
          kind: 'factor',
          label: 'X'.repeat(50_000),
          description: 'Y'.repeat(50_000),
          unit: 'Z'.repeat(5_000),
          display_value: 'W'.repeat(5_000),
        },
      ],
      unresolved_ids: [],
      graph_read: 'ok_present',
    };
    const focus = projectFocus(selection, DISPLAY, LABEL_INDEX)!;
    const el = focus.elements[0]!;
    expect(el.label!.length).toBeLessThanOrEqual(FOCUS_LABEL_MAX_CHARS);
    expect(el.description!.length).toBeLessThanOrEqual(FOCUS_DESCRIPTION_MAX_CHARS);
    // The whole block stays small enough that a selection cannot dominate the
    // ~21k-char routing prompt.
    expect(JSON.stringify(focus).length).toBeLessThan(2_000);
  });

  it('a hostile id cannot balloon the prompt either', () => {
    const selection: TurnSelection = {
      requested_ids: ['I'.repeat(40_000)],
      elements: [{ id: 'I'.repeat(40_000), kind: 'factor', label: 'ok' }],
      unresolved_ids: [],
      graph_read: 'ok_present',
    };
    const focus = projectFocus(selection, DISPLAY, LABEL_INDEX)!;
    expect(JSON.stringify(focus).length).toBeLessThan(2_000);
  });
});

// ---------------------------------------------------------------------------
// 8. THE ANALYSIS JOIN — the amended acceptance's "uses the analysis outputs"
// ---------------------------------------------------------------------------

describe('projectFocus — the selected element carries its ANALYSIS context', () => {
  it('an OPTION element carries its win probability from the display-safe analysis', () => {
    const focus = projectFocus(selectionFor([OPTION_ID]), DISPLAY, LABEL_INDEX)!;
    const el = focus.elements.find((e) => e.id === OPTION_ID)!;
    expect(el.analysis_link).toBe('linked');
    expect(el.analysis).toBeDefined();
    // The display-safe percent string, never a raw decimal.
    expect(el.analysis!.win_probability).toBe('62%');
    expect(JSON.stringify(el.analysis)).not.toContain('0.62');
  });

  it('a FACTOR element carries its influence phrase from the display-safe analysis', () => {
    const focus = projectFocus(selectionFor([FACTOR_ID]), DISPLAY, LABEL_INDEX)!;
    const el = focus.elements.find((e) => e.id === FACTOR_ID)!;
    expect(el.analysis_link).toBe('linked');
    expect(el.analysis!.influence).toBeDefined();
    expect(typeof el.analysis!.influence).toBe('string');
    // Decision language, not a signed float.
    expect(el.analysis!.influence).toMatch(/influence/i);
  });

  it('DISCRIMINATING PAIR — two selected factors carry DIFFERENT influence phrases', () => {
    // +0.42 vs -0.11: the projection must reach the entry for THIS factor, not
    // simply the first driver in the list.
    const a = projectFocus(selectionFor([FACTOR_ID]), DISPLAY, LABEL_INDEX)!.elements[0]!;
    const b = projectFocus(selectionFor([OTHER_FACTOR_ID]), DISPLAY, LABEL_INDEX)!.elements[0]!;
    expect(a.analysis!.influence).toBeDefined();
    expect(b.analysis!.influence).toBeDefined();
    expect(a.analysis!.influence).not.toBe(b.analysis!.influence);
  });

  it('FAIL CLOSED — an ambiguous DISPLAY label withholds the join rather than guessing', () => {
    // Hop 1 (id → the analysis's own label) is an identity lookup and cannot be
    // ambiguous. Hop 2 (that label → the already-formatted display entry) CAN:
    // `projectAnalysis` strips the ids, so two display options carrying the
    // same label are indistinguishable downstream. The join must then attach
    // NOTHING — a partially-safe attachment is still a claim about which object
    // the numbers belong to.
    const collidingDisplay = {
      ...DISPLAY!,
      options: [
        { rank: '1', label: OPTION_LABEL, win_probability: '62%' },
        { rank: '2', label: OPTION_LABEL, win_probability: '38%' },
      ],
    } as unknown as typeof DISPLAY;
    const focus = projectFocus(selectionFor([OPTION_ID]), collidingDisplay, LABEL_INDEX)!;
    const el = focus.elements[0]!;
    expect(el.analysis_link).toBe('ambiguous_label');
    expect('analysis' in el).toBe(false);
  });

  it('POSITIVE CONTROL for the ambiguity guard — the SAME element links when the label is unique', () => {
    // Without this pair, the test above could pass because the element never
    // links at all. The pair is what proves the guard DISCRIMINATES rather than
    // simply never attaching anything.
    const focus = projectFocus(selectionFor([OPTION_ID]), DISPLAY, LABEL_INDEX)!;
    expect(focus.elements[0]!.analysis_link).toBe('linked');
  });

  it('the identity index is built from UPSTREAM ids, which the pack projection STRIPS', () => {
    // Pins the premise the whole join rests on, at the bytes: `option_id` and
    // `factor_id` exist on the assembler's input and are GONE from
    // `ContextPack.analysis`. If a future change carried them through, this
    // goes red and the join can be simplified.
    expect(LABEL_INDEX.byId.get(OPTION_ID)).toEqual({ label: OPTION_LABEL, kind: 'option' });
    expect(LABEL_INDEX.byId.get(FACTOR_ID)).toEqual({ label: FACTOR_LABEL, kind: 'factor' });
    // The uncapped uniqueness counts — the authority guard 1 consults.
    expect(LABEL_INDEX.idsPerLabel.get(OPTION_LABEL)).toBe(1);
    expect(LABEL_INDEX.idsPerLabel.get(FACTOR_LABEL)).toBe(1);
    const packAnalysis = assembleContextPack({
      payload: makeMessagePayload({ scenario_id: 'scen-ids', message: 'why?' }),
      priorTurns: [],
      priorFacts: [],
      analysis: ANALYSIS,
      graph: GRAPH as never,
    }).analysis;
    expect(JSON.stringify(packAnalysis)).not.toContain(OPTION_ID);
    expect(JSON.stringify(packAnalysis)).not.toContain(FACTOR_ID);
  });

  it('reports no_analysis when the turn has no analysis to join against', () => {
    const focus = projectFocus(selectionFor([OPTION_ID]), null, LABEL_INDEX)!;
    expect(focus.elements[0]!.analysis_link).toBe('no_analysis');
    expect('analysis' in focus.elements[0]!).toBe(false);
  });

  it('reports not_in_analysis for an element the analysis never scored', () => {
    const focus = projectFocus(selectionFor(['goal_rev']), DISPLAY, LABEL_INDEX)!;
    expect(focus.elements[0]!.analysis_link).toBe('not_in_analysis');
    expect('analysis' in focus.elements[0]!).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F1 — THE JOIN'S HEADLINE GUARANTEE, REFUTED BY EXECUTION AND NOW PINNED
// ---------------------------------------------------------------------------

/**
 * ⭐⭐ THE DEFECT THESE TESTS EXIST FOR, AND THE REASON THE FIRST ROUND MISSED IT.
 *
 * The shipped join claimed *"nothing is ever guessed into a different node"*.
 * That was FALSE, in two independent ways, and an independent review refuted it
 * by execution — not by reading.
 *
 * ROOT CAUSE (one sentence): hop 2's ambiguity guard ran over the DISPLAY lists
 * **after** cap/trim, while hop 1's id index was built from the **uncapped**
 * upstream — so the two authorities disagreed about whether a label was unique,
 * and the guard was asking the wrong one.
 *
 *   CLASS A — CROSS-KIND COINCIDENCE (no trimming required). An option and a
 *   factor share a label. Each display list has exactly ONE match, so no list
 *   is `many` and the guard stays silent — while the option quietly collects
 *   the FACTOR's influence figure. The per-list check cannot see a collision
 *   spread ACROSS lists, and the merged id→label index recorded no kind.
 *
 *   CLASS B — WITHIN-KIND COLLISION + A CAP. Two options share a label and the
 *   cap (`MAX_PROJECTED_OPTIONS`) drops one. Exactly one survivor remains in
 *   display, so the guard sees `one` and links the SURVIVOR's figure to the
 *   DROPPED option — a different node's number, presented as this node's.
 *   Also reachable via the driver cap and the display budget tail-trim.
 *
 * ⚠ AND THE LESSON ABOUT THE FIRST ROUND'S OWN GUARD: my original ambiguity
 * test constructed TWO SURVIVORS IN ONE LIST — the single case the shipped code
 * handled. It was a guard watching one door, and it passed while both doors
 * stood open. Every case below is therefore TWINNED: both directions of the
 * cross-kind pair, and both the dropped and the surviving side of the capped
 * pair, each with a positive control proving the guard still LINKS when the
 * label genuinely identifies one node.
 */
describe('F1 — the analysis join never attaches another node’s figures', () => {
  // ── CLASS A fixtures: an option and a factor sharing one label ───────────
  const SHARED = 'Shared Name';
  const GRAPH_A = {
    nodes: [
      { id: 'opt_x', kind: 'option', label: SHARED },
      { id: 'fac_x', kind: 'factor', label: SHARED },
      { id: 'opt_other', kind: 'option', label: 'Other Option' },
      { id: 'fac_other', kind: 'factor', label: 'Other Factor' },
      { id: 'goal_a', kind: 'goal', label: 'Some goal' },
    ],
    edges: [{ from: 'fac_x', to: 'goal_a', strength: { mean: 0.4, std: 0.1 } }],
  };
  const ANALYSIS_A = {
    winner: { option_id: 'opt_x', option_label: SHARED, win_probability: 0.62 },
    options: [
      { option_id: 'opt_x', option_label: SHARED, win_probability: 0.62 },
      { option_id: 'opt_other', option_label: 'Other Option', win_probability: 0.38 },
    ],
    top_drivers: [
      { factor_id: 'fac_x', factor_label: SHARED, sensitivity: 0.42, direction: 'positive' },
      { factor_id: 'fac_other', factor_label: 'Other Factor', sensitivity: 0.2, direction: 'positive' },
    ],
    robustness_level: 'moderate', fragile_edge_count: 0, margin: 0.24, margin_pp: 24,
    analysis_status: 'computed',
  } as unknown as Parameters<typeof assembleContextPack>[0]['analysis'];

  function displayFor(analysis: Parameters<typeof assembleContextPack>[0]['analysis'], graph: unknown) {
    return formatAnalysisForContext(
      assembleContextPack({
        payload: makeMessagePayload({ scenario_id: 'scen-f1', message: 'why?' }),
        priorTurns: [], priorFacts: [], analysis, graph: graph as never,
      }).analysis,
    );
  }
  function focusFor(
    ids: readonly string[],
    analysis: Parameters<typeof assembleContextPack>[0]['analysis'],
    graph: unknown,
  ) {
    const selection = resolveTurnSelection(ids, graph, 'ok_present');
    if (selection === null) throw new Error('fixture: no selection');
    const focus = projectFocus(selection, displayFor(analysis, graph), buildAnalysisIdentityIndex(analysis));
    if (focus === null) throw new Error('fixture: no focus');
    return focus;
  }

  describe('CLASS A — a cross-kind label coincidence', () => {
    it('POSITIVE CONTROL — the instrument links normally when labels are distinct', () => {
      // Without this the refusals below could pass because nothing ever links.
      const el = focusFor(['opt_other'], ANALYSIS_A, GRAPH_A).elements[0]!;
      expect(el.analysis_link).toBe('linked');
      expect(el.analysis!.win_probability).toBe('38%');
    });

    it('selecting the OPTION must not collect the FACTOR’s influence', () => {
      const el = focusFor(['opt_x'], ANALYSIS_A, GRAPH_A).elements[0]!;
      // The refuted behaviour attached BOTH the option's win probability AND
      // the factor's influence phrase to the option.
      expect(el.analysis?.influence).toBeUndefined();
      expect(el.analysis_link).toBe('ambiguous_label');
      expect('analysis' in el).toBe(false);
    });

    it('TWIN — selecting the FACTOR must not collect the OPTION’s win probability', () => {
      const el = focusFor(['fac_x'], ANALYSIS_A, GRAPH_A).elements[0]!;
      expect(el.analysis?.win_probability).toBeUndefined();
      expect(el.analysis_link).toBe('ambiguous_label');
      expect('analysis' in el).toBe(false);
    });
  });

  // ── CLASS B fixtures: a within-kind collision the cap hides ──────────────
  const COLLIDE = 'Collide';
  /** 13 options — one more than MAX_PROJECTED_OPTIONS — ranks 1 and 13 sharing a label. */
  function manyOptions(collide: boolean) {
    const opts = [
      { option_id: 'opt_1', option_label: collide ? COLLIDE : 'Rank one', win_probability: 0.62 },
      ...Array.from({ length: 11 }, (_, i) => ({
        option_id: `opt_mid_${i}`,
        option_label: `Middle ${i}`,
        win_probability: 0.5 - i * 0.01,
      })),
      { option_id: 'opt_13', option_label: collide ? COLLIDE : 'Rank thirteen', win_probability: 0.01 },
    ];
    return {
      winner: { option_id: 'opt_1', option_label: opts[0]!.option_label, win_probability: 0.62 },
      options: opts,
      top_drivers: [],
      robustness_level: 'moderate', fragile_edge_count: 0, margin: 0.24, margin_pp: 24,
      analysis_status: 'computed',
    } as unknown as Parameters<typeof assembleContextPack>[0]['analysis'];
  }
  function manyGraph(collide: boolean) {
    const a = manyOptions(collide) as unknown as { options: { option_id: string; option_label: string }[] };
    return {
      nodes: [
        ...a.options.map((o) => ({ id: o.option_id, kind: 'option', label: o.option_label })),
        { id: 'goal_b', kind: 'goal', label: 'Some goal' },
      ],
      edges: [],
    };
  }

  describe('CLASS B — a within-kind collision the cap hides', () => {
    it('INSTRUMENT — the cap really does drop the 13th option from the display list', () => {
      // The defect is only reachable because the display list is SHORTER than
      // the upstream one. If this stops being true the tests below go vacuous.
      const display = displayFor(manyOptions(false), manyGraph(false));
      expect(display!.options!.length).toBeLessThan(13);
      expect(display!.options!.some((o) => o.label === 'Rank thirteen')).toBe(false);
    });

    it('POSITIVE CONTROL — with distinct labels the dropped option reports not_in_analysis, not a wrong link', () => {
      const el = focusFor(['opt_13'], manyOptions(false), manyGraph(false)).elements[0]!;
      expect(el.analysis_link).toBe('not_in_analysis');
      expect('analysis' in el).toBe(false);
    });

    it('selecting the DROPPED option must not inherit the SURVIVOR’s win probability', () => {
      const el = focusFor(['opt_13'], manyOptions(true), manyGraph(true)).elements[0]!;
      // The refuted behaviour reported 62% — the survivor's figure — for an
      // option whose true probability is 1%.
      expect(el.analysis?.win_probability).not.toBe('62%');
      expect(el.analysis_link).toBe('ambiguous_label');
      expect('analysis' in el).toBe(false);
    });

    it('TWIN — selecting the SURVIVING option must ALSO refuse (two ids claim that label)', () => {
      // Both sides refuse: with two upstream claimants the display entry cannot
      // be attributed to either one, so linking the survivor would be the same
      // unfounded claim in the other direction.
      const el = focusFor(['opt_1'], manyOptions(true), manyGraph(true)).elements[0]!;
      expect(el.analysis_link).toBe('ambiguous_label');
      expect('analysis' in el).toBe(false);
    });
  });
});
