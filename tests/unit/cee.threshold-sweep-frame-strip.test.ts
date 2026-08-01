/**
 * ROADMAP 2.258 — the threshold sweep must strip `goal_threshold_frame` WITH
 * the quad it describes.
 *
 * ⚠ FOUND BY ADVERSARIAL REVIEW OF #786, not by the original lane. Stage 4b
 * strips a goal threshold it judges unfounded (no raw target extracted, or a
 * suspiciously round number against a digit-free label). It does that through
 * `THRESHOLD_FIELDS` — an ATOMIC group, deleted in one loop at BOTH strip sites
 * — and the 0.31.0 stamp added a fifth member of that group without joining it.
 *
 * THE DEFECT: a sweep-fired node keeps a `goal_threshold_frame` rider with no
 * `goal_threshold` left to describe. That directly violates the invariant the
 * frame work asserts everywhere else — "the frame never travels without the
 * number it describes" — and it is the exact shape of the estate's dominant
 * defect (CLAUDE.md trap 12): a hand-maintained group that a later field is
 * added beside instead of INTO.
 *
 * Blast radius today is small — `transformNodeToV3` refuses to carry a frame
 * without a threshold, so the rider dies at the V1→V3 hop rather than reaching
 * PLoT — but "a second layer happens to catch it" is not the invariant, and the
 * sweep operates on graphs that are persisted and re-read. Fix it where the
 * group is.
 *
 * Both strip paths are covered, because there are two call sites and a fix
 * applied to only one would leave the other silently broken.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

import { runStageThresholdSweep } from '../../src/cee/unified-pipeline/stages/threshold-sweep.js';

function makeCtx(goalOverrides: Record<string, unknown> = {}) {
  return {
    requestId: 'sweep-frame-test',
    graph: {
      version: '1.0',
      default_seed: 42,
      nodes: [
        { id: 'dec_1', kind: 'decision', label: 'Which strategy?' },
        { id: 'goal_1', kind: 'goal', label: 'Improve UX Quality', ...goalOverrides },
      ],
      edges: [],
    },
    deterministicRepairs: [] as Array<{ code: string; path: string; action: string }>,
    repairTrace: {
      deterministic_sweep: {
        sweep_ran: true,
        goal_threshold_stripped: 0,
        goal_threshold_possibly_inferred: 0,
      },
    },
  } as any;
}

const goalNodeOf = (ctx: any) =>
  ctx.graph.nodes.find((n: any) => n.kind === 'goal') as Record<string, unknown>;

describe('threshold sweep strips the FRAME with the quad (ROADMAP 2.258)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('STRIPPED_NO_RAW path — the frame goes with the threshold', async () => {
    const ctx = makeCtx({
      goal_threshold: 0.8,
      // no goal_threshold_raw → the sweep judges the threshold unfounded
      goal_threshold_frame: 'level',
    });
    await runStageThresholdSweep(ctx);
    const goal = goalNodeOf(ctx);

    // Control: the sweep actually fired on this fixture.
    expect(ctx.deterministicRepairs.map((r: any) => r.code)).toContain(
      'GOAL_THRESHOLD_STRIPPED_NO_RAW',
    );
    expect(goal).not.toHaveProperty('goal_threshold');
    // The claim: no orphaned frame rider.
    expect(
      goal,
      'a stripped goal keeps a goal_threshold_frame describing a number that is ' +
        'no longer there — the frame must never travel without its threshold',
    ).not.toHaveProperty('goal_threshold_frame');
  });

  it('STRIPPED_NO_DIGITS path — the frame goes with the threshold', async () => {
    const ctx = makeCtx({
      goal_threshold: 0.8,
      goal_threshold_raw: 100, // round, and the label has no digits
      goal_threshold_unit: 'count',
      goal_threshold_cap: 125,
      goal_threshold_frame: 'level',
    });
    await runStageThresholdSweep(ctx);
    const goal = goalNodeOf(ctx);

    expect(ctx.deterministicRepairs.map((r: any) => r.code)).toContain(
      'GOAL_THRESHOLD_STRIPPED_NO_DIGITS',
    );
    expect(goal).not.toHaveProperty('goal_threshold');
    expect(goal).not.toHaveProperty('goal_threshold_frame');
  });

  it('NEGATIVE CONTROL — a well-founded threshold KEEPS its frame', async () => {
    // Without this, adding the frame to the strip group would pass just as
    // happily if the sweep deleted it unconditionally, which would silently
    // un-stamp every healthy graph that passes through Stage 4b.
    // The sweep's keep condition is `!(rawIsRound && labelHasNoDigits)`, and
    // `rawIsRound` is true for ANY integer — so the label is what must carry a
    // digit here. (Getting this wrong is how the first draft of this control
    // "passed" by being stripped like the others.)
    const ctx = makeCtx({
      label: 'Reach 823 paying customers',
      goal_threshold: 0.8,
      goal_threshold_raw: 823,
      goal_threshold_unit: 'customers',
      goal_threshold_cap: 1029,
      goal_threshold_frame: 'level',
    });
    await runStageThresholdSweep(ctx);
    const goal = goalNodeOf(ctx);

    expect(goal.goal_threshold).toBe(0.8);
    expect(goal.goal_threshold_frame).toBe('level');
    expect(ctx.deterministicRepairs).toEqual([]);
  });
});
