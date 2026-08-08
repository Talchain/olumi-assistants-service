/**
 * ROADMAP 2.918 — BASELINE ELICITATION on the exact mintable-and-baseline-less
 * cell, and the ELLIPTICAL ANSWER binding on the next turn.
 *
 * THE CELL: `mintEligible && statedBaselinePercent === undefined` — the SAME
 * `mintEligible` conjunction the #868 mint derives (one predicate, shared in
 * the same function scope; there is no twin to drift). When a level-framed
 * constraint lands on a target the mint COULD serve but no stated level
 * exists, the turn's receipt asks ONE concrete, answerable question and the
 * handler declares `__elicit_baseline` so the executor persists a pending
 * question. The constraint commit is NEVER blocked: the row persists with its
 * honest frame, and if the user ignores the question, behaviour is exactly
 * the pre-2.918 honest ISL refusal.
 *
 * THE ANSWER PATH: the NEXT turn's message flows through the SAME #868
 * extractor. A full-sentence answer binds by subject as before; an elliptical
 * answer ("about 12%") has no subject, so it may bind ONLY through the
 * question-context carry: exactly ONE live `elicit_target_baseline` pending,
 * whose target IS this handler's target. No pending question ⇒ no elliptical
 * binding (fail closed) — pendings are server-minted, so no LLM proposal can
 * fabricate the carry.
 *
 * Assertions bind by IDENTITY (node id, the label inside the question copy,
 * the stated number), never by a predicate another object could satisfy.
 */

import { describe, expect, it } from 'vitest';

import type { HandlerInvocation } from '../../registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import type { PendingAction } from '../../../session/pending-action.js';
import { createAddConstraintHandler } from '../add-constraint.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';

const QUESTION_FOR_CHURN = 'Roughly what percentage is Churn rate at right now?';

/** Same population as the stated-baseline-mint suite (2.877 link 2). */
function graphWithConstraintTargets(): GraphV3T {
  const g = buildD1Fixture();
  g.nodes.push(
    { id: 'o-churn-rate', kind: 'outcome', label: 'Churn rate' } as GraphV3T['nodes'][number],
    { id: 'r-breach', kind: 'risk', label: 'Breach likelihood' } as GraphV3T['nodes'][number],
    { id: 'o-orphan', kind: 'outcome', label: 'Orphan rate' } as GraphV3T['nodes'][number],
    { id: 'f-support-load', kind: 'factor', label: 'Support load' } as GraphV3T['nodes'][number],
  );
  g.edges.push(
    {
      from: 'f-quality',
      to: 'o-churn-rate',
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
    {
      from: 'f-budget',
      to: 'f-support-load',
      strength: { mean: 0.2, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    } as GraphV3T['edges'][number],
    // o-orphan gets NO incoming edge: it is the ROOT control.
  );
  return g;
}

function elicitPending(overrides?: {
  target_id?: string;
  target_label?: string;
  expires_at_iso?: string;
  expires_at_turn_count?: number;
  id?: string;
}): PendingAction {
  return {
    id: overrides?.id ?? 'pa-elicit-1',
    scenario_id: 'scn-1',
    chip_id: 'chip_elicit_target_baseline',
    action: {
      kind: 'elicit_target_baseline',
      target_id: overrides?.target_id ?? 'o-churn-rate',
      target_label: overrides?.target_label ?? 'Churn rate',
      constraint_type: 'at_most',
      value: 10,
      unit: '%',
      label: overrides?.target_label ?? 'Churn rate',
    },
    preconditions: { graph_hash: 'sha256:test' },
    expires_at_turn_count: overrides?.expires_at_turn_count ?? 2,
    expires_at_iso: overrides?.expires_at_iso ?? '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-08-08T00:00:00.000Z',
  } as PendingAction;
}

function buildInvocation(
  graph: GraphV3T,
  proposal: ProposalAction,
  message: string,
  pendings?: readonly PendingAction[],
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
      ...(pendings !== undefined ? { most_recent_pending_actions: pendings } : {}),
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

function makeProposal(
  targetId: string,
  kind: ProposalAction['entity']['kind'],
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

async function runTurn(opts: {
  message: string;
  targetId: string;
  kind?: ProposalAction['entity']['kind'];
  constraintType?: 'at_least' | 'at_most';
  value: number;
  unit?: string;
  graph?: GraphV3T;
  pendings?: readonly PendingAction[];
}) {
  const handler = createAddConstraintHandler();
  return handler(
    buildInvocation(
      opts.graph ?? graphWithConstraintTargets(),
      makeProposal(
        opts.targetId,
        opts.kind ?? 'node',
        opts.constraintType ?? 'at_most',
        opts.value,
        opts.unit,
      ),
      opts.message,
      opts.pendings,
    ),
  );
}

function node(graph: GraphV3T, id: string) {
  const n = graph.nodes.find((x) => x.id === id);
  expect(n, `node '${id}' missing from mutated graph`).toBeDefined();
  return n!;
}

describe('2.918 — the elicitation fires on the exact mintable-and-baseline-less cell', () => {
  it('level-framed bound, no stated level: the receipt asks the ONE question and declares the channel', async () => {
    const outcome = await runTurn({
      message: 'Keep churn rate under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
    });
    const graph = outcome.mutated_graph as GraphV3T;

    // The constraint commit is NEVER blocked: the row persists, honestly framed.
    const row = (graph.goal_constraints ?? []).find(
      (c) => c.node_id === 'o-churn-rate' && c.operator === '<=',
    );
    expect(row?.value).toBe(10);
    expect(row?.value_frame).toBe('level');

    // NO baseline was manufactured.
    expect(node(graph, 'o-churn-rate').observed_state).toBeUndefined();

    // The ask, bound to the target BY LABEL inside the question copy.
    expect(outcome.assistant_text).toContain(QUESTION_FOR_CHURN);

    // The channel the executor persists as the pending question.
    expect(outcome.__elicit_baseline).toEqual({
      target_id: 'o-churn-rate',
      target_label: 'Churn rate',
      constraint_type: 'at_most',
      value: 10,
      unit: '%',
      label: 'Churn rate',
    });
  });

  it('R2-ambiguity refusal lands in the SAME cell: the exemplar with a competing factor label asks', async () => {
    // 'Churn is 12%' is ambiguous in this graph (factor 'Customer churn') so
    // the mint refuses — and the question is precisely how the user resolves
    // the ambiguity, because the question NAMES the target.
    const outcome = await runTurn({
      message: 'Churn is 12% today, keep it under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
    });
    expect(node(outcome.mutated_graph as GraphV3T, 'o-churn-rate').observed_state).toBeUndefined();
    expect(outcome.assistant_text).toContain(QUESTION_FOR_CHURN);
    expect(outcome.__elicit_baseline?.target_id).toBe('o-churn-rate');
  });

  it('RISK target asks too, with ITS label in the question (identity pair for the copy)', async () => {
    const outcome = await runTurn({
      message: 'Keep breach likelihood under 5%.',
      targetId: 'r-breach',
      value: 5,
      unit: '%',
    });
    expect(outcome.assistant_text).toContain(
      'Roughly what percentage is Breach likelihood at right now?',
    );
    expect(outcome.__elicit_baseline?.target_id).toBe('r-breach');
    expect(outcome.__elicit_baseline?.target_label).toBe('Breach likelihood');
  });
});

describe('2.918 — NO elicitation outside the cell (each case flips exactly one gate)', () => {
  function expectNoAsk(outcome: { assistant_text: string; __elicit_baseline?: unknown }) {
    expect(outcome.assistant_text).not.toContain('Roughly what percentage');
    expect(outcome.__elicit_baseline).toBeUndefined();
  }

  it('the mint fired instead: a stated level leaves nothing to ask', async () => {
    const outcome = await runTurn({
      message: 'Churn rate is 12% today, keep churn rate under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
    });
    expect(
      node(outcome.mutated_graph as GraphV3T, 'o-churn-rate').observed_state?.baseline,
    ).toBe(0.12);
    expectNoAsk(outcome);
  });

  it('unframed row: no level-frame evidence, no ask (and no mint)', async () => {
    const outcome = await runTurn({
      message: 'Churn rate is 12% today. Set that to 10.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
    });
    expectNoAsk(outcome);
  });

  it('goal-capped target: the cap outranks the percent rung, no ask', async () => {
    const graph = graphWithConstraintTargets();
    (node(graph, 'o-churn-rate') as { goal_threshold_cap?: number }).goal_threshold_cap = 100;
    const outcome = await runTurn({
      message: 'Keep churn rate under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
      graph,
    });
    expectNoAsk(outcome);
  });

  it('ROOT target: a root baseline buys nothing, no ask', async () => {
    const outcome = await runTurn({
      message: 'Keep orphan rate under 10%.',
      targetId: 'o-orphan',
      value: 10,
      unit: '%',
    });
    expectNoAsk(outcome);
  });

  it('already-baselined target: nothing to elicit, no ask', async () => {
    const graph = graphWithConstraintTargets();
    node(graph, 'o-churn-rate').observed_state = {
      value: 0.3,
      baseline: 0.3,
      unit: 'fraction',
      cap: 1,
      source: 'user_override',
    } as GraphV3T['nodes'][number]['observed_state'];
    const outcome = await runTurn({
      message: 'Keep churn rate under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
      graph,
    });
    expectNoAsk(outcome);
  });

  it('FACTOR target: a baseline is inert there, no ask', async () => {
    const outcome = await runTurn({
      message: 'Keep support load under 10%.',
      targetId: 'f-support-load',
      value: 10,
      unit: '%',
    });
    expectNoAsk(outcome);
  });

  it('GOAL target: the goal channel has its own mint, no ask', async () => {
    const outcome = await runTurn({
      message: 'Revenue must be at least 90%.',
      targetId: 'g-revenue',
      kind: 'goal',
      constraintType: 'at_least',
      value: 90,
      unit: '%',
    });
    expectNoAsk(outcome);
  });

  it("row unit is not '%': the divisor would be a guess, no ask", async () => {
    const outcome = await runTurn({
      message: 'Keep churn rate under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '£',
    });
    expectNoAsk(outcome);
  });

  it('row value ≤ 1: PLoT can forward the raw percent, no ask', async () => {
    const outcome = await runTurn({
      message: 'Keep churn rate under 0.9%.',
      targetId: 'o-churn-rate',
      value: 0.9,
      unit: '%',
    });
    expectNoAsk(outcome);
  });

  it('row value > 100: the [0,100] rung would clamp, no ask', async () => {
    const outcome = await runTurn({
      message: 'Keep churn rate under 120%.',
      targetId: 'o-churn-rate',
      value: 120,
      unit: '%',
    });
    expectNoAsk(outcome);
  });
});

describe('2.918 — the elliptical answer binds ONLY through the pending question (fail closed)', () => {
  /**
   * The answer turn's REAL state-class (trap 16-inverse: a fixture must stay
   * inside what the producer can feed): the pending question is persisted in
   * the SAME commit as the level-framed row, so every answer turn replays
   * against a graph that already carries that row. The replay's own message
   * ("about 12%") attests no frame, so the mint's frame conjunct rides the
   * row-inheritance path (value and unit unchanged ⇒ the persisted 'level'
   * carries) — a fresh graph here would be a state no resume can produce.
   */
  function graphWithPersistedRow(): GraphV3T {
    const g = graphWithConstraintTargets();
    (g as { goal_constraints?: unknown[] }).goal_constraints = [
      {
        constraint_id: 'gc-persisted-1',
        node_id: 'o-churn-rate',
        operator: '<=',
        value: 10,
        label: 'Churn rate',
        provenance: 'explicit',
        unit: '%',
        value_frame: 'level',
      },
    ];
    return g;
  }

  it('live pending for THIS target + "about 12%" → the #868 mint fires on the named target', async () => {
    const outcome = await runTurn({
      message: 'about 12%',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
      graph: graphWithPersistedRow(),
      pendings: [elicitPending()],
    });
    const graph = outcome.mutated_graph as GraphV3T;
    const target = node(graph, 'o-churn-rate');
    expect(target.observed_state?.baseline).toBe(0.12);
    expect(target.observed_state?.value).toBe(0.12);
    expect(target.observed_state?.unit).toBe('fraction');
    expect(target.observed_state?.cap).toBe(1);
    expect(target.observed_state?.source).toBe('brief_extraction');
    // Identity: NOTHING else gained a baseline.
    for (const n of graph.nodes) {
      if (n.id === 'o-churn-rate') continue;
      expect(n.observed_state?.baseline).toBeUndefined();
    }
    // The receipt confirms the level; the question is NOT re-asked.
    expect(outcome.assistant_text).toContain('Noted Churn rate is currently at 12%.');
    expect(outcome.assistant_text).not.toContain('Roughly what percentage');
    expect(outcome.__elicit_baseline).toBeUndefined();
    expect(outcome.handler_facts[0]?.noop).toBe(false);
  });

  it('THE PAIR (no pending question ⇒ no elliptical binding): the same message mints NOTHING', async () => {
    const outcome = await runTurn({
      message: 'about 12%',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
      graph: graphWithPersistedRow(),
    });
    const graph = outcome.mutated_graph as GraphV3T;
    expect(node(graph, 'o-churn-rate').observed_state).toBeUndefined();
    // Still in the cell, so the turn asks (again) instead of inventing.
    expect(outcome.assistant_text).toContain(QUESTION_FOR_CHURN);
  });

  it('a pending for a DIFFERENT target does not license the bind (identity, not presence)', async () => {
    const outcome = await runTurn({
      message: 'about 12%',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
      graph: graphWithPersistedRow(),
      pendings: [elicitPending({ target_id: 'r-breach', target_label: 'Breach likelihood' })],
    });
    const graph = outcome.mutated_graph as GraphV3T;
    expect(node(graph, 'o-churn-rate').observed_state).toBeUndefined();
    expect(node(graph, 'r-breach').observed_state).toBeUndefined();
  });

  it('TWO live pending questions are ambiguous — the bare number binds neither', async () => {
    const outcome = await runTurn({
      message: 'about 12%',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
      graph: graphWithPersistedRow(),
      pendings: [
        elicitPending(),
        elicitPending({ id: 'pa-elicit-2', target_id: 'r-breach', target_label: 'Breach likelihood' }),
      ],
    });
    expect(node(outcome.mutated_graph as GraphV3T, 'o-churn-rate').observed_state).toBeUndefined();
  });

  it('an EXPIRED pending question licenses nothing (wall clock)', async () => {
    const outcome = await runTurn({
      message: 'about 12%',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
      graph: graphWithPersistedRow(),
      pendings: [elicitPending({ expires_at_iso: '2020-01-01T00:00:00.000Z' })],
    });
    expect(node(outcome.mutated_graph as GraphV3T, 'o-churn-rate').observed_state).toBeUndefined();
  });

  it('an EXPIRED pending question licenses nothing (turn count)', async () => {
    const outcome = await runTurn({
      message: 'about 12%',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
      graph: graphWithPersistedRow(),
      pendings: [elicitPending({ expires_at_turn_count: 0 })],
    });
    expect(node(outcome.mutated_graph as GraphV3T, 'o-churn-rate').observed_state).toBeUndefined();
  });

  it('a FULL-SENTENCE answer binds by subject exactly as before, pending or no pending', async () => {
    const outcome = await runTurn({
      message: 'Churn rate is about 12%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
      graph: graphWithPersistedRow(),
      pendings: [elicitPending()],
    });
    expect(
      node(outcome.mutated_graph as GraphV3T, 'o-churn-rate').observed_state?.baseline,
    ).toBe(0.12);
  });

  it('a pending question never rescues an AMBIGUOUS full sentence', async () => {
    // 'The rate is 12%' binds 'Churn rate' AND 'Orphan rate'; the elliptical
    // limb refuses (not a bare answer), and the full limb refuses (unanimity).
    const outcome = await runTurn({
      message: 'The rate is 12% today.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
      graph: graphWithPersistedRow(),
      pendings: [elicitPending()],
    });
    expect(node(outcome.mutated_graph as GraphV3T, 'o-churn-rate').observed_state).toBeUndefined();
    expect(outcome.assistant_text).toContain(QUESTION_FOR_CHURN);
  });

  it('the two-turn journey: ask on turn 1, elliptical answer mints on turn 2 against the persisted row', async () => {
    const first = await runTurn({
      message: 'Keep churn rate under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
    });
    expect(first.assistant_text).toContain(QUESTION_FOR_CHURN);
    const g1 = first.mutated_graph as GraphV3T;
    expect(node(g1, 'o-churn-rate').observed_state).toBeUndefined();

    // Turn 2: the replay the resume dispatches — same params, the answer text,
    // the pending the executor persisted from turn 1's channel.
    const second = await runTurn({
      message: "it's about 12%",
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
      graph: g1,
      pendings: [elicitPending()],
    });
    const g2 = second.mutated_graph as GraphV3T;
    expect(node(g2, 'o-churn-rate').observed_state?.baseline).toBe(0.12);
    // The restatement is otherwise a noop; the mint keeps the channels honest.
    expect(second.handler_facts[0]?.noop).toBe(false);
    expect(second.assistant_text).toContain('Noted Churn rate is currently at 12%.');
  });
});
