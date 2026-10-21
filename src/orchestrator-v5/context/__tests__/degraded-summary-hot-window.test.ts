/**
 * Core Runtime — degraded rolling-summary continuity.
 *
 * The session read has already paid for and bounded a hot window (normally 20
 * turns). When the rolling-summary read is absent or earns zero coverage,
 * discarding rows 9..20 creates the sharpest possible memory cliff at the
 * exact moment the durable summary cannot help. These tests pin the fallback
 * to those already-fetched bytes and keep the existing whole-pack ceiling as
 * the sole budget authority.
 */

/*
 * ⚠ DELETION 8 (track2, 22 Oct 2026): `assembleContextPackWithSummary` is
 * deleted (no served caller), so the three rows that drove the pack through it
 * were dropped. What stays is the row on the LIVE executable policy.
 */

import { describe,expect,it } from 'vitest';

import { CONTEXT_PACK_RECENT_TURNS_CAP } from '../context-pack-schema.js';
import { CONTEXT_POLICY } from '../context-policy.js';

describe('degraded-summary hot-window fallback', () => {
  it('publishes the fallback in the executable context policy', () => {
    expect(CONTEXT_POLICY.coach_converse.memory_window).toMatchObject({
      verbatim_turns: CONTEXT_PACK_RECENT_TURNS_CAP,
      rolling_summary: true,
      degraded_summary_fallback: 'fetched_hot_window',
    });
  });
});
