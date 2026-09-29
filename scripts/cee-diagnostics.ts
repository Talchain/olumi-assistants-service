/**
 * CEE diagnostics CLI (ops-focused)
 *
 * Fetches `/healthz` and (optionally) `/diagnostics` from a running
 * assistants service and prints a compact, metadata-only summary using the
 * existing `summarizeServiceHealth` helper.
 *
 * Usage (from repo root):
 *
 *   # Basic usage against local dev
 *   pnpm tsx scripts/cee-diagnostics.ts
 *
 *   # Against a remote deployment with auth
 *   ASSIST_BASE_URL=https://olumi-assistants-service.onrender.com \
 *   ASSIST_API_KEY=xxx \
 *   pnpm tsx scripts/cee-diagnostics.ts
 *
 *   # Same, but also emit JSON summary for scripting
 *   ASSIST_BASE_URL=... ASSIST_API_KEY=... pnpm tsx scripts/cee-diagnostics.ts --json
 *
 * Env vars:
 *   - ASSIST_BASE_URL      (preferred)
 *   - ASSISTANTS_BASE_URL  (backwards-compatible, used by other scripts)
 *   - ASSIST_API_KEY       (optional; used for /diagnostics auth if set)
 *   - CEE_DIAGNOSTICS_ERROR_THRESHOLD (optional; default: 20 total recent errors)
 */

import { env } from "node:process";

import {
  summarizeServiceHealth,
  type CeeServiceHealthSummary,
} from "./cee-health-snapshot.js";

interface CliOptions {
  /** When true, also print the raw JSON summary from summarizeServiceHealth. */
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json" || arg === "-j") {
      json = true;
    }
  }

  return { json };
}

export function formatCeeServiceHealthPretty(summary: CeeServiceHealthSummary): string {
  const lines: string[] = [];

  const service = summary.service ?? "unknown";
  const version = summary.version ?? "unknown";
  const provider = summary.provider ?? "unknown";
  const model = summary.model ?? "unknown";
  const limitsSource = summary.limits_source ?? "unknown";

  lines.push("CEE Service Health");
  lines.push("==================");
  lines.push("");
  lines.push(`Service: ${service}`);
  lines.push(`Version: ${version}`);
  lines.push(`Provider: ${provider}`);
  lines.push(`Model: ${model}`);
  lines.push(`Limits source: ${limitsSource}`);
  lines.push("");

  lines.push("Diagnostics");
  lines.push("-----------");
  lines.push(`Diagnostics enabled: ${summary.diagnostics_enabled ? "true" : "false"}`);
  lines.push("");

  lines.push("CEE capabilities");
  lines.push("----------------");
  const entries = Object.entries(summary.cee_config);
  if (entries.length === 0) {
    lines.push("(no CEE config reported)");
  } else {
    for (const [capability, cfg] of entries) {
      const fv = cfg.feature_version ?? "-";
      const rpm = typeof cfg.rate_limit_rpm === "number" ? String(cfg.rate_limit_rpm) : "-";
      lines.push(`- ${capability}: version=${fv}, rpm=${rpm}`);
    }
  }
  lines.push("");

  lines.push("Recent errors");
  lines.push("------------");
  const counts = summary.recent_error_counts;
  if (!counts || counts.total === 0) {
    lines.push("(no recent non-OK CEE calls in diagnostics ring)");
  } else {
    lines.push(`total: ${counts.total}`);

    const byCapabilityEntries = Object.entries(counts.by_capability);
    if (byCapabilityEntries.length > 0) {
      lines.push("by capability:");
      for (const [cap, count] of byCapabilityEntries) {
        lines.push(`  - ${cap}: ${count}`);
      }
    }

    const byStatusEntries = Object.entries(counts.by_status);
    if (byStatusEntries.length > 0) {
      lines.push("by status:");
      for (const [status, count] of byStatusEntries) {
        lines.push(`  - ${status}: ${count}`);
      }
    }

    const byCodeEntries = Object.entries(counts.by_error_code);
    if (byCodeEntries.length > 0) {
      lines.push("by error_code:");
      for (const [code, count] of byCodeEntries) {
        lines.push(`  - ${code}: ${count}`);
      }
    }
  }

  return lines.join("\n");
}

export function shouldExitNonZeroForSummary(
  summary: CeeServiceHealthSummary,
  opts?: { errorThreshold?: number },
): boolean {
  const counts = summary.recent_error_counts;
  if (!counts) return false;

  const total = counts.total ?? 0;
  const thresholdEnv = env.CEE_DIAGNOSTICS_ERROR_THRESHOLD;
  const thresholdFromEnv = thresholdEnv ? Number(thresholdEnv) : undefined;
  const threshold =
    typeof opts?.errorThreshold === "number" && Number.isFinite(opts.errorThreshold)
      ? opts.errorThreshold
      : typeof thresholdFromEnv === "number" && Number.isFinite(thresholdFromEnv)
        ? thresholdFromEnv
        : 20;

  return total >= threshold;
}

interface FetchResultOk {
  ok: true;
  status: number;
  json: unknown;
}

interface FetchResultErr {
  ok: false;
  status: number;
  message: string;
}

type FetchResult = FetchResultOk | FetchResultErr;

async function fetchJson(url: string, apiKey?: string): Promise<FetchResult> {
  const controller = new AbortController();
  const rawTimeout = env.CEE_DIAGNOSTICS_FETCH_TIMEOUT_MS;
  const parsedTimeout = rawTimeout ? Number(rawTimeout) : NaN;
  const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 10000;
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (apiKey) {
      headers["X-Olumi-Assist-Key"] = apiKey;
    }

    const res = await fetch(url, { headers, signal: controller.signal });
    const text = await res.text();

    let json: unknown = undefined;
    if (text && text.trim().length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        // Keep json as undefined; we will treat this as an error below if needed.
      }
    }

    if (!res.ok) {
      const message =
        json && typeof json === "object" && (json as any).message
          ? String((json as any).message)
          : res.statusText || "Request failed";
      return { ok: false, status: res.status, message };
    }

    if (json === undefined) {
      return { ok: false, status: res.status, message: "Empty or non-JSON response body" };
    }

    return { ok: true, status: res.status, json };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === "AbortError"
          ? `Request timed out after ${timeoutMs}ms`
          : error.message
        : String(error);
    return {
      ok: false,
      status: 0,
      message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const baseUrl =
    env.ASSIST_BASE_URL ||
    env.ASSISTANTS_BASE_URL ||
    "http://localhost:3101";
  const apiKey = env.ASSIST_API_KEY;

  // eslint-disable-next-line no-console
  console.error(`[cee-diagnostics] Target: ${baseUrl}`);

  const healthUrl = `${baseUrl.replace(/\/$/, "")}/healthz`;
  const diagnosticsUrl = `${baseUrl.replace(/\/$/, "")}/diagnostics`;

  let exitCode = 0;

  const healthResult = await fetchJson(healthUrl, apiKey);
  if (!healthResult.ok) {
    // eslint-disable-next-line no-console
    console.error(
      `[cee-diagnostics] Failed to fetch /healthz (status=${healthResult.status}): ${healthResult.message}`,
    );
    process.exit(1);
    return;
  }

  const healthz = healthResult.json as any;
  const healthOkField = typeof healthz?.ok === "boolean" ? healthz.ok : undefined;

  let diagnosticsJson: unknown | undefined;
  const diagnosticsResult = await fetchJson(diagnosticsUrl, apiKey);
  if (diagnosticsResult.ok) {
    diagnosticsJson = diagnosticsResult.json;
  } else if (diagnosticsResult.status === 404) {
    // eslint-disable-next-line no-console
    console.error(
      "[cee-diagnostics] /diagnostics not available (404). This is expected when CEE_DIAGNOSTICS_ENABLED is false.",
    );
  } else if (diagnosticsResult.status === 403) {
    // eslint-disable-next-line no-console
    console.error(
      "[cee-diagnostics] /diagnostics returned 403 FORBIDDEN. Check CEE_DIAGNOSTICS_KEY_IDS and ASSIST_API_KEY.",
    );
    exitCode = exitCode || 2;
  } else if (diagnosticsResult.status !== 0) {
    // eslint-disable-next-line no-console
    console.error(
      `[cee-diagnostics] /diagnostics returned ${diagnosticsResult.status}: ${diagnosticsResult.message}`,
    );
    exitCode = exitCode || 2;
  } else {
    // Network or unexpected error
    // eslint-disable-next-line no-console
    console.error(
      `[cee-diagnostics] Failed to call /diagnostics: ${diagnosticsResult.message}`,
    );
    exitCode = exitCode || 2;
  }

  const summary = summarizeServiceHealth(healthz, diagnosticsJson);

  const pretty = formatCeeServiceHealthPretty(summary);
  // eslint-disable-next-line no-console
  console.log(pretty);

  if (options.json) {
    // eslint-disable-next-line no-console
    console.log("\n--- raw summarizeServiceHealth JSON ---\n");
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));
  }

  if (healthOkField === false) {
    exitCode = exitCode || 3;
  }

  if (shouldExitNonZeroForSummary(summary) && exitCode === 0) {
    exitCode = 4;
  }

  process.exit(exitCode);
}

if (typeof require !== "undefined" && require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("[cee-diagnostics] Unexpected error:", error);
    process.exit(1);
  });
}
