/**
 * ⭐ PR-U1: ONE unit grammar under the edge-figure and quote checks (Science U-GRAMMAR G0–G4, #87 5999605004; the
 * PR-U1 boundary + 4 conditions, Science DM 5 Oct). Rows G4 3 (FA-R1), 4 (FA-R2), 6 (FA-R4), 7 (C1 safety, as
 * amended), condition 2 (C1 never contradicts the full reader) and condition 4 (the quote-check flip). G4 9 (the union
 * guard) is `utils/__tests__/unit-alphabet.union.test.ts`. Edge rows run on the SERVED AIE c1 bytes (#2601's fixture):
 * each edits one field of the same graph, so each verdict is bound to the item at a known `char_offset`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deriveNotModelledManifest } from "../../context-integrity/not-modelled-manifest.js";
import { statedEffectQuoteMatches, statedTargetAmountSpans } from "../stated-effect.js";
import {
  readCount,
  readMoneyTotal,
  readUnitParts,
  sameUnit,
  type UnitParts,
} from "../../../orchestrator-v5/agent-lane/same-unit.js";
import { unitsCompose } from "../../../orchestrator-v5/agent-lane/reconciling-product.js";
import { PERIOD_ADVERB_SPELLINGS, PERIOD_NOUN_SPELLINGS } from "../../../utils/unit-alphabet.js";

type Graph = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../context-integrity/__tests__/fixtures/served-aie-c1-merge-routes.json", import.meta.url)),
    "utf8",
  ),
) as { brief_text: string; graph: Graph };
const SPENDING = "annual_operating_delivery_spending";
const AT_75K = 445; // "£75,000" in the served brief ("… by about £75,000 a year.")
const graph = (): Graph => JSON.parse(JSON.stringify(FIXTURE.graph)) as Graph;
const spendingEffect = (g: Graph): Record<string, unknown> => {
  const e = g.edges.find((x) => x.from === "route_consolidation" && x.to === SPENDING) as { provenance: Record<string, unknown> };
  return e.provenance.natural_effect as Record<string, unknown>;
};
const verdictAt = (brief: string, g: Graph, offset: number) => {
  const items = deriveNotModelledManifest(brief, g).quantities?.items ?? [];
  const item = items.find((i) => i.char_offset === offset);
  expect(item?.literal, `no £75,000 at ${offset}`).toBe("£75,000");
  return { verdict: item!.verdict, matched: item!.matched_node_id };
};

describe("PR-U1 G4 row 3 (FA-R1): scale belongs to the number", () => {
  it("PRECONDITION: the served brief writes £75,000 a year at 445 and the edge holds −75000 GBP/year", () => {
    expect(FIXTURE.brief_text.slice(AT_75K, AT_75K + 14)).toBe("£75,000 a year");
    expect(spendingEffect(graph())).toMatchObject({ amount: -75000, amount_unit: "GBP/year" });
  });

  it("an edge holding −75 \"£k/year\" binds \"£75,000 a year\"; the same edge never binds \"£75,000 a month\"", () => {
    const g = graph();
    Object.assign(spendingEffect(g), { amount: -75, amount_unit: "£k/year" });
    expect(verdictAt(FIXTURE.brief_text, g, AT_75K)).toEqual({ verdict: "in_model", matched: SPENDING });
    const monthly = FIXTURE.brief_text.replace("£75,000 a year", "£75,000 a month");
    expect(verdictAt(monthly, g, AT_75K).verdict).toBe("absent");
  });
});

describe("PR-U1 G4 row 4 (FA-R2): every spelling of a year is a year", () => {
  for (const spelling of ["/year", " annually", " per annum", " p.a.", " yearly", " a year"]) {
    it(`"£75,000${spelling}" binds the GBP/year edge`, () => {
      const brief = FIXTURE.brief_text.replace("£75,000 a year", `£75,000${spelling}`);
      expect(verdictAt(brief, graph(), AT_75K)).toEqual({ verdict: "in_model", matched: SPENDING });
    });
  }
  // The discriminating half (mutant M2: a tail reader that misses the spelling reads NO period, and under C3 a part only
  // one side states is no conflict — so the GBP/year rows above would pass either way). Read as a YEAR, every spelling
  // CONFLICTS with an edge declared GBP/month.
  for (const spelling of ["/year", " annually", " per annum", " p.a.", " yearly", " a year"]) {
    it(`"£75,000${spelling}" is a year, so it never binds a GBP/month edge`, () => {
      const g = graph();
      spendingEffect(g).amount_unit = "GBP/month";
      const brief = FIXTURE.brief_text.replace("£75,000 a year", `£75,000${spelling}`);
      expect(verdictAt(brief, g, AT_75K).verdict).toBe("absent");
    });
  }
  it("CONTRAST: \"£75,000 a month\" is not a year", () => {
    const brief = FIXTURE.brief_text.replace("£75,000 a year", "£75,000 a month");
    expect(verdictAt(brief, graph(), AT_75K).verdict).toBe("absent");
  });
});

describe("PR-U1 G4 row 6 (FA-R4): % and percentage points are different units, both exact", () => {
  it("\"3 percentage points\" binds a pp edge; \"3%\" never does, and a % edge never takes \"3 percentage points\"", () => {
    expect(statedTargetAmountSpans("Delays fall by 3 percentage points.", -3, "percentage points")).toHaveLength(1);
    expect(statedTargetAmountSpans("Delays fall by 3 pp.", -3, "percentage points")).toHaveLength(1);
    expect(statedTargetAmountSpans("Delays fall by 3%.", -3, "percentage points")).toHaveLength(0);
    expect(statedTargetAmountSpans("Delays fall by 3 percentage points.", -3, "%")).toHaveLength(0);
  });
  it("whole words only: \"percentile\" is not a percent, and \"500 loyalty points\" is a count", () => {
    expect(readUnitParts("percentile")?.kind).toBe("count");
    expect(readUnitParts("%")?.kind).toBe("percent");
    expect(readUnitParts("percentage points")?.kind).toBe("points");
    expect(readUnitParts("loyalty points")).toMatchObject({ kind: "count", noun: ["loyalty", "point"] });
  });
});

describe("PR-U1 G4 row 7 (C1 safety, amended): C1 stays scale-strict and sees only month/year", () => {
  it("sameUnit never equates a scaled and an unscaled unit, and a weekly total is never a C1 total", () => {
    expect(sameUnit("£k/month", "£/month")).toBe(false);
    expect(sameUnit("£k/year", "£k/year")).toBe(true);
    expect(readMoneyTotal("£/week", "")).toBeNull();
    expect(readMoneyTotal("£/month", "")).toEqual({ code: "GBP", period: "month" });
  });
  it("a bare duration stays a COUNT for C1 (DL Review Desk ask 2): weeks, days, hours, minutes", () => {
    for (const [unit, noun] of [["weeks", "week"], ["days", "day"], ["hours", "hour"], ["minutes", "minute"]] as const) {
      expect(readCount(unit), unit).toEqual([noun]);
      expect(sameUnit(unit, noun), unit).toBe(true);
    }
  });
  it("\"£/hour\" × \"hours\" still composes for a goal with no period (Science: must stay PROOF)", () => {
    expect(unitsCompose("£", "Total cost", { unit: "£/hour", label: "Rate" }, { unit: "hours", label: "Hours" }).kind).toBe("proof");
  });
});

describe("PR-U1 condition 2: C1 may abstain but never contradicts the full reader", () => {
  const partsEqual = (a: UnitParts, b: UnitParts): boolean => JSON.stringify(a) === JSON.stringify(b);
  const spellings = [...Object.values(PERIOD_NOUN_SPELLINGS).flat(), ...Object.values(PERIOD_ADVERB_SPELLINGS).flat()];
  const units = [
    ...spellings.flatMap((w) => [`£/${w}`, `£ ${w}`, `GBP per ${w}`, `£ a ${w}`, w, `tickets/${w}`, `tickets ${w}`, `customers per ${w}`]),
    "£", "GBP", "£k/year", "£k/month", "£/subscriber/month", "£ per subscriber-month", "subscribers", "subscriber",
    "%", "percent", "pp", "percentage points", "% of output", "hours", "weeks", "GBP recurring revenue", "£ each",
  ];
  it("over every leaf spelling in every unit shape: sameUnit(a, b) ⇒ readUnitParts(a) ≡ readUnitParts(b)", () => {
    let checked = 0;
    const contradictions: string[] = [];
    for (const a of units) for (const b of units) {
      if (!sameUnit(a, b)) continue;
      const pa = readUnitParts(a); const pb = readUnitParts(b);
      if (pa === null || pb === null) continue;
      checked += 1;
      if (!partsEqual(pa, pb)) contradictions.push(`${a} | ${b}`);
    }
    expect(checked, "the corpus must exercise C1 equalities").toBeGreaterThan(100);
    expect(contradictions).toEqual([]);
  });
});

describe("PR-U1 condition 4: the quote check reads the same tail (a writer flip, listed)", () => {
  const quote = "Merging saves £75,000 annually for each 1% of rounds merged";
  it("\"£75,000 annually\" now evidences GBP/year; the same quote never evidences GBP/month", () => {
    const effect = { amount: -75000, per_source_change: 1, per_source_change_unit: "%" };
    expect(statedEffectQuoteMatches(quote, { ...effect, amount_unit: "GBP/year" })).toBe(true);
    expect(statedEffectQuoteMatches(quote, { ...effect, amount_unit: "GBP/month" })).toBe(false);
  });
});
