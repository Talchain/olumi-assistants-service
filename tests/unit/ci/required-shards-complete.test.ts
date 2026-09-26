/**
 * The SPLIT required gate (ci.yml Job A): `required-static` + `required-tests`
 * shards, verdict decided by the `Lint, TypeCheck, Unit Tests` job.
 *
 * Splitting the gate adds a failure mode the single runner did not have: tests
 * can silently NOT RUN while every surviving shard reports green. This spec
 * proves the two halves that close it:
 *
 *   1. THE COMPLETENESS GUARD DISCRIMINATES. scripts/ci/assert-required-shards-
 *      complete.mjs is fed synthetic shard reports — the green case AND every
 *      way a sharded run can be incomplete or red — and must pass exactly the
 *      first. A guard shown only passing is indistinguishable from `exit 0`.
 *
 *   2. THE WIRING CANNOT BE LOOSENED QUIETLY. Every fact below is DERIVED from
 *      the workflow files; there is no second copy to drift. It pins the things
 *      whose loss would turn the gate into theatre: the context name and its
 *      uniqueness (branch protection and the estate's premerge guard match it,
 *      one instance per head), the `!cancelled()` condition (a skipped required
 *      check reads as passing), the matrix/`--shards` agreement, and that no
 *      provider credential reaches the required path.
 *
 * Fixtures live in the OS temp dir; nothing here writes inside the repo.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";

import {
  parseExpectedList,
  readShardReports,
  toRepoPath,
  verifyShardReports,
} from "../../../scripts/ci/assert-required-shards-complete.mjs";

const REPO_ROOT = resolve(__dirname, "../../..");
const SCRIPT = join(REPO_ROOT, "scripts/ci/assert-required-shards-complete.mjs");
const CONTEXT = "Lint, TypeCheck, Unit Tests";

// ── Synthetic vitest JSON reports ───────────────────────────────────────────
const ROOT = "/work/repo";
const abs = (p: string) => `${ROOT}/${p}`;

function report(files: string[], opts: { failed?: string[]; success?: boolean } = {}) {
  const failed = new Set(opts.failed ?? []);
  return {
    success: opts.success ?? failed.size === 0,
    numTotalTests: files.length * 2,
    numPassedTests: files.length * 2 - failed.size,
    numFailedTests: failed.size,
    numPendingTests: 0,
    numTodoTests: 0,
    numFailedTestSuites: failed.size,
    testResults: files.map((f) => ({ name: abs(f), status: failed.has(f) ? "failed" : "passed", assertionResults: [] })),
  };
}

const EXPECTED = ["a.test.ts", "b.test.ts", "c.test.ts", "d.test.ts", "e.test.ts"];
const greenReports = () =>
  new Map<number, unknown>([
    [1, report(["a.test.ts", "b.test.ts"])],
    [2, report(["c.test.ts", "d.test.ts"])],
    [3, report(["e.test.ts"])],
  ]);
const verify = (reports: Map<number, unknown>, expected = EXPECTED, shardTotal = 3) =>
  verifyShardReports({ expectedFiles: expected.map(abs), reports, shardTotal, root: ROOT });

describe("completeness guard: passes exactly the complete, green run", () => {
  it("PASSES when every expected file ran in exactly one shard and every shard is green", () => {
    const v = verify(greenReports());
    expect(v.errors).toEqual([]);
    expect(v.expectedCount).toBe(5);
    expect(v.observedCount).toBe(5);
    expect(v.totals.files).toBe(5);
  });

  it("REDs when a shard's report is missing (that shard cannot be shown to have run)", () => {
    const r = greenReports();
    r.delete(3);
    expect(verify(r).errors.join("\n")).toMatch(/shard 3\/3: NO REPORT/);
  });

  it("REDs when a shard's report is unreadable", () => {
    const r = greenReports();
    r.set(2, new Error("shard-2.json: Unexpected end of JSON input"));
    expect(verify(r).errors.join("\n")).toMatch(/shard 2\/3: report unreadable/);
  });

  it("REDs when a shard is not successful, even with no failed file listed", () => {
    const r = greenReports();
    r.set(1, report(["a.test.ts", "b.test.ts"], { success: false }));
    expect(verify(r).errors.join("\n")).toMatch(/shard 1\/3: NOT GREEN/);
  });

  it("REDs when a shard has a failed file (e.g. an import failure: zero tests, status failed)", () => {
    const r = greenReports();
    r.set(2, report(["c.test.ts", "d.test.ts"], { failed: ["d.test.ts"] }));
    const errors = verify(r).errors.join("\n");
    expect(errors).toMatch(/shard 2\/3: NOT GREEN/);
    expect(errors).toContain("d.test.ts");
  });

  it("REDs when every shard is green but an expected file ran in NO shard (matrix narrower than --shard)", () => {
    const r = greenReports();
    r.set(3, report(["e.test.ts"]));
    const errors = verify(r, [...EXPECTED, "never-ran.test.ts"]).errors.join("\n");
    expect(errors).toMatch(/1 of 6 required test file\(s\) ran in NO shard/);
    expect(errors).toContain("never-ran.test.ts");
  });

  it("REDs when a file ran in two shards (population double-counted)", () => {
    const r = greenReports();
    r.set(3, report(["e.test.ts", "a.test.ts"]));
    expect(verify(r).errors.join("\n")).toMatch(/a\.test\.ts \(shards 1, 3\)/);
  });

  it("REDs when a shard reports a file the expected population does not contain", () => {
    const r = greenReports();
    r.set(3, report(["e.test.ts", "stray.test.ts"]));
    expect(verify(r).errors.join("\n")).toMatch(/not in the expected population[\s\S]*stray\.test\.ts/);
  });

  it("REDs on a report for a shard outside 1..N", () => {
    const r = greenReports();
    r.set(4, report(["e.test.ts"]));
    expect(verify(r).errors.join("\n")).toMatch(/unexpected report for shard 4: the matrix is 1\.\.3/);
  });

  it("is BLINDED, not green, when the expected population is empty", () => {
    expect(verify(greenReports(), []).errors.join("\n")).toMatch(/BLINDED: the expected required-test population is EMPTY/);
  });

  it("is BLINDED, not green, when a shard reports zero files", () => {
    const r = greenReports();
    r.set(3, report([]));
    expect(verify(r).errors.join("\n")).toMatch(/shard 3\/3: BLINDED/);
  });

  it("REDs when a reported path lies outside the workspace", () => {
    const r = greenReports();
    const bad = report(["e.test.ts"]);
    bad.testResults[0].name = "/elsewhere/e.test.ts";
    r.set(3, bad);
    expect(verify(r).errors.join("\n")).toMatch(/outside \/work\/repo/);
  });

  it("rejects a non-positive shard total", () => {
    expect(verify(greenReports(), EXPECTED, 0).errors.join("\n")).toMatch(/positive integer/);
  });

  it("reads the `vitest list --filesOnly --json` shape and normalises paths", () => {
    expect(parseExpectedList(JSON.stringify([{ file: abs("a.test.ts") }, { file: abs("x/y.test.ts") }]))).toEqual([
      abs("a.test.ts"),
      abs("x/y.test.ts"),
    ]);
    expect(() => parseExpectedList("{}")).toThrow(/not a JSON array/);
    expect(toRepoPath(abs("x/y.test.ts"), ROOT)).toBe("x/y.test.ts");
    expect(toRepoPath("/elsewhere/y.test.ts", ROOT)).toBeNull();
  });
});

describe("completeness guard: the CLI the required job actually runs", () => {
  function fixture(write: (dir: string, root: string) => void): { status: number | null; out: string } {
    const root = mkdtempSync(join(tmpdir(), "required-shards-"));
    const dir = join(root, ".vitest-reports");
    mkdirSync(dir);
    try {
      write(dir, root);
      const r = spawnSync(process.execPath, [SCRIPT, "--expected", join(dir, "expected.json"), "--dir", dir, "--shards", "2"], {
        cwd: root,
        encoding: "utf8",
      });
      return { status: r.status, out: `${r.stdout}${r.stderr}` };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  const writeRun = (dir: string, root: string, shards: Record<number, string[]>, expected: string[]) => {
    writeFileSync(join(dir, "expected.json"), JSON.stringify(expected.map((f) => ({ file: join(root, f) }))));
    for (const [k, files] of Object.entries(shards)) {
      const r = report(files);
      r.testResults.forEach((t, i) => (t.name = join(root, files[i])));
      writeFileSync(join(dir, `shard-${k}.json`), JSON.stringify(r));
    }
  };

  it("exits 0 on a complete, green run", () => {
    const r = fixture((dir, root) => writeRun(dir, root, { 1: ["a.test.ts"], 2: ["b.test.ts"] }, ["a.test.ts", "b.test.ts"]));
    expect(r.out).toContain("Every one of 2 required test files ran in exactly one shard");
    expect(r.status).toBe(0);
  });

  it("exits 1 when a shard's report never arrived", () => {
    const r = fixture((dir, root) => writeRun(dir, root, { 1: ["a.test.ts"] }, ["a.test.ts", "b.test.ts"]));
    expect(r.out).toMatch(/shard 2\/2: NO REPORT/);
    expect(r.status).toBe(1);
  });

  it("exits 1 when the population was never published", () => {
    const r = fixture((dir, root) => {
      writeRun(dir, root, { 1: ["a.test.ts"], 2: ["b.test.ts"] }, []);
      rmSync(join(dir, "expected.json"));
    });
    expect(r.out).toMatch(/expected list .* does not exist/);
    expect(r.status).toBe(1);
  });

  it("exits 2 on a bad invocation", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "--dir", "x"], { encoding: "utf8" });
    expect(r.stderr).toMatch(/missing --expected/);
    expect(r.status).toBe(2);
  });

  it("reads reports from disk, turning an unparseable one into an error value", () => {
    const dir = mkdtempSync(join(tmpdir(), "required-shards-read-"));
    try {
      writeFileSync(join(dir, "shard-1.json"), JSON.stringify(report(["a.test.ts"])));
      writeFileSync(join(dir, "shard-2.json"), "{not json");
      writeFileSync(join(dir, "expected.json"), "[]");
      const reports = readShardReports(dir);
      expect([...reports.keys()].sort()).toEqual([1, 2]);
      expect(reports.get(2)).toBeInstanceOf(Error);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── The wiring, derived from the workflow files ─────────────────────────────
const WORKFLOW_DIR = join(REPO_ROOT, ".github/workflows");
const ci: any = parse(readFileSync(join(WORKFLOW_DIR, "ci.yml"), "utf8"));
const gate = ci.jobs["unit-tests"];
const tests = ci.jobs["required-tests"];
const staticJob = ci.jobs["required-static"];
const REQUIRED_KEYS = ["required-static", "required-tests", "unit-tests"];

describe("the split required gate is wired so it cannot pass without every test", () => {
  it("the required context keeps its exact name, key and never-skipped condition", () => {
    expect(gate.name).toBe(CONTEXT);
    expect(gate.if).toBe("${{ !cancelled() }}");
    expect(gate.needs).toEqual(["required-static", "required-tests"]);
    // `live-tests` still hangs off the required context, as before the split.
    expect(ci.jobs["live-tests"].needs).toContain("unit-tests");
  });

  it("the context fails unless EVERY job it needs succeeded", () => {
    const [first] = gate.steps;
    expect(first.env).toEqual({
      STATIC_RESULT: "${{ needs.required-static.result }}",
      TESTS_RESULT: "${{ needs.required-tests.result }}",
    });
    expect(first.run).toContain('[ "$STATIC_RESULT" != "success" ] || [ "$TESTS_RESULT" != "success" ]');
    expect(first.run).toMatch(/exit 1/);
    // It is the FIRST step, with no condition of its own, so nothing runs ahead of it.
    expect(first.if).toBeUndefined();
  });

  it("the matrix covers shards 1..N, the flag divides by N, and the guard is told N", () => {
    const shards: number[] = tests.strategy.matrix.shard;
    expect(shards).toEqual(Array.from({ length: shards.length }, (_, i) => i + 1));
    expect(shards.length).toBeGreaterThanOrEqual(2);
    expect(tests.strategy["fail-fast"]).toBe(false);

    const run = tests.steps.find((s: any) => typeof s.run === "string" && /\bpnpm test:required\b/.test(s.run)).run;
    expect(run).toContain("--shard=${{ matrix.shard }}/${{ strategy.job-total }}");
    expect(run).toContain("--outputFile.json=.vitest-reports/shard-${{ matrix.shard }}.json");

    const guard = gate.steps.find((s: any) => typeof s.run === "string" && s.run.includes("assert-required-shards-complete.mjs")).run;
    expect(guard).toBe(
      `node scripts/ci/assert-required-shards-complete.mjs --expected .vitest-reports/expected.json --dir .vitest-reports --shards ${shards.length}`,
    );
  });

  it("the population and every report reach the guard", () => {
    const list = staticJob.steps.find((s: any) => typeof s.run === "string" && s.run.includes("vitest list")).run;
    expect(list).toBe("pnpm exec vitest list --config vitest.required.config.ts --filesOnly --json=.vitest-reports/expected.json");
    const uploads = [...staticJob.steps, ...tests.steps].filter((s: any) => String(s.uses).startsWith("actions/upload-artifact"));
    expect(uploads.map((s: any) => s.with.name).sort()).toEqual(["required-tests-expected", "required-tests-shard-${{ matrix.shard }}"]);
    for (const u of uploads) expect(u.with["if-no-files-found"]).toBe("error");
    const download = gate.steps.find((s: any) => String(s.uses).startsWith("actions/download-artifact"));
    expect(download.with).toMatchObject({ pattern: "required-tests-*", path: ".vitest-reports", "merge-multiple": true });
  });

  it("every shard builds dist first (the compiled-boot test would otherwise skip deterministically)", () => {
    const names = tests.steps.map((s: any) => s.run ?? s.uses);
    expect(names.indexOf("pnpm build")).toBeGreaterThan(-1);
    expect(names.indexOf("pnpm build")).toBeLessThan(names.findIndex((n: string) => /\bpnpm test:required\b/.test(n)));
  });

  it("no required job or step can be switched to continue-on-error", () => {
    for (const key of REQUIRED_KEYS) {
      const job = ci.jobs[key];
      expect(job["continue-on-error"], key).toBeUndefined();
      for (const step of job.steps) expect(step["continue-on-error"], `${key}: ${step.name ?? step.uses}`).toBeUndefined();
    }
  });

  it("exactly one job in any workflow reports the required context name", () => {
    const reporters: string[] = [];
    for (const file of readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f))) {
      const wf: any = parse(readFileSync(join(WORKFLOW_DIR, file), "utf8"));
      for (const [key, job] of Object.entries<any>(wf?.jobs ?? {})) {
        // A job without `name:` reports its key; a matrix job whose name does not
        // interpolate a matrix value would report the SAME name once per leg.
        const name = String(job?.name ?? key);
        if (name === CONTEXT || name.startsWith(`${CONTEXT} (`)) reporters.push(`${file}::${key}`);
        if (job?.strategy?.matrix && name.includes(CONTEXT)) reporters.push(`${file}::${key} (matrix)`);
      }
    }
    expect(reporters).toEqual(["ci.yml::unit-tests"]);
    // The shard legs are distinguishable from each other and from the context.
    expect(tests.name).toContain("${{ matrix.shard }}");
    expect(tests.name).not.toContain(CONTEXT);
  });

  it("no provider credential reaches the required path (programme constraint: no paid model calls)", () => {
    for (const key of REQUIRED_KEYS) {
      const text = JSON.stringify(ci.jobs[key]);
      expect(text, key).not.toMatch(/ANTHROPIC|OPENAI|CLAUDE_API|LLM_API_KEY/i);
      // The only secret the required path may read is the package-registry token.
      const secrets = [...text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
      expect(new Set(secrets), key).toEqual(new Set(key === "unit-tests" ? [] : ["NPM_PACKAGES_TOKEN"]));
    }
  });
});
