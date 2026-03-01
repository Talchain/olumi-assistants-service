/**
 * CLI entry point for the graph evaluator.
 *
 * Parses CLI arguments, orchestrates the run, and handles all file I/O.
 * Calls runner, scorer, and reporter as pure functions.
 *
 * Usage:
 *   npx ts-node --esm src/cli.ts --prompt prompts/draft_graph_v20.txt
 *   npx ts-node --esm src/cli.ts --prompt prompts/draft_graph_v20.txt --dry-run
 */

import { config as loadDotenv } from "dotenv";
import { Command } from "commander";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

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

import type { ScoredResult, RunManifest, RunConfig } from "./types.js";

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TOOL_ROOT = resolve(__dirname, "..");

// =============================================================================
// Version
// =============================================================================

const TOOL_VERSION = "1.0.0";

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  loadDotenv();

  const program = new Command()
    .name("graph-evaluator")
    .description("Evaluate LLM draft-graph generation quality across models and briefs")
    .version(TOOL_VERSION)
    .requiredOption("--prompt <path>", "Path to the system prompt file (required)")
    .option(
      "--models <ids>",
      "Comma-separated model IDs to run (default: all)",
      ""
    )
    .option(
      "--briefs <ids>",
      "Comma-separated brief IDs to run (default: all)",
      ""
    )
    .option("--force", "Force re-run even if cached results exist", false)
    .option(
      "--resume",
      "Re-run only entries marked as failed (parse_failed, timeout_failed, rate_limited)",
      false
    )
    .option("--dry-run", "List combinations without calling APIs", false)
    .parse(process.argv);

  const opts = program.opts<{
    prompt: string;
    models: string;
    briefs: string;
    force: boolean;
    resume: boolean;
    dryRun: boolean;
  }>();

  // ── Resolve paths ──────────────────────────────────────────────────────────
  const promptPath = resolve(opts.prompt);
  const modelsDir = join(TOOL_ROOT, "models");
  const briefsDir = join(TOOL_ROOT, "briefs");
  const resultsDir = join(TOOL_ROOT, "results");

  // ── Parse filter args ──────────────────────────────────────────────────────
  const modelFilter = opts.models
    ? opts.models.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const briefFilter = opts.briefs
    ? opts.briefs.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  // ── Load inputs ────────────────────────────────────────────────────────────
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

  let briefs;
  try {
    briefs = await readBriefs(briefsDir, briefFilter.length > 0 ? briefFilter : undefined);
  } catch (err) {
    console.error(`Failed to load briefs from ${briefsDir}:`, err);
    process.exit(1);
  }

  if (briefs.length === 0) {
    console.error("No briefs found. Check briefs/ directory and --briefs filter.");
    process.exit(1);
  }

  let promptContent;
  try {
    promptContent = await readPrompt(promptPath);
  } catch (err) {
    console.error(`Failed to read prompt file: ${promptPath}`, err);
    process.exit(1);
  }

  // ── Build run configuration ────────────────────────────────────────────────
  const runId = buildRunId(opts.prompt);
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
  };

  // ── Dry run: list combinations and exit ───────────────────────────────────
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

  // ── Create results directory ───────────────────────────────────────────────
  await ensureDir(join(resultsDir, runId));

  // ── Write run manifest ─────────────────────────────────────────────────────
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
      const briefPath = join(briefsDir, `${brief.id}.md`);
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

  // ── Run LLM calls ──────────────────────────────────────────────────────────
  console.log(`\nStarting run: ${runId}`);
  console.log(`Models: ${models.map((m) => m.id).join(", ")}`);
  console.log(`Briefs: ${briefs.map((b) => b.id).join(", ")}`);
  console.log();

  const responses = await run({
    models,
    briefs,
    promptContent,
    promptFile: opts.prompt,
    runId,
    resultsDir,
    force: opts.force,
    resume: opts.resume,
    dryRun: false,
    loadCached: async (modelId, briefId) =>
      loadResponse(resultsDir, runId, modelId, briefId),
    saveResult: async (modelId, briefId, result) =>
      saveResponse(resultsDir, runId, modelId, briefId, result),
  });

  if (responses.length === 0) {
    console.log("No responses to score. Run complete.");
    return;
  }

  // ── Score all responses ────────────────────────────────────────────────────
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

  // ── Generate reports ───────────────────────────────────────────────────────
  console.log("Generating reports...");

  const reports = generate({
    results: scored,
    config,
    models,
    briefs,
    promptHash,
  });

  await saveReports(resultsDir, runId, reports);

  // ── Print summary ──────────────────────────────────────────────────────────
  const successCount = scored.filter((r) => r.score.overall_score != null).length;
  const failCount = scored.filter((r) => r.response.failure_code).length;
  const invalidCount = scored.filter(
    (r) => !r.score.structural_valid && !r.response.failure_code
  ).length;

  console.log(`\n✓ Run complete: ${runId}`);
  console.log(`  ${successCount} scored | ${invalidCount} invalid | ${failCount} failed`);
  console.log(`  Results: ${join(resultsDir, runId)}`);

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

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
