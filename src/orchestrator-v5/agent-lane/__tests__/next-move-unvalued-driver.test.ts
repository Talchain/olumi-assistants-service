/**
 * ⭐ PJ-B3 — AN UNVALUED TOP-3 DRIVER IS SAID AS THE ASK IT IS, NEVER AS AN ANALYSED DRIVER (R&C root #70 5860314787;
 * DL decision 5860325629). RED-first on SERVED journey captures (DL harness, auto first pass, OpenAI):
 *   C `pj-20260927T213830Z` — "Pro paying subscribers" #1 and "Monthly churn" #2 in `factor_sensitivity`, no value;
 *   E `pj-20260927T214809Z` — "Current annual salary spend" #3, no value.
 * Both served a fragile-link card; the result's top drivers were factors the model had no figure for.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runTurnNextMove, type CapturedAnalysis, type RunTurnCoachingFinal } from '../analysis-coaching-pass-through.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { unvaluedTopDrivers } from '../../coaching/unvalued-driver-card.js';

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
const top3 = (f: Rec) => f.analysis_result.enrichment.factor_sensitivity
  .filter((r: Rec) => r.importance_rank <= 3).map((r: Rec) => [r.factor_id, r.importance_rank, r.value_source ?? null]);
const node = (f: Rec, id: string) => f.draft_graph.nodes.find((n: Rec) => n.id === id);
/** A DERIVED fixture, re-hashed through the real hash so the run stays bound to it. */
const rehash = (f: Rec): Rec => ({ ...f, graph_hash: computeAnalysisAffectingGraphHash(f.draft_graph as never) });

describe('PJ-B3 on served journey C (213830Z): the unvalued #1 driver is asked for, not presented', () => {
  const f = load('served-pj-c-213830Z-unvalued-drivers.json');

  it('precondition: bound graph; top-3 = two unvalued factors + one valued; the served card was a link card', () => {
    expect(computeAnalysisAffectingGraphHash(f.draft_graph as never)).toBe(f.graph_hash);
    expect(top3(f)).toEqual([['pro_paying_subscribers', 1, null], ['monthly_churn', 2, null], ['pro_plan_price', 3, 'brief_extraction']]);
    expect(node(f, 'pro_paying_subscribers').observed_state ?? null).toBeNull();
    expect(f.served_card_signal_ids[0].startsWith('coach:fragile_link:')).toBe(true);
  });

  it('RED: the one move is "give its value" for the #1 unvalued driver, mapped to propose_assumptions', () => {
    const r = runTurnNextMove(...args(f));
    expect(r.nextMove).toMatchObject({ kind: 'missing_value', capability: 'propose_assumptions', target_ids: ['pro_paying_subscribers'] });
    const got = cards(r.blocks);
    expect(got).toHaveLength(1);
    expect(got[0]!.signal_id.startsWith('coach:unvalued_driver:')).toBe(true);
    expect(got[0]!.title).toBe('“Pro paying subscribers” has no value yet');
    expect(got[0]!.body).toContain('ranks “Pro paying subscribers” among the three factors this result depends on most, but the model has no value for it yet');
    expect(got[0]!.action_label).toBe('Give its value');
  });

  it('CONTRAST: once the model holds values for both (re-hashed), no unvalued-driver move — the rule is the missing value', () => {
    const g = JSON.parse(JSON.stringify(f));
    for (const id of ['pro_paying_subscribers', 'monthly_churn']) node(g, id).observed_state = { value: 0.5, raw_value: 300, source: 'user_specified' };
    const r = runTurnNextMove(...args(rehash(g)));
    expect(r.nextMove?.kind).not.toBe('missing_value');
    expect(unvaluedTopDrivers(g.analysis_result, g.draft_graph)).toEqual([]);
  });

  it('CONTRAST: a producer that attests no `value_source` at all leaves today\'s move (absent everywhere = not attested)', () => {
    const g = JSON.parse(JSON.stringify(f));
    for (const row of g.analysis_result.enrichment.factor_sensitivity) delete row.value_source;
    const r = runTurnNextMove(...args(g));
    expect(r.nextMove?.kind).toBe('link_view');
  });
});

describe('PJ-B3 on served journey E (214809Z): the unvalued #3 driver', () => {
  const f = load('served-pj-e-214809Z-unvalued-driver.json');
  it('precondition: top-3 = two valued (cee_inference) + "current_annual_salary_spend" unvalued at #3', () => {
    expect(computeAnalysisAffectingGraphHash(f.draft_graph as never)).toBe(f.graph_hash);
    expect(top3(f)).toEqual([['annual_senior_engineer_salary', 1, 'cee_inference'], ['annual_junior_engineer_salary', 2, 'cee_inference'], ['current_annual_salary_spend', 3, null]]);
  });
  it('RED: the one move asks for its value', () => {
    const r = runTurnNextMove(...args(f));
    expect(r.nextMove).toMatchObject({ kind: 'missing_value', target_ids: ['current_annual_salary_spend'] });
    expect(cards(r.blocks)[0]!.title).toBe('“Current annual salary spend” has no value yet');
  });
});
