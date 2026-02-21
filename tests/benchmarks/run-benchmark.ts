#!/usr/bin/env tsx
/**
 * CLI entry point for parametric edge stability benchmark.
 *
 * Usage:
 *   pnpm benchmark:stability           # On-demand: 3 briefs × 3 seeds
 *   pnpm benchmark:stability:nightly   # Nightly: all briefs × 5 seeds
 *
 * Environment:
 *   LLM_PROVIDER=fixtures    (default — fast, deterministic)
 *   LLM_PROVIDER=anthropic   (real LLM — requires ANTHROPIC_API_KEY)
 *   BENCHMARK_MODE=nightly   (override mode)
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, getNightlyConfig, getOnDemandConfig } from "./runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = join(__dirname, "reports");

async function main() {
  const isNightly =
    process.argv.includes("--nightly") || process.env.BENCHMARK_MODE === "nightly";

  const config = isNightly ? getNightlyConfig() : getOnDemandConfig();

  // Set fixtures as default provider if none specified
  if (!process.env.LLM_PROVIDER) {
    process.env.LLM_PROVIDER = "fixtures";
  }

  const report = await runBenchmark(config);

  // Write report
  mkdirSync(REPORT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `stability-${config.mode}-${timestamp}.json`;
  const filepath = join(REPORT_DIR, filename);
  writeFileSync(filepath, JSON.stringify(report, null, 2), "utf-8");

  console.log(`\nReport: ${filepath}`);

  // Exit with error if any alerts triggered
  if (report.summary.briefs_with_alerts > 0) {
    console.error(
      `\n${report.summary.briefs_with_alerts}/${report.summary.total_briefs} briefs triggered alerts.`,
    );
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(2);
});
