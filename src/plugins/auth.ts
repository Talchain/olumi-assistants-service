import { env } from "node:process";
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { buildErrorV1 } from "../utils/errors.js";
import { getRequestId } from "../utils/request-id.js";

/**
 * API Key Authentication Plugin
 *
 * Enforces X-Olumi-Assist-Key header authentication for all /assist/* routes.
 * Skips authentication for /healthz and other non-assist routes.
 *
 * Configuration:
 * - ASSIST_API_KEY: Required API key (if not set, auth is disabled)
 *
 * Error responses:
 * - 401 UNAUTHENTICATED: Missing X-Olumi-Assist-Key header
 * - 403 FORBIDDEN: Invalid API key
 */

const AUTH_HEADER = "X-Olumi-Assist-Key";

async function authPlugin(fastify: FastifyInstance) {
  // Read API key at registration time (not module load time)
  const ASSIST_API_KEY = env.ASSIST_API_KEY;

  // Skip auth entirely if ASSIST_API_KEY not configured
  if (!ASSIST_API_KEY) {
    fastify.log.warn(
      "ASSIST_API_KEY not set - API key authentication disabled (unsafe for production)"
    );
    return;
  }

  fastify.log.info("API key authentication enabled for /assist/* routes");

  // Add onRequest hook to enforce auth on /assist/* routes
  fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for non-assist routes (healthz, etc.)
    if (!request.url.startsWith("/assist/")) {
      return;
    }

    const requestId = getRequestId(request);
    const providedKey = request.headers[AUTH_HEADER.toLowerCase()];

    // Missing header
    if (!providedKey) {
      fastify.log.warn(
        {
          event: "auth_missing_header",
          url: request.url,
          request_id: requestId,
        },
        "Authentication failed: missing API key header"
      );

      const error = buildErrorV1(
        "UNAUTHENTICATED",
        `Missing ${AUTH_HEADER} header`,
        {
          hint: `Include ${AUTH_HEADER} header with your API key`,
        },
        requestId
      );

      return reply.status(401).send(error);
    }

    // Invalid key
    if (providedKey !== ASSIST_API_KEY) {
      fastify.log.warn(
        {
          event: "auth_invalid_key",
          url: request.url,
          request_id: requestId,
        },
        "Authentication failed: invalid API key"
      );

      const error = buildErrorV1(
        "FORBIDDEN",
        "Invalid API key",
        {
          hint: "Check your API key configuration",
        },
        requestId
      );

      return reply.status(403).send(error);
    }

    // Valid key - proceed
    fastify.log.debug(
      {
        event: "auth_success",
        url: request.url,
        request_id: requestId,
      },
      "Authentication successful"
    );
  });
}

export default fp(authPlugin, {
  name: "auth",
  dependencies: ["observability"], // Depends on observability plugin for logging
});
