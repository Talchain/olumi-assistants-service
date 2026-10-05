/**
 * SCI-DEEP v1 — the deterministic reply renders the typed result faithfully: the unchanged winner with a changed
 * consequence (bank-2 B's lesson), the honest no-effect case, refusals in plain words, and no leaked leader or jargon.
 */
import { describe, expect, it } from 'vitest';

import {
  STRUCTURAL_CHALLENGE_NO_RUN_REPLY,
  STRUCTURAL_CHALLENGE_REPLAY_UNBOUND_REPLY,
  composeStructuralChallengeReply,
  parseStructuralChallengePress,
  structuralChallengePressId,
  structuralChallengeTurnFor,
  structuralChallengeTurnUnderLicence,
  structuralChallengeReplay,
  type StructuralChallengeTurn,
} from '../structural-challenge-turn.js';
import { TALK_IT_THROUGH_CHIP } from '../method-turn.js';
import { claimPermissionsFrom } from '../../first-analysis.js';
import type { StructuralChallengeFinalRead } from '../../../handlers/structural-challenge-dispatch.js';
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
  baseline: { scenario_id: 's', run_id: 'r', graph_hash_at_run: '0'.repeat(16), seed_used: '1', n_samples: 10_000, sent_digest: 'd'.repeat(64) },
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

/** The selected execution and FULL canonical permission are read together; no boolean authority. */
const BASELINE_IDENTITY = { scenario_id: BASE.baseline.scenario_id, run_id: BASE.baseline.run_id,
  graph_hash_at_run: BASE.baseline.graph_hash_at_run, computed_at: '2026-10-04T10:00:00.000Z' };

function finalRead(permitted = true, provisional = false): StructuralChallengeFinalRead {
  const state = { run_state: { kind: 'complete_current' }, requires_rerun: false,
    leader_claim: { permitted, separation: 'separated' } };
  const ready = { analysis_admission: { structurally_analysable: true,
    permitted_analysis_mode: provisional ? 'quantified_provisional' : 'comparative_leader' } };
  return {
    read: { analysis_state: state, analysis_result: { type: 'analysis_result' },
      current_read: { run_state: state.run_state, result: { type: 'analysis_result' }, figures: [],
        computed_against_hash: BASE.baseline.graph_hash_at_run, current_analysis_hash: BASE.baseline.graph_hash_at_run } } as unknown as StructuralChallengeFinalRead['read'],
    currentness: { readOk: true, permissions: claimPermissionsFrom(state, ready, { requested: true }), fact: {
      fact_type: 'run_analysis', fact_version: 1, noop: false, result: {
        summary: 'The selected baseline Run', leading_option_id: 'raise_pro_price_to_59',
        scenario_id: BASE.baseline.scenario_id, run_id: BASE.baseline.run_id,
        graph_hash_at_run: BASE.baseline.graph_hash_at_run, computed_at: '2026-10-04T10:00:00.000Z',
        enrichment: { meta: { seed_used: BASE.baseline.seed_used, n_samples: BASE.baseline.n_samples } },
        input_snapshot: { snapshot_version: 1, sent_digest: BASE.baseline.sent_digest, goal: null,
          options: [], options_not_sent: [], factors: [], constraints: [], links: [] },
      },
    } as NonNullable<StructuralChallengeFinalRead['currentness']>['fact'] },
  };
}

describe('SCI-DEEP reply', () => {
  it('an unchanged winner with a changed consequence: says both, in model-run terms, and asks for evidence', () => {
    const reply = composeStructuralChallengeReply({ result: changed, labels: LABELS, certainty: { baseline: [], alternative: [{ option_id: 'raise_pro_price_to_59', probability_of_goal: 1, earned: true }] } });
    expect(reply.split('\n')[0]).toBe('Without the link from Monthly churn to Paying subscribers, Raise Pro price to £59 still leads — but part of the result changes.');
    expect(reply).toContain('baseline: Reaches the target in about 53% of model runs. Without the link: Reaches the target in 100% of model runs.');
    // DL beat-4 audit: no unitless amount; the direction and the target crossing the claim's own side test proves.
    expect(reply).toContain('Raise Pro price to £59\'s expected result is higher without the link, and moves from below your target to above it.');
    expect(reply).not.toMatch(/83,434|90,306|85,000/);
    expect(reply).toContain('doesn\'t say which version of the model is right');
    expect(reply).toContain('This test isn\'t saved.');
    expect(reply).toContain('What evidence do you have for the link from Monthly churn to Paying subscribers?');
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
      return { kind: 'result', result: changed, labels: LABELS, finalRead: finalRead(), baselineRunIdentity: BASELINE_IDENTITY, candidateLeaderLicence: 'permitted' as const };
    });
    expect(asked).toEqual([{ from_id: 'monthly_churn', to_id: 'paying_subscribers' }]);
    expect(turn?.outcome).toBe('completed');
    expect(turn?.reply.split('\n')[0]).toContain('still leads');
    expect(turn?.actions.map((a) => a.id)).toEqual(['agent-talk-it-through']);
    expect(await structuralChallengeTurnFor('agent-next-what-would-change', async () => { throw new Error('never'); })).toBeNull();
    const none = await structuralChallengeTurnFor(structuralChallengePressId({ from_id: 'a', to_id: 'b' }), async () => ({ kind: 'no_run' }));
    expect(none).toMatchObject({ outcome: 'no_run', reply: STRUCTURAL_CHALLENGE_NO_RUN_REPLY, result: null });
  });

  it.each([
    ['driver_retention::goal_value', [{ from_id: 'driver_retention', to_id: 'goal_value' }]],
    ['a:::b', [{ from_id: 'a', to_id: ':b' }, { from_id: 'a:', to_id: 'b' }]],
    ['a::b::c', [{ from_id: 'a', to_id: 'b::c' }, { from_id: 'a::b', to_id: 'c' }]],
    ['a::::b', [{ from_id: 'a', to_id: '::b' }, { from_id: 'a:', to_id: ':b' }, { from_id: 'a::', to_id: 'b' }]],
    [':::b', [{ from_id: ':', to_id: 'b' }]],
  ])('legacy grammar enumerates every valid split, including overlaps: %s', (suffix, legacyCandidates) => {
    expect(parseStructuralChallengePress(`agent-test-without-link:${suffix}`)).toEqual({ legacyCandidates });
  });

  it.each(['a::a', 'A::b', 'a?::b', 'a::', 'a'.repeat(201) + '::b', 'a|b', '["a"]', '{"from_id":"a","to_id":"b"}'])('legacy grammar rejects invalid or third-format suffixes: %s', (suffix) => {
    expect(parseStructuralChallengePress(`agent-test-without-link:${suffix}`)).toBeNull();
  });

  it('legacy grammar cannot dispatch before graph resolution', async () => {
    const ask = vi.fn(async () => ({ kind: 'no_run' as const }));
    expect(await structuralChallengeTurnFor('agent-test-without-link:a:::b', ask)).toMatchObject({ outcome: 'unsupported', result: null });
    expect(ask).not.toHaveBeenCalled();
  });

  it.each([
    ['legacy', 'agent-test-without-link:a:::b'],
    ['canonical', structuralChallengePressId({ from_id: 'a', to_id: 'b' })],
  ])('a resolved link outside the %s press candidates refuses without dispatch', async (_grammar, chip) => {
    const ask = vi.fn(async () => ({ kind: 'no_run' as const }));
    const press = parseStructuralChallengePress(chip);
    const turn = await structuralChallengeTurnFor(chip, ask, { press, resolvedLink: { from_id: 'other', to_id: 'b' } });
    expect(turn).toMatchObject({ outcome: 'unsupported', result: null });
    expect(turn?.reply).toContain('Nothing in your model changed.');
    expect(ask).not.toHaveBeenCalled();
  });

  it('a supplied parse result is consumed without parsing the chip again', async () => {
    const ask = vi.fn(async () => ({ kind: 'no_run' as const }));
    const chip = { toString: () => { throw new Error('must not parse'); } };
    const link = { from_id: 'a', to_id: 'b' };
    expect(await structuralChallengeTurnFor(chip, ask, { press: link })).toMatchObject({ outcome: 'no_run' });
    expect(ask).toHaveBeenCalledExactlyOnceWith(link);
  });

  it('legacy maximum suffix is bounded before enumeration and canonical JSON parsing', () => {
    const maximum = `${'a'.repeat(200)}::${'b'.repeat(200)}`;
    expect(parseStructuralChallengePress(`agent-test-without-link:${maximum}`)).toEqual({ legacyCandidates: [
      { from_id: 'a'.repeat(200), to_id: 'b'.repeat(200) },
    ] });
    expect(parseStructuralChallengePress(`agent-test-without-link:${maximum}b`)).toBeNull();
  });

  it('canonical JSON keeps base compatibility: 200-char ids, whitespace and \\u escapes parse; only an oversize suffix is refused', () => {
    const link = { from_id: 'a'.repeat(200), to_id: 'b'.repeat(200) };
    const press = structuralChallengePressId(link);
    expect(press.length - 'agent-test-without-link:'.length).toBe(407);
    expect(parseStructuralChallengePress(press)).toEqual(link);
    expect(parseStructuralChallengePress(`${press} `)).toEqual(link);
    const escaped = (id: string) => [...id].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
    expect(parseStructuralChallengePress(`agent-test-without-link:["${escaped(link.from_id)}","${escaped(link.to_id)}"]`)).toEqual(link);
    expect(parseStructuralChallengePress(`agent-test-without-link:[ "monthly_churn" , "mrr" ]`)).toEqual({ from_id: 'monthly_churn', to_id: 'mrr' });
    expect(parseStructuralChallengePress(`agent-test-without-link:${' '.repeat(4097)}`)).toBeNull();
  });

  it('the final licence only narrows: a leader withheld at the final read is withheld in the result and the reply', async () => {
    const turn = await structuralChallengeTurnFor(structuralChallengePressId({ from_id: 'monthly_churn', to_id: 'paying_subscribers' }), async () => ({ kind: 'result', result: changed, labels: LABELS, finalRead: finalRead(), baselineRunIdentity: BASELINE_IDENTITY, candidateLeaderLicence: 'permitted' as const }));
    if (turn === null) throw new Error('expected a turn');
    expect(structuralChallengeTurnUnderLicence(turn, finalRead()).result).toEqual(turn.result);
    const narrowed = structuralChallengeTurnUnderLicence(turn, finalRead(false));
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
    const turn = await structuralChallengeTurnFor(structuralChallengePressId({ from_id: 'a', to_id: 'b' }), async () => ({ kind: 'result', result, labels: LABELS, certainty, finalRead: finalRead(), baselineRunIdentity: BASELINE_IDENTITY, candidateLeaderLicence: 'permitted' as const }));
    if (turn === null) throw new Error('missing turn');
    expect(turn.certainty).toEqual(certainty);
    for (const reply of [turn.reply, structuralChallengeTurnUnderLicence(turn, finalRead(false)).reply]) {
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
    expect(reply).toContain('At least one model version has no usable measurement for this claim');
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
    const turn = await structuralChallengeTurnFor(structuralChallengePressId({ from_id: 'a', to_id: 'b' }), async () => ({ kind: 'result', result, labels: LABELS, finalRead: finalRead(), baselineRunIdentity: BASELINE_IDENTITY, candidateLeaderLicence: 'permitted' as const }));
    if (turn === null) throw new Error('missing turn');
    expect(structuralChallengeTurnUnderLicence(turn, finalRead()).result).toEqual(result);
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
      expect(await structuralChallengeTurnFor(press, ask)).toMatchObject({ outcome: 'unsupported', result: null, reply: "I can't tell which link this is, so I can't test it. Nothing in your model changed." });
    }
    expect(parseStructuralChallengePress('agent-test-without-link:a::a')).toBeNull();
    expect(ask).not.toHaveBeenCalled();
    expect(structuralChallengePressId({ from_id: 'a::b', to_id: 'c' })).not.toBe(structuralChallengePressId({ from_id: 'a', to_id: 'b::c' }));
  });
});


describe('review closure: final presentation is bound to its baseline execution and full licence', () => {
  const completed = async (candidateLeaderLicence: 'permitted' | 'permitted_with_caveat' | 'withheld' = 'permitted') => {
    const turn = await structuralChallengeTurnFor(structuralChallengePressId(BASE.alternative), async () => ({
      kind: 'result', result: changed, labels: LABELS, finalRead: finalRead(), baselineRunIdentity: BASELINE_IDENTITY, candidateLeaderLicence,
    }));
    if (turn === null) throw new Error('expected turn');
    return turn;
  };
  it.each(['newer_run', 'scenario', 'hash', 'stale', 'scope', 'permission_unavailable', 'durable_unavailable', 'missing_read', 'digest', 'seed', 'budget', 'same_run_new_time', 'missing_baseline_identity', 'none', 'exploratory', 'malformed_mode'] as const)(
    'P1-1: final %s clears every conclusion and preserves the challenged Run identity', async (negative) => {
      const turn = await completed();
      const read = finalRead();
      const current = read.currentness!;
      const run = (current.fact as any).result;
      if (negative === 'same_run_new_time') run.computed_at = '2026-10-04T10:01:00.000Z';
      if (negative === 'newer_run') run.run_id = 'newer-run';
      if (negative === 'scenario') run.scenario_id = 'other-scenario';
      if (negative === 'hash') run.graph_hash_at_run = 'f'.repeat(16);
      if (negative === 'stale') (read.read.analysis_state as any).run_state = { kind: 'complete_stale' };
      if (negative === 'scope') (current as any).permissions = {
        leader_may_be_named: false, total_goal_claims_allowed: false, exploratory_work_allowed: true,
        permitted_analysis_mode: 'comparative_leader', withheld_reason: 'goal_scope_unresolved',
      };
      if (negative === 'none' || negative === 'exploratory' || negative === 'malformed_mode') (current as any).permissions.permitted_analysis_mode = negative;
      if (negative === 'permission_unavailable') delete (current as any).permissions;
      if (negative === 'durable_unavailable') (current as any).readOk = false;
      if (negative === 'digest') run.input_snapshot.sent_digest = 'a'.repeat(64);
      if (negative === 'seed') run.enrichment.meta.seed_used = '2';
      if (negative === 'budget') run.enrichment.meta.n_samples = 5000;
      const output = structuralChallengeTurnUnderLicence(negative === 'missing_baseline_identity' ? { ...turn, baselineRunIdentity: undefined } : turn, negative === 'missing_read' ? undefined : read);
      const status = ['newer_run', 'scenario', 'hash', 'stale', 'same_run_new_time'].includes(negative) ? 'stale' : ['scope', 'none', 'exploratory'].includes(negative) ? 'withheld' : 'failed';
      expect(output).toMatchObject({ outcome: status, result: { status, baseline: BASE.baseline,
        claims: [], pair_provenance: null, not_compared: [] } });
      expect(StructuralChallengeResultV1Schema.parse(output.result)).toEqual(output.result);
      expect(output.reply).not.toContain('Raise Pro price to £59');
      expect(output.reply).not.toContain('85,000');
      expect(output.reply).not.toContain('What changes:');
      expect(output.certainty).toBeUndefined();
    },
  );
  it.each(['baseline', 'candidate'] as const)('P1-1: %s caveat is carried in every sentence naming a leader', async (side) => {
    const turn = await completed(side === 'candidate' ? 'permitted_with_caveat' : 'permitted');
    const output = structuralChallengeTurnUnderLicence(turn, finalRead(true, side === 'baseline'));
    expect(output.outcome).toBe('completed');
    for (const sentence of output.reply.split('\n').filter((line) => line.includes('still leads') || line.includes('leads in both versions'))) {
      expect(sentence).toContain('as a provisional finding on Olumi’s starting estimates');
    }
    expect(output.reply).toContain('as a provisional finding on Olumi’s starting estimates');
  });
  it('P1-1: missing late authority cannot be treated as an already permitted dispatch', async () => {
    const output = await structuralChallengeTurnFor(structuralChallengePressId(BASE.alternative), async () => ({
      kind: 'result', result: changed, labels: LABELS, candidateLeaderLicence: 'permitted',
    }));
    expect(output).toMatchObject({ outcome: 'failed', result: { baseline: BASE.baseline, reason: 'probe_unavailable', claims: [] } });
  });
  it('P1-1: quantified provisional figures keep their caveat even when no leader is licensed', async () => {
    const turn = await completed();
    const read = finalRead(false, true);
    const output = structuralChallengeTurnUnderLicence(turn, read);
    expect(output.result?.baseline.run_id).toBe(BASE.baseline.run_id);
    expect(output.reply).toContain('The figures are provisional estimates from these two model versions.');
    expect(output.reply).not.toContain('still leads');
    // The outcome line is present, as a direction (never a unitless amount).
    expect(output.reply).toContain('expected result is higher without the link');
  });

  it.each([
    // [name, baseline, alternative, target, verdict, basis, noise, expected words] — every claim parsed against the contract.
    ['the same', 85500, 85500, 85000, 'holds', 'same_side_of_target', 'within_noise', 'is the same without the link, and stays above your target.'],
    ['stays above', 90000, 87000, 85000, 'holds', 'same_side_of_target', 'signal', 'is lower without the link, and stays above your target.'],
    ['no target (the served beat-4 shape)', 0.0213, -0.0031, null, 'delta_only', 'no_licensed_boundary', 'signal', 'is lower without the link.'],
    ['unavailable without the link', 0.0213, null, null, 'not_comparable', 'missing_on_one_side', 'not_noise_qualified', 'is unavailable without the link.'],
    ['not comparable (Codex P1)', 100, 1, null, 'not_comparable', 'identity_status_changed', 'not_noise_qualified', 'can\'t be compared between the two versions.'],
  ] as const)('DL beat-4 audit: an outcome level reads as a direction only when comparable (%s), never a number', (_name, baseline, alternative, target, verdict, basis, noise_verdict, words) => {
    const claim = { ...changed.claims.find((c) => c.kind === 'outcome_level')!, baseline, alternative, target, verdict, basis, noise_verdict };
    const result = StructuralChallengeResultV1Schema.parse({ ...changed, claims: [changed.claims[0]!, claim] });
    const reply = composeStructuralChallengeReply({ result, labels: LABELS });
    expect(reply).toContain(`Raise Pro price to £59's expected result ${words}`);
    expect(reply).not.toMatch(/expected result is -?\d/);
    if (verdict === 'not_comparable') expect(reply).not.toMatch(/expected result is (higher|lower|the same)/);
  });
  it.each(['leader', 'goal_probability', 'outcome_level', 'constraint_probability'] as const)(
    'P1-4 / prior #4: %s change names its observed claim and discloses unpaired sampling without dependency prose', async (kind) => {
      const quantities = changed.claims.filter((c) => c.kind !== 'leader');
      const source = kind === 'leader' ? { ...changed.claims[0], alternative_option_id: 'status_quo', verdict: 'changes', basis: 'leader_changed' }
        : { ...quantities.find((c) => c.kind === kind)!, option_id: 'status_quo', verdict: 'changes',
          basis: kind === 'constraint_probability' ? 'constraint_side_changed' : kind === 'goal_probability' ? 'certainty_boundary_crossed' : 'target_crossed',
          noise_verdict: 'signal', invariant_by_construction: false,
          ...(kind === 'constraint_probability' ? { constraint_boundary: { probability_threshold: 0.9, operator: '>=' }, baseline: 0.8, alternative: 0.99 } : {}) };
      const result = { ...changed, claims: kind === 'leader' ? [source] : [changed.claims[0], source] } as StructuralChallengeResultV1;
      expect(StructuralChallengeResultV1Schema.parse(result)).toEqual(result);
      const turn = await structuralChallengeTurnFor(structuralChallengePressId(BASE.alternative), async () => ({ kind: 'result', result,
        labels: LABELS, finalRead: finalRead(), baselineRunIdentity: BASELINE_IDENTITY, candidateLeaderLicence: 'permitted' }));
      expect(turn?.result?.baseline.run_id).toBe(BASE.baseline.run_id);
      expect(turn?.reply).toContain('The two Runs are separately sampled (unpaired).');
      const next = turn!.reply.split('\n').find((line) => line.startsWith('Next step:'))!;
      expect(next).toContain(kind === 'leader' ? 'which option leads' : kind === 'goal_probability' ? 'Status quo’s target certainty'
        : kind === 'outcome_level' ? 'Status quo’s position relative to the target' : 'Status quo’s frequency within c');
      expect(turn?.reply).not.toMatch(/rests on|depends on|doesn.t depend|independent of/i);
    },
  );
});

describe('repeated structural challenge licence adaptation only narrows', () => {
  const caveat = ', as a provisional finding on Olumi’s starting estimates';
  const disclosure = 'The figures are provisional estimates from these two model versions.';
  const completed = (): StructuralChallengeTurn => ({
    reply: composeStructuralChallengeReply({ result: changed, labels: LABELS }), outcome: 'completed', result: changed,
    labels: LABELS, actions: [TALK_IT_THROUGH_CHIP], baselineRunIdentity: BASELINE_IDENTITY, candidateLeaderLicence: 'permitted',
  });

  it('L1: provisional then plain keeps the caveated presentation byte for byte', () => {
    const first = structuralChallengeTurnUnderLicence(completed(), finalRead(true, true));
    expect(first.outcome).toBe('completed');
    expect(first.reply).toContain(caveat);
    expect(first.reply).toContain(disclosure);
    const second = structuralChallengeTurnUnderLicence(first, finalRead());
    expect(second.reply).toBe(first.reply);
    expect(second.presentedLicence).toBe('permitted_with_caveat');
  });

  it('L2: plain then plain stays permitted without a caveat', () => {
    const first = structuralChallengeTurnUnderLicence(completed(), finalRead());
    const second = structuralChallengeTurnUnderLicence(first, finalRead());
    expect(second.reply).toBe(first.reply);
    expect(second.reply).not.toContain(caveat);
    expect(second.reply).not.toContain(disclosure);
    expect(second.presentedLicence).toBe('permitted');
  });

  it.each([false, true])('L3: withheld then plain stays withheld (provisional figures: %s)', (provisional) => {
    const first = structuralChallengeTurnUnderLicence(completed(), finalRead(false, provisional));
    expect(first.outcome).toBe('completed');
    expect(first.result?.claims.find((claim) => claim.kind === 'leader')).toMatchObject({
      baseline_option_id: null, alternative_option_id: null, verdict: 'not_comparable', basis: 'withheld_on_one_side',
    });
    expect(first.reply).toContain('Which option leads cannot be compared. At least one run withheld this claim.');
    if (provisional) expect(first.reply).toContain(disclosure);
    const second = structuralChallengeTurnUnderLicence(first, finalRead());
    expect(second.result?.claims.find((claim) => claim.kind === 'leader')).toEqual(first.result?.claims.find((claim) => claim.kind === 'leader'));
    expect(second.reply).toBe(first.reply);
  });
});

/** Replay must preserve safe refusals and rebind conclusions, rather than infer a result from recorded prose. */
describe('structural challenge replay under a fresh receipt', () => {
  const remembered = (): StructuralChallengeTurn => structuralChallengeTurnUnderLicence({
    reply: composeStructuralChallengeReply({ result: changed, labels: LABELS }), outcome: 'completed', result: changed,
    labels: LABELS, actions: [TALK_IT_THROUGH_CHIP], baselineRunIdentity: BASELINE_IDENTITY, candidateLeaderLicence: 'permitted',
  }, finalRead());

  function unbound(turn: StructuralChallengeTurn) {
    expect(turn.reply).toBe(STRUCTURAL_CHALLENGE_REPLAY_UNBOUND_REPLY);
    expect(turn.reply).not.toContain('What I tested:');
    expect(turn.outcome).toBe('failed');
    expect(turn.result).toBeNull();
    expect(turn.labels).toEqual(new Map());
    expect(turn.actions).toEqual([TALK_IT_THROUGH_CHIP]);
  }

  it('has no conclusion without remembered authority or a readable fresh receipt', () => {
    unbound(structuralChallengeReplay(undefined, undefined));
    unbound(structuralChallengeReplay(remembered(), undefined));
  });
  it('re-presents the same current Run byte for byte', () => {
    const turn = remembered();
    expect(structuralChallengeReplay(turn, finalRead()).reply).toBe(turn.reply);
  });
  it('replaces a conclusion bound to an older Run with the exact unbound reply', () => {
    const receipt = finalRead();
    (receipt.currentness!.fact as unknown as { result: Record<string, unknown> }).result.run_id = 'newer-run';
    unbound(structuralChallengeReplay(remembered(), receipt));
  });
  it('keeps a freshly withheld result rather than restoring the comparison', () => {
    const read = finalRead();
    const receipt: StructuralChallengeFinalRead = { ...read, currentness: { ...read.currentness!,
      permissions: { ...read.currentness!.permissions!, total_goal_claims_allowed: false } } };
    const turn = structuralChallengeReplay(remembered(), receipt);
    expect(turn.result?.status).toBe('withheld');
    expect(turn.reply).toBe('The current analysis permission does not allow this comparison to be shown, so there is no conclusion to report. Nothing in your model changed.');
    expect(turn.reply).not.toContain('What I tested:');
  });
  it.each(['unsupported', 'failed', 'stale', 'timed_out', 'withheld'] as const)('preserves an already %s turn unchanged without a receipt', (status) => {
    const result = { ...changed, status, reason: null, claims: [], pair_provenance: null, not_compared: [] };
    const turn: StructuralChallengeTurn = { ...remembered(), outcome: status, result,
      reply: composeStructuralChallengeReply({ result, labels: LABELS }) };
    expect(structuralChallengeReplay(turn, undefined)).toBe(turn);
  });
  it('preserves a no-Run refusal unchanged without a receipt', () => {
    const turn: StructuralChallengeTurn = { reply: STRUCTURAL_CHALLENGE_NO_RUN_REPLY, outcome: 'no_run', result: null,
      labels: new Map(), actions: [] };
    expect(structuralChallengeReplay(turn, undefined)).toBe(turn);
  });
});
