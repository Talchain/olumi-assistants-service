import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { env } from "node:process";
import { getRequestId } from "../utils/request-id.js";
import { safeLog } from "../utils/redaction.js";

/**
 * Observability Plugin
 *
 * Configures structured logging with:
 * - Request/response sampling (INFO_SAMPLE_RATE, default 0.1)
 * - Automatic redaction of PII in logs
 * - Request ID propagation
 * - Duration tracking
 */

const INFO_SAMPLE_RATE = Number(env.INFO_SAMPLE_RATE) || 0.1;

/**
 * Should we sample this request for info-level logging?
 * Always log errors (4xx, 5xx), sample successful requests.
 */
function shouldSampleInfoLog(statusCode: number): boolean {
  if (statusCode >= 400) return true; // Always log errors
  return Math.random() < INFO_SAMPLE_RATE; // Sample successful requests
}

async function observabilityPlugin(fastify: FastifyInstance) {
  // Track request start time (only if not already set by another plugin)
  fastify.addHook("onRequest", async (request: FastifyRequest) => {
    if (!(request as any).startTime) {
      (request as any).startTime = Date.now();
    }
  });

  // Log request completion with sampling
  fastify.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    const duration = Date.now() - ((request as any).startTime || Date.now());
    const requestId = getRequestId(request);
    const statusCode = reply.statusCode;

    // Apply sampling for info logs
    if (!shouldSampleInfoLog(statusCode)) {
      return; // Skip logging this request
    }

    const logData = {
      request_id: requestId,
      method: request.method,
      url: request.url,
      status: statusCode,
      duration_ms: duration,
      user_agent: request.headers['user-agent'],
    };

    // Apply redaction before logging
    const safeData = safeLog(logData);

    if (statusCode >= 500) {
      fastify.log.error(safeData, "Request completed with server error");
    } else if (statusCode >= 400) {
      fastify.log.warn(safeData, "Request completed with client error");
    } else {
      fastify.log.info(safeData, "Request completed");
    }
  });

  // Log uncaught errors in request lifecycle
  fastify.addHook("onError", async (request: FastifyRequest, _reply: FastifyReply, error: Error) => {
    const requestId = getRequestId(request);
    const duration = Date.now() - ((request as any).startTime || Date.now());

    // Always log errors (no sampling)
    fastify.log.error(
      safeLog({
        request_id: requestId,
        method: request.method,
        url: request.url,
        duration_ms: duration,
        error: {
          name: error.name,
          message: error.message,
          // Never log stack in production unless explicitly enabled
          ...(env.LOG_STACK === "1" ? { stack: error.stack } : {}),
        },
      }),
      "Request error"
    );
  });
}

export default fp(observabilityPlugin, {
  name: "observability",
  fastify: "5.x",
});
