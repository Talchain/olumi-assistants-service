/**
 * Science 393023 rule R (route-once), DESIGN science-mechanism-doubt-DESIGN.md §2/§6.
 * Edge identities bind every assertion; fixture bytes are shared with DGAI.
 * R4/R5 are ISL known-answer inputs, not a claim that these tests run ISL.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';
import type { RunInputSnapshot } from '@talchain/schemas/orchestrator';
import { endsOfGraph, heldLinkBeforeRouteOnce, heldLinkOf, routeOnceCoveredSources, withHeldUserLinks } from '../held-user-links.js';
import { goalChanceDriverOf } from '../goal-chance-driver.js';
import { olumiExistenceOnGoalPath, userStatedLinksBelowOne } from '../goal-chance-licence.js';
import { computeAnalysisAffectingGraphHash, computeAnalysisAffectingGraphHashSha256 } from '../../context/graph-hash.js';
import { matchesHistoricalAnalysisIdentity, matchesHistoricalRunAnalysisIdentity, ANALYSIS_PROJECTION_VERSION } from '../../context/graph-identity.js';
import { diffRunInputs } from '../../coaching/run-input-changes.js';
import { createAgentCapabilities, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { guardAnalysisParticipation } from '../../tools/handlers/run-analysis-participation-guard.js';
import { compactGraph } from '../../../orchestrator/context/serialise.js';

type Rec = Record<string, any>;
type Edge = Rec & { from: string; to: string; exists_probability?: number; strength?: { mean: number; std?: number } };
type Graph = { nodes: Rec[]; edges: Edge[] };
type Fixture = { name: string; graph: Graph; held: string[] };
const PARITY_SHA256 = '2af884c37d767cdd68a53aa6cf9b1e5ee7cf78f003204afdc57428f61ef51331';
const bytes = readFileSync(new URL('./fixtures/route-once-parity.json', import.meta.url));
const parity = JSON.parse(bytes.toString('utf8')) as Fixture[];
const graphOf = (name: string): Graph => structuredClone(parity.find((row) => row.name === name)!.graph);
const id = (edge: Edge): string => `${edge.from}->${edge.to}`;
const edgeOf = (graph: Graph, identity: string): Edge => {
  const edge = graph.edges.find((e) => id(e) === identity);
  expect(edge, identity).toBeDefined();
  return edge!;
};
const heldIds = (graph: Graph, routeOnly = false): string[] => {
  const ends = endsOfGraph(graph);
  return graph.edges.filter((e) => {
    const held = heldLinkOf(e, ends(e));
    return routeOnly ? held?.reason === 'route_once' : held !== null;
  }).map(id).sort();
};
// The routes ISL actually draws: participating nodes only, directed links only (PLoT drops bidirected before ISL).
const structural = (graph: Graph): Edge[] => {
  const ids = new Set(graph.nodes.filter((n) => n.analysis_participation !== 'retained_excluded').map((n) => n.id));
  return graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.edge_type !== 'bidirected');
};
// Independent path oracle: coverage is tested against enumerated root routes, not just the Kahn result.
const defaultIds = (graph: Graph): Set<string> => {
  const ends = endsOfGraph(graph);
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  return new Set(structural(graph).filter((e) => typeof e.exists_probability === 'number' && Number.isFinite(e.exists_probability)
    && e.exists_probability > 0 && e.exists_probability < 1 && e.edge_type !== 'bidirected'
    && !nodes.get(e.to)?.nonlinear_identity?.factor_ids?.includes(e.from)
    && !nodes.get(e.to)?.event_risk?.mitigations?.some((m: Rec) => m.factor_id === e.from)
    && heldLinkBeforeRouteOnce(e, ends(e)) === null).map(id));
};
const rootRoutes = (graph: Graph): Edge[][] => {
  const edges = structural(graph);
  const roots = graph.nodes.map((n) => n.id as string).filter((n) => !edges.some((e) => e.to === n));
  const routes: Edge[][] = [];
  const walk = (at: string, path: Edge[], seen: Set<string>) => {
    const next = edges.filter((e) => e.from === at && !seen.has(e.to));
    if (next.length === 0) { routes.push(path); return; }
    for (const e of next) walk(e.to, [...path, e], new Set([...seen, e.to]));
  };
  for (const root of roots) walk(root, [], new Set([root]));
  return routes;
};
function randomDags(): Graph[] {
  let seed = 393023;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  return Array.from({ length: 200 }, () => {
    const count = 6 + Math.floor(random() * 5);
    const nodes = Array.from({ length: count }, (_, i) => ({ id: `n${i}`, label: `n${i}`, kind: i === count - 1 ? 'goal' : 'factor' }));
    const edges: Edge[] = [];
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) if (random() < 0.35) {
      edges.push({ from: `n${i}`, to: `n${j}`, exists_probability: random() < 0.7 ? 0.8 : 1, strength: { mean: random(), std: 0.05 } });
    }
    return { nodes, edges };
  });
}
const invariantGraphs = [...parity.map((r) => r.graph), ...randomDags()];
const snapshot = (graph: Graph): RunInputSnapshot => ({
  snapshot_version: 1, sent_digest: 'a'.repeat(64), residual_digest: 'b'.repeat(64), goal: null,
  options: [], options_not_sent: [], factors: [], constraints: [],
  links: graph.edges.map((e) => ({ from: e.from, to: e.to, mean: e.strength!.mean, std: e.strength!.std, exists_probability: e.exists_probability, sizing: linkSizing(e) })),
});

describe('rule R route-once', () => {
  it('Parity fixture: every row and pinned SHA-256', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(PARITY_SHA256);
    expect(parity.length).toBeGreaterThanOrEqual(12);
    for (const row of parity) expect({ name: row.name, held: heldIds(row.graph) }).toEqual({ name: row.name, held: row.held });
  });

  it('R4 (ISL 0.638 → 0.796): capacity->goal only, exact R4h', () => {
    const graph = graphOf('R4');
    const expected = graphOf('R4');
    edgeOf(expected, 'capacity->goal').exists_probability = 1;
    expect(heldIds(graph)).toEqual(['capacity->goal']);
    expect(withHeldUserLinks(graph)).toEqual(expected);
    expect(edgeOf(withHeldUserLinks(graph), 'capacity->goal')).toEqual({ from: 'capacity', to: 'goal', exists_probability: 1, strength: { mean: 1, std: 0.05 } });
    expect(edgeOf(withHeldUserLinks(graph), 'hire->capacity')).toEqual(edgeOf(graph, 'hire->capacity'));
  });

  it('R5 (ISL 0.636 → 0.792): bridge->goal only, exact R5h', () => {
    const graph = graphOf('R5');
    const expected = graphOf('R5');
    edgeOf(expected, 'bridge->goal').exists_probability = 1;
    expect(heldIds(graph)).toEqual(['bridge->goal']);
    expect(withHeldUserLinks(graph)).toEqual(expected);
  });

  it('Served shape: M->Y and Y->goal; first default factorA->M stays doubted', () => {
    const graph = graphOf('Served shape');
    expect(heldIds(graph)).toEqual(['M->Y', 'Y->goal']);
    const expected = graphOf('Served shape');
    for (const identity of ['M->Y', 'Y->goal']) edgeOf(expected, identity).exists_probability = 1;
    expect(withHeldUserLinks(graph)).toEqual(expected);
    expect(edgeOf(withHeldUserLinks(graph), 'factorA->M')).toEqual(edgeOf(graph, 'factorA->M'));
  });

  it('I1: every doubted root-to-goal route retains doubt (all parity rows + 200 seeded DAGs)', () => {
    for (const graph of invariantGraphs) {
      const defaults = defaultIds(graph);
      const after = withHeldUserLinks(graph);
      for (const route of rootRoutes(graph)) if (route.some((e) => defaults.has(id(e)))) {
        expect(route.some((e) => defaults.has(id(e)) && edgeOf(after, id(e)).exists_probability! < 1), route.map(id).join(', ')).toBe(true);
      }
    }
  });

  it('I2: every route-once source has cov true and an earlier default on every root route', () => {
    for (const graph of invariantGraphs) {
      const defaults = defaultIds(graph);
      const cov = routeOnceCoveredSources(structural(graph).map((e) => ({ from: e.from, to: e.to, isDefault: defaults.has(id(e)) })));
      const routes = rootRoutes(graph);
      const ends = endsOfGraph(graph);
      for (const identity of heldIds(graph, true)) {
        const edge = edgeOf(graph, identity);
        expect(cov.has(edge.from), identity).toBe(true);
        expect(ends(edge).routeOnce, identity).toBe(true);
        const through = routes.filter((route) => route.some((e) => id(e) === identity));
        expect(through.length, identity).toBeGreaterThan(0);
        for (const route of through) expect(route.slice(0, route.findIndex((e) => id(e) === identity)).some((e) => defaults.has(id(e))), identity).toBe(true);
      }
    }
  });

  it('I3: strength objects and JSON bytes unchanged on every edge; persisted graph untouched', () => {
    for (const graph of invariantGraphs) {
      const before = JSON.stringify(graph);
      const after = withHeldUserLinks(graph);
      for (const edge of graph.edges) {
        expect(edgeOf(after, id(edge)).strength, id(edge)).toEqual(edge.strength);
        expect(JSON.stringify(edgeOf(after, id(edge)).strength), id(edge)).toBe(JSON.stringify(edge.strength));
      }
      expect(JSON.stringify(graph)).toBe(before);
    }
    const graph = graphOf('R4');
    const edge = edgeOf(graph, 'capacity->goal');
    delete edge.strength!.std;
    expect(heldLinkOf(edge, endsOfGraph(graph)(edge))).toEqual({ reason: 'route_once', std: undefined });
    // Never the persisted object: the Run's copy shares nothing with the persisted graph.
    expect(edgeOf(withHeldUserLinks(graph), 'capacity->goal').strength).not.toBe(edge.strength);
    expect(edgeOf(withHeldUserLinks(graph), 'capacity->goal').strength).toEqual({ mean: 1 });
    expect(edgeOf(withHeldUserLinks(graph), 'capacity->goal').strength).not.toHaveProperty('std');
    edge.strength!.std = Infinity;
    expect(heldLinkOf(edge, endsOfGraph(graph)(edge))).toEqual({ reason: 'route_once', std: undefined });
    expect(edgeOf(withHeldUserLinks(graph), 'capacity->goal').strength).toEqual({ mean: 1, std: Infinity });
    delete edge.strength;
    expect(edgeOf(withHeldUserLinks(graph), 'capacity->goal')).not.toHaveProperty('strength');
  });

  it('I4: user range, validated definition, p=1, p=0, bidirected and identity operand never default-cover', () => {
    for (const name of ['I4 user range', 'I4 validated definition', 'I4 certain', 'I4 zero', 'Bidirected', 'Identity operand', 'I4 absent probability']) {
      const graph = graphOf(name);
      expect(heldIds(graph, true), name).toEqual([]);
      expect(endsOfGraph(graph)(edgeOf(graph, 'M->Y')).routeOnce, name).toBe(false);
      expect(heldLinkOf(edgeOf(graph, 'M->Y'), endsOfGraph(graph)(edgeOf(graph, 'M->Y'))), name).toBeNull();
    }
    // An identity operand is in ISL's graph (fixed, not drawn): it passes its source's cover on.
    const identity = graphOf('Identity operand covered source');
    expect(endsOfGraph(identity)(edgeOf(identity, 'A->M')).routeOnce).toBe(true);
    expect(heldIds(identity, true)).toEqual(['M->Y']);
    // ⛔ Codex buddy r2 P1: a BIDIRECTED link is not in ISL's graph at all, so M is a root and M->Y is its route's only doubt.
    const bidirected = graphOf('Bidirected covered source');
    expect(endsOfGraph(bidirected)(edgeOf(bidirected, 'A->M')).routeOnce).toBe(false);
    expect(heldIds(bidirected, true)).toEqual([]);
    expect(withHeldUserLinks(bidirected)).toBe(bidirected);
    const graph = graphOf('R4');
    for (const value of [NaN, Infinity, -1, 1.1]) {
      edgeOf(graph, 'hire->capacity').exists_probability = value;
      expect(heldIds(graph, true)).toEqual([]);
    }
  });

  it('Event risk (DL ruling; Science 393023): a MITIGATION is fixed by ISL, never doubt or cover; OCCURRENCE is never cover', () => {
    // The legacy case a writer can still produce: risk->child left at 0.8 under a mitigated event risk.
    const mitigated = graphOf('Event-risk mitigation');
    expect(endsOfGraph(mitigated)(edgeOf(mitigated, 'preventer->risk')).fixedByIsl).toBe(true);
    expect(heldIds(mitigated)).toEqual([]);
    expect(withHeldUserLinks(mitigated)).toBe(mitigated);
    // CONTROL: the same graph without event_risk is today's rule R — preventer->risk is a default doubt, so risk->child holds.
    expect(heldIds(graphOf('Event-risk mitigation control'))).toEqual(['risk->child']);
    // Q7 shape (risk->child at 1.0 under event_risk): the risk's occurrence never covers, so child->goal keeps its doubt.
    expect(heldIds(graphOf('Event-risk occurrence is not cover'))).toEqual([]);
  });

  it('I5: no covered default returns the same object', () => {
    const graph = graphOf('No covered default');
    expect(withHeldUserLinks(graph)).toBe(graph);
  });

  it('I6: user range on A->M moves doubt to M->Y and keeps exactly one doubt', () => {
    const before = graphOf('I6 before');
    const after = graphOf('I6 after');
    expect(heldIds(before, true)).toEqual(['M->Y']);
    expect(heldIds(after, true)).toEqual([]);
    const edge = edgeOf(after, 'A->M');
    expect(heldLinkOf(edge, endsOfGraph(after)(edge))).toEqual({ reason: 'user_range', std: 0.3 / 3.29 });
    expect(withHeldUserLinks(after).edges.filter((e) => e.exists_probability === 0.8).map(id)).toEqual(['M->Y']);
  });

  it('Shared node: two doubted causes hold its out-link; an undoubted route removes the hold', () => {
    expect(heldIds(graphOf('Shared node doubted'))).toEqual(['customers_lost->goal']);
    expect(heldIds(graphOf('Shared node undoubted'))).toEqual([]);
  });

  it('Cycle: any directed cycle removes all route-once holds, preserving base holds', () => {
    const graph = graphOf('Cycle');
    expect(heldIds(graph, true)).toEqual([]);
    expect(heldIds(graph)).toEqual(['A->M']);
    expect(routeOnceCoveredSources(structural(graph).map((e) => ({ from: e.from, to: e.to, isDefault: true })))).toEqual(new Set());
    expect(withHeldUserLinks(graph)).toEqual({ ...graph, edges: graph.edges.map((e) => id(e) === 'A->M' ? { ...e, exists_probability: 1 } : e) });
  });

  it('Dangling edge: ignored in structure, never route-once held even from a covered source', () => {
    const graph = graphOf('Dangling edge');
    expect(heldIds(graph)).toEqual(['M->Y']);
    expect(endsOfGraph(graph)(edgeOf(graph, 'M->missing')).routeOnce).toBe(false);
    expect(endsOfGraph(graph)(null).routeOnce).toBe(false);
  });

  it('Scaling: layered DAG, 2000/500 nodes, min-of-5 timing ratio < 8', () => {
    const layered = (count: number): Graph => {
      const nodes = Array.from({ length: count }, (_, i) => ({ id: `n${i}`, kind: 'chance', label: `n${i}` }));
      const edges: Edge[] = [];
      for (let i = 0; i < count - 10; i++) for (let j = 0; j < 3; j++) edges.push({
        from: `n${i}`, to: `n${Math.floor(i / 10) * 10 + 10 + (i + j) % 10}`, exists_probability: 0.8, strength: { mean: 1, std: 0.05 },
      });
      return { nodes, edges };
    };
    const small = layered(500), large = layered(2000);
    const time = (graph: Graph): number => {
      const start = performance.now();
      const ends = endsOfGraph(graph);
      for (const edge of graph.edges) ends(edge);
      withHeldUserLinks(graph);
      return performance.now() - start;
    };
    time(small); time(large);
    const smallTimes: number[] = [], largeTimes: number[] = [];
    for (let i = 0; i < 5; i++) { smallTimes.push(time(small)); largeTimes.push(time(large)); }
    expect(Math.min(...largeTimes) / Math.min(...smallTimes)).toBeLessThan(8);
  });

  it('History: pre_route_once SHA-256 validates historical analysis, current differs', () => {
    const graph = graphOf('R4');
    const historical = computeAnalysisAffectingGraphHashSha256(graph as never, 'pre_route_once')!;
    expect(historical).not.toBe(computeAnalysisAffectingGraphHashSha256(graph as never));
    expect(matchesHistoricalAnalysisIdentity(graph as never, historical)).toBe(true);
    const sent = withHeldUserLinks(graph);
    expect(computeAnalysisAffectingGraphHashSha256(graph as never)).toBe(computeAnalysisAffectingGraphHashSha256(sent as never, 'pre_route_once'));
    // History of a Run also accepts the projection, without granting freshness.
    const runGraph = (JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/fa1-served-graph.json', import.meta.url), 'utf8')) as { graph: Graph }).graph;
    const runSnapshot = { ...snapshot(runGraph), options: runGraph.nodes.filter((n) => n.kind === 'option')
      .map((n) => ({ option_id: n.id as string, settings: [] })) };
    expect(matchesHistoricalRunAnalysisIdentity(runGraph as never, computeAnalysisAffectingGraphHash(runGraph as never, 'pre_route_once')!, ANALYSIS_PROJECTION_VERSION, runSnapshot)).toBe(true);
    // The served FA1 draft carries a drafter's validated definition AND a route-once hold, so each history projection is a
    // DIFFERENT digest: only the 'pre_route_once' clause can validate a version recorded between S-DEF and rule R.
    const recordedBeforeRuleR = computeAnalysisAffectingGraphHashSha256(runGraph as never, 'pre_route_once')!;
    for (const other of ['current', 'pre_definition', 'pre_hold', 'legacy'] as const) {
      expect(computeAnalysisAffectingGraphHashSha256(runGraph as never, other), other).not.toBe(recordedBeforeRuleR);
    }
    expect(matchesHistoricalAnalysisIdentity(runGraph as never, recordedBeforeRuleR)).toBe(true);
  });

  it('Driver: route-once-held brief-stated existence driver is Olumi-authored', () => {
    const graph = graphOf('R4');
    edgeOf(graph, 'capacity->goal').provenance = { source: 'brief_extraction', source_quote: 'Capacity raises the goal.' };
    const record = { probability_of_goal_drivers: { drivers: [{ quantity_id: 'capacity->goal', from: 'capacity', to: 'goal', kind: 'link_existence',
      spread: 0.5, status: 'resolved', correlated: false, p_goal_if_absent: 0.2, p_goal_if_present: 0.8, n_absent: 1000, n_present: 1000 }] } };
    expect(goalChanceDriverOf(record, 'option', graph, {})).toEqual({ driver: { quantity_id: 'capacity->goal', from: 'capacity', to: 'goal', kind: 'link_existence',
      side: 'absent', pct_if_side: 20, pct_if_side_rounding: 'whole', authored_by: 'olumi', user_stated_link: true } });
  });

  it('Licence: held brief-stated link leaves below-one list; upstream Olumi doubt remains', () => {
    const graph = graphOf('Served shape');
    for (const identity of ['factorA->M', 'M->Y', 'Y->goal']) edgeOf(graph, identity).provenance = { source: 'brief_extraction', source_quote: 'Stated causal effect.' };
    expect(userStatedLinksBelowOne(graph, 'goal', ['option']).map((e) => id(e as Edge))).toEqual(['factorA->M']);
    expect(olumiExistenceOnGoalPath(graph, 'goal', ['option'])).toBe(true);
  });

  it('run-input-changes (a): doubt-moved I6 snapshots explain M->Y existence; std rule unchanged', () => {
    const before = snapshot(withHeldUserLinks(graphOf('I6 before')));
    const after = snapshot(withHeldUserLinks(graphOf('I6 after')));
    expect(diffRunInputs(before, after)).toEqual({ rows: [{ entity_kind: 'link', entity_id: 'A->M', link: { from: 'A', to: 'M' },
      field: 'sizing', before: { raw: 'unmarked' }, after: { raw: 'user' }, change: 'changed' }], complete: true });
    // Reverse coverage isolates the route-once move: undoing the user-range hold itself remains partial by today's sizing rule.
    const reverse = diffRunInputs(after, before);
    expect(reverse.complete).toBe(false);
    after.links[1]!.std = 0.2;
    expect(diffRunInputs(before, after).complete).toBe(false);
  });

  it('run-input-changes (b): same graph before/after rule stays partial (coverage true on both sides)', () => {
    const graph = graphOf('R4');
    expect(diffRunInputs(snapshot(graph), snapshot(withHeldUserLinks(graph)))).toEqual({ rows: [], complete: false });
  });

  it('Participation (Codex buddy r1 P1): a node kept out of the calculation never covers — Run, hash, Agent and LLM agree', async () => {
    const excluded = graphOf('Retained excluded upstream');
    const control = graphOf('Retained excluded upstream control');
    // The Run: the participation guard withholds X and X->M BEFORE the hold, so M->Y is the route's FIRST default.
    const sent = withHeldUserLinks(guardAnalysisParticipation(excluded, { goalNodeId: 'Y' }).graph as Graph);
    expect(sent.edges.map((e) => `${id(e)}@${e.exists_probability}`)).toEqual(['M->Y@0.8']);
    // Every reader of the PERSISTED graph sees the same: no hold on M->Y (control: held once X participates).
    expect(heldIds(excluded)).toEqual([]);
    expect(heldIds(control)).toEqual(['M->Y']);
    const llm = (g: Graph) => compactGraph(g as never).edges.find((e) => e.from === 'M' && e.to === 'Y')!.exists_probability;
    expect([llm(excluded), llm(control)]).toEqual([0.8, 1]);
    const agentRow = async (g: Graph): Promise<Rec> => {
      const dispatch = vi.fn<InternalDispatch>(async () => ({ status: 200, json: { graph: g } }));
      const state = await createAgentCapabilities(dispatch, new ProposalStore()).getCanonicalState({
        scenario_id: '7c1f8e3b-4d5a-4f6b-8c9d-0e1f2a3b4c5d', authenticated_user_id: null, request_id: 'route-once-participation',
      }) as Rec;
      return state.links.find((e: Edge) => id(e) === 'M->Y');
    };
    expect(await agentRow(excluded)).toMatchObject({ exists_probability: 0.8 });
    expect(await agentRow(excluded)).not.toHaveProperty('counted_once');
    expect(await agentRow(control)).toMatchObject({ exists_probability: 1, counted_once: true });
    // Freshness: a real change to M->Y's existence on the Run moves the current hash (it is not masked by a phantom hold).
    const moved = graphOf('Retained excluded upstream');
    edgeOf(moved, 'M->Y').exists_probability = 0.6;
    expect(computeAnalysisAffectingGraphHash(moved as never)).not.toBe(computeAnalysisAffectingGraphHash(excluded as never));
  });

  it('Agent: get_canonical_state capacity->goal counted_once; hire->capacity byte-identical', async () => {
    const graph = graphOf('R4');
    const before = JSON.stringify(graph);
    const dispatch = vi.fn<InternalDispatch>(async () => ({ status: 200, json: { graph } }));
    const state = await createAgentCapabilities(dispatch, new ProposalStore()).getCanonicalState({
      scenario_id: '7c1f8e3b-4d5a-4f6b-8c9d-0e1f2a3b4c5d', authenticated_user_id: null, request_id: 'route-once',
    }) as Rec;
    expect(state.ok).toBe(true);
    expect(state.mutated).toBe(false);
    expect(state.links.find((e: Edge) => id(e) === 'capacity->goal')).toEqual({ from: 'capacity', to: 'goal', strength: { mean: 1, std: 0.05 },
      band: 'very strong', exists_probability: 1, counted_once: true, sizing: 'unmarked' });
    const expected = { from: 'hire', to: 'capacity', strength: { mean: 0.4, std: 0.05 }, band: 'strong', exists_probability: 0.8, sizing: 'unmarked' };
    const control = state.links.find((e: Edge) => id(e) === 'hire->capacity');
    expect(control).toEqual(expected);
    expect(JSON.stringify(control)).toBe(JSON.stringify(expected));
    expect(JSON.stringify(graph)).toBe(before);
  });
});
