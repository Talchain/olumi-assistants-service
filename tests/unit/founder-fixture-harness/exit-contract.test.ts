/**
 * The exit-code contract, which is the only thing a CI job or a shell script
 * ever reads.
 *
 * ⚠ EXIT 0 DOES NOT MEAN THE FIXTURE PASSED, and on the wire it almost never
 * can: four of the six criteria carry a limb a payload cannot decide. A caller
 * that treats 0 as "green" is reading a claim the harness never made, so the
 * headline is asserted here alongside the code — the number and the sentence
 * that qualifies it ship together or the qualification is decorative.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { evaluateCriteria } from '../../../tools/founder-fixture-harness/criteria.js';
import { buildDetectors } from '../../../tools/founder-fixture-harness/detectors.js';
import { exitCodeFor, fixtureToCaptures } from '../../../tools/founder-fixture-harness/index.js';
import { headline, renderReport, tally } from '../../../tools/founder-fixture-harness/report.js';
import { RELOAD_SEMANTICS } from '../../../tools/founder-fixture-harness/script.js';
import { composeVerdict } from '../../../tools/founder-fixture-harness/types.js';
import type { HarnessOutcome, LimbResult } from '../../../tools/founder-fixture-harness/types.js';

const FIXTURES = join(process.cwd(), 'tools/founder-fixture-harness/fixtures');

async function outcomeFor(name: string): Promise<HarnessOutcome> {
  const fixture = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));
  const turns = fixtureToCaptures(fixture);
  const detectors = await buildDetectors(undefined);
  const { criteria, caveats } = evaluateCriteria({ turns, detectors });
  return {
    context: {
      startedAt: '2026-09-05T00:00:00.000Z',
      mode: 'replay',
      stateClass: 'replayed',
      briefSha256: 'x',
      briefBytes: 0,
      briefPath: name,
      ceeBaseUrl: '(replay)',
      origin: '(replay)',
      scenarioId: '(replay)',
      builds: [],
      detectors: [detectors.narration.status],
      reload_semantics: RELOAD_SEMANTICS,
    },
    turns,
    criteria,
    measurements: [],
    caveats,
  };
}

const limb = (verdict: LimbResult['verdict']): LimbResult => ({
  id: 'x',
  question: 'x',
  decidability: 'wire',
  verdict,
  evidence: [],
});

describe('composeVerdict — the pessimistic rule, pinned', () => {
  it('any FAIL wins, even beside passes', () => {
    expect(composeVerdict([limb('PASS'), limb('FAIL'), limb('NOT_ASSESSED')])).toBe('FAIL');
    expect(composeVerdict([limb('PASS'), limb('FAIL')])).toBe('FAIL');
  });

  it('PASS requires EVERY limb to pass — one undecidable limb sinks it to NOT_ASSESSED', () => {
    expect(composeVerdict([limb('PASS'), limb('PASS')])).toBe('PASS');
    expect(composeVerdict([limb('PASS'), limb('NOT_ASSESSED')])).toBe('NOT_ASSESSED');
  });

  it('no limbs is NOT_ASSESSED, never a vacuous PASS', () => {
    expect(composeVerdict([])).toBe('NOT_ASSESSED');
  });
});

describe('exit codes', () => {
  it('exit 1 on any FAIL', async () => {
    const outcome = await outcomeFor('red-c5-noop-correction');
    expect(tally(outcome).fail).toBeGreaterThan(0);
    expect(exitCodeFor(outcome, false)).toBe(1);
  });

  it('exit 0 when nothing failed — and the headline says that is not a pass', async () => {
    const outcome = await outcomeFor('no-failures');
    expect(exitCodeFor(outcome, false)).toBe(0);
    const t = tally(outcome);
    expect(t.fail).toBe(0);
    expect(t.notAssessed).toBeGreaterThan(0);
    // The number and its qualification ship together.
    expect(headline(outcome)).toBe(
      `FAILED 0 · NOT ASSESSED ${t.notAssessed} · PASSED ${t.pass} (of 6 deterministic criteria)`,
    );
    expect(renderReport(outcome)).toContain('that is not the same as the fixture passing');
  });

  it('--require-fully-assessed turns "nothing failed" into a failure', async () => {
    // For a caller who wants "the whole thing must be decidable" rather than
    // "nothing was refuted". On the wire today that is almost always exit 1,
    // which is the honest answer to that question.
    const outcome = await outcomeFor('no-failures');
    expect(exitCodeFor(outcome, true)).toBe(1);
  });

  it('a voided journey exits 0 — a run the harness did not drive may not fail the product', async () => {
    const outcome = await outcomeFor('brief-never-landed');
    expect(exitCodeFor(outcome, false)).toBe(0);
    expect(tally(outcome).fail).toBe(0);
    expect(renderReport(outcome)).toContain('THE BRIEF NEVER LANDED');
  });

  it('the report never omits a limb without evidence, and flags it if one is', async () => {
    // An empty evidence list is a defect in the harness, not a quiet pass, and
    // the renderer says so where a reader will see it.
    const outcome = await outcomeFor('no-failures');
    const md = renderReport(outcome);
    for (const c of outcome.criteria) {
      for (const l of c.limbs) {
        expect(md, `${l.id} missing from the report`).toContain(l.id);
        if (l.evidence.length === 0) {
          expect(md).toContain('treat this as a defect in the harness, not a pass');
        }
      }
    }
  });
});
