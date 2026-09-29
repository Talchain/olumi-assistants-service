/**
 * /v1/status — the model_routing block must not present a STARTUP value as a
 * RUNTIME one.
 *
 * WHY THIS EXISTS (wire-witnessed, 2026-09-11)
 * --------------------------------------------
 * The deployed endpoint reported `effective_task_models.draft_graph =
 * "claude-sonnet-5"` while 26 `model.resolution` events on the same service
 * showed real draft turns running `claude-sonnet-4-6` with
 * `resolution_source=store_model_config`.
 *
 * The projection behind that field is built from env vars + checked-in
 * defaults and NEVER consults the prompt store, so it is structurally
 * incapable of seeing precedence rank 2. The code comments already said so
 * (`src/config/model-routing.ts`: "Startup values are advisory only"); the
 * FIELD NAME did not. That mismatch is the defect.
 *
 * This is the same remedy the sibling `llm` block already carries
 * (`scope: "untasked_default_adapter"`), applied one field down: the wire says
 * what the value IS, and names the tasks for which it is UNVERIFIED.
 *
 * NOTE ON BINDING: every assertion below binds by TASK ID or by exact key set,
 * never by "some key matched" — a substring predicate is satisfied by
 * `startup_task_models_unverified` as well as by `startup_task_models`
 * (CLAUDE.md trap 19).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";
import { resolveTaskRouting } from "../../src/adapters/llm/model-routing-report.js";
import { STORE_MODEL_CONFIG_OUTRANKABLE_TASKS } from "../../src/config/model-routing.js";

describe("GET /v1/status — model_routing states its own epistemic status", () => {
  let app: FastifyInstance;
  let body: any;
  let raw: string;

  beforeAll(async () => {
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    cleanBaseUrl();
    app = await build();
    const response = await app.inject({ method: "GET", url: "/v1/status" });
    raw = response.body;
    body = JSON.parse(raw);
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("MODEL_ROUTING_KEYS_ARE_EXACT — the block no longer claims 'effective'", () => {
    // Exact key set, not a substring search: `toContain("startup_task_models")`
    // would be satisfied by `startup_task_models_unverified` alone.
    expect(
      Object.keys(body.model_routing).sort(),
      "The public /v1/status model_routing block changed shape. `effective_task_models` " +
        "asserted a RUNTIME fact from a STARTUP projection that cannot see precedence ranks " +
        "1 (per_call) or 2 (store_model_config). Do not reinstate that name.",
    ).toEqual([
      "default_provider",
      "startup_task_models",
      "startup_task_models_unverified",
    ]);

    // CONTRAST CONTROL (trap 13): this absence assertion must be able to see a
    // presence. `default_provider` is in the same block and is asserted above.
    expect(raw).not.toContain("effective_task_models");
    expect(raw).toContain("default_provider");
  });

  it("STARTUP_TASK_MODELS_BINDS_TO_THE_PRODUCER_BY_TASK_ID — not to a literal", () => {
    const startup = body.model_routing.startup_task_models;

    // POSITIVE CONTROL: a projection of {} makes every loop below vacuous.
    expect(Object.keys(startup).length).toBeGreaterThan(0);

    for (const task of ["draft_graph", "edit_graph", "orchestrator", "critique_graph"]) {
      expect(startup[task]).toBe(resolveTaskRouting(task as never).model);
    }
  });

  it("UNVERIFIED_NAMES_EVERY_RANK2_OUTRANKABLE_TASK_IN_THE_MAP — exact set", () => {
    const startup = body.model_routing.startup_task_models;
    const unverified: string[] = body.model_routing.startup_task_models_unverified;

    // PRECONDITION, PINNED IN-TEST (trap 13b): if the declaration were empty,
    // or if none of its tasks appeared in the projection, the equality below
    // would hold as [] === [] and assert nothing at all.
    expect(STORE_MODEL_CONFIG_OUTRANKABLE_TASKS.length).toBeGreaterThan(0);
    const expected = STORE_MODEL_CONFIG_OUTRANKABLE_TASKS
      .filter((task) => Object.hasOwn(startup, task))
      .slice()
      .sort();
    expect(
      expected.length,
      "No rank-2-outrankable task appears in startup_task_models, so this guard has no subject.",
    ).toBeGreaterThan(0);

    expect(
      [...unverified].sort(),
      "startup_task_models_unverified must name EXACTLY the tasks present in the projection " +
        "that a prompt-store modelConfig pin can outrank, derived from " +
        "STORE_MODEL_CONFIG_OUTRANKABLE_TASKS.",
    ).toEqual(expected);
  });

  it("DRAFT_GRAPH_IS_DECLARED_UNVERIFIED — the wire-witnessed case, by identity", () => {
    // This is the exact task the 2026-09-11 capture caught: /v1/status said
    // claude-sonnet-5, the store pin served claude-sonnet-4-6.
    expect(body.model_routing.startup_task_models).toHaveProperty("draft_graph");
    expect(body.model_routing.startup_task_models_unverified).toContain("draft_graph");
  });

  it("UNVERIFIED_IS_DISCRIMINATING — edit_graph has no rank-2 call site and is NOT listed", () => {
    /*
     * THE PROBE WHOSE EXPECTED ANSWER DIFFERS (CLAUDE.md trap 20).
     *
     * Every assertion above is satisfied by an implementation that marks EVERY
     * task unverified — a field that is always "unknown" discriminates nothing
     * and would be its own kind of dishonesty. `edit_graph` is routed from
     * env/defaults only: no call site reads a prompt-store pin for it (see
     * STORE_MODEL_CONFIG_LIVE_CALL_SITES), so its startup value IS the
     * server-side resolution and must not be flagged.
     */
    expect(body.model_routing.startup_task_models).toHaveProperty("edit_graph");
    expect(STORE_MODEL_CONFIG_OUTRANKABLE_TASKS).not.toContain("edit_graph");
    expect(body.model_routing.startup_task_models_unverified).not.toContain("edit_graph");
  });
});
