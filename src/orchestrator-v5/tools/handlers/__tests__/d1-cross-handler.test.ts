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
 *
 * Scope of "NOOP" in these assertions
 * -----------------------------------
 *
 * NOOP here means "**analysis-affecting** no-op": the value/raw_value/
 * unit/cap on a factor, the (value, operator, label, unit) on a
 * constraint, or the (mean, std, effect_direction) on an edge are
 * unchanged by the apply. The freshness hash function
 * `computeAnalysisAffectingGraphHash` is the canonical proxy for this
 * contract — if it doesn't change, post-dispatch freshness re-derivation
 * keeps `fresh` and the UI never sees a spurious "Re-run analysis" chip.
 *
 * It does NOT mean "literal byte-for-byte graph immutability". The live
 * D1 handlers intentionally stamp provenance/display metadata on apply
 * even when the semantic value was already the proposed one:
 *
 *   - `set_factor_value` sets `node.provenance = 'user_set'` and
 *     unconditionally recomputes `display_value` via the canonical
 *     synthesiser. `display_value` may be repaired (e.g. a stale string
 *     replaced with the canonical one, or cleared when the synthesiser
 *     declines), but it is non-analysis-affecting. Provenance may flip
 *     to `'user_set'` even when the prior `NodeV3.provenance` enum was
 *     `'from_brief'` or `'ai_inferred'`.
 *   - `adjust_edge_strength` stamps `edge.provenance.source =
 *     'user_specified'` and `edge.provenance_display = 'user_set'`.
 *
 * That metadata stamping reflects user intent (the user just said
 * "set X to Y" — `'user_set'` is correct regardless of whether Y was
 * already the value) and is by design. Future deep-equality assertions
 * on the apply result must therefore allow provenance/display drift.
 */

import { describe, expect, it } from 'vitest';

import type {
  AddConstraintHandlerFact,
  AdjustEdgeStrengthHandlerFact,
  HandlerFact,
  SetFactorValueHandlerFact,
} from '@talchain/schemas/orchestrator';

import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import type { HandlerInvocation } from '../../registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';

import { createSetFactorValueHandler } from '../set-factor-value.js';
import { createAddConstraintHandler } from '../add-constraint.js';
import { createAdjustEdgeStrengthHandler } from '../adjust-edge-strength.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';

/**
 * Discriminated-union narrow for the three D1 fact types. The raw
 * `HandlerFact` union includes `RunAnalysisHandlerFact` whose
 * `.result` shape has no `status` field, so accessing `.result.status`
 * on the raw union does not typecheck. The per-handler test files
 * inherit the same pattern and the same TS2339s — kept inline cast
 * here so this new file does not add to the baseline error count.
 */
function asD1Fact(
  fact: HandlerFact,
): SetFactorValueHandlerFact | AddConstraintHandlerFact | AdjustEdgeStrengthHandlerFact {
  return fact as SetFactorValueHandlerFact | AddConstraintHandlerFact | AdjustEdgeStrengthHandlerFact;
}

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
    expect(asD1Fact(setOutcome.handler_facts[0]).result.status).toBe('noop');
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
    expect(asD1Fact(secondAdd.handler_facts[0]).result.status).toBe('noop');
    expect(computeAnalysisAffectingGraphHash(secondAdd.mutated_graph as GraphV3T)).toBe(
      computeAnalysisAffectingGraphHash(firstAddGraph),
    );

    // 3. adjust_edge_strength noop.
    const adjustOutcome = await adjustEdgeStrength(
      buildInvocation(buildD1Fixture(), noopAdjustEdgeStrengthProposal()),
    );
    expect(adjustOutcome.handler_facts[0].noop).toBe(true);
    expect(asD1Fact(adjustOutcome.handler_facts[0]).result.status).toBe('noop');
    expect(
      computeAnalysisAffectingGraphHash(adjustOutcome.mutated_graph as GraphV3T),
    ).toBe(baseHash);
  });

  it('NOOP scope: analysis-affecting fields immutable; provenance metadata stamping is allowed', async () => {
    // Reviewer follow-up — the hash-equality assertions above prove
    // post-dispatch freshness re-derivation stays `fresh`, but they do
    // NOT prove "the apply result is byte-for-byte equal to ingress".
    // The live D1 handlers intentionally stamp provenance/display
    // metadata on every apply (including no-change applies) to reflect
    // user intent. This test pins the actual contract on both sides:
    //
    //   - analysis-affecting fields are unchanged (value, raw_value,
    //     unit, cap on factors; mean / std / effect_direction on edges);
    //   - provenance metadata may be stamped (`'user_set'` on factors,
    //     `'user_specified'` source on edges).
    //
    // If a future change tightens the runtime to "no graph mutation on
    // noop", the provenance assertions below must flip — but the
    // analysis-affecting-immutability assertions must continue to hold.

    // 1. set_factor_value — value unchanged, provenance stamped.
    const setIngress = buildD1Fixture();
    const churnBefore = setIngress.nodes.find((n) => n.id === 'f-churn');
    expect(churnBefore?.provenance).toBeUndefined();
    const setOutcome = await setFactorValue(
      buildInvocation(setIngress, noopSetFactorValueProposal()),
    );
    expect(setOutcome.handler_facts[0].noop).toBe(true);
    const churnAfter = (setOutcome.mutated_graph as GraphV3T).nodes.find(
      (n) => n.id === 'f-churn',
    );
    expect(churnAfter?.observed_state?.value).toBe(churnBefore?.observed_state?.value);
    expect(churnAfter?.observed_state?.raw_value).toBe(churnBefore?.observed_state?.raw_value);
    expect(churnAfter?.observed_state?.unit).toBe(churnBefore?.observed_state?.unit);
    expect(churnAfter?.observed_state?.cap).toBe(churnBefore?.observed_state?.cap);
    // Provenance stamping on noop is intentional — see file header.
    expect(churnAfter?.provenance).toBe('user_set');

    // 2. adjust_edge_strength — strength unchanged, edge provenance stamped.
    const edgeIngress = buildD1Fixture();
    const edgeBefore = edgeIngress.edges.find(
      (e) => e.from === 'f-budget' && e.to === 'g-revenue',
    );
    expect(edgeBefore?.provenance_display).toBeUndefined();
    const adjustOutcome = await adjustEdgeStrength(
      buildInvocation(edgeIngress, noopAdjustEdgeStrengthProposal()),
    );
    expect(adjustOutcome.handler_facts[0].noop).toBe(true);
    const edgeAfter = (adjustOutcome.mutated_graph as GraphV3T).edges.find(
      (e) => e.from === 'f-budget' && e.to === 'g-revenue',
    );
    expect(edgeAfter?.strength.mean).toBe(edgeBefore?.strength.mean);
    expect(edgeAfter?.strength.std).toBe(edgeBefore?.strength.std);
    expect(edgeAfter?.effect_direction).toBe(edgeBefore?.effect_direction);
    // Provenance stamping on noop is intentional — see file header.
    expect(edgeAfter?.provenance?.source).toBe('user_specified');
    expect(edgeAfter?.provenance_display).toBe('user_set');
  });

  it('Real mutations flip the analysis-affecting graph hash for every D1 handler', async () => {
    const baseHash = computeAnalysisAffectingGraphHash(buildD1Fixture());

    const setOutcome = await setFactorValue(
      buildInvocation(buildD1Fixture(), mutateSetFactorValueProposal()),
    );
    expect(setOutcome.handler_facts[0].noop).toBe(false);
    expect(asD1Fact(setOutcome.handler_facts[0]).result.status).toBe('applied');
    expect(computeAnalysisAffectingGraphHash(setOutcome.mutated_graph as GraphV3T)).not.toBe(
      baseHash,
    );

    const addOutcome = await addConstraint(
      buildInvocation(buildD1Fixture(), addConstraintProposal(5)),
    );
    expect(addOutcome.handler_facts[0].noop).toBe(false);
    expect(asD1Fact(addOutcome.handler_facts[0]).result.status).toBe('applied');
    expect(computeAnalysisAffectingGraphHash(addOutcome.mutated_graph as GraphV3T)).not.toBe(
      baseHash,
    );

    const adjustOutcome = await adjustEdgeStrength(
      buildInvocation(buildD1Fixture(), mutateAdjustEdgeStrengthProposal()),
    );
    expect(adjustOutcome.handler_facts[0].noop).toBe(false);
    expect(asD1Fact(adjustOutcome.handler_facts[0]).result.status).toBe('applied');
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
      const fact = asD1Fact(outcome.handler_facts[0]);
      expect(fact.result.status === 'noop').toBe(fact.noop === true);
    }
  });

  // --------------------------------------------------------------------
  // Gate-1 claim integrity: the TEXT channel must agree with the FACT
  // channel on a no-op. The four-state vocabulary is proposed / applied /
  // blocked / stale; "noop" must never render as "applied".
  //
  // Family-level pin: every D1 handler computes `noop` for its fact, so
  // every D1 handler's narration must honour it. Before this fix only
  // add_constraint did (ROADMAP 1.19(a)); set_factor_value narrated
  // "Updated X from 0.8 to 0.8." and adjust_edge_strength narrated
  // "Adjusted the link ... from moderate to moderate." — both false
  // "a change happened" claims on a turn where nothing changed.
  // --------------------------------------------------------------------
  it('NOOP narration never claims a change: no leading commit verb on any D1 handler', async () => {
    const noopSet = await setFactorValue(
      buildInvocation(buildD1Fixture(), noopSetFactorValueProposal()),
    );
    const firstAdd = await addConstraint(
      buildInvocation(buildD1Fixture(), addConstraintProposal(5)),
    );
    const noopAdd = await addConstraint(
      buildInvocation(firstAdd.mutated_graph as GraphV3T, addConstraintProposal(5)),
    );
    const noopAdjust = await adjustEdgeStrength(
      buildInvocation(buildD1Fixture(), noopAdjustEdgeStrengthProposal()),
    );

    for (const outcome of [noopSet, noopAdd, noopAdjust]) {
      // Precondition: these really are the no-op paths.
      expect(outcome.handler_facts[0].noop).toBe(true);
      // A no-op receipt must not open with a commit verb. `formatFactor-
      // Change` ("Updated …"), `formatFactorValueSet` ("Updated …"),
      // `formatConstraintUpdated` ("Updated constraint: …") and
      // `formatEdgeAdjustment` ("Adjusted the link …") all do.
      expect(outcome.assistant_text).not.toMatch(/^(Updated|Set|Added|Adjusted|Changed)\b/);
      // And it must positively say the value was already there.
      expect(outcome.assistant_text).toMatch(/\balready\b/);
    }
  });

  it('NOOP narration never emits an X-to-X change receipt', async () => {
    // The precise live defect: "Updated Customer churn from 4% to 4%."
    // A from-A-to-A receipt is self-evidently a non-change rendered as a
    // change; assert the shape is gone rather than only that some
    // "already" wording appeared somewhere in the string.
    const noopSet = await setFactorValue(
      buildInvocation(buildD1Fixture(), noopSetFactorValueProposal()),
    );
    expect(noopSet.assistant_text).not.toMatch(/from\s+(.+?)\s+to\s+\1/);
    expect(noopSet.assistant_text).not.toContain('from 4% to 4%');

    const noopAdjust = await adjustEdgeStrength(
      buildInvocation(buildD1Fixture(), noopAdjustEdgeStrengthProposal()),
    );
    expect(noopAdjust.assistant_text).not.toMatch(/from\s+(.+?)\s+to\s+\1/);
  });

  it('APPLIED narration still claims the change (the fix must discriminate, not blanket-silence)', async () => {
    // Guard against "fix by suppression": a change that DID happen must
    // still get its commit-verb receipt. Without this, returning a
    // constant "nothing changed" string would pass the two tests above.
    const appliedSet = await setFactorValue(
      buildInvocation(buildD1Fixture(), mutateSetFactorValueProposal()),
    );
    expect(appliedSet.handler_facts[0].noop).toBe(false);
    expect(appliedSet.assistant_text).toMatch(/^Updated\b/);
    expect(appliedSet.assistant_text).not.toMatch(/\balready\b/);

    const appliedAdjust = await adjustEdgeStrength(
      buildInvocation(buildD1Fixture(), mutateAdjustEdgeStrengthProposal()),
    );
    expect(appliedAdjust.handler_facts[0].noop).toBe(false);
    expect(appliedAdjust.assistant_text).toMatch(/^Adjusted\b/);
    expect(appliedAdjust.assistant_text).not.toMatch(/\balready\b/);
  });
});
