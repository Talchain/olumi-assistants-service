/**
 * CEE v1 Graph Readiness Integration Tests
 *
 * Exercises POST /assist/v1/graph-readiness and verifies CEE response
 * wrappers, deterministic behaviour, and per-feature rate limiting.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");

import { build } from "../../src/server.js";
import { cleanBaseUrl } from "../helpers/env-setup.js";
import { TelemetryEvents } from "../../src/utils/telemetry.js";

describe("POST /assist/v1/graph-readiness (CEE v1)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("ASSIST_API_KEYS", "readiness-key-1,readiness-key-2,readiness-key-rate,readiness-key-alt,readiness-key-min,readiness-key-f4,readiness-key-f4b,readiness-key-f4c,readiness-key-f4d,readiness-key-f4e,readiness-key-f4f");
    vi.stubEnv("CEE_GRAPH_READINESS_RATE_LIMIT_RPM", "3");

    cleanBaseUrl();
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const headersKey1 = { "X-Olumi-Assist-Key": "readiness-key-1" } as const;
  const headersKey2 = { "X-Olumi-Assist-Key": "readiness-key-2" } as const;
  const headersRate = { "X-Olumi-Assist-Key": "readiness-key-rate" } as const;
  const headersAlt = { "X-Olumi-Assist-Key": "readiness-key-alt" } as const;
  const headersMin = { "X-Olumi-Assist-Key": "readiness-key-min" } as const;
  const headersF4 = { "X-Olumi-Assist-Key": "readiness-key-f4" } as const;
  const headersF4b = { "X-Olumi-Assist-Key": "readiness-key-f4b" } as const;
  const headersF4c = { "X-Olumi-Assist-Key": "readiness-key-f4c" } as const;
  const headersF4d = { "X-Olumi-Assist-Key": "readiness-key-f4d" } as const;
  const headersF4e = { "X-Olumi-Assist-Key": "readiness-key-f4e" } as const;
  const headersF4f = { "X-Olumi-Assist-Key": "readiness-key-f4f" } as const;

  function makeGraph() {
    return {
      version: "1",
      default_seed: 17,
      nodes: [
        { id: "goal", kind: "goal", label: "Increase revenue" },
        { id: "decision", kind: "decision", label: "Pricing strategy" },
        { id: "opt_a", kind: "option", label: "Premium pricing" },
        { id: "opt_b", kind: "option", label: "Volume pricing" },
        { id: "outcome_1", kind: "outcome", label: "Higher margins" },
        { id: "outcome_2", kind: "outcome", label: "Market share growth" },
        { id: "risk_1", kind: "risk", label: "Customer churn" },
      ],
      edges: [
        { id: "e1", from: "decision", to: "opt_a" },
        { id: "e2", from: "decision", to: "opt_b" },
        { id: "e3", from: "opt_a", to: "outcome_1" },
        { id: "e4", from: "opt_b", to: "outcome_2" },
        { id: "e5", from: "opt_a", to: "risk_1" },
      ],
      meta: { roots: ["goal"], leaves: ["outcome_1", "outcome_2", "risk_1"], suggested_positions: {}, source: "assistant" },
    };
  }

  function makeMinimalGraph() {
    return {
      version: "1",
      default_seed: 42,
      nodes: [
        { id: "goal", kind: "goal", label: "Test goal" },
      ],
      edges: [],
      meta: { roots: ["goal"], leaves: ["goal"], suggested_positions: {}, source: "assistant" },
    };
  }

  it("returns CEEGraphReadinessResponseV1 for valid request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersKey1,
      payload: {
        graph: makeGraph(),
      },
    });

    expect(res.statusCode).toBe(200);

    expect(res.headers["x-cee-api-version"]).toBe("v1");
    expect(res.headers["x-cee-feature-version"]).toBeDefined();
    const ceeRequestId = res.headers["x-cee-request-id"];
    expect(typeof ceeRequestId).toBe("string");

    const body = res.json();

    // Required fields from schema
    expect(typeof body.readiness_score).toBe("number");
    expect(body.readiness_score).toBeGreaterThanOrEqual(0);
    expect(body.readiness_score).toBeLessThanOrEqual(100);

    expect(["ready", "fair", "needs_work"]).toContain(body.readiness_level);
    expect(["high", "medium", "low"]).toContain(body.confidence_level);
    expect(typeof body.confidence_explanation).toBe("string");

    expect(Array.isArray(body.quality_factors)).toBe(true);
    expect(body.quality_factors.length).toBeGreaterThan(0);

    for (const factor of body.quality_factors) {
      expect(["causal_detail", "weight_refinement", "risk_coverage", "outcome_balance", "option_diversity", "goal_outcome_linkage"])
        .toContain(factor.factor);
      expect(typeof factor.current_score).toBe("number");
      expect(["high", "medium", "low"]).toContain(factor.impact);
      expect(typeof factor.recommendation).toBe("string");
      expect(typeof factor.potential_improvement).toBe("number");
    }

    expect(typeof body.can_run_analysis).toBe("boolean");

    // trace is required
    expect(body.trace).toBeDefined();
    expect(body.trace.request_id).toBe(ceeRequestId);
  });

  it("returns 'needs_work' for minimal graph", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersKey2,
      payload: {
        graph: makeMinimalGraph(),
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Minimal graph should score low
    expect(body.readiness_level).toBe("needs_work");
    expect(body.readiness_score).toBeLessThan(50);
  });

  it("returns CEE_VALIDATION_FAILED for missing graph", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersKey1,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();

    expect(body.code).toBe("CEE_VALIDATION_FAILED");
    expect(body.retryable).toBe(false);
  });

  it("returns CEE_VALIDATION_FAILED for invalid graph", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersKey1,
      payload: {
        graph: { invalid: true },
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();

    expect(body.code).toBe("CEE_VALIDATION_FAILED");
  });

  it("enforces per-feature rate limit", async () => {
    // First 3 requests should succeed (RPM=3)
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/graph-readiness",
        headers: headersRate,
        payload: { graph: makeGraph() },
      });
      expect(res.statusCode).toBe(200);
    }

    // 4th request should be rate limited
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersRate,
      payload: { graph: makeGraph() },
    });

    expect(res.statusCode).toBe(429);
    const body = res.json();

    expect(body.code).toBe("CEE_RATE_LIMIT");
    expect(body.retryable).toBe(true);
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("returns 401 for missing auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      payload: { graph: makeGraph() },
    });

    expect(res.statusCode).toBe(401);
  });

  it("accepts edges with source/target format (graph library compatibility)", async () => {
    // Many graph libraries (D3, Cytoscape, vis.js) use source/target instead of from/to
    const graphWithSourceTarget = {
      nodes: [
        { id: "goal", kind: "goal", label: "Test goal" },
        { id: "decision", kind: "decision", label: "Test decision" },
        { id: "opt_a", kind: "option", label: "Option A" },
      ],
      edges: [
        { id: "e1", source: "decision", target: "opt_a" },
      ],
    };

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersAlt,
      payload: { graph: graphWithSourceTarget },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(typeof body.readiness_score).toBe("number");
    expect(["ready", "fair", "needs_work"]).toContain(body.readiness_level);
  });

  it("emits total_factor_count, user_question_count, and deprecated factor_count in telemetry and response", async () => {
    // Build a graph with exactly 4 factor nodes
    const graphWith4Factors = {
      version: "1",
      default_seed: 42,
      nodes: [
        { id: "goal", kind: "goal", label: "Increase revenue" },
        { id: "decision", kind: "decision", label: "Pricing" },
        { id: "opt_a", kind: "option", label: "Premium" },
        { id: "fac_price", kind: "factor", label: "Price", category: "controllable", data: { value: 100 } },
        { id: "fac_quality", kind: "factor", label: "Quality", category: "controllable", data: { value: 0.8 } },
        { id: "fac_demand", kind: "factor", label: "Demand", category: "observable", data: { value: 500 } },
        { id: "fac_competition", kind: "factor", label: "Competition", category: "external", data: { value: 0.5 } },
        { id: "outcome_1", kind: "outcome", label: "Revenue" },
      ],
      edges: [
        { id: "e1", from: "decision", to: "opt_a" },
        { id: "e2", from: "opt_a", to: "outcome_1" },
      ],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
    };

    const emitSpy = vi.spyOn(await import("../../src/utils/telemetry.js"), "emit");

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersAlt,
      payload: { graph: graphWith4Factors },
    });

    expect(res.statusCode).toBe(200);

    // Telemetry: verify emit payload
    const completedCall = emitSpy.mock.calls.find(
      (call) => call[0] === TelemetryEvents.CeeGraphReadinessCompleted,
    );
    expect(completedCall).toBeDefined();

    const eventData = completedCall![1] as any;
    expect(eventData.total_factor_count).toBe(4);
    expect(typeof eventData.user_question_count).toBe("number");
    expect(typeof eventData.factor_count).toBe("number");

    // Response payload: verify all three factor count fields
    const body = res.json();
    expect(body.total_factor_count).toBe(4);
    expect(typeof body.user_question_count).toBe("number");
    expect(typeof body.factor_count).toBe("number");

    emitSpy.mockRestore();
  });

  // ==========================================================================
  // scaffold_plan, now derived from the GRAPH.
  //
  // ⚠ WHAT CHANGED AND WHY THE OLD TESTS HERE ARE GONE.
  //
  // This block used to hold ~8 tests that drove `scaffold_plan` from the
  // request's `analysis_ready.options[]` — reconstructing "intervention intent"
  // from the client's cached payload via `buildReadinessRawPersistedGraph`.
  // That whole mechanism existed to paper over TWO assessors disagreeing, and
  // both it and the second assessor are deleted. Those tests are not weakened
  // or skipped; the behaviour they described is no longer a behaviour this
  // route has.
  //
  // The question they were really asking — "will the run proceed even though
  // not every option is configured?" — is still asked, and still answered by
  // the SAME predicate the run path uses (`computeScaffoldPlan` →
  // `gateAnalysableOptions`). It is now fed the CANONICAL options, so the
  // pre-run panel and the run still cannot drift, and the answer no longer
  // depends on what the caller happened to cache.
  //
  // Per-option scaffold semantics (hold vs exclude, the two-option floor) stay
  // pinned at the unit level in
  // `src/orchestrator-v5/tools/handlers/__tests__/scaffold-plan-readiness.test.ts`.
  // They are not duplicated here: this suite shares one rate-limit budget
  // across its injections, and the route only serialises the plan.
  // ==========================================================================
  function makeGraphWithOptions(configuredIds: string[]) {
    const optionIds = ["opt_a", "opt_c", "opt_b"];
    return {
      version: "1",
      nodes: [
        { id: "goal", kind: "goal", label: "Increase revenue" },
        { id: "decision", kind: "decision", label: "Pricing" },
        {
          id: "fac_price",
          kind: "factor",
          label: "Price",
          category: "controllable",
          prior: { distribution: "uniform", range_min: 10, range_max: 30 },
        },
        ...optionIds.map((id, i) => ({
          id,
          kind: "option",
          label: `Option ${id}`,
          // The carrier the deployed UI now populates (DecisionGuideAI #734).
          ...(configuredIds.includes(id) ? { interventions: { fac_price: 0.9 - i * 0.3 } } : {}),
        })),
      ],
      edges: [
        ...optionIds.flatMap((id) => [
          { id: `e_d_${id}`, from: "decision", to: id },
          { id: `e_${id}_f`, from: id, to: "fac_price" },
        ]),
        { id: "e_f_g", from: "fac_price", to: "goal" },
      ],
    };
  }

  it("mixed-configured GRAPH → will_scaffold_options=true, and can_run_analysis stays honest", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersF4,
      payload: { graph: makeGraphWithOptions(["opt_a", "opt_c"]) },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // The run WOULD proceed (two configured options survive) → the panel knows.
    expect(body.scaffold_plan).toBeDefined();
    expect(body.scaffold_plan.will_scaffold_options).toBe(true);
    expect(body.scaffold_plan.option_count).toBe(1);

    // ...but the verdict stays HONEST. scaffold_plan is additive and must never
    // flip it: an unconfigured option is genuinely not ready.
    expect(body.can_run_analysis).toBe(false);
    // And the blocker names the unconfigured option BY IDENTITY, not by count.
    expect(
      (body.readiness_issues as Array<Record<string, unknown>>).some((i) => i.option_id === "opt_b"),
    ).toBe(true);
  });

  it("fully-configured GRAPH → will_scaffold_options=false, option_count omitted, analysis admitted", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersF4b,
      payload: { graph: makeGraphWithOptions(["opt_a", "opt_c", "opt_b"]) },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scaffold_plan).toBeDefined();
    expect(body.scaffold_plan.will_scaffold_options).toBe(false);
    expect(body.scaffold_plan.option_count).toBeUndefined();
    expect(body.can_run_analysis).toBe(true);
    expect(body.readiness_issues).toEqual([]);
  });

  // ==========================================================================
  // THE ACCEPTANCE PAIR — the whole point of the unification.
  //
  // The route used to select its assessor from the REQUEST BODY SHAPE, and the
  // UI populates `analysis_ready` only from its own CACHED state. So a FRESH
  // session and a WARMED session received OPPOSITE verdicts for the SAME graph:
  // the verdict was a function of client cache, not of the model.
  //
  // `trace` is excluded from the byte comparison, and ONLY `trace`: it carries
  // the per-request id, which is supposed to differ between two distinct HTTP
  // requests. Every other field is compared byte-for-byte.
  // ==========================================================================
  function analysisReadyFor(graph: ReturnType<typeof makeGraphWithOptions>) {
    return {
      goal_node_id: "goal",
      status: "ready",
      options: graph.nodes
        .filter((n: any) => n.kind === "option")
        .map((n: any) => ({
          id: n.id,
          label: n.label,
          status: n.interventions ? "ready" : "needs_user_mapping",
          interventions: n.interventions ?? {},
        })),
    };
  }

  async function verdictFor(payload: unknown, headers: Record<string, string>) {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers,
      payload: payload as Record<string, unknown>,
    });
    expect(res.statusCode).toBe(200);
    const { trace: _trace, ...rest } = res.json() as Record<string, unknown>;
    return { verdict: rest, version: res.headers["x-cee-api-version"] };
  }

  it("ACCEPTANCE PAIR — mixed-configured graph: both request shapes give a BYTE-IDENTICAL verdict", async () => {
    const graph = makeGraphWithOptions(["opt_a", "opt_c"]);

    const fresh = await verdictFor({ graph }, headersF4c);
    const warmed = await verdictFor({ graph, analysis_ready: analysisReadyFor(graph) }, headersF4c);

    expect(JSON.stringify(warmed.verdict)).toBe(JSON.stringify(fresh.verdict));
    // One assessor ⇒ one version. This used to be 'v1' vs 'v3'.
    expect(warmed.version).toBe(fresh.version);
    expect(fresh.version).toBe("v1");
  });

  it("ACCEPTANCE PAIR — fully-configured graph: both request shapes give a BYTE-IDENTICAL verdict", async () => {
    const graph = makeGraphWithOptions(["opt_a", "opt_c", "opt_b"]);

    const fresh = await verdictFor({ graph }, headersF4d);
    const warmed = await verdictFor({ graph, analysis_ready: analysisReadyFor(graph) }, headersF4d);

    expect(JSON.stringify(warmed.verdict)).toBe(JSON.stringify(fresh.verdict));
    expect((fresh.verdict as Record<string, unknown>).can_run_analysis).toBe(true);
  });

  it("a CONTRADICTORY analysis_ready cache cannot move the verdict", async () => {
    // The sharpest form: the graph says one option is unconfigured, while the
    // cache insists every option is ready. Under the old mode branch this
    // payload took the strict V3 path and answered from the cache. The graph is
    // the model; the cache is not.
    const graph = makeGraphWithOptions(["opt_a", "opt_c"]);
    const lyingCache = {
      goal_node_id: "goal",
      status: "ready",
      options: ["opt_a", "opt_c", "opt_b"].map((id) => ({
        id,
        label: `Option ${id}`,
        status: "ready",
        interventions: { fac_price: 0.5 },
      })),
    };

    const honest = await verdictFor({ graph }, headersF4e);
    const lied = await verdictFor({ graph, analysis_ready: lyingCache }, headersF4e);

    expect(JSON.stringify(lied.verdict)).toBe(JSON.stringify(honest.verdict));
    expect((lied.verdict as Record<string, unknown>).can_run_analysis).toBe(false);
  });

  // ==========================================================================
  // DO-NO-HARM — the response shape the deployed UI reads must survive.
  // Field-for-field on a HEALTHY graph, so a silent drop cannot pass.
  // ==========================================================================
  it("DO-NO-HARM — a healthy graph returns every field the UI reads, on both shapes", async () => {
    const graph = makeGraphWithOptions(["opt_a", "opt_c", "opt_b"]);

    for (const payload of [{ graph }, { graph, analysis_ready: analysisReadyFor(graph) }]) {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/graph-readiness",
        headers: headersF4f,
        payload,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      // Hard-fail-if-dropped, then silent-regression-if-dropped (derived from
      // the UI's only reader, readinessStore's explicit object literal).
      expect(typeof body.can_run_analysis).toBe("boolean");
      expect(["ready", "fair", "needs_work"]).toContain(body.readiness_level);
      expect(typeof body.readiness_score).toBe("number");
      expect(typeof body.confidence_explanation).toBe("string");
      expect(typeof body.scaffold_plan.will_scaffold_options).toBe("boolean");
      expect(typeof body.options_ready).toBe("number");
      expect(typeof body.options_total).toBe("number");
      expect(typeof body.goal_node_valid).toBe("boolean");

      // Fields the UI does not currently read, but which the published contract
      // carries — dropping them would still be a breaking change.
      expect(["high", "medium", "low"]).toContain(body.confidence_level);
      expect(Array.isArray(body.quality_factors)).toBe(true);
      expect(Array.isArray(body.issues)).toBe(true);
      expect(Array.isArray(body.readiness_issues)).toBe(true);
      expect(typeof body.ready).toBe("boolean");
      expect(typeof body.total_factor_count).toBe("number");
      expect(typeof body.user_question_count).toBe("number");
      expect(typeof body.factor_count).toBe("number");
      expect(body.trace).toBeDefined();
    }
  });

  // --- F4 #1b — the observed_state under-report residual (A2-coordinated) -----
  // #612 closed the over-report and the configured-value / needs_encoding cases,
  // but an option scaffolded off a factor's OBSERVED_STATE neutral values still
  // under-reported (stayed "blocked") because the /graph-readiness `Graph` input
  // rejected a FACTOR observed_state (it was constraint-shaped only, requiring
  // metadata.operator) with a 400 — so readiness never saw the provenance the run
  // path uses (buildNeutralFactorValues' observed_state rung).
  //
  // The coordinated contract (mutually verified with A2): on FACTOR nodes the UI
  // sends snake_case observed_state { value:number (model 0-1), raw_value?:number
  // (display) }. This graph has NO `prior` on the factor — the neutral value can
  // come ONLY through the observed_state rung, so it isolates exactly the residual.
  function makeObservedStateV3Graph() {
    return {
      version: "1",
      nodes: [
        { id: "goal", kind: "goal", label: "Increase revenue" },
        { id: "decision", kind: "decision", label: "Pricing" },
        {
          id: "fac_price",
          kind: "factor",
          label: "Price",
          category: "controllable",
          // Factor observed_state — the exact A2 send shape. raw_value present so
          // the run-path scaffolder's resolveRawInterventionValue takes rule 1
          // (raw_value_used) → a concrete neutral wire number, never ambiguous.
          observed_state: { value: 0.4, raw_value: 200 },
        },
        // Two CONFIGURED options carry their values on the graph (the carrier
        // the deployed UI populates since DecisionGuideAI #734) so the run has
        // a real comparison to proceed with; opt_b is the unconfigured one the
        // scaffold must pick up off fac_price's observed_state neutral value.
        { id: "opt_a", kind: "option", label: "Premium", interventions: { fac_price: 0.9 } },
        { id: "opt_c", kind: "option", label: "Value", interventions: { fac_price: 0.4 } },
        { id: "opt_b", kind: "option", label: "Unconfigured" },
      ],
      edges: [
        { id: "e1", from: "decision", to: "opt_a" },
        { id: "e2", from: "decision", to: "opt_b" },
        { id: "e3", from: "opt_a", to: "fac_price" },
        { id: "e4", from: "opt_b", to: "fac_price" },
        { id: "e5", from: "decision", to: "opt_c" },
        { id: "e6", from: "opt_c", to: "fac_price" },
      ],
    };
  }

  it("F4 #1b RED-first: a FACTOR observed_state {value, raw_value} request is ACCEPTED (200), not rejected (400)", async () => {
    // Before the schema widening this exact body 400'd (CEE_VALIDATION_FAILED):
    // Node.observed_state was ConstraintObservedState-only (required
    // metadata.operator). The factor shape must now PARSE.
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersMin,
      // No `analysis_ready`: the graph now carries the option values itself, so
      // the cache is not needed to express a configured model — and is no
      // longer read for the verdict in any case.
      payload: { graph: makeObservedStateV3Graph() },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // EXACT PARITY: the run path scaffolds opt_b off fac_price's observed_state
    // neutral value → readiness must now advertise the same, matching the run.
    expect(body.scaffold_plan).toBeDefined();
    expect(body.scaffold_plan.will_scaffold_options).toBe(true);
    expect(body.scaffold_plan.option_count).toBe(1);

    // can_run_analysis stays HONEST (unconfigured option is not "ready") — the
    // field is additive and never flips the verdict.
    expect(body.can_run_analysis).toBe(false);
  });

  it("F4 #1b: constraint observed_state is still validated strictly (metadata.operator required) — union is additive, not loosening", async () => {
    // A CONSTRAINT observed_state with a MALFORMED metadata (bad operator) must
    // still be rejected — the factor branch's no-metadata refinement forbids it
    // from sliding through as a factor shape. Proves the widening did not loosen
    // constraint validation.
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersF4d,
      payload: {
        graph: {
          version: "1",
          nodes: [
            { id: "goal", kind: "goal", label: "Goal" },
            {
              id: "con_budget",
              kind: "constraint",
              label: "Budget",
              // operator is not in {">=", "<="} → constraint branch fails; the
              // factor branch rejects because `metadata` is present.
              observed_state: { value: 5000, metadata: { operator: "==" } },
            },
          ],
          edges: [],
        },
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error?.code ?? body.code).toBe("CEE_VALIDATION_FAILED");
  });

  it("accepts minimal graph without version/default_seed/meta (uses defaults)", async () => {
    // Simpler requests - only nodes and edges required
    const minimalGraph = {
      nodes: [
        { id: "goal", kind: "goal", label: "Simple goal" },
        { id: "opt", kind: "option", label: "Simple option" },
      ],
      edges: [
        { id: "e1", from: "goal", to: "opt" },
      ],
    };

    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersMin,
      payload: { graph: minimalGraph },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(typeof body.readiness_score).toBe("number");
    expect(["ready", "fair", "needs_work"]).toContain(body.readiness_level);
  });
});
