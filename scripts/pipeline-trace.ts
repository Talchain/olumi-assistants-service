/**
 * End-to-End Inference Pipeline Trace
 *
 * Feeds a known brief through CEE staging → PLoT staging,
 * captures values at every service boundary, and produces
 * a Markdown report comparing actual vs expected values.
 *
 * Usage:
 *   pnpm tsx scripts/pipeline-trace.ts
 *
 * Env vars (from .env):
 *   ASSIST_API_KEY — CEE staging auth key
 */

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

// ── Config ──────────────────────────────────────────────────────────

config(); // load .env

const CEE_BASE = "https://cee-staging.onrender.com";
const PLOT_BASE = "https://plot-lite-service-staging.onrender.com";
const API_KEY = process.env.ASSIST_API_KEY ?? "";
const TRACE_DIR = resolve(process.cwd(), "trace");
const TIMEOUT_MS = 180_000; // 3 min for cold starts
const SEED = "12345";

// Golden fixture brief
const BRIEF = readFileSync(
  resolve(process.cwd(), "tools/graph-evaluator/briefs/16-rich-saas-pricing.md"),
  "utf-8",
)
  .replace(/^---[\s\S]*?---\s*/, "") // strip YAML frontmatter
  .trim();

// ── Helpers ─────────────────────────────────────────────────────────

function save(filename: string, data: unknown): void {
  const path = resolve(TRACE_DIR, filename);
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
  console.log(`  ✓ saved ${filename}`);
}

function saveText(filename: string, text: string): void {
  const path = resolve(TRACE_DIR, filename);
  writeFileSync(path, text, "utf-8");
  console.log(`  ✓ saved ${filename}`);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

const checks: Check[] = [];

function check(name: string, passed: boolean, detail = ""): void {
  checks.push({ name, passed, detail });
  const icon = passed ? "✅" : "❌";
  console.log(`  ${icon} ${name}${detail ? ": " + detail : ""}`);
}

function pct(a: number, b: number): string {
  if (b === 0) return "N/A";
  return ((Math.abs(a - b) / Math.abs(b)) * 100).toFixed(2) + "%";
}

// ── Types (minimal, for pipeline trace) ─────────────────────────────

interface CeeNode {
  id: string;
  kind: string;
  label?: string;
  category?: string;
  observed_state?: { value?: number; raw_value?: number; unit?: string };
  data?: { value?: number; raw_value?: number; cap?: number; unit?: string };
  state_space?: { range?: [number, number] };
  [k: string]: unknown;
}

interface CeeEdge {
  id?: string;
  from: string;
  to: string;
  strength?: { mean?: number; std?: number };
  exists_probability?: number;
  effect_direction?: string;
  edge_type?: string;
  [k: string]: unknown;
}

interface CeeOption {
  id: string;
  label: string;
  interventions?: Record<string, unknown>;
  [k: string]: unknown;
}

interface CeeConstraint {
  constraint_id: string;
  node_id: string;
  operator: string;
  value: number;
  label?: string;
  unit?: string;
  [k: string]: unknown;
}

interface CeeResponse {
  status?: string;
  graph?: { nodes: CeeNode[]; edges: CeeEdge[] };
  nodes?: CeeNode[];
  edges?: CeeEdge[];
  options?: CeeOption[];
  goal_node_id?: string;
  goal_threshold?: number;
  goal_constraints?: CeeConstraint[];
  validation_warnings?: Array<{ code: string; message?: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

interface PlotOptionResult {
  option_id: string;
  option_label?: string;
  outcome?: {
    mean?: number;
    std?: number;
    p10?: number;
    p50?: number;
    p90?: number;
    n_samples?: number;
    n_valid_samples?: number;
    validity_ratio?: number;
  };
  win_probability?: number;
  probability_of_goal?: number;
  probability_of_joint_goal?: number;
  constraint_probabilities?: Record<string, number> | Array<{ constraint_id: string; probability: number }>;
  status?: string;
  [k: string]: unknown;
}

interface PlotConstraintResult {
  constraint_id: string;
  node_id: string;
  operator: string;
  value: number;
  probability: number;
}

interface PlotResponse {
  analysis_status?: string;
  repairs_applied?: Array<{ code: string; before?: unknown; after?: unknown; [k: string]: unknown }>;
  results?: PlotOptionResult[];
  option_comparison?: PlotOptionResult[];
  constraint_results?: PlotConstraintResult[];
  robustness?: {
    recommendation_stability?: number;
    overall_confidence?: number;
    fragile_edges?: Array<{ edge_id?: string; from?: string; to?: string; switch_probability?: number }>;
  };
  // PLoT v2 uses top-level recommendation_stability + fragile edges in edge_sensitivity
  recommendation_stability?: number;
  edge_sensitivity?: Array<{ edge_id?: string; from?: string; to?: string; switch_probability?: number; [k: string]: unknown }>;
  factor_sensitivity?: Array<{
    factor_id?: string;
    factor_label?: string;
    influence_score?: number;
    elasticity?: number;
    confidence?: number;
    confidence_source?: string;
    confidence_components?: { structural_certainty?: number; sampling_stability?: number | null };
    direction?: string;
    sensitivity_score?: number;
    [k: string]: unknown;
  }>;
  factor_stability?: Array<{
    factor_id?: string;
    elasticity_std?: number;
    attribution_stability?: string;
    rank_flip_rate?: number;
    stability_method?: string;
  }>;
  critiques?: Array<{ code?: string; severity?: string; message?: string; user_message?: string; [k: string]: unknown }>;
  inference_warnings?: unknown[];
  meta?: {
    seed_used?: string;
    n_samples?: number;
    response_hash?: string;
    [k: string]: unknown;
  };
  // PLoT v2 puts seed at top level or in meta-like fields
  request_id?: string;
  [k: string]: unknown;
}

// ── Step 1: CEE Draft Graph ─────────────────────────────────────────

async function step1_ceeDraft(): Promise<CeeResponse | null> {
  console.log("\n═══ Step 1: CEE Draft Graph ═══");
  console.log(`  POST ${CEE_BASE}/assist/v1/draft-graph`);
  console.log(`  Brief: ${BRIEF.slice(0, 80)}…`);

  const body = { brief: BRIEF, schema: "v3" };

  let res: Response;
  try {
    res = await fetchWithTimeout(`${CEE_BASE}/assist/v1/draft-graph`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Olumi-Assist-Key": API_KEY,
        "X-Request-Id": "trace-001",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`  ✗ CEE request failed:`, err);
    return null;
  }

  console.log(`  HTTP ${res.status} ${res.statusText}`);

  // Log response headers
  const headerLog: Record<string, string> = {};
  for (const [k, v] of res.headers.entries()) {
    if (k.startsWith("x-cee")) headerLog[k] = v;
  }
  if (Object.keys(headerLog).length) console.log("  CEE headers:", headerLog);

  const raw = await res.text();
  let data: CeeResponse;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("  ✗ CEE returned non-JSON:", raw.slice(0, 500));
    saveText("01-cee-draft-response-raw.txt", raw);
    return null;
  }

  save("01-cee-draft-response.json", data);

  if (res.status !== 200) {
    console.error(`  ✗ CEE returned ${res.status}:`, JSON.stringify(data).slice(0, 300));
    return null;
  }

  if (data.status === "needs_clarification") {
    console.error("  ✗ CEE returned needs_clarification — brief too thin for this fixture");
    return null;
  }

  // Extract graph — handle both nested and flat shapes
  const nodes: CeeNode[] = data.graph?.nodes ?? data.nodes ?? [];
  const edges: CeeEdge[] = data.graph?.edges ?? data.edges ?? [];
  const options: CeeOption[] = data.options ?? [];

  console.log(`  Nodes: ${nodes.length}, Edges: ${edges.length}, Options: ${options.length}`);

  // ── Validation checks ──

  // Node ID pattern (must match CANONICAL_ID_REGEX in src/cee/utils/id-normalizer.ts)
  const idRegex = /^[a-z0-9_:-]+$/;
  const badIds = nodes.filter((n) => !idRegex.test(n.id));
  check(
    "Node IDs match ^[a-z0-9_:-]+$",
    badIds.length === 0,
    badIds.length > 0 ? `violations: ${badIds.map((n) => n.id).join(", ")}` : "",
  );

  // Edge strength.mean in [-1, +1]
  const meanViolations = edges.filter((e) => {
    const m = e.strength?.mean;
    return m !== undefined && (m < -1 || m > 1);
  });
  check(
    "All edge strength.mean in [-1, +1]",
    meanViolations.length === 0,
    meanViolations.length > 0
      ? `violations: ${meanViolations.map((e) => `${e.from}→${e.to}: ${e.strength?.mean}`).join("; ")}`
      : "",
  );

  // Edge strength.std > 0
  const stdViolations = edges.filter((e) => {
    const s = e.strength?.std;
    return s !== undefined && s <= 0;
  });
  check(
    "All edge strength.std > 0",
    stdViolations.length === 0,
    stdViolations.length > 0
      ? `violations: ${stdViolations.map((e) => `${e.from}→${e.to}: ${e.strength?.std}`).join("; ")}`
      : "",
  );

  // exists_probability in [0, 1]
  const probViolations = edges.filter((e) => {
    const p = e.exists_probability;
    return p !== undefined && (p < 0 || p > 1);
  });
  check(
    "All exists_probability in [0, 1]",
    probViolations.length === 0,
    probViolations.length > 0
      ? `violations: ${probViolations.map((e) => `${e.from}→${e.to}: ${e.exists_probability}`).join("; ")}`
      : "",
  );

  // Structural edges canonical
  const nodeKinds = new Map(nodes.map((n) => [n.id, n.kind]));
  const structuralEdges = edges.filter((e) => {
    const fromKind = nodeKinds.get(e.from);
    const toKind = nodeKinds.get(e.to);
    return (
      (fromKind === "decision" && toKind === "option") ||
      (fromKind === "option" && (toKind === "factor" || toKind === "risk"))
    );
  });
  const nonCanonical = structuralEdges.filter(
    (e) =>
      e.strength?.mean !== 1.0 ||
      e.strength?.std !== 0.01 ||
      e.exists_probability !== 1.0,
  );
  check(
    "Structural edges canonical (mean=1, std=0.01, prob=1)",
    nonCanonical.length === 0,
    nonCanonical.length > 0
      ? `non-canonical: ${nonCanonical.map((e) => `${e.from}→${e.to} m=${e.strength?.mean} s=${e.strength?.std} p=${e.exists_probability}`).join("; ")}`
      : `(${structuralEdges.length} structural edges)`,
  );

  // Factor scale consistency (value ≈ raw_value/cap)
  const scaleIssues: string[] = [];
  for (const n of nodes) {
    const obs = n.observed_state ?? n.data;
    if (!obs) continue;
    const raw = obs.raw_value ?? (n.data as Record<string, unknown> | undefined)?.raw_value;
    const cap = (n.data as Record<string, unknown> | undefined)?.cap;
    const val = obs.value;
    if (raw != null && cap != null && val != null && typeof raw === "number" && typeof cap === "number" && typeof val === "number" && cap !== 0) {
      const expected = raw / cap;
      const relErr = Math.abs(val - expected) / Math.abs(expected);
      if (relErr > 0.05) {
        scaleIssues.push(`${n.id}: value=${val}, expected=${expected.toFixed(4)} (raw=${raw}/cap=${cap}), err=${(relErr * 100).toFixed(1)}%`);
      }
    }
  }
  check(
    "Factor value consistent with raw_value/cap (5% tolerance)",
    scaleIssues.length === 0,
    scaleIssues.length > 0 ? scaleIssues.join("; ") : "",
  );

  // STRENGTH_DEFAULT_APPLIED warning
  const warnings = data.validation_warnings ?? [];
  const hasDefault = warnings.some((w) => w.code === "STRENGTH_DEFAULT_APPLIED");
  check(
    "No STRENGTH_DEFAULT_APPLIED warning",
    !hasDefault,
    hasDefault ? "LLM defaulted most edge strengths" : "",
  );

  // Log node summary
  console.log("\n  ── Node Summary ──");
  for (const n of nodes) {
    const obs = n.observed_state ?? n.data;
    console.log(
      `  ${n.id} [${n.kind}/${n.category ?? "?"}] val=${obs?.value ?? "?"} raw=${obs?.raw_value ?? "?"} cap=${(n.data as Record<string, unknown> | undefined)?.cap ?? "?"}`,
    );
  }

  // Log edge summary
  console.log("\n  ── Edge Summary ──");
  for (const e of edges) {
    console.log(
      `  ${e.from} → ${e.to}: mean=${e.strength?.mean ?? "?"} std=${e.strength?.std ?? "?"} prob=${e.exists_probability ?? "?"} dir=${e.effect_direction ?? "?"}`,
    );
  }

  // Log options
  console.log("\n  ── Options ──");
  for (const o of options) {
    console.log(`  ${o.id}: ${o.label}`);
    if (o.interventions) {
      for (const [k, v] of Object.entries(o.interventions)) {
        console.log(`    ${k} = ${JSON.stringify(v)}`);
      }
    }
  }

  // Log constraints
  if (data.goal_constraints?.length) {
    console.log("\n  ── Goal Constraints ──");
    for (const c of data.goal_constraints) {
      console.log(`  ${c.constraint_id}: ${c.node_id} ${c.operator} ${c.value} ${c.unit ?? ""}`);
    }
  }

  return data;
}

// ── Step 2: Construct PLoT request ──────────────────────────────────

function step2_buildPlotRequest(cee: CeeResponse): Record<string, unknown> {
  console.log("\n═══ Step 2: Construct PLoT V2 Run Request ═══");

  const nodes = cee.graph?.nodes ?? cee.nodes ?? [];
  const edges = cee.graph?.edges ?? cee.edges ?? [];
  const options = cee.options ?? [];

  const runRequest: Record<string, unknown> = {
    graph: { nodes, edges },
    options: options.map((opt) => ({
      id: opt.id,
      label: opt.label,
      interventions: opt.interventions ?? {},
      is_baseline: opt.label?.toLowerCase().includes("status quo") || opt.label?.toLowerCase().includes("keep"),
    })),
    goal_node_id: cee.goal_node_id,
    ...(cee.goal_threshold != null ? { goal_threshold: cee.goal_threshold } : {}),
    ...(cee.goal_constraints?.length ? { goal_constraints: cee.goal_constraints } : {}),
    seed: SEED,
    detail_level: "deep",
  };

  save("02-plot-run-request.json", runRequest);
  console.log(`  Goal node: ${cee.goal_node_id}`);
  console.log(`  Goal threshold: ${cee.goal_threshold ?? "none"}`);
  console.log(`  Options: ${options.length}`);
  console.log(`  Seed: ${SEED}`);

  return runRequest;
}

// ── Step 3: PLoT V2 Run ────────────────────────────────────────────

async function step3_plotRun(
  request: Record<string, unknown>,
  label: string,
  filename: string,
): Promise<PlotResponse | null> {
  console.log(`\n═══ Step 3: PLoT V2 Run (${label}) ═══`);
  console.log(`  POST ${PLOT_BASE}/v2/run`);

  let res: Response;
  try {
    res = await fetchWithTimeout(`${PLOT_BASE}/v2/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": `trace-001-${label}`,
      },
      body: JSON.stringify(request),
    });
  } catch (err) {
    console.error(`  ✗ PLoT request failed:`, err);
    return null;
  }

  console.log(`  HTTP ${res.status} ${res.statusText}`);

  const raw = await res.text();
  let data: PlotResponse;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("  ✗ PLoT returned non-JSON:", raw.slice(0, 500));
    saveText(`${filename}-raw.txt`, raw);
    return null;
  }

  save(filename, data);

  if (res.status !== 200) {
    console.error(`  ✗ PLoT returned ${res.status}:`, JSON.stringify(data).slice(0, 500));
    return data; // return anyway for partial analysis
  }

  // Log key fields
  console.log(`  analysis_status: ${data.analysis_status ?? "?"}`);
  console.log(`  repairs_applied: ${data.repairs_applied?.length ?? 0}`);
  if (data.repairs_applied?.length) {
    for (const r of data.repairs_applied) {
      console.log(`    ${r.code}: before=${JSON.stringify(r.before)?.slice(0, 60)} → after=${JSON.stringify(r.after)?.slice(0, 60)}`);
    }
  }

  // PLoT v2 puts seed at top level or in per-option outcome.n_samples
  const seedUsed = data.meta?.seed_used ?? (data as Record<string, unknown>).seed as string | undefined;
  const firstResult = (data.option_comparison ?? data.results ?? [])[0];
  const nSamples = data.meta?.n_samples ?? firstResult?.outcome?.n_samples;
  console.log(`  seed_used: ${seedUsed ?? "?"}`);
  console.log(`  n_samples: ${nSamples ?? "?"}`);
  console.log(`  response_hash: ${data.meta?.response_hash ?? "(not provided)"}`);

  // PLoT v2 uses option_comparison[] not results[]
  const optResults = data.option_comparison ?? data.results ?? [];
  if (optResults.length) {
    console.log("\n  ── Option Results ──");
    for (const r of optResults) {
      const cp = r.constraint_probabilities;
      const cpStr = cp
        ? (Array.isArray(cp) ? cp.map((c) => `${c.constraint_id}=${c.probability}`).join("; ") : Object.entries(cp).map(([k, v]) => `${k}=${v}`).join("; "))
        : "none";
      console.log(
        `  ${r.option_id}: mean=${r.outcome?.mean?.toFixed(4) ?? "?"} std=${r.outcome?.std?.toFixed(4) ?? "?"} p50=${r.outcome?.p50?.toFixed(4) ?? "?"} [p10=${r.outcome?.p10?.toFixed(4) ?? "?"},p90=${r.outcome?.p90?.toFixed(4) ?? "?"}] P(win)=${r.win_probability ?? "?"} P(joint)=${r.probability_of_joint_goal ?? "?"} constraints: ${cpStr}`,
      );
    }
  }

  // Log constraint results (top-level)
  if (data.constraint_results?.length) {
    console.log("\n  ── Constraint Results ──");
    for (const c of data.constraint_results) {
      console.log(`  ${c.constraint_id}: ${c.node_id} ${c.operator} ${c.value} → P=${c.probability}`);
    }
  }

  // Robustness — PLoT v2 uses top-level recommendation_stability
  const recStab = data.robustness?.recommendation_stability ?? data.recommendation_stability;
  if (recStab != null || data.robustness) {
    console.log("\n  ── Robustness ──");
    console.log(`  recommendation_stability: ${recStab ?? "?"}`);
    console.log(`  overall_confidence: ${data.robustness?.overall_confidence ?? "?"}`);
    const fragile = data.robustness?.fragile_edges ?? data.edge_sensitivity ?? [];
    if (fragile.length) {
      console.log("  fragile edges:");
      for (const fe of fragile) {
        console.log(`    ${fe.from ?? fe.edge_id}→${fe.to ?? "?"}: switch_prob=${fe.switch_probability ?? "?"}`);
      }
    }
  }

  // Log sensitivity
  if (data.factor_sensitivity?.length) {
    console.log("\n  ── Factor Sensitivity ──");
    for (const fs of data.factor_sensitivity) {
      console.log(
        `  ${fs.factor_id}: importance=${fs.importance_score ?? "?"} elasticity=${fs.elasticity ?? "?"} confidence=${fs.confidence ?? "?"} dir=${fs.direction ?? "?"}`,
      );
    }
  }

  return data;
}

// ── Step 4: Reproducibility ─────────────────────────────────────────

/** Get option results from whichever field PLoT used */
function getOptionResults(plot: PlotResponse): PlotOptionResult[] {
  return plot.option_comparison ?? plot.results ?? [];
}

/** Get seed from PLoT response (may be in meta or top-level) */
function getPlotSeed(plot: PlotResponse): string | undefined {
  return plot.meta?.seed_used ?? (plot as Record<string, unknown>).seed as string | undefined;
}

function step4_reproducibility(run1: PlotResponse, run2: PlotResponse): void {
  console.log("\n═══ Step 4: Reproducibility Check ═══");

  const hash1 = run1.meta?.response_hash;
  const hash2 = run2.meta?.response_hash;
  if (hash1 != null || hash2 != null) {
    check(
      "Response hashes identical",
      hash1 != null && hash2 != null && hash1 === hash2,
      `run1=${hash1 ?? "null"} run2=${hash2 ?? "null"}`,
    );
  } else {
    check(
      "Response hash present",
      false,
      "PLoT does not return response_hash — cannot compare hashes",
    );
  }

  const seed1 = getPlotSeed(run1);
  const seed2 = getPlotSeed(run2);
  check(
    "Seed used identical",
    seed1 != null && seed2 != null && seed1 === seed2,
    `run1=${seed1 ?? "null"} run2=${seed2 ?? "null"}`,
  );

  // Compare outcome values
  const results1 = getOptionResults(run1);
  const results2 = getOptionResults(run2);
  let allMatch = true;
  const details: string[] = [];
  for (const r1 of results1) {
    const r2 = results2.find((r) => r.option_id === r1.option_id);
    if (!r2) {
      allMatch = false;
      details.push(`${r1.option_id}: missing in run2`);
      continue;
    }
    if (r1.outcome?.mean !== r2.outcome?.mean || r1.outcome?.std !== r2.outcome?.std) {
      allMatch = false;
      details.push(
        `${r1.option_id}: mean ${r1.outcome?.mean} vs ${r2.outcome?.mean}, std ${r1.outcome?.std} vs ${r2.outcome?.std}`,
      );
    }
  }
  check("All outcome values identical across runs", allMatch, details.join("; "));
}

// ── Step 5 & 6: Cross-boundary trace & goal evaluation ──────────────

interface FactorTrace {
  id: string;
  label: string;
  ceeValue: number | string;
  ceeRaw: number | string;
  ceeCap: number | string;
  interventions: Record<string, Record<string, unknown>>;
  plotRepair: string;
  scaleConsistent: boolean;
}

function step5_crossBoundaryTrace(cee: CeeResponse, plot: PlotResponse): FactorTrace[] {
  console.log("\n═══ Step 5: Cross-Boundary Value Trace ═══");

  const nodes = cee.graph?.nodes ?? cee.nodes ?? [];
  const options = cee.options ?? [];
  const repairs = plot.repairs_applied ?? [];

  const factorNodes = nodes.filter(
    (n) => n.kind === "factor" || n.kind === "risk" || n.kind === "outcome",
  );

  const traces: FactorTrace[] = [];

  for (const n of factorNodes) {
    const obs = n.observed_state ?? n.data;
    const val = obs?.value;
    const raw = obs?.raw_value ?? (n.data as Record<string, unknown> | undefined)?.raw_value;
    const cap = (n.data as Record<string, unknown> | undefined)?.cap;

    // Gather interventions from each option for this factor
    const interventionsByOpt: Record<string, Record<string, unknown>> = {};
    for (const opt of options) {
      if (opt.interventions && n.id in (opt.interventions as Record<string, unknown>)) {
        interventionsByOpt[opt.id] = {
          value: (opt.interventions as Record<string, unknown>)[n.id],
        };
      }
    }

    // Check if PLoT repaired this factor
    const factorRepairs = repairs.filter(
      (r) =>
        JSON.stringify(r).includes(n.id),
    );

    let scaleOk = true;
    if (
      typeof val === "number" &&
      typeof raw === "number" &&
      typeof cap === "number" &&
      cap !== 0
    ) {
      const expected = raw / cap;
      const relErr = Math.abs(val - expected) / Math.abs(expected);
      if (relErr > 0.05) scaleOk = false;
    }

    traces.push({
      id: n.id,
      label: n.label ?? n.id,
      ceeValue: val ?? "?",
      ceeRaw: raw ?? "?",
      ceeCap: cap ?? "?",
      interventions: interventionsByOpt,
      plotRepair: factorRepairs.length > 0 ? factorRepairs.map((r) => r.code).join(", ") : "none",
      scaleConsistent: scaleOk,
    });
  }

  // Print table
  console.log("\n  Factor | CEE value | raw | cap | PLoT repair | Scale OK");
  console.log("  " + "-".repeat(80));
  for (const t of traces) {
    console.log(
      `  ${t.id} | ${t.ceeValue} | ${t.ceeRaw} | ${t.ceeCap} | ${t.plotRepair} | ${t.scaleConsistent ? "✓" : "✗"}`,
    );
    for (const [optId, iv] of Object.entries(t.interventions)) {
      console.log(`    → ${optId}: ${JSON.stringify(iv.value)}`);
    }
  }

  return traces;
}

function step6_goalTrace(cee: CeeResponse, plot: PlotResponse): void {
  console.log("\n═══ Step 6: Goal Evaluation Trace ═══");

  const goalId = cee.goal_node_id;
  const threshold = cee.goal_threshold;
  const results = getOptionResults(plot);
  const constraintResults = plot.constraint_results ?? [];

  console.log(`  Goal node: ${goalId}`);
  console.log(`  Goal threshold (CEE): ${threshold ?? "none"}`);

  if (constraintResults.length) {
    console.log("  PLoT constraint results:");
    for (const c of constraintResults) {
      console.log(`    ${c.constraint_id}: ${c.node_id} ${c.operator} ${c.value} → P=${c.probability}`);
    }
  }

  console.log("\n  Option | outcome.mean | outcome.std | P(win) | P(joint) | Scale");
  console.log("  " + "-".repeat(80));
  for (const r of results) {
    console.log(
      `  ${r.option_id} | ${r.outcome?.mean?.toFixed(4) ?? "?"} | ${r.outcome?.std?.toFixed(4) ?? "?"} | ${r.win_probability ?? "?"} | ${r.probability_of_joint_goal ?? "?"} | ${typeof r.outcome?.mean === "number" && r.outcome.mean <= 1 ? "normalised" : typeof r.outcome?.mean === "number" && r.outcome.mean > 1 ? "user-units" : "?"}`,
    );
  }

  // Scale coherence: constraint value vs outcome means
  if (constraintResults.length > 0 && results.length > 0) {
    const cVal = constraintResults[0].value;
    const firstMean = results[0]?.outcome?.mean;
    if (typeof firstMean === "number") {
      const cNorm = cVal <= 1;
      const mNorm = firstMean <= 1;
      check(
        "Constraint value and outcome.mean on same scale",
        cNorm === mNorm,
        `constraint=${cVal} (${cNorm ? "normalised" : "user-units"}), outcome.mean=${firstMean.toFixed(4)} (${mNorm ? "normalised" : "user-units"})`,
      );
    }
  }
}

// ── Report Generation ───────────────────────────────────────────────

function generateReport(
  cee: CeeResponse,
  plot1: PlotResponse | null,
  plot2: PlotResponse | null,
  traces: FactorTrace[],
): string {
  const now = new Date().toISOString().slice(0, 19) + "Z";
  const nodes = cee.graph?.nodes ?? cee.nodes ?? [];
  const edges = cee.graph?.edges ?? cee.edges ?? [];
  const options = cee.options ?? [];

  let md = `# Pipeline Trace Report v1

**Generated:** ${now}
**CEE staging:** ${CEE_BASE}
**PLoT staging:** ${PLOT_BASE}
**Seed:** ${SEED}
**Brief:** ${BRIEF.slice(0, 120)}…

---

## 1. Executive Summary

`;

  const totalChecks = checks.length;
  const passedChecks = checks.filter((c) => c.passed).length;
  const failedChecks = checks.filter((c) => !c.passed);

  if (failedChecks.length === 0) {
    md += `**PASS.** All ${totalChecks} validation checks passed. The pipeline produces structurally valid results end-to-end.\n\n`;
  } else {
    md += `**${failedChecks.length} of ${totalChecks} checks failed.** Review anomalies below.\n\n`;
    md += `Failed checks:\n`;
    for (const c of failedChecks) {
      md += `- ❌ ${c.name}${c.detail ? ": " + c.detail : ""}\n`;
    }
    md += "\n";
  }

  // Section 2: Boundary Value Table
  md += `---

## 2. Boundary Value Table

### CEE Draft Output

| Metric | Value |
|--------|-------|
| Nodes | ${nodes.length} |
| Edges | ${edges.length} |
| Options | ${options.length} |
| Goal node | \`${cee.goal_node_id ?? "none"}\` |
| Goal threshold | ${cee.goal_threshold ?? "none"} |
| Constraints | ${cee.goal_constraints?.length ?? 0} |
| Validation warnings | ${cee.validation_warnings?.length ?? 0} |

### Node Values

| Node ID | Kind | Category | Value | Raw Value | Cap | Unit |
|---------|------|----------|-------|-----------|-----|------|
`;
  for (const n of nodes) {
    const obs = n.observed_state ?? n.data;
    const raw = obs?.raw_value ?? (n.data as Record<string, unknown> | undefined)?.raw_value;
    const cap = (n.data as Record<string, unknown> | undefined)?.cap;
    const unit = obs?.unit ?? (n.data as Record<string, unknown> | undefined)?.unit ?? "";
    md += `| \`${n.id}\` | ${n.kind} | ${n.category ?? "—"} | ${obs?.value ?? "—"} | ${raw ?? "—"} | ${cap ?? "—"} | ${unit} |\n`;
  }

  md += `\n### Edge Values

| From | To | Mean | Std | Prob | Direction | Type |
|------|----|------|-----|------|-----------|------|
`;
  for (const e of edges) {
    md += `| \`${e.from}\` | \`${e.to}\` | ${e.strength?.mean ?? "—"} | ${e.strength?.std ?? "—"} | ${e.exists_probability ?? "—"} | ${e.effect_direction ?? "—"} | ${e.edge_type ?? "directed"} |\n`;
  }

  md += `\n### Options & Interventions

`;
  for (const o of options) {
    md += `**${o.label}** (\`${o.id}\`)\n`;
    if (o.interventions && Object.keys(o.interventions).length) {
      md += "| Factor | Intervention |\n|--------|-------------|\n";
      for (const [k, v] of Object.entries(o.interventions as Record<string, unknown>)) {
        md += `| \`${k}\` | ${JSON.stringify(v)} |\n`;
      }
    } else {
      md += "No interventions.\n";
    }
    md += "\n";
  }

  if (cee.goal_constraints?.length) {
    md += `### Goal Constraints

| ID | Node | Operator | Value | Unit | Label |
|----|------|----------|-------|------|-------|
`;
    for (const c of cee.goal_constraints) {
      md += `| \`${c.constraint_id}\` | \`${c.node_id}\` | ${c.operator} | ${c.value} | ${c.unit ?? "—"} | ${c.label ?? "—"} |\n`;
    }
    md += "\n";
  }

  // Section 3: Normalisation Coherence
  md += `---

## 3. Normalisation Coherence

`;
  if (traces.length > 0) {
    const allScaleOk = traces.every((t) => t.scaleConsistent);
    md += allScaleOk
      ? "All factor values are scale-consistent (value ≈ raw_value/cap within 5% tolerance).\n\n"
      : "**Scale inconsistencies detected:**\n\n";

    md += `| Factor | CEE Value | Raw | Cap | Expected | Err | Scale OK |
|--------|-----------|-----|-----|----------|-----|----------|
`;
    for (const t of traces) {
      let expected = "—";
      let err = "—";
      if (typeof t.ceeRaw === "number" && typeof t.ceeCap === "number" && t.ceeCap !== 0) {
        const exp = t.ceeRaw / t.ceeCap;
        expected = exp.toFixed(4);
        if (typeof t.ceeValue === "number") {
          err = pct(t.ceeValue, exp);
        }
      }
      md += `| \`${t.id}\` | ${t.ceeValue} | ${t.ceeRaw} | ${t.ceeCap} | ${expected} | ${err} | ${t.scaleConsistent ? "✅" : "❌"} |\n`;
    }
    md += "\n";
  } else {
    md += "No factor nodes found to trace.\n\n";
  }

  // Section 4: Repairs Applied
  md += `---

## 4. Repairs Applied (PLoT)

`;
  if (plot1) {
    const repairs = plot1.repairs_applied ?? [];
    if (repairs.length === 0) {
      md += "No repairs applied by PLoT.\n\n";
    } else {
      md += `PLoT applied ${repairs.length} repair(s):\n\n`;
      md += "| Code | Before | After |\n|------|--------|-------|\n";
      for (const r of repairs) {
        md += `| \`${r.code}\` | ${JSON.stringify(r.before)?.slice(0, 80) ?? "—"} | ${JSON.stringify(r.after)?.slice(0, 80) ?? "—"} |\n`;
      }
      md += "\n";
    }
  } else {
    md += "PLoT run failed — no repair data available.\n\n";
  }

  // Section 5: Reproducibility
  md += `---

## 5. Reproducibility

`;
  if (plot1 && plot2) {
    const seed1 = getPlotSeed(plot1);
    const seed2 = getPlotSeed(plot2);
    const n1 = getOptionResults(plot1)[0]?.outcome?.n_samples;
    const n2 = getOptionResults(plot2)[0]?.outcome?.n_samples;
    const hash1 = plot1.meta?.response_hash;
    const hash2 = plot2.meta?.response_hash;

    md += `| Metric | Run 1 | Run 2 | Match |
|--------|-------|-------|-------|
| response_hash | ${hash1 ? `\`${hash1}\`` : "not provided"} | ${hash2 ? `\`${hash2}\`` : "not provided"} | ${hash1 && hash2 ? (hash1 === hash2 ? "✅" : "❌") : "N/A (not returned)"} |
| seed_used | ${seed1 ?? "?"} | ${seed2 ?? "?"} | ${seed1 === seed2 ? "✅" : "❌"} |
| n_samples | ${n1 ?? "?"} | ${n2 ?? "?"} | ${n1 === n2 ? "✅" : "❌"} |
`;

    // Compare option results
    const r1 = getOptionResults(plot1);
    const r2 = getOptionResults(plot2);
    md += "\n| Option | Run 1 mean | Run 2 mean | Run 1 P(win) | Run 2 P(win) | Match |\n|--------|-----------|-----------|-------------|-------------|-------|\n";
    for (const res1 of r1) {
      const res2 = r2.find((r) => r.option_id === res1.option_id);
      const m1 = res1.outcome?.mean;
      const m2 = res2?.outcome?.mean;
      md += `| \`${res1.option_id}\` | ${m1?.toFixed(6) ?? "?"} | ${m2?.toFixed(6) ?? "?"} | ${res1.win_probability ?? "?"} | ${res2?.win_probability ?? "?"} | ${m1 === m2 ? "✅" : "❌"} |\n`;
    }
    md += "\n";
  } else {
    md += "Reproducibility check could not be performed (one or both PLoT runs failed).\n\n";
  }

  // Section 6: Scale Trace
  md += `---

## 6. Scale Trace (per-factor)

`;
  if (traces.length > 0) {
    md += "| Factor | CEE Value | CEE Raw | CEE Cap | PLoT Repair | Interventions | Scale OK |\n";
    md += "|--------|-----------|---------|---------|-------------|---------------|----------|\n";
    for (const t of traces) {
      const ivSummary = Object.entries(t.interventions)
        .map(([optId, iv]) => `${optId}=${JSON.stringify(iv.value)}`)
        .join("; ");
      md += `| \`${t.id}\` | ${t.ceeValue} | ${t.ceeRaw} | ${t.ceeCap} | ${t.plotRepair} | ${ivSummary || "—"} | ${t.scaleConsistent ? "✅" : "❌"} |\n`;
    }
    md += "\n";
  }

  // Section 7: Goal Evaluation
  md += `---

## 7. Goal Evaluation Trace

`;
  const goalResults = plot1 ? getOptionResults(plot1) : [];
  const goalConstraintResults = plot1?.constraint_results ?? [];

  if (goalResults.length) {
    md += `| Metric | Value | Scale | Plausible? |
|--------|-------|-------|-----------|
| goal_node_id | \`${cee.goal_node_id ?? "none"}\` | — | — |
| goal_threshold (CEE) | ${cee.goal_threshold ?? "none"} | ${typeof cee.goal_threshold === "number" && cee.goal_threshold <= 1 ? "normalised" : typeof cee.goal_threshold === "number" ? "user-units" : "not set"} | — |
`;

    // Auto-generated constraint from PLoT
    if (goalConstraintResults.length) {
      for (const gc of goalConstraintResults) {
        md += `| constraint (${gc.constraint_id}) | ${gc.node_id} ${gc.operator} ${gc.value} | normalised | P=${gc.probability} |\n`;
      }
    }

    for (const r of goalResults) {
      const m = r.outcome?.mean;
      const scale = typeof m === "number" && m <= 1 ? "normalised" : typeof m === "number" ? "user-units" : "?";
      md += `| outcome.mean (${r.option_id}) | ${typeof m === "number" ? m.toFixed(6) : "?"} | ${scale} | — |\n`;
      md += `| outcome.std (${r.option_id}) | ${typeof r.outcome?.std === "number" ? r.outcome.std.toFixed(6) : "?"} | — | — |\n`;
      md += `| P(win) (${r.option_id}) | ${r.win_probability ?? "?"} | 0-1 | ${typeof r.win_probability === "number" && r.win_probability >= 0 && r.win_probability <= 1 ? "✅" : "?"} |\n`;
      md += `| P(joint_goal) (${r.option_id}) | ${r.probability_of_joint_goal ?? "?"} | 0-1 | ${typeof r.probability_of_joint_goal === "number" && r.probability_of_joint_goal >= 0 && r.probability_of_joint_goal <= 1 ? "✅" : "?"} |\n`;
    }
    md += "\n";

    // Scale coherence — check constraint value vs outcome means
    if (goalConstraintResults.length > 0 && goalResults.length > 0) {
      const constraintVal = goalConstraintResults[0].value;
      const firstMean = goalResults[0]?.outcome?.mean;
      if (typeof firstMean === "number") {
        const cNorm = constraintVal <= 1;
        const mNorm = firstMean <= 1;
        if (cNorm !== mNorm) {
          md += `**SCALE MISMATCH:** constraint value (${constraintVal}) and outcome.mean (${firstMean.toFixed(6)}) appear to be on different scales.\n\n`;
        } else {
          md += `Scale coherence: constraint value (${constraintVal}) and outcome means are on the same scale (${cNorm ? "normalised" : "user-units"}).\n\n`;
        }
      }
    }

    // Recommendation stability + winner analysis
    const recStab = plot1?.robustness?.recommendation_stability ?? plot1?.recommendation_stability;
    if (recStab != null) {
      const winner = goalResults.reduce((best, r) =>
        (r.win_probability ?? 0) > (best.win_probability ?? 0) ? r : best,
      );
      md += `**Winner:** \`${winner.option_id}\` (${winner.option_label ?? ""}) with P(win)=${winner.win_probability}, recommendation_stability=${recStab}\n\n`;
    }
  } else {
    md += "No PLoT results available.\n\n";
  }

  // Section 8: Anomalies
  md += `---

## 8. Anomalies

`;
  if (failedChecks.length === 0) {
    md += "No anomalies detected.\n\n";
  } else {
    for (const c of failedChecks) {
      md += `### ❌ ${c.name}\n\n`;
      md += `${c.detail || "No detail."}\n\n`;
    }
  }

  // Warnings from CEE
  const warnings = cee.validation_warnings ?? [];
  if (warnings.length > 0) {
    md += `### CEE Validation Warnings

`;
    for (const w of warnings) {
      md += `- \`${w.code}\`: ${w.message ?? JSON.stringify(w)}\n`;
    }
    md += "\n";
  }

  // PLoT critiques
  if (plot1?.critiques?.length) {
    md += `### PLoT Critiques

`;
    for (const c of plot1.critiques) {
      md += `- \`${c.code ?? "?"}\` [${c.severity ?? "?"}]: ${c.message ?? JSON.stringify(c)}\n`;
    }
    md += "\n";
  }

  // Factor sensitivity summary
  if (plot1?.factor_sensitivity?.length) {
    md += `### Factor Sensitivity

| Factor | Elasticity | Sensitivity | Direction | Confidence | Source |
|--------|-----------|-------------|-----------|-----------|--------|
`;
    for (const fs of plot1.factor_sensitivity) {
      md += `| \`${fs.factor_id}\` (${fs.factor_label ?? ""}) | ${fs.elasticity ?? "?"} | ${fs.sensitivity_score ?? "?"} | ${fs.direction ?? "?"} | ${fs.confidence ?? "?"} | ${fs.confidence_source ?? "?"} |\n`;
    }
    md += "\n";

    // Note on confidence source
    const allGraph = plot1.factor_sensitivity.every((f) => f.confidence_source === "graph");
    const anySampNull = plot1.factor_sensitivity.some((f) => f.confidence_components?.sampling_stability == null);
    if (allGraph && anySampNull) {
      md += `**Note:** All factor sensitivity confidence values come from \`graph\` source with \`sampling_stability: null\`. This confirms the ISL audit finding that bootstrap stability is not being used to compute confidence.\n\n`;
    }
  }

  // All checks summary
  md += `---

## Appendix: All Validation Checks

| # | Check | Passed | Detail |
|---|-------|--------|--------|
`;
  checks.forEach((c, i) => {
    md += `| ${i + 1} | ${c.name} | ${c.passed ? "✅" : "❌"} | ${c.detail.replace(/\|/g, "\\|").slice(0, 120)} |\n`;
  });

  md += `\n---

*Generated by \`scripts/pipeline-trace.ts\` — ${now}*\n`;

  return md;
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║   End-to-End Inference Pipeline Trace                   ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`CEE: ${CEE_BASE}`);
  console.log(`PLoT: ${PLOT_BASE}`);
  console.log(`Seed: ${SEED}`);
  console.log(`Brief: ${BRIEF.slice(0, 80)}…`);

  mkdirSync(TRACE_DIR, { recursive: true });

  // Step 1: CEE draft
  const cee = await step1_ceeDraft();
  if (!cee) {
    console.error("\n✗ CEE draft failed — cannot proceed with trace.");
    // Write partial report
    const md = `# Pipeline Trace Report v1\n\n**FAILED:** CEE draft graph generation failed. See trace/ for raw responses.\n`;
    saveText("PIPELINE_TRACE_REPORT_v1.md", md);
    process.exit(1);
  }

  // Step 2: Build PLoT request
  const plotReq = step2_buildPlotRequest(cee);

  // Step 3: PLoT run 1
  const plot1 = await step3_plotRun(plotReq, "run1", "03-plot-run-response.json");

  // Validate PLoT run 1
  if (plot1) {
    console.log("\n═══ PLoT Run 1 Validation ═══");

    const plotSeed = getPlotSeed(plot1);
    check(
      "PLoT seed matches requested",
      plotSeed === SEED,
      `requested=${SEED}, used=${plotSeed ?? "null"}`,
    );

    // Check sensitivity confidence not uniform 0.8 (ISL audit finding)
    const sensConfs = (plot1.factor_sensitivity ?? []).map((f) => f.confidence).filter((c) => c != null);
    const allSameConf = sensConfs.length > 1 && sensConfs.every((c) => c === sensConfs[0]);
    const confSource = plot1.factor_sensitivity?.[0]?.confidence_source;
    const sampStab = plot1.factor_sensitivity?.[0]?.confidence_components?.sampling_stability;
    check(
      "factor_sensitivity confidence computed from bootstrap (not hardcoded)",
      !allSameConf || sensConfs.length <= 1,
      `values: [${sensConfs.join(", ")}], source: ${confSource ?? "?"}, sampling_stability: ${sampStab ?? "null"}`,
    );

    // Check outcome scale plausibility
    const optResults = getOptionResults(plot1);
    for (const r of optResults) {
      if (typeof r.outcome?.mean === "number") {
        const plausible = r.outcome.mean >= -10 && r.outcome.mean <= 10_000_000;
        check(
          `Outcome mean plausible (${r.option_id})`,
          plausible,
          `mean=${r.outcome.mean.toFixed(6)}`,
        );
      }
    }

    // Check recommendation_stability
    const recStab = plot1.robustness?.recommendation_stability ?? plot1.recommendation_stability;
    if (typeof recStab === "number") {
      check(
        "recommendation_stability is a valid probability",
        recStab >= 0 && recStab <= 1,
        `value=${recStab}`,
      );
    }

    // Check all outcomes are normalised (0-1 scale) since CEE generates normalised values
    const allNorm = optResults.every(
      (r) => typeof r.outcome?.mean === "number" && r.outcome.mean >= -0.5 && r.outcome.mean <= 1.5,
    );
    check(
      "All outcome means in normalised range",
      allNorm,
      optResults.map((r) => `${r.option_id}=${r.outcome?.mean?.toFixed(4)}`).join(", "),
    );
  }

  // Step 4: PLoT run 2 (reproducibility)
  console.log("\n  (Running second PLoT request for reproducibility check…)");
  const plot2 = await step3_plotRun(plotReq, "run2", "04-plot-run-response-run2.json");

  if (plot1 && plot2) {
    step4_reproducibility(plot1, plot2);
  }

  // Step 5: Cross-boundary trace
  const traces = step5_crossBoundaryTrace(cee, plot1 ?? ({} as PlotResponse));

  // Step 6: Goal trace
  step6_goalTrace(cee, plot1 ?? ({} as PlotResponse));

  // Generate report
  console.log("\n═══ Generating Report ═══");
  const report = generateReport(cee, plot1, plot2, traces);
  saveText("PIPELINE_TRACE_REPORT_v1.md", report);

  // Summary
  const passed = checks.filter((c) => c.passed).length;
  const failed = checks.filter((c) => !c.passed).length;
  console.log(`\n════════════════════════════════════════`);
  console.log(`  Checks: ${passed} passed, ${failed} failed (${checks.length} total)`);
  console.log(`  Report: trace/PIPELINE_TRACE_REPORT_v1.md`);
  console.log(`════════════════════════════════════════\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
