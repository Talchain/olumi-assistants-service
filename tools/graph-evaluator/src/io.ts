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
import type { ModelConfig, Brief, BriefMeta, CorpusClass, ExpectedConstraint, ExpectedRatioMetric, ExpectedUserValue, LLMResponse, RunManifest, ReportFiles } from "./types.js";

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
    const raw = JSON.parse(content) as Record<string, unknown>;
    // Default provider to 'openai' for backward-compatible legacy configs
    const config = { provider: "openai" as const, ...raw } as ModelConfig;
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

// =============================================================================
// WP1 — the front-matter ORACLE
// =============================================================================

/**
 * SIDECAR ORACLES, and why they exist.
 *
 * `governed/draft-graph-v5/manifest.json` sha256-PINS the bytes of all fourteen
 * numbered briefs, and `governed-draft-graph.ts:622` raises a `CORPUS_DRIFT`
 * problem for any mismatch. Three of the six briefs WP1 needs an oracle for
 * (`02-multi-option-constrained`, `03-vague-underspecified`, `12-similar-options`)
 * are inside that pin and currently MATCH it. Writing the oracle into their front
 * matter would silently break a governance artefact — and the graph-evaluator CI
 * ratchet could not see it, by its own documented blind spot (all thirteen
 * governed problems live in ONE failing assertion, so a fourteenth changes no
 * signal the ratchet reads).
 *
 * So the oracle for a pinned brief lives in `briefs/oracles/<id>.md` — a file
 * holding front matter and nothing else, parsed with the same gray-matter
 * dialect. Unpinned briefs (`pricing-staging`, `hiring-staging`, and anything not
 * in the manifest) carry theirs inline. `meta.oracle_source` records which, so a
 * reader never has to guess.
 */
export const ORACLE_SIDECAR_DIR = "oracles";

function asExpectedUserValues(raw: unknown): ExpectedUserValue[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw as ExpectedUserValue[];
}

function asStringList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((v) => String(v));
}

/** Build BriefMeta from a merged front-matter record. */
function buildBriefMeta(
  data: Record<string, unknown>,
  oracleSource: "front_matter" | "sidecar"
): BriefMeta {
  return {
    expect_status_quo: Boolean(data["expect_status_quo"] ?? true),
    has_numeric_target: Boolean(data["has_numeric_target"] ?? false),
    complexity: (data["complexity"] as BriefMeta["complexity"]) ?? "simple",
    expect_external_factor: data["expect_external_factor"] != null
      ? Boolean(data["expect_external_factor"])
      : undefined,
    expected_constraints: Array.isArray(data["expected_constraints"])
      ? (data["expected_constraints"] as ExpectedConstraint[])
      : undefined,
    ratio_metrics: Array.isArray(data["ratio_metrics"])
      ? (data["ratio_metrics"] as ExpectedRatioMetric[])
      : undefined,
    // ── WP1 oracle ───────────────────────────────────────────────────────────
    expected_user_values: asExpectedUserValues(data["expected_user_values"]),
    expected_user_options: typeof data["expected_user_options"] === "number"
      ? (data["expected_user_options"] as number)
      : undefined,
    expected_horizon: (data["expected_horizon"] as BriefMeta["expected_horizon"]) ?? undefined,
    expected_qualitative: asStringList(data["expected_qualitative"]),
    expected_temporal: asStringList(data["expected_temporal"]),
    controllable_levers: asStringList(data["controllable_levers"]),
    corpus_class: (data["corpus_class"] as CorpusClass) ?? undefined,
    oracle_source: oracleSource,
  };
}

/**
 * Load all brief files from a directory.
 * Parses YAML front-matter using gray-matter, then overlays a sidecar oracle
 * from `<briefsDir>/oracles/<id>.md` when one exists (see ORACLE_SIDECAR_DIR).
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

    // Sidecar oracle for a brief whose bytes are hash-pinned elsewhere.
    const sidecarPath = join(briefsDir, ORACLE_SIDECAR_DIR, `${id}.md`);
    let merged: Record<string, unknown> = { ...parsed.data };
    let oracleSource: "front_matter" | "sidecar" = "front_matter";
    if (existsSync(sidecarPath)) {
      const sidecar = matter(await readFile(sidecarPath, "utf-8"));
      merged = { ...merged, ...sidecar.data };
      oracleSource = "sidecar";
    }

    const meta: BriefMeta = buildBriefMeta(merged, oracleSource);

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
