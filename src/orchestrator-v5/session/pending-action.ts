/**
 * V5 pending-action types.
 *
 * Pending actions persist alongside the chips offered on a given turn so
 * the next turn's deterministic short-confirm pre-route can resume the
 * offered action without an LLM round-trip. Storage is the
 * `pending_actions JSONB` column on `v5_conversation_turns`, written by
 * `append_turn_atomic(p_pending_actions)`. Read back via a parallel
 * SessionStore method so we don't widen the vendored `SessionTurn` type
 * from `@talchain/schemas/orchestrator`.
 *
 * Resumable kinds — closed union, mirrors canonical V5 handler/action
 * names that exist today (Phase 0 verified):
 *   - `set_factor_value`        — direct deterministic value update
 *   - `run_analysis`            — covers both initial run and re-runs
 *                                 (no separate `rerun_analysis` exists)
 *   - `what_would_flip`         — explanation handler precondition gated
 *   - `apply_proposed_change`   — backs the legacy "Here's the change I'd
 *                                 propose. If you want, I can apply it
 *                                 next." copy at edit-graph.ts:216 and
 *                                 the deterministic value-update propose
 *                                 path at deterministic/actions/
 *                                 set-factor-value.ts:285
 *   - `edit_graph_add_risk`     — preserves the original risk label
 *                                 across the A4 missing-driver clarify
 *                                 turn so the deterministic add path can
 *                                 resume on reply.
 */

export type PendingActionId = string;

export type PendingActionAction =
  | {
      readonly kind: 'set_factor_value';
      readonly factor_id: string;
      readonly value: number;
      readonly unit?: string;
      readonly operator: 'set' | 'increase' | 'decrease' | 'multiply';
    }
  | { readonly kind: 'run_analysis' }
  | { readonly kind: 'what_would_flip' }
  | {
      readonly kind: 'apply_proposed_change';
      /**
       * Reference to the proposed-change handler fact on the prior turn,
       * if applicable. Resumer rehydrates the patch from there. When
       * `proposal_ref` is omitted the action carries an inline patch
       * description in `inline_patch`.
       */
      readonly proposal_ref?: string;
      readonly inline_patch?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: 'edit_graph_add_risk';
      readonly label: string;
      readonly connect_to_node_id?: string;
    };

export type PendingActionKind = PendingActionAction['kind'];

/**
 * The set of `action_type` strings that map onto a resumable
 * pending-action kind. Used by `derivePendingActionsFromChips` to decide
 * which chips materialise as pending actions and which round-trip as
 * natural-language messages only.
 */
export const RESUMABLE_ACTION_TYPES: ReadonlySet<PendingActionKind> = new Set([
  'set_factor_value',
  'run_analysis',
  'what_would_flip',
  'apply_proposed_change',
  'edit_graph_add_risk',
]);

export interface PendingActionPreconditions {
  /**
   * The graph hash at the moment this action was offered. The resumer
   * compares against the live graph hash and invalidates if they differ.
   * Set on actions whose safety depends on graph topology
   * (`set_factor_value`, `apply_proposed_change`, `edit_graph_add_risk`).
   */
  readonly graph_hash?: string;
  /**
   * Node/edge ids that must still exist for this action to be safe to
   * resume. Resumer looks each up and invalidates with reason
   * `target_missing` if any are gone.
   */
  readonly target_entity_ids?: readonly string[];
  /**
   * For actions whose answer depends on a fresh analysis fact
   * (`what_would_flip`). When `'fresh'`, the resumer must verify a
   * fresh successful analysis fact is available; otherwise it must
   * downgrade to a focused recovery offering `run_analysis` instead.
   */
  readonly required_freshness?: 'fresh';
}

export interface PendingAction {
  readonly id: PendingActionId;
  readonly scenario_id: string;
  readonly emitted_in_turn_row_id: string;
  readonly chip_id: string;
  readonly action: PendingActionAction;
  readonly preconditions: PendingActionPreconditions;
  readonly expires_at_turn_count: number;
  readonly expires_at_iso: string;
  readonly emitted_at_iso: string;
}

/**
 * Compact reason set surfaced on the
 * `pending_action.invalidated` / `pending_action.skipped` telemetry
 * events. Single source of truth so the resumer, persistence layer,
 * and tests use the same vocabulary.
 */
export type PendingActionInvalidationReason =
  | 'expired_wall'
  | 'expired_turns'
  | 'target_missing'
  | 'graph_hash_changed'
  | 'target_kind_changed'
  | 'freshness_required_but_missing'
  | 'analysis_superseded';

export type PendingActionSkipReason =
  | 'no_short_confirm'
  | 'no_pending'
  | 'superseded_by_later_turn'
  | 'multiple_ambiguous';

/**
 * Default lifecycle bounds. Conservative; tune later via telemetry on
 * `pending_action.invalidated` rates.
 */
export const PENDING_ACTION_DEFAULT_TURN_TTL = 2;
export const PENDING_ACTION_DEFAULT_WALL_TTL_MS = 10 * 60 * 1000;

/**
 * Cap mirrors `MAX_CHIPS` in chip-generator.ts. Enforced at both the
 * derive site and the DB CHECK constraint.
 */
export const PENDING_ACTIONS_PER_TURN_CAP = 3;
