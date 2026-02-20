/**
 * Import guard: no file outside src/_archive/ may import from _archive/.
 *
 * Prevents accidental re-coupling after archival.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

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
      const content = readFileSync(file, "utf-8");
      if (content.includes("/_archive/")) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });
});
