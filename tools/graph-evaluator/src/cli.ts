/**
 * CLI entry point for the graph evaluator.
 *
 * Supports three prompt types via --type flag:
 *   draft_graph (default), edit_graph, decision_review
 *
 * Uses a per-type adapter pattern — each type has its own fixture loader,
 * request builder, response parser, and scorer.
 *
 * Usage:
 *   npx tsx src/cli.ts --type draft_graph --prompt prompts/v170.txt --models gpt-4o
 *   npx tsx src/cli.ts --type edit_graph --prompt prompts/edit_graph_v2.txt --models gpt-4o --cases all
 *   npx tsx src/cli.ts --type decision_review --prompt prompts/decision_review_v11.txt --models gpt-4o
 */

import { config as loadDotenv } from "dotenv";
import { Command } from "commander";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, access } from "node:fs/promises";

import { run } from "./runner.js";
import { score } from "./scorer.js";
import { generate } from "./reporter.js";
import {
  readModels,
  readBriefs,
  readPrompt,
  buildRunId,
  getGitSha,
  hashContent,
  hashFile,
  saveManifest,
  saveResponse,
  loadResponse,
  saveReports,
  ensureDir,
} from "./io.js";

import { DraftGraphAdapter } from "./adapters/draft-graph.js";
import { EditGraphAdapter } from "./adapters/edit-graph.js";
import { DecisionReviewAdapter } from "./adapters/decision-review.js";
import { ResearchAdapter, runResearchFixture } from "./adapters/research.js";
import { OrchestratorAdapter } from "./adapters/orchestrator.js";

import { judgeOrchestratorResponse } from "./orchestrator-judge.js";
import type {
  ScoredResult,
  RunManifest,
  RunConfig,
  PromptType,
  BaseFixture,
  GenericScoredResult,
  LLMResponse,
  EvaluatorAdapter,
  ResearchFixture,
  OrchestratorFixture,
  JudgeResult,
} from "./types.js";

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TOOL_ROOT = resolve(__dirname, "..");

// =============================================================================
// Version
// =============================================================================

const TOOL_VERSION = "2.0.0";

// =============================================================================
// Adapter resolution
// =============================================================================

function getAdapter(type: PromptType): EvaluatorAdapter {
  switch (type) {
    case "draft_graph":
      return new DraftGraphAdapter();
    case "edit_graph":
      return new EditGraphAdapter();
    case "decision_review":
      return new DecisionReviewAdapter();
    case "research":
      return new ResearchAdapter();
    case "orchestrator":
      return new OrchestratorAdapter();
    default:
      throw new Error(`Unknown prompt type: ${type}`);
  }
}

function getCasesDir(type: PromptType): string {
  switch (type) {
    case "draft_graph":
      return join(TOOL_ROOT, "briefs");
    case "edit_graph":
      return join(TOOL_ROOT, "fixtures", "edit-graph");
    case "decision_review":
      return join(TOOL_ROOT, "fixtures", "decision-review");
    case "research":
      return join(TOOL_ROOT, "fixtures", "research");
    case "orchestrator":
      return join(TOOL_ROOT, "fixtures", "orchestrator");
    default:
      throw new Error(`Unknown prompt type: ${type}`);
  }
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  // Load .env from tool root first, then fall back to repo root two levels up
  loadDotenv({ path: join(TOOL_ROOT, ".env") });
  loadDotenv({ path: join(TOOL_ROOT, "..", "..", ".env") });

  const program = new Command()
    .name("graph-evaluator")
    .description("Evaluate LLM prompt quality across models and test cases")
    .version(TOOL_VERSION)
    .requiredOption("--prompt <path>", "Path to the system prompt file (required)")
    .option(
      "--type <type>",
      "Prompt type: draft_graph, edit_graph, decision_review (default: draft_graph)",
      "draft_graph"
    )
    .option(
      "--models <ids>",
      "Comma-separated model IDs to run (default: all)",
      ""
    )
    .option(
      "--briefs <ids>",
      "Comma-separated brief/case IDs to run (default: all). Alias for --cases on draft_graph.",
      ""
    )
    .option(
      "--cases <ids>",
      "Comma-separated case IDs to run (default: all)",
      ""
    )
    .option("--force", "Force re-run even if cached results exist", false)
    .option(
      "--resume",
      "Re-run only entries marked as failed (parse_failed, timeout_failed, rate_limited)",
      false
    )
    .option("--dry-run", "List combinations without calling APIs", false)
    .option("--run-id <id>", "Resume a specific run ID instead of generating a new one")
    .option("--dsk-enabled", "Force DSK injection for all decision_review fixtures", false)
    .option("--judge", "Run LLM-as-judge scoring after structural eval (orchestrator only)", false)
    .option("--profile <fixture_id>", "Use assembled prompt from a profile fixture (Zone 2 registry)")
    .option("--zone1-only", "Use Zone 1 prompt only for baseline regression", false)
    .option("--runs <n>", "Number of independent runs for variance measurement (default: 1)", "1")
    .parse(process.argv);

  const opts = program.opts<{
    prompt: string;
    type: string;
    models: string;
    briefs: string;
    cases: string;
    force: boolean;
    resume: boolean;
    dryRun: boolean;
    runId?: string;
    dskEnabled: boolean;
    judge: boolean;
    profile?: string;
    zone1Only: boolean;
    runs: string;
  }>();

  const numRuns = Math.max(1, parseInt(opts.runs, 10) || 1);

  const promptType = opts.type as PromptType;
  if (!["draft_graph", "edit_graph", "decision_review", "research", "orchestrator"].includes(promptType)) {
    console.error(`Invalid --type: ${opts.type}. Must be draft_graph, edit_graph, decision_review, research, or orchestrator.`);
    process.exit(1);
  }

  // ── Resolve paths ──────────────────────────────────────────────────────────
  const promptPath = resolve(opts.prompt);
  const modelsDir = join(TOOL_ROOT, "models");
  const casesDir = getCasesDir(promptType);
  const resultsDir = join(TOOL_ROOT, "results");

  // ── Parse filter args ──────────────────────────────────────────────────────
  const modelFilter = opts.models
    ? opts.models.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  // --cases takes priority, --briefs is alias for backward compat
  // "all" is a sentinel meaning "no filter" — strip it so all cases run
  const caseFilterRaw = opts.cases || opts.briefs;
  const caseFilter = caseFilterRaw
    ? caseFilterRaw.split(",").map((s) => s.trim()).filter((s) => s && s !== "all")
    : [];

  // ── Load models ─────────────────────────────────────────────────────────────
  console.log("Loading configuration...");

  let models;
  try {
    models = await readModels(modelsDir, modelFilter.length > 0 ? modelFilter : undefined);
  } catch (err) {
    console.error(`Failed to load model configs from ${modelsDir}:`, err);
    process.exit(1);
  }

  if (models.length === 0) {
    console.error("No models found. Check models/ directory and --models filter.");
    process.exit(1);
  }

  // ── Load prompt ─────────────────────────────────────────────────────────────
  let promptContent;
  try {
    promptContent = await readPrompt(promptPath);
  } catch (err) {
    console.error(`Failed to read prompt file: ${promptPath}`, err);
    process.exit(1);
  }

  // Load reminder file from the same directory as the prompt file, if present.
  let reminderContent: string | undefined;
  const reminderPath = join(dirname(promptPath), "user-message-reminder.txt");
  try {
    await access(reminderPath);
    reminderContent = (await readFile(reminderPath, "utf-8")).trim();
    console.log(`Reminder: ${reminderPath}`);
  } catch {
    // No reminder file
  }

  // ── Route to type-specific or legacy path ──────────────────────────────────
  if (promptType === "orchestrator") {
    await runOrchestrator({
      promptPath,
      promptContent,
      models,
      modelsDir,
      casesDir,
      resultsDir,
      caseFilter,
      judge: opts.judge,
      profile: opts.profile,
      zone1Only: opts.zone1Only,
      opts,
    });
  } else if (promptType === "draft_graph") {
    await runDraftGraph({
      promptPath,
      promptContent,
      reminderContent,
      models,
      modelsDir,
      casesDir,
      resultsDir,
      caseFilter,
      numRuns,
      opts,
    });
  } else if (promptType === "research") {
    await runResearch({
      promptPath,
      promptContent,
      models,
      modelsDir,
      casesDir,
      resultsDir,
      caseFilter,
      opts,
    });
  } else {
    await runGenericType({
      promptType,
      promptPath,
      promptContent,
      reminderContent,
      models,
      modelsDir,
      casesDir,
      resultsDir,
      caseFilter,
      dskEnabled: opts.dskEnabled,
      numRuns,
      opts,
    });
  }
}

// =============================================================================
// Draft-graph legacy path (preserves exact existing behaviour)
// =============================================================================

interface DraftGraphRunArgs {
  promptPath: string;
  promptContent: string;
  reminderContent?: string;
  models: Awaited<ReturnType<typeof readModels>>;
  modelsDir: string;
  casesDir: string;
  resultsDir: string;
  caseFilter: string[];
  numRuns: number;
  opts: {
    prompt: string;
    force: boolean;
    resume: boolean;
    dryRun: boolean;
    runId?: string;
  };
}

async function runDraftGraph(args: DraftGraphRunArgs): Promise<void> {
  const { promptContent, reminderContent, models, modelsDir, casesDir, resultsDir, caseFilter, numRuns, opts } = args;

  let briefs;
  try {
    briefs = await readBriefs(casesDir, caseFilter.length > 0 ? caseFilter : undefined);
  } catch (err) {
    console.error(`Failed to load briefs from ${casesDir}:`, err);
    process.exit(1);
  }

  if (briefs.length === 0) {
    console.error("No briefs found. Check briefs/ directory and --briefs/--cases filter.");
    process.exit(1);
  }

  // Build run configuration
  const runId = opts.runId ?? buildRunId(opts.prompt);
  const timestamp = new Date().toISOString();
  const promptHash = hashContent(promptContent);
  const promptFilename = opts.prompt.split(/[/\\]/).pop() ?? opts.prompt;

  const config: RunConfig = {
    run_id: runId,
    timestamp,
    prompt_file: opts.prompt,
    prompt_content: promptContent,
    model_ids: models.map((m) => m.id),
    brief_ids: briefs.map((b) => b.id),
    force: opts.force,
    resume: opts.resume,
    dry_run: opts.dryRun,
    results_dir: resultsDir,
    prompt_type: "draft_graph",
  };

  // Dry run
  if (opts.dryRun) {
    console.log(`\n[Dry Run] Would execute ${models.length * briefs.length} combination(s):\n`);
    for (const model of models) {
      for (const brief of briefs) {
        console.log(`  ${model.id.padEnd(20)} × ${brief.id} [${brief.meta.complexity}]`);
      }
    }
    console.log(`\nPrompt: ${opts.prompt} (${promptHash})`);
    console.log(`Run ID would be: ${runId}`);
    return;
  }

  // Create results directory
  await ensureDir(join(resultsDir, runId));

  // Write run manifest
  const gitSha = getGitSha();
  const modelHashes: Record<string, { config_hash: string }> = {};
  for (const model of models) {
    try {
      const configPath = join(modelsDir, `${model.id}.json`);
      modelHashes[model.id] = { config_hash: await hashFile(configPath) };
    } catch {
      modelHashes[model.id] = { config_hash: "unknown" };
    }
  }

  const briefHashes: Record<string, { content_hash: string }> = {};
  for (const brief of briefs) {
    try {
      const briefPath = join(casesDir, `${brief.id}.md`);
      briefHashes[brief.id] = { content_hash: await hashFile(briefPath) };
    } catch {
      briefHashes[brief.id] = { content_hash: "unknown" };
    }
  }

  const manifest: RunManifest = {
    run_id: runId,
    timestamp,
    git_sha: gitSha,
    tool_version: TOOL_VERSION,
    cli_args: process.argv.slice(2),
    prompt: { filename: promptFilename, content_hash: promptHash },
    models: modelHashes,
    briefs: briefHashes,
  };

  await saveManifest(resultsDir, runId, manifest);

  // Run LLM calls
  console.log(`\nStarting run: ${runId}${numRuns > 1 ? ` (${numRuns} runs)` : ""}`);
  console.log(`Models: ${models.map((m) => m.id).join(", ")}`);
  console.log(`Briefs: ${briefs.map((b) => b.id).join(", ")}`);
  console.log();

  // Collect per-run scores for variance analysis
  const allRunScored: ScoredResult[][] = [];

  for (let runIdx = 0; runIdx < numRuns; runIdx++) {
    const runSubdir = numRuns > 1 ? join(runId, `run_${runIdx + 1}`) : runId;
    if (numRuns > 1) {
      console.log(`\n── Run ${runIdx + 1}/${numRuns} ──`);
      await ensureDir(join(resultsDir, runSubdir));
    }

    const responses = await run({
      models,
      briefs,
      promptContent,
      reminderContent,
      promptFile: opts.prompt,
      runId: runSubdir,
      resultsDir,
      // In multi-run mode: force re-run unless --resume is set (resume lets us skip already-done briefs per run)
      force: numRuns > 1 ? !opts.resume : opts.force,
      resume: opts.resume,
      dryRun: false,
      loadCached: async (modelId, briefId) =>
        loadResponse(resultsDir, runSubdir, modelId, briefId),
      saveResult: async (modelId, briefId, result) =>
        saveResponse(resultsDir, runSubdir, modelId, briefId, result),
    });

    if (responses.length === 0) {
      console.log("No responses to score for this run.");
      continue;
    }

    // Score all responses
    console.log("\nScoring results...");

    const scored: ScoredResult[] = responses.map((response) => {
      const brief = briefs.find((b) => b.id === response.brief_id)!;
      const model = models.find((m) => m.id === response.model_id)!;
      return {
        response,
        score: score(response, brief),
        brief,
        model,
      };
    });

    allRunScored.push(scored);

    // Generate per-run reports
    console.log("Generating reports...");

    const reports = generate({
      results: scored,
      config,
      models,
      briefs,
      promptHash,
    });

    await saveReports(resultsDir, runSubdir, reports);

    // Print per-run summary
    const successCount = scored.filter((r) => r.score.overall_score != null).length;
    const failCount = scored.filter((r) => r.response.failure_code).length;
    const invalidCount = scored.filter(
      (r) => !r.score.structural_valid && !r.response.failure_code
    ).length;

    console.log(`\n✓ Run ${runIdx + 1} complete: ${runSubdir}`);
    console.log(`  ${successCount} scored | ${invalidCount} invalid | ${failCount} failed`);
    console.log(`  Results: ${join(resultsDir, runSubdir)}`);

    const topResults = scored
      .filter((r) => r.score.overall_score != null)
      .sort((a, b) => (b.score.overall_score ?? 0) - (a.score.overall_score ?? 0))
      .slice(0, 3);

    if (topResults.length > 0) {
      console.log("\nTop results:");
      for (const r of topResults) {
        console.log(
          `  ${r.model.id.padEnd(20)} × ${r.brief.id.padEnd(30)} — overall: ${r.score.overall_score!.toFixed(3)}`
        );
      }
    }
  }

  // Generate variance + consistency reports for multi-run
  if (numRuns > 1 && allRunScored.length > 1) {
    // ── Variance report (overall_score) ───────────────────────────────────────
    const varianceLines: string[] = [
      `# Variance Report — ${runId}`,
      "",
      `Runs: ${allRunScored.length}`,
      "",
      "| Model | Brief | Mean | StdDev | Min | Max |",
      "|-------|-------|------|--------|-----|-----|",
    ];

    // Group by model×brief
    const combos = new Map<string, number[]>();
    for (const runScored of allRunScored) {
      for (const r of runScored) {
        const key = `${r.model.id}|${r.brief.id}`;
        if (!combos.has(key)) combos.set(key, []);
        if (r.score.overall_score != null) combos.get(key)!.push(r.score.overall_score);
      }
    }

    for (const [key, scores] of combos) {
      if (scores.length === 0) continue;
      const [modelId, briefId] = key.split("|");
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
      const stddev = Math.sqrt(variance);
      const min = Math.min(...scores);
      const max = Math.max(...scores);
      varianceLines.push(
        `| ${modelId} | ${briefId} | ${mean.toFixed(4)} | ${stddev.toFixed(4)} | ${min.toFixed(4)} | ${max.toFixed(4)} |`
      );
    }

    await writeFile(join(resultsDir, runId, "variance.md"), varianceLines.join("\n") + "\n", "utf-8");
    console.log(`\nVariance report: ${join(resultsDir, runId, "variance.md")}`);

    // ── Consistency report (topology + parameter) ──────────────────────────────
    //
    // topology_consistency: proportion of run pairs with identical graph topology
    //   (same node ID set, same node kinds, same edge count).
    //
    // parameter_consistency: 1 - average std of strength.mean across shared edges.
    //   Shared edges = edges with same from→to ID pair present in all runs.
    //   Capped to [0, 1].

    // Collect topology fingerprints and edge parameter maps per combo
    interface RunTopology {
      nodeIdSet: string; // sorted comma-separated node IDs
      nodeKindSig: string; // sorted "id:kind" pairs
      edgeCount: number;
      edgeParams: Map<string, number>; // "from→to" → strength.mean
    }

    const comboTopologies = new Map<string, RunTopology[]>();
    for (const runScored of allRunScored) {
      for (const r of runScored) {
        const key = `${r.model.id}|${r.brief.id}`;
        if (!comboTopologies.has(key)) comboTopologies.set(key, []);

        const graph = r.response.parsed_graph;
        if (!graph) continue;

        const sortedNodeIds = [...graph.nodes].map((n) => n.id).sort().join(",");
        const nodeKindSig = [...graph.nodes]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((n) => `${n.id}:${n.kind}`)
          .join(",");
        const edgeParams = new Map<string, number>();
        for (const e of graph.edges) {
          if (e.edge_type !== "bidirected" && e.strength?.mean != null) {
            edgeParams.set(`${e.from}→${e.to}`, e.strength.mean);
          }
        }

        comboTopologies.get(key)!.push({
          nodeIdSet: sortedNodeIds,
          nodeKindSig,
          edgeCount: graph.edges.length,
          edgeParams,
        });
      }
    }

    const consistencyCsvLines: string[] = [
      "model,prompt,brief,topology_consistency,parameter_consistency,n_runs",
    ];
    const promptStem = opts.prompt.split(/[/\\]/).pop() ?? opts.prompt;

    for (const [key, topologies] of comboTopologies) {
      if (topologies.length < 2) continue;
      const [modelId, briefId] = key.split("|");
      const n = topologies.length;

      // Topology consistency: proportion of pairs with identical topology
      let identicalPairs = 0;
      let totalPairs = 0;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          totalPairs++;
          const a = topologies[i];
          const b = topologies[j];
          if (
            a.nodeIdSet === b.nodeIdSet &&
            a.nodeKindSig === b.nodeKindSig &&
            a.edgeCount === b.edgeCount
          ) {
            identicalPairs++;
          }
        }
      }
      const topologyConsistency = totalPairs > 0 ? identicalPairs / totalPairs : 1.0;

      // Parameter consistency: 1 - avg std of strength.mean across shared edges
      // Shared edges: edges present (same from→to) in ALL runs
      const allEdgeKeys = topologies.map((t) => new Set(t.edgeParams.keys()));
      const sharedEdgeKeys = [...allEdgeKeys[0]].filter((k) =>
        allEdgeKeys.every((s) => s.has(k))
      );

      let paramConsistency = 1.0;
      if (sharedEdgeKeys.length > 0) {
        const avgStds: number[] = [];
        for (const edgeKey of sharedEdgeKeys) {
          const means = topologies.map((t) => t.edgeParams.get(edgeKey)!);
          const mean = means.reduce((a, b) => a + b, 0) / means.length;
          const variance = means.reduce((a, b) => a + (b - mean) ** 2, 0) / means.length;
          avgStds.push(Math.sqrt(variance));
        }
        const avgStd = avgStds.reduce((a, b) => a + b, 0) / avgStds.length;
        paramConsistency = Math.max(0, 1.0 - avgStd);
      }

      consistencyCsvLines.push(
        `${modelId},${promptStem},${briefId},${topologyConsistency.toFixed(4)},${paramConsistency.toFixed(4)},${n}`
      );
    }

    const consistencyCsvPath = join(resultsDir, runId, "consistency.csv");
    await writeFile(consistencyCsvPath, consistencyCsvLines.join("\n") + "\n", "utf-8");
    console.log(`Consistency report: ${consistencyCsvPath}`);
  }
}

// =============================================================================
// Generic type path (edit_graph, decision_review)
// =============================================================================

interface GenericRunArgs {
  promptType: PromptType;
  promptPath: string;
  promptContent: string;
  reminderContent?: string;
  models: Awaited<ReturnType<typeof readModels>>;
  modelsDir: string;
  casesDir: string;
  resultsDir: string;
  caseFilter: string[];
  dskEnabled: boolean;
  numRuns: number;
  opts: {
    prompt: string;
    force: boolean;
    resume: boolean;
    dryRun: boolean;
    runId?: string;
  };
}

async function runGenericType(args: GenericRunArgs): Promise<void> {
  const { promptType, promptContent, reminderContent, models, modelsDir, casesDir, resultsDir, caseFilter, dskEnabled, numRuns, opts } = args;

  const adapter = getAdapter(promptType);

  let fixtures: Array<{ id: string; [key: string]: unknown }>;
  try {
    fixtures = await adapter.loadCases(casesDir);
  } catch (err) {
    console.error(`Failed to load fixtures from ${casesDir}:`, err);
    process.exit(1);
  }

  // Apply filter
  if (caseFilter.length > 0) {
    fixtures = fixtures.filter((f: { id: string }) => caseFilter.includes(f.id));
  }

  // --dsk-enabled: force inject_dsk=true on all fixtures (decision_review only)
  if (dskEnabled && promptType === "decision_review") {
    fixtures = fixtures.map((f) => ({ ...f, inject_dsk: true }));
  }

  if (fixtures.length === 0) {
    console.error(`No fixtures found. Check ${casesDir} and --cases filter.`);
    process.exit(1);
  }

  // Build fake Brief objects for the runner (which expects briefs)
  const pseudoBriefs = fixtures.map((f) => ({
    id: f.id,
    meta: { expect_status_quo: false, has_numeric_target: false, complexity: "simple" as const },
    body: "", // Will be overridden by adapter
  }));

  // Build run configuration
  const runId = opts.runId ?? buildRunId(opts.prompt);
  const timestamp = new Date().toISOString();
  const promptHash = hashContent(promptContent);
  const promptFilename = opts.prompt.split(/[/\\]/).pop() ?? opts.prompt;

  const config: RunConfig = {
    run_id: runId,
    timestamp,
    prompt_file: opts.prompt,
    prompt_content: promptContent,
    model_ids: models.map((m) => m.id),
    brief_ids: fixtures.map((f) => f.id),
    force: opts.force,
    resume: opts.resume,
    dry_run: opts.dryRun,
    results_dir: resultsDir,
    prompt_type: promptType,
  };

  // Dry run
  if (opts.dryRun) {
    console.log(`\n[Dry Run] Would execute ${models.length * fixtures.length} combination(s):\n`);
    for (const model of models) {
      for (const fixture of fixtures) {
        console.log(`  ${model.id.padEnd(20)} × ${fixture.id}`);
      }
    }
    console.log(`\nPrompt type: ${promptType}`);
    console.log(`Prompt: ${opts.prompt} (${promptHash})`);
    console.log(`Run ID would be: ${runId}`);
    return;
  }

  // Create results directory
  await ensureDir(join(resultsDir, runId));

  // Write manifest
  const gitSha = getGitSha();
  const modelHashes: Record<string, { config_hash: string }> = {};
  for (const model of models) {
    try {
      const configPath = join(modelsDir, `${model.id}.json`);
      modelHashes[model.id] = { config_hash: await hashFile(configPath) };
    } catch {
      modelHashes[model.id] = { config_hash: "unknown" };
    }
  }

  const briefHashes: Record<string, { content_hash: string }> = {};
  for (const fixture of fixtures) {
    briefHashes[fixture.id] = { content_hash: hashContent(JSON.stringify(fixture)) };
  }

  const manifest: RunManifest = {
    run_id: runId,
    timestamp,
    git_sha: gitSha,
    tool_version: TOOL_VERSION,
    cli_args: process.argv.slice(2),
    prompt: { filename: promptFilename, content_hash: promptHash },
    models: modelHashes,
    briefs: briefHashes,
  };

  await saveManifest(resultsDir, runId, manifest);

  // Build per-fixture request content so runner can use it
  const fixtureMap = new Map(fixtures.map((f) => [f.id, f]));

  // Override brief bodies with adapter-built user messages
  for (const pb of pseudoBriefs) {
    const fixture = fixtureMap.get(pb.id)!;
    const { system, user } = adapter.buildRequest(fixture, promptContent);
    // Store the adapter-built user message as the brief body
    pb.body = user;
    // For non-draft_graph, the system prompt may be modified (e.g. DSK injection)
    // We handle this by using a per-fixture prompt override mechanism
  }

  // For decision_review with DSK injection, we need per-fixture system prompts
  // The runner doesn't support this, so we run fixtures sequentially
  console.log(`\nStarting run: ${runId} (type: ${promptType})${numRuns > 1 ? ` (${numRuns} runs)` : ""}`);
  console.log(`Models: ${models.map((m) => m.id).join(", ")}`);
  console.log(`Cases: ${fixtures.map((f) => f.id).join(", ")}`);
  console.log();

  // Collect per-run results for variance analysis
  const allRunResults: GenericScoredResult[][] = [];

  for (let runIdx = 0; runIdx < numRuns; runIdx++) {
    const runSubdir = numRuns > 1 ? join(runId, `run_${runIdx + 1}`) : runId;
    if (numRuns > 1) {
      console.log(`\n── Run ${runIdx + 1}/${numRuns} ──`);
      await ensureDir(join(resultsDir, runSubdir));
    }

    const allResults: GenericScoredResult[] = [];

    for (const model of models) {
      for (const fixture of fixtures) {
        const fixtureId = fixture.id;

        // Check cache (skip for multi-run)
        if (!opts.force && numRuns === 1) {
          const cached = await loadResponse(resultsDir, runSubdir, model.id, fixtureId);
          if (cached !== null && !opts.resume) {
            console.log(`  [cache]  Skipping ${model.id} × ${fixtureId}`);
            const parsed = cached.parsed_json ?? (cached.parsed_graph as unknown as Record<string, unknown>) ?? null;
            const scoreResult = adapter.score(fixture, parsed, cached);
            allResults.push({
              response: cached,
              score: scoreResult,
              fixture_id: fixtureId,
              model,
              prompt_type: promptType,
            });
            continue;
          }
        }

        // Build request via adapter
        const { system, user } = adapter.buildRequest(fixture, promptContent);

        // Run via the runner's single-call path
        const responses = await run({
          models: [model],
          briefs: [{ id: fixtureId, meta: { expect_status_quo: false, has_numeric_target: false, complexity: "simple" }, body: user }],
          promptContent: system,
          reminderContent,
          promptFile: opts.prompt,
          runId: runSubdir,
          resultsDir,
          force: numRuns > 1 ? true : opts.force,
          resume: opts.resume,
          dryRun: false,
          loadCached: async () => null, // Already handled above
          saveResult: async (_modelId, _briefId, result) => {
            // Also store parsed_json for non-draft_graph types
            if (result.status === "success" && result.raw_text) {
              const parseResult = adapter.parseResponse(result.raw_text);
              if (parseResult.parsed) {
                result.parsed_json = parseResult.parsed;
              }
            }
            await saveResponse(resultsDir, runSubdir, model.id, fixtureId, result);
          },
        });

        const response = responses[0];
        if (!response) continue;

        // Parse and score
        let parsed: Record<string, unknown> | null = null;
        if (response.status === "success" && response.raw_text) {
          const parseResult = adapter.parseResponse(response.raw_text);
          parsed = parseResult.parsed;
          if (parseResult.parsed) {
            response.parsed_json = parseResult.parsed;
          }
        }

        const scoreResult = adapter.score(fixture, parsed, response);

        // Runner already printed "Done: ... latency/cost". Append the score on a new line.
        console.log(`  Score:   ${model.id} × ${fixtureId} — ${scoreResult.overall?.toFixed(3) ?? "—"}`);

        allResults.push({
          response,
          score: scoreResult,
          fixture_id: fixtureId,
          model,
          prompt_type: promptType,
        });
      }
    }

    allRunResults.push(allResults);

    if (allResults.length === 0) {
      console.log("No responses to score for this run.");
      continue;
    }

    // Generate generic CSV report
    const csvLines = [
      [
        "run_id", "prompt_type", "provider", "model_id", "case_id", "target_mode",
        "overall_score", "latency_ms", "input_tokens", "output_tokens",
        "reasoning_tokens", "est_cost_usd", "failure_code", "parse_error",
        ...Object.keys(allResults[0]?.score.dimensions ?? {}),
      ].join(","),
    ];

    for (const r of allResults) {
      const dims = Object.values(r.score.dimensions).map((v) =>
        v === null ? "" : typeof v === "boolean" ? (v ? "1" : "0") : String(v)
      );
      csvLines.push(
        [
          config.run_id,
          promptType,
          r.model.provider,
          r.model.id,
          r.fixture_id,
          r.model.target_mode ?? "",
          r.score.overall?.toFixed(4) ?? "",
          String(r.response.latency_ms),
          String(r.response.input_tokens ?? ""),
          String(r.response.output_tokens ?? ""),
          String(r.response.reasoning_tokens ?? ""),
          (r.response.est_cost_usd ?? 0).toFixed(6),
          r.response.failure_code ?? "",
          r.score.parse_error ?? "",
          ...dims,
        ].join(",")
      );
    }

    const scoresCsv = csvLines.join("\n") + "\n";
    const summaryMd = generateGenericSummary(allResults, config, promptHash);

    await ensureDir(join(resultsDir, runSubdir));
    await writeFile(join(resultsDir, runSubdir, "scores.csv"), scoresCsv, "utf-8");
    await writeFile(join(resultsDir, runSubdir, "summary.md"), summaryMd, "utf-8");

    // Print per-run summary
    const successCount = allResults.filter((r) => r.score.overall != null).length;
    const failCount = allResults.filter((r) => r.response.failure_code).length;

    console.log(`\n✓ Run ${runIdx + 1} complete: ${runSubdir}`);
    console.log(`  ${successCount} scored | ${failCount} failed`);
    console.log(`  Results: ${join(resultsDir, runSubdir)}`);

    const topResults = allResults
      .filter((r) => r.score.overall != null)
      .sort((a, b) => (b.score.overall ?? 0) - (a.score.overall ?? 0))
      .slice(0, 3);

    if (topResults.length > 0) {
      console.log("\nTop results:");
      for (const r of topResults) {
        console.log(
          `  ${r.model.id.padEnd(20)} × ${r.fixture_id.padEnd(30)} — overall: ${r.score.overall!.toFixed(3)}`
        );
      }
    }
  }

  // Generate variance report for multi-run
  if (numRuns > 1 && allRunResults.length > 1) {
    const varianceLines: string[] = [
      `# Variance Report — ${runId}`,
      "",
      `Runs: ${allRunResults.length}`,
      "",
      "| Model | Case | Mean | StdDev | Min | Max |",
      "|-------|------|------|--------|-----|-----|",
    ];

    // Group by model×fixture
    const combos = new Map<string, number[]>();
    for (const runResults of allRunResults) {
      for (const r of runResults) {
        const key = `${r.model.id}|${r.fixture_id}`;
        if (!combos.has(key)) combos.set(key, []);
        if (r.score.overall != null) combos.get(key)!.push(r.score.overall);
      }
    }

    for (const [key, scores] of combos) {
      if (scores.length === 0) continue;
      const [modelId, fixtureId] = key.split("|");
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
      const stddev = Math.sqrt(variance);
      const min = Math.min(...scores);
      const max = Math.max(...scores);
      varianceLines.push(
        `| ${modelId} | ${fixtureId} | ${mean.toFixed(4)} | ${stddev.toFixed(4)} | ${min.toFixed(4)} | ${max.toFixed(4)} |`
      );
    }

    await writeFile(join(resultsDir, runId, "variance.md"), varianceLines.join("\n") + "\n", "utf-8");
    console.log(`\nVariance report: ${join(resultsDir, runId, "variance.md")}`);
  }
}

// =============================================================================
// Research path (uses web_search_preview — bypasses standard runner)
// =============================================================================

interface ResearchRunArgs {
  promptPath: string;
  promptContent: string;
  models: Awaited<ReturnType<typeof readModels>>;
  modelsDir: string;
  casesDir: string;
  resultsDir: string;
  caseFilter: string[];
  opts: {
    prompt: string;
    force: boolean;
    resume: boolean;
    dryRun: boolean;
    runId?: string;
  };
}

async function runResearch(args: ResearchRunArgs): Promise<void> {
  const { models, modelsDir, casesDir, resultsDir, caseFilter, opts } = args;

  const adapter = new ResearchAdapter();

  let fixtures: ResearchFixture[];
  try {
    fixtures = await adapter.loadCases(casesDir);
  } catch (err) {
    console.error(`Failed to load research fixtures from ${casesDir}:`, err);
    process.exit(1);
  }

  if (caseFilter.length > 0) {
    fixtures = fixtures.filter((f) => caseFilter.includes(f.id));
  }

  if (fixtures.length === 0) {
    console.error(`No research fixtures found. Check ${casesDir} and --cases filter.`);
    process.exit(1);
  }

  const runId = opts.runId ?? buildRunId(opts.prompt);
  const timestamp = new Date().toISOString();
  const promptHash = hashContent("research"); // No prompt file for research
  const promptFilename = "research (web_search_preview)";

  const runConfig: RunConfig = {
    run_id: runId,
    timestamp,
    prompt_file: opts.prompt,
    prompt_content: "",
    model_ids: models.map((m) => m.id),
    brief_ids: fixtures.map((f) => f.id),
    force: opts.force,
    resume: opts.resume,
    dry_run: opts.dryRun,
    results_dir: resultsDir,
    prompt_type: "research",
  };

  if (opts.dryRun) {
    console.log(`\n[Dry Run] Would execute ${models.length * fixtures.length} combination(s):\n`);
    for (const model of models) {
      for (const fixture of fixtures) {
        console.log(`  ${model.id.padEnd(20)} × ${fixture.id}`);
      }
    }
    console.log(`\nPrompt type: research (web_search_preview)`);
    console.log(`Run ID would be: ${runId}`);
    return;
  }

  await ensureDir(join(resultsDir, runId));

  const gitSha = getGitSha();
  const modelHashes: Record<string, { config_hash: string }> = {};
  for (const model of models) {
    try {
      const configPath = join(modelsDir, `${model.id}.json`);
      modelHashes[model.id] = { config_hash: await hashFile(configPath) };
    } catch {
      modelHashes[model.id] = { config_hash: "unknown" };
    }
  }

  const briefHashes: Record<string, { content_hash: string }> = {};
  for (const fixture of fixtures) {
    briefHashes[fixture.id] = { content_hash: hashContent(JSON.stringify(fixture)) };
  }

  const manifest: RunManifest = {
    run_id: runId,
    timestamp,
    git_sha: gitSha,
    tool_version: TOOL_VERSION,
    cli_args: process.argv.slice(2),
    prompt: { filename: promptFilename, content_hash: promptHash },
    models: modelHashes,
    briefs: briefHashes,
  };

  await saveManifest(resultsDir, runId, manifest);

  console.log(`\nStarting run: ${runId} (type: research)`);
  console.log(`Models: ${models.map((m) => m.id).join(", ")}`);
  console.log(`Cases: ${fixtures.map((f) => f.id).join(", ")}`);
  console.log();

  const allResults: GenericScoredResult[] = [];

  for (const model of models) {
    for (const fixture of fixtures) {
      // Check cache
      if (!opts.force) {
        const cached = await loadResponse(resultsDir, runId, model.id, fixture.id);
        if (cached !== null && !opts.resume) {
          console.log(`  [cache]  Skipping ${model.id} × ${fixture.id}`);
          const parsed = cached.parsed_json ?? null;
          const scoreResult = adapter.score(fixture, parsed, cached);
          allResults.push({
            response: cached,
            score: scoreResult,
            fixture_id: fixture.id,
            model,
            prompt_type: "research",
          });
          continue;
        }
      }

      console.log(`  Running: ${model.id} × ${fixture.id}...`);

      const { response, parsed } = await runResearchFixture(fixture, model);

      await saveResponse(resultsDir, runId, model.id, fixture.id, response);

      const scoreResult = adapter.score(fixture, parsed, response);

      const statusStr =
        response.status === "success"
          ? `✓ ${response.latency_ms}ms, cost $${(response.est_cost_usd ?? 0).toFixed(4)}`
          : `✗ ${response.failure_code}`;
      console.log(`  Done:    ${model.id} × ${fixture.id} — ${statusStr}`);
      console.log(`  Score:   ${model.id} × ${fixture.id} — ${scoreResult.overall?.toFixed(3) ?? "—"}`);

      allResults.push({
        response,
        score: scoreResult,
        fixture_id: fixture.id,
        model,
        prompt_type: "research",
      });
    }
  }

  if (allResults.length === 0) {
    console.log("No responses to score. Run complete.");
    return;
  }

  // Generate CSV + summary
  const csvLines = [
    [
      "run_id", "prompt_type", "provider", "model_id", "case_id", "target_mode",
      "overall_score", "latency_ms", "input_tokens", "output_tokens",
      "est_cost_usd", "failure_code",
      ...Object.keys(allResults[0]?.score.dimensions ?? {}),
    ].join(","),
  ];

  for (const r of allResults) {
    const dims = Object.values(r.score.dimensions).map((v) =>
      v === null ? "" : typeof v === "boolean" ? (v ? "1" : "0") : String(v)
    );
    csvLines.push(
      [
        runConfig.run_id,
        "research",
        r.model.provider,
        r.model.id,
        r.fixture_id,
        r.model.target_mode ?? "",
        r.score.overall?.toFixed(4) ?? "",
        String(r.response.latency_ms),
        String(r.response.input_tokens ?? ""),
        String(r.response.output_tokens ?? ""),
        (r.response.est_cost_usd ?? 0).toFixed(6),
        r.response.failure_code ?? "",
        ...dims,
      ].join(",")
    );
  }

  const scoresCsv = csvLines.join("\n") + "\n";
  const summaryMd = generateGenericSummary(allResults, runConfig, promptHash);

  await ensureDir(join(resultsDir, runId));
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(resultsDir, runId, "scores.csv"), scoresCsv, "utf-8");
  await writeFile(join(resultsDir, runId, "summary.md"), summaryMd, "utf-8");

  const successCount = allResults.filter((r) => r.score.overall != null).length;
  const failCount = allResults.filter((r) => r.response.failure_code).length;

  console.log(`\n✓ Run complete: ${runId}`);
  console.log(`  ${successCount} scored | ${failCount} failed`);
  console.log(`  Results: ${join(resultsDir, runId)}`);

  const topResults = allResults
    .filter((r) => r.score.overall != null)
    .sort((a, b) => (b.score.overall ?? 0) - (a.score.overall ?? 0))
    .slice(0, 3);

  if (topResults.length > 0) {
    console.log("\nTop results:");
    for (const r of topResults) {
      console.log(
        `  ${r.model.id.padEnd(20)} × ${r.fixture_id.padEnd(30)} — overall: ${r.score.overall!.toFixed(3)}`
      );
    }
  }
}

// =============================================================================
// Orchestrator path (multi-turn + judge support)
// =============================================================================

/** Profile fixture structure for --profile flag */
interface ProfileFixture {
  fixture_id: string;
  profile: string;
  zone1_id: string;
  active_blocks: Array<{ name: string; version: string }>;
  test_input: Record<string, unknown>;
  expected_behaviour: Record<string, unknown>;
}

interface OrchestratorRunArgs {
  promptPath: string;
  promptContent: string;
  models: Awaited<ReturnType<typeof readModels>>;
  modelsDir: string;
  casesDir: string;
  resultsDir: string;
  caseFilter: string[];
  judge: boolean;
  profile?: string;
  zone1Only: boolean;
  opts: {
    prompt: string;
    force: boolean;
    resume: boolean;
    dryRun: boolean;
    runId?: string;
  };
}

interface OrchestratorScoredResult extends GenericScoredResult {
  judgeResult?: JudgeResult;
  conversationHistory?: string;
}

async function runOrchestrator(args: OrchestratorRunArgs): Promise<void> {
  const { promptContent, models, modelsDir, casesDir, resultsDir, caseFilter, judge, profile, zone1Only, opts } = args;

  const adapter = new OrchestratorAdapter();

  let fixtures: OrchestratorFixture[];
  try {
    fixtures = await adapter.loadCases(casesDir);
  } catch (err) {
    console.error(`Failed to load orchestrator fixtures from ${casesDir}:`, err);
    process.exit(1);
  }

  if (caseFilter.length > 0) {
    fixtures = fixtures.filter((f) => caseFilter.includes(f.id));
  }

  if (fixtures.length === 0) {
    console.error(`No orchestrator fixtures found. Check ${casesDir} and --cases filter.`);
    process.exit(1);
  }

  const runId = opts.runId ?? buildRunId(opts.prompt);
  const timestamp = new Date().toISOString();
  const promptHash = hashContent(promptContent);
  const promptFilename = opts.prompt.split(/[/\\]/).pop() ?? opts.prompt;

  const config: RunConfig = {
    run_id: runId,
    timestamp,
    prompt_file: opts.prompt,
    prompt_content: promptContent,
    model_ids: models.map((m) => m.id),
    brief_ids: fixtures.map((f) => f.id),
    force: opts.force,
    resume: opts.resume,
    dry_run: opts.dryRun,
    results_dir: resultsDir,
    prompt_type: "orchestrator",
  };

  if (opts.dryRun) {
    console.log(`\n[Dry Run] Would execute ${models.length * fixtures.length} combination(s):\n`);
    for (const model of models) {
      for (const fixture of fixtures) {
        console.log(`  ${model.id.padEnd(20)} × ${fixture.id}`);
      }
    }
    console.log(`\nPrompt type: orchestrator${judge ? " (with judge)" : ""}`);
    console.log(`Prompt: ${opts.prompt} (${promptHash})`);
    console.log(`Run ID would be: ${runId}`);
    return;
  }

  await ensureDir(join(resultsDir, runId));

  // Write manifest
  const gitSha = getGitSha();
  const modelHashes: Record<string, { config_hash: string }> = {};
  for (const model of models) {
    try {
      const configPath = join(modelsDir, `${model.id}.json`);
      modelHashes[model.id] = { config_hash: await hashFile(configPath) };
    } catch {
      modelHashes[model.id] = { config_hash: "unknown" };
    }
  }
  const briefHashes: Record<string, { content_hash: string }> = {};
  for (const fixture of fixtures) {
    briefHashes[fixture.id] = { content_hash: hashContent(JSON.stringify(fixture)) };
  }
  const manifest: RunManifest = {
    run_id: runId,
    timestamp,
    git_sha: gitSha,
    tool_version: TOOL_VERSION,
    cli_args: process.argv.slice(2),
    prompt: { filename: promptFilename, content_hash: promptHash },
    models: modelHashes,
    briefs: briefHashes,
  };
  await saveManifest(resultsDir, runId, manifest);

  // ── Resolve effective prompt (--profile / --zone1-only) ───────────────────
  let effectivePrompt = promptContent;
  let promptMode = "full";

  if (zone1Only) {
    // Zone 1 only: use the raw prompt file content with no Zone 2 assembly
    promptMode = "zone1-only";
    console.log("  [mode] Zone 1 only — no Zone 2 blocks appended");
  } else if (profile) {
    // Load profile fixture and assemble Zone 2 blocks from test_input
    const profilesDir = join(TOOL_ROOT, "fixtures", "prompt-profiles");
    const profilePath = join(profilesDir, `${profile}.json`);
    let profileFixture: ProfileFixture;
    try {
      const profileContent = await readFile(profilePath, "utf-8");
      profileFixture = JSON.parse(profileContent) as ProfileFixture;
    } catch (err) {
      console.error(`Failed to load profile fixture '${profile}' from ${profilePath}:`, err);
      process.exit(1);
    }

    // Build Zone 2 context lines from test_input, guided by active_blocks
    const input = profileFixture.test_input;
    const activeBlockNames = new Set(profileFixture.active_blocks.map((b) => b.name));
    const zone2Parts: string[] = [];
    const messages = (input.messages ?? []) as Array<{ role: string; content: string }>;

    // stage_context block (always present when active)
    if (activeBlockNames.has("stage_context")) {
      const stageLines: string[] = [`Stage: ${input.stage ?? "frame"}`];
      if (input.goal) stageLines.push(`Goal: ${input.goal}`);
      if (Array.isArray(input.constraints) && input.constraints.length > 0) {
        stageLines.push(`Constraints: ${input.constraints.join("; ")}`);
      }
      if (Array.isArray(input.options) && input.options.length > 0) {
        stageLines.push(`Options: ${input.options.join("; ")}`);
      }
      zone2Parts.push(`<STAGE>\n${stageLines.join("\n")}\n</STAGE>`);
    }

    // graph_state block (placeholder — evaluator fixtures don't carry full graph data)
    if (activeBlockNames.has("graph_state") && input.hasGraph) {
      zone2Parts.push(`<GRAPH_STATE>\nNodes: 5 (factor: 3, goal: 1, option: 1)\nEdges: 4\nStrongest edges:\n  fac_1 → goal_1 (strength: 0.85)\n</GRAPH_STATE>`);
    }

    // analysis_state block (placeholder — evaluator fixtures don't carry full analysis data)
    if (activeBlockNames.has("analysis_state") && input.hasAnalysis) {
      zone2Parts.push(`<ANALYSIS_STATE>\nWinner: Option A (62.0%)\nTop drivers:\n  Factor 1: sensitivity 0.45\nRobustness: moderate\nConfidence: medium\n</ANALYSIS_STATE>`);
    }

    // bil_context block (placeholder — evaluator fixtures don't carry BIL extraction data)
    if (activeBlockNames.has("bil_context") && input.bilEnabled) {
      zone2Parts.push(`<BRIEF_ANALYSIS>\nPreliminary observations from deterministic brief analysis.\nCompleteness: adequate\nGoal: ${input.goal ?? "Not detected"}\n</BRIEF_ANALYSIS>`);
    }

    // conversation_summary block
    if (activeBlockNames.has("conversation_summary") && messages.length > 0) {
      const clauses: string[] = [];
      if (input.goal) clauses.push(`User described a decision: "${input.goal}"`);
      clauses.push(`${messages.length} conversation turns`);
      zone2Parts.push(`<CONVERSATION_SUMMARY>\n${clauses.join(". ")}.\n</CONVERSATION_SUMMARY>`);
    }

    // recent_turns block
    if (activeBlockNames.has("recent_turns") && messages.length > 0) {
      const recent = messages.slice(-3);
      const turnLines = recent.map((m) => {
        const content = String(m.content).slice(0, 500);
        if (m.role === "user") {
          return `BEGIN_UNTRUSTED_CONTEXT\nuser: ${content}\nEND_UNTRUSTED_CONTEXT`;
        }
        return `assistant: ${content}`;
      });
      zone2Parts.push(`<RECENT_TURNS>\n${turnLines.join("\n")}\n</RECENT_TURNS>`);
    }

    // event_log block (placeholder)
    if (activeBlockNames.has("event_log")) {
      zone2Parts.push(`<EVENT_LOG>\nGraph drafted. Analysis run.\n</EVENT_LOG>`);
    }

    // hints block
    const hintLines: string[] = [];
    if (activeBlockNames.has("bil_hint")) {
      hintLines.push("A deterministic brief analysis is appended below — use its findings to ground your coaching. Do not repeat the analysis verbatim; reference specific elements.");
    }
    if (activeBlockNames.has("analysis_hint")) {
      hintLines.push("Post-analysis data is available in context. Reference specific results, drivers, and robustness when coaching — all numbers must come from this data.");
    }
    if (hintLines.length > 0) {
      zone2Parts.push(`<CONTEXT_HINTS>\n${hintLines.join("\n")}\n</CONTEXT_HINTS>`);
    }

    effectivePrompt = promptContent + "\n\n" + zone2Parts.join("\n\n");
    promptMode = `profile:${profileFixture.fixture_id}`;
    console.log(`  [mode] Profile: ${profileFixture.fixture_id} (${profileFixture.profile})`);
    console.log(`  [mode] Active blocks: ${profileFixture.active_blocks.map((b) => b.name).join(", ")}`);
  }

  console.log(`\nStarting run: ${runId} (type: orchestrator${judge ? " + judge" : ""}, prompt: ${promptMode})`);
  console.log(`Models: ${models.map((m) => m.id).join(", ")}`);
  console.log(`Cases: ${fixtures.map((f) => f.id).join(", ")}`);
  console.log();

  // Import provider for direct multi-turn calls
  const { getProvider } = await import("./providers/index.js");

  const allResults: OrchestratorScoredResult[] = [];

  for (const model of models) {
    for (const fixture of fixtures) {
      const fixtureId = fixture.id;

      // Check cache
      if (!opts.force) {
        const cached = await loadResponse(resultsDir, runId, model.id, fixtureId);
        if (cached !== null && !opts.resume) {
          console.log(`  [cache]  Skipping ${model.id} × ${fixtureId}`);
          const parsed = cached.parsed_json ?? null;
          const scoreResult = adapter.score(fixture, parsed, cached);
          allResults.push({
            response: cached,
            score: scoreResult,
            fixture_id: fixtureId,
            model,
            prompt_type: "orchestrator",
          });
          continue;
        }
      }

      console.log(`  Running: ${model.id} × ${fixtureId}...`);

      let finalResponse: LLMResponse;
      let conversationHistory = "";

      if (adapter.isMultiTurn(fixture)) {
        // Multi-turn: execute each segment, auto-fill assistant nulls
        const segments = adapter.getMultiTurnSegments(fixture);
        const filledTurns = [...(fixture.turns ?? [])];
        const provider = getProvider(model);

        let totalLatency = 0;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let lastRawText = "";
        let lastOk = true;
        let lastError: string | undefined;

        for (const segment of segments) {
          const result = await provider.chat(effectivePrompt, segment.userMessage, model);
          totalLatency += result.latency_ms;
          totalInputTokens += result.input_tokens ?? 0;
          totalOutputTokens += result.output_tokens ?? 0;

          if (!result.ok) {
            lastOk = false;
            lastError = result.error ?? "unknown error";
            break;
          }

          lastRawText = result.text ?? "";

          // Auto-fill the corresponding assistant null turn
          const nullIdx = filledTurns.findIndex(
            (t) => t.role === "assistant" && t.content === null
          );
          if (nullIdx >= 0) {
            filledTurns[nullIdx] = { role: "assistant", content: lastRawText };
          }
        }

        // If there's a final user turn after all segments, make one more call
        // with the full conversation as context
        const lastTurn = filledTurns[filledTurns.length - 1];
        if (lastTurn.role === "user" && lastOk) {
          // Build full conversation context for the final call
          const historyParts = filledTurns.slice(0, -1).map(
            (t) => `[${t.role.toUpperCase()}]: ${t.content ?? ""}`
          );
          const contextPrefix = adapter.buildContextPrefix(fixture);
          const finalUserMsg = [
            contextPrefix,
            "",
            "CONVERSATION HISTORY:",
            ...historyParts,
            "",
            "BEGIN_UNTRUSTED_CONTEXT",
            lastTurn.content ?? "",
            "END_UNTRUSTED_CONTEXT",
          ].join("\n");

          const result = await provider.chat(effectivePrompt, finalUserMsg, model);
          totalLatency += result.latency_ms;
          totalInputTokens += result.input_tokens ?? 0;
          totalOutputTokens += result.output_tokens ?? 0;

          if (!result.ok) {
            lastOk = false;
            lastError = result.error ?? "unknown error";
          } else {
            lastRawText = result.text ?? "";
          }
        }

        conversationHistory = adapter.buildConversationHistory(filledTurns);

        const cost =
          (totalInputTokens / 1_000_000) * (model.pricing?.input_per_1m ?? 0) +
          (totalOutputTokens / 1_000_000) * (model.pricing?.output_per_1m ?? 0);

        finalResponse = {
          model_id: model.id,
          brief_id: fixtureId,
          status: lastOk ? "success" : "server_error",
          raw_text: lastRawText,
          latency_ms: totalLatency,
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
          est_cost_usd: cost,
          pricing_source: "model_config",
          failure_code: lastOk ? undefined : "server_error",
          error_message: lastError,
        };
      } else {
        // Single-turn: call provider directly (avoids JSON extraction mismatch for XML)
        const { system, user } = adapter.buildRequest(fixture, effectivePrompt);
        const provider = getProvider(model);
        const result = await provider.chat(system, user, model);

        const cost =
          ((result.input_tokens ?? 0) / 1_000_000) * (model.pricing?.input_per_1m ?? 0) +
          ((result.output_tokens ?? 0) / 1_000_000) * (model.pricing?.output_per_1m ?? 0);

        finalResponse = {
          model_id: model.id,
          brief_id: fixtureId,
          status: result.ok ? "success" : "server_error",
          raw_text: result.text ?? undefined,
          latency_ms: result.latency_ms,
          input_tokens: result.input_tokens,
          output_tokens: result.output_tokens,
          est_cost_usd: cost,
          pricing_source: "model_config",
          failure_code: result.ok ? undefined : "server_error",
          error_message: result.ok ? undefined : (result.error ?? undefined),
        };
      }

      // Save response
      await saveResponse(resultsDir, runId, model.id, fixtureId, finalResponse);

      // Parse and score structurally
      let parsed: Record<string, unknown> | null = null;
      if (finalResponse.status === "success" && finalResponse.raw_text) {
        const parseResult = adapter.parseResponse(finalResponse.raw_text);
        parsed = parseResult.parsed;
        if (parseResult.parsed) finalResponse.parsed_json = parseResult.parsed;
      }
      const scoreResult = adapter.score(fixture, parsed, finalResponse);

      const statusStr =
        finalResponse.status === "success"
          ? `✓ ${finalResponse.latency_ms}ms, cost $${(finalResponse.est_cost_usd ?? 0).toFixed(4)}`
          : `✗ ${finalResponse.failure_code}`;
      console.log(`  Done:    ${model.id} × ${fixtureId} — ${statusStr}`);
      console.log(`  Score:   ${model.id} × ${fixtureId} — structural: ${scoreResult.overall?.toFixed(3) ?? "—"}`);

      // Judge scoring (if --judge and raw_text available — parse_failed is expected for XML)
      let judgeResult: JudgeResult | undefined;
      if (judge && finalResponse.raw_text) {
        console.log(`  Judging: ${model.id} × ${fixtureId}...`);
        judgeResult = await judgeOrchestratorResponse(
          fixture,
          finalResponse.raw_text,
          model.id,
          conversationHistory || undefined
        );

        if (judgeResult.judge_error) {
          console.log(`  Judge:   ${model.id} × ${fixtureId} — ERROR: ${judgeResult.judge_error}`);
        } else {
          console.log(
            `  Judge:   ${model.id} × ${fixtureId} — qualitative: ${judgeResult.weighted_average.toFixed(3)} (${judgeResult.judge_latency_ms}ms, $${judgeResult.judge_cost_usd.toFixed(4)})`
          );
        }
      }

      allResults.push({
        response: finalResponse,
        score: scoreResult,
        fixture_id: fixtureId,
        model,
        prompt_type: "orchestrator",
        judgeResult,
        conversationHistory,
      });
    }
  }

  if (allResults.length === 0) {
    console.log("No responses to score. Run complete.");
    return;
  }

  // Generate CSV + summary
  const judgeActive = allResults.some((r) => r.judgeResult != null);
  const judgeDimKeys = [
    "scientific_polymath", "causal_mechanism", "coaching_over_telling",
    "grounded_quantification", "warm_directness", "appropriate_brevity",
    "constructive_challenge", "elicitation_quality", "session_coherence",
  ];

  const csvLines = [
    [
      "run_id", "prompt_type", "provider", "model_id", "case_id", "target_mode",
      "structural_score", "latency_ms", "input_tokens", "output_tokens",
      "est_cost_usd", "failure_code",
      ...Object.keys(allResults[0]?.score.dimensions ?? {}),
      ...(judgeActive ? ["judge_weighted_avg", "judge_latency_ms", "judge_cost_usd", ...judgeDimKeys.map((k) => `judge_${k}`)] : []),
    ].join(","),
  ];

  for (const r of allResults) {
    const dims = Object.values(r.score.dimensions).map((v) =>
      v === null ? "" : typeof v === "boolean" ? (v ? "1" : "0") : String(v)
    );
    const judgeCols: string[] = [];
    if (judgeActive) {
      const jr = r.judgeResult;
      judgeCols.push(
        jr ? jr.weighted_average.toFixed(4) : "",
        jr ? String(jr.judge_latency_ms) : "",
        jr ? jr.judge_cost_usd.toFixed(6) : "",
        ...judgeDimKeys.map((k) => {
          const dim = jr?.scores[k as keyof typeof jr.scores];
          return dim ? String(dim.score) : "";
        })
      );
    }
    csvLines.push(
      [
        config.run_id,
        "orchestrator",
        r.model.provider,
        r.model.id,
        r.fixture_id,
        r.model.target_mode ?? "",
        r.score.overall?.toFixed(4) ?? "",
        String(r.response.latency_ms),
        String(r.response.input_tokens ?? ""),
        String(r.response.output_tokens ?? ""),
        (r.response.est_cost_usd ?? 0).toFixed(6),
        r.response.failure_code ?? "",
        ...dims,
        ...judgeCols,
      ].join(",")
    );
  }

  const scoresCsv = csvLines.join("\n") + "\n";
  const summaryMd = generateOrchestratorSummary(allResults, config, promptHash, judgeActive);

  await ensureDir(join(resultsDir, runId));
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(resultsDir, runId, "scores.csv"), scoresCsv, "utf-8");
  await writeFile(join(resultsDir, runId, "summary.md"), summaryMd, "utf-8");

  // Print summary
  const successCount = allResults.filter((r) => r.score.overall != null).length;
  const failCount = allResults.filter((r) => r.response.failure_code).length;

  console.log(`\n✓ Run complete: ${runId}`);
  console.log(`  ${successCount} scored | ${failCount} failed`);
  console.log(`  Results: ${join(resultsDir, runId)}`);

  if (judgeActive) {
    // Print per-model judge averages
    const modelIds = [...new Set(allResults.map((r) => r.model.id))];
    console.log("\nJudge qualitative averages (per model):");
    for (const mid of modelIds) {
      const modelResults = allResults.filter(
        (r) => r.model.id === mid && r.judgeResult && !r.judgeResult.judge_error
      );
      if (modelResults.length === 0) continue;
      const avgQual =
        modelResults.reduce((s, r) => s + (r.judgeResult?.weighted_average ?? 0), 0) / modelResults.length;
      const avgStruct =
        modelResults.reduce((s, r) => s + (r.score.overall ?? 0), 0) / modelResults.length;
      console.log(
        `  ${mid.padEnd(25)} structural: ${avgStruct.toFixed(3)}  qualitative: ${avgQual.toFixed(3)}`
      );
    }
  }

  const topResults = allResults
    .filter((r) => r.score.overall != null)
    .sort((a, b) => (b.score.overall ?? 0) - (a.score.overall ?? 0))
    .slice(0, 3);

  if (topResults.length > 0) {
    console.log("\nTop results (structural):");
    for (const r of topResults) {
      console.log(
        `  ${r.model.id.padEnd(20)} × ${r.fixture_id.padEnd(30)} — ${r.score.overall!.toFixed(3)}`
      );
    }
  }
}

function generateOrchestratorSummary(
  results: OrchestratorScoredResult[],
  config: RunConfig,
  promptHash: string,
  judgeActive: boolean
): string {
  const lines: string[] = [];
  lines.push(`# Orchestrator Evaluator — Run Summary\n`);
  lines.push(`Run ID: \`${config.run_id}\``);
  lines.push(`Prompt: \`${config.prompt_file}\` (${promptHash})`);
  lines.push(`Judge: ${judgeActive ? "enabled" : "disabled"}\n`);

  // Structural scores table
  lines.push("## Structural Scores\n");
  const dimKeys = Object.keys(results[0]?.score.dimensions ?? {});
  lines.push(`| Model | Case | Overall | ${dimKeys.join(" | ")} | Latency |`);
  lines.push(`| --- | --- | --- | ${dimKeys.map(() => "---").join(" | ")} | --- |`);

  for (const r of results) {
    const dims = Object.values(r.score.dimensions).map((v) => {
      if (v === null) return "—";
      if (typeof v === "boolean") return v ? "✓" : "✗";
      return typeof v === "number" ? v.toFixed(3) : String(v);
    });
    lines.push(
      `| ${r.model.id} | ${r.fixture_id} | ${r.score.overall?.toFixed(3) ?? "—"} | ${dims.join(" | ")} | ${r.response.latency_ms}ms |`
    );
  }

  if (judgeActive) {
    const judgeDimKeys = [
      "scientific_polymath", "causal_mechanism", "coaching_over_telling",
      "grounded_quantification", "warm_directness", "appropriate_brevity",
      "constructive_challenge", "elicitation_quality", "session_coherence",
    ];

    lines.push("\n## Judge Qualitative Scores\n");
    lines.push(`| Model | Case | Weighted Avg | ${judgeDimKeys.join(" | ")} | Impression |`);
    lines.push(`| --- | --- | --- | ${judgeDimKeys.map(() => "---").join(" | ")} | --- |`);

    for (const r of results) {
      const jr = r.judgeResult;
      if (!jr || jr.judge_error) {
        lines.push(`| ${r.model.id} | ${r.fixture_id} | ERROR | ${judgeDimKeys.map(() => "—").join(" | ")} | ${jr?.judge_error ?? "no judge"} |`);
        continue;
      }
      const dimScores = judgeDimKeys.map((k) => {
        const d = jr.scores[k as keyof typeof jr.scores];
        return d ? `${d.score}/5` : "—";
      });
      lines.push(
        `| ${r.model.id} | ${r.fixture_id} | ${jr.weighted_average.toFixed(3)} | ${dimScores.join(" | ")} | ${jr.overall_impression.slice(0, 80)}... |`
      );
    }

    // Per-model averages
    const modelIds = [...new Set(results.map((r) => r.model.id))];
    lines.push("\n## Per-Model Averages\n");
    lines.push(`| Model | Structural | Qualitative | ${judgeDimKeys.join(" | ")} |`);
    lines.push(`| --- | --- | --- | ${judgeDimKeys.map(() => "---").join(" | ")} |`);

    for (const mid of modelIds) {
      const mr = results.filter((r) => r.model.id === mid && r.judgeResult && !r.judgeResult.judge_error);
      if (mr.length === 0) continue;
      const avgStruct = mr.reduce((s, r) => s + (r.score.overall ?? 0), 0) / mr.length;
      const avgQual = mr.reduce((s, r) => s + (r.judgeResult?.weighted_average ?? 0), 0) / mr.length;
      const dimAvgs = judgeDimKeys.map((k) => {
        const sum = mr.reduce((s, r) => {
          const d = r.judgeResult?.scores[k as keyof typeof r.judgeResult.scores];
          return s + (d?.score ?? 0);
        }, 0);
        return (sum / mr.length).toFixed(1);
      });
      lines.push(`| ${mid} | ${avgStruct.toFixed(3)} | ${avgQual.toFixed(3)} | ${dimAvgs.join(" | ")} |`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

// =============================================================================
// Generic summary generator
// =============================================================================

function generateGenericSummary(
  results: GenericScoredResult[],
  config: RunConfig,
  promptHash: string
): string {
  const lines: string[] = [];
  lines.push(`# ${config.prompt_type} Evaluator — Run Summary\n`);
  lines.push(`Run ID: \`${config.run_id}\``);
  lines.push(`Prompt: \`${config.prompt_file}\` (${promptHash})`);
  lines.push(`Type: ${config.prompt_type}\n`);

  // Scores table
  lines.push("## Scores\n");
  const dimKeys = Object.keys(results[0]?.score.dimensions ?? {});
  lines.push(`| Model | Case | Overall | ${dimKeys.join(" | ")} | Latency | Failure |`);
  lines.push(`| --- | --- | --- | ${dimKeys.map(() => "---").join(" | ")} | --- | --- |`);

  for (const r of results) {
    const dims = Object.values(r.score.dimensions).map((v) => {
      if (v === null) return "—";
      if (typeof v === "boolean") return v ? "✓" : "✗";
      return typeof v === "number" ? v.toFixed(3) : String(v);
    });
    lines.push(
      `| ${r.model.id} | ${r.fixture_id} | ${r.score.overall?.toFixed(3) ?? "—"} | ${dims.join(" | ")} | ${r.response.latency_ms}ms | ${r.response.failure_code ?? "—"} |`
    );
  }

  lines.push("");
  return lines.join("\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
