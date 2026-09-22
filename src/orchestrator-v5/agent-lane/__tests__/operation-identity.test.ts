/**
 * The durable operation identity carried into the write boundary.
 *
 * ⛔ THE DEFECT THIS PINS. The authorised write minted `randomUUID()` for
 * `turn_id`. A retry of the SAME authorisation was therefore a different
 * operation to every layer beneath it, `(scenario_id, turn_id)` could never
 * match, and the deployed `append_turn_atomic_v5` replay arm was unreachable by
 * construction — not because replay is broken, but because nothing ever
 * presented it with a repeated identity.
 */

import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, authorisationTurnId, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '11111111-1111-1111-1111-111111111111';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'r' };

const GRAPH = {
  nodes: [
    { id: 'competitive_pricing', kind: 'factor', label: 'Competitive pricing' },
    { id: 'monthly_churn', kind: 'factor', label: 'Monthly churn' },
  ],
  edges: [] as { from: string; to: string }[],
};

/** Records every turn posted to the product, so identity is read off the wire. */
function recordingDispatch() {
  const posted: { path: string; turn_id?: string; kind?: string }[] = [];
  let edges = [...GRAPH.edges];
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    posted.push({ path, turn_id: b.turn_id as string, kind: b.kind as string });
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as { from: string; to: string };
      edges = [...edges, { from: ev.from, to: ev.to }];
      return { status: 200, json: { assistant_text: 'Added.' } };
    }
    return { status: 200, json: { graph: { nodes: GRAPH.nodes, edges }, graph_hash: `h${edges.length}` } };
  };
  return { d, posted };
}

async function authoriseOnce() {
  const { d, posted } = recordingDispatch();
  const caps = createAgentCapabilities(d, new ProposalStore());
  const proposal = await caps.proposeModelChange(ctx, {
    from_label: 'Competitive pricing', to_label: 'Monthly churn',
    direction: 'negative', rationale: 'competitor discounts raise churn',
  });
  const applied = await caps.authoriseChange(ctx, { proposal_id: String(proposal.proposal_id) });
  const write = posted.find((p) => p.kind === 'system_event');
  return { proposal, applied, write, posted };
}

describe('the operation identity carried into the write', () => {
  it('is DERIVED from the proposal, so the same authorisation repeats the same key', async () => {
    const a = await authoriseOnce();
    expect(a.applied.ok, JSON.stringify(a.applied)).toBe(true);
    expect(a.write?.turn_id).toBe(authorisationTurnId(String(a.proposal.proposal_id)));

    // Run the whole thing again from scratch: same scenario, same labels, same
    // direction => same proposal id => same operation identity on the wire.
    const b = await authoriseOnce();
    expect(b.proposal.proposal_id).toBe(a.proposal.proposal_id);
    expect(b.write?.turn_id).toBe(a.write?.turn_id);
  });

  it('CHANGES when the mutation changes — the contrast control', async () => {
    // Same run shape, one difference: the opposite direction. If the identity
    // were constant, the test above would be measuring nothing.
    const { d, posted } = recordingDispatch();
    const caps = createAgentCapabilities(d, new ProposalStore());
    const p = await caps.proposeModelChange(ctx, {
      from_label: 'Competitive pricing', to_label: 'Monthly churn',
      direction: 'positive', rationale: 'competitor discounts raise churn',
    });
    await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    const other = await authoriseOnce();
    expect(posted.find((x) => x.kind === 'system_event')?.turn_id).not.toBe(other.write?.turn_id);
  });

  it('reports the identity it used, so a witness can bind to it', async () => {
    const a = await authoriseOnce();
    expect(a.applied.operation_id).toBe(a.write?.turn_id);
  });
});
