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

export interface FieldDeletionEvent {
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
 */
export function fieldDeletion(
  stage: string,
  nodeId: string,
  field: string,
  reason: FieldDeletionReason,
): FieldDeletionEvent {
  return { stage, node_id: nodeId, field, reason };
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
