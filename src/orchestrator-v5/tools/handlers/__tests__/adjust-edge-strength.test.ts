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

function buildInvocation(graph: GraphV3T, proposal: ProposalAction): HandlerInvocation {
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
});
