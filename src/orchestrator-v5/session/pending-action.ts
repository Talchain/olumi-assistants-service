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
