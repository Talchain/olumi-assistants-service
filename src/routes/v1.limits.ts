/**
 * GET /v1/limits - API Limits and Quotas (v1.4.0 - PR E)
 *
 * Returns current API limits and quotas for the service.
 * Useful for clients to understand constraints before making requests.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

const env = process.env;

// Response schema
const LimitsResponseSchema = z.object({
  schema: z.literal("limits.v1"),
  rate_limits: z.object({
    requests_per_minute_per_key: z.number(),
    sse_requests_per_minute_per_key: z.number(),
    global_requests_per_minute_per_ip: z.number(),
  }),
  graph_limits: z.object({
    max_nodes: z.number(),
    max_edges: z.number(),
  }),
  cost_limits: z.object({
    max_usd_per_request: z.number(),
  }),
  content_limits: z.object({
    brief_min_chars: z.number(),
    brief_max_chars: z.number(),
    attachment_per_file_max_chars: z.number(),
    attachment_aggregate_max_chars: z.number(),
    request_body_max_bytes: z.number(),
  }),
});

export type LimitsResponse = z.infer<typeof LimitsResponseSchema>;

export default async function route(app: FastifyInstance) {
  app.get("/v1/limits", async (_req, reply) => {
    // Read limits from environment variables (same as used in the app)
    const RATE_LIMIT_RPM = Number(env.RATE_LIMIT_RPM) || 120;
    const SSE_RATE_LIMIT_RPM = Number(env.SSE_RATE_LIMIT_RPM) || 20;
    const GLOBAL_RATE_LIMIT_RPM = Number(env.GLOBAL_RATE_LIMIT_RPM) || 120;
    const COST_MAX_USD = Number(env.COST_MAX_USD) || 1.0;
    const BODY_LIMIT_BYTES = Number(env.BODY_LIMIT_BYTES) || 1024 * 1024; // 1MB default

    // Graph limits (from responseGuards)
    const MAX_NODES = 12;
    const MAX_EDGES = 24;

    // Content limits
    const BRIEF_MIN_CHARS = 30; // From schema
    const BRIEF_MAX_CHARS = 5000; // From schema
    const ATTACHMENT_PER_FILE_MAX_CHARS = 5000; // From grounding/index.ts
    const ATTACHMENT_AGGREGATE_MAX_CHARS = 50000; // From grounding/process-attachments.ts

    const response: LimitsResponse = {
      schema: "limits.v1",
      rate_limits: {
        requests_per_minute_per_key: RATE_LIMIT_RPM,
        sse_requests_per_minute_per_key: SSE_RATE_LIMIT_RPM,
        global_requests_per_minute_per_ip: GLOBAL_RATE_LIMIT_RPM,
      },
      graph_limits: {
        max_nodes: MAX_NODES,
        max_edges: MAX_EDGES,
      },
      cost_limits: {
        max_usd_per_request: COST_MAX_USD,
      },
      content_limits: {
        brief_min_chars: BRIEF_MIN_CHARS,
        brief_max_chars: BRIEF_MAX_CHARS,
        attachment_per_file_max_chars: ATTACHMENT_PER_FILE_MAX_CHARS,
        attachment_aggregate_max_chars: ATTACHMENT_AGGREGATE_MAX_CHARS,
        request_body_max_bytes: BODY_LIMIT_BYTES,
      },
    };

    // Validate response against schema
    const validated = LimitsResponseSchema.parse(response);

    return reply.send(validated);
  });
}
