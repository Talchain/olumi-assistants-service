import type { FastifyInstance } from "fastify";
import { SuggestOptionsInput, SuggestOptionsOutput, ErrorV1 } from "../schemas/assist.js";
import { getAdapter } from "../adapters/llm/router.js";
import { log } from "../utils/telemetry.js";

export default async function route(app: FastifyInstance) {
  app.post("/assist/suggest-options", async (req, reply) => {
    const parsed = SuggestOptionsInput.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return reply.send(ErrorV1.parse({
        schema: "error.v1",
        code: "BAD_INPUT",
        message: "invalid input",
        details: parsed.error.flatten()
      }));
    }

    try {
      const existingOptions = parsed.data.graph_summary?.existing_options;

      // Get adapter via router (env-driven or config)
      const adapter = getAdapter('suggest_options');
      const result = await adapter.suggestOptions(
        {
          goal: parsed.data.goal,
          constraints: parsed.data.constraints,
          existingOptions,
        },
        {
          requestId: `suggest_${Date.now()}`,
          timeoutMs: 10000, // 10s timeout for suggestions
        }
      );

      const output = SuggestOptionsOutput.parse({ options: result.options });
      return reply.send(output);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error("unexpected error");
      log.error({ err }, "suggest-options route failure");

      reply.code(500);
      return reply.send(ErrorV1.parse({
        schema: "error.v1",
        code: "INTERNAL",
        message: err.message || "internal",
      }));
    }
  });
}
