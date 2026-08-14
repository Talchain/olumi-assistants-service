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
  // F4 — readiness↔run gate drift: scaffold_plan on the V3 response.
  //
  // RED-first: before the route wiring, the V3 response carried NO scaffold_plan
  // for a mixed-configured graph, so the pre-run panel had only
  // can_run_analysis:false to read → "1 option(s) blocked" while run_analysis
  // scaffolds the same option and succeeds. These pin the additive field AND
  // that can_run_analysis stays honest (the field never flips the verdict).
  //
  // Provenance note (verified at the schema): the /graph-readiness `Graph`
  // input rejects factor `observed_state` (constraint-shaped only) and PRESERVES
  // `prior` via passthrough — so these graphs give the scaffold its neutral
  // values through the `prior` rung, the provenance readiness can actually
  // receive.
  // ==========================================================================
  function makeMixedV3Graph() {
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
        { id: "opt_a", kind: "option", label: "Premium" },
        // ⚠ ADDED BY THE NO-RANK RULING (2026-08-14). `opt_b` is now EXCLUDED
        // rather than filled, so with only two options the run would REFUSE
        // ("one option is not a comparison") and `will_scaffold_options` —
        // which answers "will the run proceed even though not every option is
        // configured?" — would honestly be false. A third configured option
        // restores the shape these specs are actually about.
        //
        // The two-option answer is pinned at the UNIT level, by
        // `scaffold-plan-readiness.test.ts` → "⭐ TWIN — exclusion that leaves
        // fewer than two options says the run will NOT proceed". It is NOT
        // duplicated here: this route's suite shares one rate-limit budget
        // across its injections, and the route only serialises the plan the
        // unit twin already measures.
        { id: "opt_c", kind: "option", label: "Value" },
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

  it("F4: mixed-configured V3 graph → scaffold_plan.will_scaffold_options=true, can_run_analysis stays honest", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersF4,
      payload: {
        graph: makeMixedV3Graph(),
        analysis_ready: {
          goal_node_id: "goal",
          status: "needs_user_mapping",
          options: [
            { id: "opt_a", label: "Premium", status: "ready", interventions: { fac_price: 0.9 } },
            { id: "opt_c", label: "Value", status: "ready", interventions: { fac_price: 0.4 } },
            // opt_b: added WITHOUT configuration — the exact symptom.
            { id: "opt_b", label: "Unconfigured", status: "needs_user_mapping", interventions: {} },
          ],
          user_questions: ["Which factors and values for: Unconfigured?"],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // The run path WOULD scaffold opt_b → the panel now knows it.
    expect(body.scaffold_plan).toBeDefined();
    expect(body.scaffold_plan.will_scaffold_options).toBe(true);
    expect(body.scaffold_plan.option_count).toBe(1);

    // ...but can_run_analysis stays HONEST — an unconfigured option is not
    // "ready"; scaffold_plan is additive and must never flip the verdict.
    expect(body.can_run_analysis).toBe(false);
  });

  it("F4: fully-configured V3 graph → will_scaffold_options=false, option_count omitted", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersF4,
      payload: {
        graph: makeMixedV3Graph(),
        analysis_ready: {
          goal_node_id: "goal",
          status: "ready",
          options: [
            { id: "opt_a", label: "Premium", status: "ready", interventions: { fac_price: 0.9 } },
            { id: "opt_c", label: "Value", status: "ready", interventions: { fac_price: 0.4 } },
            { id: "opt_b", label: "Volume", status: "ready", interventions: { fac_price: 0.2 } },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scaffold_plan).toBeDefined();
    expect(body.scaffold_plan.will_scaffold_options).toBe(false);
    expect(body.scaffold_plan.option_count).toBeUndefined();
    // Two distinct ready options + valid goal → analysis can run.
    expect(body.can_run_analysis).toBe(true);
  });

  // --- F4 over-report repro (review P1) -------------------------------------
  // The proven defect: readiness must EXACTLY equal the run path's scaffold
  // decision on the SAME graph state — no over-report in the PERMISSIVE
  // direction (that reopens the readiness↔run drift, flipped).
  //
  // Same graph state: opt_b was CONFIGURED by the user with a NON-NUMERIC value
  // (a categorical "UK"). On the persisted graph its node carries intervention
  // INTENT (data.interventions), so the run path's scaffolder leaves it on the
  // honest configure path (collectInterventionIntentOptionIds → never scaffold
  // over intent) and the run stays blocked. The pre-run panel must AGREE it is
  // NOT will_scaffold-to-runnable.
  //
  // On the wire that intent reaches readiness through analysis_ready: a
  // configured-but-non-numeric option is status:"needs_encoding" with the
  // original value under raw_interventions (interventions carries no numeric).
  // The request `graph` (parsed) cannot carry a non-numeric data.interventions
  // (the OptionData schema is numeric-only), so readiness's ONLY intent
  // authority for this option is analysis_ready — exactly the provenance the
  // over-report ignored.
  it("F4 over-report: configured-but-non-numeric option (needs_encoding + raw_interventions) → the run PROCEEDS WITHOUT it, and the panel says so", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersF4,
      payload: {
        graph: makeMixedV3Graph(),
        analysis_ready: {
          goal_node_id: "goal",
          status: "needs_encoding",
          options: [
            { id: "opt_a", label: "Premium", status: "ready", interventions: { fac_price: 0.9 } },
            { id: "opt_c", label: "Value", status: "ready", interventions: { fac_price: 0.4 } },
            // opt_b: the user DID configure it — with a categorical value that
            // has not been encoded to a number yet. This is intervention INTENT,
            // not an empty option; the run path will NOT scaffold over it.
            {
              id: "opt_b",
              label: "UK launch",
              status: "needs_encoding",
              interventions: {},
              raw_interventions: { fac_price: "UK" },
            },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scaffold_plan).toBeDefined();
    // ⚠ RE-PINNED BY THE NO-RANK RULING (2026-08-14), and the property under
    // test is UNCHANGED: the panel says exactly what the run path will do,
    // because they are one computation.
    //
    // What changed is what the run path DOES. It used to leave opt_b on the
    // wire unconfigured and BLOCK on PLoT's preflight, so the honest answer was
    // "will not proceed". Now it EXCLUDES opt_b and compares the other two, so
    // the honest answer is "will proceed" — and reporting `false` would be the
    // same F4 drift in the RESTRICTIVE direction: a panel blocking a run that
    // succeeds.
    //
    // Intent is still never written over. That is now visible as opt_b being
    // EXCLUDED (named, disclosed, one configure step away) rather than held at
    // values CEE chose in place of the user's.
    expect(body.scaffold_plan.will_scaffold_options).toBe(true);
    expect(body.scaffold_plan.option_count).toBe(1);
    // can_run_analysis stays HONEST and unchanged (#612's invariant).
    expect(body.can_run_analysis).toBe(false);
  });

  it("F4 over-report control: raw_interventions intent also blocks scaffold even when status is not needs_encoding", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersF4b,
      payload: {
        graph: makeMixedV3Graph(),
        analysis_ready: {
          goal_node_id: "goal",
          status: "needs_user_mapping",
          options: [
            { id: "opt_a", label: "Premium", status: "ready", interventions: { fac_price: 0.9 } },
            { id: "opt_c", label: "Value", status: "ready", interventions: { fac_price: 0.4 } },
            // Intent present via raw_interventions (a value the user typed that
            // failed numeric projection) — the run path treats ANY intervention
            // entry, numeric or not, as intent. Readiness must too.
            {
              id: "opt_b",
              label: "Bespoke",
              status: "needs_user_mapping",
              interventions: {},
              raw_interventions: { fac_price: "tbd" },
            },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Same re-pin as its sibling above: raw_interventions intent is still never
    // written over — the option is EXCLUDED — and the run proceeds on the two
    // options that are configured.
    expect(body.scaffold_plan.will_scaffold_options).toBe(true);
    expect(body.scaffold_plan.option_count).toBe(1);
    expect(body.can_run_analysis).toBe(false);
  });

  // --- F4 #2 — the UNDER-report the synthetic intent key created (Paul, 28 Jul)
  //
  // The defect this pins, end to end on the route:
  //   1. A user adds an option by chat. It is created with NO effect values.
  //   2. `reconcile-top-level-options.ts` stamps it `status: "needs_encoding"`
  //      — that producer stamps `needs_encoding` on ANY option lacking a numeric
  //      value, INCLUDING one with no values at all. It is NOT the narrow
  //      documented meaning ("raw values awaiting numeric encoding",
  //      `schemas/analysis-ready.ts`), and CEE's OWN payload validator flags this
  //      exact wire state as an inconsistency
  //      (`OPTION_NEEDS_ENCODING_WITHOUT_RAW`, `transforms/analysis-ready.ts`).
  //   3. `buildReadinessRawPersistedGraph` used to READ that status as if it
  //      carried the narrow meaning and FABRICATE an intervention-intent key for
  //      it, even with `interventions: {}` and NO `raw_interventions`.
  //   4. Intent is never scaffolded over (`analysable-option-gate.ts`), so
  //      the fabricated intent suppressed the scaffold →
  //      `will_scaffold_options: false` → the UI's OR-term collapsed → the run
  //      was refused.
  //
  // It is a FALSE NEGATIVE: `run_analysis` reads the REAL persisted graph, which
  // carries no such key, so it scaffolds the option and the analysis succeeds.
  // F4 was re-created inside the code written to close F4.
  //
  // Live one-variable control (deployed CEE d6a765d, 28 Jul): flipping ONLY
  // `opt_b.status` "needs_encoding" → "ready", `interventions` still `{}`,
  // flipped `will_scaffold_options` false → true. The status was the sole
  // discriminating variable.
  //
  // This is the exact wire shape captured live from the app's own request.
  // RED before the fix: will_scaffold_options === false.
  it("F4 #2 RED-first: needs_encoding with NO values at all (interventions {} and no raw_interventions) → will_scaffold_options=true (the run path DOES scaffold it)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersF4e,
      payload: {
        graph: makeMixedV3Graph(),
        analysis_ready: {
          goal_node_id: "goal",
          status: "needs_encoding",
          options: [
            { id: "opt_a", label: "Premium", status: "ready", interventions: { fac_price: 0.9 } },
            { id: "opt_c", label: "Value", status: "ready", interventions: { fac_price: 0.4 } },
            // opt_b: added by chat, never configured. NOTHING was set — no
            // numeric intervention, no raw value. There is no user intent here
            // to protect; the run path scaffolds it and succeeds.
            {
              id: "opt_b",
              label: "Partner with a specialist consultancy",
              status: "needs_encoding",
              interventions: {},
            },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scaffold_plan).toBeDefined();
    expect(body.scaffold_plan.will_scaffold_options).toBe(true);
    expect(body.scaffold_plan.option_count).toBe(1);
    // can_run_analysis stays HONEST and unchanged (#612's invariant): the option
    // genuinely is not "ready". The panel's runnability comes from the OR with
    // scaffold_plan, never from readiness lying.
    expect(body.can_run_analysis).toBe(false);
    // The structured fields the UI must compose its blocked/runnable copy from
    // stay truthful and specific — never "add a decision, a goal and at least
    // two options" when five options are present.
    expect(body.options_total).toBe(3);
    expect(body.options_ready).toBe(2);
    expect(body.issues).toContain('Option "opt_b" has no interventions');
  });

  // Control (the near neighbour that must NOT change): the same empty option
  // with an EXPLICIT empty raw_interventions map. Same absence of intent, same
  // answer — the fix must not depend on whether the caller omitted the field or
  // sent it empty.
  it("F4 #2 control: needs_encoding with an explicitly EMPTY raw_interventions → will_scaffold_options=true", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/graph-readiness",
      headers: headersF4f,
      payload: {
        graph: makeMixedV3Graph(),
        analysis_ready: {
          goal_node_id: "goal",
          status: "needs_encoding",
          options: [
            { id: "opt_a", label: "Premium", status: "ready", interventions: { fac_price: 0.9 } },
            { id: "opt_c", label: "Value", status: "ready", interventions: { fac_price: 0.4 } },
            {
              id: "opt_b",
              label: "Partner with a specialist consultancy",
              status: "needs_encoding",
              interventions: {},
              raw_interventions: {},
            },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scaffold_plan.will_scaffold_options).toBe(true);
    expect(body.scaffold_plan.option_count).toBe(1);
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
        { id: "opt_a", kind: "option", label: "Premium" },
        { id: "opt_b", kind: "option", label: "Unconfigured" },
      ],
      edges: [
        { id: "e1", from: "decision", to: "opt_a" },
        { id: "e2", from: "decision", to: "opt_b" },
        { id: "e3", from: "opt_a", to: "fac_price" },
        { id: "e4", from: "opt_b", to: "fac_price" },
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
      headers: headersF4c,
      payload: {
        graph: makeObservedStateV3Graph(),
        analysis_ready: {
          goal_node_id: "goal",
          status: "needs_user_mapping",
          options: [
            { id: "opt_a", label: "Premium", status: "ready", interventions: { fac_price: 0.9 } },
            { id: "opt_c", label: "Value", status: "ready", interventions: { fac_price: 0.4 } },
            { id: "opt_b", label: "Unconfigured", status: "needs_user_mapping", interventions: {} },
          ],
          user_questions: ["Which factors and values for: Unconfigured?"],
        },
      },
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
