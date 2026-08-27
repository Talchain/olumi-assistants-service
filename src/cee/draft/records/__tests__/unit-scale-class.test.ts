import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyUnitScaleClass,
  isPercentScaledUnit,
  isBasisPointsUnit,
  deriveFactorScaleFrame,
} from "../projector.js";

/**
 * ONE SCALE-CLASSIFICATION AUTHORITY, FOUR CLASSES — replacing two overlapping
 * predicates whose contract could not describe the domain.
 *
 * ⚠ THE MEASUREMENT THAT NAMED FOUR CLASSES, NOT THREE (derived at CEE 3ab35d34
 * and PLoT 12d4389, every spelling, both directions):
 *
 *   percent            x100      '%' 'percent' 'per cent' 'pct' 'percentage'
 *   percentage points  x1        'pp' 'ppt' 'pps' 'percentage point(s)'
 *   basis points       x0.0001   'bps' 'basis point(s)'
 *   unknown            no claim  everything else, INCLUDING tailed spellings
 *
 * WHAT WAS WRONG BEFORE, measured and reproduced below:
 *  (a) `isPercentScaledUnit` matched by `startsWith`, so 'percentage points' —
 *      a x1 class — was claimed as percent. That is INVENTING a conversion.
 *  (b) the same `startsWith` silently claimed '% NRR' and '%-of-ARR', so a
 *      labelled ratio quietly acquired percent framing.
 *  (c) 'pp' / 'ppt' / 'pps' matched NOTHING in either repo — a homeless class.
 *
 * ⚠ BARE 'bp' IS DELIBERATELY UNKNOWN, and that is inherited, not invented: the
 * original `isBasisPointsUnit` argued it explicitly ("a bare 'bp' is left to the
 * derived frame rather than guessed"). Suppress-rather-than-guess. Do not add it
 * without refuting that argument.
 *
 * ⚠⚠ `unit === '%'` IS NEVER SUFFICIENT, AND NEITHER IS THIS CLASSIFIER ALONE.
 * The producer's convention is MAGNITUDE-DEPENDENT: CEE's extractor emits "4%" as
 * `{value: 0.04, unit: '%'}` — a FRACTION under a '%' label — while a '%' value
 * `>= 1` IS percentage points. PLoT documents this at
 * `intervention-normaliser.ts:1153-1180`, citing CEE's own
 * `compound-goal/extractor.ts:925-934`. Any caller converting a magnitude must
 * read the VALUE as well as the unit. Never re-add a bare equality on the unit.
 */

const REPO_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

describe("classifyUnitScaleClass — four classes, exact match, no inference", () => {
  it("PERCENT: every canonical spelling, case-insensitively", () => {
    for (const u of ["%", "percent", "per cent", "pct", "percentage", "Percent", "PCT", "  %  "]) {
      expect(classifyUnitScaleClass(u), u).toBe("percent");
    }
  });

  it("OPPOSITE-DIRECTION TWIN: percentage points is its OWN class, never percent", () => {
    // This is the x100 lie the old startsWith predicate shipped.
    for (const u of ["pp", "ppt", "pps", "percentage point", "percentage points", "Percentage Points"]) {
      expect(classifyUnitScaleClass(u), u).toBe("percentage_points");
      expect(classifyUnitScaleClass(u), u).not.toBe("percent");
    }
  });

  it("BASIS POINTS: keeps the behaviour CEE already had right", () => {
    for (const u of ["bps", "basis point", "basis points", "BPS", "Basis Points"]) {
      expect(classifyUnitScaleClass(u), u).toBe("basis_points");
    }
  });

  it("OPPOSITE-DIRECTION TWIN: a bare 'bp' stays UNKNOWN, deliberately", () => {
    expect(classifyUnitScaleClass("bp")).toBe("unknown");
  });

  it("UNKNOWN: a tailed spelling must NOT silently acquire a scale", () => {
    for (const u of ["% NRR", "%-of-ARR", "percent of ARR", "percentage of revenue", "bps spread"]) {
      expect(classifyUnitScaleClass(u), u).toBe("unknown");
    }
  });

  it("UNKNOWN: unsupported, empty and non-string units fail visibly, not by default", () => {
    for (const u of ["widgets", "flurbs", "bananas per fortnight", "", "   "]) {
      expect(classifyUnitScaleClass(u), JSON.stringify(u)).toBe("unknown");
    }
    expect(classifyUnitScaleClass(undefined)).toBe("unknown");
  });

  it("OPPOSITE-DIRECTION TWIN: the other unit families are UNKNOWN to this classifier", () => {
    // ratio / count / currency / time must not be claimed by a percent-family classifier.
    for (const u of ["ratio", "fraction", "count", "people", "£", "$", "GBP", "months", "weeks", "years"]) {
      expect(classifyUnitScaleClass(u), u).toBe("unknown");
    }
  });

  it("the classifier DISCRIMINATES (it is not returning one answer for everything)", () => {
    const answers = new Set(
      ["%", "pp", "bps", "widgets"].map((u) => classifyUnitScaleClass(u)),
    );
    expect(answers.size).toBe(4);
  });
});

describe("deriveFactorScaleFrame — the single consumer, behaviour pinned", () => {
  it("percent frames at 100 when the magnitudes fit", () => {
    expect(deriveFactorScaleFrame([20, 40, 60], "%")).toBe(100);
    expect(deriveFactorScaleFrame([20, 40, 60], "per cent")).toBe(100);
  });

  it("basis points frame at 10000", () => {
    expect(deriveFactorScaleFrame([30, 250], "bps")).toBe(10000);
  });

  it("OPPOSITE-DIRECTION TWIN: percentage points do NOT take the percent frame", () => {
    // The old predicate returned 100 here by matching `startsWith('percent')`.
    // pp is x1: it must fall through to the honestly-derived ladder instead.
    expect(deriveFactorScaleFrame([10, 20, 30], "percentage points")).toBe(50);
    expect(deriveFactorScaleFrame([10, 20, 30], "%")).toBe(100); // the discriminating partner
  });

  it("OPPOSITE-DIRECTION TWIN: a tailed spelling does NOT take the percent frame", () => {
    expect(deriveFactorScaleFrame([10, 20, 30], "% NRR")).toBe(50);
    expect(deriveFactorScaleFrame([10, 20, 30], "per cent")).toBe(100); // the discriminating partner
  });

  it("POSITIVE CONTROL + preserved invariants: unit-interval and negatives unchanged", () => {
    expect(deriveFactorScaleFrame([0.2, 0.9], "%")).toBeUndefined(); // already unit interval
    expect(deriveFactorScaleFrame([-5, 10], "%")).toBeUndefined(); // negative -> no truthful frame
    expect(deriveFactorScaleFrame([], "%")).toBeUndefined();
  });

  it("the legacy predicates still answer their own question (kept, delegating)", () => {
    expect(isPercentScaledUnit("%")).toBe(true);
    expect(isBasisPointsUnit("bps")).toBe(true);
    // and they no longer disagree with the classifier
    expect(isPercentScaledUnit("percentage points")).toBe(false);
    expect(isPercentScaledUnit("% NRR")).toBe(false);
  });
});

/**
 * KNOWN-UNMIGRATED: the inline `unit === '%'` sites.
 *
 * 41 CODE SITES across 21 files, re-derived at base 4362fae8 (staging with #1154 merged). They are NOT migrated here, on purpose:
 * `findings` derived that the x100/÷100 sites among them are fed by the regex
 * extractor, whose unit output domain is CLOSED to { '%', a currency symbol,
 * undefined } — its only unit capture group is literally `(?<unit>%)?`. An exact
 * equality is therefore CORRECT AND COMPLETE for that producer, and migrating it
 * would be churn with non-zero risk and no harm removed.
 *
 * The set is pinned so it REDs if it GROWS (a new bare equality is added) or
 * SHRINKS (one is migrated without recording it). A gap recorded in the suite is
 * honest; a gap invisible to it is how this class reopens.
 */
const KNOWN_INLINE_PERCENT_EQUALITY_SITES: Readonly<Record<string, number>> = {
  "cee/compound-goal/direction-gate.ts": 3,
  "cee/compound-goal/extractor.ts": 1,
  "cee/compound-goal/node-generator.ts": 1,
  "cee/decision-review/shape-check.ts": 1,
  "cee/factor-extraction/display-value.ts": 7,
  "cee/factor-extraction/enricher.ts": 3,
  "cee/factor-extraction/index.ts": 4,
  "cee/transforms/graph-data-integrity.ts": 2,
  "cee/unified-pipeline/stages/repair/deterministic-sweep.ts": 1,
  "cee/unified-pipeline/stages/repair/unreachable-factors.ts": 3,
  "orchestrator-v5/compose/validation-failure-responses.ts": 1,
  "orchestrator-v5/compose/warrant-demotion.ts": 1,
  "orchestrator-v5/context/cqe/compromise-backstop.ts": 1,
  "orchestrator-v5/context/cqe/rules.ts": 1,
  "orchestrator-v5/handlers/describe-changeset.ts": 1,
  "orchestrator-v5/label-value-divergence.ts": 1,
  "orchestrator-v5/routing/resolve-relative-factor-delta.ts": 1,
  "orchestrator-v5/tools/handlers/add-constraint.ts": 3,
  "orchestrator-v5/tools/handlers/d1-shared/evaluate-factor-value-proposal.ts": 1,
  "orchestrator/canonicalise-value-ops.ts": 3,
  "utils/goal-threshold-cap.ts": 1,
};

function deriveInlinePercentEqualitySites(): Record<string, number> {
  const re = /=== *['"]%['"]/g;
  const out: Record<string, number> = {};
  // `withFileTypes` deliberately: reading the kind off the Dirent the directory
  // listing ALREADY returned removes the separate `statSync` and with it the
  // check-then-use pattern CodeQL correctly flagged here (js/file-system-race).
  // One syscall per entry instead of two, and nothing to race against.
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
      // CODE SITES ONLY. Comment lines are excluded: prose that MENTIONS the
      // pattern (including this module's own "do not re-add a bare equality" note)
      // is not a site, and counting it would make the pin drift on documentation edits.
      const n = readFileSync(full, "utf8")
        .split("\n")
        .filter((line) => {
          const t = line.trim();
          return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
        })
        .reduce((acc, line) => acc + (line.match(re) ?? []).length, 0);
      if (n > 0) out[relative(REPO_SRC, full)] = n;
    }
  };
  walk(REPO_SRC);
  return out;
}

describe("inline `unit === '%'` sites — pinned as an explicit KNOWN-UNMIGRATED set", () => {
  it("the scanner can SEE the pattern (positive control)", () => {
    const found = deriveInlinePercentEqualitySites();
    expect(Object.keys(found).length).toBeGreaterThan(10);
    const total = Object.values(found).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(30);
  });

  it("carries EXACTLY the known set — REDs if it GROWS or SHRINKS", () => {
    expect(deriveInlinePercentEqualitySites()).toEqual(KNOWN_INLINE_PERCENT_EQUALITY_SITES);
  });
});
