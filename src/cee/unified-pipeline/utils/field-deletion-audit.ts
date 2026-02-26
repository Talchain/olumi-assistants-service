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
  | 'CATEGORY_OVERRIDE_STRIP';

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
};

// =============================================================================
// Helper
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
