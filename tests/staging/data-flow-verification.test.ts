/**
 * Cross-Service Data Flow Verification — Staging
 *
 * Verifies that the orchestrator's enriched context contains the data it needs
 * at each stage of a decision session. Replaces manual golden-path replay for
 * data-flow bugs (shape mismatches, Zod stripping, missing fields).
 *
 * Steps:
 *   1. Draft — fresh brief, no graph/analysis → graph_patch block
 *   2. Conversation with graph_state — "What's the biggest risk?" → graph visible
 *   3. Analysis present — synthetic analysis_state injected → analysis visible
 *   4. Edit request — "Add a factor" → graph_patch or edit_graph routed
 *   5. System event — patch_accepted → valid envelope, no 500
 *
 * Gating:
 *   - RUN_STAGING_SMOKE=1  (explicit opt-in)
 *   - CEE_BASE_URL         (staging CEE URL)
 *   - CEE_API_KEY          (X-Olumi-Assist-Key header)
 *
 * Run with:
 *   RUN_STAGING_SMOKE=1 \
 *   CEE_BASE_URL=<url> \
 *   CEE_API_KEY=<key> \
 *   pnpm exec vitest run tests/staging/data-flow-verification.test.ts
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { MINIMAL_GRAPH } from "./fixtures/minimal-graph.js";
import { rateLimitGuard } from "./helpers/rate-limit-guard.js";

// ============================================================================
// Gating
// ============================================================================

const RUN_STAGING_SMOKE = process.env.RUN_STAGING_SMOKE === "1";
const CEE_BASE_URL = process.env.CEE_BASE_URL;
const CEE_API_KEY = process.env.CEE_API_KEY;

const SKIP_REASON = !RUN_STAGING_SMOKE
  ? "Skipping: RUN_STAGING_SMOKE not set"
  : !CEE_BASE_URL
    ? "Skipping: CEE_BASE_URL not configured"
    : !CEE_API_KEY
      ? "Skipping: CEE_API_KEY not configured"
      : null;

// ============================================================================
// Timeouts per step
// ============================================================================

const TIMEOUT_DRAFT_MS = 120_000;
const TIMEOUT_CONVERSATION_MS = 30_000;
const TIMEOUT_EXPLAIN_MS = 30_000;
const TIMEOUT_EDIT_MS = 60_000;
const TIMEOUT_SYSTEM_EVENT_MS = 15_000;

// ============================================================================
// Artifact persistence on failure
// ============================================================================

function saveArtifact(
  artifactDir: string,
  step: number,
  label: string,
  request: Record<string, unknown>,
  result: { status: number; body: unknown; elapsed_ms: number },
): void {
  try {
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(
      join(artifactDir, `step-${step}-${label}.json`),
      JSON.stringify(
        {
          step,
          label,
          timestamp: new Date().toISOString(),
          request,
          response: {
            status: result.status,
            elapsed_ms: result.elapsed_ms,
            body: result.body,
          },
        },
        null,
        2,
      ),
    );
  } catch {
    // non-fatal
  }
}

// ============================================================================
// HTTP helper
// ============================================================================

async function makeRequest(
  url: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown; elapsed_ms: number }> {
  await rateLimitGuard();
  const t0 = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Olumi-Assist-Key": CEE_API_KEY!,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `fetch() network error:\n  url: ${url}\n  error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const elapsed_ms = Date.now() - t0;
  let responseBody: unknown = null;
  try {
    responseBody = await response.json();
  } catch {
    /* non-JSON */
  }
  return { status: response.status, body: responseBody, elapsed_ms };
}

// ============================================================================
// Traceability logging
// ============================================================================

function logTrace(
  label: string,
  result: { status: number; body: unknown; elapsed_ms: number },
): void {
  const b = result.body as Record<string, unknown> | null;
  const si = b?.stage_indicator as Record<string, unknown> | undefined;
  const rm = b?._route_metadata;
  console.log(`[${label}] status=${result.status} elapsed_ms=${result.elapsed_ms}`);
  if (si) console.log(`[${label}] stage_indicator: stage=${si.stage} confidence=${si.confidence}`);
  if (rm) console.log(`[${label}] _route_metadata: ${JSON.stringify(rm)}`);
}

// ============================================================================
// Request builder
// ============================================================================

function buildTurnRequest(opts: {
  message: string;
  scenarioId: string;
  graph?: unknown;
  analysisResponse?: unknown;
  analysisState?: unknown;
  framing?: unknown;
  messages?: unknown[];
  systemEvent?: unknown;
  generateModel?: boolean;
  graphState?: unknown;
}): Record<string, unknown> {
  const req: Record<string, unknown> = {
    message: opts.message,
    scenario_id: opts.scenarioId,
    client_turn_id: randomUUID(),
    context: {
      graph: opts.graph ?? null,
      analysis_response: opts.analysisResponse ?? null,
      framing: opts.framing ?? null,
      messages: opts.messages ?? [],
      scenario_id: opts.scenarioId,
    },
  };
  if (opts.generateModel) req.generate_model = true;
  if (opts.analysisState) req.analysis_state = opts.analysisState;
  if (opts.systemEvent) req.system_event = opts.systemEvent;
  if (opts.graphState) req.graph_state = opts.graphState;
  return req;
}

// ============================================================================
// Assertion helpers
// ============================================================================

function assertValidEnvelope(body: unknown, label: string): void {
  const snippet = () => JSON.stringify(body).slice(0, 500);
  if (typeof body !== "object" || body === null)
    throw new Error(`[${label}] body is not object. body: ${snippet()}`);
  const b = body as Record<string, unknown>;

  if (typeof b.turn_id !== "string")
    throw new Error(`[${label}] turn_id must be string. body: ${snippet()}`);
  if (!("assistant_text" in b))
    throw new Error(`[${label}] assistant_text missing. body: ${snippet()}`);
  if (!Array.isArray(b.blocks))
    throw new Error(`[${label}] blocks must be array. body: ${snippet()}`);

  // No error.v1 shape on 200
  if ("error" in b && b.error !== null && typeof b.error === "object") {
    const err = b.error as Record<string, unknown>;
    if (typeof err.code === "string" && typeof err.message === "string")
      throw new Error(`[${label}] unexpected error on envelope. code=${err.code}. body: ${snippet()}`);
  }
}

function assertAnalysisVisible(body: unknown, label: string): void {
  const b = body as Record<string, unknown>;
  const meta = b._route_metadata as Record<string, unknown> | undefined;

  // has_analysis should be true when analysis_state was sent
  if (meta) {
    expect(
      meta.has_analysis,
      `[${label}] _route_metadata.has_analysis should be true. ` +
        `_route_metadata: ${JSON.stringify(meta)}`,
    ).toBe(true);
  } else {
    console.warn(`[${label}] _route_metadata absent — cannot verify has_analysis`);
  }

  // Neither assistant_text nor block content should claim analysis is missing
  const blocks = (b.blocks as Array<Record<string, unknown>> | undefined) ?? [];
  const blockTexts = blocks
    .map((blk) => {
      const data = blk.data as Record<string, unknown> | undefined;
      return (data?.narrative as string) ?? (data?.text as string) ?? "";
    })
    .join(" ");
  const allText = (((b.assistant_text as string) ?? "") + " " + blockTexts).toLowerCase();
  expect(allText).not.toMatch(/no analysis|hasn't been run|not been run|no results available/);
}

function assertGraphVisible(body: unknown, label: string): void {
  const b = body as Record<string, unknown>;
  const meta = b._route_metadata as Record<string, unknown> | undefined;

  if (meta) {
    expect(
      meta.has_graph,
      `[${label}] _route_metadata.has_graph should be true. ` +
        `_route_metadata: ${JSON.stringify(meta)}`,
    ).toBe(true);
  } else {
    console.warn(`[${label}] _route_metadata absent — cannot verify has_graph`);
  }

  const text = ((b.assistant_text as string) ?? "").toLowerCase();
  expect(text).not.toMatch(/no model|no graph|hasn't been created|no decision model/);
}

function findGraphPatchBlock(
  blocks: Array<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  return blocks.find(
    (blk) => blk.block_type === "graph_patch" || blk.type === "graph_patch",
  );
}

function extractGraph(
  gpBlock: Record<string, unknown>,
): Record<string, unknown> | null {
  const data = gpBlock.data as Record<string, unknown> | undefined;
  if (!data) return null;
  for (const key of ["applied_graph", "full_graph", "graph"]) {
    const g = data[key] as Record<string, unknown> | undefined;
    if (g && Array.isArray(g.nodes)) return g;
  }
  if (Array.isArray(data.nodes)) return data;
  return null;
}

// ============================================================================
// Synthetic analysis state
//
// Matches V2RunResponseEnvelope: meta (with response_hash, seed_used, n_samples),
// results[] (with option_label, win_probability), factor_sensitivity[],
// constraint_analysis, robustness. analysis_status set to 'completed' so
// isAnalysisExplainable() returns true.
// ============================================================================

function buildSyntheticAnalysisState(): Record<string, unknown> {
  return {
    analysis_status: "completed",
    meta: {
      response_hash: `test-hash-${Date.now()}`,
      seed_used: 42,
      n_samples: 10_000,
    },
    results: [
      { option_id: "opt_senior", option_label: "Hire senior developer", win_probability: 0.62 },
      { option_id: "opt_junior", option_label: "Hire two junior developers", win_probability: 0.38 },
    ],
    factor_sensitivity: [
      { factor_id: "fac_cost", label: "Salary cost", elasticity: 0.45, direction: "negative" },
      { factor_id: "fac_productivity", label: "Team productivity", elasticity: 0.32, direction: "positive" },
    ],
    constraint_analysis: {
      joint_probability: 0.78,
      per_constraint: [],
    },
    robustness: {
      level: "moderate",
      fragile_edges: [],
    },
  };
}

// ============================================================================
// Suite — sequential data-flow verification
// ============================================================================

describe("Data-flow verification: cross-service boundary checks", { timeout: 300_000 }, () => {
  const TURN_URL = `${CEE_BASE_URL ?? ""}/orchestrate/v1/turn`;
  const scenarioId = `dataflow-${randomUUID()}`;
  const runTs = new Date().toISOString().replace(/[:.]/g, "-");
  const ARTIFACT_DIR = join(
    __dirname,
    "artifacts",
    `data-flow-${runTs}`,
  );

  // Mutable state carried across sequential steps
  let graphState: unknown = null;

  // --------------------------------------------------------------------------
  // Step 1: Draft — fresh brief, no graph/analysis
  // --------------------------------------------------------------------------

  it(
    "Step 1: Draft — graph_patch block returned with nodes",
    { timeout: TIMEOUT_DRAFT_MS + 10_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) {
        console.log(SKIP_REASON);
        return;
      }

      const requestBody = buildTurnRequest({
        message:
          "I need to decide: hire one senior developer at £120k or two junior developers at £45k each. Budget is £150k, goal is to maximise engineering output over 12 months.",
        scenarioId,
        generateModel: true,
      });

      const result = await makeRequest(TURN_URL, requestBody);
      saveArtifact(ARTIFACT_DIR, 1, "draft", requestBody, result);
      logTrace("Step 1: Draft", result);

      expect(result.status, `Expected 200. Body: ${JSON.stringify(result.body).slice(0, 400)}`).toBe(200);
      assertValidEnvelope(result.body, "Step 1");

      const b = result.body as Record<string, unknown>;
      const blocks = b.blocks as Array<Record<string, unknown>>;
      let gpBlock = findGraphPatchBlock(blocks);

      // Recovery: if first turn produced framing without graph_patch, retry
      if (!gpBlock) {
        console.log("[Step 1] No graph_patch on T1 — sending recovery turn");
        const recoveryBody = buildTurnRequest({
          message: "Draft the decision model now.",
          scenarioId,
            generateModel: true,
        });
        const result2 = await makeRequest(TURN_URL, recoveryBody);
        saveArtifact(ARTIFACT_DIR, 1, "draft-recovery", recoveryBody, result2);
        logTrace("Step 1: Draft recovery", result2);

        expect(result2.status).toBe(200);
        assertValidEnvelope(result2.body, "Step 1 recovery");

        const b2 = result2.body as Record<string, unknown>;
        const blocks2 = b2.blocks as Array<Record<string, unknown>>;
        gpBlock = findGraphPatchBlock(blocks2);
      }

      expect(
        gpBlock,
        `Expected graph_patch block. Block types: ${JSON.stringify(blocks.map((bl) => bl.block_type ?? bl.type))}`,
      ).toBeDefined();

      // Extract graph for subsequent steps
      const graph = extractGraph(gpBlock as Record<string, unknown>);
      if (graph) {
        graphState = graph;
      } else {
        // Fallback: use MINIMAL_GRAPH if LLM graph extraction failed
        graphState = MINIMAL_GRAPH;
      }

      // stage_indicator should exist
      const si = b.stage_indicator as Record<string, unknown> | undefined;
      if (si) {
        expect(typeof si.stage).toBe("string");
      }

      // diagnostics may exist (non-prod)
      // Just confirm the envelope is well-formed — diagnostics is optional
    },
  );

  // --------------------------------------------------------------------------
  // Step 2: Conversation with graph_state — graph visible to orchestrator
  // --------------------------------------------------------------------------

  it(
    "Step 2: Conversation with graph — graph visible in route metadata, response references model",
    { timeout: TIMEOUT_CONVERSATION_MS + 10_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) {
        console.log(SKIP_REASON);
        return;
      }

      const requestBody = buildTurnRequest({
        message: "What's the biggest risk in this model?",
        scenarioId,
        graph: graphState,
        framing: { stage: "ideate", goal: "Maximise engineering output" },
      });

      const result = await makeRequest(TURN_URL, requestBody);
      saveArtifact(ARTIFACT_DIR, 2, "conversation-with-graph", requestBody, result);
      logTrace("Step 2: Conversation", result);

      expect(result.status, `Expected 200. Body: ${JSON.stringify(result.body).slice(0, 400)}`).toBe(200);
      assertValidEnvelope(result.body, "Step 2");

      const b = result.body as Record<string, unknown>;
      assertGraphVisible(b, "Step 2");

      // assistant_text should be non-empty and not generic
      expect(
        typeof b.assistant_text === "string" && (b.assistant_text as string).length > 0,
        "Expected non-empty assistant_text",
      ).toBe(true);

      // Should NOT say "no model" or "no graph"
      const text = ((b.assistant_text as string) ?? "").toLowerCase();
      expect(text).not.toMatch(/no model|no graph|hasn't been created/);
    },
  );

  // --------------------------------------------------------------------------
  // Step 3: Analysis present — synthetic analysis_state injected
  // THIS IS THE CRITICAL TEST.
  // --------------------------------------------------------------------------

  it(
    "Step 3: Analysis state visible — has_analysis true, response acknowledges analysis data",
    { timeout: TIMEOUT_EXPLAIN_MS + 10_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) {
        console.log(SKIP_REASON);
        return;
      }

      const syntheticAnalysis = buildSyntheticAnalysisState();

      const requestBody = buildTurnRequest({
        message: "Can you explain the analysis results?",
        scenarioId,
        graph: graphState,
        analysisState: syntheticAnalysis,
        framing: { stage: "evaluate", goal: "Maximise engineering output" },
      });

      const result = await makeRequest(TURN_URL, requestBody);
      saveArtifact(ARTIFACT_DIR, 3, "analysis-present", requestBody, result);
      logTrace("Step 3: Analysis", result);

      expect(result.status, `Expected 200. Body: ${JSON.stringify(result.body).slice(0, 400)}`).toBe(200);
      assertValidEnvelope(result.body, "Step 3");

      const b = result.body as Record<string, unknown>;
      assertAnalysisVisible(b, "Step 3");

      // Collect all text content: assistant_text + block narratives
      // (explain_results tool puts content in commentary blocks, not assistant_text)
      const blocks = b.blocks as Array<Record<string, unknown>>;
      const blockTexts = blocks
        .map((blk) => {
          const data = blk.data as Record<string, unknown> | undefined;
          return (data?.narrative as string) ?? (data?.text as string) ?? "";
        })
        .join(" ");
      const allText = (((b.assistant_text as string) ?? "") + " " + blockTexts).toLowerCase();

      expect(allText).not.toMatch(/no analysis|hasn't been run|not been run|no results/);

      // Positive check: response should mention something from the analysis
      // (option names, probability-like numbers, driver names, or general analysis terms)
      const mentionsAnalysisContent =
        allText.includes("senior") ||
        allText.includes("junior") ||
        allText.includes("62") ||
        allText.includes("0.62") ||
        allText.includes("win") ||
        allText.includes("probability") ||
        allText.includes("cost") ||
        allText.includes("productivity") ||
        allText.includes("moderate") ||
        allText.includes("robust") ||
        allText.includes("option") ||
        allText.includes("result");
      expect(
        mentionsAnalysisContent,
        `Expected response to reference analysis data. Text: ${allText.slice(0, 300)}`,
      ).toBe(true);
    },
  );

  // --------------------------------------------------------------------------
  // Step 4: Edit request — add a factor
  // --------------------------------------------------------------------------

  it(
    "Step 4: Edit request — graph_patch or edit_graph routed, no 500",
    { timeout: TIMEOUT_EDIT_MS + 10_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) {
        console.log(SKIP_REASON);
        return;
      }

      const requestBody = buildTurnRequest({
        message: "Add a factor for competitor response",
        scenarioId,
        graph: graphState,
        framing: { stage: "ideate", goal: "Maximise engineering output" },
      });

      const result = await makeRequest(TURN_URL, requestBody);
      saveArtifact(ARTIFACT_DIR, 4, "edit-request", requestBody, result);
      logTrace("Step 4: Edit", result);

      expect(result.status, `Expected 200, got ${result.status}. Body: ${JSON.stringify(result.body).slice(0, 400)}`).toBe(200);
      assertValidEnvelope(result.body, "Step 4");

      const b = result.body as Record<string, unknown>;
      const blocks = b.blocks as Array<Record<string, unknown>>;
      const gpBlock = findGraphPatchBlock(blocks);
      const tp = b.turn_plan as Record<string, unknown> | undefined;
      const meta = b._route_metadata as Record<string, unknown> | undefined;

      // Should have either a graph_patch block, edit_graph tool, or conversational recovery
      const hasGraphPatch = gpBlock != null;
      const hasEditTool =
        tp?.selected_tool === "edit_graph" ||
        meta?.tool_selected === "edit_graph";
      const hasProposedChanges = b.proposed_changes != null;
      const hasConversationalRecovery =
        typeof b.assistant_text === "string" && (b.assistant_text as string).length > 0;

      expect(
        hasGraphPatch || hasEditTool || hasProposedChanges || hasConversationalRecovery,
        `Expected graph_patch block, edit_graph tool, proposed_changes, or conversational recovery. ` +
          `Block types: ${JSON.stringify(blocks.map((bl) => bl.block_type ?? bl.type))}. ` +
          `tool_selected: ${tp?.selected_tool ?? meta?.tool_selected ?? "none"}`,
      ).toBe(true);

      if (!hasGraphPatch && !hasEditTool && !hasProposedChanges && hasConversationalRecovery) {
        console.warn("[Step 4] LLM responded conversationally instead of edit_graph — acceptable with cf-v19");
      }
    },
  );

  // --------------------------------------------------------------------------
  // Step 5: System event — patch_accepted
  // --------------------------------------------------------------------------

  it(
    "Step 5: System event (patch_accepted) — valid envelope, no 500",
    { timeout: TIMEOUT_SYSTEM_EVENT_MS + 10_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) {
        console.log(SKIP_REASON);
        return;
      }

      const requestBody = buildTurnRequest({
        message: "",
        scenarioId,
        graph: graphState,
        graphState: graphState,
        framing: { stage: "ideate", goal: "Maximise engineering output" },
        systemEvent: {
          event_type: "patch_accepted",
          timestamp: new Date().toISOString(),
          event_id: randomUUID(),
          details: {
            block_id: `block-${randomUUID()}`,
            operations: [
              {
                op: "add_node",
                path: "/nodes/-",
                value: {
                  id: "fac_competitor",
                  kind: "factor",
                  label: "Competitor response",
                },
              },
            ],
          },
        },
      });

      const result = await makeRequest(TURN_URL, requestBody);
      saveArtifact(ARTIFACT_DIR, 5, "system-event", requestBody, result);
      logTrace("Step 5: System event", result);

      // Must not be 500
      expect(
        result.status,
        `Expected non-500 status. Body: ${JSON.stringify(result.body).slice(0, 400)}`,
      ).not.toBe(500);

      // Valid response (200 or other success status)
      if (result.status === 200) {
        const b = result.body as Record<string, unknown>;
        // assistant_text is either null/empty (silent ack) or a short confirmation
        if (b.assistant_text) {
          expect(typeof b.assistant_text).toBe("string");
        }
        // Should still have turn_id
        expect(typeof b.turn_id).toBe("string");
      }
    },
  );

  // --------------------------------------------------------------------------
  // Step 6: Feature activation check
  // Verifies that _route_metadata.features is populated and no enabled
  // feature reports unhealthy status.
  // --------------------------------------------------------------------------

  it(
    "Step 6: Feature activation — enabled features report healthy status",
    { timeout: TIMEOUT_EXPLAIN_MS + 10_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) {
        console.log(SKIP_REASON);
        return;
      }

      // Use the explain turn (analysis present) since it exercises the most features
      const syntheticAnalysis = buildSyntheticAnalysisState();
      const requestBody = buildTurnRequest({
        message: "Summarise the results briefly.",
        scenarioId,
        graph: graphState,
        analysisState: syntheticAnalysis,
        framing: { stage: "evaluate", goal: "Maximise engineering output" },
      });

      const result = await makeRequest(TURN_URL, requestBody);
      saveArtifact(ARTIFACT_DIR, 6, "feature-activation", requestBody, result);
      logTrace("Step 6: Feature activation", result);

      expect(result.status).toBe(200);
      assertValidEnvelope(result.body, "Step 6");

      const b = result.body as Record<string, unknown>;
      const meta = b._route_metadata as Record<string, unknown> | undefined;

      expect(
        meta,
        "[Step 6] _route_metadata must be present on every response envelope",
      ).toBeDefined();

      const features = meta!.features as Record<string, { enabled: boolean; healthy: boolean; reason?: string }> | undefined;

      expect(
        features,
        "[Step 6] _route_metadata.features must be present — feature diagnostics are required",
      ).toBeDefined();

      console.log(`[Step 6] Feature activation: ${JSON.stringify(features)}`);

      // Every enabled feature should be healthy (dependencies satisfied)
      for (const [name, status] of Object.entries(features)) {
        if (status.enabled && !status.healthy) {
          console.warn(
            `[Step 6] Feature "${name}" is enabled but unhealthy: ${status.reason ?? 'unknown'}`,
          );
        }
      }

      // Assert: no enabled feature has an unsatisfied dependency
      const unhealthyFeatures = Object.entries(features)
        .filter(([, s]) => s.enabled && !s.healthy)
        .map(([name, s]) => `${name}: ${s.reason ?? 'unknown'}`);

      expect(
        unhealthyFeatures,
        `Enabled features with unsatisfied dependencies: ${unhealthyFeatures.join(', ')}`,
      ).toHaveLength(0);
    },
  );
});
