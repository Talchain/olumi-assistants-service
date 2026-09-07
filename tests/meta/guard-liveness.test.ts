/**
 * GUARD LIVENESS — does every guard in this repo actually run in the one
 * required check, and does every comment claiming enforcement tell the truth?
 *
 * A guard that runs nowhere is indistinguishable from a guard that finds
 * nothing. This repo has exactly ONE required status check; everything else is
 * advisory or developer-local. So a gate can be written, cited in a comment as
 * enforcement, reviewed, merged — and never block a single merge.
 *
 * This spec runs INSIDE that required check and makes the gap fail loud.
 *
 * BOTH SIDES ARE DERIVED (see tests/meta/guard-liveness.ts for the mechanism
 * and the two measured edge-extraction defects it exists to avoid). Nothing
 * here carries a hand-written list of guards, workflows or job names: the
 * required job locates itself as the job that runs `pnpm test:required`.
 *
 * THE ONE LIST, AND WHY IT IS A LIST. 23 orphaned guards exist today. REDing on
 * all of them cannot land, and deleting or re-wiring 23 guards is a different
 * and much larger change. So the derived orphan set is pinned to an
 * ACKNOWLEDGEMENTS file and asserted EXACTLY EQUAL — RED when the set GROWS (a
 * new guard joins the estate dark) and RED when it SHRINKS (an entry was fixed
 * or deleted and the file is now lying). A gap recorded in the suite is honest;
 * a gap invisible to it is how this estate loses schedulers. The file is a
 * shrink-only ratchet, not a permission slip.
 *
 * FALSE ENFORCEMENT CLAIMS have NO acknowledgement list: the assertion is
 * `toEqual([])`. Both known instances are fixed in this change.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  deriveLiveness,
  findFalseEnforcementClaims,
  invocationEdges,
  readRepo,
  requiredGateJob,
  stripComments,
  type Job,
  type Repo,
} from "./guard-liveness.js";

const REPO_ROOT = process.cwd();
const ACK_PATH = join(REPO_ROOT, "tests", "meta", "guard-liveness-acknowledgements.json");

interface Ack {
  orphanedGuards: { path: string; via: string[]; why: string }[];
}

describe("guard liveness: positive controls (the classifier must SEE a presence)", () => {
  // Rule 1. This is the exact shape that hid nine orphaned guards behind a
  // green: a MENTION inside an error-message string, read as an INVOCATION.
  it("counts a command-position invocation and IGNORES a string-literal mention", () => {
    const invoked = invocationEdges('bash scripts/planted-guard.sh --strict\n', "sh");
    expect([...invoked]).toContain("scripts/planted-guard.sh");

    const mentioned = invocationEdges(
      `console.error('(or scripts/planted-guard.sh) in THIS directory before taking a baseline.');`,
      "js",
    );
    expect([...mentioned]).not.toContain("scripts/planted-guard.sh");
  });

  // Rule 2. Measured on check-forbidden-boundary-patterns.sh: the glob
  // `**\/__tests__/**` contains both `/*` and `*\/`, so JS block-comment
  // stripping applied to a shell file deleted 56 lines — including the line
  // that invokes the comment stripper — and manufactured a FALSE ORPHAN.
  it("does not let a shell glob eat the rest of a shell file", () => {
    // Mirrors check-forbidden-boundary-patterns.sh: an OPENING `/*` inside the
    // glob on line 1, the assignment on line 2, and a CLOSING `*\/` inside the
    // character class on line 3. Without a real closing token the JS strip is a
    // no-op and this control would pass while reproducing nothing.
    const shell = [
      "# Scope: src/ TypeScript only, excluding tests (**/__tests__/**),",
      'STRIPPER="scripts/planted-stripper.mjs"',
      "EXEMPT_RE='^[[:space:]]*//[[:space:]]*forbidden-exempt:'",
    ].join("\n");

    expect([...invocationEdges(shell, "sh")]).toContain("scripts/planted-stripper.mjs");
    // And the defect itself, pinned: treated as JS, the assignment disappears.
    expect(stripComments(shell, "js")).not.toContain("planted-stripper");
  });

  // A repo-root anchor. Without it `tools/graph-evaluator/scripts/x.ts` is
  // captured as `scripts/x.ts` and reported as a missing artefact — measured,
  // it produced two false MISSING-ENFORCER findings.
  it("does not capture a nested scripts/ directory as a repo-root artefact", () => {
    const edges = invocationEdges("tsx tools/graph-evaluator/scripts/rederive.ts\n", "sh");
    expect([...edges]).not.toContain("scripts/rederive.ts");
  });

  // The whole spec is an absence probe ("no NEW orphans"), so it must be shown
  // able to SEE an orphan before its green means anything. A synthetic repo,
  // built in memory, with one guard planted in a non-required job only.
  it("SEES a planted orphan: a guard invoked only by a non-required job", () => {
    const gateJob: Job = {
      workflow: "ci.yml",
      name: "Lint, TypeCheck, Unit Tests",
      runs: ["bash scripts/live-guard.sh", "pnpm test:required"],
    };
    const advisoryJob: Job = {
      workflow: "ci.yml",
      name: "Advisory",
      runs: ["bash scripts/planted-orphan.sh"],
    };
    const repo: Repo = {
      root: REPO_ROOT,
      scripts: ["scripts/live-guard.sh", "scripts/planted-orphan.sh"],
      pkgScripts: {},
      jobs: [gateJob, advisoryJob],
      hookInstallers: [],
    };

    const { orphans } = deriveLiveness(repo);
    expect(orphans.map((o) => o.path)).toEqual(["scripts/planted-orphan.sh"]);
    expect(orphans[0].via).toEqual(["NONREQUIRED_WORKFLOW"]);
  });

  it("SEES a planted orphan reachable only through the hook installer", () => {
    const repo: Repo = {
      root: REPO_ROOT,
      scripts: ["tests/meta/__fixtures__/guard-liveness/install-hooks.sh"],
      pkgScripts: {},
      jobs: [{ workflow: "ci.yml", name: "gate", runs: ["pnpm test:required"] }],
      hookInstallers: ["tests/meta/__fixtures__/guard-liveness/install-hooks.sh"],
    };
    const { hook } = deriveLiveness(repo);
    // The fixture installer names a guard it does not execute in command
    // position (`chmod +x`), which is precisely the shape that read as zero.
    expect([...hook]).toContain("scripts/fixture-prepush-guard.sh");
  });

  it("HARD-FAILS rather than passing vacuously when it cannot find the gate", () => {
    const blind: Repo = {
      root: REPO_ROOT,
      scripts: [],
      pkgScripts: {},
      jobs: [{ workflow: "ci.yml", name: "Nothing", runs: ["echo hi"] }],
      hookInstallers: [],
    };
    expect(() => requiredGateJob(blind)).toThrow(/BLINDED/);
  });

  it("HARD-FAILS when two jobs claim to be the required gate", () => {
    const twin: Repo = {
      root: REPO_ROOT,
      scripts: [],
      pkgScripts: {},
      jobs: [
        { workflow: "ci.yml", name: "A", runs: ["pnpm test:required"] },
        { workflow: "other.yml", name: "B", runs: ["pnpm test:required"] },
      ],
      hookInstallers: [],
    };
    expect(() => requiredGateJob(twin)).toThrow(/BLINDED/);
  });

  it("parses real workflow jobs (the parser is not silently returning nothing)", () => {
    const repo = readRepo(REPO_ROOT);
    expect(repo.jobs.length).toBeGreaterThan(5);
    expect(repo.scripts.length).toBeGreaterThan(50);
    expect(repo.jobs.some((j) => j.runs.length > 0)).toBe(true);
  });
});

describe("guard liveness: this repository", () => {
  const repo = readRepo(REPO_ROOT);
  const liveness = deriveLiveness(repo);
  const ack: Ack = JSON.parse(readFileSync(ACK_PATH, "utf8"));

  it("locates exactly one required gate, by what it runs", () => {
    const gate = requiredGateJob(repo);
    expect(gate.workflow).toBe("ci.yml");
    // The name is ASSERTED, not used to find the job — so a rename REDs here
    // with a clear message instead of silently re-pointing the derivation.
    expect(gate.name).toBe("Lint, TypeCheck, Unit Tests");
  });

  it("the required gate genuinely reaches guards (not a vacuous empty closure)", () => {
    expect(liveness.required.size).toBeGreaterThan(0);
    expect([...liveness.required]).toContain("scripts/ci/assert-pnpm-overrides-readable.mjs");
  });

  it("the orphaned-guard set EXACTLY equals the acknowledgements file", () => {
    const derived = liveness.orphans.map((o) => o.path).sort();
    const acknowledged = ack.orphanedGuards.map((o) => o.path).sort();

    // Set equality, by PATH — not by count, and not order-sensitive. A new
    // dark guard REDs (grew); a fixed or deleted one REDs (stale entry).
    expect(derived).toEqual(acknowledged);
  });

  it("each acknowledged orphan is recorded with the invoker that reaches it", () => {
    const byPath = new Map(liveness.orphans.map((o) => [o.path, o.via]));
    for (const entry of ack.orphanedGuards) {
      expect(byPath.get(entry.path), `via for ${entry.path}`).toEqual(entry.via);
      expect(entry.why.length, `why for ${entry.path}`).toBeGreaterThan(10);
    }
  });

  it("no comment claims an enforcer that does not exist or does not run", () => {
    const claims = findFalseEnforcementClaims(
      REPO_ROOT,
      trackedSourceFiles(),
      liveness.required,
    );

    // No acknowledgement list here on purpose. A false enforcement claim is a
    // lie in the codebase about its own safety net; it costs one line to fix.
    expect(claims).toEqual([]);
  });
});

function trackedSourceFiles(): string[] {
  const out = execSync("git ls-files -z src", { cwd: REPO_ROOT, maxBuffer: 1 << 28 })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((p) => /\.(ts|tsx|mts|cts)$/.test(p));
  if (out.length === 0) throw new Error("BLINDED: zero source files under src/");
  return out;
}
