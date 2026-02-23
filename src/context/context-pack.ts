/**
 * ContextPack v1 — Deterministic Context Identity
 *
 * Captures all inputs that affect CEE output into a single, hashable pack.
 * Used for:
 *  - Cache key generation (cache_prefix_key + dynamic_suffix_key)
 *  - Lineage propagation (context_hash in provenance)
 *  - Replay detection (same inputs → same context_hash)
 *
 * Design principles:
 *  - Different capabilities (endpoints) MUST NOT share context_hash
 *  - Model identity uses resolved model_id, not alias
 *  - Clarifications are canonically sorted by question_id before hashing
 *  - All hashing uses canonical JSON (sorted keys, no undefined)
 */

import { createHash } from "node:crypto";
import { canonicalizeJson } from "../utils/response-hash.js";

// =============================================================================
// Types
// =============================================================================

export type Capability =
  | "draft_graph"
  | "decision_review"
  | "clarify"
  | "repair"
  | "bias_check"
  | "explain_graph";

export type RetrievalMode = "none" | "memory" | "evidence" | "both";

export interface ContextPackV1 {
  context_pack_version: "1";

  // Call type (different endpoints must not share hash)
  capability: Capability;

  // Core inputs
  brief: string;
  brief_hash: string;

  // Graph state
  seed_graph_hash?: string;

  // Model configuration (resolved, not alias)
  model_route: string;     // Routing alias (e.g., 'default', 'fast')
  model_id: string;        // Resolved provider+model (e.g., 'anthropic/claude-sonnet-4-20250514')

  // Prompt (version + content hash)
  prompt_version: string;
  prompt_hash: string;     // Hash of actual static prompt content

  // Execution
  seed: number;
  config_hash: string;     // Hash of relevant config fields

  // Retrieval (none for PoC)
  retrieval_mode: RetrievalMode;
  retrieval_hash?: string;

  // Clarification (canonical: sorted by question_id)
  clarification_round: number;
  clarification_hash?: string;  // Hash of sorted [{question_id, answer}]

  // Computed
  context_hash: string;  // Hash of entire pack
}

// =============================================================================
// Canonical hashing primitives
// =============================================================================

const HASH_LENGTH = 12; // 12 hex chars, matches computeResponseHash

/**
 * Compute a deterministic SHA-256 hash (truncated to 12 hex chars)
 * of any JSON-serializable value using canonical key ordering.
 */
export function computeHash(value: unknown): string {
  const canonical = JSON.stringify(canonicalizeJson(value));
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, HASH_LENGTH);
}

/**
 * Compute a deterministic hash of a raw string (e.g. prompt content).
 * No JSON wrapping — hashes the string bytes directly.
 */
export function computeStringHash(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, HASH_LENGTH);
}

// =============================================================================
// Task 2: Canonical Hashing Helpers
// =============================================================================

export interface ClarificationAnswer {
  question_id: string;
  answer: string;
}

/**
 * Hash clarification answers canonically: sort by question_id, then hash.
 * Order-independent: same Q&A pairs in any order → same hash.
 */
export function hashClarificationAnswers(answers: ClarificationAnswer[]): string {
  const sorted = [...answers].sort((a, b) => a.question_id.localeCompare(b.question_id));
  return computeHash(sorted);
}

/**
 * Relevant config fields that affect CEE output.
 * Only these fields are included in the config hash.
 */
export interface RelevantConfig {
  maxTokens?: {
    draft?: number;
    repair?: number;
  };
  enforceSingleGoal?: boolean;
  draftArchetypesEnabled?: boolean;
  clarificationEnforced?: boolean;
  clarifierEnabled?: boolean;
}

/**
 * Hash only the config fields that affect output.
 * Adding/removing irrelevant fields (like rate limits) won't change the hash.
 */
export function hashConfig(config: RelevantConfig): string {
  const relevant = {
    maxTokens: config.maxTokens,
    enforceSingleGoal: config.enforceSingleGoal,
    draftArchetypesEnabled: config.draftArchetypesEnabled,
    clarificationEnforced: config.clarificationEnforced,
    clarifierEnabled: config.clarifierEnabled,
  };
  return computeHash(relevant);
}

/**
 * Hash actual prompt content (not just version string).
 * Two prompts with same version but different content → different hash.
 */
export function hashPromptContent(promptContent: string): string {
  return computeStringHash(promptContent);
}

// =============================================================================
// Task 3: Caching Boundary Helpers
// =============================================================================

export interface CacheBoundary {
  /** Hash of static blocks (system prompt, taxonomy, rules) — stable across requests */
  cache_prefix_key: string;
  /** Hash of per-request blocks (brief, graph, clarifications) — varies per request */
  dynamic_suffix_key: string;
}

/**
 * Compute cache boundary keys from a ContextPack.
 *
 * Static prefix: prompt + config (shared across requests with same system setup)
 * Dynamic suffix: brief + graph + clarifications + retrieval (per-request)
 */
export function computeCacheBoundary(pack: ContextPackV1): CacheBoundary {
  // Static prefix: system prompt, taxonomy, rules
  const staticBlocks = {
    prompt_hash: pack.prompt_hash,
    config_hash: pack.config_hash,
  };

  // Dynamic suffix: brief, graph, clarifications
  const dynamicBlocks = {
    brief_hash: pack.brief_hash,
    seed_graph_hash: pack.seed_graph_hash,
    clarification_hash: pack.clarification_hash,
    retrieval_hash: pack.retrieval_hash,
  };

  return {
    cache_prefix_key: computeHash(staticBlocks),
    dynamic_suffix_key: computeHash(dynamicBlocks),
  };
}

// =============================================================================
// Task 4: Context Assembly
// =============================================================================

/** Default seed when none provided by request or config */
const DEFAULT_SEED = 0;

export interface AssembleContextPackInput {
  capability: Capability;
  brief: string;
  seedGraph?: unknown;
  resolvedModel: { route: string; id: string };
  promptVersion: string;
  /**
   * Raw prompt content string. Hashed via hashPromptContent() to produce prompt_hash.
   * Mutually exclusive with promptHashPrecomputed — if both are provided,
   * promptHashPrecomputed wins (avoids hash-of-hash when adapter already computed it).
   */
  promptContent: string;
  /**
   * Pre-computed prompt content hash from the LLM adapter (e.g. llmMeta.prompt_hash).
   * When provided, used directly as prompt_hash — skips re-hashing promptContent.
   * Use this when the adapter already hashed the actual prompt text.
   */
  promptHashPrecomputed?: string;
  /**
   * Execution seed. Falls back to DEFAULT_SEED (0) if not provided.
   * Callers should pass `request.seed ?? config.defaultSeed` to ensure
   * determinism across endpoints.
   */
  seed?: number;
  config: RelevantConfig;
  retrievalMode?: RetrievalMode;
  retrievalHash?: string;
  clarificationRound?: number;
  clarificationAnswers?: ClarificationAnswer[];
}

/**
 * Assemble a complete ContextPackV1 from request inputs.
 *
 * The context_hash is computed last, covering the entire pack.
 * Deterministic: same inputs always produce the same context_hash.
 */
export function assembleContextPack(input: AssembleContextPackInput): ContextPackV1 {
  const clarificationHash = input.clarificationAnswers && input.clarificationAnswers.length > 0
    ? hashClarificationAnswers(input.clarificationAnswers)
    : undefined;

  const pack: Omit<ContextPackV1, "context_hash"> = {
    context_pack_version: "1",
    capability: input.capability,
    brief: input.brief,
    brief_hash: computeStringHash(input.brief),
    seed_graph_hash: input.seedGraph
      ? computeHash(input.seedGraph)
      : undefined,
    model_route: input.resolvedModel.route,
    model_id: input.resolvedModel.id,
    prompt_version: input.promptVersion,
    prompt_hash: input.promptHashPrecomputed ?? hashPromptContent(input.promptContent),
    seed: input.seed ?? DEFAULT_SEED,
    config_hash: hashConfig(input.config),
    retrieval_mode: input.retrievalMode ?? "none",
    retrieval_hash: input.retrievalHash,
    clarification_round: input.clarificationRound ?? 0,
    clarification_hash: clarificationHash,
  };

  return {
    ...pack,
    context_hash: computeHash(pack),
  };
}
