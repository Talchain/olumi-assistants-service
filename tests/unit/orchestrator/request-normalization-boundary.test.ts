/**
 * warnAnalysisStateOnNonAnalysisTurn — boundary warning downgrade test
 */

import { describe, it, expect, vi } from "vitest";
import { warnAnalysisStateOnNonAnalysisTurn } from "../../../src/orchestrator/request-normalization.js";

// Mock isProduction to return false (non-prod)
vi.mock("../../../src/config/index.js", () => ({
  isProduction: () => false,
}));

// Capture log calls
const warnSpy = vi.fn();
const debugSpy = vi.fn();
vi.mock("../../../src/utils/telemetry.js", () => ({
  log: {
    warn: (...args: unknown[]) => warnSpy(...args),
    debug: (...args: unknown[]) => debugSpy(...args),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('warnAnalysisStateOnNonAnalysisTurn — downgraded to debug', () => {
  it('does not emit warn-level log for conversation turn with analysis_state', () => {
    warnSpy.mockClear();
    debugSpy.mockClear();

    warnAnalysisStateOnNonAnalysisTurn(
      { analysis_state: { analysis_status: 'completed', results: [] } },
      'req-123',
    );

    // Should NOT call log.warn
    expect(warnSpy).not.toHaveBeenCalled();
    // Should call log.debug instead
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy.mock.calls[0][1]).toContain('analysis_state present on');
  });

  it('does not log anything when analysis_state is absent', () => {
    warnSpy.mockClear();
    debugSpy.mockClear();

    warnAnalysisStateOnNonAnalysisTurn({}, 'req-456');

    expect(warnSpy).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();
  });
});
