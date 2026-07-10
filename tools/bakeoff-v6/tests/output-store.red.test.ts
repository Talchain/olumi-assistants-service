/**
 * RED-first: a rerun that reuses a run id must NOT inherit the prior attempt's stale candidate
 * files. Without the clear, a brief/seed that drops out of the new run leaves a stale .json that
 * freeze-m1.mjs would readdir and freeze as if fresh — silently corrupting the rerun.
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunStore } from "../src/store/output-store.ts";

describe("RunStore stale-candidate clearing", () => {
  it("clears prior-attempt candidate files when a run id is reused", () => {
    const resultsDir = mkdtempSync(join(tmpdir(), "bakeoff-store-"));
    // First attempt leaves a candidate behind.
    const first = new RunStore(resultsDir, "r1");
    writeFileSync(join(first.candidatesDir, "A_expand-vs-focus_s7.json"), "{}\n");
    expect(existsSync(join(first.candidatesDir, "A_expand-vs-focus_s7.json"))).toBe(true);

    // Reusing the same run id (e.g. the brief dropped out of the new run) must start clean.
    const second = new RunStore(resultsDir, "r1");
    expect(existsSync(join(second.candidatesDir, "A_expand-vs-focus_s7.json"))).toBe(false);
    expect(readdirSync(second.candidatesDir).filter((f) => f.endsWith(".json"))).toHaveLength(0);
  });

  it("does not touch candidates of the CURRENT run (clear only runs at construction)", () => {
    const resultsDir = mkdtempSync(join(tmpdir(), "bakeoff-store-"));
    const store = new RunStore(resultsDir, "r2");
    writeFileSync(join(store.candidatesDir, "A_hire_s7.json"), "{}\n");
    // No new RunStore is constructed, so the live candidate survives.
    expect(existsSync(join(store.candidatesDir, "A_hire_s7.json"))).toBe(true);
  });
});
