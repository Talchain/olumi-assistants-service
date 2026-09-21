/**
 * Executable negative-control for the per-invariant manifest pinning (#332).
 *
 * The pinning's whole value is that it catches a class of regression the
 * exit-code-only check is BLIND to: on a mixed-invariant RED fixture
 * (golden-journey-v1-defects fails gating A8 + advisory A10 + advisory A11),
 * an advisory classifier that silently stops firing keeps the exit code at 1
 * (via A8) — so exit-code pinning stays green while the gate measures less.
 *
 * That proof previously existed only as prose in
 * `Docs/golden-journey/replay-gate-promotion-readiness.md` and as a throwaway
 * test deleted after the run. This file makes it PERMANENT and executable:
 * it simulates the silent A11 regression and asserts BOTH halves of the
 * divergence in one green test —
 *   1. exit code is UNCHANGED (still 1) → exit-code-only pinning is blind;
 *   2. the failing-invariant SET drops A11 → it no longer equals the manifest
 *      pin, so the set-pin assertion in `replay-fixtures.test.ts` WOULD fail.
 *
 * If a future change made the two checks equivalent (e.g. A11 became gating,
 * or the defects fixture stopped mixing advisory + gating invariants), this
 * test goes red — a signal that the masking scenario it guards no longer
 * holds and the promotion-readiness claim needs re-deriving.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

// Drop A11 findings to simulate a silently-regressed advisory classifier.
vi.mock('../../../tools/golden-journey-harness/invariants.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../tools/golden-journey-harness/invariants.js')>();
  return {
    ...real,
    evaluateJourney: (...args: Parameters<typeof real.evaluateJourney>) => {
      const r = real.evaluateJourney(...args);
      return { ...r, findings: r.findings.filter((f) => f.invariant_id !== 'A11') };
    },
  };
});

// Import AFTER the mock so index.js binds the mocked evaluateJourney.
const { evaluateReplayFixture, failingInvariantSet } = await import(
  '../../../tools/golden-journey-harness/index.js'
);
// The classification source of truth — not mocked, so this asserts the REAL
// advisory/gating split rather than a comment's claim about it.
const { ADVISORY_INVARIANTS } = await import(
  '../../../tools/golden-journey-harness/components.js'
);

const HARNESS_DIR = fileURLToPath(new URL('../../../tools/golden-journey-harness/', import.meta.url));
const DEFECTS = JSON.parse(
  readFileSync(`${HARNESS_DIR}fixtures/golden-journey-v1-defects.json`, 'utf-8'),
);

/** The set the manifest pins for the defects fixture — read, not hardcoded. */
const PINNED_DEFECTS_SET: readonly string[] = (() => {
  const manifest = JSON.parse(readFileSync(`${HARNESS_DIR}replay-manifest.json`, 'utf-8')) as {
    fixtures: ReadonlyArray<{ file: string; expected_failing_invariants?: readonly string[] }>;
  };
  const entry = manifest.fixtures.find((f) => f.file === 'golden-journey-v1-defects');
  if (!entry?.expected_failing_invariants) {
    throw new Error('defects fixture must carry a pinned expected_failing_invariants set');
  }
  return [...entry.expected_failing_invariants].sort();
})();

describe('masking negative-control: exit-code pinning is blind to a silent advisory regression', () => {
  it('the pinned defects set genuinely mixes a gating and an advisory invariant (else the masking scenario is moot)', () => {
    // The masking hole exists only because one fixture fails BOTH a gating and
    // an advisory invariant. Assert the CLASSIFICATION against the real
    // ADVISORY_INVARIANTS set — so this precondition is self-invalidating: if
    // A11 ever became gating, or A8 advisory, this goes red and the whole
    // negative-control (and the promotion-readiness claim it backs) is flagged
    // for re-derivation rather than silently asserting a stale premise.
    expect(PINNED_DEFECTS_SET).toContain('A8');
    expect(PINNED_DEFECTS_SET).toContain('A11');
    expect(ADVISORY_INVARIANTS.has('A8'), 'A8 must stay GATING (drives exit=1)').toBe(false);
    expect(ADVISORY_INVARIANTS.has('A11'), 'A11 must stay ADVISORY (does not drive exit)').toBe(true);
  });

  it('with A11 silently regressed: exit code STAYS 1 (exit-code-only pinning does not catch it)', () => {
    const result = evaluateReplayFixture(DEFECTS as never);
    expect(result.exitCode, 'gating A8 still fails, so the exit code is unchanged').toBe(1);
    expect(result.gatingFails).toBeGreaterThan(0);
  });

  it('with A11 silently regressed: the failing-invariant SET diverges from the pin (the set-pin DOES catch it)', () => {
    const result = evaluateReplayFixture(DEFECTS as never);
    const actual = failingInvariantSet(result.findings);
    expect(actual, 'A11 must have dropped out under the simulated regression').not.toContain('A11');
    expect(
      actual,
      'the set-pin assertion in replay-fixtures.test.ts compares exactly this set to the manifest pin — divergence is the catch',
    ).not.toEqual(PINNED_DEFECTS_SET);
    // Concretely: pin is [A10, A11, A8]; the regressed run yields [A10, A8].
    expect(actual).toEqual(PINNED_DEFECTS_SET.filter((id) => id !== 'A11'));
  });
});
