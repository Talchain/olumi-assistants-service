/**
 * Boundary Logging Plugin
 *
 * Standardizes cross-service tracing with:
 * - Service identification headers (x-olumi-service, x-olumi-service-build)
 * - Payload hash propagation (x-olumi-payload-hash)
 * - Boundary events (boundary.request, boundary.response)
 *
 * This enables end-to-end request correlation with UI and downstream services.
 *
 * Canonical hashing algorithm:
 * - Keys sorted alphabetically at all nesting levels
 * - Undefined values skipped (null preserved)
 * - SHA256, first 12 hex characters
 * - Example: { z: 1, a: 2, m: 3 } → "ebba85cfdc0a"
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { getRequestId } from "../utils/request-id.js";
import { emit, TelemetryEvents } from "../utils/telemetry.js";
import { getTimingSummary } from "../utils/request-timing.js";
import { GIT_COMMIT_SHORT } from "../version.js";

/**
 * Service identifier for boundary logging
 */
const SERVICE_NAME = "cee";

/**
 * Header names (lowercase for reading, mixed-case for writing)
 */
const PAYLOAD_HASH_HEADER = "x-olumi-payload-hash";
const CLIENT_BUILD_HEADER = "x-olumi-client-build";
const SERVICE_HEADER = "x-olumi-service";
const SERVICE_BUILD_HEADER = "x-olumi-service-build";

/**
 * Extract payload hash from request headers
 */
function getPayloadHash(request: FastifyRequest): string | undefined {
  const header = request.headers[PAYLOAD_HASH_HEADER];
  if (typeof header === "string" && header.length > 0) {
    return header;
  }
  return undefined;
}

/**
 * Extract client build version from request headers
 */
function getClientBuild(request: FastifyRequest): string | undefined {
  const header = request.headers[CLIENT_BUILD_HEADER];
  if (typeof header === "string" && header.length > 0) {
    return header;
  }
  return undefined;
}

/**
 * Extract body metadata for debugging (redacted/hashed summary)
 * Returns size and top-level keys without exposing actual values
 */
function getBodyMeta(request: FastifyRequest): { payload_bytes?: number; payload_keys?: string[] } {
  const contentLength = request.headers["content-length"];
  const result: { payload_bytes?: number; payload_keys?: string[] } = {};

  // Extract payload size from Content-Length header
  if (contentLength) {
    const bytes = parseInt(contentLength, 10);
    if (!isNaN(bytes)) {
      result.payload_bytes = bytes;
    }
  }

  // Extract top-level keys from JSON body (if available)
  // Note: body may not be parsed yet in onRequest, so we handle gracefully
  const body = (request as any).body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    result.payload_keys = Object.keys(body).sort();
  }

  return result;
}

/**
 * Boundary logging plugin (internal implementation)
 */
async function boundaryLoggingPluginImpl(fastify: FastifyInstance) {
  // Hook: onRequest - emit boundary.request event and capture metadata
  fastify.addHook("onRequest", async (request: FastifyRequest) => {
    const requestId = getRequestId(request);
    const payloadHash = getPayloadHash(request);
    const clientBuild = getClientBuild(request);
    const bodyMeta = getBodyMeta(request);

    // Store for later use in boundary.response (preserves client metadata)
    (request as any).boundaryMeta = {
      payloadHash,
      clientBuild,
      startTime: Date.now(),
    };

    // Emit boundary.request event with body metadata hints
    emit(TelemetryEvents.BoundaryRequest, {
      timestamp: new Date().toISOString(),
      request_id: requestId,
      service: SERVICE_NAME,
      endpoint: request.url,
      method: request.method,
      payload_hash: payloadHash,
      client_build: clientBuild,
      payload_bytes: bodyMeta.payload_bytes,
      payload_keys: bodyMeta.payload_keys,
    });
  });

  // Hook: onSend - add service headers to all responses
  fastify.addHook("onSend", async (_request, reply: FastifyReply, payload) => {
    // Add service identification headers to ALL responses
    reply.header(SERVICE_HEADER, SERVICE_NAME);
    reply.header(SERVICE_BUILD_HEADER, GIT_COMMIT_SHORT);

    return payload;
  });

  // Hook: onResponse - emit boundary.response event
  fastify.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = getRequestId(request);
    const boundaryMeta = (request as any).boundaryMeta || {};
    const startTime = boundaryMeta.startTime || Date.now();
    const elapsedMs = Date.now() - startTime;

    // Get response hash (set by response-hash plugin)
    const responseHash = (reply as any).responseHash;
    const responseHashSkipped = (reply as any).responseHashSkipped;

    // Get timing summary (set by request-timing utility)
    const timingSummary = getTimingSummary(request);

    // Emit boundary.response event with preserved client metadata
    emit(TelemetryEvents.BoundaryResponse, {
      timestamp: new Date().toISOString(),
      request_id: requestId,
      service: SERVICE_NAME,
      endpoint: request.url,
      status: reply.statusCode,
      elapsed_ms: elapsedMs,
      response_hash: responseHash,
      response_hash_skipped: responseHashSkipped,
      // Preserve client metadata from request for end-to-end tracing
      payload_hash: boundaryMeta.payloadHash,
      client_build: boundaryMeta.clientBuild,
      // Performance timing summary (observability v2)
      timings: timingSummary,
    });
  });
}

/**
 * Boundary logging plugin (exported with fastify-plugin)
 */
export const boundaryLoggingPlugin = fp(boundaryLoggingPluginImpl, {
  name: "boundary-logging",
  fastify: "5.x",
});
