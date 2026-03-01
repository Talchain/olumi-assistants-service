/**
 * Reporter — generates CSV, summary.md, and analysis-pack.md from scored results.
 *
 * Exports a clean async function. Does NOT write to disk directly.
 * All I/O is handled by cli.ts via io.saveReports().
 */

import { stringify } from "csv-stringify/sync";
import type { ScoredResult, RunConfig, ModelConfig, Brief, ReportFiles } from "./types.js";

const ANALYSIS_PACK_CHAR_LIMIT = 30_000;

// =============================================================================
// CSV generation
// =============================================================================

function generateScoresCsv(results: ScoredResult[], config: RunConfig): string {
  const rows = results.map((r) => ({
    run_id: config.run_id,
    model_id: r.model.id,
    brief_id: r.brief.id,
    target_mode: r.model.target_mode,
    structural_valid: r.score.structural_valid,
    param_quality: r.score.param_quality?.toFixed(4) ?? "",
    option_diff: r.score.option_diff?.toFixed(4) ?? "",
    completeness: r.score.completeness?.toFixed(4) ?? "",
    overall_score: r.score.overall_score?.toFixed(4) ?? "",
    latency_ms: r.response.latency_ms,
    input_tokens: r.response.input_tokens ?? "",
    output_tokens: r.response.output_tokens ?? "",
    reasoning_tokens: r.response.reasoning_tokens ?? "",
    est_cost_usd: r.response.est_cost_usd?.toFixed(6) ?? "",
    pricing_source: r.response.pricing_source ?? "",
    node_count: r.score.node_count,
    edge_count: r.score.edge_count,
    violation_codes: r.score.violation_codes.join(";"),
    failure_code: r.response.failure_code ?? "",
  }));

  return stringify(rows, { header: true });
}

// =============================================================================
// Markdown table helpers
// =============================================================================

function mdTable(headers: string[], rows: string[][]): string {
  const headerRow = "| " + headers.join(" | ") + " |";
  const sepRow = "| " + headers.map(() => "---").join(" | ") + " |";
  const dataRows = rows.map((r) => "| " + r.join(" | ") + " |");
  return [headerRow, sepRow, ...dataRows].join("\n");
}

function fmtScore(val: number | null): string {
  return val != null ? val.toFixed(3) : "—";
}

function fmtBool(val: boolean): string {
  return val ? "✓" : "✗";
}

// =============================================================================
// Summary markdown
// =============================================================================

function generateSummaryMd(
  results: ScoredResult[],
  config: RunConfig,
  models: ModelConfig[],
  briefs: Brief[],
  promptHash: string
): string {
  const lines: string[] = [];
  const ts = config.timestamp;

  lines.push("# Graph Evaluator — Run Summary");
  lines.push("");
  lines.push("## Run Metadata");
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Run ID | \`${config.run_id}\` |`);
  lines.push(`| Timestamp | ${ts} |`);
  lines.push(`| Prompt | \`${config.prompt_file}\` |`);
  lines.push(`| Prompt hash | \`${promptHash}\` |`);
  lines.push(`| Models | ${models.length} |`);
  lines.push(`| Briefs | ${briefs.length} |`);
  lines.push(`| Total combinations | ${results.length} |`);
  lines.push("");

  // ── Ranking table ──────────────────────────────────────────────────────────
  lines.push("## Overall Rankings");
  lines.push("");

  const ranked = [...results]
    .filter((r) => r.score.overall_score != null)
    .sort((a, b) => (b.score.overall_score ?? 0) - (a.score.overall_score ?? 0));

  const rankHeaders = [
    "#", "Model", "Brief", "Mode", "Overall", "Struct", "Param", "OptDiff", "Complete",
    "Latency (ms)", "Cost ($)", "Nodes",
  ];
  const rankRows = ranked.map((r, i) => [
    String(i + 1),
    r.model.id,
    r.brief.id,
    r.model.target_mode,
    fmtScore(r.score.overall_score),
    fmtBool(r.score.structural_valid),
    fmtScore(r.score.param_quality),
    fmtScore(r.score.option_diff),
    fmtScore(r.score.completeness),
    String(r.response.latency_ms),
    (r.response.est_cost_usd ?? 0).toFixed(5),
    String(r.score.node_count),
  ]);

  lines.push(mdTable(rankHeaders, rankRows));
  lines.push("");

  // ── Per-mode breakdown ─────────────────────────────────────────────────────
  lines.push("## Per-Mode Breakdown");
  lines.push("");
  lines.push("Best model per mode (by average overall_score across briefs):");
  lines.push("");

  const modes: Array<"fast" | "normal" | "deep" | "baseline"> = [
    "baseline", "normal", "deep", "fast",
  ];

  for (const mode of modes) {
    const modeResults = results.filter(
      (r) => r.model.target_mode === mode && r.score.overall_score != null
    );
    if (modeResults.length === 0) continue;

    // Average overall_score per model
    const byModel = new Map<string, number[]>();
    for (const r of modeResults) {
      const scores = byModel.get(r.model.id) ?? [];
      scores.push(r.score.overall_score!);
      byModel.set(r.model.id, scores);
    }

    const modelAvgs = [...byModel.entries()].map(([modelId, scores]) => ({
      modelId,
      avg: scores.reduce((a, b) => a + b, 0) / scores.length,
    }));
    modelAvgs.sort((a, b) => b.avg - a.avg);

    lines.push(`### ${mode.charAt(0).toUpperCase() + mode.slice(1)} mode`);
    lines.push("");
    const modeHeaders = ["Rank", "Model", "Avg Score"];
    const modeRows = modelAvgs.map((m, i) => [
      String(i + 1),
      m.modelId,
      m.avg.toFixed(3),
    ]);
    lines.push(mdTable(modeHeaders, modeRows));
    lines.push("");
  }

  // ── Per-brief breakdown ────────────────────────────────────────────────────
  lines.push("## Per-Brief Breakdown");
  lines.push("");

  for (const brief of briefs) {
    lines.push(`### ${brief.id}`);
    lines.push("");
    const briefResults = results.filter((r) => r.brief.id === brief.id);
    const sortedByScore = [...briefResults].sort(
      (a, b) => (b.score.overall_score ?? -1) - (a.score.overall_score ?? -1)
    );

    const briefHeaders = ["Model", "Mode", "Overall", "Struct", "Violations", "Failure"];
    const briefRows = sortedByScore.map((r) => [
      r.model.id,
      r.model.target_mode,
      fmtScore(r.score.overall_score),
      fmtBool(r.score.structural_valid),
      r.score.violation_codes.join(", ") || "—",
      r.response.failure_code ?? "—",
    ]);
    lines.push(mdTable(briefHeaders, briefRows));
    lines.push("");
  }

  // ── Failure summary ────────────────────────────────────────────────────────
  lines.push("## Failure Summary");
  lines.push("");

  const modelFailHeaders = [
    "Model", "Total", "Parse Fail", "Invalid", "Timeout", "Rate Limited",
    "Auth Fail", "Server Error", "Avg Default Takeover %",
  ];

  const modelFailRows = models.map((m) => {
    const mr = results.filter((r) => r.model.id === m.id);
    const parseFail = mr.filter((r) => r.response.failure_code === "parse_failed").length;
    const invalid = mr.filter((r) => r.score.structural_valid === false && !r.response.failure_code).length;
    const timeout = mr.filter((r) => r.response.failure_code === "timeout_failed").length;
    const rateLimited = mr.filter((r) => r.response.failure_code === "rate_limited").length;
    const authFail = mr.filter((r) => r.response.failure_code === "auth_failed").length;
    const serverErr = mr.filter((r) => r.response.failure_code === "server_error").length;

    return [
      m.id,
      String(mr.length),
      String(parseFail),
      String(invalid),
      String(timeout),
      String(rateLimited),
      String(authFail),
      String(serverErr),
      "—",
    ];
  });

  lines.push(mdTable(modelFailHeaders, modelFailRows));
  lines.push("");

  // ── Flagged issues ─────────────────────────────────────────────────────────
  lines.push("## Flagged Issues");
  lines.push("");

  const flagged = results.filter(
    (r) => r.response.failure_code || !r.score.structural_valid
  );

  if (flagged.length === 0) {
    lines.push("No failures or structural invalidity detected.");
  } else {
    for (const r of flagged) {
      const reason = r.response.failure_code
        ? `failure: ${r.response.failure_code}`
        : `invalid: [${r.score.violation_codes.join(", ")}]`;
      lines.push(`- **${r.model.id}** × **${r.brief.id}** — ${reason}`);
    }
  }

  lines.push("");

  return lines.join("\n");
}

// =============================================================================
// Analysis pack markdown
// =============================================================================

function compactGraphSummary(r: ScoredResult): string {
  const graph = r.response.parsed_graph;
  if (!graph) return "_No graph data_";

  const nodes = graph.nodes
    .map((n) => `  - ${n.id} (${n.kind}${n.category ? "/" + n.category : ""}): ${n.label ?? ""}`)
    .join("\n");

  const edgeCount = graph.edges.length;
  const causalEdges = graph.edges.filter(
    (e) =>
      e.edge_type !== "bidirected" &&
      !(
        (graph.nodes.find((n) => n.id === e.from)?.kind === "decision") ||
        (graph.nodes.find((n) => n.id === e.from)?.kind === "option" &&
          graph.nodes.find((n) => n.id === e.to)?.kind === "factor")
      )
  );

  const means = causalEdges.map((e) => e.strength.mean.toFixed(2)).join(", ");
  const stds = causalEdges.map((e) => e.strength.std.toFixed(2)).join(", ");
  const probs = causalEdges.map((e) => e.exists_probability.toFixed(2)).join(", ");

  const coaching = graph.coaching?.strengthen_items
    ?.map((c) => `  - ${c.label ?? ""}: ${c.detail ?? ""}`)
    .join("\n") ?? "  _(none)_";

  return [
    `**Nodes** (${graph.nodes.length}):`,
    nodes,
    `**Edges**: ${edgeCount} total, ${causalEdges.length} causal`,
    `**Means**: ${means || "—"}`,
    `**Stds**: ${stds || "—"}`,
    `**Exists probs**: ${probs || "—"}`,
    `**Coaching**:`,
    coaching,
    `**Violations**: ${r.score.violation_codes.join(", ") || "none"}`,
  ].join("\n");
}

function generateAnalysisPackMd(
  results: ScoredResult[],
  config: RunConfig,
  promptHash: string
): string {
  const parts: string[] = [];
  let charCount = 0;

  function add(text: string): void {
    parts.push(text);
    charCount += text.length;
  }

  add(`# Graph Evaluator — Analysis Pack\n\n`);
  add(`Run: \`${config.run_id}\` | Prompt: \`${config.prompt_file}\` (${promptHash})\n\n`);

  // ── 1. Scores table ────────────────────────────────────────────────────────
  add(`## Scores Table\n\n`);

  const tableHeaders = [
    "Model", "Brief", "Mode", "Overall", "Struct",
    "Param", "OptDiff", "Complete", "Latency", "Cost", "Nodes", "Failure",
  ];
  const tableRows = results.map((r) => [
    r.model.id,
    r.brief.id,
    r.model.target_mode,
    fmtScore(r.score.overall_score),
    fmtBool(r.score.structural_valid),
    fmtScore(r.score.param_quality),
    fmtScore(r.score.option_diff),
    fmtScore(r.score.completeness),
    `${r.response.latency_ms}ms`,
    `$${(r.response.est_cost_usd ?? 0).toFixed(5)}`,
    String(r.score.node_count),
    r.response.failure_code ?? "—",
  ]);

  add(mdTable(tableHeaders, tableRows) + "\n\n");

  // ── 2. Top 3 graphs ────────────────────────────────────────────────────────
  const ranked = [...results]
    .filter((r) => r.score.overall_score != null)
    .sort((a, b) => (b.score.overall_score ?? 0) - (a.score.overall_score ?? 0));

  const failed = results.filter((r) => r.score.overall_score == null);

  add(`## Top 3 Graphs\n\n`);
  const top3 = ranked.slice(0, 3);
  for (const r of top3) {
    add(`### ${r.model.id} × ${r.brief.id} (score: ${fmtScore(r.score.overall_score)})\n\n`);
    add(compactGraphSummary(r) + "\n\n");

    if (charCount > ANALYSIS_PACK_CHAR_LIMIT * 0.7) break;
  }

  // ── 3. Bottom 3 graphs ─────────────────────────────────────────────────────
  add(`## Bottom 3 Graphs\n\n`);
  const bottom3 = [
    ...ranked.slice(-3).reverse(),
    ...failed.slice(0, Math.max(0, 3 - ranked.length)),
  ].slice(0, 3);

  for (const r of bottom3) {
    add(`### ${r.model.id} × ${r.brief.id} (score: ${fmtScore(r.score.overall_score)})\n\n`);
    add(compactGraphSummary(r) + "\n\n");
    if (r.response.failure_code) {
      add(`**Failure**: ${r.response.failure_code} — ${r.response.error_message ?? ""}\n\n`);
    }

    if (charCount > ANALYSIS_PACK_CHAR_LIMIT * 0.8) break;
  }

  // ── 4. Per-brief comparison ────────────────────────────────────────────────
  if (charCount < ANALYSIS_PACK_CHAR_LIMIT * 0.85) {
    add(`## Per-Brief Comparison\n\n`);

    const briefIds = [...new Set(results.map((r) => r.brief.id))];
    for (const briefId of briefIds) {
      if (charCount > ANALYSIS_PACK_CHAR_LIMIT * 0.88) break;

      const briefResults = results.filter((r) => r.brief.id === briefId);
      const withScore = briefResults.filter((r) => r.score.overall_score != null);
      if (withScore.length < 2) continue;

      withScore.sort((a, b) => (b.score.overall_score ?? 0) - (a.score.overall_score ?? 0));
      const best = withScore[0];
      const worst = withScore[withScore.length - 1];

      add(`### Brief: ${briefId}\n\n`);
      add(`**Best**: ${best.model.id} (${fmtScore(best.score.overall_score)})\n\n`);

      const bestGraph = best.response.parsed_graph;
      if (bestGraph) {
        add(`- Nodes: ${best.score.node_count}, Edges: ${best.score.edge_count}\n`);
        add(`- Param quality: ${fmtScore(best.score.param_quality)}\n`);
        add(`- Option diff: ${fmtScore(best.score.option_diff)}\n`);
        add(`- Completeness: ${fmtScore(best.score.completeness)}\n\n`);
      }

      add(`**Worst**: ${worst.model.id} (${fmtScore(worst.score.overall_score)})\n\n`);
      if (worst.score.violation_codes.length > 0) {
        add(`- Violations: ${worst.score.violation_codes.join(", ")}\n`);
      }
      add(`- Param quality: ${fmtScore(worst.score.param_quality)}\n`);
      add(`- Option diff: ${fmtScore(worst.score.option_diff)}\n`);
      add(`- Completeness: ${fmtScore(worst.score.completeness)}\n\n`);
    }
  }

  // ── 5. Raw JSON for #1 and #last ───────────────────────────────────────────
  if (charCount < ANALYSIS_PACK_CHAR_LIMIT * 0.9 && ranked.length > 0) {
    const highest = ranked[0];
    const lowest = ranked[ranked.length - 1];

    const rawHighest = JSON.stringify(highest.response.parsed_graph, null, 2);
    const rawLowest = JSON.stringify(lowest.response.parsed_graph, null, 2);

    const remainingChars = ANALYSIS_PACK_CHAR_LIMIT - charCount;

    add(`## Raw Graphs\n\n`);

    add(`### Highest-scoring: ${highest.model.id} × ${highest.brief.id}\n\n`);
    const highestTruncated =
      rawHighest.length > remainingChars * 0.5
        ? rawHighest.slice(0, Math.floor(remainingChars * 0.45)) + "\n... [truncated]"
        : rawHighest;
    add("```json\n" + highestTruncated + "\n```\n\n");

    if (charCount < ANALYSIS_PACK_CHAR_LIMIT * 0.95 && lowest !== highest) {
      const remaining2 = ANALYSIS_PACK_CHAR_LIMIT - charCount;
      add(`### Lowest-scoring: ${lowest.model.id} × ${lowest.brief.id}\n\n`);
      const lowestTruncated =
        rawLowest.length > remaining2 * 0.9
          ? rawLowest.slice(0, Math.floor(remaining2 * 0.85)) + "\n... [truncated]"
          : rawLowest;
      add("```json\n" + lowestTruncated + "\n```\n\n");
    }
  }

  const finalContent = parts.join("");
  if (finalContent.length > ANALYSIS_PACK_CHAR_LIMIT) {
    return finalContent.slice(0, ANALYSIS_PACK_CHAR_LIMIT - 50) +
      "\n\n... [truncated to stay under 30,000 character limit]\n";
  }

  return finalContent;
}

// =============================================================================
// Main entry point
// =============================================================================

export interface ReporterInput {
  results: ScoredResult[];
  config: RunConfig;
  models: ModelConfig[];
  briefs: Brief[];
  promptHash: string;
}

/**
 * Generate all report files and return their content as strings.
 * Does NOT write to disk — call io.saveReports() for that.
 */
export function generate(input: ReporterInput): ReportFiles {
  const { results, config, models, briefs, promptHash } = input;

  const scores_csv = generateScoresCsv(results, config);
  const summary_md = generateSummaryMd(results, config, models, briefs, promptHash);
  const analysis_pack_md = generateAnalysisPackMd(results, config, promptHash);

  return { scores_csv, summary_md, analysis_pack_md };
}
