/**
 * ⛔ THE SENSITIVITY LOOP WAS A GUARANTEED DEAD END.
 *
 * The analysis instruction tells the model to name the one or two assumptions the
 * ordering is most sensitive to and "invite the user to change one and see how much
 * it matters". An assumption the ordering is sensitive to ALWAYS already holds a
 * value — otherwise it could not drive an ordering — and `proposeAssumptions`
 * refused exactly that case for every factor, so the invitation could never once be
 * honoured. Complete manifest of all eight agent tools checked: none could revise a
 * value that was already there.
 *
 * The blanket refusal itself was RIGHT and is untouched. It exists to stop the model
 * replacing somebody's number with a guess "under cover of adopting assumptions".
 * What it was never meant to catch is the user naming their own new figure, which is
 * the opposite act. `revise` is opt-in per factor, the old value is carried into the
 * approval the user is shown, and nothing writes without authorise_change.
 *
 * Assertions bind by IDENTITY — the exact node, the exact old and new figures, the
 * exact provenance — never "a proposal happened".
 */

import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440000';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'r' };

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown> };

const BASE: Node[] = [
  { id: 'monthly_churn_rate', kind: 'factor', label: 'Monthly churn rate', observed_state: { value: 4 } },
  { id: 'pro_subscribers', kind: 'factor', label: 'Pro subscribers' },
];

function fakeProduct() {
  const posted: unknown[] = [];
  const nodes: Node[] = BASE.map((n) => ({ ...n, observed_state: n.observed_state ? { ...n.observed_state } : undefined }));
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') { posted.push(b.event); return { status: 200, json: {} }; }
    return { status: 200, json: { graph: { nodes, edges: [] }, graph_hash: 'h0' } };
  };
  return { d, posted, read: () => nodes };
}

describe('the user can change an assumption the analysis named', () => {
  it('⭐ revises a value that is already there when the USER named the change', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeAssumptions(ctx, {
      assumptions: [{ factor_label: 'Monthly churn rate', value: 6, unit: '%', basis: 'the user asked what 6% would do', revise: true }],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.assumptions).toEqual([
      { factor: 'Monthly churn rate', value: 6, unit: '%', basis: 'the user asked what 6% would do', replaces: 4 },
    ]);
  });

  it('⛔ CONTROL: without `revise` the blanket refusal is exactly as it was', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeAssumptions(ctx, {
      assumptions: [{ factor_label: 'Monthly churn rate', value: 6, unit: '%', basis: 'a figure of my own' }],
    });
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('nothing_to_adopt');
    expect(r.already_valued).toEqual([{ label: 'Monthly churn rate', current_value: 4 }]);
  });

  it('⛔ the approval SAYS WHAT IT REPLACES — consent is not informed otherwise', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeAssumptions(ctx, {
      assumptions: [{ factor_label: 'Monthly churn rate', value: 6, unit: '%', basis: 'b', revise: true }],
    });
    // The old figure must be in the label the receipt quotes, not only the new one.
    expect(r.public_label).toContain('4 %');
    expect(r.public_label).toContain('6 %');
    expect(r.public_label).toMatch(/^Revise 1 value you asked to change: /);
  });

  it('a revision the user named is THEIRS, not the model’s', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeAssumptions(ctx, {
      assumptions: [{ factor_label: 'Monthly churn rate', value: 6, unit: '%', basis: 'b', revise: true }],
    });
    const stored = store.get(String(r.proposal_id));
    expect(stored?.provenance.authored_by).toBe('user_stated');
  });

  it('CONTROL: a mixed proposal is not laundered into the user’s name', async () => {
    const p = fakeProduct();
    const store = new ProposalStore();
    const caps = createAgentCapabilities(p.d, store);
    const r = await caps.proposeAssumptions(ctx, {
      assumptions: [
        { factor_label: 'Monthly churn rate', value: 6, unit: '%', basis: 'they asked', revise: true },
        { factor_label: 'Pro subscribers', value: 400, unit: 'subscribers', basis: 'my estimate' },
      ],
    });
    const stored = store.get(String(r.proposal_id));
    // One half is the model's own suggestion, so the whole proposal stays model_proposed.
    expect(stored?.provenance.authored_by).toBe('model_proposed');
    expect(r.public_label).toMatch(/^Revise 1 value and adopt 1 starting assumption: /);
  });

  it('⛔ PROPOSES ONLY — a revision still writes nothing without authorise_change', async () => {
    const p = fakeProduct();
    const caps = createAgentCapabilities(p.d, new ProposalStore());
    const r = await caps.proposeAssumptions(ctx, {
      assumptions: [{ factor_label: 'Monthly churn rate', value: 6, unit: '%', basis: 'b', revise: true }],
    });
    expect(r.mutated).toBe(false);
    expect(p.posted).toHaveLength(0);
    expect(p.read().find((n) => n.id === 'monthly_churn_rate')?.observed_state?.value).toBe(4);
  });
});
