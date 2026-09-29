/**
 * The shadow-copy guard (ROADMAP 2.660).
 *
 * Four jobs, and the first two are the point of the change:
 *
 *   1. THE OLD-vs-NEW PROOF PAIR. Every fixture is run through BOTH the frozen
 *      historical glob guard and the current mechanism. The narrowing is proven
 *      by the pair, never by one side alone:
 *        · the #835 name (`structural-edit-decline-copy.ts`, no sibling) must
 *          FIRE on the old guard — the defect reproduced, RED-first — and PASS
 *          on the new one;
 *        · every genuine shadow pair must FIRE on BOTH — which is what stops the
 *          "fix" being a quiet weakening.
 *      The legacy side is the real `git ls-files <glob>` shell logic run against
 *      a real throwaway git repo, not a re-implementation of it, so the
 *      comparison is against what actually shipped.
 *
 *   2. THE STRENGTHENINGS ARE REAL, NOT CLAIMED. Three fixtures fire on the NEW
 *      guard and NOT on the old one (a ` 2.md` artefact, an extensionless one,
 *      a cross-directory non-sibling that the old guard wrongly convicted).
 *
 *   3. THE GUARD IS WIRED AND CANNOT BE SILENCED QUIETLY. The workflow facts are
 *      DERIVED from ci.yml — there is no second hand-maintained copy to drift.
 *      Unwiring the step, or marking it continue-on-error, turns this red.
 *
 *   4. THE LIVE TREE IS CLEAN, checked in the REQUIRED gate. The workflow step
 *      itself lives in the non-required Security Audit job; running the same
 *      scan here means a real shadow copy blocks merge, not just prints red.
 *
 * Fixtures are synthetic and built in the OS temp dir. Nothing here adds a file
 * to this repo, and nothing here writes inside the repo root.
 */
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";

import {
  LEGACY_GUARD_GLOBS,
  classifyBasename,
  evaluateFixture,
  findShadowCopies,
  listTrackedFiles,
} from "../../../scripts/ci/assert-no-shadow-copies.mjs";

const REPO_ROOT = resolve(__dirname, "../../..");
const SCRIPT_REL = "scripts/ci/assert-no-shadow-copies.mjs";

/** Run one fixture through both guards, cleaning up the throwaway repo. */
function verdicts(files: readonly string[]): { legacy: string[]; next: string[] } {
  const r = evaluateFixture(files);
  try {
    return { legacy: [...r.legacy], next: [...r.next] };
  } finally {
    r.cleanup();
  }
}

describe("the #835 false positive is dead, and only that", () => {
  it("a legit -copy module with NO sibling: fires on the OLD guard, passes on the new", () => {
    // The historical defect, reproduced at the object level. PR #835 added
    // exactly this file and the required job hard-failed; 63bdd0f4 renamed it.
    const { legacy, next } = verdicts(["src/handlers/structural-edit-decline-copy.ts"]);
    expect(legacy).toEqual(["src/handlers/structural-edit-decline-copy.ts"]);
    expect(next).toEqual([]);
  });

  it("the SAME name WITH a tracked sibling is still a finding on both", () => {
    // The narrowing is about the sibling, not about the word "copy". Same
    // filename, one file added, opposite verdict — that is what proves the
    // mechanism is the sibling property and not a softer pattern list.
    const { legacy, next } = verdicts([
      "src/handlers/structural-edit-decline.ts",
      "src/handlers/structural-edit-decline-copy.ts",
    ]);
    expect(legacy).toEqual(["src/handlers/structural-edit-decline-copy.ts"]);
    expect(next).toEqual(["src/handlers/structural-edit-decline-copy.ts"]);
  });

  it("the two legitimate -copy files tracked in this repo today are not findings", () => {
    // Bound by IDENTITY to the real paths, so deleting or renaming either one
    // shows up here rather than silently reducing the coverage.
    const tracked = listTrackedFiles(REPO_ROOT);
    for (const p of [
      "src/orchestrator-v5/handlers/__tests__/gm-held-consent-copy.test.ts",
      "tests/unit/orchestrator/tools/edit-graph-f3-applied-turn-copy.test.ts",
    ]) {
      expect(tracked, `${p} must still be tracked for this control to mean anything`).toContain(p);
    }
    expect(findShadowCopies(tracked).map((f) => f.path)).toEqual([]);
  });
});

describe("genuine shadow copies still fire — on BOTH guards (no weakening)", () => {
  const pairs: ReadonlyArray<readonly [string, readonly string[], string]> = [
    ["Finder space-copy", ["src/x.ts", "src/x copy.ts"], "src/x copy.ts"],
    ["the shape that actually happened here", ["src/z.ts", "src/z 2.ts"], "src/z 2.ts"],
    ["kebab-case", ["src/y.ts", "src/y-copy.ts"], "src/y-copy.ts"],
    ["snake_case", ["src/w.ts", "src/w_copy.ts"], "src/w_copy.ts"],
    ["a Finder chain", ["src/q.ts", "src/q copy 2.ts"], "src/q copy 2.ts"],
  ];

  for (const [name, files, offender] of pairs) {
    it(`${name}: ${offender} fires on old AND new`, () => {
      const { legacy, next } = verdicts(files);
      expect(legacy).toEqual([offender]);
      expect(next).toEqual([offender]);
    });
  }

  it("an ORPHANED Finder artefact still fails — the sibling rule did not soften it", () => {
    // Documented decision: a space in a filename is a copy artefact, never a
    // naming convention, so the Finder family convicts with or without a
    // sibling. Deleting the original must not launder the copy.
    const { legacy, next } = verdicts(["src/stranded 2.ts"]);
    expect(legacy).toEqual(["src/stranded 2.ts"]);
    expect(next).toEqual(["src/stranded 2.ts"]);
  });
});

describe("the new guard is STRICTLY stronger where it changed", () => {
  it("catches a .md artefact the old extension allowlist could not see", () => {
    const { legacy, next } = verdicts(["Docs/a.md", "Docs/a 2.md"]);
    expect(legacy).toEqual([]);
    expect(next).toEqual(["Docs/a 2.md"]);
  });

  it("catches an extensionless artefact ('.gitignore 2' really happened)", () => {
    const { legacy, next } = verdicts([".gitignore", ".gitignore 2"]);
    expect(legacy).toEqual([]);
    expect(next).toEqual([".gitignore 2"]);
  });

  it("does not convict across directories — the sibling must be in the same one", () => {
    const { legacy, next } = verdicts(["src/a/foo.ts", "src/b/foo-copy.ts"]);
    expect(legacy).toEqual(["src/b/foo-copy.ts"]);
    expect(next).toEqual([]);
  });
});

describe("legitimate names are not findings", () => {
  it("prose-copy modules, numbered series and spaced prose filenames all pass", () => {
    const { next } = verdicts([
      "src/deepcopy.ts",
      "src/copy.ts",
      "src/copy-quality-gate.ts",
      "src/lonely-copy.ts", // delimited orphan: documented pass
      "Docs/canonical-1.md",
      "Docs/canonical-2.md",
      "src/use SseStream.tsx",
      "Docs/Olumi UI Integration Contract v1.md",
    ]);
    expect(next).toEqual([]);
  });

  it("classifyBasename says nothing about names with no duplication suffix", () => {
    for (const b of ["deepcopy.ts", "copy.ts", "foo-2.ts", "foo_2.ts", "use SseStream.tsx"]) {
      expect(classifyBasename(b), b).toBeNull();
    }
  });

  it("classifyBasename reconstructs the original it would be a copy OF", () => {
    expect(classifyBasename("cache.test 2.ts")).toEqual({
      family: "finder",
      suffix: " 2",
      original: "cache.test.ts",
    });
    expect(classifyBasename(".env 2.example")).toEqual({
      family: "finder",
      suffix: " 2",
      original: ".env.example",
    });
    expect(classifyBasename("structural-edit-decline-copy.ts")).toEqual({
      family: "delimited",
      suffix: "-copy",
      original: "structural-edit-decline.ts",
    });
  });
});

describe("the guard cannot pass by finding nothing", () => {
  it("the live tree is clean AND the scan actually read it", () => {
    const tracked = listTrackedFiles(REPO_ROOT);
    // An absence assertion needs a presence first: a blinded scan returns an
    // empty list and would otherwise report a clean tree forever.
    expect(tracked.length).toBeGreaterThan(3000);
    expect(findShadowCopies(tracked)).toEqual([]);
  });

  it("the CLI exits 2 — not 0 — when it can see no tracked files at all", () => {
    // The blinded-scanner case, exercised through the REAL entrypoint. The
    // script resolves its repo root from its own location, so copying it into
    // an empty git repo is what points it at nothing. A guard that reports
    // "clean" here would report "clean" forever.
    const dir = mkdtempSync(join(tmpdir(), "shadow-copy-cli-blind-"));
    try {
      execFileSync("git", ["init", "--quiet"], { cwd: dir });
      mkdirSync(join(dir, "scripts/ci"), { recursive: true });
      copyFileSync(resolve(REPO_ROOT, SCRIPT_REL), join(dir, SCRIPT_REL));
      const r = spawnSync(process.execPath, [join(dir, SCRIPT_REL)], { encoding: "utf8" });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("ZERO tracked files");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the CLI exits 1 and names the offender on a real shadow pair, 0 on a clean tree", () => {
    const run = (files: readonly string[]) => {
      const dir = mkdtempSync(join(tmpdir(), "shadow-copy-cli-"));
      try {
        execFileSync("git", ["init", "--quiet"], { cwd: dir });
        mkdirSync(join(dir, "scripts/ci"), { recursive: true });
        copyFileSync(resolve(REPO_ROOT, SCRIPT_REL), join(dir, SCRIPT_REL));
        for (const f of files) {
          mkdirSync(join(dir, f.slice(0, f.lastIndexOf("/"))), { recursive: true });
          writeFileSync(join(dir, f), "// fixture\n");
        }
        execFileSync("git", ["add", "-f", "-A"], { cwd: dir });
        return spawnSync(process.execPath, [join(dir, SCRIPT_REL)], { encoding: "utf8" });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };

    const dirty = run(["src/x.ts", "src/x copy.ts"]);
    expect(dirty.status).toBe(1);
    expect(dirty.stderr).toContain("src/x copy.ts");

    const clean = run(["src/x.ts", "src/deepcopy.ts", "src/lonely-copy.ts"]);
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain("no shadow copies");
  });

  it("the legacy comparator is the frozen historical list, unchanged", () => {
    // If this drifts, every old-vs-new claim above is comparing against
    // something that never shipped.
    expect([...LEGACY_GUARD_GLOBS]).toEqual([
      "* 2.ts",
      "* 2.js",
      "* copy.ts",
      "* copy.js",
      "*_copy.ts",
      "*_copy.js",
      "*-copy.ts",
      "*-copy.js",
    ]);
  });
});

describe("the guard is wired into CI and cannot be silenced quietly", () => {
  const workflow = parse(readFileSync(resolve(REPO_ROOT, ".github/workflows/ci.yml"), "utf8")) as {
    jobs: Record<string, { steps?: Array<{ name?: string; run?: string; "continue-on-error"?: boolean }> }>;
  };

  const steps = workflow.jobs.security?.steps ?? [];
  const guardSteps = steps.filter((s) => typeof s.run === "string" && s.run.includes(SCRIPT_REL));

  it("the Security Audit job runs the scan", () => {
    expect(guardSteps.length).toBeGreaterThan(0);
    const runs = guardSteps.map((s) => s.run ?? "").join("\n");
    expect(runs).toContain(`node ${SCRIPT_REL}\n`);
  });

  it("the same job runs the guard's own controls, so a guard that stopped discriminating goes red", () => {
    const runs = guardSteps.map((s) => s.run ?? "").join("\n");
    expect(runs).toContain(`node ${SCRIPT_REL} --self-test`);
  });

  it("no guard step is continue-on-error", () => {
    for (const s of guardSteps) {
      expect(s["continue-on-error"], s.name).not.toBe(true);
    }
  });

  it("the retired inline glob loop is gone from the workflow", () => {
    const raw = readFileSync(resolve(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    // Bound to the retired MACHINERY, not to prose: the step's replacement
    // comment deliberately quotes the old globs to explain why they were wrong,
    // so a text match on '*-copy.ts' would convict the documentation. These two
    // shell identifiers only exist if the glob loop is actually back — and two
    // guards with different verdicts on the same file is the state this change
    // exists to end.
    expect(raw).not.toContain("PATTERNS=(");
    expect(raw).not.toContain("FOUND_FILES");
  });
});
