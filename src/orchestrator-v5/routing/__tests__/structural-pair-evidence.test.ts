import { describe, expect, it } from 'vitest';

import type { ContextPackGraph } from '../../context/context-pack-assembler.js';
import {
  buildSelectedDependenciesEvidence,
  buildStructuralPairEvidence,
} from '../structural-pair-evidence.js';
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
  it('leaves typed dependency questions exclusively to the dependency evidence carrier', () => {
    expect(buildStructuralPairEvidence(DIRECT_GRAPH, {
      graphContextStatus: 'canonical',
      graphAuthority: 'canonical_strict',
      graphWasTrimmed: false,
      messageText: 'What feeds this?',
      structureQuery: { kind: 'dependencies', element_id: 'risk' },
    })).toBeNull();
  });

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

describe('buildSelectedDependenciesEvidence', () => {
  const selectedNodes: readonly Record<string, unknown>[] = [
      { id: 'improve', kind: 'option', label: 'Improve current CRM' },
      { id: 'hubspot', kind: 'option', label: 'Move to HubSpot' },
      { id: 'pilot', kind: 'option', label: 'Phased pilot' },
      { id: 'automation', kind: 'factor', label: 'Sales process automation level' },
      { id: 'adoption', kind: 'factor', label: 'CRM adoption and usability' },
      { id: 'ramp', kind: 'factor', label: 'Ramp and disruption time' },
      { id: 'selling_time', kind: 'outcome', label: 'Sales rep time on selling activities' },
      { id: 'goal', kind: 'goal', label: 'Improve sales productivity' },
    ];
  const selectedEdges: readonly Record<string, unknown>[] = [
      { from: 'improve', to: 'automation', strength: 1 },
      { from: 'hubspot', to: 'automation', strength: 1 },
      { from: 'pilot', to: 'ramp', strength: 1 },
      { from: 'automation', to: 'selling_time', strength: 0.35 },
      { from: 'adoption', to: 'selling_time', strength: 0.55 },
      { from: 'selling_time', to: 'goal', strength: 0.6 },
    ];
  const selectedGraph = graph(selectedNodes, selectedEdges);

  function buildSelected(
    overrides: Partial<Parameters<typeof buildSelectedDependenciesEvidence>[1]> = {},
    currentGraph = selectedGraph,
  ) {
    return buildSelectedDependenciesEvidence(currentGraph, {
      structureQuery: { kind: 'dependencies', element_id: 'selling_time' },
      requestedSelection: { node_ids: ['selling_time'], edge_ids: [] },
      focus: {
        elements: [{
          id: 'selling_time',
          kind: 'outcome',
          label: 'Sales rep time on selling activities',
          analysis_link: 'no_analysis',
        }],
        unresolved: 'none',
        requested_count: 1,
        unresolved_count: 0,
      },
      groundedSelection: { element_ids: ['selling_time'], unresolved: 'none' },
      proposalEntity: {
        id: 'selling_time',
        label: 'Sales rep time on selling activities',
        resolution_status: 'resolved',
      },
      graphContextStatus: 'canonical',
      graphAuthority: 'canonical_strict',
      graphWasTrimmed: false,
      ...overrides,
    });
  }

  it('projects only the selected identity direct neighbourhood and cannot invent an upstream option edge', () => {
    const evidence = buildSelected();
    expect(evidence?.status).toBe('resolved');
    if (evidence?.status !== 'resolved') return;

    expect(evidence.selected_label).toBe('Sales rep time on selling activities');
    expect(evidence.dependencies.map((relationship) => relationship.from_label)).toEqual([
      'Sales process automation level',
      'CRM adoption and usability',
    ].sort());
    expect(evidence.bidirected).toEqual([]);
    expect(JSON.stringify(evidence)).not.toContain('Phased pilot');
    expect(JSON.stringify(evidence)).not.toContain('Improve sales productivity');

    const permutedGraph = graph(
      [...selectedNodes].reverse(),
      [...selectedEdges].reverse(),
    );
    expect(JSON.stringify(buildSelected({}, permutedGraph))).toBe(JSON.stringify(evidence));
  });

  function buildNamed(
    messageText = 'What does Sales rep time on selling activities depend on?',
    overrides: Partial<Parameters<typeof buildSelectedDependenciesEvidence>[1]> = {},
    currentGraph = selectedGraph,
  ) {
    return buildSelected({
      messageText, requestedSelection: undefined, focus: undefined,
      groundedSelection: null, ...overrides,
    }, currentGraph);
  }

  it('answers an exact named canonical object without inventing a selection', () => {
    const named = buildNamed();
    expect(named).toEqual(buildSelected({ messageText: 'What does this depend on?' }));
    expect(named?.status).toBe('resolved');
    expect(buildNamed(undefined, {}, graph(
      [...selectedNodes].reverse(), [...selectedEdges].reverse(),
    ))).toEqual(named);
  });

  it.each([
    'What does that depend on?',
    'What does Missing Object depend on?',
    'What does CRM adoption and usability depend on?',
    'What do Sales rep time on selling activities and CRM adoption and usability depend on?',
    '',
  ])('does not promote a valid existing proposed id without matching user identity: %s', (message) => {
    expect(buildNamed(message)).toEqual({ status: 'ambiguous' });
  });

  it('requires query and validated entity agreement independently of the matching name', () => {
    expect(buildNamed(undefined, {
      proposalEntity: { id: 'adoption', resolution_status: 'resolved' },
    })).toEqual({ status: 'ambiguous' });
    expect(buildNamed(undefined, {
      proposalEntity: { id: 'selling_time', resolution_status: 'unresolved' },
    })).toEqual({ status: 'ambiguous' });
    expect(buildNamed(undefined, {
      structureQuery: { kind: 'dependencies', element_id: 'adoption' },
      proposalEntity: { id: 'adoption', resolution_status: 'resolved' },
    })).toEqual({ status: 'ambiguous' });
    expect(buildNamed(undefined, { messageText: undefined })).toEqual({ status: 'ambiguous' });
  });

  it('does not bypass unresolved, multiple, foreign or conflicting selection with a matching name', () => {
    for (const selection of [
      { node_ids: ['ghost'], edge_ids: [] },
      { node_ids: ['selling_time', 'adoption'], edge_ids: [] },
      { node_ids: [], edge_ids: ['automation-selling_time'] },
    ]) {
      expect(buildNamed(undefined, { requestedSelection: selection })).toEqual({ status: 'ambiguous' });
    }
    expect(buildNamed(undefined, {
      groundedSelection: { element_ids: [], unresolved: 'could_not_check' },
    })).toEqual({ status: 'ambiguous' });
    expect(buildSelected({
      messageText: 'What does CRM adoption and usability depend on?',
      structureQuery: { kind: 'dependencies', element_id: 'adoption' },
      proposalEntity: { id: 'adoption', resolution_status: 'resolved' },
    }))
      .toEqual({ status: 'ambiguous' });
    expect(buildSelected({ messageText: 'What does Sales rep time on selling activities depend on?' }))
      .toEqual(buildNamed());
  });

  it('does not silently drop a second generic named object or a typed selected-identity conflict', () => {
    const withCost = graph(
      [...selectedNodes, { id: 'cost', kind: 'factor', label: 'Cost' }], selectedEdges,
    );
    expect(buildNamed(undefined, {}, withCost)?.status).toBe('resolved');
    expect(buildNamed('What do Sales rep time on selling activities and Cost depend on?', {}, withCost))
      .toEqual({ status: 'ambiguous' });
    expect(buildSelected({
      messageText: 'What does Cost depend on?',
      structureQuery: { kind: 'dependencies', element_id: 'cost' },
      proposalEntity: { id: 'cost', resolution_status: 'resolved' },
    }, withCost))
      .toEqual({ status: 'ambiguous' });
    expect(buildSelected({ messageText: 'What does this depend on?' }, withCost)?.status)
      .toBe('resolved');
  });

  it.each([
    ['incidental generic mention', 'What does this depend on? I mostly care about cost.', true],
    ['same prose with no generic node', 'What does this depend on? I mostly care about cost.', false],
    ['incidental multiword mention', 'What does this depend on? CRM adoption and usability seems relevant.', true],
  ])('preserves canonical selected evidence with %s', (_case, messageText, includeCost) => {
    const currentGraph = graph([
      ...selectedNodes,
      ...(includeCost ? [{ id: 'cost', kind: 'factor', label: 'Cost' }] : []),
    ], selectedEdges);
    const expected = buildSelected({}, currentGraph);
    expect(expected?.status).toBe('resolved');
    expect(buildSelected({ messageText }, currentGraph)).toEqual(expected);
  });

  it('distinguishes a nested label from a separately named second object', () => {
    const nested = graph([
      { id: 'driver', kind: 'factor', label: 'Adoption Rate' },
      { id: 'selling_time', kind: 'outcome', label: 'Engineering Build Cost' },
      { id: 'cost', kind: 'factor', label: 'Cost' },
      { id: 'build_cost', kind: 'factor', label: 'Build Cost' },
    ], [{ from: 'driver', to: 'selling_time', strength: 0.35 }]);
    const message = 'What does "Engineering Build Cost" depend on?';
    expect(buildNamed(message, {}, nested)?.status).toBe('resolved');
    expect(buildSelected({ messageText: message }, nested))
      .toEqual(buildSelected({ messageText: 'What does this depend on?' }, nested));
    for (const extra of ['Cost', 'Build Cost']) {
      for (const messageText of [
        `What do Engineering Build Cost and ${extra} depend on?`,
        `What do ${extra} and Engineering Build Cost depend on?`,
      ]) {
        expect(buildNamed(messageText, {}, nested)).toEqual({ status: 'ambiguous' });
      }
    }
    // A nested short label cannot corroborate the wrong typed object either.
    expect(buildNamed(message, {
      structureQuery: { kind: 'dependencies', element_id: 'build_cost' },
      proposalEntity: { id: 'build_cost', resolution_status: 'resolved' },
    }, nested)).toEqual({ status: 'ambiguous' });
  });

  it.each(['provisional', 'absent', 'unavailable'] as const)('withholds named coverage for %s authority', (status) => {
    expect(buildNamed(undefined, { graphContextStatus: status })).toEqual({
      status: 'coverage_unavailable', reason: 'graph_coverage_unavailable',
    });
  });

  it('preserves trim, fallback, duplicate identity and semantic twin guards for named queries', () => {
    for (const overrides of [
      { graphWasTrimmed: true },
      { graphAuthority: 'canonical_structural_fallback' as const },
    ]) expect(buildNamed(undefined, overrides)).toEqual({
      status: 'coverage_unavailable', reason: 'graph_coverage_unavailable',
    });
    for (const duplicate of [
      { id: 'twin', kind: 'outcome', label: 'Sales rep time on selling activities' },
      { id: 'selling_time', kind: 'outcome', label: 'Other subject' },
    ]) expect(buildNamed(undefined, {}, graph([...selectedNodes, duplicate], selectedEdges)))
      .toEqual({ status: 'ambiguous' });
    expect(buildNamed(undefined, {}, graph(selectedNodes, [
      ...selectedEdges, { from: 'automation', to: 'selling_time', strength: -0.9 },
    ]))).toEqual({ status: 'ambiguous' });
  });

  it('cannot hide an additional named object by overwriting an unrelated duplicate id', () => {
    const twins = [
      { id: 'collision', kind: 'factor', label: 'Cost' },
      { id: 'collision', kind: 'factor', label: 'Budget' },
    ];
    const messageText = 'What do Sales rep time on selling activities and Cost depend on?';
    for (const order of [twins, [...twins].reverse()]) {
      const currentGraph = graph([...selectedNodes, ...order], selectedEdges);
      expect(buildNamed(messageText, {}, currentGraph)).toEqual({ status: 'ambiguous' });
    }
  });

  it('preserves selected evidence when duplicate ids are unrelated to the selected neighbourhood', () => {
    const twins = [
      { id: 'collision', kind: 'factor', label: 'Cost' },
      { id: 'collision', kind: 'factor', label: 'Budget' },
    ];
    const expected = buildSelected();
    expect(expected?.status).toBe('resolved');
    for (const order of [twins, [...twins].reverse()]) {
      const currentGraph = graph([...selectedNodes, ...order], selectedEdges);
      expect(buildSelected({ messageText: 'What does this depend on?' }, currentGraph))
        .toEqual(expected);
      // The named path uses the complete lookup to corroborate identity, so
      // unrelated duplicate ids still invalidate that different authority.
      expect(buildNamed(undefined, {}, currentGraph)).toEqual({ status: 'ambiguous' });
    }
  });

  it('requires selected focus, validated proposal target and canonical graph identity to agree', () => {
    expect(buildSelected({
      requestedSelection: { node_ids: ['selling_time'], edge_ids: ['automation→selling_time'] },
    })).toEqual({ status: 'ambiguous' });
    expect(buildSelected({
      requestedSelection: { node_ids: ['selling_time', 'adoption'], edge_ids: [] },
    })).toEqual({ status: 'ambiguous' });
    expect(buildSelected({
      requestedSelection: { node_ids: ['goal'], edge_ids: [] },
    })).toEqual({ status: 'ambiguous' });
    expect(buildSelected({ groundedSelection: null })).toEqual({ status: 'ambiguous' });
    expect(buildSelected({
      groundedSelection: { element_ids: ['selling_time', 'adoption'], unresolved: 'none' },
    })).toEqual({ status: 'ambiguous' });
    expect(buildSelected({
      structureQuery: { kind: 'dependencies', element_id: 'goal' },
    })).toEqual({ status: 'ambiguous' });
    expect(buildSelected({
      focus: {
        elements: [{
          id: 'selling_time', kind: 'outcome', label: 'Sales rep time on selling activities',
          analysis_link: 'no_analysis',
        }],
        unresolved: 'not_in_model', requested_count: 2, unresolved_count: 1,
      },
    })).toEqual({ status: 'ambiguous' });
    expect(buildSelected({
      focus: {
        elements: [{
          id: 'goal', kind: 'goal', label: 'Improve sales productivity',
          analysis_link: 'no_analysis',
        }],
        unresolved: 'none', requested_count: 1, unresolved_count: 0,
      },
    })).toEqual({ status: 'ambiguous' });
    expect(buildSelected({
      groundedSelection: { element_ids: ['selling_time'], unresolved: 'not_in_model' },
    })).toEqual({ status: 'ambiguous' });
    expect(buildSelected({
      proposalEntity: {
        id: 'goal',
        label: 'Improve sales productivity',
        resolution_status: 'resolved',
      },
    })).toEqual({ status: 'ambiguous' });
    expect(buildSelected({
      proposalEntity: {
        id: 'selling_time',
        label: 'Sales rep time on selling activities',
        resolution_status: 'ambiguous',
      },
    })).toEqual({ status: 'ambiguous' });
  });

  it('fails weak when canonical relationship coverage is unavailable', () => {
    expect(buildSelected({ graphContextStatus: 'provisional' })).toEqual({
      status: 'coverage_unavailable',
      reason: 'graph_coverage_unavailable',
    });
    expect(buildSelected({ graphAuthority: 'canonical_structural_fallback' })).toEqual({
      status: 'coverage_unavailable',
      reason: 'graph_coverage_unavailable',
    });
    expect(buildSelected({ graphWasTrimmed: true })).toEqual({
      status: 'coverage_unavailable',
      reason: 'graph_coverage_unavailable',
    });

    const structuralOptionLink = graph(
      [
        { id: 'option', kind: 'option', label: 'Phased pilot' },
        { id: 'factor', kind: 'factor', label: 'Ramp and disruption time' },
      ],
      [{ from: 'option', to: 'factor', strength: 0.8 }],
    );
    expect(buildSelectedDependenciesEvidence(structuralOptionLink, {
      structureQuery: { kind: 'dependencies', element_id: 'factor' },
      requestedSelection: { node_ids: ['factor'], edge_ids: [] },
      focus: {
        elements: [{
          id: 'factor', kind: 'factor', label: 'Ramp and disruption time',
          analysis_link: 'no_analysis',
        }],
        unresolved: 'none', requested_count: 1, unresolved_count: 0,
      },
      groundedSelection: { element_ids: ['factor'], unresolved: 'none' },
      proposalEntity: { id: 'factor', resolution_status: 'resolved' },
      graphContextStatus: 'canonical',
      graphAuthority: 'canonical_strict',
      graphWasTrimmed: false,
    })).toEqual({
      status: 'coverage_unavailable',
      reason: 'structural_semantics_unlicensed',
    });
  });

  it('does not compete with separately typed pair and reachability questions', () => {
    expect(buildSelected({ structureQuery: { kind: 'general' } })).toBeNull();
    expect(buildSelected({
      structureQuery: {
        kind: 'direct_relationship',
        element_ids: ['automation', 'selling_time'],
      },
    })).toBeNull();
    expect(buildSelected({ structureQuery: undefined })).toBeNull();
  });

  it('fails weak on duplicate visible identity and conflicting relationship twins', () => {
    const duplicateLabel = graph(
      [...selectedNodes, { id: 'selling_time_twin', kind: 'outcome', label: 'Sales rep time on selling activities' }],
      selectedEdges,
    );
    expect(buildSelectedDependenciesEvidence(duplicateLabel, {
      structureQuery: { kind: 'dependencies', element_id: 'selling_time' },
      requestedSelection: { node_ids: ['selling_time'], edge_ids: [] },
      focus: {
        elements: [{ id: 'selling_time', kind: 'outcome', label: 'Sales rep time on selling activities', analysis_link: 'no_analysis' }],
        unresolved: 'none', requested_count: 1, unresolved_count: 0,
      },
      groundedSelection: { element_ids: ['selling_time'], unresolved: 'none' },
      proposalEntity: { id: 'selling_time', resolution_status: 'resolved' },
      graphContextStatus: 'canonical',
      graphAuthority: 'canonical_strict',
      graphWasTrimmed: false,
    })).toEqual({ status: 'ambiguous' });

    const conflicting = graph(
      selectedNodes,
      [
        ...selectedEdges,
        { from: 'automation', to: 'selling_time', strength: -0.9 },
      ],
    );
    expect(buildSelectedDependenciesEvidence(conflicting, {
      structureQuery: { kind: 'dependencies', element_id: 'selling_time' },
      requestedSelection: { node_ids: ['selling_time'], edge_ids: [] },
      focus: {
        elements: [{ id: 'selling_time', kind: 'outcome', label: 'Sales rep time on selling activities', analysis_link: 'no_analysis' }],
        unresolved: 'none', requested_count: 1, unresolved_count: 0,
      },
      groundedSelection: { element_ids: ['selling_time'], unresolved: 'none' },
      proposalEntity: { id: 'selling_time', resolution_status: 'resolved' },
      graphContextStatus: 'canonical',
      graphAuthority: 'canonical_strict',
      graphWasTrimmed: false,
    })).toEqual({ status: 'ambiguous' });
  });

  it('deduplicates exact twins, preserves bidirected non-causal semantics, and ignores outgoing density', () => {
    const exactTwinAndBidirected = graph(
      selectedNodes,
      [
        ...selectedEdges,
        { from: 'automation', to: 'selling_time', strength: 0.35 },
        { from: 'ramp', to: 'selling_time', strength: 0.4, edge_type: 'bidirected' },
        { from: 'selling_time', to: 'improve', strength: 0.2 },
        { from: 'selling_time', to: 'hubspot', strength: 0.2 },
      ],
    );
    const evidence = buildSelectedDependenciesEvidence(exactTwinAndBidirected, {
      structureQuery: { kind: 'dependencies', element_id: 'selling_time' },
      requestedSelection: { node_ids: ['selling_time'], edge_ids: [] },
      focus: {
        elements: [{ id: 'selling_time', kind: 'outcome', label: 'Sales rep time on selling activities', analysis_link: 'no_analysis' }],
        unresolved: 'none', requested_count: 1, unresolved_count: 0,
      },
      groundedSelection: { element_ids: ['selling_time'], unresolved: 'none' },
      proposalEntity: { id: 'selling_time', resolution_status: 'resolved' },
      graphContextStatus: 'canonical', graphAuthority: 'canonical_strict', graphWasTrimmed: false,
    });
    expect(evidence?.status).toBe('resolved');
    if (evidence?.status !== 'resolved') return;
    expect(evidence.dependencies).toHaveLength(2);
    expect(evidence.bidirected).toEqual([
      expect.objectContaining({
        from_label: 'Ramp and disruption time',
        to_label: 'Sales rep time on selling activities',
        edge_type: 'bidirected',
      }),
    ]);
    expect(JSON.stringify(evidence)).not.toContain('Improve current CRM');
    expect(JSON.stringify(evidence)).not.toContain('Move to HubSpot');
  });

  it('fails weak on self-loops, duplicate endpoint ids and over-bound incoming coverage', () => {
    const common = {
      structureQuery: { kind: 'dependencies' as const, element_id: 'selling_time' },
      requestedSelection: { node_ids: ['selling_time'], edge_ids: [] },
      focus: {
        elements: [{ id: 'selling_time', kind: 'outcome', label: 'Sales rep time on selling activities', analysis_link: 'no_analysis' as const }],
        unresolved: 'none' as const, requested_count: 1, unresolved_count: 0,
      },
      groundedSelection: { element_ids: ['selling_time'], unresolved: 'none' as const },
      proposalEntity: { id: 'selling_time', resolution_status: 'resolved' },
      graphContextStatus: 'canonical' as const,
      graphAuthority: 'canonical_strict' as const,
      graphWasTrimmed: false,
    };
    expect(buildSelectedDependenciesEvidence(graph(
      selectedNodes,
      [...selectedEdges, { from: 'selling_time', to: 'selling_time', strength: 1 }],
    ), common)).toEqual({ status: 'ambiguous' });

    expect(buildSelectedDependenciesEvidence(graph(
      [...selectedNodes, { id: 'automation', kind: 'factor', label: 'Automation duplicate' }],
      selectedEdges,
    ), common)).toEqual({ status: 'ambiguous' });

    expect(buildSelectedDependenciesEvidence(graph(
      [...selectedNodes, { id: 'selling_time', kind: 'outcome', label: 'Selected duplicate' }],
      selectedEdges,
    ), common)).toEqual({ status: 'ambiguous' });

    const manyNodes = Array.from({ length: 25 }, (_, index) => ({
      id: `driver-${index}`, kind: 'factor', label: `Driver ${index}`,
    }));
    const manyEdges = manyNodes.map((node) => ({
      from: node.id, to: 'selling_time', strength: 0.2,
    }));
    expect(buildSelectedDependenciesEvidence(graph(
      [...selectedNodes, ...manyNodes.slice(0, 24)],
      manyEdges.slice(0, 24),
    ), common)).toMatchObject({ status: 'resolved' });
    expect(buildSelectedDependenciesEvidence(graph(
      [...selectedNodes, ...manyNodes],
      manyEdges,
    ), common)).toEqual({
      status: 'coverage_unavailable',
      reason: 'graph_coverage_unavailable',
    });
  });
});
