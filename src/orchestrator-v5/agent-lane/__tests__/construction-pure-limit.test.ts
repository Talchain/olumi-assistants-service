/**
 * ⛔ A LIMIT THE USER SETS ON WHAT THEIR LEVERS COST IS A LIMIT, NOT A CAUSE OLUMI MAY SIGN (`findPureLimits`,
 * `admit-model.ts`; MG proposal #72 5866176230, Canonical's engine probe `canonical-state/efig/`).
 *
 * Served journey E (DL run `pj-20260928T074951Z`, E01; `fixtures/served-journey-e-pure-limit-074951Z.json`): "…while
 * keeping annual salary spend under £400k?". The drafter rolled "Annual salary spend" (GBP/year) up from the two hiring
 * levers and ALSO drew `annual_salary_spend → ship_the_new_platform` (% completion), negative, `cee_hypothesis`, mean
 * −0.5 — a sign nobody stated, and (Canonical's probe) the one edge that chose the leader.
 *
 * Bound by node id. The registered graph goes through the real strict schema, `buildModelFromBrief`, `/graph/register`
 * and `GraphV3.parse`; readiness is the one authority (`assessCanonicalAnalysisReadiness`). CONTRAST rows pin every
 * condition of the rule one at a time on the served shape, plus the served journey A and C graphs.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import { admitCandidateModel, findPureLimits, type CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

type Json = Record<string, any>;
type Graph = { nodes: Json[]; edges: Json[]; goal_constraints: Json[] };
const load = (name: string): Json => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const E = load('served-journey-e-pure-limit-074951Z.json') as { brief: string; e01: Graph; a01: Graph; e01_candidate: Json };
const C = load('served-journey-c-budget-limit-063347Z.json') as { c02: Graph; c10: Graph };

const SPEND = 'annual_salary_spend';
const GOAL = 'ship_the_new_platform';
const DROPPED = `${SPEND}::${GOAL}`;
const LIMIT = 'agent-lane:annual_salary_spend:<=';
const SENTENCE = '"Annual salary spend" is kept as your limit, not as a cause of "ship the new platform": Olumi does not assume '
  + 'it changes "ship the new platform" directly, so no link between them was drawn. If it does, say which way and the link can be added.';
const E_PURE_LIMIT = [{ node_id: SPEND, label: 'Annual salary spend', dropped_edge_to: GOAL }];

const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());
const candidate = (edit: (c: Json) => void = () => {}): Json => {
  const c = structuredClone(E.e01_candidate);
  edit(c);
  expect(strict(c), JSON.stringify(strict.errors)).toBe(true);
  return c;
};
const admit = (c: Json) => admitCandidateModel(c as unknown as CandidateModel, {}, E.brief);
/** The rule read straight off a served graph (nodes, edges and limits exactly as served). */
const pureOf = (g: Graph) => findPureLimits(g.nodes as never, g.edges as never, g.goal_constraints);
const pairs = (edges: readonly Json[]): string[] => edges.map((e) => `${e.from}::${e.to}`).sort();
const shape = (edges: readonly Json[]): string[] =>
  edges.map((e) => `${e.from}::${e.to}:${e.effect_direction}:${e.provenance?.source}`).sort();

async function build(c: Json) {
  let registered: unknown = null;
  const call = (async () => ({ text: JSON.stringify(c) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0', E.brief, d, call) as Json;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return { graph: GraphV3.parse(registered) as unknown as Graph, out };
}

describe('PRECONDITION — the reconstructed candidate is the served E01 draft', () => {
  it('admitted, its edges plus the one pure-limit edge are exactly the served E01 edges (from, to, direction, source)', () => {
    const m = admit(candidate());
    const droppedServed = E.e01.edges.filter((e) => (m.pure_limits ?? []).some((p) => `${e.from}::${e.to}` === `${p.node_id}::${p.dropped_edge_to}`));
    expect(shape([...m.edges, ...droppedServed])).toEqual(shape(E.e01.edges));
    expect(m.goal_constraints.map((c) => c.constraint_id)).toEqual([LIMIT]);
  });
  it('the served edge being ruled on: spend → goal, negative, cee_hypothesis, mean −0.5', () => {
    const e = E.e01.edges.find((x) => x.from === SPEND && x.to === GOAL)!;
    expect([e.effect_direction, e.provenance.source, e.strength.mean]).toEqual(['negative', 'cee_hypothesis', -0.5]);
  });
});

describe('RED — served journey E: "Annual salary spend" is a pure limit, and Olumi\'s guessed edge into the goal is not drawn', () => {
  it('⭐ on the SERVED E01 graph the rule names exactly the one quantity and the one edge', () => {
    expect(pureOf(E.e01)).toEqual(E_PURE_LIMIT);
  });

  it('⭐ the registered model has no spend → goal edge; the lever → spend roll-up and the £400k limit are kept', async () => {
    const { graph } = await build(candidate());
    expect(pairs(graph.edges)).not.toContain(DROPPED);
    expect(pairs(graph.edges)).toEqual(pairs(E.e01.edges.filter((e) => `${e.from}::${e.to}` !== DROPPED)));
    expect(pairs(graph.edges.filter((e) => e.to === SPEND))).toEqual([`junior_engineers_hired::${SPEND}`, `senior_engineers_hired::${SPEND}`]);
    expect(graph.goal_constraints.find((c) => c.node_id === SPEND)).toMatchObject({ constraint_id: LIMIT, value: 400000, provenance: 'explicit' });
  });

  it('⭐ the drop is typed on the construction result, and said ONCE in not_represented', async () => {
    const { out } = await build(candidate());
    expect(out.pure_limits).toEqual(E_PURE_LIMIT);
    expect((out.not_represented as string[]).filter((s) => s === SENTENCE)).toHaveLength(1);
    expect((out.not_represented as string[]).filter((s) => s.includes('Annual salary spend') && s.includes('ship the new platform'))).toEqual([SENTENCE]);
  });

  it('⭐ the ledger keeps no projection entry for the edge not drawn — only its one pure_limit line', () => {
    const m = admit(candidate());
    expect(m.loss.filter((l) => String(l.field_path).startsWith(`edges[${DROPPED}]`)).map((l) => l.field_path)).toEqual([`edges[${DROPPED}].pure_limit`]);
  });

  it('⭐ readiness holds the limited roll-up as a terminal: no blocker, and admission never calls it unconnected', async () => {
    const { graph } = await build(candidate());
    expect(assessCanonicalAnalysisReadiness(graph).blockingIssues.map((i) => i.code)).toEqual([]);
    expect(admit(candidate()).loss.filter((l) => l.field_path === `nodes[${SPEND}]`)).toEqual([]);
  });
});

describe('CONTRAST — shapes that must NOT change', () => {
  const unchanged = (c: Json) => {
    const m = admit(c);
    expect(m.pure_limits).toBeUndefined();
    expect(pairs(m.edges)).toContain(DROPPED);
    expect(m.loss.some((l) => /\.pure_limit$/.test(String(l.field_path)))).toBe(false);
    return m;
  };
  const linkTo = (c: Json, from: string, to: string) => c.links.find((l: Json) => l.from === from && l.to === to);

  it('served journey A (churn limited → Pro subscribers → MRR) and journey C (C02, C10): nothing is a pure limit', () => {
    expect(pureOf(E.a01)).toEqual([]);
    expect(pureOf(C.c02)).toEqual([]);
    expect(pureOf(C.c10)).toEqual([]);
  });

  // AIQ #72 5867700610 WITHDREW "same unit family (£ → £) keeps the edge": spend → a £ goal is not accounting. The goal's
  // unit no longer decides; only a goal DECLARED as an identity containing the cost does (below).
  it('AIQ correction: a £ goal no longer keeps the edge — the rule fires whatever the goal\'s unit', () => {
    for (const unit of ['GBP', 'milestones']) {
      const m = admit(candidate((c) => { c.goal.unit = unit; }));
      expect(m.pure_limits).toEqual(E_PURE_LIMIT);
      expect(pairs(m.edges)).not.toContain(DROPPED);
    }
  });

  it('the ONLY exemption: a goal declared as an identity containing the spend keeps the edge', () => {
    unchanged(candidate((c) => {
      c.identities = [{ outcome: 'ship the new platform', operation: 'product', factors: ['Annual salary spend', 'Engineering delivery capacity'], provenance: 'inferred' }];
    }));
  });

  it('a user-stated direction into the goal is always drawn, as theirs', () => {
    const m = unchanged(candidate((c) => { linkTo(c, 'Annual salary spend', 'ship the new platform').provenance = 'explicit'; }));
    expect(m.edges.find((e) => `${e.from}::${e.to}` === DROPPED)?.provenance?.source).toBe('brief_extraction');
  });

  it('a limit Olumi inferred (not the user\'s) leaves the edge alone', () => {
    unchanged(candidate((c) => { c.constraints[0].provenance = 'inferred'; }));
  });

  it('a quantity that is not money (a headcount limit rolled up from the hires) keeps its edge', () => {
    unchanged(candidate((c) => {
      const f = c.factors.find((x: Json) => x.label === 'Annual salary spend');
      f.unit = 'FTE'; f.plausible_max = 100;
      c.constraints[0].unit = 'FTE'; c.constraints[0].value = 8;
      for (const l of c.links) if (l.to === 'Annual salary spend') { l.effect_amount = null; l.effect_per_source_change = null; l.effect_provenance = null; }
    }));
  });

  it('a parent that is not a lever (an observable driver of spend) keeps the edge', () => {
    unchanged(candidate((c) => {
      c.factors.push({ label: 'Salary inflation', role: 'observable', baseline_known: false, baseline_value: 3, unit: '%', provenance: 'inferred', plausible_max: 100 });
      c.links.push({ from: 'Salary inflation', to: 'Annual salary spend', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
    }));
  });

  it('a parent the options set but the drafter called observable (not a lever) keeps the edge', () => {
    unchanged(candidate((c) => { c.factors.find((x: Json) => x.label === 'Junior engineers hired').role = 'observable'; }));
  });

  it('a controllable parent no option sets keeps the edge', () => {
    unchanged(candidate((c) => {
      c.factors.push({ label: 'Contractor days', role: 'controllable', baseline_known: false, baseline_value: 0, unit: 'days', provenance: 'inferred', plausible_max: 1000 });
      c.links.push({ from: 'Contractor days', to: 'Annual salary spend', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
    }));
  });

  it('a limited £ quantity with no parent at all is not a roll-up, and keeps its edge', () => {
    unchanged(candidate((c) => { c.links = c.links.filter((l: Json) => l.to !== 'Annual salary spend'); }));
  });

  it('AIQ 5867700610 (non-terminal roll-ups too): a second edge out (spend → hiring lead time) is kept, the edge into the goal is not drawn', () => {
    const m = admit(candidate((c) => {
      c.links.push({ from: 'Annual salary spend', to: 'Hiring lead time', direction: 'negative', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
    }));
    expect(m.pure_limits).toEqual(E_PURE_LIMIT);
    expect(pairs(m.edges)).toContain(`${SPEND}::hiring_lead_time`);
    expect(pairs(m.edges)).not.toContain(DROPPED);
    // It still reaches the goal (through the risk), so admission never calls it unconnected.
    expect(m.loss.filter((l) => l.field_path === `nodes[${SPEND}]`)).toEqual([]);
  });

  it('a limited £ roll-up whose one edge out goes elsewhere is not reported (no edge into the goal to drop)', () => {
    const m = admit(candidate((c) => { linkTo(c, 'Annual salary spend', 'ship the new platform').to = 'Hiring lead time'; }));
    expect(m.pure_limits).toBeUndefined();
    expect(pairs(m.edges)).toContain(`${SPEND}::hiring_lead_time`);
  });

  it('a limited node that is not a quantity (the served graph with the spend node read as a risk) is never a pure limit', () => {
    const nodes = E.e01.nodes.map((n) => (n.id === SPEND ? { ...n, kind: 'risk' } : n));
    expect(pureOf({ ...E.e01, nodes })).toEqual([]);
  });
});
