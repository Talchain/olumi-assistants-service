import { describe, expect, it } from 'vitest';

import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import type { HandlerInvocation } from '../../registry.js';

import {
  createAdjustEdgeStrengthHandler,
  parseEdgeId,
} from '../adjust-edge-strength.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';

function buildInvocation(
  graph: GraphV3T,
  proposal: ProposalAction,
  edgeStrengthDirectionAuthority?: 'positive' | 'negative',
  edgeStrengthEndpointAuthority?: { readonly from: string; readonly to: string },
): HandlerInvocation {
  return {
    context: {
      session_id: 'scn-1',
      stage: 'frame',
      request_id: 'req-1',
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: 'scn-1',
      turn_id: 'turn-1',
      stage: 'frame',
      message: 'tweak the edge',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-1',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
    ...(edgeStrengthDirectionAuthority !== undefined
      ? { edgeStrengthDirectionAuthority }
      : {}),
    ...(edgeStrengthEndpointAuthority !== undefined
      ? { edgeStrengthEndpointAuthority }
      : {}),
  };
}

function makeProposal(p: {
  readonly entityId: string;
  readonly strength: unknown;
  readonly operator?: 'set' | 'increase' | 'decrease' | 'multiply';
  readonly std?: number;
}): ProposalAction {
  const params: ProposalAction['parameters'] = [
    {
      name: 'strength',
      value: p.strength,
      ...(p.operator !== undefined ? { operator: p.operator } : {}),
      source: 'user_explicit',
    },
  ];
  if (p.std !== undefined) {
    params.push({ name: 'std', value: p.std, source: 'user_explicit' });
  }
  return {
    handler_id: 'adjust_edge_strength',
    entity: {
      id: p.entityId,
      kind: 'edge',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: params,
    cited_context_fields: [],
  };
}

describe('parseEdgeId', () => {
  it('parses Unicode arrow', () => {
    expect(parseEdgeId('f-budget→g-revenue')).toEqual({ from: 'f-budget', to: 'g-revenue' });
  });

  it('parses ASCII arrow', () => {
    expect(parseEdgeId('f-budget->g-revenue')).toEqual({ from: 'f-budget', to: 'g-revenue' });
  });

  it('trims whitespace', () => {
    expect(parseEdgeId(' f-budget → g-revenue ')).toEqual({
      from: 'f-budget',
      to: 'g-revenue',
    });
  });

  it('returns null on missing arrow', () => {
    expect(parseEdgeId('f-budget')).toBeNull();
  });

  it('returns null on empty side', () => {
    expect(parseEdgeId('→g-revenue')).toBeNull();
    expect(parseEdgeId('f-budget→')).toBeNull();
  });
});

describe('adjust_edge_strength handler', () => {
  it('sets a positive edge moderate → strong', async () => {
    const handler = createAdjustEdgeStrengthHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({ entityId: 'f-budget→g-revenue', strength: 0.7, operator: 'set' }),
      ),
    );
    expect(outcome.assistant_text).toContain('moderate');
    expect(outcome.assistant_text).toContain('strong');
    expect(outcome.assistant_text).not.toMatch(/0\.\d/);
    const mutated = outcome.mutated_graph as GraphV3T;
    const edge = mutated.edges.find((e) => e.from === 'f-budget' && e.to === 'g-revenue');
    expect(edge?.strength.mean).toBe(0.7);
    expect(edge?.effect_direction).toBe('positive');
  });

  it('also accepts ASCII -> in the entity id', async () => {
    const handler = createAdjustEdgeStrengthHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({ entityId: 'f-budget->g-revenue', strength: 0.7, operator: 'set' }),
      ),
    );
    const mutated = outcome.mutated_graph as GraphV3T;
    expect(mutated.edges[0].strength.mean).toBe(0.7);
  });

  it('uses trusted exact endpoint bytes instead of retargeting through the trimming composite parser', async () => {
    const handler = createAdjustEdgeStrengthHandler();
    const graph = buildD1Fixture();
    const canonical = graph.edges.find(
      (edge) => edge.from === 'f-budget' && edge.to === 'g-revenue',
    )!;
    const exactWhitespaceEdge = structuredClone(canonical);
    exactWhitespaceEdge.from = ' f-budget ';
    exactWhitespaceEdge.strength.mean = 0.2;
    graph.edges.unshift(exactWhitespaceEdge);

    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({
          // The legacy parser would trim this and select the OTHER edge.
          entityId: ' f-budget →g-revenue',
          strength: 0.8,
          operator: 'set',
        }),
        'positive',
        { from: ' f-budget ', to: 'g-revenue' },
      ),
    );
    const mutated = outcome.mutated_graph as GraphV3T;
    expect(mutated.edges.find(
      (edge) => edge.from === ' f-budget ' && edge.to === 'g-revenue',
    )?.strength.mean).toBe(0.8);
    expect(mutated.edges.find(
      (edge) => edge.from === 'f-budget' && edge.to === 'g-revenue',
    )?.strength.mean).toBe(0.4);
    expect(outcome.handler_facts[0]).toMatchObject({
      result: {
        after: { from: ' f-budget ', to: 'g-revenue' },
      },
    });
  });

  it('clamps an over-range increase to 1.0', async () => {
    const handler = createAdjustEdgeStrengthHandler();
    const graph = buildD1Fixture();
    // f-quality starts at 0.95.
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({
          entityId: 'f-quality→g-revenue',
          strength: 0.5,
          operator: 'increase',
        }),
      ),
    );
    const mutated = outcome.mutated_graph as GraphV3T;
    const edge = mutated.edges.find((e) => e.from === 'f-quality');
    expect(edge?.strength.mean).toBe(1);
  });

  it('preserves sign on a negative-edge strengthen', async () => {
    const handler = createAdjustEdgeStrengthHandler();
    const graph = buildD1Fixture();
    // f-churn starts at -0.6 (moderate, negative). Strengthen → -0.8.
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({ entityId: 'f-churn→g-revenue', strength: -0.8, operator: 'set' }),
      ),
    );
    const mutated = outcome.mutated_graph as GraphV3T;
    const edge = mutated.edges.find((e) => e.from === 'f-churn');
    expect(edge?.strength.mean).toBe(-0.8);
    expect(edge?.effect_direction).toBe('negative');
    expect(outcome.assistant_text).toContain('(negative)');
  });

  it('flips effect_direction on sign change', async () => {
    const handler = createAdjustEdgeStrengthHandler();
    const graph = buildD1Fixture();
    // f-budget edge mean 0.4 → set to -0.2 → direction flips.
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({ entityId: 'f-budget→g-revenue', strength: -0.2, operator: 'set' }),
      ),
    );
    const mutated = outcome.mutated_graph as GraphV3T;
    const edge = mutated.edges.find((e) => e.from === 'f-budget');
    expect(edge?.effect_direction).toBe('negative');
    expect(outcome.assistant_text).toContain('Direction reversed');
  });

  it('produces "no material influence" for near-zero set', async () => {
    const handler = createAdjustEdgeStrengthHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({ entityId: 'f-budget→g-revenue', strength: 0, operator: 'set' }),
      ),
    );
    expect(outcome.assistant_text).toContain('no material influence');
    expect(outcome.assistant_text).not.toMatch(/[0-9]+\.[0-9]+/);
  });

  it.each(['positive', 'negative'] as const)(
    'retains explicit %s direction when strength is exactly zero',
    async (effectDirection) => {
      const handler = createAdjustEdgeStrengthHandler();
      const graph = buildD1Fixture();
      const outcome = await handler(
        buildInvocation(
          graph,
          makeProposal({
            entityId: 'f-budget→g-revenue',
            strength: 0,
            operator: 'set',
          }),
          effectDirection,
        ),
      );
      const edge = (outcome.mutated_graph as GraphV3T).edges.find(
        (candidate) => candidate.from === 'f-budget' && candidate.to === 'g-revenue',
      );
      expect(edge?.strength.mean).toBe(0);
      expect(edge?.effect_direction).toBe(effectDirection);
    },
  );

  it('treats a zero-strength direction change as analysis-affecting and describes it honestly', async () => {
    const handler = createAdjustEdgeStrengthHandler();
    const graph = buildD1Fixture();
    const baseEdge = graph.edges.find(
      (edge) => edge.from === 'f-budget' && edge.to === 'g-revenue',
    )!;
    baseEdge.strength.mean = 0;
    baseEdge.effect_direction = 'positive';

    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({
          entityId: 'f-budget→g-revenue',
          strength: 0,
          operator: 'set',
        }),
        'negative',
      ),
    );

    expect(outcome.handler_facts[0]).toMatchObject({ noop: false });
    expect(outcome.assistant_text).toContain('strength remains zero');
    expect(outcome.assistant_text).toContain('direction');
    expect(outcome.assistant_text).toContain('negative');
    expect(computeAnalysisAffectingGraphHash(graph)).not.toBe(
      computeAnalysisAffectingGraphHash(outcome.mutated_graph as GraphV3T),
    );
  });

  it('rejects an explicit direction that contradicts a non-zero strength', async () => {
    const handler = createAdjustEdgeStrengthHandler();
    const graph = buildD1Fixture();
    await expect(
      handler(
        buildInvocation(
          graph,
          makeProposal({
            entityId: 'f-budget→g-revenue',
            strength: 0.5,
            operator: 'set',
          }),
          'negative',
        ),
      ),
    ).rejects.toMatchObject({ cause_kind: 'parameter_invalid_at_execute' });
  });

  it.each(['user_explicit', 'inferred', 'default'] as const)(
    'rejects an untrusted %s proposal parameter that tries to set zero direction',
    async (source) => {
      const handler = createAdjustEdgeStrengthHandler();
      const graph = buildD1Fixture();
      const proposal = makeProposal({
        entityId: 'f-budget→g-revenue',
        strength: 0,
        operator: 'set',
      });
      proposal.parameters.push({
        name: 'effect_direction',
        value: 'negative',
        source,
      });

      await expect(handler(buildInvocation(graph, proposal))).rejects.toMatchObject({
        cause_kind: 'parameter_invalid_at_execute',
      });
    },
  );

  it('rejects out-of-range strength (>1)', async () => {
    const handler = createAdjustEdgeStrengthHandler();
    const graph = buildD1Fixture();
    await expect(
      handler(
        buildInvocation(
          graph,
          makeProposal({ entityId: 'f-budget→g-revenue', strength: 1.5, operator: 'set' }),
        ),
      ),
    ).rejects.toMatchObject({ cause_kind: 'parameter_invalid_at_execute' });
  });

  it('rejects malformed edge id', async () => {
    const handler = createAdjustEdgeStrengthHandler();
    const graph = buildD1Fixture();
    await expect(
      handler(
        buildInvocation(
          graph,
          makeProposal({ entityId: 'just-a-string', strength: 0.5, operator: 'set' }),
        ),
      ),
    ).rejects.toMatchObject({ cause_kind: 'parameter_invalid_at_execute' });
  });

  it('rejects edge not present in graph', async () => {
    const handler = createAdjustEdgeStrengthHandler();
    const graph = buildD1Fixture();
    await expect(
      handler(
        buildInvocation(
          graph,
          makeProposal({ entityId: 'nothing→else', strength: 0.5, operator: 'set' }),
        ),
      ),
    ).rejects.toMatchObject({ cause_kind: 'entity_not_found_in_graph' });
  });

  it('changes graph hash so prior analysis is marked stale', async () => {
    const handler = createAdjustEdgeStrengthHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({ entityId: 'f-budget→g-revenue', strength: 0.7, operator: 'set' }),
      ),
    );
    expect(computeAnalysisAffectingGraphHash(graph)).not.toBe(
      computeAnalysisAffectingGraphHash(outcome.mutated_graph as GraphV3T),
    );
  });

  it('confirmation never contains a raw decimal', async () => {
    const handler = createAdjustEdgeStrengthHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({ entityId: 'f-budget→g-revenue', strength: 0.7, operator: 'set' }),
      ),
    );
    expect(outcome.assistant_text).not.toMatch(/[0-9]+\.[0-9]+/);
  });

  it('emits noop status when strength is set to its current value', async () => {
    // Fixture: f-budget→g-revenue has strength.mean = 0.4. Setting it
    // to the same value via `set` must produce `status: 'noop'`,
    // `noop: true`, and must not change the analysis-affecting graph
    // hash (so post-dispatch freshness re-derivation keeps `fresh`).
    const handler = createAdjustEdgeStrengthHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({ entityId: 'f-budget→g-revenue', strength: 0.4, operator: 'set' }),
      ),
    );
    const fact = outcome.handler_facts[0];
    expect(fact.noop).toBe(true);
    expect(fact.result.status).toBe('noop');
    expect(outcome.llm_calls_used).toBe(0);
    expect(computeAnalysisAffectingGraphHash(graph)).toBe(
      computeAnalysisAffectingGraphHash(outcome.mutated_graph as GraphV3T),
    );
  });

  it('emits noop status when increase resolves to current strength', async () => {
    // Idempotency on a non-set operator: increasing by 0 against the
    // current value also produces noop. Pins that the noop predicate
    // tracks the final (clamped) result, not the operator type.
    const handler = createAdjustEdgeStrengthHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({ entityId: 'f-budget→g-revenue', strength: 0, operator: 'increase' }),
      ),
    );
    const fact = outcome.handler_facts[0];
    expect(fact.noop).toBe(true);
    expect(fact.result.status).toBe('noop');
  });
});
