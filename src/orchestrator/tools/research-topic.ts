/**
 * research_topic Tool Handler
 *
 * Calls OpenAI Responses API with web search to find cited evidence
 * for the user's decision model. Returns an evidence block with findings
 * and source citations. Rate-limited and cached per scenario.
 *
 * Never throws — returns friendly commentary blocks on all error paths.
 */

import { createHash } from "node:crypto";
import { config } from "../../config/index.js";
import { log } from "../../utils/telemetry.js";
import { LruTtlCache } from "../../utils/cache.js";
import type { TypedConversationBlock, ConversationContext, EvidenceBlockData } from "../types.js";
import { createEvidenceBlock } from "../blocks/factory.js";
import { createCommentaryBlock } from "../blocks/factory.js";
import { executeWebSearch } from "./research-client.js";

// ============================================================================
// Types
// ============================================================================

export interface ResearchTopicResult {
  blocks: TypedConversationBlock[];
  assistantText: string | null;
  latencyMs: number;
}

// ============================================================================
// Rate Limiter — per-scenario call counting with TTL window
// ============================================================================

let _rateLimitCache: LruTtlCache<string, number> | null = null;

function getRateLimitCache(): LruTtlCache<string, number> {
  if (!_rateLimitCache) {
    _rateLimitCache = new LruTtlCache<string, number>(
      1000, // capacity — number of tracked scenarios
      config.research.rateLimitWindowMs,
    );
  }
  return _rateLimitCache;
}

function checkAndIncrementRateLimit(scenarioId: string): { allowed: boolean; count: number } {
  const cache = getRateLimitCache();
  const current = cache.get(scenarioId) ?? 0;
  const limit = config.research.rateLimitPerScenario;

  if (current >= limit) {
    log.info({ scenario_id: scenarioId, count: current, limit }, "Research rate limit exceeded");
    return { allowed: false, count: current };
  }

  cache.set(scenarioId, current + 1);
  return { allowed: true, count: current + 1 };
}

// ============================================================================
// Query Cache — per-(scenario, normalised_query) with TTL
// ============================================================================

let _queryCache: LruTtlCache<string, EvidenceBlockData> | null = null;

function getQueryCache(): LruTtlCache<string, EvidenceBlockData> {
  if (!_queryCache) {
    _queryCache = new LruTtlCache<string, EvidenceBlockData>(
      config.research.cacheMaxSize,
      config.research.cacheTtlMs,
    );
  }
  return _queryCache;
}

function normaliseQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

// ============================================================================
// Query Sanitisation — defence-in-depth against prompt injection
// ============================================================================

/**
 * Strip obvious prompt-injection markers from user-supplied query and context
 * before sending to the external web search API. Not a primary security
 * boundary (the research client's system prompt handles that), but cheap
 * insurance against trivial injection attempts.
 */
const INJECTION_PATTERNS = [
  /\bsystem\s*:\s*/gi,
  /\bassistant\s*:\s*/gi,
  /\buser\s*:\s*/gi,
  /\bignore\s+(previous|all|above)\s+instructions?\b/gi,
  /\byou\s+are\s+(now|a)\b/gi,
  /<\/?(?:system|prompt|instruction)>/gi,
];

function sanitiseQuery(input: string): string {
  let cleaned = input.trim().replace(/\s+/g, ' ');
  for (const pattern of INJECTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned.trim();
}

function cacheKey(scenarioId: string, normalisedQuery: string, targetFactor?: string): string {
  return `${scenarioId}:${targetFactor || ''}:${normalisedQuery}`;
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Handle a research_topic tool invocation.
 *
 * Never throws — returns friendly blocks on all error paths.
 */
export async function handleResearchTopic(
  query: string,
  context: ConversationContext,
  requestId: string,
  turnId: string,
  targetFactor?: string,
  researchContext?: string,
): Promise<ResearchTopicResult> {
  const start = Date.now();
  const queryHash = createHash('sha256').update(query).digest('hex').substring(0, 8);

  // 1. Feature gate
  if (!config.research.enabled) {
    return {
      blocks: [createCommentaryBlock(
        "Research is not currently available. You can add evidence manually in the inspector.",
        turnId,
        'tool:research_topic',
      )],
      assistantText: "Research is not currently available.",
      latencyMs: Date.now() - start,
    };
  }

  // 2. Check cache before rate limit — cache hits should not consume budget
  const normQuery = normaliseQuery(query);
  const key = cacheKey(context.scenario_id, normQuery, targetFactor);
  const cached = getQueryCache().get(key);

  if (cached) {
    log.info(
      { request_id: requestId, query_hash: queryHash, cache: 'hit', sources: cached.sources.length },
      "Research topic: cache hit",
    );
    return {
      blocks: [createEvidenceBlock(cached, turnId)],
      assistantText: cached.findings,
      latencyMs: Date.now() - start,
    };
  }

  // 3. Rate limit — only checked for cache misses (actual external calls)
  const rateCheck = checkAndIncrementRateLimit(context.scenario_id);
  if (!rateCheck.allowed) {
    return {
      blocks: [createCommentaryBlock(
        "I've reached the research limit for this session. You can add evidence manually in the inspector.",
        turnId,
        'tool:research_topic',
      )],
      assistantText: "I've reached the research limit for this session.",
      latencyMs: Date.now() - start,
    };
  }

  // 4. Sanitise and execute web search
  const sanitisedQuery = sanitiseQuery(query);
  const sanitisedContext = researchContext ? sanitiseQuery(researchContext) : undefined;
  const result = await executeWebSearch(sanitisedQuery, requestId, sanitisedContext, targetFactor);

  log.info(
    {
      request_id: requestId,
      query_hash: queryHash,
      cache: 'miss',
      sources: result.sources.length,
      has_error: !!result.error,
      latency_ms: Date.now() - start,
    },
    "Research topic: web search completed",
  );

  // 5. Handle error results
  if (result.error) {
    return {
      blocks: [createCommentaryBlock(result.summary, turnId, 'tool:research_topic')],
      assistantText: result.summary,
      latencyMs: Date.now() - start,
    };
  }

  // 6. Handle no useful results — advisory whenever sources are empty
  if (result.sources.length === 0) {
    const noResultText = `I couldn't find specific data on "${query}". Try a more specific query, or add the evidence manually in the inspector.`;
    return {
      blocks: [createCommentaryBlock(noResultText, turnId, 'tool:research_topic')],
      assistantText: noResultText,
      latencyMs: Date.now() - start,
    };
  }

  // 7. Build evidence block data — always include claims and model_mapping_suggestions
  //    for deterministic shape (empty arrays when extraction not available)
  const evidenceData: EvidenceBlockData = {
    query,
    target_factor: targetFactor ?? null,
    findings: result.summary,
    claims: [],                       // Always emitted (possibly empty) — deterministic shape invariant
    model_mapping_suggestions: [],     // Always emitted (possibly empty) — deterministic shape invariant
    sources: result.sources,
    confidence_note: "Web search results — verify before updating your model",
  };

  // 8. Cache and return
  getQueryCache().set(key, evidenceData);

  return {
    blocks: [createEvidenceBlock(evidenceData, turnId)],
    assistantText: result.summary,
    latencyMs: Date.now() - start,
  };
}

/** Test-only: reset caches. */
export function _resetResearchCaches(): void {
  _rateLimitCache = null;
  _queryCache = null;
}
