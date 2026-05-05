/**
 * V5 Wave 1 — derive pending actions from a turn's suggested-action chips.
 *
 * Atomic-emit contract: for every `SuggestedAction` whose `action_type` is
 * in the resumable set, this function produces exactly one matching
 * `PendingAction`. Both flow through `commitDirectAnswer` into the same
 * `append_turn_atomic` call, so the chip and its pending action commit
 * or roll back together. The contract is asserted by
 * `derive-pending-actions.test.ts`.
 *
 * Mapping today (Wave 1 covers run_analysis only — every chip CEE
 * currently emits with a structured `action_type` falls in this kind):
 *
 *   action_type='run_analysis'  →  PendingActionAction { kind: 'run_analysis' }
 *
 * Wave 2 wires the deterministic short-confirm pre-route that consumes
 * these. Wave 3 adds emit sites for `set_factor_value`,
 * `apply_proposed_change`, and `edit_graph_add_risk` (these last two
 * are server-side-only kinds — they never appear as chip
 * `action_type` values because the boundary `ActionSchema` enum does
 * not include them. They are derived from clarification / proposal
 * state at the emit site rather than from chips).
 */

import { randomUUID } from 'node:crypto';

import type { SuggestedAction } from './types.js';
import {
  PENDING_ACTIONS_PER_TURN_CAP,
  PENDING_ACTION_DEFAULT_TURN_TTL,
  PENDING_ACTION_DEFAULT_WALL_TTL_MS,
  RESUMABLE_ACTION_TYPES,
  type PendingAction,
  type PendingActionAction,
  type PendingActionKind,
  type PendingActionPreconditions,
} from '../session/pending-action.js';

export interface DerivePendingActionsContext {
  readonly scenario_id: string;
  /** ISO emit timestamp. Pass `new Date().toISOString()` at the call site. */
  readonly emitted_at_iso: string;
  /**
   * Hash of the analysis-affecting graph state at emit time. Optional —
   * the resumer only enforces a hash check on action kinds whose safety
   * depends on graph topology. Pass undefined when the turn does not
   * have a meaningful graph (frame stage, no draft yet).
   */
  readonly graph_hash?: string;
  /**
   * Optional override for the per-pending-action wall-clock TTL.
   * Defaults to `PENDING_ACTION_DEFAULT_WALL_TTL_MS`.
   */
  readonly wall_ttl_ms?: number;
  /** Optional override for the turn-count TTL. */
  readonly turn_ttl?: number;
}

/**
 * Project chip → pending-action kind. Returns `null` for chips that
 * carry an `action_type` outside the resumable set (defence-in-depth;
 * `chip-generator.ts` only emits `run_analysis` today, but the boundary
 * enum permits other values that we do not yet support).
 */
function mapChipKind(action_type: string | undefined): PendingActionKind | null {
  if (!action_type) return null;
  if (!RESUMABLE_ACTION_TYPES.has(action_type as PendingActionKind)) return null;
  return action_type as PendingActionKind;
}

/**
 * Build the kind-specific `action` payload for a chip-derived pending
 * action. Wave 1 only handles `run_analysis` (no params). Other kinds
 * never reach this function because their `action_type` strings are
 * not in `RESUMABLE_ACTION_TYPES` AND/OR they are not emitted as
 * boundary chips.
 */
function buildChipAction(kind: PendingActionKind): PendingActionAction | null {
  switch (kind) {
    case 'run_analysis':
      return { kind: 'run_analysis' };
    case 'what_would_flip':
      return { kind: 'what_would_flip' };
    // The other kinds (`set_factor_value`, `apply_proposed_change`,
    // `edit_graph_add_risk`) are server-side-only and are not emitted
    // as chips by the chip-generator — they are constructed at their
    // specific emit sites in later waves and passed in via
    // CommitMetadata.pending_actions directly. Here we conservatively
    // return null so we never silently invent a chip-derived
    // pending action with empty params.
    default:
      return null;
  }
}

function defaultPreconditions(
  kind: PendingActionKind,
  graph_hash: string | undefined,
): PendingActionPreconditions {
  if (kind === 'what_would_flip') {
    return { required_freshness: 'fresh', graph_hash };
  }
  if (kind === 'set_factor_value' || kind === 'edit_graph_add_risk') {
    return { graph_hash };
  }
  return {};
}

/**
 * Derive pending actions from chips. Returns at most
 * `PENDING_ACTIONS_PER_TURN_CAP` entries — chips beyond the cap are
 * silently dropped from the pending-action list (they still appear as
 * chips, but no resumable record is persisted for them). The DB CHECK
 * also enforces the cap as defence-in-depth.
 *
 * Throws if the input contains a chip whose `action_type` is in
 * `RESUMABLE_ACTION_TYPES` but `buildChipAction` returns null —
 * indicates a future-kind drift that should fail loudly rather than
 * silently miss the offer/persistence pairing.
 */
export function derivePendingActionsFromChips(
  chips: readonly SuggestedAction[],
  ctx: DerivePendingActionsContext,
): readonly PendingAction[] {
  const out: PendingAction[] = [];
  const wallMs = ctx.wall_ttl_ms ?? PENDING_ACTION_DEFAULT_WALL_TTL_MS;
  const turnTtl = ctx.turn_ttl ?? PENDING_ACTION_DEFAULT_TURN_TTL;
  const expiresAtIso = new Date(Date.parse(ctx.emitted_at_iso) + wallMs).toISOString();
  for (const chip of chips) {
    const kind = mapChipKind(chip.action_type);
    if (kind === null) continue;
    const action = buildChipAction(kind);
    if (action === null) {
      // Drift guard: action_type is resumable but we don't have a
      // chip-derived constructor for it. Throw rather than silently
      // miss the offer/persistence pairing — atomic-emit contract.
      throw new Error(
        `derivePendingActionsFromChips: action_type='${chip.action_type}' is in ` +
          `RESUMABLE_ACTION_TYPES but buildChipAction returned null. ` +
          `This indicates an emit site is missing a chip-derived constructor.`,
      );
    }
    out.push({
      id: randomUUID(),
      scenario_id: ctx.scenario_id,
      chip_id: chip.id,
      action,
      preconditions: defaultPreconditions(kind, ctx.graph_hash),
      expires_at_turn_count: turnTtl,
      expires_at_iso: expiresAtIso,
      emitted_at_iso: ctx.emitted_at_iso,
    });
    if (out.length >= PENDING_ACTIONS_PER_TURN_CAP) break;
  }
  return out;
}
