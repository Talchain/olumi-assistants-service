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

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  evaluateReplayFixture,
  ReplayFixtureError,
} from '../../../tools/golden-journey-harness/index.js';

const HARNESS_DIR = fileURLToPath(new URL('../../../tools/golden-journey-harness/', import.meta.url));
const FIXTURE_DIR = `${HARNESS_DIR}fixtures/`;

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(`${FIXTURE_DIR}${name}`, 'utf-8'));
}

/**
 * SINGLE SOURCE OF TRUTH for the pinned fixture exit codes — the same
 * `replay-manifest.json` the advisory replay-gate script
 * (scripts/ci/golden-journey-replay-gate.sh) reads. This required unit test
 * (in-process, via `evaluateReplayFixture`) and the out-of-process CLI gate
 * therefore agree on the expected exits by construction; neither re-encodes
 * them. (The `file` field omits the `.json` extension so the shell script can
 * pass it straight to `--replay …/<file>.json`.)
 */
interface ManifestEntry {
  readonly file: string;
  readonly expected_exit: 0 | 1;
  readonly gating_invariant?: string;
}
const MANIFEST: ReadonlyArray<ManifestEntry> = (
  JSON.parse(readFileSync(`${HARNESS_DIR}replay-manifest.json`, 'utf-8')) as { fixtures: ManifestEntry[] }
).fixtures;

describe('replay-fixture manifest — expected exit codes are enforced, not just documented', () => {
  it('the shared manifest covers every committed replay fixture (no drift)', () => {
    // Guards against a fixture being added without a pinned expectation.
    const manifestFiles = new Set(MANIFEST.map((m) => m.file));
    const committed = new Set(
      readdirSync(FIXTURE_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, '')),
    );
    expect([...committed].sort(), 'every committed fixture must be pinned in replay-manifest.json').toEqual(
      [...manifestFiles].sort(),
    );
  });

  for (const { file, expected_exit: expectedExit, gating_invariant: gatingInvariant } of MANIFEST) {
    it(`${file} → replay exit ${expectedExit}${gatingInvariant ? ` (gating ${gatingInvariant})` : ''}`, () => {
      const result = evaluateReplayFixture(loadFixture(`${file}.json`) as never);
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
