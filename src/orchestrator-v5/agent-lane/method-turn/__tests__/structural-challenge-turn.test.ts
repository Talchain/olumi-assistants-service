/**
 * SCI-DEEP v1 — the deterministic reply renders the typed result faithfully: the unchanged winner with a changed
 * consequence (bank-2 B's lesson), the honest no-effect case, refusals in plain words, and no leaked leader or jargon.
 */
import { describe, expect, it } from 'vitest';

import {
  STRUCTURAL_CHALLENGE_NO_RUN_REPLY,
  composeStructuralChallengeReply,
  parseStructuralChallengePress,
  structuralChallengePressId,
  structuralChallengeTurnFor,
  structuralChallengeTurnUnderLicence,
} from '../structural-challenge-turn.js';
import { StructuralChallengeResultV1Schema } from '@talchain/schemas';
import { vi } from 'vitest';
import type { StructuralChallengeCertainty } from '../../../coaching/structural-challenge-compare.js';
import type { StructuralChallengeClaimV1, StructuralChallengeResultV1 } from '@talchain/schemas';

const LABELS = new Map([
  ['monthly_churn', 'Monthly churn'], ['paying_subscribers', 'Paying subscribers'], ['pro_plan_price', 'Pro plan price'],
  ['raise_pro_price_to_59', 'Raise Pro price to £59'], ['status_quo', 'Status quo'],
]);
const BASE = {
  method: 'full_recompute_unpaired_v1', perturbation_class: 'topology', attribution_case: 'C2_unpaired', retention: 'not_retained',
  recompute_key: '0'.repeat(64),
  baseline: { scenario_id: 's', run_id: 'r', graph_hash_at_run: 'h', seed_used: '1', n_samples: 10_000, sent_digest: 'd'.repeat(64) },
  alternative: { op: 'remove_link', from_id: 'monthly_churn', to_id: 'paying_subscribers', origin: 'olumi_suggested', sizing: 'olumi_estimate' },
} as const;
const NOT_COMPARED: StructuralChallengeResultV1['not_compared'] = ['structural_influence', 'e_values', 'driver_rank', 'robustness_label', 'fragile_edges'];

const changed: StructuralChallengeResultV1 = {
  ...BASE, status: 'completed', reason: null, not_compared: NOT_COMPARED,
  pair_provenance: { seed_equal: true, hash_equal: false, builds_equal: 'equal', n_equal: true },
  claims: [
    { kind: 'leader', baseline_option_id: 'raise_pro_price_to_59', alternative_option_id: 'raise_pro_price_to_59', noise_verdict: 'signal', verdict: 'holds', basis: 'leader_same', invariant_by_construction: false },
    { kind: 'goal_probability', option_id: 'raise_pro_price_to_59', constraint_id: null, baseline: 0.5291, alternative: 1, target: null, constraint_boundary: null, noise_verdict: 'signal', verdict: 'changes', basis: 'certainty_boundary_crossed', invariant_by_construction: false },
    { kind: 'outcome_level', option_id: 'raise_pro_price_to_59', constraint_id: null, baseline: 83433.86, alternative: 90306.12, target: 85000, constraint_boundary: null, noise_verdict: 'signal', verdict: 'changes', basis: 'target_crossed', invariant_by_construction: false },
    { kind: 'constraint_probability', option_id: 'raise_pro_price_to_59', constraint_id: 'c', baseline: 0.8746, alternative: 0.8744, target: null, constraint_boundary: null, noise_verdict: 'within_noise', verdict: 'holds', basis: 'unaffected_by_construction', invariant_by_construction: true },
  ],
};

describe('SCI-DEEP reply', () => {
  it('an unchanged winner with a changed consequence: says both, in model-run terms, and asks for evidence', () => {
    const reply = composeStructuralChallengeReply({ result: changed, labels: LABELS, certainty: { baseline: [], alternative: [{ option_id: 'raise_pro_price_to_59', probability_of_goal: 1, earned: true }] } });
    expect(reply.split('\n')[0]).toBe('Without the link from Monthly churn to Paying subscribers, Raise Pro price to £59 still leads — but part of the result changes.');
    expect(reply).toContain('baseline: Reaches the target in about 53% of model runs. Without the link: Reaches the target in 100% of model runs.');
    expect(reply).toContain('83,434 now and 90,306 without the link (your target is 85,000)');
    expect(reply).toContain('doesn\'t say which version of the model is right');
    expect(reply).toContain('This test isn\'t saved.');
    expect(reply).toContain('What evidence do you have for that link?');
    expect(reply).not.toMatch(/\b(likely|certain|certainly|guaranteed|robust\w*|fragile|structure-sensitive|not_comparable|delta_only|C2_unpaired|invariant\w*)\b/i);
  });

  it('never names a withheld leader', () => {
    const withheld: StructuralChallengeResultV1 = {
      ...changed,
      claims: [{ kind: 'leader', baseline_option_id: null, alternative_option_id: null, noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: 'withheld_on_one_side', invariant_by_construction: false }, ...changed.claims.slice(1)],
    };
    const reply = composeStructuralChallengeReply({ result: withheld, labels: LABELS });
    expect(reply.split('\n')[0]).toBe('Without the link from Monthly churn to Paying subscribers, part of the result changes.');
    expect(reply).not.toContain('still leads');
    expect(reply).not.toContain('leads in both versions');
  });

  it('the honest no-effect case: the conclusion does not depend on the link', () => {
    const held: StructuralChallengeResultV1 = { ...changed, claims: [changed.claims[0], changed.claims[3]] };
    const reply = composeStructuralChallengeReply({ result: held, labels: LABELS });
    expect(reply.split('\n')[0]).toBe('Without the link from Monthly churn to Paying subscribers, the conclusions I tested still hold.');
    expect(reply).toContain('isn\'t evidence either way');
    expect(reply).toContain('the tested conclusions held in these two model versions');
  });

  it('refusals are plain, typed, and say nothing changed', () => {
    const root: StructuralChallengeResultV1 = { ...BASE, alternative: { ...BASE.alternative, from_id: 'pro_plan_price', to_id: 'monthly_churn' }, status: 'unsupported', reason: 'target_becomes_root', pair_provenance: null, claims: [], not_compared: [] };
    expect(composeStructuralChallengeReply({ result: root, labels: LABELS }))
      .toBe('I can\'t test the link from Pro plan price to Monthly churn. Removing that link would leave its target with nothing driving it, which changes how its starting level is read — the comparison would measure that change of meaning, not the link. Nothing in your model changed.');
    const stale: StructuralChallengeResultV1 = { ...root, status: 'stale', reason: 'run_not_current' };
    expect(composeStructuralChallengeReply({ result: stale, labels: LABELS })).toContain('Run the analysis again');
    const mismatch: StructuralChallengeResultV1 = { ...root, status: 'failed', reason: 'baseline_payload_mismatch' };
    expect(composeStructuralChallengeReply({ result: mismatch, labels: LABELS }))
      .toBe('I couldn\'t line this test up exactly with the analysis you ran, so there\'s no fair comparison to show. Run the analysis again, then try this test. Nothing in your model changed.');
    const failed: StructuralChallengeResultV1 = { ...root, status: 'failed', reason: 'candidate_run_failed' };
    expect(composeStructuralChallengeReply({ result: failed, labels: LABELS })).toContain('I couldn\'t complete the test of the link from Pro plan price to Monthly churn');
  });

  it('a lead that is not clear is never stated as a lead', () => {
    const close: StructuralChallengeResultV1 = { ...changed, claims: [{ ...changed.claims[0], noise_verdict: 'within_noise', verdict: 'delta_only', basis: 'within_noise' } as StructuralChallengeClaimV1, ...changed.claims.slice(1)] };
    const reply = composeStructuralChallengeReply({ result: close, labels: LABELS });
    expect(reply).toContain('Which option leads is too close to call in at least one version.');
    expect(reply).not.toContain('leads in both versions');
    expect(reply).not.toContain('still leads');
  });

  it('a chance is never rounded to certain', () => {
    const near = { ...changed, claims: [{ ...changed.claims[1], baseline: 0.996, alternative: 0.004, verdict: 'delta_only', basis: 'no_licensed_boundary' } as const] } as StructuralChallengeResultV1;
    const reply = composeStructuralChallengeReply({ result: near, labels: LABELS });
    expect(reply).toContain('over 99% of model runs');
    expect(reply).toContain('under 1% of model runs');
  });

  it('the press id round-trips typed ids; anything else is not this press', () => {
    const link = { from_id: 'monthly_churn', to_id: 'paying_subscribers' };
    expect(parseStructuralChallengePress(structuralChallengePressId(link))).toEqual(link);
    for (const other of ['agent-next-what-would-change', 'agent-test-without-link:', 'agent-test-without-link:a', 'agent-test-without-link:a::', undefined, 7]) {
      expect(parseStructuralChallengePress(other)).toBeNull();
    }
  });

  it('the route adapter: one dispatch per recognised press, the deterministic reply, and only "Talk it through"', async () => {
    const asked: unknown[] = [];
    const turn = await structuralChallengeTurnFor(structuralChallengePressId({ from_id: 'monthly_churn', to_id: 'paying_subscribers' }), async (l) => {
      asked.push(l);
      return { kind: 'result', result: changed, labels: LABELS };
    });
    expect(asked).toEqual([{ from_id: 'monthly_churn', to_id: 'paying_subscribers' }]);
    expect(turn?.outcome).toBe('completed');
    expect(turn?.reply.split('\n')[0]).toContain('still leads');
    expect(turn?.actions.map((a) => a.id)).toEqual(['agent-talk-it-through']);
    expect(await structuralChallengeTurnFor('agent-next-what-would-change', async () => { throw new Error('never'); })).toBeNull();
    const none = await structuralChallengeTurnFor(structuralChallengePressId({ from_id: 'a', to_id: 'b' }), async () => ({ kind: 'no_run' }));
    expect(none).toMatchObject({ outcome: 'no_run', reply: STRUCTURAL_CHALLENGE_NO_RUN_REPLY, result: null });
  });

  it('the final licence only narrows: a leader withheld at the final read is withheld in the result and the reply', async () => {
    const turn = await structuralChallengeTurnFor(structuralChallengePressId({ from_id: 'monthly_churn', to_id: 'paying_subscribers' }), async () => ({ kind: 'result', result: changed, labels: LABELS }));
    if (turn === null) throw new Error('expected a turn');
    expect(structuralChallengeTurnUnderLicence(turn, true)).toBe(turn);
    const narrowed = structuralChallengeTurnUnderLicence(turn, false);
    expect(narrowed.result?.claims.find((c) => c.kind === 'leader'))
      .toEqual({ kind: 'leader', baseline_option_id: null, alternative_option_id: null, noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: 'withheld_on_one_side', invariant_by_construction: false });
    expect(narrowed.result?.claims.slice(1)).toEqual(changed.claims.slice(1));
    expect(narrowed.reply.split('\n')[0]).toBe('Without the link from Monthly churn to Paying subscribers, part of the result changes.');
    expect(narrowed.reply).not.toContain('still leads');
    expect(narrowed.reply).not.toContain('Raise Pro price to £59 leads');
    expect(narrowed.actions).toEqual(turn.actions);
  });
});


describe('independent-review reply and press regressions', () => {
  const goal = (baseline: number | null, alternative: number | null, basis: StructuralChallengeClaimV1['basis'] = 'no_licensed_boundary'): StructuralChallengeClaimV1 => ({
    kind: 'goal_probability', option_id: 'raise_pro_price_to_59', constraint_id: null, baseline, alternative,
    target: null, constraint_boundary: null, noise_verdict: 'signal', verdict: baseline === null || alternative === null ? 'not_comparable' : 'delta_only', basis, invariant_by_construction: false,
  });
  const replyFor = (claims: StructuralChallengeClaimV1[], certainty?: StructuralChallengeCertainty) => {
    const result = { ...changed, claims };
    expect(StructuralChallengeResultV1Schema.parse(result)).toEqual(result);
    const reply = composeStructuralChallengeReply({ result, labels: LABELS, certainty });
    return reply;
  };

  it.each(['baseline', 'alternative'] as const)('3: exact 0/1 on %s follows earned, unearned and unrecorded certainty', (side) => {
    for (const value of [0, 1] as const) for (const licence of ['earned', 'unearned', 'unrecorded', 'duplicate', 'mismatch'] as const) {
      const c = goal(side === 'baseline' ? value : 0.53, side === 'alternative' ? value : 0.53);
      const say = 'Olumi can’t yet say how likely this option is to meet the goal: the relevant link isn’t sized.';
      const decision = { option_id: 'raise_pro_price_to_59', probability_of_goal: value, earned: licence === 'earned', ...(licence === 'unearned' ? { say } : {}) };
      const recorded = licence === 'unrecorded' ? undefined : licence === 'duplicate' ? [decision, decision] : licence === 'mismatch' ? [{ ...decision, probability_of_goal: value === 1 ? 0 as const : 1 as const }] : [decision];
      const certainty = { baseline: undefined, alternative: undefined, [side]: recorded };
      const reply = replyFor([c], certainty);
      expect(reply).toContain('Raise Pro price to £59');
      if (licence === 'earned') expect(reply).toContain(value === 1 ? '100% of model runs' : '0% of model runs');
      else {
        expect(reply).not.toContain('100%'); expect(reply).not.toContain('0%');
        expect(reply).toContain(licence === 'unearned' ? say : 'what this model gives, not a certainty');
      }
    }
  });

  it.each(['baseline', 'alternative'] as const)('3/4: withheld certainty on %s keeps its recorded sentence without restoring a number', async (side) => {
    const say = 'Olumi can’t yet say how likely this option is to meet the goal: the relevant link isn’t sized.';
    const c = goal(side === 'baseline' ? null : 0.53, side === 'alternative' ? null : 0.53, 'withheld_on_one_side');
    const certainty: StructuralChallengeCertainty = { baseline: undefined, alternative: undefined, [side]: [{ option_id: 'raise_pro_price_to_59', probability_of_goal: 1, earned: false, say }] };
    const result = { ...changed, claims: [c] };
    expect(StructuralChallengeResultV1Schema.parse(result)).toEqual(result);
    const turn = await structuralChallengeTurnFor(structuralChallengePressId({ from_id: 'a', to_id: 'b' }), async () => ({ kind: 'result', result, labels: LABELS, certainty }));
    if (turn === null) throw new Error('missing turn');
    expect(turn.certainty).toEqual(certainty);
    for (const reply of [turn.reply, structuralChallengeTurnUnderLicence(turn, false).reply]) {
      expect(reply).toContain(say); expect(reply).not.toContain('100%'); expect(reply).not.toContain('0%');
    }
  });

  it('4: unparseable evidence has a specific, honest refusal', () => {
    const result = { ...BASE, status: 'failed', reason: 'candidate_unparseable', claims: [], pair_provenance: null, not_compared: [] } as StructuralChallengeResultV1;
    expect(StructuralChallengeResultV1Schema.parse(result)).toEqual(result);
    expect(composeStructuralChallengeReply({ result, labels: LABELS })).toContain("The test's recorded evidence couldn't be read");
  });

  it.each(['frame_changed', 'unit_changed', 'identity_status_changed', 'ranking_status_changed', 'withheld_on_one_side', 'missing_on_one_side'] as const)('4: incomparable leader reason %s is never a tie or omitted', (basis) => {
    const c: StructuralChallengeClaimV1 = { ...changed.claims[0] as Extract<StructuralChallengeClaimV1, { kind: 'leader' }>, verdict: 'not_comparable', basis, noise_verdict: 'not_noise_qualified', ...(basis === 'withheld_on_one_side' || basis === 'missing_on_one_side' ? { baseline_option_id: null, alternative_option_id: null } : {}) };
    const reply = replyFor([c]);
    expect(reply).toContain('Which option leads');
    expect(reply).not.toContain('too close to call');
    expect(reply).not.toContain('still hold');
    expect(reply).not.toContain('doesn\'t depend on this link');
    expect(reply).toContain('resolve the missing or unqualified evidence');
  });

  it.each(['goal_probability', 'outcome_level', 'constraint_probability'] as const)('4: missing %s keeps its identity and typed reason in the reply', (kind) => {
    const c: StructuralChallengeClaimV1 = { kind, option_id: 'status_quo', constraint_id: kind === 'constraint_probability' ? 'missing-limit' : null, baseline: kind === 'outcome_level' ? 75000 : 0.53, alternative: null, target: null, constraint_boundary: null, verdict: 'not_comparable', basis: 'missing_on_one_side', noise_verdict: 'not_noise_qualified', invariant_by_construction: false };
    const reply = replyFor([c]);
    expect(reply).toContain('Status quo');
    expect(reply).toContain('unavailable');
    if (kind === 'constraint_probability') expect(reply).toContain('missing-limit');
    expect(reply).toContain('At least one run did not record this claim');
    expect(reply).not.toContain('still hold');
  });

  it.each(['within_noise', 'not_noise_qualified', 'no_licensed_boundary'] as const)('4: delta reason %s does not imply independence', (basis) => {
    const c = { ...goal(0.1, 0.9, basis), noise_verdict: basis === 'within_noise' ? 'within_noise' : basis === 'not_noise_qualified' ? 'not_noise_qualified' : 'signal' } as StructuralChallengeClaimV1;
    const reply = replyFor([c]);
    expect(reply).not.toContain('doesn\'t depend on this link');
    expect(reply).not.toContain('still hold');
    expect(reply).toContain('resolve the missing or unqualified evidence');
  });

  it('4: construction-only holds are not positive evidence of independence', () => {
    const reply = replyFor([changed.claims[3]]);
    expect(reply).toContain('can\'t be affected by this link');
    expect(reply).not.toContain('the conclusions I tested still hold');
    expect(reply).not.toContain('doesn\'t depend on this link');
  });

  it('4: a changed competing option is not described as a changed consequence for the unchanged leader', () => {
    const competitor = { ...changed.claims[2], option_id: 'status_quo' } as StructuralChallengeClaimV1;
    const reply = replyFor([changed.claims[0], competitor]);
    expect(reply.split('\n')[0]).toContain('Raise Pro price to £59 still leads — but part of the result changes.');
    expect(reply).toContain("Status quo's expected result");
    expect(reply).not.toContain('what you can expect from it changes');
  });

  it('9: final true cannot restore a baseline-withheld compared leader', async () => {
    const result = { ...changed, claims: [{ ...changed.claims[0], baseline_option_id: null, alternative_option_id: null, verdict: 'not_comparable', basis: 'withheld_on_one_side', noise_verdict: 'not_noise_qualified' } as StructuralChallengeClaimV1] };
    expect(StructuralChallengeResultV1Schema.parse(result)).toEqual(result);
    const turn = await structuralChallengeTurnFor(structuralChallengePressId({ from_id: 'a', to_id: 'b' }), async () => ({ kind: 'result', result, labels: LABELS }));
    if (turn === null) throw new Error('missing turn');
    expect(structuralChallengeTurnUnderLicence(turn, true).result).toEqual(result);
    expect(turn.reply).not.toContain('Raise Pro price to £59');
  });

  it.each([{ from_id: 'a::b', to_id: 'c' }, { from_id: 'a', to_id: 'b::c' }, { from_id: 'a::b', to_id: 'c::d' }])('12: delimiter-bearing endpoints round-trip and dispatch once: %j', async (link) => {
    const press = structuralChallengePressId(link);
    expect(parseStructuralChallengePress(press)).toEqual(link);
    const ask = vi.fn(async () => ({ kind: 'no_run' as const }));
    await structuralChallengeTurnFor(press, ask);
    expect(ask).toHaveBeenCalledExactlyOnceWith(link);
  });

  it('12: malformed, oversized, non-string and self-link ids refuse before dispatch', async () => {
    const ask = vi.fn(async () => { throw new Error('must not dispatch'); });
    for (const endpoints of [['a', 'a'], ['', 'b'], ['a', ''], ['a'.repeat(201), 'b'], [7, 'b'], [' a', 'b'], ['a?', 'b'], ['a', null], ['a'], ['a', 'b', 'c']]) {
      const press = `agent-test-without-link:${JSON.stringify(endpoints)}`;
      expect(parseStructuralChallengePress(press)).toBeNull();
      expect(await structuralChallengeTurnFor(press, ask)).toMatchObject({ outcome: 'unsupported', result: null, reply: 'This test needs a link between two distinct nodes with valid recorded identities. Nothing in your model changed.' });
    }
    expect(parseStructuralChallengePress('agent-test-without-link:a::a')).toBeNull();
    expect(ask).not.toHaveBeenCalled();
    expect(structuralChallengePressId({ from_id: 'a::b', to_id: 'c' })).not.toBe(structuralChallengePressId({ from_id: 'a', to_id: 'b::c' }));
  });
});
