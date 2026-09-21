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

/**
 * R2918B — the answer turn's real state-class, identical to the 2.918 suite
 * below: the pending question is persisted in the SAME commit as the
 * level-framed row, so every answer turn replays against a graph that already
 * carries it. A fresh graph here would be a state no resume can produce
 * (trap 16-inverse — a fixture must stay inside what the producer can feed).
 */
function graphWithPersistedChurnRow(): GraphV3T {
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

describe('R2918B — the bare-number answer the ask itself invites', () => {
  // The ask is "Roughly what percentage is Churn rate at right now?". These are
  // its own words coming back, and until R2918B every one of them refused.
  const answers: ReadonlyArray<readonly [string, number]> = [
    ['30', 0.3],
    ['roughly 30', 0.3],
    ['about 30', 0.3],
    ['30 percent', 0.3],
    ['30%', 0.3],
  ];

  it.each(answers)('"%s" mints the baseline (%d)', async (message, expected) => {
    const outcome = await runTurn({
      message,
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
      graph: graphWithPersistedChurnRow(),
      pendings: [elicitPending()],
    });
    expect(
      node(outcome.mutated_graph as GraphV3T, 'o-churn-rate').observed_state?.baseline,
    ).toBe(expected);
    // The question is answered, so it must not be asked again.
    expect(outcome.__elicit_baseline).toBeUndefined();
  });
});

describe('R2918B — the sole-pending gate binds THIS referent (discriminating pair, trap 19)', () => {
  // WHY THIS PAIR EXISTS. The suite below calls its no-pending case a POSITIVE
  // CONTROL, and it is one for "does a pending exist at all" — but it cannot
  // observe a referent MIS-binding, because the extractor's elliptical limb
  // deliberately does not bind by label (the question supplies the subject).
  // Proven by fixture rot at the extractor:
  // `deriveElicitedBaselineAnswerPercent('about 12%', 'Zzz Unrelated Metric')`
  // returns 12, exactly as it does for the genuine label. So the ONLY thing
  // standing between a bare "30" and the wrong node is the handler's
  // `soleElicitPending.action.target_id === targetId` gate, and nothing pinned
  // it. Neither half of this pair shows anything alone: the GREEN proves the
  // carry works, the RED proves it is the target id doing the work.

  it('GENUINE referent: the pending names THIS target, so the bare answer mints here', async () => {
    const outcome = await runTurn({
      message: '30',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
      graph: graphWithPersistedChurnRow(),
      pendings: [elicitPending({ target_id: 'o-churn-rate', target_label: 'Churn rate' })],
    });
    expect(
      node(outcome.mutated_graph as GraphV3T, 'o-churn-rate').observed_state?.baseline,
    ).toBe(0.3);
  });

  it('ROT-MUTANT referent: the pending names a DIFFERENT live node, so the same message mints NOTHING', async () => {
    const outcome = await runTurn({
      message: '30',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
      graph: graphWithPersistedChurnRow(),
      // A real, live, well-formed pending question — about 'Breach likelihood'.
      pendings: [elicitPending({ target_id: 'r-breach', target_label: 'Breach likelihood' })],
    });
    // No baseline anywhere: not on this turn's target...
    expect(node(outcome.mutated_graph as GraphV3T, 'o-churn-rate').observed_state).toBeUndefined();
    // ...and emphatically not on the node the stray pending happened to name.
    expect(node(outcome.mutated_graph as GraphV3T, 'r-breach').observed_state).toBeUndefined();
    // The unanswered question for THIS target is asked, which is the honest
    // outcome: the product still does not know where churn stands.
    expect(outcome.assistant_text).toContain(QUESTION_FOR_CHURN);
    expect(outcome.__elicit_baseline?.target_id).toBe('o-churn-rate');
  });

  it('ROT-MUTANT kind: a COMPETING live number-ask makes the bare answer ambiguous, so it mints nothing', async () => {
    const outcome = await runTurn({
      message: '30',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
      graph: graphWithPersistedChurnRow(),
      pendings: [
        elicitPending(),
        {
          id: 'pa-effect-1',
          scenario_id: 'scn-1',
          chip_id: 'chip_elicit_option_effect',
          action: {
            kind: 'elicit_option_effect',
            option_id: 'opt-1',
            option_label: 'Two Developers',
            factor_id: 'f-support-load',
            factor_label: 'Support load',
          },
          preconditions: {},
          expires_at_turn_count: 2,
          expires_at_iso: '2099-12-31T23:59:59.000Z',
          emitted_at_iso: '2026-08-08T00:00:00.000Z',
        } as unknown as PendingAction,
      ],
    });
    expect(node(outcome.mutated_graph as GraphV3T, 'o-churn-rate').observed_state).toBeUndefined();
    expect(outcome.assistant_text).toContain(QUESTION_FOR_CHURN);
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

describe('declared draft percentages retain the baseline question', () => {
  function draftedGraph(kind: 'risk' | 'outcome' = 'outcome') {
    const graph = graphWithConstraintTargets();
    const target = node(graph, 'o-churn-rate');
    target.kind = kind;
    target.observed_state = {
      value: 0.30,
      raw_value: 30,
      unit: '%',
      declared_scale: 'unit_interval',
      source: 'cee_inference',
      extractionType: 'inferred',
      factor_type: 'probability',
      uncertainty_drivers: ['Limited historical observations'],
    };
    return graph;
  }

  it.each(['risk', 'outcome'] as const)('%s estimate is retained without inventing a baseline, then a user answer is saved', async (kind) => {
    const graph = draftedGraph(kind);
    const estimate = { ...node(graph, 'o-churn-rate').observed_state! };
    const first = await runTurn({
      graph, message: 'Keep churn rate under 25%.',
      targetId: 'o-churn-rate', value: 25, unit: '%',
    });
    const saved = first.mutated_graph as GraphV3T;
    expect(node(saved, 'o-churn-rate').observed_state).toEqual(estimate);
    expect(first.assistant_text).toContain(QUESTION_FOR_CHURN);
    expect(first.__elicit_baseline).toMatchObject({ target_id: 'o-churn-rate', value: 25, unit: '%' });
    const row = saved.goal_constraints!.find((c) => c.node_id === 'o-churn-rate')!;
    expect(row).toMatchObject({ value: 25, operator: '<=', value_frame: 'level' });

    const pending = {
      ...elicitPending(),
      action: { ...first.__elicit_baseline!, kind: 'elicit_target_baseline' },
    } as PendingAction;
    const second = await runTurn({
      graph: saved, message: '40%', pendings: [pending],
      targetId: 'o-churn-rate', value: 25, unit: '%',
    });
    const answered = second.mutated_graph as GraphV3T;
    expect(node(answered, 'o-churn-rate').observed_state).toEqual({
      ...estimate, value: 0.40, baseline: 0.40, raw_value: 0.40,
      unit: 'fraction', cap: 1, source: 'brief_extraction', extractionType: 'explicit',
    });
    expect(answered.goal_constraints!.find((c) => c.node_id === 'o-churn-rate')).toEqual(row);
    expect(second.__elicit_baseline).toBeUndefined();
    expect(second.assistant_text).toContain('Noted Churn rate is currently at 40%.');
  });

  it.each([
    ['undeclared scale', { declared_scale: undefined }],
    ['ratio scale', { declared_scale: 'ratio' }],
    ['ratio above 100%', { declared_scale: 'ratio', value: 1.25, raw_value: 125 }],
    ['inconsistent raw magnitude', { raw_value: 3 }],
    ['missing raw magnitude', { raw_value: undefined }],
    ['native percentage value', { value: 30 }],
    ['incompatible unit', { unit: '$' }],
    ['existing scale cap', { cap: 100 }],
    ['existing baseline', { baseline: 0.2 }],
  ])('%s is not treated as the supported draft percentage cell', async (_label, change) => {
    const graph = draftedGraph();
    const target = node(graph, 'o-churn-rate');
    target.observed_state = { ...target.observed_state!, ...change };
    const before = { ...target.observed_state };
    const outcome = await runTurn({
      graph, message: 'Churn rate is 40% today. Keep churn rate under 25%.',
      targetId: 'o-churn-rate', value: 25, unit: '%',
    });
    expect(node(outcome.mutated_graph as GraphV3T, 'o-churn-rate').observed_state).toEqual(before);
    expect(outcome.__elicit_baseline).toBeUndefined();
  });
});

/**
 * ⭐⭐ THE GOAL CAN NEVER BE MADE MEASURABLE — and the product says so out loud.
 *
 * Measured 21 Sep 2026 by EXECUTING Paul's own sentence against this handler,
 * after the lane's queue recorded the opposite ("all three needed mechanisms
 * are already built ... it should have elicited the level from him"). The
 * handler does not throw and does not misbehave:
 *
 *   "gain at least 20 new enterprise customers by the end of the year"
 *     → goal_threshold_raw 20, unit "customers"   — the target IS stamped
 *     → observed_state.baseline undefined          — correctly not invented
 *     → __elicit_baseline undefined                — AND NOTHING ASKS FOR ONE
 *     → "Success target set: Revenue at least 20 customers. I'll flag how your
 *        options score against it ONCE THE ANALYSIS CAN MEASURE THIS GOAL."
 *
 * The reply names the missing precondition and then never requests it. The
 * baseline is what makes the goal measurable; elicitation is the remedy this
 * product designed for a missing baseline; and `mintEligible`'s second
 * conjunct is `(kind === 'outcome' || kind === 'risk')`, so the remedy is
 * structurally unreachable for a goal. Downstream, ISL withholds the
 * recommendation with `missing_goal_baseline` — measured on a complex brief on
 * 19 Sep, and this is where that baseline was silently never obtained.
 *
 * ⛔ THIS FILE DOES NOT FIX IT, DELIBERATELY. `mintEligible` is a ten-conjunct
 * predicate over natural language, and widening one is how this estate has
 * repeatedly traded one silent failure for its mirror image (traps 22b/22f).
 * A count baseline ("we have eight today") is also a different PARSING problem
 * from the percentage one the mint was built for — not the same fix wearing a
 * wider gate. So the gap is recorded HERE, in the suite, where it REDs the
 * moment someone changes it in either direction. A gap a suite can see is
 * honest; a gap invisible to it is how this shipped.
 */
describe('2.918 — the elicitation cell EXCLUDES goals, so a goal target can never be baselined', () => {
  it("Paul's sentence: the target is stamped, no baseline is invented, and NO question is asked", async () => {
    const outcome = await runTurn({
      message: 'gain at least 20 new enterprise customers by the end of the year',
      targetId: 'g-revenue',
      kind: 'goal',
      constraintType: 'at_least',
      value: 20,
      unit: 'customers',
    });
    const goal = node(outcome.mutated_graph as GraphV3T, 'g-revenue') as {
      goal_threshold_raw?: number;
      observed_state?: { baseline?: number };
    };

    // The commit itself is correct and is NOT what is broken here.
    expect(goal.goal_threshold_raw).toBe(20);
    expect(goal.observed_state?.baseline).toBeUndefined();

    // ⛔ THE GAP: the one thing that would make the goal measurable is never requested.
    expect(outcome.__elicit_baseline).toBeUndefined();
  });

  /**
   * THE DISCRIMINATING PAIR (trap 19). Absence alone proves nothing — this
   * probe must be shown capable of SEEING an elicitation, and the two arms must
   * differ in exactly one field, or the silence could be the unit, the edges,
   * the frame or the fixture rather than the kind.
   */
  it('ISOLATES THE CONJUNCT: one identical cell asks as an outcome and goes silent as a goal', async () => {
    const asOutcome = await runTurn({
      message: 'Keep churn rate under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
    });
    // POSITIVE CONTROL: the elicitation demonstrably fires on this exact cell.
    expect(asOutcome.__elicit_baseline?.target_id).toBe('o-churn-rate');

    const graph = graphWithConstraintTargets();
    (node(graph, 'o-churn-rate') as { kind: string }).kind = 'goal'; // the ONLY change
    const asGoal = await runTurn({
      message: 'Keep churn rate under 10%.',
      targetId: 'o-churn-rate',
      kind: 'goal',
      value: 10,
      unit: '%',
      graph,
    });

    // Same label, same edges, same unit, same frame, same value, same message.
    expect(asGoal.__elicit_baseline).toBeUndefined();
  });
});
