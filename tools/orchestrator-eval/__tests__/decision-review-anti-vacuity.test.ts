/**
 * decision_review — ANTI-VACUITY FLOOR and PER-DIMENSION POSITIVE CONTROLS.
 *
 * Eleven of the pack's nineteen dimensions are ABSENCE checks. An absence check
 * is satisfied by an empty corpus, so a green absence dimension proves nothing
 * on its own — trap 13: a leak test that captured 0 bytes passed every "no raw
 * value present" assertion by testing nothing at all.
 *
 * Three defences, all asserted here:
 *
 *   1. THE FLOOR — a degenerate output (structurally valid keys, zero prose)
 *      must FAIL the pack. Without this, the SEAM-1 ranking would rank an empty
 *      review as the cleanest candidate in a run.
 *
 *   2. PER-DIMENSION POSITIVE CONTROLS — for every absence dimension, a
 *      candidate that DOES contain the thing must make that dimension fail.
 *      This is what proves the dimension can SEE a presence before its absence
 *      verdict is believed.
 *
 *   3. NON-EMPTY CORPUS — every absence dimension must report `scanned > 0` on
 *      every good candidate. This catches the failure mode a positive control
 *      cannot: a dimension that still fires on its seeded defect but has
 *      silently stopped looking at most of a real output (e.g. a prose walker
 *      that starts skipping a field). `tone_alignment` is pack-level rather
 *      than per-candidate — at the confident tone row the served table forbids
 *      NOTHING, so a zero corpus there is the prompt's design, not a defect.
 */

import { describe, expect, it } from 'vitest';
import {
  ABSENCE_DIMENSIONS,
  PACK_LEVEL_ABSENCE_DIMENSIONS,
  collectProseStrings,
  scoreDecisionReview,
} from '../src/decision-review/scorer.js';
import { loadDecisionReviewFixtures } from '../src/decision-review/run.js';
import type { DecisionReviewEvalFixture } from '../src/decision-review/types.js';

const fixtures = loadDecisionReviewFixtures();

function scoreCandidate(fixture: DecisionReviewEvalFixture, label: string) {
  const candidate = fixture.candidates.find((c) => c.label === label);
  expect(candidate, `${fixture.id} has no candidate "${label}"`).toBeDefined();
  return scoreDecisionReview({
    output: candidate!.output,
    input: fixture.input,
    candidateLabel: label,
  });
}

describe('1. the anti-vacuity FLOOR', () => {
  const degenerate = fixtures.find((f) => f.candidates.some((c) => c.label === 'degenerate_empty'));

  it('the pack carries a degenerate-empty control', () => {
    expect(degenerate, 'no fixture carries a `degenerate_empty` candidate').toBeDefined();
  });

  it('a structurally-valid but PROSE-EMPTY output fails the pack', () => {
    const score = scoreCandidate(degenerate!, 'degenerate_empty');
    expect(score.pass).toBe(false);
  });

  it('specifically: substance_present is what fails, not luck', () => {
    const score = scoreCandidate(degenerate!, 'degenerate_empty');
    const substance = score.dimensions.find((d) => d.name === 'substance_present');
    expect(substance?.pass).toBe(false);
  });

  it('and EVERY absence dimension passes on it — which is exactly why the floor exists', () => {
    // This is the assertion that justifies the floor's existence rather than
    // merely exercising it. If some absence dimension started failing on an
    // empty output, the floor would look redundant; it is not — this proves the
    // absence dimensions really are all vacuously satisfiable.
    const score = scoreCandidate(degenerate!, 'degenerate_empty');
    const vacuouslyGreen = ABSENCE_DIMENSIONS.filter(
      (name) => score.dimensions.find((d) => d.name === name)?.pass === true,
    );
    expect(vacuouslyGreen.length).toBe(ABSENCE_DIMENSIONS.length);
  });
});

describe('2. positive control per absence dimension', () => {
  /**
   * For each absence dimension, the (fixture, candidate) whose output CONTAINS
   * the thing the dimension looks for. Derived from the pack's own
   * `expectedFailedDimensions` rather than restated here, so a fixture rename
   * cannot leave a stale control pointing at nothing.
   */
  const controls = new Map<string, Array<{ fixtureId: string; label: string }>>();
  for (const f of fixtures) {
    for (const [label, dims] of Object.entries(f.expectedFailedDimensions ?? {})) {
      for (const d of dims) {
        if (!ABSENCE_DIMENSIONS.includes(d)) continue;
        controls.set(d, [...(controls.get(d) ?? []), { fixtureId: f.id, label }]);
      }
    }
  }

  it('every absence dimension has at least one positive control in the pack', () => {
    const missing = ABSENCE_DIMENSIONS.filter((d) => !controls.has(d));
    expect(
      missing,
      `absence dimensions with NO positive control — their green verdicts are unproven: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  for (const dimension of ABSENCE_DIMENSIONS) {
    it(`${dimension}: fires on a present instance (positive control)`, () => {
      const control = controls.get(dimension)?.[0];
      expect(control, `no control for ${dimension}`).toBeDefined();
      const fixture = fixtures.find((f) => f.id === control!.fixtureId)!;
      const score = scoreCandidate(fixture, control!.label);
      const dim = score.dimensions.find((d) => d.name === dimension);
      expect(dim?.pass, `${dimension} did not fire on its positive control`).toBe(false);
    });
  }
});

describe('3. non-empty corpus (scanned > 0)', () => {
  const perCandidate = ABSENCE_DIMENSIONS.filter((d) => !PACK_LEVEL_ABSENCE_DIMENSIONS.includes(d));

  for (const fixture of fixtures) {
    it(`${fixture.id}/good: every per-candidate absence dimension actually scanned something`, () => {
      const score = scoreCandidate(fixture, 'good');
      const blind = perCandidate.filter((name) => {
        const d = score.dimensions.find((x) => x.name === name);
        return d === undefined || d.scanned === undefined || d.scanned === 0;
      });
      expect(
        blind,
        `these absence dimensions reported a ZERO corpus on a good candidate — their "clean" verdict is vacuous: ${blind.join(', ')}`,
      ).toEqual([]);
    });
  }

  for (const dimension of PACK_LEVEL_ABSENCE_DIMENSIONS) {
    it(`${dimension}: exercised with a non-empty corpus SOMEWHERE in the pack`, () => {
      const exercised = fixtures.some((f) => {
        const d = scoreCandidate(f, 'good').dimensions.find((x) => x.name === dimension);
        return (d?.scanned ?? 0) > 0;
      });
      expect(
        exercised,
        `${dimension} has a zero corpus on EVERY fixture — it is never actually exercised`,
      ).toBe(true);
    });
  }

  it('the prose walker sees real prose on every good candidate', () => {
    // The corpus every prose-scanning dimension shares. If this collapses, the
    // per-dimension `scanned` counts above collapse with it, so it is asserted
    // once, directly, at the source.
    for (const fixture of fixtures) {
      const good = fixture.candidates.find((c) => c.label === 'good')!;
      const prose = collectProseStrings(good.output).filter((s) => s.trim().length > 0);
      expect(prose.length, `${fixture.id}: prose walker collected nothing`).toBeGreaterThan(5);
    }
  });

  it('the prose walker EXCLUDES id-bearing fields (negative control)', () => {
    // The counterpart to the assertion above: over-collecting would make
    // `no_entity_ids_in_prose` fire on every well-formed review that grounds a
    // bias finding — an alarm that fires always is an alarm nobody reads.
    const withBias = fixtures.find((f) =>
      f.candidates.some(
        (c) => Array.isArray(c.output.bias_findings) && c.output.bias_findings.length > 0,
      ),
    );
    expect(withBias, 'no fixture carries a grounded bias finding to control against').toBeDefined();
    const good = withBias!.candidates.find((c) => c.label === 'good')!;
    const affected = (good.output.bias_findings as Array<Record<string, unknown>>)
      .flatMap((b) => (Array.isArray(b.affected_elements) ? b.affected_elements : []))
      .filter((v): v is string => typeof v === 'string');
    expect(affected.length, 'control fixture has no affected_elements ids').toBeGreaterThan(0);

    const prose = collectProseStrings(good.output);
    for (const id of affected) {
      expect(prose, `grounded id "${id}" leaked into the prose corpus`).not.toContain(id);
    }
    const score = scoreCandidate(withBias!, 'good');
    expect(score.dimensions.find((d) => d.name === 'no_entity_ids_in_prose')?.pass).toBe(true);
  });
});
