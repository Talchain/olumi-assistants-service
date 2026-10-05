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
    "percents", "percent increase", "percent increases", "£ year", "£ month", "GBP year",
    "£/min", "£/mins", "percents increase", "year GBP", "£ per subscriber-month", "£/subscriber/month", "GBP per subscriber per month",
  ];
  it("over every leaf spelling in every unit shape: sameUnit(a, b) ⇒ readUnitParts(a) ≡ readUnitParts(b)", () => {
    let checked = 0;
    const contradictions: string[] = [];
    for (const a of units) for (const b of units) {
      if (!sameUnit(a, b)) continue;
      const pa = readUnitParts(a); const pb = readUnitParts(b);
      if (pa === null && pb === null) continue;
      checked += 1;
      // Codex r1: a C1 equality where the full reader reads only ONE side is a contradiction too ("£ year" | "£/year").
      if (pa === null || pb === null || !partsEqual(pa, pb)) contradictions.push(`${a} | ${b}`);
    }
    expect(checked, "the corpus must exercise C1 equalities").toBeGreaterThan(100);
    expect(contradictions).toEqual([]);
  });
});

describe("Codex r1 on #2604, P1: every part the user STATED after a figure reaches C3", () => {
  it("served c1: \"£75,000 per client per year\" never binds a \"GBP per customer per year\" edge; a matching denominator does", () => {
    const brief = FIXTURE.brief_text.replace("£75,000 a year", "£75,000 per client per year");
    const g = graph();
    spendingEffect(g).amount_unit = "GBP per customer per year";
    expect(verdictAt(brief, g, AT_75K).verdict).toBe("absent");
    spendingEffect(g).amount_unit = "GBP per client per year";
    expect(verdictAt(brief, g, AT_75K)).toEqual({ verdict: "in_model", matched: SPENDING });
  });
  it("a denominator read with a following word still binds its own unit, never another noun's", () => {
    expect(statedTargetAmountSpans("Each audit costs £8k per audit aiming for four.", 8000, "£/audit")).toHaveLength(1);
    expect(statedTargetAmountSpans("Each audit costs £8k per audit aiming for four.", 8000, "£/client")).toHaveLength(0);
  });
  it("a count's stated period and a share's stated base are kept", () => {
    expect(statedTargetAmountSpans("We log 500 hours per week.", 500, "hours per month")).toHaveLength(0);
    expect(statedTargetAmountSpans("We log 500 hours per week.", 500, "hours per week")).toHaveLength(1);
    expect(statedTargetAmountSpans("Scrap is 18% of revenue.", 18, "% of output")).toHaveLength(0);
    expect(statedTargetAmountSpans("Scrap is 18% of output.", 18, "% of output")).toHaveLength(1);
    expect(statedTargetAmountSpans("We handle 12,000 tickets a month.", 12000, "tickets/month")).toHaveLength(1);
    expect(statedTargetAmountSpans("We handle 12,000 tickets a month.", 12000, "tickets/year")).toHaveLength(0);
  });
  it("a stated noun phrase CONTAINS the declared noun (\"new subscribers\" holds \"subscribers\"); another noun does not", () => {
    expect(statedTargetAmountSpans("We add 40 new subscribers a month.", 40, "subscribers/month")).toHaveLength(1);
    expect(statedTargetAmountSpans("We add 40 new customers a month.", 40, "subscribers/month")).toHaveLength(0);
  });
  it("the writer sees the stated denominator too: \"£75,000 per client per year\" does not evidence GBP/year", () => {
    const effect = { amount: -75000, per_source_change: 1, per_source_change_unit: "%" };
    const q = "Merging saves £75,000 per client per year for each 1% of rounds merged";
    expect(statedEffectQuoteMatches(q, { ...effect, amount_unit: "GBP/year" })).toBe(false);
    expect(statedEffectQuoteMatches(q, { ...effect, amount_unit: "GBP/client/year" })).toBe(true);
  });
});

describe("Codex r1 on #2604, P2: the full reader reaches the manifest's edge candidate", () => {
  for (const unit of ["pounds/year", "GBP yearly", "GBP p.a.", "sterling/year"]) {
    it(`an edge declared "${unit}" binds "£75,000 a year"`, () => {
      const g = graph();
      spendingEffect(g).amount_unit = unit;
      expect(verdictAt(FIXTURE.brief_text, g, AT_75K)).toEqual({ verdict: "in_model", matched: SPENDING });
    });
  }
  it("C1 abstains where only one side is a share spelling, and share qualifiers compare singular", () => {
    expect(sameUnit("percent", "percents")).toBe(false);
    expect(readUnitParts("percent increase")).toEqual(readUnitParts("percent increases"));
  });
});

describe("Codex r2 on #2604: no stated part is dropped, no failed read admits, no quoted edge credits elsewhere", () => {
  it("(1) a named \"each\" denominator, a hyphenated rate, a long noun phrase and a share qualifier all reach C3", () => {
    expect(statedTargetAmountSpans("It saves £75,000 each client per year.", 75000, "GBP/customer/month")).toHaveLength(0);
    expect(statedTargetAmountSpans("It saves £75,000 each client per year.", 75000, "GBP/client/year")).toHaveLength(1);
    expect(statedTargetAmountSpans("It saves £75,000 per client-month.", 75000, "GBP/customer/year")).toHaveLength(0);
    expect(statedTargetAmountSpans("It saves £75,000 per client-month.", 75000, "GBP/client/month")).toHaveLength(1);
    expect(statedTargetAmountSpans("We add 500 new billable hours per client per week.", 500, "hours/month")).toHaveLength(0);
    expect(statedTargetAmountSpans("We add 500 new billable hours per client per week.", 500, "hours per client per week")).toHaveLength(1);
    expect(statedTargetAmountSpans("We charge £900 per billable working day.", 900, "£/year")).toHaveLength(0);
    expect(statedTargetAmountSpans("Sales grew by an 18% increase.", 18, "% decrease")).toHaveLength(0);
    expect(statedTargetAmountSpans("Sales grew by an 18% increase.", 18, "% increase")).toHaveLength(1);
  });
  it("(2) a tail that names conflicting periods abstains: it never evidences a periodless GBP", () => {
    const effect = { amount: -75000, per_source_change: 1, per_source_change_unit: "%" };
    expect(statedEffectQuoteMatches("Merging saves £75,000 a month per year for each 1% of rounds merged", { ...effect, amount_unit: "GBP" })).toBe(false);
  });
  it("(3) a verified quote binds ONLY its own numeral: the monthly pension is never the annual edge's figure", () => {
    const quote = "Each 1% of rounds merged saves £75,000 annually.";
    const brief = `${quote} Pension contributions are £75,000 a month.`;
    const g = graph();
    const e = g.edges.find((x) => x.from === "route_consolidation" && x.to === SPENDING) as { provenance: Record<string, unknown> };
    e.provenance.quote = quote;
    Object.assign(spendingEffect(g), { amount: -75000, amount_unit: "GBP/year", per_source_change: 1, per_source_change_unit: "%" });
    const items = deriveNotModelledManifest(brief, g).quantities?.items ?? [];
    const at = (offset: number) => items.find((i) => i.char_offset === offset);
    expect(at(quote.indexOf("£"))).toMatchObject({ literal: "£75,000", verdict: "in_model", matched_node_id: SPENDING });
    expect(at(brief.lastIndexOf("£"))).toMatchObject({ literal: "£75,000", verdict: "absent" });
    // The same quote written TWICE: nothing says which one the edge holds, so neither is credited.
    const twice = deriveNotModelledManifest(`${quote} ${quote}`, g).quantities?.items ?? [];
    expect(twice.filter((i) => i.literal === "£75,000").map((i) => i.verdict)).toEqual(["absent", "absent"]);
  });
  it("(4) C1 abstains where the full reader disagrees or reads one side only", () => {
    expect(sameUnit("£/min", "£/mins")).toBe(false);
    expect(sameUnit("percent increase", "percents increase")).toBe(false);
    expect(sameUnit("year GBP", "GBP/year")).toBe(false);
    expect(sameUnit("GBP recurring revenue", "GBP recurring revenue")).toBe(true);
    expect(sameUnit("£ per subscriber-month", "£ per subscriber-month")).toBe(true);
  });
});

describe("PR-U1 condition 4: the quote check reads the same tail (a writer flip, listed)", () => {
  const quote = "Merging saves £75,000 annually for each 1% of rounds merged";
  it("\"£75,000 annually\" now evidences GBP/year; the same quote never evidences GBP/month", () => {
    const effect = { amount: -75000, per_source_change: 1, per_source_change_unit: "%" };
    expect(statedEffectQuoteMatches(quote, { ...effect, amount_unit: "GBP/year" })).toBe(true);
    expect(statedEffectQuoteMatches(quote, { ...effect, amount_unit: "GBP/month" })).toBe(false);
  });
  // ⛔ LISTED LOSSES vs base, pinned on purpose (Science ruling on #2604's writer, 5 Oct). The writer stays C1: base
  // admitted "£50,000 annually" for a periodless "GBP" only because its reader could not see "annually" (it already
  // refused "a year"). Admitting a period only the quote states needs the TARGET node's period checked first, or an
  // "annually" figure lands on a monthly target as the user's own 12× size — that guard is the follow-up row.
  it("LISTED LOSS: a period only the quote states is not admitted against a periodless GBP (end-context guard = follow-up)", () => {
    const effect = { amount: -75000, per_source_change: 1, per_source_change_unit: "%" };
    expect(statedEffectQuoteMatches(quote, { ...effect, amount_unit: "GBP" })).toBe(false);
    expect(statedEffectQuoteMatches("Merging saves £75,000 p.a. for each 1% of rounds merged", { ...effect, amount_unit: "GBP" })).toBe(false);
  });
  it("LISTED LOSS: \"3 percentage points\" no longer evidences a bare \"points\" (with no % target it is not pp, G1)", () => {
    const q = "Delays fall by 3 percentage points for each 1% of rounds merged";
    const effect = { amount: -3, per_source_change: 1, per_source_change_unit: "%" };
    expect(statedEffectQuoteMatches(q, { ...effect, amount_unit: "points" })).toBe(false);
    expect(statedEffectQuoteMatches(q, { ...effect, amount_unit: "percentage points" })).toBe(true);
  });
});
