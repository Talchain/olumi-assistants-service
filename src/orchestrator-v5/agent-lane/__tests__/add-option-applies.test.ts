/**
 * ⭐ THE APPLY ROUTE for "add that option".
 *
 * ⛔ THE THING MOST LIKELY TO BE WRONG, AND THEREFORE THE THING PINNED HARDEST:
 * the base hash moves on every write. `structural_add_edge` refuses
 * `BASE_HASH_DIVERGED` against a stale base, and the node write moves the hash —
 * so reusing the proposal's base hash for the edges would refuse every edge AFTER
 * the user approved. The fake below CHECKS the hash it is handed and refuses a
 * stale one, exactly as the served writer does. Without the re-read, these go red.
 */

import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440000';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'u', request_id: 'r' };

type N = { id: string; kind: string; label: string };
type E = { from: string; to: string; effect_direction?: string };

/** Mirrors the served writers: every write moves the hash, and a stale base refuses. */
function fakeProduct() {
  let nodes: N[] = [
    { id: 'goal', kind: 'goal', label: 'Increase velocity' },
    { id: 'dev_headcount', kind: 'factor', label: 'Developer headcount' },
    { id: 'lead_time', kind: 'factor', label: 'Lead time' },
  ];
  let edges: E[] = [];
  let rev = 0;
  const refusedStale: string[] = [];
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as Record<string, string>;
      if (ev.base_graph_hash !== `h${rev}`) {
        refusedStale.push(`${ev.kind}:${ev.base_graph_hash}`);
        return { status: 200, json: { assistant_text: 'BASE_HASH_DIVERGED — nothing was written.' } };
      }
      if (ev.kind === 'structural_add') { nodes = [...nodes, { id: ev.node_id, kind: ev.node_kind, label: ev.label }]; rev += 1; return { status: 200, json: { assistant_text: 'Added.' } }; }
      if (ev.kind === 'structural_add_edge') { edges = [...edges, { from: ev.from, to: ev.to, effect_direction: ev.effect_direction }]; rev += 1; return { status: 200, json: { assistant_text: 'Linked.' } }; }
    }
    return { status: 200, json: { graph: { nodes, edges }, graph_hash: `h${rev}` } };
  };
  return { d, read: () => ({ nodes, edges }), refusedStale };
}

const ASK = {
  label: 'Hire a contractor',
  acts_on: [
    { factor_label: 'Developer headcount', direction: 'positive' as const },
    { factor_label: 'Lead time', direction: 'negative' as const },
  ],
  rationale: 'a faster route to capacity',
};

describe('adding an option the user picked', () => {
  it('⭐ the option and BOTH links land — the hash re-read is what makes this pass', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeNewOption(ctx, ASK);
    expect(prop.ok, JSON.stringify(prop)).toBe(true);
    // Proposal only — nothing written yet.
    expect(p.read().nodes.some((n) => n.kind === 'option')).toBe(false);

    const applied = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(applied.applied).toBe(true);
    const { nodes, edges } = p.read();
    const opt = nodes.find((n) => n.kind === 'option' && n.label === 'Hire a contractor');
    expect(opt, 'the option must exist').toBeDefined();
    expect(edges.map((e) => e.to).sort()).toEqual(['dev_headcount', 'lead_time']);
    // ⛔ THE DISCRIMINATOR: no write was ever refused for a stale base.
    expect(p.refusedStale).toEqual([]);
  });

  it('⭐ the STATED direction reaches the wire, per link — not one default for both', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeNewOption(ctx, ASK);
    await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    const byTo = Object.fromEntries(p.read().edges.map((e) => [e.to, e.effect_direction]));
    expect(byTo).toEqual({ dev_headcount: 'positive', lead_time: 'negative' });
  });

  it('⛔ the result says it CANNOT be compared yet — a receipt, not a reassurance', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeNewOption(ctx, ASK);
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    expect(String(applied.follow_up)).toContain('cannot be compared yet');
    expect(applied.option).toEqual({ label: 'Hire a contractor', linked_to: ['Developer headcount', 'Lead time'] });
  });

  it('⛔ CONTROL: if the node write does not land, NO edges are attempted', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeNewOption(ctx, ASK);
    // Make the node write refuse by moving the graph under the proposal.
    await p.d('/orchestrate/v2/turn', { kind: 'system_event', event: { kind: 'structural_add', node_id: 'x', node_kind: 'factor', label: 'X', base_graph_hash: 'h0' } });
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    expect(applied.ok).toBe(false);
    // ⛔ THE INVARIANT: a refused start writes NO edges. An option linked to some
    // of what was approved is not what the user agreed to.
    expect(p.read().edges).toEqual([]);
    expect(p.read().nodes.some((n) => n.kind === 'option')).toBe(false);
  });
});
