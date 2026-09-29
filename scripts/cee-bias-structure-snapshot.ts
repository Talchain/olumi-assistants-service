import { readFile } from "node:fs/promises";

import type { CeeJourneyEnvelopes, CeeQualityBand } from "../sdk/typescript/src/ceeHelpers.js";
import { classifyCeeQuality } from "../sdk/typescript/src/ceeHelpers.js";

export interface CeeBiasStructureDraftSummary {
  quality_overall?: number;
  quality_band?: CeeQualityBand;
  structural_warning_count: number;
  structural_warnings_by_id: Record<string, { count: number; severity?: string }>;
  confidence_flags?: {
    simplification_applied?: boolean;
    uncertain_node_count?: number;
  };
}

export interface CeeBiasStructureBiasSummary {
  quality_overall?: number;
  quality_band?: CeeQualityBand;
  total_findings: number;
  by_severity: Record<string, number>;
  by_category: Record<string, number>;
  by_code: Record<string, number>;
}

export interface CeeBiasStructureSnapshot {
  draft?: CeeBiasStructureDraftSummary | null;
  bias?: CeeBiasStructureBiasSummary | null;
}

function summarizeDraft(envelopes: CeeJourneyEnvelopes): CeeBiasStructureDraftSummary | null {
  const draft = envelopes.draft as any;
  if (!draft || typeof draft !== "object") {
    return null;
  }

  const quality_overall =
    draft.quality && typeof draft.quality.overall === "number"
      ? (draft.quality.overall as number)
      : undefined;
  const quality_band = draft.quality ? classifyCeeQuality(draft.quality as any) : undefined;

  const warnings = Array.isArray(draft.draft_warnings)
    ? (draft.draft_warnings as any[])
    : [];

  const structural_warnings_by_id: Record<string, { count: number; severity?: string }> = {};

  for (const w of warnings) {
    if (!w || typeof w !== "object") continue;
    const id = typeof w.id === "string" && w.id.length > 0 ? (w.id as string) : "unknown";
    const severity = typeof w.severity === "string" ? (w.severity as string) : undefined;

    const current = structural_warnings_by_id[id];
    if (current) {
      current.count += 1;
    } else {
      structural_warnings_by_id[id] = { count: 1, severity };
    }
  }

  const structural_warning_count = warnings.length;

  const cf = draft.confidence_flags as
    | { uncertain_nodes?: string[]; simplification_applied?: boolean }
    | undefined;

  let confidence_flags: CeeBiasStructureDraftSummary["confidence_flags"];
  if (cf && (Array.isArray(cf.uncertain_nodes) || cf.simplification_applied === true)) {
    confidence_flags = {
      simplification_applied: cf.simplification_applied === true ? true : undefined,
      uncertain_node_count: Array.isArray(cf.uncertain_nodes)
        ? cf.uncertain_nodes.length
        : undefined,
    };
  }

  return {
    quality_overall,
    quality_band,
    structural_warning_count,
    structural_warnings_by_id,
    confidence_flags,
  };
}

function summarizeBias(envelopes: CeeJourneyEnvelopes): CeeBiasStructureBiasSummary | null {
  const bias = envelopes.bias as any;
  if (!bias || typeof bias !== "object") {
    return null;
  }

  const quality_overall =
    bias.quality && typeof bias.quality.overall === "number"
      ? (bias.quality.overall as number)
      : undefined;
  const quality_band = bias.quality ? classifyCeeQuality(bias.quality as any) : undefined;

  const findings = Array.isArray(bias.bias_findings)
    ? (bias.bias_findings as any[])
    : [];

  const by_severity: Record<string, number> = {};
  const by_category: Record<string, number> = {};
  const by_code: Record<string, number> = {};

  for (const f of findings) {
    if (!f || typeof f !== "object") continue;
    const severity = typeof f.severity === "string" ? (f.severity as string) : "unknown";
    const category = typeof f.category === "string" ? (f.category as string) : "unknown";
    const code = typeof f.code === "string" && f.code.length > 0 ? (f.code as string) : "unknown";

    by_severity[severity] = (by_severity[severity] ?? 0) + 1;
    by_category[category] = (by_category[category] ?? 0) + 1;
    by_code[code] = (by_code[code] ?? 0) + 1;
  }

  return {
    quality_overall,
    quality_band,
    total_findings: findings.length,
    by_severity,
    by_category,
    by_code,
  };
}

export function summarizeBiasAndStructureSnapshot(
  envelopes: CeeJourneyEnvelopes,
): CeeBiasStructureSnapshot {
  const draft = summarizeDraft(envelopes);
  const bias = summarizeBias(envelopes);

  return {
    draft,
    bias,
  };
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
  const arg = process.argv[2];

  let raw: string;
  if (arg && arg !== "-") {
    raw = await readFile(arg, "utf8");
  } else {
    raw = await readJsonFromStdin();
  }

  if (!raw.trim()) {
    // eslint-disable-next-line no-console
    console.error(
      "[cee-bias-structure-snapshot] No input provided. Pass a file path or pipe JSON to stdin.",
    );
    process.exit(1);
  }

  let envelopes: CeeJourneyEnvelopes;
  try {
    envelopes = JSON.parse(raw) as CeeJourneyEnvelopes;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      "[cee-bias-structure-snapshot] Failed to parse JSON:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
    return;
  }

  const snapshot = summarizeBiasAndStructureSnapshot(envelopes);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(snapshot, null, 2));
}

if (typeof require !== "undefined" && require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("[cee-bias-structure-snapshot] Unexpected error:", error);
    process.exit(1);
  });
}
