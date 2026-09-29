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
  { id: 'onboarding_load', kind: 'factor', label: 'Onboarding load', category: 'observable', scale_frame: 100 },
  { id: 'team_size', kind: 'factor', label: 'Team size', category: 'controllable', scale_frame: 20, description: 'Hiring ramp-up delay' },
  { id: 'hiring_ramp_up_delay', kind: 'risk', label: 'Hiring ramp-up delay' },
  { id: 'hire_two', kind: 'option', label: 'Hire two developers' },
];
const edge = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' });
// The option acts on Onboarding load only, so ONE level makes the starting point complete.
const EDGES = [edge('hire_two', 'onboarding_load'), edge('onboarding_load', 'velocity'), edge('team_size', 'velocity'), edge('hiring_ramp_up_delay', 'velocity')];
const read: InternalDispatch = async () => ({ status: 200, json: { graph: { nodes: NODES, edges: EDGES }, graph_hash: 'h0' } });

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

  /**
   * ⛔ Independent review of #1800 (5806926323): the PRODUCTION shape is values + levels with BOTH halves
   * succeeding — and the joined result used to drop the value half's omission, so the starting point
   * looked complete at the moment of one-click consent.
   */
  const LEVEL = { option_label: 'Hire two developers', factor_label: 'Onboarding load', value: 60, basis: 'more onboarding' };
  it('RED (joined): risk value + factor value + a valid level → the compound holds only the factor and the level, and the left-out risk is disclosed before consent', async () => {
    const { c, store } = caps();
    const r = await c.proposeStartingPoint(ctx, { assumptions: [
      { factor_label: 'Hiring ramp-up delay', value: 3, unit: 'months', basis: 'typical' },
      { factor_label: 'Onboarding load', value: 40, unit: '', basis: 'typical' },
    ], option_levels: [LEVEL] } as never);
    expect(r.ok, JSON.stringify(r).slice(0, 400)).toBe(true);
    const ops = store.get(String(r.proposal_id))!.operations;
    expect(ops.filter((o) => o.op === 'set_factor_value').map((o) => o.path)).toEqual(['onboarding_load']);
    expect(ops.some((o) => o.op !== 'set_factor_value'), 'the level is in the compound too').toBe(true);
    expect(r['not_a_factor'], 'the omission reaches the Agent').toEqual([{ label: 'Hiring ramp-up delay', kind: 'risk' }]);
    expect(String(r['not_a_factor_note'])).toMatch(/before they approve/);
    expect(String(r.public_label), 'and the text being approved says so').toMatch(/left out, not a factor[^)]*Hiring ramp-up delay — a risk/);
  });

  it('CONTRAST: an all-factor complete starting point discloses no omission', async () => {
    const { c } = caps();
    const r = await c.proposeStartingPoint(ctx, { assumptions: [{ factor_label: 'Onboarding load', value: 40, unit: '', basis: 'typical' }], option_levels: [LEVEL] } as never);
    expect(r.ok).toBe(true);
    expect(r).not.toHaveProperty('not_a_factor');
    expect(String(r.public_label)).not.toMatch(/left out/);
  });

  it('CONTRAST: an all-risk input with no levels → nothing approvable, and the reason travels with the refusal', async () => {
    const { c } = caps();
    const r = await c.proposeStartingPoint(ctx, { assumptions: [{ factor_label: 'Hiring ramp-up delay', value: 3, unit: 'months', basis: 'typical' }], option_levels: [] } as never);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain('"not_a_factor":[{"label":"Hiring ramp-up delay","kind":"risk"}]');
  });

  it('an exact visible LABEL wins: a factor whose DESCRIPTION matches never steals a value named for the risk', async () => {
    const { c, store } = caps();
    // Team size's description is literally "Hiring ramp-up delay" — the risk's label.
    const r = await c.proposeAssumptions(ctx, { assumptions: [
      { factor_label: 'Hiring ramp-up delay', value: 3, unit: 'months', basis: 'typical' },
      { factor_label: 'Onboarding load', value: 40, unit: '', basis: 'typical' },
    ] });
    const ops = store.get(String(r.proposal_id))!.operations;
    expect(ops.map((o) => o.path), 'team_size must not receive the risk\'s value').toEqual(['onboarding_load']);
    expect(r['not_a_factor']).toEqual([{ label: 'Hiring ramp-up delay', kind: 'risk' }]);
  });

  it('CONTROL: the writer\'s rule is what this pins — factors only', () => {
    expect(SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS).toEqual(['factor']);
  });
});

describe('an INCOMPLETE starting point (both halves proposed) still reports what it left out', () => {
  const LEVEL = { option_label: 'Hire two developers', factor_label: 'Onboarding load', value: 60, basis: 'more onboarding' };
  it('both halves succeed but a level is missing → incomplete, and not_a_factor travels with it (Codex 5807008891)', async () => {
    // hire_two now acts on TWO factors, and only one level is given → incomplete.
    const edges = [...EDGES, edge('hire_two', 'team_size')];
    const rd: InternalDispatch = async () => ({ status: 200, json: { graph: { nodes: NODES, edges }, graph_hash: 'h0' } });
    const c = createAgentCapabilities(rd, new ProposalStore(), undefined, 'full');
    const r = await c.proposeStartingPoint(ctx, { assumptions: [
      { factor_label: 'Hiring ramp-up delay', value: 3, unit: 'months', basis: 'typical' },
      { factor_label: 'Onboarding load', value: 40, unit: '', basis: 'typical' },
    ], option_levels: [LEVEL] } as never);
    expect(r.ok).toBe(false);
    expect(String(r.refusal)).toBe('incomplete_starting_point');
    expect(r['not_a_factor']).toEqual([{ label: 'Hiring ramp-up delay', kind: 'risk' }]);
  });
});
