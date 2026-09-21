import { afterEach, describe, expect, it, vi } from 'vitest';

const { incrementMock } = vi.hoisted(() => ({
  incrementMock: vi.fn(),
}));

vi.mock('hot-shots', () => ({
  StatsD: class StatsDMock {
    increment = incrementMock;
    gauge = vi.fn();
    histogram = vi.fn();
  },
}));

describe('claim-safety unavailable Datadog mapping', () => {
  afterEach(() => {
    incrementMock.mockReset();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('increments the real registry-backed counter with only bounded egress tags', async () => {
    vi.stubEnv('DD_AGENT_HOST', '127.0.0.1');
    const { emit, TelemetryEvents } = await import('../../src/utils/telemetry.js');

    emit(TelemetryEvents.V5ClaimSafetyFailClosedUnavailable, {
      exit_path: 'turn_executor',
      outcome: 'substantive_replaced',
    });

    expect(incrementMock).toHaveBeenCalledTimes(1);
    expect(incrementMock).toHaveBeenCalledWith(
      'v5.claim_safety.fail_closed_unavailable_total',
      1,
      {
        exit_path: 'turn_executor',
        outcome: 'substantive_replaced',
      },
    );
  });
});
