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

  it('and NO absence dimension FAILS on it — which is exactly why the floor exists', () => {
    // This is the assertion that justifies the floor's existence rather than
    // merely exercising it. No absence dimension catches an empty output; the
    // floor is the only thing that does.
    const score = scoreCandidate(degenerate!, 'degenerate_empty');
    const caught = ABSENCE_DIMENSIONS.filter(
      (name) => score.dimensions.find((d) => d.name === name)?.status === 'fail',
    );
    expect(caught).toEqual([]);
  });

  it('nor does any of them claim a PASS on it — they report not-applicable', () => {
    // The amendment. Previously five prose-scanning dimensions reported clean
    // over zero prose and were counted as measured passes, so a degenerate
    // output scored 14/19 rather than being visibly unmeasurable.
    const score = scoreCandidate(degenerate!, 'degenerate_empty');
    const vacuousPasses = ABSENCE_DIMENSIONS.filter(
      (name) => score.dimensions.find((d) => d.name === name)?.status === 'pass',
    );
    expect(
      vacuousPasses,
      `these absence dimensions PASSED over an empty output: ${vacuousPasses.join(', ')}`,
    ).toEqual([]);
  });

  it('so the degenerate output is reported as mostly UNMEASURABLE, not mostly clean', () => {
    const score = scoreCandidate(degenerate!, 'degenerate_empty');
    expect(score.notApplicable).toBeGreaterThan(score.measured);
    expect(score.pass).toBe(false);
  });
});

describe('1b. the THREE-state contract (the amendment that matters most)', () => {
  it('not_applicable is EXCLUDED from the measured denominator', () => {
    for (const fixture of fixtures) {
      const score = scoreCandidate(fixture, 'good');
      expect(score.measured + score.notApplicable).toBe(score.dimensions.length);
      expect(score.measured).toBe(
        score.dimensions.filter((d) => d.status !== 'not_applicable').length,
      );
    }
  });

  it('not_applicable never counts toward `passed`', () => {
    for (const fixture of fixtures) {
      const score = scoreCandidate(fixture, 'good');
      expect(score.passed).toBe(score.dimensions.filter((d) => d.status === 'pass').length);
      expect(score.passed).toBeLessThanOrEqual(score.measured);
    }
  });

  it('not_applicable is not a failure either — it must not sink a candidate', () => {
    // A good candidate on a sparse fixture (07 has four NA dimensions) must
    // still pass. NA is a third state, not a soft fail.
    const sparse = fixtures.find((f) => scoreCandidate(f, 'good').notApplicable >= 3);
    expect(sparse, 'no fixture exercises multiple NA dimensions').toBeDefined();
    expect(scoreCandidate(sparse!, 'good').pass).toBe(true);
  });

  it('an NA detail is UNMISTAKABLE in output — never skim-readable as a pass', () => {
    // The regression this pins: an NA row that printed like a clean row is how
    // the first baseline's "18/19" got written down as if it meant something.
    for (const fixture of fixtures) {
      for (const d of scoreCandidate(fixture, 'good').dimensions) {
        if (d.status === 'not_applicable') {
          expect(d.detail.startsWith('NOT APPLICABLE — ')).toBe(true);
          expect(d.scanned, 'an NA dimension must not report a scanned count').toBeUndefined();
        }
      }
    }
  });

  it('RED-first: tone_alignment on a coaching-less input is NA, NOT a pass', () => {
    // The exact live-capture condition. Before the amendment this returned
    // pass:true / scanned:0 and was counted in the denominator.
    const fixture = fixtures[0];
    const good = fixture.candidates.find((c) => c.label === 'good')!;
    const score = scoreDecisionReview({
      output: good.output,
      input: { ...fixture.input, deterministic_coaching: {} },
      candidateLabel: 'coaching-less',
    });
    const tone = score.dimensions.find((d) => d.name === 'tone_alignment');
    expect(tone?.status).toBe('not_applicable');
    expect(tone?.pass, 'NA must not read as a failure').toBe(true);
    expect(score.measured).toBeLessThan(score.dimensions.length);
  });

  it('RED-first: a tone row that forbids NOTHING is NA, not a free pass', () => {
    // fixture 01 is `ready | clear_winner`, whose Forbidden-phrasing cell is
    // literally `none`. The contract constrains nothing, so the dimension
    // cannot fail — and must not claim a pass.
    const confident = fixtures.find((f) => f.id === '01-clear-winner')!;
    const tone = scoreCandidate(confident, 'good').dimensions.find((d) => d.name === 'tone_alignment');
    expect(tone?.status).toBe('not_applicable');
    expect(tone?.detail).toContain('forbids no phrasing');
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

describe('3. non-empty corpus (scanned > 0) — no carve-outs', () => {
  // The previous release needed a PACK_LEVEL_ABSENCE_DIMENSIONS escape hatch so
  // tone_alignment could report scanned:0 without failing. That hatch WAS the
  // bug: a zero-corpus row is not a tolerable pass, it is an unmeasured
  // dimension in the denominator. With the NA state the rule needs no
  // exceptions, which is the strongest form of it.
  for (const fixture of fixtures) {
    it(`${fixture.id}: NO measured-PASS dimension anywhere reports a zero corpus`, () => {
      for (const candidate of fixture.candidates) {
        const score = scoreCandidate(fixture, candidate.label);
        const blind = score.dimensions.filter(
          (d) => d.status === 'pass' && d.scanned !== undefined && d.scanned === 0,
        );
        expect(
          blind.map((d) => d.name),
          `${fixture.id}/${candidate.label}: measured-clean with an EMPTY corpus — "passed" and "did not look" render alike`,
        ).toEqual([]);
      }
    });
  }

  for (const fixture of fixtures) {
    it(`${fixture.id}/good: every MEASURED absence dimension scanned something`, () => {
      const score = scoreCandidate(fixture, 'good');
      const blind = ABSENCE_DIMENSIONS.filter((name) => {
        const d = score.dimensions.find((x) => x.name === name);
        if (d === undefined || d.status === 'not_applicable') return false;
        return d.scanned === undefined || d.scanned === 0;
      });
      expect(
        blind,
        `these MEASURED absence dimensions reported a ZERO corpus: ${blind.join(', ')}`,
      ).toEqual([]);
    });
  }

  it('every absence dimension is MEASURED (not NA) somewhere in the pack', () => {
    const measuredSomewhere = new Set<string>();
    for (const f of fixtures)
      for (const d of scoreCandidate(f, 'good').dimensions)
        if (d.status !== 'not_applicable') measuredSomewhere.add(d.name);
    const neverMeasured = ABSENCE_DIMENSIONS.filter((d) => !measuredSomewhere.has(d));
    expect(
      neverMeasured,
      `NA everywhere = never exercised by the pack: ${neverMeasured.join(', ')}`,
    ).toEqual([]);
  });

  it('scanned is ALWAYS content, never a rule-set size', () => {
    // The ambiguity this pins out: `no_banned_lexicon` used to report
    // `scanned: 10` (ten parsed terms) on an output with no prose at all.
    // Ten rules applied to zero strings is zero checks, and it read as
    // thoroughly measured. Rule counts now live in `detail`.
    for (const f of fixtures) {
      for (const d of scoreCandidate(f, 'good').dimensions) {
        if (d.scanned === undefined) continue;
        expect(d.scannedUnit, `${d.name} reports scanned with no unit`).toBeDefined();
      }
    }
    // Concretely: on a prose-less output the lexicon dimension must NOT report
    // its rule-set size as if it were a corpus.
    const lexicon = scoreDecisionReview({
      output: { narrative_summary: '', story_headlines: {}, robustness_explanation: {}, readiness_rationale: '', evidence_enhancements: {}, bias_findings: [], key_assumptions: [], decision_quality_prompts: [] },
      input: fixtures[0].input,
      candidateLabel: 'prose-less',
    }).dimensions.find((d) => d.name === 'no_banned_lexicon');
    expect(lexicon?.status).toBe('not_applicable');
  });

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
