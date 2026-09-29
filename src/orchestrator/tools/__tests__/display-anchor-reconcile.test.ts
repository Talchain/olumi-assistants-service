/**
 * ROADMAP 2.1003 — display-anchor reconciliation (the PRODUCER half of "the
 * screen lies").
 *
 * RED-first. At pristine `6b8698a4` this module does not exist.
 *
 * The oracle is the producer's declared semantics: `synthesiseDisplayValue`'s
 * own doc-comment gives the priority order (raw_value+currency → raw+% → raw+
 * time → raw → value+factor_type → value), and `set-factor-value.ts:425-446`
 * is the in-repo precedent for "recompute, or CLEAR when the formatter
 * declines". Expectations below are derived from those, not from what this
 * module happens to do.
 */
import { describe, it, expect } from 'vitest';

import { reconcileDisplayAnchors } from '../display-anchor-reconcile.js';

const CS_ID = 'fac_cs_coverage_depth';
const ONBOARDING_ID = 'fac_onboarding';

function baseGraph() {
  return {
    nodes: [
      {
        id: CS_ID,
        kind: 'factor',
        label: 'Customer Success Coverage Depth',
        display_value: '20%',
        observed_state: { value: 20, raw_value: 20, unit: '%', baseline: 20 },
      },
      {
        id: ONBOARDING_ID,
        kind: 'factor',
        label: 'Onboarding Quality',
        // A QUALITATIVE, LLM/enricher-authored string. `analysis-ready.ts`
        // deliberately PREFERS this over the synthesised numeric fallback.
        display_value: 'Moderate',
        observed_state: { value: 0.42 },
      },
    ],
    edges: [],
  };
}

describe('reconcileDisplayAnchors', () => {
  it('THE MEASURED CASE: a node whose observed value moved 20 -> 40 loses the stale "20%"', () => {
    const before = baseGraph();
    const after = baseGraph();
    after.nodes[0].observed_state = { value: 40, raw_value: 40, unit: '%', baseline: 20 };

    // PRECONDITION PINNED IN-TEST: the input really does carry the
    // contradiction the audit measured, and it is on the node we name.
    expect(after.nodes[0].id).toBe(CS_ID);
    expect(after.nodes[0].display_value).toBe('20%');
    expect((after.nodes[0].observed_state as { value: number }).value).toBe(40);

    const result = reconcileDisplayAnchors(before, after);

    expect(result.repairedNodeIds).toEqual([CS_ID]);
    const repaired = (result.graph.nodes as Array<Record<string, unknown>>)
      .find((n) => n.id === CS_ID);
    expect(repaired?.display_value).toBe('40%');
  });

  it('LEAVES AN UNTOUCHED NODE ALONE — including its qualitative LLM string', () => {
    // This is the breadth guard. A blanket rewrite would replace "Moderate"
    // with the synthesised numeric fallback on every edit turn, silently
    // downgrading every node the edit never touched.
    const before = baseGraph();
    const after = baseGraph();
    after.nodes[0].observed_state = { value: 40, raw_value: 40, unit: '%', baseline: 20 };

    const result = reconcileDisplayAnchors(before, after);

    expect(result.repairedNodeIds).not.toContain(ONBOARDING_ID);
    const untouched = (result.graph.nodes as Array<Record<string, unknown>>)
      .find((n) => n.id === ONBOARDING_ID);
    expect(untouched?.display_value).toBe('Moderate');
  });

  it('is a strict no-op (SAME REFERENCE) when nothing moved', () => {
    const before = baseGraph();
    const after = baseGraph();
    const result = reconcileDisplayAnchors(before, after);
    // Referential identity is load-bearing: `edit-graph.ts` only discards
    // PLoT's canonical `graph_hash` when this reports a repair.
    expect(result.graph).toBe(after);
    expect(result.repairedNodeIds).toEqual([]);
  });

  it('CLEARS the anchor when the formatter declines — never leaves the prior string', () => {
    const before = baseGraph();
    const after = baseGraph();
    // No numeric state at all: `synthesiseDisplayValue` returns undefined.
    after.nodes[0].observed_state = { unit: '%' } as never;

    const result = reconcileDisplayAnchors(before, after);

    expect(result.repairedNodeIds).toEqual([CS_ID]);
    const repaired = (result.graph.nodes as Array<Record<string, unknown>>)
      .find((n) => n.id === CS_ID);
    expect(repaired).not.toHaveProperty('display_value');
  });

  it('does not touch a node that is NEW in the applied graph', () => {
    const before = baseGraph();
    const after = baseGraph();
    (after.nodes as Array<Record<string, unknown>>).push({
      id: 'fac_new',
      kind: 'factor',
      label: 'Newly added factor',
      display_value: 'Whatever the author wrote',
      observed_state: { value: 0.5 },
    });
    const result = reconcileDisplayAnchors(before, after);
    expect(result.repairedNodeIds).toEqual([]);
  });

  it('does not fire when only a non-anchor field moved (e.g. observed_state.source)', () => {
    const before = baseGraph();
    const after = baseGraph();
    (after.nodes[0].observed_state as Record<string, unknown>).source = 'user_override';
    const result = reconcileDisplayAnchors(before, after);
    expect(result.repairedNodeIds).toEqual([]);
  });

  it('tolerates a missing/!array nodes field without throwing', () => {
    expect(reconcileDisplayAnchors(null, {} as never).repairedNodeIds).toEqual([]);
    expect(reconcileDisplayAnchors(undefined, { nodes: null } as never).repairedNodeIds).toEqual([]);
  });
});
