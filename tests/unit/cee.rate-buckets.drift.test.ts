import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { RATE_BUCKET_REGISTRY } from "../../src/cee/config/limits.js";

/**
 * Derive-don't-mirror guard. RATE_BUCKET_REGISTRY is the single source of truth
 * for route → cost tier, and this test polices it in BOTH directions from ONE
 * scan of the source tree (CLAUDE.md trap #12: a hand-maintained mirror must
 * fail on drift, never assume-good).
 *
 *   FORWARD  — every env var handed to a limiter helper must be registered, so
 *              a new route that forgets to register its tier cannot silently
 *              fall to the fail-safe default.
 *   REVERSE  — every registry entry must still be referenced somewhere under
 *              `src/`, so an entry whose route has been DELETED cannot sit
 *              there forever reading as green.
 *
 * The reverse direction was missing until ROADMAP 2.213 proved it was needed:
 * `/assist/v1/key-insight` and `/assist/v1/generate-recommendation` were
 * deleted, and CEE_KEY_INSIGHT_RATE_LIMIT_RPM /
 * CEE_GENERATE_RECOMMENDATION_RATE_LIMIT_RPM survived in the registry with zero
 * readers until someone removed them BY HAND. The hand-removal is the tell —
 * the guard could not see it.
 */
describe("rate bucket registry drift", () => {
  const SRC = fileURLToPath(new URL("../../src", import.meta.url));
  const LIMITS_REL = "cee/config/limits.ts";

  // Not route env vars: the fail-safe constant and the per-tier override knobs.
  const isTierKnob = (n: string) =>
    /^CEE_RATE_BUCKET_(DRAFT|COACH|READ)_RPM$/.test(n);
  const isNotARouteVar = (n: string) =>
    n === "CEE_DEFAULT_FEATURE_RATE_LIMIT_RPM" || isTierKnob(n);

  /**
   * ONE walk of the source tree feeding BOTH directions.
   *
   *  - `atLimiter`  — env vars passed to a limiter helper, in either shape:
   *      · positional:  resolveCeeRateLimit(feature, "CEE_X_RATE_LIMIT_RPM")
   *      · options-obj: { ..., envVarName: "CEE_X_RATE_LIMIT_RPM", ... }
   *    The options-object shape was previously UNMATCHED, so two live routes
   *    (draft-graph-stream, draft-graph-staged) were invisible to the forward
   *    direction — a route using that shape and forgetting to register would
   *    have passed. Adding it widens the forward check too.
   *
   *  - `anywhere`   — every `CEE_*_RATE_LIMIT_RPM` token, whatever the shape.
   *    The reverse direction uses this deliberately WIDER set: an entry is
   *    "still in use" if anything under `src/` names it, including the config
   *    seam (`env.CEE_DECISION_REVIEW_RATE_LIMIT_RPM` in config/index.ts,
   *    whose routes read `config.cee.decisionReviewRateLimitRpm` rather than
   *    calling a limiter helper). The defect being caught is a DELETED route,
   *    which leaves zero references of any shape — so the wide set is the
   *    right instrument and does not manufacture false REDs for routes that
   *    are merely wired through a different seam.
   */
  function collect(
    dir: string,
    acc: { atLimiter: Map<string, string>; anywhere: Map<string, string[]> },
  ): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "generated" && entry.name !== "__tests__") collect(p, acc);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      const text = readFileSync(p, "utf8");
      const rel = p.slice(SRC.length + 1);

      // Match the env-var string argument to either limiter helper. `[^)]` spans
      // newlines, so the two-line getCeeFeatureRateLimiter(feature, envVar) form
      // is covered; the CEE_..._RATE_LIMIT_RPM shape excludes the feature name.
      const reLimiter =
        /(?:resolveCeeRateLimit|getCeeFeatureRateLimiter)\([^)]*?"(CEE_[A-Z_]*RATE_LIMIT_RPM)"/g;
      let m: RegExpExecArray | null;
      while ((m = reLimiter.exec(text)) !== null) acc.atLimiter.set(m[1], p);

      const reEnvVarName = /envVarName:\s*"(CEE_[A-Z_]*RATE_LIMIT_RPM)"/g;
      while ((m = reEnvVarName.exec(text)) !== null) acc.atLimiter.set(m[1], p);

      const reAny = /\bCEE_[A-Z_]*RATE_LIMIT_RPM\b/g;
      while ((m = reAny.exec(text)) !== null) {
        const list = acc.anywhere.get(m[0]) ?? [];
        if (!list.includes(rel)) list.push(rel);
        acc.anywhere.set(m[0], list);
      }
    }
  }

  function scan() {
    const acc = { atLimiter: new Map<string, string>(), anywhere: new Map<string, string[]>() };
    collect(SRC, acc);
    return acc;
  }

  /**
   * Parse the registry block out of limits.ts so the RESERVED exemption can be
   * DERIVED from the entry's own definition site rather than from a hand-listed
   * allowlist in this file (an allowlist here would just recreate the mirror
   * this test exists to kill). Returns every entry with the contiguous comment
   * block immediately above it.
   */
  function parseRegistrySource(): Array<{ name: string; reserved: boolean }> {
    const text = readFileSync(`${SRC}/${LIMITS_REL}`, "utf8");
    const body = text
      .split("export const RATE_BUCKET_REGISTRY")[1]
      .split("\n};")[0];
    const lines = body.split("\n");
    const out: Array<{ name: string; reserved: boolean }> = [];
    for (let i = 0; i < lines.length; i++) {
      const m = /^\s+(CEE_[A-Z_]+):\s*"/.exec(lines[i]);
      if (!m) continue;
      let reserved = false;
      for (let j = i - 1; j >= 0; j--) {
        const t = lines[j].trim();
        if (!t.startsWith("//")) break; // end of the contiguous comment block
        if (/\bRESERVED\b/.test(t)) reserved = true;
      }
      out.push({ name: m[1], reserved });
    }
    return out;
  }

  it("every route-referenced rate-limit env var is registered", () => {
    const { atLimiter } = scan();

    // Sanity: the scan must actually find the known env vars (positive control —
    // an absence assertion is vacuous if it can't see a presence).
    expect(atLimiter.has("CEE_DRAFT_RATE_LIMIT_RPM")).toBe(true);
    expect(atLimiter.size).toBeGreaterThan(10);

    const unregistered: string[] = [];
    for (const [name, file] of atLimiter) {
      if (isNotARouteVar(name)) continue;
      if (!(name in RATE_BUCKET_REGISTRY)) unregistered.push(`${name} — ${file}`);
    }
    expect(unregistered).toEqual([]);
  });

  it("the limiter scan sees the options-object shape, not just the positional one", () => {
    // Positive control for the widened matcher. draft-graph-stream.ts wires its
    // limiter with `envVarName: "CEE_STREAM_RATE_LIMIT_RPM"`; before this shape
    // was matched, that whole call form was invisible to the forward direction.
    const { atLimiter } = scan();
    expect(atLimiter.has("CEE_STREAM_RATE_LIMIT_RPM")).toBe(true);
  });

  it("the registry source parses cleanly (control for the RESERVED derivation)", () => {
    // If limits.ts is ever reformatted such that the entry regex stops matching,
    // the reverse assertion below would silently exempt — or silently skip —
    // entries. Pin the parse against the imported object so a parser break is
    // LOUD rather than quietly vacuous.
    const parsed = parseRegistrySource();
    expect(parsed.map((e) => e.name).sort()).toEqual(
      Object.keys(RATE_BUCKET_REGISTRY).sort(),
    );
    expect(parsed.length).toBeGreaterThan(10);
  });

  it("every registry entry is still referenced under src/ (no entry outlives its route)", () => {
    const { anywhere } = scan();
    const parsed = parseRegistrySource();

    // Positive controls — the reverse assertion must be able to SEE a presence
    // before it is allowed to assert an absence (trap 13).
    expect(anywhere.has("CEE_DRAFT_RATE_LIMIT_RPM")).toBe(true);
    expect(
      (anywhere.get("CEE_DRAFT_RATE_LIMIT_RPM") ?? []).some((f) => f !== LIMITS_REL),
    ).toBe(true);
    expect(anywhere.size).toBeGreaterThan(10);

    const referencedOutsideLimits = (name: string) =>
      (anywhere.get(name) ?? []).some((f) => f !== LIMITS_REL);

    const orphaned: string[] = [];
    for (const { name, reserved } of parsed) {
      if (isNotARouteVar(name) || reserved) continue;
      if (!referencedOutsideLimits(name)) {
        orphaned.push(
          `${name} — in RATE_BUCKET_REGISTRY but referenced nowhere under src/ ` +
            `outside ${LIMITS_REL}. Its route was probably deleted: remove the ` +
            `entry, or mark it RESERVED at its definition if it is intentional.`,
        );
      }
    }
    expect(orphaned).toEqual([]);
  });

  it("a RESERVED marker cannot outlive its reason", () => {
    // The exemption above is self-policing in the other direction: once a
    // RESERVED entry IS wired up, the marker is stale and must go. Without this,
    // RESERVED would be a permanent opt-out — a one-entry allowlist wearing a
    // comment, i.e. the mirror again.
    const { anywhere } = scan();
    const stale = parseRegistrySource()
      .filter((e) => e.reserved)
      .filter((e) => (anywhere.get(e.name) ?? []).some((f) => f !== LIMITS_REL))
      .map(
        (e) =>
          `${e.name} — marked RESERVED but now referenced under src/; remove the marker.`,
      );
    expect(stale).toEqual([]);
  });
});
