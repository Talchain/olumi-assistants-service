/**
 * ⭐ B5 CONSUMER — "could not check" is said ONLY for a limit that was not checked (R&C wire finding #72 5861120960;
 * MG 5861148718: `estimate_only` = CHECKED against a figure that is not the user's; DL GO 5861158484).
 *
 * RED on the SERVED capture of the DL-authorised wire check (journey C's C01 brief, CEE 08fbba5): both limits'
 * per-limit rows were `estimate_only / level_olumi_estimate`, yet the reply said "could not check at least one of your
 * limits" and the move was a link view. The limit on the factor the result depends on most (Monthly churn, PLoT r1,
 * Olumi's 3%) is the consequential ask: "your limit was checked against Olumi's estimate — what is the real figure?".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runTurnNextMove, type CapturedAnalysis, type RunTurnCoachingFinal } from '../analysis-coaching-pass-through.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { estimatedLimitFromVerdicts } from '../../coaching/estimated-limit-card.js';

type Rec = Record<string, any>;
const F = JSON.parse(readFileSync(
  new URL('../../coaching/__tests__/fixtures/served-c01-08fbba5-per-limit-estimate-only.json', import.meta.url), 'utf8',
)) as Rec;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const args = (f: Rec, over: Partial<RunTurnCoachingFinal> = {}): [CapturedAnalysis, RunTurnCoachingFinal] => {
  const result = { ...f.analysis_result, computed_against_hash: f.graph_hash };
  return [
    { scenario_id: 's', status: 200, trigger: f.trigger, analysis_state: f.analysis_state, analysis_ready: f.analysis_ready, blocks: [result] },
    { scenarioId: 's', graphHash: f.graph_hash, analysisState: f.analysis_state, analysisResult: result, graph: f.draft_graph, limitVerdicts: f.limit_verdicts, ...over },
  ];
};
const cards = (blocks: readonly { signal_id: string }[]) => blocks.filter((b) => /^coach:[a-z_]+:/.test(b.signal_id)) as Rec[];
const CHURN = 'agent-lane:monthly_churn:<=';
const SPEND = 'agent-lane:six_month_investment_spend:<=';
const withRow = (f: Rec, id: string, row: Rec): Rec => {
  const g = clone(f);
  g.limit_verdicts.per_limit = g.limit_verdicts.per_limit.map((r: Rec) => (r.constraint_id === id ? { constraint_id: id, ...row } : r));
  return g;
};

describe('precondition: the served C01 wire capture (CEE 08fbba5)', () => {
  it('bound graph; both limits CHECKED only against Olumi\'s estimates; served "could not check" + a link view', () => {
    expect(computeAnalysisAffectingGraphHash(F.draft_graph as never)).toBe(F.graph_hash);
    expect(F.limit_verdicts.per_limit).toEqual([
      { constraint_id: SPEND, state: 'estimate_only', reason: 'level_olumi_estimate' },
      { constraint_id: CHURN, state: 'estimate_only', reason: 'level_olumi_estimate' },
    ]);
    expect(F.served_next_move).toBe('link_view');
    expect(F.served_caveats[0]).toMatch(/^coach:limit_unchecked:/);
  });
});

describe('the per-limit rows decide (B5)', () => {
  it('RED: no false "could not check"; the move is the real figure for the r1 limit (Monthly churn, Olumi\'s 3%)', () => {
    const r = runTurnNextMove(...args(F));
    expect(r.caveats).toEqual([]);
    expect(r.nextMove).toMatchObject({ kind: 'real_figure' });
    const [card] = cards(r.blocks);
    expect(card!.signal_id.startsWith('coach:limit_estimate:')).toBe(true);
    expect(card!.body).toContain('Your limit on “Monthly churn” was checked against Olumi\'s estimate that it is about 3 percent today');
    expect(`${card!.title} ${card!.body}`).not.toMatch(/could not (be )?check/i);
  });

  it('CONTRAST: a limit that WAS unscored keeps the "could not check" caveat (true for it), and no estimate card', () => {
    const r = runTurnNextMove(...args(withRow(F, CHURN, { state: 'unscored', reason: 'no_score_returned' })));
    expect(r.caveats.map((c) => c.kind)).toEqual(['limit_not_checked']);
    expect(r.nextMove?.kind).not.toBe('real_figure');
  });

  it('CONTRAST: no per-limit rows on the read → today\'s aggregate behaviour, byte for byte (the served move)', () => {
    const r = runTurnNextMove(...args(F, { limitVerdicts: undefined }));
    expect(r.nextMove?.kind).toBe(F.served_next_move);
    expect(r.caveats.map((c) => c.kind)).toEqual(['limit_not_checked']);
    // The served signal's last segment is the readback's verdict state, which is not on the wire (so not in the
    // fixture); everything before it is the served signal exactly.
    expect(`${r.caveats[0]!.block.signal_id}:unchecked`).toBe(F.served_caveats[0]);
  });

  it('a limit an OPTION sets is never "checked against Olumi\'s estimate" (spend is option-set on C01)', () => {
    const r = runTurnNextMove(...args(withRow(F, CHURN, { state: 'scored' })));
    expect(r.nextMove?.kind).not.toBe('real_figure');
    expect(r.caveats).toEqual([]);
  });

  it('two facts must agree: the row says "user assumption" but the node says Olumi\'s estimate → no card for it', () => {
    const g = withRow(F, CHURN, { state: 'estimate_only', reason: 'level_user_assumption' });
    expect(estimatedLimitFromVerdicts(g.draft_graph, g.limit_verdicts, g.analysis_ready?.options, g.analysis_result)).toBeNull();
  });

  it('selection skips an option-set limit itself, not only the builder\'s later check: spend alone qualifies → none', () => {
    const g = withRow(F, CHURN, { state: 'scored' });
    expect(estimatedLimitFromVerdicts(g.draft_graph, g.limit_verdicts, g.analysis_ready?.options, g.analysis_result)).toBeNull();
  });

  it('several qualify → the one on the factor the result depends on most (PLoT importance_rank)', () => {
    const g = clone(F);
    // Make spend uncontrolled (no option sets it) and valued by Olumi, so BOTH limits qualify; churn is r1, spend r4.
    for (const o of g.analysis_ready.options) delete o.interventions?.six_month_investment_spend;
    for (const n of g.draft_graph.nodes) if (n.kind === 'option') delete n.interventions?.six_month_investment_spend;
    const pick = (res: Rec) => estimatedLimitFromVerdicts(g.draft_graph, g.limit_verdicts, g.analysis_ready.options, res)?.label;
    expect(pick(g.analysis_result)).toBe('Monthly churn');
    const flipped = clone(g.analysis_result);
    for (const row of flipped.enrichment.factor_sensitivity) {
      if (row.factor_id === 'six_month_investment_spend') row.importance_rank = 0;
    }
    expect(pick(flipped)).toBe('Six-month investment spend');
  });
});
