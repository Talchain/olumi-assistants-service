import type {
  DraftGraphResponse,
  ErrorResponse,
  Diagnostics,
  LimitsResponse,
  SseEvent,
} from "./types.js";

/**
 * Type guard: check if a payload is a DraftGraphResponse
 */
export function isDraftGraphResponse(payload: unknown): payload is DraftGraphResponse {
  return !!payload && typeof payload === "object" && (payload as any).schema === "draft-graph.v1";
}

/**
 * Type guard: check if a payload is an ErrorResponse
 */
export function isErrorResponse(payload: unknown): payload is ErrorResponse {
  return !!payload && typeof payload === "object" && (payload as any).schema === "error.v1";
}

/**
 * Extract diagnostics from an SSE event if present.
 *
 * Returns null when the event does not contain a DraftGraphResponse payload.
 */
export function getDiagnosticsFromEvent(event: SseEvent): Diagnostics | null {
  switch (event.type) {
    case "stage": {
      const payload = (event.data as any)?.payload;
      if (isDraftGraphResponse(payload)) {
        return payload.diagnostics ?? null;
      }
      return null;
    }
    case "complete": {
      const payload = event.data as any;
      if (isDraftGraphResponse(payload)) {
        return payload.diagnostics ?? null;
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Normalized graph caps derived from LimitsResponse.
 */
export interface GraphCaps {
  maxNodes: number;
  maxEdges: number;
}

/**
 * Normalize graph limits from LimitsResponse, preferring graph_max_* fields
 * while falling back to legacy aliases when necessary.
 */
export function getGraphCaps(limits: LimitsResponse): GraphCaps {
  const maxNodes =
    typeof limits.graph_max_nodes === "number" &&
    Number.isFinite(limits.graph_max_nodes)
      ? limits.graph_max_nodes
      : limits.max_nodes;
  const maxEdges =
    typeof limits.graph_max_edges === "number" &&
    Number.isFinite(limits.graph_max_edges)
      ? limits.graph_max_edges
      : limits.max_edges;

  return { maxNodes, maxEdges };
}

/**
 * Normalized quota view for convenience when working with LimitsResponse.
 */
export interface NormalizedQuota {
  capacityRpm?: number;
  tokens?: number;
  refillRatePerSec?: number;
  /**
   * Client-friendly retry-after in milliseconds (derived from retry_after_seconds).
   */
  retryAfterMs?: number;
}

function normalizeQuota(quota?: LimitsResponse["standard_quota"]): NormalizedQuota | null {
  if (!quota) return null;

  const result: NormalizedQuota = {};

  if (typeof quota.capacity_rpm === "number") {
    result.capacityRpm = quota.capacity_rpm;
  }
  if (typeof quota.tokens === "number") {
    result.tokens = quota.tokens;
  }
  if (typeof quota.refill_rate_per_sec === "number") {
    result.refillRatePerSec = quota.refill_rate_per_sec;
  }
  if (typeof quota.retry_after_seconds === "number") {
    result.retryAfterMs = quota.retry_after_seconds * 1000;
  }

  return result;
}

/**
 * Normalized view of the standard request quota, or null when not present.
 */
export function getStandardQuota(limits: LimitsResponse): NormalizedQuota | null {
  return normalizeQuota(limits.standard_quota);
}

/**
 * Normalized view of the SSE request quota, or null when not present.
 */
export function getSseQuota(limits: LimitsResponse): NormalizedQuota | null {
  return normalizeQuota(limits.sse_quota as any);
}
