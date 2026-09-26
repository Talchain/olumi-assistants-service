/**
 * ⛔ ONE USER OPERATION → ONE APPROVAL → ONE ATOMIC COMMIT → ONE RECEIPT (ChatGPT #70 5847200462; Paul's programme
 * focus: "#2004 is useful interim progress, but partial link/value persistence is not A-complete").
 *
 * BF5's real request carries TWO option levels, one of which needs its option → factor link. #2004 writes the link,
 * then each level, each its own commit: a refused second level leaves the link and the first level committed
 * (reported exactly, `partially_applied`). The contract is stricter: the approved scope lands WHOLE or NOT AT ALL,
 * as ONE commit with ONE receipt; a retry never repeats it; a reload agrees.
 *
 * ⚠ RED BY DESIGN at `10fbbdf5`: the fake product below commits per event, exactly as today's writers do. The seam
 * that commits the whole scope at once is Canonical's to name (#70 5847274522); when it lands, the fake gains that
 * event and `applyCompound` consumes it for the whole approved scope (the per-level loop is deleted).
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'r' };

type Node = { id: string; kind: string; label: string; category?: string; observed_state?: Record<string, unknown>; scale_frame?: number; interventions?: Record<string, unknown> };
const edge = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' });
type Edge = ReturnType<typeof edge>;

const NODES: Node[] = [
  { id: 'velocity', kind: 'goal', label: 'Velocity' },
  { id: 'team_size', kind: 'factor', label: 'Team size', category: 'controllable', observed_state: { value: 0.5, raw_value: 5, cap: 10, unit: 'FTE' } },
  { id: 'hire_two', kind: 'option', label: 'Hire Two Developers' },
  { id: 'internal_trial', kind: 'option', label: 'Internal Lead Trial' },
];
// hire_two acts on Team size; internal_trial does NOT yet (its level needs the link).
const EDGES = [edge('hire_two', 'team_size'), edge('team_size', 'velocity')];

/** The product as it commits today: one commit per event, each CAS'd on the revision before it. */
function product(opts: { refuseLevelOf?: string } = {}) {
  let edges: Edge[] = EDGES.map((e) => ({ ...e }));
  let nodes: Node[] = NODES.map((n) => ({ ...n }));
  let rev = 0;
  const commits: string[] = [];
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as Record<string, unknown>;
      if (ev.base_graph_hash !== `h${rev}`) return { status: 409, json: { error: 'GRAPH_DIVERGED' } };
      if (ev.kind === 'structural_add_edge') {
        edges = [...edges, edge(String(ev.from), String(ev.to))];
        commits.push(`link ${String(ev.from)}::${String(ev.to)}`);
        rev += 1;
        return { status: 200, json: { graph_hash: `h${rev}` } };
      }
      if (ev.kind === 'option_intervention_edit') {
        const o = String(ev.option_id); const f = String(ev.factor_id);
        if (opts.refuseLevelOf === o || !edges.some((e) => e.from === o && e.to === f)) return { status: 422, json: { refusal_reason: 'unresolved_effect_relationship' } };
        nodes = nodes.map((n) => (n.id === o ? { ...n, interventions: { ...(n.interventions ?? {}), [f]: { value: ev.value } } } : n));
        commits.push(`level ${o}::${f}`);
        rev += 1;
        return { status: 200, json: { graph_hash: `h${rev}` } };
      }
      return { status: 400, json: {} };
    }
    return { status: 200, json: { graph: { nodes, edges }, graph_hash: `h${rev}` } };
  };
  const state = () => ({ rev: `h${rev}`, edges: edges.map((e) => `${e.from}::${e.to}`).sort(), levels: Object.fromEntries(nodes.filter((n) => n.interventions).map((n) => [n.id, n.interventions])) });
  return { d, commits, state };
}

/** BF5's shape: two levels in ONE proposal; Internal Lead Trial's needs its link. */
const TWO_LEVELS = { interventions: [
  { option_label: 'Hire Two Developers', factor_label: 'Team size', value: 7, basis: 'five plus two' },
  { option_label: 'Internal Lead Trial', factor_label: 'Team size', value: 6, basis: 'a trial adds one' },
] };

describe('the approved scope commits WHOLE or NOT AT ALL, as ONE commit (A complete)', () => {
  it('RED: the second level is refused → NOTHING of the approved scope stays committed (no link, no first level)', async () => {
    const p = product({ refuseLevelOf: 'internal_trial' });
    const before = p.state();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeOptionInterventions(ctx, TWO_LEVELS);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    expect(out.ok).toBe(false);
    expect(out.mutated, 'nothing of the approved scope may remain').toBe(false);
    expect(p.state(), 'the model is exactly as it was').toEqual(before);
    expect(p.commits).toEqual([]);
  });

  it('RED: success is ONE commit with ONE receipt, and the model holds the link and both levels', async () => {
    const p = product();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeOptionInterventions(ctx, TWO_LEVELS);
    const out = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(p.commits, 'one commit for the whole operation').toHaveLength(1);
    expect(p.state().rev).toBe('h1');
    expect(p.state().edges).toContain('internal_trial::team_size');
    expect(Object.keys(p.state().levels).sort()).toEqual(['hire_two', 'internal_trial']);
  });

  it('a retry of the same approval writes nothing again, and the reload still agrees', async () => {
    const p = product();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeOptionInterventions(ctx, TWO_LEVELS);
    await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    const after = p.state();
    const n = p.commits.length;
    await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
    expect(p.commits).toHaveLength(n);
    expect(p.state()).toEqual(after);
  });
});
