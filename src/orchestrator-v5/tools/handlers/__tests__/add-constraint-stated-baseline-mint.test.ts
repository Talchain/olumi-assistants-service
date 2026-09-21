/**
 * ROADMAP 2.877 (link 2) — the CHAT path mints the target's USER-STATED current
 * level as `observed_state.baseline`, and NOTHING ELSE ever mints one.
 *
 * THE INVIOLABLE RULE — NO INVENTION. A baseline is written ONLY when the
 * user's own message states the target's current level ("churn is 12% today,
 * keep it under 10%"). No statement ⇒ no baseline ⇒ ISL keeps refusing
 * `CONSTRAINT_NOT_CONVERTIBLE / missing_target_baseline`, which is the honest
 * state (the elicitation path is row 2.918, not this file). The no-statement
 * pin lives in `add-constraint-value-frame-carry.test.ts` ("the PINNED
 * post-state") and is deliberately kept there, split from this file: it keeps
 * protecting the no-evidence arm while this file owns the stated-evidence arm.
 *
 * THE MINT CELL IS DELIBERATELY NARROW, derived from the CONSUMERS' bytes, not
 * from what the fields ought to mean:
 *
 *   - target kind OUTCOME/RISK only. Factors are excluded because PLoT emits a
 *     ParameterUncertainty for every factor with a finite observed value
 *     (plot-lite-service translator-v3.ts:674) and ISL then refuses the level
 *     conversion (`target_parameter_uncertainty_shifts_base`) — measured arm H
 *     of the 2.877 probe: a correct baseline is INERT on a factor target.
 *     Goals are excluded because the goal channel has its own coherent mint
 *     (2.273) and PLoT's rung-3 `goal_threshold_cap` range would need the
 *     node's own cap as the divisor — a different arithmetic, parked.
 *   - row unit '%' and 1 < value ≤ 100. PLoT's constraint normalisation only
 *     RUNS when some constraint value is outside [0,1]
 *     (`constraintsNeedNormalisation`, intervention-normaliser.ts:1704); a
 *     '%'-unit row with value ≤ 1 can be forwarded RAW (gate false), where a
 *     fraction-frame baseline beside a raw-percent threshold converts to a
 *     confident wrong number. value > 1 makes every run carrying this row
 *     normalise it on the unit_percent [0,100] rung; ≤ 100 keeps it unclamped.
 *   - target must be NON-ROOT: ISL refuses level conversion on roots
 *     (`root_target`) AND uses `observed_state.value` as a root's sample base,
 *     so a root mint buys nothing and shifts the analysis instead.
 *   - fill-only: an existing baseline (whatever wrote it) is never overwritten.
 *
 * THE MINTED SHAPE — {value: frac, baseline: frac, unit: 'fraction', cap: 1,
 * raw_value: frac, source: 'brief_extraction'} — is chosen so PLoT's
 * `deriveRange` resolves the IDENTITY range [0,1] (explicit_cap) for this
 * node: any coexisting draft-path constraint row (stored as a 0-1 'fraction')
 * normalises to itself instead of being rescaled by a baseline-derived range
 * (deriveRange priority 2 would turn baseline 0.12 into range [0,0.24] and a
 * draft 0.05 into 0.208 — a confident wrong number this shape forecloses).
 * 'fraction' is PLoT's own fraction-scale token (constraint-units.ts), so the
 * scale-unit compatibility check reconciles instead of refusing.
 *
 * Assertions bind by IDENTITY (node id + the stated number), never by a value
 * predicate another node could satisfy (trap 19).
 */

import { describe, expect, it } from 'vitest';

import type { HandlerInvocation } from '../../registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { createAddConstraintHandler } from '../add-constraint.js';
import { HandlerInvocationFailedError } from '../../handler-errors.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';

/**
 * The D1 fixture plus the 2.877 population: a NON-ROOT outcome (the exemplar's
 * churn target), a non-root risk, and a ROOT outcome for the root gate.
 * Edges reuse existing fixture factors so the graph stays valid.
 */
function graphWithConstraintTargets(): GraphV3T {
  const g = buildD1Fixture();
  g.nodes.push(
    { id: 'o-churn-rate', kind: 'outcome', label: 'Churn rate' } as GraphV3T['nodes'][number],
    { id: 'r-breach', kind: 'risk', label: 'Breach likelihood' } as GraphV3T['nodes'][number],
    { id: 'o-orphan', kind: 'outcome', label: 'Orphan rate' } as GraphV3T['nodes'][number],
    // A NON-ROOT factor with NO observed_state: every mint gate passes for it
    // EXCEPT the kind gate, so the factor-exclusion test is discriminating
    // (the fixture's own factors are either roots or carry scale fields that
    // would refuse the fill anyway, which would let a dropped kind gate hide).
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

async function runTurn(opts: {
  message: string;
  targetId: string;
  kind?: RoutingEntityKind;
  constraintType?: 'at_least' | 'at_most';
  value: number;
  unit?: string;
  graph?: GraphV3T;
}) {
  const handler = createAddConstraintHandler();
  const outcome = await handler(
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
    ),
  );
  return outcome;
}

function node(graph: GraphV3T, id: string) {
  const n = graph.nodes.find((x) => x.id === id);
  expect(n, `node '${id}' missing from mutated graph`).toBeDefined();
  return n!;
}

/** Every node OTHER than `exceptId` must carry no observed baseline. */
function assertNoOtherBaselines(graph: GraphV3T, exceptId: string | null) {
  for (const n of graph.nodes) {
    if (n.id === exceptId) continue;
    expect(
      n.observed_state?.baseline,
      `a baseline appeared on '${n.id}' — the mint must bind to the named target only`,
    ).toBeUndefined();
  }
}

describe('2.877 link 2 — the mint fires on the stated level, bound by identity', () => {
  // 2.960 R2 NOTE: these exemplars say 'Churn rate is', not 'Churn is'. The
  // competitor population is now EVERY other labelled node (goal/factor kinds
  // included), and this fixture carries the factor 'Customer churn' — so the
  // bare subject 'churn' is ambiguous IN THIS GRAPH and correctly refuses (see
  // the R2 battery below, where that refusal is pinned as intended behaviour).
  // The uniquely-binding subject keeps each gate in this file the REASON its
  // case refuses, rather than every case refusing via ambiguity (trap 13b).
  it("the brief's exemplar, uniquely bound: churn rate is 12% today, keep it under 10%", async () => {
    const outcome = await runTurn({
      message: 'Churn rate is 12% today, keep it under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
    });
    const graph = outcome.mutated_graph as GraphV3T;

    // The constraint row itself is untouched by the mint: user units, framed.
    const row = (graph.goal_constraints ?? []).filter(
      (c) => c.node_id === 'o-churn-rate' && c.operator === '<=',
    );
    expect(row).toHaveLength(1);
    expect(row[0]!.value).toBe(10);
    expect(row[0]!.unit).toBe('%');
    expect(row[0]!.value_frame).toBe('level');

    // THE MINT — the stated number, on the named node, in the wire shape.
    const target = node(graph, 'o-churn-rate');
    expect(target.observed_state).toBeDefined();
    expect(target.observed_state!.baseline).toBe(0.12);
    expect(target.observed_state!.value).toBe(0.12);
    expect(target.observed_state!.unit).toBe('fraction');
    expect(target.observed_state!.cap).toBe(1);
    expect(target.observed_state!.source).toBe('brief_extraction');

    // Identity: NOTHING else gained a baseline.
    assertNoOtherBaselines(graph, 'o-churn-rate');

    // The fact channel and the receipt both acknowledge a real change.
    expect(outcome.handler_facts[0]?.noop).toBe(false);
    expect(outcome.assistant_text).toContain('Noted Churn rate is currently at 12%.');
  });

  it('RISK target: breach likelihood is 8% today', async () => {
    const outcome = await runTurn({
      message: 'Breach likelihood is 8% today. Keep breach likelihood under 5%.',
      targetId: 'r-breach',
      value: 5,
      unit: '%',
    });
    const graph = outcome.mutated_graph as GraphV3T;
    const target = node(graph, 'r-breach');
    expect(target.observed_state?.baseline).toBe(0.08);
    expect(target.observed_state?.value).toBe(0.08);
    assertNoOtherBaselines(graph, 'r-breach');
  });

  it('the minted baseline SURVIVES the graph validator (the silent-strip hazard)', async () => {
    const outcome = await runTurn({
      message: 'Churn rate is 12% today, keep it under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
    });
    const reparsed = GraphV3.parse(outcome.mutated_graph);
    const target = reparsed.nodes.find((n) => n.id === 'o-churn-rate')!;
    expect(target.observed_state?.baseline).toBe(0.12);
    expect(target.observed_state?.cap).toBe(1);
    expect(target.observed_state?.unit).toBe('fraction');
    expect(target.observed_state?.source).toBe('brief_extraction');
  });

  it('an otherwise-noop restatement turn that ADDS the stated level mints, and the receipt stops claiming noop', async () => {
    // Turn 1: constraint registered with NO stated level (frame rides, no
    // baseline — the honest-refusal state).
    const first = await runTurn({
      message: 'Keep churn under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
    });
    const g1 = first.mutated_graph as GraphV3T;
    expect(
      node(g1, 'o-churn-rate').observed_state?.baseline,
      'turn 1 must not mint — no level was stated',
    ).toBeUndefined();

    // Turn 2: identical constraint, but the user now states the level. This is
    // the natural REPAIR turn after an honest ISL refusal — it must not be
    // swallowed by the noop path.
    const second = await runTurn({
      message: 'Churn rate is 12% today, keep churn under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
      graph: g1,
    });
    const g2 = second.mutated_graph as GraphV3T;
    expect(node(g2, 'o-churn-rate').observed_state?.baseline).toBe(0.12);
    // F9 discipline: the graph changed, so the fact channel must not say noop
    // and the receipt must name what changed.
    expect(second.handler_facts[0]?.noop).toBe(false);
    expect(second.assistant_text).toContain('Noted Churn rate is currently at 12%.');
  });
});

describe('2.877 link 2 — every gate refuses (fail closed), each beside its positive control', () => {
  // The positive control for this whole battery is the exemplar test above:
  // same graph, same target, same constraint shape, mint fires. Each case
  // below changes exactly ONE thing.

  it('no stated level → no mint (the no-invention rule)', async () => {
    const outcome = await runTurn({
      message: 'Keep churn under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
    });
    const target = node(outcome.mutated_graph as GraphV3T, 'o-churn-rate');
    expect(
      target.observed_state,
      'a baseline was manufactured from a message that states no current level',
    ).toBeUndefined();
  });

  it("a stated level for a DIFFERENT metric does not mint on this target — or anywhere", async () => {
    const outcome = await runTurn({
      message: 'Marketing budget is 40% today. Keep churn under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
    });
    const graph = outcome.mutated_graph as GraphV3T;
    expect(node(graph, 'o-churn-rate').observed_state).toBeUndefined();
    assertNoOtherBaselines(graph, null);
  });

  it('no deterministic level-frame evidence for the row → no mint', async () => {
    // Producer-derived: deriveStatedConstraintFrame('Churn is 12% today. Set
    // that to 10.', '<=', 10) === undefined — the copula statement is not a
    // constraint clause, so the row ships unframed and the mint must not fire
    // on an unframed row (a baseline without a frame buys nothing and asserts
    // scale coherence nobody attested).
    const outcome = await runTurn({
      message: 'Churn rate is 12% today. Set that to 10.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
    });
    const graph = outcome.mutated_graph as GraphV3T;
    const row = (graph.goal_constraints ?? []).find(
      (c) => c.node_id === 'o-churn-rate' && c.operator === '<=',
    );
    expect(row?.value_frame).toBeUndefined();
    expect(node(graph, 'o-churn-rate').observed_state).toBeUndefined();
  });

  it('row value ≤ 1 → no mint (PLoT can forward the raw percent unnormalised)', async () => {
    // 'keep it under 0.9%' persists {value: 0.9, unit: '%'} and DOES derive
    // frame 'level' (producer-derived) — but a run whose constraint values all
    // sit in [0,1] skips PLoT's normalisation entirely
    // (constraintsNeedNormalisation), forwarding 0.9 raw where the fraction is
    // 0.009. A baseline would convert that mixed-frame pair into a confident
    // wrong probability; refusing the mint keeps it an honest refusal.
    const outcome = await runTurn({
      message: 'Churn rate is 12% today, keep it under 0.9%.',
      targetId: 'o-churn-rate',
      value: 0.9,
      unit: '%',
    });
    expect(node(outcome.mutated_graph as GraphV3T, 'o-churn-rate').observed_state).toBeUndefined();
  });

  it('row value > 100 → no mint (the [0,100] rung would clamp the threshold)', async () => {
    const outcome = await runTurn({
      message: 'Churn rate is 12% today, keep it under 120%.',
      targetId: 'o-churn-rate',
      value: 120,
      unit: '%',
    });
    expect(node(outcome.mutated_graph as GraphV3T, 'o-churn-rate').observed_state).toBeUndefined();
  });

  it("row unit is not '%' → no mint (the divisor would be a guess)", async () => {
    const outcome = await runTurn({
      message: 'Churn rate is 12% today, keep it under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '£',
    });
    expect(node(outcome.mutated_graph as GraphV3T, 'o-churn-rate').observed_state).toBeUndefined();
  });

  it('FACTOR target → no mint (a PU makes the baseline inert — measured arm H)', async () => {
    const outcome = await runTurn({
      message: 'Customer churn is 4% today. Keep customer churn under 3%.',
      targetId: 'f-churn',
      value: 3,
      unit: '%',
    });
    const target = node(outcome.mutated_graph as GraphV3T, 'f-churn');
    // The fixture factor's observed_state is preserved BYTE-FOR-BYTE: no
    // baseline appears, nothing else moves.
    expect(target.observed_state).toEqual({
      value: 0.04,
      raw_value: 4,
      unit: '%',
      cap: 100,
    });
  });

  it('FACTOR target with every OTHER gate open → still no mint (the kind gate itself bites)', async () => {
    // f-support-load is non-root, has no observed_state, and its label binds
    // the statement — ONLY the kind gate stands between it and a mint. This is
    // what makes the exclusion falsifiable: loosening the kind gate cannot
    // hide behind a root or a scale-field refusal.
    const outcome = await runTurn({
      message: 'Support load is 12% today. Keep support load under 10%.',
      targetId: 'f-support-load',
      value: 10,
      unit: '%',
    });
    expect(
      node(outcome.mutated_graph as GraphV3T, 'f-support-load').observed_state,
    ).toBeUndefined();
  });

  it('GOAL target → no mint from THIS path (the goal channel has its own mint)', async () => {
    const outcome = await runTurn({
      message: 'Revenue is 60% today. Keep revenue under 90%.',
      targetId: 'g-revenue',
      kind: 'goal',
      value: 90,
      unit: '%',
    });
    expect(node(outcome.mutated_graph as GraphV3T, 'g-revenue').observed_state).toBeUndefined();
  });

  it('ROOT target → no mint (ISL refuses root conversion; a root value shifts the sample base)', async () => {
    const outcome = await runTurn({
      message: 'Orphan rate is 12% today. Keep orphan rate under 10%.',
      targetId: 'o-orphan',
      value: 10,
      unit: '%',
    });
    expect(node(outcome.mutated_graph as GraphV3T, 'o-orphan').observed_state).toBeUndefined();
  });

  it('an EXISTING baseline is never overwritten (fill-only), whoever minted it', async () => {
    const graph = graphWithConstraintTargets();
    const target = graph.nodes.find((n) => n.id === 'o-churn-rate')!;
    target.observed_state = {
      value: 0.3,
      baseline: 0.3,
      unit: 'fraction',
      cap: 1,
      source: 'user_override',
    };
    const outcome = await runTurn({
      message: 'Churn rate is 12% today, keep it under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
      graph,
    });
    const after = node(outcome.mutated_graph as GraphV3T, 'o-churn-rate');
    // Identity of the PRESERVED value: still the user's 0.3, still user-owned.
    expect(after.observed_state?.baseline).toBe(0.3);
    expect(after.observed_state?.value).toBe(0.3);
    expect(after.observed_state?.source).toBe('user_override');
    // And the receipt must NOT claim a level was noted.
    expect(outcome.assistant_text).not.toContain('Noted');
  });

  it('conflicting stated levels → no mint (unanimity)', async () => {
    const outcome = await runTurn({
      message: 'Churn rate is 12% today. Actually, churn rate is 11% now. Keep churn under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
    });
    expect(node(outcome.mutated_graph as GraphV3T, 'o-churn-rate').observed_state).toBeUndefined();
  });

  it('a conditional level is not a statement → no mint', async () => {
    const outcome = await runTurn({
      message: 'If churn is 12%, we are in trouble. Keep churn under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
    });
    expect(node(outcome.mutated_graph as GraphV3T, 'o-churn-rate').observed_state).toBeUndefined();
  });

  // --- Adversarial review of #868, B1 — the three fabrication classes proven
  // REACHABLE end-to-end (real handler, real fixture, full receipt). Kept at
  // the handler level, not just the extractor, because that is where the
  // reviewer demonstrated them.
  it('B1a: a disbelief echo does not mint (the ? sits after the match)', async () => {
    const outcome = await runTurn({
      message: 'Churn is 12%? That cannot be right. Keep churn under 10% regardless.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
    });
    expect(node(outcome.mutated_graph as GraphV3T, 'o-churn-rate').observed_state).toBeUndefined();
    expect(outcome.assistant_text).not.toContain('Noted');
  });

  it('B1b: quoted third-party speech does not mint (quotes carry context, not sever it)', async () => {
    const outcome = await runTurn({
      message:
        'The analyst said "churn is 12%" but I have not verified it. Keep churn under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
    });
    expect(node(outcome.mutated_graph as GraphV3T, 'o-churn-rate').observed_state).toBeUndefined();
    expect(outcome.assistant_text).not.toContain('Noted');
  });

  it('B1c: a conditional hidden behind an abbreviation dot does not mint', async () => {
    const outcome = await runTurn({
      message: 'If, e.g., churn is 12%, we are in trouble. Keep churn under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
    });
    expect(node(outcome.mutated_graph as GraphV3T, 'o-churn-rate').observed_state).toBeUndefined();
    expect(outcome.assistant_text).not.toContain('Noted');
  });

  it('B2 (chat variant): a generic subject binding another candidate target in the graph mints nothing', async () => {
    // 'rate' ⊆ both 'Churn rate' and 'Orphan rate' word-sets — CEE cannot say
    // WHICH rate is 12%, so it says nothing. The candidate population is the
    // mintable one (outcome/risk nodes), mirroring the kind gate.
    const outcome = await runTurn({
      message: 'The rate is 12% today. Keep churn under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
    });
    const graph = outcome.mutated_graph as GraphV3T;
    expect(node(graph, 'o-churn-rate').observed_state).toBeUndefined();
    assertNoOtherBaselines(graph, null);
  });
});

describe('2.960 R2 — the competitor population is EVERY other labelled node, not just outcome/risk', () => {
  // Adversarial review of #868, B2 widened: the old population mirrored the
  // KIND gate (outcome/risk), so a goal or factor whose label the subject also
  // binds was INVISIBLE to the ambiguity rule — "The rate is 12%" beside a
  // goal 'Win rate' minted onto 'Churn rate' as if the goal did not exist.
  // Ambiguity is about what the WORDS could name, and words do not read kinds.

  it('a GOAL label the subject binds makes the statement ambiguous — mints on NONE', async () => {
    // Local relabels make the goal the ONLY competing bind for 'rate': the
    // fixture's 'Orphan rate' would otherwise already refuse this pre-R2
    // (the B2 chat-variant test above pins that), hiding the goal's effect.
    const graph = graphWithConstraintTargets();
    graph.nodes.find((n) => n.id === 'g-revenue')!.label = 'Win rate';
    graph.nodes.find((n) => n.id === 'o-orphan')!.label = 'Orphan count';
    const outcome = await runTurn({
      message: 'The rate is 12% today. Keep churn under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
      graph,
    });
    const mutated = outcome.mutated_graph as GraphV3T;
    expect(node(mutated, 'o-churn-rate').observed_state).toBeUndefined();
    assertNoOtherBaselines(mutated, null);
  });

  it('PRECONDITION PAIR (trap 13b): with the goal relabelled AWAY, the same statement mints', async () => {
    // Same graph shape, goal label word-disjoint from 'rate' — proves the
    // refusal above is the GOAL binding, not something else in the fixture.
    const graph = graphWithConstraintTargets();
    graph.nodes.find((n) => n.id === 'g-revenue')!.label = 'Total revenue';
    graph.nodes.find((n) => n.id === 'o-orphan')!.label = 'Orphan count';
    const outcome = await runTurn({
      message: 'The rate is 12% today. Keep churn under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
      graph,
    });
    expect(node(outcome.mutated_graph as GraphV3T, 'o-churn-rate').observed_state?.baseline).toBe(
      0.12,
    );
  });

  it("a FACTOR label the subject binds makes the statement ambiguous — the 2.877 exemplar refuses IN THIS GRAPH", async () => {
    // 'churn' ⊆ both 'Churn rate' (the target) and 'Customer churn' (the
    // fixture factor). CEE cannot say which metric the user stated, so it
    // states nothing — the elicitation (2.918) is the repair path.
    const outcome = await runTurn({
      message: 'Churn is 12% today, keep it under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
    });
    const mutated = outcome.mutated_graph as GraphV3T;
    expect(node(mutated, 'o-churn-rate').observed_state).toBeUndefined();
    assertNoOtherBaselines(mutated, null);
    expect(outcome.assistant_text).not.toContain('Noted');
  });

  it('PRECONDITION PAIR (trap 13b): the fully-named subject in the SAME graph still mints', async () => {
    const outcome = await runTurn({
      message: 'Churn rate is 12% today, keep it under 10%.',
      targetId: 'o-churn-rate',
      value: 10,
      unit: '%',
    });
    expect(node(outcome.mutated_graph as GraphV3T, 'o-churn-rate').observed_state?.baseline).toBe(
      0.12,
    );
  });
});

describe('2.877 link 2 — the unit-ambiguity emit guard now prices the CLAMP, not just the cap (tightening)', () => {
  // Pre-existing latent defect, closed here because the cap-1 mint shape would
  // otherwise widen it: `declaredCap` treated ANY positive cap as "downstream
  // normalisation is explicit", but a unit-less value ABOVE the cap is clamped
  // by PLoT's normaliseValue into a trivially-satisfied threshold — the exact
  // silent nullification the guard exists to refuse. The cap only exempts when
  // 0 ≤ value ≤ cap (the unclamped cell).

  function graphWithCappedOutcome(cap: number): GraphV3T {
    const g = graphWithConstraintTargets();
    const target = g.nodes.find((n) => n.id === 'o-churn-rate')!;
    target.observed_state = { value: 0.5, cap };
    return g;
  }

  it('unit-less value ABOVE the declared cap is refused (was silently accepted, then clamped downstream)', async () => {
    let caught: unknown;
    try {
      await runTurn({
        message: 'Keep it under 60.',
        targetId: 'o-churn-rate',
        value: 60,
        graph: graphWithCappedOutcome(50),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HandlerInvocationFailedError);
    const failure = caught as HandlerInvocationFailedError;
    expect(failure.details['rejection_reason']).toBe('unit_ambiguous_probability_domain');
  });

  it('CONTROL: unit-less value WITHIN the declared cap is still accepted (exemption intact)', async () => {
    const outcome = await runTurn({
      message: 'Keep it under 30.',
      targetId: 'o-churn-rate',
      value: 30,
      graph: graphWithCappedOutcome(50),
    });
    const row = (outcome.mutated_graph as GraphV3T).goal_constraints!.find(
      (c) => c.node_id === 'o-churn-rate' && c.operator === '<=',
    );
    expect(row?.value).toBe(30);
  });

  it('unit-less NEGATIVE value is refused even under a declared cap (clamps to the trivially-false 0)', async () => {
    let caught: unknown;
    try {
      await runTurn({
        message: 'Keep it above -5.',
        targetId: 'o-churn-rate',
        constraintType: 'at_least',
        value: -5,
        graph: graphWithCappedOutcome(50),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HandlerInvocationFailedError);
    const failure = caught as HandlerInvocationFailedError;
    expect(failure.details['rejection_reason']).toBe('unit_ambiguous_probability_domain');
  });
});
