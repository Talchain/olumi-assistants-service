/**
 * SCI-DEEP v1 — the claim-by-claim comparison, held to the TESTED historical evidence (Structural Robustness bank 2,
 * KEEP: ISL c40a6c2e acceptance-evidence/structural-robustness-2nd-20260930; fixtures carry each source sha256).
 *
 * The comparator is agnostic to HOW the alternative was built, so the bank's own alternatives are its oracles:
 *   A vs B  (12-month reading): "£59 leads" HOLDS while "reaching £85k" CHANGES (1 -> 0.5291) and the outcome crosses
 *           the £85k target in the raw figures. The unattested target boundary now travels as delta_only.
 *   A vs A2 (frame control): nothing changes.
 *   A vs C  (direction reversed): no headline changes ("the reply must not say this depends on price raising churn").
 * Goal certainty is decided by CEE's REAL producer (`goalCertaintyOfStoredResult`) on each model's graph, never assumed.
 */
import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { StructuralChallengeClaimV1Schema, type StructuralChallengeClaimV1 } from '@talchain/schemas';
import { compareStructuralChallenge } from '../structural-challenge-compare.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { leadNoise } from '../structural-challenge-noise.js';
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
      input_snapshot: {
        snapshot_version: 1, sent_digest: 'd'.repeat(64),
        goal: { node_id: GOAL, target_raw: TARGET, frame: 'level', unit: 'GBP/month' },
        options: [P59, SQ].map((option_id) => ({ option_id, settings: [] })), options_not_sent: [],
        factors: [], links: [], constraints: [{ constraint_id: 'agent-lane:monthly_churn:<=', node_id: 'monthly_churn', operator: '<=', raw: 5 }],
      },
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
  expect(identities(out.claims)).toEqual(EXPECTED);
  return out;
};
const identities = (claims: readonly StructuralChallengeClaimV1[]) => claims.map((c) => c.kind === 'leader' ? 'leader' : JSON.stringify([c.kind, c.option_id, c.constraint_id])).sort();
const EXPECTED = ['leader', ...[P59, SQ].flatMap((id) => [JSON.stringify(['goal_probability', id, null]), JSON.stringify(['outcome_level', id, null]), JSON.stringify(['constraint_probability', id, 'agent-lane:monthly_churn:<='])])].sort();
const claim = (claims: readonly StructuralChallengeClaimV1[], kind: StructuralChallengeClaimV1['kind'], option?: string, constraint?: string) =>
  claims.find((c) => c.kind === kind && (kind === 'leader' || ((c as { option_id: string }).option_id === option
    && (constraint === undefined || (c as { constraint_id: string | null }).constraint_id === constraint))));

describe('SCI-DEEP comparator · historical oracles (bank 2)', () => {
  it('the goal-certainty producer earns A\'s exact 1 for £59 (precondition of the certainty boundary)', () => {
    const a = runFact(A_BODY, A_GRAPH, 'hash-a');
    const decisions = (a as unknown as { result: { goal_certainty: Rec[] } }).result.goal_certainty;
    expect(decisions.find((d) => d.option_id === P59)).toMatchObject({ probability_of_goal: 1, earned: true });
  });

  it('A vs B: leader and earned certainty retain verdicts; unattested target boundaries weaken to deltas', () => {
    const { claims, pair_provenance } = compare(runFact(B_BODY, B_GRAPH, 'hash-b'));
    expect(pair_provenance).toEqual({ seed_equal: true, hash_equal: false, builds_equal: 'unknown', n_equal: true });
    expect(claim(claims, 'leader')).toMatchObject({ baseline_option_id: P59, alternative_option_id: P59, verdict: 'holds', basis: 'leader_same', noise_verdict: 'signal' });
    expect(claim(claims, 'goal_probability', P59)).toMatchObject({ baseline: 1, alternative: 0.5291, verdict: 'changes', basis: 'certainty_boundary_crossed', noise_verdict: 'signal' });
    expect(claim(claims, 'outcome_level', P59)).toMatchObject({ target: null, verdict: 'delta_only', basis: 'no_licensed_boundary', noise_verdict: 'signal' });
    expect(claim(claims, 'outcome_level', SQ)).toMatchObject({ target: null, verdict: 'delta_only', basis: 'within_noise' });
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


describe('independent-review regressions: complete claim identities', () => {
  const raw = (a: HandlerFact, b: HandlerFact, graphs: { baselineGraph?: unknown; candidateGraph?: unknown } = {}, reachable = ALL) =>
    compareStructuralChallenge({ baselineFact: a, candidateFact: b, turnMayNameLeader: true, reachable, goalNodeId: GOAL, goalLevelTarget: TARGET, ...graphs });
  const fact = (body: unknown, side: 'a' | 'b') => runFact(body as Rec, side === 'a' ? A_GRAPH : B_GRAPH, `hash-${side}`);
  const mutate = (f: HandlerFact, fn: (r: any) => void) => { const c = clone(f); fn((c as any).result); return c; };

  it.each(['a', 'b'] as const)('1: both Runs need qualified evidence (%s side), including unaffected/changed leaders', (side) => {
    for (const reachable of [ALL, new Set(['unrelated'])]) {
      for (const shares of [[0.505, 0.495], [0.5, 0.5], [0.1, 0.9], [null, 0.9], [0.9, null]]) {
        for (const changed of [false, true]) {
          let a = fact(A_BODY, 'a'); let b = fact(B_BODY, 'b');
          if (changed) b = mutate(b, (r) => {
            r.leading_option_id = SQ;
            for (const o of r.enrichment.option_comparison) o.win_probability = o.option_id === SQ ? 0.9 : 0.1;
          });
          const bad = mutate(side === 'a' ? a : b, (r) => {
            const leader = r.leading_option_id;
            for (const o of r.enrichment.option_comparison) {
              const p = shares[o.option_id === leader ? 0 : 1];
              if (p === null) delete o.win_probability; else o.win_probability = p;
            }
          });
          const out = raw(side === 'a' ? bad : a, side === 'b' ? bad : b, {}, reachable);
          if (!out.ok) throw new Error(out.reason);
          expect(identities(out.claims)).toEqual(EXPECTED);
          expect(claim(out.claims, 'leader')?.verdict).toBe('delta_only');
          expect(claim(out.claims, 'leader')?.invariant_by_construction).toBe(false);
          for (const c of out.claims) expect(StructuralChallengeClaimV1Schema.parse(c)).toEqual(c);
        }
      }
    }
    expect(leadNoise(0.1, 0.9, 10000)).toBe('not_noise_qualified');
  });

  it.each(['a', 'b'] as const)('1: a third competitor blocks a changed-leader verdict on %s', (side) => {
    const a = mutate(fact(A_BODY, 'a'), (r) => {
      r.input_snapshot.options.push({ option_id: 'third', settings: [] });
      r.enrichment.option_comparison.push({ ...clone(r.enrichment.option_comparison[0]), option_id: 'third' });
      for (const o of r.enrichment.option_comparison) o.win_probability = o.option_id === P59 ? 0.8 : 0.1;
    });
    const b = mutate(fact(B_BODY, 'b'), (r) => {
      r.leading_option_id = SQ;
      r.input_snapshot.options.push({ option_id: 'third', settings: [] });
      r.enrichment.option_comparison.push({ ...clone(r.enrichment.option_comparison[0]), option_id: 'third' });
      for (const o of r.enrichment.option_comparison) o.win_probability = o.option_id === SQ ? 0.8 : 0.1;
    });
    const bad = mutate(side === 'a' ? a : b, (r) => {
      for (const o of r.enrichment.option_comparison) o.win_probability = o.option_id === 'third' ? 0.7 : o.option_id === r.leading_option_id ? 0.2 : 0.1;
    });
    const out = raw(side === 'a' ? bad : a, side === 'b' ? bad : b);
    if (!out.ok) throw new Error(out.reason);
    expect(identities(out.claims)).toEqual([...EXPECTED, ...['goal_probability', 'outcome_level', 'constraint_probability'].map((kind) => JSON.stringify([kind, 'third', kind === 'constraint_probability' ? 'agent-lane:monthly_churn:<=' : null]))].sort());
    expect(claim(out.claims, 'leader')).toMatchObject({ verdict: 'delta_only', noise_verdict: 'not_noise_qualified' });
    for (const c of out.claims) expect(StructuralChallengeClaimV1Schema.parse(c)).toEqual(c);
  });

  it.each(['a', 'b'] as const)('5: missing current shares never select stale quantities on %s, in every supported carrier', (side) => {
    for (const carrier of ['current', 'nested', 'legacy', 'nested_options', 'nested_option_results', 'brief']) {
      let a = fact(A_BODY, 'a'); let b = fact(B_BODY, 'b');
      const modified = mutate(side === 'a' ? a : b, (r) => {
        const current = r.enrichment.option_comparison;
        for (const o of current) delete o.win_probability;
        const stale = clone(current);
        for (const o of stale) { o.win_probability = o.option_id === P59 ? 1 : 0; o.probability_of_goal = 0.25; o.outcome.mean = 5; o.constraint_probabilities['agent-lane:monthly_churn:<='] = 0.1; }
        if (carrier === 'current') r.enrichment.results = stale;
        else {
          delete r.enrichment.option_comparison;
          if (carrier === 'nested') r.enrichment.results = { option_comparison: current, options: stale };
          if (carrier === 'legacy') r.enrichment.results = current;
          if (carrier === 'nested_options') r.enrichment.results = { options: current };
          if (carrier === 'nested_option_results') r.enrichment.results = { option_results: current };
          if (carrier === 'brief') { delete r.enrichment.results; r.enrichment.decision_brief = { options: current }; }
        }
      });
      if (side === 'a') a = modified; else b = modified;
      const { claims } = compare(b, ALL, a);
      expect(claim(claims, 'leader')).toMatchObject({ verdict: 'delta_only', noise_verdict: 'not_noise_qualified' });
      const key = side === 'a' ? 'baseline' : 'alternative';
      expect(claim(claims, 'goal_probability', P59)).toMatchObject({ [key]: side === 'a' ? 1 : 0.5291 });
      expect(claim(claims, 'outcome_level', P59)).toMatchObject({ [key]: side === 'a' ? A_BODY.option_comparison[0].outcome.mean : B_BODY.option_comparison[0].outcome.mean });
      expect(claim(claims, 'constraint_probability', P59, 'agent-lane:monthly_churn:<=')).toMatchObject({ [key]: side === 'a' ? A_BODY.option_comparison[0].constraint_probabilities['agent-lane:monthly_churn:<='] : B_BODY.option_comparison[0].constraint_probabilities['agent-lane:monthly_churn:<='] });
    }
  });

  it.each(['a', 'b'] as const)('6: duplicate option identities and conflicting node bindings are rejected on %s', (side) => {
    for (const duplicate of ['option', 'constraint']) {
      const a = fact(A_BODY, 'a'); const b = fact(B_BODY, 'b');
      const bad = mutate(side === 'a' ? a : b, (r) => {
        if (duplicate === 'option') r.enrichment.option_comparison.push({ ...clone(r.enrichment.option_comparison[0]), probability_of_goal: 0.1 });
        else r.enrichment.constraint_results.push({ ...r.enrichment.constraint_results[0], node_id: 'different_node' });
      });
      expect(raw(side === 'a' ? bad : a, side === 'b' ? bad : b)).toEqual({ ok: false, reason: side === 'a' ? 'baseline_unreadable' : 'candidate_unparseable' });
    }
  });

  it('6: binding conflict between the Runs is rejected', () => {
    const b = mutate(fact(B_BODY, 'b'), (r) => { r.enrichment.constraint_results[0].node_id = 'different_node'; });
    expect(raw(fact(A_BODY, 'a'), b)).toEqual({ ok: false, reason: 'candidate_unparseable' });
  });

  it.each(['option', 'constraint', 'binding'] as const)('6: missing alternative %s retains every baseline identity with an incomparable null side', (missing) => {
    const b = mutate(fact(B_BODY, 'b'), (r) => {
      if (missing === 'option') r.enrichment.option_comparison = r.enrichment.option_comparison.filter((o: any) => o.option_id !== SQ);
      if (missing === 'constraint') for (const o of r.enrichment.option_comparison) delete o.constraint_probabilities['agent-lane:monthly_churn:<='];
      if (missing === 'binding') r.enrichment.constraint_results = [];
    });
    const { claims } = compare(b, new Set(['unrelated']));
    const absent = missing === 'option' ? claims.filter((c) => c.kind !== 'leader' && c.option_id === SQ) : claims.filter((c) => c.kind === 'constraint_probability');
    expect(identities(absent)).toEqual(EXPECTED.filter((id) => missing === 'option' ? id.includes(SQ) : id.includes('constraint_probability')));
    for (const c of absent) expect(c).toMatchObject({ alternative: null, verdict: 'not_comparable', basis: 'missing_on_one_side', invariant_by_construction: false });
  });

  it.each(['a', 'b'] as const)('6: an unavailable recorded constraint measurement on %s never drops its identity', (side) => {
    for (const value of [null, 'unavailable', Number.NaN]) {
      const a = fact(A_BODY, 'a'); const b = fact(B_BODY, 'b');
      const bad = mutate(side === 'a' ? a : b, (r) => {
        r.enrichment.option_comparison.find((o: any) => o.option_id === P59).constraint_probabilities['agent-lane:monthly_churn:<='] = value;
      });
      const { claims } = compare(side === 'b' ? bad : b, new Set(['unrelated']), side === 'a' ? bad : a);
      expect(claim(claims, 'constraint_probability', P59, 'agent-lane:monthly_churn:<=')).toMatchObject({
        [side === 'a' ? 'baseline' : 'alternative']: null, verdict: 'not_comparable', basis: 'missing_on_one_side', invariant_by_construction: false,
      });
    }
  });

  it.each([null, undefined] as const)('9: absent baseline leader %j suppresses the compared identity under a true licence', (id) => {
    const a = mutate(fact(A_BODY, 'a'), (r) => { r.leading_option_id = id; });
    expect(claim(compare(fact(B_BODY, 'b'), ALL, a).claims, 'leader')).toMatchObject({ baseline_option_id: null, alternative_option_id: null, verdict: 'not_comparable', basis: 'withheld_on_one_side' });
  });

  it('9: baseline withholding suppresses the alternative identity', () => {
    const a = runFact(A_BODY, A_GRAPH, 'hash-a', { mayNameLeader: false });
    expect(claim(compare(fact(B_BODY, 'b'), ALL, a).claims, 'leader')).toMatchObject({ baseline_option_id: null, alternative_option_id: null, verdict: 'not_comparable' });
  });

  // A genuinely testable target, with the same goal/unit/frame attested by both Runs' existing input snapshots.
  const licensedGraph = () => ({ nodes: [
    { id: GOAL, kind: 'goal', label: 'MRR', goal_threshold_raw: TARGET, goal_threshold: 0.8, goal_threshold_unit: 'GBP/month', goal_threshold_frame: 'level', goal_direction: '>=', observed_state: { baseline: 75000, unit: 'GBP/month' } },
    { id: 'f', kind: 'factor' }, { id: P59, kind: 'option' }, { id: SQ, kind: 'option' },
  ], edges: [{ from: P59, to: 'f' }, { from: SQ, to: 'f' }, { from: 'f', to: GOAL, provenance: { natural_effect: { amount: 1, amount_unit: 'GBP/month' } } }] });
  const withSnapshot = (f: HandlerFact) => mutate(f, (r) => { r.input_snapshot = {
    snapshot_version: 1, sent_digest: 'd'.repeat(64), goal: { node_id: GOAL, target_raw: TARGET, frame: 'level', unit: 'GBP/month' },
    options: [P59, SQ].map((option_id) => ({ option_id, settings: [] })), options_not_sent: [], factors: [],
    constraints: [{ constraint_id: 'agent-lane:monthly_churn:<=', node_id: 'monthly_churn', operator: '<=', raw: 5 }], links: [],
  }; });

  it.each(['a', 'b'] as const)('6: a recorded goal identity on %s cannot be relabelled by the comparison', (side) => {
    const a = withSnapshot(fact(A_BODY, 'a')); const b = withSnapshot(fact(B_BODY, 'b'));
    const bad = mutate(side === 'a' ? a : b, (r) => { r.input_snapshot.goal.node_id = 'different_goal'; });
    expect(raw(side === 'a' ? bad : a, side === 'b' ? bad : b)).toEqual({ ok: false, reason: side === 'a' ? 'baseline_unreadable' : 'candidate_unparseable' });
  });

  it('1: the submitted roster prevents a lead when both responses omit the same third competitor', () => {
    const addThird = (f: HandlerFact) => mutate(withSnapshot(f), (r) => {
      r.input_snapshot.options = [P59, SQ, 'third'].map((option_id) => ({ option_id, settings: [] }));
    });
    const out = raw(addThird(fact(A_BODY, 'a')), addThird(fact(B_BODY, 'b')));
    if (!out.ok) throw new Error(out.reason);
    expect(identities(out.claims)).toEqual([...EXPECTED, JSON.stringify(['goal_probability', 'third', null]), JSON.stringify(['outcome_level', 'third', null]), JSON.stringify(['constraint_probability', 'third', 'agent-lane:monthly_churn:<='])].sort());
    expect(claim(out.claims, 'leader')).toMatchObject({ verdict: 'delta_only', noise_verdict: 'not_noise_qualified' });
    for (const kind of ['goal_probability', 'outcome_level'] as const) expect(claim(out.claims, kind, 'third')).toMatchObject({ baseline: null, alternative: null, verdict: 'not_comparable', basis: 'missing_on_one_side' });
    for (const c of out.claims) expect(StructuralChallengeClaimV1Schema.parse(c)).toEqual(c);
  });

  it.each(['a', 'b'] as const)('5: an explicitly empty current carrier on %s never restores stale legacy quantities', (side) => {
    const a = withSnapshot(fact(A_BODY, 'a')); const b = withSnapshot(fact(B_BODY, 'b'));
    for (const f of [a, b]) (f as any).result.input_snapshot.options = [P59, SQ].map((option_id) => ({ option_id, settings: [] }));
    const bad = mutate(side === 'a' ? a : b, (r) => { r.enrichment.results = clone(r.enrichment.option_comparison); r.enrichment.option_comparison = []; });
    const out = raw(side === 'a' ? bad : a, side === 'b' ? bad : b);
    if (!out.ok) throw new Error(out.reason);
    const expected = EXPECTED;
    expect(identities(out.claims)).toEqual(expected);
    for (const c of out.claims) if (c.kind !== 'leader') expect(c).toMatchObject({ [side === 'a' ? 'baseline' : 'alternative']: null, verdict: 'not_comparable' });
    for (const c of out.claims) expect(StructuralChallengeClaimV1Schema.parse(c)).toEqual(c);
  });

  it.each(['frame', 'unit'] as const)('2/6: recorded %s changes make goal and outcome claims incomparable', (field) => {
    const a = withSnapshot(fact(A_BODY, 'a'));
    const b = mutate(withSnapshot(fact(B_BODY, 'b')), (r) => { r.input_snapshot.goal[field] = field === 'frame' ? 'change_rel' : 'USD/month'; });
    const out = raw(a, b);
    if (!out.ok) throw new Error(out.reason);
    expect(identities(out.claims)).toEqual(EXPECTED);
    for (const c of out.claims.filter((c) => c.kind !== 'constraint_probability')) expect(c).toMatchObject({ verdict: 'not_comparable', basis: field === 'frame' ? 'frame_changed' : 'unit_changed' });
    for (const c of out.claims) expect(StructuralChallengeClaimV1Schema.parse(c)).toEqual(c);
  });

  it('2: positive target verdict requires both typed testability and both recorded unit licences', () => {
    const graph = licensedGraph();
    expect(targetTestabilityOf(graph)).toEqual({ kind: 'testable', goal_id: GOAL });
    const out = raw(withSnapshot(fact(A_BODY, 'a')), withSnapshot(fact(B_BODY, 'b')), { baselineGraph: graph, candidateGraph: graph });
    if (!out.ok) throw new Error(out.reason);
    expect(identities(out.claims)).toEqual(EXPECTED);
    expect(claim(out.claims, 'outcome_level', P59)).toMatchObject({ target: TARGET, verdict: 'changes', basis: 'target_crossed' });
    for (const c of out.claims) expect(StructuralChallengeClaimV1Schema.parse(c)).toEqual(c);
  });

  it.each(['a', 'b'] as const)('2: target withholding, change frames, missing/unbound units and unchecked targets on %s never earn a target verdict', (side) => {
    for (const negative of ['withheld', 'change_abs', 'change_rel', 'unit_changed', 'unit_absent', 'snapshot_missing', 'target_changed', 'baseline_missing', 'unchecked']) {
      const ga: any = licensedGraph(); const gb: any = licensedGraph();
      let a = withSnapshot(fact(A_BODY, 'a')); let b = withSnapshot(fact(B_BODY, 'b'));
      const g = side === 'a' ? ga : gb;
      const bad = mutate(side === 'a' ? a : b, (r) => {
        if (negative === 'withheld') r.enrichment.inference_warnings.push({ code: 'GOAL_FIGURES_TARGET_NOT_TESTABLE' });
        if (negative === 'change_abs' || negative === 'change_rel') g.nodes[0].goal_threshold_frame = negative;
        if (negative === 'unit_changed') r.input_snapshot.goal.unit = 'USD/month';
        if (negative === 'unit_absent') delete r.input_snapshot.goal.unit;
        if (negative === 'snapshot_missing') delete r.input_snapshot;
        if (negative === 'target_changed') r.input_snapshot.goal.target_raw = TARGET + 1;
        if (negative === 'baseline_missing') delete g.nodes[0].observed_state.baseline;
        if (negative === 'unchecked') g.nodes[0].nonlinear_identity = { operation: 'sum', factor_ids: ['f'], stated_in_brief: true };
      });
      if (side === 'a') a = bad; else b = bad;
      const out = raw(a, b, { baselineGraph: ga, candidateGraph: gb });
      if (negative === 'snapshot_missing') {
        expect(out).toEqual({ ok: false, reason: side === 'a' ? 'baseline_unreadable' : 'candidate_unparseable' });
        continue;
      }
      if (!out.ok) throw new Error(out.reason);
      expect(identities(out.claims)).toEqual(EXPECTED);
      for (const id of [P59, SQ]) expect(claim(out.claims, 'outcome_level', id)).toMatchObject({ target: null, verdict: negative === 'unit_changed' || negative === 'unit_absent' ? 'not_comparable' : 'delta_only' });
      for (const c of out.claims) expect(StructuralChallengeClaimV1Schema.parse(c)).toEqual(c);
    }
  });
});


describe('review closure: snapshot-bound identity and measurement entitlement on BOTH Runs', () => {
  const LIMIT = 'agent-lane:monthly_churn:<=';
  const carriers = ['current', 'nested_current', 'legacy', 'nested_options', 'nested_option_results', 'brief'] as const;
  const raw = (a: HandlerFact, b: HandlerFact) => compareStructuralChallenge({ baselineFact: a, candidateFact: b,
    turnMayNameLeader: true, reachable: ALL, goalNodeId: GOAL, goalLevelTarget: TARGET });
  const pair = () => [runFact(A_BODY, A_GRAPH, 'hash-a'), runFact(B_BODY, B_GRAPH, 'hash-b')];
  const result = (fact: HandlerFact) => (fact as any).result;
  const move = (r: any, carrier: typeof carriers[number]) => {
    const rows = r.enrichment.option_comparison;
    delete r.enrichment.option_comparison;
    delete r.enrichment.results;
    delete r.enrichment.decision_brief;
    if (carrier === 'current') r.enrichment.option_comparison = rows;
    if (carrier === 'nested_current') r.enrichment.results = { option_comparison: rows };
    if (carrier === 'legacy') r.enrichment.results = rows;
    if (carrier === 'nested_options') r.enrichment.results = { options: rows };
    if (carrier === 'nested_option_results') r.enrichment.results = { option_results: rows };
    if (carrier === 'brief') r.enrichment.decision_brief = { options: rows };
    return rows;
  };
  for (const side of [0, 1] as const) {
    it.each(carriers)(`P1-2 / prior #6: rejects ghost, excluded and unsubmitted constraint identities on Run ${side}, %s`, (carrier) => {
      for (const negative of ['ghost', 'excluded', 'unsubmitted_constraint', 'missing_option_id', 'missing_snapshot', 'overlapping_roster']) {
        const [a, b] = pair();
        const r = result(side === 0 ? a : b);
        const rows = move(r, carrier);
        if (negative === 'ghost') rows.push({ ...structuredClone(rows[0]), option_id: 'ghost' });
        if (negative === 'excluded') {
          r.input_snapshot.options = r.input_snapshot.options.filter((o: any) => o.option_id !== SQ);
          r.input_snapshot.options_not_sent = [{ option_id: SQ, reason: 'removed' }];
        }
        if (negative === 'overlapping_roster') r.input_snapshot.options_not_sent = [{ option_id: P59, reason: 'infeasible' }];
        if (negative === 'unsubmitted_constraint') rows[0].constraint_probabilities['unsubmitted'] = 1;
        if (negative === 'missing_option_id') delete rows[0].option_id;
        if (negative === 'missing_snapshot') delete r.input_snapshot;
        expect(raw(a, b)).toEqual({ ok: false, reason: side === 0 ? 'baseline_unreadable' : 'candidate_unparseable' });
      }
    });
    it.each(carriers)(`P1-3: noncomputed or invalid-draw measurements are null on Run ${side}, %s`, (carrier) => {
      for (const negative of ['skipped', 'error', 'unknown', null, 0, -1, '0', Number.NaN, 0.5]) {
        const [a, b] = pair();
        const r = result(side === 0 ? a : b);
        const rows = move(r, carrier);
        if (typeof negative === 'string' && negative !== '0') rows[0].status = negative;
        else rows[0].outcome.n_valid_samples = negative;
        const out = raw(a, b);
        if (!out.ok) throw new Error(out.reason);
        expect(out.claims.filter((c) => c.kind !== 'leader' && c.option_id === P59)).toHaveLength(3);
        for (const c of out.claims.filter((c) => c.kind !== 'leader' && c.option_id === P59)) {
          expect(c).toMatchObject({ [side === 0 ? 'baseline' : 'alternative']: null, verdict: 'not_comparable', noise_verdict: 'not_noise_qualified' });
          expect(StructuralChallengeClaimV1Schema.parse(c)).toEqual(c);
        }
        expect(claim(out.claims, 'leader')?.verdict).not.toBe('holds');
        expect(claim(out.claims, 'leader')?.verdict).not.toBe('changes');
      }
    });
    it.each(carriers)(`P1-3: uncertified constraint scale is never narrated as a measurement on Run ${side}, %s`, (carrier) => {
      for (const negative of ['absent', 'false', 'malformed', 'missing_row', 'wrong_identity', 'conflicting_duplicate', 'block_skipped']) {
        const [a, b] = pair();
        const r = result(side === 0 ? a : b);
        move(r, carrier);
        const row = r.enrichment.constraint_results[0];
        if (negative === 'absent') delete row.scale_provenance;
        if (negative === 'false') row.scale_provenance.decision_grade = false;
        if (negative === 'malformed') row.scale_provenance = { decision_grade: true };
        if (negative === 'missing_row') r.enrichment.constraint_results = [];
        if (negative === 'wrong_identity') row.constraint_id = 'unsubmitted';
        if (negative === 'conflicting_duplicate') r.enrichment.constraint_results.push({ ...row, scale_provenance: { ...row.scale_provenance, decision_grade: false } });
        if (negative === 'block_skipped') r.enrichment.constraints_status = 'skipped';
        const out = raw(a, b);
        if (negative === 'wrong_identity') {
          expect(out).toEqual({ ok: false, reason: side === 0 ? 'baseline_unreadable' : 'candidate_unparseable' });
          continue;
        }
        if (!out.ok) throw new Error(out.reason);
        expect(claim(out.claims, 'constraint_probability', P59, LIMIT)).toMatchObject({
          [side === 0 ? 'baseline' : 'alternative']: null, verdict: 'not_comparable', noise_verdict: 'not_noise_qualified',
        });
        for (const c of out.claims) expect(StructuralChallengeClaimV1Schema.parse(c)).toEqual(c);
        const outcome = claim(out.claims, 'outcome_level', P59);
        if (outcome?.kind !== 'outcome_level') throw new Error('missing outcome claim');
        expect(outcome[side === 0 ? 'baseline' : 'alternative']).not.toBeNull();
      }
    });
    it(`P1-2: an unused lower-precedence ghost carrier and unsubmitted leader are rejected on Run ${side}`, () => {
      for (const negative of ['secondary_ghost', 'withheld_secondary_ghost', 'leader', 'top_constraint']) {
        const [a, b] = pair(); const r = result(side === 0 ? a : b);
        if (negative.includes('secondary')) r.enrichment.decision_brief = { options: [{ option_id: 'ghost' }] };
        if (negative === 'withheld_secondary_ghost') r.enrichment.inference_warnings.push({ code: 'GOAL_FIGURES_TARGET_NOT_TESTABLE' });
        if (negative === 'leader') r.leading_option_id = 'ghost';
        if (negative === 'top_constraint') r.enrichment.constraint_results.push({ constraint_id: 'ghost', node_id: 'monthly_churn' });
        expect(raw(a, b)).toEqual({ ok: false, reason: side === 0 ? 'baseline_unreadable' : 'candidate_unparseable' });
      }
    });
  }
});


describe('valid draws, rather than the overall requested sample budget, qualify measurements', () => {
  it.each(['baseline', 'alternative'] as const)('P1-3: one valid draw on %s cannot borrow a 10,000-draw budget to earn a changed conclusion', (side) => {
    const a = runFact(A_BODY, A_GRAPH, 'hash-a'); const b = runFact(B_BODY, B_GRAPH, 'hash-b');
    const selected = ((side === 'baseline' ? a : b) as any).result;
    for (const row of selected.enrichment.option_comparison) {
      row.outcome.n_valid_samples = 1;
      if (row.option_id === P59) row.probability_of_goal = 0.999;
    }
    const out = compareStructuralChallenge({ baselineFact: a, candidateFact: b, turnMayNameLeader: true,
      reachable: ALL, goalNodeId: GOAL, goalLevelTarget: TARGET });
    if (!out.ok) throw new Error(out.reason);
    expect(out.claims.some((c) => c.verdict === 'changes')).toBe(false);
    expect(claim(out.claims, 'leader')).toMatchObject({ verdict: 'delta_only', noise_verdict: 'within_noise' });
    for (const c of out.claims) expect(StructuralChallengeClaimV1Schema.parse(c)).toEqual(c);
  });
});
