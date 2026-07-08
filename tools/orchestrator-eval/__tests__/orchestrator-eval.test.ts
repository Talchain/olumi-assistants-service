/**
 * orchestrator-eval — foundation test suite.
 *
 * Proves the gate catches the exact drift it exists for:
 *   1. ASSEMBLY FIDELITY — the production formatter keeps win% and target-fit
 *      distinct and emits the TARGET_FIT_DEFINITION disclosure (guards the fix
 *      at its source: format-analysis-for-context.ts).
 *   2. THE GATE — the recorded good candidates PASS and the recorded regression
 *      candidates FAIL, and the chassis agrees with the fixture's expectations.
 *   3. GUARD WIRING — the imported PRODUCTION guards (forbidden phrases,
 *      mutation language) actually fire, so the eval and the runtime cannot
 *      drift apart.
 */

import { describe, expect, it } from 'vitest';
import {
  formatAnalysisForContext,
  TARGET_FIT_DEFINITION,
} from '../../../src/orchestrator-v5/format/format-analysis-for-context.js';
import { assembleAnalysis } from '../src/assemble.js';
import { detectGoalFitConflation } from '../src/goal-fit-conflation.js';
import { scoreCandidate } from '../src/scorer.js';
import { loadFixtures, runFixture } from '../src/run.js';
import type { OrchestratorEvalFixture } from '../src/types.js';

function goalFitFixture(): OrchestratorEvalFixture {
  const fixture = loadFixtures().find((f) => f.id === 'goal-fit-conflation');
  if (!fixture) throw new Error('goal-fit-conflation fixture not found');
  return fixture;
}

describe('assembly fidelity (production formatAnalysisForContext)', () => {
  it('renders win% and target-fit as DISTINCT values for the leading option', () => {
    const assembled = assembleAnalysis(goalFitFixture().analysis);
    expect(assembled?.leading_option?.win_probability).toBe('89%');
    expect(assembled?.leading_option?.target_fit).toBe('29%');
    expect(assembled?.leading_option?.win_probability).not.toBe(
      assembled?.leading_option?.target_fit,
    );
  });

  it('emits the win%-vs-target-fit disclosure so the LLM cannot silently conflate them', () => {
    const assembled = assembleAnalysis(goalFitFixture().analysis);
    expect(assembled?.goal_fit).toContain(TARGET_FIT_DEFINITION);
  });

  it('uses the SAME formatter the runtime uses (assembleAnalysis === formatAnalysisForContext)', () => {
    const raw = goalFitFixture().analysis;
    expect(assembleAnalysis(raw)).toEqual(formatAnalysisForContext(raw));
  });
});

describe('goal-fit conflation detector (grounded in assembled numbers)', () => {
  const raw = () => goalFitFixture().analysis;

  it('flags the win number narrated as target attainment', () => {
    const r = detectGoalFitConflation(
      raw(),
      'You have an 89% chance of reaching your £20k target.',
    );
    expect(r.conflated).toBe(true);
    expect(r.grounding).toEqual({ winPercent: 89, targetFitPercent: 29 });
  });

  it('does NOT flag the target-fit number bound to target attainment', () => {
    const r = detectGoalFitConflation(
      raw(),
      'It is only 29% likely to meet your £20k target.',
    );
    expect(r.conflated).toBe(false);
  });

  it('does NOT flag win% bound to win framing', () => {
    const r = detectGoalFitConflation(raw(), 'It wins most often, at an 89% win probability.');
    expect(r.conflated).toBe(false);
  });
});

describe('the gate — recorded candidates score as the fixture expects', () => {
  const fixture = goalFitFixture();

  for (const candidate of fixture.candidates) {
    const expected = fixture.expected[candidate.label];
    it(`${candidate.label} → ${expected ? 'PASS' : 'FAIL'}`, () => {
      const score = scoreCandidate(fixture.analysis, candidate);
      expect(score.pass).toBe(expected);
    });
  }

  it('chassis agreement: every candidate verdict matches its expectation', () => {
    const report = runFixture(fixture);
    expect(report.ok).toBe(true);
    expect(report.assembly.distinguishesWinFromTargetFit).toBe(true);
  });
});

describe('every checked-in fixture is self-consistent (prompt-workstream live-regression set)', () => {
  // The corpus grows as the prompt workstream feeds in fixtures reproducing
  // real staging regressions (goal-fit values-withheld, coach mutation-language,
  // stale / recommendation vocabulary). Each fixture's `expected` map is a live
  // assertion: the chassis verdict for every candidate must match it, or the
  // gate no longer catches the drift the fixture was built to catch.
  for (const fx of loadFixtures()) {
    it(`${fx.id}: chassis agreement ok`, () => {
      const report = runFixture(fx);
      expect(report.ok).toBe(true);
    });
  }
});

describe('production guards are genuinely wired (not re-specified)', () => {
  const raw = () => goalFitFixture().analysis;

  it('fails a response leaking a forbidden user-facing phrase', () => {
    const score = scoreCandidate(raw(), {
      label: 'leak',
      note: 'leaks a raw entity id + a banned internal term',
      source: 'recorded',
      text: 'The orchestrator picked opt_1 as the winner.',
    });
    const forbidden = score.dimensions.find((d) => d.name === 'no_forbidden_terms');
    expect(forbidden?.pass).toBe(false);
    expect(score.pass).toBe(false);
  });

  it('fails a response that falsely claims a graph mutation on a non-edit turn', () => {
    const score = scoreCandidate(raw(), {
      label: 'mutation',
      note: 'reads as an applied edit',
      source: 'recorded',
      text: "I'll add a competitive-response risk factor to the model.",
    });
    const mutation = score.dimensions.find((d) => d.name === 'no_mutation_language');
    expect(mutation?.pass).toBe(false);
    expect(score.pass).toBe(false);
  });
});
