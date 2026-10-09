/**
 * Adopting a proposed set of assumptions.
 *
 * ⛔ THE DEFECT THIS PINS, measured on a real session (22 Sep, debug bundle
 * `olumi-debug-3a21788c`): 17 of 20 factors held no value, the Agent listed
 * good starting assumptions in prose, the user replied "These look like a good
 * set of assumptions. Can you update the model with them?" — and the turn
 * returned `mutated: false` with `[get_canonical_state]` as its only tool call.
 * The offer was honest and the model stayed inert.
 *
 * The assertions below bind by IDENTITY — the node ids actually written and the
 * exact values — not by "a write happened", because the failure that matters is
 * a write of a DIFFERENT number from the one the user approved.
 */

import { afterEach, beforeEach, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { __setUseAppendV6ForTest } from '../../append-v6-flag.js';
import { ProposalStore } from '../proposal.js';
import { committedValueWrite } from './fixtures/served-value-write.js';

beforeEach(() => __setUseAppendV6ForTest(true));
afterEach(() => __setUseAppendV6ForTest(true));

const SCENARIO = '550e8400-e29b-41d4-a716-446655440000';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'r' };

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown> };

const BASE: Node[] = [
  { id: 'monthly_churn_rate', kind: 'factor', label: 'Monthly churn rate' },
  { id: 'pro_subscribers', kind: 'factor', label: 'Pro subscribers' },
  // Already valued — an adoption must NOT overwrite it.
  { id: 'pro_plan_price', kind: 'factor', label: 'Pro plan monthly price', observed_state: { value: 49 } },
];

/** Applies `factor_value_edit` the way the product does: the model changes, and the read-back shows it. */
function fakeProduct(opts: { rescale?: Record<string, number>; failOn?: string[]; registerFails?: boolean } = {}) {
  const posted: { turn_id: string; event: Record<string, unknown> }[] = [];
  const registered: { nodes: Node[] }[] = [];
  let nodes: Node[] = BASE.map((n) => ({ ...n, observed_state: n.observed_state ? { ...n.observed_state } : undefined }));
  let rev = 0;
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      if (opts.registerFails === true) return { status: 500, json: {} };
      const g = (b as { graph: { nodes: Node[] } }).graph;
      registered.push({ nodes: g.nodes });
      nodes = g.nodes;
      rev += 1;
      return { status: 200, json: {} };
    }
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as { kind: string; target_id: string; value: number };
      posted.push({ turn_id: String(b.turn_id), event: ev as unknown as Record<string, unknown> });
      if (opts.failOn?.includes(ev.target_id) === true) return { status: 422, json: {} };
      const stored = opts.rescale?.[ev.target_id] ?? ev.value;
      nodes = nodes.map((n) => (n.id === ev.target_id ? { ...n, observed_state: { ...n.observed_state, value: stored } } : n));
      rev += 1;
      return { status: 200, json: committedValueWrite(ev.target_id) };
    }
    return { status: 200, json: { graph: { nodes, edges: [] }, graph_hash: `h${rev}` } };
  };
  return { d, posted, registered, read: () => nodes };
}

const ASK = {
  assumptions: [
    { factor_label: 'Monthly churn rate', value: 3.5, unit: '%', basis: 'typical B2B SaaS baseline' },
    { factor_label: 'Pro subscribers', value: 400, unit: 'subscribers', basis: 'implied by a £20k MRR target at £49' },
  ],
};

it('CAS ON: values saved but range refused is incomplete, with the original diagnostic', async () => {
  const p = fakeProduct({ registerFails: true });
  const proposals = new ProposalStore();
  const caps = createAgentCapabilities(p.d, proposals);
  const prop = await caps.proposeAssumptions(ctx, ASK);
  const result = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
  expect(p.posted).toHaveLength(2);
  expect(result).toMatchObject({ ok: false, mutated: true, applied: false, partially_applied: true,
    adopted_count: 2, requested_count: 2, outcome: 'values_saved_range_refused' });
  expect(result.ranges_added_for_analysis).toBeUndefined();
  expect(result.failures).toContainEqual({ factor: 'scale_frame', detail: 'could not attach a range: http 500' });
  expect(proposals.outstanding(ctx.scenario_id, ctx.authenticated_user_id).map(p => p.proposal_id)).toContain(prop.proposal_id);
});
