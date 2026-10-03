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
import type { StructuralChallengeResult } from '../../../coaching/structural-challenge-compare.js';

const LABELS = new Map([
  ['monthly_churn', 'Monthly churn'], ['paying_subscribers', 'Paying subscribers'], ['pro_plan_price', 'Pro plan price'],
  ['raise_pro_price_to_59', 'Raise Pro price to £59'], ['status_quo', 'Status quo'],
]);
const BASE = {
  method: 'full_recompute_unpaired_v1', perturbation_class: 'topology', attribution_case: 'C2_unpaired', retention: 'not_retained',
  recompute_key: '0'.repeat(64),
  baseline: { scenario_id: 's', run_id: 'r', graph_hash_at_run: 'h', seed_used: '1', n_samples: 10_000, sent_digest: 'd' },
  alternative: { op: 'remove_link', from_id: 'monthly_churn', to_id: 'paying_subscribers', origin: 'olumi_suggested', sizing: 'olumi_estimate' },
} as const;
const NOT_COMPARED = ['structural_influence', 'e_values', 'driver_rank', 'robustness_label', 'fragile_edges'];

const changed: StructuralChallengeResult = {
  ...BASE, status: 'completed', reason: null, not_compared: NOT_COMPARED,
  pair_provenance: { seed_equal: true, hash_equal: false, builds_equal: 'equal', n_equal: true },
  claims: [
    { kind: 'leader', baseline_option_id: 'raise_pro_price_to_59', alternative_option_id: 'raise_pro_price_to_59', noise_verdict: 'signal', verdict: 'holds', basis: 'leader_same', invariant_by_construction: false },
    { kind: 'goal_probability', option_id: 'raise_pro_price_to_59', constraint_id: null, baseline: 0.5291, alternative: 1, target: null, noise_verdict: 'signal', verdict: 'changes', basis: 'certainty_boundary_crossed', invariant_by_construction: false },
    { kind: 'outcome_level', option_id: 'raise_pro_price_to_59', constraint_id: null, baseline: 83433.86, alternative: 90306.12, target: 85000, noise_verdict: 'signal', verdict: 'changes', basis: 'target_crossed', invariant_by_construction: false },
    { kind: 'constraint_probability', option_id: 'raise_pro_price_to_59', constraint_id: 'c', baseline: 0.8746, alternative: 0.8744, target: null, noise_verdict: 'within_noise', verdict: 'holds', basis: 'unaffected_by_construction', invariant_by_construction: true },
  ],
};

describe('SCI-DEEP reply', () => {
  it('an unchanged winner with a changed consequence: says both, in model-run terms, and asks for evidence', () => {
    const reply = composeStructuralChallengeReply({ result: changed, labels: LABELS });
    expect(reply.split('\n')[0]).toBe('Without the link from Monthly churn to Paying subscribers, Raise Pro price to £59 still leads — but what you can expect from it changes.');
    expect(reply).toContain('reaches your target in about 53% of model runs now, and in 100% without the link.');
    expect(reply).toContain('83,434 now and 90,306 without the link (your target is 85,000)');
    expect(reply).toContain('doesn\'t say which version of the model is right');
    expect(reply).toContain('This test isn\'t saved.');
    expect(reply).toContain('What evidence do you have for that link?');
    expect(reply).not.toMatch(/\b(likely|certain|certainly|guaranteed|robust\w*|fragile|structure-sensitive|not_comparable|delta_only|C2_unpaired|invariant\w*)\b/i);
  });

  it('never names a withheld leader', () => {
    const withheld: StructuralChallengeResult = {
      ...changed,
      claims: [{ kind: 'leader', baseline_option_id: null, alternative_option_id: null, noise_verdict: 'not_noise_qualified', verdict: 'not_comparable', basis: 'withheld_on_one_side', invariant_by_construction: false }, ...changed.claims.slice(1)],
    };
    const reply = composeStructuralChallengeReply({ result: withheld, labels: LABELS });
    expect(reply.split('\n')[0]).toBe('Without the link from Monthly churn to Paying subscribers, part of the result changes.');
    expect(reply).not.toContain('still leads');
    expect(reply).not.toContain('leads in both versions');
  });

  it('the honest no-effect case: the conclusion does not depend on the link', () => {
    const held: StructuralChallengeResult = { ...changed, claims: [changed.claims[0], changed.claims[3]] };
    const reply = composeStructuralChallengeReply({ result: held, labels: LABELS });
    expect(reply.split('\n')[0]).toBe('Without the link from Monthly churn to Paying subscribers, the conclusions I tested still hold.');
    expect(reply).toContain('isn\'t evidence either way');
    expect(reply).toContain('your conclusion doesn\'t depend on this link');
  });

  it('refusals are plain, typed, and say nothing changed', () => {
    const root: StructuralChallengeResult = { ...BASE, alternative: { ...BASE.alternative, from_id: 'pro_plan_price', to_id: 'monthly_churn' }, status: 'unsupported', reason: 'target_becomes_root', pair_provenance: null, claims: [], not_compared: [] };
    expect(composeStructuralChallengeReply({ result: root, labels: LABELS }))
      .toBe('I can\'t test the link from Pro plan price to Monthly churn. Removing that link would leave its target with nothing driving it, which changes how its starting level is read — the comparison would measure that change of meaning, not the link. Nothing in your model changed.');
    const stale: StructuralChallengeResult = { ...root, status: 'stale', reason: 'run_not_current' };
    expect(composeStructuralChallengeReply({ result: stale, labels: LABELS })).toContain('Run the analysis again');
    const mismatch: StructuralChallengeResult = { ...root, status: 'failed', reason: 'baseline_payload_mismatch' };
    expect(composeStructuralChallengeReply({ result: mismatch, labels: LABELS }))
      .toBe('I couldn\'t line this test up exactly with the analysis you ran, so there\'s no fair comparison to show. Run the analysis again, then try this test. Nothing in your model changed.');
    const failed: StructuralChallengeResult = { ...root, status: 'failed', reason: 'candidate_run_failed' };
    expect(composeStructuralChallengeReply({ result: failed, labels: LABELS })).toContain('I couldn\'t complete the test of the link from Pro plan price to Monthly churn');
  });

  it('a chance is never rounded to certain', () => {
    const near = { ...changed, claims: [{ ...changed.claims[1], baseline: 0.996, alternative: 0.004, verdict: 'delta_only', basis: 'no_licensed_boundary' } as const] } as StructuralChallengeResult;
    const reply = composeStructuralChallengeReply({ result: near, labels: LABELS });
    expect(reply).toContain('over 99% of model runs now, and in under 1% without the link');
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
