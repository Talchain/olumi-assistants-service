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
 *   - `apply_proposed_change`   — reserved for the V4 propose-and-confirm
 *                                 path. NOT emitted today: the V5
 *                                 dispatcher does not persist
 *                                 `pendingProposal` and does not render
 *                                 accept/cancel chips, so this kind has
 *                                 no production emit site yet. It stays
 *                                 in the union so the persistence layer
 *                                 can carry it once the deterministic-
 *                                 replay plumbing lands (separate
 *                                 follow-up).
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
 * The full set of pending-action kinds that the resumer can claim
 * a turn for. Used by `tryClarificationResume` and the classification
 * regression. NOT the right set for chip-derivation — a chip whose
 * `action_type` is in this set may be a server-only kind without a
 * chip-derived constructor (`set_factor_value`, `apply_proposed_change`,
 * `edit_graph_add_risk` — these are emitted via explicit
 * `CommitMetadata.pending_actions`, not derived from chips).
 *
 * For chip-derivation use `CHIP_DERIVABLE_ACTION_TYPES` instead.
 */
export const RESUMABLE_ACTION_TYPES: ReadonlySet<PendingActionKind> = new Set([
  'set_factor_value',
  'run_analysis',
  'what_would_flip',
  'apply_proposed_change',
  'edit_graph_add_risk',
]);

/**
 * The strict subset of pending-action kinds that have a chip-derived
 * constructor in `derivePendingActionsFromChips`. A chip on the wire
 * whose `action_type` is in this set materialises as a pending action;
 * a chip whose `action_type` is in `RESUMABLE_ACTION_TYPES` but NOT
 * here round-trips as a natural-language message and does NOT crash
 * the commit path.
 *
 * MAINTENANCE CONTRACT: every kind in this set MUST have a `case`
 * in `buildChipAction`. The drift guard there throws if a kind
 * reaches it without a constructor — that's still useful as a
 * fail-loud check, but the guard now only fires for kinds inside
 * this set, not the broader `RESUMABLE_ACTION_TYPES`. The companion
 * regression test in `derive-pending-actions.test.ts` exercises a
 * `set_factor_value` chip to prove server-only kinds in
 * `RESUMABLE_ACTION_TYPES` do NOT crash chip-derivation.
 */
export const CHIP_DERIVABLE_ACTION_TYPES: ReadonlySet<PendingActionKind> = new Set([
  'run_analysis',
  'what_would_flip',
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
  /**
   * The id of the chip this pending action was offered alongside. The
   * resumer uses this for telemetry correlation and to match against
   * `chip_metadata` in chip-click flows. No DB foreign-key relation
   * (chips are ephemeral; the chip id is just a string).
   */
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

/**
 * Hand-rolled validator for a single pending action read from the JSONB
 * column. We keep this in-house (not Zod) because the shape is small and
 * `pending-action.ts` is a leaf module that should not pull additional
 * dependencies. Returns `null` on any validation failure; callers
 * (read path) silently drop unparsable entries and log
 * `session.pending_action.parse_failed` telemetry.
 */
export function parsePendingAction(input: unknown): PendingAction | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.length === 0) return null;
  if (typeof o.scenario_id !== 'string' || o.scenario_id.length === 0) return null;
  if (typeof o.chip_id !== 'string' || o.chip_id.length === 0) return null;
  if (typeof o.expires_at_turn_count !== 'number' || !Number.isFinite(o.expires_at_turn_count)) return null;
  if (typeof o.expires_at_iso !== 'string') return null;
  if (typeof o.emitted_at_iso !== 'string') return null;
  const action = o.action;
  if (!action || typeof action !== 'object' || Array.isArray(action)) return null;
  const a = action as Record<string, unknown>;
  if (typeof a.kind !== 'string') return null;
  if (!RESUMABLE_ACTION_TYPES.has(a.kind as PendingActionKind)) return null;
  if (a.kind === 'set_factor_value') {
    if (typeof a.factor_id !== 'string') return null;
    if (typeof a.value !== 'number') return null;
    if (typeof a.operator !== 'string') return null;
    if (!['set', 'increase', 'decrease', 'multiply'].includes(a.operator)) return null;
  }
  if (a.kind === 'edit_graph_add_risk') {
    if (typeof a.label !== 'string' || a.label.length === 0) return null;
  }
  const preconditions = o.preconditions;
  if (!preconditions || typeof preconditions !== 'object' || Array.isArray(preconditions)) return null;
  return input as PendingAction;
}
