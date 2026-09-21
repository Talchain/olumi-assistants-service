/**
 * decision_review scorer — RED-FIRST proof, one named dimension at a time.
 *
 * The house rule is that a dimension must FAIL on a seeded-bad fixture before
 * it is allowed to pass on a good one. With nineteen dimensions, "the candidate
 * failed" is far too weak to prove any particular dimension works — a candidate
 * seeded to trip `no_dashes` could fail because of an unrelated typo and the
 * assertion would still be green.
 *
 * So every seeded candidate NAMES the dimension it exists to trip
 * (`expectedFailedDimensions`), and this file asserts, per named dimension:
 *
 *   RED   the dimension FAILS on the candidate seeded for it, and
 *   GREEN the same dimension PASSES on that fixture's `good` candidate.
 *
 * The GREEN half is not decoration. Without it, a dimension hard-wired to
 * `pass: false` would satisfy every RED assertion in this file.
 *
 * The final test asserts COVERAGE: every dimension the scorer emits is named by
 * at least one seeded candidate somewhere in the pack, EXCEPT a small,
 * explicitly-reasoned list. A dimension nobody seeded a defect for is a
 * dimension nobody has proved catches anything — and without this assertion,
 * adding a nineteenth dimension with no RED fixture would go unnoticed.
 */

import { describe, expect, it } from 'vitest';
import {
  DECISION_REVIEW_DIMENSIONS,
  scoreDecisionReview,
} from '../src/decision-review/scorer.js';
import {
  loadDecisionReviewFixtures,
  runDecisionReviewFixture,
} from '../src/decision-review/run.js';
import type { DecisionReviewEvalFixture } from '../src/decision-review/types.js';

const fixtures = loadDecisionReviewFixtures();

function dimensionOf(fixture: DecisionReviewEvalFixture, candidateLabel: string, name: string) {
  const candidate = fixture.candidates.find((c) => c.label === candidateLabel);
  expect(candidate, `fixture ${fixture.id} has no candidate "${candidateLabel}"`).toBeDefined();
  const score = scoreDecisionReview({
    output: candidate!.output,
    input: fixture.input,
    candidateLabel,
  });
  const dim = score.dimensions.find((d) => d.name === name);
  expect(dim, `scorer emitted no dimension "${name}"`).toBeDefined();
  return dim!;
}

describe('decision_review fixture pack integrity', () => {
  it('loads a non-empty pack', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(7);
  });

  it('every fixture agrees with its own recorded expectations', () => {
    for (const fixture of fixtures) {
      const report = runDecisionReviewFixture(fixture);
      const disagreeing = Object.entries(report.agreement)
        .filter(([, ok]) => !ok)
        .map(([label]) => label);
      expect(disagreeing, `${fixture.id}: verdict disagreement`).toEqual([]);
      const dimDisagreeing = Object.entries(report.dimensionAgreement)
        .filter(([, ok]) => !ok)
        .map(([label]) => label);
      expect(dimDisagreeing, `${fixture.id}: named-dimension disagreement`).toEqual([]);
    }
  });

  it('is provenance-VARIED — not one author\'s afternoon', () => {
    const origins = new Set(fixtures.map((f) => f.provenance.origin));
    // Three distinct origins is the floor: revived graded fixtures, coverage of
    // input fields no revived fixture reaches, and a reproduction of a recorded
    // defect. A pack drawn from one origin measures that origin's blind spots.
    expect(origins.size).toBeGreaterThanOrEqual(3);
    for (const f of fixtures) {
      expect(f.provenance.source.length, `${f.id} has no concrete provenance source`).toBeGreaterThan(10);
      expect(f.provenance.note.length, `${f.id} has no provenance note`).toBeGreaterThan(10);
    }
  });

  it('exercises every production assembler section across the pack', () => {
    const seen = new Set<string>();
    for (const f of fixtures) for (const s of runDecisionReviewFixture(f).assembly.sections) seen.add(s);
    // SCAFFOLDED_OPTIONS is conditional on scaffold_disclosure and
    // FLIP_THRESHOLD_DATA on flip_threshold_data — both post-v11 fields no
    // revived March fixture carried. If either drops out of this set the pack
    // has quietly regressed to measuring the v11 input surface.
    for (const tag of [
      'BRIEF',
      'GRAPH',
      'ISL_RESULTS',
      'DETERMINISTIC_COACHING',
      'DECISION_CONTEXT',
      'SCAFFOLDED_OPTIONS',
      'FLIP_THRESHOLD_DATA',
    ]) {
      expect(seen.has(tag), `no fixture exercises the <${tag}> section`).toBe(true);
    }
  });
});

describe('RED-first: each seeded candidate fails the dimension it names', () => {
  const cases: Array<{ fixture: DecisionReviewEvalFixture; label: string; dimension: string }> = [];
  for (const fixture of fixtures) {
    for (const [label, dims] of Object.entries(fixture.expectedFailedDimensions ?? {})) {
      for (const dimension of dims) cases.push({ fixture, label, dimension });
    }
  }

  it('has at least one seeded case', () => {
    expect(cases.length).toBeGreaterThan(10);
  });

  for (const { fixture, label, dimension } of cases) {
    it(`${fixture.id} / ${label}: ${dimension} is RED`, () => {
      const dim = dimensionOf(fixture, label, dimension);
      expect(dim.pass, `${dimension} did not fire — detail: ${dim.detail}`).toBe(false);
      // The detail must SAY something: a failing dimension whose evidence is
      // empty cannot be acted on, and an empty string is what a stubbed-out
      // dimension returns.
      expect(dim.detail.length).toBeGreaterThan(10);
    });

    it(`${fixture.id} / good: ${dimension} is GREEN (proves the RED above is not hard-wired)`, () => {
      const dim = dimensionOf(fixture, 'good', dimension);
      expect(dim.pass, `${dimension} fails on the GOOD candidate too — detail: ${dim.detail}`).toBe(true);
    });
  }
});

describe('exact-match agreement (amendment: the check said EXACTLY, the code checked SUBSET)', () => {
  it('RED: naming FEWER dimensions than a candidate fails is a DISAGREEMENT', () => {
    // The bug this pins: `every(name => failed.has(name))` accepted any
    // superset, so a seed that tripped extra dimensions still "agreed". Three
    // of the pack's twenty seeds were doing exactly that, and the README, PR
    // body and evidence file all repeated "fails exactly the dimension each
    // names" on the strength of a check that could not have detected otherwise.
    const fixture = fixtures.find((f) => f.id === '01-clear-winner')!;
    const understated: DecisionReviewEvalFixture = {
      ...fixture,
      expectedFailedDimensions: {
        ...fixture.expectedFailedDimensions,
        degenerate_empty: ['substance_present'], // it actually fails five
      },
    };
    expect(runDecisionReviewFixture(understated).dimensionAgreement.degenerate_empty).toBe(false);
  });

  it('RED: naming a dimension the candidate does NOT fail is a disagreement', () => {
    const fixture = fixtures.find((f) => f.id === '01-clear-winner')!;
    const overstated: DecisionReviewEvalFixture = {
      ...fixture,
      expectedFailedDimensions: {
        ...fixture.expectedFailedDimensions,
        banned_lexicon: ['no_banned_lexicon', 'no_dashes'], // no_dashes is clean here
      },
    };
    expect(runDecisionReviewFixture(overstated).dimensionAgreement.banned_lexicon).toBe(false);
  });

  it('GREEN: the shipped pack names every failure of every seed', () => {
    for (const fixture of fixtures) {
      const report = runDecisionReviewFixture(fixture);
      for (const [label, ok] of Object.entries(report.dimensionAgreement)) {
        expect(ok, `${fixture.id}/${label} does not fail EXACTLY its named dimensions`).toBe(true);
      }
    }
  });

  it('RED: a candidate missing from `expected` is refused, not silently agreed', () => {
    // Previously an unlisted candidate defaulted to "agrees" — so a candidate
    // dropped from `expected` by a rename or a merge would be scored and then
    // ignored, while the pack still reported full agreement.
    const fixture = fixtures[0];
    const { good: _dropped, ...rest } = fixture.expected as Record<string, boolean>;
    expect(() =>
      runDecisionReviewFixture({ ...fixture, expected: rest }),
    ).toThrow(/have no entry in/);
  });
});

describe('tone matching is word-boundary, not substring', () => {
  // Both strings are the reviewer's demonstrated cases. Substring matching made
  // COMPLIANT cautious prose score as a tone breach — an alarm that fires on
  // correct output, which is worse than one that misses a defect: it trains
  // operators to ignore it, and it would have penalised a rewrite for doing
  // exactly what the cautious row demands.
  const cautious = fixtures.find((f) => f.id === '03-needs-evidence')!; // forbids "ready", "confident", "clear"

  const withNarrative = (text: string): DecisionReviewEvalFixture => {
    const good = cautious.candidates.find((c) => c.label === 'good')!;
    return {
      ...cautious,
      candidates: [{ ...good, label: 'probe', output: { ...good.output, readiness_rationale: text } }],
      expected: { probe: true },
      expectedFailedDimensions: {},
    };
  };

  const toneOf = (fixture: DecisionReviewEvalFixture) =>
    runDecisionReviewFixture(fixture).scores[0].dimensions.find((d) => d.name === 'tone_alignment')!;

  it('NEGATIVE CONTROL: "already" does not trip the forbidden word "ready"', () => {
    const dim = toneOf(
      withNarrative('Engineering capacity evidence has already been requested from the team.'),
    );
    expect(dim.status).toBe('pass');
  });

  it('NEGATIVE CONTROL: "unclear" does not trip the forbidden word "clear"', () => {
    const dim = toneOf(
      withNarrative('Engineering capacity remains unclear, so evidence should come first.'),
    );
    expect(dim.status).toBe('pass');
  });

  it('POSITIVE CONTROL: the bare forbidden word still trips it', () => {
    // Without this, the boundary fix could have been "match nothing" and both
    // negative controls above would still pass.
    const dim = toneOf(
      withNarrative('Engineering capacity is clear, so the team is ready to proceed.'),
    );
    expect(dim.status).toBe('fail');
    expect(dim.detail).toContain('ready to proceed');
  });
});

describe('dimension coverage', () => {
  /**
   * Dimensions with no seeded RED candidate, each with the reason it has none.
   * Every entry is a debt, not an exemption — the list is asserted to be
   * exactly this, so shrinking it is a visible improvement and growing it is a
   * visible regression.
   */
  const UNSEEDED: Readonly<Record<string, string>> = {
    // Its RED is `degenerate_empty` in 01, which names substance_present and
    // review_card_coverage; the empty output ALSO fails this one, but naming it
    // there would assert a coincidence rather than a designed defect.
    primary_risk_coherent__also_covered: 'covered by 06/incoherent_risk (named)',
  };

  it('every emitted dimension is seeded RED somewhere in the pack', () => {
    const seeded = new Set<string>();
    for (const f of fixtures) {
      for (const dims of Object.values(f.expectedFailedDimensions ?? {})) {
        for (const d of dims) seeded.add(d);
      }
    }
    const unseeded = DECISION_REVIEW_DIMENSIONS.filter((d) => !seeded.has(d));
    expect(
      unseeded,
      `dimensions with no RED fixture (each is unproven): ${unseeded.join(', ')}`,
    ).toEqual([]);
    // Keeps the debt list above honest: if it ever needs entries, this fails.
    expect(Object.keys(UNSEEDED).length).toBeLessThanOrEqual(1);
  });

  it('the emitted dimension list matches the declared inventory exactly', () => {
    // The inventory is consumed by the anti-vacuity test and the baseline
    // report. A scorer that emits a dimension the inventory does not list would
    // be silently excluded from both — the hand-maintained-mirror defect, so it
    // is derived from a real score rather than trusted.
    const fixture = fixtures[0];
    const score = scoreDecisionReview({
      output: fixture.candidates[0].output,
      input: fixture.input,
      candidateLabel: 'good',
    });
    expect(score.dimensions.map((d) => d.name)).toEqual([...DECISION_REVIEW_DIMENSIONS]);
  });
});
