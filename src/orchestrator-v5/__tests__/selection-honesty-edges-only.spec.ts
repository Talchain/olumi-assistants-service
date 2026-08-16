/**
 * P1 HONESTY — an edges-only selection vanished.
 *
 * `resolveSelectionHonesty` filters `edge_ids` through the `from→to`
 * relationship grammar. React Flow's own edge ids (`e5`, `xy-edge__a-b`)
 * do not match it, so an EDGES-ONLY selection filtered down to nothing,
 * `requestedCount` hit zero, and the function returned `null` — no focus
 * section at all. The model was then told nothing about the selection and
 * behaved as if the user had selected nothing.
 *
 * The user had clicked an edge and asked about it. The product answered as
 * though the click never happened. That is worse than saying "I could not
 * read your selection", which is what `FOCUS_INSTRUCTION` already teaches
 * the model to say for `could_not_check`:
 *
 *   "If `focus.unresolved` is `could_not_check`, say that you could not read
 *    the model to check — never say the element is missing, because you do
 *    not know that."
 *
 * ⭐ THIS FIX IS HONESTY-ONLY. It invents NO edge-id resolution scheme. An
 * opaque producer-local token still cannot prove presence OR absence in
 * canonical state — the change is that we now SAY SO instead of going quiet.
 * Resolving React Flow ids is the analysis-state/contract wave's job.
 */
import { describe, expect, it } from 'vitest';

import { resolveSelectionHonesty } from '../build-turn-context.js';

const GRAPH = {
  nodes: [
    { id: 'fac_a', kind: 'factor', label: 'A' },
    { id: 'fac_b', kind: 'factor', label: 'B' },
  ],
  edges: [{ from: 'fac_a', to: 'fac_b' }],
};

describe('C — an edges-only selection of opaque ids is DISCLOSED, not dropped', () => {
  it('React Flow ids alone produce a focus, not null', () => {
    const focus = resolveSelectionHonesty(
      { node_ids: [], edge_ids: ['e5'] },
      null,
      GRAPH,
      'ok_present',
    );
    // The whole defect in one assertion: this used to be `null`.
    expect(focus).not.toBeNull();
    expect(focus!.unresolved).toBe('could_not_check');
  });

  it('the counts describe what the USER selected, not what we could parse', () => {
    const focus = resolveSelectionHonesty(
      { node_ids: [], edge_ids: ['e5', 'xy-edge__a-b'] },
      null,
      GRAPH,
      'ok_present',
    );
    expect(focus).not.toBeNull();
    // Two edges were requested. Reporting `requested_count: 0` would be the
    // same lie one field over.
    expect(focus!.requested_count).toBe(2);
    expect(focus!.resolved_count).toBe(0);
    expect(focus!.unresolved_count).toBe(2);
  });

  it('is `could_not_check`, NEVER `not_in_model` — the two must not collapse', () => {
    // `not_in_model` asserts the edge is absent from the graph. We do not know
    // that: we could not read the id. Claiming absence would be a fabrication
    // in the confident direction, which is the worse of the two errors.
    const focus = resolveSelectionHonesty(
      { node_ids: [], edge_ids: ['e5'] },
      null,
      GRAPH,
      'ok_present',
    );
    expect(focus!.unresolved).not.toBe('not_in_model');
    expect(focus!.unresolved).not.toBe('none');
  });

  it('holds on a degraded read too', () => {
    const focus = resolveSelectionHonesty(
      { node_ids: [], edge_ids: ['e5'] },
      null,
      null,
      'degraded',
    );
    expect(focus).not.toBeNull();
    expect(focus!.unresolved).toBe('could_not_check');
  });
});

describe('C — DISCRIMINATING PAIR: the change is scoped to the opaque-edges-only case', () => {
  // Each of these was already correct and MUST be unchanged by the fix. A
  // single biting assertion above proves sensitivity to something; these prove
  // the sensitivity is to the named case and not to selection handling at
  // large.

  it('CONTROL — a genuinely empty selection is still null', () => {
    expect(
      resolveSelectionHonesty({ node_ids: [], edge_ids: [] }, null, GRAPH, 'ok_present'),
    ).toBeNull();
    expect(resolveSelectionHonesty(null, null, GRAPH, 'ok_present')).toBeNull();
    expect(resolveSelectionHonesty(undefined, null, GRAPH, 'ok_present')).toBeNull();
  });

  it('CONTROL — a grammar-shaped edge that EXISTS still resolves cleanly', () => {
    const focus = resolveSelectionHonesty(
      { node_ids: [], edge_ids: ['fac_a→fac_b'] },
      null,
      GRAPH,
      'ok_present',
    );
    expect(focus).not.toBeNull();
    expect(focus!.resolved_count).toBe(1);
    expect(focus!.unresolved).toBe('none');
  });

  it('CONTROL — a grammar-shaped edge that is genuinely ABSENT still says not_in_model', () => {
    // The discrimination that matters most: the fix must not have turned every
    // absence into "could not check". A readable id we looked up and did not
    // find is a real absence and must still be reported as one.
    const focus = resolveSelectionHonesty(
      { node_ids: [], edge_ids: ['fac_b→fac_a'] },
      null,
      GRAPH,
      'ok_present',
    );
    expect(focus).not.toBeNull();
    expect(focus!.unresolved).toBe('not_in_model');
  });

  it('CONTROL — a node selection is untouched', () => {
    const focus = resolveSelectionHonesty(
      { node_ids: ['fac_a'], edge_ids: [] },
      { requested_ids: ['fac_a'], elements: [], unresolved_ids: [], graph_read: 'ok_present' },
      GRAPH,
      'ok_present',
    );
    expect(focus).not.toBeNull();
    expect(focus!.requested_count).toBe(1);
    expect(focus!.unresolved).toBe('none');
  });
});
