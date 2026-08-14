/**
 * THE ACCEPTANCE RUNNER MUST ACTUALLY RUN — and must not report a pass it
 * cannot support.
 *
 * `scripts/records-pinned-brief-acceptance.ts` is the post-merge deploy
 * witness's measuring instrument for the 14 Aug analysis outage. A witness
 * script that has silently stopped working is the estate's most expensive
 * failure shape: it reads exactly like a clean result. So this suite runs it
 * against the repo's banked fixtures and asserts BOTH halves of its contract —
 * the conditions a fixture can settle, and the conditions it cannot.
 *
 * ⚠ The second half is the important one. Two of the five conditions are claims
 * about what a LIVE model emits under the widened grammar, and this lane did not
 * and could not measure them. If a later change made them read `PASS` offline,
 * the instrument would be certifying the live behaviour of a model it never
 * called — so `UNEVALUABLE` is asserted BY NAME, not merely tolerated.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

import {
  buildReport,
  evaluate,
  exitCodeFor,
  loadFixtureRecordSets,
  collectGraphs,
  PINNED_BRIEF,
} from "../../scripts/records-pinned-brief-acceptance.js";

const REPO_ROOT = resolve(new URL("../..", import.meta.url).pathname);

describe("the pinned-brief acceptance runner, against fixtures", () => {
  it("replays every banked capture and reports a per-draw semantic table", async () => {
    const report = await buildReport({ repoRoot: REPO_ROOT, minimumDraws: 4 });

    expect(report.mode).toBe("fixtures");
    expect(report.brief).toBe(PINNED_BRIEF);
    // POSITIVE CONTROL — the fixture loader found real inputs. A runner that
    // silently loaded nothing would produce a clean-looking, empty verdict.
    expect(report.drawCount).toBeGreaterThanOrEqual(4);
    // Bound by IDENTITY: the banked round-11 live emission the outage was
    // diagnosed on must be one of the draws, by name.
    expect(report.perDraw.map((d) => d.label)).toContain("live-emission-round11-set12.json");
  });

  it("settles the conditions a deterministic chain owns, and REFUSES the two it does not", async () => {
    const report = await buildReport({ repoRoot: REPO_ROOT, minimumDraws: 4 });
    const verdictOf = (id: string) => report.conditions.find((c) => c.id === id)?.verdict;

    // Live-model claims — nothing offline may certify these.
    expect(verdictOf("A1")).toBe("UNEVALUABLE");
    expect(verdictOf("A2")).toBe("UNEVALUABLE");
    // Deterministic-chain properties — a fixture settles these exactly as a
    // live draw would.
    expect(verdictOf("A3")).toBe("PASS");
    expect(verdictOf("A4")).toBe("PASS");
    expect(verdictOf("A5")).toBe("PASS");

    // …and the overall verdict inherits the weakest, so a fixture run can never
    // be mistaken for the witness.
    expect(report.overall).toBe("UNEVALUABLE");
  });

  it("exits 2 on UNEVALUABLE — 'could not measure' is never a pass", () => {
    expect(exitCodeFor("PASS")).toBe(0);
    expect(exitCodeFor("FAIL")).toBe(1);
    expect(exitCodeFor("UNEVALUABLE")).toBe(2);
  });

  it("refuses a verdict over an empty population", async () => {
    await expect(
      buildReport({ repoRoot: resolve(REPO_ROOT, "src"), minimumDraws: 1 }),
    ).rejects.toThrow();
  });
});

describe("the runner's conditions discriminate", () => {
  /**
   * A guard that returned PASS whatever it was handed would satisfy every
   * assertion above. These two cases feed it populations that MUST fail, so the
   * green results are known to be the code's doing (trap 13b).
   */
  it("A3 FAILS on a draw whose minted outcome is UNMARKED", () => {
    const conditions = evaluate(
      [
        {
          label: "synthetic",
          semantics: {
            nodeCount: 2,
            edgeCount: 1,
            byKind: { outcome: 1, goal: 1 },
            riskCount: 0,
            riskLabels: [],
            outcomeCount: 1,
            outcomeLabels: ["Throughput Impact"],
            scaffoldedOutcomeIds: [],
            scaffoldedOutcomeShare: 0,
            impactPatternOutcomeIds: ["out_fac_a_impact"],
            optionCount: 0,
            optionProvenance: [],
          },
        },
      ],
      "draws",
      1,
    );
    const a3 = conditions.find((c) => c.id === "A3");
    expect(a3?.verdict).toBe("FAIL");
    expect(a3?.detail).toContain("out_fac_a_impact");
  });

  it("A4 FAILS on a draw carrying an unclassified option", () => {
    const conditions = evaluate(
      [
        {
          label: "synthetic",
          semantics: {
            nodeCount: 1,
            edgeCount: 0,
            byKind: { option: 1 },
            riskCount: 0,
            riskLabels: [],
            outcomeCount: 0,
            outcomeLabels: [],
            scaffoldedOutcomeIds: [],
            scaffoldedOutcomeShare: null,
            impactPatternOutcomeIds: [],
            optionCount: 1,
            optionProvenance: [{ id: "opt_a", label: "A", provenance_class: null }],
          },
        },
      ],
      "draws",
      1,
    );
    expect(conditions.find((c) => c.id === "A4")?.verdict).toBe("FAIL");
  });
});

describe("the runner's input readers", () => {
  it("loads only record-set-shaped fixtures, and finds the banked ones", () => {
    const loaded = loadFixtureRecordSets(REPO_ROOT);
    expect(loaded.length).toBeGreaterThanOrEqual(4);
    for (const f of loaded) {
      expect(Array.isArray(f.records.stated_items)).toBe(true);
      expect(Array.isArray(f.records.claims)).toBe(true);
    }
  });

  it("finds graphs nested anywhere in a driver artefact, and nothing that is not one", () => {
    const found: { label: string; graph: unknown }[] = [];
    collectGraphs(
      { draws: [{ p1: { graph: { nodes: [{ id: "a", kind: "goal" }], edges: [] } } }], note: "not a graph" },
      "",
      found,
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.label).toBe("draws[0].p1.graph");
  });
});
