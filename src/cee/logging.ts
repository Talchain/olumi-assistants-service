import { log } from "../utils/telemetry.js";

export type CeeOutcomeStatus = "ok" | "degraded" | "timeout" | "limited" | "error";

export interface CeeCallLogEntry {
  request_id: string;
  capability: string;
  provider?: string;
  model?: string;
  latency_ms?: number;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  status: CeeOutcomeStatus;
  error_code?: string;
  http_status?: number;
  any_truncated?: boolean;
  has_validation_issues?: boolean;
  timestamp: string;
}

const MAX_CEE_LOG_ENTRIES = 100;

const ceeCallLogRing: CeeCallLogEntry[] = [];

function pushToRing(entry: CeeCallLogEntry): void {
  ceeCallLogRing.push(entry);
  if (ceeCallLogRing.length > MAX_CEE_LOG_ENTRIES) {
    ceeCallLogRing.shift();
  }
}

export interface CeeCallLogOptions {
  requestId: string;
  capability: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  status: CeeOutcomeStatus;
  errorCode?: string;
  httpStatus?: number;
  anyTruncated?: boolean;
  hasValidationIssues?: boolean;
}

export function logCeeCall(opts: CeeCallLogOptions): void {
  const entry: CeeCallLogEntry = {
    request_id: opts.requestId,
    capability: opts.capability,
    provider: opts.provider ?? "unknown",
    model: opts.model ?? "unknown",
    latency_ms: opts.latencyMs,
    tokens_in: opts.tokensIn,
    tokens_out: opts.tokensOut,
    cost_usd: opts.costUsd,
    status: opts.status,
    error_code: opts.errorCode,
    http_status: opts.httpStatus,
    any_truncated: opts.anyTruncated,
    has_validation_issues: opts.hasValidationIssues,
    timestamp: new Date().toISOString(),
  };

  // Persist in ring buffer for diagnostics (errors and non-ok outcomes only)
  if (entry.status !== "ok") {
    pushToRing(entry);
  }

  // Emit structured log line. Message kept stable for log routing.
  log.info({ event: "cee.call", ...entry });
}

export function getRecentCeeErrors(limit = 20): CeeCallLogEntry[] {
  if (ceeCallLogRing.length <= limit) return ceeCallLogRing.slice();
  return ceeCallLogRing.slice(ceeCallLogRing.length - limit);
}

export function getRecentCeeCalls(limit = 50): CeeCallLogEntry[] {
  if (ceeCallLogRing.length <= limit) return ceeCallLogRing.slice();
  return ceeCallLogRing.slice(ceeCallLogRing.length - limit);
}
