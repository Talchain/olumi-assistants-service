/**
 * ⭐ R3-2 — A LIMITED SPEND TALLY IS THE SUM OF ITS LEVERS (`findSumTallies`), and §3 — A USER-LIMITED COST ROLL-UP'S
 * OLUMI-SIGNED EDGE INTO THE GOAL IS NOT DRAWN, unless a lever reaches the goal only through it (then ASKED)
 * (`findPureLimits` / `findPureLimitAsks`), `admit-model.ts`. AIQ #72 5867700610 (the `sum` carrier, (a), with §3's
 * guard and correction) on MG 5867674734; AIQ 5867283878 (§3 and its precondition, rows §3-1..6).
 *
 * Served journey C first builds (`fixtures/served-journey-c-sum-tally-20260928.json`, DL acceptance-f-runs): each
 * served draft_graph with the candidate reconstructed from it, put back through the real strict schema,
 * `buildModelFromBrief`, `/graph/register` and `GraphV3.parse`. Bound by node id. Journey E is T3's served fixture.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import { admitCandidateModel, findPureLimitAsks, findPureLimits, findSumTallies, type CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

type Json = Record<string, any>;
type Graph = { nodes: Json[]; edges: Json[]; goal_constraints: Json[] };
type Served = { source: string; brief: string; graph: Graph; candidate: Json };
const load = (name: string): Json => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const C = load('served-journey-c-sum-tally-20260928.json') as Record<'goal' | 'risk' | 'option_edge' | 'direct' | 'unit_mismatch', Served>;
const E = load('served-journey-e-pure-limit-074951Z.json') as { brief: string; e01: Graph; a01: Graph; e01_candidate: Json };

const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());
const candidate = (s: { candidate: Json }, edit: (c: Json) => void = () => {}): Json => {
  const c = structuredClone(s.candidate);
  edit(c);
  expect(strict(c), JSON.stringify(strict.errors)).toBe(true);
  return c;
};
const admit = (c: Json, brief: string) => admitCandidateModel(c as unknown as CandidateModel, {}, brief);
const pairs = (edges: readonly Json[]): string[] => edges.map((e) => `${e.from}::${e.to}`).sort();
const sumsOf = (nodes: readonly Json[]) => nodes.filter((n) => n.nonlinear_identity?.operation === 'sum')
  .map((n) => ({ node_id: n.id, ...n.nonlinear_identity }));
const linkTo = (c: Json, from: string, to: string) => c.links.find((l: Json) => l.from === from && l.to === to);

async function build(brief: string, c: Json) {
  let registered: unknown = null;
  const call = (async () => ({ text: JSON.stringify(c) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', brief, d, call) as Json;
  expect(out.ok, JSON.stringify(out).slice(0, 600)).toBe(true);
  return { graph: GraphV3.parse(registered) as unknown as Graph, out };
}
/** Every place the build says something to the user or the Agent. */
const said = (out: Json): string[] => [...(out.open_questions ?? []), ...(out.not_represented ?? [])];

// Served journey C, run pj-20260927T162916Z: "Total investment spend" (≤ £20,000 over 6 months) = the two spend levers,
// drafted into MRR at +0.5 (`cee_hypothesis`).
const G = C.goal;
const TALLY = 'total_investment_spend';
const GOAL = 'mrr';
const G_SUM = { node_id: TALLY, operation: 'sum', factor_ids: ['advertising_spend', 'feature_development_spend'], stated_in_brief: false };
const G_SENTENCE = 'Olumi reads "Total investment spend" as "Advertising spend" + "Feature development spend": Olumi\'s reading, '
  + 'not your figure; tell me if it includes other costs.';
const G_DROP_SENTENCE = '"Total investment spend" is kept as your limit, not as a cause of "MRR": Olumi does not assume it changes '
  + '"MRR" directly, so no link between them was drawn. If it does, say which way and the link can be added.';

describe('PRECONDITION — each reconstructed candidate is its served first build', () => {
  for (const key of ['goal', 'risk', 'option_edge', 'direct', 'unit_mismatch'] as const) {
    it(`${key} (${C[key].source}): admitted node ids, and edges plus any edge §3 leaves out, are exactly the served ones`, () => {
      const m = admit(candidate(C[key]), C[key].brief);
      const left = (m.pure_limits ?? []).map((p) => `${p.node_id}::${p.dropped_edge_to}`);
      expect(m.nodes.map((n) => n.id).sort()).toEqual(C[key].graph.nodes.map((n) => n.id).sort());
      expect([...pairs(m.edges), ...left].sort()).toEqual(pairs(C[key].graph.edges));
    });
  }
  it('the served edges being ruled on: goal tally → MRR +0.5 cee_hypothesis; each lever also reaches MRR another way', () => {
    const e = G.graph.edges.find((x) => x.from === TALLY && x.to === GOAL)!;
    expect([e.effect_direction, e.provenance.source, e.strength.mean]).toEqual(['positive', 'cee_hypothesis', 0.5]);
    expect(pairs(G.graph.edges.filter((x) => x.to === TALLY))).toEqual([`advertising_spend::${TALLY}`, `feature_development_spend::${TALLY}`]);
  });
});

describe('R3-2 — the served C shape: the lever-only tally that feeds the goal', () => {
  it('⭐ the registered tally carries the sum of its two levers, Olumi\'s reading, and it survives GraphV3.parse', async () => {
    const { graph } = await build(G.brief, candidate(G));
    expect(sumsOf(graph.nodes)).toEqual([G_SUM]);
  });
  it('the persisted contract: an Olumi sum survives GraphV3; a STATED sum (never minted) is malformed and dropped', () => {
    const parse = (ni: unknown) => (GraphV3.parse({ nodes: [{ id: TALLY, kind: 'outcome', label: 'T', nonlinear_identity: ni }], edges: [] }) as unknown as Graph).nodes[0]!.nonlinear_identity;
    expect(parse({ operation: 'sum', factor_ids: ['a', 'b'], stated_in_brief: false })).toEqual({ operation: 'sum', factor_ids: ['a', 'b'], stated_in_brief: false });
    expect(parse({ operation: 'sum', factor_ids: ['a', 'b'], stated_in_brief: true })).toBeUndefined();
    expect(parse({ operation: 'sum', factor_ids: ['a'], stated_in_brief: false })).toBeUndefined();
  });
  it('⭐ said ONCE, as Olumi\'s reading, where the user always sees it (open_questions), and typed', async () => {
    const { out } = await build(G.brief, candidate(G));
    expect(said(out).filter((s) => s === G_SENTENCE)).toHaveLength(1);
    expect(out.open_questions).toContain(G_SENTENCE);
    expect(out.sum_identities).toEqual([{ node_id: TALLY, label: 'Total investment spend', factor_ids: G_SUM.factor_ids }]);
  });
  it('⭐ §3-1 (C): the Olumi-signed tally → MRR edge is not drawn (MRR is £ too: the unit-family exemption is withdrawn), disclosed once', async () => {
    const { graph, out } = await build(G.brief, candidate(G));
    expect(pairs(graph.edges)).not.toContain(`${TALLY}::${GOAL}`);
    expect(pairs(graph.edges)).toEqual(pairs(G.graph.edges.filter((e) => !(e.from === TALLY && e.to === GOAL))));
    expect(out.pure_limits).toEqual([{ node_id: TALLY, label: 'Total investment spend', dropped_edge_to: GOAL }]);
    expect(said(out).filter((s) => s === G_DROP_SENTENCE)).toHaveLength(1);
    expect(out.pure_limit_asks).toBeUndefined();
  });
  it('the tally stays a valid limit-only terminal: readiness raises no blocker the served graph did not (the served first build\'s own unset option levels only)', async () => {
    const { graph } = await build(G.brief, candidate(G));
    const codes = (g: unknown) => assessCanonicalAnalysisReadiness(g as never).blockingIssues.map((i) => i.code).sort();
    expect(codes(graph)).toEqual(codes(GraphV3.parse(G.graph)));
    expect(codes(graph)).not.toContain('NO_PATH_TO_GOAL');
  });
});

describe('R3-2a — a NON-terminal lever-only tally (served pj-20260927T192916Z: spend → "Budget pressure")', () => {
  const R = C.risk;
  const RT = 'total_incremental_growth_spend';
  it('⭐ minted: operands = its levers, stated_in_brief false; its edge into the risk is kept; nothing touches the goal', async () => {
    const { graph, out } = await build(R.brief, candidate(R));
    expect(sumsOf(graph.nodes)).toEqual([{ node_id: RT, operation: 'sum', factor_ids: ['incremental_feature_development_spend', 'incremental_advertising_spend'], stated_in_brief: false }]);
    expect(pairs(graph.edges)).toEqual(pairs(R.graph.edges));
    expect(out.pure_limits).toBeUndefined();
    expect(out.pure_limit_asks).toBeUndefined();
  });
  it('⭐ said once', async () => {
    const { out } = await build(R.brief, candidate(R));
    const s = 'Olumi reads "Total incremental growth spend" as "Incremental feature development…" + "Incremental advertising spend": '
      + 'Olumi\'s reading, not your figure; tell me if it includes other costs.';
    expect(said(out).filter((x) => x === s)).toHaveLength(1);
    expect(said(out).filter((x) => x.startsWith('Olumi reads "Total incremental growth spend"'))).toEqual([s]);
  });
});

describe('R3-2b — levers PLUS an option edge into the tally: the operands are incomplete, so NO mint', () => {
  it('⭐ served pj-20260927T111302Z ("Total initiative spend" set by the options AND fed by two levers): no sum, no §3', async () => {
    const S = C.option_edge;
    const { graph, out } = await build(S.brief, candidate(S));
    expect(sumsOf(graph.nodes)).toEqual([]);
    expect(out.sum_identities).toBeUndefined();
    expect(out.pure_limits).toBeUndefined();
    expect(pairs(graph.edges)).toEqual(pairs(S.graph.edges));
  });
  it('⭐ the served R3-2a tally with ONE option also setting it (an option edge into it): no mint', async () => {
    const R = C.risk;
    const { graph } = await build(R.brief, candidate(R, (c) => {
      c.options[0].interventions.push({ factor_label: 'Total incremental growth spend', value: 20000, value_kind: 'absolute', unit: 'GBP over 6 months', provenance: 'ai_proposed' });
    }));
    expect(pairs(graph.edges)).toContain(`${graph.nodes.find((n) => n.kind === 'option')!.id}::total_incremental_growth_spend`);
    expect(sumsOf(graph.nodes)).toEqual([]);
  });
});

describe('§3-3 / 38-class — nothing fires where the options set the spend directly, on journey A, or without equal units', () => {
  it('⭐ served direct-set (pj-20260927T150204Z: the options set "Release investment", which feeds MRR): no sum, the edge is kept', async () => {
    const S = C.direct;
    const { graph, out } = await build(S.brief, candidate(S));
    expect(sumsOf(graph.nodes)).toEqual([]);
    expect(pairs(graph.edges)).toEqual(pairs(S.graph.edges));
    for (const k of ['sum_identities', 'pure_limits', 'pure_limit_asks']) expect(out[k]).toBeUndefined();
  });
  it('served journey A (churn limited, a % quantity) and the served direct-set graph: the rules read nothing off them', () => {
    for (const g of [E.a01, C.direct.graph]) {
      expect(findSumTallies(g.nodes as never, g.edges as never, g.goal_constraints)).toEqual([]);
      expect(findPureLimits(g.nodes as never, g.edges as never, g.goal_constraints)).toEqual([]);
      expect(findPureLimitAsks(g.nodes as never, g.edges as never, g.goal_constraints)).toEqual([]);
    }
  });
  it('⭐ unit equality: served pj-20260927T155125Z ("GBP" limit, "GBP over 6 months" levers) is NOT minted; its goal edge still follows §3', async () => {
    const S = C.unit_mismatch;
    const { graph, out } = await build(S.brief, candidate(S));
    expect(sumsOf(graph.nodes)).toEqual([]);
    expect(out.pure_limits).toEqual([{ node_id: 'incremental_6_month_spend', label: 'Incremental 6-month spend', dropped_edge_to: 'mrr' }]);
  });
  it('⭐ unit equality: served journey E — hires under a £ salary limit are not its addends: no sum', async () => {
    const { graph } = await build(E.brief, candidate({ candidate: E.e01_candidate }));
    expect(sumsOf(graph.nodes)).toEqual([]);
    expect(findSumTallies(E.e01.nodes as never, E.e01.edges as never, E.e01.goal_constraints)).toEqual([]);
  });
  it('a lever drafted to LOWER the tally is not an addend: no sum', () => {
    const m = admit(candidate(G, (c) => { linkTo(c, 'Advertising spend', 'Total investment spend').direction = 'negative'; }), G.brief);
    expect(sumsOf(m.nodes)).toEqual([]);
  });
  it('a tally with only ONE lever is not a sum', () => {
    const m = admit(candidate(G, (c) => { c.links = c.links.filter((l: Json) => !(l.from === 'Advertising spend' && l.to === 'Total investment spend')); }), G.brief);
    expect(sumsOf(m.nodes)).toEqual([]);
  });
});

describe('§3 — the precondition, the user\'s direction, and the one exemption', () => {
  const ASK = 'Olumi assumes more "Total investment spend" raises "MRR" — is that right?';
  // "Advertising spend" reaches MRR only through the tally once its link to "Pro paying subscribers" is taken out.
  const onlyThrough = (c: Json) => { c.links = c.links.filter((l: Json) => !(l.from === 'Advertising spend' && l.to === 'Pro paying subscribers')); };

  it('⭐ §3-4: a lever whose ONLY path to the goal runs through the tally → the edge is KEPT, and ASKED once as Olumi\'s assumption', async () => {
    const { graph, out } = await build(G.brief, candidate(G, onlyThrough));
    expect(pairs(graph.edges)).toContain(`${TALLY}::${GOAL}`);
    expect(out.pure_limits).toBeUndefined();
    expect(out.pure_limit_asks).toEqual([{
      node_id: TALLY, label: 'Total investment spend', goal_id: GOAL, effect_direction: 'positive', levers_only_through: ['advertising_spend'], question: ASK,
    }]);
    expect(said(out).filter((s) => s === ASK)).toHaveLength(1);
    expect(out.open_questions).toContain(ASK);
    expect(said(out)).not.toContain(G_DROP_SENTENCE);
  });
  it('§3-4: a negative Olumi sign is asked as "slows"', async () => {
    const { out } = await build(G.brief, candidate(G, (c) => { onlyThrough(c); linkTo(c, 'Total investment spend', 'MRR').direction = 'negative'; }));
    expect(out.open_questions).toContain('Olumi assumes more "Total investment spend" slows "MRR" — is that right?');
  });
  it('⭐ §3-5: a user-stated direction into the goal keeps the edge, as theirs — no drop, no ask', async () => {
    const { graph, out } = await build(G.brief, candidate(G, (c) => { linkTo(c, 'Total investment spend', 'MRR').provenance = 'explicit'; }));
    expect(graph.edges.find((e) => e.from === TALLY && e.to === GOAL)?.provenance?.source).toBe('brief_extraction');
    expect(out.pure_limits).toBeUndefined();
    expect(out.pure_limit_asks).toBeUndefined();
  });
  it('⭐ the ONLY exemption: a goal DECLARED as an identity containing the cost keeps the edge — no drop, no ask', async () => {
    const { graph, out } = await build(G.brief, candidate(G, (c) => {
      c.identities = [{ outcome: 'MRR', operation: 'product', factors: ['Pro plan price', 'Total investment spend'], provenance: 'inferred' }];
    }));
    expect(pairs(graph.edges)).toContain(`${TALLY}::${GOAL}`);
    expect(out.pure_limits).toBeUndefined();
    expect(out.pure_limit_asks).toBeUndefined();
  });
  it('a goal identity that does NOT contain the cost (the served MRR = price × subscribers) exempts nothing', () => {
    expect(G.candidate.identities).toEqual([{ outcome: 'MRR', operation: 'product', factors: ['Pro plan price', 'Pro paying subscribers'], provenance: 'inferred' }]);
    expect(admit(candidate(G), G.brief).pure_limits).toEqual([{ node_id: TALLY, label: 'Total investment spend', dropped_edge_to: GOAL }]);
  });
  it('a limit Olumi inferred (not the user\'s) leaves the goal edge alone — and still mints the sum (the ≤ level limit names it)', () => {
    const m = admit(candidate(G, (c) => { c.constraints[0].provenance = 'inferred'; }), G.brief);
    expect(pairs(m.edges)).toContain(`${TALLY}::${GOAL}`);
    expect(m.pure_limits).toBeUndefined();
    expect(sumsOf(m.nodes)).toEqual([G_SUM]);
  });
});
