import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { readRoutingLogEntry } from '../orchestrator-v5/routing/routing-log-reader.js';
import { verifyAdminKey } from '../middleware/admin-auth.js';
import { log } from '../utils/telemetry.js';

const TurnIdParamsSchema = z.object({
  turn_id: z.string().min(1),
});

export async function adminRoutingLogRoutes(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    max: 100,
    timeWindow: 15 * 60 * 1000,
    keyGenerator: (request) => {
      const adminKey = request.headers['x-admin-key'] as string ?? '';
      return `routing_log:${adminKey.slice(0, 8)}:${request.ip}`;
    },
    errorResponseBuilder: () => ({
      error: 'rate_limit_exceeded',
      message: 'Too many requests. Please try again later.',
    }),
  });

  /**
   * GET /admin/v1/routing-log/:turn_id
   *
   * Retrieve the RoutingLog record for a specific turn from the JSONL file.
   * Allows per-turn inspection of intent class, handler selection, CQE summary,
   * and graph lookup outcome without grepping the JSONL file directly.
   *
   * Note: path uses /v1/ prefix for consistency with other admin routes.
   * The brief specified /admin/routing-log/:turn_id -- the /v1/ prefix is a
   * deliberate deviation for route naming consistency (documented in Phase 2 report).
   *
   * Returns:
   *   200 -- record found
   *   404 -- turn_id not present in the JSONL file
   *   410 -- JSONL file absent (not yet written, or rotated/deleted)
   */
  app.get('/admin/v1/routing-log/:turn_id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply, 'read')) return;

    const params = TurnIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: params.error.flatten(),
      });
    }

    const result = await readRoutingLogEntry(params.data.turn_id);

    if (result === 'file_absent') {
      log.info({ turn_id: params.data.turn_id, event: 'routing_log.miss', reason: 'file_absent' }, 'Routing log JSONL file absent');
      return reply.status(410).send({
        error: 'file_absent',
        message: 'Routing log file not found. The service may not have processed any turns yet, or the log file has been rotated.',
      });
    }

    if (result === 'read_error') {
      log.warn({ turn_id: params.data.turn_id, event: 'routing_log.error', reason: 'read_error' }, 'Routing log read error');
      return reply.status(500).send({
        error: 'read_error',
        message: 'Failed to read routing log file. Check server logs for details.',
      });
    }

    if (!result) {
      log.info({ turn_id: params.data.turn_id, event: 'routing_log.miss', reason: 'not_found' }, 'Routing log entry not found');
      return reply.status(404).send({
        error: 'not_found',
        message: 'No routing log entry found for this turn_id.',
      });
    }

    return reply.status(200).send(result);
  });
}
