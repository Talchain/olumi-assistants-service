/**
 * CEE health snapshot CLI (dev-only)
 *
 * This script reads a JSON object containing CEE envelopes (the same shape used
 * by `buildCeeDecisionReviewPayload`) and prints a compact, metadata-only
 * health summary. It is intended for manual debugging and incident triage.
 *
 * Usage (from repo root):
 *
 *   # Read envelopes from a JSON file
 *   pnpm tsx scripts/cee-health-snapshot.ts path/to/envelopes.json
 *
 *   # Or read from stdin
 *   cat envelopes.json | pnpm tsx scripts/cee-health-snapshot.ts
 *
 * The summary uses only helper-derived metadata (health bands, truncation
 * flags, validation flags, and UI flags) and never prints prompts, graphs, or
 * LLM-generated text.
 */

import { readFile } from "node:fs/promises";
import {
  buildCeeDecisionReviewPayload,
  buildCeeEngineStatus,
  type CeeDecisionReviewPayload,
  type CeeJourneyEnvelopes,
  type CeeHealthSummary,
  type CeeHealthTone,
  type CeeUiFlags,
  type CeeEngineStatus,
} from "../sdk/typescript/src/ceeHelpers.js";

export interface CeeHealthSnapshotPerEnvelope {
  status: CeeHealthSummary["status"];
  any_truncated: boolean;
  has_validation_issues: boolean;
}

export interface CeeHealthSnapshot {
  overallStatus: CeeHealthSummary["status"];
  overallTone: CeeHealthTone;
  any_truncated: boolean;
  has_validation_issues: boolean;
  is_journey_complete: boolean;
  missing_envelopes: CeeHealthSummary["source"][];
  has_team_disagreement: boolean;
  perEnvelope: Partial<Record<CeeHealthSummary["source"], CeeHealthSnapshotPerEnvelope>>;
  uiFlags: CeeUiFlags;
  traceId?: string;
  engine?: CeeEngineStatus;
}

export interface CeeServiceHealthSummary {
  service?: string;
  version?: string;
  provider?: string;
  model?: string;
  limits_source?: string;
  diagnostics_enabled: boolean;
  feature_flags: Record<string, boolean>;
  cee_config: Record<string, { feature_version?: string; rate_limit_rpm?: number }>;
  recent_error_counts?: {
    total: number;
    by_capability: Record<string, number>;
    by_status: Record<string, number>;
    by_error_code: Record<string, number>;
  };
}

/**
 * Pure helper to derive a compact, metadata-only health snapshot from a
 * CeeDecisionReviewPayload. This intentionally omits story text and focuses on
 * health, completeness, flags, and a compact engine status summary.
 */
export function summarizeReviewForSnapshot(
  review: CeeDecisionReviewPayload,
  engine?: CeeEngineStatus | null,
): CeeHealthSnapshot {
  const { journey, uiFlags, trace } = review;
  const perEnvelope: CeeHealthSnapshot["perEnvelope"] = {};

  for (const [source, health] of Object.entries(journey.health.perEnvelope)) {
    if (!health) continue;
    perEnvelope[source as CeeHealthSummary["source"]] = {
      status: health.status,
      any_truncated: health.any_truncated,
      has_validation_issues: health.has_validation_issues,
    };
  }

  return {
    overallStatus: journey.health.overallStatus,
    overallTone: journey.health.overallTone,
    any_truncated: journey.health.any_truncated,
    has_validation_issues: journey.health.has_validation_issues,
    is_journey_complete: journey.is_complete,
    missing_envelopes: journey.missing_envelopes,
    has_team_disagreement: journey.has_team_disagreement,
    perEnvelope,
    uiFlags,
    traceId: trace?.request_id,
    engine: engine ?? undefined,
  };
}

/**
 * Summarise /healthz and (optionally) /diagnostics payloads into a compact,
 * metadata-only service health view suitable for maintainers.
 *
 * This helper expects the raw JSON bodies from GET /healthz and GET
 * /diagnostics. It only reads metadata fields (service, version, provider,
 * model, feature flags, per-capability config, and recent error metadata).
 */
export function summarizeServiceHealth(
  healthz: unknown,
  diagnostics?: unknown,
): CeeServiceHealthSummary {
  const h = (healthz && typeof healthz === "object" ? (healthz as any) : {}) as any;
  const d = (diagnostics && typeof diagnostics === "object" ? (diagnostics as any) : {}) as any;

  const featureFlags: Record<string, boolean> = {};
  if (h.feature_flags && typeof h.feature_flags === "object") {
    for (const [key, value] of Object.entries(h.feature_flags as Record<string, unknown>)) {
      featureFlags[key] = value === true;
    }
  }

  const ceeConfig: Record<string, { feature_version?: string; rate_limit_rpm?: number }> = {};
  const rawCeeConfig = h.cee && typeof h.cee === "object" ? (h.cee as any).config : undefined;
  if (rawCeeConfig && typeof rawCeeConfig === "object") {
    for (const [capability, cfg] of Object.entries(rawCeeConfig as Record<string, any>)) {
      if (!cfg || typeof cfg !== "object") continue;
      const feature_version = typeof cfg.feature_version === "string" ? cfg.feature_version : undefined;
      const rpmVal = (cfg as any).rate_limit_rpm;
      const rate_limit_rpm = typeof rpmVal === "number" && Number.isFinite(rpmVal) ? rpmVal : undefined;
      ceeConfig[capability] = { feature_version, rate_limit_rpm };
    }
  }

  const recentErrors =
    d.cee && typeof d.cee === "object" && Array.isArray((d.cee as any).recent_errors)
      ? ((d.cee as any).recent_errors as any[])
      : [];

  let recent_error_counts: CeeServiceHealthSummary["recent_error_counts"];
  if (recentErrors.length > 0) {
    const by_capability: Record<string, number> = {};
    const by_status: Record<string, number> = {};
    const by_error_code: Record<string, number> = {};

    for (const err of recentErrors) {
      if (!err || typeof err !== "object") continue;
      const capability = typeof (err as any).capability === "string" ? (err as any).capability : "unknown";
      const status = typeof (err as any).status === "string" ? (err as any).status : "unknown";
      const errorCode = typeof (err as any).error_code === "string" ? (err as any).error_code : "";

      by_capability[capability] = (by_capability[capability] ?? 0) + 1;
      by_status[status] = (by_status[status] ?? 0) + 1;
      if (errorCode) {
        by_error_code[errorCode] = (by_error_code[errorCode] ?? 0) + 1;
      }
    }

    recent_error_counts = {
      total: recentErrors.length,
      by_capability,
      by_status,
      by_error_code,
    };
  }

  const ceeDiagnosticsEnabled =
    !!(h.cee && typeof h.cee === "object" && (h.cee as any).diagnostics_enabled === true);

  return {
    service: typeof h.service === "string" ? h.service : undefined,
    version: typeof h.version === "string" ? h.version : undefined,
    provider: typeof h.provider === "string" ? h.provider : undefined,
    model: typeof h.model === "string" ? h.model : undefined,
    limits_source: typeof h.limits_source === "string" ? h.limits_source : undefined,
    diagnostics_enabled: ceeDiagnosticsEnabled,
    feature_flags: featureFlags,
    cee_config: ceeConfig,
    recent_error_counts,
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
    console.error("[cee-health-snapshot] No input provided. Pass a file path or pipe JSON to stdin.");
    process.exit(1);
  }

  let envelopes: CeeJourneyEnvelopes;
  try {
    envelopes = JSON.parse(raw) as CeeJourneyEnvelopes;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[cee-health-snapshot] Failed to parse JSON:", error);
    process.exit(1);
  }

  const engineStatus = buildCeeEngineStatus(envelopes as CeeJourneyEnvelopes);
  const review = buildCeeDecisionReviewPayload(envelopes as CeeJourneyEnvelopes);
  const snapshot = summarizeReviewForSnapshot(review, engineStatus ?? null);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(snapshot, null, 2));
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("[cee-health-snapshot] Unexpected error:", error);
    process.exit(1);
  });
}
