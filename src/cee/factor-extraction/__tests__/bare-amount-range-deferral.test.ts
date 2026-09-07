/**
 * ⭐⭐ THE DEFERRAL AND THE PATTERN IT DEFERS TO MUST AGREE ON THEIR DOMAIN
 * (ROADMAP 2.1131, repair of the behaviour seat's finding B on PR #1327).
 *
 * `RANGE_LOWER_BOUND_ABSENT_GUARD` makes three POINT patterns decline an amount
 * that is the first half of a written range, **on the promise that a range
 * pattern will read the pair instead**. Two of the three — `contextualNumber`
 * and `approximateValue` — make the currency symbol OPTIONAL. Every range
 * pattern that could keep the promise did not: `currencyRange` REQUIRES a
 * `[£$€]` and `genericRange` REQUIRES the literal word `between`. For a bare,
 * dash-joined pair no range pattern existed, so the guard declined on a promise
 * nothing could keep and the figure vanished.
 *
 * MEASURED at `8ba54157` against base `f4c8f501`, through `extractFactors`,
 * 32-string corpus, currency-prefixed twins as contrast controls in the same
 * run — nine strings lost every factor they had at base:
 *
 *   "Budget of 80k-120k for the hire."   f4c8f501  Budget=80,000 explicit/0.90
 *                                        8ba54157  []
 *   "Revenue of 2m-5m is the target."    f4c8f501  Revenue=2,000,000
 *                                        8ba54157  []
 *   "roughly 800-900k users"             f4c8f501  Factor=800 inferred/0.70
 *                                        8ba54157  []
 *
 * ⚠ THE REPAIR IS NOT TO NARROW THE GUARD BACK. Admitting `contextualNumber`
 * on "Budget of 80-120k" republishes **80** at confidence 0.90 — the 3 Sep
 * defect verbatim, in the spelling with no currency symbol. The repair is the
 * other half of the seat's own fix direction: give the range grammar the bare
 * dash-joined spelling, so the domain the guard DECLINES and the domain a range
 * pattern READS are the same domain, derived from one constant
 * (`RANGE_LOWER_BOUND_DEFERRAL_TAIL`) rather than written twice.
 *
 * ⚠⚠ AND THE OPPOSITE HARM IS THE ONE UNDER GUARD HERE. Widening the range
 * grammar until any dash-joined pair mints a node is how this estate ships a
 * fix and its exact inverse in consecutive rounds (CLAUDE.md trap 22b). The
 * new pattern therefore REQUIRES a magnitude on the upper bound — the same
 * `MAGNITUDE_SUFFIX_ANON_REQUIRED` the guard's own tail requires — so
 * "3-5 people", "2024-2025" and "£50,000 - 3 months" are outside it by
 * construction, and every one of those carries an assertion below.
 */

import { describe, expect, it } from "vitest";
import { extractFactors } from "../index.js";
import { enrichGraphWithFactorsAsync } from "../enricher.js";
import type { GraphT } from "../../../schemas/graph.js";

function emptyGraph(): GraphT {
  return {
    nodes: [{ id: "goal-1", kind: "outcome", label: "Reach £30k MRR", data: {} }],
    edges: [],
  } as unknown as GraphT;
}

/** The whole factor, so an over-narrowing and an over-widening both RED. */
function shapes(brief: string) {
  return extractFactors(brief).map((f) => ({
    label: f.label,
    value: f.value,
    unit: f.unit ?? null,
    extractionType: f.extractionType,
    rangeMin: f.rangeMin ?? null,
    rangeMax: f.rangeMax ?? null,
  }));
}

/* ===========================================================================
 * DIRECTION 1 — THE REGRESSION. A stated figure with NO currency symbol must
 * not vanish. RED at `8ba54157`: each of these returns `[]`.
 * ========================================================================= */
describe("a dash-joined pair with no currency symbol still reaches the model", () => {
  it("'Budget of 80k-120k' yields a factor node, and it is the RANGE the user wrote", async () => {
    const found = shapes("Budget of 80k-120k for the hire.");
    // Bound by IDENTITY — the label the sentence states and the extraction
    // type — never by "some factor whose value is 100000", which a different
    // extractor could satisfy (CLAUDE.md trap 19).
    const range = found.find((f) => f.label === "Budget" && f.extractionType === "range");
    expect(range, `no Budget range factor; extractFactors returned ${JSON.stringify(found)}`)
      .toBeDefined();
    expect(range!.rangeMin).toBe(80_000);
    expect(range!.rangeMax).toBe(120_000);
    // And no 1,000x-short twin taken from the pair's own first half.
    expect(found.some((f) => f.value === 80)).toBe(false);

    // The seat's finding was NODE LOSS, so the claim is settled at the surface
    // that mints nodes, not only at the producer.
    const { graph } = await enrichGraphWithFactorsAsync(
      emptyGraph(),
      "Budget of 80k-120k for the hire.",
    );
    const node = graph.nodes.find(
      (n) => n.kind === "factor" && String(n.label).toLowerCase().includes("budget"),
    );
    expect(node, "the enricher minted NO factor node for a stated budget").toBeDefined();
  });

  it("the elliptical spelling too — 'Budget of 80-120k' scopes the k across both bounds", () => {
    const found = shapes("Budget of 80-120k for the hire.");
    const range = found.find((f) => f.label === "Budget" && f.extractionType === "range");
    expect(range, `returned ${JSON.stringify(found)}`).toBeDefined();
    expect(range!.rangeMin).toBe(80_000);
    expect(range!.rangeMax).toBe(120_000);
    expect(found.some((f) => f.value === 80), "the 3 Sep defect, currency-free").toBe(false);
  });

  it("and the approximate spelling — 'roughly 800-900k users'", () => {
    const found = shapes("roughly 800-900k users");
    const range = found.find((f) => f.extractionType === "range");
    expect(range, `returned ${JSON.stringify(found)}`).toBeDefined();
    expect(range!.rangeMin).toBe(800_000);
    expect(range!.rangeMax).toBe(900_000);
    expect(found.some((f) => f.value === 800)).toBe(false);
  });
});

/* ===========================================================================
 * DIRECTION 2 — THE PR'S PURPOSE SURVIVES. The currency-prefixed twins are the
 * contrast control: they were CORRECT at `8ba54157` and must not move.
 * ========================================================================= */
describe("the currency-prefixed twins are untouched (contrast control)", () => {
  it("Paul's 3 Sep brief still reads as a range, with no scale from its lower bound", () => {
    const found = shapes("We're budgeting £80-120k for the first hire.");
    expect(found).toEqual([
      {
        label: "Budget",
        value: 100_000,
        unit: "£",
        extractionType: "range",
        rangeMin: 80_000,
        rangeMax: 120_000,
      },
    ]);
  });

  it("…and exactly ONE range factor, not a bare duplicate beside the currency one", () => {
    // The bare pattern must decline an amount a currency symbol already owns,
    // or one written range arrives as two factors on two units.
    for (const brief of [
      "Budget between £2-5m for the platform.",
      "Budget of £400-900k for the hire.",
      "roughly £800-900k in revenue",
    ]) {
      const ranges = shapes(brief).filter((f) => f.extractionType === "range");
      expect(ranges.length, `${brief} → ${JSON.stringify(ranges)}`).toBe(1);
      expect(ranges[0]!.unit).toBe("£");
    }
  });
});

/* ===========================================================================
 * DIRECTION 3 — THE GUARD SURVIVES. A genuine unit slip is still caught, and
 * the pairs that are not ranges still mint nothing. One direction alone proves
 * nothing (CLAUDE.md trap 22b).
 * ========================================================================= */
describe("the refusals and the non-ranges are unchanged", () => {
  it("a DESCENDING pair is still refused, bare as well as currency-prefixed", () => {
    // "£500-2m" has no single reading — 500m..2m or £500..£2,000,000 — and the
    // doctrine is to refuse rather than publish a confident wrong magnitude.
    // The bare spelling must refuse identically, or the new pattern has become
    // a second opinion about what a range is.
    expect(shapes("Budget £500-2m for the platform.").filter((f) => f.extractionType === "range"))
      .toEqual([]);
    expect(shapes("Budget of 500-2m for the platform.").filter((f) => f.extractionType === "range"))
      .toEqual([]);
  });

  it("a magnitude on the LOWER bound only is still refused ('£2m-5')", () => {
    const found = shapes("Budget £2m-5 for the platform.");
    expect(found.some((f) => f.extractionType === "range")).toBe(false);
    // …and the correctly-read point survives, so the refusal is not deletion.
    expect(found.some((f) => f.value === 2_000_000)).toBe(true);
  });

  it("N1 survives: '£50,000 - 3 months of runway' still yields the honest £50,000 point", () => {
    // The guard's own narrowing. No magnitude on the upper bound ⇒ the point
    // reading loses nothing ⇒ the point is admitted. The new pattern must not
    // reach this string either: `3` carries no magnitude.
    const found = shapes("The budget is £50,000 - 3 months of runway.");
    expect(found.some((f) => f.value === 50_000 && f.extractionType === "explicit")).toBe(true);
  });

  it("a bare dash pair with NO magnitude mints nothing new", () => {
    // The over-widening this repair must not commit: any two numbers joined by
    // a hyphen becoming a band.
    expect(shapes("We hired 3-5 people this year.")).toEqual([]);
    expect(shapes("Revenue 2024-2025 was flat.").some((f) => f.extractionType === "range"))
      .toBe(false);
    expect(shapes("Budget of 80,000-120,000 for the hire.").some((f) => f.extractionType === "range"))
      .toBe(false);
    expect(shapes("Budget of 80-120 for the hire.").some((f) => f.extractionType === "range"))
      .toBe(false);
  });

  it("a percentage band is still ONE percent range, not a unitless twin", () => {
    // `percentRange` owns "5-10%"; a unitless 5..10 beside it is one written
    // range arriving as two factors on two scales.
    const ranges = shapes("Churn between 5-10% this year.").filter(
      (f) => f.extractionType === "range",
    );
    expect(ranges.length).toBe(1);
    expect(ranges[0]!.unit).toBe("%");
  });
});

/* ===========================================================================
 * WHAT THIS REPAIR DOES **NOT** CLOSE, AND WHAT IT WIDENS — pinned in both
 * directions so the suite REDs if either set grows OR shrinks (CLAUDE.md trap
 * 22f: a gap the suite can see is honest; one it cannot is how four rounds
 * happen).
 * ========================================================================= */
describe("the recorded floor: a pair with a RIVAL reading still yields nothing", () => {
  /**
   * ⚠⚠ THIS SET AND ITS NAME WERE BOTH WRONG, AND THE NAME IS WHY THE SET WAS.
   *
   * It was called `KNOWN_DESCENDING_PAIR_LOSES_ITS_POINT`, under the sentence
   * *"the range is refused because the bare digits descend and the two readings
   * diverge by 1,000x in opposite directions"*. For its third member,
   * `"Budget £80,000-120k for the hire."`, NEITHER CLAUSE WAS TRUE: 80,000 to
   * 120,000 ascends, and it has exactly one reading, because nobody writes
   * "80,000k". A behaviour seat measured six such strings losing every factor
   * they carried at base `f4c8f501` — the head filed them all under
   * "descending", and a false class name is inherited by the next reader as a
   * deliberate decision rather than a defect.
   *
   * WHAT ACTUALLY UNITES THE MEMBERS BELOW, and what the name now says: the
   * bare digits descend, so the shared suffix cannot distribute — and a RIVAL
   * reading survives in which the writer dropped a magnitude from the LOWER
   * bound, which ascends just as coherently.
   *
   *     "£500-2m"     literal 500..2,000,000      dropped 500k..2m      BOTH
   *     "£1,200-2m"   literal 1,200..2,000,000    dropped 1,200k..2m    BOTH
   *
   * Two coherent readings 1,000x apart is the ambiguity this module refuses to
   * resolve by guessing (CLAUDE.md trap 22f: where direction cannot be
   * determined, refuse and record the gap rather than tune a constant).
   *
   * ⚠ `"£1,200-2m"` IS NEW TO THIS SET and it is the honest cost of the rule
   * chosen. A typographic rule — "a thousands separator in the lower bound
   * means it cannot take the suffix" — would have published 1,200..2,000,000
   * here, a 1,667x band over a reading ("£1,200k-£2m") that is coherent and,
   * for a revenue sentence, likelier. It is refused rather than guessed, and
   * pinned here rather than left invisible.
   *
   * NOT closed, deliberately. The twins below are what stop the set being
   * "closed" by re-narrowing the pattern until everything yields nothing.
   */
  const KNOWN_RIVAL_READING_YIELDS_NOTHING = [
    "Budget £500-2m for the platform.",
    "Budget of 500-2m for the platform.",
    "Revenue of £1,200-2m next year.",
  ] as const;

  it.each(KNOWN_RIVAL_READING_YIELDS_NOTHING)("OPEN (recorded): %s yields nothing", (brief) => {
    expect(extractFactors(brief)).toEqual([]);
  });

  it("⭐ TWIN A: the DISTRIBUTED ascending members of the same grammar yield a range", () => {
    // Bare digits ascend ⇒ the suffix scopes across both bounds. Untouched by
    // the repair, and asserted so a re-narrowing cannot pass by deleting it.
    for (const [brief, min, max] of [
      ["Budget £500-2000k for the platform.", 500_000, 2_000_000],
      ["Budget of 500-2000k for the platform.", 500_000, 2_000_000],
      ["Budget of 80-120k for the hire.", 80_000, 120_000],
    ] as const) {
      const range = shapes(brief).find((f) => f.extractionType === "range");
      expect(range, brief).toBeDefined();
      expect(range!.rangeMin, brief).toBe(min);
      expect(range!.rangeMax, brief).toBe(max);
    }
  });

  it("⭐ TWIN B: the LITERAL ascending class — the six strings the seat measured as lost", () => {
    // MEASURED at head `762245c8`, all six yielded `[]`; at base `f4c8f501`
    // five yielded a point PLUS a fabricated descending range (e.g.
    // "£80,000-120k" → point 80,000 and range [80,000..120], midpoint 40,060 —
    // the magnitude silently dropped). Neither is what the sentence says.
    // Five of the six read here as the one band that ascends; the sixth
    // ("£1,200-2m") has a rival reading and is pinned above.
    const CASES = [
      "Budget of £80,000-120k for the hire.",
      "Budget of £80,000\u2013120k for the hire.", // en dash
      "Budget of 80,000-120k for the hire.",
      "Budget of £1,500-2k for the hire.",
      "Budget of £950-1.2k per month.",
    ] as const;
    // Read EVERY member before asserting, so one RED names the whole class
    // rather than stopping at the first — the six-row table this repair was
    // briefed from was itself produced that way.
    const actual = Object.fromEntries(
      CASES.map((brief) => {
        const r = shapes(brief).find((f) => f.extractionType === "range");
        return [brief, r ? `${r.rangeMin}..${r.rangeMax}` : "NO RANGE"];
      }),
    );
    expect(actual).toEqual({
      "Budget of £80,000-120k for the hire.": "80000..120000",
      "Budget of £80,000\u2013120k for the hire.": "80000..120000",
      "Budget of 80,000-120k for the hire.": "80000..120000",
      "Budget of £1,500-2k for the hire.": "1500..2000",
      "Budget of £950-1.2k per month.": "950..1200",
    });
  });

  it("⭐ TWIN C: a pair where NEITHER reading ascends is still refused", () => {
    // The opposite-direction twin of TWIN B, and the guard against reading the
    // repair as "admit the literal reading whenever the digits descend".
    // 5,000,000 > 2m literally, and 5,000,000k is further away still.
    expect(extractFactors("Budget of £5,000,000-2m for the platform.")).toEqual([]);
    expect(extractFactors("Budget of 5,000,000-2m for the platform.")).toEqual([]);
  });
});

describe("a SIGNED lower bound is refused, not silently unsigned", () => {
  it("'-5-10k' and '+5-10k' mint nothing", () => {
    // ⚠ MEASURED, NOT ANTICIPATED. Before `BARE_AMOUNT_RANGE_START_GUARD`
    // carried its sign limb, "Growth of -5-10k users." matched from its **5**
    // and published 5,000..10,000 — the writer's minus sign dropped in
    // silence. That is the OVER-read direction, and base and head both return
    // nothing here, so no differential against them could have shown it: the
    // only instrument that could was a corpus that included the sign axis.
    expect(extractFactors("Growth of -5-10k users.")).toEqual([]);
    expect(extractFactors("Uplift of +5-10k users.")).toEqual([]);
  });

  it("⭐ TWIN: the same sentence UNSIGNED does mint the range", () => {
    // Or the assertion above would pass under a pattern that reads nothing.
    const range = shapes("Growth of 5-10k users.").find((f) => f.extractionType === "range");
    expect(range).toBeDefined();
    expect(range!.rangeMin).toBe(5_000);
    expect(range!.rangeMax).toBe(10_000);
  });
});

describe("the WIDENING this repair ships, stated rather than discovered later", () => {
  it("a dash-joined magnitude-scoped pair that reached NOTHING at base now reads", () => {
    // These are not restorations — base `f4c8f501` and head `8ba54157` both
    // returned `[]`. They are inside the new pattern's declared domain (a
    // dash, and a magnitude on the upper bound), and each is a correct reading
    // of a stated range, so they are disclosed here rather than left for a
    // later seat to find.
    const signups = shapes("between 5-10 thousand signups").find(
      (f) => f.extractionType === "range",
    );
    expect(signups).toBeDefined();
    expect([signups!.rangeMin, signups!.rangeMax]).toEqual([5_000, 10_000]);
  });

  it("⚠ and the label is `inferLabel`'s, which is a CLOSED LIST checked in order", () => {
    // ⚠ A PRE-EXISTING LIMITATION, SURFACED IN A NEW PLACE — recorded, not
    // repaired, because `inferLabel` is shared by every range extractor and
    // widening its vocabulary would move labels estate-wide (the scope rule).
    // Two consequences, both measured:
    //   · a context word outside the list ("target", "spend") yields "Factor",
    //     where the POINT patterns used their own `context` capture and did
    //     not;
    //   · with two metrics in one sentence, the FIRST list entry to match the
    //     50-character look-back wins, so the second range borrows the first
    //     one's label.
    const two = shapes("Cost 1-2m, revenue 3-4m this year.").filter(
      (f) => f.extractionType === "range",
    );
    expect(two.map((f) => [f.label, f.rangeMin, f.rangeMax])).toEqual([
      ["Cost", 1_000_000, 2_000_000],
      ["Cost", 3_000_000, 4_000_000], // ← `inferLabel` list order, not the sentence
    ]);
    expect(shapes("Spend of 300-500k on tooling.")[0]!.label).toBe("Factor");
  });
});

/* ===========================================================================
 * ⭐⭐ KNOWN_WORD_SEPARATOR_FLOOR — the 3 Sep defect, alive in the `to`/`and`
 * spelling (PR #1327 behaviour seat, finding C: "worth a pinned gap-set entry
 * rather than silence").
 *
 * `RANGE_SEPARATOR` admits `\s+(?:to|and)\s+`; `RANGE_LOWER_BOUND_ABSENT_GUARD`
 * looks only for `[-–—]`. So on the word spelling the point pattern is NOT
 * declined, and its confidence 0.90 beats the range's 0.80 in `mergeFactors`.
 * MEASURED through `enrichGraphWithFactorsAsync` — the node-minting surface,
 * not the producer — at base `f4c8f501` and at this repair:
 *
 *   "Budget of £80 to 120k for the hire."   BOTH  raw_value 80, cap 100
 *   "Budget of 80 to 120k for the hire."    BOTH  raw_value 80, cap 100
 *   "Budget of £80 and 120k for the hire."  BOTH  raw_value 80, cap 100
 *
 * That cap is the one that refused Paul's £100,000 on 3 Sep. It is NOT a
 * regression — base is identically wrong — and it is NOT closed here.
 *
 * ── WHY NOT CLOSED (trap 22f) ──────────────────────────────────────────────
 * Closing it means widening the guard's separator to the word forms, which by
 * this repair's own rule then requires widening `bareAmountRange` to match, so
 * every `X to Y` and anchored `X and Y` pair in the estate changes reading at
 * once. `RANGE_SEPARATOR`'s own docstring records what happened the last time
 * the `and` limb moved without an outside corpus: four measured fabrications,
 * one of them `min > max`. This repair's mandate is the DASH class the guard
 * deferred and nothing could read. The word axis needs its own corpus, from
 * outside the author's head, and its own seat.
 * ========================================================================= */
describe("KNOWN_WORD_SEPARATOR_FLOOR — pinned in both directions", () => {
  const WORD_SEPARATOR_STILL_UNDER_READS = [
    "Budget of £80 to 120k for the hire.",
    "Budget of 80 to 120k for the hire.",
    "Budget of £80 and 120k for the hire.",
  ] as const;

  it.each(WORD_SEPARATOR_STILL_UNDER_READS)(
    "OPEN (recorded): %s still mints raw_value 80 under a cap of 100",
    async (brief) => {
      const { graph } = await enrichGraphWithFactorsAsync(emptyGraph(), brief);
      const node = graph.nodes.find(
        (n) => n.kind === "factor" && String(n.label).toLowerCase().includes("budget"),
      );
      const data = node?.data as { raw_value?: number; cap?: number } | undefined;
      expect(data, `${brief}: no budget node at all — the floor MOVED, re-derive it`).toBeDefined();
      expect(data!.raw_value, brief).toBe(80);
      expect(data!.cap, "the cap that refused £100,000 on 3 Sep").toBe(100);
    },
  );

  it("⭐ TWIN: the DASH spelling of the same sentence is closed, and stays closed", async () => {
    // Without this the block above could be "satisfied" by a change that
    // under-reads everything, and it would read as a floor rather than a
    // regression.
    const { graph } = await enrichGraphWithFactorsAsync(
      emptyGraph(),
      "We're budgeting £80-120k for the first hire.",
    );
    const data = graph.nodes.find(
      (n) => n.kind === "factor" && String(n.label).toLowerCase().includes("budget"),
    )?.data as { raw_value?: number; cap?: number } | undefined;
    expect(data!.raw_value).toBe(100_000);
    expect(data!.cap, "admits the user's own upper bound, and then some").toBeGreaterThan(120_000);
  });
});
