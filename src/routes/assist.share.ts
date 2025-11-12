/**
 * Share-for-Review Routes (v1.5.0 - PR I)
 *
 * POST /assist/share - Create shareable link for a decision graph
 * GET /share/:token - View shared graph (redacted, public)
 * DELETE /share/:token - Revoke a share
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Graph } from "../schemas/graph.js";
import { generateShareToken, verifyShareToken, extractShareId, revokeShare, isShareRevoked } from "../utils/share-token.js";
import { redactGraphForSharing, containsSensitiveInfo, type RedactionOptions } from "../utils/graph-redaction.js";
import { buildErrorV1, zodErrorToErrorV1 } from "../utils/errors.js";
import { getRequestId } from "../utils/request-id.js";
import { log } from "../utils/telemetry.js";
import { env } from "node:process";

/**
 * Input schema for creating a share
 */
const CreateShareInputSchema = z.object({
  graph: Graph,
  expiry_hours: z.number().min(1).max(168).optional().default(168), // 1 hour to 7 days
  redaction_options: z.object({
    keep_brief: z.boolean().optional().default(false),
    keep_bodies: z.boolean().optional().default(false),
    keep_rationales: z.boolean().optional().default(false),
  }).optional().default({}),
});

/**
 * Response schema for share creation
 */
const ShareResponse = z.object({
  schema: z.literal("share.v1"),
  share_id: z.string(),
  share_url: z.string(),
  expires_at: z.string(),
  redacted: z.object({
    brief: z.boolean(),
    bodies: z.boolean(),
    rationales: z.boolean(),
  }),
});

/**
 * Response schema for viewing a share
 */
const ViewShareResponse = z.object({
  schema: z.literal("shared_graph.v1"),
  graph: z.any(), // RedactedGraph
  shared_at: z.string(),
  expires_at: z.string(),
});

// In-memory storage for shared graphs (production should use database/Redis)
// NOTE: Placed outside route handler to persist across requests
const sharedGraphs = new Map<string, { graph: any; redaction_options: RedactionOptions }>();

export default async function route(app: FastifyInstance) {
  /**
   * POST /assist/share
   * Create a shareable link for a decision graph
   */
  app.post("/assist/share", async (req, reply) => {
    const requestId = getRequestId(req);

    try {
      // Validate input
      const validationResult = CreateShareInputSchema.safeParse(req.body);

      if (!validationResult.success) {
        const errorV1 = zodErrorToErrorV1(validationResult.error, requestId);
        return reply.status(400).send(errorV1);
      }

      const { graph, expiry_hours, redaction_options } = validationResult.data;

      // Check if brief contains sensitive info and override keep_brief if needed
      const graphMeta = graph.meta as any;
      const briefHasSensitiveInfo = graphMeta?.brief
        ? containsSensitiveInfo(graphMeta.brief)
        : false;

      const effectiveOptions: RedactionOptions = {
        ...redaction_options,
        // Force redact brief if it contains sensitive information
        keep_brief: redaction_options.keep_brief && !briefHasSensitiveInfo,
      };

      // Generate share token
      const expiryMs = expiry_hours * 60 * 60 * 1000;
      const { token, payload } = generateShareToken(undefined, expiryMs);

      // Store graph with redaction options
      sharedGraphs.set(payload.share_id, {
        graph,
        redaction_options: effectiveOptions,
      });

      // Construct share URL
      const baseUrl = env.PUBLIC_BASE_URL || `http://localhost:${env.PORT || 3000}`;
      const shareUrl = `${baseUrl}/share/${token}`;

      log.info({
        request_id: requestId,
        share_id: payload.share_id,
        expires_at: new Date(payload.expires_at).toISOString(),
        redacted_brief: !effectiveOptions.keep_brief,
        redacted_bodies: !effectiveOptions.keep_bodies,
        redacted_rationales: !effectiveOptions.keep_rationales,
        sensitive_brief_detected: briefHasSensitiveInfo,
      }, "Share created");

      const response = ShareResponse.parse({
        schema: "share.v1",
        share_id: payload.share_id,
        share_url: shareUrl,
        expires_at: new Date(payload.expires_at).toISOString(),
        redacted: {
          brief: !effectiveOptions.keep_brief,
          bodies: !effectiveOptions.keep_bodies,
          rationales: !effectiveOptions.keep_rationales,
        },
      });

      return reply.send(response);
    } catch (error) {
      log.error({ error, request_id: requestId }, "Share creation failed");

      const errorV1 = buildErrorV1(
        'INTERNAL',
        error instanceof Error ? error.message : 'Failed to create share',
        undefined,
        requestId
      );
      return reply.status(500).send(errorV1);
    }
  });

  /**
   * GET /share/:token
   * View a shared decision graph
   */
  app.get("/share/:token", async (req, reply) => {
    const requestId = getRequestId(req);
    const { token } = req.params as { token: string };

    try {
      // Verify token
      let payload;
      try {
        payload = verifyShareToken(token);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        if (err.message.includes("expired")) {
          const errorV1 = buildErrorV1('BAD_INPUT', 'Share link has expired', undefined, requestId);
          return reply.status(410).send(errorV1); // 410 Gone
        }

        const errorV1 = buildErrorV1('BAD_INPUT', 'Invalid or malformed share link', undefined, requestId);
        return reply.status(400).send(errorV1);
      }

      // Check revocation
      if (isShareRevoked(payload.share_id)) {
        const errorV1 = buildErrorV1('BAD_INPUT', 'Share link has been revoked', undefined, requestId);
        return reply.status(410).send(errorV1); // 410 Gone
      }

      // Retrieve stored graph
      const stored = sharedGraphs.get(payload.share_id);
      if (!stored) {
        const errorV1 = buildErrorV1('NOT_FOUND', 'Share not found', undefined, requestId);
        return reply.status(404).send(errorV1);
      }

      // Redact graph
      const redactedGraph = redactGraphForSharing(stored.graph, stored.redaction_options);

      log.info({
        request_id: requestId,
        share_id: payload.share_id,
      }, "Share viewed");

      const response = ViewShareResponse.parse({
        schema: "shared_graph.v1",
        graph: redactedGraph,
        shared_at: new Date(payload.created_at).toISOString(),
        expires_at: new Date(payload.expires_at).toISOString(),
      });

      return reply.send(response);
    } catch (error) {
      log.error({ error, request_id: requestId }, "Share view failed");

      const errorV1 = buildErrorV1(
        'INTERNAL',
        'Failed to retrieve shared graph',
        undefined,
        requestId
      );
      return reply.status(500).send(errorV1);
    }
  });

  /**
   * DELETE /share/:token
   * Revoke a share
   */
  app.delete("/share/:token", async (req, reply) => {
    const requestId = getRequestId(req);
    const { token } = req.params as { token: string };

    try {
      // Extract share ID (don't need full verification for revocation)
      const shareId = extractShareId(token);
      if (!shareId) {
        const errorV1 = buildErrorV1('BAD_INPUT', 'Invalid share token', undefined, requestId);
        return reply.status(400).send(errorV1);
      }

      // Revoke the share
      revokeShare(shareId);

      // Remove from storage
      sharedGraphs.delete(shareId);

      log.info({
        request_id: requestId,
        share_id: shareId,
      }, "Share revoked");

      return reply.status(204).send();
    } catch (error) {
      log.error({ error, request_id: requestId }, "Share revocation failed");

      const errorV1 = buildErrorV1(
        'INTERNAL',
        'Failed to revoke share',
        undefined,
        requestId
      );
      return reply.status(500).send(errorV1);
    }
  });
}
