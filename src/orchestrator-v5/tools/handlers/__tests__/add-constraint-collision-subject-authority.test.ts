/**
 * ⭐⭐ THE OTHER HALF OF THE COLLISION TRANSITION, AT THE REAL HANDLER.
 *
 * The routing suite proves the dispatch verdict. It cannot prove the thing the
 * user actually cares about: that a subject-bound answer, given while two
 * questions are open, ends up RECORDED as the baseline of the node the user
 * named — and of no other node. A dispatch verdict is not a write.
 *
 * So this suite runs the REAL `add_constraint` handler with a competing
 * bare-number ask live, in both of its persisted spellings, and reads the
 * mutated graph back.
 *
 * WHY THE HANDLER ALREADY GETS THIS RIGHT, and why the fix is a restoration
 * rather than a new capability: the handler's own gate is
 *
 *     ellipticalAllowed = soleElicitPending !== null && target matches
 *
 * and when that is FALSE it still runs `deriveStatedTargetBaselinePercent` —
 * the subject-bearing limb. The collision competitor makes `ellipticalAllowed`
 * false, which is exactly right for a bare number and exactly irrelevant to a
 * reply that names its own subject. The regression was upstream: the reply
 * never reached here.
 *
 * BOTH DIRECTIONS, SAME RUN. The elliptical cases must record NOTHING while a
 * competitor is live (the harm the transition targets), and the subject-bound
 * cases must record the right value on the right node (the harm it introduced).
 *
 * Assertions bind by IDENTITY: the node id, the exact fraction, and an explicit
 * sweep asserting every OTHER node's baseline stayed undefined.
 */

import { describe, expect, it } from 'vitest';

import type { HandlerInvocation } from '../../registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import type { PendingAction } from '../../../session/pending-action.js';
import { createAddConstraintHandler } from '../add-constraint.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';

const TARGET_ID = 'o-churn-rate';
const TARGET_LABEL = 'Churn rate';

/**
 * ⚠ THE SHARED D1 FIXTURE CARRIES A NODE LABELLED "Customer churn", and that is
 * a SECOND churn-worded node beside the target "Churn rate". The pre-existing
 * 2.960 R2 unanimity rule then refuses the bare subject "Churn" as genuinely
 * ambiguous between the two — correctly, and with nothing to do with this
 * transition. Left in place it would have made these cases measure the
 * ambiguity rule rather than the collision fix, so the main population renames
 * it, and the `ambiguousSibling` variant below keeps it deliberately in order to
 * pin that the rule is still there.
 */
function graphWithConstraintTargets(opts?: {
  readonly ambiguousSibling?: boolean;
  readonly secondLimitRow?: boolean;
}): GraphV3T {
  const g = buildD1Fixture();
  if (opts?.ambiguousSibling !== true) {
    const sibling = g.nodes.find((n) => n.label === 'Customer churn');
    expect(
      sibling,
      'the D1 fixture no longer carries the "Customer churn" node this suite compensates for',
    ).toBeDefined();
    (sibling as { label: string }).label = 'Support load';
  }
  g.nodes.push(
    { id: TARGET_ID, kind: 'outcome', label: TARGET_LABEL } as GraphV3T['nodes'][number],
    { id: 'r-breach', kind: 'risk', label: 'Breach likelihood' } as GraphV3T['nodes'][number],
    {
      id: 'f-acar',
      kind: 'factor',
      label: 'Annual Contract Adoption Rate',
    } as GraphV3T['nodes'][number],
  );
  g.edges.push(
    {
      from: 'f-quality',
      to: TARGET_ID,
      strength: { mean: -0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'negative',
    } as GraphV3T['edges'][number],
    {
      from: 'f-budget',
      to: 'r-breach',
      strength: { mean: 0.3, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    } as GraphV3T['edges'][number],
  );
  (g as { goal_constraints?: unknown[] }).goal_constraints = [
    {
      constraint_id: 'gc-persisted-1',
      node_id: TARGET_ID,
      operator: '<=',
      value: 10,
      label: TARGET_LABEL,
      provenance: 'explicit',
      unit: '%',
      value_frame: 'level',
    },
    // A SECOND limit on the SAME node, opposite operator — a floor beside the
    // ceiling. Off by default so every existing case is byte-identical.
    ...(opts?.secondLimitRow === true
      ? [
          {
            constraint_id: 'gc-persisted-2',
            node_id: TARGET_ID,
            operator: '>=',
            value: 2,
            label: TARGET_LABEL,
            provenance: 'explicit',
            unit: '%',
            value_frame: 'level',
          },
        ]
      : []),
  ];
  return g;
}

const baselinePending = {
  id: 'pa-elicit-1',
  scenario_id: 'scn-1',
  chip_id: 'chip_elicit_target_baseline',
  action: {
    kind: 'elicit_target_baseline',
    target_id: TARGET_ID,
    target_label: TARGET_LABEL,
    constraint_type: 'at_most',
    value: 10,
    unit: '%',
    label: TARGET_LABEL,
  },
  preconditions: { graph_hash: 'sha256:test' },
  expires_at_turn_count: 2,
  expires_at_iso: '2099-12-31T23:59:59.000Z',
  emitted_at_iso: '2026-08-08T00:00:00.000Z',
} as PendingAction;

const effectPending = {
  id: 'pa-effect-1',
  scenario_id: 'scn-1',
  chip_id: 'chip_configure_option_clarify',
  action: {
    kind: 'elicit_option_effect',
    option_id: 'opt-annual-contracts',
    option_label: 'introduce annual contracts with a discount to lock customers in',
    factor_id: 'f-acar',
    factor_label: 'Annual Contract Adoption Rate',
  },
  preconditions: { graph_hash: 'sha256:test' },
  expires_at_turn_count: 2,
  expires_at_iso: '2099-12-31T23:59:59.000Z',
  emitted_at_iso: '2026-08-08T00:00:00.000Z',
} as PendingAction;

const effectTargetPending = {
  id: 'pa-effect-target-1',
  scenario_id: 'scn-1',
  chip_id: 'chip_configure_option_clarify',
  action: {
    kind: 'elicit_effect_target',
    option_id: 'opt-annual-contracts',
    option_label: 'introduce annual contracts with a discount to lock customers in',
    value: 0.3,
  },
  preconditions: { graph_hash: 'sha256:test' },
  expires_at_turn_count: 2,
  expires_at_iso: '2099-12-31T23:59:59.000Z',
  emitted_at_iso: '2026-08-08T00:00:00.000Z',
} as unknown as PendingAction;

const COMPETING_SPELLINGS: ReadonlyArray<readonly [string, PendingAction]> = [
  ['elicit_option_effect', effectPending],
  ['elicit_effect_target', effectTargetPending],
];

function makeProposal(): ProposalAction {
  return {
    handler_id: 'add_constraint',
    entity: { id: TARGET_ID, kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters: [
      { name: 'constraint_type', value: 'at_most', source: 'user_explicit' },
      { name: 'value', value: 10, source: 'user_explicit' },
      { name: 'unit', value: '%', source: 'user_explicit' },
    ],
    cited_context_fields: [],
  };
}

async function runTurn(
  message: string,
  pendings: readonly PendingAction[],
  graphOpts?: { readonly ambiguousSibling?: boolean; readonly secondLimitRow?: boolean },
  proposalOverride?: ProposalAction,
  /**
   * ⚠ THE SIDE BAND IS SET BY THE EXECUTOR, NEVER BY THIS HANDLER.
   * `baselineAnswerAuthority` is written at `turn-executor.ts:10644` and is the
   * ONLY thing that arms the limit-preserving branch at `add-constraint.ts:377`.
   * A handler-level case that omits it silently exercises the UNPROTECTED path —
   * which is a different question wearing the same fixture, and would have made
   * the two-row cases below fail for a harness reason rather than a product one.
   */
  baselineAnswerAuthorityTargetId?: string,
) {
  const handler = createAddConstraintHandler();
  return handler({
    context: {
      session_id: 'scn-1',
      stage: 'frame',
      request_id: 'req-1',
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
      most_recent_pending_actions: pendings,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: 'scn-1',
      turn_id: 'turn-1',
      stage: 'frame',
      message,
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-1',
    signal: new AbortController().signal,
    orientationText: '',
    proposal: proposalOverride ?? makeProposal(),
    ...(baselineAnswerAuthorityTargetId !== undefined
      ? { baselineAnswerAuthority: { targetId: baselineAnswerAuthorityTargetId } }
      : {}),
    graphForTurn: graphWithConstraintTargets(graphOpts),
  });
}

function baselineOf(graph: GraphV3T, id: string): number | undefined {
  const n = graph.nodes.find((x) => x.id === id);
  expect(n, `node '${id}' missing from mutated graph`).toBeDefined();
  return n!.observed_state?.baseline;
}

/** Every node that is NOT the target must be untouched. */
function expectNoOtherBaselines(graph: GraphV3T): void {
  for (const n of graph.nodes) {
    if (n.id === TARGET_ID) continue;
    expect(n.observed_state?.baseline, `node '${n.id}' gained a baseline`).toBeUndefined();
  }
}

describe('DIRECTION 2 — a subject-bound answer records the baseline on the node it names', () => {
  /**
   * The product's own offered example, and the pre-existing external-corpus
   * sentence the reviewer showed was blocked. Both while a competing
   * bare-number ask is live, in both persisted spellings.
   */
  const SUBJECT_BOUND: ReadonlyArray<readonly [string, number]> = [
    [`${TARGET_LABEL} is 30%`, 0.3],
    ['Churn is about 12%.', 0.12],
    ['Churn rate is about 12%.', 0.12],
    ['Churn is 12% today.', 0.12],
  ];

  for (const [spelling, competitor] of COMPETING_SPELLINGS) {
    for (const [message, expected] of SUBJECT_BOUND) {
      it(`"${message}" records ${expected} on ${TARGET_ID} only, past a competing ${spelling}`, async () => {
        const outcome = await runTurn(message, [baselinePending, competitor]);
        const graph = outcome.mutated_graph as GraphV3T;
        expect(baselineOf(graph, TARGET_ID)).toBe(expected);
        expectNoOtherBaselines(graph);
      });
    }
  }
});

describe('DIRECTION 1 — an elliptical answer records nothing while a competitor is live', () => {
  /**
   * The harm the transition targets, proven at the WRITE rather than at the
   * verdict. With two claimants live the elliptical carry has no licence, so
   * the handler must mint no baseline anywhere — including on the target.
   */
  const ELLIPTICAL: readonly string[] = ['30', '30%', 'roughly 30', '30 percent', '0.6'];

  for (const [spelling, competitor] of COMPETING_SPELLINGS) {
    for (const message of ELLIPTICAL) {
      it(`"${message}" mints no baseline anywhere past a competing ${spelling}`, async () => {
        const outcome = await runTurn(message, [baselinePending, competitor]);
        const graph = outcome.mutated_graph as GraphV3T;
        expect(baselineOf(graph, TARGET_ID)).toBeUndefined();
        expectNoOtherBaselines(graph);
      });
    }
  }

  /**
   * ⭐⭐ "SUBJECT-BOUND" IS NOT "ANY SENTENCE WITH A NUMBER IN IT" — the exact
   * over-correction the reviewer warned against ("do not accept every bound
   * result"). Independent subject authority means the reply resolves its subject
   * UNAMBIGUOUSLY, which is the pre-existing competitor-unanimity rule, and this
   * transition must not have loosened it by a single case.
   *
   * A DISCRIMINATING PAIR on ONE graph: the same competing ask, the same live
   * baseline question, the same "Customer churn" sibling present, two sentences
   * that differ only in how specifically they name their subject. Neither half
   * shows anything alone — the refusal alone is consistent with the fix being
   * dead, and the bind alone is consistent with the unanimity rule being gone.
   */
  it('a subject that is AMBIGUOUS between two same-worded nodes still records nothing', async () => {
    const outcome = await runTurn('Churn is about 12%.', [baselinePending, effectPending], {
      ambiguousSibling: true,
    });
    const graph = outcome.mutated_graph as GraphV3T;
    // "Churn" binds BOTH 'Churn rate' and 'Customer churn' — refuse, as before.
    expect(graph.nodes.find((n) => n.label === 'Customer churn')).toBeDefined();
    expect(baselineOf(graph, TARGET_ID)).toBeUndefined();
    expectNoOtherBaselines(graph);
  });

  it('the SPECIFIC subject on that SAME graph does record, so the refusal above is the rule and not the fix', async () => {
    const outcome = await runTurn('Churn rate is about 12%.', [baselinePending, effectPending], {
      ambiguousSibling: true,
    });
    const graph = outcome.mutated_graph as GraphV3T;
    expect(graph.nodes.find((n) => n.label === 'Customer churn')).toBeDefined();
    expect(baselineOf(graph, TARGET_ID)).toBe(0.12);
    expectNoOtherBaselines(graph);
  });

  it('the SAME elliptical answer DOES bind when the baseline question is sole', async () => {
    // The discriminating counterpart: without this, every case above would pass
    // just as well if the elliptical carry had been deleted outright.
    const outcome = await runTurn('30', [baselinePending]);
    const graph = outcome.mutated_graph as GraphV3T;
    expect(baselineOf(graph, TARGET_ID)).toBe(0.3);
    expectNoOtherBaselines(graph);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⭐⭐ THE TWO-ROW TARGET — the case the round-4 triage named as the most likely
//    home of a blocking defect, and did not examine:
//
//      "`constraintRowThisAnswerPreserves` uses `.find()` — FIRST matching row.
//       A target carrying two constraint rows is unexamined by me, and this
//       PR's whole thesis is that one target carries more than one quantity."
//
//    Driven rather than reasoned about, because a reading of a `.find()` is not
//    evidence about what the upsert does with it.
// ─────────────────────────────────────────────────────────────────────────────
describe('a target carrying TWO limits keeps both when its baseline is answered', () => {
  /** The model mis-reads the answer as a NEW ceiling — the witnessed defect. */
  function proposalRewritingTheCeiling(): ProposalAction {
    return {
      handler_id: 'add_constraint',
      entity: {
        id: TARGET_ID,
        kind: 'node',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        { name: 'constraint_type', value: 'at_most', source: 'user_explicit' },
        { name: 'value', value: 30, source: 'user_explicit' },
        { name: 'unit', value: '%', source: 'user_explicit' },
      ],
      cited_context_fields: [],
    };
  }

  const rowsOn = (graph: GraphV3T, nodeId: string): Array<Record<string, unknown>> => {
    const rows = (graph as unknown as { goal_constraints?: unknown }).goal_constraints;
    return Array.isArray(rows)
      ? (rows as Array<Record<string, unknown>>).filter((r) => r.node_id === nodeId)
      : [];
  };

  /** By IDENTITY (`constraint_id`), never "the row whose value is 10" (trap 19). */
  const rowById = (graph: GraphV3T, id: string): Record<string, unknown> | undefined =>
    rowsOn(graph, TARGET_ID).find((r) => r.constraint_id === id);

  it('PRECONDITION — the fixture really does carry two rows on one node', async () => {
    // Asserted before anything rests on it: without this the case below could
    // pass on a one-row graph and prove nothing (trap 13).
    const outcome = await runTurn(
      'Churn rate is 30%',
      [baselinePending, effectPending],
      { secondLimitRow: true },
      undefined,
      TARGET_ID,
    );
    expect(rowsOn(outcome.mutated_graph as GraphV3T, TARGET_ID)).toHaveLength(2);
  });

  it('BOTH limits survive intact — the ceiling is not rewritten and the floor is not touched', async () => {
    const outcome = await runTurn(
      'Churn rate is 30%',
      [baselinePending, effectPending],
      { secondLimitRow: true },
      proposalRewritingTheCeiling(),
      TARGET_ID,
    );
    const graph = outcome.mutated_graph as GraphV3T;

    const ceiling = rowById(graph, 'gc-persisted-1');
    const floor = rowById(graph, 'gc-persisted-2');
    expect(ceiling, 'the ceiling row survives by id').toBeDefined();
    expect(floor, 'the floor row survives by id').toBeDefined();

    // The answer stated a LEVEL, so neither LIMIT may move.
    expect(ceiling!.operator).toBe('<=');
    expect(ceiling!.value).toBe(10);
    expect(ceiling!.value_frame, 'the attestation the mint depends on').toBe('level');
    expect(floor!.operator).toBe('>=');
    expect(floor!.value).toBe(2);

    // Exactly two — the proposal must not have APPENDED a third.
    expect(rowsOn(graph, TARGET_ID)).toHaveLength(2);
  });

  it('and the baseline the answer DID state still records', async () => {
    // The discriminating counterpart: without it, everything above would pass
    // just as well if the whole turn had been refused outright.
    const outcome = await runTurn(
      'Churn rate is 30%',
      [baselinePending, effectPending],
      { secondLimitRow: true },
      proposalRewritingTheCeiling(),
      TARGET_ID,
    );
    expect(baselineOf(outcome.mutated_graph as GraphV3T, TARGET_ID)).toBe(0.3);
  });

  /**
   * ⭐⭐ THE DISCRIMINATING TWIN. Same graph, same two rows, same proposal — the
   * authority side band REMOVED. The ceiling IS rewritten to 30, which is the
   * witnessed harm and today's behaviour without this branch.
   *
   * Neither half shows anything alone: the protection alone is consistent with
   * the handler simply never writing on this fixture, and the rewrite alone is
   * consistent with the branch being dead. The PAIR proves the preservation is
   * bound to the AUTHORITY and not to something incidental about the graph.
   */
  it('TWIN — without the authority the SAME proposal rewrites the ceiling, so the branch is doing the work', async () => {
    const outcome = await runTurn(
      'Churn rate is 30%',
      [baselinePending, effectPending],
      { secondLimitRow: true },
      proposalRewritingTheCeiling(),
      // no authority
    );
    const graph = outcome.mutated_graph as GraphV3T;
    expect(rowById(graph, 'gc-persisted-1')!.value, 'the unprotected ceiling moves').toBe(30);
    // The floor is untouched either way — the idempotency key is (node, operator).
    expect(rowById(graph, 'gc-persisted-2')!.value).toBe(2);
  });
});
