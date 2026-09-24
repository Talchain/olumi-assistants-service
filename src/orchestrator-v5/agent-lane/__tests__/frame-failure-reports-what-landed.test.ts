/**
 * ⛔⛔ THE PARTIAL OUTCOME MUST BE TOLD TRUTHFULLY.
 *
 * Owner finding (PR #1743, note 5799139118, limb 2): the adopted-assumption path
 * saves the factor VALUES in their own registration, then attempts a second
 * registration to attach a range. If that second write is refused, the reply said
 * *"nothing was written"* — while the values had already landed — and still
 * reported applied/mutated success.
 *
 * That is the worst shape of untrue: it invites the user to redo a write that
 * succeeded, and hides that the analysis is still blocked.
 *
 * These are the owner note's own minimum controls: a POSITIVE control (unchanged
 * model accepts the frame) and a PARTIAL-OUTCOME control (value lands, frame CAS
 * refuses → the reply states the saved value and the unattached range).
 */
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440000';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'r' };

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown> };
const BASE: Node[] = [
  { id: 'monthly_churn_rate', kind: 'factor', label: 'Monthly churn rate' },
  { id: 'pro_subscribers', kind: 'factor', label: 'Pro subscribers' },
];

const ASK = {
  assumptions: [
    { factor_label: 'Monthly churn rate', value: 3.5, unit: '%', basis: 'typical B2B SaaS baseline' },
    { factor_label: 'Pro subscribers', value: 400, unit: 'subscribers', basis: 'implied by a target' },
  ],
};

/** `frameRefusal` refuses ONLY the frame registration, after the values landed. */
function product(opts: { frameRefusal?: boolean } = {}) {
  const posted: { target_id: string; value: number }[] = [];
  const registered: unknown[] = [];
  let nodes: Node[] = BASE.map((n) => ({ ...n }));
  let rev = 0;
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      if (opts.frameRefusal === true) {
        // The concurrent writer moved the model between the value write and this.
        return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      }
      const g = (b as { graph: { nodes: Node[] } }).graph;
      registered.push(b);
      nodes = g.nodes;
      rev += 1;
      return { status: 200, json: {} };
    }
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as { target_id: string; value: number };
      posted.push({ target_id: ev.target_id, value: ev.value });
      nodes = nodes.map((n) => (n.id === ev.target_id
        ? { ...n, observed_state: { ...n.observed_state, value: ev.value, raw_value: ev.value } }
        : n));
      rev += 1;
      return { status: 200, json: { assistant_text: 'Updated.' } };
    }
    return { status: 200, json: { graph: { nodes, edges: [] }, graph_hash: `h${rev}` } };
  };
  return { d, posted, registered, read: () => nodes };
}

async function authorise(opts: { frameRefusal?: boolean } = {}) {
  const p = product(opts);
  const caps = createAgentCapabilities(p.d, new ProposalStore());
  const prop = await caps.proposeAssumptions(ctx as never, ASK as never);
  const r = await caps.authoriseChange(ctx as never, { proposal_id: String(prop.proposal_id) } as never);
  return { p, r: r as Record<string, unknown> };
}

describe('POSITIVE CONTROL — an unchanged model accepts the intended frame', () => {
  it('⭐ attaches the range and reports NO partial outcome', async () => {
    const { p, r } = await authorise();
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(p.posted.length, 'no value was written — the control would be vacuous').toBeGreaterThan(0);
    expect(r.ranges_added_for_analysis, JSON.stringify(r)).toBeDefined();
    // The discriminator: nothing claims a partial outcome when there is none.
    expect(r.partially_applied).toBeUndefined();
    expect(r.ranges_not_attached).toBeUndefined();
    expect(r.analysis_still_blocked_for).toBeUndefined();
  });
});

describe('PARTIAL-OUTCOME CONTROL — the value landed, the range did not', () => {
  it('⛔ NEVER says nothing was written once a value has landed', async () => {
    const { p, r } = await authorise({ frameRefusal: true });
    // Precondition: the values really did land before the frame write failed.
    expect(p.posted.map((x) => x.target_id)).toEqual(['monthly_churn_rate', 'pro_subscribers']);

    const failures = (r.failures ?? []) as { factor?: string; detail: string }[];
    const frame = failures.find((f) => f.factor === 'scale_frame');
    expect(frame, 'no scale_frame failure recorded — this assertion would be vacuous').toBeDefined();
    // THE DEFECT: this exact sentence was shown to a user whose values had saved.
    expect(frame!.detail).not.toContain('nothing was written');
    expect(frame!.detail).toContain('WERE saved');
  });

  it('⭐ reports the saved values and the unattached range SEPARATELY', async () => {
    const { r } = await authorise({ frameRefusal: true });
    // What landed.
    expect(r.adopted_count, JSON.stringify(r)).toBe(2);
    // What did not, by identity — the factors, not a count.
    expect(r.partially_applied).toBe(true);
    const blocked = (r.analysis_still_blocked_for ?? []) as string[];
    expect(blocked.sort()).toEqual(['Monthly churn rate', 'Pro subscribers']);
    const notAttached = (r.ranges_not_attached ?? []) as { factor: string; range: number }[];
    expect(notAttached.length).toBe(2);
    for (const n of notAttached) expect(n.range).toBeGreaterThan(1);
    // And it must NOT also claim the ranges were added.
    expect(r.ranges_added_for_analysis).toBeUndefined();
  });

  it('⭐ tells the model to say the values are safe and must NOT be re-entered', async () => {
    // The user-facing consequence of the old wording was a redone write.
    const { r } = await authorise({ frameRefusal: true });
    const owed = String(r.not_represented ?? '');
    expect(owed).toContain('still blocked');
    expect(owed.toLowerCase()).toContain('re-entering');
  });
});
