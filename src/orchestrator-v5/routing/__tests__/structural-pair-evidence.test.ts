import { describe, expect, it } from 'vitest';

import type { ContextPackGraph } from '../../context/context-pack-assembler.js';
import { buildStructuralPairEvidence } from '../structural-pair-evidence.js';
import type { StructureQuery } from '../types.js';

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
  };
}

function build(
  currentGraph: ContextPackGraph,
  messageText: string,
  queryOrElementIds: readonly [string, string] | StructureQuery | undefined,
  overrides: Partial<{
    graphContextStatus: 'canonical' | 'provisional' | 'absent' | 'unavailable';
    graphAuthority: 'canonical_strict' | 'canonical_structural_fallback' | 'unavailable';
    graphWasTrimmed: boolean;
  }> = {},
) {
  return buildStructuralPairEvidence(currentGraph, {
    messageText,
    structureQuery:
      queryOrElementIds === undefined
        ? undefined
        : Array.isArray(queryOrElementIds)
          ? {
            kind: 'direct_relationship',
            element_ids: [queryOrElementIds[0]!, queryOrElementIds[1]!],
          }
          : queryOrElementIds as StructureQuery,
    graphContextStatus: overrides.graphContextStatus ?? 'canonical',
    graphAuthority: overrides.graphAuthority ?? 'canonical_strict',
    graphWasTrimmed: overrides.graphWasTrimmed ?? false,
  });
}

const DIRECT_GRAPH = graph(
  [
    { id: 'factor', kind: 'factor', label: 'Pilot Scope and Commitment' },
    { id: 'risk', kind: 'outcome', label: 'Implementation Quality Failure' },
  ],
  [
    {
      from: 'factor',
      to: 'risk',
      strength: 0.37,
      coefficient_confidence: 'high',
    },
  ],
);

describe('buildStructuralPairEvidence', () => {
  it('resolves current-message labels to canonical ids and preserves stored direction when asked in reverse order', () => {
    const evidence = build(
      DIRECT_GRAPH,
      'Describe the relationship between Implementation Quality Failure and Pilot Scope and Commitment.',
      ['risk', 'factor'],
    );
    expect(evidence).toEqual({
      status: 'direct',
      first_label: 'Implementation Quality Failure',
      second_label: 'Pilot Scope and Commitment',
      coverage: 'complete',
      relationships: [
        {
          from_label: 'Pilot Scope and Commitment',
          to_label: 'Implementation Quality Failure',
          edge_type: 'directed',
          relationship: 'moderate positive link',
          coefficient_confidence: 'high',
        },
      ],
    });
  });

  it('preserves a negative relationship without reversing it', () => {
    const currentGraph = graph(
      [
        { id: 'cost', kind: 'factor', label: 'Implementation Cost' },
        { id: 'goal', kind: 'goal', label: 'Responsible Market Entry' },
      ],
      [{ from: 'cost', to: 'goal', strength: -0.55 }],
    );
    const evidence = build(
      currentGraph,
      'How are Responsible Market Entry and Implementation Cost connected?',
      ['goal', 'cost'],
    );
    expect(evidence?.status).toBe('direct');
    if (evidence?.status === 'direct') {
      expect(evidence.relationships[0]).toMatchObject({
        from_label: 'Implementation Cost',
        to_label: 'Responsible Market Entry',
        relationship: 'moderate negative link',
      });
    }
  });

  it('uses typed canonical ids to corroborate unique exact generic labels', () => {
    const currentGraph = graph(
      [
        { id: 'cost', kind: 'factor', label: 'Cost' },
        { id: 'risk', kind: 'outcome', label: 'Risk' },
      ],
      [{ from: 'cost', to: 'risk', strength: -0.55 }],
    );
    expect(build(
      currentGraph,
      'How does Cost affect Risk?',
      ['cost', 'risk'],
    )).toEqual({
      status: 'direct',
      first_label: 'Cost',
      second_label: 'Risk',
      coverage: 'complete',
      relationships: [{
        from_label: 'Cost',
        to_label: 'Risk',
        edge_type: 'directed',
        relationship: 'moderate negative link',
      }],
    });
  });

  it('does not let typed ids disambiguate duplicate exact generic labels', () => {
    const currentGraph = graph(
      [
        { id: 'cost_a', kind: 'factor', label: 'Cost' },
        { id: 'cost_b', kind: 'factor', label: 'cost' },
        { id: 'risk', kind: 'outcome', label: 'Risk' },
      ],
      [{ from: 'cost_a', to: 'risk', strength: 0.5 }],
    );
    expect(build(
      currentGraph,
      'How does Cost affect Risk?',
      ['cost_a', 'risk'],
    )).toEqual({ status: 'ambiguous' });
  });

  it('does not ignore an additional ambiguous generic reference', () => {
    const currentGraph = graph(
      [
        { id: 'cost', kind: 'factor', label: 'Cost' },
        { id: 'risk', kind: 'outcome', label: 'Risk' },
        { id: 'goal_a', kind: 'goal', label: 'Goal' },
        { id: 'goal_b', kind: 'goal', label: 'goal' },
      ],
      [{ from: 'cost', to: 'risk', strength: 0.5 }],
    );
    expect(build(
      currentGraph,
      'How do Cost and Risk affect Goal?',
      ['cost', 'risk'],
    )).toEqual({ status: 'ambiguous' });
  });

  it('does not promote a nonexact generic word or a third named identity', () => {
    const currentGraph = graph(
      [
        { id: 'cost', kind: 'factor', label: 'Cost' },
        { id: 'risk', kind: 'outcome', label: 'Risk' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      [{ from: 'cost', to: 'risk', strength: 0.5 }],
    );
    expect(build(
      currentGraph,
      'How do Costs affect Risk?',
      ['cost', 'risk'],
    )).toEqual({ status: 'ambiguous' });
    expect(build(
      currentGraph,
      'How do Cost and Risk affect Goal?',
      ['cost', 'risk'],
    )).toEqual({ status: 'ambiguous' });
  });

  it('preserves bidirected semantics without minting a causal direction', () => {
    const currentGraph = graph(
      [
        { id: 'sentiment', kind: 'factor', label: 'Brand Sentiment' },
        { id: 'profit', kind: 'outcome', label: 'Quarterly Profit' },
      ],
      [{ from: 'sentiment', to: 'profit', strength: 0.5, edge_type: 'bidirected' }],
    );
    const evidence = build(
      currentGraph,
      'What is the relationship between Quarterly Profit and Brand Sentiment?',
      ['profit', 'sentiment'],
    );
    expect(evidence?.status).toBe('direct');
    if (evidence?.status === 'direct') {
      expect(evidence.relationships[0]).toMatchObject({
        edge_type: 'bidirected',
        relationship:
          'moderate positive co-movement, unmeasured common cause (not a causal route)',
      });
    }
  });

  it('does not compose a factor-to-goal path from separate connectors', () => {
    const currentGraph = graph(
      [
        { id: 'factor', kind: 'factor', label: 'Enterprise Integration Investment' },
        { id: 'outcome', kind: 'outcome', label: 'Enterprise Revenue Expansion' },
        { id: 'goal', kind: 'goal', label: 'Preserve Strategic Flexibility' },
      ],
      [
        { from: 'factor', to: 'outcome', strength: 0.5 },
        { from: 'outcome', to: 'goal', strength: 0.5 },
      ],
    );
    expect(
      build(
        currentGraph,
        'Is there a direct connector between Enterprise Integration Investment and Preserve Strategic Flexibility, or only a path?',
        ['factor', 'goal'],
      ),
    ).toEqual({
      status: 'no_direct',
      first_label: 'Enterprise Integration Investment',
      second_label: 'Preserve Strategic Flexibility',
    });
  });

  it('does not let a direct-relationship query license the different option-reachability question', () => {
    const currentGraph = graph(
      [
        { id: 'option', kind: 'option', label: 'Pilot First', reaches: ['goal'] },
        { id: 'middle', kind: 'factor', label: 'Implementation Quality' },
        { id: 'goal', kind: 'goal', label: 'Responsible Market Entry' },
      ],
      [
        { from: 'option', to: 'middle', strength: 1 },
        { from: 'middle', to: 'goal', strength: 0.5 },
      ],
    );
    expect(
      build(
        currentGraph,
        'Does Pilot First have a direct relationship with Responsible Market Entry?',
        ['option', 'goal'],
      ),
    ).toEqual({
      status: 'no_direct',
      first_label: 'Pilot First',
      second_label: 'Responsible Market Entry',
    });
  });

  it('does not turn a trimmed direct-relationship projection into authoritative absence', () => {
    const currentGraph = graph(
      [
        { id: 'factor', kind: 'factor', label: 'Enterprise Integration Investment' },
        { id: 'goal', kind: 'goal', label: 'Preserve Strategic Flexibility' },
      ],
      [],
    );
    expect(
      build(
        currentGraph,
        'Is there a connector between Enterprise Integration Investment and Preserve Strategic Flexibility?',
        ['factor', 'goal'],
        { graphWasTrimmed: true },
      ),
    ).toEqual({
      status: 'coverage_unavailable',
      first_label: 'Enterprise Integration Investment',
      second_label: 'Preserve Strategic Flexibility',
    });
  });

  it('fails weak on duplicate labels, duplicate ids and conflicting repeated relationships', () => {
    const duplicateLabels = graph(
      [
        { id: 'a1', kind: 'factor', label: 'Shared Signal' },
        { id: 'a2', kind: 'factor', label: 'Shared Signal' },
        { id: 'goal', kind: 'goal', label: 'Growth Goal' },
      ],
      [],
    );
    expect(build(duplicateLabels, 'How does Shared Signal relate to Growth Goal?', ['a1', 'goal'])).toEqual({
      status: 'ambiguous',
    });

    const duplicateIds = graph(
      [
        { id: 'same', kind: 'factor', label: 'First Signal' },
        { id: 'same', kind: 'factor', label: 'Second Signal' },
        { id: 'goal', kind: 'goal', label: 'Growth Goal' },
      ],
      [{ from: 'same', to: 'goal', strength: 0.5 }],
    );
    expect(build(duplicateIds, 'How does Second Signal relate to Growth Goal?', ['same', 'goal'])).toEqual({
      status: 'ambiguous',
    });

    const conflicting = graph(
      [
        { id: 'factor', kind: 'factor', label: 'Demand Signal' },
        { id: 'goal', kind: 'goal', label: 'Growth Goal' },
      ],
      [
        { from: 'factor', to: 'goal', strength: 0.5 },
        { from: 'factor', to: 'goal', strength: -0.5 },
      ],
    );
    expect(build(conflicting, 'How does Demand Signal relate to Growth Goal?', ['factor', 'goal'])).toEqual({
      status: 'ambiguous',
    });
  });

  it('is invariant to node and relationship array order', () => {
    const forward = build(
      DIRECT_GRAPH,
      'Describe the direct relationship between Pilot Scope and Commitment and Implementation Quality Failure.',
      ['factor', 'risk'],
    );
    const reversed = build(
      graph([...DIRECT_GRAPH.nodes].reverse() as Record<string, unknown>[], [...DIRECT_GRAPH.edges].reverse() as Record<string, unknown>[]),
      'Describe the direct relationship between Pilot Scope and Commitment and Implementation Quality Failure.',
      ['factor', 'risk'],
    );
    expect(reversed).toEqual(forward);
  });

  it('does not mint canonical pair authority from provisional or unavailable context', () => {
    const message =
      'Describe the direct relationship between Pilot Scope and Commitment and Implementation Quality Failure.';
    expect(build(DIRECT_GRAPH, message, ['factor', 'risk'], { graphContextStatus: 'provisional' })).toBeNull();
    expect(build(DIRECT_GRAPH, message, ['factor', 'risk'], { graphContextStatus: 'unavailable' })).toBeNull();
  });

  it('does not reuse two resolved labels as relationship-intent authority', () => {
    for (const message of [
      'Compare Pilot Scope and Commitment and Implementation Quality Failure as priorities.',
      'What assumptions support Pilot Scope and Commitment and Implementation Quality Failure?',
      'Summarise the evidence for Pilot Scope and Commitment and Implementation Quality Failure.',
      'Which is more uncertain: Pilot Scope and Commitment or Implementation Quality Failure?',
    ]) {
      expect(build(DIRECT_GRAPH, message, undefined)).toBeNull();
    }
  });

  it('fails weak when the typed pair ids do not match the two current-message canonical refs', () => {
    const message =
      'Describe the direct relationship between Pilot Scope and Commitment and Implementation Quality Failure.';
    expect(build(DIRECT_GRAPH, message, ['factor', 'forged'])).toEqual({
      status: 'ambiguous',
    });
  });

  it('keeps structural-fallback and trimmed connectors presence-only', () => {
    const message =
      'Describe the direct relationship between Pilot Scope and Commitment and Implementation Quality Failure.';
    const structural = build(DIRECT_GRAPH, message, ['factor', 'risk'], {
      graphAuthority: 'canonical_structural_fallback',
    });
    expect(structural).toEqual({
      status: 'direct',
      first_label: 'Pilot Scope and Commitment',
      second_label: 'Implementation Quality Failure',
      coverage: 'presence_only',
      relationships: [{
        from_label: 'Pilot Scope and Commitment',
        to_label: 'Implementation Quality Failure',
        edge_type: 'directed',
      }],
    });
    const trimmed = build(DIRECT_GRAPH, message, ['factor', 'risk'], {
      graphWasTrimmed: true,
    });
    expect(trimmed).toMatchObject({ status: 'direct', coverage: 'presence_only' });
  });

  it('preserves reciprocal directed connectors without treating either as absent', () => {
    const reciprocal = graph(
      DIRECT_GRAPH.nodes as readonly Record<string, unknown>[],
      [
        { from: 'factor', to: 'risk', strength: 0.37 },
        { from: 'risk', to: 'factor', strength: -0.22 },
      ],
    );
    const evidence = build(
      reciprocal,
      'Describe the direct relationship between Pilot Scope and Commitment and Implementation Quality Failure.',
      ['factor', 'risk'],
    );
    expect(evidence?.status).toBe('direct');
    if (evidence?.status === 'direct') {
      expect(evidence.relationships).toHaveLength(2);
      expect(evidence.relationships.map((item) => [item.from_label, item.to_label])).toEqual(
        expect.arrayContaining([
          ['Pilot Scope and Commitment', 'Implementation Quality Failure'],
          ['Implementation Quality Failure', 'Pilot Scope and Commitment'],
        ]),
      );
    }
  });

  it('normalises reverse bidirected identity, dedupes exact twins and rejects conflict', () => {
    const nodes = [
      { id: 'a', kind: 'factor', label: 'Brand Sentiment' },
      { id: 'b', kind: 'outcome', label: 'Quarterly Profit' },
    ];
    const message = 'Describe the direct relationship between Brand Sentiment and Quarterly Profit.';
    const exactTwins = build(
      graph(nodes, [
        { from: 'a', to: 'b', strength: 0.5, edge_type: 'bidirected' },
        { from: 'b', to: 'a', strength: 0.5, edge_type: 'bidirected' },
      ]),
      message,
      ['a', 'b'],
    );
    expect(exactTwins?.status).toBe('direct');
    if (exactTwins?.status === 'direct') expect(exactTwins.relationships).toHaveLength(1);

    expect(build(
      graph(nodes, [
        { from: 'a', to: 'b', strength: 0.5, edge_type: 'bidirected' },
        { from: 'b', to: 'a', strength: -0.5, edge_type: 'bidirected' },
      ]),
      message,
      ['a', 'b'],
    )).toEqual({ status: 'ambiguous' });
  });

  it('answers the separately licensed option-reachability question from exact ids', () => {
    const currentGraph = graph(
      [
        { id: 'option', kind: 'option', label: 'Pilot First', reaches: ['goal'] },
        { id: 'goal', kind: 'goal', label: 'Responsible Market Entry' },
      ],
      [],
    );
    const message = 'Can Pilot First reach Responsible Market Entry through the saved model?';
    expect(build(currentGraph, message, {
      kind: 'reachability',
      source_element_id: 'option',
      target_element_id: 'goal',
    })).toEqual({
      status: 'reachable',
      source_label: 'Pilot First',
      target_label: 'Responsible Market Entry',
    });
    expect(build(currentGraph, message, {
      kind: 'reachability',
      source_element_id: 'goal',
      target_element_id: 'option',
    })).toEqual({ status: 'ambiguous' });
  });

  it('does not license reachability negatives from trimmed or fallback coverage', () => {
    const currentGraph = graph(
      [
        { id: 'option', kind: 'option', label: 'Pilot First', reaches: [] },
        { id: 'goal', kind: 'goal', label: 'Responsible Market Entry' },
      ],
      [],
    );
    const query: StructureQuery = {
      kind: 'reachability',
      source_element_id: 'option',
      target_element_id: 'goal',
    };
    const message = 'Can Pilot First reach Responsible Market Entry through the saved model?';
    expect(build(currentGraph, message, query)).toMatchObject({ status: 'not_reachable' });
    expect(build(currentGraph, message, query, { graphWasTrimmed: true })).toMatchObject({
      status: 'coverage_unavailable',
    });
    expect(build(currentGraph, message, query, {
      graphAuthority: 'canonical_structural_fallback',
    })).toMatchObject({ status: 'coverage_unavailable' });
  });
});
