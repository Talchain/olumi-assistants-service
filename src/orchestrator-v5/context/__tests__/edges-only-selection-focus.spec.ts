/**
 * P1 HONESTY — an edges-only selection reached the model as SILENCE.
 *
 * GraphV3 has no stable `edge.id`, so the ids the canvas sends for edges are
 * producer-local React Flow tokens (`e5`). Nothing in CEE can address them, so
 * `resolveTurnSelection` produced no selection, the pack carried no `focus`
 * key, `FOCUS_INSTRUCTION` was never appended, and the model answered as
 * though the user had clicked nothing. The user HAD clicked an edge and asked
 * about it. That is Paul's manual-test defect.
 *
 * ── WHY THIS IS NOT THE FIX THAT WAS TRIED FIRST ──────────────────────────
 * A previous attempt (reverted, #992) made `resolveSelectionHonesty` return a
 * non-null summary for this case. That field's ONLY consumer is
 * `turn-executor.ts::projectZeroResolvedSelectionResponse`, which reads
 * `requested>=1 && resolved==0` as a whole-turn REFUSAL — so the "fix" replaced
 * a working answer and its chips with a canned refusal, on every edge
 * selection in the product. The refusal projection was never the seam; the
 * model-facing pack focus is.
 *
 * ── THE RULE THIS FILE EXISTS TO KEEP ─────────────────────────────────────
 * ⭐ `graph_read` and `unreadable_ref_ids` answer DIFFERENT QUESTIONS and must
 * not collapse:
 *      `graph_read`         — "could we read THE MODEL?"
 *      `unreadable_ref_ids` — "could we read WHAT THE USER POINTED AT?"
 * Expressing the second by pretending the first happened would have been the
 * cheap fix, and it would have corrupted every other consumer of `graph_read`.
 * Both can end in `could_not_check` downstream and they are still not the same
 * observation.
 */
import { describe, expect, it } from 'vitest';

import { resolveTurnSelection } from '../../build-turn-context.js';
import { buildAnalysisIdentityIndex, projectFocus } from '../context-pack-assembler.js';

// Built with the CANONICAL builder rather than hand-rolled, so this fixture
// cannot drift from the real index shape (trap 12: derive, do not mirror).
// `null` yields a genuinely empty index — these cases resolve no elements, so
// there is nothing for the analysis join to attach anyway.
const EMPTY_INDEX = buildAnalysisIdentityIndex(null);
const OPAQUE_EDGE_ID = 'e5';
const GRAPH = {
  nodes: [
    { id: 'factor_price', kind: 'factor', label: 'Price' },
    { id: 'opt_build', kind: 'option', label: 'Build' },
  ],
  edges: [{ from: 'factor_price', to: 'opt_build' }],
};

describe('(a) an edges-only selection produces a focus the model can read', () => {
  it('resolveTurnSelection returns a selection, not null', () => {
    const sel = resolveTurnSelection([], GRAPH, 'ok_present', [OPAQUE_EDGE_ID]);
    // The whole defect in one assertion: this used to be `null`, and null is
    // how the model came to be told nothing.
    expect(sel).not.toBeNull();
    expect(sel!.unreadable_ref_ids).toEqual([OPAQUE_EDGE_ID]);
    // Nothing is resolved and nothing is invented.
    expect(sel!.elements).toEqual([]);
    expect(sel!.requested_ids).toEqual([]);
    expect(sel!.unresolved_ids).toEqual([]);
  });

  it('the focus says could_not_check — NEVER not_in_model', () => {
    const sel = resolveTurnSelection([], GRAPH, 'ok_present', [OPAQUE_EDGE_ID])!;
    const focus = projectFocus(sel, null, EMPTY_INDEX)!;
    expect(focus).not.toBeNull();
    // `not_in_model` asserts the edge is absent. We never looked it up — we
    // could not parse the address. Claiming absence is the fabrication
    // direction, and it is the one this pack schema exists to prevent.
    expect(focus.unresolved).toBe('could_not_check');
    expect(focus.unresolved).not.toBe('not_in_model');
    expect(focus.unresolved).not.toBe('none');
  });

  it('⭐ the graph read was HEALTHY — could_not_check here is NOT graph_read leaking', () => {
    // The load-bearing discrimination. `graph_read` is `ok_present`: the model
    // read fine. The verdict comes from the reference being unreadable, and a
    // fix that had faked `degraded` to get this string would pass the previous
    // assertion and fail this one.
    const sel = resolveTurnSelection([], GRAPH, 'ok_present', [OPAQUE_EDGE_ID])!;
    expect(sel.graph_read).toBe('ok_present');
    expect(projectFocus(sel, null, EMPTY_INDEX)!.unresolved).toBe('could_not_check');
  });

  it('the counts describe what the USER selected', () => {
    const sel = resolveTurnSelection([], GRAPH, 'ok_present', ['e5', 'xy-edge__a-b'])!;
    const focus = projectFocus(sel, null, EMPTY_INDEX)!;
    // Reporting 0 requested for a turn where someone clicked two edges would
    // be the same silence one field over.
    expect(focus.requested_count).toBe(2);
    expect(focus.unresolved_count).toBe(2);
    expect(focus.elements).toEqual([]);
  });

  it('the pack focus carries NO new keys — the schema is unchanged', () => {
    const sel = resolveTurnSelection([], GRAPH, 'ok_present', [OPAQUE_EDGE_ID])!;
    const focus = projectFocus(sel, null, EMPTY_INDEX)!;
    // `unreadable_ref_ids` is INTERNAL to TurnSelection and must not reach the
    // model-facing pack, or this becomes a contract change.
    expect(Object.keys(focus).sort()).toEqual(
      ['elements', 'requested_count', 'unresolved', 'unresolved_count'].sort(),
    );
    expect(JSON.stringify(focus)).not.toContain('unreadable_ref_ids');
  });
});

describe('(c) CONTROL — the resolved NODE path is byte-identical', () => {
  /**
   * ⭐ CAPTURED BY EXECUTION AT THE PRE-CHANGE TIP, not reasoned out. The
   * probe was run twice with the artefact DELETED between runs, so a stale
   * file could not masquerade as a fresh result — the first attempt at this
   * capture did exactly that and had to be thrown away.
   */
  const PRISTINE_NODE_FOCUS_BYTES =
    '{"elements":[{"id":"factor_price","kind":"factor","label":"Price","unit":"GBP",'
    + '"analysis_link":"no_analysis"}],"unresolved":"not_in_model","requested_count":2,'
    + '"unresolved_count":1}';

  it('a node selection with a miss serialises EXACTLY as it did before', () => {
    const sel = {
      requested_ids: ['factor_price', 'ghost_x'],
      elements: [{ id: 'factor_price', kind: 'factor', label: 'Price', unit: 'GBP' }],
      unresolved_ids: ['ghost_x'],
      graph_read: 'ok_present' as const,
      unreadable_ref_ids: [],
    };
    expect(JSON.stringify(projectFocus(sel, null, EMPTY_INDEX))).toBe(
      PRISTINE_NODE_FOCUS_BYTES,
    );
  });

  it('a fully-resolved node selection still reports `none`', () => {
    const sel = resolveTurnSelection(['factor_price'], GRAPH, 'ok_present')!;
    expect(sel.unreadable_ref_ids).toEqual([]);
    expect(projectFocus(sel, null, EMPTY_INDEX)!.unresolved).toBe('none');
  });

  it('a degraded read on a NODE selection still reports could_not_check', () => {
    const sel = resolveTurnSelection(['ghost'], null, 'degraded')!;
    expect(projectFocus(sel, null, EMPTY_INDEX)!.unresolved).toBe('could_not_check');
  });

  it('a healthy read with a genuinely absent NODE still reports not_in_model', () => {
    // The discrimination that matters most: the fix must not have turned every
    // absence into "could not check".
    const sel = resolveTurnSelection(['ghost'], GRAPH, 'ok_present')!;
    expect(projectFocus(sel, null, EMPTY_INDEX)!.unresolved).toBe('not_in_model');
  });

  it('a genuinely empty selection is still null (no focus on a no-selection turn)', () => {
    expect(resolveTurnSelection([], GRAPH, 'ok_present')).toBeNull();
    expect(resolveTurnSelection([], GRAPH, 'ok_present', [])).toBeNull();
  });

  it('a READABLE edge ref is NOT diverted into this channel', () => {
    // `factor_price→opt_build` matches the existing grammar, so it is not
    // unreadable and must not acquire `could_not_check`. Only the producer
    // scopes this (buildTurnContext filters by the same grammar check), so
    // this pins that the channel is for UNREADABLE refs specifically.
    const sel = resolveTurnSelection([], GRAPH, 'ok_present', []);
    expect(sel).toBeNull();
  });
});

describe('MIXED selections are deliberately untouched (reported, not widened)', () => {
  it('a node selection carrying unreadable refs keeps the NODE verdict', () => {
    // Producer-side scoping means this shape is not built today; the assertion
    // pins the ASSEMBLER contract, so that if the producer is ever widened the
    // node verdict is known to survive.
    const sel = {
      requested_ids: ['factor_price'],
      elements: [{ id: 'factor_price', kind: 'factor', label: 'Price' }],
      unresolved_ids: [],
      graph_read: 'ok_present' as const,
      unreadable_ref_ids: ['e5'],
    };
    // Nothing failed to resolve, but a reference was unreadable — so the
    // honest verdict is could_not_check, and the resolved element is STILL
    // named. The user is not told their node is missing.
    const focus = projectFocus(sel, null, EMPTY_INDEX)!;
    expect(focus.elements).toHaveLength(1);
    expect(focus.unresolved).toBe('could_not_check');
  });

  it('an unresolved NODE outranks an unreadable ref — the stronger claim wins', () => {
    const sel = {
      requested_ids: ['ghost'],
      elements: [],
      unresolved_ids: ['ghost'],
      graph_read: 'ok_present' as const,
      unreadable_ref_ids: ['e5'],
    };
    // A node we looked up and did not find is a real absence; it must not be
    // softened to "could not check" just because an edge ref was unreadable.
    expect(projectFocus(sel, null, EMPTY_INDEX)!.unresolved).toBe('not_in_model');
  });
});
