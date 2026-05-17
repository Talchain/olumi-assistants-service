/**
 * Deterministic UUID v5 helper for V5 Phase 3 `block_id` derivation.
 *
 * Phase 3A PR 3 requires `block_id` to be stable across re-emissions of
 * the same logical block. The pre-PR-3 code used `randomUUID()` which
 * produces a fresh UUID v4 every call — fine when blocks were always
 * built from the current-turn fact (PR #178), but breaks UI dedupe when
 * a stale or freshly-rebuilt block re-renders the same logical content
 * across multiple turns.
 *
 * UUID v5 (RFC 4122 §4.3): SHA-1 over namespace UUID's 16 raw bytes
 * concatenated with the UTF-8 encoding of the name string, then:
 *   - take the first 16 bytes of the digest
 *   - set version bits: byte[6] = (byte[6] & 0x0F) | 0x50  (version 5)
 *   - set variant bits: byte[8] = (byte[8] & 0x3F) | 0x80  (RFC 4122)
 *   - format as xxxxxxxx-xxxx-5xxx-yxxx-xxxxxxxxxxxx (y in [89ab])
 *
 * Output passes `z.string().uuid()` from the boundary schema.
 *
 * Namespace is a project-internal stable UUID — changing it would rekey
 * every persisted/cached block_id, so it must be treated as constant
 * forever for V5 Phase 3 lifecycle. Generated once with `randomUUID()`
 * and committed here.
 *
 * No new npm dependency: `node:crypto.createHash('sha1')` is sufficient.
 */

import { createHash } from 'node:crypto';

/**
 * Stable V5 Phase 3 namespace UUID. DO NOT CHANGE — rotation would
 * invalidate every persisted block_id in production.
 *
 * Format-validated v4-shape (version bits = 0x40, variant bits = 0x80)
 * so it itself passes any UUID validator that callers might add.
 */
export const V5_PHASE3_BLOCK_ID_NAMESPACE = 'f0c87e25-9d0b-4f4c-89b2-d8b8f4d2b6c1';

/**
 * Compute a deterministic UUID v5 from a stable name string under the
 * V5 Phase 3 namespace. Same name ⇒ same UUID, always. Different names ⇒
 * almost-certainly-different UUIDs (SHA-1 collision space).
 *
 * Use the existing deterministic `signal_id` (already keyed per
 * `(kind, source-key, graph_hash)`) as the name to get block_id
 * stability across re-emissions of the same logical block. The
 * namespace UUID then ensures Phase 3 block_ids never collide with
 * UUIDs from other parts of the system that derive UUIDs from
 * unrelated strings.
 */
export function deterministicBlockId(name: string): string {
  return uuidV5(name, V5_PHASE3_BLOCK_ID_NAMESPACE);
}

/**
 * Internal: RFC 4122 §4.3 UUID v5 implementation backed by
 * `node:crypto.createHash('sha1')`. Exported for tests; production
 * callers should use `deterministicBlockId` for the namespace fix.
 */
export function uuidV5(name: string, namespace: string): string {
  const nsBytes = uuidStringToBytes(namespace);
  if (nsBytes === null) {
    throw new Error(`uuidV5: invalid namespace UUID "${namespace}"`);
  }
  const hash = createHash('sha1');
  hash.update(nsBytes);
  hash.update(name, 'utf8');
  const digest = hash.digest();

  // First 16 bytes of the SHA-1 digest form the UUID candidate.
  const bytes = digest.subarray(0, 16);

  // Set version 5 in byte 6: top 4 bits ← 0101.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  // Set RFC 4122 variant in byte 8: top 2 bits ← 10.
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  return bytesToUuidString(bytes);
}

function uuidStringToBytes(uuid: string): Uint8Array | null {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const byte = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}

function bytesToUuidString(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20, 32),
  ].join('-');
}
