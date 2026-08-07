/**
 * ROADMAP 2.740a — substep 1b (orchestrator validation) LLM-repair limb removal.
 *
 * Evidence: PHASE0-EVIDENCE-2026-07-28/substep1b-repair-measurement-2026-08-08.md
 * (0 invocations in a controlled 7-day window; gate false on staging + demo,
 * absent→false in production; `skip_repair` false on 398/398 turns, so one
 * dashboard flip would have armed a 60 s gpt-4.1 repair on 100 % of turns).
 *
 * These tests run with the gate **ENABLED** — the posture under which the
 * hazard was real — against the REAL `validateAndRepairGraph`. Only the LLM
 * router, config, telemetry and the error-response builder are mocked.
 *
 * The pair they form is the point:
 *   - "removed the broken half": no LLM repair adapter is constructed or
 *     invoked, and the defer limb can no longer adopt an LLM-authored graph.
 *   - "kept the working half": the deterministic validator still runs and
 *     still rejects invalid graphs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (must precede imports) ────────────────────────────────────────────

// Mutable so each test can pin the posture it is making a claim about.
// `vi.hoisted` because `vi.mock` factories are hoisted above module scope.
const { mockConfig, getAdapter } = vi.hoisted(() => ({
  mockConfig: {
    cee: {
      orchestratorValidationEnabled: false,
      // Present so the PRISTINE (limb-bearing) code takes its production
      // branch: totalAttempts = maxRetries + 1. Without it the retry loop
      // computes NaN and never runs, which would make the RED vacuous.
      maxRepairRetries: 1,
      enforceSingleGoal: true,
      debugLoggingEnabled: false,
    },
    features: {},
  },
  // THE INSTRUMENT. `getAdapter` is the only door to an LLM repair call from
  // substep 1b (`getAdapter("repair_graph", …)`). Asserting on it is asserting
  // on the limb itself, by identity — not on a proxy for it.
  getAdapter: vi.fn(),
}));

vi.mock("../../src/config/index.js", () => ({
  config: mockConfig,
  isProduction: vi.fn().mockReturnValue(true),
}));

vi.mock("../../src/adapters/llm/router.js", () => ({
  getAdapter: (...args: unknown[]) => getAdapter(...args),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  calculateCost: vi.fn().mockReturnValue(0),
  TelemetryEvents: { GuardViolation: "GuardViolation" },
}));

vi.mock("../../src/cee/validation/pipeline.js", () => ({
  buildCeeErrorResponse: (code: string, message: string, meta?: any) => ({
    error: { code, message },
    trace: { request_id: meta?.requestId, details: meta?.details },
  }),
  isAdminAuthorized: () => false,
}));

// ── Imports (REAL graph-orchestrator — that is the whole point) ─────────────

import { runOrchestratorValidation } from "../../src/cee/unified-pipeline/stages/repair/orchestrator-validation.js";
import { Graph } from "../../src/schemas/graph.js";

// ── Fixtures, pinned against the PRODUCER'S OWN CONTRACT ────────────────────
//
// Every fixture below is asserted against the `Graph` Zod schema in-test
// (`pinFixture`), so no fixture can silently drift out of the shape the
// pipeline actually carries, and no test can pass because its input never
// reached the code path it names.

function validGraph() {
  return {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: "goal_1", kind: "goal", label: "Maximise value" },
      { id: "dec_1", kind: "decision", label: "Main decision" },
      { id: "opt_a", kind: "option", label: "Option A" },
      { id: "opt_b", kind: "option", label: "Option B" },
      {
        id: "fac_price",
        kind: "factor",
        label: "Price",
        category: "controllable",
        data: { value: 100, extractionType: "explicit", factor_type: "price", uncertainty_drivers: ["volatility"] },
      },
      { id: "outcome_1", kind: "outcome", label: "Revenue" },
    ],
    edges: [
      { from: "dec_1", to: "opt_a", strength_mean: 1, belief_exists: 1, origin: "ai" },
      { from: "dec_1", to: "opt_b", strength_mean: 1, belief_exists: 1, origin: "ai" },
      { from: "opt_a", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive", origin: "ai" },
      { from: "opt_b", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive", origin: "ai" },
      { from: "fac_price", to: "outcome_1", strength_mean: 0.7, belief_exists: 0.9, origin: "ai" },
      { from: "outcome_1", to: "goal_1", strength_mean: 0.8, belief_exists: 0.95, origin: "ai" },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  };
}

/** Zod-VALID but deterministically INVALID (no goal node) — reaches Phase 2. */
function deterministicallyInvalidGraph() {
  return {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: "dec_1", kind: "decision", label: "Main decision" },
      { id: "opt_a", kind: "option", label: "Option A" },
      { id: "opt_b", kind: "option", label: "Option B" },
    ],
    edges: [
      { from: "dec_1", to: "opt_a", strength_mean: 1, origin: "ai" },
      { from: "dec_1", to: "opt_b", strength_mean: 1, origin: "ai" },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  };
}

/**
 * What a repair LLM would hand back: Zod-valid, still deterministically
 * invalid, and carrying node IDs that appear NOWHERE in the input. The
 * disjoint ID set is what makes the adoption observable by identity.
 */
const FABRICATED_IDS = ["llm_fabricated_dec", "llm_fabricated_opt_a", "llm_fabricated_opt_b"] as const;

function llmRewrittenGraph() {
  return {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: FABRICATED_IDS[0], kind: "decision", label: "LLM decision" },
      { id: FABRICATED_IDS[1], kind: "option", label: "LLM option A" },
      { id: FABRICATED_IDS[2], kind: "option", label: "LLM option B" },
    ],
    edges: [
      { from: FABRICATED_IDS[0], to: FABRICATED_IDS[1], strength_mean: 1, origin: "ai" },
      { from: FABRICATED_IDS[0], to: FABRICATED_IDS[2], strength_mean: 1, origin: "ai" },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  };
}

function pinFixture(graph: unknown, expected: "zod-valid") {
  const parsed = Graph.safeParse(graph);
  expect(parsed.success, `fixture must be ${expected} against the Graph contract`).toBe(true);
  return graph;
}

const idsOf = (g: any): string[] => (g?.nodes ?? []).map((n: any) => n.id).sort();

function makeCtx(overrides: Record<string, unknown> = {}): any {
  return {
    requestId: "req-2740a",
    input: { brief: "Test brief", flags: null },
    request: { id: "req-2740a", headers: {} },
    opts: { schemaVersion: "v3" as const, signal: undefined },
    graph: validGraph(),
    effectiveBrief: "Test brief",
    skipRepairDueToBudget: false,
    repairTimeoutMs: 60_000,
    llmRepairNeeded: false,
    repairTrace: undefined,
    earlyReturn: undefined,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("2.740a — substep 1b LLM-repair limb is removed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.cee.orchestratorValidationEnabled = false;
    // Any consultation of the router from substep 1b is a limb; if the limb
    // exists it will find a working adapter here, so the RED is about the
    // call happening, never about the adapter being unusable.
    getAdapter.mockReturnValue({
      name: "openai",
      model: "gpt-4.1-2025-04-14",
      repairGraph: vi.fn().mockResolvedValue({
        graph: llmRewrittenGraph(),
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    });
  });

  it("gate ENABLED + a graph that reaches the repair trigger: no LLM repair adapter is requested or invoked", async () => {
    mockConfig.cee.orchestratorValidationEnabled = true;
    const input = pinFixture(deterministicallyInvalidGraph(), "zod-valid");

    const repairGraph = vi.fn().mockResolvedValue({
      graph: llmRewrittenGraph(),
      usage: { input_tokens: 10, output_tokens: 10 },
    });
    getAdapter.mockReturnValue({ name: "openai", model: "gpt-4.1-2025-04-14", repairGraph });

    const ctx = makeCtx({ graph: input, llmRepairNeeded: true });
    await runOrchestratorValidation(ctx);

    // PRECONDITION PIN: the fixture must genuinely reach the repair trigger,
    // or "no adapter was called" would be true for an uninteresting reason.
    // A deferred defer-limb outcome is the proof the validator rejected it.
    expect(ctx.earlyReturn, "fixture must have failed validation and deferred").toBeUndefined();
    expect(ctx.orchestratorRepairUsed, "success path must not have been taken").toBeUndefined();

    // THE CLAIM.
    expect(getAdapter).not.toHaveBeenCalled();
    expect(repairGraph).not.toHaveBeenCalled();
  });

  it("gate ENABLED + gate DISABLED: the router is never consulted for repair_graph in either posture", async () => {
    for (const enabled of [false, true]) {
      vi.clearAllMocks();
      mockConfig.cee.orchestratorValidationEnabled = enabled;
      const ctx = makeCtx({ graph: pinFixture(validGraph(), "zod-valid") });
      await runOrchestratorValidation(ctx);
      expect(
        getAdapter.mock.calls.filter((c) => c[0] === "repair_graph"),
        `no repair_graph adapter with gate ${enabled}`,
      ).toHaveLength(0);
    }
  });

  it("the defer limb cannot adopt an LLM-authored graph: ctx.graph keeps the INPUT's node identities", async () => {
    mockConfig.cee.orchestratorValidationEnabled = true;
    const input = pinFixture(deterministicallyInvalidGraph(), "zod-valid");
    pinFixture(llmRewrittenGraph(), "zod-valid");

    const inputIds = idsOf(input);
    // PRECONDITION PIN: the two ID sets must be disjoint, or the assertion
    // below could pass while an adoption silently happened.
    expect(inputIds.filter((id) => (FABRICATED_IDS as readonly string[]).includes(id))).toHaveLength(0);

    const ctx = makeCtx({ graph: input, llmRepairNeeded: true });
    await runOrchestratorValidation(ctx);

    expect(ctx.earlyReturn, "llmRepairNeeded=true must defer, not 422").toBeUndefined();
    // Bound by IDENTITY: the surviving graph's nodes are the input's nodes.
    expect(idsOf(ctx.graph)).toEqual(inputIds);
    for (const fabricated of FABRICATED_IDS) {
      expect(idsOf(ctx.graph)).not.toContain(fabricated);
    }
  });
});

describe("2.740a — the deterministic validator is KEPT and still validates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.cee.orchestratorValidationEnabled = true;
    getAdapter.mockReturnValue({ name: "openai", model: "gpt-4.1", repairGraph: vi.fn() });
  });

  it("rejects a deterministically-invalid graph with the validator's own MISSING_GOAL code (422)", async () => {
    const input = pinFixture(deterministicallyInvalidGraph(), "zod-valid");
    // llmRepairNeeded=false ⇒ the 422 limb, which carries the codes on the wire.
    const ctx = makeCtx({ graph: input, llmRepairNeeded: false });

    await runOrchestratorValidation(ctx);

    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn.statusCode).toBe(422);
    expect(ctx.earlyReturn.body.error.code).toBe("CEE_GRAPH_INVALID");
    // Bound by IDENTITY to the deterministic validator's own emitted code —
    // not to "some error happened".
    expect(ctx.earlyReturn.body.details ?? ctx.earlyReturn.body.trace?.details).toBeDefined();
    const details = (ctx.earlyReturn.body.trace?.details ?? {}) as any;
    expect(details.validation_error_codes).toContain("MISSING_GOAL");
    expect(details.last_phase).toBe("orchestrator_validation");
    // And the honest disclosure: no LLM repair was called.
    expect(details.llm_repair_called).toBe(false);
  });

  it("accepts a valid graph and returns the validator's normalisation + warnings", async () => {
    const source = validGraph();
    // Strip an edge origin so the validator's own normalisation step has an
    // observable, identity-bound effect to prove it ran.
    delete (source.edges[0] as any).origin;
    const input = pinFixture(source, "zod-valid");

    const ctx = makeCtx({ graph: input, llmRepairNeeded: false });
    await runOrchestratorValidation(ctx);

    expect(ctx.earlyReturn).toBeUndefined();
    expect(ctx.orchestratorRepairUsed).toBe(false);
    // normaliseGraph() defaulted the missing origin to "ai" — proof the
    // deterministic normalisation phase executed on THIS graph.
    expect((ctx.graph.edges[0] as any).origin).toBe("ai");
    expect(
      (ctx.orchestratorWarnings ?? []).map((w: any) => w.code),
    ).toContain("EDGE_ORIGIN_DEFAULTED");
    // Node identities are untouched by the deterministic path.
    expect(idsOf(ctx.graph)).toEqual(idsOf(source));
  });
});
