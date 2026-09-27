/**
 * ⭐ WHEN EVERY OPTION BREAKS THE LIMIT, THE ONE NEXT MOVE IS "CHANGE THE LIMIT OR AN OPTION" — RED-first (served 27 Sep).
 *
 * THE DEFECT (R&C dloop-3, UI 2bec4c47 · CEE bd86f49, #70 5851348637): Paul's brief, then "Our monthly churn is
 * actually 12%.", approve, re-run. The run's typed verdict was `leader_claim.withheld_reason: no_option_meets_limit`
 * (F-LIMIT, #2058) and the reply said "every analysed option fails your limit of at most 10%" — yet the one card was
 * "Check an assumption Olumi made" on Pro plan price → MRR. `leaderWithheldForALimit` matches only
 * `constraint_verdict_withheld`, so both F-LIMIT tiers fell through to the link cards: the card pointed at a link that
 * cannot change the limit verdict, and nothing on screen offered the move that can.
 *
 * THE RULE: when the readback's typed claim says every option breaks the same limit (tier 1) or would probably break
 * it (tier 2), the limit card is the turn's one card, in that tier's words, and its action is the move the Agent's own
 * fail-closed sentence names (`withheld-leader-fail-closed.ts`): change that limit or one of the options — offered for
 * the user's approval, changing nothing until they approve. Tier 2 never says "meets".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runTurnCoaching, type CapturedAnalysis, type RunTurnCoachingFinal } from '../analysis-coaching-pass-through.js';
import { composeLimitUncheckedCard } from '../../coaching/limit-unchecked-card.js';
import { RUN_TURN_COACHING_CONTRACT } from '../../coaching/fragile-link-challenge.js';

type Served = {
  graph_hash: string;
  analysis_state: Record<string, unknown> & { leader_claim: Record<string, unknown> };
  analysis_result: Record<string, unknown>;
  analysis_ready: unknown;
  draft_graph: Record<string, unknown>;
  served_card_signal_id: string;
};
// Verbatim wire fields of the served re-run turn (dloop-3 04d-rerun: analysis_state, the analysis_result block,
// analysis_ready, draft_graph, graph_hash).
const served = JSON.parse(readFileSync(
  new URL('../../coaching/__tests__/fixtures/served-rerun-no-option-meets-limit-20260927.json', import.meta.url), 'utf8',
)) as Served;

const withReason = (withheld_reason: string) => {
  const state = { ...served.analysis_state, leader_claim: { ...served.analysis_state.leader_claim, withheld_reason } };
  const captured: CapturedAnalysis = {
    scenario_id: 'dloop-3', status: 200, trigger: 'explicit_run',
    analysis_state: state, analysis_ready: served.analysis_ready, blocks: [served.analysis_result],
  };
  const final: RunTurnCoachingFinal = {
    scenarioId: 'dloop-3', graphHash: served.graph_hash, analysisState: state,
    analysisResult: served.analysis_result, graph: served.draft_graph,
  };
  return runTurnCoaching(captured, final);
};
const runCards = (blocks: readonly { signal_id: string }[]) =>
  blocks.filter((b) => /^coach:(fragile_link|no_flagged_link|limit_unchecked|near_tie):/.test(b.signal_id));
const LIMIT = '“Monthly churn rate” (10%)';
const NEXT_MOVE = 'change that limit or one of the options';
const HOLDS = /change nothing until I (do|approve)/;

describe('every option breaks the limit: the limit card, not a link card', () => {
  it('precondition: the served claim is tier 1, on a run bound to the served graph', () => {
    expect(served.analysis_state.leader_claim).toMatchObject({ permitted: false, withheld_reason: 'no_option_meets_limit' });
    expect(served.analysis_result.computed_against_hash).toBe(served.graph_hash);
  });

  it('CONTRAST: the same served run under a non-limit reason still picks the served link card (the fixture rebinds)', () => {
    const cards = runCards(withReason('nonlinear_identity_sign_unproven').blocks);
    expect(cards.map((c) => c.signal_id)).toEqual([served.served_card_signal_id]);
  });

  it('RED: tier 1 (served) — one limit card that says no option meets the named limit and offers the next move', () => {
    const out = withReason('no_option_meets_limit');
    const cards = runCards(out.blocks) as Array<{ signal_id: string; title: string; body: string; action_label: string; action_prompt: string }>;
    expect(cards).toHaveLength(1);
    const [card] = cards;
    expect(card!.signal_id.startsWith('coach:limit_unchecked:')).toBe(true);
    expect(card!.signal_id.endsWith(':named:none_meets')).toBe(true);
    expect(card!.title).toBe('No option meets your limit');
    expect(card!.body).toContain(`no option meets your limit on ${LIMIT}`);
    expect(card!.action_prompt).toContain(NEXT_MOVE);
    expect(card!.action_prompt).toMatch(HOLDS);
    expect(card!.action_prompt).not.toMatch(/re-run|run (it|the analysis) again/i);
  });

  it('RED: tier 2 — "would probably break", never "meets"', () => {
    const cards = runCards(withReason('every_option_likely_breaks_limit').blocks) as Array<{ signal_id: string; title: string; body: string; action_prompt: string }>;
    expect(cards).toHaveLength(1);
    const [card] = cards;
    expect(card!.signal_id.endsWith(':named:likely_breaks')).toBe(true);
    expect(card!.body).toContain(`every option would probably break your limit on ${LIMIT}`);
    expect(`${card!.title} ${card!.body} ${card!.action_prompt}`).not.toMatch(/\bmeets?\b/);
    expect(card!.action_prompt).toContain(NEXT_MOVE);
    expect(card!.action_prompt).toMatch(HOLDS);
  });

  it('two limits: tier 1 says "all of your limits", tier 2 "one of your limits" (which one is not on the card)', () => {
    const two = [{ label: 'Churn', stated: '10%' }, { label: 'Budget', stated: null }];
    const none = composeLimitUncheckedCard(false, two, 'none_meets');
    const likely = composeLimitUncheckedCard(false, two, 'likely_breaks');
    expect(none.body).toContain('no option meets all of your limits on “Churn” (10%) and “Budget”');
    expect(likely.body).toContain('every option would probably break one of your limits on “Churn” (10%) and “Budget”');
    for (const c of [none, likely, composeLimitUncheckedCard(true, undefined, 'none_meets'), composeLimitUncheckedCard(false, undefined, 'likely_breaks')]) {
      expect(c.title.length).toBeLessThanOrEqual(RUN_TURN_COACHING_CONTRACT.limits.title_max);
      expect(c.body.length).toBeLessThanOrEqual(RUN_TURN_COACHING_CONTRACT.limits.body_max);
      expect(c.action_label.length).toBeLessThanOrEqual(RUN_TURN_COACHING_CONTRACT.limits.action_label_max);
      expect(c.action_prompt.length).toBeLessThanOrEqual(RUN_TURN_COACHING_CONTRACT.limits.action_prompt_max);
    }
  });
});
