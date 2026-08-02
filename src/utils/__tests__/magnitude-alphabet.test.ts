/**
 * ROADMAP 2.322 — ONE MAGNITUDE ALPHABET, EVERY CONSUMER.
 *
 * WHAT THIS FILE IS FOR, and why it is not a fifth behavioural corpus.
 *
 * #797 and #799 each folded a magnitude list onto the shared one, one file at
 * a time, and each time a further copy survived. The reason was structural: the
 * shared list lived inside `cee/factor-extraction/index.ts`, so a consumer in
 * `context/` or `utils/` could not reach it without importing 1,500 lines of
 * extraction machinery — and therefore wrote its own. This file pins the two
 * properties that make a fourth copy impossible rather than merely absent:
 *
 *   1. the alphabet is REACHABLE from a leaf module every consumer can import;
 *   2. every folded consumer indexes THAT object, proven by a guard DERIVED
 *      from the map, so a byte-identical copy REDs the moment the map grows.
 *
 * Property 2 is the one a behavioural test cannot give you. A hand-copied list
 * that is byte-correct on the day it is written passes every behavioural
 * assertion and drifts silently forever after (CLAUDE.md trap 12) — which is
 * exactly how the third list came to be missing `bn`, and how the CANONICAL
 * list came to be missing `thousand`.
 */

import { describe, it, expect } from "vitest";
import {
  AMOUNT_DIGITS,
  MAGNITUDE_ALTERNATION,
  MAGNITUDE_DISPLAY_LADDER,
  MAGNITUDE_MULTIPLIERS,
  isKnownMagnitude,
  isMagnitudeShapedSuffix,
  magnitudeSuffixPattern,
  parseAmountDigits,
  requiredMagnitudeSuffixPattern,
  resolveMagnitude,
} from "../magnitude-alphabet.js";
import { extractFactors } from "../../cee/factor-extraction/index.js";
import { extractIncreaseByDelta } from "../reduction-framing.js";
import { extractNumericValues } from "../../context/resolver.js";
import { extractCompoundGoals } from "../../cee/compound-goal/extractor.js";
import { synthesiseDisplayValue } from "../../cee/factor-extraction/display-value.js";
import { generateConstraintNodes } from "../../cee/compound-goal/node-generator.js";

/* ===========================================================================
 * PART A — THE GAP IN THE CANONICAL LIST ITSELF.
 *
 * `thousand` was absent from `MAGNITUDE_MULTIPLIERS`, so "$5 thousand"
 * extracted as 5 — a 1,000× under-read at full confidence, on the same card,
 * in the same file, that #799's comment block describes as unified. These are
 * the RED-first signatures for that.
 *
 * ⚠ WHY IT SURVIVED — THE MEASURED ANSWER, replacing an overstated one this
 * lane wrote and review caught within hours. The first version of this header
 * said "every guard #799 shipped is DERIVED FROM the map, which makes them
 * structurally incapable of noticing that the LIST IS INCOMPLETE." That
 * generalised from the guards this lane had read. Deleting the key `million`
 * from the map at base, in a throwaway worktree, measured the opposite: the one
 * genuinely derived per-key guard stayed GREEN, but 6 HARDCODED CORPUS
 * assertions went RED across both of #799's guard files. `thousand` survived
 * because no corpus happened to SPELL it — not because everything was derived.
 *
 *   A derived guard proves AGREEMENT and can never prove COMPLETENESS — and the
 *   only thing that CAN catch a short list is a hand-written corpus, i.e.
 *   exactly the mirror derivation was introduced to abolish. Trap 12 has a
 *   second face.
 *
 * Which is why PART A is written as EXPLICIT, HAND-SPELLED cases for the two
 * added keys, and not only as another walk over the map: a map-walk cannot see
 * a key that is not in the map, and that is precisely the defect being closed.
 * ========================================================================= */

describe("ROADMAP 2.322 — the canonical alphabet was itself incomplete", () => {
  it("RED 1 — `thousand` is a magnitude key (it was absent; '$5 thousand' read as 5)", () => {
    expect(MAGNITUDE_MULTIPLIERS.thousand).toBe(1e3);
    const factors = extractFactors("We raised $5 thousand last year.");
    const explicit = factors.find((f) => f.extractionType === "explicit");
    expect(explicit, "no explicit factor for '$5 thousand'").toBeDefined();
    expect(explicit!.value, "'$5 thousand' must not read as a bare 5").toBe(5_000);
  });

  it("RED 2 — `mn` is a magnitude key (it was absent; '$5mn' refused outright)", () => {
    // `mn` is the UK-finance spelling of million and was already carried by
    // `cee/extraction/numeric-parser.ts`'s own list — so the estate knew the
    // key, and only the canonical list did not. Before this change `$5mn` hit
    // `isMagnitudeShapedSuffix` ("mn" begins with "m" but is not a key) and
    // refused: safe, but a lost extraction the sibling list handled.
    expect(MAGNITUDE_MULTIPLIERS.mn).toBe(1e6);
    const factors = extractFactors("We raised $5mn last year.");
    const explicit = factors.find((f) => f.extractionType === "explicit");
    expect(explicit, "no explicit factor for '$5mn'").toBeDefined();
    expect(explicit!.value).toBe(5_000_000);
  });

  it("the completeness gap is closed in BOTH directions — every key round-trips", () => {
    // Derived, so it covers keys that do not exist yet: it walks the map, but
    // it asserts on the CONSUMER, so a key present in the map and unreachable
    // through extraction REDs.
    //
    // ⚠ IT WOULD NOT HAVE CAUGHT `thousand`, and an earlier version of this
    // comment claimed it would. A map-walk is blind to a key the map does not
    // contain — measured, by deleting `million` at base and watching this
    // assertion's derived sibling stay GREEN. Completeness is the corpus's job
    // (PART A); this assertion's job is agreement.
    for (const [key, multiplier] of Object.entries(MAGNITUDE_MULTIPLIERS)) {
      const factors = extractFactors(`We raised $4${key} last year.`);
      const explicit = factors.find((f) => f.extractionType === "explicit");
      expect(explicit, `no explicit factor for key '${key}'`).toBeDefined();
      expect(explicit!.value, `key '${key}'`).toBe(4 * multiplier);
    }
  });
});

/* ===========================================================================
 * PART B — THE REUSE PROOF.
 *
 * The mutant this must survive is the one #799 established: copy the alphabet
 * BYTE-IDENTICALLY into a consumer, then add a key to the map. Behaviourally
 * the copy is indistinguishable until that moment; these assertions RED at it,
 * because every one of them is derived from the map rather than from a list of
 * what the map contains today.
 * ========================================================================= */

describe("ROADMAP 2.322 — every folded consumer indexes the ONE alphabet (drift guard)", () => {
  it("`context/resolver` knows EVERY key — derived, so a frozen copy REDs", () => {
    for (const [key, multiplier] of Object.entries(MAGNITUDE_MULTIPLIERS)) {
      expect(
        extractNumericValues(`$4${key}`),
        `resolver does not know '${key}'`,
      ).toContain(4 * multiplier);
    }
  });

  it("`utils/reduction-framing` knows EVERY key — derived, so a frozen copy REDs", () => {
    for (const [key, multiplier] of Object.entries(MAGNITUDE_MULTIPLIERS)) {
      expect(
        extractIncreaseByDelta(`increase revenue by 4${key}`),
        `reduction-framing does not know '${key}'`,
      ).toBe(4 * multiplier);
    }
  });

  it("`cee/compound-goal/extractor` knows EVERY key — derived, so a frozen copy REDs", () => {
    for (const [key, multiplier] of Object.entries(MAGNITUDE_MULTIPLIERS)) {
      const { constraints } = extractCompoundGoals(`keep costs under $4${key}`);
      expect(constraints.length, `no constraint for key '${key}'`).toBeGreaterThan(0);
      expect(
        constraints.map((c) => c.value),
        `compound-goal does not know '${key}'`,
      ).toContain(4 * multiplier);
    }
  });

  it("the DISPLAY ladder is derived from the same map — parse and print agree", () => {
    // The formatting half of the same defect. Two hand-written ladders stopped
    // at 1e6 and 1e9 respectively, so a value the parsers read as five trillion
    // printed as "£5000000m". Derived, the two cannot disagree about which
    // magnitudes exist — and this assertion is what makes that structural.
    const parseable = new Set(Object.values(MAGNITUDE_MULTIPLIERS).filter((m) => m >= 1e3));
    const printable = new Set(MAGNITUDE_DISPLAY_LADDER.map(([m]) => m));
    expect(printable, "a magnitude the parsers accept has no display rung").toEqual(parseable);
  });

  it("the ladder is strictly DESCENDING and each rung uses the shortest key", () => {
    // Ordering is the safety property on the display side too: an ascending or
    // unsorted ladder would take the 1e3 rung for every value and print
    // "£5000000000k". Derived from the key set, tie-broken lexicographically,
    // so it is a pure function of the map.
    const multipliers = MAGNITUDE_DISPLAY_LADDER.map(([m]) => m);
    expect(multipliers).toEqual([...multipliers].sort((a, b) => b - a));
    for (const [multiplier, suffix] of MAGNITUDE_DISPLAY_LADDER) {
      const candidates = Object.entries(MAGNITUDE_MULTIPLIERS)
        .filter(([, m]) => m === multiplier)
        .map(([k]) => k)
        .sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
      expect(suffix, `rung ${multiplier} does not use the shortest key`).toBe(candidates[0]);
    }
  });
});

/* ===========================================================================
 * PART C — THE DERIVED-PATTERN INVARIANTS.
 *
 * Carried over from #799's guard because they now protect a module that is
 * imported by five consumers rather than one, and because the escaping rule in
 * particular is a no-op until the day it is not.
 * ========================================================================= */

describe("ROADMAP 2.322 — the derived alternation cannot be corrupted by its own data", () => {
  it("keys are UNIQUE under case-folding — a collision silently drops one", () => {
    const keys = Object.keys(MAGNITUDE_MULTIPLIERS);
    const folded = new Set(keys.map((k) => k.toLowerCase()));
    expect(
      folded.size,
      `case-fold collision: ${keys.length} keys collapse to ${folded.size} lookup entries`,
    ).toBe(keys.length);
  });

  it("the alternation is LONGEST-FIRST — a prefix key must not swallow a longer one", () => {
    // "b" before "bn" reads "$5bn" as five billion followed by a stray "n" on
    // some paths and as 5 on others. The sort is by raw key length so this is
    // structural, but the property is pinned directly because it is the one
    // that silently changes when someone re-formats the map.
    const branches = MAGNITUDE_ALTERNATION.split("|");
    for (let i = 0; i < branches.length; i++) {
      for (let j = i + 1; j < branches.length; j++) {
        expect(
          branches[j]!.startsWith(branches[i]!),
          `'${branches[i]}' precedes '${branches[j]}' and is a prefix of it`,
        ).toBe(false);
      }
    }
  });

  it("the alternation carries every key LITERALLY — no key acts as a regex operator", () => {
    const alternation = new RegExp(`^(?:${MAGNITUDE_ALTERNATION})$`, "i");
    const keys = Object.keys(MAGNITUDE_MULTIPLIERS).map((k) => k.toLowerCase());
    const keySet = new Set(keys);
    const SENTINEL = "§"; // in no key, and not a regex metacharacter

    for (const key of keys) {
      expect(alternation.test(key), `key does not match itself literally: '${key}'`).toBe(true);
      for (let i = 0; i < key.length; i++) {
        const substituted = key.slice(0, i) + SENTINEL + key.slice(i + 1);
        if (!keySet.has(substituted)) {
          expect(
            alternation.test(substituted),
            `alternation matches a NON-KEY '${substituted}' — an unescaped metacharacter in '${key}'`,
          ).toBe(false);
        }
        const doubled = key.slice(0, i) + key[i]! + key.slice(i);
        if (!keySet.has(doubled)) {
          expect(
            alternation.test(doubled),
            `alternation matches a NON-KEY '${doubled}' — an unescaped quantifier in '${key}'`,
          ).toBe(false);
        }
      }
    }
  });

  it("`resolveMagnitude` admits every casing the `i`-flagged patterns admit", () => {
    for (const [key, multiplier] of Object.entries(MAGNITUDE_MULTIPLIERS)) {
      for (const cased of [key.toUpperCase(), key.toLowerCase(), titleCase(key)]) {
        expect(resolveMagnitude(cased), `cased key '${cased}'`).toBe(multiplier);
      }
    }
    expect(resolveMagnitude(undefined), "absent suffix must be identity").toBe(1);
  });

  it("the optional and required spellings differ ONLY in optionality", () => {
    // Both are built from the same fragment. If they ever diverge in anything
    // but the wrapper, one of them has grown its own copy of the alphabet.
    const optional = magnitudeSuffixPattern("g");
    const required = requiredMagnitudeSuffixPattern("g");
    expect(optional).toBe(`(?:${required})?`);
    expect(required).toContain(MAGNITUDE_ALTERNATION);
  });

  it("`AMOUNT_DIGITS` + `parseAmountDigits` survive thousands separators", () => {
    // `parseFloat("800,000")` is 800 — the same silent 1,000× loss as a dropped
    // suffix, arriving through the comma instead.
    expect(new RegExp(`^${AMOUNT_DIGITS}$`).test("1,250,000")).toBe(true);
    expect(parseAmountDigits("1,250,000")).toBe(1_250_000);
    expect(parseAmountDigits(undefined)).toBeNull();
    expect(parseAmountDigits("not-a-number")).toBeNull();
  });
});

/* ===========================================================================
 * PART D — THE REFUSAL PREDICATE, PRESERVED IN BOTH DIRECTIONS.
 *
 * #799 narrowed the refusal in review after its first cut destroyed seven good
 * extractions. Those seven shapes are pinned here because the alphabet just
 * GREW, and a wider alphabet makes `isMagnitudeShapedSuffix` refuse MORE by
 * construction — `thousand` and `mn` each add a prefix that "begins with a
 * magnitude key" can now match. This is the assertion that proves the growth
 * did not quietly re-break what the narrowing fixed.
 * ========================================================================= */

describe("ROADMAP 2.322 — the narrowed refusal survives the alphabet growing", () => {
  const STILL_EXTRACTS: ReadonlyArray<readonly [string, number]> = [
    ["£49pcm", 49],
    ["$100pa", 100],
    ["£20ph", 20],
    ["£49ea", 49],
    ["$50s", 50],
    ["$5USD", 5],
    ["€500EUR", 500],
  ];

  it.each(STILL_EXTRACTS)("%s still extracts as %d (#799's narrowing)", (shape, expected) => {
    const factors = extractFactors(`We charge ${shape} for it.`);
    expect(factors.map((f) => f.value), `${shape} must still extract`).toContain(expected);
  });

  const STILL_REFUSES = ["$5mARR", "$5kg", "$5bnX", "$5tonnes"] as const;

  it.each(STILL_REFUSES)("%s still REFUSES rather than emitting bare digits", (shape) => {
    expect(isMagnitudeShapedSuffix(shape.replace(/^[£$€]\d+(?:\.\d+)?/, ""))).toBe(true);
    const factors = extractFactors(`We charge ${shape} for it.`);
    expect(factors.map((f) => f.value), `${shape} must not emit bare digits`).not.toContain(5);
  });

  it("`compound-goal` now REFUSES the ambiguous shape instead of guessing a reading", () => {
    // MEASURED REGRESSION FOUND MID-CHANGE, and the reason it is pinned here.
    // The old `[kKmMbB]?` class had no `\b`, so it swallowed the FIRST letter of
    // any attached run and guessed: "$5kg" became 5,000 (five thousand
    // kilograms of nothing) while "$5mARR" became 5,000,000 — wrong and right
    // by the same accident. Deriving the token made the `\b` real, which flipped
    // both to a bare 5: safer for `kg`, a 1e6× UNDER-read for `mARR`. Neither
    // is acceptable, so the derived trailer guard refuses the shape outright,
    // matching what `extractFactors` already does.
    for (const shape of ["$5mARR", "$5kg", "$5bnX", "$5tonnes"]) {
      expect(
        extractCompoundGoals(`keep costs under ${shape}`).constraints,
        `${shape} must yield NO constraint rather than a guessed magnitude`,
      ).toEqual([]);
    }
  });

  it("`compound-goal` keeps #799's narrowed list extracting — the guard is not 'any letter'", () => {
    for (const [shape, expected] of [
      ["£49pcm", 49],
      ["$100pa", 100],
      ["£20ph", 20],
      ["£49ea", 49],
      ["$50s", 50],
      ["$5USD", 5],
      ["€500EUR", 500],
    ] as const) {
      const { constraints } = extractCompoundGoals(`keep costs under ${shape}`);
      expect(constraints.map((c) => c.value), `${shape} must still extract`).toContain(expected);
    }
  });

  it("`isKnownMagnitude` and `isMagnitudeShapedSuffix` are mutually exclusive on keys", () => {
    // An exact key is READ, never refused — that is what stops the refusal
    // predicate from eating its own alphabet as it grows.
    for (const key of Object.keys(MAGNITUDE_MULTIPLIERS)) {
      expect(isKnownMagnitude(key), `'${key}' must be known`).toBe(true);
      expect(isMagnitudeShapedSuffix(key), `'${key}' must not be refused`).toBe(false);
    }
  });
});

/* ===========================================================================
 * PART E — THE FORMATTING LADDERS, PINNED WHERE THEY CHANGED AND WHERE THEY
 * DID NOT.
 *
 * The change is narrow by construction (new rungs only), but "narrow by
 * construction" is what the last three of these PRs each believed. Pinned as
 * measured pristine output either side of the boundary.
 * ========================================================================= */

describe("ROADMAP 2.322 — the display ladders reach every parseable magnitude", () => {
  const gbp = (raw: number): string | undefined => synthesiseDisplayValue({ raw_value: raw, unit: "£" });

  it("unchanged below 1e9 — the rungs that already existed keep their exact spelling", () => {
    expect(gbp(1)).toBe("£1");
    expect(gbp(999)).toBe("£999");
    expect(gbp(1_000)).toBe("£1k");
    expect(gbp(1_500)).toBe("£1.5k");
    expect(gbp(12_345)).toBe("£12.3k");
    expect(gbp(1_000_000)).toBe("£1m");
    expect(gbp(2_500_000)).toBe("£2.5m");
    expect(gbp(-500_000)).toBe("£-500k");
  });

  it("RED 3 — 1e9 and 1e12 gain their own rungs ('$5t' printed as '£5000000m')", () => {
    expect(gbp(1_000_000_000)).toBe("£1b");
    expect(gbp(5_000_000_000)).toBe("£5b");
    expect(gbp(1_000_000_000_000)).toBe("£1t");
    expect(gbp(5_000_000_000_000)).toBe("£5t");
    expect(gbp(-5_000_000_000)).toBe("£-5b");
  });

  const label = (value: number): string =>
    generateConstraintNodes([
      {
        targetName: "cost",
        targetNodeId: "fac_cost",
        operator: "<=",
        value,
        unit: "£",
        label: "cost",
        sourceQuote: "q",
        confidence: 0.9,
        provenance: "explicit",
      },
    ])[0]!.label;

  it("the constraint-node ladder keeps its historical CASING per rung", () => {
    // This site printed `B`/`M` but a lower-case `k`, and those exact strings
    // are what existing graph labels carry. Normalising them would be a
    // user-visible label change smuggled in under a magnitude fix, so the
    // casing is applied on top of the derived suffix and pinned here.
    expect(label(1_000)).toContain("£1k");
    expect(label(1_000_000)).toContain("£1.0M");
    expect(label(1_000_000_000)).toContain("£1.0B");
  });

  it("RED 4 — the constraint-node ladder gains the trillion rung ('£1000.0B')", () => {
    expect(label(1_000_000_000_000)).toContain("£1.0T");
    expect(label(5_000_000_000_000)).toContain("£5.0T");
  });
});

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
