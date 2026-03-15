/**
 * Regression Check
 *
 * Compares a new evaluator run against previously captured golden responses.
 * Reports four types of regression:
 *   1. Score delta — overall score drop > threshold (default 0.05)
 *   2. Pass/fail flip — golden passed but new fails (or vice versa)
 *   3. Mode/tool change — tool_selected or response mode changed
 *   4. Structural drift — node or edge count changed by > 20%
 *
 * Outputs a tri-state summary: PASS / WARN / FAIL
 *
 * Usage:
 *   npx tsx scripts/regression-check.ts --run-id <run_id> --golden draft_graph
 *   npx tsx scripts/regression-check.ts --run-id <run_id> --golden edit_graph --threshold 0.03
 *
 * Exit codes:
 *   0 — PASS (no regressions)
 *   1 — FAIL (score drops > threshold or pass→fail flip)
 *   2 — configuration error or missing golden baseline
 */

import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

import { loadResponse } from "../src/io.js";

import { DraftGraphAdapter } from "../src/adapters/draft-graph.js";
import { EditGraphAdapter } from "../src/adapters/edit-graph.js";
import { DecisionReviewAdapter } from "../src/adapters/decision-review.js";
import { OrchestratorAdapter } from "../src/adapters/orchestrator.js";

import type {
  PromptType,
  EvaluatorAdapter,
  GenericScoreResult,
  LLMResponse,
} from "../src/types.js";

// ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TOOL_ROOT = resolve(__dirname, "..");

// ============================================================================
// Types
// ============================================================================

interface GoldenEntry {
  brief_id: string;
  model: string;
  prompt_hash: string;
  response: LLMResponse;
  scores: Record<string, boolean | number | null>;
  overall: number | null;
  captured_at: string;
}

interface GoldenManifest {
  captured_at: string;
  git_sha: string;
  source_run_id: string;
  prompt_type: PromptType;
  prompt_hash: string;
  models: string[];
  fixture_count: number;
  entry_count: number;
}

type IssueLevel = "fail" | "warn" | "info";

interface RegressionIssue {
  level: IssueLevel;
  type: "score_drop" | "pass_fail_flip" | "mode_change" | "structural_drift" | "missing";
  detail: string;
}

interface ComparisonResult {
  brief_id: string;
  model_id: string;
  golden_overall: number | null;
  new_overall: number | null;
  delta: number | null;
  issues: RegressionIssue[];
  dimension_changes: Array<{
    dimension: string;
    golden: boolean | number | null;
    new_val: boolean | number | null;
    flipped: boolean;
  }>;
}

// ============================================================================
// Adapter resolution
// ============================================================================

function getAdapter(type: PromptType): EvaluatorAdapter {
  switch (type) {
    case "draft_graph": return new DraftGraphAdapter();
    case "edit_graph": return new EditGraphAdapter();
    case "decision_review": return new DecisionReviewAdapter();
    case "orchestrator": return new OrchestratorAdapter();
    default: throw new Error(`Unsupported prompt type: ${type}`);
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function loadJson<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf-8");
  return JSON.parse(content) as T;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

/** Count nodes and edges in a parsed graph response */
function countStructure(response: LLMResponse): { nodes: number; edges: number } {
  const graph = response.parsed_graph ?? (response.parsed_json as Record<string, unknown> | null);
  if (!graph || typeof graph !== "object") return { nodes: 0, edges: 0 };
  const nodes = Array.isArray((graph as Record<string, unknown>).nodes) ? ((graph as Record<string, unknown>).nodes as unknown[]).length : 0;
  const edges = Array.isArray((graph as Record<string, unknown>).edges) ? ((graph as Record<string, unknown>).edges as unknown[]).length : 0;
  return { nodes, edges };
}

/** Check if a pass/fail flip occurred on any boolean dimension */
function detectPassFailFlips(
  goldenDims: Record<string, boolean | number | null>,
  newDims: Record<string, boolean | number | null>,
): Array<{ dim: string; golden: boolean; new_val: boolean }> {
  const flips: Array<{ dim: string; golden: boolean; new_val: boolean }> = [];
  for (const [dim, gv] of Object.entries(goldenDims)) {
    const nv = newDims[dim];
    if (typeof gv === "boolean" && typeof nv === "boolean" && gv !== nv) {
      flips.push({ dim, golden: gv, new_val: nv });
    }
  }
  return flips;
}

/** Detect mode/tool selection changes by checking response metadata */
function detectModeChange(
  goldenResponse: LLMResponse,
  newResponse: LLMResponse,
): string | null {
  // Check if tool_use content changed
  const goldenTool = extractToolName(goldenResponse);
  const newTool = extractToolName(newResponse);
  if (goldenTool !== newTool) {
    return `tool changed: ${goldenTool ?? "none"} → ${newTool ?? "none"}`;
  }
  return null;
}

function extractToolName(response: LLMResponse): string | null {
  const raw = response.raw_text ?? "";
  // Check for tool_calls in XML
  const match = raw.match(/<tool\s+name="([^"]+)"/);
  return match ? match[1] : null;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const idx = args.indexOf(name);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  const runId = getArg("--run-id");
  const goldenType = getArg("--golden") as PromptType | undefined;
  const thresholdStr = getArg("--threshold");
  const threshold = thresholdStr ? parseFloat(thresholdStr) : 0.05;
  const structuralDriftPct = 0.20; // 20% node/edge count change

  if (!runId || !goldenType) {
    console.error("Usage: npx tsx scripts/regression-check.ts --run-id <run_id> --golden <prompt_type> [--threshold <num>]");
    process.exit(2);
  }

  const typeDirName = goldenType.replace(/_/g, "-");
  const goldenDir = join(TOOL_ROOT, "golden-responses", typeDirName);
  const resultsDir = join(TOOL_ROOT, "results");

  // Load golden manifest
  const manifestPath = join(goldenDir, "manifest.json");
  if (!(await fileExists(manifestPath))) {
    console.error(`❌ No golden baseline found at ${manifestPath}`);
    console.error(`   Run capture-golden-responses.ts first.`);
    process.exit(2);
  }

  const manifest = await loadJson<GoldenManifest>(manifestPath);
  console.log(`\n📋 Regression check: ${goldenType}`);
  console.log(`   Golden baseline: ${manifest.source_run_id} (captured ${manifest.captured_at})`);
  console.log(`   New run:         ${runId}`);
  console.log(`   Threshold:       ${threshold} (score deltas > this trigger FAIL)`);
  console.log(`   Structural:      ${(structuralDriftPct * 100).toFixed(0)}% node/edge drift triggers WARN`);
  console.log(`   Models:          ${manifest.models.join(", ")}`);
  console.log();

  // Load adapter for re-scoring
  const adapter = getAdapter(goldenType);
  const fixtureDir = join(TOOL_ROOT, "fixtures", typeDirName);
  const allFixtures = await adapter.loadCases(fixtureDir);
  const fixtureMap = new Map(allFixtures.map((f: { id: string }) => [f.id, f]));

  // Compare
  const comparisons: ComparisonResult[] = [];
  let failCount = 0;
  let warnCount = 0;
  let passCount = 0;

  for (const modelId of manifest.models) {
    const briefIds = Object.keys(manifest.briefs ?? {});
    // If manifest doesn't have briefs, scan fixture IDs
    const idsToCheck = briefIds.length > 0 ? briefIds : allFixtures.map((f: { id: string }) => f.id);

    for (const briefId of idsToCheck) {
      const goldenPath = join(goldenDir, modelId, `${briefId}.json`);
      const issues: RegressionIssue[] = [];

      // Load golden entry
      let goldenEntry: GoldenEntry | null = null;
      if (await fileExists(goldenPath)) {
        goldenEntry = await loadJson<GoldenEntry>(goldenPath);
      }

      // Load new response
      const newResponse = await loadResponse(resultsDir, runId, modelId, briefId);

      if (!goldenEntry && !newResponse) continue;

      if (!newResponse) {
        issues.push({ level: "warn", type: "missing", detail: "No response in new run" });
        comparisons.push({
          brief_id: briefId, model_id: modelId,
          golden_overall: goldenEntry?.overall ?? null, new_overall: null,
          delta: null, issues, dimension_changes: [],
        });
        warnCount++;
        continue;
      }

      if (!goldenEntry) {
        issues.push({ level: "info", type: "missing", detail: "New fixture — no golden baseline" });
        const fixture = fixtureMap.get(briefId);
        const newScore = fixture
          ? adapter.score(fixture, newResponse.parsed_json ?? newResponse.parsed_graph ?? null, newResponse)
          : { overall: null, dimensions: {} } as GenericScoreResult;
        comparisons.push({
          brief_id: briefId, model_id: modelId,
          golden_overall: null, new_overall: newScore.overall,
          delta: null, issues, dimension_changes: [],
        });
        passCount++;
        continue;
      }

      // Score new response
      const fixture = fixtureMap.get(briefId);
      const newScore = fixture
        ? adapter.score(fixture, newResponse.parsed_json ?? newResponse.parsed_graph ?? null, newResponse)
        : { overall: null, dimensions: {} } as GenericScoreResult;

      // --- Check 1: Score delta ---
      const goldenOverall = goldenEntry.overall;
      const newOverall = newScore.overall;
      let delta: number | null = null;
      if (goldenOverall !== null && newOverall !== null) {
        delta = newOverall - goldenOverall;
        if (delta < -threshold) {
          issues.push({ level: "fail", type: "score_drop", detail: `Overall dropped ${delta.toFixed(3)} (${goldenOverall.toFixed(3)} → ${newOverall.toFixed(3)})` });
        }
      }

      // --- Check 2: Pass/fail flips ---
      const flips = detectPassFailFlips(goldenEntry.scores, newScore.dimensions);
      for (const flip of flips) {
        if (flip.golden === true && flip.new_val === false) {
          // Pass→fail is FAIL-level
          issues.push({ level: "fail", type: "pass_fail_flip", detail: `${flip.dim}: pass→fail` });
        } else {
          // Fail→pass is improvement (info)
          issues.push({ level: "info", type: "pass_fail_flip", detail: `${flip.dim}: fail→pass (improvement)` });
        }
      }

      // --- Check 3: Mode/tool change ---
      const modeChange = detectModeChange(goldenEntry.response, newResponse);
      if (modeChange) {
        issues.push({ level: "warn", type: "mode_change", detail: modeChange });
      }

      // --- Check 4: Structural drift ---
      const goldenStructure = countStructure(goldenEntry.response);
      const newStructure = countStructure(newResponse);
      if (goldenStructure.nodes > 0) {
        const nodeDrift = Math.abs(newStructure.nodes - goldenStructure.nodes) / goldenStructure.nodes;
        if (nodeDrift > structuralDriftPct) {
          issues.push({ level: "warn", type: "structural_drift", detail: `Node count: ${goldenStructure.nodes} → ${newStructure.nodes} (${(nodeDrift * 100).toFixed(0)}% drift)` });
        }
      }
      if (goldenStructure.edges > 0) {
        const edgeDrift = Math.abs(newStructure.edges - goldenStructure.edges) / goldenStructure.edges;
        if (edgeDrift > structuralDriftPct) {
          issues.push({ level: "warn", type: "structural_drift", detail: `Edge count: ${goldenStructure.edges} → ${newStructure.edges} (${(edgeDrift * 100).toFixed(0)}% drift)` });
        }
      }

      // Build dimension changes
      const dimensionChanges: ComparisonResult["dimension_changes"] = [];
      const allDims = new Set([
        ...Object.keys(goldenEntry.scores),
        ...Object.keys(newScore.dimensions),
      ]);
      for (const dim of allDims) {
        const gv = goldenEntry.scores[dim] ?? null;
        const nv = newScore.dimensions[dim] ?? null;
        const flipped = typeof gv === "boolean" && typeof nv === "boolean" && gv !== nv;
        dimensionChanges.push({ dimension: dim, golden: gv, new_val: nv, flipped });
      }

      // Determine comparison-level status
      const hasFail = issues.some(i => i.level === "fail");
      const hasWarn = issues.some(i => i.level === "warn");
      if (hasFail) failCount++;
      else if (hasWarn) warnCount++;
      else passCount++;

      comparisons.push({
        brief_id: briefId, model_id: modelId,
        golden_overall: goldenOverall, new_overall: newOverall,
        delta, issues, dimension_changes: dimensionChanges,
      });
    }
  }

  // ============================================================================
  // Report
  // ============================================================================

  console.log("─".repeat(90));
  console.log("  Model             | Brief                      | Golden | New    | Delta  | Status");
  console.log("─".repeat(90));

  for (const c of comparisons) {
    const model = c.model_id.padEnd(18);
    const brief = c.brief_id.padEnd(26);
    const golden = c.golden_overall !== null ? c.golden_overall.toFixed(3).padStart(6) : "  N/A ";
    const newVal = c.new_overall !== null ? c.new_overall.toFixed(3).padStart(6) : "  N/A ";
    const delta = c.delta !== null ? (c.delta >= 0 ? "+" : "") + c.delta.toFixed(3) : " N/A ";

    const hasFail = c.issues.some(i => i.level === "fail");
    const hasWarn = c.issues.some(i => i.level === "warn");
    const icon = hasFail ? "🔴 FAIL" : hasWarn ? "🟡 WARN" : "🟢 PASS";

    console.log(`  ${model} | ${brief} | ${golden} | ${newVal} | ${delta.padStart(6)} | ${icon}`);

    // Print issues
    for (const issue of c.issues) {
      const prefix = issue.level === "fail" ? "  🔴" : issue.level === "warn" ? "  🟡" : "  ℹ️ ";
      console.log(`                     └─ ${prefix} [${issue.type}] ${issue.detail}`);
    }
  }

  console.log("─".repeat(90));
  console.log();

  // Overall means
  const goldenMean = comparisons
    .filter(c => c.golden_overall !== null)
    .reduce((sum, c) => sum + c.golden_overall!, 0) /
    Math.max(1, comparisons.filter(c => c.golden_overall !== null).length);

  const newMean = comparisons
    .filter(c => c.new_overall !== null)
    .reduce((sum, c) => sum + c.new_overall!, 0) /
    Math.max(1, comparisons.filter(c => c.new_overall !== null).length);

  console.log(`📊 Score summary:`);
  console.log(`   Golden mean: ${goldenMean.toFixed(3)}`);
  console.log(`   New mean:    ${newMean.toFixed(3)}`);
  console.log(`   Delta:       ${(newMean - goldenMean >= 0 ? "+" : "")}${(newMean - goldenMean).toFixed(3)}`);
  console.log();

  // Tri-state summary
  console.log(`📋 Comparison summary: ${comparisons.length} briefs checked`);
  console.log(`   🟢 PASS: ${passCount}`);
  console.log(`   🟡 WARN: ${warnCount}`);
  console.log(`   🔴 FAIL: ${failCount}`);
  console.log();

  // Issue breakdown
  const issuesByType = new Map<string, number>();
  for (const c of comparisons) {
    for (const issue of c.issues) {
      const key = `${issue.level}:${issue.type}`;
      issuesByType.set(key, (issuesByType.get(key) ?? 0) + 1);
    }
  }
  if (issuesByType.size > 0) {
    console.log(`   Issue breakdown:`);
    for (const [key, count] of [...issuesByType.entries()].sort()) {
      const [level, type] = key.split(":");
      const icon = level === "fail" ? "🔴" : level === "warn" ? "🟡" : "ℹ️ ";
      console.log(`     ${icon} ${type}: ${count}`);
    }
    console.log();
  }

  // Final verdict
  if (failCount > 0) {
    console.log(`❌ FAIL — ${failCount} regression(s) detected (threshold: ${threshold})`);
    console.log(`   Score drops > ${threshold} or pass→fail flips require investigation.`);
    process.exit(1);
  } else if (warnCount > 0) {
    console.log(`⚠️  WARN — ${warnCount} warning(s) detected`);
    console.log(`   Mode/tool changes or structural drift detected. Review recommended.`);
    process.exit(0);
  } else {
    console.log(`✅ PASS — no regressions detected`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
