/**
 * ⭐ THE AGENT READS A LINK'S BAND IN THE CANVAS'S VOCABULARY, NEVER GUESSES IT (R&C, #2003 served after-leg).
 *
 * Served on CEE `e13eda8` (#2003 in, OpenAI only): a hiring model's link "Tech lead hires → Engineering leadership
 * coverage" held mean 0.5 — the canvas's "Strong" — and the Agent told the user it was "an unvalidated MODERATE
 * effect". `get_canonical_state` handed the Agent the raw `strength.mean` and no band, so the model named the band from
 * its own priors (0.5 = the middle of 0–1 = "moderate"), contradicting the pill beside it. #2003 made every CEE phrase
 * read one table (`format/edge-strength-bands.ts`); this carries that table's word into the Agent's own view of a link.
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440079';
const edge = (to: string, mean: number) => ({ from: 'hires', to, strength: { mean, std: 0.125 }, exists_probability: 1,
  effect_direction: mean < 0 ? 'negative' : 'positive', provenance: { source: 'cee_hypothesis' }, defaulted: true });
const graph = {
  nodes: [
    { id: 'hires', kind: 'factor', label: 'Tech lead hires' },
    { id: 'lead', kind: 'factor', label: 'Engineering leadership coverage' },
    { id: 'cap', kind: 'factor', label: 'Effective delivery capacity' },
    { id: 'coord', kind: 'factor', label: 'Coordination overhead' },
    { id: 'ramp', kind: 'factor', label: 'Ramp-up load' },
    { id: 'v', kind: 'goal', label: 'Velocity' },
  ],
  // The served means (e13eda8): 0.5, 0.175, -0.75; plus the two band edges the served graph did not carry.
  edges: [edge('lead', 0.5), edge('cap', 0.175), edge('coord', -0.75), edge('ramp', 0.3), edge('v', 0.4)],
};
const d: InternalDispatch = async (path) => (path.endsWith('/graph') ? { status: 200, json: { graph, graph_hash: 'h1' } } : { status: 500, json: {} });
const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: '', user_turn_text: '' };

describe('get_canonical_state: every link carries its band, on the canvas\'s table', () => {
  it('RED (served e13eda8): the 0.5 link the canvas draws "Strong" reaches the Agent as band "strong"; every band on the table\'s cuts', async () => {
    const s = await createAgentCapabilities(d, new ProposalStore()).getCanonicalState(ctx);
    expect(s.ok, JSON.stringify(s)).toBe(true);
    const links = (s as unknown as { links: { to: string; band?: string; strength?: { mean: number } }[] }).links;
    const bandOf = Object.fromEntries(links.map((l) => [l.to, l.band]));
    expect(bandOf).toEqual({ lead: 'strong', cap: 'weak', coord: 'very strong', ramp: 'moderate', v: 'strong' });
    // The number is still there beside the word: the band is added, nothing is taken away.
    expect(links.find((l) => l.to === 'lead')?.strength?.mean).toBe(0.5);
  });

  it('CONTRAST: a link with no numeric strength carries no band (nothing is guessed on the way in either)', async () => {
    const bare = { ...graph, edges: [{ from: 'hires', to: 'lead', exists_probability: 1, effect_direction: 'positive' }] };
    const d2: InternalDispatch = async (path) => (path.endsWith('/graph') ? { status: 200, json: { graph: bare, graph_hash: 'h2' } } : { status: 500, json: {} });
    const s = await createAgentCapabilities(d2, new ProposalStore()).getCanonicalState(ctx);
    const links = (s as unknown as { links: Record<string, unknown>[] }).links;
    expect(links).toHaveLength(1);
    expect(links[0]).not.toHaveProperty('band');
  });
});
