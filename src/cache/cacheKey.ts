import { createHash } from "node:crypto";

/**
 * Template version for cache invalidation.
 * Increment this whenever prompts or templates change to invalidate stale cache entries.
 */
const TEMPLATE_VERSION = "v1.0.0";

/**
 * Normalize brief for deterministic cache key generation.
 * - Trim whitespace
 * - Collapse multiple whitespace to single space
 * - Lowercase for case-insensitive matching
 */
function normalizeBrief(brief: string): string {
  return brief
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Generate deterministic signature for attachment content.
 * Uses SHA256 hash of the attachment content.
 */
function hashAttachment(attachment: { id: string; kind: string; name: string; content: Buffer | string }): string {
  const content = typeof attachment.content === "string"
    ? Buffer.from(attachment.content, "base64")
    : attachment.content;

  const hash = createHash("sha256")
    .update(attachment.id)
    .update(attachment.kind)
    .update(attachment.name)
    .update(content)
    .digest("hex");

  return hash;
}

/**
 * Extract cache-affecting flags from flags object.
 * Only include flags that change the draft behavior (e.g., grounding).
 * Exclude debug/observability flags that don't affect output.
 */
function extractCacheAffectingFlags(flags?: Record<string, boolean>): Record<string, boolean> {
  if (!flags) return {};

  const cacheAffectingFlags = ["grounding", "critique", "clarifier"];
  const result: Record<string, boolean> = {};

  for (const flag of cacheAffectingFlags) {
    if (flag in flags) {
      result[flag] = flags[flag];
    }
  }

  return result;
}

/**
 * Input parameters for cache key generation.
 */
export interface CacheKeyInput {
  /** User's decision brief (will be normalized) */
  brief: string;

  /** Attachments with content for hashing */
  attachments?: Array<{ id: string; kind: string; name: string; content: Buffer | string }>;

  /** Feature flags (only cache-affecting subset will be used) */
  flags?: Record<string, boolean>;

  /** Clarifier answers from previous rounds (optional, for future use) */
  clarifierAnswers?: Array<{ question: string; answer: string }>;
}

/**
 * Cache key structure for debugging and telemetry.
 * Shows what went into the cache key without exposing sensitive data.
 */
export interface CacheKeyShape {
  brief_normalized_length: number;
  attachment_count: number;
  attachment_hashes: string[];
  flags: Record<string, boolean>;
  clarifier_answer_count: number;
  template_version: string;
}

/**
 * Generate deterministic cache key for draft-graph requests.
 *
 * Cache key is SHA256 hash over:
 * - brief (normalized: lowercase, trimmed, collapsed whitespace)
 * - attachments (SHA256 hash of each attachment's content)
 * - flags (only cache-affecting flags like grounding, critique, clarifier)
 * - clarifier_answers (if present, for future multi-round clarification)
 * - template_version (hardcoded, incremented when prompts change)
 *
 * Returns both the cache key and shape for telemetry.
 */
export function generateCacheKey(input: CacheKeyInput): { key: string; shape: CacheKeyShape } {
  const normalizedBrief = normalizeBrief(input.brief);
  const cacheAffectingFlags = extractCacheAffectingFlags(input.flags);

  // Hash attachments deterministically
  const attachmentHashes = (input.attachments || [])
    .map(hashAttachment)
    .sort(); // Sort for deterministic ordering

  // Build deterministic cache key components
  const components = [
    `brief:${normalizedBrief}`,
    `template:${TEMPLATE_VERSION}`,
  ];

  // Add flags (sorted by key for determinism)
  const flagKeys = Object.keys(cacheAffectingFlags).sort();
  if (flagKeys.length > 0) {
    components.push(`flags:${flagKeys.map(k => `${k}=${cacheAffectingFlags[k]}`).join(",")}`);
  }

  // Add attachment hashes
  if (attachmentHashes.length > 0) {
    components.push(`attachments:${attachmentHashes.join(",")}`);
  }

  // Add clarifier answers (future use)
  if (input.clarifierAnswers && input.clarifierAnswers.length > 0) {
    const answersHash = createHash("sha256")
      .update(JSON.stringify(input.clarifierAnswers))
      .digest("hex");
    components.push(`clarifier:${answersHash}`);
  }

  // Generate final cache key
  const cacheKey = createHash("sha256")
    .update(components.join("|"))
    .digest("hex");

  // Build shape for telemetry (no sensitive data)
  const shape: CacheKeyShape = {
    brief_normalized_length: normalizedBrief.length,
    attachment_count: attachmentHashes.length,
    attachment_hashes: attachmentHashes.map(h => h.substring(0, 8)), // First 8 chars only
    flags: cacheAffectingFlags,
    clarifier_answer_count: input.clarifierAnswers?.length || 0,
    template_version: TEMPLATE_VERSION,
  };

  return { key: cacheKey, shape };
}
