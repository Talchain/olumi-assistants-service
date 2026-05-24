/**
 * Wiring contract: chip-click dispatch must thread `pickLatestRawRobustness`
 * through `buildProjectionInputs` and into the handler invocation so the
 * `what_would_flip` deterministic fallback composer can suppress the
 * "smaller changes are unlikely to flip" sentence on raw-fragile or
 * near-tie results.
 *
 * Mirrors the source-level wiring assertion PR #193 introduced for the
 * turn-executor → free-text gate path. A full integration harness around
 * `dispatchDeterministicChipClick` would be disproportionate to the
 * three-line wiring change under test; reading the dispatcher source and
 * asserting the literal expressions are present is the lightest test that
 * fails for the specific regression we care about (the line getting
 * deleted or refactored away).
 *
 * The composer behaviour itself is covered by the unit tests in
 * `tools/handlers/__tests__/explanation-fallback.test.ts`.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DISPATCHER_PATH = path.resolve(__dirname, '../chip-click-dispatch.ts');

describe('chip-click dispatch → what_would_flip rawRobustness wiring', () => {
  it('imports pickLatestRawRobustness from the SSOT helper module', async () => {
    const source = await readFile(DISPATCHER_PATH, 'utf-8');
    expect(source).toMatch(
      /import\s*\{[^}]*\bpickLatestRawRobustness\b[^}]*\}\s*from\s*['"]\.\.\/coaching\/pick-raw-robustness\.js['"]/,
    );
  });

  it('calls pickLatestRawRobustness on prior_facts inside buildProjectionInputs', async () => {
    const source = await readFile(DISPATCHER_PATH, 'utf-8');
    // Tolerant of whitespace / surrounding cosmetic changes; the load-
    // bearing fragment is `pickLatestRawRobustness(context.prior_facts)`.
    expect(source).toMatch(/pickLatestRawRobustness\s*\(\s*context\.prior_facts\s*\)/);
  });

  it('forwards rawRobustness into the handler invocation', async () => {
    const source = await readFile(DISPATCHER_PATH, 'utf-8');
    // The handler-invocation object literal must carry `rawRobustness`
    // sourced from the projection inputs. This is the line the chip-click
    // bug fix lives on — removing it silently regresses the path.
    expect(source).toMatch(/rawRobustness\s*:\s*projectionInputs\.rawRobustness/);
  });

  it('ProjectionInputs declares a rawRobustness field typed against the SSOT type', async () => {
    const source = await readFile(DISPATCHER_PATH, 'utf-8');
    expect(source).toMatch(/readonly\s+rawRobustness\s*:\s*RawRobustnessSignals\s*\|\s*null/);
  });
});
