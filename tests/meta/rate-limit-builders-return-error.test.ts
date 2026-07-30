/**
 * ROADMAP 2.181 — DERIVED GUARD: every `@fastify/rate-limit`
 * `errorResponseBuilder` under `src/` must RETURN an `Error`.
 *
 * The plugin THROWS whatever the builder RETURNS (`index.js:333`). A plain
 * object reaches this app's custom `setErrorHandler` as an unknown type and is
 * answered **500 INTERNAL** while the limiter's own headers still say 429. All
 * nine builders had that shape, in production, under months of green CI.
 *
 * Nothing else can catch it:
 *   - the plugin types the return as `object`, so a raw pre-fix builder
 *     TYPECHECKS CLEAN (verified: `tsc -p tsconfig.build.json --noEmit` exit 0);
 *   - `pnpm lint` reddens on a REVERT only incidentally (unused import), and on
 *     a brand-new tenth builder not at all.
 *
 * So the nine correct sites are otherwise a nine-way hand-maintained mirror with
 * no drift alarm — the dominant defect class in CLAUDE.md. This test is the
 * alarm, and it DERIVES its sites from the source tree rather than listing them,
 * so a tenth builder is checked the moment it is written.
 *
 * The same derivation runs as a step in the REQUIRED CI job
 * (`node scripts/ci/assert-rate-limit-builders-return-error.mjs`); this test
 * makes it bite locally too, in `pnpm test:required`.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD_PATH = join(REPO_ROOT, "scripts/ci/assert-rate-limit-builders-return-error.mjs");
const FIXTURES = join(REPO_ROOT, "tests/meta/__fixtures__");

interface BuilderSite {
  file: string;
  line: number;
  ok: boolean;
  reason: string;
}
interface Scan {
  tsFileCount: number;
  pluginFiles: string[];
  registrationSites: Array<{ file: string; line: number }>;
  builderSites: BuilderSite[];
  violations: BuilderSite[];
}
interface Guard {
  scanRateLimitErrorBuilders: (root?: string) => Scan;
  checkRateLimitErrorBuilders: (root?: string) => { scan: Scan; errors: string[] };
}

let guard: Guard;

beforeAll(async () => {
  guard = (await import(pathToFileURL(GUARD_PATH).href)) as unknown as Guard;
});

describe("derived guard: rate-limit errorResponseBuilder must return an Error", () => {
  it("every errorResponseBuilder under src/ returns an Error", () => {
    const { scan, errors } = guard.checkRateLimitErrorBuilders();
    expect(errors, `rate-limit builder guard failed:\n${errors.join("\n")}`).toEqual([]);
    // Report what was actually inspected, so a shrinking scan is visible rather
    // than silently reading as a pass.
    expect(scan.builderSites.length).toBeGreaterThan(0);
  });

  // POSITIVE CONTROL (trap 13): the guard must be able to SEE a violation.
  // Without this, "every builder returns an Error" could be true simply because
  // the scanner recognises nothing.
  it("REDs on a builder that returns the pre-fix plain object", () => {
    const { errors } = guard.checkRateLimitErrorBuilders(join(FIXTURES, "rate-limit-guard"));

    expect(errors.length).toBeGreaterThan(0);
    const joined = errors.join("\n");
    expect(joined).toMatch(/returns a non-Error/);
    // …and it is the raw builder that is flagged, not the conforming one.
    expect(joined).toMatch(/raw-builder\.ts/);
    expect(joined).not.toMatch(/conforming-builder\.ts/);
  });

  // The scanner must HARD-FAIL when blinded, never pass by finding nothing.
  it("HARD-FAILS on a tree with TypeScript but no rate-limit code (never `[] === []`)", () => {
    const { errors } = guard.checkRateLimitErrorBuilders(
      join(FIXTURES, "rate-limit-guard-blind"),
    );

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toMatch(/SCANNER BLINDED/);
  });

  it("HARD-FAILS when pointed at a directory that does not exist", () => {
    const { errors } = guard.checkRateLimitErrorBuilders(
      join(FIXTURES, "no-such-directory-at-all"),
    );

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toMatch(/SCANNER BLINDED/);
  });

  it("derives its sites rather than hand-listing them", () => {
    const scan = guard.scanRateLimitErrorBuilders();
    // Every builder site must sit in a file that also references the plugin —
    // i.e. two independent derivations agree on the same set of files.
    for (const site of scan.builderSites) {
      expect(
        scan.pluginFiles,
        `${site.file} declares an errorResponseBuilder but never references @fastify/rate-limit`,
      ).toContain(site.file);
    }
    expect(scan.registrationSites.length).toBeGreaterThan(0);
    expect(scan.tsFileCount).toBeGreaterThan(0);
  });
});
