/**
 * ⭐ C4 — ONE TYPED NEXT MOVE, on Paul's own three served runs (build train #70 5855068711; design 5855041235).
 * RED-first against the precedence it replaces: on all three the one card was a limit notice (P3C C3, 5855014136).
 *
 * Fixtures: verbatim `payloads.cee_response` fields of Paul's debug exports (27 Sep, CEE 263dbd5 / UI e8ba18e6), with
 * the served card's signal id; the readback verdict state is the one the served card's arm licenses.
 *
 * THE RULE (`coaching/next-move.ts`): the move is chosen by what it lets the user do. A limit unchecked for a cause the
 * user cannot close is a CAVEAT the reply says once — the limit card's own words, unchanged — never the card. A link
 * that is an operand of an identity the model declares on its target is a definition, never the move.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  runTurnCoaching,
  runTurnNextMove,
  type CapturedAnalysis,
  type RunTurnCoachingFinal,
} from '../analysis-coaching-pass-through.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

type Rec = Record<string, any>;
const load = (id: string): Rec => JSON.parse(readFileSync(
  new URL(`../../coaching/__tests__/fixtures/paul-run-${id}-next-move.json`, import.meta.url), 'utf8',
)) as Rec;
// A DERIVED graph (labelled at each use) is re-hashed through the real hash function, so the run stays bound to it:
// an un-rehashed mutation would silently unbind the graph and test nothing.
const args = (f: Rec, graph: Rec = f.draft_graph): [CapturedAnalysis, RunTurnCoachingFinal] => {
  const hash = graph === f.draft_graph ? f.graph_hash : computeAnalysisAffectingGraphHash(graph as never)!;
  const result = { ...f.analysis_result, computed_against_hash: hash };
  return [
    { scenario_id: 'paul', status: 200, trigger: f.trigger, analysis_state: f.analysis_state, analysis_ready: f.analysis_ready, blocks: [result] },
    { scenarioId: 'paul', graphHash: hash, analysisState: f.analysis_state, analysisResult: result, graph, constraintVerdictState: f.constraint_verdict_state },
  ];
};

it.each(['17d1cd3a', '90b8f080', '08bf9a1f'])('precondition %s: the served graph IS the run\'s graph (its hash is the run\'s), so every move reads it', (id) => {
  const f = load(id);
  expect(computeAnalysisAffectingGraphHash(f.draft_graph as never)).toBe(f.graph_hash);
  expect(f.analysis_result.computed_against_hash).toBe(f.graph_hash);
});
const cards = (blocks: readonly { signal_id: string }[]) => blocks.filter((b) => /^coach:[a-z_]+:/.test(b.signal_id));
const LIMIT = 'coach:limit_unchecked:';

describe('C4 on Paul 90b8f080 (explicit Run): the added option he could not test is the move', () => {
  const f = load('90b8f080');
  it('precondition: the served card was the limit notice', () => {
    expect(f.served_card_signal_ids).toHaveLength(1);
    expect(f.served_card_signal_ids[0].startsWith(LIMIT)).toBe(true);
  });
  it('RED: the one card asks for the missing level, naming the option and the factor; no limit card is rendered', () => {
    const got = cards(runTurnCoaching(...args(f)).blocks) as Rec[];
    expect(got).toHaveLength(1);
    expect(got[0]!.signal_id.startsWith('coach:untested_option:')).toBe(true);
    expect(got[0]!.title).toBe('“£59 for new Pro customers; grandfather existing customers” was not tested');
    expect(got[0]!.body).toContain('it has no level yet for “Existing customers grandfathered”');
    expect(got[0]!.action_prompt).toContain('Ask me what level it sets and what that rests on.');
    expect(got[0]!.action_label).toBe('Give its level');
  });
  it('the move is typed: kind, capability, and the option and factor ids from the one missing-level authority', () => {
    const r = runTurnNextMove(...args(f));
    expect(r.nextMove).toMatchObject({ kind: 'missing_level', capability: 'propose_option_interventions', target_ids: ['146aa89d', 'fac_existing_customers_grandfathered'] });
  });
  it('the limit notice is the CAVEAT, byte-identical to the served card (same signal id, same words)', () => {
    const r = runTurnNextMove(...args(f));
    expect(r.caveats.map((c) => c.block.signal_id)).toEqual(f.served_card_signal_ids);
    expect(r.caveats[0]!.block.title).toBe('Your limit could not be checked');
    expect(r.blocks.some((b) => b.signal_id.startsWith(LIMIT))).toBe(false);
  });
});

describe('C4 on Paul 08bf9a1f (explicit Run): a definition is never the move — the next link that is not one is', () => {
  const f = load('08bf9a1f');
  const withIdentity = (factorIds: string[] | null): Rec => ({
    ...f.draft_graph,
    nodes: f.draft_graph.nodes.map((n: Rec) => {
      if (n.id !== 'mrr') return n;
      const { nonlinear_identity: identity, ...rest } = n;
      return factorIds === null ? rest : { ...rest, nonlinear_identity: { ...identity, factor_ids: factorIds } };
    }),
  });
  const fragile = (): string[] => f.analysis_result.enrichment.robustness.fragile_edges.map((e: Rec) => `${e.from_id}→${e.to_id}`);
  it('precondition: MRR declares price × subscribers, price → MRR is the top fragile link, and the served card was the limit notice', () => {
    const mrr = f.draft_graph.nodes.find((n: Rec) => n.id === 'mrr');
    expect(mrr.nonlinear_identity).toMatchObject({ operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'] });
    expect(runTurnNextMove(...args(f, withIdentity(null))).nextMove?.target_ids).toEqual(['pro_plan_price→mrr']);
    expect(f.served_card_signal_ids[0].startsWith(LIMIT)).toBe(true);
  });
  it('RED: no limit card; the one card asks for a view on the next fragile link, Olumi\'s own assumption — never price → MRR', () => {
    const got = cards(runTurnCoaching(...args(f)).blocks) as Rec[];
    expect(got).toHaveLength(1);
    expect(got[0]!.signal_id.startsWith('coach:fragile_link:pro_plan_price→price_sensitivity:')).toBe(true);
    expect(got[0]!.signal_id.endsWith(':assumed')).toBe(true);
    expect(`${got[0]!.title} ${got[0]!.body}`).not.toMatch(/to MRR/);
    const r = runTurnNextMove(...args(f));
    expect(r.nextMove).toMatchObject({ kind: 'link_view', capability: 'propose_link_strength', target_ids: ['pro_plan_price→price_sensitivity'] });
  });
  it('the limit notice is the caveat, byte-identical to the served card', () => {
    const r = runTurnNextMove(...args(f));
    expect(r.caveats.map((c) => c.block.signal_id)).toEqual(f.served_card_signal_ids);
    expect(r.blocks.some((b) => b.signal_id.startsWith(LIMIT))).toBe(false);
  });
  // ⛔ DL #2229 follow-up: the card read the DECLARED set, the writers refuse only an identity the Run kept IN USE.
  const withRun = (extra: Rec): Rec => ({ ...f, analysis_result: { ...f.analysis_result, enrichment: { ...f.analysis_result.enrichment, ...extra } } });
  it('RED: when the Run WITHDREW MRR\'s identity it used price → MRR\'s strength, so THAT link is the move (the writers take an edit to it)', () => {
    const notForwarded = withRun({ _meta: { ...f.analysis_result.enrichment._meta,
      identities_not_forwarded: [{ node_id: 'mrr', reason: 'inferred_identity_frame_unresolved', frameless_node_ids: ['pro_plan_price'] }] } });
    expect(runTurnNextMove(...args(notForwarded)).nextMove).toMatchObject({ kind: 'link_view', capability: 'propose_link_strength', target_ids: ['pro_plan_price→mrr'] });
    const notEvaluated = withRun({ identity_evaluations: [{ node_id: 'mrr', evaluated: false }] });
    expect(runTurnNextMove(...args(notEvaluated)).nextMove?.target_ids).toEqual(['pro_plan_price→mrr']);
  });
  it('CONTROL: the Run EVALUATED MRR\'s identity → the definition is still never the move', () => {
    const evaluated = withRun({ identity_evaluations: [{ node_id: 'mrr', evaluated: true }] });
    expect(runTurnNextMove(...args(evaluated)).nextMove?.target_ids).toEqual(['pro_plan_price→price_sensitivity']);
  });
  it('CONTRAST: when the model declares EVERY fragile link a definition → no card, and the reason says so', () => {
    const all = fragile();
    const everyEdgeInto = { ...f.draft_graph, nodes: f.draft_graph.nodes.map((n: Rec) => {
      const into = all.filter((e) => e.endsWith(`→${n.id}`)).map((e) => e.split('→')[0]);
      return into.length > 0 ? { ...n, nonlinear_identity: { operation: 'product', factor_ids: into, stated_in_brief: false } } : n;
    }) };
    const r = runTurnNextMove(...args(f, everyEdgeInto));
    expect(r.nextMove).toBeNull();
    expect(r.eligibility).toEqual({ eligible: false, reason: 'definitional_link' });
    expect(r.caveats).toHaveLength(1);
  });
});

describe('C4 on Paul 17d1cd3a (automatic first pass): the real figure is the move, and its title stands alone', () => {
  const f = load('17d1cd3a');
  // MG #70 5856264807 (EXECUTED): the relabelled "%" limit reached ISL as 0.04 — framed correctly; the false certainty
  // was Olumi's 3% estimate treated as exactly known. So the served card's words were TRUE, and it stays the move.
  it('precondition: the limit was relabelled "% per month" → "%" (and still framed correctly, per MG\'s replay)', () => {
    expect(f.draft_graph.goal_constraints[0].provenance_unit_relabelled).toMatchObject({ pre_normalisation_unit: '% per month' });
  });
  it('the served card is the move (same signal id), now titled with the limit and the figure', () => {
    const got = cards(runTurnCoaching(...args(f)).blocks) as Rec[];
    expect(got.map((c) => c.signal_id)).toEqual(f.served_card_signal_ids);
    expect(got[0]!.title).toBe("Your “Monthly churn” limit was checked against Olumi's estimate of 3% per month");
    const r = runTurnNextMove(...args(f));
    expect(r.nextMove).toMatchObject({ kind: 'real_figure', capability: 'propose_starting_point', target_ids: ['monthly_churn'] });
    expect(r.caveats).toEqual([]);
  });
});

describe('C4 science brief (Runtime C1 hook): only what AI Quality ruled coach-safe (5855170731)', () => {
  it.each(['17d1cd3a', '90b8f080', '08bf9a1f'])('%s: the move, the caveats, the leader permission — ≤1k tokens, no engine field', (id) => {
    const f = load(id);
    const brief = runTurnNextMove(...args(f)).scienceBrief!;
    expect(Object.keys(brief).sort()).toEqual(['caveats', 'leader', 'next_move']);
    expect(brief.leader).toEqual({ may_be_named: false, withheld_reason: f.analysis_state.leader_claim.withheld_reason });
    expect(JSON.stringify(brief).length).toBeLessThanOrEqual(4000);
    // None of the withheld-turn leak FIELDS AI Quality found in the raw result reaches the brief (keys, not labels:
    // a node may be called "Price sensitivity").
    const keys: string[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); }
    };
    walk(brief);
    expect(keys.filter((k) => /confidence|near_tie|goal_fit|separation|alternative_winner|win_probabilit|sensitivity|evpi|enrichment/i.test(k))).toEqual([]);
    expect(keys).toContain('next_move');
  });
});
