/** Server-read linkage of one applied receipt to its committed model version. */
export interface CommittedMutationTurnRef {
  readonly conversation_row_id: string;
  /** User/request turn identity, not the parent persistence-row UUID. */
  readonly source_turn_id: string;
  readonly scenario_id: string;
  readonly owner_user_id: string;
  readonly mutation_id: string;
}

/** Historical qualitative fact only; never a numerical effect or current-state claim. */
export interface CanonicalNodeLabelTransition {
  readonly kind: 'node_label_changed';
  readonly before_label: string;
  readonly after_label: string;
}

/** Missing lineage is lack of transition evidence, never lack of a receipt. */
export function readCommittedMutationTurnRef(value: unknown): CommittedMutationTurnRef | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const { conversation_row_id, source_turn_id, scenario_id, owner_user_id, mutation_id } = row;
  if (
    typeof conversation_row_id !== 'string' || conversation_row_id.trim().length === 0 ||
    typeof source_turn_id !== 'string' || source_turn_id.trim().length === 0 ||
    typeof scenario_id !== 'string' || scenario_id.trim().length === 0 ||
    typeof owner_user_id !== 'string' || owner_user_id.trim().length === 0 ||
    typeof mutation_id !== 'string' || mutation_id.trim().length === 0
  ) return null;
  return Object.freeze({
    conversation_row_id, source_turn_id, scenario_id, owner_user_id, mutation_id,
  });
}
