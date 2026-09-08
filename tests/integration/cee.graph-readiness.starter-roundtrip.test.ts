/**
 * POST /assist/v1/graph-readiness — THE ROUND TRIP, AND THE ENVELOPE'S TWO SCOPES.
 *
 * Two things are pinned here, both measured on deployed CEE `88b4db2c` (2026-09-08)
 * and both invisible to every existing suite.
 *
 * ── 1. A GRAPH CEE HAS PERSISTED MUST BE READABLE BACK BY ITS OWN READINESS ROUTE
 * `register` accepted a real bundled starter (19 nodes / 39 edges) and persisted it
 * byte-exact; `graph-readiness` refused THE SAME BYTES with HTTP 400 and one
 * "Invalid input" per edge. The schema half of that is pinned in
 * `tests/unit/cee.edge-provenance-ingress.test.ts`; this file pins the HTTP half —
 * the register route's own pure pipeline produces the persisted bytes, the store
 * returns them, and the route must answer 200.
 *
 * ── 2. THE ENVELOPE CARRIES TWO SCOPES AND MUST SAY SO
 * The route builds ONE response from TWO graphs, deliberately: admission reads the
 * PERSISTED model (the read the run path performs), coaching reads the REQUEST
 * graph (the canvas the user is looking at). Both halves are right; what was
 * missing is that the wire said so. `assessed_from: "persisted"` sat over a flat
 * envelope in which `readiness_score`, `evidence_quality`, `quality_factors` and
 * `total_factor_count` were all request-scoped and unstamped.
 *
 * The pair below is DISCRIMINATING, and pins its own precondition: the two graphs
 * are chosen so that every asserted number is WRONG under the other scope, and the
 * test asserts that the counterfactual values genuinely differ. A pair whose two
 * graphs agreed would pass under either scoping and prove nothing.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");

/**
 * Settable persisted graph. `loadPersistedScenarioStateStrict` → `getSessionStore()`
 * → `loadGraphAndBriefText` is the route's only route to persisted state, so a
 * module-scoped holder is the whole store this file needs. `importOriginal` spread
 * rather than a hand-listed replacement (trap 12).
 */
const persistedGraphHolder: { graph: unknown } = { graph: null };

vi.mock("../../src/orchestrator-v5/session/index.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/orchestrator-v5/session/index.js")>();
  const { createMockSessionStore } = await import("../utils/mock-session-store.js");
  return {
    ...original,
    getSessionStore: () =>
      createMockSessionStore({
        loadGraphAndBriefText: async () => ({
          graph: persistedGraphHolder.graph,
          briefText: null,
        }),
      }),
    resetSessionStoreForTests: () => {},
  };
});

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";
import { GraphStateIngressSchema } from "../../src/orchestrator-v5/boundary/request-extensions.js";
import { projectGraphForPersistence } from "../../src/orchestrator-v5/persisted-graph-projection.js";
import { normaliseGraphNodeKindField } from "../../src/orchestrator-v5/graph-registration/normalise-node-kind.js";

function readStarter(id: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      new URL(`../fixtures/ui-starters-2026-09-08/${id}.draft.json`, import.meta.url),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

/**
 * The register route's OWN pipeline, in its order, on the caller's bytes
 * (`routes/assist.v1.scenario-graph-register.ts:313-425`). All three steps are
 * pure, so this is the form the graph reaches `scenarios.graph` in — without a
 * database, and without this test's model of what persistence does to a graph.
 */
function persistedFormOf(id: string): unknown {
  const normalised = normaliseGraphNodeKindField(readStarter(id));
  expect(normalised.ok, `${id}: node-kind normalisation`).toBe(true);
  const ingress = GraphStateIngressSchema.safeParse(normalised.graph);
  expect(ingress.success, `${id}: register's contract gate`).toBe(true);
  return projectGraphForPersistence(ingress.success ? ingress.data : undefined);
}

const STARTER_IDS = [
  "build-vs-buy",
  "headcount-allocation",
  "market-entry",
  "pricing-model",
  "vendor-selection",
] as const;

describe("POST /assist/v1/graph-readiness — register→persist→readiness round trip", () => {
  let app: FastifyInstance;
  const headers = { "X-Olumi-Assist-Key": "starter-roundtrip-key" } as const;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "starter-roundtrip-key");
    // The route is per-feature rate limited; this file makes more calls than the
    // default window allows and is not testing the limiter.
    vi.stubEnv("CEE_GRAPH_READINESS_RATE_LIMIT_RPM", "500");
    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it.each(STARTER_IDS)(
    "%s: the persisted bytes are readable back — 200, assessed from persisted",
    async (id) => {
      persistedGraphHolder.graph = persistedFormOf(id);

      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/graph-readiness",
        headers,
        payload: { graph: readStarter(id), scenario_id: `scn-${id}` },
      });

      // Report the body on failure: a bare status assertion on a 400 whose
      // details name the offending edges is a wasted diagnosis.
      expect(res.statusCode, res.body.slice(0, 800)).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.assessed_from).toBe("persisted");
    },
  );

  it("vendor-selection, the graph the live probe used: 39 edges, and none of them refused", async () => {
    const starter = readStarter("vendor-selection") as { edges: unknown[]; nodes: unknown[] };
    expect(starter.nodes).toHaveLength(19);
    expect(starter.edges).toHaveLength(39);

    persistedGraphHolder.graph = persistedFormOf("vendor-selection");
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers,
      payload: { graph: starter, scenario_id: "scn-vendor-selection" },
    });

    expect(res.statusCode, res.body.slice(0, 800)).toBe(200);
  });

  /**
   * ── THE DISCRIMINATING SCOPE PAIR ────────────────────────────────────────────
   * request  = headcount-allocation — 5 factors, 4 options
   * persisted = market-entry        — 8 factors, 3 options
   *
   * Every number below is wrong under the other scoping, and the mismatch
   * assertions state that in the test rather than leaving it to a reader to
   * verify against the fixtures.
   */
  it("names its two scopes: coaching follows the request graph, admission the persisted one", async () => {
    const requestGraph = readStarter("headcount-allocation");
    const persistedGraph = readStarter("market-entry");
    persistedGraphHolder.graph = persistedFormOf("market-entry");

    const factorsIn = (g: Record<string, unknown>) =>
      (g.nodes as { kind: string }[]).filter((n) => n.kind === "factor").length;
    const optionsIn = (g: Record<string, unknown>) =>
      (g.nodes as { kind: string }[]).filter((n) => n.kind === "option").length;

    // The precondition, asserted rather than assumed: if the two graphs ever
    // agreed on either count, the assertions below would hold under BOTH
    // scopings and this test would be a guard agreeing with itself.
    expect(factorsIn(requestGraph)).toBe(5);
    expect(factorsIn(persistedGraph)).toBe(8);
    expect(optionsIn(requestGraph)).toBe(4);
    expect(optionsIn(persistedGraph)).toBe(3);

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers,
      payload: { graph: requestGraph, scenario_id: "scn-market-entry" },
    });
    expect(res.statusCode, res.body.slice(0, 800)).toBe(200);
    const body = JSON.parse(res.body);

    // The two stamps, and the fact they DIFFER on this payload — which is the
    // whole reason `coaching_assessed_from` exists as a separate field.
    expect(body.assessed_from).toBe("persisted");
    expect(body.coaching_assessed_from).toBe("request_graph");
    expect(body.coaching_assessed_from).not.toBe(body.assessed_from);

    // Coaching half → the REQUEST graph (5, not the persisted 8).
    expect(body.total_factor_count).toBe(factorsIn(requestGraph));

    // Admission half → the PERSISTED graph (3, not the request's 4).
    expect(body.options_total).toBe(optionsIn(persistedGraph));
  });

  /**
   * The pre-save caller — no `scenario_id`, so both halves read the same graph
   * and the two stamps AGREE. Kept because it is the case in which the fields
   * look redundant, and a later "simplification" that deletes one of them must
   * fail on the test above rather than pass on this one.
   */
  it("with no scenario named, both stamps read request_graph", async () => {
    persistedGraphHolder.graph = null;

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers,
      payload: { graph: readStarter("vendor-selection") },
    });

    expect(res.statusCode, res.body.slice(0, 800)).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assessed_from).toBe("request_graph");
    expect(body.coaching_assessed_from).toBe("request_graph");
    expect(body.total_factor_count).toBe(8);
  });
});
