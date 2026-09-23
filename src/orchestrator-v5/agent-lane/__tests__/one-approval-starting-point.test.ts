/**
 * ⛔ ONE APPROVAL MUST BE ABLE TO MAKE THE MODEL COMPARABLE.
 *
 * Every proposal is bound to the revision it was made against. Offered
 * separately, starting values and option levels could never both be applied
 * from one "yes": applying the first moved the revision, and the second was
 * refused as superseded by OUR OWN write. Measured on the replay of Paul's
 * 22 Sep journey (output/paul-test-20260923/repro): the user asked for the
 * updates "immediately" and the model still could not become analysable in one
 * step.
 *
 * The fake product applies both system events the way the product does —
 * `factor_value_edit` moves the revision, `option_intervention_edit` is
 * CAS-gated on `base_graph_hash` — so a part applied against a stale base is
 * refused here exactly as on the wire.
 */

import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const USER = 'user-a';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: USER, request_id: 'r' };

type Node = {
  id: string; kind: string; label: string;
  observed_state?: Record<string, unknown>;
  interventions?: Record<string, unknown> | null;
};

const BASE: Node[] = [
  { id: 'velocity', kind: 'goal', label: 'Velocity' },
  { id: 'team_size', kind: 'factor', label: 'Team size', observed_state: { value: 0.5, raw_value: 5, cap: 10, unit: 'FTE' } },
  { id: 'coordination_load', kind: 'factor', label: 'Coordination load' },
  { id: 'hire_two', kind: 'option', label: 'Hire Two Developers', interventions: null },
  { id: 'hire_lead', kind: 'option', label: 'Hire a Tech Lead', interventions: null },
];

function fakeProduct(opts: { failOn?: string[] } = {}) {
  const posted: { kind: string; target: string; base?: string; at_rev: number }[] = [];
  let nodes: Node[] = BASE.map((n) => ({ ...n, observed_state: n.observed_state ? { ...n.observed_state } : undefined }));
  let rev = 0;
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      nodes = (b as { graph: { nodes: Node[] } }).graph.nodes;
      rev += 1;
      return { status: 200, json: {} };
    }
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as Record<string, unknown>;
      if (ev.kind === 'factor_value_edit') {
        const target = String(ev.target_id);
        posted.push({ kind: 'factor_value_edit', target, at_rev: rev });
        if (opts.failOn?.includes(target) === true) return { status: 422, json: {} };
        nodes = nodes.map((n) => (n.id === target ? { ...n, observed_state: { ...n.observed_state, value: ev.value as number } } : n));
        rev += 1;
        return { status: 200, json: { assistant_text: 'Updated.' } };
      }
      if (ev.kind === 'option_intervention_edit') {
        const target = `${String(ev.option_id)}::${String(ev.factor_id)}`;
        posted.push({ kind: 'option_intervention_edit', target, base: String(ev.base_graph_hash), at_rev: rev });
        if (ev.base_graph_hash !== `h${rev}`) return { status: 409, json: { error: 'GRAPH_DIVERGED' } };
        if (opts.failOn?.includes(target) === true) return { status: 422, json: {} };
        nodes = nodes.map((n) => (n.id === ev.option_id
          ? { ...n, interventions: { ...(n.interventions ?? {}), [String(ev.factor_id)]: { value: ev.value } } } : n));
        rev += 1;
        return { status: 200, json: { assistant_text: 'Recorded.' } };
      }
      return { status: 400, json: {} };
    }
    return { status: 200, json: { graph: { nodes, edges: [] }, graph_hash: `h${rev}` } };
  };
  return { d, posted, read: () => nodes, rev: () => rev };
}

const ASSUMPTIONS = [{ factor_label: 'Coordination load', value: 40, unit: 'index points (0-100)', basis: 'a five-person team with one lead' }];
const LEVELS = [
  { option_label: 'Hire Two Developers', factor_label: 'Team size', value: 7, basis: 'five today plus two hires' },
  { option_label: 'Hire a Tech Lead', factor_label: 'Team size', value: 6, basis: 'five today plus one hire' },
];

describe('the dead end this closes — two proposals, one approval', () => {
  it('CHARACTERISATION: the second of two separate proposals is refused after the first applies', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const a = await caps.proposeAssumptions(ctx, { assumptions: ASSUMPTIONS });
    const b = await caps.proposeOptionInterventions(ctx, { interventions: LEVELS });
    expect(a.ok && b.ok, JSON.stringify({ a, b })).toBe(true);
    expect((await caps.authoriseChange(ctx, { proposal_id: String(a.proposal_id) })).ok).toBe(true);
    const second = await caps.authoriseChange(ctx, { proposal_id: String(b.proposal_id) });
    expect(second.ok).toBe(false);
    expect(second.refusal).toBe('superseded');
  });
});

describe('propose_starting_point', () => {
  it('leaves exactly ONE proposal awaiting approval, carrying both values and levels', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeStartingPoint(ctx, { assumptions: ASSUMPTIONS, option_levels: LEVELS });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.mutated).toBe(false);
    expect(p.posted).toHaveLength(0);
    const waiting = store.outstanding(SCENARIO, USER);
    expect(waiting.map((w) => w.proposal_id)).toEqual([r.proposal_id]);
    const kinds = new Set(store.get(String(r.proposal_id))!.operations.map((o) => o.op));
    expect([...kinds].sort()).toEqual(['set_factor_value', 'set_option_intervention']);
    // What the user is shown quotes THEIR numbers.
    expect(String(r.public_label)).toMatch(/Coordination load = 40/);
    expect(String(r.public_label)).toMatch(/Hire Two Developers sets Team size to 7/);
  });

  it('RED: ONE approval applies the values AND every level, in that order, against the current base each time', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeStartingPoint(ctx, { assumptions: ASSUMPTIONS, option_levels: LEVELS });
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(applied.applied).toBe(true);
    expect(applied.mutated).toBe(true);
    // Values first, then levels — and every level carried the base it was applied on.
    expect(p.posted.map((x) => x.kind)).toEqual(['factor_value_edit', 'option_intervention_edit', 'option_intervention_edit']);
    for (const x of p.posted.filter((y) => y.kind === 'option_intervention_edit')) expect(x.base).toBe(`h${x.at_rev}`);
    // Read back from the product, by identity.
    const byId = Object.fromEntries(p.read().map((n) => [n.id, n]));
    expect(byId.coordination_load.observed_state?.value).toBeDefined();
    expect(Object.keys(byId.hire_two.interventions ?? {})).toEqual(['team_size']);
    expect(Object.keys(byId.hire_lead.interventions ?? {})).toEqual(['team_size']);
    // The approved object is now applied; nothing is left waiting.
    expect(store.outstanding(SCENARIO, USER)).toEqual([]);
    const again = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    expect(again.already_applied).toBe(true);
    expect(p.posted).toHaveLength(3);
  });

  it('a part that refuses is reported as PARTIAL, and never listed as a second thing to approve', async () => {
    const p = fakeProduct({ failOn: ['hire_lead::team_size'] });
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeStartingPoint(ctx, { assumptions: ASSUMPTIONS, option_levels: LEVELS });
    const out = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    expect(out.ok).toBe(false);
    expect(out.applied).toBe(false);
    expect(out.mutated).toBe(true);
    expect(out.refusal).toBe('partially_applied');
    const parts = out.parts as { part: string; ok: boolean }[];
    expect(parts.map((x) => [x.part, x.ok === true])).toEqual([['values', true], ['option_levels', false]]);
    // Only the object the user was shown can appear as awaiting approval.
    expect(store.outstanding(SCENARIO, USER).map((w) => w.proposal_id)).toEqual([r.proposal_id]);
  });

  it('CONTRAST: with only one kind it is an ordinary single proposal', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeStartingPoint(ctx, { assumptions: [], option_levels: LEVELS });
    expect(r.ok).toBe(true);
    const kinds = new Set(store.get(String(r.proposal_id))!.operations.map((o) => o.op));
    expect([...kinds]).toEqual(['set_option_intervention']);
    expect(store.outstanding(SCENARIO, USER)).toHaveLength(1);
  });

  it('is a MUTATION tool: the read-only preview refuses it before any capability runs', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await dispatchTool('propose_starting_point', JSON.stringify({ assumptions: ASSUMPTIONS, option_levels: LEVELS }), ctx, caps, 'preview');
    expect(r.refusal).toBe('read_only_preview');
    expect(p.posted).toHaveLength(0);
  });
});
