/**
 * Field Deletion Audit Telemetry
 *
 * Tracks individual field deletions across pipeline repair stages for
 * observability. Events are collected into trace.field_deletions in the
 * package stage, following the same pattern as trace.strp.mutations.
 *
 * Stages that produce field deletions:
 * - threshold-sweep (Stage 4b): goal_threshold fields stripped from goal nodes
 * - unreachable-factors (Stage 4 substep): value/factor_type/uncertainty_drivers stripped on reclassification
 * - deterministic-sweep (Stage 4 substep): Bucket B fixes strip category-inappropriate fields
 * - structural-reconciliation (Stage 2): category override strips controllable-only fields
 */

// =============================================================================
// Constants
// =============================================================================

/** Maximum field deletion events recorded per stage before truncation. */
export const MAX_FIELD_DELETIONS_PER_STAGE = 50;

// =============================================================================
// Types
// =============================================================================

/**
 * What a deletion REMOVED — the field this audit was missing.
 *
 * ⚠ AN AUDIT THAT RECORDS THAT A DELETION HAPPENED BUT NOT WHAT WAS DELETED
 * CANNOT SUPPORT ANY HONEST STATEMENT TO THE USER, AND CANNOT BE TESTED FOR
 * CORRECTNESS. It is trap 13's shape at the instrument level: an absence is
 * recorded with no way to prove what the absence is of. Measured consequence
 * (CEE build `32f06dd`, deployed capture 2026-08-10): `fac_support_cost` lost a
 * £1.8m baseline to `UNREACHABLE_FACTOR_RECLASSIFIED` and the user's receipt
 * said only that the category had changed.
 *
 * ⚠ EVERY FIELD HERE IS COPIED OUT OF THE PAYLOAD BEING MUTATED. Nothing in
 * this module reads the brief, and nothing may. ROADMAP 2.714 shipped a limb
 * that read a number out of free-brief prose and stamped it with the user's own
 * provenance (PR #853); it was measured committing values 10^6x wrong, values
 * the user had NEGATED, and values bound to the WRONG NODE, and was reverted 54
 * minutes later (#856). Reporting what the pipeline itself held is a different
 * act from re-reading what the user wrote, and only the first is safe.
 */
export interface PreviousFieldState {
  /** The value as the pipeline held it — usually cap-normalised, not a magnitude. */
  previous_value?: unknown;
  /** The un-normalised magnitude, when the node carried one (e.g. 1800000). */
  previous_raw_value?: number;
  /** The unit that gave the magnitude its meaning (e.g. '£', '%'). */
  previous_unit?: string;
  /** The cap the value was normalised against, when present. */
  previous_cap?: number;
  /**
   * The provenance the node carried BEFORE the mutation relabelled it.
   * ⚠ Read as a record of what the pipeline claimed, never as proof the user
   * said it: `brief_extraction` is a DEFAULT stamp applied to anything the
   * drafter did not self-declare as inferred, so it OVER-CLAIMS (ROADMAP 2.743).
   */
  previous_provenance?: string;
  /**
   * The Stated Ledger item this value came from — S3, unbuilt. NULL, always,
   * until a ledger exists. A minted id with no referent is worse than none.
   */
  stated_item_id?: string | null;
}

export interface FieldDeletionEvent extends PreviousFieldState {
  /** Pipeline stage that performed the deletion */
  stage: string;
  /** Node ID on which the field was deleted */
  node_id: string;
  /** Dotted field path (e.g. 'data.factor_type', 'goal_threshold') */
  field: string;
  /** Centralised reason code — see FIELD_DELETION_REASONS */
  reason: FieldDeletionReason;
  /** Optional metadata (used by TELEMETRY_CAP_REACHED summary events) */
  meta?: Record<string, unknown>;
}

// =============================================================================
// Reason codes (centralised SSOT)
// =============================================================================

export type FieldDeletionReason =
  | 'THRESHOLD_STRIPPED_NO_RAW'
  | 'THRESHOLD_STRIPPED_NO_DIGITS'
  | 'UNREACHABLE_FACTOR_RECLASSIFIED'
  | 'EXTERNAL_HAS_DATA'
  | 'OBSERVABLE_EXTRA_DATA'
  | 'CATEGORY_OVERRIDE_STRIP'
  | 'TELEMETRY_CAP_REACHED';

/**
 * Human-readable descriptions for each reason code.
 * Used in trace output for debugging.
 */
export const FIELD_DELETION_REASON_DESCRIPTIONS: Record<FieldDeletionReason, string> = {
  THRESHOLD_STRIPPED_NO_RAW: 'Goal threshold removed: no raw target value extracted from brief',
  THRESHOLD_STRIPPED_NO_DIGITS: 'Goal threshold removed: round number with no digits in label (likely inferred)',
  UNREACHABLE_FACTOR_RECLASSIFIED: 'Controllable-only field stripped during reclassification to external',
  EXTERNAL_HAS_DATA: 'Prohibited field removed from external factor',
  OBSERVABLE_EXTRA_DATA: 'Extra controllable-only field removed from observable factor',
  CATEGORY_OVERRIDE_STRIP: 'Controllable-only field stripped during STRP category override',
  TELEMETRY_CAP_REACHED: 'Per-stage field deletion telemetry cap reached; remaining events truncated',
};

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a FieldDeletionEvent. Convenience to avoid typos in inline construction.
 *
 * `previous` is OPTIONAL and OMITTED KEYS ARE NOT EMITTED, so every call site
 * that does not pass it produces the byte-identical event it produced before —
 * `trace.field_deletions` consumers see no change until a stage opts in.
 */
export function fieldDeletion(
  stage: string,
  nodeId: string,
  field: string,
  reason: FieldDeletionReason,
  previous?: PreviousFieldState,
): FieldDeletionEvent {
  const event: FieldDeletionEvent = { stage, node_id: nodeId, field, reason };
  if (previous === undefined) return event;
  // Assign only what is actually known. A key present with `undefined` reads as
  // "we looked and there was nothing"; an absent key reads as "we did not
  // look". Those are different claims and must not collapse.
  if ("previous_value" in previous) event.previous_value = previous.previous_value;
  if (previous.previous_raw_value !== undefined) event.previous_raw_value = previous.previous_raw_value;
  if (previous.previous_unit !== undefined) event.previous_unit = previous.previous_unit;
  if (previous.previous_cap !== undefined) event.previous_cap = previous.previous_cap;
  if (previous.previous_provenance !== undefined) event.previous_provenance = previous.previous_provenance;
  if ("stated_item_id" in previous) event.stated_item_id = previous.stated_item_id ?? null;
  return event;
}

/**
 * Record a batch of field deletion events onto ctx.fieldDeletions, enforcing
 * a per-stage cap of MAX_FIELD_DELETIONS_PER_STAGE. When the cap is reached,
 * a single TELEMETRY_CAP_REACHED summary event is appended and no further
 * events for that stage are recorded.
 */
export function recordFieldDeletions(
  ctx: { fieldDeletions?: FieldDeletionEvent[] },
  stage: string,
  events: FieldDeletionEvent[],
): void {
  if (events.length === 0) return;
  if (!ctx.fieldDeletions) ctx.fieldDeletions = [];

  // Count existing events for this stage (may be called more than once per stage)
  const existingForStage = ctx.fieldDeletions.filter((e) => e.stage === stage).length;

  // Already capped from a previous call?
  const alreadyCapped = ctx.fieldDeletions.some(
    (e) => e.stage === stage && e.reason === 'TELEMETRY_CAP_REACHED',
  );
  if (alreadyCapped) return;

  const remaining = MAX_FIELD_DELETIONS_PER_STAGE - existingForStage;
  if (remaining <= 0) {
    // Prior calls filled the cap exactly — emit the summary now
    ctx.fieldDeletions.push({
      stage,
      node_id: '__truncated__',
      field: '*',
      reason: 'TELEMETRY_CAP_REACHED',
      meta: { total: existingForStage + events.length, captured: MAX_FIELD_DELETIONS_PER_STAGE },
    });
    return;
  }

  if (events.length <= remaining) {
    ctx.fieldDeletions.push(...events);
  } else {
    ctx.fieldDeletions.push(...events.slice(0, remaining));
    ctx.fieldDeletions.push({
      stage,
      node_id: '__truncated__',
      field: '*',
      reason: 'TELEMETRY_CAP_REACHED',
      meta: { total: existingForStage + events.length, captured: MAX_FIELD_DELETIONS_PER_STAGE },
    });
  }
}
