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
import { rebindCapture } from '../../../../tests/helpers/legacy-analysis-hash-v2.js';

type Rec = Record<string, any>;
// Shared Data row 1 (projection v3): each capture's recorded hash is proven to be the pre-0.62.0 projection of its
// draft graph, then rebound to the current projection everywhere that exact string appears (tests/helpers).
const rebound = (f: Rec): Rec => rebindCapture(f, f.draft_graph, f.graph_hash as string);
const load = (name: string): Rec => rebound(JSON.parse(readFileSync(
  new URL(`../../coaching/__tests__/fixtures/${name}`, import.meta.url), 'utf8',
)) as Rec);
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

describe('AIQ gap 1 (5860454709): when the figures treat the unvalued driver as a placeholder 0, the card says so', () => {
  const ZERO = ' These figures treat it as 0 until you give it.';
  it('E: the run\'s GOAL_ANCESTOR_DATA_GAP names current_annual_salary_spend → the sentence is on the card (short form: the full one would exceed body_max)', () => {
    const f = load('served-pj-e-214809Z-unvalued-driver.json');
    const codes = f.analysis_result.enrichment.inference_warnings.filter((w: Rec) => w.code === 'GOAL_ANCESTOR_DATA_GAP');
    expect(codes).toHaveLength(1);
    expect(codes[0].message).toContain("'current_annual_salary_spend'");
    const body = cards(runTurnNextMove(...args(f)).blocks)[0]!.body as string;
    // E also carries a limit caveat, composed in front (#2135), so the move's words start mid-body.
    expect(body.endsWith(`ranks “Current annual salary spend” in its top three, but the model has no value for it yet.${ZERO}`)).toBe(true);
    expect(body.length).toBeLessThanOrEqual(300);
  });
  it('C: no GOAL_ANCESTOR_DATA_GAP names the factor → no placeholder sentence', () => {
    const f = load('served-pj-c-213830Z-unvalued-drivers.json');
    expect(cards(runTurnNextMove(...args(f)).blocks)[0]!.body).not.toContain(ZERO.trim());
  });
});

describe('DL #2154 CHANGES_REQUIRED (5860590920): order, option-set factors, both halves pinned, no silent fallback', () => {
  const c = load('served-pj-c-213830Z-unvalued-drivers.json');
  // Served dloop2x-1 re-run: "Retention programme churn reduction" is PLoT's #3, unvalued, fed only by option 80206211.
  const rerun = load('served-rerun-untested-option-20260927.json');
  const OPT_SET = 'fac_retention_programme_churn_reduction';
  const ADDED = 'Keep the price at £49 and launch a retention programme';
  const withoutOptionEdge = (f: Rec): Rec => {
    const g = JSON.parse(JSON.stringify(f));
    g.draft_graph.edges = g.draft_graph.edges.filter((e: Rec) => e.to !== OPT_SET);
    return g;
  };

  it('item 2 RED: a top-3 factor an OPTION feeds is never "give its value" (its missing level is the untested-option move)', () => {
    const row = rerun.analysis_result.enrichment.factor_sensitivity.find((r: Rec) => r.factor_id === OPT_SET);
    expect([row.importance_rank, row.value_source ?? null, node(rerun, OPT_SET).observed_state ?? null]).toEqual([3, null, null]);
    expect(rerun.draft_graph.edges.filter((e: Rec) => e.to === OPT_SET).map((e: Rec) => node(rerun, e.from)?.kind)).toEqual(['option']);
    expect(unvaluedTopDrivers(rerun.analysis_result, rerun.draft_graph).map((d) => d.id)).not.toContain(OPT_SET);
  });

  it('item 2 CONTRAST: the same factor with its option edge removed IS asked for (the exclusion is the option edge)', () => {
    const g = withoutOptionEdge(rerun);
    expect(unvaluedTopDrivers(g.analysis_result, g.draft_graph).map((d) => d.id)).toContain(OPT_SET);
  });

  it('item 1 RED: when a limit move and an unvalued driver both apply, the limit move wins', () => {
    const g = withoutOptionEdge(rerun);
    const optionId = g.analysis_ready.options.find((o: Rec) => o.label === ADDED).option_id;
    g.trigger = 'explicit_run';
    g.analysis_ready = {
      ...g.analysis_ready,
      options: g.analysis_ready.options.map((o: Rec) => (o.label === ADDED ? { ...o, status: 'ready' } : o)),
      blockers: (g.analysis_ready.blockers ?? []).filter((b: Rec) => b.option_id !== optionId),
    };
    const r = runTurnNextMove(...args(rehash(g)));
    expect(r.nextMove?.kind).toBe('no_option_meets_limit');
  });

  it('item 3 RED (mutant M2): a row that carries a `value_source` vetoes the card even when its node holds no value', () => {
    const g = JSON.parse(JSON.stringify(c));
    for (const row of g.analysis_result.enrichment.factor_sensitivity) {
      if (row.factor_id === 'pro_paying_subscribers' || row.factor_id === 'monthly_churn') row.value_source = 'brief_extraction';
    }
    expect(node(g, 'pro_paying_subscribers').observed_state ?? null).toBeNull();
    expect(unvaluedTopDrivers(g.analysis_result, g.draft_graph)).toEqual([]);
    expect(runTurnNextMove(...args(g)).nextMove?.kind).toBe('link_view');
  });

  it('item 4: when no wording fits the card limits there is NO card and the selector moves on (never a cut name, never the #2)', () => {
    const g = JSON.parse(JSON.stringify(c));
    node(g, 'pro_paying_subscribers').label = `Pro paying subscribers ${'on the annual plan '.repeat(20)}`.trim();
    const h = rehash(g);
    expect(unvaluedTopDrivers(h.analysis_result, h.draft_graph)[0]?.id).toBe('pro_paying_subscribers');
    const r = runTurnNextMove(...args(h));
    expect(r.nextMove?.kind).toBe('link_view');
    expect(cards(r.blocks).some((b) => String(b.signal_id).startsWith('coach:unvalued_driver:'))).toBe(false);
  });
});
