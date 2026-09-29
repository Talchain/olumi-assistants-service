import type { GraphT } from "../schemas/graph.js";
import { LruTtlCache } from "../utils/cache.js";
import { fastHash } from "../utils/hash.js";
import { emit, log, TelemetryEvents } from "../utils/telemetry.js";
import { validateGraph as validateGraphDirect } from "./validateClient.js";
import { config } from "../config/index.js";

// Result type mirrored from validateClient.ts
export type ValidateResult = {
  ok: boolean;
  normalized?: GraphT;
  violations?: string[];
};

function getCacheEnabled(): boolean {
  return config.validation.cacheEnabled;
}

function getCacheMaxSize(): number {
  return config.validation.cacheMaxSize;
}

function getCacheTtlMs(): number {
  return config.validation.cacheTtlMs;
}

let cache: LruTtlCache<string, ValidateResult> | null = null;

function getCache(): LruTtlCache<string, ValidateResult> | null {
  if (!getCacheEnabled()) {
    return null;
  }
  if (!cache) {
    const capacity = getCacheMaxSize();
    const ttlMs = getCacheTtlMs();

    cache = new LruTtlCache<string, ValidateResult>(
      capacity,
      ttlMs,
      (key, value, reason) => {
        log.debug(
          {
            key_hash: fastHash(key, 8),
            reason,
            ok: value.ok,
          },
          "Validation cache eviction"
        );
      }
    );

    log.info({ capacity, ttl_ms: ttlMs }, "Validation cache initialized");
  }
  return cache;
}

function makeCacheKey(graph: GraphT): string {
  // Graphs are small and already stabilised; JSON stringify is acceptable here
  const json = JSON.stringify(graph);
  const hash = fastHash(json, 16);
  return `validate:${hash}`;
}

export async function validateGraph(graph: GraphT): Promise<ValidateResult> {
  const cacheInstance = getCache();

  if (!cacheInstance) {
    return validateGraphDirect(graph);
  }

  const cacheKey = makeCacheKey(graph);
  const cached = cacheInstance.get(cacheKey);
  if (cached) {
    emit(TelemetryEvents.ValidationCacheHit, { operation: "validate_graph" });
    log.debug({ key_hash: fastHash(cacheKey, 8) }, "Validation cache hit");
    return cached;
  }

  const result = await validateGraphDirect(graph);

  // Avoid caching transient engine-unreachable failures so callers can retry
  const violations = result.violations || [];
  const isUnreachable = violations.includes("validate_unreachable");

  if (isUnreachable) {
    emit(TelemetryEvents.ValidationCacheBypass, {
      operation: "validate_graph",
      reason: "validate_unreachable",
    });
  } else {
    emit(TelemetryEvents.ValidationCacheMiss, { operation: "validate_graph" });
    cacheInstance.set(cacheKey, result);
  }

  return result;
}

// Test-only hook to reset cache between test cases
export function __resetValidationCacheForTests(): void {
  if (cache) {
    cache.clear();
  }
  cache = null;
}
