/**
 * ROADMAP 2.972 follow-up — A NEW CURRENCY VOCABULARY IN `src/` FORCES A REVIEW.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * `utils/__tests__/magnitude-alphabet.union.test.ts` exists because fifteen
 * hand-written MAGNITUDE tables accumulated in this service and eight were
 * measurably wrong, each by a factor of 10^3 to 10^12. It caught a sixteenth
 * attempt in CI, in the same diff this guard was written for.
 *
 * There was no equivalent guard for the CURRENCY vocabulary — which is exactly
 * why a second one shipped unobserved. `cee/context-integrity/`
 * `not-modelled-manifest.ts` carried `CURRENCY_SYMBOLS = ["£","€","$"]` and a
 * private `parseUnit`, three months after `CURRENCY_SYMBOL_TO_CODE` was
 * exported under 2.972 with a header saying in terms that "a second
 * hand-written currency vocabulary is exactly the mirror CLAUDE.md trap 12
 * describes". Two live defects followed (`unit: "GBP"` unmatchable; `A$m`
 * mis-scaled as `$` x1). Review did not catch it either time. A guard does.
 *
 * ── WHAT THIS GUARD CLAIMS, AND WHAT IT CANNOT ─────────────────────────────
 * It claims: every file in `src/` that spells TWO OR MORE distinct currency
 * symbols as QUOTED TOKENS within a short window has been looked at by a human
 * and classified. That is a DETECTION guard, and detection is all a scan can
 * honestly offer (trap 12d: a derived guard proves agreement and can never
 * prove completeness).
 *
 * It does NOT claim the estate has one currency vocabulary. It measurably does
 * not: the manifest below records SEVEN further hand-written currency lists
 * that disagree with each other and with the canonical map. Folding them in is
 * a behaviour change per call site and is rowed separately — pretending
 * otherwise here would be the "pre-blessed false label" of trap 7b, inside the
 * guard built to prevent it. What this guard buys is that the EIGHTH cannot
 * arrive silently.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

import { CURRENCY_SYMBOL_TO_CODE } from "../numeric-parser.js";

const SRC_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SCAN_TIMEOUT_MS = 30_000;

/**
 * The symbols a vocabulary is built from. Derived from the canonical map's own
 * keys — single-character ones only, because the multi-character keys (`A$`,
 * `C$`, `NZ$`, `CHF`, `kr`) contain or are ordinary words and would make the
 * detector fire on prose.
 */
const DETECTABLE_SYMBOLS: readonly string[] = Object.keys(CURRENCY_SYMBOL_TO_CODE).filter(
  (k) => [...k].length === 1 && !/[a-z]/i.test(k),
);

/** Lines within which quoted currency tokens count as ONE vocabulary. */
const WINDOW = 12;

/** A quoted short token: `"£"`, `'A$'`, `` `€` `` — the shape a vocabulary entry takes. */
const QUOTED_TOKEN = /(?:"([^"]{0,4})"|'([^']{0,4})'|`([^`]{0,4})`)/g;

/** Currency tokens quoted on one line, ignoring comment lines. */
export function quotedCurrencyTokensOnLine(line: string): string[] {
  if (/^\s*(\/\/|\*|\/\*)/.test(line)) return [];
  const found: string[] = [];
  for (const m of line.matchAll(QUOTED_TOKEN)) {
    const t = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (t.length > 0 && DETECTABLE_SYMBOLS.some((s) => t.includes(s))) found.push(t);
  }
  return found;
}

/** Does this source text carry a multi-symbol currency vocabulary? */
export function carriesCurrencyVocabulary(source: string): boolean {
  const per = source.split("\n").map(quotedCurrencyTokensOnLine);
  for (let i = 0; i < per.length; i++) {
    const seen = new Set<string>();
    for (let j = i; j < Math.min(per.length, i + WINDOW); j++) {
      for (const t of per[j]!) seen.add(t);
    }
    if (seen.size >= 2) return true;
  }
  return false;
}

/**
 * Files reviewed at `4f171486` + this PR, each classified.
 *
 * ⚠ EVERY REASON HERE WAS READ AT THE BYTES, NOT INFERRED FROM THE FILENAME.
 * The magnitude guard's own manifest shipped two FALSE entries ("carries no
 * multiplier") that an adversarial review had to catch — a registry entry that
 * teaches the checker to stop looking is trap 7b's exact shape.
 */
const REVIEWED: Readonly<Record<string, string>> = {
  // ── THE CANONICAL VOCABULARY ─────────────────────────────────────────────
  "cee/extraction/numeric-parser.ts":
    "THE canonical map (`CURRENCY_MAP` / `CURRENCY_SYMBOL_TO_CODE`, 10 entries), exported " +
    "under 2.972 as the one currency vocabulary. ⚠ It also holds a PRIVATE 5-entry inverse " +
    "(`getCurrencySymbol`'s `reverseMap`: GBP/USD/EUR/JPY/INR) that is NOT derived from it and " +
    "is short by five — a real finding from this scan, rowed rather than changed here because " +
    "inverting the map alters what that formatter emits for A$/C$/NZ$/CHF/kr.",

  // ── SYMBOL <-> CODE LOOKUPS THAT DISAGREE WITH THE CANONICAL MAP ─────────
  "cee/signals/currency-signal.ts":
    "code -> {symbol, code} map, 5 entries (GBP/USD/EUR/AUD/CAD). AGREES with the canonical " +
    "map on all 5 (asserted in Part A below) but is hand-written and short by five.",
  "orchestrator/tools/draft-graph.ts":
    "an INLINE re-spelling of currency-signal.ts's 5-entry map inside `signalFromCurrencyCode`. " +
    "Function-local, so nothing can import it and no derived guard can compare it.",
  "cee/factor-extraction/display-value.ts":
    "`CURRENCY_SYMBOLS` recognition Set mixing symbols and ISO codes " +
    "(£/$/€/¥/₹/GBP/USD/EUR), plus a symbol->prefix ladder in `currencyPrefix`.",
  "cee/factor-extraction/enricher.ts":
    "inline recognition array (£/$/€/GBP/USD/EUR) used to classify a factor as currency.",
  "cee/factor-extraction/merge.ts":
    "`UNIT_COMPATIBILITY_GROUPS.currency` — a unit-FAMILY list that deliberately includes WORD " +
    "forms (dollar/pound/euro) absent from the canonical map. A union assertion against the " +
    "canonical keys would RED on those words today; word-form currency is a known coverage gap " +
    "(named in `provenance/stated-amounts.ts`'s false-negative list) and is rowed, not silently " +
    "widened here.",
  "cee/compound-goal/node-generator.ts":
    "inline `[\"£\",\"$\",\"€\"]` recognition test before formatting a currency display string.",
  "orchestrator-v5/compose/format-factor-value.ts":
    "`CURRENCY_SYMBOL` display map (symbol->symbol plus gbp/usd/eur->symbol) — a FORMATTER's " +
    "3-currency ladder, not a parser.",
  "orchestrator-v5/tools/handlers/d1-shared/format-confirmation.ts":
    "`PREFIX_UNITS` Set (£/$/€/¥) — spacing policy for rendering, no code mapping at all.",

  // ── NOT VOCABULARIES: the detector's own false positives, each read ───────
  "cee/factor-extraction/index.ts":
    "no currency list. The window catches two unrelated quoted tokens; the amount pattern's " +
    "currency class is the inline regex `[£$€]` and its magnitudes come from the canonical " +
    "alphabet.",
  "orchestrator-v5/context/cqe/rules.ts":
    "`normaliseCurrencyUnit` maps £/gbp/grand/quid->GBP, $/usd->USD, €/eur->EUR. A genuine " +
    "symbol->code sibling, private to the module; its regex source " +
    "(`CURRENCY_SYMBOL_SOURCE`) IS exported and is the one other files derive from.",
  "orchestrator-v5/routing/deterministic-value-update.ts":
    "a `switch` over CQE unit STRINGS ('GBP'/'percentage'/…) mapping to display units. Consumes " +
    "cqe/rules.ts's output vocabulary; spells no symbol list of its own.",
  "orchestrator-v5/routing/value-unit-resolution.ts":
    "`UnitFamily` token->family map. Currency tokens appear as family members, not as a " +
    "symbol->code lookup.",
};

describe("ROADMAP 2.972 — the canonical currency map is the one this repo derives from", () => {
  it("PRECONDITION — the canonical map is non-trivial and the detector can see it", () => {
    // Trap 13 / trap 20: prove the instrument discriminates BEFORE trusting a
    // clean result. A detector blind to the known vocabulary would return the
    // same empty output as a detector that looked and found nothing.
    expect(Object.keys(CURRENCY_SYMBOL_TO_CODE).length).toBe(10);
    // Copy before sorting: `DETECTABLE_SYMBOLS` is `readonly`, and `sort()`
    // mutates in place (caught by the `Typecheck Drift` CI job, which types the
    // test tree that `tsconfig.build.json` excludes).
    expect([...DETECTABLE_SYMBOLS].sort()).toEqual(["£", "¥", "₹", "€", "$"].sort());

    const canonical = readFileSync(join(SRC_ROOT, "cee/extraction/numeric-parser.ts"), "utf8");
    expect(
      carriesCurrencyVocabulary(canonical),
      "the detector cannot see the canonical map itself — it is blind",
    ).toBe(true);
  });

  it("the detector BITES on a rogue copy and stays quiet on ordinary code", () => {
    // The discriminating pair (trap 19). Neither half alone shows anything: the
    // first proves sensitivity, the second proves it is not just always-true.
    expect(carriesCurrencyVocabulary('const CURRENCY_SYMBOLS = ["£", "€", "$"] as const;')).toBe(
      true,
    );
    // …including the MULTI-LINE object shape a real copy takes.
    expect(
      carriesCurrencyVocabulary(['const M = {', '  "£": "GBP",', '  "$": "USD",', "};"].join("\n")),
    ).toBe(true);

    expect(carriesCurrencyVocabulary('const price = `£${n}`;')).toBe(false);
    expect(carriesCurrencyVocabulary("const RE = /[£$€]/;")).toBe(false);
    expect(carriesCurrencyVocabulary('// prose naming "£" and "$" together')).toBe(false);
    // Two tokens far apart are two mentions, not one vocabulary.
    expect(
      carriesCurrencyVocabulary(['const a = "£";', ...Array(WINDOW + 2).fill(""), 'const b = "$";'].join("\n")),
    ).toBe(false);
  });

  it("the module this guard was written for no longer carries a vocabulary", () => {
    // The regression pin. `not-modelled-manifest.ts` is the file whose copy
    // this PR deleted; if a currency list returns there, this REDs by name.
    const target = readFileSync(
      join(SRC_ROOT, "cee/context-integrity/not-modelled-manifest.ts"),
      "utf8",
    );
    expect(carriesCurrencyVocabulary(target)).toBe(false);
  });
});

describe("ROADMAP 2.972 — every symbol->code sibling AGREES with the canonical map", () => {
  /**
   * The union assertion (trap 12d). Only ONE sibling is importable —
   * `currency-signal.ts`'s map is module-private, so this reads it from disk
   * and compares the pairs it spells. Every other sibling is function-local or
   * private, which is itself the finding: a private sibling is a sibling no
   * derived guard can check, exactly as the magnitude alphabet's header says.
   */
  it("currency-signal.ts spells no pair the canonical map contradicts", () => {
    const src = readFileSync(join(SRC_ROOT, "cee/signals/currency-signal.ts"), "utf8");
    const pairs = [...src.matchAll(/(\w{3}):\s*\{\s*symbol:\s*"([^"]+)",\s*code:\s*"(\w{3})"/g)];
    // Non-vacuity: if the shape ever changes, this must fail loudly rather
    // than iterate an empty list and agree with nothing (trap 13b).
    expect(pairs.length, "parsed no pairs from currency-signal.ts — the guard is blind").toBe(5);
    for (const [, key, symbol, code] of pairs) {
      expect(key, "the map key must be its own code").toBe(code);
      expect(
        CURRENCY_SYMBOL_TO_CODE[symbol!],
        `currency-signal.ts maps ${symbol} -> ${code}; the canonical map disagrees`,
      ).toBe(code);
    }
  });
});

describe("ROADMAP 2.972 — a new currency vocabulary in src/ forces a review", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["__tests__", "generated", "node_modules"].includes(entry.name)) continue;
        walk(full, out);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        out.push(full);
      }
    }
    return out;
  }

  let cache: { files: string[]; unreviewed: string[] } | null = null;
  function scanSrc(): { files: string[]; unreviewed: string[] } {
    if (cache !== null) return cache;
    const files = walk(SRC_ROOT);
    const unreviewed: string[] = [];
    for (const file of files) {
      const rel = relative(SRC_ROOT, file);
      if (rel in REVIEWED) continue;
      // `readFileSync` + regex, deliberately NOT `grep`: CLAUDE.md trap 17 —
      // plain grep is silently blind to NUL-bearing source files, and this repo
      // has at least one (`orchestrator-v5/handlers/edit-graph-referee-gate.ts`,
      // verified to carry 1 NUL byte at this tip).
      if (carriesCurrencyVocabulary(readFileSync(file, "utf8"))) unreviewed.push(rel);
    }
    cache = { files, unreviewed };
    return cache;
  }

  it("every src/ file carrying a currency vocabulary has been reviewed", () => {
    const { files, unreviewed } = scanSrc();
    expect(
      files.length,
      "the src/ walk found no TypeScript files — the scan is not running",
    ).toBeGreaterThan(100);

    expect(
      unreviewed,
      `These src/ files spell a multi-symbol currency vocabulary but are not in this guard's ` +
        `REVIEWED manifest:\n` +
        unreviewed.map((f) => `  - ${f}`).join("\n") +
        `\n\nEach is either (a) a NEW currency lookup, which must instead DERIVE from ` +
        `CURRENCY_SYMBOL_TO_CODE in cee/extraction/numeric-parser.ts, or (b) a genuine ` +
        `exception, which must be added to REVIEWED with a reason READ AT THE BYTES. ` +
        `Do not delete this assertion: it is the only thing standing between this estate and ` +
        `the currency version of the fifteen magnitude tables.`,
    ).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  it("the REVIEWED manifest has no stale entries", () => {
    const files = new Set(scanSrc().files.map((f) => relative(SRC_ROOT, f)));
    for (const rel of Object.keys(REVIEWED)) {
      expect(files.has(rel), `REVIEWED lists ${rel}, which no longer exists in src/`).toBe(true);
    }
  }, SCAN_TIMEOUT_MS);

  it("every REVIEWED entry carries a non-trivial reason", () => {
    // Stops the manifest degrading into a list of paths with "ok" beside them —
    // which is how the magnitude guard's two false entries got in.
    for (const [rel, reason] of Object.entries(REVIEWED)) {
      expect(reason.length, `${rel}: reason is too short to be a review`).toBeGreaterThan(40);
    }
  });
});
