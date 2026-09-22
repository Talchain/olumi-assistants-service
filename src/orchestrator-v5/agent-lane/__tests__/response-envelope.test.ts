/**
 * The turn envelope must satisfy `OlumiResponseSchema`, validated against the
 * REAL schema — not against my belief about it.
 *
 * ⛔ WHAT THIS COSTS WHEN IT IS WRONG. I added `draft_graph` as `{nodes, edges}`.
 * The schema requires FOUR fields; the envelope failed validation; the UI
 * discarded the WHOLE response — and the user was told "the server did not
 * reply in time" after waiting 93 seconds for an answer that had arrived,
 * complete, with HTTP 200. A shape error here does not degrade a turn, it
 * deletes it, and it reports as a timeout.
 */

import { describe, it, expect } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

const base = {
  response_version: 2,
  assistant_text: 'x',
  blocks: [],
  suggested_actions: [],
  insights: [],
  stage_indicator: 'frame',
};

/** Exactly the shape the route builds. */
const draftGraphFrom = (nodes: unknown[], edges: unknown[]) => ({
  node_count: nodes.length,
  edge_count: edges.length,
  nodes,
  edges,
});

describe('the agent turn envelope', () => {
  it('validates with the draft_graph the route actually sends', () => {
    const r = OlumiResponseSchema.safeParse({
      ...base,
      graph_hash: 'abc123',
      draft_graph: draftGraphFrom([{ id: 'a', kind: 'goal', label: 'G', provenance: 'from_brief' }], []),
    });
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 4))).toBe(true);
  });

  it('REJECTS the shape I originally shipped — the contrast control', () => {
    // Without this, the test above would pass for any object at all and would
    // not be pinning the four-field requirement that actually bit.
    const r = OlumiResponseSchema.safeParse({
      ...base,
      draft_graph: { nodes: [{ id: 'a', kind: 'goal', label: 'G', provenance: 'from_brief' }], edges: [] },
    });
    expect(r.success, 'a two-field draft_graph must NOT validate').toBe(false);
  });

  it('validates with no draft_graph at all — a read-only turn must still parse', () => {
    expect(OlumiResponseSchema.safeParse({ ...base, graph_hash: 'abc123' }).success).toBe(true);
  });
});

describe('the response says WHICH PATH served the turn', () => {
  /**
   * ⛔ MEASURED on the deployed build at `1da622c0`. The estate's `Live user
   * journey against deployed staging` gate failed with "turn 1:
   * `_diagnostic_trace.exit_path` missing — cannot tell which path served this
   * turn". Under `PROXY_V5_TARGET=agent` every browser turn is served by the
   * agent route and the orchestrator's trace never runs, so nothing
   * downstream could name the producer — and an observer that cannot identify
   * the producer cannot attribute a defect to it.
   */
  it('travels as an UNDERSCORE sidecar, because egress is .strict()', () => {
    const trace = { exit_path: 'agent_lane_v1', agent_mode: 'full', hops: 2, stopped_reason: 'answered', tools_called: ['get_canonical_state'] };

    // ⛔ THE CONTRAST CONTROL, and the reason the prefix is load-bearing: the
    // SAME object under a non-underscore key is refused by the egress schema.
    expect(OlumiResponseSchema.safeParse({ ...base, diagnostic_trace: trace }).success).toBe(false);
    // The bare envelope is fine, so the refusal above is about the key.
    expect(OlumiResponseSchema.safeParse(base).success).toBe(true);
  });
});

