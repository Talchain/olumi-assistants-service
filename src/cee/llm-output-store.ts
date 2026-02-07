/**
 * LLM Output Store - Stores LLM outputs for debugging/admin retrieval.
 *
 * Uses an in-memory FIFO cache with TTL to store LLM outputs keyed by request_id.
 * Note: This is FIFO (first-in-first-out), not LRU - get() does not refresh recency.
 * This enables the admin endpoint to retrieve outputs for debugging without
 * bloating normal API responses.
 *
 * Important: The stored rawText may be truncated by adapters before reaching this store.
 * Hash is computed on whatever text is passed, which may not be the complete LLM output.
 */

import { createHash } from "node:crypto";

/** Default TTL: 1 hour */
const DEFAULT_TTL_MS = 60 * 60 * 1000;

/** Max entries in the store */
const MAX_ENTRIES = 1000;

/** Stored LLM output entry */
export interface LLMOutputEntry {
  /** Request ID */
  requestId: string;
  /** SHA-256 hash of the stored output (may be truncated by adapters) */
  outputHash: string;
  /** Raw LLM text output (may be truncated by adapters) */
  rawText: string;
  /** Parsed JSON output (if parsing succeeded) */
  parsedJson?: unknown;
  /** Node count from parsed output */
  nodeCount: number;
  /** Edge count from parsed output */
  edgeCount: number;
  /** Timestamp when stored */
  storedAt: number;
  /** Model used */
  model?: string;
  /** Prompt version */
  promptVersion?: string;
}

/** In-memory store with TTL */
class LLMOutputStore {
  private store = new Map<string, LLMOutputEntry>();
  private ttlMs: number;
  private maxEntries: number;

  constructor(ttlMs = DEFAULT_TTL_MS, maxEntries = MAX_ENTRIES) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  /**
   * Store LLM output for later retrieval.
   */
  set(entry: LLMOutputEntry): void {
    // Evict expired entries and enforce max size
    this.cleanup();

    // Enforce FIFO eviction if at capacity (evict oldest inserted)
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) {
        this.store.delete(oldestKey);
      }
    }

    this.store.set(entry.requestId, entry);
  }

  /**
   * Retrieve stored LLM output by request ID.
   * Returns undefined if not found or expired.
   */
  get(requestId: string): LLMOutputEntry | undefined {
    const entry = this.store.get(requestId);
    if (!entry) {
      return undefined;
    }

    // Check if expired
    if (Date.now() - entry.storedAt > this.ttlMs) {
      this.store.delete(requestId);
      return undefined;
    }

    return entry;
  }

  /**
   * Check if an entry exists and is not expired.
   */
  has(requestId: string): boolean {
    return this.get(requestId) !== undefined;
  }

  /**
   * Remove expired entries.
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.storedAt > this.ttlMs) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Get store size (for diagnostics).
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * Clear all entries (for testing).
   */
  clear(): void {
    this.store.clear();
  }
}

/** Singleton store instance */
const llmOutputStore = new LLMOutputStore();

/**
 * Store LLM output for admin retrieval.
 * Idempotent: if entry already exists for requestId, returns existing data without re-storing.
 */
export function storeLLMOutput(
  requestId: string,
  rawText: string,
  parsedJson: unknown | undefined,
  options?: {
    model?: string;
    promptVersion?: string;
  }
): { outputHash: string; nodeCount: number; edgeCount: number } {
  // Check if already stored (idempotent)
  const existing = llmOutputStore.get(requestId);
  if (existing) {
    return {
      outputHash: existing.outputHash,
      nodeCount: existing.nodeCount,
      edgeCount: existing.edgeCount,
    };
  }

  const outputHash = createHash("sha256").update(rawText).digest("hex");

  // Extract node/edge counts from parsed JSON
  let nodeCount = 0;
  let edgeCount = 0;
  if (parsedJson && typeof parsedJson === "object") {
    const obj = parsedJson as Record<string, unknown>;
    if (Array.isArray(obj.nodes)) {
      nodeCount = obj.nodes.length;
    }
    if (Array.isArray(obj.edges)) {
      edgeCount = obj.edges.length;
    }
    // Also check for graph wrapper
    if (obj.graph && typeof obj.graph === "object") {
      const graph = obj.graph as Record<string, unknown>;
      if (Array.isArray(graph.nodes)) {
        nodeCount = graph.nodes.length;
      }
      if (Array.isArray(graph.edges)) {
        edgeCount = graph.edges.length;
      }
    }
  }

  llmOutputStore.set({
    requestId,
    outputHash,
    rawText,
    parsedJson,
    nodeCount,
    edgeCount,
    storedAt: Date.now(),
    model: options?.model,
    promptVersion: options?.promptVersion,
  });

  return { outputHash, nodeCount, edgeCount };
}

/**
 * Retrieve stored LLM output by request ID.
 */
export function getLLMOutput(requestId: string): LLMOutputEntry | undefined {
  return llmOutputStore.get(requestId);
}

/**
 * Check if LLM output is available for a request ID.
 */
export function hasLLMOutput(requestId: string): boolean {
  return llmOutputStore.has(requestId);
}

/**
 * Build llm_raw trace object from stored output.
 */
export function buildLLMRawTrace(
  requestId: string,
  rawText: string | undefined,
  parsedJson: unknown | undefined,
  options?: {
    model?: string;
    promptVersion?: string;
    storeOutput?: boolean;
  }
): {
  text: string;
  output_preview: string;
  char_count: number;
  output_hash: string;
  output_node_count: number;
  output_edge_count: number;
  truncated: boolean;
  full_output_available: boolean;
} | undefined {
  if (!rawText) {
    return undefined;
  }

  const PREVIEW_MAX_CHARS = 2000;
  const outputPreview = rawText.slice(0, PREVIEW_MAX_CHARS);
  const truncated = rawText.length > PREVIEW_MAX_CHARS;

  let outputHash: string;
  let nodeCount: number;
  let edgeCount: number;
  let fullOutputAvailable: boolean;

  if (options?.storeOutput !== false) {
    // Store the full output and get hash/counts
    const stored = storeLLMOutput(requestId, rawText, parsedJson, {
      model: options?.model,
      promptVersion: options?.promptVersion,
    });
    outputHash = stored.outputHash;
    nodeCount = stored.nodeCount;
    edgeCount = stored.edgeCount;
    fullOutputAvailable = true;
  } else {
    // Just compute hash and counts without storing
    outputHash = createHash("sha256").update(rawText).digest("hex");
    nodeCount = 0;
    edgeCount = 0;
    if (parsedJson && typeof parsedJson === "object") {
      const obj = parsedJson as Record<string, unknown>;
      if (Array.isArray(obj.nodes)) {
        nodeCount = obj.nodes.length;
      }
      if (Array.isArray(obj.edges)) {
        edgeCount = obj.edges.length;
      }
      if (obj.graph && typeof obj.graph === "object") {
        const graph = obj.graph as Record<string, unknown>;
        if (Array.isArray(graph.nodes)) {
          nodeCount = graph.nodes.length;
        }
        if (Array.isArray(graph.edges)) {
          edgeCount = graph.edges.length;
        }
      }
    }
    fullOutputAvailable = false;
  }

  return {
    text: rawText,
    output_preview: outputPreview,
    char_count: rawText.length,
    output_hash: outputHash,
    output_node_count: nodeCount,
    output_edge_count: edgeCount,
    truncated,
    full_output_available: fullOutputAvailable,
  };
}

/**
 * Get store size (for diagnostics).
 */
export function getLLMOutputStoreSize(): number {
  return llmOutputStore.size;
}

/**
 * Clear the store (for testing).
 */
export function clearLLMOutputStore(): void {
  llmOutputStore.clear();
}
