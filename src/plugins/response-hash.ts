/**
 * Response Hash Plugin
 *
 * Adds x-olumi-response-hash header to all API responses for:
 * - Response integrity verification
 * - Cache validation
 * - Replay detection
 * - Cross-service correlation
 *
 * Hash is deterministic: same response always produces same hash
 * Uses canonical JSON (sorted keys, no undefined) for consistency with UI.
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { computeResponseHash } from "../utils/response-hash.js";
import { log } from "../utils/telemetry.js";

/**
 * Response hash plugin (internal implementation)
 */
async function responseHashPluginImpl(fastify: FastifyInstance) {
  // Hook: onSend (before sending response to client)
  // This runs after serialization, so we can hash the final response body
  fastify.addHook("onSend", async (_request, reply: FastifyReply, payload: unknown) => {
    // Skip for non-JSON responses (e.g., SSE streams, NDJSON)
    // Mark as skipped so boundary.response can differentiate missing vs skipped hashes
    const contentType = reply.getHeader("content-type");
    if (typeof contentType === "string" && !contentType.includes("application/json")) {
      (reply as any).responseHashSkipped = true;
      return payload;
    }

    // Parse response body
    // Note: We must parse to an object to enable deterministic hashing via
    // canonical JSON serialization (sorted keys). Hashing the string directly
    // would break determinism if key order varies between responses.
    let body: unknown;
    try {
      if (typeof payload === "string") {
        body = JSON.parse(payload);
      } else if (Buffer.isBuffer(payload)) {
        body = JSON.parse(payload.toString("utf8"));
      } else {
        body = payload;
      }
    } catch {
      // If parsing fails, skip hashing (invalid JSON)
      return payload;
    }

    // Generate 12-char hash (canonicalizes JSON for determinism)
    const hash = computeResponseHash(body);

    // Add header
    reply.header("x-olumi-response-hash", hash);

    // Store hash for boundary logging (will be picked up by onResponse hook)
    (reply as any).responseHash = hash;

    // Log for debugging
    log.debug({
      response_hash: hash,
      path: _request.url,
      status: reply.statusCode,
    }, "Response hash computed");

    return payload;
  });
}

/**
 * Response hash plugin (exported with fastify-plugin)
 */
export const responseHashPlugin = fp(responseHashPluginImpl, {
  name: "response-hash",
  fastify: "5.x",
});
