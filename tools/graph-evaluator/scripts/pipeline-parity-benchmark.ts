/**
 * Pipeline Parity Benchmark
 *
 * Compares raw LLM draft graph output against post-pipeline (staging endpoint)
 * output to measure whether the production pipeline improves or degrades graph
 * quality.
 *
 * Phase A: Same-brief comparison (independent samples — two separate LLM calls)
 * Phase B: Identical to Phase A (no offline replay available — see report header)
 *
 * Note: The unified pipeline does NOT support injecting a pre-parsed graph
 * (Stage 1 Parse always calls the LLM). Both phases therefore use the staging
 * endpoint independently. Phase A and Phase B are reported identically but
 * labelled differently for clarity.
 *
 * Usage:
 *   RUN_PIPELINE_PARITY=1 npx tsx tools/graph-evaluator/scripts/pipeline-parity-benchmark.ts
 *   RUN_PIPELINE_PARITY=1 npx tsx tools/graph-evaluator/scripts/pipeline-parity-benchmark.ts --dry-run
 *   RUN_PIPELINE_PARITY=1 npx tsx tools/graph-evaluator/scripts/pipeline-parity-benchmark.ts --briefs 01,13,11
 *   RUN_PIPELINE_PARITY=1 npx tsx tools/graph-evaluator/scripts/pipeline-parity-benchmark.ts --phase-a-only
 *   RUN_PIPELINE_PARITY=1 npx tsx tools/graph-evaluator/scripts/pipeline-parity-benchmark.ts --phase-b-only
 *
 * Environment variables (required):
 *   CEE_BASE_URL  — staging endpoint base URL (e.g. https://staging.example.com)
 *   CEE_API_KEY   — staging API key (X-Olumi-Assist-Key header)
 *   OPENAI_API_KEY — for direct LLM calls via evaluator adapter
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { validateStructural } from "../src/validator.js";
import { score as scoreDraftGraph } from "../src/scorer.js";
import { getProvider } from "../src/providers/index.js";
import { extractJSON } from "../src/json-extractor.js";
import type {
  ParsedGraph,
  GraphNode,
  GraphEdge,
  Brief,
  BriefMeta,
  LLMResponse,
  ScoreResult,
  ModelConfig,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EVALUATOR_ROOT = path.resolve(__dirname, "..");
const BRIEFS_DIR = path.join(EVALUATOR_ROOT, "briefs");
const PROMPTS_DIR = path.join(EVALUATOR_ROOT, "prompts");
const RESULTS_BASE = path.join(EVALUATOR_ROOT, "results", "pipeline-parity");

const PROMPT_FILE = "draft-v178.txt";
const MODEL_ID = "gpt-4o";
const REQUEST_TIMEOUT_MS = 120_000;

const DRY_RUN_BRIEFS = ["01-simple-binary", "13-forced-binary", "11-feedback-loop-trap"];

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
}

const isDryRun = hasFlag("--dry-run");
const phaseAOnly = hasFlag("--phase-a-only");
const phaseBOnly = hasFlag("--phase-b-only");
const briefsArg = getArg("--briefs");

// ---------------------------------------------------------------------------
// Environment checks
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`ERROR: Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return val;
}

// ---------------------------------------------------------------------------
// Brief loading
// ---------------------------------------------------------------------------

async function loadBriefs(filter?: string[]): Promise<Brief[]> {
  const files = fs.readdirSync(BRIEFS_DIR)
    .filter((f) => f.endsWith(".md"))
    .filter((f) => !f.startsWith("hiring-") && !f.startsWith("pricing-"))
    .sort();

  const briefs: Brief[] = [];
  for (const file of files) {
    const id = path.basename(file, ".md");
    if (filter && !filter.some((f) => id.includes(f))) continue;

    const content = fs.readFileSync(path.join(BRIEFS_DIR, file), "utf-8");
    const parsed = matter(content);
    const meta: BriefMeta = {
      expect_status_quo: Boolean(parsed.data["expect_status_quo"] ?? true),
      has_numeric_target: Boolean(parsed.data["has_numeric_target"] ?? false),
      complexity: (parsed.data["complexity"] as BriefMeta["complexity"]) ?? "simple",
    };
    briefs.push({ id, meta, body: parsed.content.trim() });
  }
  return briefs;
}

// ---------------------------------------------------------------------------
// Model config
// ---------------------------------------------------------------------------

function loadModelConfig(): ModelConfig {
  const configPath = path.join(EVALUATOR_ROOT, "models", `${MODEL_ID}.json`);
  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  return { ...raw, timeout_ms: REQUEST_TIMEOUT_MS };
}

// ---------------------------------------------------------------------------
// Raw LLM call (direct, via evaluator provider)
// ---------------------------------------------------------------------------

async function callRawLLM(
  brief: Brief,
  promptContent: string,
  model: ModelConfig
): Promise<{ response: LLMResponse; raw_text: string }> {
  const provider = getProvider(model);
  const start = Date.now();
  const result = await provider.chat(promptContent, brief.body, model);
  const latency_ms = Date.now() - start;

  if (!result.ok) {
    return {
      response: {
        model_id: model.id,
        brief_id: brief.id,
        status: "server_error",
        failure_code: "server_error",
        error_message: result.error ?? "Unknown error",
        latency_ms,
      },
      raw_text: "",
    };
  }

  const rawText = result.text ?? "";
  const extraction = extractJSON(rawText);

  if (!extraction.parsed) {
    return {
      response: {
        model_id: model.id,
        brief_id: brief.id,
        status: "parse_failed",
        failure_code: "parse_failed",
        raw_text: rawText,
        latency_ms,
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        error_message: "No extractable JSON found in response",
      },
      raw_text: rawText,
    };
  }

  return {
    response: {
      model_id: model.id,
      brief_id: brief.id,
      status: "success",
      raw_text: rawText,
      parsed_graph: extraction.parsed as unknown as ParsedGraph,
      latency_ms,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
    },
    raw_text: rawText,
  };
}

// ---------------------------------------------------------------------------
// Staging endpoint call
// ---------------------------------------------------------------------------

interface StagingResult {
  status: "success" | "error" | "timeout" | "parse_failed";
  http_status?: number;
  body?: Record<string, unknown>;
  parsed_graph?: ParsedGraph;
  latency_ms: number;
  error?: string;
  trace?: Record<string, unknown>;
}

function v3ResponseToGraph(body: Record<string, unknown>): ParsedGraph | null {
  const nodes = body["nodes"] as Array<Record<string, unknown>> | undefined;
  const edges = body["edges"] as Array<Record<string, unknown>> | undefined;

  if (!nodes || !edges || !Array.isArray(nodes) || !Array.isArray(edges)) {
    return null;
  }

  // Map V3 options array back onto option nodes as interventions
  const optionsArray = (body["options"] ?? []) as Array<Record<string, unknown>>;
  const optionInterventions = new Map<string, Record<string, number>>();
  for (const opt of optionsArray) {
    const optId = opt["id"] as string;
    const intv = opt["interventions"] as Record<string, unknown> | undefined;
    if (optId && intv) {
      const flat: Record<string, number> = {};
      for (const [key, val] of Object.entries(intv)) {
        if (typeof val === "number") {
          flat[key] = val;
        } else if (typeof val === "object" && val !== null && "value" in val) {
          flat[key] = (val as { value: number }).value;
        }
      }
      optionInterventions.set(optId, flat);
    }
  }

  const graphNodes: GraphNode[] = nodes.map((n) => {
    const nodeId = n["id"] as string;
    const kind = n["kind"] as GraphNode["kind"];
    const category = n["category"] as GraphNode["category"];
    const label = n["label"] as string | undefined;

    // Map observed_state → data
    const observedState = n["observed_state"] as Record<string, unknown> | undefined;
    const existingData = n["data"] as Record<string, unknown> | undefined;
    const data: Record<string, unknown> = { ...(existingData ?? {}), ...(observedState ?? {}) };

    // For option nodes, inject interventions from options array
    if (kind === "option" && optionInterventions.has(nodeId)) {
      data["interventions"] = optionInterventions.get(nodeId);
    }

    const node: GraphNode = {
      id: nodeId,
      kind,
      label,
      category,
      data: data as GraphNode["data"],
    };

    // Goal threshold fields
    if (n["goal_threshold"] != null) node.goal_threshold = n["goal_threshold"] as number;
    if (n["goal_threshold_raw"] != null) node.goal_threshold_raw = n["goal_threshold_raw"] as number;
    if (n["goal_threshold_unit"] != null) node.goal_threshold_unit = n["goal_threshold_unit"] as string;
    if (n["goal_threshold_cap"] != null) node.goal_threshold_cap = n["goal_threshold_cap"] as number;

    // Prior for external factors
    if (n["prior"]) node.prior = n["prior"] as GraphNode["prior"];

    return node;
  });

  const graphEdges: GraphEdge[] = edges.map((e) => {
    const strength = e["strength"] as { mean: number; std: number } | undefined;
    return {
      from: e["from"] as string,
      to: e["to"] as string,
      strength: strength ?? { mean: 0.5, std: 0.125 },
      exists_probability: (e["exists_probability"] as number) ?? 1.0,
      edge_type: e["edge_type"] as GraphEdge["edge_type"],
      effect_direction: e["effect_direction"] as GraphEdge["effect_direction"],
    };
  });

  const coaching = body["coaching"] as ParsedGraph["coaching"] | undefined;
  const goalConstraints = body["goal_constraints"] as ParsedGraph["goal_constraints"] | undefined;
  const causalClaims = body["causal_claims"] as ParsedGraph["causal_claims"] | undefined;

  return {
    nodes: graphNodes,
    edges: graphEdges,
    coaching,
    goal_constraints: goalConstraints,
    causal_claims: causalClaims,
  };
}

async function callStagingEndpoint(
  brief: Brief,
  baseUrl: string,
  apiKey: string
): Promise<StagingResult> {
  const url = `${baseUrl}/assist/v1/draft-graph?schema=v3`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Olumi-Assist-Key": apiKey,
      },
      body: JSON.stringify({ brief: brief.body }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latency_ms = Date.now() - start;

    const bodyText = await res.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return {
        status: "parse_failed",
        http_status: res.status,
        latency_ms,
        error: `Invalid JSON response: ${bodyText.slice(0, 200)}`,
      };
    }

    if (res.status !== 200) {
      return {
        status: "error",
        http_status: res.status,
        body,
        latency_ms,
        error: (body["message"] as string) ?? `HTTP ${res.status}`,
      };
    }

    // Check for needs_clarification
    if (body["status"] === "needs_clarification") {
      return {
        status: "error",
        http_status: 200,
        body,
        latency_ms,
        error: "needs_clarification response",
      };
    }

    const parsed_graph = v3ResponseToGraph(body);
    const trace = body["trace"] as Record<string, unknown> | undefined;

    if (!parsed_graph) {
      return {
        status: "parse_failed",
        http_status: 200,
        body,
        latency_ms,
        error: "Could not extract graph from V3 response",
      };
    }

    return {
      status: "success",
      http_status: 200,
      body,
      parsed_graph,
      latency_ms,
      trace,
    };
  } catch (err) {
    clearTimeout(timer);
    const latency_ms = Date.now() - start;
    const isAbort = err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"));
    return {
      status: isAbort ? "timeout" : "error",
      latency_ms,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function scoreGraph(graph: ParsedGraph, brief: Brief): ScoreResult {
  const fakeResponse: LLMResponse = {
    model_id: "pipeline-parity",
    brief_id: brief.id,
    status: "success",
    parsed_graph: graph,
    latency_ms: 0,
  };
  return scoreDraftGraph(fakeResponse, brief);
}

// ---------------------------------------------------------------------------
// Topology diff
// ---------------------------------------------------------------------------

interface TopologyDiff {
  topology_changed: boolean;
  nodes_added: string[];
  nodes_removed: string[];
  kinds_changed: Array<{ id: string; raw_kind: string; pipeline_kind: string }>;
  edge_count_delta: number;
  edges_changed: Array<{ from: string; to: string; change: string }>;
}

function computeTopologyDiff(
  rawGraph: ParsedGraph,
  pipelineGraph: ParsedGraph
): TopologyDiff {
  const rawNodeIds = new Set(rawGraph.nodes.map((n) => n.id));
  const pipelineNodeIds = new Set(pipelineGraph.nodes.map((n) => n.id));

  const nodes_added = [...pipelineNodeIds].filter((id) => !rawNodeIds.has(id));
  const nodes_removed = [...rawNodeIds].filter((id) => !pipelineNodeIds.has(id));

  const rawNodeKinds = new Map(rawGraph.nodes.map((n) => [n.id, n.kind]));
  const pipelineNodeKinds = new Map(pipelineGraph.nodes.map((n) => [n.id, n.kind]));

  const kinds_changed: TopologyDiff["kinds_changed"] = [];
  for (const [id, rawKind] of rawNodeKinds) {
    const pipeKind = pipelineNodeKinds.get(id);
    if (pipeKind && pipeKind !== rawKind) {
      kinds_changed.push({ id, raw_kind: rawKind, pipeline_kind: pipeKind });
    }
  }

  const edge_count_delta = pipelineGraph.edges.length - rawGraph.edges.length;

  const rawEdgeKeys = new Set(rawGraph.edges.map((e) => `${e.from}→${e.to}`));
  const pipeEdgeKeys = new Set(pipelineGraph.edges.map((e) => `${e.from}→${e.to}`));

  const edges_changed: TopologyDiff["edges_changed"] = [];
  for (const key of pipeEdgeKeys) {
    if (!rawEdgeKeys.has(key)) {
      const [from, to] = key.split("→");
      edges_changed.push({ from, to, change: "added" });
    }
  }
  for (const key of rawEdgeKeys) {
    if (!pipeEdgeKeys.has(key)) {
      const [from, to] = key.split("→");
      edges_changed.push({ from, to, change: "removed" });
    }
  }

  const topology_changed =
    nodes_added.length > 0 ||
    nodes_removed.length > 0 ||
    kinds_changed.length > 0 ||
    edges_changed.length > 0;

  return { topology_changed, nodes_added, nodes_removed, kinds_changed, edge_count_delta, edges_changed };
}

// ---------------------------------------------------------------------------
// Metadata extraction
// ---------------------------------------------------------------------------

interface CallMetadata {
  model_id: string;
  prompt_hash: string;
  pipeline_path: string;
  repair_fired: string;
  retry_count: string;
  enrichment_called: string;
  feature_flags: string;
  checkpoint_stages: string;
  latency_ms: number;
}

function extractMetadata(
  trace: Record<string, unknown> | undefined,
  latency_ms: number,
  source: "raw" | "pipeline"
): CallMetadata {
  if (source === "raw") {
    return {
      model_id: MODEL_ID,
      prompt_hash: "unavailable",
      pipeline_path: "none (raw LLM)",
      repair_fired: "n/a",
      retry_count: "0",
      enrichment_called: "n/a",
      feature_flags: "n/a",
      checkpoint_stages: "n/a",
      latency_ms,
    };
  }

  if (!trace) {
    return {
      model_id: "unavailable",
      prompt_hash: "unavailable",
      pipeline_path: "unavailable",
      repair_fired: "unavailable",
      retry_count: "unavailable",
      enrichment_called: "unavailable",
      feature_flags: "unavailable",
      checkpoint_stages: "unavailable",
      latency_ms,
    };
  }

  const pipeline = trace["pipeline"] as Record<string, unknown> | undefined;
  const engine = trace["engine"] as Record<string, unknown> | undefined;

  return {
    model_id: (engine?.["model"] as string) ?? (trace["model"] as string) ?? "unavailable",
    prompt_hash: (pipeline?.["prompt_hash"] as string) ?? (trace["prompt_hash"] as string) ?? "unavailable",
    pipeline_path: (pipeline?.["pipeline_path"] as string) ?? "unified",
    repair_fired: pipeline?.["repair"]
      ? JSON.stringify(pipeline["repair"])
      : (trace["corrections_summary"] as string) ?? "unavailable",
    retry_count: String(
      (trace["goal_handling"] as Record<string, unknown>)?.["retry_attempted"] === true ? 1 : 0
    ),
    enrichment_called: pipeline?.["enrich"]
      ? String((pipeline["enrich"] as Record<string, unknown>)?.["called_count"] ?? "unavailable")
      : "unavailable",
    feature_flags: "unavailable",
    checkpoint_stages: pipeline?.["checkpoints"]
      ? JSON.stringify(pipeline["checkpoints"])
      : "unavailable",
    latency_ms,
  };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

type Classification = "RESCUED" | "IMPROVED" | "NEUTRAL" | "DEGRADED" | "BROKEN";

function classify(
  rawValid: boolean,
  rawScore: number | null,
  pipeValid: boolean,
  pipeScore: number | null
): Classification {
  if (!rawValid && pipeValid) return "RESCUED";
  if (rawValid && !pipeValid) return "BROKEN";
  if (rawValid && pipeValid) {
    const delta = (pipeScore ?? 0) - (rawScore ?? 0);
    if (delta >= 0.02) return "IMPROVED";
    if (delta <= -0.02) return "DEGRADED";
    return "NEUTRAL";
  }
  // Both invalid
  return "NEUTRAL";
}

// ---------------------------------------------------------------------------
// Per-brief result type
// ---------------------------------------------------------------------------

interface BriefResult {
  brief_id: string;
  raw_status: string;
  raw_valid: boolean;
  raw_score: number | null;
  raw_violations: string[];
  raw_latency_ms: number;
  raw_node_count: number;
  raw_edge_count: number;
  raw_metadata: CallMetadata;
  pipeline_status: string;
  pipeline_valid: boolean;
  pipeline_score: number | null;
  pipeline_violations: string[];
  pipeline_latency_ms: number;
  pipeline_node_count: number;
  pipeline_edge_count: number;
  pipeline_metadata: CallMetadata;
  classification: Classification;
  topology_diff: TopologyDiff | null;
  notes: string;
}

// ---------------------------------------------------------------------------
// Main benchmark
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Gate check
  if (!process.env["RUN_PIPELINE_PARITY"]) {
    console.error("ERROR: Set RUN_PIPELINE_PARITY=1 to run this benchmark.");
    process.exit(1);
  }

  // Dry-run only needs briefs — skip env checks
  const ceeBaseUrl = isDryRun ? "https://dry-run" : requireEnv("CEE_BASE_URL");
  const ceeApiKey = isDryRun ? "dry-run" : requireEnv("CEE_API_KEY");
  if (!isDryRun) requireEnv("OPENAI_API_KEY");

  // Load prompt
  const promptPath = path.join(PROMPTS_DIR, PROMPT_FILE);
  const promptContent = fs.readFileSync(promptPath, "utf-8");

  // Load model config
  const model = loadModelConfig();

  // Determine briefs to run
  let briefFilter: string[] | undefined;
  if (briefsArg) {
    briefFilter = briefsArg.split(",").map((b) => b.trim());
  } else if (isDryRun) {
    briefFilter = DRY_RUN_BRIEFS;
  }

  const briefs = await loadBriefs(briefFilter);
  console.log(`\nPipeline Parity Benchmark`);
  console.log(`========================`);
  console.log(`Model: ${MODEL_ID}`);
  console.log(`Prompt: ${PROMPT_FILE}`);
  console.log(`Staging: ${ceeBaseUrl}`);
  console.log(`Briefs: ${briefs.length} (${briefs.map((b) => b.id).join(", ")})`);
  console.log(`Dry run: ${isDryRun}`);
  console.log(`Phase A only: ${phaseAOnly}`);
  console.log(`Phase B only: ${phaseBOnly}`);
  console.log();

  if (briefs.length === 0) {
    console.error("ERROR: No briefs matched the filter.");
    process.exit(1);
  }

  // Create results directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = path.join(RESULTS_BASE, timestamp);

  if (!isDryRun) {
    for (const sub of ["raw", "pipeline", "diffs"]) {
      fs.mkdirSync(path.join(runDir, sub), { recursive: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Phase A: Raw LLM + Staging per brief
  // ---------------------------------------------------------------------------

  const results: BriefResult[] = [];
  const failedBriefs: Array<{ brief_id: string; phase: string; error: string }> = [];

  for (const brief of briefs) {
    console.log(`── Brief: ${brief.id} ──`);

    if (isDryRun) {
      console.log(`  [dry-run] Would run: raw LLM + staging endpoint for ${brief.id}`);
      continue;
    }

    // ── Raw LLM call ──
    console.log(`  [raw] Calling LLM directly...`);
    const { response: rawResponse, raw_text: rawText } = await callRawLLM(brief, promptContent, model);
    const rawLatency = rawResponse.latency_ms;

    let rawScoreResult: ScoreResult;
    if (rawResponse.status !== "success" || !rawResponse.parsed_graph) {
      console.log(`  [raw] FAILED: ${rawResponse.failure_code ?? rawResponse.status} — ${rawResponse.error_message ?? ""}`);
      failedBriefs.push({ brief_id: brief.id, phase: "raw", error: rawResponse.error_message ?? rawResponse.status });
      rawScoreResult = {
        structural_valid: false,
        violation_codes: ["NO_GRAPH"],
        param_quality: null,
        option_diff: null,
        completeness: null,
        overall_score: null,
        node_count: 0,
        edge_count: 0,
      };
    } else {
      rawScoreResult = scoreGraph(rawResponse.parsed_graph, brief);
      console.log(`  [raw] ${rawScoreResult.structural_valid ? "VALID" : "INVALID"} — score: ${rawScoreResult.overall_score?.toFixed(3) ?? "null"} — ${rawLatency}ms`);
    }

    // Save raw artefacts
    fs.writeFileSync(
      path.join(runDir, "raw", `${brief.id}.json`),
      JSON.stringify(rawResponse.parsed_graph ?? { error: rawResponse.error_message }, null, 2)
    );
    fs.writeFileSync(
      path.join(runDir, "raw", `${brief.id}.score.json`),
      JSON.stringify(rawScoreResult, null, 2)
    );

    // ── Staging endpoint call ──
    console.log(`  [pipeline] Calling staging endpoint...`);
    const stagingResult = await callStagingEndpoint(brief, ceeBaseUrl, ceeApiKey);

    let pipelineScoreResult: ScoreResult;
    if (stagingResult.status !== "success" || !stagingResult.parsed_graph) {
      console.log(`  [pipeline] FAILED: ${stagingResult.status} — ${stagingResult.error ?? ""}`);
      failedBriefs.push({ brief_id: brief.id, phase: "pipeline", error: stagingResult.error ?? stagingResult.status });
      pipelineScoreResult = {
        structural_valid: false,
        violation_codes: ["NO_GRAPH"],
        param_quality: null,
        option_diff: null,
        completeness: null,
        overall_score: null,
        node_count: 0,
        edge_count: 0,
      };
    } else {
      pipelineScoreResult = scoreGraph(stagingResult.parsed_graph, brief);
      console.log(`  [pipeline] ${pipelineScoreResult.structural_valid ? "VALID" : "INVALID"} — score: ${pipelineScoreResult.overall_score?.toFixed(3) ?? "null"} — ${stagingResult.latency_ms}ms`);
    }

    // Save pipeline artefacts
    fs.writeFileSync(
      path.join(runDir, "pipeline", `${brief.id}.json`),
      JSON.stringify(stagingResult.body ?? { error: stagingResult.error }, null, 2)
    );
    fs.writeFileSync(
      path.join(runDir, "pipeline", `${brief.id}.score.json`),
      JSON.stringify(pipelineScoreResult, null, 2)
    );
    if (stagingResult.trace) {
      fs.writeFileSync(
        path.join(runDir, "pipeline", `${brief.id}.trace.json`),
        JSON.stringify(stagingResult.trace, null, 2)
      );
    }

    // ── Topology diff ──
    let topologyDiff: TopologyDiff | null = null;
    if (rawResponse.parsed_graph && stagingResult.parsed_graph) {
      topologyDiff = computeTopologyDiff(rawResponse.parsed_graph, stagingResult.parsed_graph);
      if (topologyDiff.topology_changed) {
        fs.writeFileSync(
          path.join(runDir, "diffs", `${brief.id}.diff.json`),
          JSON.stringify(topologyDiff, null, 2)
        );
      }
    }

    // ── Classification ──
    const classification = classify(
      rawScoreResult.structural_valid,
      rawScoreResult.overall_score,
      pipelineScoreResult.structural_valid,
      pipelineScoreResult.overall_score
    );

    console.log(`  [result] ${classification} — delta: ${((pipelineScoreResult.overall_score ?? 0) - (rawScoreResult.overall_score ?? 0)).toFixed(3)} — topology: ${topologyDiff?.topology_changed ? "CHANGED" : "same"}`);

    results.push({
      brief_id: brief.id,
      raw_status: rawResponse.status,
      raw_valid: rawScoreResult.structural_valid,
      raw_score: rawScoreResult.overall_score,
      raw_violations: rawScoreResult.violation_codes,
      raw_latency_ms: rawLatency,
      raw_node_count: rawScoreResult.node_count,
      raw_edge_count: rawScoreResult.edge_count,
      raw_metadata: extractMetadata(undefined, rawLatency, "raw"),
      pipeline_status: stagingResult.status,
      pipeline_valid: pipelineScoreResult.structural_valid,
      pipeline_score: pipelineScoreResult.overall_score,
      pipeline_violations: pipelineScoreResult.violation_codes,
      pipeline_latency_ms: stagingResult.latency_ms,
      pipeline_node_count: pipelineScoreResult.node_count,
      pipeline_edge_count: pipelineScoreResult.edge_count,
      pipeline_metadata: extractMetadata(stagingResult.trace, stagingResult.latency_ms, "pipeline"),
      classification,
      topology_diff: topologyDiff,
      notes: [
        rawResponse.status !== "success" ? `raw: ${rawResponse.error_message}` : "",
        stagingResult.status !== "success" ? `pipeline: ${stagingResult.error}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    });
  }

  if (isDryRun) {
    console.log("\nDry-run complete. No API calls were made.");
    return;
  }

  // ---------------------------------------------------------------------------
  // Generate report
  // ---------------------------------------------------------------------------

  const report = generateReport(results, failedBriefs, timestamp, ceeBaseUrl);

  // Save to results dir
  fs.writeFileSync(path.join(runDir, "report.md"), report);

  // Save to docs/
  const docsDir = path.resolve(EVALUATOR_ROOT, "..", "..", "docs");
  const docsPath = path.join(docsDir, "pipeline-parity-benchmark.md");
  fs.writeFileSync(docsPath, report);

  console.log(`\n✓ Report written to:`);
  console.log(`  ${path.join(runDir, "report.md")}`);
  console.log(`  ${docsPath}`);
  console.log(`✓ Artefacts saved to: ${runDir}`);
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function summarizeRepair(repairJson: string): string {
  if (repairJson === "n/a" || repairJson === "unavailable") return repairJson;
  try {
    const obj = JSON.parse(repairJson);
    const sweep = obj?.deterministic_sweep;
    if (!sweep) return "unknown";
    const parts: string[] = [];
    if (sweep.repairs_count > 0) parts.push(`${sweep.repairs_count} repairs`);
    if (sweep.llm_repair_needed) parts.push("LLM repair");
    if (sweep.violations_before > 0) parts.push(`${sweep.violations_before}→${sweep.violations_after} violations`);
    const reclassified = sweep.unreachable_factors?.reclassified?.length ?? 0;
    if (reclassified > 0) parts.push(`${reclassified} reclassified`);
    const pruned = sweep.disconnected_observables_pruned?.length ?? 0;
    if (pruned > 0) parts.push(`${pruned} pruned`);
    return parts.length > 0 ? parts.join(", ") : "no repairs";
  } catch {
    return repairJson.slice(0, 60);
  }
}

function generateReport(
  results: BriefResult[],
  failedBriefs: Array<{ brief_id: string; phase: string; error: string }>,
  timestamp: string,
  ceeBaseUrl: string
): string {
  // Filter to successful results for aggregates
  const validResults = results.filter(
    (r) => r.raw_status === "success" && r.pipeline_status === "success"
  );

  const rawValidCount = validResults.filter((r) => r.raw_valid).length;
  const pipeValidCount = validResults.filter((r) => r.pipeline_valid).length;
  const rawAbove90 = validResults.filter((r) => r.raw_valid && (r.raw_score ?? 0) >= 0.9).length;
  const pipeAbove90 = validResults.filter((r) => r.pipeline_valid && (r.pipeline_score ?? 0) >= 0.9).length;

  const rawValidScores = validResults.filter((r) => r.raw_valid && r.raw_score != null).map((r) => r.raw_score!);
  const pipeValidScores = validResults.filter((r) => r.pipeline_valid && r.pipeline_score != null).map((r) => r.pipeline_score!);
  const rawMean = rawValidScores.length > 0 ? rawValidScores.reduce((a, b) => a + b, 0) / rawValidScores.length : 0;
  const pipeMean = pipeValidScores.length > 0 ? pipeValidScores.reduce((a, b) => a + b, 0) / pipeValidScores.length : 0;

  const rawTotalViolations = validResults.reduce((acc, r) => acc + r.raw_violations.filter((v) => v !== "NO_GRAPH").length, 0);
  const pipeTotalViolations = validResults.reduce((acc, r) => acc + r.pipeline_violations.filter((v) => v !== "NO_GRAPH").length, 0);

  const total = validResults.length;

  // Classification counts
  const classificationCounts: Record<Classification, number> = {
    RESCUED: 0, IMPROVED: 0, NEUTRAL: 0, DEGRADED: 0, BROKEN: 0,
  };
  for (const r of validResults) classificationCounts[r.classification]++;

  // Sample metadata from first pipeline result
  const sampleMeta = validResults.find((r) => r.pipeline_metadata)?.pipeline_metadata;

  let md = "";

  // Header
  md += `# Draft Graph Pipeline Parity Benchmark\n\n`;
  md += `**Date:** ${timestamp.slice(0, 10)}\n`;
  md += `**Raw model:** ${MODEL_ID}\n`;
  md += `**Prompt:** ${PROMPT_FILE}\n`;
  md += `**Pipeline model:** ${sampleMeta?.model_id ?? "unavailable"} (via staging)\n`;
  md += `**Prompt hash (pipeline):** ${sampleMeta?.prompt_hash ?? "unavailable"}\n`;
  md += `**Staging endpoint:** ${ceeBaseUrl}\n`;
  md += `**Briefs evaluated:** ${results.length} (${validResults.length} successful)\n\n`;

  md += `> **⚠ Important:** The unified pipeline does not support injecting a pre-parsed graph.\n`;
  md += `> Stage 1 (Parse) always calls the LLM. Therefore, the raw LLM call and the staging\n`;
  md += `> endpoint call are **two independent stochastic generations** from the same brief.\n`;
  md += `> Results include model variance, not just pipeline effect. This is a system-level\n`;
  md += `> comparison, not a controlled same-graph experiment.\n\n`;

  md += `---\n\n`;

  // Section 1: Phase A aggregate
  md += `## 1. Phase A — Same-Brief Parity (Aggregate)\n\n`;
  md += `| Metric | Raw LLM | Post-Pipeline | Delta |\n`;
  md += `|---|---|---|---|\n`;
  md += `| Structurally valid | ${rawValidCount}/${total} | ${pipeValidCount}/${total} | ${pipeValidCount - rawValidCount >= 0 ? "+" : ""}${pipeValidCount - rawValidCount} |\n`;
  md += `| Score ≥0.90 | ${rawAbove90}/${total} | ${pipeAbove90}/${total} | ${pipeAbove90 - rawAbove90 >= 0 ? "+" : ""}${pipeAbove90 - rawAbove90} |\n`;
  md += `| Mean score (valid only) | ${rawMean.toFixed(3)} | ${pipeMean.toFixed(3)} | ${(pipeMean - rawMean) >= 0 ? "+" : ""}${(pipeMean - rawMean).toFixed(3)} |\n`;
  md += `| Total violations | ${rawTotalViolations} | ${pipeTotalViolations} | ${(pipeTotalViolations - rawTotalViolations) >= 0 ? "+" : ""}${pipeTotalViolations - rawTotalViolations} |\n\n`;

  // Classification summary
  md += `**Classification summary:**\n\n`;
  md += `| Classification | Count |\n`;
  md += `|---|---|\n`;
  for (const cls of ["RESCUED", "IMPROVED", "NEUTRAL", "DEGRADED", "BROKEN"] as Classification[]) {
    md += `| ${cls} | ${classificationCounts[cls]} |\n`;
  }
  md += `\n---\n\n`;

  // Section 2: Phase A per-brief
  md += `## 2. Phase A — Same-Brief Parity (Per-Brief)\n\n`;
  md += `| Brief | Raw Valid | Raw Score | Pipeline Valid | Pipeline Score | Delta | Classification | Topology Changed | Notes |\n`;
  md += `|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of results) {
    const delta = (r.pipeline_score ?? 0) - (r.raw_score ?? 0);
    const deltaStr = r.raw_score != null && r.pipeline_score != null
      ? `${delta >= 0 ? "+" : ""}${delta.toFixed(3)}`
      : "n/a";
    md += `| ${r.brief_id} | ${r.raw_valid ? "✓" : "✗"} | ${r.raw_score?.toFixed(3) ?? "null"} | ${r.pipeline_valid ? "✓" : "✗"} | ${r.pipeline_score?.toFixed(3) ?? "null"} | ${deltaStr} | ${r.classification} | ${r.topology_diff?.topology_changed ? "Yes" : "No"} | ${r.notes || "—"} |\n`;
  }
  md += `\n---\n\n`;

  // Section 3: Phase B (same data, different label)
  md += `## 3. Phase B — Live-System Parity (Aggregate)\n\n`;
  md += `> Phase B uses the same data as Phase A. Since the unified pipeline does not support\n`;
  md += `> offline graph replay, both phases are independent-sample comparisons. The tables\n`;
  md += `> above already represent the live-system comparison.\n\n`;
  md += `See Section 1 for aggregate metrics and Section 2 for per-brief breakdown.\n\n`;
  md += `---\n\n`;

  // Section 4: Pipeline stage impact
  md += `## 4. Pipeline Stage Impact\n\n`;
  const topoChangedResults = results.filter((r) => r.topology_diff?.topology_changed);
  if (topoChangedResults.length === 0) {
    md += `No topology changes detected (note: raw and pipeline are independent generations,\n`;
    md += `so all graphs differ — topology_changed tracks structural divergence beyond expected\n`;
    md += `model variance).\n\n`;
  } else {
    for (const r of topoChangedResults) {
      const d = r.topology_diff!;
      md += `### ${r.brief_id}\n\n`;
      md += `| Metric | Value |\n`;
      md += `|---|---|\n`;
      md += `| Nodes added | ${d.nodes_added.length > 0 ? d.nodes_added.join(", ") : "none"} |\n`;
      md += `| Nodes removed | ${d.nodes_removed.length > 0 ? d.nodes_removed.join(", ") : "none"} |\n`;
      md += `| Kinds changed | ${d.kinds_changed.length > 0 ? d.kinds_changed.map((k) => `${k.id}: ${k.raw_kind}→${k.pipeline_kind}`).join(", ") : "none"} |\n`;
      md += `| Edge count delta | ${d.edge_count_delta >= 0 ? "+" : ""}${d.edge_count_delta} |\n`;
      md += `| Edges added | ${d.edges_changed.filter((e) => e.change === "added").length} |\n`;
      md += `| Edges removed | ${d.edges_changed.filter((e) => e.change === "removed").length} |\n`;
      md += `| Repair fired | ${summarizeRepair(r.pipeline_metadata.repair_fired)} |\n`;
      md += `| Enrichment called | ${r.pipeline_metadata.enrichment_called} |\n\n`;
    }
  }
  md += `---\n\n`;

  // Section 5: Metadata
  md += `## 5. Metadata\n\n`;
  md += `| Brief | Source | Model | Pipeline Path | Repair Summary | Enrichment | Latency |\n`;
  md += `|---|---|---|---|---|---|---|\n`;
  for (const r of results) {
    md += `| ${r.brief_id} | raw | ${r.raw_metadata.model_id} | ${r.raw_metadata.pipeline_path} | ${r.raw_metadata.repair_fired} | ${r.raw_metadata.enrichment_called} | ${r.raw_latency_ms}ms |\n`;
    const repairSummary = summarizeRepair(r.pipeline_metadata.repair_fired);
    md += `| ${r.brief_id} | pipeline | ${r.pipeline_metadata.model_id} | ${r.pipeline_metadata.pipeline_path} | ${repairSummary} | ${r.pipeline_metadata.enrichment_called} | ${r.pipeline_latency_ms}ms |\n`;
  }
  md += `\n`;

  // Failed briefs
  if (failedBriefs.length > 0) {
    md += `### Failed Briefs\n\n`;
    md += `| Brief | Phase | Error |\n`;
    md += `|---|---|---|\n`;
    for (const f of failedBriefs) {
      md += `| ${f.brief_id} | ${f.phase} | ${f.error} |\n`;
    }
    md += `\n`;
  }

  md += `---\n\n`;

  // Section 6: Recommendations
  md += `## 6. Recommendations\n\n`;

  const netDelta = pipeMean - rawMean;
  const netLabel = netDelta > 0.02 ? "net-positive" : netDelta < -0.02 ? "net-negative" : "net-neutral";

  md += `### 1. Is the pipeline net-positive, net-neutral, or net-negative for graph quality?\n\n`;
  md += `**${netLabel}** — Mean score delta: ${netDelta >= 0 ? "+" : ""}${netDelta.toFixed(3)}. `;
  md += `Structurally valid graphs: raw ${rawValidCount}/${total} vs pipeline ${pipeValidCount}/${total}. `;
  md += `Rescued: ${classificationCounts.RESCUED}, Broken: ${classificationCounts.BROKEN}.\n\n`;

  md += `### 2. Are any specific stages causing degradation?\n\n`;
  if (classificationCounts.BROKEN > 0 || classificationCounts.DEGRADED > 0) {
    const degraded = results.filter((r) => r.classification === "BROKEN" || r.classification === "DEGRADED");
    md += `${degraded.length} brief(s) show degradation: ${degraded.map((r) => r.brief_id).join(", ")}. `;
    md += `Review pipeline trace data for these briefs to identify which stage caused the regression.\n\n`;
  } else {
    md += `No briefs show degradation. Pipeline stages appear to be either neutral or beneficial.\n\n`;
  }

  md += `### 3. Are raw benchmark scores a reliable proxy for production quality?\n\n`;
  if (classificationCounts.RESCUED > 0) {
    md += `Partially — the pipeline rescues ${classificationCounts.RESCUED} invalid graph(s) `;
    md += `(raw valid: ${rawValidCount}/${total} → pipeline valid: ${pipeValidCount}/${total}), `;
    md += `which means raw validity scores undercount production quality. `;
    md += `Among graphs that are valid in both, scores track closely (delta: ${netDelta >= 0 ? "+" : ""}${netDelta.toFixed(3)}). `;
    md += `Post-pipeline validity should supplement raw scores as a metric.\n\n`;
  } else if (Math.abs(netDelta) < 0.02 && classificationCounts.BROKEN === 0) {
    md += `Yes — raw and pipeline scores track closely (delta < 0.02) with no BROKEN cases. `;
    md += `Raw benchmark scores are a reliable proxy for production quality.\n\n`;
  } else {
    md += `Unclear — the score delta (${netDelta.toFixed(3)}) suggests meaningful divergence. `;
    md += `Consider running post-pipeline scores as a secondary metric alongside raw scores.\n\n`;
  }

  md += `### 4. Briefs requiring human review\n\n`;
  const reviewBriefs = results.filter(
    (r) => r.classification === "BROKEN" || r.classification === "DEGRADED" ||
    (r.topology_diff?.topology_changed && r.topology_diff.kinds_changed.length > 0)
  );
  if (reviewBriefs.length > 0) {
    md += `The following briefs require human review:\n`;
    for (const r of reviewBriefs) {
      md += `- **${r.brief_id}**: ${r.classification}`;
      if (r.topology_diff?.kinds_changed.length) {
        md += ` — node kind changes: ${r.topology_diff.kinds_changed.map((k) => `${k.id}: ${k.raw_kind}→${k.pipeline_kind}`).join(", ")}`;
      }
      md += `\n`;
    }
  } else {
    md += `No briefs require urgent human review.\n`;
  }
  md += `\n`;

  return md;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
