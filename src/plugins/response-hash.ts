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
 * Response-hash marker fields written to FastifyReply by this plugin and
 * read by the boundary-logging plugin's `onResponse` hook. Declared via
 * Fastify module augmentation so cross-plugin reads / writes are
 * type-checked at call sites without local casts.
 *
 * Module augmentation makes the optional fields visible on every
 * FastifyReply across the codebase. This is safe because both fields
 * are optional and the writer (this plugin) is the only producer.
 */
declare module "fastify" {
  interface FastifyReply {
    /** 12-hex response hash set by responseHashPlugin onSend. */
    responseHash?: string;
    /**
     * True when responseHashPlugin's onSend hook deliberately skipped
     * hashing for this reply (empty / preflight / non-JSON / 204 path).
     */
    responseHashSkipped?: boolean;
  }
}

/**
 * Mark this reply as having had its hash deliberately skipped. Read by
 * boundary-logging's onResponse hook so dashboards differentiate
 * "missing hash" from "skipped hash".
 */
function markReplyHashSkipped(reply: FastifyReply): void {
  reply.responseHashSkipped = true;
}

/**
 * Attach the computed hash to the reply. Boundary-logging reads it via
 * the typed accessor below.
 */
function markReplyHash(reply: FastifyReply, hash: string): void {
  reply.responseHash = hash;
}

/**
 * Read the response-hash markers from a reply. Used by boundary-logging's
 * `onResponse` hook so the cross-plugin contract is centralised in this
 * file alongside the writer (`markReplyHash` / `markReplyHashSkipped`).
 */
export function readResponseHashMarkers(
  reply: FastifyReply,
): { hash: string | undefined; skipped: boolean | undefined } {
  return { hash: reply.responseHash, skipped: reply.responseHashSkipped };
}

/**
 * Response hash plugin (internal implementation)
 */
async function responseHashPluginImpl(fastify: FastifyInstance) {
  // Hook: onSend (before sending response to client)
  // This runs after serialization, so we can hash the final response body
  fastify.addHook("onSend", async (request, reply: FastifyReply, payload: unknown) => {
    // Skip empty / preflight / no-content responses BEFORE attempting any
    // hash work. Three independent guards (P0 fix, 2026-05):
    //
    //   1. payload is undefined or null — Fastify passes `undefined` to
    //      onSend when reply.send() is called with no body (e.g.
    //      @fastify/cors's preflight short-circuit). Calling
    //      computeResponseHash(undefined) propagates to
    //      createHash().update(undefined) which throws ERR_INVALID_ARG_TYPE
    //      and becomes a 500 — see the OPTIONS preflight regression that
    //      blocked the staging UI in 2026-05.
    //
    //   2. method === 'OPTIONS' — preflight responses carry no API
    //      content; hashing them is meaningless and historically tripped
    //      guard 1 because @fastify/cors's preflight reply has no body.
    //      Belt-and-braces with guard 1.
    //
    //   3. statusCode === 204 — No Content responses by definition have
    //      no body to hash. Same belt-and-braces rationale.
    //
    // Guards run before the content-type skip check because the
    // content-type skip's `typeof contentType === 'string'` predicate
    // returns false for `undefined`, so the original code fell through to
    // the throw-prone path on preflight responses.
    if (
      payload === undefined ||
      payload === null ||
      request.method === "OPTIONS" ||
      reply.statusCode === 204
    ) {
      markReplyHashSkipped(reply);
      return payload;
    }

    // Skip for non-JSON responses (e.g., SSE streams, NDJSON)
    // Mark as skipped so boundary.response can differentiate missing vs skipped hashes
    const contentType = reply.getHeader("content-type");
    if (typeof contentType === "string" && !contentType.includes("application/json")) {
      markReplyHashSkipped(reply);
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
    markReplyHash(reply, hash);

    // Log for debugging
    log.debug({
      response_hash: hash,
      path: request.url,
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
