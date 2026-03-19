/**
 * End-to-end pipeline benchmark.
 *
 * Sends each brief through the full unified pipeline (Stages 1-6) via the
 * staging endpoint, then scores both the Stage 1 (pre-repair) and final
 * post-pipeline graph outputs.
 *
 * Usage:
 *   npx tsx src/e2e-pipeline-test.ts --briefs 15,16,17,18,19,20 --runs 3
 *   npx tsx src/e2e-pipeline-test.ts --runs 3          # all briefs
 */

import { config as loadDotenv } from "dotenv";
import { Command } from "commander";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import matter from "gray-matter";

import { score } from "./scorer.js";
import { validateStructural } from "./validator.js";
import type { Brief, BriefMeta, ParsedGraph, ScoreResult } from "./types.js";

// ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TOOL_ROOT = resolve(__dirname, "..");

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_URL = "https://cee-staging.onrender.com/assist/v1/draft-graph";
const LOCAL_URL = "http://localhost:3101/assist/v1/draft-graph";
const REQUEST_TIMEOUT_MS = 120_000;
const INTER_REQUEST_DELAY_MS = 3_000; // rate-limit guard

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface E2ERunResult {
  fixture: string;
  run: number;
  http_status: number;
  latency_ms: number;

  // Stage 1 (pre-repair)
  stage1_score: ScoreResult | null;
  stage1_pass: boolean;
  stage1_violations: string[];

  // Post-pipeline (final output)
  post_pipeline_score: ScoreResult | null;
  post_pipeline_pass: boolean;
  post_pipeline_violations: string[];

  // Repair metadata
  repair_operations: number;
  repair_details: Record<string, unknown> | null;
  repair_fallback_reason: string | null;
  llm_repair_needed: boolean;

  // Error info
  error: string | null;

  // Raw response body (for deeper analysis)
  response_body?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Brief loading (adapted from io.ts)
// ─────────────────────────────────────────────────────────────────────────────

async function loadBriefs(dir: string, filter?: string[]): Promise<Brief[]> {
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
  const briefs: Brief[] = [];

  for (const file of files) {
    const id = file.replace(/\.md$/, "");
    if (filter && filter.length > 0 && !filter.some((f) => id.includes(f))) continue;

    const raw = await readFile(join(dir, file), "utf-8");
    const { data, content } = matter(raw);

    briefs.push({
      id,
      meta: {
        expect_status_quo: data.expect_status_quo ?? false,
        has_numeric_target: data.has_numeric_target ?? false,
        complexity: data.complexity ?? "moderate",
      } as BriefMeta,
      body: content.trim(),
    });
  }

  return briefs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline call
// ─────────────────────────────────────────────────────────────────────────────

// Module-level state set by main()
let PIPELINE_URL = LOCAL_URL;

async function callPipeline(brief: string): Promise<{
  status: number;
  body: Record<string, unknown>;
  latency_ms: number;
}> {
  const apiKey = process.env.ASSIST_API_KEY || process.env.CEE_API_KEY;

  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["X-Olumi-Assist-Key"] = apiKey;

  try {
    const res = await fetch(PIPELINE_URL + "?schema=v3", {
      method: "POST",
      headers,
      body: JSON.stringify({ brief, include_debug: true }),
      signal: controller.signal,
    });

    const body = (await res.json()) as Record<string, unknown>;
    return { status: res.status, body, latency_ms: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph extraction
// ─────────────────────────────────────────────────────────────────────────────

function extractGraph(body: Record<string, unknown>): ParsedGraph | null {
  // V3 format: nodes/edges at top level
  // V2/V1 format: nested under body.graph
  let nodes: ParsedGraph["nodes"] | undefined;
  let edges: ParsedGraph["edges"] | undefined;
  let coaching: ParsedGraph["coaching"];
  let goalConstraints: ParsedGraph["goal_constraints"];

  if (Array.isArray(body.nodes) && Array.isArray(body.edges)) {
    // V3 format
    nodes = body.nodes as ParsedGraph["nodes"];
    edges = body.edges as ParsedGraph["edges"];
    coaching = body.coaching as ParsedGraph["coaching"];
    goalConstraints = body.goal_constraints as ParsedGraph["goal_constraints"];
  } else if (body.graph) {
    // V2/V1 format
    const graph = body.graph as Record<string, unknown>;
    nodes = graph.nodes as ParsedGraph["nodes"] | undefined;
    edges = graph.edges as ParsedGraph["edges"] | undefined;
    coaching = graph.coaching as ParsedGraph["coaching"];
    goalConstraints = graph.goal_constraints as ParsedGraph["goal_constraints"];
  }

  if (!Array.isArray(nodes) || !Array.isArray(edges)) return null;

  // V3 uses "action" instead of "option" — normalise for scorer compatibility
  const normalisedNodes = nodes.map((n) => ({
    ...n,
    kind: (n.kind === "action" ? "option" : n.kind) as typeof n.kind,
  }));

  return { nodes: normalisedNodes, edges, coaching, goal_constraints: goalConstraints };
}

function extractRepairTrace(body: Record<string, unknown>): {
  repair: Record<string, unknown> | null;
  repairOps: number;
  fallbackReason: string | null;
  llmRepairNeeded: boolean;
  stage1Violations: string[];
} {
  const trace = body.trace as Record<string, unknown> | undefined;
  const pipeline = trace?.pipeline as Record<string, unknown> | undefined;
  const repair = pipeline?.repair as Record<string, unknown> | undefined;
  const sweep = repair?.deterministic_sweep as Record<string, unknown> | undefined;

  const repairSummary = pipeline?.repair_summary as Record<string, unknown> | undefined;

  // Count repair operations from deterministic sweep
  const repairsCount = Number(sweep?.repairs_count) || 0;
  const factorGoalSplits = Number(sweep?.factor_goal_splits) || 0;
  const optionOutcomeRemoved = Number(sweep?.option_outcome_shortcuts_removed) || 0;
  const disconnectedPrunedRaw = sweep?.disconnected_observables_pruned;
  const disconnectedPruned = Array.isArray(disconnectedPrunedRaw) ? disconnectedPrunedRaw.length : (Number(disconnectedPrunedRaw) || 0);
  const totalDeterministic = repairsCount + factorGoalSplits + optionOutcomeRemoved + disconnectedPruned;

  // LLM repair info
  const llmRepairNeeded = (sweep?.llm_repair_needed as boolean) ?? false;
  const fallbackReason = (repair?.plot_validation_fallback_reason as string) ?? null;

  // Pre-repair violations
  const violationsBefore = (sweep?.violations_before as number) ?? 0;
  const violationsAfter = (sweep?.violations_after as number) ?? 0;

  // Try to extract violation codes from repair summary
  const stage1Violations: string[] = [];
  if (repairSummary) {
    const codes = repairSummary.violation_codes as string[] | undefined;
    if (Array.isArray(codes)) stage1Violations.push(...codes);
  }

  return {
    repair: repair ?? null,
    repairOps: totalDeterministic,
    fallbackReason,
    llmRepairNeeded,
    stage1Violations,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1 graph extraction from pipeline checkpoints
// ─────────────────────────────────────────────────────────────────────────────

function extractStage1Graph(body: Record<string, unknown>): ParsedGraph | null {
  const trace = body.trace as Record<string, unknown> | undefined;
  const pipeline = trace?.pipeline as Record<string, unknown> | undefined;

  // Try pipeline_checkpoints first (if enabled)
  const checkpoints = pipeline?.pipeline_checkpoints as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(checkpoints)) {
    const stage1Cp = checkpoints.find(
      (cp) => cp.stage === "stage_1" || cp.stage === "parse" || cp.label?.toString().includes("stage_1")
    );
    if (stage1Cp?.graph) {
      return extractGraph({ graph: stage1Cp.graph as Record<string, unknown> });
    }
  }

  // Try stage_snapshots
  const snapshots = pipeline?.stage_snapshots as Record<string, unknown> | undefined;
  if (snapshots?.stage_1) {
    const s1 = snapshots.stage_1 as Record<string, unknown>;
    if (s1.graph) return extractGraph({ graph: s1.graph as Record<string, unknown> });
  }

  // Fallback: we can't separate Stage 1 from final output without checkpoints.
  // In this case we use the repair trace to infer whether Stage 1 had violations.
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Single run
// ─────────────────────────────────────────────────────────────────────────────

async function runOnce(brief: Brief, runIdx: number): Promise<E2ERunResult> {
  const result: E2ERunResult = {
    fixture: brief.id,
    run: runIdx,
    http_status: 0,
    latency_ms: 0,
    stage1_score: null,
    stage1_pass: false,
    stage1_violations: [],
    post_pipeline_score: null,
    post_pipeline_pass: false,
    post_pipeline_violations: [],
    repair_operations: 0,
    repair_details: null,
    repair_fallback_reason: null,
    llm_repair_needed: false,
    error: null,
  };

  try {
    const { status, body, latency_ms } = await callPipeline(brief.body);
    result.http_status = status;
    result.latency_ms = latency_ms;

    // Store raw body for analysis
    result.response_body = body;

    if (status !== 200) {
      result.error = `HTTP ${status}: ${JSON.stringify(body).slice(0, 200)}`;
      return result;
    }

    // Extract repair trace
    const repairInfo = extractRepairTrace(body);
    result.repair_operations = repairInfo.repairOps;
    result.repair_details = repairInfo.repair;
    result.repair_fallback_reason = repairInfo.fallbackReason;
    result.llm_repair_needed = repairInfo.llmRepairNeeded;

    // Score post-pipeline (final) graph
    const finalGraph = extractGraph(body);
    if (finalGraph) {
      const validation = validateStructural(finalGraph);
      result.post_pipeline_pass = validation.valid;
      result.post_pipeline_violations = validation.violations;

      // Build a mock LLMResponse to use the scorer
      const mockResponse = {
        model_id: "pipeline",
        brief_id: brief.id,
        status: "success" as const,
        parsed_graph: finalGraph,
        latency_ms,
      };
      result.post_pipeline_score = score(mockResponse, brief);
    }

    // Try to extract and score Stage 1 graph
    const stage1Graph = extractStage1Graph(body);
    if (stage1Graph) {
      const validation = validateStructural(stage1Graph);
      result.stage1_pass = validation.valid;
      result.stage1_violations = validation.violations;

      const mockResponse = {
        model_id: "pipeline-stage1",
        brief_id: brief.id,
        status: "success" as const,
        parsed_graph: stage1Graph,
        latency_ms: 0,
      };
      result.stage1_score = score(mockResponse, brief);
    } else {
      // Infer Stage 1 status from repair trace
      // If repair ran and fixed things, Stage 1 likely had issues
      result.stage1_violations = repairInfo.stage1Violations;
      result.stage1_pass = repairInfo.repairOps === 0 && !repairInfo.llmRepairNeeded;
    }
  } catch (err: unknown) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Report generation
// ─────────────────────────────────────────────────────────────────────────────

function generateReport(results: E2ERunResult[], briefs: Brief[]): string {
  const lines: string[] = [];

  lines.push("# End-to-end pipeline benchmark report");
  lines.push("");
  lines.push(`**Date:** ${new Date().toISOString().split("T")[0]}`);
  lines.push(`**Endpoint:** ${PIPELINE_URL}`);
  lines.push(`**Fixtures:** ${briefs.map((b) => b.id).join(", ")}`);
  lines.push(`**Runs per fixture:** ${Math.max(...results.map((r) => r.run))}`);
  lines.push("");

  // ── Section 1: Repair stage capability ──────────────────────────────
  lines.push("## Section 1: Repair stage capability");
  lines.push("");
  lines.push("The unified pipeline repair stage (Stage 4) handles violations through two mechanisms:");
  lines.push("");
  lines.push("1. **Deterministic sweep** (substep 1): auto-fixes Bucket A/B violations");
  lines.push("   - NAN_VALUE, SIGN_MISMATCH, INVALID_EDGE_REF, GOAL_HAS_OUTGOING, DECISION_HAS_INCOMING");
  lines.push("   - CATEGORY_MISMATCH, CONTROLLABLE_MISSING_DATA, OBSERVABLE_MISSING_DATA");
  lines.push("   - Proactive: factor-goal edge splits, option-outcome shortcut removal, orphan pruning");
  lines.push("");
  lines.push("2. **PLoT LLM repair** (substep 2): handles Bucket C semantic violations");
  lines.push("   - NO_PATH_TO_GOAL, UNREACHABLE_FROM_DECISION, INVALID_EDGE_TYPE, CYCLE_DETECTED");
  lines.push("   - OPTIONS_IDENTICAL, MISSING_BRIDGE, MISSING_GOAL, MISSING_DECISION");
  lines.push("");
  lines.push("| Benchmark failure type | Repair coverage | Mechanism |");
  lines.push("|---|---|---|");
  lines.push("| FORBIDDEN_EDGE (option-outcome) | Covered | Deterministic: `fixOptionOutcomeShortcut` removes or defers to LLM |");
  lines.push("| FORBIDDEN_EDGE (factor-goal) | Covered | Deterministic: `fixFactorGoalEdges` inserts mediating outcome |");
  lines.push("| FORBIDDEN_EDGE (other) | Covered | LLM repair via INVALID_EDGE_TYPE violation code |");
  lines.push("| ORPHAN_NODE | Covered | Deterministic: `fixDisconnectedObservables` prunes disconnected nodes |");
  lines.push("| CONTROLLABLE_NO_OPTION_EDGE | Not directly covered | No dedicated repair path; may be resolved indirectly by connectivity wiring |");
  lines.push("");

  // ── Section 2: End-to-end results ───────────────────────────────────
  lines.push("## Section 2: End-to-end results");
  lines.push("");
  lines.push("### Per-fixture detail");
  lines.push("");
  lines.push("| Fixture | Run | HTTP | Latency (s) | Stage 1 pass | Stage 1 violations | Repair ops | LLM repair | Post-pipeline pass | Post-pipeline violations | Post-pipeline score |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");

  for (const r of results) {
    const latency = (r.latency_ms / 1000).toFixed(1);
    const s1Pass = r.stage1_pass ? "PASS" : "FAIL";
    const s1Viols = r.stage1_violations.length > 0 ? r.stage1_violations.join(", ") : "-";
    const ppPass = r.post_pipeline_pass ? "PASS" : "FAIL";
    const ppViols = r.post_pipeline_violations.length > 0 ? r.post_pipeline_violations.join(", ") : "-";
    const ppScore = r.post_pipeline_score?.overall_score != null
      ? r.post_pipeline_score.overall_score.toFixed(3)
      : r.error ? `ERROR: ${r.error.slice(0, 40)}` : "-";
    const llmRepair = r.llm_repair_needed ? "yes" : "no";

    lines.push(
      `| ${r.fixture} | ${r.run} | ${r.http_status} | ${latency} | ${s1Pass} | ${s1Viols} | ${r.repair_operations} | ${llmRepair} | ${ppPass} | ${ppViols} | ${ppScore} |`
    );
  }

  lines.push("");

  // ── Section 3: Repair recovery analysis ─────────────────────────────
  lines.push("## Section 3: Repair recovery analysis");
  lines.push("");

  // Group by fixture
  const byFixture = new Map<string, E2ERunResult[]>();
  for (const r of results) {
    const arr = byFixture.get(r.fixture) ?? [];
    arr.push(r);
    byFixture.set(r.fixture, arr);
  }

  lines.push("### 3a: Repair recovery rate");
  lines.push("");
  lines.push("| Fixture | Total runs | Stage 1 failures | Repaired successfully | Recovery rate |");
  lines.push("|---|---|---|---|---|");

  let totalRuns = 0;
  let totalS1Failures = 0;
  let totalRecovered = 0;

  for (const [fixture, runs] of byFixture) {
    const total = runs.filter((r) => r.http_status === 200).length;
    const s1Fails = runs.filter((r) => !r.stage1_pass && r.http_status === 200).length;
    const recovered = runs.filter((r) => !r.stage1_pass && r.post_pipeline_pass && r.http_status === 200).length;
    const rate = s1Fails > 0 ? ((recovered / s1Fails) * 100).toFixed(0) + "%" : "n/a";

    totalRuns += total;
    totalS1Failures += s1Fails;
    totalRecovered += recovered;

    lines.push(`| ${fixture} | ${total} | ${s1Fails} | ${recovered} | ${rate} |`);
  }

  const totalRate = totalS1Failures > 0
    ? ((totalRecovered / totalS1Failures) * 100).toFixed(0) + "%"
    : "n/a";
  lines.push(`| **Total** | **${totalRuns}** | **${totalS1Failures}** | **${totalRecovered}** | **${totalRate}** |`);
  lines.push("");

  // ── Section 3b: Pre-repair vs post-pipeline pass rates ──────────────
  lines.push("### 3b: Pre-repair vs post-pipeline pass rates");
  lines.push("");
  lines.push("| Fixture | Stage 1 pass rate | Post-pipeline pass rate | Delta |");
  lines.push("|---|---|---|---|");

  for (const [fixture, runs] of byFixture) {
    const validRuns = runs.filter((r) => r.http_status === 200);
    if (validRuns.length === 0) continue;
    const s1Rate = validRuns.filter((r) => r.stage1_pass).length / validRuns.length;
    const ppRate = validRuns.filter((r) => r.post_pipeline_pass).length / validRuns.length;
    const delta = ppRate - s1Rate;

    lines.push(
      `| ${fixture} | ${(s1Rate * 100).toFixed(0)}% | ${(ppRate * 100).toFixed(0)}% | +${(delta * 100).toFixed(0)}pp |`
    );
  }

  lines.push("");

  // ── Section 3c: Quality impact ──────────────────────────────────────
  lines.push("### 3c: Repair impact on quality");
  lines.push("");

  const passingScores = results
    .filter((r) => r.post_pipeline_pass && r.post_pipeline_score?.overall_score != null)
    .map((r) => r.post_pipeline_score!.overall_score!);

  if (passingScores.length > 0) {
    const mean = passingScores.reduce((a, b) => a + b, 0) / passingScores.length;
    const min = Math.min(...passingScores);
    const max = Math.max(...passingScores);
    lines.push(`- **Passing-run mean score:** ${mean.toFixed(3)}`);
    lines.push(`- **Score range:** ${min.toFixed(3)} - ${max.toFixed(3)}`);

    // Break down by whether repair intervened
    const repairedPassing = results.filter(
      (r) => r.post_pipeline_pass && r.post_pipeline_score?.overall_score != null && r.repair_operations > 0
    );
    const cleanPassing = results.filter(
      (r) => r.post_pipeline_pass && r.post_pipeline_score?.overall_score != null && r.repair_operations === 0 && !r.llm_repair_needed
    );

    if (repairedPassing.length > 0) {
      const repairedMean = repairedPassing.reduce((a, r) => a + r.post_pipeline_score!.overall_score!, 0) / repairedPassing.length;
      lines.push(`- **Repaired-run mean score:** ${repairedMean.toFixed(3)} (n=${repairedPassing.length})`);
    }
    if (cleanPassing.length > 0) {
      const cleanMean = cleanPassing.reduce((a, r) => a + r.post_pipeline_score!.overall_score!, 0) / cleanPassing.length;
      lines.push(`- **Clean-run mean score:** ${cleanMean.toFixed(3)} (n=${cleanPassing.length})`);
    }
  } else {
    lines.push("No passing runs to analyse quality.");
  }

  lines.push("");

  // ── Section 3d: Residual failures ───────────────────────────────────
  lines.push("### 3d: Residual failures");
  lines.push("");

  const residualFailures = results.filter(
    (r) => r.http_status === 200 && !r.post_pipeline_pass
  );

  if (residualFailures.length === 0) {
    lines.push("No residual failures. All successful HTTP responses produced valid graphs.");
  } else {
    lines.push("| Fixture | Run | Remaining violations | Repair fallback | Error |");
    lines.push("|---|---|---|---|---|");
    for (const r of residualFailures) {
      const viols = r.post_pipeline_violations.join(", ") || "-";
      const fb = r.repair_fallback_reason ?? "-";
      const err = r.error?.slice(0, 60) ?? "-";
      lines.push(`| ${r.fixture} | ${r.run} | ${viols} | ${fb} | ${err} |`);
    }
  }

  lines.push("");

  // ── Section 4: Effective production pass rate ───────────────────────
  lines.push("## Section 4: Effective production pass rate");
  lines.push("");

  const httpOk = results.filter((r) => r.http_status === 200);
  const postPipelinePass = httpOk.filter((r) => r.post_pipeline_pass);
  const effectiveRate = httpOk.length > 0 ? (postPipelinePass.length / httpOk.length) * 100 : 0;
  const httpErrors = results.filter((r) => r.http_status !== 200);

  lines.push(`- **Total runs:** ${results.length}`);
  lines.push(`- **HTTP 200 responses:** ${httpOk.length}`);
  lines.push(`- **HTTP errors:** ${httpErrors.length}`);
  lines.push(`- **Post-pipeline structural pass:** ${postPipelinePass.length}/${httpOk.length}`);
  lines.push(`- **Effective production pass rate: ${effectiveRate.toFixed(1)}%**`);
  lines.push("");

  // ── Section 5: Recommendations ──────────────────────────────────────
  lines.push("## Section 5: Recommendations");
  lines.push("");

  if (effectiveRate >= 95) {
    lines.push("**Structural pass rate is acceptable post-repair.** No further action on FORBIDDEN_EDGE.");
    lines.push("Focus on quality improvements (parameter diversity, option differentiation).");
  } else if (effectiveRate >= 80) {
    lines.push("**Repair partially recovers failures.** The pipeline catches most structural violations");
    lines.push("but some escape. Fine-tuning should target the violation types repair cannot fix:");
    const residualViols = new Set(residualFailures.flatMap((r) => r.post_pipeline_violations));
    if (residualViols.size > 0) {
      lines.push(`- ${[...residualViols].join(", ")}`);
    }
  } else {
    lines.push("**Repair does not sufficiently recover failures.** FORBIDDEN_EDGE and other structural");
    lines.push("failures survive the pipeline at an unacceptable rate. Fine-tuning or pipeline changes needed.");
  }

  lines.push("");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV output
// ─────────────────────────────────────────────────────────────────────────────

function generateCsv(results: E2ERunResult[]): string {
  const headers = [
    "fixture", "run", "http_status", "latency_ms",
    "stage1_pass", "stage1_violations",
    "repair_operations", "llm_repair_needed", "repair_fallback_reason",
    "post_pipeline_pass", "post_pipeline_violations",
    "post_pipeline_overall", "post_pipeline_param", "post_pipeline_optdiff", "post_pipeline_completeness",
    "error",
  ];

  const rows = results.map((r) => [
    r.fixture,
    r.run,
    r.http_status,
    r.latency_ms,
    r.stage1_pass ? 1 : 0,
    r.stage1_violations.join(";"),
    r.repair_operations,
    r.llm_repair_needed ? 1 : 0,
    r.repair_fallback_reason ?? "",
    r.post_pipeline_pass ? 1 : 0,
    r.post_pipeline_violations.join(";"),
    r.post_pipeline_score?.overall_score?.toFixed(4) ?? "",
    r.post_pipeline_score?.param_quality?.toFixed(4) ?? "",
    r.post_pipeline_score?.option_diff?.toFixed(4) ?? "",
    r.post_pipeline_score?.completeness?.toFixed(4) ?? "",
    r.error ?? "",
  ]);

  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n") + "\n";
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadDotenv({ path: join(TOOL_ROOT, ".env") });
  loadDotenv({ path: join(TOOL_ROOT, "..", "..", ".env") });

  const program = new Command()
    .name("e2e-pipeline-test")
    .description("End-to-end pipeline benchmark via local or staging endpoint")
    .option("--briefs <ids>", "Comma-separated brief IDs to run (default: all)", "")
    .option("--runs <n>", "Number of runs per fixture (default: 3)", "3")
    .option("--output <dir>", "Output directory for results", "")
    .option("--url <url>", "Override pipeline endpoint URL")
    .option("--local", "Use local server (http://localhost:3000)", false)
    .parse(process.argv);

  const opts = program.opts<{ briefs: string; runs: string; output: string; url?: string; local: boolean }>();

  // Resolve endpoint URL
  if (opts.url) {
    PIPELINE_URL = opts.url;
  } else if (opts.local) {
    PIPELINE_URL = LOCAL_URL;
  } else {
    PIPELINE_URL = LOCAL_URL; // default to local
  }
  const numRuns = Math.max(1, parseInt(opts.runs, 10) || 3);

  const briefFilter = opts.briefs
    ? opts.briefs.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const briefsDir = join(TOOL_ROOT, "briefs");
  const briefs = await loadBriefs(briefsDir, briefFilter);

  if (briefs.length === 0) {
    console.error("No briefs found. Check briefs/ directory and --briefs filter.");
    process.exit(1);
  }

  // Output directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outputDir = opts.output
    ? resolve(opts.output)
    : join(TOOL_ROOT, "results", `${timestamp}_e2e-pipeline`);
  await mkdir(outputDir, { recursive: true });

  console.log(`\nE2E Pipeline Benchmark`);
  console.log(`Endpoint: ${PIPELINE_URL}`);
  console.log(`Briefs: ${briefs.map((b) => b.id).join(", ")}`);
  console.log(`Runs per fixture: ${numRuns}`);
  console.log(`Output: ${outputDir}\n`);

  const allResults: E2ERunResult[] = [];
  const totalCalls = briefs.length * numRuns;
  let callIdx = 0;

  for (const brief of briefs) {
    for (let run = 1; run <= numRuns; run++) {
      callIdx++;
      const pct = ((callIdx / totalCalls) * 100).toFixed(0);
      process.stdout.write(
        `[${callIdx}/${totalCalls} ${pct}%] ${brief.id} run ${run}/${numRuns} ... `
      );

      const result = await runOnce(brief, run);
      allResults.push(result);

      const status = result.post_pipeline_pass ? "PASS" : "FAIL";
      const scoreStr = result.post_pipeline_score?.overall_score != null
        ? result.post_pipeline_score.overall_score.toFixed(3)
        : "n/a";
      const repairStr = result.repair_operations > 0 || result.llm_repair_needed
        ? ` [repaired: ${result.repair_operations} det, llm=${result.llm_repair_needed}]`
        : "";

      console.log(
        `${status} (${scoreStr}) ${(result.latency_ms / 1000).toFixed(1)}s${repairStr}${result.error ? ` ERROR: ${result.error.slice(0, 60)}` : ""}`
      );

      // Save individual response (result + raw body for deeper analysis)
      const responseFile = join(outputDir, `${brief.id}_run${run}.json`);
      await writeFile(responseFile, JSON.stringify(result, null, 2), "utf-8");

      // Rate-limit delay (skip on last call)
      if (callIdx < totalCalls) {
        await new Promise((r) => setTimeout(r, INTER_REQUEST_DELAY_MS));
      }
    }
  }

  // Generate and save reports
  const reportMd = generateReport(allResults, briefs);
  const reportCsv = generateCsv(allResults);

  await writeFile(join(outputDir, "report.md"), reportMd, "utf-8");
  await writeFile(join(outputDir, "results.csv"), reportCsv, "utf-8");
  // Strip response_body from all-results to keep it small; individual files have full data
  const slimResults = allResults.map(({ response_body, ...rest }) => rest);
  await writeFile(join(outputDir, "all-results.json"), JSON.stringify(slimResults, null, 2), "utf-8");

  console.log(`\nResults saved to: ${outputDir}`);
  console.log(`  report.md    — full analysis`);
  console.log(`  results.csv  — tabular data`);

  // Print summary
  const httpOk = allResults.filter((r) => r.http_status === 200);
  const ppPass = httpOk.filter((r) => r.post_pipeline_pass);
  const effectiveRate = httpOk.length > 0 ? (ppPass.length / httpOk.length) * 100 : 0;

  console.log(`\n── Summary ──`);
  console.log(`Total runs: ${allResults.length}`);
  console.log(`HTTP 200: ${httpOk.length}`);
  console.log(`Post-pipeline pass: ${ppPass.length}/${httpOk.length} (${effectiveRate.toFixed(1)}%)`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
