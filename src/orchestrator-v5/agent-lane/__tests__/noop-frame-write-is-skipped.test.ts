/**
 * ⛔⛔ A BYTE-IDENTICAL WHOLE-GRAPH WRITE IS NOT HARMLESS — and this file exists
 * because I APPROVED AND MERGED THE GUARD WITHOUT PROVING IT.
 *
 * ── THE HONEST HISTORY ──────────────────────────────────────────────────────
 * PR #1820 added `if (stillNeeds.size === 0)` so that when a competing writer has
 * already framed every factor, no register is issued. I wrote a control for it
 * TWICE and the mutant SURVIVED BOTH TIMES:
 *
 *   attempt 1 — framed every factor UP FRONT. `needsFrame` was then empty, so the
 *     OUTER `frameById.size > 0` gate skipped the write on its own and the test
 *     passed for a reason that had nothing to do with the guard.
 *   attempt 2 — gated the fixture on a raw read counter. It fired before the value
 *     writes and the run never reached the frame block at all.
 *
 * I removed the control rather than ship one that passes for the wrong reason, and
 * then merged the PR anyway with the gap disclosed. That left an UNPROVEN claim in
 * served code, which is exactly the shape this lane exists to remove. This file
 * closes it.
 *
 * ── WHY THE TIMING IS THE WHOLE TEST ───────────────────────────────────────
 * `agent-capabilities.ts` reads the graph TWICE around the frame write:
 *
 *   value writes  →  read A (`afterSet`)   →  needsFrame / frameById
 *                 →  read B (`nowRead`)    →  stillNeeds  →  register?
 *
 * The guard is reachable ONLY when read A shows the factors UNFRAMED (so
 * `frameById.size > 0` and we enter the block) and read B shows them FRAMED (so
 * `stillNeeds` is empty). Any fixture that frames earlier trips the outer gate
 * instead; any fixture that frames later never reaches the guard. So this double
 * counts reads AFTER the value writes and flips the graph between the first and
 * the second — the only window in which the guard decides anything.
 */
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { committedValueWrite } from './fixtures/served-value-write.js';
import { nextRequest } from './fixtures/next-request.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440000';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'user-a', request_id: 'r' };

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown> };
const BASE: Node[] = [
  { id: 'monthly_churn_rate', kind: 'factor', label: 'Monthly churn rate' },
  { id: 'pro_subscribers', kind: 'factor', label: 'Pro subscribers' },
];
const ASK = {
  assumptions: [
    { factor_label: 'Monthly churn rate', value: 3.5, unit: '%', basis: 'typical B2B SaaS baseline' },
    { factor_label: 'Pro subscribers', value: 400, unit: 'subscribers', basis: 'implied by a target' },
  ],
};

/**
 * `competitorFramesBetweenTheReads` is the ONLY option that reaches the guard.
 * It counts reads that occur AFTER the value writes: the first is `afterSet`
 * (returned UNFRAMED, so the block is entered) and every read after it is
 * returned FRAMED (so `stillNeeds` is empty and the guard decides).
 */
function product(opts: { competitorFramesBetweenTheReads?: boolean } = {}) {
  const registered: unknown[] = [];
  let nodes: Node[] = BASE.map((n) => ({ ...n }));
  let rev = 0;
  let valueWritesDone = false;
  let readsAfterWrites = 0;
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      registered.push(b);
      const g = (b as { graph?: { nodes?: Node[] } }).graph;
      if (g?.nodes !== undefined) nodes = g.nodes;
      rev += 1;
      return { status: 200, json: {} };
    }
    if (path === '/orchestrate/v2/turn' && b.kind === 'system_event') {
      const ev = b.event as { target_id: string; value: number };
      nodes = nodes.map((n) => (n.id === ev.target_id
        ? { ...n, observed_state: { ...n.observed_state, value: ev.value, raw_value: ev.value } }
        : n));
      rev += 1;
      valueWritesDone = true;
      return { status: 200, json: committedValueWrite(ev.target_id) };
    }
    // a READ
    if (valueWritesDone) readsAfterWrites += 1;
    if (opts.competitorFramesBetweenTheReads === true && valueWritesDone && readsAfterWrites >= 2) {
      // Read B onwards: a competing writer has supplied every range.
      const framed = nodes.map((n) => ({
        ...n,
        observed_state: { ...(n.observed_state ?? {}), cap: 1000 },
      }));
      rev += 1;
      return { status: 200, json: { graph: { nodes: framed, edges: [] }, graph_hash: `h${rev}` } };
    }
    return { status: 200, json: { graph: { nodes, edges: [] }, graph_hash: `h${rev}` } };
  };
  return { d, registered, reads: () => readsAfterWrites };
}

async function authorise(opts: { competitorFramesBetweenTheReads?: boolean } = {}) {
  const p = product(opts);
  const caps = createAgentCapabilities(p.d, new ProposalStore());
  const prop = await caps.proposeAssumptions(ctx as never, ASK as never);
  const r = await caps.authoriseChange(nextRequest(ctx) as never, { proposal_id: String(prop.proposal_id) } as never);
  return { p, r: r as Record<string, unknown> };
}

describe('the frame write is SKIPPED when the re-read leaves nothing to frame', () => {
  it('⛔⛔ THE GUARD: a competitor framing between the two reads yields ZERO register calls', async () => {
    const { p, r } = await authorise({ competitorFramesBetweenTheReads: true });
    // ⭐ PREMISE, asserted rather than assumed — without this the assertion below
    // could pass because the run never reached the frame block at all (which is
    // exactly how my two earlier attempts fooled themselves).
    expect(p.reads(), 'the run must take BOTH post-write reads to reach the guard')
      .toBeGreaterThanOrEqual(2);
    // Bound to the CALL, not to the wording of the reply.
    expect(p.registered, 'a byte-identical whole-graph register was issued for a no-op')
      .toHaveLength(0);
    // ⭐ And nothing is claimed: no range was attached, so none is reported.
    expect((r as { ranges_added_for_analysis?: unknown[] }).ranges_added_for_analysis ?? [])
      .toHaveLength(0);
  });

  it('⭐ POSITIVE CONTROL: with no competitor the register IS called', async () => {
    // Without this the assertion above could be satisfied by never writing at all.
    const { p } = await authorise();
    expect(p.registered.length).toBeGreaterThan(0);
  });
});
