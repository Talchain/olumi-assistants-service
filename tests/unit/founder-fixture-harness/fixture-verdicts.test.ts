/**
 * THE LOAD-BEARING TEST: every one of the six criteria has an exercised path to
 * FAIL.
 *
 * The brief this harness was built to answer put it first, in these words: "It
 * must be able to FAIL. Every criterion needs a path to FAIL that has been
 * exercised. A criterion that cannot fail is not a check — this estate has
 * shipped that repeatedly."
 *
 * So each RED fixture is replayed through the real classifiers and asserted to
 * fail the criterion it was built to break, AND to name the specific thing in
 * its evidence. Asserting only the verdict would pass on a criterion that
 * failed for an unrelated reason — the same defect as a test that binds by a
 * value predicate instead of by identity.
 *
 * The `no-failures` fixture is the negative control for the whole set: if it
 * ever fails a criterion, the RED fixtures' failures stop being evidence about
 * the thing they mutate.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { evaluateCriteria } from '../../../tools/founder-fixture-harness/criteria.js';
import { buildDetectors, type DetectorBundle } from '../../../tools/founder-fixture-harness/detectors.js';
import { fixtureToCaptures, type ReplayFixture } from '../../../tools/founder-fixture-harness/index.js';
import type { CriterionId, Verdict } from '../../../tools/founder-fixture-harness/types.js';

const FIXTURES = join(process.cwd(), 'tools/founder-fixture-harness/fixtures');

function load(name: string): ReplayFixture {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as ReplayFixture;
}

/**
 * A coherence detector that is present, controlled, and reports whatever the
 * caller says.
 *
 * ⚠ WHY A STUB HERE AND NOT THE REAL ONE. The real detector lives in the UI
 * repo and needs that checkout's dependencies, which CI for THIS repo does not
 * have. Two claims must not be conflated:
 *
 *   "the UI's contradiction gate is correct"        — the UI repo's business
 *   "when the gate reports a violation, C4 FAILS
 *    and names the pair"                            — THIS repo's business
 *
 * The stub tests the second and only the second. The first is tested where it
 * lives. A test that silently skipped when the UI checkout was absent would be
 * a test that cannot fail.
 */
function withCoherence(base: DetectorBundle, violations: readonly { pair: string; detail?: string }[]): DetectorBundle {
  return {
    ...base,
    coherence: {
      module: { evaluate: () => violations },
      status: {
        id: 'cross-surface-coherence',
        available: true,
        positiveControl: 'fired',
        negativeControl: 'silent',
        source: 'test stub',
      },
    },
  };
}

function verdictOf(criteria: ReturnType<typeof evaluateCriteria>['criteria'], id: CriterionId): Verdict {
  const c = criteria.find((x) => x.id === id);
  expect(c, `criterion ${id} missing from the evaluation`).toBeDefined();
  return (c as { verdict: Verdict }).verdict;
}

function evidenceOf(criteria: ReturnType<typeof evaluateCriteria>['criteria'], id: CriterionId): string {
  const c = criteria.find((x) => x.id === id);
  return (c?.limbs ?? []).flatMap((l) => l.evidence).join('\n');
}

describe('founder fixture — every criterion has an exercised FAIL path', () => {
  it('the no-failures fixture is the negative control: nothing FAILS', async () => {
    const detectors = await buildDetectors(undefined);
    const { criteria } = evaluateCriteria({
      turns: fixtureToCaptures(load('no-failures')),
      detectors,
    });
    const failed = criteria.filter((c) => c.verdict === 'FAIL').map((c) => c.id);
    expect(failed).toEqual([]);
    // And it is NOT reported as a pass: four criteria carry an undecidable limb.
    expect(criteria.filter((c) => c.verdict === 'NOT_ASSESSED').map((c) => c.id).sort()).toEqual([
      'C1',
      'C2',
      'C4',
      'C6',
    ]);
    expect(verdictOf(criteria, 'C3')).toBe('PASS');
    expect(verdictOf(criteria, 'C5')).toBe('PASS');
  });

  it('C1 FAILS when an unlicensed turn names a leading option, a rank and a stability verdict', async () => {
    const detectors = await buildDetectors(undefined);
    const { criteria } = evaluateCriteria({
      turns: fixtureToCaptures(load('red-c1-unlicensed-leader')),
      detectors,
    });
    expect(verdictOf(criteria, 'C1')).toBe('FAIL');
    const ev = evidenceOf(criteria, 'C1');
    expect(ev).toContain('quantified_provisional');
    expect(ev).toContain('leading_option_id');
    expect(ev).toContain('key designates an ordinal position (rank)');
    expect(ev).toContain('stability/robustness verdict');
    // The other criteria must not be collateral damage — a RED fixture that
    // broke everything would prove nothing about the criterion it names.
    expect(verdictOf(criteria, 'C5')).toBe('PASS');
  });

  it('C2 FAILS on a silent refusal — a refusal with an empty reasons[]', async () => {
    const detectors = await buildDetectors(undefined);
    const { criteria } = evaluateCriteria({
      turns: fixtureToCaptures(load('red-c2-silent-refusal')),
      detectors,
    });
    expect(verdictOf(criteria, 'C2')).toBe('FAIL');
    expect(evidenceOf(criteria, 'C2')).toContain('EMPTY reasons[]');
  });

  it('C3 FAILS on the verbatim routing narration captured on 3 Sep, and C6 fails with it', async () => {
    const detectors = await buildDetectors(undefined);
    const { criteria } = evaluateCriteria({
      turns: fixtureToCaptures(load('red-c3-narration')),
      detectors,
    });
    expect(verdictOf(criteria, 'C3')).toBe('FAIL');
    expect(evidenceOf(criteria, 'C3')).toContain('USER-VISIBLE NARRATION');
    // The same sentence is signature (b) of C6's misroute. That the two agree
    // is not redundancy — they are different criteria over one corpus, and the
    // producer module's own header cites this capture at BOTH fixture turns.
    expect(verdictOf(criteria, 'C6')).toBe('FAIL');
  });

  it('C4 FAILS when the coherence gate reports a violation, and names the pair', async () => {
    const detectors = withCoherence(await buildDetectors(undefined), [
      { pair: 'CX5', detail: 'flip_thresholds says it cannot flip; conditional_winners says it does' },
    ]);
    const { criteria } = evaluateCriteria({
      turns: fixtureToCaptures(load('red-c4-contradiction')),
      detectors,
      adaptCapture: (raw) => raw,
    });
    expect(verdictOf(criteria, 'C4')).toBe('FAIL');
    expect(evidenceOf(criteria, 'C4')).toContain('CX5');
  });

  it('C4 is NOT ASSESSED — never PASS — when the coherence detector is unavailable', async () => {
    const detectors = await buildDetectors(undefined);
    const { criteria } = evaluateCriteria({
      turns: fixtureToCaptures(load('red-c4-contradiction')),
      detectors,
    });
    expect(verdictOf(criteria, 'C4')).toBe('NOT_ASSESSED');
    expect(evidenceOf(criteria, 'C4')).toContain('no --ui-repo given');
  });

  it('C4 reports CX3 unassessed even when the gate reports nothing', async () => {
    const detectors = withCoherence(await buildDetectors(undefined), []);
    const { criteria } = evaluateCriteria({
      turns: fixtureToCaptures(load('no-failures')),
      detectors,
      adaptCapture: (raw) => raw,
    });
    const c4 = criteria.find((c) => c.id === 'C4');
    const cx3 = c4?.limbs.find((l) => l.id === 'C4.wire.cx3-visible-body');
    expect(cx3?.verdict).toBe('NOT_ASSESSED');
    // Five pairs clean, one limb undecidable ⇒ the criterion is NOT_ASSESSED.
    expect(c4?.verdict).toBe('NOT_ASSESSED');
  });

  it('C5 FAILS when the correction reports applied in prose but the patch is a noop', async () => {
    const detectors = await buildDetectors(undefined);
    const { criteria } = evaluateCriteria({
      turns: fixtureToCaptures(load('red-c5-noop-correction')),
      detectors,
    });
    expect(verdictOf(criteria, 'C5')).toBe('FAIL');
    const ev = evidenceOf(criteria, 'C5');
    expect(ev).toContain('changed NOTHING');
    expect(ev).toContain('fac_sales_headcount');
  });

  it('C5 FAILS when the correction lands on a DIFFERENT object than the one named', async () => {
    const detectors = await buildDetectors(undefined);
    const { criteria } = evaluateCriteria({
      turns: fixtureToCaptures(load('red-c5-off-target')),
      detectors,
    });
    expect(verdictOf(criteria, 'C5')).toBe('FAIL');
    const ev = evidenceOf(criteria, 'C5');
    expect(ev).toContain('DIFFERENT object');
    expect(ev).toContain('fac_tooling');
  });

  it('C6 FAILS on the misroute: a noop patch and the no-change denial as the answer', async () => {
    const detectors = await buildDetectors(undefined);
    const { criteria } = evaluateCriteria({
      turns: fixtureToCaptures(load('red-c6-misroute')),
      detectors,
    });
    expect(verdictOf(criteria, 'C6')).toBe('FAIL');
    const ev = evidenceOf(criteria, 'C6');
    expect(ev).toContain('graph editor entered and changed nothing');
    expect(ev).toContain('no-change denial as the ANSWER');
  });

  it('a turn that never returned makes its criteria NOT ASSESSED — never FAIL', async () => {
    const detectors = await buildDetectors(undefined);
    const { criteria, caveats } = evaluateCriteria({
      turns: fixtureToCaptures(load('transport-loss')),
      detectors,
    });
    // Turn 6 never returned. C5's rerun limb reads it, so C5 goes unassessed.
    expect(verdictOf(criteria, 'C5')).toBe('NOT_ASSESSED');
    expect(criteria.filter((c) => c.verdict === 'FAIL')).toEqual([]);
    expect(caveats.join('\n')).toContain('turn 6 did not return a body');
  });

  it('every fixture declares the exit code and criteria it expects, and delivers them', async () => {
    // The fixtures' own `expect` blocks are part of the contract, not decoration.
    const cases = [
      'no-failures',
      'refusal-honest',
      'red-c1-unlicensed-leader',
      'red-c2-silent-refusal',
      'red-c3-narration',
      'red-c5-noop-correction',
      'red-c5-off-target',
      'red-c6-misroute',
      'transport-loss',
    ];
    for (const name of cases) {
      const fixture = load(name);
      expect(fixture.expect, `${name} declares no expectations`).toBeDefined();
      const detectors = await buildDetectors(undefined);
      const { criteria } = evaluateCriteria({ turns: fixtureToCaptures(fixture), detectors });
      for (const [id, expected] of Object.entries(fixture.expect?.criteria ?? {})) {
        expect(verdictOf(criteria, id as CriterionId), `${name} → ${id}`).toBe(expected);
      }
    }
  });
});
