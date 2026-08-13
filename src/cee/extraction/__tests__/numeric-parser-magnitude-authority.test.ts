/**
 * ROADMAP 2.1130 — `numeric-parser` READS THE CANONICAL MAGNITUDE ALPHABET.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * `src/utils/magnitude-alphabet.ts` is the one place a magnitude key may be
 * written, and its own header names `cee/extraction/numeric-parser.ts` as the
 * sibling it took `thousand` and `mn` FROM. The debt was never paid in the
 * other direction: this module kept a private `MULTIPLIERS` map and spelled
 * the alphabet inline, five times, as `([kKmMbB]|thousand|million|billion)`.
 *
 * Two measured consequences at `dbd012eb`, both at `confidence: "high"`, both
 * live through `cee/extraction/intervention-extractor.ts`:
 *
 *   1. THE LIST IS SHORT. `grand`, `t` and `trillion` are canonical and absent
 *      here, so `parseNumericValue("£250 grand")` returned 250 — the exact
 *      1,000x under-read ROADMAP 2.330 was opened to close, still live in the
 *      module the canonical alphabet copied its own keys from.
 *
 *   2. THE ALTERNATION HAS NO `\b`, SO IT FABRICATES. This is the sharper half
 *      and it runs in the OPPOSITE direction — an over-read, at full
 *      confidence, on ordinary British business prose:
 *        "£20,000 migration cost" -> 20,000,000,000   (the 'm' of "migration")
 *        "£20,000 board approval" -> 20,000,000,000,000 (the 'b' of "board")
 *        "£100 base"              -> 100,000,000,000
 *        "£5 max"                 -> 5,000,000
 *      The canonical alphabet documents this exact defect (#787: the 't' of
 *      "THIS year" scaling 6,000,000 to 6e18) and closes it with the `\b`
 *      inside `magnitudeSuffixFragment`. This module never adopted it.
 *
 * ── WHY THE EXISTING UNION GUARD COULD NOT SEE EITHER ──────────────────────
 * `utils/__tests__/magnitude-alphabet.union.test.ts` Part A asserts
 * canonical ⊇ sibling ("every key is canonical"). A sibling that is SHORT
 * satisfies it by construction, and a sibling whose REGEX disagrees with its
 * own map is invisible to a key comparison entirely. That is trap 12d's second
 * face: a derived guard proves AGREEMENT and can never prove COMPLETENESS.
 *
 * So this file ships BOTH kinds, as the alphabet's own header requires:
 *   · PART A — a DERIVED equality, so a key added canonically is live here the
 *     instant it lands and this module can never again be short.
 *   · PART B — a DERIVED per-key behavioural sweep of `parseNumericValue`
 *     itself, because agreeing about a LIST is not resolving a STRING.
 *   · PART C — a HAND-WRITTEN corpus from outside the failure mode, which is
 *     the only thing able to notice a defect neither list can express (trap 22).
 *
 * ⚠ EVERY EXPECTATION IS WRITTEN AGAINST THE SPEC — "the amount is the
 * magnitude the writer stated" — never against the failure mode being fixed
 * (trap 13d). The corpus therefore carries amounts with NO magnitude suffix at
 * all, which is the class the `\b` defect corrupted, alongside amounts that
 * carry one.
 */

import { describe, it, expect } from "vitest";

import {
  MAGNITUDE_MULTIPLIERS,
  isKnownMagnitude,
  resolveMagnitude,
} from "../../../utils/magnitude-alphabet.js";
import { MULTIPLIERS, extractAllNumericValues, parseNumericValue } from "../numeric-parser.js";
import { findStatedAmounts } from "../../provenance/stated-amounts.js";

/* ===========================================================================
 * PART A — THE LIST. Derived both ways, so neither side can go short.
 * ======================================================================== */

describe("ROADMAP 2.1130 Part A — the sibling map IS the canonical alphabet", () => {
  it("every canonical key is resolvable by this module (the direction the union guard cannot assert)", () => {
    const folded = new Map(
      Object.entries(MULTIPLIERS).map(([k, v]) => [k.toLowerCase(), v] as const),
    );
    for (const [key, multiplier] of Object.entries(MAGNITUDE_MULTIPLIERS)) {
      expect(
        folded.get(key.toLowerCase()),
        `cee/extraction/numeric-parser.ts cannot resolve the canonical magnitude ` +
          `${JSON.stringify(key)}. The union guard asserts canonical ⊇ sibling and is ` +
          `structurally blind to a SHORT sibling; this is the missing direction. Derive ` +
          `MULTIPLIERS from MAGNITUDE_MULTIPLIERS rather than re-spelling it.`,
      ).toBe(multiplier);
    }
  });

  it("and carries no key the canonical alphabet does not (the union guard's own direction, restated locally)", () => {
    for (const key of Object.keys(MULTIPLIERS)) {
      expect(isKnownMagnitude(key), `numeric-parser resolves ${JSON.stringify(key)}; the canonical alphabet does not.`).toBe(true);
      expect(resolveMagnitude(key)).toBe(MULTIPLIERS[key]);
    }
  });
});

/* ===========================================================================
 * PART B — THE STRINGS. Derived per key, so a new canonical key is swept here
 * automatically. Agreeing about a list is not resolving a string.
 * ======================================================================== */

describe("ROADMAP 2.1130 Part B — parseNumericValue resolves EVERY canonical magnitude", () => {
  for (const [key, multiplier] of Object.entries(MAGNITUDE_MULTIPLIERS)) {
    for (const spelling of [`£5${key}`, `£5 ${key}`, `$5${key.toUpperCase()}`]) {
      it(`${JSON.stringify(spelling)} is ${5 * multiplier}`, () => {
        const parsed = parseNumericValue(spelling);
        expect(parsed, `${JSON.stringify(spelling)} did not parse at all`).not.toBeNull();
        expect(
          parsed!.value,
          `${JSON.stringify(spelling)} resolved to ${parsed!.value}; the canonical alphabet ` +
            `reads ${JSON.stringify(key)} as x${multiplier}, so the stated magnitude is ` +
            `${5 * multiplier}. A magnitude key this module cannot read is silently x1.`,
        ).toBe(5 * multiplier);
      });
    }
  }

  it("a plain number carries the whole alphabet too", () => {
    for (const [key, multiplier] of Object.entries(MAGNITUDE_MULTIPLIERS)) {
      const parsed = parseNumericValue(`5 ${key}`);
      expect(parsed, `"5 ${key}" did not parse`).not.toBeNull();
      expect(parsed!.value, `"5 ${key}" resolved to ${parsed?.value}`).toBe(5 * multiplier);
    }
  });
});

/* ===========================================================================
 * PART C — THE CORPUS. Hand-written, from outside the failure mode. This is
 * the only guard able to notice a defect neither list can express.
 *
 * The witnessed brief is here VERBATIM (ROADMAP 2.1130's own reproduction),
 * and every other row is ordinary British business prose in which the word
 * FOLLOWING an amount begins with a magnitude key. That word is the whole
 * point: the amounts below state NO magnitude suffix, so the correct answer is
 * always the digits as written, and any other answer is fabricated.
 * ======================================================================== */

const WITNESSED_BRIEF =
  "Should we replace our current CRM with HubSpot next quarter, or keep what we have? " +
  "We are a 30-person B2B sales team. Annual CRM cost is about £50,000 and switching would cost " +
  "roughly £20,000 one-off. The goal is higher sales productivity without blowing the budget.";

/** [text, the magnitude the writer stated]. */
const CORPUS: readonly (readonly [string, number])[] = [
  // ── The witnessed brief's own two clauses, verbatim ──────────────────────
  ["Annual CRM cost is about £50,000", 50_000],
  ["switching would cost roughly £20,000 one-off", 20_000],

  // ── No suffix stated, next word BEGINS with a magnitude key ──────────────
  // Each of these fabricated a magnitude at `dbd012eb`.
  ["£20,000 migration cost", 20_000], // m -> 1e6
  ["£50,000 maintenance", 50_000], // m -> 1e6
  ["£20,000 board approval", 20_000], // b -> 1e9
  ["£100 base", 100], // b -> 1e9
  ["£12 backlog", 12], // b -> 1e9
  ["£7 budget", 7], // b -> 1e9
  ["£5 max", 5], // m -> 1e6
  ["£5 monthly", 5], // m -> 1e6
  ["£20,000 kick-off fee", 20_000], // k -> 1e3
  ["£30 thereabouts", 30], // t -> 1e12 once `t` is admitted
  ["£6,000,000 this year", 6_000_000], // #787's own case, in currency form
  ["£40 total", 40], // t -> 1e12 once `t` is admitted
  ["£90 grandfathered", 90], // `grand` must not swallow "grandfathered"

  // ── A suffix IS stated: the magnitude must be applied ────────────────────
  ["£250 grand for the rebuild", 250_000],
  ["£20k one-off", 20_000],
  ["£20K", 20_000],
  ["$5 thousand", 5_000],
  ["€900k", 900_000],
  ["£1.5 million one-off", 1_500_000],
  ["£2bn", 2_000_000_000],
  ["£3mn", 3_000_000],
  ["£4 trillion", 4_000_000_000_000],
  ["£0.02m one-off", 20_000],

  // ── Phrasings from outside the author's head: qualifiers and postfixes ───
  ["£20,000 up-front", 20_000],
  ["£20,000 upfront", 20_000],
  ["a one-off cost of £20,000", 20_000],
  ["£50,000 per year", 50_000],
  ["£50,000 per annum", 50_000],
  ["£50,000 a year", 50_000],
  ["20,000 GBP one-off", 20_000],
  // The POSTFIX form carried `([kKmMbB])?` — a char class with no word spelling
  // at all — so this parsed as nothing whatever before 2.1130.
  ["5 million GBP", 5_000_000],
  ["2.5m USD", 2_500_000],
  ["between £20,000 and £30,000", 20_000],
  ["£20,000 (one-off)", 20_000],
];

describe("ROADMAP 2.1130 Part C — the stated magnitude survives, in both directions", () => {
  for (const [text, expected] of CORPUS) {
    it(`${JSON.stringify(text)} states ${expected}`, () => {
      const parsed = parseNumericValue(text);
      expect(parsed, `${JSON.stringify(text)} did not parse at all`).not.toBeNull();
      expect(
        parsed!.value,
        `${JSON.stringify(text)} resolved to ${parsed!.value}, but the writer stated ` +
          `${expected}. A wrong answer here is published at confidence "high".`,
      ).toBe(expected);
    });
  }

  it("the witnessed brief's BOTH monetary values survive — neither is zeroed nor inflated", () => {
    // ROADMAP 2.1130's reproduction claim, bound by IDENTITY (the clause each
    // amount was stated in), never by "some value in the brief equals 20000".
    const annual = parseNumericValue("Annual CRM cost is about £50,000");
    const oneOff = parseNumericValue("switching would cost roughly £20,000 one-off");
    expect(annual?.value).toBe(50_000);
    expect(annual?.unit).toBe("GBP");
    expect(oneOff?.value).toBe(20_000);
    expect(oneOff?.unit).toBe("GBP");
    // …and the canonical scanner, reading the WHOLE brief, agrees about both.
    const scanned = findStatedAmounts(WITNESSED_BRIEF)
      .filter((a) => a.kind === "currency")
      .map((a) => a.magnitude);
    expect(scanned).toEqual([50_000, 20_000]);
  });

  it("the SECOND amount in a segment — reachable only through the inline scan — keeps its magnitude", () => {
    // ⭐ A DISCRIMINATING FIXTURE, not merely a passing one. `extractAllNumericValues`
    // has two readers: a segment split (which returns only the FIRST match per
    // segment) and an inline /g scan. Both amounts below sit in ONE segment — no
    // comma, no "and", no "or" — so `£250 grand` can ONLY have come from the
    // inline pattern. A mutant that strips the alphabet from that pattern
    // therefore reddens HERE and nowhere else; without this case it survived.
    const found = extractAllNumericValues("budget £5m rising to £250 grand");
    const byText = new Map(found.map((p) => [p.originalText, p.value]));
    expect(byText.get("£5m")).toBe(5_000_000);
    expect(
      byText.get("£250 grand"),
      "the inline currency scan lost the magnitude alphabet — the second amount in a " +
        "segment is reachable through no other reader.",
    ).toBe(250_000);
  });

  it("agrees with the canonical scanner on every corpus row that states one amount", () => {
    // A SECOND, INDEPENDENT reading of the same text. Absolute values are
    // asserted above; this pins the two consumers of one alphabet together, so
    // a future divergence reddens here rather than being discovered live.
    for (const [text, expected] of CORPUS) {
      const scanned = findStatedAmounts(text).filter((a) => a.kind === "currency");
      if (scanned.length === 0) continue; // postfix/ISO forms the scanner reads differently
      expect(
        scanned[0]!.magnitude,
        `the canonical scanner reads ${JSON.stringify(text)} as ${scanned[0]!.magnitude}; ` +
          `the writer stated ${expected}.`,
      ).toBe(expected);
    }
  });
});

/* ===========================================================================
 * PART D — A KNOWN, UNFIXED DEFECT, PINNED RATHER THAN LEFT INVISIBLE.
 *
 * `extractAllNumericValues` splits its input on `[,;]` before parsing, and a
 * thousands separator IS a comma. So "£50,000" is torn into "£50" and "000",
 * and BOTH survive into the result: a 1,000x truncation (50) beside a
 * fabricated ZERO (parseFloat("000")). It is the same magnitude-loss class this
 * file exists to close, arriving through the SPLIT rather than the alphabet.
 *
 * IT IS NOT FIXED HERE, and the reason is measured, not assumed:
 * `extractAllNumericValues` has ZERO consumers in `src/` (swept at
 * `dbd012eb`; the only occurrence is its own declaration). Its blast radius is
 * zero by construction, so repairing it is a behaviour change to dead code and
 * belongs in its own row, not smuggled into a fix for the live path.
 *
 * ⚠ BUT AN UNPINNED GAP IS HOW A DEFECT SURVIVES A REPAIR OF ITS OWN MODULE.
 * This asserts the EXACT set of spurious readings, so the suite stays green for
 * the right reason and REDs if the set GROWS (a new loss) or SHRINKS (someone
 * fixed it and this note went stale). The correct reading is asserted alongside
 * it, so the pin can never be mistaken for approval.
 * ======================================================================== */

describe("ROADMAP 2.1130 Part D — the comma-split gap in extractAllNumericValues", () => {
  it("tears a thousands separator apart — pinned exactly, fix rows separately", () => {
    const found = extractAllNumericValues("Annual CRM cost is about £50,000");
    const pairs = found.map((p) => [p.originalText, p.value] as const);
    // The CORRECT reading is present…
    expect(pairs).toContainEqual(["£50,000", 50_000]);
    // …and so are exactly these two spurious ones, and no others.
    expect(
      pairs,
      "the comma-split gap changed shape. If it was FIXED, delete this test and the " +
        "Part D note. If it GREW, a new magnitude-loss class has arrived.",
    ).toEqual([
      ["£50", 50],
      ["000", 0],
      ["£50,000", 50_000],
    ]);
  });

  it("has no consumer in src/ — which is why the gap above is pinned rather than fixed", async () => {
    // The claim that licenses Part D is an ABSENCE claim, so it gets a positive
    // control: the same sweep must FIND a symbol from the same module that is
    // genuinely consumed (trap 13/13e). A sweep that can see nothing would
    // otherwise "prove" every absence in the tree.
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { join } = await import("node:path");
    const srcRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith(".ts")) files.push(full);
      }
    };
    walk(srcRoot);
    expect(files.length, "the sweep found no TypeScript files — it is blind").toBeGreaterThan(500);

    const count = (symbol: string): number =>
      files.filter(
        (f) =>
          !f.endsWith("numeric-parser.ts") &&
          !f.includes("__tests__") &&
          readFileSync(f, "utf8").includes(symbol),
      ).length;

    // POSITIVE CONTROL — a sibling export of the SAME module that is live.
    expect(
      count("parseNumericValue"),
      "the positive control found no consumer of `parseNumericValue`, which " +
        "cee/extraction/intervention-extractor.ts demonstrably imports. The sweep is blind, " +
        "so the absence claim below is unsupported.",
    ).toBeGreaterThan(0);

    // THE ABSENCE CLAIM, in the same sweep, at the same moment.
    expect(
      count("extractAllNumericValues"),
      "`extractAllNumericValues` has gained a consumer. Part D's comma-split gap now has a " +
        "blast radius and must be fixed rather than pinned.",
    ).toBe(0);
  });
});
