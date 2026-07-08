/**
 * RED-first: the evidence watermark FAILS CLOSED. Placeholder prompts,
 * missing clearance, missing labels, missing R, a smoke-stub verdict source,
 * a blocked pre-flight, or simply the ABSENCE of the attestations file must
 * each force "PIPELINE SMOKE TEST — NOT EVIDENCE". There are no negative
 * flags — nothing can be switched off into an evidence report.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assessEvidence, WATERMARK, type EvidenceInputs } from "../src/report/attestations.ts";
import { buildReport } from "../src/report/report.ts";
import { DEFAULT_MODELS } from "../src/config.ts";
import type { PreflightResult, RunConfig } from "../src/types.ts";

const dir = mkdtempSync(join(tmpdir(), "bakeoff-attest-"));
const clearancePath = join(dir, "judge-clearance.json");
const labelsPath = join(dir, "labels.csv");
writeFileSync(clearancePath, "{}");
writeFileSync(labelsPath, "id,label\n");
const attestationsPath = join(dir, "attestations.json");
writeFileSync(
  attestationsPath,
  JSON.stringify({
    real_prompts: true,
    judge_clearance_path: clearancePath,
    labels_path: labelsPath,
    attested_by: "Paul",
    date: "2026-07-02",
  })
);

const passingPreflight: PreflightResult = {
  ran_at: "2026-07-02T00:00:00Z",
  key_present: true,
  sdk_version: "test",
  models: [],
  advisor_pairing_ok: true,
  advisor_error: null,
  pricing_stale: false,
  pricing_age_days: 0,
  arm_gate: {
    A: { allowed: true, reason: "ok" },
    B: { allowed: true, reason: "ok" },
    C: { allowed: true, reason: "ok" },
    D: { allowed: true, reason: "ok" },
  },
};

const config: RunConfig = {
  run_id: "attest-run",
  arms: ["A", "B", "C", "D"],
  brief_ids: ["b1"],
  seeds: [17],
  models: DEFAULT_MODELS,
  mock: false,
  results_dir: dir,
  compute_tolerance: 0.2,
};

/** The ONLY combination that opens the gate. Every test below breaks one leg. */
const allGreen: EvidenceInputs = {
  attestationsPath,
  anyPlaceholderPrompts: false,
  preflight: passingPreflight,
  config,
  verdictProvider: "cleared_proposal_quality_judge",
  anyRPending: false,
};

describe("fail-closed evidence watermark", () => {
  it("opens ONLY when every positive attestation exists", () => {
    const assessment = assessEvidence(allGreen);
    expect(assessment.reasons).toEqual([]);
    expect(assessment.watermark).toBe(false);
  });

  it("RED: absence of the attestations file forces the watermark", () => {
    const a = assessEvidence({ ...allGreen, attestationsPath: null });
    expect(a.watermark).toBe(true);
    expect(a.reasons.join(" ")).toContain("no attestations file");
  });

  it("RED: placeholder prompts force the watermark even with a valid attestations file", () => {
    const a = assessEvidence({ ...allGreen, anyPlaceholderPrompts: true });
    expect(a.watermark).toBe(true);
    expect(a.reasons.join(" ")).toContain("placeholder prompts");
  });

  it("RED: smoke-stub verdicts force the watermark", () => {
    const a = assessEvidence({ ...allGreen, verdictProvider: "deterministic_smoke_stub" });
    expect(a.watermark).toBe(true);
    expect(a.reasons.join(" ")).toContain("smoke stub");
  });

  it("RED: missing R (hard benchmark input) forces the watermark", () => {
    const a = assessEvidence({ ...allGreen, anyRPending: true });
    expect(a.watermark).toBe(true);
    expect(a.reasons.join(" ")).toContain("warranted reference set R");
  });

  it("RED: a blocked pre-flight arm or absent key forces the watermark", () => {
    const blocked = structuredClone(passingPreflight);
    blocked.arm_gate.D = { allowed: false, reason: "advisor beta unavailable" };
    expect(assessEvidence({ ...allGreen, preflight: blocked }).watermark).toBe(true);

    const noKey = structuredClone(passingPreflight);
    noKey.key_present = false;
    expect(assessEvidence({ ...allGreen, preflight: noKey }).watermark).toBe(true);
    expect(assessEvidence({ ...allGreen, preflight: null }).watermark).toBe(true);
  });

  it("RED: attestation paths that do not exist on disk force the watermark", () => {
    const badPath = join(dir, "attestations-bad.json");
    writeFileSync(
      badPath,
      JSON.stringify({
        real_prompts: true,
        judge_clearance_path: join(dir, "missing-clearance.json"),
        labels_path: labelsPath,
        attested_by: "Paul",
        date: "2026-07-02",
      })
    );
    const a = assessEvidence({ ...allGreen, attestationsPath: badPath });
    expect(a.watermark).toBe(true);
    expect(a.reasons.join(" ")).toContain("judge clearance not found");
  });

  it("RED: real_prompts:false (or any missing field) can NEVER attest — schema requires literal true", () => {
    const badPath = join(dir, "attestations-negative.json");
    writeFileSync(
      badPath,
      JSON.stringify({
        real_prompts: false,
        judge_clearance_path: clearancePath,
        labels_path: labelsPath,
        attested_by: "Paul",
        date: "2026-07-02",
      })
    );
    const a = assessEvidence({ ...allGreen, attestationsPath: badPath });
    expect(a.watermark).toBe(true);
  });

  it("mock mode always watermarks", () => {
    const a = assessEvidence({ ...allGreen, config: { ...config, mock: true } });
    expect(a.watermark).toBe(true);
  });

  it("the watermark banner appears in the rendered report when watermarked, and only then", () => {
    const base = {
      config,
      baseSha: "abc123",
      verdictProvider: "deterministic_smoke_stub",
      preflight: passingPreflight,
      pricingStaleness: { stale: false, age_days: 0 },
      rows: [],
      matchEntries: [],
      blockedArms: [],
      generatedLabel: "test",
    };
    const marked = buildReport({ ...base, evidence: { watermark: true, reasons: ["placeholder prompts"] } });
    expect(marked).toContain(WATERMARK);
    const clean = buildReport({ ...base, evidence: { watermark: false, reasons: [] } });
    expect(clean).not.toContain(WATERMARK);
  });

  it("surfaces the arm-D cost provisional gate and R-pending gate when applicable, and omits them otherwise", () => {
    const scoreRow = (arm_label: string, r_pending: boolean) => ({
      arm_label,
      brief_id: "b1",
      seed: 17,
      blind_id: "B001",
      valid: true,
      failure_stage: null,
      scoring_refused: null,
      safety_hits: [],
      fgq: null,
      r_pending,
      holistic_det: null,
      holistic_llm: null,
      merge_failures: 0,
      merge_applied: 0,
      merge_proposals_total: 0,
      cost_usd: 0.01,
      latency_ms: 100,
    });
    const base = {
      config,
      baseSha: "abc123",
      verdictProvider: "cleared_judge",
      preflight: passingPreflight,
      pricingStaleness: { stale: false, age_days: 0 },
      matchEntries: [],
      blockedArms: [],
      generatedLabel: "test",
      evidence: { watermark: false, reasons: [] },
    };

    const withD = buildReport({ ...base, rows: [scoreRow("D", false), scoreRow("B@match_d", false)] });
    expect(withD).toContain("## Provisional gates");
    expect(withD).toContain("Arm-D cost is PROVISIONAL");

    const withRPending = buildReport({ ...base, rows: [scoreRow("A", true)] });
    expect(withRPending).toContain("## Provisional gates");
    expect(withRPending).toContain("recall is `pending R`");
    expect(withRPending).not.toContain("Arm-D cost is PROVISIONAL");

    const cleanRun = buildReport({ ...base, rows: [scoreRow("A", false), scoreRow("C", false)] });
    expect(cleanRun).not.toContain("## Provisional gates");
  });
});
