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
 *   - `proposed_concept`        — V5 P0 post-analysis proposal memory.
 *                                 Captures a noun-phrase concept emitted
 *                                 by Sonnet ("add team morale as a
 *                                 factor"). DOES NOT auto-apply. Read by
 *                                 `decideNoOpRecovery` in
 *                                 `edit-graph-dispatch` to drive a
 *                                 two-stage deterministic clarifier:
 *                                 Stage 1 offers risk/factor/note chips
 *                                 on agreement; Stage 2 offers affect-
 *                                 target chips on "add as factor" intent.
 *                                 Server-only (NOT chip-derivable);
 *                                 emitted alongside the LLM Sonnet
 *                                 direct-answer commit. No new wire-
 *                                 level action_type is introduced.
 */

// Clarify v2 (E0-B): the closed dimension set for `clarify_v2_round`
// validation is DERIVED from the rubric (the source of truth), never
// hand-mirrored here. `clarify-v2/rubric.ts` is itself a zero-dependency
// leaf module, so this import keeps pending-action.ts dependency-light
// and cycle-free.
import { isClarifyDimension } from '../clarify-v2/rubric.js';

export type PendingActionId = string;

/**
 * ROADMAP 2.918 — the fields a pending baseline question carries, shared with
 * `HandlerOutcome.__elicit_baseline` (registry.ts) so the handler's channel
 * and the persisted pending cannot drift (trap 12). `target_id`/`target_label`
 * are the question's identity; `constraint_type`/`value`/`unit`/`label` are
 * the REGISTERED row's shape, carried so the answer-turn resume replays a
 * value-identical restatement (`label` is the persisted row's label — omitting
 * it would let the replay silently rewrite the label to the node's).
 */
export interface ElicitTargetBaselineFields {
  readonly target_id: string;
  readonly target_label: string;
  readonly constraint_type: 'at_least' | 'at_most';
  readonly value: number;
  readonly unit?: string;
  readonly label?: string;
}

/**
 * THE ASKED CELL, carried across the turn on which the product asked about it.
 *
 * The configure-option clarify intercept names a specific (option, factor) cell
 * — "'Two Developers' has no effect value on Development throughput yet" — and
 * before ROADMAP 2.1352 that referent existed only in the prose of a turn that
 * was never written. The next turn therefore received no history of the
 * question and no pending action, so a compliant reply of "0.6" had nothing to
 * bind to and the product asked which cell was meant. It had named it itself,
 * one turn earlier.
 *
 * Both ids AND both labels are carried deliberately. The ids are the question's
 * IDENTITY (a label can be duplicated across options — the duplicate-label dead
 * end at route-v2 exists because of exactly that); the labels are the copy the
 * user actually saw, kept so a resume can restate the question in the user's own
 * vocabulary without re-deriving it from a graph that may have moved.
 *
 * Fields are derived from `deriveMissingEffectPairs` (the estate's ONE owner of
 * "which effect value is outstanding"), never re-stated at the emit site.
 */
export interface ElicitOptionEffectFields {
  readonly option_id: string;
  readonly option_label: string;
  readonly factor_id: string;
  readonly factor_label: string;
}

/**
 * ONE OFFERED (option, factor) CELL, as the user was shown it.
 *
 * Structurally identical to {@link ElicitOptionEffectFields}, and NOT reused
 * from it on purpose: that type is ONE asked cell, this is ONE MEMBER of an
 * offered SET. Both ids and both labels for the same reason given there — the
 * ids are identity (labels collide across options; the duplicate-label dead end
 * at `route-v2.ts` exists because of exactly that), the labels are the copy the
 * user actually read.
 */
export interface ElicitEffectTargetCandidate {
  readonly option_id: string;
  readonly option_label: string;
  readonly factor_id: string;
  readonly factor_label: string;
}

/**
 * THE VALUE THE USER ALREADY GAVE, plus the cells it might belong to.
 *
 * ⚠ THE QUESTION THIS ANSWERS, written down before the shape (CLAUDE.md trap
 * 21 — two authorities under similar names that answer different questions is
 * this estate's chronic defect). It is: *"you have given me a number; WHICH
 * (option, factor) cell does it belong to?"* That question has exactly two
 * askers today, and they ask it about differently-SOURCED candidate sets:
 *
 *   - `repair_value_ask` (`composeRepairValueAskResponse`) — the user typed a
 *     bare compliant value ("Set it to 0.12.") and MORE THAN ONE effect value
 *     is still unset, so the candidates are the OUTSTANDING cells read off the
 *     readiness blockers.
 *   - `option_effect_ask` (`composeOptionEffectAskResponse`) — the sentence is
 *     unmistakably an option-effect request carrying a value, and the ENTITY is
 *     ambiguous, so the candidates are the cells the user's own message reaches.
 *
 * They are ONE kind because the REFERENT A REPLY BINDS TO is identical: the
 * value, and the set it must be assigned to. The provenance difference is real
 * and is RECORDED in `source` rather than forked into a second kind — a reply
 * of "the first one" needs the same two facts either way, and two kinds would
 * double the parse surface for no reader.
 *
 * `value_text` is the user's own bytes AS THE COPY QUOTED THEM — never a
 * re-formatted number. The composers put that exact string on screen
 * ("You gave 0.12, and more than one effect value is still missing…"), so a
 * resume can restate the question in the user's own terms.
 */
export interface ElicitEffectTargetFields {
  readonly source: 'repair_value_ask' | 'option_effect_ask';
  readonly value_text: string;
  /** Non-empty, and in the order the user was offered them. */
  readonly candidates: readonly ElicitEffectTargetCandidate[];
}

/**
 * ONE OFFERED EDIT TARGET, as the user was shown it.
 */
export interface ElicitEditTargetOffer {
  readonly node_id: string;
  readonly label: string;
}

/**
 * THE GENERIC EDIT CLARIFICATION, and its offered targets.
 *
 * ⚠ THE QUESTION THIS ANSWERS is deliberately WEAKER than its two siblings
 * above, and saying so is the point. `composeEditClarifyResponse` asks
 * *"tell me the specific factor, edge, option, or value to change"* — it names
 * NO cell, because at its two call sites there is nothing to name: the user
 * said something vague ("update the model") or clicked the legacy simplify
 * chip. So the only honest referent is (a) WHICH of the two intercepts asked,
 * and (b) the targets the reply was offered.
 *
 * ⚠⚠ AND `offered_targets` IS ROUTINELY EMPTY ON THE LIVE WIRE. Both call sites
 * read their nodes from `extensions.graphState`, and the UI sends a turn, NOT a
 * graph — so `buildClarifyChips` falls through to the cancel-only chip and
 * there is no target to record. That is why the emit sites arm this pending
 * ONLY when a graph arrived, and commit the turn REGARDLESS: on the path that
 * actually has the defect, the durable conversation-history row IS the fix and
 * the structured referent is a bonus. Refusing to commit for want of a referent
 * would discard the whole repair on exactly the turns that need it.
 */
export interface ElicitEditTargetFields {
  readonly reason: 'chip_simplify' | 'vague_edit';
  /** Non-empty when armed; the emit sites decline rather than arm an empty one. */
  readonly offered_targets: readonly ElicitEditTargetOffer[];
}

export type PendingActionAction =
  | {
      readonly kind: 'set_factor_value';
      readonly factor_id: string;
      readonly value: number;
      readonly unit?: string;
      readonly operator: 'set' | 'increase' | 'decrease' | 'multiply';
      /**
       * 1.16 item A2 — OPTIONAL explicit cap carried by the user-consented
       * "extend the scale" chip (value_exceeds_cap recovery). When present,
       * the clarification-resume synthesis threads it into the proposal's
       * structured value `{ value, unit, cap }`; `proposalCap` takes
       * precedence over the factor's stored cap in the shared predicate
       * and the handler, so the consented cap change applies atomically
       * with the value. Absent on all other emits.
       */
      readonly cap?: number;
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
    }
  | {
      /**
       * ROADMAP 2.63 C3/C4 — deterministic draft/redraft offer.
       *
       * Seeded server-side (explicit `CommitMetadata.pending_actions`,
       * NEVER chip-derived — `draft_graph` is not in the wire ActionType
       * enum, so the offer chip is a plain text-replay chip) by:
       *   - the frame_no_brief_guard when the guard-firing message carries
       *     a usable brief seed (C3 — "Build the model" offer), and
       *   - the explicit-generate graph-present decline (C4 — "Redraft
       *     the model" offer; `redraft: true`).
       *
       * Resumed at ROUTE level only (route-v2's draft-offer pre-route,
       * upstream of TurnExecutor) into the C1/C2 deterministic draft path:
       * an exact replay of the offer's public copy (chip click or typed),
       * or a bare short-confirm while this is the SOLE live pending kind.
       * TurnExecutor's bare-confirm resumer deliberately does NOT dispatch
       * it (`kind_not_yet_resumable` fall-through — the executor cannot
       * draft), and the kind is deliberately NOT confirmation-expecting:
       * a bare "yes" while a real consent hold (`apply_proposed_change`)
       * is live resolves the HOLD per the F-HELD consent-priority ruling;
       * the draft offer then requires its named copy. Like the
       * chip-suggestion kinds, a lapsed offer dies silently — the
       * deterministic re-offer paths (guard re-fire / a fresh
       * generate-flag turn) replace it cheaply.
       */
      readonly kind: 'draft_graph';
      /**
       * Brief candidate captured at offer time (normaliseBriefText-bounded,
       * ≥ DRAFT_GRAPH_MIN_BRIEF_LENGTH). Absent when the offering turn had
       * no usable typed content — the resume then relies on the persisted
       * brief / recent shaped turns, or declines honestly. Never captured
       * from a chip_click's canned text.
       */
      readonly brief_seed?: string;
      /**
       * True on the C4 offer: consenting means REPLACING the persisted
       * graph. `preconditions.graph_hash` carries the persisted graph's
       * analysis-affecting hash at offer time when computable, so the
       * commit carry-forward invalidates the offer if an edit lands
       * between offer and consent. Absent/false = C3 first-draft offer.
       */
      readonly redraft?: boolean;
      /** Stable public copy captured at emit time (chip label/message). */
      readonly public_label: string;
      readonly public_message: string;
    }
  | {
      /**
       * Clarify v2 round state (ROADMAP 1.94 Option A replacement, E0-B).
       * Carries the draft-preflight clarification round across the answer
       * turn: the WORKING BRIEF (original + incorporated answers), the
       * REAL asked-history (`asked_dimensions` — the retired clarifier's
       * history was always empty, B1.4), and the round counter that
       * enforces the ready-to-draft stop rule.
       *
       * Server-only (NOT chip-derivable): emitted by
       * `handlers/clarify-v2-dispatch.ts` via
       * `CommitMetadata.pending_actions` alongside the question chips,
       * and claimed on the next user turn by the same module's resume
       * pre-route in route-v2 (BEFORE TurnExecutor). Non-mutating: the
       * scenario has no graph yet, and resuming only re-runs the
       * deterministic rubric — no graph mutation, so no
       * `preconditions.graph_hash` is persisted.
       *
       * DARK behind CEE_CLARIFY_V2_ENABLED: with the flag off nothing
       * emits this kind; a persisted row read with the flag off is
       * ignored by every other consumer (short-confirm's local
       * RESUMABLE_KINDS excludes it; tryClarificationResume filters on
       * set_factor_value / edit_graph_add_risk) and dies by TTL.
       */
      readonly kind: 'clarify_v2_round';
      /** Working brief, ≤ DRAFT_GRAPH_MAX_BRIEF_LENGTH (5000). */
      readonly brief: string;
      /** Rubric dimensions asked so far (closed set, validated at parse). */
      readonly asked_dimensions: readonly string[];
      /** Rounds asked so far, 1-based. */
      readonly round: number;
      /**
       * 1.152 (A1/A4): true once this round's single re-offer is spent
       * (bare-ack calibration / not-an-answer guard). OPTIONAL so rows
       * persisted before 1.152 parse as not-reoffered — never refused.
       */
      readonly reoffered?: boolean;
      /**
       * 2.171: the post-Stop new brief the disclosure was issued for —
       * "start over" re-runs round 1 over this. OPTIONAL so rows persisted
       * before 2.171 (and every ordinary round) parse unchanged.
       */
      readonly start_over_brief?: string;
    }
  | ({
      /**
       * ROADMAP 2.918 — the pending BASELINE QUESTION. Emitted by the
       * turn-executor's commit path when `add_constraint` returns the
       * `__elicit_baseline` channel: the turn registered a level-framed
       * constraint on a mintable-and-baseline-less target and the receipt
       * asked for the target's current level. Carries the question's
       * TARGET (the identity an elliptical answer binds through — no
       * pending question, no elliptical binding, fail closed) and the
       * REGISTERED CONSTRAINT's own shape so the answer-turn resume can
       * replay a value-identical restatement through the add_constraint
       * handler (the #868 mint path), never a second writer.
       *
       * Server-only (NOT chip-derivable; not confirmation-expecting — a
       * bare "yes" answers no percent question). Resumed by the
       * turn-executor's baseline-elicitation pre-route; ALSO read directly
       * by the add_constraint handler (via
       * `context.most_recent_pending_actions`) to license the elliptical
       * grammar when the LLM routes the answer itself. A lapsed question
       * dies silently by TTL — behaviour is then exactly the honest ISL
       * refusal that preceded 2.918.
       */
      readonly kind: 'elicit_target_baseline';
    } & ElicitTargetBaselineFields)
  | ({
      /**
       * ROADMAP 2.1352 — the configure-option clarify intercept's asked cell.
       *
       * Server-only: never chip-derived, and it introduces no wire-level
       * `action_type`. Persisted in the existing `pending_actions` JSONB
       * column, whose DB CHECK enforces only array + length <= 3, so no
       * migration is required.
       *
       * Deliberately ABSENT from `CONFIRMATION_EXPECTING_ACTION_TYPES`, on the
       * same reasoning as `elicit_target_baseline`: a bare "yes" answers no
       * "give me a number from 0 to 1" question.
       */
      readonly kind: 'elicit_option_effect';
    } & ElicitOptionEffectFields)
  | ({
      /**
       * ROADMAP 2.1353 — the two value-ask exits' offered cells.
       *
       * Server-only: never chip-derived, and it introduces no wire-level
       * `action_type`. Persisted in the existing `pending_actions` JSONB
       * column, whose DB CHECK enforces only array + length <= 3, so no
       * migration is required.
       *
       * Deliberately ABSENT from `CONFIRMATION_EXPECTING_ACTION_TYPES`, on the
       * same reasoning as `elicit_option_effect`: a bare "yes" answers no
       * "which of these does your number belong to?" question.
       */
      readonly kind: 'elicit_effect_target';
    } & ElicitEffectTargetFields)
  | ({
      /**
       * ROADMAP 2.1353 — the two Stage-4A edit-clarify intercepts' offered
       * targets. Server-only, no wire `action_type`, no migration; and
       * deliberately absent from `CONFIRMATION_EXPECTING_ACTION_TYPES`,
       * because a bare "yes" answers no "which factor, edge, option or value?"
       * question either.
       */
      readonly kind: 'elicit_edit_target';
    } & ElicitEditTargetFields)
  | {
      /**
       * V5 P0 proposal-memory continuation. Captures a noun-phrase
       * concept extracted from the prior assistant turn's Sonnet-emitted
       * "add X as a factor" / "would you like me to add X" proposal.
       *
       * Server-only. Never derived from a user-facing chip. Read on the
       * next user turn by `decideNoOpRecovery` in `edit-graph-dispatch`
       * to drive the deterministic two-stage clarifier. The kind does
       * NOT auto-apply a graph mutation; the resumer always emits
       * either a Stage 1 (risk/factor/note) or Stage 2 (affect target)
       * clarification.
       *
       * Persisted in JSONB via the existing `pending_actions` column;
       * the DB CHECK constraint enforces only array + length <= 3, so
       * no migration is required to add the kind. Per-element shape
       * is validated by `parsePendingAction` below.
       */
      readonly kind: 'proposed_concept';
      readonly concept: string;
      readonly preferred_kind: 'risk' | 'factor' | 'either';
      /** Stable public copy captured at emit time. */
      readonly public_label: string;
      readonly public_message: string;
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
  'proposed_concept',
  // ROADMAP 2.63 C3/C4 — resumed by route-v2's draft-offer pre-route,
  // NOT by TurnExecutor's bare-confirm resumer (which cannot draft and
  // falls through with `kind_not_yet_resumable`).
  'draft_graph',
  // Clarify v2 (E0-B): resumed exclusively by the clarify-v2 pre-route in
  // route-v2 (flag-gated). Deliberately ABSENT from the short-confirm
  // resumer's local RESUMABLE_KINDS — a bare "yes" against a live clarify
  // round is claimed by the clarify-v2 resume itself (proceed-with-defaults),
  // never by TurnExecutor's pending-action synthesis.
  'clarify_v2_round',
  // ROADMAP 2.918 — resumed by the turn-executor's baseline-elicitation
  // pre-route (answer-shaped message only), and read directly by the
  // add_constraint handler to license the elliptical answer grammar.
  // Deliberately ABSENT from the short-confirm resumer's local
  // RESUMABLE_KINDS: a bare "yes" answers no percent question.
  'elicit_target_baseline',
  // ROADMAP 2.1352 — the configure-option clarify intercept's asked cell.
  // MANDATORY here even though no deterministic resumer claims it yet:
  // `parsePendingAction` gates every read on this set, so a kind omitted from
  // it is WRITE-ONLY and cannot be read back at all. Its readers today are the
  // context projection (`most_recent_pending_actions` → the ContextPack the
  // model sees) and `derivePendingActivity`'s ORIENT tally — the same tally
  // that reported `pending_action_count: 0` on the turn this fixes.
  // Deliberately ABSENT from the short-confirm resumer's local
  // RESUMABLE_KINDS: a bare "yes" answers no "give me a number" question.
  'elicit_option_effect',
  // ROADMAP 2.1353 — the value-ask and edit-clarify exits' offered referents.
  // MANDATORY here for the SAME structural reason 2.1352 records above, and it
  // is worth restating because it is not obvious from the set's name:
  // `parsePendingAction` gates EVERY read on this set, so a kind omitted from
  // it is WRITE-ONLY — it would round-trip to the column and then be dropped on
  // the way back out, which is indistinguishable from never having persisted
  // it. Readers today are the context projection
  // (`most_recent_pending_actions`) and `derivePendingActivity`'s ORIENT tally.
  // Both are deliberately ABSENT from the short-confirm resumer's local
  // RESUMABLE_KINDS: a bare "yes" answers neither question.
  'elicit_effect_target',
  'elicit_edit_target',
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
 *
 * These remain the bounds for every OFFER kind — the pendings a bare "yes" or
 * a chip click resolves. Recorded ASKS get their own, much longer bounds; see
 * {@link PENDING_ACTION_ASK_TURN_TTL} and the two-harm note beneath it.
 */
export const PENDING_ACTION_DEFAULT_TURN_TTL = 2;
export const PENDING_ACTION_DEFAULT_WALL_TTL_MS = 10 * 60 * 1000;

/**
 * ⭐ RECORDED-ASK LIFETIME — TWO HARMS, TWO DIALS, AND WHY THEY CANNOT BE ONE
 * NUMBER (2026-08-31, from a measured production session).
 *
 * THE DEFECT. A `configure_option` clarify recorded the question "for OPTION on
 * FACTOR, give me a number from 0 to 1" and armed an `elicit_option_effect`
 * pending at the DEFAULT bounds — 2 turns / 10 minutes. In the session that
 * prompted this change (CEE staging, 2026-08-31, scenario `528e00b0…`), the
 * SECOND such ask was emitted at 13:13:36Z, carried through two unrelated
 * `direct_answer` turns, and was dropped by the turn-count leg at 13:15:30Z —
 * **114 seconds after the product asked the question, having never seen an
 * answer attempt**. The user's bare numeric answers arrived at 13:38:45Z and
 * 13:39:07Z, ~25 minutes and six turns later, against an UNCHANGED graph
 * (`current_graph_hash` held at `dcc8b4d1…` across every one of those turns).
 * By then `resolveRecordedOptionEffectAnswer` had no live claimant, so the
 * number fell through to the LLM and was refused. The product asked a
 * question, closed the window for answering it, then spent half an hour asking
 * again.
 *
 * WHY WIDENING ONE NUMBER WOULD BE THE WRONG FIX. The default bounds are not
 * arbitrary: they exist to stop a STALE pending hijacking an unrelated later
 * turn — the user has moved on, and a bare "60%" three topics later must not
 * silently bind to a forgotten offer. That harm is real and this change must
 * not reopen it. But the two harms are not two ends of one scale:
 *
 *   · "the window closed too early" is a question about ELAPSED CONVERSATION;
 *   · "a stale action hijacked a later turn" is a question about whether the
 *     WORLD HAS MOVED — has the graph changed, has the referent gone, has the
 *     cell already been filled, is some other ask now competing for the same
 *     bare number?
 *
 * A three-second-old ask against a graph that just changed must refuse. A
 * twenty-eight-minute-old ask against an unchanged graph whose cell is still
 * empty must bind. **No single threshold expresses both**, and the shipped
 * design failed in both directions precisely because the clock was doing both
 * jobs at once. So:
 *
 *   · DIAL A — this window ({@link PENDING_ACTION_ASK_TURN_TTL},
 *     {@link PENDING_ACTION_ASK_WALL_TTL_MS}) guards "closed too early". It is
 *     a bound on how long the product REMEMBERS having asked.
 *   · DIAL B — the RELEVANCE PRECONDITION at bind time guards "stale hijack".
 *     It is not a clock. For `elicit_option_effect` it is
 *     `resolveRecordedOptionEffectAnswer`'s chain: the pinned
 *     `preconditions.graph_hash` must still equal the live
 *     `computeAnalysisAffectingGraphHash`, the option and factor nodes must
 *     still resolve to exactly one node each of the right kind, the (option,
 *     factor) cell must still be MISSING in the current readiness, and the ask
 *     must be the SOLE live claimant on a bare number. For
 *     `elicit_target_baseline` it is `tryBaselineElicitationResume`'s:
 *     `graphHashConflicts` (fail-closed when either hash is absent), the target
 *     node must still carry a live label, and the answer must classify as bound
 *     against every competing label in the live graph.
 *
 * Widening dial A moves load onto dial B, which is why membership in
 * {@link PENDING_KIND_IS_RECORDED_ASK} is granted ONLY to kinds that have such
 * a gate — see that map's own note.
 *
 * WHERE THE NUMBERS COME FROM — the measured distribution, not intuition.
 * Render logs for CEE staging, 2026-08-29T00:00Z → 2026-08-31T14:00Z: 249
 * `elicit_*` pendings created; for the 24 of them followed by a turn carrying a
 * parsed quantity (the closest available proxy for "the user tried to answer
 * with a number"), the ask → answer latency was median 17s, p75 339s, p90 897s,
 * p95 1509s, max 5066s, and the number of INTERVENING turns was median 0, p90 1,
 * p95 4, max 10.
 *
 *   · 30 minutes covers 96% of those follow-ups where the shipped 10 minutes
 *     covers 83%. 45 and 60 minutes cover no additional case in this sample —
 *     the single miss is 84 minutes, which is a resumed session rather than a
 *     late answer, so the window stops at 30.
 *   · 12 intervening turns covers 100% where the shipped 2 covers 92%; the
 *     observed maximum is 10, and 12 leaves headroom without being unbounded.
 *
 * Both remain REAL bounds: at 31 minutes, or after 13 carried turns, a recorded
 * ask is expired exactly as before. This is a longer window, not an immortal one.
 */
export const PENDING_ACTION_ASK_TURN_TTL = 12;
export const PENDING_ACTION_ASK_WALL_TTL_MS = 30 * 60 * 1000;

/**
 * WHICH KINDS ARE RECORDED ASKS — i.e. which get {@link
 * PENDING_ACTION_ASK_TURN_TTL} / {@link PENDING_ACTION_ASK_WALL_TTL_MS}
 * instead of the defaults.
 *
 * Exhaustive `Record<PendingActionKind, boolean>` on purpose: adding a kind to
 * the union is a COMPILE ERROR until it is classified here, so the set is
 * derived from the type rather than mirrored beside it (trap 12 — a
 * hand-maintained list drifts silently, and here the drift would read as a
 * confident wrong bind on a number the user meant for something else).
 * Same construction as {@link PENDING_KIND_CLAIMS_BARE_NUMBER}.
 *
 * MEMBERSHIP IS NOT "IS IT AN ELICITATION?" — it is the conjunction of two
 * claims, and both must hold, because dial A is only safe where dial B exists:
 *
 *   1. **A bare "yes" or a chip click can never resolve it.** Every member is
 *      absent from `RESUMABLE_KINDS` (deterministic-short-confirm.ts) and from
 *      {@link CONFIRMATION_EXPECTING_ACTION_TYPES}, so a longer window cannot
 *      make a stray confirmation bind to a forgotten offer. The only thing that
 *      can resolve a member is a bare NUMBER or a menu index.
 *   2. **Its bind path re-validates the answer against the CURRENT graph.**
 *      `elicit_option_effect` → `resolveRecordedOptionEffectAnswer`;
 *      `elicit_target_baseline` → `tryBaselineElicitationResume`. Both refuse on
 *      a moved graph hash, a vanished referent, or a competing claimant.
 *
 * `elicit_effect_target` and `elicit_edit_target` are members even though they
 * have NO bind path today (they are recorded-only — see the "NO RESUMER IS
 * ADDED BY THIS FILE" ruling in routing/persist-asked-question.ts). They are in
 * for a reason that would be easy to get backwards: they participate in
 * {@link PENDING_KIND_CLAIMS_BARE_NUMBER}, so their liveness is what makes a
 * bare number AMBIGUOUS between two open questions. Widening the answerable
 * kinds while leaving these on the short window would let an
 * `elicit_option_effect` from three turns earlier quietly WIN a number the user
 * typed in answer to a "which of these does it belong to?" that had just
 * expired out of the claimant set — the exact stale-hijack harm, manufactured
 * by an asymmetric widening. The claimant set has to move as one.
 *
 * ⚠⚠ AND THAT RULE IS NOT SATISFIED BY THIS MAP ALONE — it was stated here and
 * then broken by this map's own membership (adversarial review, 2026-08-31).
 * {@link PENDING_KIND_CLAIMS_BARE_NUMBER} has SEVEN true members and this map
 * widens FOUR, leaving `set_factor_value`, `clarify_v2_round` and
 * `proposed_concept` on the short window — so the claimant set decays unevenly
 * exactly as the paragraph above warns. Widening those three is NOT the fix
 * (two of them have no dial B; see the derivation on
 * {@link enforceSymmetricClaimWindow}). The evenness is enforced separately, by
 * clamping every recorded ask back to the defaults whenever a short-window
 * claimant is live beside it. **Read that function before changing this map:
 * membership here is only half the rule.**
 *
 * Every non-member keeps the default bounds unchanged.
 */
export const PENDING_KIND_IS_RECORDED_ASK: Record<PendingActionKind, boolean> = {
  // Recorded questions. Answerable only by a bare number or a menu index, and
  // every bind path re-checks the live graph before it binds.
  elicit_target_baseline: true, // "Roughly what percentage is X at right now?"
  elicit_option_effect: true, // "give me a number from 0 to 1"
  elicit_effect_target: true, // "which of these does your number belong to?"
  elicit_edit_target: true, // "which factor, edge, option or value?"
  // Offers and holds. A bare "yes", a chip click or a follow-up parameter
  // resolves these, so a longer window IS the stale-hijack harm. Unchanged.
  run_analysis: false,
  what_would_flip: false,
  draft_graph: false,
  apply_proposed_change: false,
  proposed_concept: false,
  clarify_v2_round: false,
  set_factor_value: false,
  edit_graph_add_risk: false,
};

/**
 * Stamp the recorded-ask lifetime onto ONE pending action being created THIS
 * turn. Pure; clock injected. Non-members are returned by identity.
 *
 * MONOTONE BY CONSTRUCTION — it only ever WIDENS. A caller that deliberately
 * armed an ask wider than these bounds (or a future kind-specific TTL) keeps
 * its own value; this function can never shorten a window somebody else opened.
 * That direction matters: a normaliser that could shorten would be a second,
 * invisible expiry authority sitting underneath every creation site.
 *
 * ⚠ IT DOES NOT REPAIR A MALFORMED EXPIRY. {@link isPendingActionExpired}
 * treats an unparseable `expires_at_iso` as expired — fail-closed, because an
 * action whose freshness cannot be verified must never be treated as live.
 * Widening a malformed stamp into a valid one would silently convert that
 * fail-closed verdict into a 30-minute live window, so a malformed
 * `expires_at_iso` (or a non-finite turn count) is passed through untouched and
 * stays expired.
 *
 * ⚠ APPLY TO THIS TURN'S OWN NEW PENDINGS ONLY, NEVER TO CARRY-FORWARD
 * SURVIVORS. `computeSurvivingPriorPendingsDetailed` decrements the turn count
 * once per carried turn; re-stamping a survivor would reset that decrement
 * every turn and make the ask immortal, which is the opposite harm this file's
 * two-dial note exists to prevent.
 */
export function withRecordedAskLifetime(pa: PendingAction, nowMs: number): PendingAction {
  if (!PENDING_KIND_IS_RECORDED_ASK[pa.action.kind]) return pa;

  const currentTurns = pa.expires_at_turn_count;
  const nextTurns =
    Number.isFinite(currentTurns) && currentTurns > PENDING_ACTION_ASK_TURN_TTL
      ? currentTurns
      : Number.isFinite(currentTurns)
        ? PENDING_ACTION_ASK_TURN_TTL
        : currentTurns;

  const currentExpiryMs = Date.parse(pa.expires_at_iso);
  let nextExpiryIso = pa.expires_at_iso;
  if (Number.isFinite(currentExpiryMs)) {
    // Base the floor on when the question was ASKED, not on `nowMs`: the
    // commit seam runs some milliseconds after the emit, and the two must not
    // drift apart across re-stamps.
    const emittedMs = Date.parse(pa.emitted_at_iso);
    const baseMs = Number.isFinite(emittedMs) ? emittedMs : nowMs;
    const floorMs = baseMs + PENDING_ACTION_ASK_WALL_TTL_MS;
    if (floorMs > currentExpiryMs) nextExpiryIso = new Date(floorMs).toISOString();
  }

  if (nextTurns === currentTurns && nextExpiryIso === pa.expires_at_iso) return pa;
  return { ...pa, expires_at_turn_count: nextTurns, expires_at_iso: nextExpiryIso };
}

/**
 * {@link withRecordedAskLifetime} over this turn's new pendings. Returns the
 * input array by identity when nothing changed, so a commit that arms no
 * recorded ask allocates nothing.
 */
export function applyRecordedAskLifetimes(
  pendings: readonly PendingAction[],
  nowMs: number,
): readonly PendingAction[] {
  let changed = false;
  const out = pendings.map((pa) => {
    const next = withRecordedAskLifetime(pa, nowMs);
    if (next !== pa) changed = true;
    return next;
  });
  return changed ? out : pendings;
}

/**
 * ⭐⭐ THE CLAIMANT SET MOVES AS ONE — the asymmetry this file's own note
 * demanded and its first implementation did not deliver (adversarial review,
 * 2026-08-31).
 *
 * ── THE DEFECT, AND IT WAS MANUFACTURED BY THE FIX ABOVE ───────────────────
 * {@link PENDING_KIND_CLAIMS_BARE_NUMBER} has SEVEN true members;
 * {@link PENDING_KIND_IS_RECORDED_ASK} widens FOUR. The three left behind —
 * `set_factor_value`, `clarify_v2_round`, `proposed_concept` — still claim a
 * bare number, and still expire at 2 turns / 10 minutes. So:
 *
 *   turn T    a `clarify_v2_round` arms a NUMBERED MENU (TTL 2)
 *   turn T+3  the menu has expired; a widened `elicit_option_effect` (TTL 12)
 *             armed at T-1 is still live
 *   turn T+3  the user types "1", meaning the MENU INDEX
 *             → `repair-value-binding.ts:514-518` finds exactly one live
 *               claimant, so the ambiguity gate does not fire
 *             → `resolveRecordedOptionEffectAnswer` returns `bind`
 *             → 1 is written into the option/factor cell
 *
 * That is precisely the stale-hijack harm the two-dial note above exists to
 * prevent, newly created, with a 6x wider window. The ambiguity gate was never
 * wrong; it was reading a claimant set that had decayed unevenly underneath it.
 *
 * ── WHY NOT SIMPLY WIDEN ALL SEVEN ────────────────────────────────────────
 * Because membership in the widened set is a claim that dial B exists, and for
 * two of the three it does not. Derived at the mint sites, not assumed:
 *
 *   · `clarify_v2_round` (`clarify-v2-dispatch.ts:176`) mints
 *     `preconditions: {}` — NO graph hash. Carry-forward rule 4 can therefore
 *     never invalidate it, so a 30-minute window would be a 30-minute window
 *     with no relevance gate at all.
 *   · `proposed_concept` is the one claimant in
 *     {@link CONFIRMATION_EXPECTING_ACTION_TYPES}: a bare "yes" resolves it, so
 *     a longer window IS the stale-hijack harm in a second direction the
 *     widening cannot fail closed on.
 *   · `set_factor_value` (`rescale-cap-pending.ts:97-100`) does pin a hash, but
 *     widening one of the three and not the others leaves the set uneven again.
 *
 * So the two questions are named apart rather than aligned (trap 21): *"how
 * long may this ask be ANSWERED?"* stays with
 * {@link PENDING_KIND_IS_RECORDED_ASK}, and *"is the claimant set even?"* is
 * answered here. When the set is MIXED, nobody gets the long window — every
 * recorded ask is clamped back to the defaults so it expires alongside the
 * competitor that would otherwise have vanished from under it.
 *
 * ⛔ ONE-DIRECTIONAL, AND THAT IS THE WHOLE SAFETY ARGUMENT. This function can
 * only ever SHORTEN, and only when a competing short-window claimant is LIVE.
 * It cannot widen anything, so it can introduce no new binding that was not
 * already reachable; the worst it can do is decline a bind the user wanted,
 * which is the fail-closed direction (the number falls through exactly as it
 * did before the widening shipped). Identity is returned whenever the set is
 * unmixed, so the founder's journey — one recorded ask, no competitor — is
 * untouched.
 *
 * ⚠ MALFORMED VALUES PASS THROUGH UNTOUCHED. {@link isPendingActionExpired}
 * already treats an unparseable `expires_at_iso` as expired; rewriting one into
 * a valid clamp would convert that fail-closed verdict into a live window.
 */
export function isShortWindowBareNumberClaimant(kind: PendingActionKind): boolean {
  return PENDING_KIND_CLAIMS_BARE_NUMBER[kind] && !PENDING_KIND_IS_RECORDED_ASK[kind];
}

/**
 * Clamp ONE recorded ask back to the default bounds. Never widens; returns the
 * input by identity for a non-ask and for an ask already inside the defaults.
 *
 * ⚠ THE CALLER OWNS THE DECISION, and the separation is deliberate. Whether to
 * clamp is a property of the WHOLE pending set
 * ({@link recordedAskWindowMustClamp}); whether this particular pending changes
 * is a property of the pending. Folding the set-level test in here would make
 * the function answer it from whatever slice it happened to be handed — and the
 * competitor is routinely in a different slice from the ask, so it would look
 * right and clamp nothing.
 */
export function clampRecordedAskWindow(pa: PendingAction): PendingAction {
  if (!PENDING_KIND_IS_RECORDED_ASK[pa.action.kind]) return pa;

  const currentTurns = pa.expires_at_turn_count;
  const nextTurns =
    Number.isFinite(currentTurns) && currentTurns > PENDING_ACTION_DEFAULT_TURN_TTL
      ? PENDING_ACTION_DEFAULT_TURN_TTL
      : currentTurns;

  const currentExpiryMs = Date.parse(pa.expires_at_iso);
  const emittedMs = Date.parse(pa.emitted_at_iso);
  let nextExpiryIso = pa.expires_at_iso;
  if (Number.isFinite(currentExpiryMs) && Number.isFinite(emittedMs)) {
    const ceilMs = emittedMs + PENDING_ACTION_DEFAULT_WALL_TTL_MS;
    if (ceilMs < currentExpiryMs) nextExpiryIso = new Date(ceilMs).toISOString();
  }

  if (nextTurns === currentTurns && nextExpiryIso === pa.expires_at_iso) return pa;
  return { ...pa, expires_at_turn_count: nextTurns, expires_at_iso: nextExpiryIso };
}

/**
 * True when the pending set contains a LIVE bare-number claimant that does not
 * get the widened window — i.e. the set is mixed and the asks must come back
 * down to meet it.
 */
export function recordedAskWindowMustClamp(
  pendings: readonly PendingAction[],
  nowMs: number,
): boolean {
  return pendings.some(
    (pa) =>
      isShortWindowBareNumberClaimant(pa.action.kind) &&
      !isPendingActionExpired(pa, nowMs),
  );
}

/**
 * {@link clampRecordedAskWindow} over a pending set, UNCONDITIONALLY. Returns the
 * input by identity when nothing needed clamping.
 *
 * ⚠ SEPARATED FROM THE DECISION ON PURPOSE. The persisted set arrives in two
 * halves — this turn's own pendings and the carry-forward survivors — and the
 * competitor is routinely in the OTHER half from the ask. A convenience that
 * re-decided per array would therefore look right and clamp nothing: the caller
 * must take {@link recordedAskWindowMustClamp} over the UNION once, then apply
 * this to each half. (Caught before landing; it is the same shape as a
 * per-item probe that answers from the wrong scope.)
 */
export function clampRecordedAskWindows(
  pendings: readonly PendingAction[],
): readonly PendingAction[] {
  let changed = false;
  const out = pendings.map((pa) => {
    const next = clampRecordedAskWindow(pa);
    if (next !== pa) changed = true;
    return next;
  });
  return changed ? out : pendings;
}

/**
 * Decide-and-apply over a SINGLE set that already contains both the asks and
 * their competitors. Convenience for callers holding one list; the commit seam
 * uses the two-step form above because its set arrives in halves.
 */
export function enforceSymmetricClaimWindow(
  pendings: readonly PendingAction[],
  nowMs: number,
): readonly PendingAction[] {
  if (!recordedAskWindowMustClamp(pendings, nowMs)) return pendings;
  return clampRecordedAskWindows(pendings);
}

/**
 * Cap mirrors `MAX_CHIPS` in chip-generator.ts. Enforced at both the
 * derive site and the DB CHECK constraint.
 */
export const PENDING_ACTIONS_PER_TURN_CAP = 3;

/**
 * The kinds whose live presence means "the next user turn is expected to
 * confirm or dismiss a pending change" — the semantic the ContextPack's
 * `conversation.pending_confirmation` boolean carries (see the assembler's
 * field doc and spec §10:444's original patch framing).
 *
 * PROPOSE-THEN-DECIDE kinds only — a system-surfaced proposal whose immediate
 * next turn is the user's accept/decline:
 *   - `apply_proposed_change` — the G7/G8 propose-then-confirm patch.
 *   - `proposed_concept` — a system-initiated "would you like me to add X?"
 *     concept memory; the next turn agrees (→ a follow-up clarifier fires) or
 *     declines. Agreement leading to a refinement does not change that the
 *     immediate expectation is accept/decline.
 *
 * Deliberately EXCLUDED:
 *   - `set_factor_value` / `edit_graph_add_risk` — CLARIFICATION-CONTINUATION
 *     pendings. The change is already DECIDED (value parsed / risk named); the
 *     pending only carries it across a TARGET-disambiguation turn ("which
 *     factor?" / "what does it affect?"). The next turn supplies a parameter,
 *     not a confirm/dismiss — counting them would mislabel clarification state
 *     as proposal-confirmation to the router.
 *   - `run_analysis` / `what_would_flip` — chip suggestion offers; chips derive
 *     pending actions after most analysis turns, so counting them would leave
 *     the flag near-constant-true for `PENDING_ACTION_DEFAULT_TURN_TTL` turns.
 *   - `draft_graph` (ROADMAP 2.63 C3/C4) — an OFFER, resolved at ROUTE level
 *     only (route-v2's draft-offer pre-route). Deliberately excluded so a bare
 *     "yes" while a real consent hold is live keeps resolving the hold
 *     (F-HELD consent-priority); the draft/redraft offer then requires its
 *     named public copy. Including it would also route its lapse through
 *     `buildHeldLapseNotice`'s "held change" copy, which misdescribes an
 *     offer to draft.
 *
 * All kinds (including the excluded ones) remain visible in the frame's
 * pending diagnostics COUNTS regardless of this set.
 */
export const CONFIRMATION_EXPECTING_ACTION_TYPES: ReadonlySet<PendingActionKind> = new Set([
  'apply_proposed_change',
  'proposed_concept',
]);

/**
 * Single liveness authority for a persisted pending action at READ time.
 *
 * IMPORTANT: `SessionStore.readMostRecentPendingActions` does NOT filter
 * expiry (parse + scenario checks only), so wall-expired entries DO reach
 * `EnrichedTurnContext.most_recent_pending_actions`. Every consumer that
 * needs "live" truth must apply this predicate; `length > 0` on the raw
 * list is NOT a liveness claim.
 *
 * Semantics (extracted verbatim from the short-confirm resumer's
 * `isExpired`, which the route-level proposal-confirm suppressor mirrors):
 *   - malformed `expires_at_iso` → expired (fail-closed: never treat an
 *     action whose freshness we can't verify as live);
 *   - `nowMs > expires_at_iso` → expired (wall-clock TTL);
 *   - `expires_at_turn_count <= 0` → expired (turn-count TTL;
 *     carry-forward decrements and drops at persistence, so a non-positive
 *     count reaching a read is defence-in-depth).
 *
 * Deliberately DIFFERENT predicates that must NOT delegate here:
 *   - carry-forward survival in `commit.ts` (decrement-then-drop +
 *     consume/supersede/graph-hash rules);
 *   - `isProposedConceptExpired` in `coaching/proposal-continuation.ts`
 *     (wall-clock only, documented there).
 */
export function isPendingActionExpired(pa: PendingAction, nowMs: number): boolean {
  const expiresMs = Date.parse(pa.expires_at_iso);
  if (!Number.isFinite(expiresMs)) return true;
  if (nowMs > expiresMs) return true;
  if (pa.expires_at_turn_count <= 0) return true;
  return false;
}

/** Live = not expired per {@link isPendingActionExpired}. Order-preserving. */
export function filterLivePendingActions(
  pendings: readonly PendingAction[],
  nowMs: number,
): readonly PendingAction[] {
  return pendings.filter((pa) => !isPendingActionExpired(pa, nowMs));
}

/** A pending baseline question, narrowed to its kind. */
export type ElicitTargetBaselinePending = PendingAction & {
  readonly action: { readonly kind: 'elicit_target_baseline' } & ElicitTargetBaselineFields;
};

/**
 * R2918B — WHICH PENDING KINDS A BARE NUMBER COULD BE ANSWERING.
 *
 * Exhaustive `Record<PendingActionKind, boolean>`: adding a kind to the union
 * is a COMPILE ERROR until it is classified here, so this is derived from the
 * type rather than mirrored beside it (trap 12 — a hand-maintained list would
 * drift silently, and the drift would read as a confident wrong bind).
 *
 * Membership is a claim about the QUESTION, not about the answer: "can a
 * message that is nothing but a number be an answer to this ask?" If two such
 * asks are live at once, a bare number is genuinely ambiguous between them and
 * the elliptical carry must refuse.
 */
export const PENDING_KIND_CLAIMS_BARE_NUMBER: Record<PendingActionKind, boolean> = {
  // The asks whose natural answer IS a bare number, or a bare menu index.
  elicit_target_baseline: true, // "Roughly what percentage is X at right now?"
  elicit_option_effect: true, // "give me a number from 0 to 1"
  elicit_effect_target: true, // "which of these does your number belong to?"
  elicit_edit_target: true, // "which factor, edge, option or value?"
  set_factor_value: true, // a held quantity awaiting a target; "12" re-states it
  clarify_v2_round: true, // a clarify round may offer numbered choices
  proposed_concept: true, // the two-stage clarifier offers a choice
  // The asks a bare number CANNOT be answering: each expects a confirmation or
  // a chip click. This is the same reasoning
  // `CONFIRMATION_EXPECTING_ACTION_TYPES` records one level up, and it is why
  // the gate is not simply "sole among ALL live pendings": the receipt that
  // ASKS the baseline question routinely ships a "Run the analysis" chip in the
  // same commit, so an all-kinds rule would have made the feature unreachable.
  run_analysis: false,
  what_would_flip: false,
  draft_graph: false,
  apply_proposed_change: false,
  edit_graph_add_risk: false,
};

/**
 * ROADMAP 2.918, widened by R2918B — THE question-context gate for the
 * elliptical answer grammar. Returns the pending baseline question if and only
 * if it is the SOLE live ask that a bare number could be answering.
 *
 * As shipped this filtered to `elicit_target_baseline` first and only then
 * required "exactly one", so a competing ask of a different kind was invisible
 * to it and a bare "12%" bound to the baseline question no matter which
 * question the user meant. Widening it is a precondition of hearing a bare
 * "30": the other number-asking kinds take bare numbers too, so the looser
 * grammar would otherwise have made a pre-existing mis-binding much easier to
 * reach. Two live baseline questions still make a
 * bare "about 12%" ambiguous between targets, so it binds neither (the same
 * unanimity doctrine as the extractor's competitor rule, one level up).
 * Liveness via the shared predicate; `null` in every other case, so every
 * caller fails closed by construction.
 */
export function findSoleLiveElicitBaselinePending(
  pendings: readonly PendingAction[] | undefined,
  nowMs: number,
): ElicitTargetBaselinePending | null {
  // LIVENESS, then CLAIMANTS, then IDENTITY. The order matters: filtering to
  // the baseline kind FIRST (the shipped order) counts competitors out of
  // existence before they can block anything.
  const claimants = filterLivePendingActions(pendings ?? [], nowMs).filter(
    (pa) => PENDING_KIND_CLAIMS_BARE_NUMBER[pa.action.kind],
  );
  if (claimants.length !== 1) return null;
  const sole = claimants[0]!;
  if (sole.action.kind !== 'elicit_target_baseline') return null;
  return sole as ElicitTargetBaselinePending;
}

/**
 * Redacted read-time tally of prior-turn pending actions. Counts + closed-enum
 * kind counts only. `confirmationExpectingLiveCount` counts live pendings whose
 * kind is in {@link CONFIRMATION_EXPECTING_ACTION_TYPES} — the value the caller
 * gates behind the kill-switch to derive `pending_confirmation`.
 */
export interface PendingActivityTally {
  /** Live (non-expired) pending actions. */
  readonly liveCount: number;
  /** Present in the read but expired (wall or turn TTL). */
  readonly expiredCount: number;
  /** Live counts by kind (closed-enum keys; absent kind ⇒ zero). */
  readonly kinds: Partial<Record<PendingActionKind, number>>;
  /** Live entries whose kind is confirmation-expecting. */
  readonly confirmationExpectingLiveCount: number;
}

/**
 * The SINGLE ORIENT-time derivation of pending truth: one pass over the (≤
 * `PENDING_ACTIONS_PER_TURN_CAP`) prior-turn pendings that classifies liveness
 * (via the shared predicate) and tallies live count, per-kind counts, and the
 * confirmation-expecting live count together. Pure; the caller applies the
 * kill-switch (`pending_confirmation = flagOn && confirmationExpectingLiveCount
 * > 0`) and adds the `threaded` flag / commit-time `lifecycle` for the frame
 * diagnostics. Extracted so every kind's confirmation-expecting contribution is
 * unit-testable in isolation, independent of routing.
 */
export function derivePendingActivity(
  pendings: readonly PendingAction[],
  nowMs: number,
): PendingActivityTally {
  const kinds: Partial<Record<PendingActionKind, number>> = {};
  let liveCount = 0;
  let confirmationExpectingLiveCount = 0;
  for (const pa of pendings) {
    if (isPendingActionExpired(pa, nowMs)) continue;
    liveCount += 1;
    kinds[pa.action.kind] = (kinds[pa.action.kind] ?? 0) + 1;
    if (CONFIRMATION_EXPECTING_ACTION_TYPES.has(pa.action.kind)) {
      confirmationExpectingLiveCount += 1;
    }
  }
  return {
    liveCount,
    expiredCount: pendings.length - liveCount,
    kinds,
    confirmationExpectingLiveCount,
  };
}

/**
 * Redacted per-turn pending-action lifecycle tally (Track 2). Integer counts
 * only — never ids, labels, messages or patch content. Produced by the
 * commit-time carry-forward pass so the proposed → held → refused → applied →
 * expired lifecycle is DIAGNOSABLE without a second state authority. Each
 * prior pending is attributed to the FIRST matching drop reason (mirrors the
 * carry-forward short-circuit order: consumed → superseded → wall → hash →
 * turns), then a final `cap_dropped` bucket accounts for eligible survivors
 * evicted by the per-turn `PENDING_ACTIONS_PER_TURN_CAP` when this turn's own
 * pendings fill it. The seven fates partition the prior set exactly:
 * `consumed + superseded + expired_wall + expired_turns + hash_invalidated +
 * cap_dropped + survived === prior`. `survivedCount` therefore reflects what
 * ACTUALLY persisted (post-cap), NOT pre-cap eligibility.
 */
export interface PendingLifecycleSummary {
  /** Prior turn's pending actions entering carry-forward. */
  readonly priorCount: number;
  /** Consumed this turn (applied or dismissed via consumedPendingRefs). */
  readonly consumedCount: number;
  /** Superseded by a same-key offer emitted this turn (newer wins). */
  readonly supersededCount: number;
  /** Dropped by wall-clock TTL (or malformed expiry) at commit time. */
  readonly expiredWallCount: number;
  /** Dropped by turn-count TTL decrement reaching zero at commit time. */
  readonly expiredTurnsCount: number;
  /** Dropped because the emit-time graph hash no longer matches. */
  readonly hashInvalidatedCount: number;
  /**
   * Eligible to carry forward but evicted by the per-turn cap because this
   * turn's own pendings (offered FIRST) filled `PENDING_ACTIONS_PER_TURN_CAP`.
   * Zero at the pre-cap carry-forward pass; finalised at commit against
   * `finalPendings`.
   */
  readonly capDroppedCount: number;
  /** Carried forward into this turn's PERSISTED pending set (post-cap). */
  readonly survivedCount: number;
}

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
    // 1.16 item A2 — optional explicit cap (rescale chip). Absent on all
    // other emits; when present it must be a finite positive number, or
    // the entry is unresumable and refused at parse time.
    if (a.cap !== undefined && (typeof a.cap !== 'number' || !Number.isFinite(a.cap) || a.cap <= 0)) {
      return null;
    }
  }
  if (a.kind === 'edit_graph_add_risk') {
    if (typeof a.label !== 'string' || a.label.length === 0) return null;
  }
  if (a.kind === 'draft_graph') {
    // ROADMAP 2.63 C3/C4 — the offer's public copy is REQUIRED: the
    // route-level resume exact-matches the persisted copy against the
    // replayed message, so an entry without it is unresumable.
    if (typeof a.public_label !== 'string' || a.public_label.length === 0) return null;
    if (typeof a.public_message !== 'string' || a.public_message.length === 0) return null;
    // brief_seed is optional; when present it must be a non-empty bounded
    // string (normaliseBriefText caps at 8000 — mirror the DB bound here
    // so a corrupted row cannot smuggle an unbounded value to the draft
    // pipeline).
    if (
      a.brief_seed !== undefined &&
      (typeof a.brief_seed !== 'string' || a.brief_seed.length === 0 || a.brief_seed.length > 8000)
    ) {
      return null;
    }
    if (a.redraft !== undefined && typeof a.redraft !== 'boolean') return null;
  }
  if (a.kind === 'clarify_v2_round') {
    // Clarify v2 (E0-B). The working brief must be a non-empty string
    // within the draft pipeline's max (5000 — mirrored numerically here so
    // this leaf module stays dependency-free, same convention as the 120
    // cap on proposed_concept). asked_dimensions is a closed-set string
    // array (the rubric dimension names); round is a small positive int.
    // Anything else is unresumable and refused at parse time.
    if (typeof a.brief !== 'string' || a.brief.trim().length === 0) return null;
    if (a.brief.length > 5000) return null;
    if (!Array.isArray(a.asked_dimensions) || a.asked_dimensions.length > 8) return null;
    if (!a.asked_dimensions.every(isClarifyDimension)) return null;
    if (
      typeof a.round !== 'number' ||
      !Number.isInteger(a.round) ||
      a.round < 1 ||
      a.round > 5
    ) {
      return null;
    }
    // 1.152 (A1/A4): optional re-offer marker; anything but a boolean (or
    // absence) is a corrupted row and refused like the other fields.
    if (a.reoffered !== undefined && typeof a.reoffered !== 'boolean') return null;
    // 2.171: optional post-Stop start-over brief — same bounds as the working
    // brief (non-empty, draft max 5000) or the row is corrupted and refused.
    if (
      a.start_over_brief !== undefined &&
      (typeof a.start_over_brief !== 'string' ||
        a.start_over_brief.trim().length === 0 ||
        a.start_over_brief.length > 5000)
    ) {
      return null;
    }
  }
  if (a.kind === 'elicit_target_baseline') {
    // ROADMAP 2.918 — the question's target identity and the registered
    // row's replay shape are both REQUIRED to be well-formed, or the entry
    // is unresumable and refused at parse time (a corrupted row must never
    // license an elliptical bind or a replay).
    if (typeof a.target_id !== 'string' || a.target_id.length === 0) return null;
    if (typeof a.target_label !== 'string' || a.target_label.length === 0) return null;
    if (typeof a.constraint_type !== 'string') return null;
    if (!['at_least', 'at_most'].includes(a.constraint_type)) return null;
    if (typeof a.value !== 'number' || !Number.isFinite(a.value)) return null;
    if (a.unit !== undefined && (typeof a.unit !== 'string' || a.unit.length === 0)) return null;
    if (a.label !== undefined && (typeof a.label !== 'string' || a.label.length === 0)) return null;
  }
  if (a.kind === 'elicit_option_effect') {
    // ROADMAP 2.1352 — all four fields REQUIRED. The ids are the asked cell's
    // identity and the labels are the copy the user saw; a row missing any of
    // them cannot restate or rebind the question, so it is refused at parse
    // time rather than surfacing as a pending that names nothing.
    //
    // ⚠ THIS BLOCK IS NOT OPTIONAL. `parsePendingAction` is a flat `if` chain,
    // NOT a switch: a kind admitted to RESUMABLE_ACTION_TYPES with no block
    // here passes the envelope checks and is returned by a CAST, so a corrupted
    // row would reach the readers with zero field validation.
    if (typeof a.option_id !== 'string' || a.option_id.length === 0) return null;
    if (typeof a.option_label !== 'string' || a.option_label.length === 0) return null;
    if (typeof a.factor_id !== 'string' || a.factor_id.length === 0) return null;
    if (typeof a.factor_label !== 'string' || a.factor_label.length === 0) return null;
  }
  if (a.kind === 'elicit_effect_target') {
    // ROADMAP 2.1353 — all three fields REQUIRED, and `candidates` NON-EMPTY.
    //
    // ⚠ SAME NON-OPTIONAL BLOCK AS ABOVE, for the same reason: this is a flat
    // `if` chain, NOT a switch. A kind admitted to RESUMABLE_ACTION_TYPES with
    // no block here clears the envelope checks and is returned by a CAST, so a
    // corrupted row would reach the readers with zero field validation.
    //
    // An EMPTY candidate list is refused rather than tolerated: this pending's
    // whole purpose is to name the set a reply can choose from, and a row that
    // names none can neither restate the question nor bind an answer. The emit
    // sites already decline in that state; this refuses it at the read too, so
    // a hand-written or partially-migrated row cannot surface as a pending that
    // names nothing.
    if (a.source !== 'repair_value_ask' && a.source !== 'option_effect_ask') return null;
    if (typeof a.value_text !== 'string' || a.value_text.length === 0) return null;
    if (!Array.isArray(a.candidates) || a.candidates.length === 0) return null;
    for (const raw of a.candidates as readonly unknown[]) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const c = raw as Record<string, unknown>;
      if (typeof c.option_id !== 'string' || c.option_id.length === 0) return null;
      if (typeof c.option_label !== 'string' || c.option_label.length === 0) return null;
      if (typeof c.factor_id !== 'string' || c.factor_id.length === 0) return null;
      if (typeof c.factor_label !== 'string' || c.factor_label.length === 0) return null;
    }
  }
  if (a.kind === 'elicit_edit_target') {
    // ROADMAP 2.1353 — both fields REQUIRED, `offered_targets` NON-EMPTY.
    // Same flat-chain reasoning as the two blocks above. `reason` is a closed
    // set because it is the composer's own `EditClarifyReason`, and a row
    // carrying a third value could not be attributed to either intercept.
    if (a.reason !== 'chip_simplify' && a.reason !== 'vague_edit') return null;
    if (!Array.isArray(a.offered_targets) || a.offered_targets.length === 0) return null;
    for (const raw of a.offered_targets as readonly unknown[]) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const t = raw as Record<string, unknown>;
      if (typeof t.node_id !== 'string' || t.node_id.length === 0) return null;
      if (typeof t.label !== 'string' || t.label.length === 0) return null;
    }
  }
  if (a.kind === 'proposed_concept') {
    // V5 P0 proposal-memory continuation. Both fields REQUIRED.
    // concept is the noun-phrase captured from the prior assistant turn;
    // preferred_kind is the LLM's stated preference at emit time. The
    // resumer reads both to pick Stage 1 copy and Stage 2 chip routing.
    if (typeof a.concept !== 'string' || a.concept.length === 0) return null;
    if (a.concept.length > 120) return null;
    if (typeof a.preferred_kind !== 'string') return null;
    if (!['risk', 'factor', 'either'].includes(a.preferred_kind)) return null;
    // Public copy fields mirror the apply_proposed_change requirement so
    // the resumer always has user-safe strings to render even if the
    // helper module is missing.
    if (typeof a.public_label !== 'string' || a.public_label.length === 0) return null;
    if (typeof a.public_message !== 'string' || a.public_message.length === 0) return null;
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
