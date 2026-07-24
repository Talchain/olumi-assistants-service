import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { RATE_BUCKET_REGISTRY } from "../../src/cee/config/limits.js";

/**
 * Derive-don't-mirror guard. RATE_BUCKET_REGISTRY is the single source of truth
 * for route → cost tier. This test scans the source for every
 * `CEE_*_RATE_LIMIT_RPM` env var actually passed to a limiter helper
 * (resolveCeeRateLimit / getCeeFeatureRateLimiter) and fails LOUD if any is not
 * in the registry — so a new route that forgets to register its tier cannot
 * silently fall to the fail-safe default. (CLAUDE.md trap #12: a hand-maintained
 * mirror must fail on drift, never assume-good.)
 */
describe("rate bucket registry drift", () => {
  const SRC = fileURLToPath(new URL("../../src", import.meta.url));

  // Not route env vars: the fail-safe constant and the per-tier override knobs.
  const isTierKnob = (n: string) =>
    /^CEE_RATE_BUCKET_(DRAFT|COACH|READ)_RPM$/.test(n);

  function collect(dir: string, acc: Map<string, string>): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "generated" && entry.name !== "__tests__") collect(p, acc);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      const text = readFileSync(p, "utf8");
      // Match the env-var string argument to either limiter helper. `[^)]` spans
      // newlines, so the two-line getCeeFeatureRateLimiter(feature, envVar) form
      // is covered; the CEE_..._RATE_LIMIT_RPM shape excludes the feature name.
      const re =
        /(?:resolveCeeRateLimit|getCeeFeatureRateLimiter)\([^)]*?"(CEE_[A-Z_]*RATE_LIMIT_RPM)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) acc.set(m[1], p);
    }
  }

  it("every route-referenced rate-limit env var is registered", () => {
    const found = new Map<string, string>();
    collect(SRC, found);

    // Sanity: the scan must actually find the known env vars (positive control —
    // an absence assertion is vacuous if it can't see a presence).
    expect(found.has("CEE_DRAFT_RATE_LIMIT_RPM")).toBe(true);
    expect(found.size).toBeGreaterThan(10);

    const unregistered: string[] = [];
    for (const [name, file] of found) {
      if (name === "CEE_DEFAULT_FEATURE_RATE_LIMIT_RPM" || isTierKnob(name)) continue;
      if (!(name in RATE_BUCKET_REGISTRY)) unregistered.push(`${name} — ${file}`);
    }
    expect(unregistered).toEqual([]);
  });
});
