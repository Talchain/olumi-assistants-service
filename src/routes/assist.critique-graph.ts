import type { FastifyInstance } from "fastify";
import { CritiqueGraphInput, CritiqueGraphOutput, ErrorV1 } from "../schemas/assist.js";
import { getAdapter } from "../adapters/llm/router.js";
import { emit, log, calculateCost } from "../utils/telemetry.js";

export default async function route(app: FastifyInstance) {
  app.post("/assist/critique-graph", async (req, reply) => {
    const parsed = CritiqueGraphInput.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return reply.send(ErrorV1.parse({
        schema: "error.v1",
        code: "BAD_INPUT",
        message: "invalid input",
        details: parsed.error.flatten()
      }));
    }

    const input = parsed.data;

    try {
      const critiqueStartTime = Date.now();

      // Get adapter via router (env-driven or config)
      const adapter = getAdapter('critique_graph');

      emit("assist.critique.start", {
        node_count: input.graph.nodes.length,
        edge_count: input.graph.edges.length,
        has_brief: !!input.brief,
        focus_areas: input.focus_areas,
        provider: adapter.name,
      });

      const result = await adapter.critiqueGraph(
        {
          graph: input.graph,
          brief: input.brief,
          focus_areas: input.focus_areas,
        },
        {
          requestId: `critique_${Date.now()}`,
          timeoutMs: 10000, // 10s timeout for critique
        }
      );

      const critiqueDuration = Date.now() - critiqueStartTime;

      // Calculate cost (provider-specific pricing)
      const cost_usd = calculateCost(adapter.model, result.usage.input_tokens, result.usage.output_tokens);

      // Count issues by level
      const blockerCount = result.issues.filter(i => i.level === "BLOCKER").length;
      const improvementCount = result.issues.filter(i => i.level === "IMPROVEMENT").length;
      const observationCount = result.issues.filter(i => i.level === "OBSERVATION").length;

      // Emit telemetry with provider/cost fallbacks (per v04 spec)
      emit("assist.critique.complete", {
        duration_ms: critiqueDuration,
        issue_count: result.issues.length,
        blocker_count: blockerCount,
        improvement_count: improvementCount,
        observation_count: observationCount,
        overall_quality: result.overall_quality,
        provider: adapter.name || "unknown",
        cost_usd: cost_usd ?? 0,
        model: adapter.model,
        cache_hit: (result.usage.cache_read_input_tokens || 0) > 0,
      });

      // Deterministic ordering: BLOCKER → IMPROVEMENT → OBSERVATION, then by note
      const levelOrder: Record<string, number> = { BLOCKER: 0, IMPROVEMENT: 1, OBSERVATION: 2 };
      const sortedIssues = [...result.issues].sort((a, b) => {
        const la = levelOrder[a.level] ?? 99;
        const lb = levelOrder[b.level] ?? 99;
        if (la !== lb) return la - lb;
        return a.note.localeCompare(b.note);
      });

      const output = CritiqueGraphOutput.parse({
        issues: sortedIssues,
        suggested_fixes: result.suggested_fixes,
        overall_quality: result.overall_quality,
      });

      return reply.send(output);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error("unexpected error");
      log.error({ err, node_count: input.graph.nodes.length }, "critique-graph route failure");

      emit("assist.critique.failed", {
        error: err.message,
      });

      // Capability mapping: provider not supported -> 400 BAD_INPUT with hint
      if (err.message && err.message.includes("_not_supported")) {
        reply.code(400);
        return reply.send(ErrorV1.parse({
          schema: "error.v1",
          code: "BAD_INPUT",
          message: "not_supported",
          details: { hint: "Use LLM_PROVIDER=anthropic or fixtures" },
        }));
      }

      reply.code(500);
      return reply.send(ErrorV1.parse({
        schema: "error.v1",
        code: "INTERNAL",
        message: err.message || "internal",
      }));
    }
  });
}
