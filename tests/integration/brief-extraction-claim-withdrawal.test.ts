/**
 * ⭐⭐ ROW 2.1207 — NO `display_value` MAY CLAIM BRIEF EXTRACTION WHILE SHOWING
 * A VALUE THE BRIEF DOES NOT CONTAIN.
 *
 * ── THE WITNESSED NODE, TRANSCRIBED FROM THE CAPTURE ───────────────────────
 * `closing-witness-20260814/driver/captures-run/captures/P3/committed-graph.json`,
 * node `19d5a529`, on a brief stating **£120,000**:
 *
 *     provenance:          "ai_inferred"                                 ← honest
 *     extractionType:      "inferred"                                    ← honest
 *     uncertainty_drivers: ["Extracted from brief — confirm value"]      ← FALSE
 *     display_value:       "£0.2 to £0.6"
 *
 * `schema-v3.ts` already withdraws a false brief claim from `provenance` and
 * `extractionType` (ROADMAP 2.972), with a comment naming exactly why — *"or the
 * wire still carries the claim one field to the left of the one we corrected."*
 * It missed the third carrier on the NODE — the only one of those three written
 * in English, and the one a user reads.
 *
 * ⚠ CORRECTED AT REVIEW: an earlier draft said "the only carrier written in
 * English", full stop. That was an overclaim — a FOURTH carrier rides EDGE
 * `provenance.quote` (`enricher.ts:457/:1145` → wire at `schema-v3.ts:811-814`)
 * and this node-level withdrawal does not reach it. Separately rowed; mitigated
 * by those edges carrying an honest `source: "hypothesis"` beside the claim.
 * A count is a claim about a SCOPE — state the scope or the count is wrong.
 *
 * ── THE INVARIANT IS THE AGREEMENT, NOT THE WITNESSED STRING (trap 13d) ────
 * `provenance` is the response's authority on "did this come from the brief".
 * A prose driver asserting brief extraction is a second carrier of that same
 * fact, so the two may not disagree in either direction (trap 12). Both
 * directions are tested below.
 */
import { describe, expect, it } from "vitest";

import { transformResponseToV3 } from "../../src/cee/transforms/index.js";
import type { V1DraftGraphResponse } from "../../src/cee/transforms/index.js";
import {
  BRIEF_EXTRACTION_CLAIM_PREFIX,
  BRIEF_EXTRACTION_CONFIRM_DRIVER,
  assertsBriefExtraction,
  briefExtractionQuote,
} from "../../src/cee/factor-extraction/brief-extraction-claim.js";

const BRIEF_PRICING =
  "Should we hold our seat price at £42, raise it to £49 per seat, or raise it to £59 per seat? " +
  "Our aim is to raise our average seat price. Today it is £42 per seat and our monthly " +
  "recurring revenue is £250,000. I want to reach £59 per seat within two quarters. " +
  "Churn is running at 4% and our annual support cost is £120,000.";

const CLAIM = "Extracted from brief — confirm value";

function replayWithSupportCost(): V1DraftGraphResponse {
  return {
    graph: {
      nodes: [
        { id: "3ea21b47", kind: "decision", label: "Decision" },
        { id: "987198bf", kind: "option", label: "hold our seat price at £42" },
        { id: "c3441206", kind: "option", label: "raise it to £49 per seat" },
        {
          id: "19d5a529",
          kind: "factor",
          label: "Annual Support Cost",
          category: "external",
          prior: { distribution: "uniform", range_min: 0.21, range_max: 0.63 },
          data: {
            unit: "£",
            factor_type: "price",
            extractionType: "inferred",
            uncertainty_drivers: [CLAIM],
          },
        },
        { id: "94fa174b", kind: "outcome", label: "Monthly Recurring Revenue" },
        { id: "957ac013", kind: "goal", label: "Our aim is to raise our average seat price" },
      ],
      edges: [
        { from: "3ea21b47", to: "987198bf", weight: 1, belief: 1 },
        { from: "3ea21b47", to: "c3441206", weight: 1, belief: 1 },
        { from: "19d5a529", to: "94fa174b", weight: 0.4, belief: 0.8 },
        { from: "94fa174b", to: "957ac013", weight: 1, belief: 1 },
      ],
      meta: { roots: ["3ea21b47"], leaves: ["957ac013"], source: "assistant" },
    },
    quality: { overall: 8, structure: 8, coverage: 8, structural_proxy: 8 },
    trace: { request_id: "replay-p3-claim", correlation_id: "replay" },
  } as unknown as V1DraftGraphResponse;
}

function nodeById(res: V1DraftGraphResponse, id: string): Record<string, unknown> {
  const v3 = transformResponseToV3(res, { brief: BRIEF_PRICING });
  const found = (v3.nodes as unknown as ReadonlyArray<Record<string, unknown>>).find(
    (n) => n.id === id,
  );
  expect(found, `node ${id} must survive the transform`).toBeDefined();
  return found as Record<string, unknown>;
}

describe("row 2.1207 — the brief-extraction claim is withdrawn with the badge", () => {
  const supportCost = nodeById(replayWithSupportCost(), "19d5a529");

  // PRECONDITION — pins that this node really is the un-badged one, so the
  // assertions below are the code's doing and not a fixture that stopped
  // reproducing the case (trap 13b).
  it("PRECONDITION — the node is present and NOT badged from_brief", () => {
    expect(supportCost.kind).toBe("factor");
    expect(supportCost.label).toBe("Annual Support Cost");
    expect(supportCost.provenance).toBe("ai_inferred");
  });

  it("⭐ the false 'Extracted from brief' driver does not reach the wire", () => {
    const drivers = (supportCost.uncertainty_drivers ?? []) as readonly unknown[];
    expect(drivers.some((d) => typeof d === "string" && d.startsWith("Extracted from brief"))).toBe(
      false,
    );
  });

  it("an empty list is dropped, not shipped as 'we looked and found none'", () => {
    expect(supportCost.uncertainty_drivers).toBeUndefined();
  });

  // ⭐ THE COMBINED ACCEPTANCE CONDITION, asserted as one statement over the
  // whole graph rather than about the one node the witness happened to catch.
  it("ACCEPTANCE — no node claims brief extraction unless its provenance says from_brief", () => {
    const v3 = transformResponseToV3(replayWithSupportCost(), { brief: BRIEF_PRICING });
    for (const n of v3.nodes as unknown as ReadonlyArray<Record<string, unknown>>) {
      const drivers = (n.uncertainty_drivers ?? []) as readonly unknown[];
      const claims = drivers.some(
        (d) => typeof d === "string" && d.startsWith("Extracted from brief"),
      );
      if (claims) expect(n.provenance).toBe("from_brief");
    }
  });

  // ── OPPOSITE DIRECTION. A withdrawal that took everything would satisfy every
  // assertion above while destroying honest content (trap 22b).
  it("TWIN — an unrelated uncertainty driver on the same node survives", () => {
    const res = replayWithSupportCost();
    const nodes = (res as unknown as { graph: { nodes: Array<Record<string, unknown>> } }).graph
      .nodes;
    const target = nodes.find((n) => n.id === "19d5a529")!;
    (target.data as Record<string, unknown>).uncertainty_drivers = [
      CLAIM,
      "Support contracts renew annually",
    ];
    const out = nodeById(res, "19d5a529");
    expect(out.uncertainty_drivers).toEqual(["Support contracts renew annually"]);
  });

  it("TWIN — the normalised prior is no longer rendered as a currency value", () => {
    expect(String(supportCost.display_value ?? "")).not.toMatch(/[£$€¥₹]/);
  });
});

describe("row 2.1207 — F4: producers and guard share ONE constant", () => {
  /**
   * The claim had four producer sites and one consumer, every one spelling the
   * literal by hand — and the consumer is a guard that must RECOGNISE what the
   * producers write. Two hand-maintained spellings of one string, where one
   * recognises the other, is trap 12 with a user-facing lie as the failure mode:
   * reword the producer (em-dash → hyphen, capital → lower case) and the
   * withdrawal silently stops matching while every test spelling the old literal
   * stays green.
   */
  it("the driver the ENRICHER emits is recognised by the guard — by construction", () => {
    expect(assertsBriefExtraction(BRIEF_EXTRACTION_CONFIRM_DRIVER)).toBe(true);
  });

  it("the edge-quote form is built from the same prefix", () => {
    expect(briefExtractionQuote('churn is 4%')).toBe(
      `${BRIEF_EXTRACTION_CLAIM_PREFIX}: "churn is 4%"`,
    );
    expect(assertsBriefExtraction(briefExtractionQuote("anything"))).toBe(true);
  });

  /**
   * Recognition is case-INSENSITIVE and the direction of that choice is the
   * point: failing to recognise a claim leaves a LIE on the wire, recognising
   * one variant too many only withdraws a driver line. Recognise generously,
   * withdraw safely.
   */
  it.each([
    ["extracted from brief — confirm value"],
    ["EXTRACTED FROM BRIEF — confirm value"],
    ["  Extracted from brief — confirm value"],
  ])("a case/whitespace variant %s is still recognised", (variant) => {
    expect(assertsBriefExtraction(variant)).toBe(true);
  });

  // OPPOSITE DIRECTION — a guard that recognised everything would satisfy every
  // assertion above while deleting honest content.
  it.each([
    ["Support contracts renew annually"],
    ["Extracted"],
    ["Derived from the brief"],
    [""],
    [null],
    [42],
  ])("TWIN — %s does NOT assert brief extraction", (value) => {
    expect(assertsBriefExtraction(value)).toBe(false);
  });

  // ⭐ THE DRIFT PIN. Producers build from the prefix, so this fails the moment
  // someone changes the user-facing wording without updating the guard's anchor.
  it("the enricher's driver literally starts with the shared prefix", () => {
    expect(BRIEF_EXTRACTION_CONFIRM_DRIVER.startsWith(BRIEF_EXTRACTION_CLAIM_PREFIX)).toBe(true);
  });
});
