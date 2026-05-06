/**
 * Atomic-emit contract tests for `derivePendingActionsFromChips`.
 *
 * Contract under test (from the V5 interaction-recovery brief
 * "Atomic offer creation is non-negotiable"):
 *
 *   For every SuggestedAction whose action_type is in
 *   RESUMABLE_ACTION_TYPES, exactly one PendingAction is produced
 *   with matching chip_id and a kind-appropriate action payload.
 *
 *   For every SuggestedAction whose action_type is absent or outside
 *   the resumable set, zero PendingActions are produced.
 *
 *   The cap PENDING_ACTIONS_PER_TURN_CAP is enforced; chips beyond it
 *   are silently dropped from the pending list (chips themselves still
 *   surface to the user; only the resumable record is omitted).
 *
 * The downstream guarantee — "chips and pending actions are persisted
 * atomically" — is enforced in commit.ts (single append_turn_atomic
 * call). This file only asserts the projection invariants.
 */

import { describe, expect, it } from 'vitest';

import { derivePendingActionsFromChips } from '../derive-pending-actions.js';
import {
  PENDING_ACTIONS_PER_TURN_CAP,
  RESUMABLE_ACTION_TYPES,
} from '../../session/pending-action.js';
import type { SuggestedAction } from '../types.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW_ISO = '2026-05-05T12:00:00.000Z';

function ctx() {
  return { scenario_id: SCENARIO_ID, emitted_at_iso: NOW_ISO };
}

function chip(overrides: Partial<SuggestedAction> & { id: string; label: string; message: string }): SuggestedAction {
  return { intent: 'primary', ...overrides } as unknown as SuggestedAction;
}

describe('derivePendingActionsFromChips — atomic-emit contract', () => {
  it('returns exactly one PendingAction per resumable chip', () => {
    const chips: SuggestedAction[] = [
      chip({ id: 'c1', label: 'Run analysis', message: 'Run the analysis', action_type: 'run_analysis' }),
    ];
    const out = derivePendingActionsFromChips(chips, ctx());
    expect(out).toHaveLength(1);
    expect(out[0]?.chip_id).toBe('c1');
    expect(out[0]?.action.kind).toBe('run_analysis');
    expect(out[0]?.scenario_id).toBe(SCENARIO_ID);
    expect(out[0]?.emitted_at_iso).toBe(NOW_ISO);
  });

  it('emits zero PendingActions for chips without action_type', () => {
    const chips: SuggestedAction[] = [
      chip({ id: 'c1', label: 'Tell me more', message: 'Tell me more about this' }),
      chip({ id: 'c2', label: 'How do you decide?', message: 'How do you decide?' }),
    ];
    expect(derivePendingActionsFromChips(chips, ctx())).toEqual([]);
  });

  it('emits zero PendingActions for chips whose action_type is outside the resumable set', () => {
    // The boundary Action enum permits action_types that the resumable
    // set does not (e.g. add_constraint, adjust_edge_strength,
    // explain_result). These must round-trip as natural-language
    // submissions, not as resumable pending actions.
    const chips: SuggestedAction[] = [
      chip({ id: 'c1', label: 'Add constraint', message: 'Add a constraint', action_type: 'add_constraint' }),
      chip({ id: 'c2', label: 'Adjust edge', message: 'Adjust an edge', action_type: 'adjust_edge_strength' }),
    ];
    expect(derivePendingActionsFromChips(chips, ctx())).toEqual([]);
  });

  it('produces a PendingAction with chip_id matching every resumable chip', () => {
    const chips: SuggestedAction[] = [
      chip({ id: 'rc1', label: 'Re-run analysis', message: 'Re-run the analysis', action_type: 'run_analysis' }),
      chip({ id: 'cc2', label: 'Add a risk', message: 'Add a risk', action_type: 'add_constraint' }),
      chip({ id: 'rc3', label: 'Run analysis', message: 'Run the analysis', action_type: 'run_analysis' }),
    ];
    const out = derivePendingActionsFromChips(chips, ctx());
    const expectedResumable = chips.filter((c) =>
      c.action_type !== undefined && RESUMABLE_ACTION_TYPES.has(c.action_type as never),
    );
    expect(out).toHaveLength(expectedResumable.length);
    expect(out.map((p) => p.chip_id).sort()).toEqual(['rc1', 'rc3']);
  });

  it('caps the pending-action list at PENDING_ACTIONS_PER_TURN_CAP', () => {
    const chips: SuggestedAction[] = Array.from({ length: PENDING_ACTIONS_PER_TURN_CAP + 2 }, (_, i) =>
      chip({ id: `c${i}`, label: `Chip ${i}`, message: 'Run', action_type: 'run_analysis' }),
    );
    const out = derivePendingActionsFromChips(chips, ctx());
    expect(out).toHaveLength(PENDING_ACTIONS_PER_TURN_CAP);
    expect(out.map((p) => p.chip_id)).toEqual(
      Array.from({ length: PENDING_ACTIONS_PER_TURN_CAP }, (_, i) => `c${i}`),
    );
  });

  it('threads the supplied graph_hash into preconditions for hash-sensitive kinds', () => {
    // run_analysis is freshness-driven, not hash-driven; preconditions
    // are empty for it. The hash is plumbed into the call but does not
    // appear on a run_analysis pending action.
    const chips: SuggestedAction[] = [
      chip({ id: 'c1', label: 'Run', message: 'Run', action_type: 'run_analysis' }),
    ];
    const out = derivePendingActionsFromChips(chips, { ...ctx(), graph_hash: 'sha256:abc' });
    expect(out[0]?.preconditions.graph_hash).toBeUndefined();
  });

  it('expires_at_iso is wall_ttl_ms after emitted_at_iso (default)', () => {
    const chips: SuggestedAction[] = [
      chip({ id: 'c1', label: 'Run', message: 'Run', action_type: 'run_analysis' }),
    ];
    const out = derivePendingActionsFromChips(chips, ctx());
    const emittedMs = Date.parse(NOW_ISO);
    const expiresMs = Date.parse(out[0]!.expires_at_iso);
    expect(expiresMs - emittedMs).toBeGreaterThan(0);
    // 10-minute default TTL = 600_000ms.
    expect(expiresMs - emittedMs).toBe(10 * 60 * 1000);
  });

  it('produces unique PendingAction ids per chip', () => {
    const chips: SuggestedAction[] = [
      chip({ id: 'c1', label: 'Run', message: 'Run', action_type: 'run_analysis' }),
      chip({ id: 'c2', label: 'Run again', message: 'Run again', action_type: 'run_analysis' }),
    ];
    const out = derivePendingActionsFromChips(chips, ctx());
    expect(out).toHaveLength(2);
    expect(out[0]!.id).not.toBe(out[1]!.id);
  });

  it('empty chip list yields empty output', () => {
    expect(derivePendingActionsFromChips([], ctx())).toEqual([]);
  });

  it('chip with action_type=set_factor_value is silently skipped (server-only kind, no commit failure)', () => {
    // Regression cordon for the chip-derivable / resumable split.
    // `set_factor_value` is in `RESUMABLE_ACTION_TYPES` (the resumer
    // reads it) but NOT in `CHIP_DERIVABLE_ACTION_TYPES` — the boundary
    // chip enum permits the value, so a future or adapter-emitted
    // chip with this action_type must NOT crash chip-derivation into
    // STATE_COMMIT_FAILED. Pending actions for `set_factor_value` are
    // emitted via explicit `CommitMetadata.pending_actions` at their
    // dedicated emit sites (turn-executor's value-update clarify path
    // and recovery_label_ambiguous re-persist branch).
    const chips: SuggestedAction[] = [
      chip({
        id: 'c1',
        label: 'Set X',
        message: 'Set X to 5',
        action_type: 'set_factor_value',
      }),
    ];
    expect(() =>
      derivePendingActionsFromChips(chips, ctx()),
    ).not.toThrow();
    const out = derivePendingActionsFromChips(chips, ctx());
    expect(out).toEqual([]);
  });

  it('chip-derivable + server-only chips together — only the derivable one materialises', () => {
    const chips: SuggestedAction[] = [
      chip({
        id: 'c1',
        label: 'Run',
        message: 'Run',
        action_type: 'run_analysis',
      }),
      chip({
        id: 'c2',
        label: 'Set X',
        message: 'Set X to 5',
        action_type: 'set_factor_value',
      }),
    ];
    const out = derivePendingActionsFromChips(chips, ctx());
    expect(out).toHaveLength(1);
    expect(out[0]?.action.kind).toBe('run_analysis');
    expect(out[0]?.chip_id).toBe('c1');
  });
});
