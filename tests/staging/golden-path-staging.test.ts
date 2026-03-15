/**
 * Staging Golden-Path Integration Tests
 *
 * Sequential user journey through the full cross-service stack:
 *   PLoT → CEE → ISL (for analysis)
 *
 * Steps:
 *   1. Draft — hiring brief via generate_model:true → CEE draft_graph → graph_patch (operations format)
 *          Recovery: if first response has no graph_patch, send second turn with explicit draft prompt.
 *   2. Edit — update factor value → CEE edit_graph → proposed_changes (expected path)
 *          Confirm via affirmative follow-up turn ("Yes, apply it") with messages history
 *          containing the proposal → applied_changes or updated graph.
 *          Fallback: applied_changes auto-apply path (logged, not silently accepted).
 *   3. Analyse — MINIMAL_GRAPH fixture + hardcoded analysis_inputs → ISL → computed results.
 *          Always uses the fixture (not draftGraph) because the LLM-generated graph produces
 *          node IDs that won't match the hardcoded ANALYSIS_INPUTS intervention keys.
 *   4. Explain — "who is winning?" → CEE explain_results → grounded answer
 *
 * Gating:
 *   - RUN_STAGING_SMOKE=1   (explicit opt-in)
 *   - PLOT_BASE_URL         (staging PLoT URL, e.g. https://plot-lite-service-staging.onrender.com)
 *   - CEE_API_KEY           (X-Olumi-Assist-Key header — passed through by PLoT)
 *
 * Run with:
 *   RUN_STAGING_SMOKE=1 \
 *   PLOT_BASE_URL=https://plot-lite-service-staging.onrender.com \
 *   CEE_API_KEY=<key> \
 *   pnpm test:staging
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { MINIMAL_GRAPH } from "./fixtures/minimal-graph.js";

// ============================================================================
// Gating
// ============================================================================

const RUN_STAGING_SMOKE = process.env.RUN_STAGING_SMOKE === "1";
const PLOT_BASE_URL = process.env.PLOT_BASE_URL;
const CEE_API_KEY = process.env.CEE_API_KEY;

const SKIP_REASON = !RUN_STAGING_SMOKE
  ? "Skipping: RUN_STAGING_SMOKE not set"
  : !PLOT_BASE_URL
    ? "Skipping: PLOT_BASE_URL not configured"
    : !CEE_API_KEY
      ? "Skipping: CEE_API_KEY not configured"
      : null;

// ============================================================================
// SLA time budgets (from brief) — enforced per-call, not combined
// ============================================================================

const SLA_DRAFT_MS  = 120_000;  // per draft call (applies to both first and recovery turn)
const SLA_EDIT_MS   =  30_000;  // per edit call (proposal turn OR confirm turn, each independently)
const SLA_ANALYSE_MS = 140_000; // < 140s (ISL timeout is 130s)
const SLA_EXPLAIN_MS =  30_000; // < 30s

// ============================================================================
// Diagnostics persistence
// ============================================================================

const DIAG_DIR = join(__dirname, "..", "..", "test-diagnostics", "golden-path");

/**
 * Persist request/response diagnostics to disk.
 * Called on every step (success and failure) for full traceability.
 */
function saveDiagnostics(
  step: string,
  request: Record<string, unknown>,
  result: { status: number; body: unknown; elapsed_ms: number },
): void {
  try {
    mkdirSync(DIAG_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const b = result.body as Record<string, unknown> | null;
    const payload = {
      step,
      timestamp: new Date().toISOString(),
      request,
      response: {
        status: result.status,
        elapsed_ms: result.elapsed_ms,
        body: result.body,
      },
      _route_metadata: b?._route_metadata ?? null,
      stage_indicator: b?.stage_indicator ?? null,
    };
    writeFileSync(
      join(DIAG_DIR, `${step}-${ts}.json`),
      JSON.stringify(payload, null, 2),
    );
  } catch {
    // non-fatal — best-effort diagnostics
  }
}

/**
 * Log _route_metadata and stage_indicator to console for every step.
 */
function logTraceability(
  label: string,
  result: { status: number; body: unknown; elapsed_ms: number },
): void {
  const b = result.body as Record<string, unknown> | null;
  const si = b?.stage_indicator as Record<string, unknown> | undefined;
  const rm = b?._route_metadata;
  console.log(`[${label}] status=${result.status} elapsed_ms=${result.elapsed_ms}`);
  if (si) console.log(`[${label}] stage_indicator: stage=${si.stage} confidence=${si.confidence} source=${si.source}`);
  if (rm) console.log(`[${label}] _route_metadata: ${JSON.stringify(rm)}`);
}

// ============================================================================
// Helpers
// ============================================================================

async function makeRequest(
  url: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown; elapsed_ms: number }> {
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
      `fetch() network error — server unreachable:\n` +
      `  url: ${url}\n` +
      `  error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const elapsed_ms = Date.now() - t0;
  let responseBody: unknown = null;
  try { responseBody = await response.json(); } catch { /* non-JSON */ }
  return { status: response.status, body: responseBody, elapsed_ms };
}

/**
 * Contract-grade envelope validator for 200 responses.
 * No Zod imports — manual runtime checks only.
 */
function assertEnvelopeOk(body: unknown, label: string): void {
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
  if (!Array.isArray(b.guidance_items))
    throw new Error(`[${label}] guidance_items must be array. body: ${snippet()}`);

  if (typeof b.turn_plan !== "object" || b.turn_plan === null)
    throw new Error(`[${label}] turn_plan must be object. body: ${snippet()}`);
  const tp = b.turn_plan as Record<string, unknown>;
  if (typeof tp.routing !== "string")
    throw new Error(`[${label}] turn_plan.routing must be string. body: ${snippet()}`);

  // No error.v1 shape on 200
  if ("error" in b && b.error !== null && typeof b.error === "object") {
    const err = b.error as Record<string, unknown>;
    if (typeof err.code === "string" && typeof err.message === "string")
      throw new Error(`[${label}] unexpected error.v1 shape on 200 envelope. body: ${snippet()}`);
  }
}

function assertStageIndicator(body: unknown, expectedStages: string[], label: string): void {
  const b = body as Record<string, unknown>;
  const si = b.stage_indicator as Record<string, unknown> | undefined;
  if (!si || typeof si.stage !== "string") return; // optional — don't fail if absent
  expect(
    expectedStages.includes(si.stage),
    `[${label}] stage_indicator.stage expected one of [${expectedStages.join(",")}], got '${si.stage}'`,
  ).toBe(true);
}

function makeContext(
  scenarioId: string,
  graph: unknown = null,
  framing: unknown = null,
  analysisResponse: unknown = null,
  messages: unknown[] = [],
): Record<string, unknown> {
  return {
    graph,
    analysis_response: analysisResponse,
    framing,
    messages,
    scenario_id: scenarioId,
  };
}

/**
 * Extract node count from a graph_patch block, handling both formats:
 *   1. data.full_graph.nodes[] or data.applied_graph.nodes[] (full graph)
 *   2. data.operations[] with op === "add_node" (operations format), deduplicated by node ID
 */
function extractNodeCount(gpBlock: Record<string, unknown>): number {
  const data = gpBlock.data as Record<string, unknown> | undefined;
  if (!data) return 0;

  // Path 1: full graph nested under applied_graph, full_graph, or graph
  for (const key of ["applied_graph", "full_graph", "graph"]) {
    const g = data[key] as Record<string, unknown> | undefined;
    if (g && Array.isArray(g.nodes) && g.nodes.length > 0) {
      return g.nodes.length;
    }
  }

  // Path 2: data itself has nodes (flat graph in data)
  if (Array.isArray(data.nodes) && data.nodes.length > 0) {
    return data.nodes.length;
  }

  // Path 3: operations format — count add_node ops, deduplicated by path/value.id
  if (Array.isArray(data.operations)) {
    const ops = data.operations as Array<Record<string, unknown>>;
    const addNodeOps = ops.filter(op => op.op === "add_node" || op.op === "add");
    const nodeIds = new Set<string>();
    for (const op of addNodeOps) {
      const value = op.value as Record<string, unknown> | undefined;
      const nodeId = value?.id ?? op.path;
      if (typeof nodeId === "string") nodeIds.add(nodeId);
    }
    return nodeIds.size;
  }

  return 0;
}

/**
 * Extract the full graph from a graph_patch block (if available).
 */
function extractGraph(gpBlock: Record<string, unknown>): Record<string, unknown> | null {
  const data = gpBlock.data as Record<string, unknown> | undefined;
  if (!data) return null;

  for (const key of ["applied_graph", "full_graph", "graph"]) {
    const g = data[key] as Record<string, unknown> | undefined;
    if (g && Array.isArray(g.nodes)) return g;
  }

  if (Array.isArray(data.nodes)) return data;
  return null;
}

function findGraphPatchBlock(blocks: Array<Record<string, unknown>>): Record<string, unknown> | undefined {
  return blocks.find(blk => blk.block_type === "graph_patch" || blk.type === "graph_patch");
}

// ============================================================================
// Analysis fixture
//
// Always use MINIMAL_GRAPH for analysis (not draftGraph). Reason: the LLM
// generates unique node IDs for each draft (e.g. "node_abc123"), which won't
// match the hardcoded ANALYSIS_INPUTS.options[].interventions keys
// (fac_cost, fac_productivity) or goal_node_id (goal_main). PLoT validates
// this alignment and returns 422 → CEE surfaces as analysis_status:"blocked".
//
// MINIMAL_GRAPH has: 1 goal (goal_main), 2 options (opt_senior, opt_junior),
// 2 factors (fac_cost, fac_productivity), 1 outcome (outcome_team), 7 edges.
// All node IDs match ANALYSIS_INPUTS.
// ============================================================================

const ANALYSIS_INPUTS = {
  options: [
    { option_id: "opt_senior", label: "Hire senior developer", interventions: { fac_cost: 1, fac_productivity: 1 } },
    { option_id: "opt_junior", label: "Hire two junior developers", interventions: { fac_cost: 0.5, fac_productivity: 0.6 } },
  ],
  goal_node_id: "goal_main",
};

// ============================================================================
// Suite — sequential golden path through PLoT → CEE → ISL
// ============================================================================

describe("Golden-path staging: PLoT → CEE draft → edit → analyse → explain", { timeout: 180_000 }, () => {
  const TURN_URL = `${PLOT_BASE_URL ?? ""}/orchestrate/v1/turn`;

  const scenarioId = `golden-${randomUUID()}`;

  // Mutable state carried across turns
  let draftGraph: unknown = null;
  let draftNodeCount = 0;
  let analysisResponse: unknown = null;

  beforeAll(async () => {
    if (SKIP_REASON) return;
    // Warmup — wake staging services
    await fetch(TURN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Olumi-Assist-Key": CEE_API_KEY! },
      body: JSON.stringify({
        message: "", scenario_id: randomUUID(), client_turn_id: randomUUID(),
        context: makeContext(randomUUID()),
      }),
    }).catch(() => {});
  }, 60_000);

  // --------------------------------------------------------------------------
  // Step 1: Draft — hiring brief via generate_model:true → graph_patch
  //         Recovery: if first turn has no graph_patch, send a second explicit draft turn.
  // --------------------------------------------------------------------------

  it(
    "Step 1: POST PLoT → CEE draft_graph (generate_model) returns 200 with graph_patch, node count > 0, within 120s SLA",
    { timeout: SLA_DRAFT_MS * 2 + 20_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) { console.log(SKIP_REASON); return; }

      // Turn 1: generate_model:true — should produce graph_patch deterministically
      const requestBody = {
        message: "I need to decide: hire one senior developer at £120k or two junior developers at £45k each. Budget is £150k, goal is to maximise engineering output over 12 months.",
        scenario_id: scenarioId,
        client_turn_id: randomUUID(),
        context: makeContext(scenarioId),
        generate_model: true,
      };
      const result = await makeRequest(TURN_URL, requestBody);

      logTraceability("Step 1: Draft T1", result);
      saveDiagnostics("step1-draft-t1", requestBody, result);

      // SLA per-call
      expect(result.elapsed_ms, `Draft T1 SLA: expected < ${SLA_DRAFT_MS}ms, got ${result.elapsed_ms}ms`).toBeLessThan(SLA_DRAFT_MS);
      expect(result.status, `Expected 200. Body: ${JSON.stringify(result.body).slice(0, 400)}`).toBe(200);
      assertEnvelopeOk(result.body, "Step 1 T1");

      let b = result.body as Record<string, unknown>;
      let blocks = b.blocks as Array<Record<string, unknown>>;
      let gpBlock = findGraphPatchBlock(blocks);

      // Recovery: if first turn produced a framing response (no graph_patch),
      // send a second turn with an explicit draft prompt.
      if (!gpBlock) {
        console.log("[Step 1] No graph_patch on T1 — sending recovery T2 with generate_model:true");
        const recoveryBody = {
          message: "Draft the decision model now.",
          scenario_id: scenarioId,
          client_turn_id: randomUUID(),
          context: makeContext(scenarioId),
          generate_model: true,
        };
        const result2 = await makeRequest(TURN_URL, recoveryBody);

        logTraceability("Step 1: Draft T2 (recovery)", result2);
        saveDiagnostics("step1-draft-t2-recovery", recoveryBody, result2);

        // SLA per-call (recovery turn also gets the full draft budget)
        expect(result2.elapsed_ms, `Draft T2 SLA: expected < ${SLA_DRAFT_MS}ms, got ${result2.elapsed_ms}ms`).toBeLessThan(SLA_DRAFT_MS);
        expect(result2.status, `Expected 200 on recovery. Body: ${JSON.stringify(result2.body).slice(0, 400)}`).toBe(200);
        assertEnvelopeOk(result2.body, "Step 1 T2");

        b = result2.body as Record<string, unknown>;
        blocks = b.blocks as Array<Record<string, unknown>>;
        gpBlock = findGraphPatchBlock(blocks);
      }

      // Stage indicator: draft should produce ideate (or frame for framing response)
      assertStageIndicator(b, ["frame", "ideate"], "Step 1");

      expect(gpBlock, `Expected graph_patch block after up to 2 turns. Blocks: ${JSON.stringify(blocks.map(bl => bl.block_type ?? bl.type))}`).toBeDefined();

      // Extract node count (handles both full_graph.nodes[] and operations[] formats)
      const nodeCount = extractNodeCount(gpBlock as Record<string, unknown>);
      draftNodeCount = nodeCount;

      // Extract full graph if available (for subsequent steps)
      const graph = extractGraph(gpBlock as Record<string, unknown>);
      if (graph) draftGraph = graph;

      expect(nodeCount, `Expected node count > 0. Blocks: ${JSON.stringify(blocks.map(bl => bl.block_type ?? bl.type))}`).toBeGreaterThan(0);

      // No error envelope on draft
      expect(b.error, `No error expected on draft`).toBeUndefined();
    },
  );

  // --------------------------------------------------------------------------
  // Step 2: Edit — propose-and-confirm flow
  //
  // Expected path: proposed_changes in response → user sends affirmative
  // confirmation turn ("Yes, apply it") with messages history containing
  // the proposal → applied_changes or updated graph.
  //
  // The orchestrator detects pending_proposal by scanning context.messages
  // for the previous assistant turn's tool_calls. Without this history,
  // "Yes, apply it" would fall through to the LLM as a generic message.
  //
  // Fallback: applied_changes returned directly (auto-apply path). This is
  // logged and passes, but is NOT the intended proposal flow.
  // --------------------------------------------------------------------------

  it(
    "Step 2: POST PLoT → CEE edit_graph returns proposed_changes, then user confirms, within 30s SLA each",
    { timeout: SLA_EDIT_MS * 2 + 10_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) { console.log(SKIP_REASON); return; }

      const graphToSend = draftGraph ?? MINIMAL_GRAPH;
      const editMessage = "Actually the senior salary would be £100k not £120k. Update the cost factor.";

      // 2a: Send the edit request
      const editRequestBody = {
        message: editMessage,
        scenario_id: scenarioId,
        client_turn_id: randomUUID(),
        context: makeContext(scenarioId, graphToSend, { stage: "ideate", goal: "Maximise engineering output" }),
      };
      const editResult = await makeRequest(TURN_URL, editRequestBody);

      logTraceability("Step 2a: Edit propose", editResult);
      saveDiagnostics("step2a-edit-propose", editRequestBody, editResult);

      // SLA per-call: proposal turn
      expect(editResult.elapsed_ms, `Edit proposal SLA: expected < ${SLA_EDIT_MS}ms, got ${editResult.elapsed_ms}ms`).toBeLessThan(SLA_EDIT_MS);
      expect(editResult.status, `Expected 200 from edit. Body: ${JSON.stringify(editResult.body).slice(0, 400)}`).toBe(200);
      assertEnvelopeOk(editResult.body, "Step 2a");

      const eb = editResult.body as Record<string, unknown>;

      // Stage indicator: edit should be in ideate
      assertStageIndicator(eb, ["ideate", "evaluate"], "Step 2a");

      const hasProposedChanges = eb.proposed_changes != null;
      const hasAppliedChanges = "applied_changes" in eb && eb.applied_changes != null;
      const blocks = eb.blocks as Array<Record<string, unknown>>;
      const gpBlock = findGraphPatchBlock(blocks);

      if (hasProposedChanges) {
        // ── Expected path: proposed_changes → user confirms with messages history ──
        console.log("[Step 2a] Got proposed_changes (expected path) — sending affirmative confirmation turn");

        const proposedChanges = eb.proposed_changes as Record<string, unknown>;
        expect(
          Array.isArray(proposedChanges.changes),
          `Expected proposed_changes.changes to be array`,
        ).toBe(true);

        // graph_patch block should have status: 'proposed'
        if (gpBlock) {
          const gpData = (gpBlock as Record<string, unknown>).data as Record<string, unknown>;
          expect(gpData.status, `Expected graph_patch status='proposed'`).toBe("proposed");
        }

        // Build messages history so the orchestrator can detect the pending_proposal.
        // The orchestrator scans context.messages for an assistant turn with tool_calls
        // containing edit_graph + pending_proposal (see conversational-state.ts:extractPendingProposal).
        // The response envelope includes assistant_tool_calls when there's a pending proposal.
        const assistantToolCalls = eb.assistant_tool_calls as Array<Record<string, unknown>> | undefined;
        const messagesForConfirm = [
          { role: "user", content: editMessage },
          {
            role: "assistant",
            content: eb.assistant_text ?? "",
            tool_calls: assistantToolCalls ?? [],
          },
        ];

        // 2b: Send affirmative user message to confirm the proposal
        const confirmRequestBody = {
          message: "Yes, apply it.",
          scenario_id: scenarioId,
          client_turn_id: randomUUID(),
          context: makeContext(
            scenarioId,
            graphToSend,
            { stage: "ideate", goal: "Maximise engineering output" },
            null,
            messagesForConfirm,
          ),
        };
        const confirmResult = await makeRequest(TURN_URL, confirmRequestBody);

        logTraceability("Step 2b: Confirm turn", confirmResult);
        saveDiagnostics("step2b-confirm-turn", confirmRequestBody, confirmResult);

        // SLA per-call: confirm turn
        expect(confirmResult.elapsed_ms, `Confirm SLA: expected < ${SLA_EDIT_MS}ms, got ${confirmResult.elapsed_ms}ms`).toBeLessThan(SLA_EDIT_MS);
        expect(confirmResult.status, `Expected 200 from confirm. Body: ${JSON.stringify(confirmResult.body).slice(0, 400)}`).toBe(200);
        assertEnvelopeOk(confirmResult.body, "Step 2b");

        const cb = confirmResult.body as Record<string, unknown>;
        const confirmBlocks = cb.blocks as Array<Record<string, unknown>>;
        const confirmGp = findGraphPatchBlock(confirmBlocks);

        // Confirm should produce either applied_changes or an updated graph_patch
        const confirmHasApplied = "applied_changes" in cb && cb.applied_changes != null;
        const confirmHasGp = confirmGp != null;
        expect(
          confirmHasApplied || confirmHasGp,
          `Expected applied_changes or graph_patch after confirm. ` +
          `Keys: ${Object.keys(cb).join(",")}. Body: ${JSON.stringify(cb).slice(0, 400)}`,
        ).toBe(true);

        // Extract graph from confirmation if present
        if (confirmGp) {
          const confirmGraph = extractGraph(confirmGp as Record<string, unknown>);
          if (confirmGraph) draftGraph = confirmGraph;
        }

      } else if (hasAppliedChanges) {
        // ── Fallback: auto-applied (not the intended proposal flow) ──
        console.warn("[Step 2] WARNING: Got applied_changes directly (auto-apply path, not the intended proposal flow)");

        // Extract graph from response if available
        if (gpBlock) {
          const graph = extractGraph(gpBlock as Record<string, unknown>);
          if (graph) draftGraph = graph;
        }
      } else {
        // Neither path — fail explicitly so this doesn't hide regressions.
        saveDiagnostics("step2-edit-unexpected", editRequestBody, editResult);
        expect(
          gpBlock != null,
          `Expected proposed_changes (default), applied_changes, or graph_patch block. ` +
          `Keys: ${Object.keys(eb).join(",")}. Body: ${JSON.stringify(eb).slice(0, 400)}`,
        ).toBe(true);

        if (gpBlock) {
          const graph = extractGraph(gpBlock as Record<string, unknown>);
          if (graph) draftGraph = graph;
        }
      }
    },
  );

  // --------------------------------------------------------------------------
  // Step 3: Analyse — always use MINIMAL_GRAPH fixture
  //
  // Uses MINIMAL_GRAPH (not draftGraph) because the LLM-generated graph has
  // unique node IDs that won't match the hardcoded ANALYSIS_INPUTS intervention
  // keys (fac_cost, fac_productivity) or goal_node_id (goal_main). PLoT
  // validates this alignment and returns 422 on mismatch.
  //
  // MINIMAL_GRAPH has valid topology: 1 goal, 2 options, 2 factors, 1 outcome,
  // 7 edges — all node IDs align with ANALYSIS_INPUTS.
  // --------------------------------------------------------------------------

  it(
    "Step 3: POST PLoT → ISL run_analysis returns 200 with analysis data, within 140s SLA",
    { timeout: SLA_ANALYSE_MS + 10_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) { console.log(SKIP_REASON); return; }

      const requestBody = {
        message: "run the analysis",
        scenario_id: scenarioId,
        client_turn_id: randomUUID(),
        context: {
          ...makeContext(scenarioId, MINIMAL_GRAPH, { stage: "evaluate", goal: "Maximise engineering output" }),
          analysis_inputs: ANALYSIS_INPUTS,
        },
      };
      const result = await makeRequest(TURN_URL, requestBody);

      logTraceability("Step 3: Analyse", result);
      saveDiagnostics("step3-analyse", requestBody, result);

      // SLA per-call
      expect(result.elapsed_ms, `Analyse SLA: expected < ${SLA_ANALYSE_MS}ms, got ${result.elapsed_ms}ms`).toBeLessThan(SLA_ANALYSE_MS);
      expect(result.status, `Expected 200. Body: ${JSON.stringify(result.body).slice(0, 400)}`).toBe(200);
      assertEnvelopeOk(result.body, "Step 3");

      const b = result.body as Record<string, unknown>;

      // Stage indicator: analysis should be in evaluate
      assertStageIndicator(b, ["evaluate"], "Step 3");

      // turn_plan.selected_tool should be run_analysis
      const tp = b.turn_plan as Record<string, unknown>;
      expect(tp.selected_tool, `Expected selected_tool='run_analysis'. Keys: ${Object.keys(b).join(",")}`).toBe("run_analysis");

      const blocks = b.blocks as Array<Record<string, unknown>>;
      const hasFact = blocks.some(blk => blk.block_type === "fact" || blk.type === "fact");

      if ("analysis_status" in b && (b.analysis_status === "blocked" || b.analysis_status === "failed")) {
        // Analysis blocked/failed — unexpected with MINIMAL_GRAPH + aligned ANALYSIS_INPUTS.
        expect.unreachable(
          `[Step 3] analysis_status=${b.analysis_status}, status_reason=${b.status_reason}. ` +
          `Using MINIMAL_GRAPH fixture. Body: ${JSON.stringify(b).slice(0, 400)}`,
        );
      } else {
        // Success path: expect fact blocks and analysis data
        expect(hasFact, `Expected at least one fact block. Block types: ${JSON.stringify(blocks.map(bl => bl.block_type ?? bl.type))}`).toBe(true);

        // Analysis data present (V2 lineage or V1 analysis_response)
        const lineage = b.lineage as Record<string, unknown> | undefined;
        const hasV2 = typeof lineage?.response_hash === "string" && (lineage.response_hash as string).length > 0;
        const hasV1 = b.analysis_response != null;
        expect(hasV2 || hasV1, `Expected analysis response data (lineage.response_hash or analysis_response)`).toBe(true);
      }

      // Store analysis_response for Step 4 (explain)
      if (b.analysis_response) {
        analysisResponse = b.analysis_response;
      }
    },
  );

  // --------------------------------------------------------------------------
  // Step 4: Explain — "who is winning?" → grounded answer
  // --------------------------------------------------------------------------

  it(
    "Step 4: POST PLoT → CEE explain_results returns 200 with grounded answer referencing winner, within 30s SLA",
    { timeout: SLA_EXPLAIN_MS + 10_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) { console.log(SKIP_REASON); return; }

      // Use MINIMAL_GRAPH for explain too (consistent with analysis fixture)
      const graphToSend = MINIMAL_GRAPH;

      const requestBody = {
        message: "who is winning?",
        scenario_id: scenarioId,
        client_turn_id: randomUUID(),
        context: makeContext(
          scenarioId,
          graphToSend,
          { stage: "evaluate", goal: "Maximise engineering output" },
          analysisResponse,
        ),
      };
      const result = await makeRequest(TURN_URL, requestBody);

      logTraceability("Step 4: Explain", result);
      saveDiagnostics("step4-explain", requestBody, result);

      // SLA per-call
      expect(result.elapsed_ms, `Explain SLA: expected < ${SLA_EXPLAIN_MS}ms, got ${result.elapsed_ms}ms`).toBeLessThan(SLA_EXPLAIN_MS);
      expect(result.status, `Expected 200. Body: ${JSON.stringify(result.body).slice(0, 400)}`).toBe(200);
      assertEnvelopeOk(result.body, "Step 4");

      const b = result.body as Record<string, unknown>;

      // Stage indicator: explain should be in evaluate
      assertStageIndicator(b, ["evaluate", "decide"], "Step 4");

      // Must have non-empty assistant_text
      expect(
        typeof b.assistant_text === "string" && (b.assistant_text as string).length > 0,
        `Expected non-empty assistant_text`,
      ).toBe(true);

      // Answer should reference an option name (grounded in data, not generic)
      const text = (b.assistant_text as string).toLowerCase();
      const mentionsOption = text.includes("senior") || text.includes("junior") || text.includes("hire");
      expect(mentionsOption, `Expected answer to reference an option. Text: ${text.slice(0, 200)}`).toBe(true);
    },
  );
});
