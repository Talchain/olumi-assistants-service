/**
 * Derive pending actions from a turn's suggested-action chips.
 *
 * Atomic-emit contract: for every `SuggestedAction` whose `action_type`
 * is in `CHIP_DERIVABLE_ACTION_TYPES`, this function produces exactly
 * one matching `PendingAction`. Both flow through `commitDirectAnswer`
 * into the same `append_turn_atomic` call, so the chip and its pending
 * action commit or roll back together.
 *
 * Chips whose `action_type` is in `RESUMABLE_ACTION_TYPES` but NOT in
 * `CHIP_DERIVABLE_ACTION_TYPES` (the server-only kinds —
 * `set_factor_value`, `apply_proposed_change`, `edit_graph_add_risk`)
 * round-trip as natural-language messages here and DO NOT crash the
 * commit path. Pending actions for those kinds are emitted via
 * explicit `CommitMetadata.pending_actions` at their dedicated emit
 * sites — for `apply_proposed_change` the dedicated site is
 * `compose/proposed-change.ts::emitProposedChange`, which produces a
 * matching wire chip (using one of the existing `boundary.ActionType`
 * literals such as `add_constraint`) plus the server-side pending
 * action carrying `inline_patch.handler_id` / `inline_patch.params` /
 * `inline_patch.target_entity_ids`.
 *
 * Today the mapping is:
 *   action_type='run_analysis'    → PendingActionAction { kind: 'run_analysis' }
 *   action_type='what_would_flip' → PendingActionAction { kind: 'what_would_flip' }
 *
 * Drift guard: if a chip's action_type is in
 * `CHIP_DERIVABLE_ACTION_TYPES` but `buildChipAction` has no case for
 * it, the function throws — that fires only for genuine drift inside
 * the chip-derivable subset, not for any chip whose action_type just
 * happens to be in the broader resumable set.
 */

import { randomUUID } from 'node:crypto';

import type { SuggestedAction } from './types.js';
import { finalizeChips } from './chip-finalizer.js';
import {
  CHIP_DERIVABLE_ACTION_TYPES,
  PENDING_ACTIONS_PER_TURN_CAP,
  PENDING_ACTION_DEFAULT_TURN_TTL,
  PENDING_ACTION_DEFAULT_WALL_TTL_MS,
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
 * Project chip → pending-action kind. Returns `null` for chips whose
 * `action_type` is outside `CHIP_DERIVABLE_ACTION_TYPES` (no
 * chip-derived constructor, including server-only kinds that round-trip
 * as natural-language messages).
 */
function mapChipKind(action_type: string | undefined): PendingActionKind | null {
  if (!action_type) return null;
  if (!CHIP_DERIVABLE_ACTION_TYPES.has(action_type as PendingActionKind)) return null;
  return action_type as PendingActionKind;
}

/**
 * Build the kind-specific `action` payload for a chip-derived pending
 * action. The switch must have a case for every kind in
 * `CHIP_DERIVABLE_ACTION_TYPES`; the drift guard in the caller throws
 * if one is missing.
 */
function buildChipAction(kind: PendingActionKind): PendingActionAction | null {
  switch (kind) {
    case 'run_analysis':
      return { kind: 'run_analysis' };
    case 'what_would_flip':
      return { kind: 'what_would_flip' };
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
 * `CHIP_DERIVABLE_ACTION_TYPES` but `buildChipAction` returns null —
 * indicates drift WITHIN the chip-derivable subset (a kind was added
 * to the set but its `case` was forgotten in `buildChipAction`).
 * Non-chip-derivable resumable kinds (server-only `set_factor_value`,
 * `apply_proposed_change`, `edit_graph_add_risk`) round-trip silently
 * via the `mapChipKind` filter and never reach the throw path.
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
      // Drift guard: action_type is in CHIP_DERIVABLE_ACTION_TYPES
      // but buildChipAction has no case for it. Adding a kind to
      // the set without updating the switch is a real bug — fail
      // loudly so the test layer catches it.
      throw new Error(
        `derivePendingActionsFromChips: action_type='${chip.action_type}' is in ` +
          `CHIP_DERIVABLE_ACTION_TYPES but buildChipAction returned null. ` +
          `Add a case for this kind to buildChipAction.`,
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

/**
 * Derive pending actions from the EGRESS-FINALISED chip set. This is the
 * canonical chip → pending derivation: it applies the same deterministic
 * `finalizeChips` transform that runs at egress
 * (`sanitiseOlumiResponseForEgress`) and can drop a chip (unsafe / blank /
 * duplicate / over-budget). Deriving pendings from the survivors keeps the
 * "persisted pending ⟹ rendered chip" invariant structural: a chip dropped
 * from the wire can never leave an orphaned resumable pending that a later
 * "yes" short-confirm could resume.
 *
 * Use this at EVERY chip → pending derivation site — the implicit commit path
 * AND every site that precomputes an explicit `CommitMetadata.pending_actions`
 * list (those bypass the commit-time pre-pass, so they must finalise here).
 * Never call the raw {@link derivePendingActionsFromChips} from a derivation
 * site. The chip-derivable subset (`run_analysis` / `what_would_flip`) carries
 * no entity ids or decimals, so its surviving set is identical here (pre-scrub)
 * and at egress (post-scrub). `finalizeChips` runs with `logSuppressions:
 * false` so a chip drop is logged exactly once, at egress.
 */
export function derivePendingActionsFromFinalizedChips(
  chips: readonly SuggestedAction[],
  ctx: DerivePendingActionsContext,
): readonly PendingAction[] {
  return derivePendingActionsFromChips(
    finalizeChips(chips, { logSuppressions: false }).chips,
    ctx,
  );
}
