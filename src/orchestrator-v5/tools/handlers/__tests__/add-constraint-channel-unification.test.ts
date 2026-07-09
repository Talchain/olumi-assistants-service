/**
 * Overnight review F8 + F9 (+ N1's label-sensitivity secondary) — ONE
 * add-constraint channel-unification fix, per the mega-review's
 * ORCHESTRATOR-DEFAULT doctrine (pending Paul ratification, see
 * acceptance-evidence/receipt-honesty/README.md).
 *
 * F8 — the draft path (cee/factor-extraction/enricher.ts) registers a
 * success target by stamping `goal_threshold_raw`/`_unit` on the goal node
 * DIRECTLY — it never writes a `goal_constraints` row. `add_constraint`'s
 * unchanged-value detection previously read ONLY `graph.goal_constraints`,
 * so a restatement of the identical value after a draft-stamped target
 * always found `existing === undefined` and fell through to
 * `formatGoalTargetSet` — a false fresh-registration claim for a value
 * that was already registered, via the OTHER channel.
 *
 * F9 — the goal-target mutation closure unconditionally re-stamped
 * `goal_threshold_raw/_unit/_cap` on the node whenever `isGoalTargetSet`,
 * regardless of `valueUnchanged` (which was computed AFTER the mutation
 * already ran). A legacy-divergent graph (a `goal_constraints` row present,
 * but the node never stamped — the Gate-item-8 dead-end) restated at the
 * SAME value got a noop text + noop fact, while the committed
 * `mutated_graph` newly stamped the node fields the analysis-affecting
 * hash reads — moving the hash on a turn whose own receipt says nothing
 * changed.
 *
 * Fix: compare BOTH channels (the `goal_constraints` row AND the node's
 * own `goal_threshold_raw`/`_unit`) for value-sameness, with `label`
 * excluded from the predicate (a label-only change gets its own distinct
 * receipt, not a value-change claim) — and gate ONLY the node
 * goal_threshold_raw/_unit/_cap stamp on that sameness check, so a true
 * noop turn cannot move the analysis-affecting graph hash. The
 * goal_constraints row upsert itself still runs unconditionally
 * (idempotent on a real no-op — same content in, same content out),
 * preserving the pre-existing D1 cross-handler contract that every
 * handler returns a `mutated_graph` on every outcome, noop included (see
 * d1-cross-handler.test.ts).
 */
import { describe, expect, it } from 'vitest';

import type { HandlerInvocation } from '../../registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import type { GraphStateIngress } from '../../../boundary/request-extensions.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { createAddConstraintHandler } from '../add-constraint.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';

function buildInvocation(graph: GraphV3T, proposal: ProposalAction): HandlerInvocation {
  return {
    context: {
      session_id: 'scn-channel-unification',
      stage: 'frame',
      request_id: 'req-channel-unification',
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: 'scn-channel-unification',
      turn_id: 'turn-channel-unification',
      stage: 'frame',
      message: 'restate the same target',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-channel-unification',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
  };
}

function goalProposal(p: { value: number; unit?: string; label?: string }): ProposalAction {
  const params: ProposalAction['parameters'] = [
    { name: 'constraint_type', value: 'at_least', source: 'user_explicit' },
    { name: 'value', value: p.value, source: 'user_explicit' },
  ];
  if (p.unit) params.push({ name: 'unit', value: p.unit, source: 'user_explicit' });
  if (p.label) params.push({ name: 'label', value: p.label, source: 'user_explicit' });
  return {
    handler_id: 'add_constraint',
    entity: {
      id: 'g-revenue',
      kind: 'goal',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: params,
    cited_context_fields: [],
  };
}

describe('F8: unchanged-value detection compares BOTH channels (goal_constraints row AND node threshold fields)', () => {
  it('draft-registration channel (node stamped, NO goal_constraints row): restating the identical value is recognised as unchanged, not a fresh "set" claim', async () => {
    const graph = buildD1Fixture();
    const goalNode = graph.nodes.find((n) => n.id === 'g-revenue')!;
    // Simulate the draft path: node stamped directly, no goal_constraints
    // row ever written (enricher.ts never touches goal_constraints).
    (goalNode as Record<string, unknown>).goal_threshold_raw = 15;
    (goalNode as Record<string, unknown>).goal_threshold_unit = '%';
    (goalNode as Record<string, unknown>).goal_threshold_cap = 100;
    (goalNode as Record<string, unknown>).goal_threshold = 0.15;
    expect(graph.goal_constraints).toBeUndefined();

    const handler = createAddConstraintHandler();
    const outcome = await handler(
      buildInvocation(graph, goalProposal({ value: 15, unit: '%' })),
    );

    // Must NOT claim a fresh registration — the value is already
    // registered via the node-stamp channel.
    expect(outcome.assistant_text).not.toContain('Success target set');
    expect(outcome.assistant_text).toMatch(/already/i);
    expect(outcome.handler_facts[0]?.result).toMatchObject({ status: 'noop' });
  });
});

describe('F9: a true no-op turn must not stamp node threshold fields (analysis-affecting hash cannot move)', () => {
  it('legacy-divergent graph (goal_constraints row present, node NEVER stamped): restating the same value at the row does not move the analysis-affecting graph hash', async () => {
    const graph = buildD1Fixture();
    // Legacy divergence (Gate-item-8 dead-end): a goal_constraints row
    // exists at the target value, but the node's own threshold fields
    // were never stamped.
    graph.goal_constraints = [
      {
        constraint_id: 'gc-legacy',
        node_id: 'g-revenue',
        operator: '>=',
        value: 15,
        unit: '%',
        label: 'Revenue',
        provenance: 'explicit',
      },
    ];
    const goalNode = graph.nodes.find((n) => n.id === 'g-revenue')!;
    expect((goalNode as Record<string, unknown>).goal_threshold_raw).toBeUndefined();

    const hashBefore = computeAnalysisAffectingGraphHash(
      graph as unknown as GraphStateIngress,
    );

    const handler = createAddConstraintHandler();
    const outcome = await handler(
      buildInvocation(graph, goalProposal({ value: 15, unit: '%' })),
    );

    expect(outcome.assistant_text).toMatch(/already/i);
    expect(outcome.handler_facts[0]?.result).toMatchObject({ status: 'noop' });

    // The defect: the OLD code unconditionally stamped
    // goal_threshold_raw/_unit/_cap on the node whenever isGoalTargetSet,
    // even on a noop turn — moving the analysis-affecting hash. The fix
    // gates ONLY the node stamp, not the whole mutation (a noop still
    // rewrites the goal_constraints row with byte-identical content,
    // matching every other D1 handler's noop contract — see
    // d1-cross-handler.test.ts): the returned mutated_graph's hash must
    // equal the pre-turn hash.
    expect(
      computeAnalysisAffectingGraphHash(outcome.mutated_graph as GraphStateIngress),
    ).toBe(hashBefore);
    const stampedNode = (outcome.mutated_graph as { nodes: Array<Record<string, unknown>> }).nodes.find(
      (n) => n.id === 'g-revenue',
    )!;
    expect(stampedNode.goal_threshold_raw).toBeUndefined();

    // Positive control: if the node HAD been (re-)stamped, prove the hash
    // would in fact have moved — grounds why the assertion above is
    // load-bearing, not incidental.
    const wouldBeGraph = structuredClone(graph) as unknown as GraphStateIngress;
    const wouldBeStampedNode = (wouldBeGraph.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === 'g-revenue',
    )!;
    wouldBeStampedNode.goal_threshold_raw = 15;
    wouldBeStampedNode.goal_threshold_unit = '%';
    wouldBeStampedNode.goal_threshold_cap = 100;
    const hashIfStamped = computeAnalysisAffectingGraphHash(wouldBeGraph);
    expect(hashIfStamped).not.toBe(hashBefore);
  });
});

describe('F8 secondary: label is excluded from the value-sameness predicate', () => {
  it('a label-only change on an otherwise-identical value gets a distinct "label updated" receipt, not a fresh value-change claim', async () => {
    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();

    const proposalV1: ProposalAction = {
      handler_id: 'add_constraint',
      entity: {
        id: 'f-churn',
        kind: 'node',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        { name: 'constraint_type', value: 'at_most', source: 'user_explicit' },
        { name: 'value', value: 5, source: 'user_explicit' },
        { name: 'unit', value: '%', source: 'user_explicit' },
      ],
      cited_context_fields: [],
    };
    const first = await handler(buildInvocation(graph, proposalV1));
    expect(first.assistant_text).toContain('Added constraint');

    // Restate the SAME value/unit but with a different label supplied.
    const proposalV2: ProposalAction = {
      ...proposalV1,
      parameters: [
        ...proposalV1.parameters,
        { name: 'label', value: 'Churn rate', source: 'user_explicit' },
      ],
    };
    const second = await handler(
      buildInvocation(first.mutated_graph as GraphV3T, proposalV2),
    );

    // Must NOT read as a fresh value update (the value did not change).
    expect(second.assistant_text).not.toMatch(/^Updated constraint:/i);
    // Must NOT read as a total no-op either — the label DID change and
    // was persisted; a distinct receipt names that.
    expect(second.assistant_text).toMatch(/label/i);
  });
});
