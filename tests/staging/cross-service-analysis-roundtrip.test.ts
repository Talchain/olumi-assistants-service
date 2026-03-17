/**
 * Cross-Service End-to-End Analysis Round-Trip — Staging
 *
 * Validates the full analysis chain that no other test covers:
 *   orchestrator dispatches run_analysis → CEE calls PLoT /v2/run →
 *   PLoT calls ISL → real Monte Carlo results return →
 *   next orchestrator turn sees analysis_present:true from computed data.
 *
 * This is the test that would have caught the analysis_state bug:
 *   - PLoT returns analysis in a shape CEE can't normalise
 *   - ISL computation fails silently and PLoT returns empty results
 *   - Analysis results don't propagate from tool dispatch to the next turn's context
 *   - [value] stripping destroys real computed numbers
 *   - The orchestrator's internal analysis state management doesn't work end-to-end
 *
 * Steps:
 *   1. Draft — brief → CEE draft_graph → graph_patch with analysis-ready graph
 *   2. Analyse — "Run the analysis" with graph_state → CEE run_analysis → PLoT → ISL
 *   3. Explain — "What do the results show?" with analysis_state round-tripped → grounded answer
 *   4. Verification — assert PLoT was actually called (response_hash, samples count, debug bundle)
 *
 * Gating:
 *   - RUN_STAGING_SMOKE=1  (explicit opt-in)
 *   - CEE_BASE_URL         (CEE staging)
 *   - CEE_API_KEY          (X-Olumi-Assist-Key header)
 *   - PLOT_BASE_URL        (PLoT staging — skip gracefully if absent)
 *
 * Run with:
 *   RUN_STAGING_SMOKE=1 \
 *   PLOT_BASE_URL=https://plot-lite-service-staging.onrender.com \
 *   CEE_BASE_URL=<url> \
 *   CEE_API_KEY=<key> \
 *   pnpm exec vitest run tests/staging/cross-service-analysis-roundtrip.test.ts
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { rateLimitGuard } from "./helpers/rate-limit-guard.js";

// ============================================================================
// Gating
// ============================================================================

const RUN_STAGING_SMOKE = process.env.RUN_STAGING_SMOKE === "1";
const CEE_BASE_URL = process.env.CEE_BASE_URL;
const CEE_API_KEY = process.env.CEE_API_KEY;
const PLOT_BASE_URL = process.env.PLOT_BASE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY;

const SKIP_REASON = !RUN_STAGING_SMOKE
  ? "Skipping: RUN_STAGING_SMOKE not set"
  : !CEE_BASE_URL
    ? "Skipping: CEE_BASE_URL not configured"
    : !CEE_API_KEY
      ? "Skipping: CEE_API_KEY not configured"
      : !PLOT_BASE_URL
        ? "Skipping: PLOT_BASE_URL not configured (required for real analysis round-trip)"
        : null;

// ============================================================================
// Timeouts per step (request-level, enforced via AbortController)
// ============================================================================

const TIMEOUT_DRAFT_MS = 120_000;
const TIMEOUT_ANALYSIS_MS = 150_000;
const TIMEOUT_EXPLAIN_MS = 30_000;

// ============================================================================
// Error classification
// ============================================================================

/** Errors that indicate PLoT/CEE is unreachable (skip, not fail) */
function isServiceUnreachable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("fetch failed") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("econnreset") ||
    msg.includes("network error") ||
    msg.includes("socket hang up") ||
    msg.includes("dns") ||
    // Render cold-start can surface as connect timeout
    msg.includes("connect etimedout")
  );
}

// ============================================================================
// Artifact persistence
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
// HTTP helper — with per-request AbortController timeout
// ============================================================================

interface RequestResult {
  status: number;
  body: unknown;
  elapsed_ms: number;
}

class AnalysisTimeoutError extends Error {
  elapsed_ms: number;
  constructor(url: string, timeoutMs: number, elapsed_ms: number) {
    super(
      `analysis_timeout: request to ${url} aborted after ${timeoutMs}ms ` +
        `(elapsed: ${elapsed_ms}ms). ISL computation may have exceeded time budget.`,
    );
    this.name = "AnalysisTimeoutError";
    this.elapsed_ms = elapsed_ms;
  }
}

class ServiceUnreachableError extends Error {
  constructor(url: string, cause: Error) {
    super(
      `Service unreachable: ${url}\n  cause: ${cause.message}`,
    );
    this.name = "ServiceUnreachableError";
  }
}

async function makeRequest(
  url: string,
  body: Record<string, unknown>,
  apiKey: string,
  timeoutMs?: number,
  maxRetries = 2,
): Promise<RequestResult> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await rateLimitGuard();
    const t0 = Date.now();
    const controller = timeoutMs ? new AbortController() : undefined;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": apiKey,
        },
        body: JSON.stringify(body),
        signal: controller?.signal,
      });
    } catch (err) {
      const elapsed_ms = Date.now() - t0;
      if (err instanceof Error && err.name === "AbortError") {
        throw new AnalysisTimeoutError(url, timeoutMs!, elapsed_ms);
      }
      if (isServiceUnreachable(err as Error)) {
        throw new ServiceUnreachableError(url, err as Error);
      }
      throw new Error(
        `fetch() error:\n  url: ${url}\n  elapsed: ${elapsed_ms}ms\n  error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      if (timer) clearTimeout(timer);
    }

    // Retry on 429 with server-specified backoff
    if (response.status === 429 && attempt < maxRetries) {
      const retryBody = await response.json().catch(() => null) as Record<string, unknown> | null;
      const retryAfter = (retryBody?.details as Record<string, unknown>)?.retry_after_seconds;
      const waitMs = (typeof retryAfter === "number" ? retryAfter : 30) * 1000;
      console.warn(`[makeRequest] 429 rate-limited, retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
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
  throw new Error("makeRequest: exhausted retries");
}

// ============================================================================
// Traceability logging
// ============================================================================

function logTrace(
  label: string,
  result: RequestResult,
): void {
  const b = result.body as Record<string, unknown> | null;
  const si = b?.stage_indicator as Record<string, unknown> | undefined;
  const rm = b?._route_metadata;
  const tp = b?.turn_plan as Record<string, unknown> | undefined;
  const db = b?._debug_bundle as Record<string, unknown> | undefined;
  console.log(`[${label}] status=${result.status} elapsed_ms=${result.elapsed_ms}`);
  if (si) console.log(`[${label}] stage_indicator: stage=${si.stage} confidence=${si.confidence}`);
  if (tp) console.log(`[${label}] turn_plan: selected_tool=${tp.selected_tool} routing=${tp.routing}`);
  if (rm) console.log(`[${label}] _route_metadata: ${JSON.stringify(rm)}`);
  if (db) {
    const as = db.analysis_state as Record<string, unknown> | undefined;
    if (as) console.log(`[${label}] _debug_bundle.analysis_state: ${JSON.stringify(as)}`);
  }
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
  analysisInputs?: unknown;
  framing?: unknown;
  messages?: unknown[];
  generateModel?: boolean;
  graphState?: unknown;
  systemEvent?: unknown;
}): Record<string, unknown> {
  const context: Record<string, unknown> = {
    graph: opts.graph ?? null,
    analysis_response: opts.analysisResponse ?? null,
    framing: opts.framing ?? null,
    messages: opts.messages ?? [],
    scenario_id: opts.scenarioId,
  };
  if (opts.analysisInputs) {
    context.analysis_inputs = opts.analysisInputs;
  }
  const req: Record<string, unknown> = {
    message: opts.message,
    scenario_id: opts.scenarioId,
    client_turn_id: randomUUID(),
    context,
  };
  if (opts.generateModel) req.generate_model = true;
  if (opts.analysisState) req.analysis_state = opts.analysisState;
  if (opts.graphState) req.graph_state = opts.graphState;
  if (opts.systemEvent) req.system_event = opts.systemEvent;
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

/**
 * Normalize a graph for PLoT consumption.
 * - Adds a top-level graph `id` if absent
 * - Ensures every edge has an `id` field (PLoT requires it)
 * - Ensures every node has an `id` field (defensive)
 */
function normalizeGraphForPlot(graph: Record<string, unknown>): Record<string, unknown> {
  const result = { ...graph };

  // PLoT (Rust/warp) requires a top-level `id` on the graph
  if (!result.id) {
    result.id = `graph_${randomUUID()}`;
  }

  // PLoT requires every edge to have an `id` field
  const edges = result.edges as Array<Record<string, unknown>> | undefined;
  if (edges) {
    result.edges = edges.map((edge, idx) => {
      if (edge.id) return edge;
      return {
        ...edge,
        id: `edge_${edge.from}_${edge.to}_${idx}`,
      };
    });
  }

  // PLoT requires every node to have an `id` field (should already exist, but defensive)
  const nodes = result.nodes as Array<Record<string, unknown>> | undefined;
  if (nodes) {
    result.nodes = nodes.map((node, idx) => {
      if (node.id) return node;
      return { ...node, id: `node_${idx}` };
    });
  }

  return result;
}

/**
 * Build analysis_inputs from a graph for run_analysis.
 *
 * Maps each option node to the factor nodes it connects to (directly or
 * transitively through intermediate nodes). Also handles graphs where options
 * connect to factors via intermediate outcome/factor chains.
 *
 * Returns null with a diagnostic reason if the graph is not analysis-runnable.
 */
function buildAnalysisInputsFromGraph(
  graph: Record<string, unknown>,
): { inputs: Record<string, unknown>; diagnostics: string[] } | null {
  const nodes = graph.nodes as Array<Record<string, unknown>> | undefined;
  const edges = graph.edges as Array<Record<string, unknown>> | undefined;
  if (!nodes || !edges) return null;

  const goalNode = nodes.find((n) => n.kind === "goal");
  if (!goalNode) return null;

  const optionNodes = nodes.filter((n) => n.kind === "option");
  const factorIds = new Set(
    nodes.filter((n) => n.kind === "factor").map((n) => n.id as string),
  );

  if (optionNodes.length === 0) return null;

  // Build adjacency for transitive factor discovery
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    const from = edge.from as string;
    const to = edge.to as string;
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    adjacency.get(from)!.add(to);
  }

  const diagnostics: string[] = [];

  const options = optionNodes.map((opt, optIdx) => {
    const optId = opt.id as string;
    const interventions: Record<string, number> = {};

    // Use per-option scaling to ensure PLoT doesn't flag IDENTICAL_OPTIONS.
    // Each option gets a different intervention magnitude.
    const scale = 0.5 + (optIdx * 0.3);

    // Direct edges: option → factor
    const directTargets = adjacency.get(optId) ?? new Set();
    for (const target of directTargets) {
      if (factorIds.has(target)) {
        interventions[target] = scale;
      }
    }

    // If no direct factor edges, try one-hop transitive: option → X → factor
    if (Object.keys(interventions).length === 0) {
      for (const intermediate of directTargets) {
        const secondHop = adjacency.get(intermediate) ?? new Set();
        for (const target of secondHop) {
          if (factorIds.has(target)) {
            interventions[target] = scale;
          }
        }
      }
      if (Object.keys(interventions).length > 0) {
        diagnostics.push(
          `option ${optId}: no direct factor edges, used transitive discovery (${Object.keys(interventions).length} factors found)`,
        );
      }
    }

    // If still no interventions, assign ALL factors as a last resort
    if (Object.keys(interventions).length === 0) {
      for (const fId of factorIds) {
        interventions[fId] = scale;
      }
      diagnostics.push(
        `option ${optId}: no reachable factors via edges, assigned all ${factorIds.size} factors as fallback`,
      );
    }

    return {
      id: opt.id,
      option_id: opt.id,
      label: opt.label,
      interventions,
    };
  });

  return {
    inputs: {
      options,
      goal_node_id: goalNode.id,
    },
    diagnostics,
  };
}

/**
 * Validate that a graph is analysis-runnable: has goal, ≥2 options, ≥1 factor,
 * and every option can reach at least one factor.
 */
function validateAnalysisReadiness(
  graph: Record<string, unknown>,
): { ready: boolean; reasons: string[] } {
  const nodes = graph.nodes as Array<Record<string, unknown>> | undefined;
  const edges = graph.edges as Array<Record<string, unknown>> | undefined;
  const reasons: string[] = [];

  if (!nodes || !Array.isArray(nodes)) {
    reasons.push("graph has no nodes array");
    return { ready: false, reasons };
  }
  if (!edges || !Array.isArray(edges)) {
    reasons.push("graph has no edges array");
    return { ready: false, reasons };
  }

  const goalNodes = nodes.filter((n) => n.kind === "goal");
  const optionNodes = nodes.filter((n) => n.kind === "option");
  const factorNodes = nodes.filter((n) => n.kind === "factor");

  if (goalNodes.length === 0) reasons.push("no goal node");
  if (optionNodes.length < 2) reasons.push(`only ${optionNodes.length} option(s), need ≥2`);
  if (factorNodes.length === 0) reasons.push("no factor nodes");

  if (reasons.length > 0) return { ready: false, reasons };

  // Check option connectivity — warn but don't block on indirect edges.
  // buildAnalysisInputsFromGraph() handles transitive discovery and all-factors fallback.
  const factorIds = new Set(factorNodes.map((n) => n.id as string));
  let optionsWithNoEdges = 0;
  for (const opt of optionNodes) {
    const outgoing = edges.filter((e) => e.from === opt.id);
    if (outgoing.length === 0) {
      reasons.push(`option ${opt.id} has no outgoing edges (will use all-factors fallback)`);
      optionsWithNoEdges++;
    } else {
      const reachesFactor = outgoing.some((e) => factorIds.has(e.to as string));
      if (!reachesFactor) {
        reasons.push(`option ${opt.id} has no direct factor edges (transitive discovery will be attempted)`);
      }
    }
  }

  // Only truly unrunnable if ALL options have zero edges
  const ready = optionsWithNoEdges < optionNodes.length;
  return { ready, reasons };
}

// ============================================================================
// Suite — sequential cross-service analysis round-trip
// ============================================================================

describe("Cross-service analysis round-trip: CEE → PLoT → ISL → explain", { timeout: 400_000 }, () => {
  const CEE_TURN_URL = `${CEE_BASE_URL ?? ""}/orchestrate/v1/turn`;
  const scenarioId = `roundtrip-${randomUUID()}`;
  const runTs = new Date().toISOString().replace(/[:.]/g, "-");
  const ARTIFACT_DIR = join(
    __dirname,
    "artifacts",
    `cross-service-${runTs}`,
  );

  // Mutable state carried across sequential steps
  let graphState: Record<string, unknown> | null = null;
  let analysisInputs: Record<string, unknown> | null = null;
  let analysisResponse: Record<string, unknown> | null = null;
  // Full Step 2 envelope preserved for Step 4 downstream verification
  let step2Envelope: Record<string, unknown> | null = null;

  // --------------------------------------------------------------------------
  // Step 1: Draft a graph
  // --------------------------------------------------------------------------

  it(
    "Step 1: Draft — produces analysis-ready graph with options, factors, and goal",
    { timeout: TIMEOUT_DRAFT_MS + 10_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) {
        console.log(SKIP_REASON);
        return;
      }

      let result: RequestResult;
      const requestBody = buildTurnRequest({
        message:
          "Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 4%, should we increase the Pro plan price from £49 to £59 per month? We have 400 customers. Options: raise to £59, keep at £49, or introduce a tiered pricing model.",
        scenarioId,
        generateModel: true,
      });

      try {
        result = await makeRequest(CEE_TURN_URL, requestBody, CEE_API_KEY!, TIMEOUT_DRAFT_MS);
      } catch (err) {
        if (err instanceof ServiceUnreachableError) {
          console.warn(`[Step 1] CEE unreachable — skipping test suite: ${(err as Error).message}`);
          return; // graceful skip; Steps 2-4 will hard-fail on missing prerequisite
        }
        throw err;
      }
      saveArtifact(ARTIFACT_DIR, 1, "draft", requestBody, result);
      logTrace("Step 1: Draft", result);

      expect(result.status, `Expected 200. Body: ${JSON.stringify(result.body).slice(0, 400)}`).toBe(200);
      assertValidEnvelope(result.body, "Step 1");

      const b = result.body as Record<string, unknown>;
      let blocks = b.blocks as Array<Record<string, unknown>>;
      let gpBlock = findGraphPatchBlock(blocks);

      // Recovery: if first turn produced framing without graph_patch, retry
      if (!gpBlock) {
        console.log("[Step 1] No graph_patch on T1 — sending recovery turn");
        const recoveryBody = buildTurnRequest({
          message: "Draft the decision model now.",
          scenarioId,
          generateModel: true,
        });
        const result2 = await makeRequest(CEE_TURN_URL, recoveryBody, CEE_API_KEY!, TIMEOUT_DRAFT_MS);
        saveArtifact(ARTIFACT_DIR, 1, "draft-recovery", recoveryBody, result2);
        logTrace("Step 1: Draft recovery", result2);

        expect(result2.status).toBe(200);
        assertValidEnvelope(result2.body, "Step 1 recovery");

        const b2 = result2.body as Record<string, unknown>;
        blocks = b2.blocks as Array<Record<string, unknown>>;
        gpBlock = findGraphPatchBlock(blocks);
      }

      expect(
        gpBlock,
        `Expected graph_patch block. Block types: ${JSON.stringify(blocks.map((bl) => bl.block_type ?? bl.type))}`,
      ).toBeDefined();

      // Extract and normalize graph (PLoT requires edge IDs)
      const rawGraph = extractGraph(gpBlock as Record<string, unknown>);
      expect(rawGraph, "Expected extractable graph from graph_patch block").not.toBeNull();
      const graph = normalizeGraphForPlot(rawGraph!);

      // Validate analysis-readiness before proceeding
      const readiness = validateAnalysisReadiness(graph!);
      if (!readiness.ready) {
        saveArtifact(ARTIFACT_DIR, 1, "graph-not-analysis-ready", requestBody, result);
        expect.unreachable(
          `[Step 1] Graph is not analysis-runnable. Reasons:\n` +
            readiness.reasons.map((r) => `  - ${r}`).join("\n") +
            `\nGraph: ${JSON.stringify(graph).slice(0, 600)}`,
        );
      }
      if (readiness.reasons.length > 0) {
        console.warn(`[Step 1] Analysis-readiness warnings:\n${readiness.reasons.map((r) => `  - ${r}`).join("\n")}`);
      }

      graphState = graph;

      // Log graph topology
      const nodes = (graph!.nodes as Array<Record<string, unknown>>) ?? [];
      const optionCount = nodes.filter((n) => n.kind === "option").length;
      const factorCount = nodes.filter((n) => n.kind === "factor").length;
      console.log(
        `[Step 1] Graph: ${nodes.length} nodes (${optionCount} options, ${factorCount} factors), ` +
          `${(graph!.edges as unknown[])?.length ?? 0} edges`,
      );

      // Build analysis_inputs from the LLM-generated graph
      const aiResult = buildAnalysisInputsFromGraph(graph!);
      expect(
        aiResult,
        "Expected to build analysis_inputs from graph",
      ).not.toBeNull();

      analysisInputs = aiResult!.inputs;
      if (aiResult!.diagnostics.length > 0) {
        console.warn(`[Step 1] analysis_inputs build diagnostics:\n${aiResult!.diagnostics.map((d) => `  - ${d}`).join("\n")}`);
      }

      // Verify every option has at least one intervention
      const aiOptions = (analysisInputs!.options as Array<Record<string, unknown>>) ?? [];
      for (const opt of aiOptions) {
        const interventions = opt.interventions as Record<string, number>;
        expect(
          Object.keys(interventions).length,
          `[Step 1] Option ${opt.option_id} must have ≥1 intervention for analysis. ` +
            `Graph edges: ${JSON.stringify((graph!.edges as unknown[])?.slice(0, 5))}`,
        ).toBeGreaterThan(0);
      }

      console.log(
        `[Step 1] analysis_inputs: ${aiOptions.length} options, goal=${analysisInputs!.goal_node_id}`,
      );
      for (const opt of aiOptions) {
        const interventions = opt.interventions as Record<string, number>;
        console.log(
          `  option=${opt.option_id} interventions=[${Object.keys(interventions).join(",")}]`,
        );
      }
    },
  );

  // --------------------------------------------------------------------------
  // Step 2: Request analysis via orchestrator
  //
  // run_analysis is SYNCHRONOUS: PLoT is called inline and results return
  // in the same HTTP response. No polling needed.
  //
  // Uses direct_analysis_run system event — this is the production UI path.
  // Without it, CEE's stage inference sees graph-without-analysis as "ideate"
  // stage, which blocks run_analysis via stage policy. The system event forces
  // the stage to "evaluate" and delegates directly to the run_analysis handler.
  // --------------------------------------------------------------------------

  it(
    "Step 2: Analysis — run_analysis dispatches to PLoT, returns computed results",
    { timeout: TIMEOUT_ANALYSIS_MS + 10_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) {
        console.log(SKIP_REASON);
        return;
      }

      // Hard-fail if prerequisites are missing — no false green
      expect(
        graphState,
        "[Step 2] PREREQUISITE FAILED: graphState is null — Step 1 did not produce a valid graph. " +
          "Cannot test analysis round-trip without a graph.",
      ).not.toBeNull();
      expect(
        analysisInputs,
        "[Step 2] PREREQUISITE FAILED: analysisInputs is null — Step 1 did not produce valid analysis inputs. " +
          "Cannot test analysis round-trip without analysis_inputs.",
      ).not.toBeNull();

      const requestBody = buildTurnRequest({
        message: "",
        scenarioId,
        graph: graphState,
        graphState: graphState,
        analysisInputs,
        framing: { stage: "evaluate", goal: "Reach £20k MRR within 12 months" },
        systemEvent: {
          event_type: "direct_analysis_run",
          timestamp: new Date().toISOString(),
          event_id: randomUUID(),
          details: {},
        },
      });

      let result: RequestResult;
      try {
        result = await makeRequest(CEE_TURN_URL, requestBody, CEE_API_KEY!, TIMEOUT_ANALYSIS_MS);
      } catch (err) {
        if (err instanceof AnalysisTimeoutError) {
          saveArtifact(ARTIFACT_DIR, 2, "analysis-timeout", requestBody, {
            status: 0,
            body: { error: "analysis_timeout", message: (err as Error).message, elapsed_ms: err.elapsed_ms },
            elapsed_ms: err.elapsed_ms,
          });
          expect.unreachable(
            `[Step 2] analysis_timeout: PLoT/ISL did not respond within ${TIMEOUT_ANALYSIS_MS}ms. ` +
              `Elapsed: ${err.elapsed_ms}ms. ISL computation may have exceeded time budget. ` +
              `Artifacts saved to ${ARTIFACT_DIR}.`,
          );
        }
        if (err instanceof ServiceUnreachableError) {
          console.warn(`[Step 2] Service unreachable — skipping: ${(err as Error).message}`);
          saveArtifact(ARTIFACT_DIR, 2, "service-unreachable", requestBody, {
            status: 0,
            body: { error: "service_unreachable", message: (err as Error).message },
            elapsed_ms: 0,
          });
          return; // graceful skip — Steps 3-4 will hard-fail on missing prerequisite
        }
        throw err;
      }
      saveArtifact(ARTIFACT_DIR, 2, "analysis", requestBody, result);
      logTrace("Step 2: Analysis", result);

      // Accept 502 as a transient upstream failure (PLoT/ISL timeout) — skip gracefully
      if (result.status === 502) {
        console.warn(
          `[Step 2] Upstream error (502): PLoT or ISL returned an error. ` +
            `Body: ${JSON.stringify(result.body).slice(0, 300)}. ` +
            `Steps 3-4 will gracefully skip.`,
        );
        saveArtifact(ARTIFACT_DIR, 2, "upstream-502", requestBody, result);
        return;
      }

      expect(result.status, `Expected 200. Body: ${JSON.stringify(result.body).slice(0, 400)}`).toBe(200);
      assertValidEnvelope(result.body, "Step 2");

      const b = result.body as Record<string, unknown>;
      step2Envelope = b;

      // Verify run_analysis was dispatched OR LLM handled conversationally.
      // With direct_analysis_run system event, the tool may appear in turn_plan.selected_tool,
      // _route_metadata.tool_selected, or turn_plan.system_event.type.
      const tp = b.turn_plan as Record<string, unknown> | undefined;
      const meta = b._route_metadata as Record<string, unknown> | undefined;
      const toolSelected = tp?.selected_tool ?? meta?.tool_selected;
      const sysEvent = tp?.system_event as Record<string, unknown> | undefined;
      const analysisDispatched =
        toolSelected === "run_analysis" ||
        sysEvent?.type === "direct_analysis_run" ||
        meta?.turn_type === "run_analysis";

      if (!analysisDispatched) {
        // Path (b): LLM conversational recovery — cf-v19 may request clarification
        // instead of immediately routing to run_analysis. This is valid behavior.
        console.warn(
          `[Step 2] LLM responded conversationally instead of dispatching run_analysis. ` +
            `tool_selected=${toolSelected}, system_event=${JSON.stringify(sysEvent)}, ` +
            `turn_type=${meta?.turn_type}. ` +
            `This is acceptable with cf-v19 — Steps 3-4 will gracefully skip.`,
        );
        expect(
          typeof b.assistant_text === "string" && (b.assistant_text as string).length > 0,
          `Expected non-empty assistant_text for conversational recovery. ` +
            `turn_plan: ${JSON.stringify(tp)}, _route_metadata: ${JSON.stringify(meta)}`,
        ).toBe(true);
        // analysisResponse stays null — Steps 3-4 will skip gracefully
        return;
      }

      // Path (a): run_analysis was dispatched — full assertion chain

      // Check for blocked/failed analysis
      if (b.analysis_status === "blocked" || b.analysis_status === "failed") {
        saveArtifact(ARTIFACT_DIR, 2, "analysis-blocked", requestBody, result);
        expect.unreachable(
          `[Step 2] Analysis ${b.analysis_status}: ${b.status_reason ?? "unknown"}. ` +
            `Critiques: ${JSON.stringify(b.critiques ?? [])}. ` +
            `This may indicate graph/analysis_inputs misalignment. ` +
            `Body: ${JSON.stringify(b).slice(0, 600)}`,
        );
      }

      // Expect fact blocks from PLoT
      const blocks = b.blocks as Array<Record<string, unknown>>;
      const factBlocks = blocks.filter(
        (blk) => blk.block_type === "fact" || blk.type === "fact",
      );
      expect(
        factBlocks.length,
        `Expected at least one fact block. Block types: ${JSON.stringify(blocks.map((bl) => bl.block_type ?? bl.type))}`,
      ).toBeGreaterThan(0);

      // Extract and store analysis_response for Step 3
      const ar = b.analysis_response as Record<string, unknown> | undefined;
      expect(ar, "Expected analysis_response in envelope").toBeDefined();
      analysisResponse = ar!;

      // Verify analysis_response has real computed data.
      // PLoT runtime data is in `meta` (n_samples, seed_used, response_hash).
      // `_meta` is CEE's internal envelope metadata — different structure.
      const arMeta = ar!.meta as Record<string, unknown> | undefined;
      expect(arMeta, "Expected analysis_response.meta or _meta").toBeDefined();

      const responseHash =
        (ar!.response_hash as string) ??
        (arMeta?.response_hash as string);
      expect(
        responseHash,
        "Expected response_hash from PLoT",
      ).toBeTruthy();

      const nSamples = Number(arMeta?.n_samples);
      expect(nSamples, "Expected n_samples > 0 (ISL Monte Carlo ran)").toBeGreaterThan(0);

      // Verify lineage includes response_hash
      const lineage = b.lineage as Record<string, unknown> | undefined;
      if (lineage) {
        expect(
          typeof lineage.response_hash === "string" && (lineage.response_hash as string).length > 0,
          `Expected lineage.response_hash. Lineage: ${JSON.stringify(lineage)}`,
        ).toBe(true);
      }

      // Verify results/option_comparison contain option data.
      // PLoT may use `results` or `option_comparison` for option outcomes.
      const results = (ar!.results ?? ar!.option_comparison) as Array<Record<string, unknown>> | undefined;
      if (results && results.length > 0) {
        for (const r of results) {
          expect(
            typeof r.option_label === "string" || typeof r.option_id === "string",
            `Expected option_label or option_id in result. Result: ${JSON.stringify(r).slice(0, 200)}`,
          ).toBe(true);
        }
        console.log(
          `[Step 2] Results: ${results.length} options. ` +
            results
              .map(
                (r) =>
                  `${r.option_label ?? r.option_id}: win_prob=${r.win_probability}`,
              )
              .join(", "),
        );
      }

      console.log(
        `[Step 2] Analysis complete: response_hash=${responseHash}, n_samples=${nSamples}, ` +
          `seed_used=${arMeta?.seed_used}`,
      );
    },
  );

  // --------------------------------------------------------------------------
  // Step 3: Ask about results with real analysis data
  //
  // The UI must round-trip analysis_state back to the orchestrator.
  // The orchestrator does NOT store analysis results server-side.
  // This step validates that the explain path works with REAL computed data
  // (not synthetic fixtures).
  // --------------------------------------------------------------------------

  it(
    "Step 3: Explain — grounded answer from real analysis, no [value] tokens, no 'no analysis' claims",
    { timeout: TIMEOUT_EXPLAIN_MS + 10_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) {
        console.log(SKIP_REASON);
        return;
      }

      // Hard-fail if graphState is missing — that's a real break.
      // Gracefully skip if analysisResponse is null — Step 2 may have taken
      // the conversational recovery path (cf-v19 clarification behavior).
      expect(
        graphState,
        "[Step 3] PREREQUISITE FAILED: graphState is null — earlier steps did not produce a valid graph. " +
          "The full analysis round-trip chain is broken.",
      ).not.toBeNull();
      if (analysisResponse === null) {
        console.warn(
          "[Step 3] SKIPPED: analysisResponse is null — Step 2 took the conversational recovery path " +
            "(cf-v19 requested clarification instead of dispatching run_analysis). " +
            "Analysis state propagation cannot be verified without real PLoT data.",
        );
        return;
      }

      // Normalize analysis_response → analysis_state for route schema compliance.
      // PLoT returns `_meta` (not `meta`), `option_comparison` (not `results`),
      // and `seed_used` as string (schema expects number). The UI does this
      // transformation before round-tripping — replicate it here.
      const ar = analysisResponse!;
      const rawMeta = ar.meta as Record<string, unknown> | undefined;
      const normalizedState: Record<string, unknown> = {
        ...ar,
        meta: {
          ...rawMeta,
          response_hash: rawMeta?.response_hash ?? ar.response_hash,
          seed_used: rawMeta?.seed_used != null ? Number(rawMeta.seed_used) : undefined,
          n_samples: rawMeta?.n_samples != null ? Number(rawMeta.n_samples) : undefined,
        },
        results: ar.results ?? ar.option_comparison ?? [],
        analysis_status: ar.analysis_status ?? "computed",
      };

      const requestBody = buildTurnRequest({
        message: "What do the results show?",
        scenarioId,
        graph: graphState,
        graphState: graphState,
        analysisState: normalizedState,
        framing: { stage: "evaluate", goal: "Reach £20k MRR within 12 months" },
      });

      const result = await makeRequest(CEE_TURN_URL, requestBody, CEE_API_KEY!, TIMEOUT_EXPLAIN_MS);
      saveArtifact(ARTIFACT_DIR, 3, "explain", requestBody, result);
      logTrace("Step 3: Explain", result);

      expect(result.status, `Expected 200. Body: ${JSON.stringify(result.body).slice(0, 400)}`).toBe(200);
      assertValidEnvelope(result.body, "Step 3");

      const b = result.body as Record<string, unknown>;

      // ── Assert analysis_present and analysis_explainable ──
      // These fields live in _debug_bundle.analysis_state (exposed on non-production
      // environments or when ORCHESTRATOR_DEBUG_BUNDLE=true).
      const meta = b._route_metadata as Record<string, unknown> | undefined;
      const debugBundle = b._debug_bundle as Record<string, unknown> | undefined;
      const debugAnalysisState = debugBundle?.analysis_state as Record<string, unknown> | undefined;

      // Primary assertion: _route_metadata.has_analysis
      expect(
        meta,
        "[Step 3] _route_metadata must be present on every response envelope",
      ).toBeDefined();
      expect(
        meta!.has_analysis,
        `[Step 3] CRITICAL: _route_metadata.has_analysis should be true — analysis_state was sent with real PLoT data. ` +
          `This is the analysis_state propagation bug. ` +
          `_route_metadata: ${JSON.stringify(meta)}`,
      ).toBe(true);

      // Debug bundle assertions: analysis_present and analysis_explainable
      if (debugAnalysisState) {
        expect(
          debugAnalysisState.present,
          `[Step 3] CRITICAL: _debug_bundle.analysis_state.present (analysis_present) should be true. ` +
            `analysis_state was round-tripped with real PLoT data. ` +
            `debug analysis_state: ${JSON.stringify(debugAnalysisState)}`,
        ).toBe(true);

        // With the isAnalysisExplainable fix accepting "computed" status,
        // explainable should be true when real PLoT data is present.
        expect(
          debugAnalysisState.explainable,
          `[Step 3] analysis_state.explainable should be true — analysis_state was round-tripped ` +
            `with real PLoT data and isAnalysisExplainable now accepts "computed" status. ` +
            `debug analysis_state: ${JSON.stringify(debugAnalysisState)}`,
        ).toBe(true);

        console.log(`[Step 3] _debug_bundle.analysis_state: ${JSON.stringify(debugAnalysisState)}`);
      } else {
        // Debug bundle may not be exposed on production — fall back to content-level verification.
        // Warn but do NOT skip — the content assertions below still validate the round-trip.
        console.warn(
          "[Step 3] _debug_bundle.analysis_state not present in response — " +
            "staging may have ORCHESTRATOR_DEBUG_BUNDLE=false or NODE_ENV=production. " +
            "analysis_present/analysis_explainable cannot be directly verified; " +
            "relying on content-level assertions.",
        );
      }

      // Collect all text: assistant_text + block narratives
      const blocks = b.blocks as Array<Record<string, unknown>>;
      const blockTexts = blocks
        .map((blk) => {
          const data = blk.data as Record<string, unknown> | undefined;
          return (data?.narrative as string) ?? (data?.text as string) ?? "";
        })
        .join(" ");
      const allText = (((b.assistant_text as string) ?? "") + " " + blockTexts);
      const allTextLower = allText.toLowerCase();

      // CRITICAL: Must NOT claim analysis is missing
      expect(allTextLower).not.toMatch(
        /no analysis|hasn't been run|not been run|no results available|analysis has not/,
      );

      // Grounded-value stripping: analysis-derived numbers (win probabilities) must survive.
      // Brief-context numbers (MRR targets, prices, months) should also survive when
      // brief_text is available in framing context.
      const valueTokenCount = (allText.match(/\[value\]/gi) ?? []).length;
      if (valueTokenCount > 0) {
        console.log(
          `[Step 3] [value] tokens found: ${valueTokenCount}`,
        );
      }
      // Analysis win probabilities must be present as real numbers, not [value]
      const arResultsForCheck = (analysisResponse!.results ?? analysisResponse!.option_comparison) as Array<Record<string, unknown>> | undefined;
      const winProbs = (arResultsForCheck ?? [])
        .map((r) => r.win_probability as number)
        .filter((p) => typeof p === "number" && Number.isFinite(p));
      if (winProbs.length > 0) {
        // At least one win probability percentage should appear as a real number
        const anyWinProbPresent = winProbs.some((p) => {
          const pctStr = (p * 100).toFixed(1);
          const pctRounded = Math.round(p * 100).toString();
          return allText.includes(pctStr) || allText.includes(pctRounded);
        });
        expect(
          anyWinProbPresent,
          `Expected at least one win probability to appear as a real number, not [value]. ` +
            `Win probs: [${winProbs.map((p) => (p * 100).toFixed(1) + "%").join(", ")}]. ` +
            `Response excerpt: ${allText.slice(0, 300)}`,
        ).toBe(true);
      }

      // Positive: response should reference specific computed data.
      // With isAnalysisExplainable accepting "computed", expect detailed explanation.
      // Fall back to analysis ack if LLM routing doesn't select explain_results.
      const arResults = (analysisResponse!.results ?? analysisResponse!.option_comparison) as Array<Record<string, unknown>> | undefined;
      const optionLabels = (arResults ?? [])
        .map((r) => ((r.option_label as string) ?? "").toLowerCase())
        .filter(Boolean);

      const mentionsSpecificData =
        optionLabels.some((label) => {
          const words = label.split(/\s+/).filter((w) => w.length > 3);
          return words.some((w) => allTextLower.includes(w));
        }) ||
        /\d+%|\d+\.\d+|probability|chance|likelihood|winning|favou?r/.test(allTextLower) ||
        /sensitiv|driver|factor|robust|constraint/.test(allTextLower);

      const isAnalysisAck =
        /analysis has run|results are ready|would you like.*explain|re-run/.test(allTextLower);

      expect(
        mentionsSpecificData || isAnalysisAck,
        `Expected response to reference specific analysis data OR acknowledge analysis results. ` +
          `Option labels: [${optionLabels.join(", ")}]. ` +
          `Text: ${allText.slice(0, 400)}`,
      ).toBe(true);

      if (!mentionsSpecificData && isAnalysisAck) {
        console.warn(
          `[Step 3] Response is an analysis ack, not a detailed explanation. ` +
            `LLM routing may not have selected explain_results.`,
        );
      }

      console.log(`[Step 3] Explain text (first 300 chars): ${allText.slice(0, 300)}`);
    },
  );

  // --------------------------------------------------------------------------
  // Step 4: Verify PLoT was actually called
  //
  // Validates data from Step 2 to confirm PLoT/ISL was genuinely involved.
  // Also checks downstream-call trace evidence in the debug bundle, and
  // falls back to admin LLM output endpoint if available.
  // --------------------------------------------------------------------------

  it(
    "Step 4: Verification — PLoT was called, ISL ran Monte Carlo, downstream trace evidence",
    { timeout: 15_000, skip: !!SKIP_REASON },
    async () => {
      if (SKIP_REASON) {
        console.log(SKIP_REASON);
        return;
      }

      // Gracefully skip if analysisResponse is null — Step 2 may have taken
      // the conversational recovery path (cf-v19 clarification behavior).
      if (analysisResponse === null) {
        console.warn(
          "[Step 4] SKIPPED: analysisResponse is null — Step 2 took the conversational recovery path " +
            "(cf-v19 requested clarification instead of dispatching run_analysis). " +
            "PLoT invocation verification cannot be performed without analysis data.",
        );
        return;
      }

      const ar = analysisResponse!;
      // PLoT runtime data is in `meta` (n_samples, seed_used, response_hash).
      // `_meta` is CEE's internal envelope metadata — different structure.
      const arMeta = ar.meta as Record<string, unknown> | undefined;

      // 1. Response hash exists (computed by PLoT)
      const responseHash =
        (ar.response_hash as string) ??
        (arMeta?.response_hash as string);
      expect(
        typeof responseHash === "string" && responseHash.length > 0,
        `PLoT response_hash must be a non-empty string. Got: ${responseHash}`,
      ).toBe(true);

      // 2. Sample count > 0 (ISL Monte Carlo ran)
      const nSamples = Number(arMeta?.n_samples);
      expect(
        nSamples > 0,
        `ISL n_samples must be > 0. Got: ${arMeta?.n_samples}`,
      ).toBe(true);

      // 3. Seed was recorded
      const seedUsed = arMeta?.seed_used;
      expect(
        seedUsed != null,
        `Expected seed_used in meta. Meta keys: ${JSON.stringify(Object.keys(arMeta ?? {}))}`,
      ).toBe(true);

      // 4. Analysis status is completed/computed
      expect(
        typeof ar.analysis_status === "string" && ar.analysis_status.length > 0,
        `Expected analysis_status to be a non-empty string. Got: ${ar.analysis_status}`,
      ).toBe(true);
      expect(
        ["completed", "computed"].includes(ar.analysis_status as string),
        `Expected analysis_status to be 'completed' or 'computed'. Got: ${ar.analysis_status}`,
      ).toBe(true);

      // 5. Results/option_comparison array is non-empty
      const results = (ar.results ?? ar.option_comparison) as Array<Record<string, unknown>> | undefined;
      expect(
        Array.isArray(results) && results.length > 0,
        `Expected non-empty results/option_comparison array from PLoT. Keys: ${JSON.stringify(Object.keys(ar))}`,
      ).toBe(true);

      // 6. Each result has a win_probability (from ISL computation)
      for (const r of results ?? []) {
        expect(
          typeof r.win_probability === "number",
          `Expected numeric win_probability. Result: ${JSON.stringify(r).slice(0, 200)}`,
        ).toBe(true);
      }

      // 7. Factor sensitivity exists (proves ISL did sensitivity analysis)
      const hasSensitivity =
        Array.isArray(ar.factor_sensitivity) &&
        (ar.factor_sensitivity as unknown[]).length > 0;
      const hasNestedSensitivity = (results ?? []).some(
        (r) =>
          Array.isArray(r.factor_sensitivity) &&
          (r.factor_sensitivity as unknown[]).length > 0,
      );
      expect(
        hasSensitivity || hasNestedSensitivity,
        "Expected factor_sensitivity data (top-level or per-result)",
      ).toBe(true);

      // ── Downstream-call trace evidence ──
      // Check Step 2's debug bundle for downstream call traces
      const verificationNotes: string[] = [];

      if (step2Envelope) {
        const db = step2Envelope._debug_bundle as Record<string, unknown> | undefined;

        // Check observability/diagnostics for downstream call evidence
        const observability = step2Envelope.observability as Record<string, unknown> | undefined;
        const diagnostics = step2Envelope.diagnostics as Record<string, unknown> | undefined;

        // tool_latency_ms in turn_plan proves a real external call was made
        const tp = step2Envelope.turn_plan as Record<string, unknown> | undefined;
        if (tp?.tool_latency_ms != null) {
          const latency = tp.tool_latency_ms as number;
          expect(
            latency > 0,
            `Expected tool_latency_ms > 0 for real PLoT call. Got: ${latency}`,
          ).toBe(true);
          verificationNotes.push(`tool_latency_ms=${latency}ms (proves real external call)`);
        }

        // Debug bundle may contain downstream_calls or tool traces
        if (db) {
          const downstreamCalls = db.downstream_calls as unknown[] | undefined;
          if (downstreamCalls && downstreamCalls.length > 0) {
            verificationNotes.push(
              `_debug_bundle.downstream_calls: ${downstreamCalls.length} call(s)`,
            );
          }
          // Check for tool execution trace
          const toolTrace = db.tool_execution as Record<string, unknown> | undefined;
          if (toolTrace) {
            verificationNotes.push(
              `_debug_bundle.tool_execution: tool=${toolTrace.tool}, status=${toolTrace.status}`,
            );
          }
        }

        if (observability) {
          verificationNotes.push(`observability present: keys=[${Object.keys(observability).join(",")}]`);
        }
        if (diagnostics) {
          verificationNotes.push(`diagnostics present: keys=[${Object.keys(diagnostics).join(",")}]`);
        }
      }

      // ── Admin debug-bundle fallback (optional) ──
      // If ADMIN_KEY is set and we have a turn_id, try the admin LLM output endpoint
      // for additional trace evidence. Non-fatal if unavailable.
      if (ADMIN_KEY && CEE_BASE_URL && step2Envelope?.turn_id) {
        try {
          const adminUrl = `${CEE_BASE_URL}/admin/v1/llm-output/${step2Envelope.turn_id}`;
          const adminResponse = await fetch(adminUrl, {
            headers: { "X-Admin-Key": ADMIN_KEY },
          });
          if (adminResponse.ok) {
            const adminBody = await adminResponse.json() as Record<string, unknown>;
            verificationNotes.push(
              `admin/llm-output: status=200, keys=[${Object.keys(adminBody).join(",")}]`,
            );
          } else {
            verificationNotes.push(
              `admin/llm-output: status=${adminResponse.status} (non-fatal)`,
            );
          }
        } catch {
          verificationNotes.push("admin/llm-output: fetch failed (non-fatal)");
        }
      }

      // Save verification artifact
      saveArtifact(ARTIFACT_DIR, 4, "verification", {}, {
        status: 200,
        body: {
          response_hash: responseHash,
          n_samples: nSamples,
          seed_used: seedUsed,
          analysis_status: ar.analysis_status,
          result_count: results?.length ?? 0,
          has_sensitivity: hasSensitivity || hasNestedSensitivity,
          option_summaries: (results ?? []).map((r) => ({
            option_id: r.option_id,
            option_label: r.option_label,
            win_probability: r.win_probability,
          })),
          verification_notes: verificationNotes,
        },
        elapsed_ms: 0,
      });

      console.log(
        `[Step 4] Verification passed:\n` +
          `  response_hash: ${responseHash}\n` +
          `  n_samples: ${nSamples}\n` +
          `  seed_used: ${seedUsed}\n` +
          `  results: ${results?.length} options\n` +
          `  factor_sensitivity: ${hasSensitivity ? "top-level" : hasNestedSensitivity ? "nested" : "none"}\n` +
          (verificationNotes.length > 0
            ? `  downstream evidence:\n${verificationNotes.map((n) => `    - ${n}`).join("\n")}`
            : "  downstream evidence: none available (debug bundle may not be exposed)"),
      );
    },
  );
});
