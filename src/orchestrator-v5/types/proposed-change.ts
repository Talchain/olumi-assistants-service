/**
 * V5 G7/G8 — proposed-change types.
 *
 * A "proposed change" is a server-side intent for a graph mutation that
 * the assistant offers to the user as a chip on turn N. The user
 * confirms (or dismisses) on turn N+1; the deterministic short-confirm
 * pre-route resumes the matching `apply_proposed_change` pending action
 * without an LLM round-trip.
 *
 * Public proposal handle (Option B):
 *   - The wire chip uses an existing `boundary.ActionType` literal —
 *     `add_constraint`, `set_factor_value`, or `adjust_edge_strength`.
 *   - The chip's stable `id` (`prop_<sha256-12hex>`) is the public
 *     `proposal_ref`.
 *   - Heavy executable detail (handler id, params, target) lives
 *     server-side on the matching `PendingAction.action.inline_patch`.
 *
 * The compose helper (`compose/proposed-change.ts`) is the only sanctioned
 * emit site; it returns the chip and pending action together so atomic
 * persistence holds.
 */

import type { V5ActionType } from '@talchain/schemas/orchestrator';

import type { HandlerRegistry } from '../tools/registry.js';

/**
 * The set of mutation intents we currently know how to propose. Each
 * maps 1:1 onto a registered V5 handler id and a wire-valid
 * `boundary.ActionType` literal:
 *   - `add_constraint`        → handler `add_constraint`,        chip `add_constraint`
 *   - `set_factor_value`      → handler `set_factor_value`,      chip `set_factor_value`
 *   - `adjust_edge_strength`  → handler `adjust_edge_strength`,  chip `adjust_edge_strength`
 *
 * Keeping intent === handler id === chip action_type is deliberate: it
 * removes a translation surface and makes the relationship between the
 * public chip and the server-side pending action obvious.
 */
export type ProposedChangeIntent =
  | 'add_constraint'
  | 'set_factor_value'
  | 'adjust_edge_strength';

/**
 * The full proposal payload an upstream caller hands to
 * `emitProposedChange`. The caller authors the user-facing copy
 * (`label`, `message`) — these are not prompts and not LLM output;
 * they are deterministic in-code strings, validated against the safety
 * filter at emit time.
 */
export interface ProposedChange {
  readonly intent: ProposedChangeIntent;
  /**
   * The chip's user-facing label. Concise British English. Validated
   * against the safety string filter (no internal ids, handler names,
   * `apply_proposed_change`, raw JSON, etc.).
   */
  readonly label: string;
  /**
   * The chip's user-facing message — the text we show on the chip and
   * the prompt we replay if the user clicks. Same constraints as
   * `label`.
   */
  readonly message: string;
  /**
   * Handler-bound parameters. Materialised verbatim into
   * `inline_patch.params` and replayed when the user confirms.
   * Treat as opaque here — validation is the handler's job at apply
   * time.
   */
  readonly params: Readonly<Record<string, unknown>>;
  /**
   * Optional graph entity ids the proposal targets. Threaded into
   * `preconditions.target_entity_ids` so the resumer can invalidate
   * with `target_missing` if any have been removed since emit.
   */
  readonly target_entity_ids?: readonly string[];
}

/**
 * Per-emit context. `graph_hash` MUST be the analysis-affecting graph
 * hash at emit time so the resumer can detect graph drift and emit
 * `recovery_superseded` rather than apply a stale patch.
 */
export interface ProposedChangeContext {
  readonly scenario_id: string;
  readonly graph_hash: string;
  /** ISO emit timestamp. Pass `new Date().toISOString()` at the call site. */
  readonly emitted_at_iso: string;
  /**
   * The active V5 handler registry. The compose helper resolves the
   * intent against this registry and refuses to emit if no handler is
   * registered — fails closed rather than producing a chip the
   * resumer cannot honour.
   */
  readonly registry: HandlerRegistry;
  /**
   * Optional override for the per-pending-action wall-clock TTL.
   * Defaults to `PENDING_ACTION_DEFAULT_WALL_TTL_MS`.
   */
  readonly wall_ttl_ms?: number;
  /** Optional override for the turn-count TTL. */
  readonly turn_ttl?: number;
}

/**
 * Discriminated emit outcome. Callers can hard-fail loudly on
 * `unknown_intent` / `unsafe_copy` rather than silently dropping the
 * proposal.
 */
export type ProposedChangeEmitResult =
  | {
      readonly status: 'success';
      readonly chip: import('../compose/types.js').SuggestedAction;
      readonly pending: import('../session/pending-action.js').PendingAction;
    }
  | {
      readonly status: 'unknown_intent';
      readonly intent: ProposedChangeIntent;
    }
  | {
      readonly status: 'unsafe_copy';
      readonly field: 'label' | 'message';
      readonly forbidden_token: string;
    };

/**
 * Map an intent onto the wire chip `action_type` (boundary literal) and
 * handler id (V5ActionType). Today they are the same string. Keep
 * the mapping explicit so a future divergence is a deliberate code
 * change, not a silent drift.
 */
export function intentToActionType(intent: ProposedChangeIntent): V5ActionType {
  return intent;
}

/**
 * Single source of truth for "is this V5 action type one that backs an
 * apply_proposed_change proposal". Used by:
 *   - the proposal-emit path (derives the wire chip's `action_type`)
 *   - the ambiguous-clarification chip builder (derives the chip's
 *     `action_type` from the stored `inline_patch.handler_id`)
 *   - tests asserting the mapping is stable
 *
 * Equivalent in spirit to `intentToActionType` reversed, but typed at
 * the V5ActionType wire literal so callers don't have to narrow.
 */
export function isProposedChangeActionType(
  value: unknown,
): value is 'add_constraint' | 'set_factor_value' | 'adjust_edge_strength' {
  return value === 'add_constraint' || value === 'set_factor_value' || value === 'adjust_edge_strength';
}
