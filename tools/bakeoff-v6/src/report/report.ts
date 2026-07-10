/**
 * Report generator — the product's face. Headline comparison first, then
 * safety, true cost/latency, equal-compute audit, silent-exclusion
 * accounting, and cross-arm alignment. Watermarked NOT EVIDENCE unless the
 * fail-closed attestation gate passes (see attestations.ts).
 */
import { WATERMARK, type EvidenceAssessment } from "./attestations.ts";
import type { ComputeMatchEntry } from "../compute/match.ts";
import type { FgqResult } from "../scoring/fgq/fgq.ts";
import type { HolisticVerdict } from "../scoring/holistic/llm.ts";
import type {
  HolisticDeterministicScore,
  PreflightResult,
  RunConfig,
  SafetyCellHit,
} from "../types.ts";
import { PRICING_TABLE, type PricingStaleness } from "../llm/pricing.ts";

export interface ScoreRow {
  arm_label: string;
  brief_id: string;
  seed: number;
  blind_id: string;
  valid: boolean;
  failure_stage: string | null;
  scoring_refused: string | null;
  safety_hits: SafetyCellHit[];
  fgq: FgqResult | null;
  r_pending: boolean;
  holistic_det: HolisticDeterministicScore | null;
  holistic_llm: HolisticVerdict | null;
  merge_failures: number;
  merge_applied: number;
  merge_proposals_total: number;
  cost_usd: number;
  latency_ms: number;
}

export interface ReportInput {
  config: RunConfig;
  baseSha: string;
  verdictProvider: string;
  preflight: PreflightResult;
  pricingStaleness: PricingStaleness;
  rows: ScoreRow[];
  matchEntries: ComputeMatchEntry[];
  evidence: EvidenceAssessment;
  blockedArms: Array<{ arm: string; reason: string }>;
  generatedLabel: string;
}

const fmt = (x: number | null | undefined, digits = 3): string =>
  x === null || x === undefined ? "—" : x.toFixed(digits);
const usd = (x: number): string => `$${x.toFixed(4)}`;

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

export function buildReport(input: ReportInput): string {
  const lines: string[] = [];
  const banner = `> ⚠️ **${WATERMARK}** ⚠️`;

  if (input.evidence.watermark) {
    lines.push(banner, ">");
    for (const reason of input.evidence.reasons) lines.push(`> - ${reason}`);
    lines.push("");
  }

  lines.push(`# V6 Bake-off report — run \`${input.config.run_id}\``, "");
  lines.push(`- Generated: ${input.generatedLabel}`);
  lines.push(`- Base SHA: \`${input.baseSha}\``);
  lines.push(`- Mode: ${input.config.mock ? "MOCK (deterministic fixture client — no network)" : "live"}`);
  lines.push(`- Verdict provider: \`${input.verdictProvider}\``);
  lines.push(
    `- Models: A=${input.config.models.A.model} · B=${input.config.models.B.model} (effort ${input.config.models.B.effort}) · C=${input.config.models.C.m1}+${input.config.models.C.m2} · D=${input.config.models.D.executor}+advisor:${input.config.models.D.advisor}`
  );
  lines.push(
    `- Pricing: ${PRICING_TABLE.currency}, as-of ${PRICING_TABLE.as_of} (${PRICING_TABLE.entered}); source: ${PRICING_TABLE.source}`
  );
  if (input.pricingStaleness.stale) {
    lines.push(
      `- ⚠️ **PRICING TABLE STALE**: ${input.pricingStaleness.age_days} days old (limit ${PRICING_TABLE.stale_after_days}) — refresh before trusting cost comparisons`
    );
  } else {
    lines.push(`- Pricing age: ${input.pricingStaleness.age_days} days (fresh)`);
  }
  lines.push("");

  if (input.blockedArms.length > 0) {
    lines.push("## Blocked arms", "");
    for (const blocked of input.blockedArms) lines.push(`- **${blocked.arm}**: ${blocked.reason}`);
    lines.push("");
  }

  // ---- Provisional gates (standing caveats, independent of the watermark) ----
  const armLabelsForGates = new Set(input.rows.map((r) => r.arm_label));
  const armDPresent = [...armLabelsForGates].some((label) => label === "D" || label.startsWith("B@match_d"));
  const rPendingForGates = input.rows.some((r) => r.r_pending);
  const gates: string[] = [];
  if (armDPresent) {
    gates.push(
      "**Arm-D cost is PROVISIONAL** — the advisor tool's `usage.iterations[]` shape is not yet verified on a real arm-D generation call. Arm-D USD cost and every **B@D** equal-compute comparison below are provisional; **no D comparison is evidential** until the first real advisor generation confirms the shape and the cost mapper is checked against it."
    );
  }
  if (rPendingForGates) {
    gates.push(
      "**FGQ recall is `pending R`** — the warranted reference set R is not built. Recall and full FGQ are unavailable; no decisive final-graph-quality comparison (which arm found more warranted content) can be quoted until R exists."
    );
  }
  if (gates.length > 0) {
    lines.push("## Provisional gates", "");
    for (const gate of gates) lines.push(`- ${gate}`);
    lines.push("");
  }

  // ---- Headline ----
  const armLabels = [...new Set(input.rows.map((r) => r.arm_label))].sort();
  lines.push("## Headline — per-arm comparison", "");
  const rPendingAnywhere = input.rows.some((r) => r.r_pending);
  if (rPendingAnywhere) {
    lines.push(
      "> **FGQ recall is `pending R`** — the warranted reference set R (third human-judgement input) is not built. FGQ numbers below are precision+safety only; no claim about which arm found more warranted content can be made until R exists.",
      ""
    );
  }
  lines.push(
    "| Arm | Candidates | Invalid | Safety-capped | FGQ (precision-only where R pending) | Precision | Recall | Holistic (det) | Holistic (LLM) | Total cost | Mean latency |",
    "|---|---|---|---|---|---|---|---|---|---|---|"
  );
  for (const label of armLabels) {
    const rows = input.rows.filter((r) => r.arm_label === label);
    const valid = rows.filter((r) => r.valid);
    const scored = rows.filter((r) => r.fgq !== null);
    const capped = scored.filter((r) => r.fgq!.tier === "SAFETY_CAPPED").length;
    const recallDisplay = rows.some((r) => r.r_pending)
      ? "pending R"
      : fmt(mean(scored.map((r) => r.fgq!.recall)));
    lines.push(
      `| ${label} | ${rows.length} | ${rows.length - valid.length} | ${capped} | ${fmt(mean(scored.map((r) => r.fgq!.fgq)))} | ${fmt(
        mean(scored.map((r) => r.fgq!.precision))
      )} | ${recallDisplay} | ${fmt(mean(rows.filter((r) => r.holistic_det).map((r) => r.holistic_det!.score)))} | ${fmt(
        mean(rows.filter((r) => r.holistic_llm).map((r) => r.holistic_llm!.overall)),
        1
      )} | ${usd(rows.reduce((s, r) => s + r.cost_usd, 0))} | ${fmt(mean(rows.map((r) => r.latency_ms)), 0)} ms |`
    );
  }
  lines.push("");

  // ---- Safety cells ----
  lines.push("## Safety cells", "");
  const anyHits = input.rows.some((r) => r.safety_hits.length > 0);
  if (!anyHits) {
    lines.push("No deterministic safety-cell hits.", "");
  } else {
    lines.push("| Arm | Brief | Seed | Cell | Element | Detail |", "|---|---|---|---|---|---|");
    for (const row of input.rows) {
      for (const hit of row.safety_hits) {
        lines.push(
          `| ${row.arm_label} | ${row.brief_id} | ${row.seed} | ${hit.cell} | \`${hit.element_id}\` | ${hit.detail} |`
        );
      }
    }
    lines.push("", "`unsupported_causal_link` rows are a HEURISTIC PROXY — the cleared judge owns real verdicts.", "");
  }

  // ---- Equal-compute audit ----
  lines.push("## Equal-compute audit (currency: USD; tolerance ±20%)", "");
  if (input.matchEntries.length === 0) {
    lines.push("No compute-matched B runs in this run.", "");
  } else {
    lines.push(
      "| Comparison | Brief | Seed | Target USD | Achieved USD | Ratio | Within ±20% |",
      "|---|---|---|---|---|---|---|"
    );
    for (const entry of input.matchEntries) {
      lines.push(
        `| ${entry.comparison} | ${entry.brief_id} | ${entry.seed} | ${usd(entry.target_usd)} | ${usd(entry.achieved_usd)} | ${
          entry.ratio === null ? "—" : entry.ratio.toFixed(2)
        } | ${entry.within_tolerance ? "✓" : "**✗ FLAGGED**"} |`
      );
    }
    const flagged = input.matchEntries.filter((e) => !e.within_tolerance).length;
    lines.push("");
    if (flagged > 0) {
      lines.push(
        `⚠️ ${flagged} comparison(s) OUT OF TOLERANCE — those B-vs-partner conclusions are not compute-fair and must not be quoted.`,
        ""
      );
    }
  }

  // ---- Latency ----
  lines.push("## Latency", "");
  lines.push("| Arm | p50 | p95 |", "|---|---|---|");
  for (const label of armLabels) {
    const latencies = input.rows.filter((r) => r.arm_label === label).map((r) => r.latency_ms);
    lines.push(`| ${label} | ${fmt(percentile(latencies, 50), 0)} ms | ${fmt(percentile(latencies, 95), 0)} ms |`);
  }
  lines.push("");

  // ---- Silent-exclusion accounting ----
  lines.push("## Silent-exclusion accounting", "");
  lines.push(
    "Every candidate and every proposal lands in a counted bucket — nothing is dropped from the tally.",
    "",
    "| Arm | Stored | Invalid (counted) | Scoring refused (leak scan) | C proposals | C applied | C failures (recorded) |",
    "|---|---|---|---|---|---|---|"
  );
  for (const label of armLabels) {
    const rows = input.rows.filter((r) => r.arm_label === label);
    lines.push(
      `| ${label} | ${rows.length} | ${rows.filter((r) => !r.valid).length} | ${rows.filter((r) => r.scoring_refused !== null).length} | ${rows.reduce(
        (s, r) => s + r.merge_proposals_total,
        0
      )} | ${rows.reduce((s, r) => s + r.merge_applied, 0)} | ${rows.reduce((s, r) => s + r.merge_failures, 0)} |`
    );
  }
  lines.push("");
  lines.push(
    "_Arm-C is an **M1 draft + M2 suggestion overlay**: M2's delta.node is a {label, description} suggestion (\"never an applied change\"), so **`C applied` ~ 0 is BY DESIGN** and proposals correctly land in artifacts/failures. Arm-C is evaluated on suggestion quality, not merge deltas — do not read `C applied` as arm strength or compare arm-C to A/B on graph structure._",
    ""
  );
  const failures = input.rows.filter((r) => r.failure_stage !== null);
  if (failures.length > 0) {
    lines.push("Recorded failures:", "");
    for (const row of failures) {
      lines.push(`- ${row.arm_label} / ${row.brief_id} / s${row.seed}: \`${row.failure_stage}\``);
    }
    lines.push("");
  }

  // ---- Alignment matrix ----
  lines.push("## Cross-arm alignment (identical fixtures and seeds per comparison)", "");
  const cells = new Set(input.rows.map((r) => `${r.arm_label}|${r.brief_id}|${r.seed}`));
  const briefSeeds = [...new Set(input.rows.map((r) => `${r.brief_id}|${r.seed}`))].sort();
  lines.push(`| Brief / seed | ${armLabels.join(" | ")} |`, `|---|${armLabels.map(() => "---").join("|")}|`);
  for (const bs of briefSeeds) {
    const [briefId, seed] = bs.split("|");
    lines.push(
      `| ${briefId} s${seed} | ${armLabels.map((a) => (cells.has(`${a}|${briefId}|${seed}`) ? "✓" : "**✗**")).join(" | ")} |`
    );
  }
  lines.push("");

  lines.push("## Blinding", "");
  lines.push(
    "Scoring consumed allowlist-projected blind payloads only. The blind_id ↔ arm mapping is in `presentation_map.SEALED.json` — sealed; scoring code never reads it.",
    ""
  );

  if (input.evidence.watermark) {
    lines.push("---", "", banner, "");
  }
  return lines.join("\n") + "\n";
}
