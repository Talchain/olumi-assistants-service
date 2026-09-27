/**
 * ⭐ C4 — THE LIMIT CAVEAT IS SAID ONCE, ON THE MOVE CARD (R&C finding #70 5859409296; DL 5859428786 item 4).
 *
 * SERVED (R&C served check, CEE 9bd3747, Paul's pricing brief, auto first pass): `_diagnostic_trace.coaching_caveats`
 * held the churn limit's "could not be checked" card, the one card was the churn → subscribers link, and the reply
 * never said the limit went unchecked. C4 moved the notice off the card for "the reply says it once" (Runtime's C1
 * hook, not built), so the user was told NOWHERE.
 *
 * THE RULE (`coaching/next-move.ts` `withCaveatSentence`): while a caveat rides with a move, the move card's body opens
 * with the limit card's OWN finding ("This first pass on Olumi's estimates could not check your limit on …"), then the
 * move's words without the shared first-pass opening. Same builder's words, no new warning logic; ≤ body_max or the
 * card is unchanged (the caveat stays in `caveats` for the reply either way).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runTurnNextMove, type CapturedAnalysis, type RunTurnCoachingFinal } from '../analysis-coaching-pass-through.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { COACHING_BLOCK_BODY_MAX } from '../../coaching/fragile-edge-offer-text.js';
import { withCaveatSentence } from '../../coaching/next-move.js';

type Rec = Record<string, any>;
const load = (name: string): Rec => JSON.parse(readFileSync(
  new URL(`../../coaching/__tests__/fixtures/${name}`, import.meta.url), 'utf8',
)) as Rec;
const args = (f: Rec): [CapturedAnalysis, RunTurnCoachingFinal] => {
  const result = { ...f.analysis_result, computed_against_hash: f.graph_hash };
  return [
    { scenario_id: 's', status: 200, trigger: f.trigger, analysis_state: f.analysis_state, analysis_ready: f.analysis_ready, blocks: [result] },
    { scenarioId: 's', graphHash: f.graph_hash, analysisState: f.analysis_state, analysisResult: result, graph: f.draft_graph, constraintVerdictState: f.constraint_verdict_state },
  ];
};
const cards = (blocks: readonly { signal_id: string }[]) => blocks.filter((b) => /^coach:[a-z_]+:/.test(b.signal_id)) as Rec[];

describe('C4: the limit caveat is said once, on the move card (served Paul, CEE 9bd3747)', () => {
  const f = load('served-paul-9bd3747-caveat.json');

  it('precondition: the served graph is the run\'s; the served turn carried the limit caveat and a link card that never said it', () => {
    expect(computeAnalysisAffectingGraphHash(f.draft_graph as never)).toBe(f.graph_hash);
    expect(f.served_caveat_signal_ids).toHaveLength(1);
    expect(f.served_caveat_signal_ids[0].startsWith('coach:limit_unchecked:')).toBe(true);
    expect(f.served_card_signal_ids[0].startsWith('coach:fragile_link:monthly_churn→pro_paying_subscribers:')).toBe(true);
    expect(f.served_card_body).not.toMatch(/limit/i);
  });

  it('RED: ONE card — the same move (same signal id) — whose body says the limit went unchecked, then the move', () => {
    const r = runTurnNextMove(...args(f));
    const got = cards(r.blocks);
    expect(got).toHaveLength(1);
    expect(got[0]!.signal_id).toBe(f.served_card_signal_ids[0]);
    expect(got[0]!.body).toBe(
      'This first pass on Olumi\'s estimates could not check your limit on “Monthly churn” (10%). '
      + 'The robustness check flagged the link from Monthly churn to Pro paying subscribers as sensitive, and some of its numbers are starting assumptions — worth saying what you believe about it.',
    );
    expect(got[0]!.body.length).toBeLessThanOrEqual(COACHING_BLOCK_BODY_MAX);
    expect(r.nextMove!.block.body).toBe(got[0]!.body);
  });

  it('the caveat stays typed for the reply (Runtime C1): same signal id, same words as before', () => {
    const r = runTurnNextMove(...args(f));
    expect(r.caveats.map((c) => c.block.signal_id)).toEqual(f.served_caveat_signal_ids);
    expect(r.caveats[0]!.block.title).toBe('Your limit could not be checked');
  });
});

describe('CONTRASTS', () => {
  it('no caveat (served hiring, CEE 9bd3747): the move card body is untouched', () => {
    const h = load('served-hiring-9bd3747-link-not-in-model.json');
    const withEdge: Rec = { ...h, draft_graph: { ...h.draft_graph, edges: [...h.draft_graph.edges, { ...h.draft_graph.edges.find((e: Rec) => e.to === 'delivery_capacity'), from: 'tech_lead_hires_change_from_today', to: 'delivery_capacity' }] } };
    withEdge.graph_hash = computeAnalysisAffectingGraphHash(withEdge.draft_graph as never);
    const r = runTurnNextMove(...args(withEdge));
    expect(r.caveats).toEqual([]);
    expect(r.nextMove!.block.body.startsWith('Before relying on this first pass on Olumi\'s estimates, note that ')).toBe(true);
    expect(r.nextMove!.block.body).not.toMatch(/limit/i);
  });

  it('too long with the limits named → the SAME finding without the list (the one-limit form)', () => {
    const long = JSON.parse(JSON.stringify(load('served-paul-9bd3747-caveat.json')));
    const churn = long.draft_graph.nodes.find((n: Rec) => n.id === 'monthly_churn');
    churn.label = 'Monthly churn of paying Pro-plan subscribers measured across every billing region and plan tier';
    long.graph_hash = computeAnalysisAffectingGraphHash(long.draft_graph as never);
    const r = runTurnNextMove(...args(long));
    expect(r.caveats).toHaveLength(1);
    expect(r.nextMove!.block.body.startsWith('This first pass on Olumi\'s estimates could not check your limit. ')).toBe(true);
    expect(r.nextMove!.block.body.length).toBeLessThanOrEqual(COACHING_BLOCK_BODY_MAX);
  });

  it('when neither form fits, the move card is unchanged (the caveat stays in `caveats`)', () => {
    const f = load('served-paul-9bd3747-caveat.json');
    const r = runTurnNextMove(...args(f));
    const long = { ...r.nextMove!, block: { ...r.nextMove!.block, body: `${'x'.repeat(COACHING_BLOCK_BODY_MAX - 10)}.` } };
    expect(withCaveatSentence(long, r.caveats)).toBe(long);
    expect(withCaveatSentence(long, [])).toBe(long);
  });
});

describe('Paul\'s own C4 runs: every run with a caveat says it on the one card', () => {
  const body = (id: string): string => {
    const f = load(`paul-run-${id}-next-move.json`);
    return runTurnNextMove(...args(f)).nextMove!.block.body;
  };
  it('90b8f080 (one limit, missing level): the named form', () => {
    expect(body('90b8f080')).toBe('This analysis could not check your limit on “Monthly churn” (4%). This analysis did not test “£59 for new Pro customers; grandfather existing customers”: it has no level yet for “Existing customers grandfathered”, so the result does not cover it.');
  });
  it('08bf9a1f (two limits, link view; the named form is 334 chars): the short form', () => {
    expect(body('08bf9a1f')).toBe('This analysis could not check at least one of your limits. The robustness check flagged the link from Pro plan price to Price sensitivity as sensitive, and some of its numbers are Olumi\'s starting assumptions — worth saying what you believe about it.');
  });
  it('17d1cd3a (no caveat): unchanged', () => {
    expect(body('17d1cd3a')).toMatch(/^Your limit on “Monthly churn” was checked against Olumi's estimate/);
  });
});
