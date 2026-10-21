/**
 * POST /assist/v1/scenarios/:scenario_id/what-if — a what-if on the canvas, NOTHING SAVED (`handlers/what-if-run.ts`).
 *
 * Body: `{ changes: SystemEvent[], crux?: boolean, base_graph_hash?: string }`. Each change is a canvas value gesture exactly as
 * the canvas builds it for the saved-edit path (`SystemEventSchema`, each kind's own shape), held instead of sent. Identity and owner
 * admission run in plugins/scenario-ownership.ts (owner only: a viewer member does not run the owner's model).
 *
 * Tier `coach` (fails CLOSED): every call runs the saved model and the what-if through PLoT, and a crux run adds one per
 * change. No LLM, no write.
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SystemEventSchema } from "@talchain/schemas/boundary";

import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { loadPersistedScenarioStateStrict } from "../orchestrator-v5/build-turn-context.js";
import { runWhatIf, WHAT_IF_KINDS } from "../orchestrator-v5/handlers/what-if-run.js";
import { buildErrorV1 } from "../utils/errors.js";
import { getRequestId } from "../utils/request-id.js";
import { log } from "../utils/telemetry.js";

/** At most this many held gestures per what-if: a crux run costs one PLoT call per change, plus the what-if and the saved. */
export const WHAT_IF_MAX_CHANGES = 6;

/** `scenarios.id` is a UUID column, so a non-UUID id cannot name a row: the scenario family's one 404, before the body. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BodySchema = z.object({
  changes: z.array(SystemEventSchema).min(1).max(WHAT_IF_MAX_CHANGES),
  crux: z.boolean().optional(),
  /** The saved model's analysis hash the canvas built the what-if on (refused as `stale_base` when it has since changed). */
  base_graph_hash: z.string().min(1).optional(),
}).strict();

export default async function route(app: FastifyInstance) {
  const RATE_LIMIT_MAX = resolveCeeRateLimit("CEE_SCENARIO_WHAT_IF_RATE_LIMIT_RPM");

  app.post<{ Params: { scenario_id: string } }>(
    "/assist/v1/scenarios/:scenario_id/what-if",
    {
      config: { scenarioId: { from: "params", key: "scenario_id" }, rateLimit: { max: RATE_LIMIT_MAX, timeWindow: "1 minute" } },
      // Before the body is parsed: a malformed id gets the family's 404 even with a malformed body (Codex #3591).
      onRequest: async (req, reply) => {
        const id = (req.params as { scenario_id?: string }).scenario_id ?? "";
        if (!UUID_PATTERN.test(id)) return reply.status(404).send(buildErrorV1("NOT_FOUND", "No scenario to run a what-if on.", {}, getRequestId(req)));
      },
    },
    async (req, reply) => {
      const requestId = getRequestId(req);
      const scenarioId = req.params.scenario_id;
      const parsed = BodySchema.safeParse(req.body ?? {});
      if (!parsed.success || parsed.data.changes.some((c) => !WHAT_IF_KINDS.has(c.kind))) {
        return reply.status(400).send(buildErrorV1("BAD_INPUT",
          `A what-if holds 1 to ${WHAT_IF_MAX_CHANGES} value changes made on the canvas (a factor value, a link strength, an option's setting or a range).`,
          {}, requestId));
      }
      try {
        const result = await runWhatIf({
          payload: { kind: "message", scenario_id: scenarioId, turn_id: randomUUID(), stage: "analyse", turn_class: "decide", source: "composer", message: "" } as never,
          requestId: `${requestId}:what-if`,
          changes: parsed.data.changes.map((c) => ({ ...c })),
          crux: parsed.data.crux === true,
          ...(parsed.data.base_graph_hash === undefined ? {} : { baseGraphHash: parsed.data.base_graph_hash }),
        }, { loadSaved: (id) => loadPersistedScenarioStateStrict(id) });
        if (result.kind === "refused") {
          return reply.status(200).send({ persisted: false, refusal: result.reason, changes_refused: result.changes_refused ?? [] });
        }
        const { kind: _kind, ...shown } = result;
        return reply.status(200).send(shown);
      } catch (err) {
        log.warn({ event: "v5.what_if.failed", request_id: requestId, scenario_id: scenarioId, err: err instanceof Error ? err.message : String(err) },
          "What-if could not run; nothing was saved");
        return reply.status(503).send(buildErrorV1("INTERNAL", "The what-if could not run right now. Nothing was saved.", {}, requestId));
      }
    },
  );
}
