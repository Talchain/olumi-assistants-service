/**
 * ⛔ AN OPTION THAT ACTS ON NO FACTOR IS NAMED BEFORE THE USER APPROVES — never discovered at the Run.
 *
 * MEASURED on served `6dfb56f` (witness `c8a`, hiring): the model's "Continue Current Hiring" had no link
 * to any factor. `missingPairs` passes such an option VACUOUSLY (it has no pair to miss), so the starting
 * point was offered as complete, one approval saved every value and level — and the Run straight after
 * was blocked on `OPTION_NO_FACTOR_EDGES`. The user approved believing that made the model runnable.
 *
 * Nothing is invented for the option here: the proposal names it, the Agent is told to ask what it
 * changes, and Olumi's own line says so beside the proposal.
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { notAdoptedLine } from '../write-outcome.js';

const SCENARIO = '9c2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const USER = 'user-a';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: USER, request_id: 'r' };
const edge = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' });

type Node = { id: string; kind: string; label: string; category?: string; observed_state?: Record<string, unknown>; scale_frame?: number };
const BASE: Node[] = [
  { id: 'velocity', kind: 'goal', label: 'Velocity' },
  { id: 'team_size', kind: 'factor', label: 'Team size', category: 'controllable', observed_state: { value: 0.5, raw_value: 5, cap: 10, unit: 'FTE' } },
  { id: 'coordination_load', kind: 'factor', label: 'Coordination load', category: 'observable', scale_frame: 100 },
  { id: 'hire_two', kind: 'option', label: 'Hire Two Developers' },
];
const INERT: Node = { id: 'continue_current', kind: 'option', label: 'Continue Current Hiring' };
const EDGES = [edge('hire_two', 'team_size'), edge('team_size', 'velocity'), edge('coordination_load', 'velocity')];

function product(nodes: readonly Node[]): InternalDispatch {
  return async (path) => {
    if (path.endsWith('/graph/register') || path === '/orchestrate/v2/turn') return { status: 400, json: {} };
    return { status: 200, json: { graph: { nodes, edges: EDGES }, graph_hash: 'h0' } };
  };
}

const VALUES = [{ factor_label: 'Coordination load', value: 40, unit: 'index points (0-100)', basis: 'five people, one lead' }];
const LEVELS = [{ option_label: 'Hire Two Developers', factor_label: 'Team size', value: 7, basis: 'five plus two' }];
const line = (r: unknown) => notAdoptedLine([{ name: 'propose_starting_point' }], [r as never]);

describe('a starting point names every option that acts on no factor', () => {
  it('RED: the joined proposal names the inert option, and Olumi says the model will still not run', async () => {
    const r = await createAgentCapabilities(product([...BASE, INERT]), new ProposalStore()).proposeStartingPoint(ctx, { assumptions: VALUES, option_levels: LEVELS });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(typeof r.proposal_id, 'the control: an approvable proposal was made').toBe('string');
    expect(r.options_acting_on_nothing).toEqual(['Continue Current Hiring']);
    expect(String(r.options_acting_on_nothing_note)).toMatch(/ask what each one changes/);
    expect(line(r)).toBe('Still needed before the analysis can run: "Continue Current Hiring" acts on no factor yet, so approving this will not make the model runnable — say what it changes.');
  });

  it('RED: a levels-only starting point (one half) names it too', async () => {
    const r = await createAgentCapabilities(product([...BASE.filter((n) => n.id !== 'coordination_load'), INERT]), new ProposalStore())
      .proposeStartingPoint(ctx, { assumptions: [], option_levels: LEVELS });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.options_acting_on_nothing).toEqual(['Continue Current Hiring']);
  });

  it('CONTRAST: every option acts on a factor → nothing named, no line', async () => {
    const r = await createAgentCapabilities(product(BASE), new ProposalStore()).proposeStartingPoint(ctx, { assumptions: VALUES, option_levels: LEVELS });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r).not.toHaveProperty('options_acting_on_nothing');
    expect(line(r)).toBeNull();
  });
});
