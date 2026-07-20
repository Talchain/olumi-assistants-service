/**
 * Required-gate exclusion self-check (O-6 gate hardening).
 *
 * vitest.required.config.ts excludes a FINITE list of external-dependent
 * integration files (REQUIRED_GATE_INTEGRATION_EXCLUSIONS, vitest.shared.ts)
 * instead of the former `tests/integration/**` category glob. A category glob
 * is a hand-maintained mirror of the claim "everything in this directory is
 * service-like" — and that claim drifted: ~155 of the ~175 files are
 * in-process `app.inject()` tests, so PR #539 truthfully reported "0 failed"
 * while breaking two of them.
 *
 * This test runs IN the required gate and makes the finite list fail loud in
 * both directions:
 *
 *   DERIVE, DON'T MIRROR — it mechanically derives the external-dependent set
 *   (files under tests/integration that read `process.env.<VAR>` for any VAR
 *   in EXTERNAL_SERVICE_ENV_VARS) and asserts it EQUALS the list:
 *     - listed file missing / no longer external-dependent → RED (stale);
 *     - new external-dependent file not listed → RED (silent join).
 *
 *   SELF-GATE — every listed file must carry a recognised self-gating
 *   construct (skipIf / runIf / `describe.skip` ternary / `{ skip: ... }`
 *   options / top-of-file env throw), so the advisory jobs that DO collect it
 *   skip cleanly instead of erroring when env is absent.
 *
 *   POSITIVE CONTROL — the classifier is proven able to SEE a presence (and
 *   ignore a non-external var) on inline fixtures before any absence claim is
 *   made, and the directory walk is proven non-vacuous via sentinel files.
 *
 * Deliberate choice: the classifier matches the literal `process.env.<VAR>`
 * token WITHOUT comment-stripping. Today that yields zero false positives
 * (verified: the only comment-adjacent mention, orchestrate-v2.test.ts:139,
 * says "SUPABASE_*" without the `process.env.` prefix). If a future comment
 * quotes the full literal, this test goes RED (over-detection) — which is the
 * fail-loud direction: reword the comment or list the file, both reviewable.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import {
  EXTERNAL_SERVICE_ENV_VARS,
  REQUIRED_GATE_INTEGRATION_EXCLUSIONS,
} from "../../vitest.shared.js";

const REPO_ROOT = process.cwd();
const INTEGRATION_DIR = join(REPO_ROOT, "tests", "integration");

/** Matches vitest's default include breadth for this directory. */
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/;

/** Literal `process.env.<VAR>` read of an external-service var. */
const EXTERNAL_ENV_RE = new RegExp(
  `process\\.env\\.(${EXTERNAL_SERVICE_ENV_VARS.join("|")})\\b`,
);

/**
 * Recognised self-gating constructs. A listed file must match at least one,
 * so it skips (rather than errors) wherever it IS collected without env.
 */
const SELF_GATE_PATTERNS: RegExp[] = [
  /\.skipIf\s*\(/, // describe.skipIf(!POSTGRES_URL)(...)
  /\.runIf\s*\(/, // describe.runIf(SHOULD_RUN)(...)
  /\bdescribe\.skip\b/, // const suite = envReady ? describe : describe.skip
  /\bskip:\s*!?!?[A-Za-z_$]/, // it("...", { skip: !!SKIP_REASON }, ...)
  /if\s*\(\s*process\.env\.LIVE_LLM/, // top-of-file `if (process.env.LIVE_LLM !== "1") throw`
];

function walkTestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkTestFiles(full));
    } else if (TEST_FILE_RE.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function isExternalDependent(source: string): boolean {
  return EXTERNAL_ENV_RE.test(source);
}

describe("required-gate integration exclusion list (finite, self-checking)", () => {
  // ── Positive/negative controls: prove the classifier can SEE ─────────────
  it("classifier positive control: detects a literal external env read", () => {
    expect(
      isExternalDependent("const url = process.env.SUPABASE_URL;"),
    ).toBe(true);
    expect(
      isExternalDependent("if (process.env.LIVE_LLM !== '1') throw new Error('x');"),
    ).toBe(true);
  });

  it("classifier negative control: ignores non-external vars and bare names", () => {
    // Non-external env var —
    expect(isExternalDependent("process.env.LLM_PROVIDER = 'fixtures';")).toBe(
      false,
    );
    // Bare var name without the process.env prefix (the orchestrate-v2 case) —
    expect(isExternalDependent("// needs SUPABASE_URL and REDIS_URL set")).toBe(
      false,
    );
    // Prefix-collision guard: the word boundary must hold —
    expect(isExternalDependent("process.env.SUPABASE_URL_BACKUP")).toBe(false);
  });

  // ── Walk is non-vacuous ──────────────────────────────────────────────────
  const files = walkTestFiles(INTEGRATION_DIR).map((f) =>
    relative(REPO_ROOT, f),
  );

  it("directory walk sees the integration suite (sentinels present)", () => {
    // If tests/integration moved or the walk broke, every claim below would
    // be vacuous — fail here first, loudly.
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("tests/integration/orchestrate-v2.test.ts");
    expect(files).toContain("tests/integration/orchestrator/route.test.ts");
  });

  // ── Derive the set and demand exact equality (both directions loud) ──────
  const derived = files
    .filter((f) => isExternalDependent(readFileSync(join(REPO_ROOT, f), "utf8")))
    .sort();
  const listed = [...REQUIRED_GATE_INTEGRATION_EXCLUSIONS].sort();

  it("no NEW external-dependent test silently joins the exclusion", () => {
    const unlisted = derived.filter((f) => !listed.includes(f));
    expect(
      unlisted,
      `These tests/integration files read external-service env ` +
        `(${EXTERNAL_SERVICE_ENV_VARS.join(", ")}) but are NOT in ` +
        `REQUIRED_GATE_INTEGRATION_EXCLUSIONS (vitest.shared.ts). Either make ` +
        `them in-process, or add them to the list WITH a self-gate — an ` +
        `explicit, reviewed addition, never a silent one.`,
    ).toEqual([]);
  });

  it("no STALE entry lingers in the exclusion list", () => {
    const stale = listed.filter((f) => !derived.includes(f));
    expect(
      stale,
      `These REQUIRED_GATE_INTEGRATION_EXCLUSIONS entries no longer exist ` +
        `under tests/integration or no longer read external-service env. ` +
        `Remove them from vitest.shared.ts so the files rejoin the required ` +
        `gate.`,
    ).toEqual([]);
  });

  it("every excluded file self-gates (skips cleanly without env)", () => {
    const ungated = listed.filter((f) => {
      let source: string;
      try {
        source = readFileSync(join(REPO_ROOT, f), "utf8");
      } catch {
        return true; // missing file = ungated; the stale check flags it too
      }
      return !SELF_GATE_PATTERNS.some((p) => p.test(source));
    });
    expect(
      ungated,
      `These excluded files carry no recognised self-gating construct ` +
        `(skipIf / runIf / describe.skip ternary / { skip: ... } options / ` +
        `env guard throw). They would ERROR rather than skip in the advisory ` +
        `jobs when env is absent — add a self-gate.`,
    ).toEqual([]);
  });

  it("the exclusion list is exactly the derived external-dependent set", () => {
    // Belt-and-braces equality on top of the two directional checks: any
    // classifier or list drift whatsoever fails the gate with the full diff.
    expect(listed).toEqual(derived);
  });
});
