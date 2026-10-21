/**
 * SELECTION-AWARE ANSWERING — the producer half that survives deletion 8.
 *
 * Hop 3 resolves the user's canvas selection against canonical state
 * (`resolveTurnSelection`, build-turn-context.ts — live: `buildTurnContext`
 * calls it). Hop 4, the `focus` ContextPack projection (`projectFocus`,
 * `buildAnalysisIdentityIndex`, the assembler's focus threading), went with
 * `context-pack-assembler.ts`, which no served lane calls; its 40 rows were
 * removed with it.
 *
 * What stays is the POSITIVE CONTROL on the live producer (trap #13): a REAL
 * `resolveTurnSelection` over a REAL graph, bound by IDENTITY (trap #19), plus
 * its negative — an unresolvable id is reported, never invented.
 */

import { describe, expect, it } from 'vitest';

import { resolveTurnSelection, type TurnSelection } from '../../build-turn-context.js';

// ---------------------------------------------------------------------------
// Fixtures — a graph and the selection the producer emits over it
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

function selectionFor(ids: readonly string[]): TurnSelection {
  const resolved = resolveTurnSelection(ids, GRAPH, 'ok_present');
  if (resolved === null) throw new Error('fixture: resolveTurnSelection returned null');
  return resolved;
}

// ---------------------------------------------------------------------------
// POSITIVE CONTROL — the fixtures are the producer's real shape
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
