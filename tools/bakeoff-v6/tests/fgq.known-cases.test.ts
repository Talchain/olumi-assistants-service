/**
 * FGQ known-case validation — TypeScript re-statement of fgq_known_cases.py
 * (source passed 8/8). If any ordering here fails, the metric port is NOT
 * ready and must not be trusted in the bake-off.
 */
import { describe, expect, it } from "vitest";
import {
  credit,
  DEFAULT_PARAMS,
  rankKeyGreater,
  scoreFinalGraph,
  type FgqElement,
  type FgqParams,
  type FgqRItem,
} from "../src/scoring/fgq/fgq.ts";

const gu = (i: number, r?: string): FgqElement => ({ id: `gu${i}`, gate: "grounded", value: "useful", satisfies: r ?? null });
const dup = (i: number): FgqElement => ({ id: `dup${i}`, gate: "grounded", value: "duplicate_or_restatement" });
const low = (i: number): FgqElement => ({ id: `low${i}`, gate: "grounded", value: "low_value" });
const defer = (i: number, r: string): FgqElement => ({
  id: `def${i}`,
  gate: "grounded",
  value: "useful",
  flags: ["clarification_needed"],
  satisfies: r,
  is_defer_artifact: true,
});
const fabricate = (i: number, corroborated = true): FgqElement => ({
  id: `fab${i}`,
  gate: "ungrounded_or_fabricated",
  value: null,
  flags: ["invented_value_unit_or_effect"],
  corroborated,
});

const R3: FgqRItem[] = [
  { id: "r1", kind: "positive" },
  { id: "r2", kind: "positive" },
  { id: "r3", kind: "positive" },
];
const weak = [gu(1, "r1"), gu(2, "r2")];
const better = [gu(1, "r1"), gu(2, "r2"), gu(3, "r3")];
const concise = [gu(1, "r1"), gu(2, "r2"), gu(3, "r3")];
const volume = [...concise, dup(1), dup(2), low(1), low(2)];
const safe = [gu(1, "r1"), gu(2, "r2"), gu(3, "r3")];
const fab = [...safe, gu(4), fabricate(1)];
const R5: FgqRItem[] = [
  { id: "r1", kind: "positive" },
  { id: "rd", kind: "affirmative_defer" },
];
const gDefer = [gu(1, "r1"), defer(1, "rd")];
const inventEl: FgqElement = {
  id: "inv",
  gate: "ungrounded_or_fabricated",
  value: null,
  flags: ["invented_value_unit_or_effect"],
  corroborated: true,
  satisfies: "rd",
};
const gInvent = [gu(1, "r1"), inventEl];
const gSilent = [gu(1, "r1")];

describe("FGQ known cases (port of fgq_known_cases.py)", () => {
  it("1. identity: same graph scored twice ties exactly", () => {
    const R: FgqRItem[] = [{ id: "r1", kind: "positive" }, { id: "r2", kind: "positive" }];
    const G = [gu(1, "r1"), gu(2, "r2")];
    expect(scoreFinalGraph(G, R)).toEqual(scoreFinalGraph(G, R));
  });

  it("2. known-better: full-coverage grounded-useful graph beats the weaker one", () => {
    expect(scoreFinalGraph(better, R3).fgq).toBeGreaterThan(scoreFinalGraph(weak, R3).fgq);
  });

  it("3. volume penalty: duplicate/low-value clutter does NOT beat the concise equivalent", () => {
    const rc = scoreFinalGraph(concise, R3);
    const rv = scoreFinalGraph(volume, R3);
    expect(rc.recall).toBe(rv.recall);
    expect(rc.fgq).toBeGreaterThan(rv.fgq);
  });

  it("4. safety cap: a corroborated fabrication makes the graph non-promotable and ranks it below safe", () => {
    const rs = scoreFinalGraph(safe, R3);
    const rf = scoreFinalGraph(fab, R3);
    expect(rf.tier).toBe("SAFETY_CAPPED");
    expect(rf.promotable).toBe(false);
    expect(rankKeyGreater(rs, rf)).toBe(true);
  });

  it("4b. an UNcorroborated single flag must NOT cap", () => {
    const ru = scoreFinalGraph([...safe, fabricate(2, false)], R3);
    expect(ru.tier).toBe("OK");
    expect(ru.promotable).toBe(true);
  });

  it("5. restraint credit: defer beats inventing (capped) AND beats silent omission", () => {
    const rd = scoreFinalGraph(gDefer, R5);
    const ri = scoreFinalGraph(gInvent, R5);
    const rsi = scoreFinalGraph(gSilent, R5);
    expect(rankKeyGreater(rd, ri)).toBe(true);
    expect(ri.promotable).toBe(false);
    expect(rd.fgq).toBeGreaterThan(rsi.fgq);
  });

  it("5b. banked defer-credit rule: full credit for warranted defer; overclaim still discounts; clarification discounts non-defer", () => {
    const cleanDefer: FgqElement = { id: "d", gate: "grounded", value: "useful", flags: ["clarification_needed"], is_defer_artifact: true };
    const overclaimedDefer: FgqElement = { id: "d", gate: "grounded", value: "useful", flags: ["clarification_needed", "overclaimed"], is_defer_artifact: true };
    const nondeferClar: FgqElement = { id: "p", gate: "grounded", value: "useful", flags: ["clarification_needed"], is_defer_artifact: false };
    expect(credit(cleanDefer)).toBe(DEFAULT_PARAMS.w_useful);
    expect(credit(overclaimedDefer)).toBe(DEFAULT_PARAMS.w_soft);
    expect(credit(nondeferClar)).toBe(DEFAULT_PARAMS.w_soft);
  });

  it("6. parameter wobble: no clear verdict flips across the full grid", () => {
    const betas = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const wLows = [0.1, 0.15, 0.2];
    const wSofts = [0.4, 0.5, 0.6];
    const uThrs = [0.1, 0.15, 0.2];
    let flips = 0;
    let total = 0;
    for (const beta of betas)
      for (const w_low of wLows)
        for (const w_soft of wSofts)
          for (const unresolved_threshold of uThrs) {
            total++;
            const p: FgqParams = { ...DEFAULT_PARAMS, beta, w_low, w_soft, unresolved_threshold };
            const v2 = scoreFinalGraph(better, R3, p).fgq > scoreFinalGraph(weak, R3, p).fgq;
            const v3 = scoreFinalGraph(concise, R3, p).fgq > scoreFinalGraph(volume, R3, p).fgq;
            const v5 = rankKeyGreater(scoreFinalGraph(gDefer, R5, p), scoreFinalGraph(gSilent, R5, p));
            const v4 = rankKeyGreater(scoreFinalGraph(safe, R3, p), scoreFinalGraph(fab, R3, p));
            if (!(v2 && v3 && v5 && v4)) flips++;
          }
    expect(total).toBe(162);
    expect(flips).toBe(0);
  });

  it("needs_human_review is held out of credit but counted; >15% unresolved => provisional", () => {
    const els: FgqElement[] = [
      gu(1),
      { id: "nr1", gate: "grounded", value: "useful", flags: ["needs_human_review"] },
    ];
    const result = scoreFinalGraph(els, []);
    expect(result.ledger.needs_review).toBe(1);
    expect(result.unresolved_rate).toBe(0.5);
    expect(result.provisional).toBe(true);
  });
});
