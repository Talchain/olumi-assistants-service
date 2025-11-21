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
