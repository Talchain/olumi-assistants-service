/**
 * Cross-handler invariants shared by the three V5 D1 deterministic
 * handlers (`set_factor_value`, `add_constraint`, `adjust_edge_strength`).
 *
 * The per-handler unit and integration files exercise each handler in
 * isolation; this file pins properties that must hold *uniformly* across
 * all three so future drift on one handler does not silently break the
 * D1 family contract:
 *
 *   1. NOOP proposals leave the analysis-affecting graph hash unchanged
 *      → post-dispatch freshness re-derivation keeps the verdict at
 *      `fresh` and no "Re-run analysis" chip is emitted on no-op
 *      mutations.
 *
 *   2. Genuine mutations change the analysis-affecting graph hash →
 *      freshness flips to `stale` and the rerun chip fires.
 *
 *   3. Every D1 handler returns `llm_calls_used === 0` on success and
 *      on NOOP — D1 is the deterministic family by spec §12 and must
 *      not route through any model.
 *
 *   4. Every D1 handler emits exactly one handler fact carrying a
 *      structured `result.status` of `'noop'` or `'applied'`, with the
 *      `noop` boolean flag in agreement.
 */

import { describe, expect, it } from 'vitest';

import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import type { HandlerInvocation } from '../../registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';

import { createSetFactorValueHandler } from '../set-factor-value.js';
import { createAddConstraintHandler } from '../add-constraint.js';
import { createAdjustEdgeStrengthHandler } from '../adjust-edge-strength.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';

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
      message: 'd1 cross-handler',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-1',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
  };
}

const setFactorValue = createSetFactorValueHandler();
const addConstraint = createAddConstraintHandler();
const adjustEdgeStrength = createAdjustEdgeStrengthHandler();

/**
 * One NOOP proposal per handler, each targeting an entity whose current
 * value already matches the proposed value in the shared D1 fixture.
 *
 *   - set_factor_value: f-churn currently sits at raw_value=4 / unit="%".
 *     Proposing { value: 4, unit: "%", cap: 100 } is a no-change apply.
 *
 *   - add_constraint: first turn adds the constraint; second turn with
 *     identical parameters is the no-change apply (idempotent
 *     collision rule, see add-constraint.ts file header).
 *
 *   - adjust_edge_strength: f-budget→g-revenue is fixture-defined with
 *     strength.mean = 0.4. Proposing 0.4 set is a no-change apply.
 */
function noopSetFactorValueProposal(): ProposalAction {
  return {
    handler_id: 'set_factor_value',
    entity: {
      id: 'f-churn',
      kind: 'node',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [
      {
        name: 'value',
        value: { value: 4, unit: '%', cap: 100 },
        operator: 'set',
        source: 'user_explicit',
      },
    ],
    cited_context_fields: [],
  };
}

function addConstraintProposal(value: number): ProposalAction {
  return {
    handler_id: 'add_constraint',
    entity: {
      id: 'f-churn',
      kind: 'node',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [
      { name: 'constraint_type', value: 'at_most', source: 'user_explicit' },
      { name: 'value', value, source: 'user_explicit' },
      { name: 'unit', value: '%', source: 'user_explicit' },
    ],
    cited_context_fields: [],
  };
}

function noopAdjustEdgeStrengthProposal(): ProposalAction {
  return {
    handler_id: 'adjust_edge_strength',
    entity: {
      id: 'f-budget→g-revenue',
      kind: 'edge',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [
      { name: 'strength', value: 0.4, operator: 'set', source: 'user_explicit' },
    ],
    cited_context_fields: [],
  };
}

function mutateSetFactorValueProposal(): ProposalAction {
  return {
    handler_id: 'set_factor_value',
    entity: {
      id: 'f-churn',
      kind: 'node',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [
      {
        name: 'value',
        value: { value: 5, unit: '%', cap: 100 },
        operator: 'set',
        source: 'user_explicit',
      },
    ],
    cited_context_fields: [],
  };
}

function mutateAdjustEdgeStrengthProposal(): ProposalAction {
  return {
    handler_id: 'adjust_edge_strength',
    entity: {
      id: 'f-budget→g-revenue',
      kind: 'edge',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [
      { name: 'strength', value: 0.7, operator: 'set', source: 'user_explicit' },
    ],
    cited_context_fields: [],
  };
}

describe('D1 cross-handler family invariants', () => {
  it('NOOP across all three handlers preserves the analysis-affecting graph hash', async () => {
    const baseHash = computeAnalysisAffectingGraphHash(buildD1Fixture());

    // 1. set_factor_value noop.
    const setOutcome = await setFactorValue(
      buildInvocation(buildD1Fixture(), noopSetFactorValueProposal()),
    );
    expect(setOutcome.handler_facts[0].noop).toBe(true);
    expect(setOutcome.handler_facts[0].result.status).toBe('noop');
    expect(computeAnalysisAffectingGraphHash(setOutcome.mutated_graph as GraphV3T)).toBe(
      baseHash,
    );

    // 2. add_constraint noop. First turn adds; the same payload on the
    // second turn (with the resulting graph as ingress) is a no-change.
    const firstAdd = await addConstraint(
      buildInvocation(buildD1Fixture(), addConstraintProposal(5)),
    );
    expect(firstAdd.handler_facts[0].noop).toBe(false);
    const firstAddGraph = firstAdd.mutated_graph as GraphV3T;
    const secondAdd = await addConstraint(
      buildInvocation(firstAddGraph, addConstraintProposal(5)),
    );
    expect(secondAdd.handler_facts[0].noop).toBe(true);
    expect(secondAdd.handler_facts[0].result.status).toBe('noop');
    expect(computeAnalysisAffectingGraphHash(secondAdd.mutated_graph as GraphV3T)).toBe(
      computeAnalysisAffectingGraphHash(firstAddGraph),
    );

    // 3. adjust_edge_strength noop.
    const adjustOutcome = await adjustEdgeStrength(
      buildInvocation(buildD1Fixture(), noopAdjustEdgeStrengthProposal()),
    );
    expect(adjustOutcome.handler_facts[0].noop).toBe(true);
    expect(adjustOutcome.handler_facts[0].result.status).toBe('noop');
    expect(
      computeAnalysisAffectingGraphHash(adjustOutcome.mutated_graph as GraphV3T),
    ).toBe(baseHash);
  });

  it('Real mutations flip the analysis-affecting graph hash for every D1 handler', async () => {
    const baseHash = computeAnalysisAffectingGraphHash(buildD1Fixture());

    const setOutcome = await setFactorValue(
      buildInvocation(buildD1Fixture(), mutateSetFactorValueProposal()),
    );
    expect(setOutcome.handler_facts[0].noop).toBe(false);
    expect(setOutcome.handler_facts[0].result.status).toBe('applied');
    expect(computeAnalysisAffectingGraphHash(setOutcome.mutated_graph as GraphV3T)).not.toBe(
      baseHash,
    );

    const addOutcome = await addConstraint(
      buildInvocation(buildD1Fixture(), addConstraintProposal(5)),
    );
    expect(addOutcome.handler_facts[0].noop).toBe(false);
    expect(addOutcome.handler_facts[0].result.status).toBe('applied');
    expect(computeAnalysisAffectingGraphHash(addOutcome.mutated_graph as GraphV3T)).not.toBe(
      baseHash,
    );

    const adjustOutcome = await adjustEdgeStrength(
      buildInvocation(buildD1Fixture(), mutateAdjustEdgeStrengthProposal()),
    );
    expect(adjustOutcome.handler_facts[0].noop).toBe(false);
    expect(adjustOutcome.handler_facts[0].result.status).toBe('applied');
    expect(
      computeAnalysisAffectingGraphHash(adjustOutcome.mutated_graph as GraphV3T),
    ).not.toBe(baseHash);
  });

  it('Every D1 handler returns llm_calls_used === 0 on success and on NOOP', async () => {
    // Apply + noop paths for each handler. The handler must never reach
    // a model provider; the deterministic spec §12 contract requires
    // llm_calls_used to be 0 on both the apply and the no-change paths.
    const appliedSet = await setFactorValue(
      buildInvocation(buildD1Fixture(), mutateSetFactorValueProposal()),
    );
    const noopSet = await setFactorValue(
      buildInvocation(buildD1Fixture(), noopSetFactorValueProposal()),
    );
    const appliedAdd = await addConstraint(
      buildInvocation(buildD1Fixture(), addConstraintProposal(5)),
    );
    const noopAdd = await addConstraint(
      buildInvocation(appliedAdd.mutated_graph as GraphV3T, addConstraintProposal(5)),
    );
    const appliedAdjust = await adjustEdgeStrength(
      buildInvocation(buildD1Fixture(), mutateAdjustEdgeStrengthProposal()),
    );
    const noopAdjust = await adjustEdgeStrength(
      buildInvocation(buildD1Fixture(), noopAdjustEdgeStrengthProposal()),
    );

    for (const outcome of [
      appliedSet,
      noopSet,
      appliedAdd,
      noopAdd,
      appliedAdjust,
      noopAdjust,
    ]) {
      expect(outcome.llm_calls_used).toBe(0);
      expect(outcome.handler_facts).toHaveLength(1);
      // Fact status / noop flag must agree on every path. Drift between
      // these two would mean a downstream consumer reading one signal
      // could disagree with one reading the other.
      const fact = outcome.handler_facts[0];
      expect(fact.result.status === 'noop').toBe(fact.noop === true);
    }
  });
});
