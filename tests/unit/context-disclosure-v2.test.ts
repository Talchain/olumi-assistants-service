/**
 * Context Architecture v2 — "disclosure integrity" (ROADMAP 1.73).
 *
 * Design of record: docs-designs/CONTEXT-ARCHITECTURE-V2-2026-07-13/
 *   - 02 §Disclosure — (1) graph truncation gets an in-section marker AND
 *     the section header stops misreporting (post-truncation counts);
 *     (2) the pack conversation gains `{window: {shown, available}}` and
 *     per-message `truncated` flags on projected turns.
 *
 * Disclosure is now UNCONDITIONAL (the CEE_CONTEXT_DISCLOSURE_V2 flag was
 * removed). These pins assert the always-on output shape at every surface
 * that renders it, and lock the LIVE correctness fix: the edit-lane graph
 * header must report what is actually in the JSON below it, never the
 * pre-truncation counts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as telemetry from '../../src/utils/telemetry.js';
import { TelemetryEvents } from '../../src/utils/telemetry.js';
import {
  projectConversation,
  PERSISTED_MESSAGE_CAP,
  CONTEXT_PACK_RECENT_TURNS_CAP,
} from '../../src/orchestrator-v5/context/context-pack-assembler.js';
import type { SessionTurnWithContent } from '../../src/orchestrator-v5/session/conversation-content.js';
import { ContextPackSchema } from '../../src/orchestrator-v5/context/context-pack-schema.js';
import { CONVERSATION_TEXT_CAP } from '../../src/orchestrator-v5/commit.js';

let emitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  emitSpy = vi.spyOn(telemetry, 'emit');
});

afterEach(() => {
  vi.restoreAllMocks();
});

function turnFixture(i: number, userMessage?: string): SessionTurnWithContent {
  return {
    id: `row_${i}`,
    scenario_id: 'scenario_fixture',
    user_id: null,
    turn_id: `turn_${i}`,
    turn_class: 'handler',
    handler_id: 'run_analysis',
    request_hash: 'sha256:test',
    response_emitted: true,
    llm_calls_used: 0,
    duration_ms: 0,
    created_at: new Date(2026, 0, 1, 0, i).toISOString(),
    user_message: userMessage ?? `question ${i}`,
    assistant_message: `answer ${i}`,
  };
}

// ---------------------------------------------------------------------------
// Window + per-turn disclosure (projectConversation) — UNCONDITIONAL
// ---------------------------------------------------------------------------

describe('window disclosure (projectConversation) — always on', () => {
  it('default (no opts): conversation gains {window: {shown, available}}', () => {
    const turns = Array.from({ length: 9 }, (_, i) => turnFixture(i));
    const projected = projectConversation(turns, false);
    // Numbers asserted by name: the window also carries an additive
    // `notice` (the code-owned in-band disclosure) whenever turns exist
    // that the projection does not show. No `totalStored` is passed here,
    // so the counts stay the window's own length.
    expect(projected.window?.shown).toBe(CONTEXT_PACK_RECENT_TURNS_CAP);
    expect(projected.window?.available).toBe(9);
    expect(projected.window?.notice).toContain('INCOMPLETE');

    const cuts = emitSpy.mock.calls
      .filter((c: readonly unknown[]) => c[0] === TelemetryEvents.V5ContextTruncation)
      .map((c: readonly unknown[]) => c[1] as Record<string, unknown>);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].disclosed).toBe(true);
  });

  it('a window that fits (<= cap) still discloses shown === available', () => {
    const turns = Array.from({ length: 3 }, (_, i) => turnFixture(i));
    const projected = projectConversation(turns, false);
    // A conversation that fits shows everything, so there is nothing to
    // disclose — the notice key must be ABSENT, not an empty string.
    expect(projected.window).toEqual({ shown: 3, available: 3 });
    // No overflow → no window_slice cut event.
    const cuts = emitSpy.mock.calls.filter(
      (c: readonly unknown[]) => c[0] === TelemetryEvents.V5ContextTruncation,
    );
    expect(cuts).toHaveLength(0);
  });

  it('default (no opts): a projected turn whose message sits AT the persistence cap is flagged truncated', () => {
    const atCap = 'q'.repeat(PERSISTED_MESSAGE_CAP);
    const turns = [turnFixture(0, atCap), turnFixture(1)];
    const projected = projectConversation(turns, false);
    expect(projected.recent_turns[0].truncated).toBe(true);
    // Turns under the cap carry NO truncated key (never a noisy false).
    expect('truncated' in projected.recent_turns[1]).toBe(false);
  });

  it('PERSISTED_MESSAGE_CAP mirrors commit.ts CONVERSATION_TEXT_CAP (drift pin)', () => {
    expect(PERSISTED_MESSAGE_CAP).toBe(CONVERSATION_TEXT_CAP);
  });

  it('a disclosing conversation still validates against the strict ContextPack schema', () => {
    const turns = Array.from({ length: 9 }, (_, i) => turnFixture(i, 'q'.repeat(PERSISTED_MESSAGE_CAP)));
    const projected = projectConversation(turns, false);
    const parsed = ContextPackSchema.shape.conversation.safeParse(projected);
    expect(parsed.success).toBe(true);
    // .strict() must not silently strip the disclosure fields.
    if (parsed.success) {
      const window = (parsed.data as { window?: Record<string, unknown> }).window;
      expect(window?.shown).toBe(CONTEXT_PACK_RECENT_TURNS_CAP);
      expect(window?.available).toBe(9);
      // .strict() must not strip the disclosure STRING either.
      expect(typeof window?.notice).toBe('string');
    }
  });
});
