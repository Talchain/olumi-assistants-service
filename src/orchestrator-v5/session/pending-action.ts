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
 *   - `apply_proposed_change`   — server-only proposal kind for the V5
 *                                 propose-then-confirm path (G7/G8).
 *                                 Emitted by `compose/proposed-change.ts`
 *                                 via `CommitMetadata.pending_actions`;
 *                                 NOT chip-derivable (it is deliberately
 *                                 omitted from `CHIP_DERIVABLE_ACTION_TYPES`).
 *                                 The deterministic short-confirm
 *                                 resumer matches it as a resumable
 *                                 kind, and `decideProposedChangeSynthesis`
 *                                 in TurnExecutor handles the apply
 *                                 path with hash-divergence and
 *                                 idempotency checks before dispatch.
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
       * The public proposal handle: identical to the chip's stable
       * `id` produced by `compose/proposed-change.ts::emitProposedChange`.
       * REQUIRED for V5 emits — `parsePendingAction` rejects entries
       * missing `proposal_ref` or where it differs from the
       * `PendingAction.chip_id`. This identity is the bridge the
       * deterministic short-confirm resumer uses to map "yes" / "add
       * that" / "the first one" back to the offered proposal.
       */
      readonly proposal_ref: string;
      /**
       * Executable patch payload. REQUIRED for V5 emits. Contains
       * `handler_id` (a registered V5 action type), `params` (handler
       * arguments), and `target_entity_ids` (graph entities the patch
       * targets). The synthesis path (`decideProposedChangeSynthesis`)
       * resolves the handler and dispatches.
       */
      readonly inline_patch: Readonly<Record<string, unknown>>;
      /**
       * The chip's user-facing label, captured at emit time. REQUIRED
       * for V5 emits — `parsePendingAction` rejects new entries without
       * it. Persisted so the resumer can render numbered ambiguous-
       * clarification copy with the original labels rather than a
       * generic placeholder, and so the label/ordinal pre-route can
       * exact-match against it. Must pass the safety filter in
       * `emitProposedChange`.
       *
       * Marked optional in the type only to accommodate the legacy
       * variant below (`__legacy_no_public_copy: true`); the parser
       * enforces presence on the standard variant.
       */
      readonly public_label: string;
      /**
       * The chip's user-facing message, captured at emit time. Same
       * rationale as `public_label`. REQUIRED for V5 emits.
       */
      readonly public_message: string;
      /**
       * Standard (post-P1-1) variant flag — always undefined on V5
       * emits. The legacy escape hatch below sets this to `true`.
       */
      readonly __legacy_no_public_copy?: undefined;
    }
  | {
      /**
       * Legacy variant of apply_proposed_change for pre-P1-1 entries
       * persisted before the public-copy fields became required.
       * Distinguished from the standard variant by
       * `__legacy_no_public_copy: true`. The parser accepts this
       * variant via `parsePendingAction`'s explicit opt-out check.
       *
       * `emitProposedChange` NEVER constructs this variant — it is
       * read-only for forward compatibility with old persisted rows.
       * If the wider system ever migrates legacy rows in place, this
       * variant becomes a no-op and can be removed in a follow-up.
       */
      readonly kind: 'apply_proposed_change';
      readonly proposal_ref: string;
      readonly inline_patch: Readonly<Record<string, unknown>>;
      readonly public_label?: undefined;
      readonly public_message?: undefined;
      readonly __legacy_no_public_copy: true;
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
  if (a.kind === 'apply_proposed_change') {
    // Both proposal_ref AND inline_patch are REQUIRED for V5 emits.
    // A V5 emit always supplies both via `emitProposedChange`; persisting
    // only one makes the entry unresumable, so we refuse at parse time.
    const hasRef = typeof a.proposal_ref === 'string' && a.proposal_ref.length >= 12;
    const hasInline =
      a.inline_patch !== null &&
      typeof a.inline_patch === 'object' &&
      !Array.isArray(a.inline_patch);
    if (!hasRef || !hasInline) return null;
    // proposal_ref MUST equal chip_id (top-level) — this is the bridge
    // the resumer uses to correlate "yes" with the offered proposal.
    if (a.proposal_ref !== o.chip_id) return null;
    // public_label and public_message are REQUIRED for new V5 emits so
    // ambiguous-clarification can render numbered options. Legacy
    // entries that predate P1-1 may set `__legacy_no_public_copy: true`
    // as an explicit migration opt-out — without that opt-out the
    // entry is rejected.
    const isLegacyOptOut = a.__legacy_no_public_copy === true;
    if (!isLegacyOptOut) {
      if (typeof a.public_label !== 'string' || a.public_label.length === 0) return null;
      if (typeof a.public_message !== 'string' || a.public_message.length === 0) return null;
    }
  }
  const preconditions = o.preconditions;
  if (!preconditions || typeof preconditions !== 'object' || Array.isArray(preconditions)) return null;
  if (a.kind === 'apply_proposed_change') {
    // Graph-mutating proposals MUST carry the emit-time graph hash so
    // the resumer can detect divergence and emit recovery_superseded.
    const p = preconditions as Record<string, unknown>;
    if (typeof p.graph_hash !== 'string' || p.graph_hash.length === 0) return null;
  }
  return input as PendingAction;
}
