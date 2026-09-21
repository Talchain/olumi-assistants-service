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
  failingInvariantSet,
  ReplayFixtureError,
} from '../../../tools/golden-journey-harness/index.js';
import {
  ADVISORY_INVARIANTS,
  INVARIANT_TITLE,
  type InvariantId,
} from '../../../tools/golden-journey-harness/components.js';

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
  /**
   * The exact sorted set of invariant IDs with status 'fail' (gating AND
   * advisory). Optional per entry (absent = exit-code-only pinning, byte-for-
   * byte legacy behaviour). Closes the mixed-invariant masking hole: on a RED
   * fixture that fails A8+A10+A11, an A10/A11 classifier that silently stops
   * failing keeps exit=1 (via A8) and is invisible to the exit code alone.
   * Values are CAPTURED via --json-summary, never hand-authored.
   */
  readonly expected_failing_invariants?: readonly string[];
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

  for (const {
    file,
    expected_exit: expectedExit,
    gating_invariant: gatingInvariant,
    expected_failing_invariants: expectedFailing,
  } of MANIFEST) {
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
      if (expectedFailing !== undefined) {
        expect(
          failingInvariantSet(result.findings),
          `${file}: pinned failing-invariant set diverged. A pinned invariant that STOPPED failing means a ` +
            `classifier silently regressed (exit-code-only pinning would have stayed green); a NEW failing ` +
            `invariant means the fixture surfaced a new defect. Re-capture with --json-summary and update ` +
            `replay-manifest.json deliberately (same PR, diff explained).`,
        ).toEqual([...expectedFailing].sort());
      }
    });
  }
});

describe('replay-manifest integrity — the gate must be provably able to fail', () => {
  it('the pinned fixture population does not shrink below the known floor', () => {
    // 6 = today's committed population. Shrinking the manifest (deleting
    // fixtures + their pins together) would otherwise pass every per-fixture
    // assertion while measuring less and less.
    expect(MANIFEST.length, 'manifest lost fixtures — shrinking the pinned population needs review').toBeGreaterThanOrEqual(6);
  });

  it('at least one fixture is pinned RED (expected_exit=1)', () => {
    // A gate whose fixtures are all-green proves nothing about its ability
    // to detect a defect.
    expect(
      MANIFEST.some((m) => m.expected_exit === 1),
      'no pinned-RED fixture left — an all-green manifest measures nothing',
    ).toBe(true);
  });

  it('every pinned invariant ID is a real invariant (typo guard)', () => {
    const known = new Set(Object.keys(INVARIANT_TITLE));
    for (const m of MANIFEST) {
      for (const id of m.expected_failing_invariants ?? []) {
        expect(known.has(id), `${m.file}: unknown invariant id '${id}' in expected_failing_invariants`).toBe(true);
      }
      if (m.gating_invariant) {
        expect(known.has(m.gating_invariant), `${m.file}: unknown gating_invariant '${m.gating_invariant}'`).toBe(true);
      }
    }
  });

  it('every pinned-RED entry with a pinned set contains at least one GATING (non-advisory) invariant', () => {
    // Internal consistency: exit=1 requires a gating fail, so a pinned set
    // of only advisory IDs contradicts the pinned exit.
    for (const m of MANIFEST) {
      if (m.expected_exit !== 1 || m.expected_failing_invariants === undefined) continue;
      const hasGating = m.expected_failing_invariants.some(
        (id) => !ADVISORY_INVARIANTS.has(id as InvariantId),
      );
      expect(hasGating, `${m.file}: expected_exit=1 but pinned set has no gating invariant`).toBe(true);
    }
  });
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
