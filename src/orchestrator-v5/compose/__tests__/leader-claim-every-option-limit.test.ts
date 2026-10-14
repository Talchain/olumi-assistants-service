/**
 * ⛔ F-LIMIT (DL #70 5850643426 ruling v3 + 5850672588 tier 2; reviewer AI Conversation 5850621263 — its 8 rows).
 *
 * What EVERY option does against one of the user's limits on the bound run, from the run fact's own persisted PLoT
 * body, by the two existing per-option rules. The tab said only `constraint_verdict_withheld` ("we declined") on both
 * served shapes below.
 *
 * FIXTURES — the `option_comparison` entries exactly as served, each with its source:
 *  · TIER 1: Panel S9 (5850641881; CEE 44ec820; churn 12% vs ≤ 10%): 0.0054 / 0.0191 / 0.0061 / 0 → every option ≤ 0.05.
 *  · TIER 2: DL `f-20260926T202112Z/12-F9-rerun` (run B): 0.169 / 0.0115 / 0.1796 / 0 / 0 → every option < 0.5.
 *  · NEITHER: DL `f-20260926T201724Z/12-F9-rerun` (run A): 0.5027 / 0.5108 / 0.5072 / 0.0822 / 0 / 0 — a coin-flip.
 * SYNTHESISED, LABELLED: the persisted verdict state (not on the wire) and the `constraint_results` certification
 * (the transport block drops it; the fact keeps it), in the served U3b capture's shape
 * (`tests/fixtures/cross-service/c50-level-demo/U3b.plot-response.json`).
 */
import { describe, it, expect } from 'vitest';

import { deriveEveryOptionLimitVerdict, type RatifiedConstraint } from '../../../orchestrator/context/constraint-feasibility.js';
import {
  LEADER_CLAIM_REASON_KINDS,
  WITHHELD_CONSTRAINT_VERDICT,
  WITHHELD_EVERY_OPTION_LIKELY_BREAKS_LIMIT,
  WITHHELD_NO_OPTION_MEETS_LIMIT,
  WITHHELD_RUN_OUT_OF_DATE,
  WITHHELD_UNREQUESTED_ANALYSIS,
  composeAnalysisStateV1,
  leaderClaimReasonKind,
} from '../analysis-state-v1.js';
import { agentNoLeaderSentence } from '../../agent-lane/withheld-leader-fail-closed.js';
import { leaderWithheldForALimit } from '../../coaching/limit-unchecked-card.js';

const LIMIT = 'agent-lane:monthly_churn:<=';
const RATIFIED: RatifiedConstraint[] = [{ constraint_id: LIMIT, label: 'Monthly churn at most 10%' }];
type Entry = { option_id: string; constraints_decision_grade: boolean; constraint_probabilities: Record<string, number>; probability_of_joint_goal?: number };
const served = (ps: Record<string, number>): Entry[] =>
  Object.entries(ps).map(([option_id, p]) => ({ option_id, constraints_decision_grade: true, constraint_probabilities: { [LIMIT]: p } }));
const TIER1_S9 = served({ '59_ai_release_price': 0.0054, keep_49_with_ai_release: 0.0191, '54_ai_release_price': 0.0061, carry_on_as_now: 0 });
const TIER2_RUN_B = served({ '59_with_ai_release': 0.169, carry_on_as_now: 0.0115, '49_with_ai_release': 0.1796, ed44180c: 0, '8ff92948': 0 });
const COIN_FLIP_RUN_A = served({ raise_pro_to_59: 0.5027, hold_49_with_ai_release: 0.5108, raise_pro_to_54: 0.5072, continue_as_now: 0.0822, '125ce3a7': 0, '3d4b68e7': 0 });

const CERTIFIED = [{ constraint_id: LIMIT, node_id: 'monthly_churn', operator: '<=', value: 0.1,
  scale_provenance: { decision_grade: true, range_unified: true, source: 'explicit_cap' } }];
const resultOf = (options: readonly Entry[], state = 'evaluated_infeasible', certified: unknown[] = CERTIFIED) => ({
  scenario_id: '24197e68-0a2e-4a91-bf5e-452e2991bc4f',
  constraint_verdict: { constraint_verdict_state: state },
  enrichment: { option_comparison: structuredClone(options), constraint_results: structuredClone(certified) },
});
const withOption = (options: readonly Entry[], i: number, patch: Partial<Entry>) => options.map((e, j) => (j === i ? { ...e, ...patch } : e));

const canonicalFor = (freshness: 'fresh' | 'stale') => ({
  status: 'needs_user_input',
  usableForProse: true,
  usableForChips: true,
  usableForFollowupContext: true,
  requiresRerun: freshness === 'stale',
  blockedUnusable: false,
  contradictions: [],
  freshness,
  freshness_reason: freshness === 'stale' ? 'graph_changed' : undefined,
  computed_at: '2026-09-26T22:51:18.670Z',
  selected_fact_index: freshness === 'fresh' ? 0 : null,
}) as never;

type Causes = { limit?: 'none_meets' | 'likely_breaks'; unrequested?: boolean; identity?: boolean };
function compose(freshness: 'fresh' | 'stale', causes: Causes = {}) {
  return composeAnalysisStateV1({
    canonical: canonicalFor(freshness),
    mayNameLeadingOption: false,
    withheldBecauseUnrequested: causes.unrequested === true,
    withheldBecauseNonlinearIdentity: causes.identity === true,
    ...(causes.limit !== undefined ? { everyOptionLimit: causes.limit } : {}),
    rawRobustness: null,
  } as never)!;
}

describe('F-LIMIT — the rule: the two existing per-option rules, applied to EVERY option', () => {
  it('RED tier 1 (served S9): every option breaks the same ratified limit at P ≤ 0.05 → none_meets', () => {
    expect(deriveEveryOptionLimitVerdict(resultOf(TIER1_S9), RATIFIED)).toEqual({ kind: 'none_meets', constraintId: LIMIT });
  });

  it('RED tier 2 (served F9 run B, the C46 run): every option under 0.5 on the same limit → likely_breaks', () => {
    expect(deriveEveryOptionLimitVerdict(resultOf(TIER2_RUN_B, 'evaluated_feasible'), RATIFIED)).toEqual({ kind: 'likely_breaks', constraintId: LIMIT });
    // Tier 1 cannot fire here: two options are above the 0.05 floor, even under an infeasible leader verdict.
    expect(deriveEveryOptionLimitVerdict(resultOf(TIER2_RUN_B, 'evaluated_infeasible'), RATIFIED)).toEqual({ kind: 'likely_breaks', constraintId: LIMIT });
  });

  it('CONTRAST (served F9 run A, a coin-flip 0.50–0.51): neither code — today\'s behaviour stays', () => {
    expect(deriveEveryOptionLimitVerdict(resultOf(COIN_FLIP_RUN_A, 'evaluated_feasible'), RATIFIED)).toBeNull();
  });

  it('CONTRAST (row 2, exact): ONE option meeting the limit → null (the old reason stands)', () => {
    expect(deriveEveryOptionLimitVerdict(resultOf(withOption(TIER1_S9, 1, { constraint_probabilities: { [LIMIT]: 0.8 } })), RATIFIED)).toBeNull();
  });

  it('ONE option in (0.05, 0.5) under tier-1 conditions → tier 2, never tier 1', () => {
    const between = withOption(TIER1_S9, 1, { constraint_probabilities: { [LIMIT]: 0.2 } });
    expect(deriveEveryOptionLimitVerdict(resultOf(between), RATIFIED)).toEqual({ kind: 'likely_breaks', constraintId: LIMIT });
  });

  it('CONTRAST (row 3): ONE option not decision-grade → null, on both tiers', () => {
    expect(deriveEveryOptionLimitVerdict(resultOf(withOption(TIER1_S9, 2, { constraints_decision_grade: false })), RATIFIED)).toBeNull();
    expect(deriveEveryOptionLimitVerdict(resultOf(withOption(TIER2_RUN_B, 0, { constraints_decision_grade: false }), 'evaluated_feasible'), RATIFIED)).toBeNull();
  });

  it('the persisted verdict must have been EVALUATED: unevaluated / identity_unresolved / not_applicable → null', () => {
    for (const state of ['unevaluated', 'identity_unresolved', 'not_applicable']) {
      expect(deriveEveryOptionLimitVerdict(resultOf(TIER1_S9, state), RATIFIED), state).toBeNull();
    }
  });

  it('only a limit the USER ratified is named: an unratified id → null on both tiers', () => {
    const other: RatifiedConstraint[] = [{ constraint_id: 'agent-lane:mrr:>=', label: null }];
    expect(deriveEveryOptionLimitVerdict(resultOf(TIER1_S9), other)).toBeNull();
    expect(deriveEveryOptionLimitVerdict(resultOf(TIER2_RUN_B, 'evaluated_feasible'), other)).toBeNull();
  });

  it('tier 2 needs the producer\'s certification (a clamped or uncertified score licenses no breach claim)', () => {
    expect(deriveEveryOptionLimitVerdict(resultOf(TIER2_RUN_B, 'evaluated_feasible', []), RATIFIED)).toBeNull();
  });

  it('options failing DIFFERENT limits → null: the sentence names one limit, so it must be the same one', () => {
    const mixed = withOption(TIER1_S9, 0, { constraint_probabilities: { 'agent-lane:mrr:>=': 0.01, [LIMIT]: 0.9 } });
    const both: RatifiedConstraint[] = [...RATIFIED, { constraint_id: 'agent-lane:mrr:>=', label: null }];
    expect(deriveEveryOptionLimitVerdict(resultOf(mixed), both)).toBeNull();
  });

  it('a joint-goal tension is not "does not meet the limit": no tier 1 (it may still be tier 2 on its own P)', () => {
    const tension = withOption(TIER1_S9, 3, { constraint_probabilities: { [LIMIT]: 0.3 }, probability_of_joint_goal: 0.01 });
    expect(deriveEveryOptionLimitVerdict(resultOf(tension), RATIFIED)).toEqual({ kind: 'likely_breaks', constraintId: LIMIT });
  });

  it('no option entries, or no persisted body → null (never a vacuous claim about "every option")', () => {
    expect(deriveEveryOptionLimitVerdict(resultOf([]), RATIFIED)).toBeNull();
    expect(deriveEveryOptionLimitVerdict({ constraint_verdict: { constraint_verdict_state: 'evaluated_infeasible' } }, RATIFIED)).toBeNull();
  });
});

describe('F-LIMIT — the claim: the two codes, their precedence, and their readers', () => {
  it('RED (row 1): a current run on which no option meets the limit reads no_option_meets_limit, not the constraint token', () => {
    expect(compose('fresh', { limit: 'none_meets' }).leader_claim).toEqual({ permitted: false, withheld_reason: WITHHELD_NO_OPTION_MEETS_LIMIT });
    expect(compose('fresh', { limit: 'likely_breaks' }).leader_claim).toEqual({ permitted: false, withheld_reason: WITHHELD_EVERY_OPTION_LIKELY_BREAKS_LIMIT });
    expect(compose('fresh').leader_claim.withheld_reason, 'CONTROL: without the cause, today\'s token').toBe(WITHHELD_CONSTRAINT_VERDICT);
  });

  it('PRECEDENCE (row 4): both outrank the nonlinear-identity and constraint codes; the unrequested first pass outranks both', () => {
    expect(compose('fresh', { limit: 'none_meets', identity: true }).leader_claim.withheld_reason).toBe(WITHHELD_NO_OPTION_MEETS_LIMIT);
    expect(compose('fresh', { limit: 'likely_breaks', identity: true }).leader_claim.withheld_reason).toBe(WITHHELD_EVERY_OPTION_LIKELY_BREAKS_LIMIT);
    expect(compose('fresh', { limit: 'none_meets', unrequested: true }).leader_claim.withheld_reason).toBe(WITHHELD_UNREQUESTED_ANALYSIS);
  });

  it('PRECEDENCE (AI Conversation 5850621263): on an OUT-OF-DATE run neither fires — analysis_out_of_date', () => {
    expect(compose('stale', { limit: 'none_meets' }).leader_claim.withheld_reason).toBe(WITHHELD_RUN_OUT_OF_DATE);
    expect(compose('stale', { limit: 'likely_breaks' }).leader_claim.withheld_reason).toBe(WITHHELD_RUN_OUT_OF_DATE);
    // DL 7 Oct (W1c, #2764) supersedes #2047's order: out-of-date now leads over the nonlinear identity too.
    expect(compose('stale', { limit: 'none_meets', identity: true }).leader_claim.withheld_reason).toBe(WITHHELD_RUN_OUT_OF_DATE);
  });

  it('row 5: the limit-UNCHECKED card fires on neither (the limit was checked)', () => {
    expect(leaderWithheldForALimit(compose('fresh', { limit: 'none_meets' }))).toBe(false);
    expect(leaderWithheldForALimit(compose('fresh', { limit: 'likely_breaks' }))).toBe(false);
  });

  it('row 6: both classified `withheld` — we looked', () => {
    for (const code of [WITHHELD_NO_OPTION_MEETS_LIMIT, WITHHELD_EVERY_OPTION_LIKELY_BREAKS_LIMIT]) {
      expect(Object.prototype.hasOwnProperty.call(LEADER_CLAIM_REASON_KINDS, code)).toBe(true);
      expect(leaderClaimReasonKind(code)).toBe('withheld');
    }
  });

  it('row 7: the Agent says what every option does and asks what to change — never "run again", never the fallback', () => {
    const none = agentNoLeaderSentence(WITHHELD_NO_OPTION_MEETS_LIMIT, undefined);
    const likely = agentNoLeaderSentence(WITHHELD_EVERY_OPTION_LIKELY_BREAKS_LIMIT, undefined);
    const fallback = agentNoLeaderSentence('an_unrecorded_code', undefined);
    for (const said of [none, likely]) {
      expect(said).not.toBe(agentNoLeaderSentence(WITHHELD_CONSTRAINT_VERDICT, undefined));
      expect(said).not.toBe(fallback);
      // DL 5851485153: offer only served writes — change or add an option, or give a figure; never the limit itself.
      expect(said).toMatch(/change one of the options or add one/);
      expect(said).toMatch(/give me a real figure you know/);
      expect(said).not.toMatch(/change (that|the|your|a|one of (those|your|these)) limits?\b/i);
      expect(said).not.toMatch(/run the analysis again/i);
    }
    expect(none).toMatch(/no option meets one of your limits/);
    // Tier 2 never says "meets" (AI Quality ruling 5842498806), and names the estimates it rests on.
    expect(likely).toMatch(/on these estimates every option would probably break one of your limits/);
    expect(likely).not.toMatch(/meets|within/);
  });
});

/**
 * ⛔ BF9 (DL #72 5863859943; Canonical owner read 5863888216) — THE TIER REFUSES THE CLAIM, NOT ONLY NAMES IT.
 *
 * Served `bee1a422` (CEE a94fcb9, 28 Sep 05:06Z): the user's churn was 12% against their "under 10%" limit, and every
 * option was more likely than not to break it (leader 0.1699 · 0.0616 · 0 · 0), yet the typed claim NAMED the leader:
 * the persisted leader verdict is `evaluated_feasible` because rule 4's infeasibility floor is P ≤ 0.05, and the
 * F-LIMIT tier only chose the REASON once entitlement was already refused. Every row above composes with
 * `mayNameLeadingOption: false`, so none of them could see an ENTITLED leader under a tier.
 */
const BF9_SERVED = served({ raise_price_with_release: 0.1699, phased_54_release: 0.0616, keep_current_plan: 0, '8555417c': 0 });

function composeEntitled(freshness: 'fresh' | 'stale', limit?: 'none_meets' | 'likely_breaks') {
  return composeAnalysisStateV1({
    canonical: canonicalFor(freshness),
    mayNameLeadingOption: true,
    withheldBecauseUnrequested: false,
    withheldBecauseNonlinearIdentity: false,
    ...(limit !== undefined ? { everyOptionLimit: limit } : {}),
    rawRobustness: { near_tie_is_tie: false } as never,
  } as never)!;
}

describe('F-LIMIT × BF9 — an ENTITLED leader under a tier is withheld', () => {
  it('PREMISE: the served BF9 fact (leader verdict evaluated_feasible) is tier 2', () => {
    expect(deriveEveryOptionLimitVerdict(resultOf(BF9_SERVED, 'evaluated_feasible'), RATIFIED)).toEqual({ kind: 'likely_breaks', constraintId: LIMIT });
  });

  it('RED (BF9): entitled + separated + every option likely breaks the limit → withheld, every_option_likely_breaks_limit', () => {
    expect(composeEntitled('fresh', 'likely_breaks').leader_claim).toMatchObject({ permitted: false, withheld_reason: WITHHELD_EVERY_OPTION_LIKELY_BREAKS_LIMIT });
  });

  it('RED (tier 1): entitled + separated + no option meets the limit → withheld, no_option_meets_limit', () => {
    expect(composeEntitled('fresh', 'none_meets').leader_claim).toMatchObject({ permitted: false, withheld_reason: WITHHELD_NO_OPTION_MEETS_LIMIT });
  });

  it('CONTROL: entitled + separated with NO tier (one option ≥ 0.5, or a coin-flip) → the leader is named, as today', () => {
    expect(deriveEveryOptionLimitVerdict(resultOf(COIN_FLIP_RUN_A, 'evaluated_feasible'), RATIFIED)).toBeNull();
    expect(composeEntitled('fresh').leader_claim).toMatchObject({ permitted: true, separation: 'separated' });
  });

  it('an OUT-OF-DATE run never carries the tier (a claim about the analysed revision, not the model now)', () => {
    const claim = composeEntitled('stale', 'likely_breaks').leader_claim;
    expect(claim.withheld_reason).not.toBe(WITHHELD_EVERY_OPTION_LIKELY_BREAKS_LIMIT);
    expect(claim).toEqual(composeEntitled('stale').leader_claim);
  });
});
