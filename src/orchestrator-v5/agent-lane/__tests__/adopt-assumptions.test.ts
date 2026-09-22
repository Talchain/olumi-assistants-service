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

import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, authorisationTurnId, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

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
function fakeProduct(opts: { rescale?: Record<string, number>; failOn?: string[] } = {}) {
  const posted: { turn_id: string; event: Record<string, unknown> }[] = [];
  let nodes: Node[] = BASE.map((n) => ({ ...n, observed_state: n.observed_state ? { ...n.observed_state } : undefined }));
  let rev = 0;
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as { kind: string; target_id: string; value: number };
      posted.push({ turn_id: String(b.turn_id), event: ev as unknown as Record<string, unknown> });
      if (opts.failOn?.includes(ev.target_id) === true) return { status: 422, json: {} };
      const stored = opts.rescale?.[ev.target_id] ?? ev.value;
      nodes = nodes.map((n) => (n.id === ev.target_id ? { ...n, observed_state: { ...n.observed_state, value: stored } } : n));
      rev += 1;
      return { status: 200, json: { assistant_text: 'Updated.' } };
    }
    return { status: 200, json: { graph: { nodes, edges: [] }, graph_hash: `h${rev}` } };
  };
  return { d, posted, read: () => nodes };
}

const ASK = {
  assumptions: [
    { factor_label: 'Monthly churn rate', value: 3.5, unit: '%', basis: 'typical B2B SaaS baseline' },
    { factor_label: 'Pro subscribers', value: 400, unit: 'subscribers', basis: 'implied by a £20k MRR target at £49' },
  ],
};

describe('propose_assumptions', () => {
  it('proposes without mutating, and the proposal names the exact figures shown', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeAssumptions(ctx, ASK);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.mutated).toBe(false);
    expect(p.posted).toHaveLength(0);
    expect(p.read().find((n) => n.id === 'monthly_churn_rate')?.observed_state?.value).toBeUndefined();
    expect(r.assumptions).toEqual([
      { factor: 'Monthly churn rate', value: 3.5, unit: '%', basis: 'typical B2B SaaS baseline' },
      { factor: 'Pro subscribers', value: 400, unit: 'subscribers', basis: 'implied by a £20k MRR target at £49' },
    ]);
  });

  it('leaves a factor that already holds a value alone, and says which', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeAssumptions(ctx, {
      assumptions: [
        { factor_label: 'Pro plan monthly price', value: 59, unit: '£', basis: 'the proposed increase' },
        { factor_label: 'Pro subscribers', value: 400, unit: 'subscribers', basis: 'implied' },
      ],
    });
    expect(r.left_alone_already_valued).toEqual([{ label: 'Pro plan monthly price', current_value: 49 }]);
    expect((r.assumptions as { factor: string }[]).map((a) => a.factor)).toEqual(['Pro subscribers']);
  });

  it('refuses a label the model does not have, rather than inventing a target', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeAssumptions(ctx, {
      assumptions: [{ factor_label: 'Customer acquisition cost', value: 90, unit: '£', basis: 'guess' }],
    });
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('nothing_to_adopt');
    expect(r.unresolved_labels).toEqual(['Customer acquisition cost']);
    expect(p.posted).toHaveLength(0);
  });

  it('is order-insensitive: the same set proposed in either order is ONE proposal', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const a = await caps.proposeAssumptions(ctx, ASK);
    const b = await caps.proposeAssumptions(ctx, { assumptions: [...ASK.assumptions].reverse() });
    expect(b.proposal_id).toBe(a.proposal_id);
  });
});

describe('authorise_change applies the STORED assumptions', () => {
  it('writes exactly the approved values, to the approved factors, and reports what landed', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeAssumptions(ctx, ASK);
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });

    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    expect(applied.mutated).toBe(true);
    expect(applied.adopted_count).toBe(2);
    // Bound by IDENTITY: which node, which number.
    expect(p.posted.map((x) => [x.event.target_id, x.event.value, x.event.unit])).toEqual([
      ['monthly_churn_rate', 3.5, '%'],
      ['pro_subscribers', 400, 'subscribers'],
    ]);
    expect(p.read().find((n) => n.id === 'monthly_churn_rate')?.observed_state?.value).toBe(3.5);
    // The already-valued factor was never touched.
    expect(p.read().find((n) => n.id === 'pro_plan_price')?.observed_state?.value).toBe(49);
    expect(String(applied.not_represented)).toMatch(/assumptions, not measurements/);
  });

  it('gives each value its OWN derived identity, so a retry repeats the same keys', async () => {
    const p1 = fakeProduct();
    const c1 = createAgentCapabilities(p1.d, new ProposalStore());
    const prop = await c1.proposeAssumptions(ctx, ASK);
    await c1.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });

    const id = String(prop.proposal_id);
    expect(p1.posted.map((x) => x.turn_id)).toEqual([
      authorisationTurnId(`${id}#0`),
      authorisationTurnId(`${id}#1`),
    ]);
    // Distinct per value — `(scenario_id, turn_id)` is unique, so a shared key
    // would silently drop the second value as a replay of the first.
    expect(new Set(p1.posted.map((x) => x.turn_id)).size).toBe(2);

    // A fresh process authorising the SAME proposal produces the SAME keys.
    const p2 = fakeProduct();
    const c2 = createAgentCapabilities(p2.d, new ProposalStore());
    const prop2 = await c2.proposeAssumptions(ctx, ASK);
    await c2.authoriseChange(ctx, { proposal_id: String(prop2.proposal_id) });
    expect(p2.posted.map((x) => x.turn_id)).toEqual(p1.posted.map((x) => x.turn_id));
  });

  it('DISCLOSES a value the model stored differently from the one approved', async () => {
    // The live defect this guards: current CEE stored a user's £49 as 0.49.
    const p = fakeProduct({ rescale: { monthly_churn_rate: 0.035 } });
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeAssumptions(ctx, ASK);
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    expect(applied.must_disclose_rescaling).toBe(true);
    expect(applied.rescaled_by_the_model).toEqual([
      { factor: 'Monthly churn rate', requested: 3.5, recorded: 0.035 },
    ]);
    expect(String(applied.not_represented)).toMatch(/stored differently from the one approved/);
  });

  it('reports a PARTIAL application as partial, and does not mark the proposal applied', async () => {
    const p = fakeProduct({ failOn: ['pro_subscribers'] });
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeAssumptions(ctx, ASK);
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    expect(applied.adopted_count).toBe(1);
    expect(applied.requested_count).toBe(2);
    expect(applied.values).toEqual([
      { factor: 'Monthly churn rate', requested: 3.5, recorded: 3.5 },
      { factor: 'Pro subscribers', requested: 400, recorded: null },
    ]);
    // Not marked applied, so a retry can still complete the rest.
    const again = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    expect(again.already_applied).toBeUndefined();
  });

  it('refuses honestly when NOTHING landed', async () => {
    const p = fakeProduct({ failOn: ['monthly_churn_rate', 'pro_subscribers'] });
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const prop = await caps.proposeAssumptions(ctx, ASK);
    const applied = await caps.authoriseChange(ctx, { proposal_id: String(prop.proposal_id) });
    expect(applied.ok).toBe(false);
    expect(applied.mutated).toBe(false);
    expect(applied.refusal).toBe('not_applied');
  });
});

describe('preview mode', () => {
  it('has no assumption-adoption surface at all', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore(), undefined, 'preview');
    const r = await caps.proposeAssumptions(ctx, ASK);
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('read_only_preview');
    expect(p.posted).toHaveLength(0);
  });
});

describe('the emitted event satisfies the REAL wire contract', () => {
  it('is accepted by SystemEventTurnPayloadSchema — the mock above does not validate, the boundary does', async () => {
    const { SystemEventTurnPayloadSchema } = await import('@talchain/schemas/boundary');
    const payload = {
      kind: 'system_event' as const,
      turn_id: authorisationTurnId('prop_ff26e7596c7a8bafc3e1695e4b362aa5#0'),
      scenario_id: SCENARIO,
      stage: 'frame' as const,
      event: { kind: 'factor_value_edit', target_id: 'monthly_churn_rate', value: 3.5, unit: '%' },
    };
    const ok = SystemEventTurnPayloadSchema.safeParse(payload);
    expect(ok.success, JSON.stringify(ok.success ? {} : ok.error.issues.slice(0, 3))).toBe(true);

    // Contrast control: the event is `.strict()`, so the field the edge path
    // carries is REFUSED here. This is why the apply branch omits it.
    const bad = SystemEventTurnPayloadSchema.safeParse({
      ...payload,
      event: { ...payload.event, base_graph_hash: 'abc' },
    });
    expect(bad.success).toBe(false);
  });
});
