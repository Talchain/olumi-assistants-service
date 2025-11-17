/**
 * GET /v1/limits - Per-key quota usage endpoint
 *
 * Exposes quota information for the authenticated API key.
 * Useful for monitoring rate limit status and preventing 429 errors.
 *
 * Response schema:
 * {
 *   key_id: string;           // Hash of API key (for correlation)
 *   rate_limit_rpm: number;   // Standard rate limit (requests per minute)
 *   sse_rate_limit_rpm: number; // SSE rate limit (requests per minute)
 *   quota_backend: "redis" | "memory"; // Backend storage type
 * }
 */

import type { FastifyInstance } from "fastify";
import { getRequestKeyId } from "../plugins/auth.js";
import { getQuotaStats, getQuotaSnapshotByKeyId } from "../utils/quota.js";
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from "../config/graphCaps.js";

// Rate limits (match quota.ts config)
const RATE_LIMIT_RPM = Number(process.env.RATE_LIMIT_RPM) || 120;
const SSE_RATE_LIMIT_RPM = Number(process.env.SSE_RATE_LIMIT_RPM) || 20;

export async function limitsRoute(app: FastifyInstance) {
  /**
   * GET /v1/limits - Get current quota status for authenticated key
   */
  app.get("/v1/limits", async (request, reply) => {
    // Get key ID from auth (will be null if not authenticated)
    const keyId = getRequestKeyId(request);

    if (!keyId) {
      return reply.code(401).send({
        schema: "error.v1",
        code: "FORBIDDEN",
        message: "Authentication required",
      });
    }

    // Get global quota stats (for backend) and per-key snapshots (for remaining tokens)
    const stats = getQuotaStats();
    const [standardSnapshot, sseSnapshot] = await Promise.all([
      getQuotaSnapshotByKeyId(keyId, false),
      getQuotaSnapshotByKeyId(keyId, true),
    ]);

    return reply.code(200).send({
      schema: "limits.v1",
      key_id: keyId,
      rate_limit_rpm: RATE_LIMIT_RPM,
      sse_rate_limit_rpm: SSE_RATE_LIMIT_RPM,
      quota_backend: standardSnapshot.backend || stats.backend,
      graph_max_nodes: GRAPH_MAX_NODES,
      graph_max_edges: GRAPH_MAX_EDGES,
      max_nodes: GRAPH_MAX_NODES,
      max_edges: GRAPH_MAX_EDGES,
      standard_quota: {
        capacity_rpm: RATE_LIMIT_RPM,
        tokens: standardSnapshot.tokens,
        refill_rate_per_sec: standardSnapshot.refillRate,
        retry_after_seconds: standardSnapshot.retryAfterSeconds,
      },
      sse_quota: {
        capacity_rpm: SSE_RATE_LIMIT_RPM,
        tokens: sseSnapshot.tokens,
        refill_rate_per_sec: sseSnapshot.refillRate,
        retry_after_seconds: sseSnapshot.retryAfterSeconds,
      },
    });
  });
}
