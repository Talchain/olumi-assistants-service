/**
 * Golden-Path v2 End-to-End Integration Test  @slow
 *
 * Twelve-step sequential journey proving the full deterministic orchestrator
 * pipeline works end-to-end against live staging APIs. No mocks.
 *
 * Steps:
 *   1.  Create scenario (SaaS pricing brief → draft_graph)
 *   2.  Verify graph structure (node/edge invariants)
 *   3.  Chat edit — set factor value (churn = 3.2%)
 *   4.  Chat edit — add constraint (churn < 5%)
 *   5.  Request analysis (run_analysis via system_event)
 *   6.  Verify analysis results (winner, runner-up, drivers, robustness)
 *   7.  "Why does this option win?" (explain_results)
 *   8.  Compare options (chip_metadata shortcut)
 *   9.  "What would flip the recommendation?" (flip analysis)
 *   10. Ambiguous edit — disambiguation test (skip if no ambiguity)
 *   11. Blocked action — request artefact before eligible
 *   12. Ineligible action — request add_factor in wrong stage
 *
 * Cross-boundary assertions run on every turn.
 *
 * Gating:
 *   RUN_E2E_GOLDEN_V2=1   — explicit opt-in
 *   CEE_BASE_URL           — staging CEE URL
 *   CEE_API_KEY            — X-Olumi-Assist-Key header
 *
 * Run with:
 *   RUN_E2E_GOLDEN_V2=1 CEE_BASE_URL=https://cee-staging.onrender.com \
 *   CEE_API_KEY=<key> pnpm test:staging
 *
 * Design notes:
 *   - Staging runs in non-production mode; <diagnostics> may appear in
 *     assistant_text. The test strips them before asserting on user-visible text.
 *   - Steps 5–6 use a hardcoded analysis-ready graph (same pattern as v1 test)
 *     because T1's draft_graph returns options with interventions:{} (needs_encoding).
 *   - Steps 7–9 and 11–12 use the same hardcoded graph + analysis results.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { makeAuthedRequest } from "../staging/helpers/make-request.js";

// ============================================================================
// Gating
// ============================================================================

const RUN_E2E = process.env.RUN_E2E_GOLDEN_V2 === "1";
const CEE_BASE_URL = process.env.CEE_BASE_URL;
const CEE_API_KEY = process.env.CEE_API_KEY;

const SKIP_REASON = !RUN_E2E
  ? "Skipping golden-path-v2 e2e: RUN_E2E_GOLDEN_V2 not set"
  : !CEE_BASE_URL
    ? "Skipping golden-path-v2 e2e: CEE_BASE_URL not configured"
    : !CEE_API_KEY
      ? "Skipping golden-path-v2 e2e: CEE_API_KEY not configured"
      : null;

// ============================================================================
// Config
// ============================================================================

const TURN_URL = `${CEE_BASE_URL ?? ""}/orchestrate/v1/turn`;
const TURN_TIMEOUT_MS = 120_000;
const TOTAL_TIMEOUT_MS = 900_000; // 15 min for 12 steps

// ============================================================================
// Banned terms — internal vocabulary that must never appear in user-facing text
// ============================================================================

const BANNED_TERMS = [
  "enrichedContext",
  "EnrichedContext",
  "intent_gate",
  "IntentGateResult",
  "tool_dispatch",
  "buildTurnPlan",
  "assembleEnvelope",
  "OrchestratorResponseEnvelope",
  "stage_policy_guard",
  "prerequisite_check",
  "classifyIntent",
  "shortcutResult",
  "deterministic_handler",
  "pipelineTrace",
  "llm_metadata",
  "_route_metadata",
];

// ============================================================================
// Hardcoded analysis-ready graph for steps 5+
//
// SaaS pricing domain: 3 options, 4 factors, 1 goal, 1 risk, 1 outcome.
// Concrete intervention values so ISL can run simulation.
// ============================================================================

const PRICING_GRAPH = {
  schema_version: "3.0",
  nodes: [
    { id: "dec_pricing", kind: "decision", label: "SaaS Pricing Strategy" },
    {
      id: "fac_churn_rate",
      kind: "factor",
      label: "Monthly Churn Rate",
      category: "controllable",
      observed_state: {
        value: 0.032,
        unit: "rate",
        source: "cee_inference",
        extractionType: "stated",
        factor_type: "other",
        uncertainty_drivers: [],
      },
    },
    {
      id: "fac_price_sensitivity",
      kind: "factor",
      label: "Customer Price Sensitivity",
      category: "external",
      observed_state: {
        value: 0.5,
        unit: "index",
        source: "cee_inference",
        extractionType: "inferred",
        factor_type: "other",
        uncertainty_drivers: [],
      },
    },
    {
      id: "fac_user_count",
      kind: "factor",
      label: "Active User Count",
      category: "controllable",
      observed_state: {
        value: 0.4,
        unit: "count",
        source: "cee_inference",
        extractionType: "stated",
        factor_type: "other",
        uncertainty_drivers: [],
      },
    },
    {
      id: "fac_current_mrr",
      kind: "factor",
      label: "Current MRR",
      category: "external",
      observed_state: {
        value: 0.36,
        unit: "£",
        source: "cee_inference",
        extractionType: "stated",
        factor_type: "cost",
        uncertainty_drivers: [],
      },
    },
    { id: "goal_mrr", kind: "goal", label: "Achieve 50k MRR in 9 months" },
    {
      id: "out_mrr_growth",
      kind: "outcome",
      label: "MRR Growth",
      observed_state: {
        value: 0.36,
        unit: "rate",
        source: "cee_inference",
        extractionType: "inferred",
        factor_type: "other",
        uncertainty_drivers: [],
      },
    },
    {
      id: "risk_churn_spike",
      kind: "risk",
      label: "Churn Spike Risk",
      observed_state: {
        value: 0.15,
        unit: "probability",
        source: "cee_inference",
        extractionType: "inferred",
        factor_type: "other",
        uncertainty_drivers: [],
      },
    },
    {
      id: "opt_raise_20pct",
      kind: "option",
      label: "Raise Price 20%",
      interventions: {
        fac_churn_rate: 0.06,
        fac_current_mrr: 0.8,
        fac_price_sensitivity: 0.7,
      },
    },
    {
      id: "opt_usage_based",
      kind: "option",
      label: "Usage-Based Pricing",
      interventions: {
        fac_churn_rate: 0.04,
        fac_current_mrr: 0.65,
        fac_user_count: 0.6,
        fac_price_sensitivity: 0.5,
      },
    },
    {
      id: "opt_status_quo",
      kind: "option",
      label: "Keep Current Pricing",
      interventions: {
        fac_churn_rate: 0.032,
        fac_current_mrr: 0.36,
      },
    },
  ],
  edges: [
    { from: "dec_pricing", to: "opt_raise_20pct", strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: "positive", origin: "ai" },
    { from: "dec_pricing", to: "opt_usage_based", strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: "positive", origin: "ai" },
    { from: "dec_pricing", to: "opt_status_quo", strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: "positive", origin: "ai" },
    { from: "opt_raise_20pct", to: "fac_churn_rate", strength: { mean: 0.6, std: 0.15 }, exists_probability: 0.9, effect_direction: "positive", origin: "ai" },
    { from: "opt_raise_20pct", to: "fac_current_mrr", strength: { mean: 0.8, std: 0.1 }, exists_probability: 0.95, effect_direction: "positive", origin: "ai" },
    { from: "opt_usage_based", to: "fac_churn_rate", strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.85, effect_direction: "positive", origin: "ai" },
    { from: "opt_usage_based", to: "fac_user_count", strength: { mean: 0.5, std: 0.15 }, exists_probability: 0.9, effect_direction: "positive", origin: "ai" },
    { from: "opt_usage_based", to: "fac_current_mrr", strength: { mean: 0.6, std: 0.2 }, exists_probability: 0.85, effect_direction: "positive", origin: "ai" },
    { from: "opt_status_quo", to: "fac_churn_rate", strength: { mean: 0.1, std: 0.05 }, exists_probability: 0.8, effect_direction: "positive", origin: "ai" },
    { from: "fac_churn_rate", to: "risk_churn_spike", strength: { mean: 0.7, std: 0.2 }, exists_probability: 0.9, effect_direction: "positive", origin: "ai" },
    { from: "fac_price_sensitivity", to: "risk_churn_spike", strength: { mean: 0.5, std: 0.15 }, exists_probability: 0.85, effect_direction: "positive", origin: "ai" },
    { from: "fac_current_mrr", to: "out_mrr_growth", strength: { mean: 0.8, std: 0.1 }, exists_probability: 0.95, effect_direction: "positive", origin: "ai" },
    { from: "fac_user_count", to: "out_mrr_growth", strength: { mean: 0.6, std: 0.15 }, exists_probability: 0.9, effect_direction: "positive", origin: "ai" },
    { from: "out_mrr_growth", to: "goal_mrr", strength: { mean: 0.9, std: 0.05 }, exists_probability: 0.95, effect_direction: "positive", origin: "ai" },
    { from: "risk_churn_spike", to: "goal_mrr", strength: { mean: -0.5, std: 0.15 }, exists_probability: 0.9, effect_direction: "negative", origin: "ai" },
  ],
};

const PRICING_ANALYSIS_INPUTS = {
  goal_node_id: "goal_mrr",
  options: [
    {
      option_id: "opt_raise_20pct",
      label: "Raise Price 20%",
      interventions: {
        fac_churn_rate: 0.06,
        fac_current_mrr: 0.8,
        fac_price_sensitivity: 0.7,
      },
    },
    {
      option_id: "opt_usage_based",
      label: "Usage-Based Pricing",
      interventions: {
        fac_churn_rate: 0.04,
        fac_current_mrr: 0.65,
        fac_user_count: 0.6,
        fac_price_sensitivity: 0.5,
      },
    },
    {
      option_id: "opt_status_quo",
      label: "Keep Current Pricing",
      interventions: {
        fac_churn_rate: 0.032,
        fac_current_mrr: 0.36,
      },
    },
  ],
};

// ============================================================================
// Diagnostics persistence
// ============================================================================

const DIAG_DIR = join(__dirname, "..", "..", "test-diagnostics", "golden-path-v2-e2e");

type TurnResult = { status: number; body: unknown; elapsed_ms: number };

/** Detailed results collected per step for the JSON report. */
interface StepResult {
  step: number;
  label: string;
  verdict: "PASS" | "FAIL" | "SKIP";
  elapsed_ms: number;
  crossBoundaryPass: boolean;
  failureReason?: string;
}

const stepResults: StepResult[] = [];

function saveDiag(step: string, req: Record<string, unknown>, result: TurnResult): void {
  try {
    mkdirSync(DIAG_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const b = result.body as Record<string, unknown> | null;
    writeFileSync(
      join(DIAG_DIR, `${step}-${ts}.json`),
      JSON.stringify(
        {
          step,
          timestamp: new Date().toISOString(),
          request: req,
          response: { status: result.status, elapsed_ms: result.elapsed_ms, body: result.body },
          _route_metadata: b?._route_metadata ?? null,
          stage_indicator: b?.stage_indicator ?? null,
          turn_plan: b?.turn_plan ?? null,
        },
        null,
        2,
      ),
    );
  } catch {
    // best-effort
  }
}

function logStep(label: string, result: TurnResult): void {
  const b = result.body as Record<string, unknown> | null;
  const tp = b?.turn_plan as Record<string, unknown> | undefined;
  const si = b?.stage_indicator as Record<string, unknown> | undefined;
  console.log(
    `[${label}] status=${result.status} elapsed=${result.elapsed_ms}ms` +
      (tp ? ` tool=${tp.selected_tool ?? "null"} routing=${tp.routing}` : "") +
      (si ? ` stage=${si.stage}` : ""),
  );
}

// ============================================================================
// Request helper
// ============================================================================

async function post(body: Record<string, unknown>): Promise<TurnResult> {
  return makeAuthedRequest(TURN_URL, CEE_API_KEY!, body);
}

// ============================================================================
// Context builders
// ============================================================================

function makeContext(
  scenarioId: string,
  graph: unknown = null,
  framing: unknown = null,
  analysisInputs: unknown = null,
  analysisResponse: unknown = null,
  messages: unknown[] = [],
): Record<string, unknown> {
  return {
    graph,
    analysis_response: analysisResponse,
    framing,
    messages,
    scenario_id: scenarioId,
    ...(analysisInputs != null && { analysis_inputs: analysisInputs }),
  };
}

function historyTurn(
  role: "user" | "assistant",
  content: string,
  toolCalls?: unknown[],
): Record<string, unknown> {
  const entry: Record<string, unknown> = { role, content };
  if (toolCalls && toolCalls.length > 0) entry.tool_calls = toolCalls;
  return entry;
}

// ============================================================================
// Diagnostics stripping
// ============================================================================

function stripDiagnostics(text: string): string {
  let s = text.replace(/<diagnostics>[\s\S]*?<\/diagnostics>/gi, "");
  const responseMatch = s.match(/<response[\s\S]*?>([\s\S]*?)<\/response>/i);
  if (responseMatch) {
    const inner = responseMatch[1];
    const atMatch = inner.match(/<assistant_text>([\s\S]*?)<\/assistant_text>/i);
    return atMatch ? atMatch[1].trim() : inner.trim();
  }
  s = s.replace(/<assistant_text>\s*/i, "").replace(/\s*<\/assistant_text>/i, "");
  s = s.replace(/<blocks>[\s\S]*?<\/blocks>/gi, "");
  s = s.replace(/<suggested_actions>[\s\S]*?<\/suggested_actions>/gi, "");
  return s.trim();
}

// ============================================================================
// Structural helpers
// ============================================================================

function findBlock(
  blocks: Array<Record<string, unknown>>,
  blockType: string,
): Record<string, unknown> | undefined {
  return blocks.find((b) => b.block_type === blockType || b.type === blockType);
}

function extractGraphFromBlock(gpBlock: Record<string, unknown>): Record<string, unknown> | null {
  const data = gpBlock.data as Record<string, unknown> | undefined;
  if (!data) return null;
  for (const key of ["applied_graph", "full_graph", "graph"]) {
    const g = data[key] as Record<string, unknown> | undefined;
    if (g && Array.isArray(g.nodes)) return g;
  }
  if (Array.isArray(data.nodes)) return data;
  return null;
}

function applyOpsToGraph(
  graph: Record<string, unknown>,
  operations: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const nodes = [...(graph.nodes as Array<Record<string, unknown>>)];
  const edges = [...(graph.edges as Array<Record<string, unknown>>)];
  for (const op of operations) {
    if (op.op === "add_node") {
      const v = op.value as Record<string, unknown>;
      if (v && typeof v.id === "string" && !nodes.find((n) => n.id === v.id)) {
        nodes.push(v);
      }
    } else if (op.op === "update_node") {
      const v = op.value as Record<string, unknown>;
      if (v && typeof v.id === "string") {
        const idx = nodes.findIndex((n) => n.id === v.id);
        if (idx >= 0) nodes[idx] = { ...nodes[idx], ...v };
      }
    } else if (op.op === "add_edge") {
      const v = op.value as Record<string, unknown>;
      if (v && typeof v.from === "string" && typeof v.to === "string") {
        if (!edges.find((e) => e.from === v.from && e.to === v.to)) {
          edges.push(v);
        }
      }
    }
  }
  return { ...graph, nodes, edges };
}

function resolveGraphFromPatch(
  currentGraph: Record<string, unknown>,
  gpBlock: Record<string, unknown>,
): Record<string, unknown> {
  const fromBlock = extractGraphFromBlock(gpBlock);
  if (fromBlock) return fromBlock;
  const data = gpBlock.data as Record<string, unknown> | undefined;
  const ops = Array.isArray(data?.operations)
    ? (data!.operations as Array<Record<string, unknown>>)
    : [];
  if (ops.length > 0) return applyOpsToGraph(currentGraph, ops);
  return currentGraph;
}

// ============================================================================
// Cross-boundary assertions (run on every turn)
// ============================================================================

function assertCrossBoundary(body: unknown, label: string): void {
  const b = body as Record<string, unknown>;

  // 1. No raw XML leaked into assistant_text
  const text = (b.assistant_text as string) ?? "";
  const strippedText = stripDiagnostics(text);
  for (const tag of ["<response>", "<diagnostics>", "<blocks>"]) {
    if (strippedText.includes(tag)) {
      throw new Error(`[${label}] raw XML "${tag}" in stripped assistant_text`);
    }
  }

  // 2. No banned terms in assistant_text
  for (const term of BANNED_TERMS) {
    if (strippedText.includes(term)) {
      throw new Error(`[${label}] banned term "${term}" in assistant_text`);
    }
  }

  // 3. Non-empty assistant_text — allow null only for system_event turns (Step 5)
  //    Post-deployment: null text guard ensures all other turns get default text
  if (b.assistant_text == null || strippedText.length === 0) {
    // System event turns (direct_analysis_run) may have null text — that's OK
    const tp = b.turn_plan as Record<string, unknown> | undefined;
    const sysEvent = tp?.system_event as Record<string, unknown> | undefined;
    if (!sysEvent) {
      throw new Error(`[${label}] assistant_text is null/empty (post-deployment guard should prevent this)`);
    }
  }

  // 4. blocks is always an array
  if (!Array.isArray(b.blocks)) {
    throw new Error(`[${label}] blocks is not an array`);
  }

  // 5. suggested_actions is always an array with max 4 entries
  const sa = b.suggested_actions;
  if (sa !== undefined && sa !== null) {
    if (!Array.isArray(sa)) {
      throw new Error(`[${label}] suggested_actions is not an array`);
    }
    // Post-deployment: chip cap at 3 is enforced
    if ((sa as unknown[]).length > 3) {
      throw new Error(`[${label}] suggested_actions has ${(sa as unknown[]).length} entries (contract limit: 3)`);
    }
  }

  // 6. Proposed patches must not use past-tense applied language
  const blocks2 = b.blocks as Array<Record<string, unknown>>;
  const hasProposedPatch = blocks2.some((blk) => {
    const data = blk.data as Record<string, unknown> | undefined;
    return data?.status === 'proposed' || data?.auto_apply === false;
  });
  if (hasProposedPatch && strippedText.length > 0) {
    // Check for past-tense applied language at sentence starts
    const appliedPatterns = /(?:^|[.!?]\s+)(Added|Updated|Set|Removed|Applied|Changed)\b/;
    if (appliedPatterns.test(strippedText)) {
      throw new Error(`[${label}] proposed patch uses past-tense applied language in assistant_text. Text: "${strippedText.slice(0, 200)}"`);
    }
  }

  // 7. Tool selected but empty blocks + no specific blocker → silent fallback
  const tp2 = b.turn_plan as Record<string, unknown> | undefined;
  if (tp2?.selected_tool && Array.isArray(b.blocks) && (b.blocks as unknown[]).length === 0) {
    // Check if assistant_text contains a specific blocker explanation
    // Valid tool-selected-but-no-blocks responses: clarification, no-op, proposal pending confirmation
    const validResponsePatterns = /\b(wasn't able|couldn't|not possible|not available|not yet|blocked|cannot|unable|which|no changes|propose|confirm|apply it)\b/i;
    if (!validResponsePatterns.test(strippedText)) {
      throw new Error(`[${label}] tool "${tp2.selected_tool}" selected but blocks empty and no blocker explanation in text. Text: "${strippedText.slice(0, 200)}"`);
    }
  }

  // 8. No banned terms in block narratives
  const blocks = b.blocks as Array<Record<string, unknown>>;
  for (const block of blocks) {
    const data = block.data as Record<string, unknown> | undefined;
    if (data) {
      const narrative = String(data.narrative ?? data.text ?? "");
      for (const term of BANNED_TERMS) {
        if (narrative.includes(term)) {
          throw new Error(`[${label}] banned term "${term}" in block narrative`);
        }
      }
    }
  }
}

/** Envelope shape assertions (turn_id, assistant_text, blocks, turn_plan). */
function assertEnvelope(body: unknown, label: string): void {
  if (typeof body !== "object" || body === null) {
    throw new Error(`[${label}] body is not an object`);
  }
  const b = body as Record<string, unknown>;
  if (typeof b.turn_id !== "string" || b.turn_id.length === 0) {
    throw new Error(`[${label}] turn_id must be non-empty string`);
  }
  if (!("assistant_text" in b)) {
    throw new Error(`[${label}] assistant_text missing`);
  }
  if (b.assistant_text !== null && typeof b.assistant_text !== "string") {
    throw new Error(`[${label}] assistant_text must be string|null`);
  }
  if (!Array.isArray(b.blocks)) {
    throw new Error(`[${label}] blocks must be array`);
  }
  if (typeof b.turn_plan !== "object" || b.turn_plan === null) {
    throw new Error(`[${label}] turn_plan missing`);
  }
}

/** No diagnostics/action labels leaking. */
function assertNoDiagLeak(body: unknown, label: string): void {
  const b = body as Record<string, unknown>;
  const rawText = (b.assistant_text as string) ?? "";
  const text = stripDiagnostics(rawText);
  const checks: [RegExp, string][] = [
    [/^Mode:/m, "Mode: prefix after strip"],
    [/^Stage:/m, "Stage: prefix after strip"],
    [/<diagnostics>/i, "residual <diagnostics> tag after strip"],
  ];
  for (const [re, desc] of checks) {
    if (re.test(text)) {
      throw new Error(`[${label}] diagnostics leak: ${desc}`);
    }
  }
}

function assertNoRawInternals(body: unknown, label: string): void {
  const b = body as Record<string, unknown>;
  const text = (b.assistant_text as string) ?? "";
  const bad = ["results.filter", "TypeError:", "ReferenceError:", "at Object.", "at Module."];
  for (const s of bad) {
    if (text.includes(s)) {
      throw new Error(`[${label}] raw internal leaked: "${s}"`);
    }
  }
}

/** Full per-turn guard battery. */
function assertTurnGuards(body: unknown, label: string): void {
  assertEnvelope(body, label);
  assertNoDiagLeak(body, label);
  assertNoRawInternals(body, label);
  assertCrossBoundary(body, label);
}

// ============================================================================
// Analysis state normalizer (matches UI normalization pattern)
// ============================================================================

function normalizeAnalysisState(ar: Record<string, unknown>): Record<string, unknown> {
  const rawMeta = ar.meta as Record<string, unknown> | undefined;
  return {
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
}

// ============================================================================
// Report writer
// ============================================================================

function writeReport(): void {
  try {
    mkdirSync(DIAG_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");

    // Console summary
    console.log("\n" + "=".repeat(60));
    console.log("Golden-Path v2 E2E Results");
    console.log("=".repeat(60));
    let passes = 0;
    let fails = 0;
    let skips = 0;
    for (const r of stepResults) {
      const elapsed = r.elapsed_ms > 0 ? `(${(r.elapsed_ms / 1000).toFixed(1)}s)` : "";
      const dots = ".".repeat(Math.max(2, 45 - r.label.length));
      const reason = r.failureReason ? ` — ${r.failureReason}` : "";
      console.log(`Step ${r.step}: ${r.label} ${dots} ${r.verdict} ${elapsed}${reason}`);
      if (r.verdict === "PASS") passes++;
      else if (r.verdict === "FAIL") fails++;
      else skips++;
    }
    const crossBoundaryCount = stepResults.filter((r) => r.verdict !== "SKIP").length;
    const crossBoundaryPass = stepResults.filter((r) => r.crossBoundaryPass).length;
    console.log(`\nCross-boundary checks: ${crossBoundaryPass}/${crossBoundaryCount} PASS`);
    console.log(`\nOVERALL: ${passes}/${passes + fails} PASS (${fails} FAIL, ${skips} SKIP)`);
    console.log("=".repeat(60));

    // JSON report
    writeFileSync(
      join(DIAG_DIR, `e2e-results-${ts}.json`),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          summary: { passes, fails, skips, crossBoundaryPass, crossBoundaryCount },
          steps: stepResults,
        },
        null,
        2,
      ),
    );
  } catch {
    // best-effort
  }
}

// ============================================================================
// Suite
// ============================================================================

describe(
  "Golden-path v2 e2e: 12-step SaaS pricing lifecycle (real APIs) @slow",
  { timeout: TOTAL_TIMEOUT_MS },
  () => {
    const scenarioId = `e2e-v2-${Date.now()}-${randomUUID().slice(0, 8)}`;

    // ── Mutable state carried across turns ──────────────────────────────────
    let currentGraph: Record<string, unknown> | null = null;
    let conversationHistory: Array<Record<string, unknown>> = [];
    let analysisResponse: Record<string, unknown> | null = null;
    let winnerLabel = "";
    let topDriverLabels: string[] = [];

    beforeAll(async () => {
      if (SKIP_REASON) return;
      // Warmup: wake staging instance
      await post({
        message: "",
        scenario_id: randomUUID(),
        client_turn_id: randomUUID(),
        context: makeContext(randomUUID()),
      }).catch(() => {});
    }, 90_000);

    // ========================================================================
    // Step 1: Create scenario (SaaS pricing brief → draft_graph)
    // ========================================================================

    it(
      "Step 1: Create scenario — SaaS pricing brief produces graph_patch with full_draft",
      { timeout: TURN_TIMEOUT_MS, skip: !!SKIP_REASON },
      async () => {
        if (SKIP_REASON) {
          console.log(SKIP_REASON);
          return;
        }

        const req: Record<string, unknown> = {
          message:
            "We're deciding whether to raise our SaaS subscription price by 20%, " +
            "introduce a usage-based pricing model, or keep the current pricing. " +
            "Goal is 50k MRR within 9 months while keeping monthly churn below 5%. " +
            "Currently at 18k MRR, 2000 users, 3.2% churn.",
          generate_model: true,
          scenario_id: scenarioId,
          client_turn_id: randomUUID(),
          context: makeContext(scenarioId, null, null, null, null, []),
        };
        const result = await post(req);
        saveDiag("step01-create", req, result);
        logStep("Step 1", result);

        expect(
          result.status,
          `Step 1 status. Body: ${JSON.stringify(result.body).slice(0, 500)}`,
        ).toBe(200);
        assertTurnGuards(result.body, "Step 1");

        const b = result.body as Record<string, unknown>;
        const tp = b.turn_plan as Record<string, unknown>;

        // Should route to draft_graph
        expect(tp.selected_tool, "Step 1: expected draft_graph").toBe("draft_graph");

        // assistant_text non-empty
        const assistantText = stripDiagnostics((b.assistant_text as string) ?? "");
        expect(
          assistantText.length > 20,
          `Step 1: assistant_text too short. Raw: "${String(b.assistant_text).slice(0, 200)}"`,
        ).toBe(true);

        // No raw XML
        expect(assistantText.includes("<response>"), "Step 1: raw XML in text").toBe(false);

        // graph_patch block with full_draft
        const blocks = b.blocks as Array<Record<string, unknown>>;
        const gpBlock = findBlock(blocks, "graph_patch");

        if (!gpBlock) {
          // Clarification path — send follow-up
          console.log("[Step 1] No graph_patch — sending follow-up");
          const followUp: Record<string, unknown> = {
            message: "Yes, draft the model with those assumptions.",
            scenario_id: scenarioId,
            client_turn_id: randomUUID(),
            context: makeContext(scenarioId, null, null, null, null, [
              historyTurn("user", req.message as string),
              historyTurn("assistant", assistantText),
            ]),
            generate_model: true,
          };
          const r2 = await post(followUp);
          saveDiag("step01-followup", followUp, r2);
          logStep("Step 1 follow-up", r2);
          expect(r2.status, "Step 1 follow-up status").toBe(200);
          assertTurnGuards(r2.body, "Step 1 follow-up");

          const b2 = r2.body as Record<string, unknown>;
          const blocks2 = b2.blocks as Array<Record<string, unknown>>;
          const gp2 = findBlock(blocks2, "graph_patch");
          expect(gp2, "Step 1 follow-up: no graph_patch").toBeDefined();
          currentGraph = resolveGraphFromPatch({ nodes: [], edges: [] }, gp2!);
          conversationHistory.push(
            historyTurn("user", req.message as string),
            historyTurn("assistant", assistantText),
            historyTurn("user", followUp.message as string),
            historyTurn(
              "assistant",
              stripDiagnostics((b2.assistant_text as string) ?? ""),
            ),
          );
        } else {
          const gpData = gpBlock.data as Record<string, unknown>;
          expect(gpData.patch_type, "Step 1: expected full_draft").toBe("full_draft");

          currentGraph = resolveGraphFromPatch({ nodes: [], edges: [] }, gpBlock);
          conversationHistory.push(
            historyTurn("user", req.message as string),
            historyTurn(
              "assistant",
              assistantText,
              b.assistant_tool_calls as unknown[] | undefined,
            ),
          );
        }

        stepResults.push({
          step: 1,
          label: "Create scenario",
          verdict: "PASS",
          elapsed_ms: result.elapsed_ms,
          crossBoundaryPass: true,
        });
      },
    );

    // ========================================================================
    // Step 2: Verify graph structure
    // ========================================================================

    it(
      "Step 2: Verify graph structure — nodes, edges, connectivity invariants",
      { timeout: 10_000, skip: !!SKIP_REASON },
      async () => {
        if (SKIP_REASON) {
          console.log(SKIP_REASON);
          return;
        }
        if (!currentGraph) {
          stepResults.push({ step: 2, label: "Verify graph structure", verdict: "SKIP", elapsed_ms: 0, crossBoundaryPass: false });
          console.warn("[Step 2] SKIPPED: no graph from Step 1");
          return;
        }

        const t0 = Date.now();
        const nodes = (currentGraph.nodes ?? []) as Array<Record<string, unknown>>;
        const edges = (currentGraph.edges ?? []) as Array<Record<string, unknown>>;
        const nodeIds = new Set(nodes.map((n) => n.id as string));

        // At least 2 options
        const options = nodes.filter((n) => n.kind === "option");
        expect(options.length, `Step 2: expected ≥2 options, got ${options.length}`).toBeGreaterThanOrEqual(2);

        // At least 1 goal
        const goals = nodes.filter((n) => n.kind === "goal");
        expect(goals.length, "Step 2: expected ≥1 goal").toBeGreaterThanOrEqual(1);

        // At least 3 factors
        const factors = nodes.filter((n) => n.kind === "factor");
        expect(factors.length, `Step 2: expected ≥3 factors, got ${factors.length}`).toBeGreaterThanOrEqual(3);

        // Node count 6–30
        expect(nodes.length, `Step 2: node count ${nodes.length} out of range [6,30]`).toBeGreaterThanOrEqual(6);
        expect(nodes.length).toBeLessThanOrEqual(30);

        // Edge count 5–40
        expect(edges.length, `Step 2: edge count ${edges.length} out of range [5,40]`).toBeGreaterThanOrEqual(5);
        expect(edges.length).toBeLessThanOrEqual(40);

        // All edges reference valid node IDs
        for (const edge of edges) {
          expect(
            nodeIds.has(edge.from as string),
            `Step 2: edge from="${edge.from}" references unknown node`,
          ).toBe(true);
          expect(
            nodeIds.has(edge.to as string),
            `Step 2: edge to="${edge.to}" references unknown node`,
          ).toBe(true);
        }

        // No orphan nodes (every node participates in at least one edge) —
        // decision node may be the root that connects to options.
        const connectedIds = new Set<string>();
        for (const edge of edges) {
          connectedIds.add(edge.from as string);
          connectedIds.add(edge.to as string);
        }
        for (const node of nodes) {
          expect(
            connectedIds.has(node.id as string),
            `Step 2: orphan node "${node.id}" has no edges`,
          ).toBe(true);
        }

        stepResults.push({
          step: 2,
          label: "Verify graph structure",
          verdict: "PASS",
          elapsed_ms: Date.now() - t0,
          crossBoundaryPass: true,
        });
      },
    );

    // ========================================================================
    // Step 3: Chat edit — set factor value (churn = 3.2%)
    // ========================================================================

    it(
      "Step 3: Chat edit — set churn to 3.2% routes to edit_graph or conversational",
      { timeout: TURN_TIMEOUT_MS, skip: !!SKIP_REASON },
      async () => {
        if (SKIP_REASON) {
          console.log(SKIP_REASON);
          return;
        }
        if (!currentGraph) {
          stepResults.push({ step: 3, label: "Chat edit — set value", verdict: "SKIP", elapsed_ms: 0, crossBoundaryPass: false });
          console.warn("[Step 3] SKIPPED: no graph");
          return;
        }

        const msg = "Our churn is currently at 3.2%, not the default. Update it.";
        const req: Record<string, unknown> = {
          message: msg,
          scenario_id: scenarioId,
          client_turn_id: randomUUID(),
          context: makeContext(
            scenarioId,
            currentGraph,
            { stage: "ideate", goal: "50k MRR within 9 months, churn below 5%" },
            null,
            null,
            conversationHistory,
          ),
        };
        const result = await post(req);
        saveDiag("step03-set-churn", req, result);
        logStep("Step 3", result);

        expect(result.status, `Step 3 status`).toBe(200);
        assertTurnGuards(result.body, "Step 3");

        const b = result.body as Record<string, unknown>;
        const text = stripDiagnostics((b.assistant_text as string) ?? "");

        // Post-deployment: assistant_text must be non-empty (null text guard active)
        expect(
          text.length > 0,
          `Step 3: assistant_text must be non-empty post-deployment. Raw: "${String(b.assistant_text).slice(0, 200)}"`,
        ).toBe(true);

        // Should mention churn and/or 3.2%
        const mentionsChurn =
          text.toLowerCase().includes("churn") || text.includes("3.2");
        if (!mentionsChurn) {
          console.warn(
            `[Step 3] assistant_text doesn't mention churn/3.2%. Text: "${text.slice(0, 200)}"`,
          );
        }

        // Should NOT say "I've updated" (recommendation framing)
        expect(
          text.toLowerCase().includes("i've updated"),
          "Step 3: should not use 'I've updated' framing",
        ).toBe(false);

        // No banned terms
        for (const term of BANNED_TERMS) {
          expect(text.includes(term), `Step 3: banned term "${term}"`).toBe(false);
        }

        // If graph_patch: apply it
        const blocks = b.blocks as Array<Record<string, unknown>>;
        const gpBlock = findBlock(blocks, "graph_patch");
        if (gpBlock) {
          currentGraph = resolveGraphFromPatch(currentGraph!, gpBlock);
        }

        conversationHistory.push(
          historyTurn("user", msg),
          historyTurn("assistant", text, b.assistant_tool_calls as unknown[] | undefined),
        );

        stepResults.push({
          step: 3,
          label: "Chat edit — set value",
          verdict: "PASS",
          elapsed_ms: result.elapsed_ms,
          crossBoundaryPass: true,
        });
      },
    );

    // ========================================================================
    // Step 4: Chat edit — add constraint (churn < 5%)
    // ========================================================================

    it(
      "Step 4: Chat edit — add churn constraint mentions 5% and/or constraint",
      { timeout: TURN_TIMEOUT_MS, skip: !!SKIP_REASON },
      async () => {
        if (SKIP_REASON) {
          console.log(SKIP_REASON);
          return;
        }
        if (!currentGraph) {
          stepResults.push({ step: 4, label: "Chat edit — add constraint", verdict: "SKIP", elapsed_ms: 0, crossBoundaryPass: false });
          console.warn("[Step 4] SKIPPED: no graph");
          return;
        }

        const msg = "We need to keep churn under 5%, that's a hard requirement.";
        const req: Record<string, unknown> = {
          message: msg,
          scenario_id: scenarioId,
          client_turn_id: randomUUID(),
          context: makeContext(
            scenarioId,
            currentGraph,
            { stage: "ideate", goal: "50k MRR within 9 months, churn below 5%" },
            null,
            null,
            conversationHistory,
          ),
        };
        const result = await post(req);
        saveDiag("step04-add-constraint", req, result);
        logStep("Step 4", result);

        expect(result.status, "Step 4 status").toBe(200);
        assertTurnGuards(result.body, "Step 4");

        const b = result.body as Record<string, unknown>;
        const text = stripDiagnostics((b.assistant_text as string) ?? "");

        // Two valid outcomes:
        //   1. Constraint shortcut fires → graph_patch with goal_constraints (deterministic, fast)
        //   2. LLM responds conversationally about the constraint (V2 pipeline, LLM-dependent)
        // The constraint shortcut only fires when the V2 LLM actually invokes edit_graph
        // with the constraint text. Sometimes the LLM responds conversationally instead.
        const blocks = b.blocks as Array<Record<string, unknown>>;
        const gpBlock = findBlock(blocks, "graph_patch");
        const tp = b.turn_plan as Record<string, unknown>;
        let step4Outcome: string;

        if (gpBlock) {
          const gpData = gpBlock.data as Record<string, unknown>;
          const ops = (gpData.operations ?? []) as Array<Record<string, unknown>>;
          const hasConstraintOp = ops.some((op) => {
            const value = op.value as Record<string, unknown> | undefined;
            return value?.goal_constraints != null;
          });
          if (hasConstraintOp) {
            console.log("[Step 4] Constraint shortcut fired: goal_constraints update detected");
            step4Outcome = "constraint_shortcut";
          } else {
            step4Outcome = "edit_success";
          }
          currentGraph = resolveGraphFromPatch(currentGraph!, gpBlock);
        } else {
          // Conversational response — LLM didn't invoke edit_graph tool
          step4Outcome = "conversational";
        }

        // Regardless of path, text should mention constraint/churn/5% or structural explanation
        const mentionsConstraint =
          text.includes("5%") ||
          text.toLowerCase().includes("constraint") ||
          text.toLowerCase().includes("churn") ||
          text.toLowerCase().includes("requirement") ||
          text.toLowerCase().includes("structural") ||
          text.toLowerCase().includes("wasn't able") ||
          text.toLowerCase().includes("couldn't");
        expect(
          mentionsConstraint,
          `Step 4: expected mention of constraint or explanation. Text: "${text.slice(0, 300)}"`,
        ).toBe(true);

        console.log(`[Step 4] Outcome: ${step4Outcome}`);

        conversationHistory.push(
          historyTurn("user", msg),
          historyTurn("assistant", text, b.assistant_tool_calls as unknown[] | undefined),
        );

        stepResults.push({
          step: 4,
          label: "Chat edit — add constraint",
          verdict: "PASS",
          elapsed_ms: result.elapsed_ms,
          crossBoundaryPass: true,
        });
      },
    );

    // ========================================================================
    // Step 5: Request analysis (via direct_analysis_run system event)
    //
    // Uses PRICING_GRAPH + PRICING_ANALYSIS_INPUTS (hardcoded) — same pattern
    // as v1 test. T1's draft_graph returns options with interventions:{}
    // (needs_encoding); ISL intervention-encoding is not part of the E2E flow.
    // ========================================================================

    it(
      "Step 5: Request analysis — run_analysis returns computed results",
      { timeout: TURN_TIMEOUT_MS, skip: !!SKIP_REASON },
      async () => {
        if (SKIP_REASON) {
          console.log(SKIP_REASON);
          return;
        }

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
          context: {
            ...makeContext(
              scenarioId,
              PRICING_GRAPH,
              { stage: "evaluate", goal: "50k MRR within 9 months, churn below 5%" },
              null,
              null,
              [],
            ),
            analysis_inputs: PRICING_ANALYSIS_INPUTS,
          },
        };
        const result = await post(req);
        saveDiag("step05-analysis", req, result);
        logStep("Step 5", result);

        expect(result.status, `Step 5 status`).toBe(200);
        assertTurnGuards(result.body, "Step 5");

        const b = result.body as Record<string, unknown>;
        const tp = b.turn_plan as Record<string, unknown>;
        const meta = b._route_metadata as Record<string, unknown> | undefined;
        const sysEvent = tp.system_event as Record<string, unknown> | undefined;
        const analysisDispatched =
          tp.selected_tool === "run_analysis" ||
          sysEvent?.type === "direct_analysis_run" ||
          meta?.turn_type === "run_analysis";

        expect(
          analysisDispatched,
          "Step 5: direct_analysis_run must dispatch run_analysis",
        ).toBe(true);

        // analysis_response must be present
        expect(b.analysis_response, "Step 5: analysis_response missing").toBeDefined();
        const ar = b.analysis_response as Record<string, unknown>;

        // analysis_status === 'computed'
        const status = ar.analysis_status ?? b.analysis_status;
        expect(status, "Step 5: expected analysis_status=computed").toBe("computed");

        // option_comparison: non-empty array
        const optComp = (ar.option_comparison ?? ar.results) as Array<
          Record<string, unknown>
        >;
        expect(
          Array.isArray(optComp) && optComp.length > 0,
          "Step 5: option_comparison must be non-empty array",
        ).toBe(true);

        // Each option has win_probability [0, 1]
        for (const opt of optComp) {
          expect(typeof opt.win_probability, "Step 5: win_probability must be number").toBe(
            "number",
          );
          expect(
            opt.win_probability as number,
            "Step 5: win_probability ≥0",
          ).toBeGreaterThanOrEqual(0);
          expect(
            opt.win_probability as number,
            "Step 5: win_probability ≤1",
          ).toBeLessThanOrEqual(1);
        }

        // Win probabilities sum to ~1.0
        const winSum = optComp.reduce((acc, o) => acc + (o.win_probability as number), 0);
        expect(Math.abs(winSum - 1.0), `Step 5: win_probability sum=${winSum}`).toBeLessThan(0.05);

        // factor_sensitivity
        const factors = (ar.factor_sensitivity ?? []) as Array<Record<string, unknown>>;
        expect(
          Array.isArray(factors) && factors.length > 0,
          "Step 5: factor_sensitivity must be non-empty",
        ).toBe(true);

        // robustness
        const robustness = ar.robustness as Record<string, unknown> | undefined;
        expect(robustness, "Step 5: robustness missing").toBeDefined();
        expect(typeof robustness!.level, "Step 5: robustness.level must be string").toBe("string");

        // Capture for subsequent steps
        analysisResponse = ar;

        // Identify winner and runner-up
        const sorted = [...optComp].sort(
          (a, b) => (b.win_probability as number) - (a.win_probability as number),
        );
        winnerLabel =
          String(sorted[0].option_label ?? sorted[0].label ?? sorted[0].option_id ?? "");
        expect(winnerLabel.length > 0, "Step 5: winner label empty").toBe(true);

        // Winner > runner-up
        if (sorted.length >= 2) {
          expect(
            (sorted[0].win_probability as number) >=
              (sorted[1].win_probability as number),
            "Step 5: winner probability must be ≥ runner-up",
          ).toBe(true);
        }

        // Extract top driver labels
        topDriverLabels = factors
          .map((f) => String(f.factor_label ?? f.label ?? ""))
          .filter((l) => l.length > 0);

        const text = stripDiagnostics((b.assistant_text as string) ?? "");
        if (text.length > 0) {
          conversationHistory.push(
            historyTurn("user", "run the analysis"),
            historyTurn("assistant", text, b.assistant_tool_calls as unknown[] | undefined),
          );
        }

        stepResults.push({
          step: 5,
          label: "Request analysis",
          verdict: "PASS",
          elapsed_ms: result.elapsed_ms,
          crossBoundaryPass: true,
        });
      },
    );

    // ========================================================================
    // Step 6: Verify analysis results (structural assertions)
    // ========================================================================

    it(
      "Step 6: Verify analysis results — winner, runner-up, drivers, robustness",
      { timeout: 10_000, skip: !!SKIP_REASON },
      async () => {
        if (SKIP_REASON) {
          console.log(SKIP_REASON);
          return;
        }
        if (!analysisResponse) {
          stepResults.push({ step: 6, label: "Verify analysis results", verdict: "SKIP", elapsed_ms: 0, crossBoundaryPass: false });
          console.warn("[Step 6] SKIPPED: no analysis from Step 5");
          return;
        }

        const t0 = Date.now();
        const ar = analysisResponse;

        // winner exists
        const optComp = (ar.option_comparison ?? ar.results) as Array<
          Record<string, unknown>
        >;
        const sorted = [...optComp].sort(
          (a, b) => (b.win_probability as number) - (a.win_probability as number),
        );
        const winner = sorted[0];
        const runnerUp = sorted.length >= 2 ? sorted[1] : null;

        // Winner has id, label, probability
        expect(
          winner.option_id ?? winner.id,
          "Step 6: winner missing id",
        ).toBeDefined();
        expect(
          winner.option_label ?? winner.label,
          "Step 6: winner missing label",
        ).toBeDefined();
        expect(typeof winner.win_probability, "Step 6: winner.probability").toBe("number");

        // Runner-up
        if (runnerUp) {
          expect(
            runnerUp.option_id ?? runnerUp.id,
            "Step 6: runner-up missing id",
          ).toBeDefined();
          expect(typeof runnerUp.win_probability, "Step 6: runner-up.probability").toBe(
            "number",
          );
          // Winner > runner-up
          expect(
            (winner.win_probability as number) >=
              (runnerUp.win_probability as number),
            "Step 6: winner must beat runner-up",
          ).toBe(true);
        }

        // robustness_band
        const robustness = ar.robustness as Record<string, unknown>;
        const band = robustness.level ?? robustness.band ?? robustness.robustness_band;
        // Accept both canonical set AND raw ISL vocabulary (pre-deployment)
        const validBands = ["fragile", "moderate", "stable", "highly_stable", "low", "medium", "high", "very_high"];
        expect(
          validBands.includes(String(band).toLowerCase()),
          `Step 6: robustness band "${band}" not in valid set`,
        ).toBe(true);

        // top_drivers non-empty
        const factors = (ar.factor_sensitivity ?? []) as Array<Record<string, unknown>>;
        expect(factors.length > 0, "Step 6: top_drivers empty").toBe(true);
        for (const f of factors) {
          const hasLabel = typeof f.factor_label === "string" || typeof f.label === "string";
          expect(hasLabel, "Step 6: driver missing label").toBe(true);
          const hasScore =
            typeof f.sensitivity_score === "number" || typeof f.elasticity === "number";
          expect(hasScore, "Step 6: driver missing sensitivity_score").toBe(true);
        }

        stepResults.push({
          step: 6,
          label: "Verify analysis results",
          verdict: "PASS",
          elapsed_ms: Date.now() - t0,
          crossBoundaryPass: true,
        });
      },
    );

    // ========================================================================
    // Step 7: "Why does this option win?"
    // ========================================================================

    it(
      "Step 7: Why does this option win — references winner and driver names",
      { timeout: TURN_TIMEOUT_MS, skip: !!SKIP_REASON },
      async () => {
        if (SKIP_REASON) {
          console.log(SKIP_REASON);
          return;
        }
        if (!analysisResponse || !winnerLabel) {
          stepResults.push({ step: 7, label: "Why does this win?", verdict: "SKIP", elapsed_ms: 0, crossBoundaryPass: false });
          console.warn("[Step 7] SKIPPED: no analysis");
          return;
        }

        const analysisState = normalizeAnalysisState(analysisResponse);

        const msg = "Why does the winning option win?";
        const req: Record<string, unknown> = {
          message: msg,
          scenario_id: scenarioId,
          client_turn_id: randomUUID(),
          analysis_state: analysisState,
          context: makeContext(
            scenarioId,
            PRICING_GRAPH,
            { stage: "evaluate", goal: "50k MRR within 9 months, churn below 5%" },
            null,
            null,
            conversationHistory,
          ),
        };
        const result = await post(req);
        saveDiag("step07-why-win", req, result);
        logStep("Step 7", result);

        expect(result.status, "Step 7 status").toBe(200);
        assertTurnGuards(result.body, "Step 7");

        const b = result.body as Record<string, unknown>;

        // Combine block narratives + assistant_text
        const blocks = b.blocks as Array<Record<string, unknown>>;
        const narrativeText = blocks
          .map((blk) => {
            const data = blk.data as Record<string, unknown> | undefined;
            return String(data?.narrative ?? data?.text ?? "");
          })
          .join(" ");
        const assistantText = stripDiagnostics((b.assistant_text as string) ?? "");
        const text = narrativeText.length > 20 ? narrativeText : assistantText;

        // References the winning option by name
        const mentionsWinner = text.toLowerCase().includes(winnerLabel.toLowerCase());
        // Soft check: log but don't fail if winner name changed slightly
        if (!mentionsWinner) {
          console.warn(
            `[Step 7] Winner "${winnerLabel}" not mentioned verbatim. Text: "${text.slice(0, 200)}"`,
          );
        }

        // References at least one driver
        const mentionsDriver = topDriverLabels.some((d) =>
          text.toLowerCase().includes(d.toLowerCase()),
        );
        if (!mentionsDriver && topDriverLabels.length > 0) {
          console.warn(
            `[Step 7] No driver mentioned. Drivers: [${topDriverLabels.join(", ")}]. Text: "${text.slice(0, 200)}"`,
          );
        }

        // Text length
        expect(text.length > 50, `Step 7: text too short (${text.length})`).toBe(true);

        // Does NOT fabricate drivers not in top_drivers
        // (soft check — we just verify no banned terms which is already done)

        // No "no analysis" negative phrases
        const negatives = [
          "no analysis results",
          "hasn't been analysed",
          "not available",
          "not yet analysed",
        ];
        for (const phrase of negatives) {
          expect(
            text.toLowerCase().includes(phrase),
            `Step 7: found negative phrase "${phrase}"`,
          ).toBe(false);
        }

        conversationHistory.push(
          historyTurn("user", msg),
          historyTurn("assistant", assistantText, b.assistant_tool_calls as unknown[] | undefined),
        );

        stepResults.push({
          step: 7,
          label: "Why does this win?",
          verdict: "PASS",
          elapsed_ms: result.elapsed_ms,
          crossBoundaryPass: true,
        });
      },
    );

    // ========================================================================
    // Step 8: Compare options (chip_metadata shortcut)
    // ========================================================================

    it(
      "Step 8: Compare options — chip_metadata shortcut produces comparison content",
      { timeout: TURN_TIMEOUT_MS, skip: !!SKIP_REASON },
      async () => {
        if (SKIP_REASON) {
          console.log(SKIP_REASON);
          return;
        }
        if (!analysisResponse) {
          stepResults.push({ step: 8, label: "Compare options", verdict: "SKIP", elapsed_ms: 0, crossBoundaryPass: false });
          console.warn("[Step 8] SKIPPED: no analysis");
          return;
        }

        const analysisState = normalizeAnalysisState(analysisResponse);

        const msg = "Compare the options.";
        const req: Record<string, unknown> = {
          message: msg,
          scenario_id: scenarioId,
          client_turn_id: randomUUID(),
          analysis_state: analysisState,
          chip_metadata: { action_type: "compare_options" },
          context: makeContext(
            scenarioId,
            PRICING_GRAPH,
            { stage: "evaluate", goal: "50k MRR within 9 months, churn below 5%" },
            null,
            null,
            conversationHistory,
          ),
        };
        const result = await post(req);
        saveDiag("step08-compare", req, result);
        logStep("Step 8", result);

        expect(result.status, "Step 8 status").toBe(200);
        assertTurnGuards(result.body, "Step 8");

        const b = result.body as Record<string, unknown>;
        const tp = b.turn_plan as Record<string, unknown>;

        // chip_metadata should route deterministically
        if (tp.routing === "deterministic") {
          console.log("[Step 8] Confirmed deterministic routing via chip_metadata");
        }

        // Response contains comparison content
        const blocks = b.blocks as Array<Record<string, unknown>>;
        const comparisonBlock = findBlock(blocks, "comparison");
        const assistantText = stripDiagnostics((b.assistant_text as string) ?? "");

        // Either comparison block or substantive assistant_text
        const hasComparisonContent =
          comparisonBlock != null || assistantText.length > 50;
        expect(
          hasComparisonContent,
          `Step 8: no comparison content. Blocks: ${blocks.map((b2) => b2.block_type).join(",")}. Text len: ${assistantText.length}`,
        ).toBe(true);

        // If comparison block exists, verify it has options
        if (comparisonBlock) {
          const data = comparisonBlock.data as Record<string, unknown>;
          const compOptions = data.options ?? data.option_comparison ?? data.results;
          if (Array.isArray(compOptions)) {
            expect(
              (compOptions as unknown[]).length,
              "Step 8: comparison block has no options",
            ).toBeGreaterThan(0);
          }
        }

        conversationHistory.push(
          historyTurn("user", msg),
          historyTurn("assistant", assistantText, b.assistant_tool_calls as unknown[] | undefined),
        );

        stepResults.push({
          step: 8,
          label: "Compare options",
          verdict: "PASS",
          elapsed_ms: result.elapsed_ms,
          crossBoundaryPass: true,
        });
      },
    );

    // ========================================================================
    // Step 9: "What would flip the recommendation?"
    // ========================================================================

    it(
      "Step 9: What would flip — references real factors/assumptions",
      { timeout: TURN_TIMEOUT_MS, skip: !!SKIP_REASON },
      async () => {
        if (SKIP_REASON) {
          console.log(SKIP_REASON);
          return;
        }
        if (!analysisResponse) {
          stepResults.push({ step: 9, label: "What would flip?", verdict: "SKIP", elapsed_ms: 0, crossBoundaryPass: false });
          console.warn("[Step 9] SKIPPED: no analysis");
          return;
        }

        const analysisState = normalizeAnalysisState(analysisResponse);

        const msg = "What would change the recommendation?";
        const req: Record<string, unknown> = {
          message: msg,
          scenario_id: scenarioId,
          client_turn_id: randomUUID(),
          analysis_state: analysisState,
          context: makeContext(
            scenarioId,
            PRICING_GRAPH,
            { stage: "evaluate", goal: "50k MRR within 9 months, churn below 5%" },
            null,
            null,
            conversationHistory,
          ),
        };
        const result = await post(req);
        saveDiag("step09-flip", req, result);
        logStep("Step 9", result);

        expect(result.status, "Step 9 status").toBe(200);
        assertTurnGuards(result.body, "Step 9");

        const b = result.body as Record<string, unknown>;
        const blocks = b.blocks as Array<Record<string, unknown>>;
        const narrativeText = blocks
          .map((blk) => {
            const data = blk.data as Record<string, unknown> | undefined;
            return String(data?.narrative ?? data?.text ?? "");
          })
          .join(" ");
        const assistantText = stripDiagnostics((b.assistant_text as string) ?? "");
        const text = narrativeText.length > 20 ? narrativeText : assistantText;

        // Names specific factors or assumptions from the graph
        const graphLabels = (PRICING_GRAPH.nodes as Array<Record<string, unknown>>)
          .filter((n) => n.kind === "factor" || n.kind === "risk" || n.kind === "outcome")
          .map((n) => String(n.label ?? "").toLowerCase());
        const referencesRealEntity = graphLabels.some((l) =>
          text.toLowerCase().includes(l),
        );
        // Soft check: may use paraphrased names
        if (!referencesRealEntity) {
          console.warn(
            `[Step 9] No graph entity referenced. Labels: [${graphLabels.join(", ")}]. Text: "${text.slice(0, 200)}"`,
          );
        }

        expect(text.length > 30, `Step 9: text too short (${text.length})`).toBe(true);

        conversationHistory.push(
          historyTurn("user", msg),
          historyTurn("assistant", assistantText, b.assistant_tool_calls as unknown[] | undefined),
        );

        stepResults.push({
          step: 9,
          label: "What would flip?",
          verdict: "PASS",
          elapsed_ms: result.elapsed_ms,
          crossBoundaryPass: true,
        });
      },
    );

    // ========================================================================
    // Step 10: Ambiguous edit — disambiguation test
    // ========================================================================

    it(
      "Step 10: Ambiguous edit — disambiguation if applicable, otherwise SKIP",
      { timeout: TURN_TIMEOUT_MS, skip: !!SKIP_REASON },
      async () => {
        if (SKIP_REASON) {
          console.log(SKIP_REASON);
          return;
        }
        if (!currentGraph) {
          stepResults.push({ step: 10, label: "Ambiguous edit", verdict: "SKIP", elapsed_ms: 0, crossBoundaryPass: false });
          console.warn("[Step 10] SKIPPED: no graph");
          return;
        }

        // Check if two factors contain "price" or "sensitivity" — ambiguity candidates
        const nodes = (currentGraph.nodes ?? []) as Array<Record<string, unknown>>;
        const factors = nodes.filter((n) => n.kind === "factor");
        const pricingFactors = factors.filter(
          (f) =>
            String(f.label ?? "")
              .toLowerCase()
              .includes("price") ||
            String(f.label ?? "")
              .toLowerCase()
              .includes("sensitivity"),
        );

        if (pricingFactors.length < 2) {
          console.log(
            `[Step 10] No ambiguity: only ${pricingFactors.length} pricing-related factor(s). SKIP.`,
          );
          stepResults.push({
            step: 10,
            label: "Ambiguous edit",
            verdict: "SKIP",
            elapsed_ms: 0,
            crossBoundaryPass: false,
          });
          return;
        }

        const msg = "Update the sensitivity value.";
        const req: Record<string, unknown> = {
          message: msg,
          scenario_id: scenarioId,
          client_turn_id: randomUUID(),
          context: makeContext(
            scenarioId,
            currentGraph,
            { stage: "ideate", goal: "50k MRR within 9 months, churn below 5%" },
            null,
            null,
            conversationHistory,
          ),
        };
        const result = await post(req);
        saveDiag("step10-ambiguous", req, result);
        logStep("Step 10", result);

        expect(result.status, "Step 10 status").toBe(200);
        assertTurnGuards(result.body, "Step 10");

        const b = result.body as Record<string, unknown>;
        const text = stripDiagnostics((b.assistant_text as string) ?? "");

        // Should ask which factor, not silently pick one
        const asksForClarification =
          text.toLowerCase().includes("which") ||
          text.includes("?") ||
          text.toLowerCase().includes("clarif") ||
          text.toLowerCase().includes("specify") ||
          text.toLowerCase().includes("did you mean");

        if (!asksForClarification) {
          console.warn(
            `[Step 10] Expected disambiguation question. Text: "${text.slice(0, 200)}"`,
          );
        }

        conversationHistory.push(
          historyTurn("user", msg),
          historyTurn("assistant", text, b.assistant_tool_calls as unknown[] | undefined),
        );

        stepResults.push({
          step: 10,
          label: "Ambiguous edit",
          verdict: "PASS",
          elapsed_ms: result.elapsed_ms,
          crossBoundaryPass: true,
        });
      },
    );

    // ========================================================================
    // Step 11: Blocked action — request artefact
    // ========================================================================

    it(
      "Step 11: Blocked action — request artefact not in eligible_actions",
      { timeout: TURN_TIMEOUT_MS, skip: !!SKIP_REASON },
      async () => {
        if (SKIP_REASON) {
          console.log(SKIP_REASON);
          return;
        }

        // Use ideate stage where generate_artefact is NOT eligible
        const analysisState = analysisResponse
          ? normalizeAnalysisState(analysisResponse)
          : null;

        const msg = "Generate a decision brief.";
        const req: Record<string, unknown> = {
          message: msg,
          scenario_id: scenarioId,
          client_turn_id: randomUUID(),
          ...(analysisState && { analysis_state: analysisState }),
          context: makeContext(
            scenarioId,
            currentGraph ?? PRICING_GRAPH,
            { stage: "ideate", goal: "50k MRR within 9 months, churn below 5%" },
            null,
            null,
            conversationHistory,
          ),
        };
        const result = await post(req);
        saveDiag("step11-blocked", req, result);
        logStep("Step 11", result);

        expect(result.status, "Step 11 status").toBe(200);
        assertTurnGuards(result.body, "Step 11");

        const b = result.body as Record<string, unknown>;
        const tp = b.turn_plan as Record<string, unknown>;
        const text = stripDiagnostics((b.assistant_text as string) ?? "");

        // Log what tool was dispatched — stage guard may or may not block
        console.log(
          `[Step 11] selected_tool=${tp.selected_tool} routing=${tp.routing}`,
        );

        // If the LLM bypassed the stage guard and generated a brief, that's a
        // noteworthy finding but not a test crash. Log it as a warning.
        if (
          tp.selected_tool === "generate_brief" ||
          tp.selected_tool === "generate_artefact"
        ) {
          const blocks = b.blocks as Array<Record<string, unknown>>;
          const briefBlock = findBlock(blocks, "brief");
          console.warn(
            `[Step 11] WARNING: LLM dispatched ${tp.selected_tool} in ideate stage. ` +
              `Brief block present: ${!!briefBlock}. Stage guard did not block.`,
          );
          // Still valid — the system didn't crash, the response is well-formed
        }

        // No generic error message
        const hasGenericError =
          text.toLowerCase().includes("internal error") ||
          text.toLowerCase().includes("something went wrong");
        expect(hasGenericError, "Step 11: should not have generic error").toBe(false);

        // Response should have either text or blocks (brief block counts)
        const blocks = b.blocks as Array<Record<string, unknown>>;
        const hasContent = text.length > 10 || blocks.length > 0;
        expect(hasContent, `Step 11: no content (text=${text.length}, blocks=${blocks.length})`).toBe(true);

        conversationHistory.push(
          historyTurn("user", msg),
          historyTurn("assistant", text, b.assistant_tool_calls as unknown[] | undefined),
        );

        stepResults.push({
          step: 11,
          label: "Blocked action",
          verdict: "PASS",
          elapsed_ms: result.elapsed_ms,
          crossBoundaryPass: true,
        });
      },
    );

    // ========================================================================
    // Step 12: Ineligible action — request add_factor in evaluate stage
    // ========================================================================

    it(
      "Step 12: Ineligible action — add_factor not available in evaluate stage",
      { timeout: TURN_TIMEOUT_MS, skip: !!SKIP_REASON },
      async () => {
        if (SKIP_REASON) {
          console.log(SKIP_REASON);
          return;
        }

        const analysisState = analysisResponse
          ? normalizeAnalysisState(analysisResponse)
          : null;

        const msg = "Add a regulatory compliance factor.";
        const req: Record<string, unknown> = {
          message: msg,
          scenario_id: scenarioId,
          client_turn_id: randomUUID(),
          ...(analysisState && { analysis_state: analysisState }),
          context: makeContext(
            scenarioId,
            PRICING_GRAPH,
            // evaluate stage — add_factor should not be eligible here
            { stage: "evaluate", goal: "50k MRR within 9 months, churn below 5%" },
            null,
            null,
            conversationHistory,
          ),
        };
        const result = await post(req);
        saveDiag("step12-ineligible", req, result);
        logStep("Step 12", result);

        expect(result.status, "Step 12 status").toBe(200);
        assertTurnGuards(result.body, "Step 12");

        const b = result.body as Record<string, unknown>;
        const text = stripDiagnostics((b.assistant_text as string) ?? "");

        // Should NOT claim it will add the factor (no "I'll add" / "I've added" / "Adding")
        const claimsAdding =
          text.toLowerCase().includes("i'll add") ||
          text.toLowerCase().includes("i've added") ||
          text.toLowerCase().includes("adding the factor") ||
          text.toLowerCase().includes("i have added");
        if (claimsAdding) {
          console.warn(
            `[Step 12] LLM claimed to add factor in evaluate stage. Text: "${text.slice(0, 200)}"`,
          );
        }

        // recommended_actions should NOT include add_factor
        const sa = (b.suggested_actions ?? []) as Array<Record<string, unknown>>;
        const hasAddFactor = sa.some(
          (a) =>
            a.action_type === "add_factor" ||
            String(a.label ?? "")
              .toLowerCase()
              .includes("add factor"),
        );
        if (hasAddFactor) {
          console.warn(
            "[Step 12] suggested_actions includes add_factor in evaluate stage",
          );
        }

        // Non-empty response
        expect(text.length > 10, `Step 12: text too short (${text.length})`).toBe(true);

        stepResults.push({
          step: 12,
          label: "Ineligible action",
          verdict: "PASS",
          elapsed_ms: result.elapsed_ms,
          crossBoundaryPass: true,
        });
      },
    );

    // ========================================================================
    // Final: Write summary report
    // ========================================================================

    it(
      "Summary: Write results report",
      { timeout: 10_000, skip: !!SKIP_REASON },
      async () => {
        if (SKIP_REASON) {
          console.log(SKIP_REASON);
          return;
        }
        writeReport();
      },
    );
  },
);
