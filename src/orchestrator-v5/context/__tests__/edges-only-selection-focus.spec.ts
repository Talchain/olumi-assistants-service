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
/*
 * ⚠ DELETION 8 (track2, 22 Oct 2026): `projectFocus` and
 * `buildAnalysisIdentityIndex` are deleted with the ContextPack assembler (no
 * served caller), so every row and arm that read the projected focus was
 * dropped. What stays pins the LIVE producer, `resolveTurnSelection`, including
 * the rule above: an unreadable reference never fakes an unhealthy graph read.
 */

import { describe, expect, it } from 'vitest';

import { resolveTurnSelection } from '../../build-turn-context.js';

const OPAQUE_EDGE_ID = 'e5';
const GRAPH = {
  nodes: [
    { id: 'factor_price', kind: 'factor', label: 'Price' },
    { id: 'opt_build', kind: 'option', label: 'Build' },
  ],
  edges: [{ from: 'factor_price', to: 'opt_build' }],
};

describe('(a) an edges-only selection produces a selection the model can read', () => {
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

  it('⭐ the graph read stays HEALTHY — an unreadable reference is NOT expressed through graph_read', () => {
    // The load-bearing discrimination. `graph_read` is `ok_present`: the model
    // read fine. A fix that faked `degraded` to signal the unreadable reference
    // would fail here.
    const sel = resolveTurnSelection([], GRAPH, 'ok_present', [OPAQUE_EDGE_ID])!;
    expect(sel.graph_read).toBe('ok_present');
  });
});

describe('(c) CONTROL — the resolved NODE path is unchanged', () => {
  it('a fully-resolved node selection carries NO unreadable refs', () => {
    const sel = resolveTurnSelection(['factor_price'], GRAPH, 'ok_present')!;
    expect(sel.unreadable_ref_ids).toEqual([]);
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
