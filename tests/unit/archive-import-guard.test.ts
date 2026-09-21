/**
 * Import guard: no file outside src/_archive/ may import from _archive/.
 *
 * Prevents accidental re-coupling after archival.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "fs";
import { join } from "path";

import { stripCommentsFile, GUARD_WALK_TIMEOUT_MS } from "../../scripts/ci/strip-source-comments.mjs";

/** Recursively collect .ts/.tsx/.js files, skipping directories matching `skip`. */
function walkDir(dir: string, skip: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (full.includes(skip)) continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkDir(full, skip));
    } else if (/\.(ts|tsx|js)$/.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

describe("Archive import guard", () => {
  it("no file outside src/_archive/ imports from _archive/", () => {
    const files = walkDir("src", "_archive");
    const violations: string[] = [];
    for (const file of files) {
      // Comment-stripped view (scripts/ci/strip-source-comments.mjs): a
      // comment pointing at an archived file ("superseded implementation
      // retained at src/_archive/…") is exactly the documentation archival
      // should leave behind, and must not read as re-coupling. A real
      // import's module specifier is a STRING LITERAL, which the stripped
      // view keeps, so genuine violations still fail.
      const content = stripCommentsFile(file);
      if (content.includes("/_archive/")) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  }, GUARD_WALK_TIMEOUT_MS); // full-src tree walk; explicit timeout absorbs parallel-load CPU contention
});
