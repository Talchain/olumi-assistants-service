/**
 * `get_canonical_state` must not strip the carriers the Agent needs to reason
 * truthfully about a magnitude.
 *
 * ⛔ WHAT WAS MEASURED. The live projection returned only `label`, `full_label`,
 * `kind` and a bare `value`. Every other carrier the persisted graph holds was
 * dropped, so the Agent saw `value: 0.49` with no unit, no scale and no idea
 * whether a human or the system put it there — and the only way to act on an
 * entity was a fuzzy label match, because the node's own `id` was withheld.
 *
 * FIXTURE PROVENANCE: the keys below are not invented. They are the keys the
 * estate actually persists, counted across all stored graphs on 22 Sep 2026:
 *
 *   id 211,211 · provenance 209,115 · display_value 34,107 · observed_state 27,728
 *   observed_state.value 27,728 · .source 27,654 · .extractionType 26,894
 *   .unit 9,490 · .raw_value 8,080 · .cap 4,345 · .declared_scale 736
 *   scale_frame 5,803
 *
 * Why the scale carriers matter more than they look: a bare amount with no
 * `cap`, no `raw_value`/`value` pair and no declared scale is not merely
 * under-described, it is UNANALYSABLE — the product refuses it downstream. An
 * Agent that cannot see those fields cannot tell a user why.
 *
 * Asserted at the TOP OF THE CHAIN — `dispatchTool`, the function the route
 * calls — not against the projection in isolation.
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { dispatchTool } from '../runtime/agent-tools.js';

const SCENARIO = '11111111-1111-1111-1111-111111111111';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'req-1' };

/** Every key here is one the estate persists — see the counts above. */
const PRICE = {
  id: 'price',
  kind: 'factor',
  label: 'Pro plan price',
  display_value: '£49',
  provenance: { source: 'user_specified' },
  scale_frame: { kind: 'bounded', min: 0, max: 100 },
  observed_state: {
    value: 0.49,
    raw_value: 49,
    unit: 'GBP',
    cap: 100,
    declared_scale: 'ratio',
    source: 'user_stated',
    extractionType: 'explicit',
  },
};

/** The contrast: an entity the graph holds NO magnitude for. */
const BARE = { id: 'churn', kind: 'factor', label: 'Monthly churn' };

const dispatcher = (nodes: unknown[]): InternalDispatch =>
  async () => ({ status: 200, json: { graph: { nodes, edges: [] }, graph_hash: 'h'.repeat(64) } });

async function entitiesFor(nodes: unknown[]) {
  const caps = createAgentCapabilities(dispatcher(nodes), new ProposalStore());
  const r = (await dispatchTool('get_canonical_state', '{}', ctx, caps)) as Record<string, unknown>;
  expect(r.ok).toBe(true);
  return r.entities as Array<Record<string, unknown>>;
}

describe('get_canonical_state — the Agent can address an entity', () => {
  it('carries the node ID, so an entity can be named without guessing at labels', async () => {
    const [price] = await entitiesFor([PRICE]);
    expect(price.id).toBe('price');
  });
});

describe('get_canonical_state — the Agent can see the magnitude honestly', () => {
  it('carries the normalised value AND the user-facing raw value — they are different facts', async () => {
    const [price] = await entitiesFor([PRICE]);
    expect(price.value).toBe(0.49);
    expect(price.raw_value).toBe(49);
    expect(price.display_value).toBe('£49');
  });

  it('carries the unit', async () => {
    const [price] = await entitiesFor([PRICE]);
    expect(price.unit).toBe('GBP');
  });

  it('carries the scale carriers that decide whether a value is analysable at all', async () => {
    const [price] = await entitiesFor([PRICE]);
    expect(price.cap).toBe(100);
    expect(price.declared_scale).toBe('ratio');
    expect(price.scale_frame).toEqual({ kind: 'bounded', min: 0, max: 100 });
  });
});

describe('get_canonical_state — the Agent can see WHO said it', () => {
  it('carries value provenance, distinct from entity provenance', async () => {
    const [price] = await entitiesFor([PRICE]);
    // Who put THIS NUMBER here …
    expect(price.value_provenance).toEqual({ source: 'user_stated', extraction_type: 'explicit' });
    // … versus where the ENTITY came from.
    expect(price.provenance).toEqual({ source: 'user_specified' });
  });
});

describe('get_canonical_state — absence stays absence', () => {
  it('CONTROL: an entity with no magnitude carries no invented carriers', async () => {
    const [bare] = await entitiesFor([BARE]);
    expect(bare.id).toBe('churn');
    // `value` keeps its existing convention: null means "none stored", never 0.
    expect(bare.value).toBeNull();
    // The rest must be ABSENT keys, not nulls a model would read as a fact.
    for (const k of ['raw_value', 'unit', 'cap', 'declared_scale', 'scale_frame', 'display_value', 'value_provenance']) {
      expect(bare[k], `${k} must be absent, not null`).toBeUndefined();
    }
  });

  it('POSITIVE CONTROL: the projection still carries what it always did', async () => {
    const [price] = await entitiesFor([PRICE]);
    expect(price.label).toBe('Pro plan price');
    expect(price.kind).toBe('factor');
  });
});
