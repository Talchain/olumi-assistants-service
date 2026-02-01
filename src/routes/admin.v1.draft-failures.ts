import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { listDraftFailureBundles, getDraftFailureBundleById } from '../cee/draft-failures/store.js';
import { verifyAdminKey } from '../middleware/admin-auth.js';

const ListQuerySchema = z.object({
  request_id: z.string().optional(),
  correlation_id: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  since: z.string().optional(),
});

const IdParamsSchema = z.object({
  id: z.string().uuid(),
});

export async function adminDraftFailureRoutes(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    max: 100,
    timeWindow: 15 * 60 * 1000,
    keyGenerator: (request) => {
      const adminKey = request.headers['x-admin-key'] as string ?? '';
      return `draft_failures:${adminKey.slice(0, 8)}:${request.ip}`;
    },
    errorResponseBuilder: () => ({
      error: 'rate_limit_exceeded',
      message: 'Too many requests. Please try again later.',
    }),
  });

  app.get('/admin/v1/draft-failures', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply, 'read')) return;

    const query = ListQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: query.error.flatten(),
      });
    }

    const result = await listDraftFailureBundles({
      requestId: query.data.request_id,
      correlationId: query.data.correlation_id,
      limit: query.data.limit,
      since: query.data.since,
    });

    return reply.status(200).send({
      failures: result.failures.map((f) => ({
        id: f.id,
        request_id: f.request_id,
        correlation_id: f.correlation_id ?? undefined,
        created_at: f.created_at,
        brief_hash: f.brief_hash,
        brief_preview: f.brief_preview ?? undefined,
        validation_error: f.validation_error,
        status_code: f.status_code ?? undefined,
        missing_kinds: f.missing_kinds ?? undefined,
        node_kinds_raw_json: f.node_kinds_raw_json ?? [],
        node_kinds_post_normalisation: f.node_kinds_post_normalisation ?? [],
        node_kinds_pre_validation: f.node_kinds_pre_validation ?? [],
        model: f.model ?? 'unknown',
        prompt_version: f.prompt_version ?? undefined,
        prompt_hash: f.prompt_hash ?? undefined,
        llm_duration_ms: f.llm_duration_ms ?? undefined,
        total_duration_ms: f.total_duration_ms ?? undefined,
        finish_reason: f.finish_reason ?? undefined,
      })),
      total: result.total,
    });
  });

  app.get('/admin/v1/draft-failures/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyAdminKey(request, reply, 'read')) return;

    const params = IdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({
        error: 'validation_error',
        details: params.error.flatten(),
      });
    }

    const failure = await getDraftFailureBundleById(params.data.id);
    if (!failure) {
      return reply.status(404).send({
        error: 'not_found',
        message: 'Failure bundle not found',
      });
    }

    return reply.status(200).send({
      ...failure,
      correlation_id: failure.correlation_id ?? undefined,
      brief_preview: failure.brief_preview ?? undefined,
      brief: failure.brief ?? undefined,
      raw_llm_output: failure.raw_llm_output ?? undefined,
      raw_llm_text: failure.raw_llm_text ?? undefined,
      missing_kinds: failure.missing_kinds ?? undefined,
      node_kinds_raw_json: failure.node_kinds_raw_json ?? [],
      node_kinds_post_normalisation: failure.node_kinds_post_normalisation ?? [],
      node_kinds_pre_validation: failure.node_kinds_pre_validation ?? [],
      prompt_version: failure.prompt_version ?? undefined,
      prompt_hash: failure.prompt_hash ?? undefined,
      model: failure.model ?? undefined,
      temperature: failure.temperature ?? undefined,
      token_usage: failure.token_usage ?? undefined,
      finish_reason: failure.finish_reason ?? undefined,
      llm_duration_ms: failure.llm_duration_ms ?? undefined,
      total_duration_ms: failure.total_duration_ms ?? undefined,
    });
  });
}
