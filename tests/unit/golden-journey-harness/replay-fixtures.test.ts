/**
 * Golden-Journey Harness — committed replay-fixture manifest (review blockers).
 *
 * Encodes the expected replay EXIT CODE for every committed fixture as a
 * machine-readable test, so a RED fixture silently flipping green (e.g. a
 * weakened pattern, or an edited `defects` / `context-drop` transcript) fails
 * the required unit gate immediately — rather than going unnoticed until the
 * PR2 CI replay lands. Uses the SAME `evaluateReplayFixture` seam the CLI uses,
 * so "the replay would exit N" is asserted, not just documented.
 *
 * Also pins the fail-CLOSED shape contract: a fixture whose
 * `transcript.observations` is missing, renamed, non-array, or empty is a fatal
 * `ReplayFixtureError` (CLI → exit 2), never a zero-turn run that reports only
 * inconclusives and exits 0.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  evaluateReplayFixture,
  ReplayFixtureError,
} from '../../../tools/golden-journey-harness/index.js';

const FIXTURE_DIR = fileURLToPath(
  new URL('../../../tools/golden-journey-harness/fixtures/', import.meta.url),
);

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(`${FIXTURE_DIR}${name}`, 'utf-8'));
}

/**
 * The expected replay outcome for each committed fixture. `gatingInvariant`,
 * when set, asserts the discriminating gating fail is that invariant (so a
 * fixture cannot exit 1 for an unrelated reason and read as success).
 */
const MANIFEST: ReadonlyArray<{
  readonly file: string;
  readonly expectedExit: 0 | 1;
  readonly gatingInvariant?: string;
}> = [
  { file: 'golden-journey-v1.json', expectedExit: 0 },
  { file: 'golden-journey-v1-defects.json', expectedExit: 1 },
  { file: 'golden-journey-v1-f4835349-regression.json', expectedExit: 0 },
  { file: 'golden-journey-v1-add-risk-rejection.json', expectedExit: 0 },
  { file: 'golden-journey-v1-context-drop.json', expectedExit: 1, gatingInvariant: 'A12' },
];

describe('replay-fixture manifest — expected exit codes are enforced, not just documented', () => {
  for (const { file, expectedExit, gatingInvariant } of MANIFEST) {
    it(`${file} → replay exit ${expectedExit}${gatingInvariant ? ` (gating ${gatingInvariant})` : ''}`, () => {
      const result = evaluateReplayFixture(loadFixture(file) as never);
      expect(result.exitCode, `${file} expected replay exit ${expectedExit}`).toBe(expectedExit);
      if (expectedExit === 1) {
        expect(result.gatingFails, `${file} must have at least one gating fail`).toBeGreaterThan(0);
      } else {
        expect(result.gatingFails, `${file} must have zero gating fails`).toBe(0);
      }
      if (gatingInvariant) {
        const gating = result.findings.filter((f) => f.status === 'fail' && f.invariant_id === gatingInvariant);
        expect(gating.length, `${file} must gate specifically on ${gatingInvariant}`).toBeGreaterThan(0);
      }
    });
  }
});

describe('replay fixture shape — fail closed (review blocker)', () => {
  it('missing transcript.observations throws (not a silent exit-0 empty run)', () => {
    expect(() => evaluateReplayFixture({ transcript: {} } as never)).toThrow(ReplayFixtureError);
    expect(() => evaluateReplayFixture({} as never)).toThrow(ReplayFixtureError);
  });

  it('a renamed observations key (shape drift) throws', () => {
    expect(() =>
      evaluateReplayFixture({ transcript: { observation: [{ step: '1', http_status: 200, body: {} }] } } as never),
    ).toThrow(ReplayFixtureError);
  });

  it('a non-array observations value throws', () => {
    expect(() =>
      evaluateReplayFixture({ transcript: { observations: 'nope' } } as never),
    ).toThrow(ReplayFixtureError);
  });

  it('an empty observations array throws (nothing to evaluate)', () => {
    expect(() => evaluateReplayFixture({ transcript: { observations: [] } } as never)).toThrow(ReplayFixtureError);
  });

  it('a well-formed fixture does NOT throw', () => {
    expect(() => evaluateReplayFixture(loadFixture('golden-journey-v1.json') as never)).not.toThrow();
  });
});
