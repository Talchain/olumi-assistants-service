/**
 * ROADMAP 2.308 / S3 — `buildAnalysisAbsentTemplate` contradicted itself BY
 * CONSTRUCTION.
 *
 * Diagnosis `PHASE0-EVIDENCE-2026-07-28/diagnosis-2308-addoption-deadend.md`
 * §7 row 7 / §9 S3, at deployed CEE `a5a3e22`: remedy #7 was answered with
 *
 *   "No analysis has been run on your model yet. Your model has 6 options
 *    set up but the options still need to be set up before analysis can run."
 *
 * "This is not an LLM hallucination — it is deterministic concatenation":
 * the head clause `Your model has ${n} ${optionsLabel} set up ` was emitted
 * unconditionally and the needs-setup tail then denied it. The copy also
 * named no option and no missing thing, so it was unactionable.
 *
 * The pin below is a PROPERTY, not a string snapshot: no rendering of this
 * template may both claim the options are set up and say they still need to
 * be. A snapshot would go green the moment someone reworded either clause;
 * the property bites on any future concatenation of the same shape.
 */

import { describe, it, expect } from 'vitest';

import { buildAnalysisAbsentTemplate } from '../no-op-helpers.js';

/** The a5a3e22a output for the tester's exact state — pinned historically. */
const PRISTINE_CONTRADICTION =
  'No analysis has been run on your model yet. Your model has 6 options set up ' +
  'but the options still need to be set up before analysis can run.';

const NEEDS_SETUP_STATUSES = ['needs_user_input', 'needs_user_mapping', 'needs_encoding'] as const;
const NON_BLOCKING_STATUSES = ['ready', undefined, 'some_future_status'] as const;

/** Claims the options ARE set up. */
const CLAIMS_SET_UP = /\b(?:options?|model)\b[^.]*\bset up\b/i;
/** Says they still need to be set up. */
const CLAIMS_NEEDS_SET_UP = /\bstill need(?:s)? to be set up\b/i;

describe('2.308 S3 — the pristine template is pinned as the defect', () => {
  it('the a5a3e22a output asserts and denies "set up" in one sentence', () => {
    expect(CLAIMS_SET_UP.test(PRISTINE_CONTRADICTION)).toBe(true);
    expect(CLAIMS_NEEDS_SET_UP.test(PRISTINE_CONTRADICTION)).toBe(true);
  });
});

describe('2.308 S3 — buildAnalysisAbsentTemplate is never self-contradicting', () => {
  for (const status of NEEDS_SETUP_STATUSES) {
    for (const optionCount of [0, 1, 2, 6]) {
      for (const labels of [[], ['Launch Customer Retention Programme'], ['A', 'B']]) {
        it(`status=${status} count=${optionCount} labels=${labels.length}: does not claim "set up" and deny it`, () => {
          const text = buildAnalysisAbsentTemplate(optionCount, status, labels);
          const contradicts = CLAIMS_SET_UP.test(text) && CLAIMS_NEEDS_SET_UP.test(text);
          expect(contradicts, `self-contradicting copy: ${text}`).toBe(false);
        });
      }
    }
  }

  it('names the blocked option when the caller knows it', () => {
    const text = buildAnalysisAbsentTemplate(6, 'needs_encoding', [
      'Launch Customer Retention Programme',
    ]);
    expect(text).toContain('Launch Customer Retention Programme');
    // …and says what is missing, in the same words the UI's blocked reason
    // uses ("has no effect values yet"), not an internal field name.
    expect(text).toMatch(/effect values/i);
    expect(text).not.toMatch(/\binterventions?\b/i);
    expect(text).not.toMatch(/\braw_value\b|\bobserved_state\b|\bcap\b/i);
  });

  it('stays honest when the caller knows no labels', () => {
    const text = buildAnalysisAbsentTemplate(6, 'needs_encoding', []);
    expect(text).toMatch(/effect values/i);
    expect(CLAIMS_NEEDS_SET_UP.test(text)).toBe(false);
  });

  it('needs_user_input says what it actually means — too few options to compare', () => {
    const text = buildAnalysisAbsentTemplate(1, 'needs_user_input', []);
    expect(text).toMatch(/at least two/i);
    expect(text).not.toMatch(/effect values/i);
  });

  it('pluralises the named options correctly', () => {
    const one = buildAnalysisAbsentTemplate(3, 'needs_encoding', ['Option A']);
    expect(one).toMatch(/"Option A" has no effect values yet/);
    const two = buildAnalysisAbsentTemplate(3, 'needs_encoding', ['Option A', 'Option B']);
    expect(two).toMatch(/"Option A" and "Option B" have no effect values yet/);
  });

  for (const status of NON_BLOCKING_STATUSES) {
    it(`status=${String(status)}: the ready-path copy is unchanged`, () => {
      const text = buildAnalysisAbsentTemplate(2, status);
      expect(text).toBe(
        'No analysis has been run on your model yet. Your model has 2 options set up ' +
          'and is ready to analyse. Would you like me to run the analysis?',
      );
    });
  }

  it('blockedOptionLabels is optional — existing two-argument callers still compile and render', () => {
    const text = buildAnalysisAbsentTemplate(6, 'needs_encoding');
    expect(CLAIMS_SET_UP.test(text) && CLAIMS_NEEDS_SET_UP.test(text)).toBe(false);
  });
});
