import type { FastifyInstance } from "fastify";
import { SuggestOptionsInput, SuggestOptionsOutput, ErrorV1 } from "../schemas/assist.js";
import { suggestOptionsWithAnthropic } from "../adapters/llm/anthropic.js";
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
      const options = await suggestOptionsWithAnthropic({
        goal: parsed.data.goal,
        constraints: parsed.data.constraints,
        existingOptions,
      });

      const output = SuggestOptionsOutput.parse({ options });
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
