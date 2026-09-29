/**
 * Capture Golden Responses
 *
 * Loads scored outputs from a completed evaluator run and saves them as
 * golden baseline fixtures for future regression checks.
 *
 * Usage:
 *   npx tsx scripts/capture-golden-responses.ts --run-id dg4-gpt4o-v2 --type draft_graph
 *   npx tsx scripts/capture-golden-responses.ts --run-id 2026-03-14_01-27-40_edit_graph_v2 --type edit_graph
 *
 * Reads from:
 *   results/{run_id}/run.json                           ← manifest
 *   results/{run_id}/{model_id}/{brief_id}/response.json ← per-brief LLM responses
 *
 * Writes to:
 *   golden-responses/{prompt_type}/
 *     manifest.json                                      ← capture metadata
 *     {model_id}/
 *       {brief_id}.json                                  ← { brief_id, model, prompt_hash, response, scores, captured_at }
 *
 * The capture is idempotent — re-running overwrites previous golden responses
 * for the same prompt_type.
 */

import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, readdir } from "node:fs/promises";

import {
  loadResponse,
  ensureDir,
  getGitSha,
} from "../src/io.js";

import { DraftGraphAdapter } from "../src/adapters/draft-graph.js";
import { EditGraphAdapter } from "../src/adapters/edit-graph.js";
import { DecisionReviewAdapter } from "../src/adapters/decision-review.js";
import { OrchestratorAdapter } from "../src/adapters/orchestrator.js";

import type {
  PromptType,
  EvaluatorAdapter,
  LLMResponse,
  GenericScoreResult,
  RunManifest,
} from "../src/types.js";

// ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TOOL_ROOT = resolve(__dirname, "..");

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

// ============================================================================
// Helpers
// ============================================================================

async function loadJson<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf-8");
  return JSON.parse(content) as T;
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const stat = await readdir(path);
    return stat.length >= 0;
  } catch {
    return false;
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  // Parse args
  const args = process.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const idx = args.indexOf(name);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  const runId = getArg("--run-id");
  const promptType = getArg("--type") as PromptType | undefined;

  if (!runId || !promptType) {
    console.error("Usage: npx tsx scripts/capture-golden-responses.ts --run-id <run_id> --type <prompt_type>");
    console.error("  --run-id   ID of a completed evaluator run (directory in results/)");
    console.error("  --type     Prompt type: draft_graph | edit_graph | decision_review | orchestrator");
    process.exit(2);
  }

  const resultsDir = join(TOOL_ROOT, "results");
  const runDir = join(resultsDir, runId);

  // Load run manifest
  const manifestPath = join(runDir, "run.json");
  let manifest: RunManifest;
  try {
    manifest = await loadJson<RunManifest>(manifestPath);
  } catch {
    console.error(`❌ Cannot read run manifest at ${manifestPath}`);
    console.error(`   Make sure the evaluator run completed successfully.`);
    process.exit(2);
    return; // unreachable but satisfies TS
  }

  const promptHash = manifest.prompt.content_hash;
  const modelIds = Object.keys(manifest.models);
  const briefIds = Object.keys(manifest.briefs);

  console.log(`\n📋 Capturing golden responses from existing run`);
  console.log(`   Run ID:      ${runId}`);
  console.log(`   Type:        ${promptType}`);
  console.log(`   Prompt hash: ${promptHash}`);
  console.log(`   Models:      ${modelIds.join(", ")}`);
  console.log(`   Briefs:      ${briefIds.length}`);
  console.log();

  // Load adapter for scoring
  const adapter = getAdapter(promptType);
  const typeDirName = promptType.replace(/_/g, "-");
  const fixtureDir = join(TOOL_ROOT, "fixtures", typeDirName);
  const fixtures = await adapter.loadCases(fixtureDir);
  const fixtureMap = new Map(fixtures.map((f: { id: string }) => [f.id, f]));

  // Golden output directory
  const goldenDir = join(TOOL_ROOT, "golden-responses", typeDirName);
  const entries: GoldenEntry[] = [];
  const capturedAt = new Date().toISOString();

  for (const modelId of modelIds) {
    // Check if model dir exists in run
    const modelDir = join(runDir, modelId);
    if (!(await dirExists(modelDir))) {
      console.log(`   ⚠️  No results for model ${modelId}`);
      continue;
    }

    for (const briefId of briefIds) {
      // Load cached response
      const response = await loadResponse(resultsDir, runId, modelId, briefId);
      if (!response) {
        console.log(`   ⚠️  ${modelId} / ${briefId}: no response found`);
        continue;
      }

      // Find matching fixture for scoring
      const fixture = fixtureMap.get(briefId);
      if (!fixture) {
        console.log(`   ⚠️  ${modelId} / ${briefId}: no matching fixture`);
        continue;
      }

      // Score via adapter
      const parsed = response.parsed_json ?? response.parsed_graph ?? null;
      const scoreResult: GenericScoreResult = adapter.score(
        fixture,
        parsed as Record<string, unknown> | null,
        response,
      );

      // Build golden entry — keyed by brief_id with captured scores
      const entry: GoldenEntry = {
        brief_id: briefId,
        model: modelId,
        prompt_hash: promptHash,
        response,
        scores: scoreResult.dimensions,
        overall: scoreResult.overall,
        captured_at: capturedAt,
      };
      entries.push(entry);

      // Save per-model/per-brief
      const entryDir = join(goldenDir, modelId);
      await ensureDir(entryDir);
      await writeFile(
        join(entryDir, `${briefId}.json`),
        JSON.stringify(entry, null, 2),
        "utf-8",
      );

      const overall = scoreResult.overall !== null ? scoreResult.overall.toFixed(3) : "N/A";
      console.log(`   ✅ ${modelId} / ${briefId}: ${overall}`);
    }
  }

  // Write golden manifest
  const goldenManifest: GoldenManifest = {
    captured_at: capturedAt,
    git_sha: getGitSha(),
    source_run_id: runId,
    prompt_type: promptType,
    prompt_hash: promptHash,
    models: modelIds,
    fixture_count: briefIds.length,
    entry_count: entries.length,
  };

  await ensureDir(goldenDir);
  await writeFile(
    join(goldenDir, "manifest.json"),
    JSON.stringify(goldenManifest, null, 2),
    "utf-8",
  );

  console.log(`\n✨ Golden responses captured: ${entries.length} entries`);
  console.log(`   Directory: ${goldenDir}`);
  console.log(`   Manifest:  ${join(goldenDir, "manifest.json")}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
