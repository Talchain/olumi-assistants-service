import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { __runExtractionForTesting } from '../extract-quantities.js';
import { log } from '../../../../utils/telemetry.js';
import type { PatternRule } from '../rules.js';

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
    // Force P1 (range_between: the only rule that claims "between X and Y")
    // to "time out". Because P1 never runs, no mask is recorded, so the text
    // "between 5 and 10" remains intact for later rules. No later rule
    // matches the full range shape, but compromise picks up "5" and "10"
    // as bare numbers. This is evidence that the fallback path runs on the
    // original unmasked text.
    const input = 'between 5 and 10';
    const { results, summary } = __runExtractionForTesting(input, {
      forceTimeoutPatterns: new Set(['P1']),
    });

    // Gate 5 point 1: timeout emits per-pattern telemetry carrying both
    // `timeout: true` (literal brief requirement) and `pattern_id`.
    expect(warnSpy).toHaveBeenCalled();
    const forcedCalls = warnSpy.mock.calls.filter((call) => {
      const payload = call[0] as Record<string, unknown>;
      return payload.event === 'cqe.pattern_timeout' && payload.pattern_id === 'P1';
    });
    expect(forcedCalls).toHaveLength(1);
    const payload = forcedCalls[0]![0] as Record<string, unknown>;
    expect(payload.timeout).toBe(true);
    expect(payload.reason).toBe('forced_for_test');

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
    const { results, summary } = __runExtractionForTesting(input, {
      forceTimeoutPatterns: new Set(['P13']),
    });

    expect(summary.timeout).toBe(true);
    const compromiseMatch = results.find((r) => r.source === 'compromise' && r.value === 42);
    expect(compromiseMatch).toBeDefined();
  });

  it('exercises the real wall-clock branch when ruleDuration > CQE_REGEX_TIMEOUT_MS', () => {
    // Deterministic test of the physical code path `if (ruleDuration >
    // CQE_REGEX_TIMEOUT_MS) { ... }` (vs the forced-hook short-circuit in
    // the tests above). Inject a trivial no-op rule and spy performance.now
    // so the orchestrator observes a 60ms apparent duration (>50ms cap).
    const slowRule: PatternRule = {
      id: 'P_SLOW_FOR_TEST',
      priority: 1,
      apply: () => [],
    };

    // Sequence of clock reads performed by runExtractionInternal for a
    // single-rule run:
    //   [0] startedAt
    //   [1] budgetDeadline check at loop entry (startedAt + 200ms = 1200)
    //   [2] ruleStart
    //   [3] ruleEnd (60ms > 50ms cap -> triggers wall-clock branch)
    //   [4] summary.duration_ms
    const ticks = [1000, 1000, 1000, 1060, 1060];
    let callCount = 0;
    const perfSpy = vi
      .spyOn(globalThis.performance, 'now')
      .mockImplementation(() => ticks[Math.min(callCount++, ticks.length - 1)] ?? 0);

    try {
      const { summary } = __runExtractionForTesting('some text', {
        patternRules: [slowRule],
      });

      // The wall-clock branch fired once for this rule.
      const wallClockCalls = warnSpy.mock.calls.filter((call) => {
        const payload = call[0] as Record<string, unknown>;
        return (
          payload.event === 'cqe.pattern_timeout' &&
          payload.pattern_id === 'P_SLOW_FOR_TEST' &&
          payload.reason === 'wall_clock_exceeded'
        );
      });
      expect(wallClockCalls).toHaveLength(1);
      const payload = wallClockCalls[0]![0] as Record<string, unknown>;
      expect(payload.timeout).toBe(true);
      expect(payload.duration_ms).toBe(60);
      expect(payload.timeout_cap_ms).toBe(50);

      // Aggregate summary reflects the trip.
      expect(summary.timeout).toBe(true);
      expect(summary.patterns_matched).not.toContain('P_SLOW_FOR_TEST');
    } finally {
      perfSpy.mockRestore();
    }
  });

  it('forcing every rule to time out still returns a valid (possibly empty) array', () => {
    const allIds = new Set([
      'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P6b', 'P7', 'P7c',
      'P8', 'P9', 'P10', 'P11', 'P12', 'P13',
    ]);
    const { results, summary } = __runExtractionForTesting('set X to 5%', {
      forceTimeoutPatterns: allIds,
    });

    expect(summary.timeout).toBe(true);
    expect(Array.isArray(results)).toBe(true);
    // Compromise still runs on the fully unmasked text.
    // It may emit nothing for "set X to 5%" if % is too close to the digit,
    // or it may emit "5"; either outcome is valid. The invariant: no throw,
    // array returned.
  });
});
