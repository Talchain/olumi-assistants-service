/**
 * V5 Coaching State Spine — Stage 2B-1b: coaching-state snapshot envelope tests.
 * Covers wrap/parse round-trip, defensive parsing (malformed → null), and the
 * content-free (machine-safe) persistence guarantee.
 */

import { describe, it, expect } from 'vitest';

import { EMPTY_COACHING_STATE, type CoachingState } from '../coaching-state.js';
import {
  toPreDispatchSnapshot,
  parseCoachingStateSnapshot,
  COACHING_STATE_SNAPSHOT_TIMING_PRE_DISPATCH,
} from '../coaching-state-snapshot.js';

const ACTIVE_STATE: CoachingState = {
  version: 'v1',
  status: 'active',
  graph_hash: 'h_now',
  analysis_graph_hash: 'h_run',
  signals: [
    {
      signal_id: 'analysis_stale:graph_hash_diverged',
      kind: 'analysis_stale',
      status: 'active',
      source: 'analysis_freshness',
      graph_hash: 'h_now',
      analysis_graph_hash: 'h_run',
      reason_code: 'graph_hash_diverged',
      created_from: 'derived_current_turn',
    },
  ],
  summary: { active_count: 1, stale_count: 0, unavailable_count: 0 },
};

describe('coaching-state-snapshot — toPreDispatchSnapshot', () => {
  it('wraps with snapshot_timing=pre_dispatch + version, preserving the state', () => {
    const snap = toPreDispatchSnapshot(ACTIVE_STATE);
    expect(snap.snapshot_timing).toBe(COACHING_STATE_SNAPSHOT_TIMING_PRE_DISPATCH);
    expect(snap.snapshot_timing).toBe('pre_dispatch');
    expect(snap.coaching_state_version).toBe('v1');
    expect(snap.coaching_state).toEqual(ACTIVE_STATE);
  });

  it('persisted JSON contains ONLY machine-safe fields — no raw content', () => {
    const serialised = JSON.stringify(toPreDispatchSnapshot(ACTIVE_STATE));
    const allowedKeys = new Set([
      'snapshot_timing', 'coaching_state_version', 'coaching_state',
      'version', 'status', 'graph_hash', 'analysis_graph_hash', 'signals', 'summary',
      'signal_id', 'kind', 'source', 'reason_code', 'created_from',
      'active_count', 'stale_count', 'unavailable_count',
    ]);
    const assertKeysAllowed = (v: unknown): void => {
      if (Array.isArray(v)) { v.forEach(assertKeysAllowed); return; }
      if (v !== null && typeof v === 'object') {
        for (const k of Object.keys(v as object)) {
          expect(allowedKeys.has(k)).toBe(true);
          assertKeysAllowed((v as Record<string, unknown>)[k]);
        }
      }
    };
    assertKeysAllowed(JSON.parse(serialised));
    // Spot-check: no raw-decision-content vocabulary leaks into the JSONB.
    for (const banned of ['brief', 'label', 'description', 'monetary', 'timeline', 'node_id']) {
      expect(serialised.toLowerCase()).not.toContain(banned);
    }
  });
});

describe('coaching-state-snapshot — parseCoachingStateSnapshot', () => {
  it('round-trips a valid wrapped snapshot (through JSON)', () => {
    const snap = toPreDispatchSnapshot(ACTIVE_STATE);
    const parsed = parseCoachingStateSnapshot(JSON.parse(JSON.stringify(snap)));
    expect(parsed).not.toBeNull();
    expect(parsed!.snapshot_timing).toBe('pre_dispatch');
    expect(parsed!.coaching_state_version).toBe('v1');
    expect(parsed!.coaching_state.status).toBe('active');
    expect(parsed!.coaching_state.signals).toHaveLength(1);
  });

  it('parses an EMPTY snapshot', () => {
    const parsed = parseCoachingStateSnapshot(toPreDispatchSnapshot(EMPTY_COACHING_STATE));
    expect(parsed?.coaching_state.status).toBe('empty');
  });

  it('returns null for malformed / drifted shapes (never throws)', () => {
    expect(parseCoachingStateSnapshot(null)).toBeNull();
    expect(parseCoachingStateSnapshot('nope')).toBeNull();
    expect(parseCoachingStateSnapshot(42)).toBeNull();
    expect(parseCoachingStateSnapshot([])).toBeNull();
    expect(parseCoachingStateSnapshot({})).toBeNull();
    // wrong timing (e.g. a future post-dispatch snapshot) → rejected
    expect(
      parseCoachingStateSnapshot({
        snapshot_timing: 'post_dispatch',
        coaching_state_version: 'v1',
        coaching_state: ACTIVE_STATE,
      }),
    ).toBeNull();
    // missing version
    expect(
      parseCoachingStateSnapshot({ snapshot_timing: 'pre_dispatch', coaching_state: ACTIVE_STATE }),
    ).toBeNull();
    // inner state not Stage-2A-shaped
    expect(
      parseCoachingStateSnapshot({
        snapshot_timing: 'pre_dispatch',
        coaching_state_version: 'v1',
        coaching_state: { status: 'active' },
      }),
    ).toBeNull();
    // inner state null / bad status / non-array signals
    expect(
      parseCoachingStateSnapshot({
        snapshot_timing: 'pre_dispatch',
        coaching_state_version: 'v1',
        coaching_state: null,
      }),
    ).toBeNull();
    expect(
      parseCoachingStateSnapshot({
        snapshot_timing: 'pre_dispatch',
        coaching_state_version: 'v1',
        coaching_state: { version: 'v1', status: 'nope', signals: [], summary: {} },
      }),
    ).toBeNull();
  });
});
