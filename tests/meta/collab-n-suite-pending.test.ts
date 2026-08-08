/**
 * ROADMAP 2.909 — THE COLLECTED SENTRY for the pre-DDL collab N-suite.
 *
 * The adversarial N-suite for the U-S0 collab slice
 * (tests/collab-nsuite-pending/ — see its README.md) is authored RED-FIRST
 * against seams that DO NOT EXIST yet (tenancy-audit DDL condition 4), so the
 * required gate cannot collect it without going red. This meta-test is how the
 * required gate SEES that the suite exists anyway (estate trap 12f: a
 * scheduler that stops looks exactly like a scheduler that found nothing —
 * a pending suite nothing watches is a suite that silently rots).
 *
 * It is GREEN today and MUST GO RED in exactly two situations:
 *   1. the pending suite's manifest drifts (a spec deleted/renamed/added
 *      without updating the declared manifest) — fail loud on drift;
 *   2. ANY contract seam lands in src/ — that RED is the PROMOTION TRIGGER:
 *      the build lane must promote the N-suite into the collected gate
 *      (protocol in tests/collab-nsuite-pending/README.md) and delete this
 *      sentry in the same PR.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CONTRACT_SEAMS,
  POSITIVE_CONTROL_MODULE,
  REPO_ROOT,
  RED_SIGNATURE_PREFIX,
  importSeam,
  seamExists,
} from "../collab-nsuite-pending/contracts.js";

const PENDING_DIR = resolve(REPO_ROOT, "tests/collab-nsuite-pending");

/** The declared manifest — the single place the suite's file list lives. */
const DECLARED_MANIFEST = [
  "README.md",
  "attribution.inv-f.ntest.ts",
  "blindness.inv-a.ntest.ts",
  "contracts.ts",
  "n-suite-rls.collab.sql",
  "redaction.r1-r2.ntest.ts",
  "round-lifecycle.ntest.ts",
  "routes.token-boundary.ntest.ts",
  "token-scope.ntest.ts",
].sort();

const SPEC_FILES = DECLARED_MANIFEST.filter((f) => f.endsWith(".ntest.ts"));

describe("2.909 pending N-suite sentry (collected by the required gate)", () => {
  it("manifest: tests/collab-nsuite-pending/ contains exactly the declared files", () => {
    const actual = readdirSync(PENDING_DIR).sort();
    expect(actual).toEqual(DECLARED_MANIFEST);
  });

  it("absence instrument works: the positive-control module EXISTS via the same check that reports the seams absent (trap 13)", () => {
    expect(seamExists(POSITIVE_CONTROL_MODULE)).toBe(true);
  });

  it("PRE-DDL RED STATUS: every contract seam is absent, and importSeam throws the documented RED signature for each — when this test fails, the U-S0 build has begun: PROMOTE THE N-SUITE (tests/collab-nsuite-pending/README.md, 'Promotion protocol') and delete this sentry in the same PR", async () => {
    for (const seam of CONTRACT_SEAMS) {
      expect(
        seamExists(seam),
        `Seam ${seam} now EXISTS. This is the promotion trigger, not a defect: ` +
          `wire tests/collab-nsuite-pending/ into the required gate per its README ` +
          `promotion protocol, make the N-suite GREEN against the real seams, and ` +
          `delete tests/meta/collab-n-suite-pending.test.ts in the same PR.`
      ).toBe(false);

      // Execute the exact mechanism the pending specs rely on: the guard must
      // THROW the uniform RED signature today (not resolve, not throw
      // something else) — this is the RED status, asserted in the gate.
      await expect(importSeam(seam)).rejects.toThrow(RED_SIGNATURE_PREFIX);
    }
  });

  it("every pending spec invokes the seam guard (a tidy-up cannot silently defuse the RED)", () => {
    for (const file of SPEC_FILES) {
      const content = readFileSync(resolve(PENDING_DIR, file), "utf8");
      // Call-shaped token, not a substring (a rename like importSeamX must RED
      // here — caught by mutant M3 of this sentry's own kit, 2026-08-08):
      // matches `importSeam<T>(` and `importSeam(`, at a word start.
      expect(
        /\bimportSeam\s*[<(]/.test(content),
        `${file} must CALL importSeam (call-shaped token importSeam<...>( or importSeam( not found)`
      ).toBe(true);
      // And the guard must be the contracts.js one, not a local reinvention.
      expect(
        /import\s*\{[^}]*\bimportSeam\b[^}]*\}\s*from\s*"\.\/contracts\.js"/s.test(content),
        `${file} must import importSeam from ./contracts.js`
      ).toBe(true);
      expect(
        content.includes("RED (pre-DDL): seam not implemented"),
        `${file} must document its RED signature in-file`
      ).toBe(true);
    }
  });

  it("the dedicated runner exists and collects exactly the pending suite (pnpm test:collab-nsuite)", () => {
    const config = readFileSync(resolve(REPO_ROOT, "vitest.collab-nsuite.config.ts"), "utf8");
    expect(config).toContain("tests/collab-nsuite-pending/**/*.ntest.ts");
    const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["test:collab-nsuite"]).toContain("vitest.collab-nsuite.config.ts");
  });

  it("no pending file can be collected by the required gate by accident (no .test.ts/.spec.ts filenames in the pending dir)", () => {
    const collectable = readdirSync(PENDING_DIR).filter(
      (f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f)
    );
    expect(collectable).toEqual([]);
  });
});
