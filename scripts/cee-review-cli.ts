/**
 * CEE review CLI (dev-only)
 *
 * Reads CEE envelopes or a Decision Review payload and prints a compact,
 * metadata-only summary suitable for manual inspection or dashboards.
 *
 * Usage (from repo root):
 *
 *   # From envelopes (CeeJourneyEnvelopes-like JSON)
 *   pnpm tsx scripts/cee-review-cli.ts --mode envelopes --input path/to/envelopes.json
 *
 *   # From a Decision Review payload or bundle (e.g. golden fixture)
 *   pnpm tsx scripts/cee-review-cli.ts --mode review --input path/to/review.json
 *
 *   # Use "--output json" for a small summary object instead of pretty text
 *   pnpm tsx scripts/cee-review-cli.ts --mode review --input review.json --output json
 */

import { readFile } from "node:fs/promises";

import {
  buildCeeDecisionReviewPayload,
  buildCeeEngineStatus,
  buildCeeEvidenceCoverageSummary,
  buildCeeTraceSummary,
  type CeeDecisionReviewPayload,
  type CeeEngineStatus,
  type CeeEvidenceCoverageSummary,
  type CeeJourneyEnvelopes,
  type CeeTraceSummary,
  type CeeHealthSummary,
  type CeeHealthTone,
  type CeeUiFlags,
} from "../sdk/typescript/src/ceeHelpers.js";
import type { CEEBiasCheckResponseV1 } from "../sdk/typescript/src/ceeTypes.js";
import type { GraphV1 } from "../sdk/typescript/src/graphTypes.js";
import { applyGraphPatch } from "../sdk/typescript/src/applyGraphPatch.js";

export interface CeeReviewSummary {
  headline: string;
  key_drivers: string[];
  next_actions: string[];
  any_truncated: boolean;
  health: {
    status: CeeHealthSummary["status"];
    tone: CeeHealthTone;
    any_truncated: boolean;
    has_validation_issues: boolean;
    reasons: string[];
  };
  journey: {
    is_complete: boolean;
    missing_envelopes: CeeHealthSummary["source"][];
    has_team_disagreement: boolean;
  };
  flags: CeeUiFlags;
  trace?: CeeTraceSummary;
  engine?: CeeEngineStatus;
  evidenceCoverage?: CeeEvidenceCoverageSummary;
}

export interface CeeMitigationEffectSummary {
  applied: boolean;
  addedNodesByKind: Record<string, number>;
}

function countNodesByKind(graph: GraphV1 | null | undefined): Record<string, number> {
  const counts: Record<string, number> = {};

  if (!graph || !Array.isArray((graph as any).nodes)) {
    return counts;
  }

  for (const node of (graph as any).nodes as any[]) {
    const kind =
      node && typeof (node as any).kind === "string"
        ? ((node as any).kind as string)
        : "unknown";
    counts[kind] = (counts[kind] ?? 0) + 1;
  }

  return counts;
}

/**
 * Simulate applying bias mitigation patches from the bias envelope to the
 * draft graph, returning only metadata about how many nodes would be added
 * by kind. This remains metadata-only and never returns the full graph.
 */
export function simulateBiasMitigationEffect(
  envelopes: CeeJourneyEnvelopes,
): CeeMitigationEffectSummary {
  const draft = envelopes.draft as { graph?: GraphV1 } | null | undefined;
  const bias = envelopes.bias as CEEBiasCheckResponseV1 | null | undefined;

  const baseGraph = draft && typeof draft === "object" ? (draft.graph as GraphV1) : undefined;
  const patches = (bias as any)?.mitigation_patches;

  if (!baseGraph || !Array.isArray(patches) || patches.length === 0) {
    return {
      applied: false,
      addedNodesByKind: {},
    };
  }

  const baseCounts = countNodesByKind(baseGraph);

  let updatedGraph: GraphV1 = baseGraph;
  for (const mitigation of patches as any[]) {
    if (!mitigation || typeof mitigation !== "object") continue;
    const patch = (mitigation as any).patch;
    if (!patch || typeof patch !== "object") continue;
    updatedGraph = applyGraphPatch(updatedGraph, patch as any);
  }

  const updatedCounts = countNodesByKind(updatedGraph);
  const addedNodesByKind: Record<string, number> = {};

  for (const [kind, newCount] of Object.entries(updatedCounts)) {
    const oldCount = baseCounts[kind] ?? 0;
    const diff = newCount - oldCount;
    if (diff > 0) {
      addedNodesByKind[kind] = diff;
    }
  }

  return {
    applied: Object.keys(addedNodesByKind).length > 0,
    addedNodesByKind,
  };
}

function buildHealthReasonsFromReview(review: CeeDecisionReviewPayload): string[] {
  const reasons = new Set<string>();

  for (const reason of review.story.risks_and_gaps || []) {
    if (reason && typeof reason === "string") {
      reasons.add(reason);
    }
  }

  const per = review.journey.health.perEnvelope;
  for (const summary of Object.values(per)) {
    if (!summary) continue;
    for (const r of summary.reasons || []) {
      if (r && typeof r === "string") {
        reasons.add(r);
      }
    }
  }

  return Array.from(reasons).slice(0, 8);
}

export function buildCeeReviewSummaryFromReview(
  review: CeeDecisionReviewPayload,
  engineStatus?: CeeEngineStatus | null,
  traceSummary?: CeeTraceSummary | null,
  evidenceCoverage?: CeeEvidenceCoverageSummary | null,
): CeeReviewSummary {
  if (!review || typeof review !== "object") {
    throw new Error("CEE review summary: review payload is missing or invalid");
  }
  if (!review.story || !review.journey || !review.uiFlags) {
    throw new Error("CEE review summary: input does not look like CeeDecisionReviewPayload");
  }

  const { story, journey, uiFlags } = review;
  const health = journey.health;

  const reasons = buildHealthReasonsFromReview(review);

  let trace: CeeTraceSummary | undefined;
  if (traceSummary) {
    trace = traceSummary;
  } else if (review.trace && (review.trace.request_id || review.trace.correlation_id)) {
    const summary = buildCeeTraceSummary({
      trace: review.trace as any,
      engineStatus: engineStatus ?? undefined,
    });
    if (summary) {
      trace = summary;
    }
  }

  return {
    headline: story.headline,
    key_drivers: story.key_drivers.slice(0, 4),
    next_actions: story.next_actions.slice(0, 4),
    any_truncated: Boolean(story.any_truncated || health.any_truncated),
    health: {
      status: health.overallStatus,
      tone: health.overallTone,
      any_truncated: health.any_truncated,
      has_validation_issues: health.has_validation_issues,
      reasons,
    },
    journey: {
      is_complete: journey.is_complete,
      missing_envelopes: journey.missing_envelopes,
      has_team_disagreement: journey.has_team_disagreement,
    },
    flags: uiFlags,
    trace,
    engine: engineStatus ?? undefined,
    evidenceCoverage: evidenceCoverage ?? undefined,
  };
}

export function buildCeeReviewSummaryFromEnvelopes(
  envelopes: CeeJourneyEnvelopes,
): CeeReviewSummary {
  const review = buildCeeDecisionReviewPayload(envelopes);
  const engineStatus = buildCeeEngineStatus(envelopes) ?? undefined;
  const evidence = envelopes.evidence ?? null;
  const coverage = evidence
    ? buildCeeEvidenceCoverageSummary({ evidence })
    : null;

  const trace = buildCeeTraceSummary({
    trace: review.trace as any,
    engineStatus,
  });

  return buildCeeReviewSummaryFromReview(review, engineStatus, trace, coverage);
}

export function formatCeeReviewSummaryPretty(summary: CeeReviewSummary): string {
  const lines: string[] = [];

  lines.push("CEE Decision Review Summary");
  lines.push("");
  lines.push(`Headline: ${summary.headline}`);
  lines.push("");

  const keyDrivers = summary.key_drivers.slice(0, 3);
  if (keyDrivers.length > 0) {
    lines.push("Key drivers:");
    for (const d of keyDrivers) {
      lines.push(`  - ${d}`);
    }
    lines.push("");
  }

  const nextActions = summary.next_actions.slice(0, 3);
  if (nextActions.length > 0) {
    lines.push("Next actions:");
    for (const a of nextActions) {
      lines.push(`  - ${a}`);
    }
    lines.push("");
  }

  lines.push(
    `Health: ${summary.health.status} (tone: ${summary.health.tone}, any_truncated: ${summary.health.any_truncated}, has_validation_issues: ${summary.health.has_validation_issues})`,
  );

  if (summary.health.reasons.length > 0) {
    lines.push("Health reasons:");
    for (const r of summary.health.reasons.slice(0, 5)) {
      lines.push(`  - ${r}`);
    }
    lines.push("");
  }

  lines.push(
    `Journey: is_complete=${summary.journey.is_complete}, missing_envelopes=[${summary.journey.missing_envelopes.join(", ")}], has_team_disagreement=${summary.journey.has_team_disagreement}`,
  );
  lines.push(
    `Flags: has_high_risk_envelopes=${summary.flags.has_high_risk_envelopes}, has_truncation_somewhere=${summary.flags.has_truncation_somewhere}, has_team_disagreement=${summary.flags.has_team_disagreement}, is_journey_complete=${summary.flags.is_journey_complete}`,
  );

  if (summary.evidenceCoverage) {
    const c = summary.evidenceCoverage;
    lines.push(
      `Evidence coverage: level=${c.coverage_level}, returned=${c.returned_count}, max_items=${c.max_items ?? "-"}, items_truncated=${c.items_truncated}`,
    );
  }

  if (summary.trace) {
    lines.push(
      `Trace: requestId=${summary.trace.requestId}, degraded=${summary.trace.degraded}, provider=${summary.trace.provider ?? "-"}, model=${summary.trace.model ?? "-"}`,
    );
  }

  if (summary.engine) {
    lines.push(
      `Engine: provider=${summary.engine.provider ?? "-"}, model=${summary.engine.model ?? "-"}, degraded=${summary.engine.degraded}`,
    );
  }

  return lines.join("\n");
}

type Mode = "envelopes" | "review";

type OutputMode = "pretty" | "json";

interface CliOptions {
  inputPath?: string;
  mode: Mode;
  output: OutputMode;
  applyMitigations: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  let inputPath: string | undefined;
  let mode: Mode = "envelopes";
  let output: OutputMode = "pretty";
   let applyMitigations = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input" || arg === "-i") {
      inputPath = argv[i + 1];
      i += 1;
    } else if (arg === "--mode" || arg === "-m") {
      const value = argv[i + 1];
      if (value === "envelopes" || value === "review") {
        mode = value;
      } else {
        throw new Error(`Unknown --mode value: ${value}`);
      }
      i += 1;
    } else if (arg === "--output" || arg === "-o") {
      const value = argv[i + 1];
      if (value === "pretty" || value === "json") {
        output = value;
      } else {
        throw new Error(`Unknown --output value: ${value}`);
      }
      i += 1;
    } else if (arg === "--apply-mitigations") {
      applyMitigations = true;
    }
  }

  return { inputPath, mode, output, applyMitigations };
}

async function readJsonFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(chunk as Buffer);
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[cee-review-cli] Argument error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
    return;
  }

  let raw: string;
  if (options.inputPath && options.inputPath !== "-") {
    raw = await readFile(options.inputPath, "utf8");
  } else {
    raw = await readJsonFromStdin();
  }

  if (!raw.trim()) {
    // eslint-disable-next-line no-console
    console.error("[cee-review-cli] No input provided. Use --input <file> or pipe JSON to stdin.");
    process.exit(1);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[cee-review-cli] Failed to parse JSON:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  let summary: CeeReviewSummary;

  try {
    if (options.mode === "envelopes") {
      summary = buildCeeReviewSummaryFromEnvelopes(json as CeeJourneyEnvelopes);
    } else {
      // review mode – accept either a plain CeeDecisionReviewPayload or an object
      // with a `review` field (e.g. the golden fixture shape).
      let review: CeeDecisionReviewPayload;
      let engineStatus: CeeEngineStatus | undefined;
      let trace: CeeTraceSummary | null | undefined;

      if (json && typeof json === "object" && "review" in (json as any)) {
        const obj = json as { review: CeeDecisionReviewPayload; engineStatus?: CeeEngineStatus; trace?: CeeTraceSummary };
        review = obj.review;
        engineStatus = obj.engineStatus;
        trace = obj.trace;
      } else {
        review = json as CeeDecisionReviewPayload;
      }

      summary = buildCeeReviewSummaryFromReview(review, engineStatus ?? null, trace ?? null, null);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      "[cee-review-cli] Failed to build review summary:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
    return;
  }

  if (options.output === "json") {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));
  } else {
    const text = formatCeeReviewSummaryPretty(summary);
    // eslint-disable-next-line no-console
    console.log(text);

    if (options.mode === "envelopes" && options.applyMitigations) {
      const envelopes = json as CeeJourneyEnvelopes;
      const effect = simulateBiasMitigationEffect(envelopes);

      // eslint-disable-next-line no-console
      console.log("");

      if (!effect.applied) {
        // eslint-disable-next-line no-console
        console.log(
          "[cee-review-cli] Mitigation simulation: no mitigation_patches applied or no structural changes.",
        );
      } else {
        const parts = Object.entries(effect.addedNodesByKind).map(
          ([kind, count]) => `${kind}=${count}`,
        );
        // eslint-disable-next-line no-console
        console.log(
          `[cee-review-cli] Mitigation simulation: added nodes by kind: ${parts.join(", ")}`,
        );
      }
    }
  }
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("[cee-review-cli] Unexpected error:", error);
    process.exit(1);
  });
}
