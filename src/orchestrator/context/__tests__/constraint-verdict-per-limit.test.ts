/**
 * B5: ONE TYPED VERDICT PER LIMIT (`constraint_verdict.per_limit` + `joint`, @talchain/schemas 0.60.0).
 *
 * THE DEFECT. Paul's 17d1 churn limit ("≤ 4 %") was reported met with certainty: P = 1 for every option and
 * decision-grade. MG's EXECUTED replay (#70 5856264807) showed ISL compared 0.04 against Olumi's own 3 % ESTIMATE as
 * if it had been measured. Nothing in the stored verdict said whose figure the limit was checked against.
 *
 * THE MEANING (AI Quality 5855511541 and 5856308029):
 *   · `scored`: P exists and every precondition held, including (e) the baseline is the user's. No `reason`.
 *   · `estimate_only`: (a)–(d) held, but the baseline is not the user's (`baseline_is_estimate`).
 *   · `unscored`: no P, and `reason` names the first failed precondition.
 *   · `joint`: `scored` iff every limit is scored; `estimate_only` iff none is unscored and one is estimate_only;
 *     otherwise `withheld` with `limit_unscored` and the ids. One unscoreable limit never silences another.
 *
 * Every row binds by `constraint_id`. The envelopes are served or EXECUTED bytes
 * (`tests/fixtures/cross-service/b5-per-limit/README.md`); every derived variant is labelled where it is made.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { ConstraintVerdictSchema } from '@talchain/schemas/orchestrator';

import {
  collectLeaderEstimatedTargetIds,
  collectUserBaselineConstraintIds,
  deriveConstraintVerdict,
  projectClaimSafety,
  readRatifiedConstraints,
  type RatifiedConstraint,
} from '../constraint-feasibility.js';
import { applyIntakeToLeaderPermission } from '../intake-option-reconciliation.js';

type Json = Record<string, any>;
// 0.60.0 does not export the two member schemas from `/orchestrator`; they are read off the published verdict's shape.
const ConstraintPerLimitVerdictSchema = ConstraintVerdictSchema.shape.per_limit.unwrap().element;
const ConstraintJointVerdictSchema = ConstraintVerdictSchema.shape.joint.unwrap();
const DIR = 'tests/fixtures/cross-service/b5-per-limit';
const load = (name: string): Json => JSON.parse(readFileSync(`${DIR}/${name}`, 'utf8')) as Json;
const c50 = (name: string): Json =>
  JSON.parse(readFileSync(`tests/fixtures/cross-service/c50-level-demo/${name}.plot-response.json`, 'utf8')) as Json;

const CHURN = 'agent-lane:monthly_churn:<=';
const SPEND = 'agent-lane:six_month_decision_spend:<=';

/** The leader the handler would pass: the highest win share in the served option list. */
const leaderOf = (options: Json[]): string =>
  [...options].sort((a, b) => b.win_probability - a.win_probability)[0]!.option_id as string;
const nodeOf = (graph: Json, id: string): Json => (graph.nodes as Json[]).find((n) => n.id === id)!;

/** Every argument the ONE call site in run_analysis passes, derived the way it derives them. */
function verdictFor(envelope: Json, graph: Json, leader: string) {
  const ratified = readRatifiedConstraints(graph);
  const leaderEstimated = collectLeaderEstimatedTargetIds(graph, ratified, leader);
  return deriveConstraintVerdict(envelope, ratified, leader, undefined, leaderEstimated, {
    userBaselineIds: collectUserBaselineConstraintIds(graph, ratified),
  });
}
const rowOf = (v: ReturnType<typeof deriveConstraintVerdict>, id: string) => v.perLimit?.find((r) => r.constraint_id === id);

/** Schema 0.60.0 accepts every row and the joint, and the persisted projection parses as the stored contract field. */
function expectContractValid(v: ReturnType<typeof deriveConstraintVerdict>) {
  expect(v.perLimit).toBeDefined();
  for (const row of v.perLimit!) {
    expect(ConstraintPerLimitVerdictSchema.safeParse(row).success).toBe(true);
    if (row.state === 'scored') expect(Object.prototype.hasOwnProperty.call(row, 'reason')).toBe(false);
    else expect(typeof row.reason).toBe('string');
    expect(Object.keys(row)).not.toContain('frame_checked');
  }
  expect(ConstraintJointVerdictSchema.safeParse(v.joint).success).toBe(true);
  const persisted = projectClaimSafety(v);
  expect(ConstraintVerdictSchema.safeParse(persisted).success).toBe(true);
  expect(persisted.per_limit).toEqual(v.perLimit);
  expect(persisted.joint).toEqual(v.joint);
}

// ── Fixture preconditions: each row below relies on a fact of the served bytes, so assert it first. ────────────────
describe('preconditions (bound by identity to the served bytes)', () => {
  it('17d1: churn is Olumi\'s 3 %, and PLoT certified P = 1 for every option', () => {
    const { graph } = load('17d1cd3a.graph.json');
    const env = load('17d1cd3a.plot-response.json');
    expect(graph.goal_constraints.map((c: Json) => c.constraint_id)).toEqual([CHURN]);
    expect(nodeOf(graph, 'monthly_churn').observed_state.source).toBe('cee_inference');
    expect(env.constraints_status).toBe('computed');
    expect(env.constraint_results.map((r: Json) => [r.constraint_id, r.scale_provenance.decision_grade])).toEqual([[CHURN, true]]);
    expect(env.option_comparison.map((o: Json) => o.constraint_probabilities[CHURN])).toEqual([1, 1, 1]);
    expect(env.option_comparison.every((o: Json) => o.constraints_decision_grade === true)).toBe(true);
  });
  it('a6ed1bff (before A3): the block is withheld under CONSTRAINT_TARGET_UNRELIABLE, churn is cee_inference', () => {
    const { graph } = load('a6ed1bff.graph.json');
    const env = load('a6ed1bff.plot-response.json');
    expect(graph.goal_constraints.map((c: Json) => c.constraint_id)).toEqual([CHURN]);
    expect(nodeOf(graph, 'monthly_churn').observed_state.source).toBe('cee_inference');
    expect(env.constraints_status).toBe('unavailable');
    expect(env.inference_warnings.map((w: Json) => w.code)).toContain('CONSTRAINT_TARGET_UNRELIABLE');
    expect(env.option_comparison.every((o: Json) => o.constraint_probabilities === undefined)).toBe(true);
  });
  it('0e19bb82: spend is NOT_CONVERTIBLE by name; churn is the user\'s assumption; no option carries a P', () => {
    const { graph, enrichment } = load('0e19bb82.served-turn.json');
    expect(graph.goal_constraints.map((c: Json) => c.constraint_id)).toEqual([SPEND, CHURN]);
    expect(nodeOf(graph, 'monthly_churn').observed_state.source).toBe('user_assumption');
    expect(nodeOf(graph, 'six_month_decision_spend').observed_state).toBeUndefined();
    const nc = (enrichment.inference_warnings as Json[]).find((w) => w.code === 'CONSTRAINT_NOT_CONVERTIBLE')!;
    expect(nc.field).toBe('nodes[six_month_decision_spend].observed_state.baseline');
    expect(enrichment.option_comparison.every((o: Json) => o.constraint_probabilities === undefined)).toBe(true);
  });
});

// ── B5-1 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('B5-1: 17d1 churn ≤ 4 % is estimate_only (Olumi\'s 3 %), never scored', () => {
  const { graph } = load('17d1cd3a.graph.json');
  const env = load('17d1cd3a.plot-response.json');
  const leader = leaderOf(env.option_comparison);

  it('per_limit churn = estimate_only / baseline_is_estimate; the joint is not scored', () => {
    const v = verdictFor(env, graph, leader);
    expect(v.perLimit).toEqual([{ constraint_id: CHURN, state: 'estimate_only', reason: 'baseline_is_estimate' }]);
    expect(v.joint).toEqual({ state: 'estimate_only' });
    expect(v.joint?.state).not.toBe('scored');
    expectContractValid(v);
  });
  it('the baseline reader names churn as NOT the user\'s figure', () => {
    expect(collectUserBaselineConstraintIds(graph, readRatifiedConstraints(graph)).has(CHURN)).toBe(false);
  });
  it('the leader permission and state are unchanged: B5 adds rows, it moves no withholding', () => {
    const ratified = readRatifiedConstraints(graph);
    const before = deriveConstraintVerdict(env, ratified, leader, undefined, collectLeaderEstimatedTargetIds(graph, ratified, leader));
    const { perLimit, joint, ...rest } = verdictFor(env, graph, leader);
    expect(perLimit).toBeDefined();
    expect(joint).toBeDefined();
    expect(rest).toEqual(before);
  });
});

// ── B5-2 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('B5-2: a6ed1bff churn ≤ 4 %', () => {
  const { graph } = load('a6ed1bff.graph.json');
  const served = load('a6ed1bff.plot-response.json');
  const leader = leaderOf(served.option_comparison);

  it('SERVED, before A3: unscored with PLoT\'s own code; the joint is withheld naming churn', () => {
    const v = verdictFor(served, graph, leader);
    expect(v.perLimit).toEqual([{ constraint_id: CHURN, state: 'unscored', reason: 'CONSTRAINT_TARGET_UNRELIABLE' }]);
    expect(v.joint).toEqual({ state: 'withheld', withheld_reason: 'limit_unscored', constraint_ids: [CHURN] });
    expectContractValid(v);
  });
  it('AFTER A3 (DERIVED: the served body with the block computed and a certified churn row): estimate_only', () => {
    const env = structuredClone(served);
    env.constraints_status = 'computed';
    env.inference_warnings = (env.inference_warnings as Json[]).filter((w) => w.code !== 'CONSTRAINT_TARGET_UNRELIABLE');
    env.constraint_results = [
      { constraint_id: CHURN, node_id: 'monthly_churn', operator: '<=', value: 0.04, probability: 1,
        scale_provenance: { source: 'unit_percent', range_unified: true, decision_grade: true } },
    ];
    for (const o of env.option_comparison as Json[]) o.constraint_probabilities = { [CHURN]: 1 };
    const v = verdictFor(env, graph, leader);
    expect(v.perLimit).toEqual([{ constraint_id: CHURN, state: 'estimate_only', reason: 'baseline_is_estimate' }]);
    expect(v.joint).toEqual({ state: 'estimate_only' });
    expectContractValid(v);
  });
});

// ── B5-3 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('B5-3: 0e19bb82, the spend limit refused', () => {
  const { graph, enrichment } = load('0e19bb82.served-turn.json');
  const leader = leaderOf(enrichment.option_comparison);

  /** DERIVED: the served turn as a PER-LIMIT wire would carry it: churn scored per option under a certified row,
   *  spend still refused by ISL by name, and no block-level withholding code. */
  function perLimitWire(): Json {
    const env = structuredClone(enrichment);
    env.constraints_status = 'computed';
    env.inference_warnings = (env.inference_warnings as Json[]).filter((w) => w.code !== 'CONSTRAINT_TARGET_UNRELIABLE');
    env.constraint_results = [
      { constraint_id: CHURN, node_id: 'monthly_churn', operator: '<=', value: 0.04, probability: 0.9,
        scale_provenance: { source: 'unit_percent', range_unified: true, decision_grade: true } },
    ];
    for (const o of env.option_comparison as Json[]) o.constraint_probabilities = { [CHURN]: 0.9 };
    return env;
  }
  /** DERIVED control: the same graph with churn's level stated by the user. */
  function userChurnGraph(): Json {
    const g = structuredClone(graph);
    nodeOf(g, 'monthly_churn').observed_state.source = 'user';
    return g;
  }

  it('churn keeps its own verdict while spend is unscored; the joint is withheld over spend (limit_unscored)', () => {
    const v = verdictFor(perLimitWire(), graph, leader);
    expect(rowOf(v, SPEND)).toEqual({ constraint_id: SPEND, state: 'unscored', reason: 'CONSTRAINT_NOT_CONVERTIBLE' });
    // churn's level is `user_assumption`: the user's admitted guess, which earns no authorship credit.
    expect(rowOf(v, CHURN)).toEqual({ constraint_id: CHURN, state: 'estimate_only', reason: 'baseline_is_estimate' });
    expect(v.joint).toEqual({ state: 'withheld', withheld_reason: 'limit_unscored', constraint_ids: [SPEND] });
    expectContractValid(v);
  });
  it('an identity-less CONSTRAINT_TARGET_UNRELIABLE (as PLoT emits it today) does not silence the certified churn row', () => {
    const env = perLimitWire();
    const served = (enrichment.inference_warnings as Json[]).find((w) => w.code === 'CONSTRAINT_TARGET_UNRELIABLE')!;
    expect(Object.keys(served).sort()).toEqual(['code', 'message', 'severity']);
    (env.inference_warnings as Json[]).unshift(structuredClone(served));
    const v = verdictFor(env, userChurnGraph(), leader);
    expect(rowOf(v, CHURN)).toEqual({ constraint_id: CHURN, state: 'scored' });
    expect(rowOf(v, SPEND)).toEqual({ constraint_id: SPEND, state: 'unscored', reason: 'CONSTRAINT_NOT_CONVERTIBLE' });
    expect(v.joint).toEqual({ state: 'withheld', withheld_reason: 'limit_unscored', constraint_ids: [SPEND] });
  });
  it('control: with churn stated by the user, churn is SCORED per option and the joint is still withheld', () => {
    const v = verdictFor(perLimitWire(), userChurnGraph(), leader);
    expect(rowOf(v, CHURN)).toEqual({ constraint_id: CHURN, state: 'scored' });
    expect(rowOf(v, SPEND)?.state).toBe('unscored');
    expect(v.joint).toEqual({ state: 'withheld', withheld_reason: 'limit_unscored', constraint_ids: [SPEND] });
    expectContractValid(v);
  });
  it('SERVED (the engine withheld every P): spend by its own code, churn by the block, never a P-less "scored"', () => {
    const v = verdictFor(enrichment, graph, leader);
    expect(v.perLimit).toEqual([
      { constraint_id: SPEND, state: 'unscored', reason: 'CONSTRAINT_NOT_CONVERTIBLE' },
      { constraint_id: CHURN, state: 'unscored', reason: 'constraint_block_withheld' },
    ]);
    expect(v.joint).toEqual({ state: 'withheld', withheld_reason: 'limit_unscored', constraint_ids: [SPEND, CHURN] });
    expectContractValid(v);
  });
});

// ── B5-4 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('B5-4: an all-scoreable graph with user baselines is scored, and today\'s verdict is byte-identical', () => {
  const { graph } = load('17d1cd3a.graph.json');
  const env = load('17d1cd3a.plot-response.json');
  const leader = leaderOf(env.option_comparison);
  /** DERIVED control: 17d1 with churn's level stated by the user. */
  const userGraph = structuredClone(graph);
  nodeOf(userGraph, 'monthly_churn').observed_state.source = 'user';

  it('churn is scored (no reason) and the joint is scored', () => {
    const v = verdictFor(env, userGraph, leader);
    expect(v.perLimit).toEqual([{ constraint_id: CHURN, state: 'scored' }]);
    expect(v.joint).toEqual({ state: 'scored' });
    expectContractValid(v);
  });
  it('the persisted verdict without the per-limit input is byte-identical to today\'s two keys', () => {
    const ratified = readRatifiedConstraints(userGraph);
    const today = projectClaimSafety(deriveConstraintVerdict(env, ratified, leader, undefined, new Set()));
    expect(JSON.stringify(today)).toBe('{"may_name_leading_option":true,"constraint_verdict_state":"evaluated_feasible"}');
    const withRows = projectClaimSafety(verdictFor(env, userGraph, leader));
    const { per_limit, joint, ...rest } = withRows;
    expect(per_limit).toBeDefined();
    expect(joint).toBeDefined();
    expect(JSON.stringify(rest)).toBe(JSON.stringify(today));
  });
  it('a run with NO ratified limit attests nothing: no rows, no joint, the same bytes as today', () => {
    const v = deriveConstraintVerdict(env, [], leader, undefined, new Set(), { userBaselineIds: new Set() });
    expect(v.perLimit).toBeUndefined();
    expect(v.joint).toBeUndefined();
    expect(JSON.stringify(projectClaimSafety(v))).toBe(JSON.stringify(projectClaimSafety(deriveConstraintVerdict(env, [], leader))));
  });
  it('absence is never defaulted: without the baseline input no row is attested', () => {
    const v = deriveConstraintVerdict(env, readRatifiedConstraints(userGraph), leader);
    expect(v.perLimit).toBeUndefined();
    expect(v.joint).toBeUndefined();
  });
});

// ── PLoT #378: the producer names the limits itself (`constraint_ids` on a warning, `joint_withheld`) ───────────────
describe('PLoT #378 wire: a warning\'s constraint_ids and joint_withheld attribute to exactly the limits they name', () => {
  const { graph } = load('0e19bb82.served-turn.json');
  /** The fixed-pair (PLoT #378 + ISL B5) answer to CEE's served 0e19bb82 body: EXECUTED bytes, see the README. */
  const fixed = load('0e19bb82.fixed-pair.V0-served.plot-response.json');
  const leader = leaderOf(fixed.option_comparison);
  const unreliable = (env: Json): Json[] =>
    (env.inference_warnings as Json[]).filter((w) => w.code === 'CONSTRAINT_TARGET_UNRELIABLE');
  /** Every entry on either warning channel whose refusal code could name spend by its node. */
  const spendNodeRefusal = (w: Json): boolean =>
    (w.code === 'CONSTRAINT_NOT_CONVERTIBLE' || w.code === 'CONSTRAINT_OUT_OF_DOMAIN') &&
    (w.field === 'nodes[six_month_decision_spend].observed_state.baseline' ||
      (w.affected_node_ids ?? []).includes('six_month_decision_spend'));

  it('precondition: spend is named ONLY by constraint_ids on the unreliable warning, and joint_withheld names spend alone', () => {
    const [w, ...more] = unreliable(fixed);
    expect(more).toEqual([]);
    expect(Object.keys(w!).sort()).toEqual(['code', 'constraint_ids', 'message', 'severity']);
    expect(w!.constraint_ids).toEqual([SPEND]);
    expect(fixed.joint_withheld).toEqual({ reason: 'limit_unscored', constraint_ids: [SPEND] });
    expect(fixed.constraints_status).toBe('computed');
    expect(fixed.constraint_results.map((r: Json) => [r.constraint_id, r.scale_provenance.decision_grade])).toEqual([[CHURN, true]]);
    expect(fixed.option_comparison.every((o: Json) => Object.keys(o.constraint_probabilities).join() === CHURN)).toBe(true);
    // The two OTHER spend-naming refusals the derived row below removes, bound by code + node.
    const named = [...(fixed.inference_warnings as Json[]), ...(fixed.critiques as Json[])].filter(spendNodeRefusal);
    expect(named.map((w2) => w2.code)).toEqual(['CONSTRAINT_NOT_CONVERTIBLE', 'CONSTRAINT_OUT_OF_DOMAIN']);
  });

  it('SERVED fixed pair: churn keeps its own estimate_only row; spend is unscored; the joint is withheld over spend', () => {
    const v = verdictFor(fixed, graph, leader);
    expect(rowOf(v, SPEND)).toEqual({ constraint_id: SPEND, state: 'unscored', reason: 'CONSTRAINT_NOT_CONVERTIBLE' });
    expect(rowOf(v, CHURN)).toEqual({ constraint_id: CHURN, state: 'estimate_only', reason: 'baseline_is_estimate' });
    expect(v.joint).toEqual({ state: 'withheld', withheld_reason: 'limit_unscored', constraint_ids: [SPEND] });
    expectContractValid(v);
  });

  it('DERIVED (spend\'s node-named refusals removed): spend is unscored FROM THE WARNING\'S constraint_ids, not the block rule', () => {
    const env = structuredClone(fixed);
    env.inference_warnings = (env.inference_warnings as Json[]).filter((w) => !spendNodeRefusal(w));
    env.critiques = (env.critiques as Json[]).filter((w) => !spendNodeRefusal(w));
    const v = verdictFor(env, graph, leader);
    expect(rowOf(v, SPEND)).toEqual({ constraint_id: SPEND, state: 'unscored', reason: 'CONSTRAINT_TARGET_UNRELIABLE' });
    expect(rowOf(v, CHURN)).toEqual({ constraint_id: CHURN, state: 'estimate_only', reason: 'baseline_is_estimate' });
    expect(v.joint).toEqual({ state: 'withheld', withheld_reason: 'limit_unscored', constraint_ids: [SPEND] });
    expectContractValid(v);
  });

  it('DERIVED (churn\'s own marker not decision-grade): the constraint_ids:[spend] warning never marks churn', () => {
    const env = structuredClone(fixed);
    env.constraint_results[0].scale_provenance = { source: 'unit_percent', range_unified: true, decision_grade: false };
    const v = verdictFor(env, graph, leader);
    // churn fails on ITS OWN evidence only: never the spend warning's code, never the block-wide spill.
    expect(rowOf(v, CHURN)).toEqual({ constraint_id: CHURN, state: 'unscored', reason: 'not_decision_grade' });
    expect(rowOf(v, SPEND)).toEqual({ constraint_id: SPEND, state: 'unscored', reason: 'CONSTRAINT_NOT_CONVERTIBLE' });
  });

  it('DERIVED (spec: "exactly those limits"): constraint_ids outranks a node identity on the same warning', () => {
    const env = structuredClone(fixed);
    unreliable(env)[0]!.affected_node_ids = ['monthly_churn'];
    const v = verdictFor(env, graph, leader);
    expect(rowOf(v, CHURN)).toEqual({ constraint_id: CHURN, state: 'estimate_only', reason: 'baseline_is_estimate' });
  });

  it('DERIVED (joint_withheld also names churn): the producer\'s own "unscored" is read, and only for the ids it names', () => {
    const env = structuredClone(fixed);
    env.joint_withheld = { reason: 'limit_unscored', constraint_ids: [SPEND, CHURN] };
    const v = verdictFor(env, graph, leader);
    expect(rowOf(v, CHURN)).toEqual({ constraint_id: CHURN, state: 'unscored', reason: 'limit_unscored' });
    expect(rowOf(v, SPEND)).toEqual({ constraint_id: SPEND, state: 'unscored', reason: 'CONSTRAINT_NOT_CONVERTIBLE' });
    expect(v.joint).toEqual({ state: 'withheld', withheld_reason: 'limit_unscored', constraint_ids: [SPEND, CHURN] });
    expectContractValid(v);
  });

  // Byte-identity for payloads without either field. Each literal was printed by the verdict code at 6e4f9643 (before
  // this change), from the same inputs, and is compared as bytes.
  it.each([
    ['17d1 (EXEC)', () => [load('17d1cd3a.plot-response.json'), load('17d1cd3a.graph.json').graph],
      '{"may_name_leading_option":true,"constraint_verdict_state":"evaluated_feasible","per_limit":[{"constraint_id":"agent-lane:monthly_churn:<=","state":"estimate_only","reason":"baseline_is_estimate"}],"joint":{"state":"estimate_only"}}'],
    ['a6ed1bff (WIRE, identity-less CONSTRAINT_TARGET_UNRELIABLE)', () => [load('a6ed1bff.plot-response.json'), load('a6ed1bff.graph.json').graph],
      '{"may_name_leading_option":false,"constraint_verdict_state":"unevaluated","per_limit":[{"constraint_id":"agent-lane:monthly_churn:<=","state":"unscored","reason":"CONSTRAINT_TARGET_UNRELIABLE"}],"joint":{"state":"withheld","withheld_reason":"limit_unscored","constraint_ids":["agent-lane:monthly_churn:<="]}}'],
    ['0e19bb82 served turn (export)', () => [load('0e19bb82.served-turn.json').enrichment, graph],
      '{"may_name_leading_option":false,"constraint_verdict_state":"unevaluated","per_limit":[{"constraint_id":"agent-lane:six_month_decision_spend:<=","state":"unscored","reason":"CONSTRAINT_NOT_CONVERTIBLE"},{"constraint_id":"agent-lane:monthly_churn:<=","state":"unscored","reason":"constraint_block_withheld"}],"joint":{"state":"withheld","withheld_reason":"limit_unscored","constraint_ids":["agent-lane:six_month_decision_spend:<=","agent-lane:monthly_churn:<="]}}'],
    ['fixed pair with both new fields DELETED (old shape, DERIVED)', () => {
      const env = structuredClone(fixed);
      delete env.joint_withheld;
      for (const w of env.inference_warnings as Json[]) delete w.constraint_ids;
      expect(unreliable(env)).toHaveLength(1);
      return [env, graph];
    },
      '{"may_name_leading_option":false,"constraint_verdict_state":"unevaluated","per_limit":[{"constraint_id":"agent-lane:six_month_decision_spend:<=","state":"unscored","reason":"CONSTRAINT_NOT_CONVERTIBLE"},{"constraint_id":"agent-lane:monthly_churn:<=","state":"estimate_only","reason":"baseline_is_estimate"}],"joint":{"state":"withheld","withheld_reason":"limit_unscored","constraint_ids":["agent-lane:six_month_decision_spend:<="]}}'],
  ] as const)('an old payload with no ids stores byte-identical bytes: %s', (_name, inputs, expected) => {
    const [env, g] = inputs() as [Json, Json];
    expect(env.joint_withheld).toBeUndefined();
    expect(JSON.stringify(env)).not.toContain('"constraint_ids"');
    expect(JSON.stringify(projectClaimSafety(verdictFor(env, g, leaderOf(env.option_comparison))))).toBe(expected);
  });
});

// ── B5-5: reason iff not scored, from the producer's own per-constraint marker (C50 served captures) ─────────────
describe('B5-5: the first failed precondition is named from the producer\'s marker', () => {
  const rat = (id: string): RatifiedConstraint[] => [{ constraint_id: id, label: null }];
  const LEADER = 'opt_raise';
  it.each([
    ['U1', 'gc_u1', { constraint_id: 'gc_u1', state: 'unscored', reason: 'threshold_clamped' }],
    ['L1', 'gc_l1', { constraint_id: 'gc_l1', state: 'unscored', reason: 'not_decision_grade' }],
    ['U2', 'gc_u2', { constraint_id: 'gc_u2', state: 'scored' }],
  ] as const)('%s → %j', (capture, id, expected) => {
    const v = deriveConstraintVerdict(c50(capture), rat(id), LEADER, undefined, new Set(), { userBaselineIds: new Set([id]) });
    expect(v.perLimit).toEqual([expected]);
    expectContractValid(v);
  });
  it('a threshold whose range diverged from the target\'s (range_unified false) is threshold_unframed', () => {
    const env = structuredClone(c50('U2'));
    env.constraint_results[0].scale_provenance = { source: 'explicit_cap', range_unified: false, decision_grade: false };
    const v = deriveConstraintVerdict(env, rat('gc_u2'), LEADER, undefined, new Set(), { userBaselineIds: new Set(['gc_u2']) });
    expect(v.perLimit).toEqual([{ constraint_id: 'gc_u2', state: 'unscored', reason: 'threshold_unframed' }]);
  });
  it('a certified score with a P missing on one option is not scored (no_score_returned)', () => {
    const env = structuredClone(c50('U2'));
    delete (env.option_comparison as Json[]).find((o) => o.option_id === 'opt_hold')!.constraint_probabilities.gc_u2;
    const v = deriveConstraintVerdict(env, rat('gc_u2'), LEADER, undefined, new Set(), { userBaselineIds: new Set(['gc_u2']) });
    expect(v.perLimit).toEqual([{ constraint_id: 'gc_u2', state: 'unscored', reason: 'no_score_returned' }]);
  });
  it('the leader SETTING the target at Olumi\'s level folds in as estimate_only (rule (d))', () => {
    const v = deriveConstraintVerdict(c50('U2'), rat('gc_u2'), LEADER, undefined, new Set(['gc_u2']), {
      userBaselineIds: new Set(['gc_u2']),
    });
    expect(v.perLimit).toEqual([{ constraint_id: 'gc_u2', state: 'estimate_only', reason: 'baseline_is_estimate' }]);
  });
});

// ── Carrier: the intake conjunct can withdraw the leader permission, never the per-limit rows ───────────────────────
describe('the intake conjunct keeps the rows it does not own', () => {
  it('a withholding intake answer leaves per_limit and joint in place', () => {
    const persisted = {
      may_name_leading_option: true,
      constraint_verdict_state: 'evaluated_feasible' as const,
      per_limit: [{ constraint_id: CHURN, state: 'estimate_only' as const, reason: 'baseline_is_estimate' }],
      joint: { state: 'estimate_only' as const },
    };
    const out = applyIntakeToLeaderPermission(persisted, { state: 'options_missing', mayNameLeadingOption: false, enumerated: [], missing: [] } as never);
    expect(out).toEqual({ ...persisted, may_name_leading_option: false });
  });
});
