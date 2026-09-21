/**
 * Parametric Edge Stability Benchmark (1A)
 *
 * Measures LLM coefficient elicitation stability across seed-varied runs
 * of gold briefs. Not part of the standard test suite — run with:
 *
 *   pnpm benchmark:stability           # on-demand (3 × 3)
 *   pnpm benchmark:stability:nightly   # nightly (all × 5)
 *
 * Nightly mode: all 12 briefs × 5 seeds, hard-fail on threshold breach
 * On-demand mode: 3 briefs × 3 seeds, warn only
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runBenchmark, getNightlyConfig, getOnDemandConfig } from "./runner.js";
import type { BenchmarkReport } from "./report-types.js";
import { ALERT_THRESHOLDS } from "./report-types.js";

// Use fixtures provider for fast deterministic testing
// For real LLM benchmarks, set LLM_PROVIDER to "anthropic" or "openai"
if (!process.env.LLM_PROVIDER) {
  vi.stubEnv("LLM_PROVIDER", "fixtures");
}

// Mock external validation service
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

const REPORT_DIR = join(import.meta.dirname, "reports");

function writeReport(report: BenchmarkReport, suffix: string): string {
  mkdirSync(REPORT_DIR, { recursive: true });
  const filename = `stability-${report.metadata.mode}-${suffix}.json`;
  const filepath = join(REPORT_DIR, filename);
  writeFileSync(filepath, JSON.stringify(report, null, 2), "utf-8");
  return filepath;
}

describe("Parametric Edge Stability Benchmark", () => {
  const isNightly = process.env.BENCHMARK_MODE === "nightly";
  const config = isNightly ? getNightlyConfig() : getOnDemandConfig();

  let report: BenchmarkReport;

  beforeAll(async () => {
    report = await runBenchmark(config);

    // Write JSON report for CI archival
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filepath = writeReport(report, timestamp);
    console.log(`\nReport written to: ${filepath}`);
  }, 300_000); // 5 min timeout for LLM-based runs

  it("produces a valid report with reproducibility metadata", () => {
    expect(report.metadata.gold_set_version).toBeGreaterThan(0);
    expect(report.metadata.cee_commit_hash).toBeDefined();
    expect(report.metadata.seed_sequence.length).toBeGreaterThan(0);
    expect(report.metadata.timestamp).toBeDefined();
    expect(report.metadata.mode).toBe(config.mode);
  });

  it("runs all expected briefs", () => {
    const expectedCount = config.brief_ids
      ? config.brief_ids.length
      : 12; // all gold briefs
    // On-demand allows partial; nightly completeness is enforced in CI block below
    expect(report.brief_reports.length).toBeGreaterThanOrEqual(1);
    expect(report.brief_reports.length).toBeLessThanOrEqual(expectedCount);
  });

  it("tracks dropped briefs explicitly", () => {
    expect(Array.isArray(report.dropped_brief_ids)).toBe(true);
    // Total = reported + dropped should equal expected
    const expectedCount = config.brief_ids
      ? config.brief_ids.length
      : 12;
    expect(report.brief_reports.length + report.dropped_brief_ids.length).toBe(expectedCount);
  });

  it("records run completion metadata per brief", () => {
    for (const br of report.brief_reports) {
      expect(br.completed_runs).toBeGreaterThanOrEqual(2);
      expect(br.expected_runs).toBe(config.runs_per_brief);
      expect(br.completed_runs).toBeLessThanOrEqual(br.expected_runs);
    }
  });

  it("computes structural stability for each brief", () => {
    for (const br of report.brief_reports) {
      expect(br.stability.structural_stability).toBeGreaterThanOrEqual(0);
      expect(br.stability.structural_stability).toBeLessThanOrEqual(1);
    }
  });

  it("reports node set stability for each brief", () => {
    for (const br of report.brief_reports) {
      expect(typeof br.stability.node_set_stable).toBe("boolean");
    }
  });

  it("reports option set stability for each brief", () => {
    for (const br of report.brief_reports) {
      expect(typeof br.aggregate.option_set_stability.count_stable).toBe("boolean");
      expect(br.aggregate.option_set_stability.counts.length).toBeGreaterThan(0);
    }
  });

  it("includes ISL stub placeholder in report JSON", () => {
    for (const br of report.brief_reports) {
      // isl_outcome_stability should be null (not absent) in serialized JSON
      expect(br.aggregate).toHaveProperty("isl_outcome_stability");
      expect(br.aggregate.isl_outcome_stability).toBeNull();
    }
  });

  it("flags briefs exceeding alert thresholds", () => {
    for (const br of report.brief_reports) {
      // Verify alert logic is consistent
      if (br.stability.structural_stability < ALERT_THRESHOLDS.structural_stability) {
        expect(br.alerts.low_structural_stability).toBe(true);
      }
      if (br.stability.high_cv_edges.length > 0) {
        expect(br.alerts.high_cv_edges).toBe(true);
      }
    }
  });

  it("computes per-edge metrics for always-present edges", () => {
    for (const br of report.brief_reports) {
      for (const apm of br.stability.always_present) {
        // Every always-present edge should have stats
        expect(apm.strength_mean.values.length).toBeGreaterThan(0);
        expect(apm.strength_std.values.length).toBeGreaterThan(0);
        expect(apm.belief_exists.values.length).toBeGreaterThan(0);
        // CV should be non-negative
        expect(apm.strength_mean.cv).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("computes intermittent edge presence rates", () => {
    for (const br of report.brief_reports) {
      for (const ie of br.stability.intermittent) {
        expect(ie.presence_rate).toBeGreaterThan(0);
        expect(ie.presence_rate).toBeLessThan(1);
        expect(ie.present_count).toBeLessThan(ie.total_runs);
      }
    }
  });

  it("produces a valid summary", () => {
    expect(report.summary.total_briefs).toBe(report.brief_reports.length);
    expect(report.summary.average_structural_stability).toBeGreaterThanOrEqual(0);
    expect(report.summary.average_structural_stability).toBeLessThanOrEqual(1);
  });

  // ── CI Threshold Enforcement (Fix #1) ────────────────────────────────
  // Nightly: hard-fail if any threshold breached
  // On-demand: this test is skipped (warnings only, no hard fail)

  const describeCIEnforce = isNightly ? describe : describe.skip;

  describeCIEnforce("CI threshold enforcement (nightly only)", () => {
    it("no briefs were dropped (all expected briefs produced reports)", () => {
      expect(report.dropped_brief_ids).toEqual([]);
    });

    it("no brief has structural stability below 80%", () => {
      const failing = report.brief_reports.filter(
        (br) => br.stability.structural_stability < ALERT_THRESHOLDS.structural_stability,
      );
      expect(failing.map((b) => b.brief_id)).toEqual([]);
    });

    it("no brief has always-present edges with CV > 0.5", () => {
      const failing = report.brief_reports.filter(
        (br) => br.stability.high_cv_edges.length > 0,
      );
      expect(failing.map((b) => b.brief_id)).toEqual([]);
    });

    it("no brief has option set changes across runs", () => {
      const failing = report.brief_reports.filter(
        (br) => br.alerts.option_set_changes,
      );
      expect(failing.map((b) => b.brief_id)).toEqual([]);
    });

    it("all briefs completed all seeds", () => {
      for (const br of report.brief_reports) {
        expect(br.completed_runs).toBe(br.expected_runs);
      }
    });
  });

  // Sensitivity tests only in nightly mode
  if (isNightly) {
    it("runs prompt sensitivity analysis", () => {
      expect(report.sensitivity_reports.length).toBeGreaterThan(0);
      for (const sr of report.sensitivity_reports) {
        expect(sr.comparisons.length).toBeGreaterThan(0);
        for (const c of sr.comparisons) {
          expect(["synonym_swap", "clause_reorder", "passive_voice"]).toContain(c.transformation);
          expect(typeof c.option_count_changed).toBe("boolean");
          expect(typeof c.node_set_changed).toBe("boolean");
          expect(typeof c.perturbation_exceeds_seed).toBe("boolean");
        }
      }
    });
  }
});
