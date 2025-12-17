/**
 * Share-for-Review Routes
 *
 * POST /assist/share - Create signed share URL
 * GET /assist/share/:id - Retrieve shared content (read-only, redacted)
 * DELETE /assist/share/:id - Revoke share
 */

import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { Graph } from "../schemas/graph.js";
import { buildErrorV1 } from "../utils/errors.js";
import { getRequestId } from "../utils/request-id.js";
import { TelemetryEvents, emit } from "../utils/telemetry.js";
import {
  generateShareId,
  signShareToken,
  verifyShareToken,
  hashShareId,
} from "../utils/share-token.js";
import { storeShare, getShare, revokeShare } from "../utils/share-storage.js";
import {
  redactGraphForShare,
  redactBrief,
  calculateRedactedSize,
  SHARE_SIZE_LIMITS,
} from "../utils/share-redaction.js";
import { config } from "../config/index.js";

/**
 * Check if share feature is enabled
 */
function isShareEnabled(): boolean {
  return config.features.shareReview;
}

/**
 * Share routes registration
 */
export default async function route(app: FastifyInstance) {
  // Rate limiting for share routes to prevent abuse
  // GET/DELETE routes use token-based auth, so we need explicit rate limiting
  await app.register(rateLimit, {
    max: 60,
    timeWindow: 60 * 1000, // 60 requests per minute
    keyGenerator: (request) => {
      // Rate limit by IP for public share routes
      return `share:${request.ip}`;
    },
    errorResponseBuilder: (_, context) => ({
      schema: "error.v1",
      code: "RATE_LIMITED",
      message: "Too many requests. Please try again later.",
      details: {
        retry_after_seconds: Math.ceil(context.ttl / 1000),
      },
    }),
  });

  /**
   * POST /assist/share
   * Create a signed, redacted share URL
   */
  app.post("/assist/share", async (req, reply) => {
    if (!isShareEnabled()) {
      const requestId = getRequestId(req);
      return reply.code(404).send(
        buildErrorV1("NOT_FOUND", "Share feature not enabled", {}, requestId)
      );
    }

    const requestId = getRequestId(req);

    try {
      // Validate input
      const ShareInputSchema = z.object({
        graph: Graph,
        brief: z.string().optional(),
        ttl_hours: z.number().min(1).max(168).default(24), // 1h-7d, default 24h
      });

      const input = ShareInputSchema.parse(req.body);

      // Validate size constraints
      if (input.graph.nodes.length > SHARE_SIZE_LIMITS.MAX_NODES) {
        return reply.code(400).send(
          buildErrorV1(
            "BAD_INPUT",
            `Graph too large: ${input.graph.nodes.length} nodes (max ${SHARE_SIZE_LIMITS.MAX_NODES})`,
            {},
            requestId
          )
        );
      }

      if (input.graph.edges.length > SHARE_SIZE_LIMITS.MAX_EDGES) {
        return reply.code(400).send(
          buildErrorV1(
            "BAD_INPUT",
            `Graph too large: ${input.graph.edges.length} edges (max ${SHARE_SIZE_LIMITS.MAX_EDGES})`,
            {},
            requestId
          )
        );
      }

      const redactedSize = calculateRedactedSize(input.graph, input.brief);
      if (redactedSize > SHARE_SIZE_LIMITS.MAX_GRAPH_SIZE) {
        return reply.code(400).send(
          buildErrorV1(
            "BAD_INPUT",
            `Content too large: ${redactedSize} bytes (max ${SHARE_SIZE_LIMITS.MAX_GRAPH_SIZE})`,
            {},
            requestId
          )
        );
      }

      // Generate share
      const shareId = generateShareId();
      const now = Date.now();
      const expiresAt = now + input.ttl_hours * 60 * 60 * 1000;

      // Redact and store
      const redactedGraph = redactGraphForShare(input.graph);
      const redactedBrief = input.brief ? redactBrief(input.brief) : undefined;

      // Await persistence to ensure share is stored before returning URL
      await storeShare({
        share_id: shareId,
        graph: redactedGraph,
        brief: redactedBrief,
        created_at: now,
        expires_at: expiresAt,
        revoked: false,
        access_count: 0,
      });

      // Sign token
      const token = signShareToken({
        share_id: shareId,
        created_at: now,
        expires_at: expiresAt,
      });

      // Telemetry
      emit(TelemetryEvents.ShareCreated, {
        share_id_hash: hashShareId(shareId),
        ttl_hours: input.ttl_hours,
        graph_nodes: input.graph.nodes.length,
        graph_edges: input.graph.edges.length,
        has_brief: !!input.brief,
        size_bytes: redactedSize,
      });

      // Build share URL
      const baseUrl = config.server.baseUrl || "https://olumi-assistants-service.onrender.com";
      const shareUrl = `${baseUrl}/assist/share/${token}`;

      return reply.code(201).send({
        schema: "share.v1",
        share_id: shareId,
        url: shareUrl,
        expires_at: new Date(expiresAt).toISOString(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        // Check for size limit errors
        const sizeError = error.errors.find(
          (e) => e.code === "too_big" && (e.path.includes("nodes") || e.path.includes("edges"))
        );

        if (sizeError) {
          const field = sizeError.path.includes("nodes") ? "nodes" : "edges";
          const max = field === "nodes" ? SHARE_SIZE_LIMITS.MAX_NODES : SHARE_SIZE_LIMITS.MAX_EDGES;
          return reply.code(400).send(
            buildErrorV1(
              "BAD_INPUT",
              `Graph too large: too many ${field} (max ${max})`,
              {},
              requestId
            )
          );
        }

        return reply.code(400).send(
          buildErrorV1("BAD_INPUT", "Invalid request", { errors: error.errors }, requestId)
        );
      }

      app.log.error({ error, request_id: requestId }, "Share creation failed");
      return reply.code(500).send(
        buildErrorV1("INTERNAL", "Failed to create share", {}, requestId)
      );
    }
  });

  /**
   * GET /assist/share/:token
   * Retrieve shared content (read-only, redacted)
   */
  app.get("/assist/share/*", async (req, reply) => {
    if (!isShareEnabled()) {
      const requestId = getRequestId(req);
      return reply.code(404).send(
        buildErrorV1("NOT_FOUND", "Share feature not enabled", {}, requestId)
      );
    }

    const requestId = getRequestId(req);
    // Extract token from wildcard path
    const token = req.url.replace("/assist/share/", "");

    try {
      // Verify token
      const payload = verifyShareToken(token);
      if (!payload) {
        emit(TelemetryEvents.ShareExpired, { reason: "invalid_token" });
        return reply.code(410).send(
          buildErrorV1("NOT_FOUND", "Share expired or invalid", {}, requestId)
        );
      }

      // Retrieve share data
      const shareData = await getShare(payload.share_id);
      if (!shareData) {
        emit(TelemetryEvents.ShareNotFound, {
          share_id_hash: hashShareId(payload.share_id),
        });
        return reply.code(410).send(
          buildErrorV1("NOT_FOUND", "Share not found or revoked", {}, requestId)
        );
      }

      // Telemetry
      emit(TelemetryEvents.ShareAccessed, {
        share_id_hash: hashShareId(payload.share_id),
        access_count: shareData.access_count,
        age_hours: Math.floor((Date.now() - shareData.created_at) / (1000 * 60 * 60)),
      });

      // Return redacted content
      return reply.code(200).send({
        schema: "share-content.v1",
        share_id: shareData.share_id,
        graph: shareData.graph,
        brief: shareData.brief,
        created_at: new Date(shareData.created_at).toISOString(),
        expires_at: new Date(shareData.expires_at).toISOString(),
        access_count: shareData.access_count,
      });
    } catch (error) {
      app.log.error({ error, request_id: requestId }, "Share retrieval failed");
      return reply.code(500).send(
        buildErrorV1("INTERNAL", "Failed to retrieve share", {}, requestId)
      );
    }
  });

  /**
   * DELETE /assist/share/:token
   * Revoke share immediately
   */
  app.delete("/assist/share/*", async (req, reply) => {
    if (!isShareEnabled()) {
      const requestId = getRequestId(req);
      return reply.code(404).send(
        buildErrorV1("NOT_FOUND", "Share feature not enabled", {}, requestId)
      );
    }

    const requestId = getRequestId(req);
    // Extract token from wildcard path
    const token = req.url.replace("/assist/share/", "");

    try {
      // Verify token
      const payload = verifyShareToken(token);
      if (!payload) {
        return reply.code(404).send(
          buildErrorV1("NOT_FOUND", "Share not found", {}, requestId)
        );
      }

      // Revoke
      const revoked = await revokeShare(payload.share_id);
      if (!revoked) {
        return reply.code(404).send(
          buildErrorV1("NOT_FOUND", "Share not found", {}, requestId)
        );
      }

      // Telemetry
      emit(TelemetryEvents.ShareRevoked, {
        share_id_hash: hashShareId(payload.share_id),
      });

      return reply.code(200).send({
        schema: "share-revoke.v1",
        share_id: payload.share_id,
        revoked: true,
      });
    } catch (error) {
      app.log.error({ error, request_id: requestId }, "Share revocation failed");
      return reply.code(500).send(
        buildErrorV1("INTERNAL", "Failed to revoke share", {}, requestId)
      );
    }
  });
}
