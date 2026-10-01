/**
 * ⭐ R-c PER OPTION — lock A PJ-A3 (AI Quality #72 5900908629; R3 5900778834; MG 5900810410).
 *
 * Paul's run 2 on R3's captured request (`a3-rep1.plot-request.json`, the PLoT request CEE f95ea209 built): he set the
 * price → churn strength himself (0.85, `user_specified`) and added a retention offer and a grandfathering option, whose
 * links into churn are `olumi_placeholder`. #2268's R-c folded PER LIMIT: one placeholder-moved option withheld churn's
 * baseline for EVERY option, so his churn ≤ 4% went unscored. AIQ's rule: a strength the user stated is authored; the
 * baseline always carries; ONLY an option with ANY path into the target through an `olumi_placeholder` has ITS verdict
 * withheld, with the per-option reason and the ask. Expected, verbatim from the ruling:
 *   raise_pro_price_to_59 / _54: scored · c8342a91: scored · 7f996d9a (retention): withheld + ask · c0ce789c
 *   (grandfather): withheld + ask.
 * Mutant (quoted in the PR): the per-limit fold restored in `collectLimitLevelOwners` → the price rows go RED.
 *
 * The carrier rows read a SERVED PLoT body (`17d1cd3a.plot-response.json`, journey A) — every place an option's result on
 * a limit surfaces there — so the withhold is checked against the whole body, not the carriers the author thought of.
 *
 * ⛔ B6 SUPERSEDES THE "SCORED" ROWS AS SERVED (AIQ #75 5916187873): churn's 3% is Olumi's estimate and the feature-release
 * link is Olumi's, so as captured every option's churn P rests on Olumi's guess and is withheld. AIQ's per-option
 * placeholder rule is kept on the twin where those two inputs are Paul's (`mine`), and the served shape asserts B6.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CROWN_NOT_ASSESSED_REASON,
  collectLimitLevelOwners,
  deriveConstraintVerdict,
  readRatifiedConstraints,
  withholdOptionLimitScores,
} from '../constraint-feasibility.js';
import { placeholderMovedOptions } from '../placeholder-parts.js';
import { levelLimitBaselineNodeIds } from '../../../orchestrator-v5/tools/handlers/level-limit-baseline.js';
import { limitChecksForAgent } from '../../../orchestrator-v5/agent-lane/limit-checks.js';

type Json = Record<string, any>;
const read = (rel: string): Json => JSON.parse(readFileSync(rel, 'utf8')) as Json;
const REP1 = read('tests/fixtures/cross-service/b5-per-limit/a3-rep1.plot-request.json').request as Json;
const CHURN_LIMIT = 'agent-lane:monthly_churn:<=';
const CHURN = 'monthly_churn';

const byLimitOf = (graph: Json, options: Json[]) =>
  collectLimitLevelOwners(graph, readRatifiedConstraints(graph.goal_constraints ?? REP1.goal_constraints), options).placeholderMovedOptionIds;
const graphOf = (): Json => ({ ...structuredClone(REP1.graph), goal_constraints: structuredClone(REP1.goal_constraints) });
/** The A3 twin with B6's inputs made Paul's: churn's 3% is his, and so is the feature-release → churn size. */
const mine = (): Json => {
  const g = graphOf();
  (g.nodes as Json[]).find((n) => n.id === CHURN)!.observed_state.source = 'user';
  const e = (g.edges as Json[]).find((x) => x.from === 'pro_feature_release' && x.to === CHURN)!;
  e.provenance.source = 'user_specified';
  delete e.defaulted;
  return g;
};

/** PLoT scored churn ≤ 4% on every option it was sent, decision-grade (what the carried baseline makes possible). */
function scoredEnvelope(optionIds: readonly string[], p = 1): Json {
  return {
    constraints_status: 'computed',
    constraint_results: [{
      constraint_id: CHURN_LIMIT, node_id: CHURN, option_id: optionIds[0], probability: p,
      scale_provenance: { source: 'unit_percent', range_unified: true, decision_grade: true }, frame_verdict: 'scored',
    }],
    option_comparison: optionIds.map((id) => ({
      option_id: id, win_probability: 1 / optionIds.length, constraints_decision_grade: true,
      constraint_probabilities: { [CHURN_LIMIT]: p }, probability_of_joint_goal: p,
      constraint_margins: [{ constraint_id: CHURN_LIMIT, level_out_of_domain_fraction: 0 }],
    })),
    inference_warnings: [],
    critiques: [],
  };
}

describe('PRECONDITIONS — the captured request, read off its bytes', () => {
  it('price → churn is Paul\'s own strength (user_specified 0.85, no magnitude); the two added options reach churn on olumi_placeholder links', () => {
    const into = (REP1.graph.edges as Json[]).filter((e) => e.to === CHURN);
    const by = (from: string) => into.find((e) => e.from === from)!;
    expect(by('pro_plan_price').provenance).toMatchObject({ source: 'user_specified' });
    expect(by('pro_plan_price').strength.mean).toBe(0.85);
    expect(by('fac_at_risk_account_retention_intervention').provenance.magnitude).toBe('olumi_placeholder');
    expect(by('fac_grandfather_existing_customers').provenance.magnitude).toBe('olumi_placeholder');
    expect(by('pro_feature_release').provenance.magnitude).toBe('olumi_estimate');
  });
  it('the five options PLoT was sent, by id; churn ≤ 4% is a "%" level limit', () => {
    expect((REP1.options as Json[]).map((o) => o.option_id)).toEqual(
      ['raise_pro_price_to_59', 'raise_pro_price_to_54', 'c8342a91', '7f996d9a', 'c0ce789c']);
    expect(REP1.goal_constraints).toEqual([expect.objectContaining({ constraint_id: CHURN_LIMIT, unit: '%', value_frame: 'level' })]);
  });
});

describe('AIQ 5900908629 — the five rows on the rep1 request shape (Paul\'s level and links: `mine`)', () => {
  const withheld = () => byLimitOf(mine(), REP1.options).get(CHURN_LIMIT) ?? new Set<string>();

  it('B6 AS SERVED (AIQ 5916187873): every option withheld — placeholders as placeholders, the rest for Olumi\'s guess', () => {
    expect(Object.fromEntries(placeholderMovedOptions(CHURN, graphOf().nodes, graphOf().edges, REP1.options))).toEqual({
      raise_pro_price_to_59: 'limit_rests_on_olumi_guess', raise_pro_price_to_54: 'limit_rests_on_olumi_guess',
      c8342a91: 'limit_rests_on_olumi_guess', '7f996d9a': 'parts_links_placeholder', c0ce789c: 'parts_links_placeholder',
    });
  });

  it('⭐ raise_pro_price_to_59: scored (Paul\'s own strength is authored)', () => {
    expect(withheld().has('raise_pro_price_to_59')).toBe(false);
  });
  it('⭐ raise_pro_price_to_54: scored', () => {
    expect(withheld().has('raise_pro_price_to_54')).toBe(false);
  });
  it('c8342a91 (trial-to-Pro conversion): scored', () => {
    expect(withheld().has('c8342a91')).toBe(false);
  });
  it('7f996d9a (retention offer): withheld — it reaches churn through an olumi_placeholder', () => {
    expect(withheld().has('7f996d9a')).toBe(true);
  });
  it('c0ce789c (grandfather): withheld — ANY path counts, though its price move is Paul\'s strength', () => {
    expect(withheld().has('c0ce789c')).toBe(true);
    expect([...withheld()].sort()).toEqual(['7f996d9a', 'c0ce789c']);
  });
  it('the churn baseline CARRIES (it was dropped for every option at #2268), so PLoT scores every option', () => {
    const g = graphOf();
    expect(levelLimitBaselineNodeIds(g, g.goal_constraints, REP1.goal_node_id, REP1.options).has(CHURN)).toBe(true);
  });
  it('the row is NOT withheld for its parts: it folds over the three scored options (never unscored / parts_links_placeholder)', () => {
    const g = mine();
    const ratified = readRatifiedConstraints(g.goal_constraints);
    const ids = (REP1.options as Json[]).map((o) => o.option_id as string);
    const owners = collectLimitLevelOwners(g, ratified, REP1.options);
    expect(owners.placeholderPartsReasons.has(CHURN_LIMIT)).toBe(false);
    const env = withholdOptionLimitScores(scoredEnvelope(ids), owners.placeholderMovedOptionIds);
    const v = deriveConstraintVerdict(env, ratified, 'raise_pro_price_to_59', undefined, new Set(), owners);
    const row = v.perLimit?.find((r) => r.constraint_id === CHURN_LIMIT);
    expect(row?.state).not.toBe('unscored');
    expect(row?.reason).not.toBe('parts_links_placeholder');
    // The leader is a price option: its own P is Paul's, so the leader verdict is decided, not withheld for the parts.
    expect(v.state).toBe('evaluated_feasible');
  });
  it('a withheld option leading: the leader verdict is unevaluated on churn (rule 3(f)), never read off the placeholder\'s P', () => {
    const g = graphOf();
    const ratified = readRatifiedConstraints(g.goal_constraints);
    const ids = (REP1.options as Json[]).map((o) => o.option_id as string);
    const owners = collectLimitLevelOwners(g, ratified, REP1.options);
    const env = withholdOptionLimitScores(scoredEnvelope(ids), owners.placeholderMovedOptionIds);
    const v = deriveConstraintVerdict(env, ratified, '7f996d9a', undefined, new Set(), owners);
    expect(v.state).toBe('unevaluated');
    expect(v.mayNameLeadingOption).toBe(false);
  });
  it('said: the two withheld options by name, and one question per unsized part', () => {
    const g = mine();
    const row = { constraint_id: CHURN_LIMIT, state: 'scored' as const };
    const check = limitChecksForAgent(g, { per_limit: [row], joint: { state: 'scored' } } as never)!
      .find((c) => c.constraint_id === CHURN_LIMIT)!;
    expect(check.withheld_for).toEqual(['Retention intervention for at-risk accounts', '£59 for new Pro customers; grandfather existing customers']);
    expect(check.say).toContain('For ‘Retention intervention for at-risk accounts’ and ‘£59 for new Pro customers; grandfather existing customers’ it couldn’t be checked: those options move it through a link Olumi hasn’t sized in this limit’s units.');
    // The question is MG's ask, never the sentence's: one per unsized part (Paul's own level asks nothing).
    expect(check.say).not.toContain('How much');
    expect(check.ask).toMatch(/How much does ‘At-risk account retention intervention’ change ‘Monthly churn’\? How much does ‘Grandfather existing customers’ change ‘Monthly churn’\?$/);
    expect(check.say).not.toContain('Raise Pro Price');
  });
});

describe('the whole carrier class, on a SERVED PLoT body (journey A 17d1: both price options reach churn on a placeholder)', () => {
  const A = read('tests/fixtures/cross-service/b5-per-limit/17d1cd3a.graph.json').graph as Json;
  const BODY = read('tests/fixtures/cross-service/b5-per-limit/17d1cd3a.plot-response.json');
  const optionsOfA = (A.nodes as Json[]).filter((n) => n.kind === 'option').map((n) => ({ option_id: n.id, interventions: n.interventions ?? {} }));
  /** Journey A with churn's 3% made the user's (B6's level arm out), so these rows keep the placeholder carrier class. */
  const A_MINE = structuredClone(A);
  (A_MINE.nodes as Json[]).find((n) => n.label === 'Monthly churn')!.observed_state.source = 'user';
  const byLimit = collectLimitLevelOwners(A_MINE, readRatifiedConstraints(A_MINE), optionsOfA).placeholderMovedOptionIds;

  it('B6 AS SERVED (AIQ 5916187873 (c)): keep-current\'s P is Olumi\'s 3% against the 4% limit, so it is withheld too', () => {
    const served = collectLimitLevelOwners(A, readRatifiedConstraints(A), optionsOfA).placeholderMovedOptionIds;
    expect([...(served.get(CHURN_LIMIT) ?? [])].sort()).toEqual(['increase_price_to_54', 'increase_price_to_59', 'keep_current_49_price']);
  });
  const out = withholdOptionLimitScores(structuredClone(BODY), byLimit);
  const entry = (id: string) => (out.option_comparison as Json[]).find((o) => o.option_id === id)!;

  it('PRECONDITION: the withheld set is the two price options; PLoT crowned one of them "compliant"', () => {
    expect([...(byLimit.get(CHURN_LIMIT) ?? [])].sort()).toEqual(['increase_price_to_54', 'increase_price_to_59']);
    expect(BODY.robustness).toMatchObject({ recommended_option_id: 'increase_price_to_59', recommended_option_compliance: 'compliant' });
  });
  it('per option: the P, the joint P and the margin for churn are gone from each withheld option', () => {
    for (const id of ['increase_price_to_59', 'increase_price_to_54']) {
      expect(entry(id).constraint_probabilities, id).toEqual({});
      expect(entry(id), id).not.toHaveProperty('probability_of_joint_goal');
      expect(entry(id).constraint_margins, id).toEqual([]);
    }
  });
  it('the whole-body scan: no path under a withheld option\'s entry still names the churn limit', () => {
    const paths: string[] = [];
    const walk = (v: unknown, at: string) => {
      if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
      else if (v === CHURN_LIMIT || at.endsWith(`.${CHURN_LIMIT}`)) paths.push(at);
    };
    for (const id of ['increase_price_to_59', 'increase_price_to_54']) walk(entry(id), id);
    walk(out.decision_brief, 'decision_brief');
    expect(paths).toEqual([]);
  });
  it('the crown: PLoT\'s "met every limit you set" on a withheld option becomes PLoT\'s own not_assessed, in PLoT\'s words', () => {
    expect(out.robustness.recommended_option_compliance).toBe('not_assessed');
    expect(out.robustness.recommended_option_compliance_reason).toBe(CROWN_NOT_ASSESSED_REASON);
    expect(CROWN_NOT_ASSESSED_REASON).toBe('we could not check every limit you set on this run');
    expect(out.robustness.recommended_option_id).toBe('increase_price_to_59');
  });
  it('CONTROL — the option not moved by a placeholder keeps everything: keep_current\'s P, joint P, margin and its constraint_results P', () => {
    const keep = entry('keep_current_49_price');
    expect(keep).toEqual((BODY.option_comparison as Json[]).find((o) => o.option_id === 'keep_current_49_price'));
    expect(out.constraint_results).toEqual(BODY.constraint_results);
  });
  it('CONTROL — nothing withheld returns the body itself', () => {
    expect(withholdOptionLimitScores(BODY, new Map())).toBe(BODY);
  });
});

describe('the top-level constraint_results P and the crown eligibility', () => {
  const ids = ['raise_pro_price_to_59', '7f996d9a'];
  const byLimit = new Map([[CHURN_LIMIT, new Set(['7f996d9a'])]]);

  it('a constraint_results entry is ONE option\'s P: withheld option → its probability goes; the limit\'s id and scale marker stay', () => {
    const env = { ...scoredEnvelope(ids), constraint_results: [{ ...scoredEnvelope(ids).constraint_results[0], option_id: '7f996d9a' }] };
    const out = withholdOptionLimitScores(env, byLimit) as Json;
    expect(out.constraint_results[0]).not.toHaveProperty('probability');
    expect(out.constraint_results[0]).toMatchObject({ constraint_id: CHURN_LIMIT, frame_verdict: 'scored', scale_provenance: { decision_grade: true } });
  });
  it('PLoT ruled a withheld option out of the crown on a P of 0 (isCrownPermittedByConstraints) → the crowned option\'s compliance is not_assessed', () => {
    const env = scoredEnvelope(ids);
    (env.option_comparison as Json[])[1].constraint_probabilities[CHURN_LIMIT] = 0;
    env.robustness = { level: 'high', recommended_option_id: 'raise_pro_price_to_59', recommended_option_compliance: 'compliant',
      recommended_option_compliance_reason: 'this option met every limit you set, in all the scenarios we tested' };
    const out = withholdOptionLimitScores(env, byLimit) as Json;
    expect(out.robustness.recommended_option_compliance).toBe('not_assessed');
  });
  it('CONTROL — the crowned option is scored and no withheld P was 0: PLoT\'s compliance stands', () => {
    const env = scoredEnvelope(ids);
    env.robustness = { level: 'high', recommended_option_id: 'raise_pro_price_to_59', recommended_option_compliance: 'compliant',
      recommended_option_compliance_reason: 'this option met every limit you set, in all the scenarios we tested' };
    const out = withholdOptionLimitScores(env, byLimit) as Json;
    expect(out.robustness).toEqual(env.robustness);
  });
});
