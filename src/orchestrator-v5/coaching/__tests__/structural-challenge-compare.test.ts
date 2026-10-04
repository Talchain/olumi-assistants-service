/**
 * SCI-DEEP v1 — the claim-by-claim comparison, held to the TESTED historical evidence (Structural Robustness bank 2,
 * KEEP: ISL c40a6c2e acceptance-evidence/structural-robustness-2nd-20260930; fixtures carry each source sha256).
 *
 * The comparator is agnostic to HOW the alternative was built, so the bank's own alternatives are its oracles:
 *   A vs B  (12-month reading): "£59 leads" HOLDS while "reaching £85k" CHANGES (1 -> 0.5291) and the outcome crosses
 *           the £85k target — an unchanged winner is not an unchanged result.
 *   A vs A2 (frame control): nothing changes.
 *   A vs C  (direction reversed): no headline changes ("the reply must not say this depends on price raising churn").
 * Goal certainty is decided by CEE's REAL producer (`goalCertaintyOfStoredResult`) on each model's graph, never assumed.
 */
import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { StructuralChallengeClaimV1Schema, type StructuralChallengeClaimV1 } from '@talchain/schemas';
import { compareStructuralChallenge } from '../structural-challenge-compare.js';
import { reachableFrom } from '../structural-challenge-eligibility.js';
import { goalCertaintyOfStoredResult } from '../../agent-lane/goal-certainty.js';
import { GOAL_FIGURES_WITHHELD_CODES } from '../../../orchestrator/context/option-result-source.js';
import A_BODY from './fixtures/sci-deep-bank2/A-cur.plot-body.json';
import A2_BODY from './fixtures/sci-deep-bank2/A2-cur.plot-body.json';
import B_BODY from './fixtures/sci-deep-bank2/B-cur.plot-body.json';
import C_BODY from './fixtures/sci-deep-bank2/C-cur.plot-body.json';
import A_GRAPH from './fixtures/sci-deep-bank2/A-graph.json';
import A2_GRAPH from './fixtures/sci-deep-bank2/A2-graph.json';
import B_GRAPH from './fixtures/sci-deep-bank2/B-graph.json';
import C_GRAPH from './fixtures/sci-deep-bank2/C-graph.json';

type Rec = Record<string, unknown>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const P59 = 'raise_pro_price_to_59';
const SQ = 'status_quo';
const GOAL = 'mrr';
const TARGET = 85000;

function runFact(body: Rec, graph: { graph: unknown }, hash: string, opts: { mayNameLeader?: boolean } = {}): HandlerFact {
  const enrichment = clone(body);
  const options = (enrichment.option_comparison as Rec[]);
  const leader = [...options].sort((x, y) => (y.win_probability as number) - (x.win_probability as number))[0];
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'ssr2-mrr-pricing',
      leading_option_id: leader.option_id,
      summary: '',
      enrichment,
      graph_hash_at_run: hash,
      run_id: `run-${hash}`,
      computed_at: '2026-10-03T19:00:00.000Z',
      goal_certainty: goalCertaintyOfStoredResult(graph.graph, { enrichment }),
      constraint_verdict: { may_name_leading_option: opts.mayNameLeader ?? true, constraint_verdict_state: 'evaluated_feasible' },
    },
  } as unknown as HandlerFact;
}

const ALL = reachableFrom(A_GRAPH.graph, 'new_paying_subscribers_per_month'); // a link upstream of the goal
const compare = (b: HandlerFact, reachable: ReadonlySet<string> = ALL, a: HandlerFact = runFact(A_BODY, A_GRAPH, 'hash-a')) => {
  const out = compareStructuralChallenge({ baselineFact: a, candidateFact: b, turnMayNameLeader: true, reachable, goalNodeId: GOAL, goalLevelTarget: TARGET });
  if (!out.ok) throw new Error(out.reason);
  // All historical fixtures and every evidence variant below exercise the published claim licences.
  for (const c of out.claims) expect(StructuralChallengeClaimV1Schema.parse(c)).toEqual(c);
  return out;
};
const claim = (claims: readonly StructuralChallengeClaimV1[], kind: StructuralChallengeClaimV1['kind'], option?: string, constraint?: string) =>
  claims.find((c) => c.kind === kind && (kind === 'leader' || ((c as { option_id: string }).option_id === option
    && (constraint === undefined || (c as { constraint_id: string | null }).constraint_id === constraint))));

describe('SCI-DEEP comparator · historical oracles (bank 2)', () => {
  it('the goal-certainty producer earns A\'s exact 1 for £59 (precondition of the certainty boundary)', () => {
    const a = runFact(A_BODY, A_GRAPH, 'hash-a');
    const decisions = (a as unknown as { result: { goal_certainty: Rec[] } }).result.goal_certainty;
    expect(decisions.find((d) => d.option_id === P59)).toMatchObject({ probability_of_goal: 1, earned: true });
  });

  it('A vs B: the leader HOLDS while reaching £85k CHANGES, and the £59 outcome crosses the target', () => {
    const { claims, pair_provenance } = compare(runFact(B_BODY, B_GRAPH, 'hash-b'));
    expect(pair_provenance).toEqual({ seed_equal: true, hash_equal: false, builds_equal: 'unknown', n_equal: true });
    expect(claim(claims, 'leader')).toMatchObject({ baseline_option_id: P59, alternative_option_id: P59, verdict: 'holds', basis: 'leader_same', noise_verdict: 'signal' });
    expect(claim(claims, 'goal_probability', P59)).toMatchObject({ baseline: 1, alternative: 0.5291, verdict: 'changes', basis: 'certainty_boundary_crossed', noise_verdict: 'signal' });
    expect(claim(claims, 'outcome_level', P59)).toMatchObject({ target: TARGET, verdict: 'changes', basis: 'target_crossed', noise_verdict: 'signal' });
    expect(claim(claims, 'outcome_level', SQ)).toMatchObject({ verdict: 'holds', basis: 'same_side_of_target' });
  });

  it('A vs A2 (frame control): nothing changes', () => {
    const { claims } = compare(runFact(A2_BODY, A2_GRAPH, 'hash-a2'));
    expect(claims.filter((c) => c.verdict === 'changes')).toEqual([]);
    expect(claim(claims, 'leader')).toMatchObject({ verdict: 'holds', basis: 'leader_same' });
    expect(claim(claims, 'goal_probability', P59)).toMatchObject({ verdict: 'holds', basis: 'certainty_kept' });
  });

  it('A vs C (direction reversed): no headline changes', () => {
    const { claims } = compare(runFact(C_BODY, C_GRAPH, 'hash-c'));
    expect(claims.filter((c) => c.verdict === 'changes')).toEqual([]);
  });
});

describe('SCI-DEEP comparator · licences, absence and construction', () => {
  it('a link that cannot reach the goal: its goal claims hold BY CONSTRUCTION and say so (never robustness evidence)', () => {
    const { claims } = compare(runFact(A2_BODY, A2_GRAPH, 'hash-a2'), new Set(['an_unrelated_leaf']));
    const goalClaims = claims.filter((c) => c.kind !== 'constraint_probability');
    expect(goalClaims.length).toBeGreaterThan(0);
    for (const c of goalClaims) expect(c).toMatchObject({ verdict: 'holds', basis: 'unaffected_by_construction', invariant_by_construction: true });
  });

  it('a constraint on a node the removed link cannot reach holds by construction; one it can reach is delta_only', () => {
    const fromSubs = new Set(['paying_subscribers', 'mrr']); // removing a link INTO subscribers: churn is upstream
    const churn = 'agent-lane:monthly_churn:<=';
    expect(claim(compare(runFact(A2_BODY, A2_GRAPH, 'hash-a2'), fromSubs).claims, 'constraint_probability', P59, churn))
      .toMatchObject({ verdict: 'holds', basis: 'unaffected_by_construction', invariant_by_construction: true });
    const fromPrice = reachableFrom(A_GRAPH.graph, 'monthly_churn'); // removing a link INTO churn: churn is reached
    expect(claim(compare(runFact(A2_BODY, A2_GRAPH, 'hash-a2'), fromPrice).claims, 'constraint_probability', P59, churn))
      .toMatchObject({ verdict: 'delta_only', invariant_by_construction: false });
  });

  it('a withheld leader on either side is never named: not_comparable, null id on that side', () => {
    const { claims } = compare(runFact(B_BODY, B_GRAPH, 'hash-b', { mayNameLeader: false }));
    expect(claim(claims, 'leader')).toMatchObject({ baseline_option_id: P59, alternative_option_id: null, verdict: 'not_comparable', basis: 'withheld_on_one_side' });
  });

  it('withheld goal figures are never read as 0: not_comparable withheld_on_one_side', () => {
    const body = clone(B_BODY) as Rec & { option_comparison: Rec[]; inference_warnings: Rec[] };
    for (const o of body.option_comparison) delete o.probability_of_goal;
    body.inference_warnings.push({ code: [...GOAL_FIGURES_WITHHELD_CODES][0] });
    const { claims } = compare(runFact(body, B_GRAPH, 'hash-b'));
    expect(claim(claims, 'goal_probability', P59)).toMatchObject({ baseline: 1, alternative: null, verdict: 'not_comparable', basis: 'withheld_on_one_side' });
  });

  it('an UNEARNED exact certainty is not a licensed boundary: the crossing is shown without a verdict word', () => {
    const a = runFact(A_BODY, A_GRAPH, 'hash-a') as unknown as { result: { goal_certainty: Rec[] } };
    a.result.goal_certainty = a.result.goal_certainty.map((d) => ({ ...d, earned: false }));
    const { claims } = compare(runFact(B_BODY, B_GRAPH, 'hash-b'), ALL, a as unknown as HandlerFact);
    expect(claim(claims, 'goal_probability', P59)).toMatchObject({ verdict: 'delta_only', basis: 'no_licensed_boundary', noise_verdict: 'signal' });
  });

  it('a changed identity evaluation makes goal claims NOT COMPARABLE', () => {
    const body = clone(B_BODY) as Rec & { identity_evaluations: Rec[] };
    body.identity_evaluations = body.identity_evaluations.map((e) => ({ ...e, evaluated: false }));
    const { claims } = compare(runFact(body, B_GRAPH, 'hash-b'));
    expect(claim(claims, 'goal_probability', P59)).toMatchObject({ verdict: 'not_comparable', basis: 'identity_status_changed' });
    expect(claim(claims, 'outcome_level', P59)).toMatchObject({ verdict: 'not_comparable', basis: 'identity_status_changed' });
  });

  it('a near-tie lead under the alternative is not a held leader: delta_only within noise', () => {
    const body = clone(B_BODY) as Rec & { option_comparison: Rec[] };
    for (const o of body.option_comparison) o.win_probability = o.option_id === P59 ? 0.505 : 0.495;
    const { claims } = compare(runFact(body, B_GRAPH, 'hash-b'));
    expect(claim(claims, 'leader')).toMatchObject({ verdict: 'delta_only', basis: 'within_noise', noise_verdict: 'within_noise' });
  });

  it('an unaffected leader still needs a clear lead to HOLD: within noise it is delta_only, never invariant', () => {
    const body = clone(A2_BODY) as Rec & { option_comparison: Rec[] };
    for (const o of body.option_comparison) o.win_probability = o.option_id === P59 ? 0.505 : 0.495;
    const { claims } = compare(runFact(body, A2_GRAPH, 'hash-a2'), new Set(['an_unrelated_leaf']));
    expect(claim(claims, 'leader')).toMatchObject({ verdict: 'delta_only', basis: 'within_noise', invariant_by_construction: false });
  });

  it('every quantity claim states it carries no constraint boundary (CEE declares none in v1)', () => {
    const { claims } = compare(runFact(B_BODY, B_GRAPH, 'hash-b'));
    for (const c of claims) if (c.kind !== 'leader') expect(c.constraint_boundary).toBeNull();
  });

  it('an unreadable candidate is a typed failure, never a comparison', () => {
    const broken = runFact(B_BODY, B_GRAPH, 'hash-b') as unknown as { result: { enrichment: Rec } };
    delete broken.result.enrichment.meta;
    const out = compareStructuralChallenge({
      baselineFact: runFact(A_BODY, A_GRAPH, 'hash-a'), candidateFact: broken as unknown as HandlerFact,
      turnMayNameLeader: true, reachable: ALL, goalNodeId: GOAL, goalLevelTarget: TARGET,
    });
    expect(out).toEqual({ ok: false, reason: 'candidate_unparseable' });
  });
});


describe('SCI-DEEP producer · published 0.76.0 evidence rules', () => {
  it.each([
    ['different probabilities', 0.1, 0.9],
    ['same probabilities', 0.8746, 0.8746],
  ])('constraint %s without a declared probability boundary never earn a side verdict', (_label, prior, current) => {
    const a = clone(A_BODY) as Rec & { option_comparison: Rec[] };
    const b = clone(B_BODY) as Rec & { option_comparison: Rec[] };
    const id = 'agent-lane:monthly_churn:<=';
    (a.option_comparison.find((o) => o.option_id === P59)!.constraint_probabilities as Rec)[id] = prior;
    (b.option_comparison.find((o) => o.option_id === P59)!.constraint_probabilities as Rec)[id] = current;
    const { claims } = compare(runFact(b, B_GRAPH, 'hash-b'), reachableFrom(A_GRAPH.graph, 'monthly_churn'), runFact(a, A_GRAPH, 'hash-a'));
    expect(claim(claims, 'constraint_probability', P59, id)).toMatchObject({
      baseline: prior, alternative: current, constraint_boundary: null, verdict: 'delta_only',
      basis: prior === current ? 'within_noise' : 'no_licensed_boundary',
    });
    expect(claims.some((c) => c.basis === 'constraint_side_same' || c.basis === 'constraint_side_changed')).toBe(false);
  });

  it('missing win-share evidence cannot earn leader HOLDS by substituting zero', () => {
    const body = clone(A2_BODY) as Rec & { option_comparison: Rec[] };
    delete body.option_comparison.find((o) => o.option_id === SQ)!.win_probability;
    const { claims } = compare(runFact(body, A2_GRAPH, 'hash-a2'), new Set(['an_unrelated_leaf']));
    expect(claim(claims, 'leader')).toMatchObject({
      baseline_option_id: P59, alternative_option_id: P59,
      verdict: 'delta_only', noise_verdict: 'not_noise_qualified', basis: 'not_noise_qualified', invariant_by_construction: false,
    });
  });

  it('an unaffected outcome without variance evidence has values only, never unqualified HOLDS', () => {
    const body = clone(A2_BODY) as Rec & { option_comparison: Rec[] };
    delete (body.option_comparison.find((o) => o.option_id === P59)!.outcome as Rec).std;
    const { claims } = compare(runFact(body, A2_GRAPH, 'hash-a2'), new Set(['an_unrelated_leaf']));
    expect(claim(claims, 'outcome_level', P59)).toMatchObject({
      verdict: 'delta_only', noise_verdict: 'not_noise_qualified', basis: 'not_noise_qualified', invariant_by_construction: false,
    });
  });

  it('missing sides are null and not comparable; delta_only always carries both sides', () => {
    const body = clone(B_BODY) as Rec & { option_comparison: Rec[] };
    const row = body.option_comparison.find((o) => o.option_id === P59)!;
    delete row.probability_of_goal;
    delete (row.outcome as Rec).mean;
    const { claims } = compare(runFact(body, B_GRAPH, 'hash-b'));
    expect(claim(claims, 'goal_probability', P59)).toMatchObject({ alternative: null, verdict: 'not_comparable', basis: 'missing_on_one_side' });
    expect(claim(claims, 'outcome_level', P59)).toMatchObject({ alternative: null, verdict: 'not_comparable', basis: 'missing_on_one_side' });
    for (const c of claims) {
      if (c.verdict === 'delta_only') {
        if (c.kind === 'leader') {
          expect(c.baseline_option_id).not.toBeNull();
          expect(c.alternative_option_id).not.toBeNull();
        } else {
          expect(c.baseline).not.toBeNull();
          expect(c.alternative).not.toBeNull();
        }
      }
    }
  });

  it.each([
    ['A', A_BODY, A_GRAPH], ['A2', A2_BODY, A2_GRAPH], ['B', B_BODY, B_GRAPH], ['C', C_BODY, C_GRAPH],
  ])('every producer claim on existing bank-2 fixture %s parses against the published schema', (_label, body, graph) => {
    const { claims } = compare(runFact(body, graph, 'hash-alternative'));
    expect(claims.length).toBeGreaterThan(0);
    for (const c of claims) expect(StructuralChallengeClaimV1Schema.parse(c)).toEqual(c);
  });
});
