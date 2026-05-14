import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { getTurnDebug, getTurnDebugStoreSize } from '../orchestrator-v5/debug/turn-debug-store.js';
import { verifyAdminKey } from '../middleware/admin-auth.js';
import { log } from '../utils/telemetry.js';

const DEFAULT_TTL_MS = 60 * 60 * 1000;

const TurnIdParamsSchema = z.object({
  turn_id: z.string().min(1),
});

export async function adminTurnDebugRoutes(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    max: 100,
    timeWindow: 15 * 60 * 1000,
    keyGenerator: (request) => {
      const adminKey = request.headers['x-admin-key'] as string ?? '';
      return `turn_debug:${adminKey.slice(0, 8)}:${request.ip}`;
    },
    errorResponseBuilder: () => ({
      error: 'rate_limit_exceeded',
      message: 'Too many requests. Please try again later.',
    }),
  });

  /**
   * GET /admin/v1/turn-debug/:turn_id
   *
   * Retrieve V5 per-turn debug data for a specific turn ID.
   * Includes the full CQE extraction section: parsed_quantities,
   * patterns_matched, timing flags, and summary counters.
   *
   * Enabled only when CEE_TURN_DEBUG_ENABLED=true (not populated in production
   * unless the flag is explicitly set).
   *
   * Returns:
   *   200 -- entry found
   *   404 -- turn_id not found (never stored or store not enabled)
   *   410 -- entry existed but TTL (1 hour) has elapsed
   */
  app.get('/admin/v1/turn-debug/:turn_id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply, 'read')) return;

    const params = TurnIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: params.error.flatten(),
      });
    }

    const result = getTurnDebug(params.data.turn_id);

    if (result === 'expired') {
      log.info({ turn_id: params.data.turn_id, event: 'turn_debug.miss', reason: 'expired' }, 'Turn debug entry expired');
      return reply.status(410).send({
        error: 'expired',
        message: 'Turn debug entry existed but TTL (1 hour) has elapsed. Retrieve during the debug session.',
      });
    }

    if (!result) {
      log.info({ turn_id: params.data.turn_id, event: 'turn_debug.miss', reason: 'not_found' }, 'Turn debug entry not found');
      return reply.status(404).send({
        error: 'not_found',
        message: 'Turn debug entry not found. Ensure CEE_TURN_DEBUG_ENABLED=true and retrieve within 1 hour of the turn.',
      });
    }

    const expiresAt = new Date(result.stored_at + DEFAULT_TTL_MS).toISOString();
    reply.header('X-TTL-Expires-At', expiresAt);

    return reply.status(200).send({
      turn_id: result.turn_id,
      session_id: result.session_id,
      stored_at: new Date(result.stored_at).toISOString(),
      ttl_expires_at: expiresAt,
      cqe: {
        parsed_quantities: result.cqe.parsed_quantities,
        patterns_matched: result.cqe.patterns_matched,
        timeout: result.cqe.timeout,
        compromise_match_count: result.cqe.compromise_match_count,
        duration_ms: result.cqe.duration_ms,
        message_too_long: result.cqe.message_too_long,
        word_range_missed: result.cqe.word_range_missed,
      },
      model_resolutions: (result.model_resolutions ?? []).map((r) => ({
        task: r.task,
        resolved_model: r.resolved_model,
        resolution_source: r.resolution_source,
        timestamp: new Date(r.timestamp).toISOString(),
      })),
      // V5 P0 stabilisation — failure-path observability. Both fields are
      // present only when the turn-executor's routing-error branch
      // recorded them; absent for clean success-path turns.
      route_failure_type: result.route_failure_type ?? null,
      freshness_summary: result.freshness_summary ?? null,
    });
  });

  /**
   * GET /admin/v1/turn-debug-stats
   *
   * Diagnostics: current store occupancy.
   */
  app.get('/admin/v1/turn-debug-stats', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply, 'read')) return;
    return reply.status(200).send({
      store_size: getTurnDebugStoreSize(),
      max_entries: 500,
      ttl_ms: DEFAULT_TTL_MS,
    });
  });
}
