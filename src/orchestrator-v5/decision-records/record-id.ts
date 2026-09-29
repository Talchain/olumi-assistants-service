/**
 * Decision Records — deterministic record-id derivation, ONE implementation.
 *
 * ⭐ WHY THIS FILE EXISTS: THE ID-SPACE COLLISION (calibration R0, W4).
 *
 * `create_decision_record`'s replay branch returns the EXISTING record with
 * `deduped: true` whenever `p_record_id` already exists
 * (supabase/migrations/20260710113000_v5_decision_records.sql:510-533). The
 * auto-capture seam derives its id from `(scenario_id, graph_hash,
 * computed_at)` — so a USER COMMIT for the same analysed graph, derived the
 * same way, would land on the auto-captured record's id and be swallowed:
 * the RPC would return the model-derived record and the user's OWN stated
 * confidence would be **silently discarded**. That is a trust defect (the
 * product would claim to have recorded a forecast it threw away), and it is
 * the single most important thing this slice makes impossible.
 *
 * The fix is a SEPARATE NAMESPACE plus the submitting user and a per-commit
 * nonce, so a commit can never collide with an auto-capture and a genuinely
 * new commit can never collide with an earlier one.
 *
 * ⚠ ONE implementation of the UUID stamping, not two (CLAUDE.md trap 12 —
 * derive, don't mirror). `capture.ts` and `user-commit.ts` both call
 * {@link deterministicRecordUuid}; the ONLY thing that distinguishes their
 * ids is the namespace constant and the tuple, which is exactly the
 * distinction the collision guard depends on.
 */

import { createHash } from 'node:crypto';

/**
 * Namespace for AMBIENT auto-capture ids (the commit-seam hook in capture.ts).
 * Unchanged from the value that seam has always used — moving it would
 * re-derive every live record's id and break the RPC's replay semantics.
 */
export const AUTO_CAPTURE_RECORD_ID_NAMESPACE = 'cee:decision_record:v1';

/**
 * Namespace for USER-COMMITTED record ids. Distinct from
 * {@link AUTO_CAPTURE_RECORD_ID_NAMESPACE} BY CONSTRUCTION — this is half of
 * the collision guard (the other half is the user id + commit nonce in the
 * tuple).
 */
export const USER_COMMIT_RECORD_ID_NAMESPACE = 'cee:decision_record:commit:v1';

/**
 * Deterministic UUID over a namespace + a length-delimited tuple: SHA-256,
 * truncated to 128 bits, with RFC 4122 version-5 and variant bits stamped
 * (name-based-style). Delimiter-safe: each part is preceded by its own
 * newline, so shifting a boundary character between parts changes the digest.
 */
export function deterministicRecordUuid(
  namespace: string,
  parts: readonly string[],
): string {
  const digest = createHash('sha256')
    .update(`${namespace}\n${parts.join('\n')}`)
    .digest();
  const bytes = digest.subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version nibble → 5 (name-based)
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
