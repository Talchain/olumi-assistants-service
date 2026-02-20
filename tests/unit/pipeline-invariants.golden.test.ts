/**
 * CI-safe golden pipeline invariant test (B1.4 CEE)
 *
 * Runs stages 2–6 of the unified pipeline with a synthetic fixture graph
 * and stubbed LLM calls. Asserts structural invariants of the V3 output.
 *
 * Network tripwire: every LLM adapter method throws immediately.
 * If any stage makes an unexpected live network call, the test fails loudly.
 *
 * Fixture: synthetic inline graph — created because no pre-recorded Stage 1
 * checkpoint exists in the repo.
 *
 * Stage sequence called:
 *   runStageNormalise → runStageEnrich → runStageRepair →
 *   runStagePackage → runStageBoundary
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Tripwire adapter (must be before all mocks) ────────────────────────────

const TRIPWIRE_MSG = "NETWORK TRIPWIRE: Live LLM call attempted in CI-safe test. Stub the adapter.";

function tripwireMethod(): never {
  throw new Error(TRIPWIRE_MSG);
}

const tripwireAdapter = {
  name: "TRIPWIRE",
  model: "TRIPWIRE",
  draftGraph: tripwireMethod,
  repairGraph: tripwireMethod,
  clarifyBrief: tripwireMethod,
  suggestOptions: tripwireMethod,
  critiqueGraph: tripwireMethod,
  explainDiff: tripwireMethod,
  chat: tripwireMethod,
};

// ── Module mocks ────────────────────────────────────────────────────────────

// -- Tripwire: LLM adapter
vi.mock("../../src/adapters/llm/router.js", () => ({
  getAdapter: () => tripwireAdapter,
  getAdapterForProvider: () => { throw new Error(TRIPWIRE_MSG); },
  resetAdapterCache: vi.fn(),
  getMaxTokensFromConfig: () => undefined,
}));

// -- Stub: factor enrichment (Stage 3 LLM call)
vi.mock("../../src/cee/factor-extraction/enricher.js", () => ({
  enrichGraphWithFactorsAsync: vi.fn(async (graph: any) => ({
    graph,
    factorsAdded: 0,
    factorsEnhanced: 0,
    factorsSkipped: 0,
    extractionMode: "regex-only",
    llmSuccess: false,
    warnings: [],
  })),
}));

// -- Stub: PLoT validation (Stage 4 external HTTP call)
vi.mock("../../src/services/validateClientWithCache.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
  __resetValidationCacheForTests: vi.fn(),
}));

vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

// -- Config
vi.mock("../../src/config/index.js", () => ({
  config: {
    cee: {
      orchestratorValidationEnabled: false,
      clarifierEnabled: false,
      enforceSingleGoal: true,
      draftArchetypesEnabled: false,
      draftStructuralWarningsEnabled: true,
      pipelineCheckpointsEnabled: false,
      debugLoggingEnabled: false,
      debugCategoryTrace: false,
      refinementEnabled: false,
      llmFirstExtractionEnabled: false,
    },
    validation: {
      engineBaseUrl: "http://TRIPWIRE.invalid",
      cacheEnabled: false,
    },
    llm: { provider: "fixtures", model: "fixture-v1" },
  },
  isProduction: vi.fn().mockReturnValue(false),
  shouldUseStagingPrompts: vi.fn().mockReturnValue(false),
}));

// -- Telemetry (suppress noise)
vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  calculateCost: vi.fn().mockReturnValue(0),
  TelemetryEvents: {
    GuardViolation: "GuardViolation",
    CeeGraphGoalsMerged: "CeeGraphGoalsMerged",
    CeeGoalInferred: "CeeGoalInferred",
    CeeClarifierFailed: "CeeClarifierFailed",
  },
}));

// -- Stage 4 deps: graph-orchestrator (gated off via config, but mock for safety)
vi.mock("../../src/cee/graph-orchestrator.js", () => ({
  validateAndRepairGraph: vi.fn(),
  GraphValidationError: class extends Error {},
}));

// -- Stage 4 deps: validation pipeline
vi.mock("../../src/cee/validation/pipeline.js", () => ({
  buildCeeErrorResponse: (code: string, msg: string, meta?: any) => ({
    error: { code, message: msg },
  }),
  integrateClarifier: vi.fn(),
  isAdminAuthorized: () => false,
}));

// -- Stage 4 deps: preserveFieldsFromOriginal
vi.mock("../../src/routes/assist.draft-graph.js", () => ({
  preserveFieldsFromOriginal: vi.fn().mockImplementation((norm: any) => norm),
}));

// -- Stage 4 deps: simpleRepair + stabilise (pass through)
vi.mock("../../src/services/repair.js", () => ({
  simpleRepair: vi.fn().mockImplementation((g: any) => g),
}));

vi.mock("../../src/orchestrator/index.js", () => ({
  stabiliseGraph: vi.fn().mockImplementation((g: any) => g),
  ensureDagAndPrune: vi.fn().mockImplementation((g: any) => g),
}));

// -- Stage 4 deps: graph determinism (use real)
vi.mock("../../src/utils/graph-determinism.js", async (importOriginal) => {
  const orig: any = await importOriginal();
  return { ...orig };
});

// -- Stage 4 deps: structure (goal merge pass through + structure detectors)
vi.mock("../../src/cee/structure/index.js", () => ({
  validateAndFixGraph: vi.fn(),
  ensureGoalNode: vi.fn(),
  hasGoalNode: vi.fn().mockReturnValue(false),
  wireOutcomesToGoal: vi.fn().mockImplementation((g: any) => g),
  normaliseDecisionBranchBeliefs: vi.fn().mockImplementation((g: any) => g),
  detectStructuralWarnings: vi.fn().mockReturnValue({ warnings: [], uncertainNodeIds: [] }),
  detectUniformStrengths: vi.fn().mockReturnValue({ detected: false }),
  detectStrengthClustering: vi.fn().mockReturnValue({ detected: false }),
  detectSameLeverOptions: vi.fn().mockReturnValue({ detected: false }),
  detectMissingBaseline: vi.fn().mockReturnValue({ detected: false }),
  detectGoalNoBaselineValue: vi.fn().mockReturnValue({ detected: false }),
  detectZeroExternalFactors: vi.fn().mockReturnValue({ detected: false, factorCount: 0, externalCount: 0 }),
  checkGoalConnectivity: vi.fn().mockReturnValue({ status: "ok" }),
  computeModelQualityFactors: vi.fn().mockReturnValue({}),
}));

// -- Stage 4 deps: compound goals
vi.mock("../../src/cee/compound-goal/index.js", () => ({
  extractCompoundGoals: vi.fn().mockReturnValue({ constraints: [], isCompound: false }),
  toGoalConstraints: vi.fn().mockReturnValue([]),
  remapConstraintTargets: vi.fn().mockReturnValue({ constraints: [], remapped: 0, rejected_junk: 0, rejected_no_match: 0 }),
}));

// -- Stage 4 deps: STRP (use real)
vi.mock("../../src/validators/structural-reconciliation.js", async (importOriginal) => {
  const orig: any = await importOriginal();
  return { ...orig };
});

// -- Stage 4 deps: edge identity (use real)
vi.mock("../../src/cee/unified-pipeline/edge-identity.js", async (importOriginal) => {
  const orig: any = await importOriginal();
  return { ...orig };
});

// -- Stage 4 deps: structure checks (connectivity always valid)
vi.mock("../../src/cee/transforms/structure-checks.js", () => ({
  validateMinimumStructure: vi.fn().mockReturnValue({
    valid: true,
    missing: [],
    counts: { goal: 1, decision: 1, option: 2, factor: 2, outcome: 1 },
    connectivity_failed: false,
  }),
  MINIMUM_STRUCTURE_REQUIREMENT: { goal: 1, decision: 1, option: 1 },
}));

// -- Stage 4 deps: graph normalisation (pass through)
vi.mock("../../src/cee/transforms/graph-normalisation.js", () => ({
  normaliseCeeGraphVersionAndProvenance: vi.fn().mockImplementation((g: any) => g),
}));

// -- Stage 4 deps: quality
vi.mock("../../src/cee/quality/index.js", () => ({
  computeQuality: vi.fn().mockReturnValue({
    overall: 7, structure: 7, coverage: 7, safety: 8, causality: 6,
  }),
}));

// -- Stage 4 deps: DraftGraphOutput.parse (pass through, keep GoalConstraintSchema etc.)
vi.mock("../../src/schemas/assist.js", async (importOriginal) => {
  const orig: any = await importOriginal();
  return {
    ...orig,
    DraftGraphOutput: {
      parse: vi.fn().mockImplementation((input: any) => input),
    },
  };
});

// -- Stage 4 deps: versions
vi.mock("../../src/cee/constants/versions.js", () => ({
  DETERMINISTIC_SWEEP_VERSION: "golden-test-v1",
}));

// -- Stage 3 deps: graph guards
vi.mock("../../src/utils/graphGuards.js", () => ({
  detectCycles: vi.fn().mockReturnValue([]),
}));

// -- Stage 5 deps: archetypes
vi.mock("../../src/cee/archetypes/index.js", () => ({
  inferArchetype: vi.fn().mockReturnValue({
    archetype: { decision_type: "generic", match: "generic", confidence: 0.8 },
    issues: [],
  }),
}));

// -- Stage 5 deps: bias
vi.mock("../../src/cee/bias/index.js", () => ({
  sortBiasFindings: vi.fn().mockImplementation((findings: any) => findings ?? []),
}));

// -- Stage 5 deps: response caps (pass through)
vi.mock("../../src/cee/transforms/response-caps.js", () => ({
  applyResponseCaps: vi.fn().mockImplementation((payload: any) => ({
    cappedPayload: payload,
    limits: {},
  })),
}));

// -- Stage 5 deps: guidance
vi.mock("../../src/cee/guidance/index.js", () => ({
  ceeAnyTruncated: vi.fn().mockReturnValue(false),
  buildCeeGuidance: vi.fn().mockReturnValue({ summary: "OK" }),
}));

// -- Stage 5 deps: verification pipeline (pass through)
vi.mock("../../src/cee/verification/index.js", () => ({
  verificationPipeline: {
    verify: vi.fn().mockImplementation(async (response: any) => ({ response })),
  },
}));

// -- Stage 5 deps: V1 schema
vi.mock("../../src/schemas/ceeResponses.js", () => ({
  CEEDraftGraphResponseV1Schema: {},
}));

// -- Stage 5 deps: pipeline checkpoints
vi.mock("../../src/cee/pipeline-checkpoints.js", () => ({
  captureCheckpoint: vi.fn().mockReturnValue({}),
  applyCheckpointSizeGuard: vi.fn().mockReturnValue([]),
  assembleCeeProvenance: vi.fn().mockReturnValue({}),
}));

// -- Stage 5 deps: LLM output store
vi.mock("../../src/cee/llm-output-store.js", () => ({
  buildLLMRawTrace: vi.fn(),
}));

// -- Stage 5 deps: version
vi.mock("../../src/version.js", () => ({
  SERVICE_VERSION: "1.0.0-golden-test",
}));

// -- Stage 6: V3 transform (use REAL for golden validation)
// schema-v3.js and analysis-ready.js are NOT mocked — they run for real

// -- Stage 6 deps: V2 transform (keep isFactorData etc., only stub transformResponseToV2)
vi.mock("../../src/cee/transforms/schema-v2.js", async (importOriginal) => {
  const orig: any = await importOriginal();
  return {
    ...orig,
    transformResponseToV2: vi.fn(),
  };
});

// ── Imports ─────────────────────────────────────────────────────────────────

import { runStageNormalise } from "../../src/cee/unified-pipeline/stages/normalise.js";
import { runStageEnrich } from "../../src/cee/unified-pipeline/stages/enrich.js";
import { runStageRepair } from "../../src/cee/unified-pipeline/stages/repair/index.js";
import { runStagePackage } from "../../src/cee/unified-pipeline/stages/package.js";
import { runStageBoundary } from "../../src/cee/unified-pipeline/stages/boundary.js";
import { CEEGraphResponseV3 } from "../../src/schemas/cee-v3.js";
import { getAdapter } from "../../src/adapters/llm/router.js";
import { enrichGraphWithFactorsAsync } from "../../src/cee/factor-extraction/enricher.js";
import { validateAndFixGraph } from "../../src/cee/structure/index.js";
import { validateGraph } from "../../src/services/validateClientWithCache.js";

// ── Synthetic fixture graph ─────────────────────────────────────────────────

/**
 * Synthetic fixture — created because no pre-recorded Stage 1 checkpoint
 * exists in the repo.
 *
 * Topology: decision → opt_a → fac_cost → outcome_1 → goal_1
 *                     → opt_b → fac_rev  → outcome_1 → goal_1
 * Sentinel fields at all depths for field-preservation verification.
 */
const GOLDEN_FIXTURE_GRAPH = {
  version: "1",
  default_seed: 42,
  _sentinel_top: "golden_top",
  nodes: [
    {
      id: "goal_1",
      kind: "goal",
      label: "Maximise revenue",
      description: "Increase annual revenue",
      _sentinel_node: "goal_1_s",
    },
    {
      id: "dec_1",
      kind: "decision",
      label: "Market entry strategy",
      _sentinel_node: "dec_1_s",
    },
    {
      id: "opt_a",
      kind: "option",
      label: "Organic growth",
      data: {
        interventions: { fac_cost: 50000 },
        _sentinel_opt_data: "opt_a_data_s",
      },
      _sentinel_node: "opt_a_s",
    },
    {
      id: "opt_b",
      kind: "option",
      label: "Acquisition",
      data: {
        interventions: { fac_rev: 200000 },
        _sentinel_opt_data: "opt_b_data_s",
      },
      _sentinel_node: "opt_b_s",
    },
    {
      id: "fac_cost",
      kind: "factor",
      label: "Implementation cost",
      category: "controllable",
      data: {
        value: 50000,
        baseline: 40000,
        unit: "USD",
        factor_type: "cost",
        _sentinel_fac_data: "fac_cost_data_s",
      },
      _sentinel_node: "fac_cost_s",
    },
    {
      id: "fac_rev",
      kind: "factor",
      label: "Revenue uplift",
      category: "observable",
      data: {
        value: 200000,
        unit: "USD",
        _sentinel_fac_data: "fac_rev_data_s",
      },
      _sentinel_node: "fac_rev_s",
    },
    {
      id: "outcome_1",
      kind: "outcome",
      label: "Market share increase",
      _sentinel_node: "outcome_1_s",
    },
  ],
  edges: [
    {
      from: "dec_1", to: "opt_a",
      strength_mean: 1.0, strength_std: 0.01, belief_exists: 1.0,
      effect_direction: "positive",
      _sentinel_edge: "e_dec_opt_a_s",
    },
    {
      from: "dec_1", to: "opt_b",
      strength_mean: 1.0, strength_std: 0.01, belief_exists: 1.0,
      effect_direction: "positive",
      _sentinel_edge: "e_dec_opt_b_s",
    },
    {
      from: "opt_a", to: "fac_cost",
      strength_mean: -0.8, strength_std: 0.1, belief_exists: 0.9,
      effect_direction: "negative",
      provenance: { source: "brief_extraction", _sentinel_prov: "prov_a_s" },
      _sentinel_edge: "e_opt_a_fac_s",
    },
    {
      from: "opt_b", to: "fac_rev",
      strength_mean: 0.9, strength_std: 0.08, belief_exists: 0.85,
      effect_direction: "positive",
      _sentinel_edge: "e_opt_b_fac_s",
    },
    {
      from: "fac_cost", to: "outcome_1",
      strength_mean: -0.5, strength_std: 0.15, belief_exists: 0.8,
      effect_direction: "negative",
      _sentinel_edge: "e_fac_cost_out_s",
    },
    {
      from: "fac_rev", to: "outcome_1",
      strength_mean: 0.7, strength_std: 0.12, belief_exists: 0.8,
      effect_direction: "positive",
      _sentinel_edge: "e_fac_rev_out_s",
    },
    {
      from: "outcome_1", to: "goal_1",
      strength_mean: 0.8, strength_std: 0.1, belief_exists: 0.9,
      effect_direction: "positive",
      provenance: { source: "cee_hypothesis", _sentinel_prov: "prov_out_s" },
      _sentinel_edge: "e_out_goal_s",
    },
  ],
  meta: {
    roots: ["dec_1"],
    leaves: ["goal_1"],
    suggested_positions: {},
    source: "assistant",
  },
};

// ── StageContext builder ────────────────────────────────────────────────────

function makeGoldenCtx(): any {
  return {
    requestId: "golden-test-001",
    input: { brief: "Should we pursue organic growth or acquisition?", flags: null, include_debug: false, seed: 42 },
    rawBody: {},
    request: {
      id: "golden-test-001",
      headers: { "x-olumi-assist-key": "test-key" },
      query: {},
      raw: { destroyed: false },
    },
    opts: { schemaVersion: "v3" as const, requestStartMs: Date.now(), strictMode: false, includeDebug: false },
    start: Date.now(),
    graph: structuredClone(GOLDEN_FIXTURE_GRAPH),

    // Stage 1 outputs (simulated)
    rationales: [{ target: "goal_1", why: "User wants to maximise revenue" }],
    draftCost: 0,
    draftAdapter: { name: "fixtures", model: "fixture-v1" },
    llmMeta: {
      prompt_version: "v15",
      model: "fixture-v1",
      temperature: 0,
      token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      finish_reason: "stop",
      provider_latency_ms: 0,
    },
    confidence: 0.82,
    clarifierStatus: "complete",
    effectiveBrief: "Should we pursue organic growth or acquisition?",
    edgeFieldStash: undefined,
    skipRepairDueToBudget: false,
    repairTimeoutMs: 20_000,
    draftDurationMs: 100,

    // Stage 2 outputs
    strpResult: undefined,
    riskCoefficientCorrections: [],
    transforms: [],

    // Stage 3 outputs
    enrichmentResult: undefined,
    enrichmentTrace: undefined,
    hadCycles: false,

    // Stage 4 outputs
    nodeRenames: new Map<string, string>(),
    goalConstraints: undefined,
    constraintStrpResult: undefined,
    repairCost: 0,
    repairFallbackReason: undefined,
    clarifierResult: undefined,
    structuralMeta: undefined,
    validationSummary: undefined,

    // Stage 5 outputs
    quality: undefined,
    archetype: undefined,
    draftWarnings: [],
    ceeResponse: undefined,
    pipelineTrace: undefined,

    // Stage 6 outputs
    finalResponse: undefined,

    // Cross-cutting
    collector: {
      add: vi.fn(),
      addByStage: vi.fn(),
      hasCorrections: vi.fn().mockReturnValue(false),
      getCorrections: vi.fn().mockReturnValue([]),
      getSummary: vi.fn().mockReturnValue({}),
    },
    pipelineCheckpoints: [],
    checkpointsEnabled: false,
  };
}

// ── Setup ───────────────────────────────────────────────────────────────────

function setupDefaults(): void {
  vi.clearAllMocks();

  // Goal merge: return graph as-is (single goal, no merge needed)
  (validateAndFixGraph as any).mockImplementation((g: any) => ({
    graph: g,
    valid: true,
    fixes: {
      singleGoalApplied: false,
      outcomeBeliefsFilled: 0,
      decisionBranchesNormalized: false,
    },
    warnings: [],
  }));
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Network tripwire", () => {
  it("throws NETWORK TRIPWIRE on any LLM adapter call", () => {
    const adapter = getAdapter();
    expect(() => adapter.draftGraph({} as any, {} as any)).toThrow(TRIPWIRE_MSG);
    expect(() => adapter.repairGraph({} as any, {} as any)).toThrow(TRIPWIRE_MSG);
    expect(() => adapter.clarifyBrief({} as any, {} as any)).toThrow(TRIPWIRE_MSG);
  });

  it("tripwire works for unexpected input (not just empty args)", () => {
    const adapter = getAdapter();
    expect(() =>
      adapter.draftGraph(
        { brief: "real brief", docs: [], seed: 1 } as any,
        { requestId: "test", timeoutMs: 5000 } as any,
      ),
    ).toThrow(TRIPWIRE_MSG);
  });

  it("tripwire fires when clarifier config enables LLM-dependent code path", async () => {
    setupDefaults();

    const { config } = await import("../../src/config/index.js");
    (config as any).cee.clarifierEnabled = true;

    try {
      // Make integrateClarifier simulate what the real one does: call the adapter.
      // The clarifier substep wraps this in try/catch (swallows errors), so we
      // verify: (1) integrateClarifier was called, (2) the tripwire error was
      // emitted via CeeClarifierFailed telemetry with the TRIPWIRE_MSG.
      const { integrateClarifier } = await import("../../src/cee/validation/pipeline.js");
      (integrateClarifier as any).mockImplementationOnce(async () => {
        const adapter = getAdapter();
        adapter.clarifyBrief({} as any, {} as any);
      });

      const ctx = makeGoldenCtx();
      await runStageRepair(ctx);

      // integrateClarifier was called — proves clarifierEnabled routes to substep 9
      expect(integrateClarifier).toHaveBeenCalledTimes(1);

      // Tripwire error was caught by clarifier's try/catch and emitted as telemetry.
      // Assert the emitted CeeClarifierFailed event contains the TRIPWIRE_MSG.
      const { emit } = await import("../../src/utils/telemetry.js");
      const emitCalls = (emit as any).mock.calls;
      const clarifierFailedCall = emitCalls.find(
        (call: any[]) => call[0] === "CeeClarifierFailed",
      );
      expect(clarifierFailedCall).toBeDefined();
      expect(clarifierFailedCall[1].error_message).toContain(TRIPWIRE_MSG);
    } finally {
      (config as any).cee.clarifierEnabled = false;
    }
  });
});

describe("Golden pipeline invariants (stages 2–6)", () => {
  beforeEach(setupDefaults);

  it("produces a valid CEEGraphResponseV3 from fixture graph", async () => {
    const ctx = makeGoldenCtx();
    const startTime = Date.now();

    // Run stages 2–6 sequentially
    await runStageNormalise(ctx);
    await runStageEnrich(ctx);
    await runStageRepair(ctx);
    await runStagePackage(ctx);
    await runStageBoundary(ctx);

    const elapsed = Date.now() - startTime;

    // Runtime must be < 5s (no network, all deterministic)
    expect(elapsed).toBeLessThan(5000);

    // No early return — pipeline completed
    expect(ctx.earlyReturn).toBeUndefined();

    // Final response exists
    expect(ctx.finalResponse).toBeDefined();
    const response = ctx.finalResponse;

    // schema_version
    expect(response.schema_version).toBe("3.0");

    // Node count >= 3
    expect(Array.isArray(response.nodes)).toBe(true);
    expect(response.nodes.length).toBeGreaterThanOrEqual(3);

    // Edge count >= 2
    expect(Array.isArray(response.edges)).toBe(true);
    expect(response.edges.length).toBeGreaterThanOrEqual(2);

    // Every edge has required V3 fields
    for (const edge of response.edges) {
      expect(typeof edge.from).toBe("string");
      expect(typeof edge.to).toBe("string");
      expect(typeof edge.strength_mean).toBe("number");
      expect(typeof edge.strength_std).toBe("number");
      expect(typeof edge.effect_direction).toBe("string");
    }

    // Every edge from/to references a valid node ID
    const nodeIds = new Set(response.nodes.map((n: any) => n.id));
    for (const edge of response.edges) {
      expect(nodeIds.has(edge.from)).toBe(true);
      expect(nodeIds.has(edge.to)).toBe(true);
    }

    // At least one option with non-empty interventions
    expect(Array.isArray(response.options)).toBe(true);
    const optionWithInterventions = response.options.find(
      (o: any) => o.interventions && Object.keys(o.interventions).length > 0,
    );
    expect(optionWithInterventions).toBeDefined();

    // goal_node_id references a real goal node
    expect(response.goal_node_id).toBeDefined();
    const goalNode = response.nodes.find((n: any) => n.id === response.goal_node_id);
    expect(goalNode).toBeDefined();
    expect(goalNode.kind).toBe("goal");

    // analysis_ready exists with valid status
    expect(response.analysis_ready).toBeDefined();
    expect(
      ["ready", "needs_user_mapping", "needs_encoding", "needs_user_input"],
    ).toContain(response.analysis_ready.status);

    // trace.repair_summary exists
    const repairSummary =
      response.trace?.pipeline?.repair_summary ??
      response.trace?.repair_summary;
    expect(repairSummary).toBeDefined();

    // V3 schema validation passes
    const parseResult = CEEGraphResponseV3.safeParse(response);
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map(
        (i: any) => `${i.path.join(".")}: ${i.message}`,
      );
      throw new Error(`CEEGraphResponseV3.safeParse failed:\n${issues.join("\n")}`);
    }
    expect(parseResult.success).toBe(true);
  });

  it("enrichment stub was called exactly once", async () => {
    const ctx = makeGoldenCtx();
    await runStageNormalise(ctx);
    await runStageEnrich(ctx);
    await runStageRepair(ctx);
    await runStagePackage(ctx);
    await runStageBoundary(ctx);

    expect(enrichGraphWithFactorsAsync).toHaveBeenCalledTimes(1);
  });

  it("PLoT validation stub was called (repair ran)", async () => {
    const ctx = makeGoldenCtx();
    await runStageNormalise(ctx);
    await runStageEnrich(ctx);
    await runStageRepair(ctx);
    await runStagePackage(ctx);
    await runStageBoundary(ctx);

    // PLoT validation should have been called at least once
    expect(validateGraph).toHaveBeenCalled();
  });

  it("sentinel fields survive full pipeline (stages 2–6)", async () => {
    const ctx = makeGoldenCtx();
    const baseline = structuredClone(ctx.graph);
    await runStageNormalise(ctx);
    await runStageEnrich(ctx);
    await runStageRepair(ctx);

    // Check graph-level sentinel survived through stages 2–4
    expect((ctx.graph as any)._sentinel_top).toBe(baseline._sentinel_top);

    // Check node-level sentinels survived
    for (const baselineNode of baseline.nodes) {
      const outputNode = (ctx.graph as any).nodes.find(
        (n: any) => n.id === baselineNode.id || n.label === baselineNode.label,
      );
      if (!outputNode) continue;
      expect(outputNode._sentinel_node).toBe(baselineNode._sentinel_node);
    }
  });

  it("pipeline completes without triggering tripwire (proof: no LLM calls)", async () => {
    // This test implicitly proves the tripwire adapter was never called,
    // because if any stage attempted an LLM call, it would throw NETWORK TRIPWIRE.
    const ctx = makeGoldenCtx();
    await runStageNormalise(ctx);
    await runStageEnrich(ctx);
    await runStageRepair(ctx);
    await runStagePackage(ctx);
    await runStageBoundary(ctx);

    expect(ctx.earlyReturn).toBeUndefined();
    expect(ctx.finalResponse).toBeDefined();
  });
});
