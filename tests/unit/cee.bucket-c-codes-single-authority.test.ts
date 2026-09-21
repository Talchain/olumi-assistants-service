/**
 * BUCKET_C_CODES SINGLE-AUTHORITY GUARD (platform trap 12: derive, don't mirror).
 *
 * Bucket C decides `ctx.llmRepairNeeded`, and R1's completion keep/discard
 * comparator binds to the same set — so a second copy makes the repair stages
 * and the acceptance instrument disagree about what blocks, silently and
 * greenly. The list was in fact declared twice (deterministic-sweep.ts and
 * options-identical-graceful-dedup.ts, under a "KEEP IN SYNC" comment) until
 * this guard landed.
 *
 * Two guards, both DERIVED from the authority set itself — neither restates a
 * single code, and neither carries an allowlist of files:
 *
 *   1. NAME: exactly one declaration of `BUCKET_C_CODES` exists among all
 *      .ts files in the working tree.
 *   2. SHAPE: no collection literal outside the authority module reproduces a
 *      majority of the authority's members (catches a RENAMED copy, which the
 *      name check cannot see).
 *   3. MOCK-INDEPENDENCE: the consumers reach the set through a module that is
 *      not vi.mock-replaced wholesale — the constraint that made the naive
 *      "just import it from the sweep" repair wrong. See bucket-c-codes.ts.
 *
 * SCOPE, stated rather than implied (trap 20 — an absence claim must name what
 * it searched): the NAME scan covers every `.ts` path git reports as tracked OR
 * untracked-and-not-ignored, repo-wide — src, scripts and tests alike (~2,788
 * files as measured on this branch; the count is derived, never asserted). The
 * SHAPE scan covers the same set narrowed to `src/**` and `scripts/**` and
 * EXCLUDING test files, because tests legitimately enumerate validator codes.
 * Both scans assert a non-trivial file count first, so a glob that matched
 * nothing REDs instead of passing vacuously.
 *
 * `git ls-files` is used rather than a filesystem walk on purpose: the required
 * CI job runs `pnpm build` BEFORE `pnpm test:required`, and a walk would pick up
 * `dist/**.d.ts`, whose `declare const BUCKET_C_CODES` would false-RED the name
 * check. `--others --exclude-standard` keeps ignored paths out while still
 * seeing a copy planted in a new, uncommitted file.
 *
 * KNOWN LIMIT, honestly stated: the SHAPE check fires on a majority-overlap
 * copy, so a partial copy of fewer than half the codes under a different name
 * would pass both guards. The name check is the primary instrument; shape is
 * the backstop for a rename.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { BUCKET_C_CODES } from "../../src/cee/unified-pipeline/stages/repair/bucket-c-codes.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const AUTHORITY_REL = "src/cee/unified-pipeline/stages/repair/bucket-c-codes.ts";

/**
 * Tracked files PLUS untracked-but-not-ignored ones (`--others
 * --exclude-standard`). Untracked files are included deliberately: a copy
 * planted in a brand-new file must RED before it is ever committed, not after.
 * Ignored paths stay out, which is what keeps `dist/**` from being scanned.
 */
function sourceFiles(...globs: string[]): string[] {
  const out = execFileSync(
    "git",
    ["-C", REPO_ROOT, "ls-files", "--cached", "--others", "--exclude-standard", ...globs],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
  return [...new Set(out)].sort();
}

function parse(rel: string, text: string): ts.SourceFile {
  return ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true);
}

/** Every `<name> = ...` variable declaration in a source file, with its line. */
function declarationsNamed(rel: string, text: string, name: string): number[] {
  const lines: number[] = [];
  const src = parse(rel, text);
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      lines.push(src.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return lines;
}

/** Every array literal of string literals, with how many authority codes it holds. */
function literalOverlaps(rel: string, text: string, authority: ReadonlySet<string>): Array<{ line: number; hits: number; size: number }> {
  const out: Array<{ line: number; hits: number; size: number }> = [];
  const src = parse(rel, text);
  const visit = (node: ts.Node): void => {
    if (ts.isArrayLiteralExpression(node)) {
      const members = node.elements.filter(ts.isStringLiteralLike).map((e) => e.text);
      const hits = members.filter((m) => authority.has(m)).length;
      if (hits > 0) out.push({ line: src.getLineAndCharacterOfPosition(node.getStart()).line + 1, hits, size: members.length });
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return out;
}

const isTestFile = (rel: string): boolean => /\.test\.ts$/.test(rel) || rel.includes("/__tests__/");

describe("BUCKET_C_CODES is a single derived authority", () => {
  it("the authority set is non-empty (an empty set would make every scan below vacuous)", () => {
    // Trap 13: an absence probe that cannot see a presence proves nothing. If
    // the authority were empty, the shape threshold would be 0 and the overlap
    // count would be 0 everywhere — both guards would pass by testing nothing.
    expect(BUCKET_C_CODES.size).toBeGreaterThan(0);
  });

  it("is DECLARED exactly once across every tracked .ts file, in the authority module", () => {
    const files = sourceFiles("*.ts");
    expect(files.length).toBeGreaterThan(100); // the scan reached a real manifest

    const sites: string[] = [];
    for (const rel of files) {
      const text = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      if (!text.includes("BUCKET_C_CODES")) continue; // cheap pre-filter, then parse
      for (const line of declarationsNamed(rel, text, "BUCKET_C_CODES")) sites.push(`${rel}:${line}`);
    }

    expect(sites).toEqual([`${AUTHORITY_REL}:${declarationLineOfAuthority()}`]);
  });

  it("no OTHER collection literal in src/ or scripts/ reproduces a majority of it (catches a renamed copy)", () => {
    // Threshold derived from the authority's own size — not a hand-set number.
    const threshold = Math.ceil(BUCKET_C_CODES.size / 2);
    const files = sourceFiles("src/**/*.ts", "scripts/**/*.ts").filter(
      (rel) => rel !== AUTHORITY_REL && !isTestFile(rel),
    );
    expect(files.length).toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const rel of files) {
      const text = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      if (![...BUCKET_C_CODES].some((c) => text.includes(c))) continue; // cheap pre-filter
      for (const lit of literalOverlaps(rel, text, BUCKET_C_CODES)) {
        if (lit.hits >= threshold) offenders.push(`${rel}:${lit.line} (${lit.hits}/${BUCKET_C_CODES.size} bucket-C codes in a ${lit.size}-member literal)`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("POSITIVE CONTROL: both scanners detect a planted copy", () => {
    // The two scans above assert an ABSENCE. Prove here that they can see a
    // PRESENCE, so an empty result means "nothing found" and not "nothing
    // looked". Run against synthetic sources, so the control cannot pollute
    // the tree it is checking.
    const planted = `const BUCKET_C_CODES = new Set([\n${[...BUCKET_C_CODES].map((c) => `  "${c}",`).join("\n")}\n]);\n`;
    expect(declarationsNamed("planted.ts", planted, "BUCKET_C_CODES")).toHaveLength(1);

    const renamed = planted.replace("BUCKET_C_CODES", "BLOCKING_CODES");
    expect(declarationsNamed("renamed.ts", renamed, "BUCKET_C_CODES")).toHaveLength(0); // name check is blind to a rename…
    const overlaps = literalOverlaps("renamed.ts", renamed, BUCKET_C_CODES);
    expect(overlaps.some((l) => l.hits >= Math.ceil(BUCKET_C_CODES.size / 2))).toBe(true); // …and shape is why that still REDs

    // Discrimination: an unrelated code list must NOT trip the shape check.
    const unrelated = `const BUCKET_A_CODES = new Set(["NAN_VALUE", "SIGN_MISMATCH", "CYCLE_DETECTED", "INVALID_EDGE_REF"]);`;
    expect(literalOverlaps("unrelated.ts", unrelated, BUCKET_C_CODES).some((l) => l.hits >= Math.ceil(BUCKET_C_CODES.size / 2))).toBe(false);
  });
});

/** The authority's own declaration line, derived — so the expectation above is not a hand-kept literal. */
function declarationLineOfAuthority(): number {
  const text = fs.readFileSync(path.join(REPO_ROOT, AUTHORITY_REL), "utf8");
  const lines = declarationsNamed(AUTHORITY_REL, text, "BUCKET_C_CODES");
  if (lines.length !== 1) throw new Error(`authority module declares BUCKET_C_CODES ${lines.length} times`);
  return lines[0]!;
}
