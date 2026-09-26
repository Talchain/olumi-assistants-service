/**
 * ⛔ A LEVEL CAN ONLY BE SET ON A FACTOR THE OPTION IS WIRED TO — enforced at
 * PROPOSAL time, by the write's own reader (`linkedFactorsOf`).
 *
 * MEASURED on served 0f2f3b87 (journey witness, scenario 1e7649c2): the Agent's
 * starting point proposed "Internal Lead Trial -> Tech lead headcount", an
 * option with no link to that factor. The proposer accepted it; the served
 * `option_intervention_edit` refused it (`unresolved_effect_relationship`), and
 * because a compound's level chain stops at its first refusal, NONE of that
 * approval's levels landed — two options stayed inert and out of the analysis.
 *
 * The fake product enforces the same rule the served write does, so a proposal
 * that lets an unlinked level through reproduces the served failure here.
 *
 * ⭐ THE RULE NOW (DL #70 5846924842, served BF5 on 1f8327c): dropping the unlinked level made the Agent propose the
 * link alone and PROMISE the level, which no proposal kept. So the level BRINGS ITS LINK: one proposal carries the
 * option → factor link and the level; on approval the link is written first and the level on the revision that
 * write reported. The served failure above (a level written onto an unlinked factor, refused, stopping the chain)
 * stays impossible: the level is never written before its link lands.
 */

import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const USER = 'user-a';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: USER, request_id: 'r' };

type Node = { id: string; kind: string; label: string; category?: string; observed_state?: Record<string, unknown>; scale_frame?: number; interventions?: Record<string, unknown> };
const edge = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' });

const NODES: Node[] = [
  { id: 'velocity', kind: 'goal', label: 'Velocity' },
  { id: 'team_size', kind: 'factor', label: 'Team size', category: 'controllable', observed_state: { value: 0.5, raw_value: 5, cap: 10, unit: 'FTE' } },
  { id: 'coordination_load', kind: 'factor', label: 'Coordination load', category: 'observable', scale_frame: 100 },
  { id: 'hire_two', kind: 'option', label: 'Hire Two Developers' },
  { id: 'internal_trial', kind: 'option', label: 'Internal Lead Trial' },
];
// hire_two acts on Team size; internal_trial acts ONLY on Coordination load.
const EDGES = [edge('hire_two', 'team_size'), edge('internal_trial', 'coordination_load'), edge('team_size', 'velocity'), edge('coordination_load', 'velocity')];
type Edge = ReturnType<typeof edge>;

function fakeProduct(opts: { refuseLinks?: boolean; refuseLevels?: boolean } = {}) {
  const posted: { kind: string; target: string }[] = [];
  let edges: Edge[] = EDGES.map((e) => ({ ...e }));
  let nodes: Node[] = NODES.map((n) => ({ ...n, ...(n.observed_state ? { observed_state: { ...n.observed_state } } : {}) }));
  let rev = 0;
  const linked = (o: string, f: string) => edges.some((e) => e.from === o && e.to === f);
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      posted.push({ kind: 'register', target: 'graph' });
      if (typeof b.expected_graph_hash === 'string' && b.expected_graph_hash !== `h${rev}`) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      nodes = (b as { graph: { nodes: Node[] } }).graph.nodes;
      rev += 1;
      return { status: 200, json: { registered: true, graph_hash: `h${rev}` } };
    }
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as Record<string, unknown>;
      if (ev.kind === 'structural_add_edge') {
        posted.push({ kind: 'structural_add_edge', target: `${String(ev.from)}::${String(ev.to)}` });
        if (ev.base_graph_hash !== `h${rev}`) return { status: 409, json: { error: 'GRAPH_DIVERGED' } };
        if (opts.refuseLinks === true) return { status: 422, json: { error: 'INGRESS_CONTRACT_VIOLATION' } };
        edges = [...edges, edge(String(ev.from), String(ev.to))];
        rev += 1;
        return { status: 200, json: { assistant_text: 'Connected.', graph_hash: `h${rev}` } };
      }
      if (ev.kind === 'option_intervention_edit') {
        const o = String(ev.option_id); const f = String(ev.factor_id);
        posted.push({ kind: 'option_intervention_edit', target: `${o}::${f}` });
        if (ev.base_graph_hash !== `h${rev}`) return { status: 409, json: { error: 'GRAPH_DIVERGED' } };
        // The served rule (`option-intervention-edit.ts`, `linkedFactorsOf`).
        if (opts.refuseLevels === true || !linked(o, f)) return { status: 422, json: { refusal_reason: 'unresolved_effect_relationship' } };
        nodes = nodes.map((n) => (n.id === o ? { ...n, interventions: { ...(n.interventions ?? {}), [f]: { value: ev.value } } } : n));
        rev += 1;
        return { status: 200, json: { assistant_text: 'Recorded.', graph_hash: `h${rev}` } };
      }
      return { status: 400, json: {} };
    }
    return { status: 200, json: { graph: { nodes, edges }, graph_hash: `h${rev}` } };
  };
  return { d, posted, read: () => nodes, edges: () => edges };
}

describe('a level brings its link: ONE proposal, the link written before the level (DL #70 5846924842)', () => {
  it('RED: an UNLINKED level is KEPT — the proposal carries the option → factor link FIRST, then the levels, and says so', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeOptionInterventions(ctx, { interventions: [
      { option_label: 'Hire Two Developers', factor_label: 'Team size', value: 7, basis: 'five plus two' },
      { option_label: 'Internal Lead Trial', factor_label: 'Team size', value: 6, basis: 'a trial adds one' },
    ] });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const ops = store.get(String(r.proposal_id))!.operations.map((o) => `${o.op}:${o.path}`);
    expect(ops).toEqual(['add_edge:internal_trial::team_size', 'set_option_intervention:hire_two::team_size', 'set_option_intervention:internal_trial::team_size']);
    expect(r.not_linked).toBeUndefined();
    expect(String(r.adds_links_note)).toMatch(/Never tell the user a level will be recorded later/);
    expect(String(r.public_label)).toContain('Internal Lead Trial acts on Team size (a new link) and sets it to 6');
  });

  it('RED: on approval the link is written FIRST, then every level on the revision it reported — both levels land, the link exists', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeOptionInterventions(ctx, { interventions: [
      { option_label: 'Hire Two Developers', factor_label: 'Team size', value: 7, basis: 'five plus two' },
      { option_label: 'Internal Lead Trial', factor_label: 'Team size', value: 6, basis: 'a trial adds one' },
    ] });
    const out = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(out.applied).toBe(true);
    expect(p.posted.map((x) => `${x.kind}:${x.target}`)).toEqual([
      'structural_add_edge:internal_trial::team_size',
      'option_intervention_edit:hire_two::team_size',
      'option_intervention_edit:internal_trial::team_size',
    ]);
    expect(p.edges().some((e) => e.from === 'internal_trial' && e.to === 'team_size')).toBe(true);
    const byId = Object.fromEntries(p.read().map((n) => [n.id, n]));
    expect(Object.keys(byId.internal_trial.interventions ?? {})).toEqual(['team_size']);
  });

  it('a link the product refuses → NO level is written onto a factor it could not reach, and the result says nothing was fully saved', async () => {
    const p = fakeProduct({ refuseLinks: true });
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeOptionInterventions(ctx, { interventions: [
      { option_label: 'Internal Lead Trial', factor_label: 'Team size', value: 6, basis: 'a trial adds one' },
    ] });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    expect(out.ok).toBe(false);
    expect(out.applied).not.toBe(true);
    expect(p.posted.filter((x) => x.kind === 'option_intervention_edit')).toEqual([]);
  });

  it('RED (Canonical #2004 B1): the link LANDS, then its level is refused → the result says the model changed and names the link', async () => {
    const p = fakeProduct({ refuseLevels: true });
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeOptionInterventions(ctx, { interventions: [
      { option_label: 'Internal Lead Trial', factor_label: 'Team size', value: 6, basis: 'a trial adds one' },
    ] });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    expect(p.edges().some((e) => e.from === 'internal_trial' && e.to === 'team_size'), 'premise: the link landed').toBe(true);
    expect(out.ok).toBe(false);
    expect(out.mutated, 'the model gained a link').toBe(true);
    expect(out.refusal).toBe('partially_applied');
    expect(out.revision_after).not.toBe(out.revision_before);
    expect(out.parts).toEqual([
      { part: 'links', ok: true, recorded_count: 1, requested_count: 1 },
      { part: 'option_levels', ok: false, recorded_count: 0, requested_count: 1 },
    ]);
    expect(String(out.detail)).toContain('Internal Lead Trial \u2192 Team size');
  });

  it('RED: a starting point with a level on an unlinked factor lands EVERY level it carries, the link first', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeStartingPoint(ctx, {
      assumptions: [{ factor_label: 'Coordination load', value: 40, unit: 'index points (0-100)', basis: 'a five-person team' }],
      option_levels: [
        { option_label: 'Hire Two Developers', factor_label: 'Team size', value: 7, basis: 'five plus two' },
        { option_label: 'Internal Lead Trial', factor_label: 'Team size', value: 6, basis: 'a trial adds one' },
        { option_label: 'Internal Lead Trial', factor_label: 'Coordination load', value: 30, basis: 'a trial lead eases load' },
      ],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(out.applied).toBe(true);
    const levelWrites = p.posted.filter((x) => x.kind === 'option_intervention_edit').map((x) => x.target).sort();
    expect(levelWrites).toEqual(['hire_two::team_size', 'internal_trial::coordination_load', 'internal_trial::team_size']);
    const firstLevel = p.posted.findIndex((x) => x.kind === 'option_intervention_edit');
    const link = p.posted.findIndex((x) => x.kind === 'structural_add_edge');
    expect(link).toBeGreaterThanOrEqual(0);
    expect(link).toBeLessThan(firstLevel);
  });
});
