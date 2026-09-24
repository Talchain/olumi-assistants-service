/**
 * ⛔ A STARTING VALUE CAN ONLY BE PROPOSED FOR A NODE THE VALUE WRITER ACCEPTS — enforced at
 * PROPOSAL time, by the writer's own rule (`SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS`).
 *
 * MEASURED on served `778f1fd` (OpenAI Connected witness `c7a`, scenario `b9041553…`, 24 Sep
 * 03:05:42Z): the hiring starting point proposed a value for `hiring_ramp_up_delay` — a RISK
 * node. The proposer matched it by label, whatever its kind; the served `factor_value_edit`
 * refused it (`entity_kind_mismatch_at_execute`), and the approval came back "Not saved: none of
 * it was applied" — the user approved and NOTHING landed, so no analysis could run.
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS } from '../../tools/handlers/set-factor-value.js';

const SCENARIO = '6b5a4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'r' };
const NODES = [
  { id: 'velocity', kind: 'goal', label: 'Delivery velocity' },
  { id: 'onboarding_load', kind: 'factor', label: 'Onboarding load', category: 'observable' },
  { id: 'hiring_ramp_up_delay', kind: 'risk', label: 'Hiring ramp-up delay' },
  { id: 'hire_two', kind: 'option', label: 'Hire two developers' },
];
const read: InternalDispatch = async () => ({ status: 200, json: { graph: { nodes: NODES, edges: [] }, graph_hash: 'h0' } });

function caps() {
  const store = new ProposalStore();
  return { store, c: createAgentCapabilities(read, store, undefined, 'full') };
}
const kindOf = (id: string) => NODES.find((n) => n.id === id)?.kind;

describe('a starting value is only proposed for a node the value writer accepts', () => {
  it('RED: a value named for a RISK is not proposed; the factor beside it still is, and the risk is reported back', async () => {
    const { c, store } = caps();
    const r = await c.proposeAssumptions(ctx, { assumptions: [
      { factor_label: 'Hiring ramp-up delay', value: 3, unit: 'months', basis: 'typical' },
      { factor_label: 'Onboarding load', value: 0.4, unit: '', basis: 'typical' },
    ] });
    expect(r.ok).toBe(true);
    const ops = store.get(String(r.proposal_id))!.operations;
    // The writer's own admission, imported — every proposed value is one it will accept.
    expect(ops.every((o) => SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS.includes(String(kindOf(o.path))))).toBe(true);
    expect(ops.map((o) => o.path)).toEqual(['onboarding_load']);
    expect(r['not_a_factor']).toEqual([{ label: 'Hiring ramp-up delay', kind: 'risk' }]);
  });

  it('only a non-factor named → nothing to adopt, with the reason stated (never a proposal that cannot land)', async () => {
    const { c } = caps();
    const r = await c.proposeAssumptions(ctx, { assumptions: [{ factor_label: 'Hiring ramp-up delay', value: 3, unit: 'months', basis: 'typical' }] });
    expect(r).toMatchObject({ ok: false, refusal: 'nothing_to_adopt', not_a_factor: [{ label: 'Hiring ramp-up delay', kind: 'risk' }] });
  });

  it('the starting point (values + levels) inherits the rule — its value half never targets a risk', async () => {
    const { c, store } = caps();
    const r = await c.proposeStartingPoint(ctx, { assumptions: [
      { factor_label: 'Hiring ramp-up delay', value: 3, unit: 'months', basis: 'typical' },
      { factor_label: 'Onboarding load', value: 0.4, unit: '', basis: 'typical' },
    ], levels: [] } as never);
    const id = String(r.proposal_id ?? '');
    const ops = id ? store.get(id)!.operations : [];
    expect(ops.filter((o) => o.op === 'set_factor_value').map((o) => o.path)).toEqual(['onboarding_load']);
  });

  it('CONTROL: the writer\'s rule is what this pins — factors only', () => {
    expect(SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS).toEqual(['factor']);
  });
});
