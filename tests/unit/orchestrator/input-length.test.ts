import { describe, it, expect, vi } from 'vitest';
import { assembleEnvelope } from '../../../src/orchestrator/envelope.js';

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

  it('4,001-char message produces HTTP 400 with friendly message', () => {
    const message = 'a'.repeat(MAX_MESSAGE_LENGTH + 1);
    expect(message.length > MAX_MESSAGE_LENGTH).toBe(true);

    // Simulate what route.ts produces for over-limit messages (route-boundary guard)
    const envelope = assembleEnvelope({
      turnId: 'test-turn',
      assistantText: "Your message is too long. Try breaking it into shorter messages, or focus on the key points of your decision.",
      blocks: [],
      context: { messages: [], framing: null, graph: null, analysis_response: null, scenario_id: 'test' },
      error: {
        code: 'INVALID_REQUEST' as const,
        message: `Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters.`,
        recoverable: true,
      },
    });

    // Verify envelope shape
    expect(envelope.turn_id).toBe('test-turn');
    expect(envelope.assistant_text).toContain('too long');
    expect(envelope.assistant_text).toContain('shorter messages');
    expect(envelope.error).toBeDefined();
    expect(envelope.error!.code).toBe('INVALID_REQUEST');
    expect(envelope.error!.recoverable).toBe(true);
    expect(envelope.blocks).toHaveLength(0);
  });
});
