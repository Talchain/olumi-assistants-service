/**
 * Benchmark Runner
 *
 * Orchestrates the full parametric edge stability benchmark:
 * 1. Selects briefs based on mode (nightly = all, on-demand = 3)
 * 2. Runs each brief N times with different seeds
 * 3. Matches nodes/edges across runs
 * 4. Computes stability and aggregate metrics
 * 5. Optionally runs prompt sensitivity analysis
 * 6. Assembles full report with reproducibility metadata
 */

import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { GOLD_BRIEF_SET } from "./gold-briefs/gold-briefs.js";
import type { GoldBrief } from "./gold-briefs/types.js";
import { matchRuns, normaliseLabel } from "./matching.js";
import { computeBriefStabilityMetrics } from "./stability-metrics.js";
import { computeAggregateMetrics } from "./aggregate-metrics.js";
import { generateTransformedBriefs } from "./prompt-sensitivity.js";
import type { SensitivityComparison } from "./prompt-sensitivity.js";
import {
  checkAlerts,
  computeSummary,
  type BenchmarkReport,
  type BriefReport,
  type ReproducibilityMetadata,
  type SensitivityReport,
} from "./report-types.js";
import type { NodeV3T, EdgeV3T, OptionV3T } from "../../src/schemas/cee-v3.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface BenchmarkConfig {
  mode: "nightly" | "on-demand";
  /** Number of seed-varied runs per brief */
  runs_per_brief: number;
  /** Brief IDs to run (null = all) */
  brief_ids?: string[];
  /** Whether to run prompt sensitivity analysis */
  run_sensitivity: boolean;
  /** Fastify app factory — allows injection of pre-configured app */
  createApp?: () => Promise<FastifyInstance>;
}

const NIGHTLY_CONFIG: BenchmarkConfig = {
  mode: "nightly",
  runs_per_brief: 5,
  run_sensitivity: true,
};

const ON_DEMAND_CONFIG: BenchmarkConfig = {
  mode: "on-demand",
  runs_per_brief: 3,
  brief_ids: ["gold_001", "gold_003", "gold_005"],
  run_sensitivity: false,
};

export function getNightlyConfig(): BenchmarkConfig {
  return { ...NIGHTLY_CONFIG };
}

export function getOnDemandConfig(): BenchmarkConfig {
  return { ...ON_DEMAND_CONFIG };
}

// ---------------------------------------------------------------------------
// Seed Generation
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic seed sequence for benchmark runs.
 * Seeds are string-formatted for CEE compatibility.
 */
export function generateSeedSequence(count: number): string[] {
  const seeds: string[] = [];
  for (let i = 0; i < count; i++) {
    seeds.push(`bench_seed_${i + 1}`);
  }
  return seeds;
}

// ---------------------------------------------------------------------------
// CEE Invocation
// ---------------------------------------------------------------------------

interface CEERunResult {
  success: boolean;
  nodes?: NodeV3T[];
  edges?: EdgeV3T[];
  options?: OptionV3T[];
  raw_body?: unknown;
  error?: string;
}

/**
 * Call the CEE draft-graph endpoint for a single brief+seed combination.
 */
async function runCEE(
  app: FastifyInstance,
  briefText: string,
  seed: string,
): Promise<CEERunResult> {
  const res = await app.inject({
    method: "POST",
    url: "/assist/draft-graph",
    payload: { brief: briefText, seed },
  });

  if (res.statusCode !== 200) {
    return { success: false, error: `HTTP ${res.statusCode}: ${res.body}` };
  }

  try {
    const body = JSON.parse(res.body);
    // V3 responses have nodes/edges at root; V1 has them under graph
    const nodes: NodeV3T[] = body.nodes ?? body.graph?.nodes ?? [];
    const edges: EdgeV3T[] = body.edges ?? body.graph?.edges ?? [];
    const options: OptionV3T[] = body.options ?? [];

    return { success: true, nodes, edges, options, raw_body: body };
  } catch (e) {
    return { success: false, error: `Parse error: ${e}` };
  }
}

// ---------------------------------------------------------------------------
// Metadata Collection (Fix #5: read from runtime config, not just env)
// ---------------------------------------------------------------------------

async function collectMetadata(
  config: BenchmarkConfig,
  seeds: string[],
): Promise<ReproducibilityMetadata> {
  let commitHash = "unknown";
  try {
    const { execSync } = await import("node:child_process");
    commitHash = execSync("git rev-parse HEAD", { encoding: "utf-8", timeout: 1000 }).trim();
  } catch { /* noop */ }

  // Try to read model name/version from runtime config (lazy proxy).
  // Falls back to env vars if config import fails (e.g. in isolation tests).
  // model_name = concrete model ID (e.g. "claude-sonnet-4-5-20250929", "gpt-4o")
  // model_version = provider name (e.g. "anthropic", "openai", "fixtures")
  let modelName: string | undefined = process.env.LLM_MODEL ?? undefined;
  let modelVersion = process.env.LLM_PROVIDER ?? "fixtures";
  let promptVersion: string | undefined = process.env.CEE_DRAFT_FEATURE_VERSION ?? undefined;
  try {
    const { config: runtimeConfig } = await import("../../src/config/index.js");
    modelName = runtimeConfig.llm.model ?? modelName;
    modelVersion = runtimeConfig.llm.provider ?? modelVersion;
    promptVersion = runtimeConfig.cee.draftFeatureVersion ?? promptVersion;
  } catch { /* noop — config may not be loadable in test context */ }

  return {
    gold_set_version: GOLD_BRIEF_SET.gold_set_version,
    cee_commit_hash: commitHash,
    model_name: modelName,
    model_version: modelVersion,
    prompt_version: promptVersion,
    temperature: undefined, // Not currently configurable in CEE
    seed_sequence: seeds,
    timestamp: new Date().toISOString(),
    mode: config.mode,
  };
}

// ---------------------------------------------------------------------------
// Brief Benchmark
// ---------------------------------------------------------------------------

interface RunGraphData {
  nodes: NodeV3T[];
  edges: EdgeV3T[];
  options?: OptionV3T[];
}

async function benchmarkBrief(
  app: FastifyInstance,
  brief: GoldBrief,
  seeds: string[],
  config: BenchmarkConfig,
): Promise<BriefReport | null> {
  const runs: RunGraphData[] = [];
  const responses: Array<{ nodes?: NodeV3T[]; options?: OptionV3T[] }> = [];
  const failedSeeds: string[] = [];

  for (const seed of seeds) {
    const result = await runCEE(app, brief.brief_text, seed);
    if (!result.success || !result.nodes || !result.edges) {
      console.warn(`  [WARN] Run failed for ${brief.id} seed=${seed}: ${result.error}`);
      failedSeeds.push(seed);
      continue;
    }
    runs.push({ nodes: result.nodes, edges: result.edges, options: result.options });
    responses.push({ nodes: result.nodes, options: result.options });
  }

  // Fix #4: Nightly requires full seed completion. On-demand allows partial (≥2).
  if (config.mode === "nightly" && runs.length < seeds.length) {
    console.warn(
      `  [FAIL] ${brief.id}: nightly requires ${seeds.length}/${seeds.length} seeds, ` +
        `got ${runs.length}. Failed: [${failedSeeds.join(", ")}]`,
    );
    return null;
  }
  if (runs.length < 2) {
    console.warn(`  [SKIP] ${brief.id}: only ${runs.length} successful runs (need ≥2)`);
    return null;
  }

  // Match nodes and edges
  const matchResult = matchRuns(runs);

  // Compute metrics
  const stability = computeBriefStabilityMetrics(brief.id, matchResult);
  const aggregate = computeAggregateMetrics(brief.id, responses);
  const alerts = checkAlerts(stability, aggregate);

  return {
    brief_id: brief.id,
    domain: brief.domain,
    stability,
    aggregate,
    alerts,
    // Fix #4: record completion metadata
    completed_runs: runs.length,
    expected_runs: seeds.length,
  };
}

// ---------------------------------------------------------------------------
// Node-Set Comparison Helpers (Fix #3)
// ---------------------------------------------------------------------------

/**
 * Extract a set of normalised node "signatures" (kind:normalised_label)
 * for semantic node-set comparison across runs.
 * Much stronger than just comparing sorted kinds.
 */
function nodeSetSignature(nodes: NodeV3T[]): Set<string> {
  return new Set(
    nodes.map((n) => `${n.kind}:${normaliseLabel(n.label)}`),
  );
}

/**
 * Extract normalised option labels from a run's output.
 */
function extractOptionLabels(run: RunGraphData): Set<string> {
  const optionNodes = run.options?.length
    ? run.options
    : run.nodes.filter((n) => n.kind === "option");
  return new Set(optionNodes.map((o) => normaliseLabel(o.label)));
}

// ---------------------------------------------------------------------------
// Sensitivity Benchmark (Fix #3: stronger comparison)
// ---------------------------------------------------------------------------

async function benchmarkSensitivity(
  app: FastifyInstance,
  seeds: string[],
): Promise<SensitivityReport[]> {
  const reports: SensitivityReport[] = [];

  for (const sensitivityBrief of GOLD_BRIEF_SET.sensitivity_briefs) {
    const comparisons: SensitivityComparison[] = [];

    // First, run the original brief with all seeds to get baseline seed variation
    const baselineRuns: RunGraphData[] = [];
    for (const seed of seeds) {
      const result = await runCEE(app, sensitivityBrief.brief_text, seed);
      if (result.success && result.nodes && result.edges) {
        baselineRuns.push({ nodes: result.nodes, edges: result.edges, options: result.options });
      }
    }

    if (baselineRuns.length < 2) continue;

    const baselineMatch = matchRuns(baselineRuns);
    const baselineStability = computeBriefStabilityMetrics(sensitivityBrief.id, baselineMatch);

    // Baseline reference (first run) — used for per-transformation comparison
    const baselineRef = baselineRuns[0]!;
    const baselineNodeSig = nodeSetSignature(baselineRef.nodes);
    const baselineOptLabels = extractOptionLabels(baselineRef);

    // Generate and run each transformation
    const transformedBriefs = generateTransformedBriefs(sensitivityBrief);

    for (const tb of transformedBriefs) {
      // Single run with the first seed
      const result = await runCEE(app, tb.text, seeds[0]!);
      if (!result.success || !result.nodes || !result.edges) {
        continue;
      }

      // Compare perturbation against baseline using matching layer
      const perturbRuns = [
        baselineRef,
        { nodes: result.nodes, edges: result.edges, options: result.options },
      ];
      const perturbMatch = matchRuns(perturbRuns);
      const perturbStability = computeBriefStabilityMetrics(sensitivityBrief.id, perturbMatch);

      // Fix #3: semantic node-set comparison (kind:label, not just kind)
      const perturbNodeSig = nodeSetSignature(result.nodes);
      const nodeSetChanged =
        baselineNodeSig.size !== perturbNodeSig.size ||
        [...baselineNodeSig].some((sig) => !perturbNodeSig.has(sig));

      // Fix #3: option label comparison (previously computed but unused)
      const perturbOptLabels = extractOptionLabels({
        nodes: result.nodes,
        edges: result.edges,
        options: result.options,
      });
      const optionCountChanged = baselineOptLabels.size !== perturbOptLabels.size;

      comparisons.push({
        brief_id: sensitivityBrief.id,
        transformation: tb.transformation,
        option_count_changed: optionCountChanged,
        node_set_changed: nodeSetChanged,
        perturbation_structural_stability: perturbStability.structural_stability,
        seed_structural_stability: baselineStability.structural_stability,
        perturbation_exceeds_seed:
          perturbStability.structural_stability < baselineStability.structural_stability,
      });
    }

    reports.push({ brief_id: sensitivityBrief.id, comparisons });
  }

  return reports;
}

// ---------------------------------------------------------------------------
// Main Runner
// ---------------------------------------------------------------------------

/**
 * Run the full parametric edge stability benchmark.
 */
export async function runBenchmark(config: BenchmarkConfig): Promise<BenchmarkReport> {
  const seeds = generateSeedSequence(config.runs_per_brief);
  const metadata = await collectMetadata(config, seeds);

  // Select briefs
  const briefs = config.brief_ids
    ? GOLD_BRIEF_SET.briefs.filter((b) => config.brief_ids!.includes(b.id))
    : GOLD_BRIEF_SET.briefs;

  console.log(`\n=== Parametric Edge Stability Benchmark ===`);
  console.log(`Mode: ${config.mode}`);
  console.log(`Briefs: ${briefs.length}`);
  console.log(`Runs per brief: ${config.runs_per_brief}`);
  console.log(`Seeds: [${seeds.join(", ")}]`);
  console.log(`Gold set version: ${GOLD_BRIEF_SET.gold_set_version}`);
  console.log(`Commit: ${metadata.cee_commit_hash.slice(0, 7)}`);
  console.log(`Provider: ${metadata.model_version}`);
  console.log(`Model: ${metadata.model_name ?? "unknown"}`);
  console.log();

  // Create app
  let app: FastifyInstance;
  if (config.createApp) {
    app = await config.createApp();
  } else {
    const draftRoute = (await import("../../src/routes/assist.draft-graph.js")).default;
    app = Fastify({ logger: false });
    await draftRoute(app);
  }

  // Run per-brief benchmarks — track dropped briefs explicitly
  const briefReports: BriefReport[] = [];
  const droppedBriefIds: string[] = [];
  for (const brief of briefs) {
    console.log(`Running ${brief.id} (${brief.domain})...`);
    const report = await benchmarkBrief(app, brief, seeds, config);
    if (report) {
      briefReports.push(report);
      const alertStr = [
        report.alerts.high_cv_edges ? "HIGH_CV" : null,
        report.alerts.low_structural_stability ? "LOW_STRUCT" : null,
        report.alerts.option_set_changes ? "OPT_CHANGE" : null,
      ]
        .filter(Boolean)
        .join(", ");
      console.log(
        `  structural_stability=${(report.stability.structural_stability * 100).toFixed(1)}%` +
          ` node_stable=${report.stability.node_set_stable}` +
          ` opt_stable=${report.aggregate.option_set_stability.count_stable}` +
          ` runs=${report.completed_runs}/${report.expected_runs}` +
          (alertStr ? ` ALERTS=[${alertStr}]` : ""),
      );
    } else {
      droppedBriefIds.push(brief.id);
      console.log(`  [DROPPED] ${brief.id}`);
    }
  }

  // Run sensitivity analysis
  let sensitivityReports: SensitivityReport[] = [];
  if (config.run_sensitivity) {
    console.log("\nRunning prompt sensitivity analysis...");
    sensitivityReports = await benchmarkSensitivity(app, seeds);
    for (const sr of sensitivityReports) {
      console.log(`  ${sr.brief_id}: ${sr.comparisons.length} transformations`);
      for (const c of sr.comparisons) {
        console.log(
          `    ${c.transformation}: struct=${(c.perturbation_structural_stability * 100).toFixed(1)}%` +
            ` opt_changed=${c.option_count_changed} node_changed=${c.node_set_changed}` +
            ` exceeds_seed=${c.perturbation_exceeds_seed}`,
        );
      }
    }
  }

  // Assemble report
  const summary = computeSummary(briefReports);
  const report: BenchmarkReport = {
    metadata,
    brief_reports: briefReports,
    dropped_brief_ids: droppedBriefIds,
    sensitivity_reports: sensitivityReports,
    summary,
  };

  console.log("\n=== Summary ===");
  console.log(`Total briefs: ${summary.total_briefs}`);
  console.log(`Briefs with alerts: ${summary.briefs_with_alerts}`);
  console.log(`Avg structural stability: ${(summary.average_structural_stability * 100).toFixed(1)}%`);
  console.log(`Avg node set stability: ${(summary.average_node_set_stability_rate * 100).toFixed(1)}%`);
  console.log(`Avg option count stability: ${(summary.average_option_count_stability_rate * 100).toFixed(1)}%`);
  if (droppedBriefIds.length > 0) {
    console.log(`Dropped briefs: ${droppedBriefIds.join(", ")}`);
  }
  if (summary.flagged_brief_ids.length > 0) {
    console.log(`Flagged briefs: ${summary.flagged_brief_ids.join(", ")}`);
  }

  await app.close();

  return report;
}
