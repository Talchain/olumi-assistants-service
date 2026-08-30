/**
 * CONTINUITY HARNESS — Tier 1: self-check of the harness's own instruments.
 *
 * WHY THE HARNESS TESTS ITSELF
 * ----------------------------
 * The Tier 2 battery's entire value rests on three claims: that its redactor
 * fires, that its discrimination gate can fail, and that a split reading is
 * never averaged into a verdict. Each of those is an ABSENCE-shaped claim, and
 * an absence-shaped claim from an unproven instrument is worth nothing.
 *
 * This estate has repeatedly shipped guards that could not fail — controls
 * that agreed because both sides were empty, discriminators whose fixtures had
 * silently stopped reproducing anything, absence probes with no positive
 * control. The response is not to be more careful. It is to make the
 * instrument's failure modes EXECUTABLE, so that a change which quietly
 * removes the harness's teeth REDs here rather than being discovered later by
 * a wrong verdict nobody could see was wrong.
 *
 * Every assertion below is a MUTANT: it feeds the helper an input on which it
 * MUST refuse, and fails if the helper waves it through.
 */

import { describe, expect, it } from 'vitest';

import { proveRedactorFires, redact, fingerprint } from '../../../../scripts/continuity/lib/redact.mjs';
import {
  assertArmsDiscriminate,
  collapseReplays,
  requireNonEmpty,
  scoreCase,
  validateCaseShape,
  check,
  PASS,
  FAIL,
  CNM,
} from '../../../../scripts/continuity/lib/verdict.mjs';

describe('continuity instrument: the redactor', () => {
  it('passes its own positive and contrast controls', () => {
    const r = proveRedactorFires();
    expect(r.checks).toHaveLength(2);
    expect(r.ok, `redactor controls failed: ${JSON.stringify(r.checks)}`).toBe(true);
  });

  it('MUTANT — destroys a JWT-shaped string rather than passing it through', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtdXRhbnQtY2hlY2sifQ.c2lnbmF0dXJlLXBsYWNlaG9sZGVy';
    const { value, hits } = redact({ authorization: `Bearer ${jwt}` });
    const serialised = JSON.stringify(value);

    expect(serialised, 'the token survived redaction — a capture would leak it to disk').not.toContain(jwt);
    expect(hits.length).toBeGreaterThan(0);
    // The value is reported only as a fingerprint, never in the clear.
    expect(serialised).toContain(fingerprint(jwt).slice(0, 8));
  });

  it('MUTANT — does NOT over-match ordinary prose (a redactor that eats everything is equally broken)', () => {
    const prose = 'Confirm the effect value for "Partial Increase" on "Monthly seat price" — e.g. 20%.';
    const { value, hits } = redact({ assistant_text: prose });
    expect(value.assistant_text).toBe(prose);
    expect(hits).toHaveLength(0);
  });
});

describe('continuity instrument: the discrimination gate', () => {
  it('MUTANT — two EMPTY responses must NOT count as discriminating', () => {
    // This is the exact defect the gate replaces: `not.toEqual` passes when
    // both sides are empty, and the case scores a meaningless PASS.
    const r = assertArmsDiscriminate('', '');
    expect(r.ok, 'two empty responses were accepted as discriminating').toBe(false);
    expect(r.reason).toMatch(/empty|absent/i);
  });

  it('MUTANT — byte-identical responses must NOT count as discriminating', () => {
    const same = 'I want to route this correctly, but "20" alone does not tell me what to change.';
    const r = assertArmsDiscriminate(same, same);
    expect(r.ok, 'byte-identical arm and control were accepted').toBe(false);
    expect(r.reason).toMatch(/BYTE-IDENTICAL/i);
  });

  it('accepts genuinely different responses', () => {
    expect(assertArmsDiscriminate('names Partial Increase', 'names nothing at all').ok).toBe(true);
  });

  it('MUTANT — whitespace-only difference must NOT count as discrimination', () => {
    const r = assertArmsDiscriminate('same answer', '  same answer  ');
    expect(r.ok, 'a trailing-whitespace difference was accepted as a real divergence').toBe(false);
  });
});

describe('continuity instrument: non-empty gating', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace', '   '],
    ['empty array', []],
    ['empty object', {}],
  ])('MUTANT — refuses %s', (_label, value) => {
    expect(requireNonEmpty('probe', value as never).ok).toBe(false);
  });

  it('accepts real content', () => {
    expect(requireNonEmpty('probe', 'a real answer').ok).toBe(true);
  });
});

describe('continuity instrument: replay collapsing', () => {
  it('MUTANT — a split reading must NOT be majority-voted into a verdict', () => {
    const r = collapseReplays([PASS, PASS, FAIL]);
    expect(r.verdict, 'a 2-1 split was resolved by majority instead of being voided').toBe(CNM);
    expect(r.split).toBe(true);
    expect(r.distribution).toEqual({ [PASS]: 2, [FAIL]: 1 });
  });

  it('agrees only when every replay agrees', () => {
    expect(collapseReplays([PASS, PASS, PASS]).verdict).toBe(PASS);
    expect(collapseReplays([FAIL, FAIL]).verdict).toBe(FAIL);
  });

  it('MUTANT — zero replays is not a pass', () => {
    expect(collapseReplays([]).verdict).toBe(CNM);
  });
});

describe('continuity instrument: case scoring gates', () => {
  const goodDiscrimination = { ok: true, reason: 'differ' };

  it('MUTANT — a failed precondition yields COULD_NOT_MEASURE, never FAIL or PASS', () => {
    const r = scoreCase({
      preconditionChecks: [check('world reached', false, 'the fixture no longer reproduces the state')],
      discrimination: goodDiscrimination,
      armChecks: [check('a', true, '')],
      controlChecks: [check('b', true, '')],
    });
    expect(r.verdict).toBe(CNM);
    expect(r.stage).toBe('precondition');
  });

  it('MUTANT — a dead discrimination yields COULD_NOT_MEASURE even when every assertion passes', () => {
    const r = scoreCase({
      preconditionChecks: [check('world reached', true, '')],
      discrimination: { ok: false, reason: 'BYTE-IDENTICAL' },
      armChecks: [check('a', true, '')],
      controlChecks: [check('b', true, '')],
    });
    expect(r.verdict, 'a non-discriminating case was allowed to PASS').toBe(CNM);
    expect(r.stage).toBe('discrimination');
  });

  it('only reaches PASS when precondition AND discrimination AND assertions all hold', () => {
    const r = scoreCase({
      preconditionChecks: [check('world reached', true, '')],
      discrimination: goodDiscrimination,
      armChecks: [check('a', true, '')],
      controlChecks: [check('b', true, '')],
    });
    expect(r.verdict).toBe(PASS);
  });

  it('reports a genuine assertion failure as FAIL, not as could-not-measure', () => {
    const r = scoreCase({
      preconditionChecks: [check('world reached', true, '')],
      discrimination: goodDiscrimination,
      armChecks: [check('names the option', false, 'not named')],
      controlChecks: [],
    });
    expect(r.verdict).toBe(FAIL);
  });
});

describe('continuity instrument: case shape validation', () => {
  const wellFormed = {
    id: 'x',
    stateClass: 'fresh',
    seam: 'A',
    setup: () => {},
    precondition: () => [],
    arm: () => {},
    control: () => {},
    assertArm: () => [],
    assertControl: () => [],
  };

  it('accepts a well-formed case', () => {
    expect(validateCaseShape(wellFormed).ok).toBe(true);
  });

  it('MUTANT — REFUSES a case with no control (the defect this estate keeps shipping)', () => {
    const { control: _control, ...noControl } = wellFormed;
    const v = validateCaseShape(noControl);
    expect(v.ok, 'a control-less case was accepted — it could pass without discriminating').toBe(false);
    expect(v.problems.join(' ')).toMatch(/control/);
  });

  it('MUTANT — REFUSES a case with no precondition pin', () => {
    const { precondition: _precondition, ...noPre } = wellFormed;
    expect(validateCaseShape(noPre).ok).toBe(false);
  });

  it('MUTANT — REFUSES an unrecognised state class (seeded must never be reported as fresh)', () => {
    expect(validateCaseShape({ ...wellFormed, stateClass: 'whatever' }).ok).toBe(false);
  });
});
