/**
 * `prompt.store.jsonb_column_degraded` → Datadog counter mapping.
 *
 * WHY THIS EXISTS AS ITS OWN GUARD. When a prompt-store JSONB list column
 * cannot be established as a list, the store SUBSTITUTES `[]`. That substituted
 * value is byte-identical to a genuinely empty column at every consumer — the
 * published `PromptVersion` type has no channel for "unknown" — so this counter
 * and the accompanying ERROR log are the ONLY things that can ever say the
 * degradation happened.
 *
 * An unguarded `case` arm in the `emit()` switch is exactly the kind of code a
 * tidy-up deletes with nothing going red, and its deletion would be silent:
 * `emit()` would still fire, the log would still be written, and the metric ops
 * alert on would simply stop existing. So the mapping is pinned by identity —
 * exact metric name, exact tag set — not by "some metric was incremented".
 */

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

describe('prompt.store.jsonb_column_degraded — Datadog mapping', () => {
  afterEach(() => {
    incrementMock.mockReset();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('increments the registry-backed counter with only BOUNDED tags', async () => {
    vi.stubEnv('DD_AGENT_HOST', '127.0.0.1');
    const { emit, TelemetryEvents } = await import('../../src/utils/telemetry.js');

    emit(TelemetryEvents.PromptStoreJsonColumnDegraded, {
      column: 'test_cases',
      prompt_id: 'prompt-draft-graph',
      version: 7,
      reason: 'jsonb_not_array',
      value_type: 'object',
      outcome: 'unavailable',
    });

    expect(incrementMock).toHaveBeenCalledTimes(1);
    // Bind by IDENTITY: the exact metric name and the EXACT tag object.
    // `toHaveBeenCalledWith` on the whole object is deliberate — it fails if a
    // future edit adds `prompt_id` or `version` as a tag, which are unbounded
    // and would blow up Datadog cardinality. They belong in the log line, which
    // carries them, not in the metric.
    expect(incrementMock).toHaveBeenCalledWith(
      'prompt.store.jsonb_column_degraded_total',
      1,
      { column: 'test_cases', reason: 'jsonb_not_array' },
    );
  });

  it('carries the reason tag through for the OTHER fault class', async () => {
    vi.stubEnv('DD_AGENT_HOST', '127.0.0.1');
    const { emit, TelemetryEvents } = await import('../../src/utils/telemetry.js');

    emit(TelemetryEvents.PromptStoreJsonColumnDegraded, {
      column: 'variables',
      reason: 'jsonb_unparseable',
      outcome: 'unavailable',
    });

    // The whole point of the tag split: "the column is not a list" (data drift
    // in the row) and "the string is not JSON" (a bad write) are different
    // faults with the same consequence, and they have different remedies. A
    // counter that collapsed them would be one number answering two questions.
    expect(incrementMock).toHaveBeenCalledWith(
      'prompt.store.jsonb_column_degraded_total',
      1,
      { column: 'variables', reason: 'jsonb_unparseable' },
    );
  });

  /**
   * POSITIVE CONTROL for the mock itself. If `hot-shots` were not actually
   * intercepted, or the Datadog client never initialised, `incrementMock` would
   * read zero for EVERY event and both assertions above would be failing for a
   * reason that has nothing to do with the mapping under test. Prove the probe
   * can see a DIFFERENT, long-standing mapping first.
   */
  it('positive control: the mock observes an unrelated, pre-existing mapping', async () => {
    vi.stubEnv('DD_AGENT_HOST', '127.0.0.1');
    const { emit, TelemetryEvents } = await import('../../src/utils/telemetry.js');

    emit(TelemetryEvents.PromptStoreError, { operation: 'initialize', error: 'boom' });

    expect(incrementMock).toHaveBeenCalledWith(
      'prompt.store.error',
      1,
      { operation: 'initialize', error: 'boom' },
    );
  });

  /**
   * CONTRAST CONTROL. An arm that fired for everything would satisfy the tests
   * above while telling ops nothing. Prove the switch DISCRIMINATES: an event
   * with no arm must increment nothing.
   */
  it('contrast control: an event with no Datadog arm increments nothing', async () => {
    vi.stubEnv('DD_AGENT_HOST', '127.0.0.1');
    const { emit, TelemetryEvents } = await import('../../src/utils/telemetry.js');

    // The sibling degradation event this one was modelled on has no arm.
    emit(TelemetryEvents.PendingActionsReadDegraded, {
      scenario_id: 's-1',
      reason: 'jsonb_not_array',
    });

    expect(incrementMock).not.toHaveBeenCalled();
  });
});
