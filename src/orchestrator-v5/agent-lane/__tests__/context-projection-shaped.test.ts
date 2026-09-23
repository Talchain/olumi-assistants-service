/**
 * OMITTING A TOOL REMOVES THE FALLBACK, SO THE PACKET MUST EARN THE OMISSION.
 *
 * ⛔ THE DEFECT THIS PINS, and it was created by a merge, not by this PR.
 * Staging #1698 (`fix(agent): get_canonical_state must not strip the carriers
 * the Agent reasons with`) established ONE projection — `projectEntity` — used by
 * every tool that hands the Agent entities, for a reason its own docblock states:
 *
 *   "Two field lists will always drift; one cannot."
 *
 * `eligibleTools` drops `get_canonical_state` whenever a verified packet is
 * supplied, and `CanonicalContextPacket.state` is `unknown` — opaque, supplied by
 * the caller, bound to no projection. That is a SECOND field list by construction.
 *
 * ⚠ What makes it more than a drift risk: dropping the tool removes the Agent's
 * RECOVERY. Before this helper, a thin context still left `get_canonical_state`
 * on the list, so the model could fetch the carriers itself. After it, a thin
 * packet is terminal for the turn — the Agent cannot ask for what it was not given.
 *
 * So the omission must be conditional on positive evidence that the state carries
 * addressable entities, and must FAIL SAFE (keep the tool) otherwise. The cost of
 * failing safe is one round trip. The cost of failing open is the Agent silently
 * reasoning without the carriers #1698 restored.
 *
 * ⚠ NOT IMPORTING `projectEntity`. It lives in `agent-capabilities.ts`, which this
 * lane may not edit without a lease, and it does not exist at this branch's base
 * (#1698 merged after it). The predicate is therefore STRUCTURAL — it asserts the
 * keys `projectEntity` emits unconditionally (`id`, `label`, `kind`, `value`)
 * without importing or duplicating it. `id` is the one the #1698 docblock singles
 * out: "⭐ THE ID. Without it the only way to act on an entity was a fuzzy label
 * match, which collides and cannot address two entities that read alike."
 *
 * EVERY CASE BELOW ASSERTS `freshness.kind === 'fresh'`. Without that a test could
 * pass because verification failed rather than because the gate fired — the
 * non-vacuity control, since both failure modes return the full tool set.
 */
import { describe, it, expect } from 'vitest';
import { eligibleTools, issueContextPacket } from '../runtime/request-assembly.js';
import { toolsFor } from '../runtime/agent-tools.js';

const SCENARIO = '11111111-1111-1111-1111-111111111111';
const USER = 'user-a';
const REV = 'a'.repeat(64);
const SECRET = 'server-secret';
const TOOL = 'get_canonical_state';

const expectation = {
  scenario_id: SCENARIO,
  authenticated_user_id: USER,
  graph_revision: REV,
  current_turn: 3,
  binding_secret: SECRET,
};

const packetWith = (state: unknown) =>
  issueContextPacket(
    {
      scenario_id: SCENARIO,
      authenticated_user_id: USER,
      graph_revision: REV,
      captured_at_turn: 3,
      state,
    },
    SECRET,
  );

const run = (state: unknown) =>
  eligibleTools({ mode: 'full', context: packetWith(state), expectation });

const names = (r: { tools: readonly { name: string }[] }) => r.tools.map((t) => t.name);

/** A node as `projectEntity` emits it: the four unconditional keys, plus carriers. */
const projected = {
  id: 'node-1',
  label: 'Monthly burn',
  kind: 'factor',
  value: 0.45,
  raw_value: 9,
  unit: 'months',
  cap: 20,
};

describe('a packet must be projection-shaped before the tool is omitted', () => {
  it('OMITS the tool when every entity carries the projection keys', () => {
    const r = run({ entities: [projected] });
    expect(r.freshness.kind).toBe('fresh'); // non-vacuity
    expect(names(r)).not.toContain(TOOL);
    expect(r.omitted.map((o) => o.name)).toEqual([TOOL]);
  });

  it('⛔ KEEPS the tool when entities are present but carry NO id', () => {
    // Exactly the shape the pre-#1698 inline projection produced: a label/kind/
    // value triple with no addressable identity. The Agent cannot act on these,
    // and without the tool it cannot go and get better ones.
    const r = run({ entities: [{ label: 'Monthly burn', kind: 'factor', value: 0.45 }] });
    expect(r.freshness.kind).toBe('fresh'); // non-vacuity — it IS verified, and still kept
    expect(names(r)).toContain(TOOL);
    expect(r.omitted).toEqual([]);
  });

  it('KEEPS the tool when ONE entity among many is thin — every, not some', () => {
    const r = run({ entities: [projected, { label: 'Runway', kind: 'factor', value: 1 }] });
    expect(r.freshness.kind).toBe('fresh');
    expect(names(r)).toContain(TOOL);
  });

  it('KEEPS the tool when the state is not an entity carrier at all', () => {
    for (const state of [undefined, null, 42, 'entities', {}, { entities: 'many' }]) {
      const r = run(state);
      expect(r.freshness.kind).toBe('fresh');
      expect(names(r)).toContain(TOOL);
    }
  });

  it('an EMPTY entity list still omits — there are no carriers to lose', () => {
    // Deliberate and worth stating: a packet with no entities is equivalent to
    // what the tool itself would return for a graph with no nodes, so omitting
    // costs the Agent nothing. `every` over an empty list is true, and that is
    // the intended reading rather than an accident of the predicate.
    const r = run({ entities: [] });
    expect(r.freshness.kind).toBe('fresh');
    expect(names(r)).not.toContain(TOOL);
  });

  it('the kept set is always exactly toolsFor(mode) — never a third, narrower list', () => {
    const kept = run({ entities: [{ label: 'thin', kind: 'factor', value: 1 }] });
    expect(names(kept)).toEqual(toolsFor('full').map((t) => t.name));
  });
});
