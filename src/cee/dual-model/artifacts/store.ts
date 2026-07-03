/**
 * Pure artifact-row construction core (quarantined scaffold).
 *
 * BOTH store implementations (in-memory and Supabase) build rows through
 * toArtifactRows, so caps, drop rules and truncation cannot drift between
 * them. Deterministic: same input → same rows + accounting.
 */
import {
  ARTIFACT_FIELD_CAPS,
  MAX_ARTIFACTS_PER_TURN,
  M2_ARTIFACT_TYPES,
  type AppendArtifactsInput,
  type AppendArtifactsResult,
  type M2ArtifactRecord,
  type M2ArtifactType,
} from './types.js';

/** Row shape both impls persist; id/created_at/status are storage-assigned. */
export type ArtifactRowDraft = Omit<M2ArtifactRecord, 'id' | 'created_at' | 'status'>;

export interface ToArtifactRowsResult {
  readonly rows: readonly ArtifactRowDraft[];
  readonly accounting: AppendArtifactsResult;
}

/** Trims, then hard-caps with a trailing ellipsis when over. */
export function truncateForStorage(
  text: string,
  cap: number,
): { readonly value: string; readonly truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= cap) return { value: trimmed, truncated: false };
  return { value: `${trimmed.slice(0, cap - 1)}…`, truncated: true };
}

function isKnownType(type: string): type is M2ArtifactType {
  return (M2_ARTIFACT_TYPES as readonly string[]).includes(type);
}

/**
 * Maps a merge outcome's defer artifacts onto bounded row drafts:
 *   - index >= MAX_ARTIFACTS_PER_TURN → dropped_over_cap (defensive: the
 *     merge's PROPOSAL_CAP already bounds this — drift-guarded by test);
 *   - unknown proposal type, or empty-after-trim question/evidence_pointer
 *     → rejected_invalid (the SQL CHECKs would refuse the row);
 *   - over-cap text fields → deterministically truncated, counted.
 */
export function toArtifactRows(input: AppendArtifactsInput): ToArtifactRowsResult {
  const rows: ArtifactRowDraft[] = [];
  let dropped_over_cap = 0;
  let truncated_fields = 0;
  let rejected_invalid = 0;

  input.artifacts.forEach((artifact, index) => {
    if (index >= MAX_ARTIFACTS_PER_TURN) {
      dropped_over_cap++;
      return;
    }
    if (!isKnownType(artifact.type)) {
      rejected_invalid++;
      return;
    }
    const question = truncateForStorage(artifact.question, ARTIFACT_FIELD_CAPS.question);
    const evidence = truncateForStorage(artifact.evidence_pointer, ARTIFACT_FIELD_CAPS.evidence_pointer);
    if (question.value.length === 0 || evidence.value.length === 0) {
      rejected_invalid++;
      return;
    }
    const rationale =
      artifact.rationale === null
        ? null
        : truncateForStorage(artifact.rationale, ARTIFACT_FIELD_CAPS.rationale);
    if (rationale?.truncated) truncated_fields++;
    if (question.truncated) truncated_fields++;
    if (evidence.truncated) truncated_fields++;

    rows.push({
      request_id: input.requestId,
      scenario_id: input.scenarioId,
      turn_id: input.turnId,
      graph_hash: input.graphHash,
      artifact_index: index,
      proposal_type: artifact.type,
      question: question.value,
      rationale: rationale === null || rationale.value.length === 0 ? null : rationale.value,
      evidence_pointer: evidence.value,
    });
  });

  return {
    rows,
    accounting: { appended: rows.length, dropped_over_cap, truncated_fields, rejected_invalid },
  };
}
