import { describe, expect, it } from 'vitest';

import type { ContextPackGraph } from '../../context/context-pack-assembler.js';
import {
  buildGraphNodeLookupFromGraph,
  buildLabelIndex,
  resolveTypedCanonicalProseEntityRefs,
} from '../../compose/phase3-blocks.js';
import { formatGraphForContext } from '../../format/format-graph-for-context.js';

/**
 * #1187 — the typed-identity resolver's OWN contract.
 *
 * `resolveTypedCanonicalProseEntityRefs` admits a unique generic single-word
 * label ("Cost", "Risk") only because the caller supplies the exact canonical
 * ids it expects, and its docstring promises it "returns `null` unless the
 * message resolves to precisely that id set". These rows bind that promise on
 * the function directly, so it does not depend on any caller re-checking the
 * length. (The corpus that drove it through the structural-pair evidence
 * builder was deleted with that builder.)
 */

function graph(
  nodes: readonly Record<string, unknown>[],
  edges: readonly Record<string, unknown>[],
): ContextPackGraph {
  const options = nodes.filter((node) => node.kind === 'option');
  const goals = nodes.filter((node) => node.kind === 'goal');
  return {
    nodes,
    edges,
    options,
    goals,
    constraints: [],
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      options: options.length,
      goals: goals.length,
      constraints: 0,
    },
  } as unknown as ContextPackGraph;
}

/** BOTH typed elements carry a unique generic single-word label. */
const MODEL_G = graph(
  [
    { id: 'cost', kind: 'factor', label: 'Cost' },
    { id: 'risk', kind: 'outcome', label: 'Risk' },
  ],
  [{ from: 'cost', to: 'risk', strength: 0.48, coefficient_confidence: 'moderate' }],
);

describe('#1187 generic-label window — the RESOLVER\'s own contract', () => {
  function resolverFor(currentGraph: ContextPackGraph) {
    const display = formatGraphForContext(currentGraph);
    const lookup = buildGraphNodeLookupFromGraph(display);
    return { lookup, index: buildLabelIndex(lookup) };
  }

  it('refuses when only ONE of the two typed elements is named', () => {
    const { lookup, index } = resolverFor(MODEL_G);
    // Positive control: both named resolves to exactly the typed set.
    expect(
      resolveTypedCanonicalProseEntityRefs(lookup, index, 'How does Cost affect Risk?', ['cost', 'risk'])
        ?.map((ref) => ref.id),
    ).toEqual(['cost', 'risk']);
    // Twin: one named must be `null`, never a partial answer. Without the
    // resolver's own length check this returns a one-element array.
    expect(
      resolveTypedCanonicalProseEntityRefs(lookup, index, 'How much does Cost matter here?', ['cost', 'risk']),
    ).toBeNull();
  });

  it('refuses when NEITHER typed element is named', () => {
    const { lookup, index } = resolverFor(MODEL_G);
    expect(
      resolveTypedCanonicalProseEntityRefs(lookup, index, 'Tell me about the market outlook.', ['cost', 'risk']),
    ).toBeNull();
  });

  it('refuses a typed set carrying the same id twice', () => {
    const { lookup, index } = resolverFor(MODEL_G);
    expect(
      resolveTypedCanonicalProseEntityRefs(lookup, index, 'How does Cost affect Risk?', ['cost', 'cost']),
    ).toBeNull();
  });
});
