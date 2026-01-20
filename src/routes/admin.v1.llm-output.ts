import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { config } from '../config/index.js';
import { getLLMOutput, getLLMOutputStoreSize } from '../cee/llm-output-store.js';

type AdminPermission = 'read' | 'write';

function getAllowedIPs(): Set<string> | null {
  const allowedIPsConfig = config.prompts?.adminAllowedIPs;
  if (!allowedIPsConfig || allowedIPsConfig.trim() === '') {
    return null;
  }

  return new Set(
    allowedIPsConfig
      .split(',')
      .map((ip) => ip.trim())
      .filter((ip) => ip.length > 0)
  );
}

function verifyIPAllowed(request: FastifyRequest, reply: FastifyReply): boolean {
  const allowedIPs = getAllowedIPs();
  if (!allowedIPs) return true;

  const requestIP = request.ip;
  const isAllowed =
    allowedIPs.has(requestIP) ||
    (requestIP === '::1' && allowedIPs.has('127.0.0.1')) ||
    (requestIP === '127.0.0.1' && allowedIPs.has('::1'));

  if (!isAllowed) {
    reply.status(403).send({
      error: 'ip_not_allowed',
      message: 'Your IP address is not authorized for admin access',
    });
    return false;
  }
  return true;
}

function verifyAdminKey(
  request: FastifyRequest,
  reply: FastifyReply,
  requiredPermission: AdminPermission = 'read'
): boolean {
  if (!verifyIPAllowed(request, reply)) return false;

  const adminKey = config.prompts?.adminApiKey;
  const adminKeyRead = config.prompts?.adminApiKeyRead;

  if (!adminKey && !adminKeyRead) {
    reply.status(503).send({
      error: 'admin_not_configured',
      message: 'Admin API is not configured',
    });
    return false;
  }

  const providedKey = request.headers['x-admin-key'] as string;
  if (!providedKey) {
    reply.status(401).send({
      error: 'unauthorized',
      message: 'Missing admin API key',
    });
    return false;
  }

  if (adminKey && providedKey === adminKey) return true;

  if (adminKeyRead && providedKey === adminKeyRead) {
    if (requiredPermission === 'write') {
      reply.status(403).send({
        error: 'forbidden',
        message: 'Read-only key cannot perform write operations',
      });
      return false;
    }
    return true;
  }

  reply.status(401).send({
    error: 'unauthorized',
    message: 'Invalid admin API key',
  });
  return false;
}

const RequestIdParamsSchema = z.object({
  request_id: z.string().min(1),
});

export async function adminLLMOutputRoutes(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    max: 100,
    timeWindow: 15 * 60 * 1000,
    keyGenerator: (request) => {
      const adminKey = request.headers['x-admin-key'] as string ?? '';
      return `llm_output:${adminKey.slice(0, 8)}:${request.ip}`;
    },
    errorResponseBuilder: () => ({
      error: 'rate_limit_exceeded',
      message: 'Too many requests. Please try again later.',
    }),
  });

  /**
   * GET /admin/v1/llm-output/:request_id
   *
   * Retrieve the full LLM output for a specific request ID.
   * This is used for debugging and admin purposes to inspect
   * the complete raw output from the LLM.
   *
   * Returns 404 if the output is not found or has expired (TTL: 1 hour).
   */
  app.get('/admin/v1/llm-output/:request_id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply, 'read')) return;

    const params = RequestIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: params.error.flatten(),
      });
    }

    const entry = getLLMOutput(params.data.request_id);
    if (!entry) {
      return reply.status(404).send({
        error: 'not_found',
        message: 'LLM output not found or has expired (TTL: 1 hour)',
      });
    }

    return reply.status(200).send({
      request_id: entry.requestId,
      output_hash: entry.outputHash,
      raw_text: entry.rawText,
      parsed_json: entry.parsedJson ?? null,
      node_count: entry.nodeCount,
      edge_count: entry.edgeCount,
      stored_at: new Date(entry.storedAt).toISOString(),
      model: entry.model ?? null,
      prompt_version: entry.promptVersion ?? null,
    });
  });

  /**
   * GET /admin/v1/llm-output-stats
   *
   * Get diagnostics about the LLM output store.
   */
  app.get('/admin/v1/llm-output-stats', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply, 'read')) return;

    return reply.status(200).send({
      store_size: getLLMOutputStoreSize(),
      max_entries: 1000,
      ttl_ms: 60 * 60 * 1000,
    });
  });
}
