/**
 * ROADMAP 2.855 — CEE's half of the `value_frame` chain (row 2.798:
 * ISL declares -> CEE stamps -> PLoT forwards -> a result is delivered).
 *
 * WHY THIS TEST EXISTS, AND WHY IT IS NOT A CODE-CONSTANT TEST.
 * `@talchain/schemas` 0.38.0's own block comment on
 * `DraftGoalConstraintSchema.value_frame` prescribes that "CEE stamps it as a
 * CODE CONSTANT at its constraint mint sites ... the frame is a property of
 * the minting arithmetic, exactly as for `goal_threshold_frame`". The second
 * half is exactly right and the first half does NOT follow, because — unlike
 * the goal-threshold channel, whose single mint branch is `raw / cap`, an
 * absolute level by construction — this channel's minting arithmetic is NOT
 * uniform. `extractReductionConstraints` deliberately mints
 * `{ operator: '<=', value: -N }` and its own comment states the semantics in
 * the SAMPLE frame: "the samples must reach `-value` or lower". That is a
 * DELTA. Stamping a blanket 'level' on it would hand ISL a change-from-origin
 * number attested as an absolute level; ISL would convert it against the
 * target's baseline and return a CONFIDENT WRONG probability — strictly worse
 * than today's honest refusal, and the exact fabrication class 2.258/2.266
 * exist to kill.
 *
 * So the stamp is derived PER BRANCH, at the mint site, where the arithmetic
 * is known to the minter. Branches whose arithmetic is not known to CEE (the
 * `add_constraint` handler, whose number the ROUTING MODEL computed; the draft
 * LLM's own `goal_constraints` array; the client ingress array) stamp NOTHING
 * and ISL fails closed — see `constraint-value-frame-unattested.test.ts`.
 *
 * Assertions bind to their constraint by node id / operator IDENTITY, never by
 * a value predicate another constraint could satisfy (trap 19).
 */

import { describe, it, expect } from 'vitest';
import { GoalThresholdFrame } from '@talchain/schemas';

import {
  extractCompoundGoals,
  toGoalConstraints,
  normaliseConstraintUnits,
} from '../extractor.js';
import { GoalConstraintSchema } from '../../../schemas/assist.js';

/** Mint via the real extractor, then run the real downstream carry. */
function mintFromBrief(brief: string) {
  const extraction = extractCompoundGoals(brief);
  return toGoalConstraints(normaliseConstraintUnits(extraction.constraints));
}

/**
 * Bind by IDENTITY (node id + operator), never by value — two constraints on
 * one target differ only by operator, and a value predicate would let the
 * wrong one satisfy the assertion (trap 19).
 */
function pick(rows: ReturnType<typeof mintFromBrief>, nodeId: string, operator: '>=' | '<=') {
  const hits = rows.filter((r) => r.node_id === nodeId && r.operator === operator);
  expect(
    hits,
    `expected exactly one ${operator} constraint on '${nodeId}'; got ${JSON.stringify(rows)}`,
  ).toHaveLength(1);
  return hits[0]!;
}

describe('2.855 — the frame is stamped from the MINTING ARITHMETIC, per branch', () => {
  it('the contract enum is the single vocabulary (no local literal union — trap 12)', () => {
    // Derived from the vendored package, so a contract change fails loud here
    // rather than drifting silently against a hand-copied union.
    expect(GoalThresholdFrame.options.slice().sort()).toEqual(['delta', 'level']);
  });

  it("REDUCTION ('reduce X by N%') mints a DELTA and is stamped 'delta'", () => {
    const rows = mintFromBrief('We need to reduce marketing cost by 15% this year.');
    const row = pick(rows, 'fac_marketing_cost', '<=');

    // The arithmetic that makes this a delta, pinned in the same assertion so
    // the frame claim is bound to the number it describes rather than floating
    // free: the extractor flips the naive "+N" reading to a negative value.
    expect(row.value).toBeLessThan(0);
    expect(row.value_frame).toBe('delta');
  });

  it("UPPER BOUND ('keep X under N') mints an absolute LEVEL and is stamped 'level'", () => {
    const rows = mintFromBrief('Keep churn under 5% for the year.');
    const row = pick(rows, 'fac_churn', '<=');

    expect(row.value).toBeGreaterThan(0);
    expect(row.value_frame).toBe('level');
  });

  it("LOWER BOUND ('X at least N') mints an absolute LEVEL and is stamped 'level'", () => {
    const rows = mintFromBrief('Retention must be at least 90%.');
    const row = pick(rows, 'fac_retention', '>=');

    expect(row.value).toBeGreaterThan(0);
    expect(row.value_frame).toBe('level');
  });

  it('BETWEEN mints two absolute LEVELS and stamps BOTH (the pair is one branch)', () => {
    const rows = mintFromBrief('Keep headcount between 20 and 30.');

    // Both limbs, bound by operator identity — a single-limb stamp would pass
    // a "some row is level" assertion while leaving the other limb dark.
    expect(pick(rows, 'fac_keep_headcount', '>=').value_frame).toBe('level');
    expect(pick(rows, 'fac_keep_headcount', '<=').value_frame).toBe('level');
  });

  it('EVERY minted row carries a frame — no branch is silently unstamped', () => {
    // The completeness half that a per-branch assertion cannot provide (12d):
    // a new extractor branch added without a stamp reddens HERE, where a
    // branch-by-branch corpus would simply not mention it.
    const rows = mintFromBrief(
      'Reduce marketing cost by 15%, keep churn under 5%, retention must be at least 90%, ' +
        'keep headcount between 20 and 30, and deliver within 6 months.',
    );
    expect(rows.length).toBeGreaterThan(0);

    const unstamped = rows.filter((r) => r.value_frame === undefined);
    expect(
      unstamped,
      `every extractor-minted constraint must carry a frame; unstamped: ${JSON.stringify(unstamped)}`,
    ).toEqual([]);
  });

  it('the stamp SURVIVES GoalConstraintSchema.parse (a plain z.object STRIPS unknown keys)', () => {
    // The goal_threshold_frame trap, one channel later: GoalConstraintSchema
    // is a plain `z.object` explicitly commented "strip unknown fields", so an
    // UNDECLARED value_frame is deleted silently one hop before the PLoT
    // payload and the stamp reaches nothing, with no error anywhere. This is
    // the positive control that the declaration is load-bearing, not decorative.
    const rows = mintFromBrief('We need to reduce marketing cost by 15% this year.');
    const row = pick(rows, 'fac_marketing_cost', '<=');
    expect(row.value_frame).toBe('delta');

    const parsed = GoalConstraintSchema.parse(row);
    expect(
      parsed.value_frame,
      'value_frame was stripped by GoalConstraintSchema — the field is undeclared',
    ).toBe('delta');
  });

  it('the schema REJECTS a frame outside the contract enum (not merely stripped)', () => {
    const rows = mintFromBrief('Keep churn under 5% for the year.');
    const row = pick(rows, 'fac_churn', '<=');

    const bad = GoalConstraintSchema.safeParse({ ...row, value_frame: 'normalised' });
    expect(bad.success).toBe(false);
  });
});
