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

function fakeProduct() {
  const posted: { kind: string; target: string }[] = [];
  let nodes: Node[] = NODES.map((n) => ({ ...n, ...(n.observed_state ? { observed_state: { ...n.observed_state } } : {}) }));
  let rev = 0;
  const linked = (o: string, f: string) => EDGES.some((e) => e.from === o && e.to === f);
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
      if (ev.kind === 'option_intervention_edit') {
        const o = String(ev.option_id); const f = String(ev.factor_id);
        posted.push({ kind: 'option_intervention_edit', target: `${o}::${f}` });
        if (ev.base_graph_hash !== `h${rev}`) return { status: 409, json: { error: 'GRAPH_DIVERGED' } };
        // The served rule (`option-intervention-edit.ts`, `linkedFactorsOf`).
        if (!linked(o, f)) return { status: 422, json: { refusal_reason: 'unresolved_effect_relationship' } };
        nodes = nodes.map((n) => (n.id === o ? { ...n, interventions: { ...(n.interventions ?? {}), [f]: { value: ev.value } } } : n));
        rev += 1;
        return { status: 200, json: { assistant_text: 'Recorded.', graph_hash: `h${rev}` } };
      }
      return { status: 400, json: {} };
    }
    return { status: 200, json: { graph: { nodes, edges: EDGES }, graph_hash: `h${rev}` } };
  };
  return { d, posted, read: () => nodes };
}

describe('a level is only proposed on a factor the option is wired to', () => {
  it('RED: an UNLINKED level is LEFT OUT of the proposal and named, with the factors the option does act on', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeOptionInterventions(ctx, { interventions: [
      { option_label: 'Hire Two Developers', factor_label: 'Team size', value: 7, basis: 'five plus two' },
      { option_label: 'Internal Lead Trial', factor_label: 'Team size', value: 6, basis: 'not wired' },
    ] });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const paths = store.get(String(r.proposal_id))!.operations.map((o) => o.path);
    expect(paths).toEqual(['hire_two::team_size']);
    expect(r.not_linked).toEqual([{ option: 'Internal Lead Trial', factor: 'Team size', acts_on: ['Coordination load'] }]);
  });

  it('CONTRAST: a proposal holding ONLY unlinked levels refuses, and still names what each option acts on', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeOptionInterventions(ctx, { interventions: [
      { option_label: 'Internal Lead Trial', factor_label: 'Team size', value: 6, basis: 'not wired' },
    ] });
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('nothing_to_set');
    expect(r.not_linked).toEqual([{ option: 'Internal Lead Trial', factor: 'Team size', acts_on: ['Coordination load'] }]);
  });

  it('RED: a starting point with one unlinked level still lands EVERY level it carries, and says what it left out', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeStartingPoint(ctx, {
      assumptions: [{ factor_label: 'Coordination load', value: 40, unit: 'index points (0-100)', basis: 'a five-person team' }],
      option_levels: [
        { option_label: 'Hire Two Developers', factor_label: 'Team size', value: 7, basis: 'five plus two' },
        { option_label: 'Internal Lead Trial', factor_label: 'Team size', value: 6, basis: 'not wired' },
        // The level it CAN carry — a starting point must cover every factor each option acts on (#1719).
        { option_label: 'Internal Lead Trial', factor_label: 'Coordination load', value: 30, basis: 'a trial lead eases load' },
      ],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.not_linked).toEqual([{ option: 'Internal Lead Trial', factor: 'Team size', acts_on: ['Coordination load'] }]);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    // At the served head this was `partially_applied` with ZERO levels: the
    // unlinked level was written first-refused and stopped the chain.
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(out.applied).toBe(true);
    const levelWrites = p.posted.filter((x) => x.kind === 'option_intervention_edit').map((x) => x.target).sort();
    expect(levelWrites).toEqual(['hire_two::team_size', 'internal_trial::coordination_load']);
    // The unlinked level was never even attempted.
    expect(levelWrites).not.toContain('internal_trial::team_size');
    const byId = Object.fromEntries(p.read().map((n) => [n.id, n]));
    expect(Object.keys(byId.hire_two.interventions ?? {})).toEqual(['team_size']);
    expect(Object.keys(byId.internal_trial.interventions ?? {})).toEqual(['coordination_load']);
  });
});
