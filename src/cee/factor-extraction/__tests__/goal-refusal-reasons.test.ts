/**
 * ROADMAP 2.371 (a) + (d) — A REFUSAL MUST REACH THE RULE IT IS NAMED FOR.
 *
 * #807 shipped five named refusals and three negative assertions "re-pointed"
 * at them. Its own re-review then MEASURED that the re-pointing had not
 * landed: the briefs returned null, so the assertions passed, but they passed
 * for a reason none of them named. A test that is satisfied by the right
 * ANSWER arriving from the wrong RULE cannot see that rule break — it is the
 * same vacuity as an absence assertion that never proves it can see a presence
 * (CLAUDE.md trap 13), one level up.
 *
 * ⚠ WHAT THAT COSTS, CONCRETELY. Delete the cross-metric refusal entirely and
 * `extractGoalTargetWithBaseline('Increase our headcount from 50 employees to
 * 800000 revenue within 12 months')` still returns null — the anchor rejects
 * the construction before the refusal is ever consulted. The pin stays green
 * while the guarantee it is named for is gone.
 *
 * SO THESE PINS ASSERT THE LOGGED REASON, BY IDENTITY. `goal_pair_refused`
 * carries the rule's own name, and it is the only observable that distinguishes
 * "refused BY THIS RULE" from "never got that far". At `7bdf30ff` the reason
 * strings have NO reader outside `src/cee/factor-extraction/index.ts` (whole-
 * repo grep, `-a` for the NUL-bearing files of CLAUDE.md trap 17), so the log
 * is the entire visible surface of a refusal and pinning it is not incidental
 * coupling — it is the only thing there is to pin.
 *
 * ⚠ MEASURED STATE AT `7bdf30ff`, PER BRIEF, BEFORE THIS FILE EXISTED — and it
 * corrects the re-review's own summary in the lane's favour AND against it:
 *
 *   'Increase our headcount from 50 employees to 800000 revenue within 12
 *    months'                                      → goal_pair_unanchored   ✗
 *   'Grow revenue from 50 employees to a target of 800000 customers'
 *                                                 → metric_noun_mismatch   ✓
 *   'Increase annual retention from 85 today to 95% within 12 months'
 *                                                 → direction_unsupported  ✗
 *
 * i.e. ONE of the three did reach its named rule, not zero; and the third
 * missed its rule for a reason nobody had named — check ORDER, not the anchor.
 * That is residual (d), and it is fixed in the same slice because the pin for
 * (a) cannot be written honestly until it is.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The captured log stream.
 *
 * ⚠ `importOriginal`-SPREAD, NOT A HAND-LISTED MOCK (CLAUDE.md trap 12). A
 * `vi.mock` factory REPLACES the module, so a hand-written object would
 * silently drop every export this module gains later — the exact defect that
 * killed 51 tests at collection once already.
 */
const events: Array<Record<string, unknown>> = [];

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  const capture = (obj: unknown): void => {
    if (obj && typeof obj === 'object') events.push(obj as Record<string, unknown>);
  };
  return {
    ...actual,
    log: {
      ...actual.log,
      info: capture,
      debug: capture,
      warn: capture,
      error: capture,
    },
  };
});

const { extractGoalTargetWithBaseline } = await import('../index.js');

/** Every `goal_pair_refused` event this call emitted, newest last. */
function refusalsFor(brief: string): Array<Record<string, unknown>> {
  events.length = 0;
  const pair = extractGoalTargetWithBaseline(brief);
  expect(pair, `expected NO pair for: ${brief}`).toBeNull();
  return events.filter((e) => e.event === 'cee.factor_extraction.goal_pair_refused');
}

describe('ROADMAP 2.371(a) — each refusal pin reaches the rule it names', () => {
  beforeEach(() => {
    events.length = 0;
  });

  /**
   * ⭐ THE POSITIVE CONTROL FOR THE INSTRUMENT ITSELF, and it runs first
   * deliberately. Every assertion below reads a captured log event; if the
   * capture were broken — a `vi.mock` path typo, a logger the module resolves
   * differently, pino writing straight to fd 1 past the spy — every one of them
   * would fail loudly rather than pass on an empty array, but only because this
   * test proves the sink can SEE a refusal at all.
   */
  it('the log sink can see a refusal (trap 13 — prove a PRESENCE first)', () => {
    const refusals = refusalsFor('Raise the target from £4 million to 6 million dollars');
    expect(refusals.length, 'the telemetry capture is not wired — every pin below is vacuous').toBe(
      1,
    );
  });

  /**
   * ⚠ RE-POINTED, AND THE RE-POINT IS THE WHOLE FIX. #807 gave this brief a
   * HORIZON ("within 12 months") to anchor it, and that did not work: the
   * horizon group sits AFTER the target's trailing-metric position, so the
   * metric noun "revenue" stands between `800000` and `within 12 months` and
   * the horizon never matches. Measured `goal_pair_unanchored`.
   *
   * The honest anchor for a cross-metric brief is therefore a GOAL WORD, which
   * pattern 4 reads from the metric phrase before `from` — "raise the TARGET
   * from…". Both briefs below carry one, and both reach the rule.
   *
   * The mechanism that defeated the horizon here is real and is NOT fixed in
   * this slice: widening the horizon to reach past a trailing noun would ADMIT
   * more pairs, which is the fabrication direction, and this row's mandate is
   * the opposite one. REPORTED as a residual of this slice (see the PR body),
   * and pinned below as a known absence rather than left to be rediscovered.
   */
  it('REFUSES a cross-metric from-to, BY metric_noun_mismatch', () => {
    for (const brief of [
      'Raise the target from 50 employees to 800000 revenue',
      'Grow revenue from 50 employees to a target of 800000 customers',
    ]) {
      const refusals = refusalsFor(brief);
      expect(refusals.map((r) => r.reason), brief).toEqual(['metric_noun_mismatch']);
      expect(refusals[0].baseline_metric, brief).toBe('employee');
    }
  });

  it('the ABSENCE CLOSED (L67) — the horizon anchors past a trailing metric noun, and the refusal fires BY NAME', () => {
    // This pin used to assert `goal_pair_unanchored`: the target's trailing
    // noun ("revenue") was read by a zero-width lookahead, stood in front of
    // the horizon slot, and the horizon never matched — the KNOWN ABSENCE the
    // previous entry recorded, with the instruction that "the day someone
    // widens the horizon this test tells them which pin to move". L67 is that
    // day: the same mechanism was LOSING LIVE TARGETS on single-metric briefs
    // ("…to 250 thousand pounds by the end of December 2026", the journey
    // walk's verbatim goal), so pattern 4 now CONSUMES the trailing word
    // (guarded so a horizon opener is never eaten). This cross-metric brief
    // therefore anchors, reaches the pair-former, and refuses BY THE RULE THAT
    // NAMES ITS DEFECT — which is what #807's comment wanted all along. Still
    // null, still the safe direction; the reason is now diagnostic instead of
    // incidental.
    events.length = 0;
    expect(
      extractGoalTargetWithBaseline(
        'Increase our headcount from 50 employees to 800000 revenue within 12 months',
      ),
    ).toBeNull();
    expect(events.map((e) => e.event)).toEqual(['cee.factor_extraction.goal_pair_refused']);
    expect(events[0].reason).toBe('metric_noun_mismatch');
    expect(events[0].target_metric).toBe('revenue');
    expect(events[0].baseline_metric).toBe('employee');
  });

  it('REFUSES a mixed-currency from-to, BY currency_mismatch', () => {
    const refusals = refusalsFor('Raise the target from £4 million to 6 million dollars');
    expect(refusals.map((r) => r.reason)).toEqual(['currency_mismatch']);
    expect(refusals[0].target_currency).toBe('$');
    expect(refusals[0].baseline_currency).toBe('£');
  });

  it('REFUSES a cross-signal pair, BY currency_vs_metric_noun', () => {
    const refusals = refusalsFor('Raise the target from $50 to 800 widgets');
    expect(refusals.map((r) => r.reason)).toEqual(['currency_vs_metric_noun']);
    expect(refusals[0].baseline_currency).toBe('$');
    expect(refusals[0].target_metric).toBe('widget');
  });

  it('REFUSES a decrease, BY direction_unsupported, on COMPARABLE operands', () => {
    const refusals = refusalsFor(
      'Decrease annual costs from £4 million today to £3 million within 12 months',
    );
    expect(refusals.map((r) => r.reason)).toEqual(['direction_unsupported']);
    expect(refusals[0].target).toBe('3000000');
    expect(refusals[0].baseline).toBe('4000000');
  });
});

describe('ROADMAP 2.371(d) — a logged reason is computed from comparable operands', () => {
  beforeEach(() => {
    events.length = 0;
  });

  /**
   * MEASURED at `7bdf30ff`: this brief logged
   *   `direction_unsupported target="0.95" baseline="85"`
   * — the direction check ran FIRST, so `<` was handed a target already divided
   * into a 0-1 fraction against a baseline that never was. 0.95 was not below
   * 85 in any sense the user expressed; the pair is refused because the two
   * amounts are NOT COMPARABLE, and comparability is a precondition of the
   * comparison, not a competing rule.
   *
   * Nothing a user sees changes — both orders refuse, with the same absent
   * pair — so this is observability, and it is pinned because a reason that
   * names the wrong rule is how the next reader learns the wrong thing about
   * the seam. (It is also what made the (a) pin above unwritable: its brief was
   * MIXED-PERCENT, and it could not reach its own rule until this order
   * changed.)
   */
  it('a mixed-percent pair refuses BY mixed_percent_pair, not by direction', () => {
    for (const brief of [
      'Increase annual retention from 85 today to 95% within 12 months',
      'Raise the target from 85 to 95%',
    ]) {
      const refusals = refusalsFor(brief);
      expect(refusals.map((r) => r.reason), brief).toEqual(['mixed_percent_pair']);
      // The identity of the failure: no direction reason was computed at all,
      // so no incomparable operand pair was ever formed or reported.
      expect(refusals[0].target, brief).toBeUndefined();
      expect(refusals[0].baseline, brief).toBeUndefined();
    }
  });

  it('a mixed-percent pair that is ALSO INCREASING refuses identically', () => {
    // The control that separates the two rules. Here `<` would have said
    // nothing (0.95 > 0.85), so at `7bdf30ff` this brief ALREADY reported
    // `mixed_percent_pair`. It must be unchanged — the reorder moved one
    // branch, it did not merge them.
    const refusals = refusalsFor('Increase annual retention from 0.85 today to 95% within 12 months');
    expect(refusals.map((r) => r.reason)).toEqual(['mixed_percent_pair']);
  });

  it('a same-percent DECREASE still refuses by direction, with percent operands', () => {
    // The other control: with both sides percent the operands ARE comparable,
    // so the direction rule is the right one and still fires — pre-divided on
    // both sides, which is what "comparable" means here.
    const refusals = refusalsFor('Drop annual churn from 5% to 3% within 12 months');
    expect(refusals.map((r) => r.reason)).toEqual(['direction_unsupported']);
    expect(refusals[0].target).toBe('0.03');
    expect(refusals[0].baseline).toBe('0.05');
  });
});
