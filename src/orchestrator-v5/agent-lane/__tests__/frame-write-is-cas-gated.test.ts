import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { createProposal, ProposalStore } from '../proposal.js';
import type { CallStructuredModel } from '../runtime/build-model.js';

/**
 * ⛔⛔ A STALE-STATE OVERWRITE ON THE OPENAI PATH.
 *
 * `authoriseChange` reads the graph once, then writes in two stages:
 *
 *   1. ATTACH THE DERIVED FRAME — one `graph/register` carrying
 *      `{ nodes: patched, edges: before.edges }`;
 *   2. APPLY THE LEVELS — CAS-gated edits that re-read the hash between each.
 *
 * Stage 2's own docblock says so: *"THIS EVENT IS CAS-GATED … it carries a
 * REQUIRED `base_graph_hash`. Each applied edit moves the hash, so the current
 * one is re-read between edits."*
 *
 * ⛔ STAGE 1 CARRIED NO `expected_graph_hash` AT ALL, so it could not be
 * refused. And it does not merely lose a node change: it asserts
 * `edges: before.edges` — the WHOLE edge set as it was at read time — so any
 * edge written in between is silently restored to its old value. The user is
 * told nothing; the Agent reports the frame as attached.
 *
 * ⭐ The sibling register at the values step already gets this right, which is
 * what makes the omission a gap rather than a design: it sends
 * `expected_graph_hash: carried` and turns `GRAPH_STALE` into
 * *"The model changed after this was approved, so nothing was written."*
 *
 * ⚠ THE PROPOSAL CHECK IS NOT THE WRITE CHECK. `proposals.authorise` is bound
 * to `before.graph_hash`, so it is tempting to call the write covered. It is
 * not: the authorisation is an in-memory comparison against a hash this process
 * read, while the register call is the only thing that can refuse ATOMICALLY at
 * the row. Between them, another writer can land.
 */
const SCENARIO = '11111111-1111-4111-8111-111111111111';
const USER = 'user-a';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: USER, request_id: 'req-1' };

const FACTOR = 'fac_subs';
const OPTION = 'opt_raise';
const BASE_HASH = 'hash-at-read-time';
/** What a read returns AFTER the frame write — the concurrent writer's state.
 *  Without this the harness answers the same hash to every read and a rebase
 *  is invisible, which is how the first version of these tests let the
 *  unconditional-rebase mutant survive. */
const MOVED_HASH = 'hash-after-someone-else-wrote';

/** A factor carrying a BARE AMOUNT — the only shape that gets a range attached. */
const NODES = [
  { id: OPTION, kind: 'option', label: 'Raise Pro to £59' },
  { id: FACTOR, kind: 'factor', label: 'Active Subscribers', observed_state: { value: 408, raw_value: 408 } },
  { id: 'goal_1', kind: 'goal', label: 'MRR' },
];
const EDGES = [{ from: OPTION, to: FACTOR, strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' }];

function harness(registerStatus = 200, registerJson: Record<string, unknown> = {}) {
  const registerBodies: Record<string, unknown>[] = [];
  const turnBodies: Record<string, unknown>[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path === '/orchestrate/v2/turn') {
      turnBodies.push((body ?? {}) as Record<string, unknown>);
      return { status: 200, json: {} };
    }
    if (path.endsWith('/graph/register')) {
      registerBodies.push((body ?? {}) as Record<string, unknown>);
      return { status: registerStatus, json: registerJson };
    }
    if (path.endsWith('/graph')) {
      // The graph MOVES once the frame write has been attempted, so a re-read is
      // observably different from the hash held at entry.
      const moved = registerBodies.length > 0;
      return {
        status: 200,
        json: { graph: { nodes: NODES, edges: EDGES }, graph_hash: moved ? MOVED_HASH : BASE_HASH },
      };
    }
    return { status: 200, json: {} };
  };
  return { d, registerBodies, turnBodies };
}

const structured: CallStructuredModel = async () => ({ text: '{}' });

/** A proposal whose value op carries a `derived_frame`, which is what reaches stage 1. */
function seedProposal(store: ProposalStore): string {
  const p = createProposal({
    scenario_id: SCENARIO,
    user_id: USER,
    base_graph_identity_hash: BASE_HASH,
    operations: [
      {
        op: 'set_option_intervention',
        path: `${OPTION}::${FACTOR}`,
        // `normalised` is what the level loop reads; without it every edit is
        // skipped and the fail-closed assertions below would be vacuous.
        value: { raw: 360, normalised: 0.72, derived_frame: 500 },
      } as never,
    ],
    provenance: { authored_by: 'model_proposed' },
    validation: { admitted: true, loss_count: 0, refusals: [] },
    public_label: 'Raise Pro to £59 sets Active Subscribers to 360',
  });
  store.put(p);
  return p.proposal_id;
}

describe('the frame write must be refusable', () => {
  it('⛔ carries an expected_graph_hash, so a concurrent write refuses it', async () => {
    const { d, registerBodies } = harness();
    const store = new ProposalStore();
    const id = seedProposal(store);
    const caps = createAgentCapabilities(d, store, structured);

    await caps.authoriseChange(ctx as never, { proposal_id: id, approved: true } as never);

    expect(registerBodies.length, 'no register call was made — this test would be vacuous').toBeGreaterThan(0);
    const frameWrite = registerBodies[0];
    expect(
      frameWrite.expected_graph_hash,
      'the frame write asserts `edges: before.edges` from an earlier read; without an ' +
        'expected hash it cannot be refused and silently restores the old edge set',
    ).toBe(BASE_HASH);
  });

  it('⭐ CONTRAST CONTROL — it really is the frame write, carrying the read’s edges', async () => {
    // Without this, "the first register call has a hash" could be satisfied by
    // some other call and the assertion above would be about the wrong write.
    const { d, registerBodies } = harness();
    const store = new ProposalStore();
    const id = seedProposal(store);
    const caps = createAgentCapabilities(d, store, structured);

    await caps.authoriseChange(ctx as never, { proposal_id: id, approved: true } as never);

    const g = (registerBodies[0]?.graph ?? {}) as { nodes?: unknown[]; edges?: unknown[] };
    expect(Array.isArray(g.nodes)).toBe(true);
    expect(JSON.stringify(g.edges)).toBe(JSON.stringify(EDGES));
  });

  it('⛔ a GRAPH_STALE refusal is reported as the model having changed, not as a generic failure', async () => {
    // The sibling write's wording, for the same reason: "could not attach a
    // range: http 400" tells the user nothing they can act on, and hides that
    // their model moved under them.
    const { d } = harness(400, { details: { code: 'GRAPH_STALE' } });
    const store = new ProposalStore();
    const id = seedProposal(store);
    const caps = createAgentCapabilities(d, store, structured);

    const r = await caps.authoriseChange(ctx as never, { proposal_id: id, approved: true } as never);

    // ⚠ BOUND TO THE SCALE_FRAME FAILURE ITSELF, not to the whole result.
    // An earlier version matched /changed/ over `JSON.stringify(r)` and PASSED
    // BEFORE THE FIX — the values step's own `model_changed_since_approval`
    // satisfied it. A non-discriminating assertion about the right subject is
    // still the wrong test.
    const failures = ((r as { failures?: { path: string; detail: string }[] }).failures) ?? [];
    const frame = failures.find((f) => f.path === 'scale_frame');
    expect(frame, 'no scale_frame failure was recorded — this assertion would be vacuous').toBeDefined();
    expect(frame!.detail).toContain('the model changed');
    expect(frame!.detail).not.toMatch(/^could not attach a range: http/);
  });
});

/**
 * ⭐⭐ THE PROPERTY THE CAS ACTUALLY BUYS — the whole authorisation fails closed
 * on a moved graph, rather than applying half of it.
 *
 * The sequencing is what makes this work, and it is easy to break by accident:
 *
 *   const rebased = framedHere.length > 0 ? await readGraph(…) : null;
 *   let baseHash = rebased?.graph_hash ?? before.graph_hash;
 *
 * `rebased` is read ONLY when the frame write landed. So on a `GRAPH_STALE`
 * refusal `baseHash` stays the hash from entry — the STALE one — and every
 * level edit below carries it into `option_intervention_edit`, which has a
 * REQUIRED `base_graph_hash` and refuses in turn.
 *
 * ⛔ WITHOUT THE CAS THIS WAS THE OPPOSITE. The frame write would SUCCEED
 * (overwriting whatever landed), `rebased` would then read the post-overwrite
 * hash, and the levels would apply cleanly on top — so a stale approval wrote
 * through end to end and reported success.
 *
 * ⚠ Had `rebased` been read unconditionally, a refused frame would be followed
 * by levels applied against the CONCURRENT writer's state: half an approval the
 * user gave against a model that no longer exists. That is the shape this pins.
 */
describe('a moved graph refuses the WHOLE authorisation, not half of it', () => {
  it('⛔ no level edit is attempted once the frame write is refused as stale', async () => {
    const { d, registerBodies, turnBodies } = harness(400, { details: { code: 'GRAPH_STALE' } });
    const store = new ProposalStore();
    const id = seedProposal(store);
    const caps = createAgentCapabilities(d, store, structured);

    await caps.authoriseChange(ctx as never, { proposal_id: id, approved: true } as never);

    expect(registerBodies.length, 'the frame write was never attempted — vacuous').toBeGreaterThan(0);

    // Every level edit that WAS dispatched must still carry the entry hash, so
    // the row-level CAS refuses it too. It must never carry a hash re-read after
    // a failed frame write, which would silently rebase onto the other writer.
    for (const t of turnBodies) {
      const ev = (t.event ?? {}) as { kind?: string; base_graph_hash?: unknown };
      if (ev.kind !== 'option_intervention_edit') continue;
      expect(
        ev.base_graph_hash,
        'a level edit rebased onto a graph read AFTER the frame write was refused — ' +
          'that applies half an approval against state the user never approved',
      ).toBe(BASE_HASH);
    }
  });

  it('⭐ CONTRAST CONTROL — when the frame write LANDS, the levels do rebase', async () => {
    // Without this, "every level carries BASE_HASH" would also be satisfied by a
    // build that never rebases at all, and the assertion above would prove
    // nothing about the refusal path specifically.
    const { d, turnBodies } = harness(200);
    const store = new ProposalStore();
    const id = seedProposal(store);
    const caps = createAgentCapabilities(d, store, structured);

    await caps.authoriseChange(ctx as never, { proposal_id: id, approved: true } as never);

    const levels = turnBodies
      .map((t) => (t.event ?? {}) as { kind?: string; base_graph_hash?: unknown })
      .filter((e) => e.kind === 'option_intervention_edit');
    expect(levels.length, 'no level edit was dispatched on the success path — vacuous').toBeGreaterThan(0);
    // ⭐ A LANDED frame write DOES rebase, and the harness now moves the hash so
    // that is observable. This is the control that makes the refusal-path
    // assertion mean something: the two paths must differ.
    expect(levels[0].base_graph_hash).toBe(MOVED_HASH);
  });
});
