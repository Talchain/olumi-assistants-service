import type { FastifyInstance } from "fastify";
import { ExplainDiffInput, ExplainDiffOutput, ErrorV1 } from "../schemas/assist.js";
import { getAdapter } from "../adapters/llm/router.js";
import { emit, log, calculateCost, TelemetryEvents } from "../utils/telemetry.js";
import { EXPLAIN_DIFF_TIMEOUT_MS } from "../config/timeouts.js";

/**
 * POST /assist/explain-diff  (legacy surface)
 * POST /assist/v1/explain-diff  (browser-reachable surface)
 *
 * Explains why changes were made in a graph patch.
 * Non-mutating: does not modify the graph, only provides rationales.
 *
 * Enforces deterministic ordering of rationales (by target alphabetically).
 *
 * ── WHY TWO PATHS ───────────────────────────────────────────────────────────
 * This handler was complete, correct and tested from the day it shipped, and
 * was still unreachable from any browser. It mounted ONLY on the legacy
 * `/assist/*` surface, while the UI's sole CEE seam is the `/bff/cee/*` edge
 * function, which rewrites `/bff/cee/<x>` -> `/assist/v1/<x>` unconditionally.
 * No value of `<x>` can produce `/assist/explain-diff`, so the capability was
 * dark with a finished server half — the estate's "we build more than we plug
 * in" failure in miniature.
 *
 * Measured rather than reasoned: a live probe of the client's assumed seam
 * `/bff/assist/explain-diff` returned the Netlify SPA catch-all, byte-identical
 * (3449 bytes) to a deliberately fabricated path, while `/bff/cee/graph-readiness`
 * returned live CEE JSON in the same run — a discriminating probe, not a blind one.
 *
 * ── WHY ADDITIVE, NOT A MOVE ────────────────────────────────────────────────
 * The legacy path has live consumers — most importantly the published SDK
 * (`sdk/typescript/src/client.ts`), plus `openapi.yaml` and `scripts/smoke-fixtures.sh`.
 * Moving it would be a breaking change to a shipped client for no gain.
 *
 * ── WHY ONE HANDLER AND NOT TWO ─────────────────────────────────────────────
 * Both paths share a single handler reference and a single derived path list.
 * Two copies would be the hand-maintained-mirror defect: they drift, and the
 * drift reads green on whichever path the suite happens to exercise. A parity
 * test pins this.
 *
 * NOTE ON THE COLLAB PRECEDENT (server.ts, `collabRoundsRouteV1`): an
 * `/assist/v1/collab/*` alias was deliberately WITHDRAWN there, on the grounds
 * that "two entrances to one room is one too many when the room is a privacy
 * boundary." That reasoning is specific to the collab privacy boundary and does
 * not transfer: this route is a non-mutating explanation of a patch the caller
 * already holds, and carries no participant-scoped data. The divergence is
 * deliberate and stated so it is not read as an oversight.
 */

/**
 * The paths this handler answers on. Single source of truth — the registration
 * loop below derives from it, so a path cannot be added without being registered.
 */
export const EXPLAIN_DIFF_PATHS = [
  "/assist/explain-diff",
  "/assist/v1/explain-diff",
] as const;

export default async function route(app: FastifyInstance) {
  const handler = async (
    req: Parameters<Parameters<FastifyInstance["post"]>[1]>[0],
    reply: Parameters<Parameters<FastifyInstance["post"]>[1]>[1],
  ) => {
    const startTime = Date.now();
    const parsed = ExplainDiffInput.safeParse(req.body);
    
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
      const { patch, brief, graph_summary } = parsed.data;
      
      // Count total changes
      const totalChanges = 
        (patch.adds?.nodes?.length || 0) +
        (patch.adds?.edges?.length || 0) +
        (patch.updates?.length || 0) +
        (patch.removes?.length || 0);
      
      if (totalChanges === 0) {
        reply.code(400);
        return reply.send(ErrorV1.parse({
          schema: "error.v1",
          code: "BAD_INPUT",
          message: "patch has no changes to explain"
        }));
      }

      // Get adapter via router (env-driven or config)
      const adapter = getAdapter('explain_diff');

      // Emit telemetry start event
      emit(TelemetryEvents.ExplainDiffStart, {
        change_count: totalChanges,
        has_brief: !!brief,
        has_graph_summary: !!graph_summary,
        provider: adapter.name
      });

      // Call adapter to explain the diff
      const result = await adapter.explainDiff(
        {
          patch,
          brief,
          graph_summary,
        },
        {
          requestId: `explain_${Date.now()}`,
          timeoutMs: EXPLAIN_DIFF_TIMEOUT_MS,
        }
      );

      // Rationales are already sorted by adapter, but ensure deterministic ordering
      const sortedRationales = [...result.rationales].sort((a, b) => a.target.localeCompare(b.target));

      const durationMs = Date.now() - startTime;

      // Calculate cost from usage metrics
      const costUsd = calculateCost(
        adapter.model,
        result.usage.input_tokens,
        result.usage.output_tokens
      );

      // Emit completion telemetry
      emit(TelemetryEvents.ExplainDiffComplete, {
        rationale_count: sortedRationales.length,
        duration_ms: durationMs,
        provider: adapter.name,
        model: adapter.model,
        cost_usd: costUsd
      });
      
      const output = ExplainDiffOutput.parse({ rationales: sortedRationales });
      return reply.send(output);
      
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error("unexpected error");
      
      // Capability error mapping (like clarifier/critique)
      if (err.message && err.message.includes("_not_supported")) {
        reply.code(400);
        return reply.send(ErrorV1.parse({
          schema: "error.v1",
          code: "BAD_INPUT",
          message: "not_supported",
          details: { hint: "Use LLM_PROVIDER=anthropic or fixtures" }
        }));
      }
      
      log.error({ err }, "explain-diff route failure");
      reply.code(500);
      return reply.send(ErrorV1.parse({
        schema: "error.v1",
        code: "INTERNAL",
        message: err.message || "internal"
      }));
    }
  };

  // Derived from the path list above — one handler reference, so the two
  // surfaces cannot fork.
  for (const path of EXPLAIN_DIFF_PATHS) {
    app.post(path, handler);
  }
}
