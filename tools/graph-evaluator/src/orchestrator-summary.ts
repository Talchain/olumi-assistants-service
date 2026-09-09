/**
 * Orchestrator run-summary renderer.
 *
 * Extracted from `cli.ts` so it can be exercised directly: `cli.ts` runs
 * `main()` at import time, which makes it unimportable from a test, and a
 * report section nobody can render is a report section nobody can verify.
 *
 * Two separate statements, because conflating them misreads what changed:
 *
 * 1. The EXTRACTION is a pure move. The 80-line body lifted out of `cli.ts`
 *    and the corresponding 80 lines here are identical apart from the added
 *    `export` keyword on the signature, plus the result type it consumes.
 * 2. The MODULE is NOT behaviour-neutral. It adds an always-printed
 *    "Unattested Scale Renders" section (41 lines below), so
 *    `generateOrchestratorSummary` now emits output it did not emit before.
 *    The section is printed unconditionally, including its zero case, so
 *    "measured, found none" stays distinguishable from "not measured".
 *
 * The diagnostic it reports changes no score and gates nothing — see
 * `orchestrator-scorer.ts` — but the report text is genuinely different.
 */

import type {
  GenericScoredResult,
  JudgeResult,
  RunConfig,
} from "./types.js";

export interface OrchestratorScoredResult extends GenericScoredResult {
  judgeResult?: JudgeResult;
  conversationHistory?: string;
}

export function generateOrchestratorSummary(
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

  // ── Unattested scale renders (DIAGNOSTIC — not scored, not gated) ──────────
  // Printed unconditionally, including the zero case, so "measured, found none"
  // is distinguishable from "not measured". A silent section would let the
  // class disappear from a promotion report exactly when it was fixed.
  lines.push("\n## Unattested Scale Renders (diagnostic — not scored)\n");
  lines.push(
    "Percentages rendered from model values whose scale nothing attests. " +
    "A unitless `0.5` shown as `50%` converts an admitted unknown into a " +
    "confident statistic. These do NOT affect `fabrication_check` or `overall` " +
    "— the remedy is an open product decision. Tracked here so a promotion run " +
    "can tell an improvement from a regression on this class.\n"
  );

  const scaleRows = results.flatMap((r) =>
    (r.score.scale_conversions ?? []).map((c) => ({ r, c }))
  );

  if (scaleRows.length === 0) {
    const anyMeasured = results.some((r) => r.score.scale_conversions !== undefined);
    lines.push(
      anyMeasured
        ? "None detected across this run.\n"
        : "NOT MEASURED — no result carried the diagnostic.\n"
    );
  } else {
    lines.push(`| Model | Case | Rendered | Source value | Source | Why unattested |`);
    lines.push(`| --- | --- | --- | --- | --- | --- |`);
    for (const { r, c } of scaleRows) {
      lines.push(
        `| ${r.model.id} | ${r.fixture_id} | \`${c.rendered}\` | \`${c.source_value}\` | \`${c.source_ref}\` | ${c.attestation} |`
      );
    }
    const affected = new Set(
      results.filter((r) => (r.score.scale_conversions ?? []).length > 0)
        .map((r) => `${r.model.id}×${r.fixture_id}`)
    ).size;
    lines.push(
      `\n**${scaleRows.length}** unattested render(s) across **${affected}** of **${results.length}** scored response(s).\n`
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
