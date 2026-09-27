/**
 * ⭐ PJ-C1 TOKENS: THE GIVEN STATE AND THE TOOL LIST CARRY NOTHING THE TURN CANNOT USE (#70 5859578339).
 *
 * Measured on the final served graphs of journeys A / C / E (X3 run 194514Z, CEE cd489f1): the state given with every
 * turn is 11.5–12.8k characters, and 1.4–1.6k of it is `existing_links` — `"<from> -> <to>"` for every edge, an exact
 * copy of `links[].from/to`, which the same object also carries. And every populated turn is offered
 * `build_model_from_brief`, which refuses on any model that has entities (`model_already_exists`,
 * agent-capabilities.ts `buildModelFromBrief`) — a schema paid for on every call and never usable.
 *
 * The rules under test:
 *   - the given state has no `existing_links`, and `links` still names every edge, by its endpoints;
 *   - a FRESH packet whose state holds addressable entities withholds `build_model_from_brief`, said as omitted with
 *     its reason; an EMPTY model, an absent packet and a stale one keep it (fail safe, as `get_canonical_state`): the
 *     server's own refusal stays the boundary either way.
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { eligibleTools, issueContextPacket, type CanonicalContextPacket } from '../runtime/request-assembly.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440091';
const graph = {
  nodes: [
    { id: 'dec', kind: 'decision', label: 'Pro price' },
    { id: 'opt_a', kind: 'option', label: 'Keep Pro at £49' },
    { id: 'opt_b', kind: 'option', label: 'Raise Pro to £59' },
    { id: 'price', kind: 'factor', label: 'Pro plan price' },
    { id: 'mrr', kind: 'goal', label: 'MRR' },
  ],
  edges: [
    { from: 'dec', to: 'opt_a' },
    { from: 'dec', to: 'opt_b' },
    { from: 'opt_a', to: 'price' },
    { from: 'opt_b', to: 'price' },
    { from: 'price', to: 'mrr', strength: { mean: 0.5, std: 0.1 }, effect_direction: 'positive', exists_probability: 1 },
  ],
};
const d: InternalDispatch = async (path) => (path.endsWith('/graph') ? { status: 200, json: { graph, graph_hash: 'h1' } } : { status: 500, json: {} });
const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: '', user_turn_text: '' };

describe('the given state carries each edge once', () => {
  it('RED: no `existing_links`; `links` names every edge by its endpoints, one entry per edge', async () => {
    const s = (await createAgentCapabilities(d, new ProposalStore()).getCanonicalState(ctx)) as unknown as Record<string, unknown>;
    expect(s.ok, JSON.stringify(s)).toBe(true);
    // CONTROL: the edge list this state is read from is the one above, so "every edge" is a real set.
    const links = s.links as { from: string; to: string }[];
    expect(links.map((l) => `${l.from} -> ${l.to}`)).toEqual(graph.edges.map((e) => `${e.from} -> ${e.to}`));
    expect(s).not.toHaveProperty('existing_links');
  });
});

describe('a populated model is not offered a build it would refuse', () => {
  const SECRET = 'server-side-secret-value';
  const REV = 'a'.repeat(64);
  const USER = 'user-a';
  const expectation = { scenario_id: SCENARIO, authenticated_user_id: USER, graph_revision: REV, current_turn: 0, binding_secret: SECRET };
  const packet = (state: unknown, over: Partial<{ graph_revision: string }> = {}): CanonicalContextPacket =>
    issueContextPacket({ scenario_id: SCENARIO, authenticated_user_id: USER, graph_revision: REV, captured_at_turn: 0, state, ...over }, SECRET);
  const entity = { id: 'opt_a', label: 'Keep Pro at £49', kind: 'option', value: null };
  const names = (r: ReturnType<typeof eligibleTools>) => r.tools.map((t) => t.name);

  it('RED: a FRESH packet with entities → build_model_from_brief withheld, and said so with its reason', () => {
    const r = eligibleTools({ mode: 'full', context: packet({ entities: [entity], structure: {} }), expectation });
    expect(r.freshness.kind).toBe('fresh');
    expect(names(r)).not.toContain('build_model_from_brief');
    expect(r.omitted).toContainEqual({ name: 'build_model_from_brief', reason: 'model_already_exists' });
    // The C1 omission is unchanged beside it.
    expect(r.omitted).toContainEqual({ name: 'get_canonical_state', reason: 'context_already_supplied' });
  });

  it('CONTROL: a fresh packet of the EMPTY model (the first brief) keeps build_model_from_brief', () => {
    const r = eligibleTools({ mode: 'full', context: packet({ entities: [], empty: true, structure: {} }), expectation });
    expect(names(r)).toContain('build_model_from_brief');
    expect(r.omitted.map((o) => o.name)).not.toContain('build_model_from_brief');
  });

  it('CONTROL (fail safe): no packet, or a stale one, keeps build_model_from_brief whatever it claims', () => {
    for (const context of [null, packet({ entities: [entity], structure: {} }, { graph_revision: 'b'.repeat(64) })]) {
      const r = eligibleTools({ mode: 'full', context, expectation });
      expect(names(r)).toContain('build_model_from_brief');
    }
  });

  it('CONTROL (fail safe): a fresh packet whose entities are not addressable keeps every tool', () => {
    const r = eligibleTools({ mode: 'full', context: packet({ entities: [{ label: 'no id' }], structure: {} }), expectation });
    expect(names(r)).toContain('build_model_from_brief');
    expect(names(r)).toContain('get_canonical_state');
  });
});
