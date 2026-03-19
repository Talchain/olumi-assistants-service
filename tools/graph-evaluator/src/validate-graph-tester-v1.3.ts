/**
 * validate-graph-tester.ts
 *
 * Tests the validate_graph_v1_2.txt prompt against real draft-graph Pass 1 outputs.
 *
 * Runs each of 5 fixtures 3 times against o4-mini (reasoning: low, max_completion_tokens: 4096).
 * Performs schema, range, basis-consistency, diversity, and reasoning-quality checks.
 * Compares Pass 2 estimates against Pass 1 values to compute contested rate.
 * Writes a Markdown report to docs/validate-graph-prompt-test-report.md.
 *
 * Usage (from tools/graph-evaluator/):
 *   npx tsx src/validate-graph-tester.ts
 */

import { config as loadDotenv } from "dotenv";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import OpenAI from "openai";

// ─── Paths ────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TOOL_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(TOOL_ROOT, "..", "..");

loadDotenv({ path: join(TOOL_ROOT, ".env") });
loadDotenv({ path: join(REPO_ROOT, ".env") });

const PROMPT_PATH  = join(TOOL_ROOT, "prompts", "validate_graph_v1_2.txt");
const FIXTURES_DIR = join(TOOL_ROOT, "fixtures", "validate-graph");
const RESULTS_DIR  = join(TOOL_ROOT, "results", "validate-graph");
const REPORT_PATH  = join(REPO_ROOT, "Docs", "validate-graph-prompt-test-report.md");

const FIXTURE_IDS = [
  "01-simple-binary",
  "16-rich-saas-pricing",
  "15-thin-hiring",
  "19-ambiguous-retention",
  "02-multi-option-constrained",
];

const RUNS_PER_FIXTURE = 3;
const MODEL = "o4-mini";
const REASONING_EFFORT = "low";
const MAX_COMPLETION_TOKENS = 4096;
const TIMEOUT_MS = 120_000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface FixtureNode {
  id: string;
  kind: string;
  label: string;
  category?: string;
}

interface FixtureEdge {
  from: string;
  to: string;
  label: string;
  _p1_mean: number;
  _p1_std: number;
  _p1_ep: number;
}

interface Fixture {
  brief_id: string;
  brief: string;
  nodes: FixtureNode[];
  edges: FixtureEdge[];
}

interface P2Edge {
  from: string;
  to: string;
  strength: { mean: number; std: number };
  exists_probability: number;
  reasoning: string;
  basis: string;
  needs_user_input: boolean;
}

interface P2Response {
  edges: P2Edge[];
  model_notes: string[];
}

interface RunResult {
  fixture_id: string;
  run: number;
  ok: boolean;
  error?: string;
  raw_text: string;
  parsed: P2Response | null;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  est_cost_usd: number;
}

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

interface ValidationReport {
  fixture_id: string;
  run: number;
  checks: CheckResult[];
  pass_count: number;
  total_checks: number;
}

// ─── API call ─────────────────────────────────────────────────────────────────

async function callO4Mini(
  systemPrompt: string,
  userMessage: string,
): Promise<{ ok: boolean; text: string; error?: string; latency_ms: number; input_tokens: number; output_tokens: number; reasoning_tokens: number }> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    return { ok: false, text: "", error: "OPENAI_API_KEY not set", latency_ms: 0, input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 };
  }

  const client = new OpenAI({ apiKey });

  const params: Record<string, unknown> = {
    model: MODEL,
    instructions: systemPrompt,
    input: userMessage,
    reasoning: { effort: REASONING_EFFORT },
    max_output_tokens: MAX_COMPLETION_TOKENS,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = Date.now();

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (client.responses as any).create(params, { signal: controller.signal });
    clearTimeout(timer);
    const latency_ms = Date.now() - start;

    const text: string =
      response.output_text ??
      response.output
        ?.filter((o: { type: string }) => o.type === "message")
        ?.flatMap((o: { content: Array<{ type: string; text: string }> }) =>
          o.content
            ?.filter((c) => c.type === "output_text" || c.type === "text")
            ?.map((c) => c.text) ?? []
        )
        ?.join("") ?? "";

    const usage = response.usage ?? {};
    const reasoning_tokens =
      usage.output_tokens_details?.reasoning_tokens ??
      usage.completion_tokens_details?.reasoning_tokens ?? 0;

    return {
      ok: true,
      text: text.trim(),
      latency_ms,
      input_tokens:    usage.input_tokens  ?? usage.prompt_tokens     ?? 0,
      output_tokens:   usage.output_tokens ?? usage.completion_tokens ?? 0,
      reasoning_tokens,
    };
  } catch (err) {
    clearTimeout(timer);
    const latency_ms = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, text: "", error: msg, latency_ms, input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 };
  }
}

// ─── Parse response ───────────────────────────────────────────────────────────

function parseP2Response(raw: string): P2Response | null {
  const trimmed = raw.trim();
  for (const candidate of [trimmed, trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")]) {
    try {
      return JSON.parse(candidate) as P2Response;
    } catch { /* fall through */ }
  }
  const s = trimmed.indexOf("{");
  const e = trimmed.lastIndexOf("}");
  if (s !== -1 && e > s) {
    try { return JSON.parse(trimmed.slice(s, e + 1)) as P2Response; } catch { /* fall through */ }
  }
  return null;
}

// Cost: o4-mini $1.10/1M in, $4.40/1M out (reasoning counted as output)
function estimateCost(input_tokens: number, output_tokens: number): number {
  return (input_tokens / 1_000_000) * 1.10 + (output_tokens / 1_000_000) * 4.40;
}

// ─── Validation checks ────────────────────────────────────────────────────────

const CITATION_PATTERNS = [
  /profitwell/i, /mckinsey/i, /gartner/i, /forrester/i, /harvard/i,
  /\d{4}\s+study/i, /study\s+found/i, /research\s+shows/i, /according\s+to/i,
  /report\s+found/i, /survey\s+shows/i,
];

function runValidationChecks(fixture: Fixture, parsed: P2Response): CheckResult[] {
  const checks: CheckResult[] = [];
  const inputEdges = fixture.edges;
  const inputNodeIds = new Set(fixture.nodes.map((n) => n.id));
  const p2Edges = parsed.edges ?? [];

  // ── Schema ────────────────────────────────────────────────────────────────

  checks.push({
    name: "schema.edges_array",
    pass: Array.isArray(p2Edges),
    detail: Array.isArray(p2Edges) ? undefined : "edges is not an array",
  });

  checks.push({
    name: "schema.model_notes_array",
    pass: Array.isArray(parsed.model_notes),
    detail: Array.isArray(parsed.model_notes) ? undefined : "model_notes is not an array",
  });

  const requiredFields = ["from", "to", "strength", "exists_probability", "reasoning", "basis", "needs_user_input"];
  const missingFields: string[] = [];
  for (const e of p2Edges) {
    for (const f of requiredFields) {
      if (!(f in e)) missingFields.push(`${e.from}->${e.to}:${f}`);
    }
    if (e.strength && !("mean" in e.strength)) missingFields.push(`${e.from}->${e.to}:strength.mean`);
    if (e.strength && !("std" in e.strength)) missingFields.push(`${e.from}->${e.to}:strength.std`);
  }
  checks.push({
    name: "schema.all_fields_present",
    pass: missingFields.length === 0,
    detail: missingFields.length ? `Missing: ${missingFields.slice(0, 5).join(", ")}` : undefined,
  });

  // from/to IDs must be valid node IDs
  const badIds = p2Edges.filter((e) => !inputNodeIds.has(e.from) || !inputNodeIds.has(e.to));
  checks.push({
    name: "schema.valid_node_ids",
    pass: badIds.length === 0,
    detail: badIds.length ? `Bad IDs: ${badIds.map((e) => `${e.from}->${e.to}`).join(", ")}` : undefined,
  });

  // No extra edges
  const inputEdgeKeys = new Set(inputEdges.map((e) => `${e.from}->${e.to}`));
  const extraEdges = p2Edges.filter((e) => !inputEdgeKeys.has(`${e.from}->${e.to}`));
  checks.push({
    name: "schema.no_extra_edges",
    pass: extraEdges.length === 0,
    detail: extraEdges.length ? `Extra: ${extraEdges.map((e) => `${e.from}->${e.to}`).slice(0, 3).join(", ")}` : undefined,
  });

  // No missing edges
  const p2EdgeKeys = new Set(p2Edges.map((e) => `${e.from}->${e.to}`));
  const missingEdges = inputEdges.filter((e) => !p2EdgeKeys.has(`${e.from}->${e.to}`));
  checks.push({
    name: "schema.no_missing_edges",
    pass: missingEdges.length === 0,
    detail: missingEdges.length ? `Missing: ${missingEdges.map((e) => `${e.from}->${e.to}`).slice(0, 3).join(", ")}` : undefined,
  });

  // ── Parameter ranges ──────────────────────────────────────────────────────

  const meanOutOfRange = p2Edges.filter((e) => e.strength?.mean < -1 || e.strength?.mean > 1);
  checks.push({
    name: "ranges.mean_in_bounds",
    pass: meanOutOfRange.length === 0,
    detail: meanOutOfRange.length ? `Out of [-1,1]: ${meanOutOfRange.map((e) => `${e.from}->${e.to}=${e.strength.mean}`).join(", ")}` : undefined,
  });

  const stdOutOfRange = p2Edges.filter((e) => e.strength?.std < 0.05 || e.strength?.std > 0.35);
  checks.push({
    name: "ranges.std_in_bounds",
    pass: stdOutOfRange.length === 0,
    detail: stdOutOfRange.length ? `Out of [0.05,0.35]: ${stdOutOfRange.map((e) => `${e.from}->${e.to}=${e.strength.std}`).join(", ")}` : undefined,
  });

  const epOutOfRange = p2Edges.filter((e) => e.exists_probability < 0 || e.exists_probability > 1);
  checks.push({
    name: "ranges.ep_in_bounds",
    pass: epOutOfRange.length === 0,
    detail: epOutOfRange.length ? `Out of [0,1]: ${epOutOfRange.map((e) => `${e.from}->${e.to}=${e.exists_probability}`).join(", ")}` : undefined,
  });

  // Range discipline: sum |mean| per target node <= 1.0
  const inboundByTarget = new Map<string, number>();
  for (const e of p2Edges) {
    inboundByTarget.set(e.to, (inboundByTarget.get(e.to) ?? 0) + Math.abs(e.strength?.mean ?? 0));
  }
  const budgetViolations: string[] = [];
  for (const [nodeId, total] of inboundByTarget) {
    if (total > 1.001) budgetViolations.push(`${nodeId}=${total.toFixed(3)}`);
  }
  checks.push({
    name: "ranges.sum_mean_budget",
    pass: budgetViolations.length === 0,
    detail: budgetViolations.length ? `Sum |mean| > 1.0: ${budgetViolations.join(", ")}` : undefined,
  });

  // std must not exceed |mean|
  const stdExceedsMean = p2Edges.filter((e) => {
    const mean = e.strength?.mean ?? 0;
    const std  = e.strength?.std  ?? 0;
    return std > Math.abs(mean) + 0.0001;
  });
  checks.push({
    name: "ranges.std_not_exceed_mean",
    pass: stdExceedsMean.length === 0,
    detail: stdExceedsMean.length
      ? `std > |mean|: ${stdExceedsMean.map((e) => `${e.from}->${e.to} mean=${e.strength.mean} std=${e.strength.std}`).slice(0, 3).join("; ")}`
      : undefined,
  });

  // ── Basis consistency ─────────────────────────────────────────────────────

  const validBases = new Set(["brief_explicit", "structural_inference", "domain_prior", "weak_guess"]);
  const invalidBasis = p2Edges.filter((e) => !validBases.has(e.basis));
  checks.push({
    name: "basis.valid_values",
    pass: invalidBasis.length === 0,
    detail: invalidBasis.length ? `Invalid: ${invalidBasis.map((e) => `${e.from}->${e.to}=${e.basis}`).join(", ")}` : undefined,
  });

  // weak_guess → ep <= 0.75, std >= 0.15, needs_user_input === true
  const weakGuessViolations: string[] = [];
  for (const e of p2Edges.filter((e) => e.basis === "weak_guess")) {
    if (e.exists_probability > 0.75)   weakGuessViolations.push(`${e.from}->${e.to}: ep=${e.exists_probability} (must be <=0.75)`);
    if ((e.strength?.std ?? 0) < 0.15) weakGuessViolations.push(`${e.from}->${e.to}: std=${e.strength?.std} (must be >=0.15)`);
    if (e.needs_user_input !== true)    weakGuessViolations.push(`${e.from}->${e.to}: needs_user_input=${e.needs_user_input} (must be true)`);
  }
  checks.push({
    name: "basis.weak_guess_constraints",
    pass: weakGuessViolations.length === 0,
    detail: weakGuessViolations.length ? weakGuessViolations.slice(0, 3).join("; ") : undefined,
  });

  // domain_prior → ep <= 0.90
  const domainPriorViolations = p2Edges.filter((e) => e.basis === "domain_prior" && e.exists_probability > 0.90);
  checks.push({
    name: "basis.domain_prior_ep_cap",
    pass: domainPriorViolations.length === 0,
    detail: domainPriorViolations.length
      ? `ep > 0.90: ${domainPriorViolations.map((e) => `${e.from}->${e.to}=${e.exists_probability}`).join(", ")}`
      : undefined,
  });

  // needs_user_input must not be false when basis is weak_guess (redundant with above but explicit)
  const nuiFalseOnWeak = p2Edges.filter((e) => e.basis === "weak_guess" && e.needs_user_input === false);
  checks.push({
    name: "basis.no_false_nui_on_weak_guess",
    pass: nuiFalseOnWeak.length === 0,
    detail: nuiFalseOnWeak.length
      ? `needs_user_input=false on weak_guess: ${nuiFalseOnWeak.map((e) => `${e.from}->${e.to}`).join(", ")}`
      : undefined,
  });

  // ── Diversity ─────────────────────────────────────────────────────────────

  if (p2Edges.length >= 2) {
    const means = p2Edges.map((e) => e.strength?.mean ?? 0);
    const allSameMean = means.every((m) => Math.abs(m - means[0]) < 0.01);
    checks.push({
      name: "diversity.means_not_uniform",
      pass: !allSameMean,
      detail: allSameMean ? `All means identical (${means[0]})` : undefined,
    });

    const eps = p2Edges.map((e) => e.exists_probability ?? 0);
    const allSameEp = eps.every((ep) => Math.abs(ep - eps[0]) < 0.05);
    checks.push({
      name: "diversity.eps_not_uniform",
      pass: !allSameEp,
      detail: allSameEp ? `All exists_probability identical (${eps[0]})` : undefined,
    });

    const bases = p2Edges.map((e) => e.basis);
    const uniqueBases = new Set(bases).size;
    checks.push({
      name: "diversity.mixed_basis_values",
      pass: uniqueBases > 1,
      detail: uniqueBases <= 1 ? `All basis values are "${bases[0]}"` : undefined,
    });

    const stds = p2Edges.map((e) => e.strength?.std ?? 0);
    const allSameStd = stds.every((s) => Math.abs(s - stds[0]) < 0.01);
    checks.push({
      name: "diversity.stds_not_uniform",
      pass: !allSameStd,
      detail: allSameStd ? `All std values identical (${stds[0]})` : undefined,
    });
  }

  // ── Reasoning quality ─────────────────────────────────────────────────────

  const shortReasoning = p2Edges.filter((e) => (e.reasoning ?? "").length < 15);
  checks.push({
    name: "reasoning.min_length",
    pass: shortReasoning.length === 0,
    detail: shortReasoning.length ? `Too short (<15 chars): ${shortReasoning.map((e) => `${e.from}->${e.to}`).join(", ")}` : undefined,
  });

  const citationViolations: string[] = [];
  for (const e of p2Edges) {
    const r = e.reasoning ?? "";
    for (const pat of CITATION_PATTERNS) {
      if (pat.test(r)) {
        citationViolations.push(`${e.from}->${e.to}: "${r.slice(0, 60)}..."`);
        break;
      }
    }
  }
  checks.push({
    name: "reasoning.no_spurious_citations",
    pass: citationViolations.length === 0,
    detail: citationViolations.length ? citationViolations.slice(0, 2).join(" | ") : undefined,
  });

  // At least some diversity in reasoning (not all identical boilerplate)
  if (p2Edges.length >= 3) {
    const reasonings = p2Edges.map((e) => (e.reasoning ?? "").toLowerCase().slice(0, 40));
    const uniqueReasonings = new Set(reasonings).size;
    checks.push({
      name: "reasoning.not_all_generic",
      pass: uniqueReasonings > 1,
      detail: uniqueReasonings <= 1 ? "All reasoning fields appear identical" : undefined,
    });
  }

  // ── model_notes ───────────────────────────────────────────────────────────

  if (Array.isArray(parsed.model_notes) && parsed.model_notes.length > 0) {
    const noteStrings = parsed.model_notes.every((n) => typeof n === "string");
    checks.push({
      name: "model_notes.entries_are_strings",
      pass: noteStrings,
      detail: noteStrings ? undefined : "Some model_notes entries are not strings",
    });
  }

  return checks;
}

// ─── Stability analysis ───────────────────────────────────────────────────────

interface StabilityEdge {
  edge_key: string;
  means: number[];
  mean_std: number;
  bases: string[];
  sign_flip: boolean;
  band_change: boolean;
}

function strengthBand(mean: number): string {
  const abs = Math.abs(mean);
  if (abs >= 0.6) return "strong";
  if (abs >= 0.25) return "moderate";
  if (abs >= 0.05) return "weak";
  return "negligible";
}

function analyseStability(runs: RunResult[], fixture_id: string): StabilityEdge[] {
  const successfulRuns = runs.filter((r) => r.ok && r.parsed);
  if (successfulRuns.length < 2) return [];

  // Gather per-edge data across runs
  const edgeMap = new Map<string, { means: number[]; bases: string[] }>();
  for (const run of successfulRuns) {
    for (const e of run.parsed!.edges) {
      const key = `${e.from}->${e.to}`;
      if (!edgeMap.has(key)) edgeMap.set(key, { means: [], bases: [] });
      edgeMap.get(key)!.means.push(e.strength?.mean ?? 0);
      edgeMap.get(key)!.bases.push(e.basis);
    }
  }

  const results: StabilityEdge[] = [];
  for (const [key, data] of edgeMap) {
    const { means, bases } = data;
    if (means.length < 2) continue;
    const avg = means.reduce((a, b) => a + b, 0) / means.length;
    const variance = means.reduce((a, b) => a + (b - avg) ** 2, 0) / means.length;
    const mean_std = Math.sqrt(variance);
    const sign_flip = means.some((m) => Math.sign(m) !== Math.sign(means[0]));
    const band_change = means.some((m) => strengthBand(m) !== strengthBand(means[0]));
    results.push({ edge_key: key, means, mean_std, bases, sign_flip, band_change });
  }
  return results.sort((a, b) => b.mean_std - a.mean_std);
}

// ─── Pass 1 vs Pass 2 comparison ─────────────────────────────────────────────

type ContestReason = "sign_flip" | "strength_band" | "confidence_band" | "ep_boundary" | "raw_delta";

function confidenceBand(std: number): string {
  if (std < 0.10) return "high";
  if (std < 0.20) return "moderate";
  return "low";
}

function epBand(ep: number): string {
  if (ep >= 0.90) return "near_certain";
  if (ep >= 0.70) return "likely";
  if (ep >= 0.50) return "uncertain";
  return "speculative";
}

interface ContestedEdge {
  edge_key: string;
  p1_mean: number;
  p2_mean: number;
  p1_std: number;
  p2_std: number;
  p1_ep: number;
  p2_ep: number;
  reasons: ContestReason[];
  needs_user_input: boolean;
}

function comparePassOnePassTwo(fixture: Fixture, p2Edges: P2Edge[]): ContestedEdge[] {
  const contested: ContestedEdge[] = [];
  const p2Map = new Map(p2Edges.map((e) => [`${e.from}->${e.to}`, e]));

  for (const fixtureEdge of fixture.edges) {
    const key = `${fixtureEdge.from}->${fixtureEdge.to}`;
    const p2 = p2Map.get(key);
    if (!p2) continue;

    const p1_mean = fixtureEdge._p1_mean;
    const p2_mean = p2.strength?.mean ?? 0;
    const p1_std  = fixtureEdge._p1_std;
    const p2_std  = p2.strength?.std ?? 0;
    const p1_ep   = fixtureEdge._p1_ep;
    const p2_ep   = p2.exists_probability ?? 0;

    const reasons: ContestReason[] = [];
    if (Math.sign(p1_mean) !== Math.sign(p2_mean) && Math.abs(p1_mean) > 0.05 && Math.abs(p2_mean) > 0.05) {
      reasons.push("sign_flip");
    }
    if (strengthBand(p1_mean) !== strengthBand(p2_mean)) reasons.push("strength_band");
    if (confidenceBand(p1_std) !== confidenceBand(p2_std)) reasons.push("confidence_band");
    if (epBand(p1_ep) !== epBand(p2_ep)) reasons.push("ep_boundary");
    if (Math.abs(p1_mean - p2_mean) > 0.20) {
      if (!reasons.includes("strength_band") && !reasons.includes("sign_flip")) reasons.push("raw_delta");
    }

    if (reasons.length > 0) {
      contested.push({ edge_key: key, p1_mean, p2_mean, p1_std, p2_std, p1_ep, p2_ep, reasons, needs_user_input: p2.needs_user_input });
    }
  }
  return contested;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Verify API key early
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    console.error("BLOCKER: OPENAI_API_KEY not set. Check .env file.");
    process.exit(1);
  }

  const promptText = await readFile(PROMPT_PATH, "utf-8");
  console.log(`Prompt: ${PROMPT_PATH} (${promptText.length} chars)`);

  // Load fixtures
  const fixtures: Fixture[] = [];
  for (const id of FIXTURE_IDS) {
    const raw = await readFile(join(FIXTURES_DIR, `${id}.json`), "utf-8");
    fixtures.push(JSON.parse(raw) as Fixture);
  }
  console.log(`Fixtures: ${fixtures.map((f) => f.brief_id).join(", ")}`);
  console.log();

  await mkdir(RESULTS_DIR, { recursive: true });

  // ── Run all fixtures × runs ───────────────────────────────────────────────
  const allResults: RunResult[] = [];

  for (const fixture of fixtures) {
    console.log(`\n── Fixture: ${fixture.brief_id} (${fixture.edges.length} causal edges) ──`);

    // Build user message — strip _p1_* fields from edges
    const userEdges = fixture.edges.map(({ from, to, label }) => ({ from, to, label }));
    const userMessage = JSON.stringify({ brief: fixture.brief, nodes: fixture.nodes, edges: userEdges });

    for (let run = 1; run <= RUNS_PER_FIXTURE; run++) {
      process.stdout.write(`  Run ${run}/${RUNS_PER_FIXTURE}... `);
      const result = await callO4Mini(promptText, userMessage);
      const parsed = result.ok ? parseP2Response(result.text) : null;
      const cost = estimateCost(result.input_tokens, result.output_tokens);

      const runResult: RunResult = {
        fixture_id: fixture.brief_id,
        run,
        ok: result.ok,
        error: result.error,
        raw_text: result.text,
        parsed,
        latency_ms: result.latency_ms,
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        reasoning_tokens: result.reasoning_tokens,
        est_cost_usd: cost,
      };
      allResults.push(runResult);

      if (!result.ok) {
        console.log(`FAILED: ${result.error}`);
      } else if (!parsed) {
        console.log(`PARSE FAILED (${result.latency_ms}ms, $${cost.toFixed(4)})`);
      } else {
        console.log(`ok ${result.latency_ms}ms, in=${result.input_tokens} out=${result.output_tokens} reason=${result.reasoning_tokens} $${cost.toFixed(4)}`);
      }

      // Save raw response
      const responseDir = join(RESULTS_DIR, fixture.brief_id);
      await mkdir(responseDir, { recursive: true });
      await writeFile(
        join(responseDir, `run_${run}.json`),
        JSON.stringify({ fixture_id: fixture.brief_id, run, ...runResult, parsed }, null, 2),
        "utf-8",
      );
    }
  }

  // ── Validation checks ─────────────────────────────────────────────────────
  const allValidations: ValidationReport[] = [];
  for (const result of allResults) {
    if (!result.ok || !result.parsed) {
      allValidations.push({
        fixture_id: result.fixture_id,
        run: result.run,
        checks: [{ name: "api.success", pass: false, detail: result.error ?? "parse failed" }],
        pass_count: 0,
        total_checks: 1,
      });
      continue;
    }
    const fixture = fixtures.find((f) => f.brief_id === result.fixture_id)!;
    const checks = runValidationChecks(fixture, result.parsed);
    allValidations.push({
      fixture_id: result.fixture_id,
      run: result.run,
      checks,
      pass_count: checks.filter((c) => c.pass).length,
      total_checks: checks.length,
    });
  }

  // ── Stability analysis ────────────────────────────────────────────────────
  const stabilityByFixture = new Map<string, StabilityEdge[]>();
  for (const fixture of fixtures) {
    const runs = allResults.filter((r) => r.fixture_id === fixture.brief_id);
    stabilityByFixture.set(fixture.brief_id, analyseStability(runs, fixture.brief_id));
  }

  // ── Pass 1 vs Pass 2 comparison ───────────────────────────────────────────
  // Use run 1 of each fixture as the representative P2 estimate
  interface FixtureComparison {
    fixture_id: string;
    total_edges: number;
    contested: ContestedEdge[];
    nui_count: number;
    reason_counts: Record<ContestReason, number>;
  }
  const comparisons: FixtureComparison[] = [];

  for (const fixture of fixtures) {
    const run1 = allResults.find((r) => r.fixture_id === fixture.brief_id && r.run === 1);
    if (!run1?.parsed) {
      comparisons.push({ fixture_id: fixture.brief_id, total_edges: fixture.edges.length, contested: [], nui_count: 0, reason_counts: { sign_flip: 0, strength_band: 0, confidence_band: 0, ep_boundary: 0, raw_delta: 0 } });
      continue;
    }
    const contested = comparePassOnePassTwo(fixture, run1.parsed.edges);
    const nui_count = run1.parsed.edges.filter((e) => e.needs_user_input).length;
    const reason_counts: Record<ContestReason, number> = { sign_flip: 0, strength_band: 0, confidence_band: 0, ep_boundary: 0, raw_delta: 0 };
    for (const ce of contested) {
      for (const r of ce.reasons) reason_counts[r]++;
    }
    comparisons.push({ fixture_id: fixture.brief_id, total_edges: fixture.edges.length, contested, nui_count, reason_counts });
  }

  // ── Generate report ───────────────────────────────────────────────────────
  const report = generateReport(fixtures, allResults, allValidations, stabilityByFixture, comparisons);

  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, report, "utf-8");
  console.log(`\nReport: ${REPORT_PATH}`);

  // Summary
  const totalChecks = allValidations.flatMap((v) => v.checks).length;
  const totalPass   = allValidations.flatMap((v) => v.checks).filter((c) => c.pass).length;
  const totalEdges  = comparisons.reduce((s, c) => s + c.total_edges, 0);
  const totalContested = comparisons.reduce((s, c) => s + c.contested.length, 0);
  const contestedRate = totalEdges > 0 ? (totalContested / totalEdges) * 100 : 0;
  const totalCost   = allResults.reduce((s, r) => s + r.est_cost_usd, 0);

  console.log(`\n══════════════════════════════`);
  console.log(`Validation: ${totalPass}/${totalChecks} checks passed`);
  console.log(`Contested rate: ${contestedRate.toFixed(1)}% (${totalContested}/${totalEdges} edges)`);
  console.log(`Total cost: $${totalCost.toFixed(4)}`);
  console.log(`══════════════════════════════`);
}

// ─── Report generator ─────────────────────────────────────────────────────────

function generateReport(
  fixtures: Fixture[],
  allResults: RunResult[],
  allValidations: ValidationReport[],
  stabilityByFixture: Map<string, StabilityEdge[]>,
  comparisons: Array<{
    fixture_id: string;
    total_edges: number;
    contested: ContestedEdge[];
    nui_count: number;
    reason_counts: Record<string, number>;
  }>,
): string {
  const lines: string[] = [];
  const now = new Date().toISOString().slice(0, 10);

  lines.push(`# validate_graph v1.2 Prompt Test Report — ${now}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");

  const totalCalls    = allResults.length;
  const okCalls       = allResults.filter((r) => r.ok && r.parsed).length;
  const totalChecks   = allValidations.flatMap((v) => v.checks).length;
  const totalPass     = allValidations.flatMap((v) => v.checks).filter((c) => c.pass).length;
  const totalFail     = totalChecks - totalPass;
  const totalEdges    = comparisons.reduce((s, c) => s + c.total_edges, 0);
  const totalContested = comparisons.reduce((s, c) => s + c.contested.length, 0);
  const contestedRate = totalEdges > 0 ? ((totalContested / totalEdges) * 100).toFixed(1) : "0";
  const totalNui      = comparisons.reduce((s, c) => s + c.nui_count, 0);
  const nuiRate       = totalEdges > 0 ? ((totalNui / totalEdges) * 100).toFixed(1) : "0";
  const totalCost     = allResults.reduce((s, r) => s + r.est_cost_usd, 0);
  const avgLatency    = okCalls > 0 ? Math.round(allResults.filter((r) => r.ok).reduce((s, r) => s + r.latency_ms, 0) / okCalls) : 0;

  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Fixtures | ${fixtures.length} |`);
  lines.push(`| Runs per fixture | 3 |`);
  lines.push(`| API calls | ${okCalls}/${totalCalls} succeeded |`);
  lines.push(`| Validation checks | ${totalPass}/${totalChecks} passed (${totalFail} failed) |`);
  lines.push(`| Contested rate | **${contestedRate}%** (${totalContested}/${totalEdges} edges) |`);
  lines.push(`| needs_user_input rate | ${nuiRate}% (${totalNui}/${totalEdges}) |`);
  lines.push(`| Avg latency | ${avgLatency}ms |`);
  lines.push(`| Total cost | $${totalCost.toFixed(4)} |`);
  lines.push("");

  // ── 1. Schema validation ──────────────────────────────────────────────────
  lines.push("---");
  lines.push("");
  lines.push("## 1. Schema Validation");
  lines.push("");

  for (const fixture of fixtures) {
    const fixtureValidations = allValidations.filter((v) => v.fixture_id === fixture.brief_id);
    lines.push(`### ${fixture.brief_id}`);
    lines.push("");

    const schemaChecks = fixtureValidations.map((v) => ({
      run: v.run,
      checks: v.checks.filter((c) => c.name.startsWith("schema.")),
    }));

    lines.push(`| Check | Run 1 | Run 2 | Run 3 |`);
    lines.push(`|-------|-------|-------|-------|`);

    const checkNames = schemaChecks[0]?.checks.map((c) => c.name) ?? [];
    for (const name of checkNames) {
      const cells = [1, 2, 3].map((run) => {
        const runVal = fixtureValidations.find((v) => v.run === run);
        const check = runVal?.checks.find((c) => c.name === name);
        if (!check) return "—";
        return check.pass ? "✓" : `✗ ${check.detail ?? ""}`;
      });
      lines.push(`| ${name.replace("schema.", "")} | ${cells.join(" | ")} |`);
    }
    lines.push("");
  }

  // ── 2. Parameter ranges ───────────────────────────────────────────────────
  lines.push("---");
  lines.push("");
  lines.push("## 2. Parameter Range Validation");
  lines.push("");

  const rangeCheckNames = ["ranges.mean_in_bounds", "ranges.std_in_bounds", "ranges.ep_in_bounds", "ranges.sum_mean_budget", "ranges.std_not_exceed_mean"];
  lines.push(`| Fixture | Run | ${rangeCheckNames.map((n) => n.replace("ranges.", "")).join(" | ")} |`);
  lines.push(`|---------|-----|${rangeCheckNames.map(() => "---").join("|")}|`);

  for (const v of allValidations.filter((v) => v.checks.some((c) => c.name.startsWith("ranges.")))) {
    const cells = rangeCheckNames.map((name) => {
      const check = v.checks.find((c) => c.name === name);
      if (!check) return "—";
      return check.pass ? "✓" : `✗`;
    });
    const failures = rangeCheckNames
      .map((name) => v.checks.find((c) => c.name === name))
      .filter((c) => c && !c.pass)
      .map((c) => `${c!.name.replace("ranges.", "")}: ${c!.detail}`);
    lines.push(`| ${v.fixture_id} | ${v.run} | ${cells.join(" | ")} |${failures.length ? ` *${failures.join("; ")}*` : ""}`);
  }
  lines.push("");

  // ── 3. Basis consistency ──────────────────────────────────────────────────
  lines.push("---");
  lines.push("");
  lines.push("## 3. Basis Consistency");
  lines.push("");

  const basisCheckNames = ["basis.valid_values", "basis.weak_guess_constraints", "basis.domain_prior_ep_cap", "basis.no_false_nui_on_weak_guess"];
  lines.push(`| Fixture | Run | valid_values | weak_guess_constraints | domain_prior_ep_cap | no_false_nui |`);
  lines.push(`|---------|-----|---|---|---|---|`);

  for (const v of allValidations.filter((v) => v.checks.some((c) => c.name.startsWith("basis.")))) {
    const cells = basisCheckNames.map((name) => {
      const check = v.checks.find((c) => c.name === name);
      if (!check) return "—";
      return check.pass ? "✓" : `✗ ${check.detail ?? ""}`;
    });
    lines.push(`| ${v.fixture_id} | ${v.run} | ${cells.join(" | ")} |`);
  }
  lines.push("");

  // ── 4. Diversity ──────────────────────────────────────────────────────────
  lines.push("---");
  lines.push("");
  lines.push("## 4. Diversity Validation");
  lines.push("");

  const divCheckNames = ["diversity.means_not_uniform", "diversity.eps_not_uniform", "diversity.mixed_basis_values", "diversity.stds_not_uniform"];
  lines.push(`| Fixture | Run | means_not_uniform | eps_not_uniform | mixed_basis | stds_not_uniform |`);
  lines.push(`|---------|-----|---|---|---|---|`);

  for (const v of allValidations.filter((v) => v.checks.some((c) => c.name.startsWith("diversity.")))) {
    const cells = divCheckNames.map((name) => {
      const check = v.checks.find((c) => c.name === name);
      if (!check) return "—";
      return check.pass ? "✓" : `✗ ${check.detail ?? ""}`;
    });
    lines.push(`| ${v.fixture_id} | ${v.run} | ${cells.join(" | ")} |`);
  }
  lines.push("");

  // ── 5. Reasoning quality ──────────────────────────────────────────────────
  lines.push("---");
  lines.push("");
  lines.push("## 5. Reasoning Quality");
  lines.push("");

  const reasonCheckNames = ["reasoning.min_length", "reasoning.no_spurious_citations", "reasoning.not_all_generic"];
  lines.push(`| Fixture | Run | min_length | no_citations | not_generic | Detail |`);
  lines.push(`|---------|-----|---|---|---|--------|`);

  for (const v of allValidations.filter((v) => v.checks.some((c) => c.name.startsWith("reasoning.")))) {
    const cells = reasonCheckNames.map((name) => {
      const check = v.checks.find((c) => c.name === name);
      if (!check) return "—";
      return check.pass ? "✓" : "✗";
    });
    const failures = reasonCheckNames
      .map((name) => v.checks.find((c) => c.name === name))
      .filter((c) => c && !c.pass)
      .map((c) => c!.detail ?? "");
    lines.push(`| ${v.fixture_id} | ${v.run} | ${cells.join(" | ")} | ${failures.join("; ")} |`);
  }
  lines.push("");

  // ── 6. Stability analysis ─────────────────────────────────────────────────
  lines.push("---");
  lines.push("");
  lines.push("## 6. Stability Analysis (3 Runs per Fixture)");
  lines.push("");
  lines.push("Edges are flagged as unstable if they have a sign flip or strength-band change across runs.");
  lines.push("");

  for (const fixture of fixtures) {
    const stability = stabilityByFixture.get(fixture.brief_id) ?? [];
    const signFlips   = stability.filter((s) => s.sign_flip);
    const bandChanges = stability.filter((s) => s.band_change);
    const highVariance = stability.filter((s) => s.mean_std > 0.10);

    lines.push(`### ${fixture.brief_id}`);
    lines.push(`- Sign flips: **${signFlips.length}** edges`);
    lines.push(`- Band changes: **${bandChanges.length}** edges`);
    lines.push(`- High variance (std>0.10): **${highVariance.length}** edges`);
    lines.push(`- Basis consistency: ${stability.filter((s) => new Set(s.bases).size === 1).length}/${stability.length} edges consistent across runs`);
    lines.push("");

    if (signFlips.length > 0 || bandChanges.length > 0) {
      lines.push("| Edge | Run means | Std across runs | Sign flip | Band change |");
      lines.push("|------|-----------|-----------------|-----------|-------------|");
      for (const s of [...new Set([...signFlips, ...bandChanges])].slice(0, 10)) {
        lines.push(`| ${s.edge_key} | ${s.means.map((m) => m.toFixed(3)).join(", ")} | ${s.mean_std.toFixed(3)} | ${s.sign_flip ? "YES" : "—"} | ${s.band_change ? "YES" : "—"} |`);
      }
      lines.push("");
    }
  }

  // ── 7. Pass 1 vs Pass 2 comparison ───────────────────────────────────────
  lines.push("---");
  lines.push("");
  lines.push("## 7. Pass 1 vs Pass 2 Comparison");
  lines.push("");
  lines.push("Target contested rate: 15–40%. Below 15% = thresholds too loose; above 40% = too noisy.");
  lines.push("");

  const allReasonCounts: Record<string, number> = { sign_flip: 0, strength_band: 0, confidence_band: 0, ep_boundary: 0, raw_delta: 0 };

  for (const comp of comparisons) {
    const rate = comp.total_edges > 0 ? ((comp.contested.length / comp.total_edges) * 100).toFixed(1) : "0";
    const nuiRate2 = comp.total_edges > 0 ? ((comp.nui_count / comp.total_edges) * 100).toFixed(1) : "0";
    lines.push(`### ${comp.fixture_id}`);
    lines.push(`- **Contested:** ${comp.contested.length}/${comp.total_edges} edges (${rate}%)`);
    lines.push(`- **needs_user_input:** ${comp.nui_count}/${comp.total_edges} (${nuiRate2}%)`);
    if (comp.contested.length > 0) {
      lines.push(`- Reasons: sign_flip=${comp.reason_counts["sign_flip"]}, strength_band=${comp.reason_counts["strength_band"]}, confidence_band=${comp.reason_counts["confidence_band"]}, ep_boundary=${comp.reason_counts["ep_boundary"]}, raw_delta=${comp.reason_counts["raw_delta"]}`);
    }
    lines.push("");
    for (const r of Object.keys(allReasonCounts) as Array<keyof typeof allReasonCounts>) {
      allReasonCounts[r] += comp.reason_counts[r] ?? 0;
    }

    if (comp.contested.length > 0) {
      lines.push("| Edge | P1 mean | P2 mean | P1 std | P2 std | P1 ep | P2 ep | Reasons | NUI |");
      lines.push("|------|---------|---------|--------|--------|-------|-------|---------|-----|");
      for (const ce of comp.contested) {
        lines.push(`| ${ce.edge_key} | ${ce.p1_mean.toFixed(3)} | ${ce.p2_mean.toFixed(3)} | ${ce.p1_std.toFixed(3)} | ${ce.p2_std.toFixed(3)} | ${ce.p1_ep.toFixed(2)} | ${ce.p2_ep.toFixed(2)} | ${ce.reasons.join(", ")} | ${ce.needs_user_input ? "✓" : "—"} |`);
      }
      lines.push("");
    }
  }

  lines.push("### Aggregate reason distribution");
  lines.push(`| Reason | Count |`);
  lines.push(`|--------|-------|`);
  for (const [reason, count] of Object.entries(allReasonCounts)) {
    lines.push(`| ${reason} | ${count} |`);
  }
  lines.push("");

  // ── 8. Latency and cost ───────────────────────────────────────────────────
  lines.push("---");
  lines.push("");
  lines.push("## 8. Latency and Cost");
  lines.push("");
  lines.push(`| Fixture | Run | Latency (ms) | Input tokens | Output tokens | Reasoning tokens | Cost ($) |`);
  lines.push(`|---------|-----|-------------|-------------|---------------|-----------------|---------|`);
  for (const r of allResults) {
    lines.push(`| ${r.fixture_id} | ${r.run} | ${r.latency_ms} | ${r.input_tokens} | ${r.output_tokens} | ${r.reasoning_tokens} | ${r.est_cost_usd.toFixed(4)} |`);
  }
  lines.push("");
  lines.push(`**Total cost: $${allResults.reduce((s, r) => s + r.est_cost_usd, 0).toFixed(4)}**`);
  lines.push("");

  // ── 9. Recommendation ────────────────────────────────────────────────────
  lines.push("---");
  lines.push("");
  lines.push("## 9. Recommendation");
  lines.push("");

  const schemaFails   = allValidations.flatMap((v) => v.checks).filter((c) => c.name.startsWith("schema.") && !c.pass);
  const basisFails    = allValidations.flatMap((v) => v.checks).filter((c) => c.name.startsWith("basis.")  && !c.pass);
  const rangeFails    = allValidations.flatMap((v) => v.checks).filter((c) => c.name.startsWith("ranges.") && !c.pass);
  const divFails      = allValidations.flatMap((v) => v.checks).filter((c) => c.name.startsWith("diversity.") && !c.pass);
  const reasonFails   = allValidations.flatMap((v) => v.checks).filter((c) => c.name.startsWith("reasoning.") && !c.pass);

  const contestedRateNum = totalEdges > 0 ? (totalContested / totalEdges) * 100 : 0;
  const allSignFlips      = [...stabilityByFixture.values()].flatMap((s) => s.filter((e) => e.sign_flip));

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (schemaFails.length > 0) blockers.push(`Schema violations in ${schemaFails.length} check(s): ${schemaFails.map((c) => c.name).slice(0, 3).join(", ")}`);
  if (basisFails.length > 0)  blockers.push(`Basis consistency violations in ${basisFails.length} check(s): ${basisFails.map((c) => c.name).slice(0, 3).join(", ")}`);
  if (rangeFails.length > 0)  blockers.push(`Parameter range violations in ${rangeFails.length} check(s)`);
  if (contestedRateNum > 40)  warnings.push(`Contested rate ${contestedRate}% exceeds 40% — may overwhelm users with disagreements`);
  if (contestedRateNum < 15)  warnings.push(`Contested rate ${contestedRate}% is below 15% — thresholds may be too loose`);
  if (allSignFlips.length > 3) warnings.push(`${allSignFlips.length} sign flips across stability runs — model is sign-unstable on some edges`);
  if (divFails.length > 3)    warnings.push(`${divFails.length} diversity failures — model may be producing uniform estimates`);
  if (reasonFails.length > 0) warnings.push(`${reasonFails.length} reasoning quality failures`);

  if (blockers.length === 0 && warnings.length === 0) {
    lines.push("**READY FOR CEE INTEGRATION.** All schema, range, basis, diversity, and reasoning checks pass. Contested rate is within the 15–40% target band. No revision needed.");
  } else if (blockers.length === 0) {
    lines.push("**CONDITIONALLY READY.** No hard blockers. Address warnings before production deployment:");
    for (const w of warnings) lines.push(`- ${w}`);
  } else {
    lines.push("**NOT READY — prompt requires revision before CEE integration.** Blockers:");
    for (const b of blockers) lines.push(`- ${b}`);
    if (warnings.length > 0) {
      lines.push("");
      lines.push("Also address:");
      for (const w of warnings) lines.push(`- ${w}`);
    }
  }
  lines.push("");

  // ── Appendix: raw responses ───────────────────────────────────────────────
  lines.push("---");
  lines.push("");
  lines.push("## Appendix: Raw Responses");
  lines.push("");
  lines.push(`Raw JSON responses saved to: \`tools/graph-evaluator/results/validate-graph/<fixture_id>/run_<n>.json\``);
  lines.push("");

  for (const result of allResults) {
    lines.push(`### ${result.fixture_id} — Run ${result.run}`);
    lines.push("");
    if (!result.ok) {
      lines.push(`**API FAILURE:** ${result.error}`);
    } else if (!result.parsed) {
      lines.push(`**PARSE FAILURE.** Raw text:`);
      lines.push("```");
      lines.push(result.raw_text.slice(0, 500));
      lines.push("```");
    } else {
      lines.push("```json");
      lines.push(JSON.stringify(result.parsed, null, 2).slice(0, 3000));
      lines.push("```");
    }
    lines.push("");
  }

  return lines.join("\n");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
