/**
 * ⛔ A STARTING POINT MUST COVER EVERY FACTOR EACH OPTION ACTS ON.
 *
 * MEASURED on served 63cf4dcf (journey witness, direct transport): the starting
 * point gave "Stage Hiring After Review" ONE level while the option is wired to
 * three factors; readiness then blocked the whole comparison (`missing_value`)
 * and the user needed a second approval. The pairs still missing are now
 * computed deterministically (same reader as the write, `linkedFactorsOf`) and
 * returned before the user is shown anything; a newer starting point replaces
 * the caller's earlier unapproved one, so only the latest set awaits approval.
 */

import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '8b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const USER = 'user-a';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: USER, request_id: 'r' };
const edge = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' });

const NODES = [
  { id: 'velocity', kind: 'goal', label: 'Velocity' },
  { id: 'team_size', kind: 'factor', label: 'Team size', category: 'controllable', observed_state: { value: 0.5, raw_value: 5, cap: 10, unit: 'FTE' } },
  { id: 'coordination_load', kind: 'factor', label: 'Coordination load', category: 'observable', scale_frame: 100 },
  { id: 'hire_two', kind: 'option', label: 'Hire Two Developers' },
  { id: 'staged', kind: 'option', label: 'Stage Hiring After Review' },
];
// `staged` acts on BOTH factors; `hire_two` on Team size only.
const EDGES = [edge('hire_two', 'team_size'), edge('staged', 'team_size'), edge('staged', 'coordination_load'),
  edge('team_size', 'velocity'), edge('coordination_load', 'velocity')];

const product = (): InternalDispatch => async () => ({ status: 200, json: { graph: { nodes: NODES, edges: EDGES }, graph_hash: 'h0' } });
const VALUES = [{ factor_label: 'Coordination load', value: 40, unit: 'index points (0-100)', basis: 'five people, one lead' }];

describe('a starting point covers every factor each option acts on', () => {
  it('RED: names each (option, linked factor) pair the proposal leaves without a level', async () => {
    const caps = createAgentCapabilities(product(), new ProposalStore());
    const r = await caps.proposeStartingPoint(ctx, { assumptions: VALUES, option_levels: [
      { option_label: 'Hire Two Developers', factor_label: 'Team size', value: 7, basis: 'five plus two' },
      { option_label: 'Stage Hiring After Review', factor_label: 'Team size', value: 5, basis: 'no hires in stage one' },
    ] });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.options_missing_levels).toEqual([{ option: 'Stage Hiring After Review', factor: 'Coordination load' }]);
  });

  it('CONTRAST: a complete starting point reports nothing missing', async () => {
    const caps = createAgentCapabilities(product(), new ProposalStore());
    const r = await caps.proposeStartingPoint(ctx, { assumptions: VALUES, option_levels: [
      { option_label: 'Hire Two Developers', factor_label: 'Team size', value: 7, basis: 'five plus two' },
      { option_label: 'Stage Hiring After Review', factor_label: 'Team size', value: 5, basis: 'no hires in stage one' },
      { option_label: 'Stage Hiring After Review', factor_label: 'Coordination load', value: 35, basis: 'review lowers load' },
    ] });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r).not.toHaveProperty('options_missing_levels');
  });

  it('RED: a newer starting point REPLACES the earlier unapproved one — only the latest awaits approval', async () => {
    const store = new ProposalStore();
    const caps = createAgentCapabilities(product(), store);
    const first = await caps.proposeStartingPoint(ctx, { assumptions: VALUES, option_levels: [
      { option_label: 'Hire Two Developers', factor_label: 'Team size', value: 7, basis: 'five plus two' },
    ] });
    const second = await caps.proposeStartingPoint(ctx, { assumptions: VALUES, option_levels: [
      { option_label: 'Hire Two Developers', factor_label: 'Team size', value: 7, basis: 'five plus two' },
      { option_label: 'Stage Hiring After Review', factor_label: 'Team size', value: 5, basis: 'no hires in stage one' },
      { option_label: 'Stage Hiring After Review', factor_label: 'Coordination load', value: 35, basis: 'review lowers load' },
    ] });
    expect(first.ok && second.ok).toBe(true);
    expect(first.proposal_id).not.toBe(second.proposal_id);
    expect(store.outstanding(SCENARIO, USER).map((o) => o.proposal_id)).toEqual([second.proposal_id]);
  });
});
