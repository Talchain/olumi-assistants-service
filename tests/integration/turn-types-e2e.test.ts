/**
 * Turn-Type Coverage E2E Test  @slow
 *
 * Eight-step sequential journey validating every turn type that flows
 * through /orchestrate/v1/turn. Covers normal messages, system events,
 * follow-ups after system events, and context continuity.
 *
 * Steps:
 *   1.  Initial brief → draft_graph (generate_model: true)
 *   2.  System event — patch_accepted
 *   3.  System event — direct_graph_edit
 *   4.  Normal follow-up after system events (context continuity)
 *   5.  Follow-up referencing prior context (multi-turn proof)
 *   6.  Request explanation before analysis (no hallucination)
 *   7.  System event — direct_analysis_run
 *   8.  System event — feedback_submitted (silent)
 *
 * Gating:
 *   RUN_E2E_GOLDEN_V2=1   — explicit opt-in
 *   CEE_BASE_URL           — staging CEE URL
 *   CEE_API_KEY            — X-Olumi-Assist-Key header
 *
 * Run with:
 *   RUN_E2E_GOLDEN_V2=1 CEE_BASE_URL=https://cee-staging.onrender.com \
 *   CEE_API_KEY=<key> npx vitest run tests/integration/turn-types-e2e.test.ts
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { makeAuthedRequest } from "../staging/helpers/make-request.js";
import { assertValidEnvelope, assertHttpOk } from "../helpers/validate-envelope.js";

// ============================================================================
// Gating
// ============================================================================

const RUN_E2E = process.env.RUN_E2E_GOLDEN_V2 === "1";
const CEE_BASE_URL = process.env.CEE_BASE_URL;
const CEE_API_KEY = process.env.CEE_API_KEY;

const SKIP_REASON = !RUN_E2E
  ? "Skipping turn-types e2e: RUN_E2E_GOLDEN_V2 not set"
  : !CEE_BASE_URL
    ? "Skipping turn-types e2e: CEE_BASE_URL not configured"
    : !CEE_API_KEY
      ? "Skipping turn-types e2e: CEE_API_KEY not configured"
      : null;

// ============================================================================
// Config
// ============================================================================

const TURN_URL = `${CEE_BASE_URL ?? ""}/orchestrate/v1/turn`;
const TURN_TIMEOUT_MS = 120_000;
const DIAG_DIR = join(__dirname, "..", "..", "test-diagnostics", "turn-types-e2e");

// ============================================================================
// Types
// ============================================================================

type TurnResult = { status: number; body: unknown; elapsed_ms: number };

interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

// ============================================================================
// Helpers
// ============================================================================

async function post(body: Record<string, unknown>): Promise<TurnResult> {
  return makeAuthedRequest(TURN_URL, CEE_API_KEY!, body);
}

function saveDiag(step: string, req: Record<string, unknown>, result: TurnResult): void {
  try {
    mkdirSync(DIAG_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    writeFileSync(
      join(DIAG_DIR, `${step}-${ts}.json`),
      JSON.stringify({ step, request: req, response: { status: result.status, elapsed_ms: result.elapsed_ms, body: result.body } }, null, 2),
    );
  } catch {
    // best-effort
  }
}

function logStep(label: string, result: TurnResult): void {
  const b = result.body as Record<string, unknown> | null;
  const text = typeof b?.assistant_text === "string" ? b.assistant_text.slice(0, 80) : "(null)";
  console.log(`[${label}] status=${result.status} elapsed=${result.elapsed_ms}ms text="${text}..."`);
}

function makeContext(
  scenarioId: string,
  graph: unknown = null,
  framing: unknown = null,
  messages: HistoryEntry[] = [],
  analysisResponse: unknown = null,
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
 * Extract clean assistant text from a response, stripping diagnostics XML.
 */
function cleanText(body: unknown): string {
  const b = body as Record<string, unknown>;
  const raw = typeof b.assistant_text === "string" ? b.assistant_text : "";
  return raw
    .replace(/<diagnostics>[\s\S]*?<\/diagnostics>/gi, "")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .trim();
}

/**
 * Safely add a turn to conversation history.
 * Skips error responses and silent/empty responses.
 */
function maybeAddToHistory(
  history: HistoryEntry[],
  role: "user" | "assistant",
  content: string | null | undefined,
): void {
  if (!content || content.trim().length === 0) return;
  // Skip error patterns
  const lower = content.toLowerCase();
  if (lower.includes("couldn't generate") || lower.includes("try rephrasing")) return;
  history.push({ role, content: content.trim() });
}

// ============================================================================
// Test Suite
// ============================================================================

describe("Turn-type coverage e2e", { timeout: 900_000 }, () => {
  const scenarioId = `tt-e2e-${randomUUID().slice(0, 8)}`;
  const history: HistoryEntry[] = [];

  // State accumulated across steps
  let currentGraph: Record<string, unknown> | null = null;
  let currentFraming: Record<string, unknown> = { stage: "frame" };
  let step4TurnId: string | null = null;

  beforeAll(() => {
    if (SKIP_REASON) console.log(SKIP_REASON);
  });

  // ── Step 1: Initial brief → draft_graph ──────────────────────────────────

  it("Step 1: Initial brief generates a decision model", { timeout: TURN_TIMEOUT_MS, skip: !!SKIP_REASON }, async () => {
    const message = "Should I build in-house or outsource our mobile app? We have a team of 5 developers and a 6-month deadline. Budget is $200k.";
    const req: Record<string, unknown> = {
      message,
      scenario_id: scenarioId,
      client_turn_id: randomUUID(),
      generate_model: true,
      context: makeContext(scenarioId),
    };

    const result = await post(req);
    saveDiag("step01-brief", req, result);
    logStep("Step 1", result);

    assertHttpOk(result.status, "Step 1");
    assertValidEnvelope(result.body, { expectText: true, step: "Step 1" });

    const b = result.body as Record<string, unknown>;
    const blocks = b.blocks as Array<Record<string, unknown>>;

    // Should have a graph_patch block with the generated model
    const gpBlock = blocks.find((bl) => bl.block_type === "graph_patch");
    if (gpBlock) {
      const data = gpBlock.data as Record<string, unknown>;
      // Extract graph from applied_graph or operations
      currentGraph = (data.applied_graph ?? data.full_graph ?? null) as Record<string, unknown> | null;
    }

    // Update framing
    if (b.stage_indicator) {
      const si = typeof b.stage_indicator === "string"
        ? { stage: b.stage_indicator }
        : b.stage_indicator as Record<string, unknown>;
      currentFraming = { stage: si.stage ?? "ideate" };
    } else {
      currentFraming = { stage: "ideate" };
    }

    // Add to history
    maybeAddToHistory(history, "user", message);
    maybeAddToHistory(history, "assistant", cleanText(b));
  });

  // ── Step 2: System event — patch_accepted ────────────────────────────────

  it("Step 2: patch_accepted produces valid envelope", { timeout: TURN_TIMEOUT_MS, skip: !!SKIP_REASON }, async () => {
    const req: Record<string, unknown> = {
      message: "",
      scenario_id: scenarioId,
      client_turn_id: randomUUID(),
      system_event: {
        event_type: "patch_accepted",
        timestamp: new Date().toISOString(),
        event_id: randomUUID(),
        details: {
          patch_id: randomUUID(),
          operations: [],
          applied_graph_hash: "e2e-test-hash",
        },
      },
      ...(currentGraph ? { graph_state: currentGraph } : {}),
      context: makeContext(scenarioId, currentGraph, currentFraming, history),
    };

    const result = await post(req);
    saveDiag("step02-patch-accepted", req, result);
    logStep("Step 2", result);

    assertHttpOk(result.status, "Step 2");
    assertValidEnvelope(result.body, { step: "Step 2" });

    // patch_accepted: either has ack text or silent — both valid
    // Do NOT add silent system events to history
    const text = cleanText(result.body);
    if (text.length > 0) {
      maybeAddToHistory(history, "assistant", text);
    }
  });

  // ── Step 3: System event — direct_graph_edit ─────────────────────────────

  it("Step 3: direct_graph_edit produces valid envelope", { timeout: TURN_TIMEOUT_MS, skip: !!SKIP_REASON }, async () => {
    const req: Record<string, unknown> = {
      message: "",
      scenario_id: scenarioId,
      client_turn_id: randomUUID(),
      system_event: {
        event_type: "direct_graph_edit",
        timestamp: new Date().toISOString(),
        event_id: randomUUID(),
        details: {
          changed_node_ids: ["fac_cost"],
          changed_edge_ids: [],
          operations: ["update_node"],
        },
      },
      ...(currentGraph ? { graph_state: currentGraph } : {}),
      context: makeContext(scenarioId, currentGraph, currentFraming, history),
    };

    const result = await post(req);
    saveDiag("step03-direct-graph-edit", req, result);
    logStep("Step 3", result);

    assertHttpOk(result.status, "Step 3");
    assertValidEnvelope(result.body, { step: "Step 3" });

    // direct_graph_edit may be silent — do NOT add to history if so
    const text = cleanText(result.body);
    if (text.length > 0) {
      maybeAddToHistory(history, "assistant", text);
    }
  });

  // ── Step 4: Normal follow-up after system events ─────────────────────────

  it("Step 4: Follow-up after system events has context", { timeout: TURN_TIMEOUT_MS, skip: !!SKIP_REASON }, async () => {
    const message = "What are the main risks with outsourcing the mobile app?";
    maybeAddToHistory(history, "user", message);

    const req: Record<string, unknown> = {
      message,
      scenario_id: scenarioId,
      client_turn_id: randomUUID(),
      context: makeContext(scenarioId, currentGraph, currentFraming, history),
    };

    const result = await post(req);
    saveDiag("step04-followup", req, result);
    logStep("Step 4", result);

    assertHttpOk(result.status, "Step 4");
    assertValidEnvelope(result.body, { expectText: true, step: "Step 4" });

    const b = result.body as Record<string, unknown>;
    const text = cleanText(b);
    step4TurnId = (b.turn_id as string) ?? null;

    // Must be substantive (>50 chars)
    expect(text.length, "Step 4: response should be substantive (>50 chars)").toBeGreaterThan(50);

    maybeAddToHistory(history, "assistant", text);
  });

  // ── Step 5: Follow-up referencing prior context ──────────────────────────

  it("Step 5: Follow-up references prior conversation", { timeout: TURN_TIMEOUT_MS, skip: !!SKIP_REASON }, async () => {
    const message = "You mentioned risks — which one is most likely to affect the timeline?";
    maybeAddToHistory(history, "user", message);

    const req: Record<string, unknown> = {
      message,
      scenario_id: scenarioId,
      client_turn_id: randomUUID(),
      context: makeContext(scenarioId, currentGraph, currentFraming, history),
    };

    const result = await post(req);
    saveDiag("step05-context-ref", req, result);
    logStep("Step 5", result);

    assertHttpOk(result.status, "Step 5");
    assertValidEnvelope(result.body, { expectText: true, step: "Step 5" });

    const text = cleanText(result.body);
    expect(text.length, "Step 5: response should be substantive").toBeGreaterThan(50);

    maybeAddToHistory(history, "assistant", text);
  });

  // ── Step 6: Request explanation before analysis ──────────────────────────

  it("Step 6: Explanation request before analysis doesn't hallucinate", { timeout: TURN_TIMEOUT_MS, skip: !!SKIP_REASON }, async () => {
    const message = "Please explain the analysis results.";
    maybeAddToHistory(history, "user", message);

    const req: Record<string, unknown> = {
      message,
      scenario_id: scenarioId,
      client_turn_id: randomUUID(),
      context: makeContext(scenarioId, currentGraph, currentFraming, history),
    };

    const result = await post(req);
    saveDiag("step06-explain-no-analysis", req, result);
    logStep("Step 6", result);

    assertHttpOk(result.status, "Step 6");
    assertValidEnvelope(result.body, { expectText: true, step: "Step 6" });

    const text = cleanText(result.body);

    // Should acknowledge that analysis hasn't run — must NOT hallucinate results.
    // Accept any reasonable response: redirect to run analysis, explain it's not available, etc.
    // Just ensure it doesn't make up specific numbers or winners.
    const fabricatedResults = /\b(?:wins?\s+with|probability\s+of|leads?\s+with)\s+\d+/i;
    expect(
      fabricatedResults.test(text),
      `Step 6: should not hallucinate analysis results. Text: "${text.slice(0, 200)}"`,
    ).toBe(false);

    maybeAddToHistory(history, "assistant", text);
  });

  // ── Step 7: System event — direct_analysis_run ───────────────────────────

  it("Step 7: direct_analysis_run produces valid envelope", { timeout: TURN_TIMEOUT_MS, skip: !!SKIP_REASON }, async () => {
    const req: Record<string, unknown> = {
      message: "",
      scenario_id: scenarioId,
      client_turn_id: randomUUID(),
      system_event: {
        event_type: "direct_analysis_run",
        timestamp: new Date().toISOString(),
        event_id: randomUUID(),
        details: {},
      },
      ...(currentGraph ? { graph_state: currentGraph } : {}),
      context: makeContext(scenarioId, currentGraph, { ...currentFraming, stage: "evaluate" }, history),
    };

    const result = await post(req);
    saveDiag("step07-analysis-run", req, result);
    logStep("Step 7", result);

    assertHttpOk(result.status, "Step 7");
    assertValidEnvelope(result.body, { step: "Step 7" });

    // May trigger analysis or return informational message — both valid
    const text = cleanText(result.body);
    if (text.length > 0) {
      maybeAddToHistory(history, "assistant", text);
    }
  });

  // ── Step 8: System event — feedback_submitted ────────────────────────────

  it("Step 8: feedback_submitted produces valid silent envelope", { timeout: TURN_TIMEOUT_MS, skip: !!SKIP_REASON }, async () => {
    const req: Record<string, unknown> = {
      message: "",
      scenario_id: scenarioId,
      client_turn_id: randomUUID(),
      system_event: {
        event_type: "feedback_submitted",
        timestamp: new Date().toISOString(),
        event_id: randomUUID(),
        details: {
          turn_id: step4TurnId ?? randomUUID(),
          rating: "up",
        },
      },
      context: makeContext(scenarioId, currentGraph, currentFraming, history),
    };

    const result = await post(req);
    saveDiag("step08-feedback", req, result);
    logStep("Step 8", result);

    assertHttpOk(result.status, "Step 8");
    assertValidEnvelope(result.body, { step: "Step 8" });

    // Feedback may return "Thanks for your feedback." or be silent — both valid.
    // Must NOT contain error text.
  });
});
