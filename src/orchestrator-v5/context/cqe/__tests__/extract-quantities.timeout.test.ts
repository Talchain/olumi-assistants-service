import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { runExtraction } from '../extract-quantities.js';
import { log } from '../../../../utils/telemetry.js';

// Dedicated timeout-behaviour test per brief §6 Gate 5. Uses the internal
// __testForceTimeoutPatterns hook to simulate a pattern exceeding its
// wall-clock budget without needing an actual slow regex, so the test is
// deterministic and isolated from production rule performance.

describe('CQE timeout behaviour (brief §6 Gate 5)', () => {
  let warnSpy: Mock;

  beforeEach(() => {
    warnSpy = vi.fn();
    vi.spyOn(log, 'warn').mockImplementation(warnSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits pattern_id on timeout and preserves no-mask fallback for later rules', () => {
    // Force P1 (range_between — the only rule that claims "between X and Y")
    // to "time out". Because P1 never runs, no mask is recorded, so the text
    // "between 5 and 10" remains intact for later rules. No later rule
    // matches the full range shape, but compromise picks up "5" and "10"
    // as bare numbers — evidence that the fallback path runs on the
    // original unmasked text.
    const input = 'between 5 and 10';
    const { results, summary } = runExtraction(input, {
      __testForceTimeoutPatterns: new Set(['P1']),
    });

    // Gate 5 point 1: timeout emits per-pattern telemetry with pattern_id.
    expect(warnSpy).toHaveBeenCalled();
    const forcedCalls = warnSpy.mock.calls.filter((call) => {
      const payload = call[0] as Record<string, unknown>;
      return payload.event === 'cqe.pattern_timeout' && payload.pattern_id === 'P1';
    });
    expect(forcedCalls).toHaveLength(1);
    expect((forcedCalls[0]![0] as Record<string, unknown>).reason).toBe(
      'forced_for_test',
    );

    // Gate 5 points 2 + 3: no partial spans from P1, later rules (and
    // ultimately compromise) see the original unmasked text.
    expect(summary.timeout).toBe(true);
    expect(summary.patterns_matched).not.toContain('P1');

    // Gate 5 point 5: global return is not []; compromise fills the gap.
    expect(results.length).toBeGreaterThan(0);
    const compromiseValues = results
      .filter((r) => r.source === 'compromise')
      .map((r) => r.value);
    expect(compromiseValues).toContain(5);
    expect(compromiseValues).toContain(10);
  });

  it('compromise backstop still runs on unmasked remainder after a pattern times out', () => {
    // Force P13 (percentage_points) out. The message contains a plain
    // number that compromise should still pick up.
    const input = 'the forecast is 42';
    const { results, summary } = runExtraction(input, {
      __testForceTimeoutPatterns: new Set(['P13']),
    });

    expect(summary.timeout).toBe(true);
    const compromiseMatch = results.find((r) => r.source === 'compromise' && r.value === 42);
    expect(compromiseMatch).toBeDefined();
  });

  it('forcing every rule to time out still returns a valid (possibly empty) array', () => {
    const allIds = new Set([
      'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P6b', 'P7', 'P7c',
      'P8', 'P9', 'P10', 'P11', 'P12', 'P13',
    ]);
    const { results, summary } = runExtraction('set X to 5%', {
      __testForceTimeoutPatterns: allIds,
    });

    expect(summary.timeout).toBe(true);
    expect(Array.isArray(results)).toBe(true);
    // Compromise still runs on the fully unmasked text.
    // It may emit nothing for "set X to 5%" if % is too close to the digit,
    // or it may emit "5"; either outcome is valid. The invariant: no throw,
    // array returned.
  });
});
