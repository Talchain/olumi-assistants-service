/**
 * ROADMAP 2.258 — the frame SURVIVES to the wire.
 *
 * ⚠ THIS IS THE PIN THAT STOPS THE STAMP BEING THEATRE, and it exists because
 * the chain between the mint site and PLoT contains THREE places that delete
 * an unnamed field, none of which raises an error:
 *
 *   1. `transformNodeToV3` (cee/transforms/schema-v3.ts) rebuilds the node
 *      field-by-field, so a V1 field it does not name is gone.
 *   2. `NodeV3` (schemas/cee-v3.ts) is a PLAIN `z.object` — its own closing
 *      comment reads "declared fields only — unknown fields stripped". This is
 *      the one that matters most: the run path calls `GraphV3.safeParse` on
 *      the reloaded persisted graph (build-turn-context.ts), so an undeclared
 *      frame is deleted one hop before the PLoT payload is built.
 *   3. PLoT reads the frame off the RAW graph node it receives and hoists it
 *      to a request-level scalar; if CEE's node never carried it, PLoT logs
 *      `goal_threshold_frame_unstamped` and ISL refuses with
 *      `GOAL_THRESHOLD_FRAME_UNSPECIFIED`.
 *
 * A stamp that is silently stripped looks EXACTLY like a stamp that works —
 * same green tests at the mint site, same absent goal probability on staging.
 * Each assertion below therefore carries a POSITIVE CONTROL proving the strip
 * mechanism it is defending against is REAL and ACTIVE at this tip (CLAUDE.md
 * trap 13: an absence/survival claim must first prove it can see the opposite).
 */
import { describe, expect, it } from 'vitest';

import { NodeV3, GraphV3 } from '../cee-v3.js';
import { transformNodeToV3 } from '../../cee/transforms/schema-v3.js';
import type { V1Node } from '../../cee/transforms/schema-v2.js';
import { CEE_GOAL_THRESHOLD_FRAME } from '../../utils/goal-threshold-cap.js';

const goalNodeV3 = () => ({
  id: 'g1',
  kind: 'goal' as const,
  label: 'Revenue Goal',
  goal_threshold: 0.8,
  goal_threshold_raw: 800,
  goal_threshold_unit: 'customers',
  goal_threshold_cap: 1000,
  goal_threshold_frame: CEE_GOAL_THRESHOLD_FRAME,
});

describe('ROADMAP 2.258 — the frame survives NodeV3 (the unknown-field strip)', () => {
  it('POSITIVE CONTROL — NodeV3 really does strip an undeclared field', () => {
    // If this ever passes-by-being-passthrough, every survival claim below is
    // vacuous: the field would survive whether or not it was declared.
    const parsed = NodeV3.parse({
      ...goalNodeV3(),
      a_field_no_schema_declares: 'must not survive',
    });
    expect(parsed).not.toHaveProperty('a_field_no_schema_declares');
  });

  it('goal_threshold_frame SURVIVES NodeV3.parse (it is declared)', () => {
    const parsed = NodeV3.parse(goalNodeV3());
    expect(parsed.goal_threshold_frame).toBe('level');
  });

  it('the frame survives GraphV3.safeParse — the run path`s own reload gate', () => {
    // build-turn-context.ts calls GraphV3.safeParse on the reloaded persisted
    // graph, and run-analysis.ts sends THAT object to PLoT. This is the exact
    // seam, exercised through the real schema rather than a stand-in.
    const result = GraphV3.safeParse({
      nodes: [goalNodeV3()],
      edges: [],
    });
    expect(result.success).toBe(true);
    const goal = result.success
      ? result.data.nodes.find((n) => n.kind === 'goal')
      : undefined;
    expect(goal?.goal_threshold_frame).toBe('level');
    // The frame must never arrive without the number it describes.
    expect(goal?.goal_threshold).toBe(0.8);
  });

  it('an INVALID frame is refused rather than silently carried', () => {
    const result = GraphV3.safeParse({
      nodes: [{ ...goalNodeV3(), goal_threshold_frame: 'levl' }],
      edges: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('ROADMAP 2.258 — the frame survives the V1→V3 transform', () => {
  const v1GoalNode = (extra: Record<string, unknown> = {}): V1Node =>
    ({
      id: 'g1',
      kind: 'goal',
      label: 'Revenue Goal',
      goal_threshold: 0.8,
      goal_threshold_raw: 800,
      goal_threshold_unit: 'customers',
      goal_threshold_cap: 1000,
      ...extra,
    }) as unknown as V1Node;

  it('POSITIVE CONTROL — the transform really does drop an unnamed V1 field', () => {
    const out = transformNodeToV3(
      v1GoalNode({ a_field_the_transform_never_names: 'must not survive' }),
    ) as Record<string, unknown>;
    expect(out).not.toHaveProperty('a_field_the_transform_never_names');
  });

  it('a frame minted on the V1 draft graph reaches the V3 node', () => {
    const out = transformNodeToV3(
      v1GoalNode({ goal_threshold_frame: CEE_GOAL_THRESHOLD_FRAME }),
    ) as Record<string, unknown>;
    expect(out.goal_threshold_frame).toBe('level');
  });

  it('the frame is NOT carried when there is no threshold to describe', () => {
    // Fail-closed: an attestation about a number that is not there would be a
    // claim about nothing, and ISL reads absence-of-frame as "do not compute".
    const out = transformNodeToV3({
      id: 'g1',
      kind: 'goal',
      label: 'Qualitative goal',
      goal_threshold_frame: CEE_GOAL_THRESHOLD_FRAME,
    } as unknown as V1Node) as Record<string, unknown>;
    expect(out).not.toHaveProperty('goal_threshold_frame');
  });
});
