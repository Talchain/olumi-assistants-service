/**
 * File I/O utilities for the graph evaluator.
 *
 * All file system access is isolated here so that runner, scorer, and
 * reporter remain pure functions that can be imported by a future API.
 */

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import matter from "gray-matter";
import type { ModelConfig, Brief, BriefMeta, LLMResponse, RunManifest, ReportFiles } from "./types.js";

// =============================================================================
// Hashing
// =============================================================================

/** SHA-256 hex digest of a string. */
export function hashContent(content: string): string {
  return "sha256:" + createHash("sha256").update(content).digest("hex");
}

// =============================================================================
// Git SHA
// =============================================================================

/** Returns the short git SHA of the current HEAD, or "unknown" on failure. */
export function getGitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["pipe", "pipe", "pipe"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

// =============================================================================
// Run ID
// =============================================================================

/** Build a run ID from the prompt filename. Format: YYYY-MM-DD_HH-mm-ss_stem */
export function buildRunId(promptFile: string): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const time = now.toTimeString().slice(0, 8).replace(/:/g, "-"); // HH-mm-ss
  const stem = basename(promptFile, extname(promptFile));
  return `${date}_${time}_${stem}`;
}

// =============================================================================
// Directory utilities
// =============================================================================

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function fileExists(path: string): Promise<boolean> {
  return existsSync(path);
}

// =============================================================================
// Model config loading
// =============================================================================

/**
 * Load all model configs from a directory.
 * Skips files starting with `_` (e.g., _template.json).
 */
export async function readModels(
  modelsDir: string,
  filter?: string[]
): Promise<ModelConfig[]> {
  const files = await readdir(modelsDir);
  const jsonFiles = files.filter(
    (f) => f.endsWith(".json") && !f.startsWith("_")
  );

  const configs: ModelConfig[] = [];
  for (const file of jsonFiles) {
    const content = await readFile(join(modelsDir, file), "utf-8");
    const config = JSON.parse(content) as ModelConfig;
    configs.push(config);
  }

  if (filter && filter.length > 0) {
    return configs.filter((c) => filter.includes(c.id));
  }

  return configs.sort((a, b) => a.id.localeCompare(b.id));
}

// =============================================================================
// Brief loading
// =============================================================================

/**
 * Load all brief files from a directory.
 * Parses YAML front-matter using gray-matter.
 */
export async function readBriefs(
  briefsDir: string,
  filter?: string[]
): Promise<Brief[]> {
  const files = await readdir(briefsDir);
  const mdFiles = files
    .filter((f) => f.endsWith(".md"))
    .sort();

  const briefs: Brief[] = [];
  for (const file of mdFiles) {
    const content = await readFile(join(briefsDir, file), "utf-8");
    const parsed = matter(content);

    const id = basename(file, ".md");
    const meta: BriefMeta = {
      expect_status_quo: Boolean(parsed.data["expect_status_quo"] ?? true),
      has_numeric_target: Boolean(parsed.data["has_numeric_target"] ?? false),
      complexity: (parsed.data["complexity"] as BriefMeta["complexity"]) ?? "simple",
    };

    briefs.push({
      id,
      meta,
      body: parsed.content.trim(),
    });
  }

  if (filter && filter.length > 0) {
    return briefs.filter((b) => filter.includes(b.id));
  }

  return briefs;
}

// =============================================================================
// Prompt loading
// =============================================================================

export async function readPrompt(promptPath: string): Promise<string> {
  return readFile(promptPath, "utf-8");
}

// =============================================================================
// Response persistence
// =============================================================================

/** Save an LLM response to the results directory. */
export async function saveResponse(
  resultsDir: string,
  runId: string,
  modelId: string,
  briefId: string,
  data: LLMResponse
): Promise<void> {
  const dir = join(resultsDir, runId, modelId, briefId);
  await ensureDir(dir);
  await writeFile(
    join(dir, "response.json"),
    // Never log or persist API key values — the data object must not contain them
    JSON.stringify(data, null, 2),
    "utf-8"
  );
}

/** Load a cached response, or null if it doesn't exist. */
export async function loadResponse(
  resultsDir: string,
  runId: string,
  modelId: string,
  briefId: string
): Promise<LLMResponse | null> {
  const path = join(resultsDir, runId, modelId, briefId, "response.json");
  if (!(await fileExists(path))) return null;

  const content = await readFile(path, "utf-8");
  return JSON.parse(content) as LLMResponse;
}

// =============================================================================
// Run manifest
// =============================================================================

export async function saveManifest(
  resultsDir: string,
  runId: string,
  manifest: RunManifest
): Promise<void> {
  const dir = join(resultsDir, runId);
  await ensureDir(dir);
  await writeFile(join(dir, "run.json"), JSON.stringify(manifest, null, 2), "utf-8");
}

// =============================================================================
// Reports
// =============================================================================

export async function saveReports(
  resultsDir: string,
  runId: string,
  files: ReportFiles
): Promise<void> {
  const dir = join(resultsDir, runId);
  await ensureDir(dir);

  await Promise.all([
    writeFile(join(dir, "scores.csv"), files.scores_csv, "utf-8"),
    writeFile(join(dir, "summary.md"), files.summary_md, "utf-8"),
    writeFile(join(dir, "analysis-pack.md"), files.analysis_pack_md, "utf-8"),
  ]);
}

// =============================================================================
// Config hashing (for run manifest)
// =============================================================================

export async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath, "utf-8");
  return hashContent(content);
}
