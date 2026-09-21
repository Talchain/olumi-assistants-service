/**
 * DSK canonical hashing — SHA-256 over canonical JSON.
 */

import { createHash } from "node:crypto";
import type { DSKBundle } from "./types.js";
import { canonicalise } from "./canonicalise.js";

/** Compute the canonical SHA-256 hex hash for a DSK bundle. */
export function computeDSKHash(bundle: DSKBundle): string {
  const canonical = canonicalise(bundle);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Verify the stored dsk_version_hash matches the computed hash. */
export function verifyDSKHash(bundle: DSKBundle): boolean {
  return bundle.dsk_version_hash === computeDSKHash(bundle);
}
