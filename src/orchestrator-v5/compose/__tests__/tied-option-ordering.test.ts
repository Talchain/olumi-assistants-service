/**
 * Tied-option ordering — RED-first guards.
 *
 * THE HARM, reproduced at a LIVE WIRE CAPTURE (not a fixture of our own
 * invention): `olumi-programme-docs`
 * `olumi-docs/PHASE0-EVIDENCE-2026-07-28/golden-journey-runs/
 *  20260828T141150Z-fresh-4d29da-raw/step-T3_ANALYSE.json`, vendored verbatim
 * as `fixtures/tied-options/20260828T141150Z-analyse.enrichment.json`.
 *
 *   win_probability   BIT-IDENTICAL 0.12090000000000044 on two options
 *   presented FIRST   a551345f "keep what we have"     mean 0.0117  regret 0.1592
 *   presented SECOND  a7d7b5cf "Phased HubSpot Pilot"  mean 0.0754  regret 0.0955
 *
 * The option presented HIGHER is strictly worse on BOTH measures the same
 * payload carries.
 *
 * ⚠ THE ARRAY UNDER TEST IS `option_comparison`, because that is the one whose
 * order a user sees. Derived at DecisionGuideAI
 * `daf6537aa4f116b8124a0da9a54f8a70420eb6aa`:
 * `mapV5AnalysisToReport.ts:571` builds one display row per entry, and
 * `optionDisplayOrder.ts:104-110` then stable-sorts by win probability — so a
 * tied pair keeps THIS array's order. `decision_brief.options[]` has no display
 * iteration at all and is asserted here only for internal coherence.
 *
 * ⚠ EVERY ASSERTION BINDS BY OPTION ID, never by a value predicate. Two options
 * in this payload share a win_probability byte-for-byte, so any assertion
 * phrased as "the option whose win_probability is 0.1209…" is satisfied by BOTH
 * of them and would pass while the defect stands.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { projectTiedOptionOrderingForTransport } from '../tied-option-ordering.js';

const LIVE_CAPTURE = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures', 'tied-options', '20260828T141150Z-analyse.enrichment.json'),
    'utf8',
  ),
) as Record<string, unknown>;

/** Deep clone so one test's projection can never leak into another's input. */
function capture(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(LIVE_CAPTURE)) as Record<string, unknown>;
}

interface Entry {
  readonly option_id: string;
  readonly win_probability: number;
  readonly rank?: number;
  readonly [key: string]: unknown;
}

function comparisonOf(enrichment: unknown): Entry[] {
  return (enrichment as Record<string, unknown>).option_comparison as Entry[];
}

function briefOptionsOf(enrichment: unknown): Entry[] {
  const brief = (enrichment as Record<string, unknown>).decision_brief as Record<string, unknown>;
  return brief.options as Entry[];
}

/** Position of an option BY ID in the displayed array. -1 when absent. */
function displayIndex(enrichment: unknown, optionId: string): number {
  return comparisonOf(enrichment).findIndex((o) => o.option_id === optionId);
}

/** Rank of an option BY ID in the brief. undefined when absent. */
function briefRank(enrichment: unknown, optionId: string): number | undefined {
  return briefOptionsOf(enrichment).find((o) => o.option_id === optionId)?.rank;
}

// The three options in the live capture, named by IDENTITY.
const LEADER = '5f6f5e36'; // untied, win probability 0.7582
const TIED_WORSE = 'a551345f'; // "keep what we have"     — mean 0.0117, regret 0.1592
const TIED_BETTER = 'a7d7b5cf'; // "Phased HubSpot Pilot"  — mean 0.0754, regret 0.0955

describe('tied-option ordering — the live-capture harm, on the array the user sees', () => {
  it('places the better-outcome tied option ABOVE the worse one in option_comparison', () => {
    const projected = projectTiedOptionOrderingForTransport(capture());

    // Bound by ID. At pristine this reads better=2, worse=1 and REDs.
    expect(displayIndex(projected, TIED_BETTER)).toBeLessThan(displayIndex(projected, TIED_WORSE));
  });

  it('leaves the untied leader exactly where the producer put it', () => {
    const projected = projectTiedOptionOrderingForTransport(capture());

    expect(displayIndex(projected, LEADER)).toBe(0);
  });

  it('changes ONLY position — every member of every entry survives verbatim', () => {
    const before = comparisonOf(capture());
    const after = comparisonOf(projectTiedOptionOrderingForTransport(capture()));

    expect(after).toHaveLength(before.length);
    for (const original of before) {
      const projected = after.find((o) => o.option_id === original.option_id);
      expect(projected).toBeDefined();
      // win_probability is DATA the user is entitled to; it must survive
      // byte-for-byte, tie included. We re-order the presentation; we never
      // edit the producer's numbers.
      expect(projected!.win_probability).toBe(original.win_probability);
      expect(projected).toEqual(original);
    }
  });
});

describe('tied-option ordering — decision_brief stays coherent with what is shown', () => {
  it('gives the better-outcome tied option the better (smaller) rank', () => {
    const projected = projectTiedOptionOrderingForTransport(capture());

    expect(briefRank(projected, TIED_BETTER)).toBe(2);
    expect(briefRank(projected, TIED_WORSE)).toBe(3);
  });

  it('leaves the untied leader’s rank alone', () => {
    expect(briefRank(projectTiedOptionOrderingForTransport(capture()), LEADER)).toBe(1);
  });

  it('orders the brief array the same way as the displayed array', () => {
    const projected = projectTiedOptionOrderingForTransport(capture());

    expect(briefOptionsOf(projected).map((o) => o.option_id)).toEqual(
      comparisonOf(projected).map((o) => o.option_id),
    );
  });
});

describe('tied-option ordering — THE OPPOSITE-DIRECTION TWIN: untied sets never move', () => {
  /**
   * The overwhelming majority of recorded option maps are UNTIED. A fix for
   * ties that reorders anything else trades a wrong order for a wider one.
   *
   * The safety property is structural, not statistical: grouping is on
   * BIT-IDENTICAL win_probability, so an untied set has every group of size 1
   * and there is nothing to permute. These tests pin that.
   */
  function untiedCapture(): Record<string, unknown> {
    const c = capture();
    // Break the tie in the WRONG direction: give the worse-outcome option a
    // strictly HIGHER win probability, in BOTH arrays. A correct projection
    // must now leave the order alone — win probability is the producer's
    // measure and here it separates.
    for (const arr of [comparisonOf(c), briefOptionsOf(c)]) {
      (arr.find((o) => o.option_id === TIED_WORSE) as { win_probability: number })
        .win_probability = 0.2;
    }
    return c;
  }

  it('leaves an untied array in the producer’s order, even when outcome.mean disagrees', () => {
    const projected = projectTiedOptionOrderingForTransport(untiedCapture());

    expect(displayIndex(projected, TIED_WORSE)).toBeLessThan(displayIndex(projected, TIED_BETTER));
    expect(briefRank(projected, TIED_WORSE)).toBe(2);
    expect(briefRank(projected, TIED_BETTER)).toBe(3);
  });

  it('returns an untied enrichment structurally unchanged', () => {
    const input = untiedCapture();
    const snapshot = JSON.stringify(input);

    expect(JSON.stringify(projectTiedOptionOrderingForTransport(input))).toBe(snapshot);
  });

  it('returns the SAME OBJECT when nothing is tied — no needless clone', () => {
    const input = untiedCapture();
    expect(projectTiedOptionOrderingForTransport(input)).toBe(input);
  });
});

describe('tied-option ordering — fails closed when it cannot defend a reorder', () => {
  it('does not reorder a tied pair whose separating evidence is absent', () => {
    const c = capture();
    // Strip the evidence: every entry keeps its identity and win probability
    // but loses outcome and downside, so nothing can defend a move.
    for (const entry of comparisonOf(c)) {
      delete (entry as unknown as Record<string, unknown>).outcome;
      delete (entry as unknown as Record<string, unknown>).downside;
    }

    const projected = projectTiedOptionOrderingForTransport(c);
    expect(displayIndex(projected, TIED_WORSE)).toBeLessThan(displayIndex(projected, TIED_BETTER));
    expect(briefRank(projected, TIED_WORSE)).toBe(2);
  });

  it('does not reorder a tied entry that claims no option identity', () => {
    const c = capture();
    const entry = comparisonOf(c).find((o) => o.option_id === TIED_BETTER)!;
    delete (entry as unknown as Record<string, unknown>).option_id;
    delete (entry as unknown as Record<string, unknown>).id;

    const projected = projectTiedOptionOrderingForTransport(c);
    // The worse option must still sit where the producer put it: with an
    // unidentifiable sibling there is no defensible move.
    expect(displayIndex(projected, TIED_WORSE)).toBe(1);
  });

  it('does not reorder brief options when a tied element carries no usable rank', () => {
    const c = capture();
    delete (briefOptionsOf(c).find((o) => o.option_id === TIED_BETTER) as unknown as Record<
      string,
      unknown
    >).rank;

    const projected = projectTiedOptionOrderingForTransport(c);
    expect(briefOptionsOf(projected).findIndex((o) => o.option_id === TIED_WORSE)).toBeLessThan(
      briefOptionsOf(projected).findIndex((o) => o.option_id === TIED_BETTER),
    );
    // …while the DISPLAYED array is still corrected: a missing ordinal in the
    // brief must not hold back the fix on the surface a user actually reads.
    expect(displayIndex(projected, TIED_BETTER)).toBeLessThan(displayIndex(projected, TIED_WORSE));
  });

  it('is total: a malformed enrichment is returned rather than thrown on', () => {
    expect(() => projectTiedOptionOrderingForTransport(undefined)).not.toThrow();
    expect(() => projectTiedOptionOrderingForTransport({ decision_brief: null })).not.toThrow();
    expect(() =>
      projectTiedOptionOrderingForTransport({ option_comparison: 'not an array' }),
    ).not.toThrow();
    expect(() =>
      projectTiedOptionOrderingForTransport({ decision_brief: { options: 'not an array' } }),
    ).not.toThrow();
  });
});
