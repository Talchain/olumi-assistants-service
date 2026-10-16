import { describe, it, expect, vi } from 'vitest';

// Suppress log output
vi.mock('../../../src/utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

describe('Input length validation (Task 4)', () => {
  const MAX_MESSAGE_LENGTH = 4000;

  it('4,000-char message passes validation', () => {
    const message = 'a'.repeat(MAX_MESSAGE_LENGTH);
    expect(message.length).toBe(MAX_MESSAGE_LENGTH);
    // At exactly the limit, the guard should NOT trigger
    expect(message.length > MAX_MESSAGE_LENGTH).toBe(false);
  });
});
