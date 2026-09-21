/**
 * ROADMAP 2.877 (link 1) — the CHAT path carries the DETERMINISTIC frame.
 *
 * ⚠ THE ROW'S STATED PREMISE WAS REFUTED AT THIS TIP, AND THIS FILE PINS THE
 * CORRECTED ONE. 2.877 records "non-goal targets carry no `value_frame` AT ALL
 * today". Measured on `ed8aad89` by running the real stage: the regex extractor
 * stamps a frame on OUTCOME, RISK and FACTOR targets alike — it is node-kind
 * AGNOSTIC (there is no `kind` read anywhere in `compound-goal/extractor.ts`;
 * `remapConstraintTargets` binds by id / label / alias). The dark axis is the
 * PRODUCER, not the TARGET KIND:
 *
 *   producer                          frame today
 *   ────────────────────────────────  ───────────────────────────────────────
 *   regex extractor (draft stage)     STAMPED, every target kind (#862)
 *   `add_constraint` (this handler)   ABSENT, every target kind  ← this file
 *   the draft LLM's own array         ABSENT (cannot be honestly stamped)
 *   client ingress                    ABSENT (z.array(z.unknown()))
 *
 * So a user who states a constraint IN CHAT gets `CONSTRAINT_FRAME_UNSPECIFIED`
 * from ISL whether the target is an outcome, a risk, a factor OR the goal.
 *
 * WHAT MAKES A STAMP HERE HONEST (and why #862 was right to refuse a blanket
 * one). The number in `params.value` was computed by the ROUTING MODEL, and
 * `routing/tool-schema.ts` instructs a NEGATIVE `at_most` encoding for
 * reduction framing — so both frames are reachable through one parameter and
 * the handler cannot tell which it holds FROM THE PARAMETER. Inferring from
 * `(operator, sign)` is not sound. What this file pins is a different source of
 * truth: CEE's OWN DETERMINISTIC PARSE OF THE USER'S OWN MESSAGE, gated on the
 * parsed number being THE SAME NUMBER now being persisted. That is the exact
 * carrier the sibling baseline gate already uses in this handler ("the extractor
 * guarantees its target and baseline came from ONE match … requiring the stated
 * target to equal the value actually being stamped carries that guarantee
 * across"). No evidence, or evidence that disagrees ⇒ NO STAMP, and ISL keeps
 * failing closed.
 *
 * The handler is therefore still NOT an attestation site: it RELAYS an
 * attestation minted by a registered stamper. No frame literal is written here
 * or in the handler, which is why the derived completeness guard in
 * `cee/compound-goal/__tests__/constraint-value-frame-unattested.test.ts`
 * stays green — that guard counts frame LITERALS, and a by-presence carry is
 * explicitly not one.
 *
 * Every message below was DERIVED FROM THE PRODUCER by execution before being
 * written here, never imagined (trap 16-inverse — a fixture you wrote yourself
 * is not evidence about the wire).
 *
 * Assertions bind to their constraint row by node-id + operator IDENTITY, never
 * by a value predicate another row could satisfy (trap 19).
 */

import { describe, expect, it } from 'vitest';

import type { HandlerInvocation } from '../../registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import { GoalConstraintSchema } from '../../../../schemas/assist.js';
import { createAddConstraintHandler } from '../add-constraint.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';

/**
 * The D1 fixture carries no OUTCOME and no RISK node, and those are exactly the
 * kinds 2.877 names as the reachable population. Both are on `add_constraint`'s
 * own `ALLOWED_TARGET_KINDS`.
 */
function graphWithNonGoalTargets(): GraphV3T {
  const g = buildD1Fixture();
  g.nodes.push(
    { id: 'o-churn-rate', kind: 'outcome', label: 'Churn rate' } as GraphV3T['nodes'][number],
    { id: 'r-marketing-cost', kind: 'risk', label: 'Marketing cost' } as GraphV3T['nodes'][number],
  );
  // Adversarial review of #868, B4: without an incoming edge o-churn-rate is a
  // ROOT, and the link-2 mint's non-root gate refuses BEFORE the extractor is
  // ever consulted — which made the no-statement pin below VACUOUS (it passed
  // even with the extractor hardwired to a fabricated 12). The edge makes the
  // target mint-eligible on every axis EXCEPT the stated evidence, so the pin
  // pins the evidence gate and nothing else.
  g.edges.push({
    from: 'f-quality',
    to: 'o-churn-rate',
    strength: { mean: -0.5, std: 0.1 },
    exists_probability: 0.9,
    effect_direction: 'negative',
  } as GraphV3T['edges'][number]);
  return g;
}

function buildInvocation(
  graph: GraphV3T,
  proposal: ProposalAction,
  message: string,
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
      message,
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-1',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
  };
}

/**
 * ⚠ TWO DIFFERENT `kind` VOCABULARIES, AND THEY OVERLAP ON EXACTLY ONE WORD.
 * `proposal.entity.kind` is the ROUTER's enum (`node|edge|option|goal|
 * constraint`); the handler's own target-kind logic reads `targetNode.kind`
 * from the GRAPH (`factor|outcome|goal|risk|…`). Only `'goal'` is a member of
 * both, which is why every prior test in this directory happens to typecheck
 * while using one enum's word for the other's slot. A non-goal target arrives
 * from the router as `'node'`.
 */
type RoutingEntityKind = ProposalAction['entity']['kind'];

function makeProposal(
  targetId: string,
  kind: RoutingEntityKind,
  constraintType: 'at_least' | 'at_most',
  value: number,
  unit?: string,
): ProposalAction {
  const params: ProposalAction['parameters'] = [
    { name: 'constraint_type', value: constraintType, source: 'user_explicit' },
    { name: 'value', value, source: 'user_explicit' },
  ];
  if (unit) params.push({ name: 'unit', value: unit, source: 'user_explicit' });
  return {
    handler_id: 'add_constraint',
    entity: { id: targetId, kind, resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters: params,
    cited_context_fields: [],
  };
}

async function registerViaChat(opts: {
  message: string;
  targetId: string;
  kind: RoutingEntityKind;
  constraintType: 'at_least' | 'at_most';
  value: number;
  unit?: string;
  graph?: GraphV3T;
}) {
  const handler = createAddConstraintHandler();
  const outcome = await handler(
    buildInvocation(
      opts.graph ?? graphWithNonGoalTargets(),
      makeProposal(opts.targetId, opts.kind, opts.constraintType, opts.value, opts.unit),
      opts.message,
    ),
  );
  return outcome.mutated_graph as GraphV3T;
}

/**
 * Bind by IDENTITY (node id + operator). Two constraints on one target differ
 * only by operator, and a value predicate would let the wrong one satisfy the
 * assertion (trap 19). Asserting EXACTLY ONE hit is part of the binding: a
 * duplicate row would otherwise let `[0]` silently pick either.
 */
function pick(graph: GraphV3T, nodeId: string, operator: '>=' | '<=') {
  const rows = (graph.goal_constraints ?? []).filter(
    (c) => c.node_id === nodeId && c.operator === operator,
  );
  expect(
    rows,
    `expected exactly one ${operator} constraint on '${nodeId}'; got ${JSON.stringify(graph.goal_constraints)}`,
  ).toHaveLength(1);
  return rows[0]!;
}

describe('2.877 link 1 — the chat path relays the deterministic frame (non-goal targets)', () => {
  it("OUTCOME target, upper bound: the row carries value_frame 'level'", async () => {
    // Producer-derived: `extractCompoundGoals` on this exact sentence yields
    // `<= 0.05 fraction / level` (measured, not assumed).
    const graph = await registerViaChat({
      message: 'Keep churn under 5% this year.',
      targetId: 'o-churn-rate',
      kind: 'node',
      constraintType: 'at_most',
      value: 5,
      unit: '%',
    });

    const row = pick(graph, 'o-churn-rate', '<=');
    // Pin the number the frame DESCRIBES in the same assertion, so the frame
    // claim is bound to its quantity rather than floating free.
    expect(row.value).toBe(5);
    expect(row.value_frame).toBe('level');
  });

  it("RISK target, reduction: the row carries value_frame 'delta' (not 'level')", async () => {
    // Producer-derived: this sentence yields `<= -0.15 fraction / delta`. The
    // delta half is the one that MUST NOT default to 'level' — ISL would then
    // convert a change-from-origin number against the target's baseline and
    // return a confident WRONG probability.
    const graph = await registerViaChat({
      message: 'Reduce marketing cost by 15% next year.',
      targetId: 'r-marketing-cost',
      kind: 'node',
      constraintType: 'at_most',
      value: -15,
      unit: '%',
    });

    const row = pick(graph, 'r-marketing-cost', '<=');
    expect(row.value).toBe(-15);
    expect(row.value_frame).toBe('delta');
  });

  it('GOAL target too — the frame question is NOT the goal-target-set question (trap 21)', async () => {
    // The two predicates in this handler answer DIFFERENT questions:
    //   "is this turn setting the SUCCESS TARGET?"  -> goal node + '>='
    //   "does CEE hold deterministic evidence of    -> any target kind
    //    this NUMBER's frame?"
    // Gating the second on the first is what left the chat path dark. This test
    // is what fails if they are ever re-fused.
    const graph = await registerViaChat({
      message: 'Revenue must be at least 90%.',
      targetId: 'g-revenue',
      kind: 'goal',
      constraintType: 'at_least',
      value: 90,
      unit: '%',
    });

    const row = pick(graph, 'g-revenue', '>=');
    expect(row.value).toBe(90);
    expect(row.value_frame).toBe('level');
  });

  it('the relayed frame survives the row VALIDATOR (the silent-strip hazard)', async () => {
    // `GoalConstraintSchema` is a plain `z.object` commented "strip unknown
    // fields": an undeclared stamp is deleted one hop before the PLoT payload,
    // with no error anywhere. This is how `goal_threshold_frame` nearly shipped
    // dark on the node channel.
    const graph = await registerViaChat({
      message: 'Keep churn under 5% this year.',
      targetId: 'o-churn-rate',
      kind: 'node',
      constraintType: 'at_most',
      value: 5,
      unit: '%',
    });

    const reparsed = GoalConstraintSchema.parse(pick(graph, 'o-churn-rate', '<='));
    expect(reparsed.value_frame).toBe('level');
  });
});

describe('2.877 link 1 — NO deterministic evidence means NO stamp (fail closed)', () => {
  it('a message with no constraint phrase leaves the row UNFRAMED', async () => {
    // Producer-derived: `extractCompoundGoals('Set that to 5.')` yields [].
    const graph = await registerViaChat({
      message: 'Set that to 5.',
      targetId: 'o-churn-rate',
      kind: 'node',
      constraintType: 'at_most',
      value: 5,
      unit: '%',
    });

    const row = pick(graph, 'o-churn-rate', '<=');
    // PRECONDITION PAIR (trap 13b): the absence below is vacuous unless the same
    // handler, same target, same value demonstrably DOES frame a row when the
    // message carries the evidence. Without this a handler that stopped framing
    // altogether would satisfy the assertion while proving the opposite.
    const framed = await registerViaChat({
      message: 'Keep churn under 5% this year.',
      targetId: 'o-churn-rate',
      kind: 'node',
      constraintType: 'at_most',
      value: 5,
      unit: '%',
    });
    expect(
      pick(framed, 'o-churn-rate', '<=').value_frame,
      'the handler is not framing at all — the absence assertion below is vacuous',
    ).toBe('level');

    expect(
      row.value_frame,
      'a frame was manufactured from a message that states no constraint — ' +
        'a defaulted frame is a manufactured attestation',
    ).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(row, 'value_frame')).toBe(false);
  });

  it("a message whose stated number is NOT the persisted number leaves the row UNFRAMED", async () => {
    // The message says 5%; the routing model resolved 9. The parse is about a
    // DIFFERENT quantity, so it attests nothing about this one. This is the
    // gate that stops the frame of one metric being welded onto another's
    // number — the breadth failure that would make the stamp worse than the gap.
    const graph = await registerViaChat({
      message: 'Keep churn under 5% this year.',
      targetId: 'o-churn-rate',
      kind: 'node',
      constraintType: 'at_most',
      value: 9,
      unit: '%',
    });

    const row = pick(graph, 'o-churn-rate', '<=');
    expect(row.value).toBe(9);
    expect(
      row.value_frame,
      "the parsed 5% frame was welded onto the model's 9 — the stated number " +
        'must equal the persisted number for the evidence to carry',
    ).toBeUndefined();
  });

  it('a TEMPORAL pseudo-constraint is not frame evidence for a real one', async () => {
    // Producer-derived: 'Deliver within 18 months.' yields `<= 18 months /
    // level` WITH `deadline_metadata`. ROADMAP 2.349 established that a
    // deadline is not a hard constraint — the merge stage drops these
    // source-agnostically — so it must not become the frame evidence for a
    // genuinely-constrained node on a bare numeric coincidence (18 months and
    // 18 headcount are not the same claim). `f-uncapped` is a FACTOR, which is
    // deliberately outside the probability-domain emit guard, so a unit-less 18
    // is a legitimate absolute threshold there.
    const graph = await registerViaChat({
      message: 'Deliver within 18 months.',
      targetId: 'f-uncapped',
      kind: 'node',
      constraintType: 'at_most',
      value: 18,
    });

    const row = pick(graph, 'f-uncapped', '<=');
    expect(row.value).toBe(18);
    expect(
      row.value_frame,
      "a deadline's frame was borrowed for a headcount threshold — the numbers " +
        'coincided, the claims did not',
    ).toBeUndefined();
  });

  it('AMBIGUOUS ZERO BOUNDARY — a message that parses to BOTH frames on the same number leaves the row UNFRAMED', async () => {
    // ⚠ THIS TEST KILLS MUTANT A-M5 (relax the frame-unanimity check to "take
    // the first candidate"), and it exists because an earlier revision of this
    // PR wrongly claimed A-M5 had no killing fixture — that the two frames sat
    // on disjoint sign ranges so no single number could carry both (trap 13c:
    // an equivalence asserted, not demonstrated). Refuted by execution in
    // review, then derived from the producer here (trap 16-inverse).
    //
    // The collision is at ZERO. On this exact message the real extractor mints
    // three LEVEL candidates (value 0, from the two upper bounds' target-name
    // guesses) AND one DELTA candidate (the reduction branch flips +0 to -0),
    // all `<=`, none temporal — and `valuesMatch(-0, 0)` is true, so for a
    // persisted value of 0 all four reach the unanimity Set. Intact,
    // `frames.size === 2` and the frame is withheld. Under A-M5 the row would
    // inherit the FIRST candidate's frame ('level') — a silently picked
    // attestation ISL then trusts.
    const graph = await registerViaChat({
      message: 'Reduce marketing cost by 0% and keep churn under 0%.',
      targetId: 'o-churn-rate',
      kind: 'node',
      constraintType: 'at_most',
      value: 0,
      unit: '%',
    });

    const row = pick(graph, 'o-churn-rate', '<=');
    expect(row.value).toBe(0);
    expect(
      row.value_frame,
      'the extractor derived BOTH level and delta for this number, so CEE cannot ' +
        'say which the user meant — picking one is a manufactured attestation',
    ).toBeUndefined();
  });

  it('a message whose stated OPERATOR differs from the persisted one leaves the row UNFRAMED', async () => {
    // 'at least 90%' parses as `>=`; this turn persists `<=`. Same number,
    // opposite comparator — a different constraint, so the evidence does not
    // transfer.
    const graph = await registerViaChat({
      message: 'Revenue must be at least 90%.',
      targetId: 'o-churn-rate',
      kind: 'node',
      constraintType: 'at_most',
      value: 90,
      unit: '%',
    });

    const row = pick(graph, 'o-churn-rate', '<=');
    expect(row.value).toBe(90);
    expect(row.value_frame).toBeUndefined();
  });
});

describe('2.877 link 1 — an UPDATE must not silently clear a still-true attestation', () => {
  /**
   * Register once through chat (framed), then run a SECOND turn against the
   * persisted row — the update path, which replaces the row WHOLESALE.
   */
  async function updateAfterFraming(second: {
    message: string;
    value: number;
    unit?: string;
    label?: string;
  }) {
    const first = await registerViaChat({
      message: 'Keep churn under 5% this year.',
      targetId: 'o-churn-rate',
      kind: 'node',
      constraintType: 'at_most',
      value: 5,
      unit: '%',
    });
    // PRECONDITION: the row really is framed going in, or every assertion about
    // what the second turn does to that frame is vacuous.
    expect(
      pick(first, 'o-churn-rate', '<=').value_frame,
      'the first turn did not frame the row — the update assertions are vacuous',
    ).toBe('level');

    const proposal = makeProposal(
      'o-churn-rate',
      'node',
      'at_most',
      second.value,
      second.unit,
    );
    if (second.label !== undefined) {
      proposal.parameters.push({
        name: 'label',
        value: second.label,
        source: 'user_explicit',
      } as ProposalAction['parameters'][number]);
    }
    const handler = createAddConstraintHandler();
    const out = await handler(buildInvocation(first, proposal, second.message));
    return out.mutated_graph as GraphV3T;
  }

  it('a LABEL-ONLY turn keeps the frame (omission means unchanged)', async () => {
    // This is the regression THIS PR would otherwise have introduced: once a row
    // can carry a frame, the wholesale row replacement on update silently clears
    // it on any turn whose message states no constraint clause — and ISL quietly
    // resumes refusing. Same silent-nullification class as the persisted-unit
    // drop this handler already guards (the live gc-cdd6eb74 defect).
    const graph = await updateAfterFraming({
      message: 'Call that one the churn ceiling.',
      value: 5,
      unit: '%',
      label: 'Churn ceiling',
    });

    const row = pick(graph, 'o-churn-rate', '<=');
    expect(row.label).toBe('Churn ceiling');
    expect(row.value).toBe(5);
    expect(
      row.value_frame,
      'a label-only turn cleared an attestation that is still true of the same number',
    ).toBe('level');
  });

  it('a turn that CHANGES the value does NOT inherit the old frame (fails closed)', async () => {
    // The frame describes a NUMBER. Once the number moves, the old attestation
    // is about a different quantity, and carrying it across would be exactly the
    // manufactured attestation the contract forbids — worse than the honest gap,
    // because ISL trusts what it is told.
    const graph = await updateAfterFraming({
      message: 'Actually make it 3 instead.',
      value: 3,
      unit: '%',
    });

    const row = pick(graph, 'o-churn-rate', '<=');
    expect(row.value).toBe(3);
    expect(
      row.value_frame,
      "the previous number's frame was carried onto a different number",
    ).toBeUndefined();
  });

  it('a turn that CHANGES the unit does NOT inherit the old frame (fails closed)', async () => {
    // Same number, different scale: `5 %` and `5 £` are not the same quantity,
    // and nothing here reconciles units.
    const graph = await updateAfterFraming({
      message: 'Keep it at 5 there.',
      value: 5,
      unit: '£',
    });

    const row = pick(graph, 'o-churn-rate', '<=');
    expect(row.unit).toBe('£');
    expect(row.value_frame).toBeUndefined();
  });

  it("this turn's OWN evidence outranks the inherited frame", async () => {
    // A restatement that parses is a fresh attestation of the same number, so it
    // must be sourced from THIS turn rather than silently reused — otherwise a
    // stale inherited frame could outlive a producer change.
    const graph = await updateAfterFraming({
      message: 'Reduce churn by 5%.',
      value: -5,
      unit: '%',
    });

    const row = pick(graph, 'o-churn-rate', '<=');
    expect(row.value).toBe(-5);
    expect(row.value_frame).toBe('delta');
  });
});

describe('2.877 — the PINNED no-statement arm: no stated level, no baseline, ever', () => {
  it('a level-framed constraint whose message states NO current level reaches the wire baseline-less', async () => {
    // SPLIT, NOT RETIRED (link 2, this PR). When link 1 landed, this pin read
    // "framed AND baseline-less" as the whole post-state, dated until the link
    // 2 mint. Link 2 has now landed — a message that ALSO states the target's
    // current level ("churn is 12% today, keep it under 10%") mints
    // `observed_state.baseline` from that statement, with its own
    // identity-bound battery in add-constraint-stated-baseline-mint.test.ts.
    //
    // THIS ARM KEEPS PROTECTING THE NO-STATEMENT CASE, PERMANENTLY. The
    // message below states a bound and nothing else, so a baseline appearing
    // here can only be a DEFAULT — the fabrication class the 2.877 chain
    // exists to remove (an invented baseline converts a level threshold
    // against a fiction; CEE's prompt once emitted exactly that as
    // 0.5/`inferred` placeholders). The honest post-state for this message is
    // an ISL refusal at `CONSTRAINT_NOT_CONVERTIBLE / missing_target_baseline`
    // and, in time, elicitation (row 2.918) — never a manufactured number.
    const graph = await registerViaChat({
      message: 'Keep churn under 5% this year.',
      targetId: 'o-churn-rate',
      kind: 'node',
      constraintType: 'at_most',
      value: 5,
      unit: '%',
    });

    const row = pick(graph, 'o-churn-rate', '<=');
    expect(row.value_frame).toBe('level');

    const target = graph.nodes.find((n) => n.id === 'o-churn-rate')!;
    expect(
      target.observed_state?.baseline,
      'a baseline appeared on a target whose message stated NO current level — ' +
        'that is a DEFAULTED baseline, the exact fabrication 2.877 exists to ' +
        'remove. Revert the change that manufactured it.',
    ).toBeUndefined();
  });
});
