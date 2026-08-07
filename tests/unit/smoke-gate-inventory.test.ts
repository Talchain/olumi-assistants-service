/**
 * F1 — smoke-gate inventory self-check (derive-don't-mirror).
 *
 * `scripts/validate-prepush.sh` runs a `SMOKE_TESTS` set through Vitest as the
 * pre-push critical-pipeline gate. Vitest SILENTLY IGNORES a path filter that
 * matches no file, so a deleted/renamed entry leaves the gate GREEN while
 * exercising fewer files than intended — this is exactly how #615 (dead V1
 * belt deletion) reduced the effective smoke set to 1 of 10 files with no
 * signal.
 *
 * This test DERIVES its expectations from the single source of truth (it parses
 * the SMOKE_TESTS array out of the shell script) rather than mirroring a
 * hand-copied list, then asserts every listed path exists on disk. A future
 * deletion therefore fails THIS test at collection time — it cannot silently
 * under-cover the gate. It is the test-side complement to the loud on-disk
 * existence check `check_smoke_tests` now performs before invoking Vitest.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', 'validate-prepush.sh');

/** Parse the `SMOKE_TESTS=( ... )` bash array out of the pre-push script. */
function parseSmokeTests(scriptText: string): string[] {
  const marker = 'SMOKE_TESTS=(';
  const occurrences = scriptText.split(marker).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Expected exactly one SMOKE_TESTS=( array in validate-prepush.sh, found ${occurrences}`,
    );
  }
  const afterOpen = scriptText.slice(scriptText.indexOf(marker) + marker.length);
  const closeIdx = afterOpen.indexOf('\n)');
  if (closeIdx === -1) {
    throw new Error('Could not find the closing ")" of the SMOKE_TESTS array');
  }
  return afterOpen
    .slice(0, closeIdx)
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim()) // strip inline bash comments
    .filter((line) => line.length > 0);
}

describe('smoke-gate inventory (scripts/validate-prepush.sh)', () => {
  const smokeTests = parseSmokeTests(readFileSync(SCRIPT_PATH, 'utf-8'));

  it('parses a non-trivial set (guards against a silent collapse to ~1 file)', () => {
    // Floor well below the intended ~9; a drop past this is a deliberate,
    // reviewed change, and catches the #615-class 10→1 collapse loudly.
    expect(smokeTests.length).toBeGreaterThanOrEqual(6);
  });

  it('every SMOKE_TESTS entry is a .test.ts path', () => {
    for (const p of smokeTests) {
      expect(p, `SMOKE_TESTS entry is not a .test.ts file: ${p}`).toMatch(/\.test\.ts$/);
    }
  });

  it('every SMOKE_TESTS entry exists on disk (Vitest would silently skip a missing one)', () => {
    const missing = smokeTests.filter((p) => !existsSync(join(REPO_ROOT, p)));
    expect(missing, `SMOKE_TESTS entries missing on disk: ${missing.join(', ')}`).toEqual([]);
  });

  it('has no duplicate entries', () => {
    const seen = new Set<string>();
    const dupes = smokeTests.filter((p) => (seen.has(p) ? true : (seen.add(p), false)));
    expect(dupes, `duplicate SMOKE_TESTS entries: ${dupes.join(', ')}`).toEqual([]);
  });
});
