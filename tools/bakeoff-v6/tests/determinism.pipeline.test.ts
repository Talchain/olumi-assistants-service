/**
 * End-to-end determinism on the deterministic paths: two full mock-mode
 * pipeline runs over the same fixture + seed produce identical stored
 * candidates (canonical, timing-free form), identical blind maps, identical
 * scores and identical merge accounting. Also proves: the mock run exercises
 * validation counting, arm-C failure recording, D iterations cost, and the
 * forced smoke watermark.
 */
import { readdirSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runPipeline } from "../src/cli/pipeline.ts";
import { WATERMARK } from "../src/report/attestations.ts";

const resultsDir = mkdtempSync(join(tmpdir(), "bakeoff-determinism-"));

async function runOnce(runId: string) {
  return runPipeline({
    runId,
    mock: true,
    arms: ["A", "B", "C", "D"],
    briefFilter: ["buy-vs-build"],
    seeds: [17],
    resultsDir,
    attestationsPath: null,
    runSeed: 20260702,
    holisticLlm: false,
    preflightOnly: false,
    promptSet: null,
  });
}

function candidateHashes(runDir: string): Record<string, string> {
  const dir = join(runDir, "candidates");
  const out: Record<string, string> = {};
  for (const file of readdirSync(dir).sort()) {
    const record = JSON.parse(readFileSync(join(dir, file), "utf-8")) as { canonical_hash: string };
    out[file] = record.canonical_hash;
  }
  return out;
}

describe("pipeline determinism (mock mode)", () => {
  it("same fixture + seed => identical canonical candidates, scores and blind map", async () => {
    const run1 = await runOnce("det-1");
    const run2 = await runOnce("det-2");

    // A=1, B@match_c=1, B@match_d=1, C=1, D=1 per brief×seed
    expect(run1.rows).toBe(5);
    expect(run1.watermark).toBe(true);

    const hashes1 = candidateHashes(run1.runDir);
    const hashes2 = candidateHashes(run2.runDir);
    expect(Object.keys(hashes1)).toHaveLength(5);
    // run_id differs between the two runs, so exclude it from the comparison
    // by comparing per-file hashes computed on records whose run_id differs —
    // the canonical hash INCLUDES run_id, so instead compare full canonical
    // forms minus run_id:
    const canon = (runDir: string) => {
      const dir = join(runDir, "candidates");
      return readdirSync(dir)
        .sort()
        .map((file) => {
          const record = JSON.parse(readFileSync(join(dir, file), "utf-8")) as Record<string, unknown>;
          delete record.run_id;
          delete record.timing;
          delete record.canonical_hash;
          return [file, JSON.stringify(record)] as const;
        });
    };
    expect(canon(run1.runDir)).toEqual(canon(run2.runDir));

    const scores = (runDir: string) => {
      const parsed = JSON.parse(readFileSync(join(runDir, "scores.json"), "utf-8")) as { rows: unknown[] };
      return JSON.stringify(parsed.rows);
    };
    expect(scores(run1.runDir)).toBe(scores(run2.runDir));

    const map = (runDir: string) => readFileSync(join(runDir, "presentation_map.SEALED.json"), "utf-8");
    expect(map(run1.runDir)).toBe(map(run2.runDir));
  });

  it("mock run records arm-C merge failure accounting and D iterations cost, and forces the watermark", async () => {
    const run = await runOnce("det-3");
    const dir = join(run.runDir, "candidates");
    const files = readdirSync(dir);

    const cFile = files.find((f) => f.startsWith("C_"))!;
    const cRecord = JSON.parse(readFileSync(join(dir, cFile), "utf-8")) as {
      arm_c: { merge: { proposals_total: number; applied: number; failures: unknown[] } };
      artifacts: unknown[];
    };
    // Mock M2 emits 3 proposals: 1 valid, 1 artifact, 1 deliberately invalid.
    expect(cRecord.arm_c.merge.proposals_total).toBe(3);
    expect(cRecord.arm_c.merge.applied).toBe(1);
    expect(cRecord.arm_c.merge.failures).toHaveLength(1);
    expect(cRecord.artifacts).toHaveLength(1);

    const dFile = files.find((f) => f.startsWith("D_"))!;
    const dRecord = JSON.parse(readFileSync(join(dir, dFile), "utf-8")) as {
      calls: Array<{ cost_from_iterations: boolean; iterations: unknown[] }>;
    };
    expect(dRecord.calls[0].cost_from_iterations).toBe(true);
    expect(dRecord.calls[0].iterations).toHaveLength(2);

    const report = readFileSync(join(run.runDir, "report.md"), "utf-8");
    expect(report).toContain(WATERMARK);
    expect(report).toContain("Equal-compute audit");
    expect(report).toContain("pending R");
  });
});
