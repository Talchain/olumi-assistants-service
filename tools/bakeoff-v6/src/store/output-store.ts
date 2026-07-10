/**
 * Output store: results/{run_id}/ with one file per candidate.
 *
 * Every candidate persists arm, seed, prompt hashes, model IDs, timestamps,
 * usage, cost and latency. The canonical hash is computed over the record
 * WITHOUT the timing subtree, so deterministic paths can be proven
 * byte-identical across runs while wall-clock provenance is still recorded.
 * No API keys or user data ever enter a record (keys never leave env; the
 * only user-adjacent text is the fixture brief).
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex, stableStringify } from "../util/stable.ts";
import type { CandidateRecord } from "../types.ts";
import type { PresentationEntry } from "../scoring/blind.ts";

export function canonicalForm(record: CandidateRecord): Record<string, unknown> {
  const { timing: _timing, canonical_hash: _hash, ...rest } = record;
  return rest as unknown as Record<string, unknown>;
}

export function computeCanonicalHash(record: CandidateRecord): string {
  return sha256Hex(stableStringify(canonicalForm(record)));
}

export function candidateFileName(record: Pick<CandidateRecord, "arm" | "brief_id" | "seed"> & { variant?: string | null }): string {
  const variant = record.variant ? `_${record.variant}` : "";
  return `${record.arm}${variant}_${record.brief_id}_s${record.seed}.json`;
}

export class RunStore {
  readonly runDir: string;
  readonly candidatesDir: string;

  constructor(resultsDir: string, runId: string) {
    this.runDir = join(resultsDir, runId);
    this.candidatesDir = join(this.runDir, "candidates");
    mkdirSync(this.candidatesDir, { recursive: true });
    this.clearStaleCandidates();
  }

  /**
   * A rerun that reuses a run id (explicit --run-id) must not INHERIT the prior attempt's
   * candidate files. writeCandidate overwrites by exact {arm}{variant}_{brief}_s{seed}.json, so a
   * brief/seed that drops out of the new run (fewer briefs, a failed draw, a changed seed set) would
   * otherwise leave a STALE .json behind — and freeze-m1.mjs readdir's this dir and would freeze that
   * stale graph. The store is constructed once, before any candidate of THIS run is written, so
   * clearing here only removes prior-attempt debris, never a live result. Only *.json is touched.
   */
  private clearStaleCandidates(): void {
    let cleared = 0;
    for (const f of readdirSync(this.candidatesDir)) {
      if (f.endsWith(".json")) {
        rmSync(join(this.candidatesDir, f));
        cleared++;
      }
    }
    if (cleared > 0) {
      console.warn(`RunStore: cleared ${cleared} stale candidate file(s) from a prior run reusing this run id`);
    }
  }

  writeJson(name: string, value: unknown): string {
    const path = join(this.runDir, name);
    writeFileSync(path, stableStringify(value) + "\n", "utf-8");
    return path;
  }

  writeCandidate(record: CandidateRecord, variant: string | null): string {
    const path = join(this.candidatesDir, candidateFileName({ ...record, variant }));
    writeFileSync(path, stableStringify(record) + "\n", "utf-8");
    return path;
  }

  /**
   * SEALED: maps blind ids back to arms. Never read by any scoring path;
   * excluded from the report until an explicit unblind step.
   */
  writePresentationMap(entries: PresentationEntry[]): string {
    return this.writeJson("presentation_map.SEALED.json", {
      SEALED:
        "blind_id <-> arm mapping. Do NOT open during labelling/judging. Scoring code never reads this file.",
      entries,
    });
  }

  writeReport(markdown: string): string {
    const path = join(this.runDir, "report.md");
    writeFileSync(path, markdown, "utf-8");
    return path;
  }
}
