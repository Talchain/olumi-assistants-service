/**
 * The draft-seam mapping re-ask: PROMPT CONTRACT, PARSE, IDENTITY FILTER.
 *
 * ⚠ SCOPE, STATED FIRST. Every `call` below is a fake. Nothing here is evidence
 * about what a model returns (trap 16). What is pinned is what the model is
 * ASKED, and what this module does with each shape of answer — including the
 * shapes that must be refused.
 */

import { describe, expect, it } from "vitest";
import {
  buildOptionFactorMapUserContent,
  mapOptionsToFactors,
  OPTION_FACTOR_MAP_OUTPUT_SCHEMA,
  OPTION_FACTOR_MAP_SYSTEM_PROMPT,
  type OptionFactorMapModelCall,
  type OptionFactorMapRequest,
} from "../option-factor-mapper.js";

const REQ: OptionFactorMapRequest = {
  options: [{ option_id: "opt_two_devs", label: "Hire two developers only" }],
  factors: [
    { factor_id: "fac_capacity", label: "Delivery capacity", targeted_by: ["Hire a tech lead"] },
    { factor_id: "fac_leadership", label: "Technical leadership", targeted_by: [] },
  ],
  brief: "Should we hire a tech lead or two developers?",
};

const stub =
  (content: string, seen?: { system?: string; user?: string; timeoutMs?: number }): OptionFactorMapModelCall =>
  async (args) => {
    if (seen) {
      seen.system = args.system;
      seen.user = args.userMessage;
      seen.timeoutMs = args.timeoutMs;
    }
    return { content };
  };

describe("what the model is told", () => {
  it("names every factor id, every option id, and the brief", () => {
    const content = buildOptionFactorMapUserContent(REQ);
    for (const token of [
      "fac_capacity",
      "fac_leadership",
      "opt_two_devs",
      "Should we hire a tech lead or two developers?",
    ]) {
      expect(content).toContain(token);
    }
    // Sibling usage is CONTEXT, and it is labelled as such rather than handed
    // over as a list to copy — the specific error the prompt names.
    expect(content).toContain("already changed by: Hire a tech lead");
    expect(content).toContain("not changed by any option yet");
  });

  it("⭐ the prompt asks for WHICH, forbids HOW MUCH, and offers a refusal by name", () => {
    // Derived from the design constraint, not from a reading of the text: the
    // magnitude has exactly one producer (the estimate batch) and a second one
    // here would skip the user's review card.
    expect(OPTION_FACTOR_MAP_SYSTEM_PROMPT).toContain("Do NOT estimate how much");
    expect(OPTION_FACTOR_MAP_SYSTEM_PROMPT).toContain("declined_reason");
    expect(OPTION_FACTOR_MAP_SYSTEM_PROMPT).toContain("Listing every factor is not an");
  });

  it("the structured-output schema admits a refusal and forbids an unrequested key", () => {
    const items = (
      (OPTION_FACTOR_MAP_OUTPUT_SCHEMA.properties as Record<string, { items: Record<string, unknown> }>)
        .mappings.items
    );
    expect(items.additionalProperties).toBe(false);
    expect(items.required).toEqual(["option_id", "factor_ids"]);
    expect(Object.keys(items.properties as object).sort()).toEqual(
      ["declined_reason", "factor_ids", "option_id", "reasoning"].sort(),
    );
  });

  it("passes the caller's timeout through to the boundary", async () => {
    const seen: { timeoutMs?: number } = {};
    await mapOptionsToFactors(
      REQ,
      stub(JSON.stringify({ mappings: [{ option_id: "opt_two_devs", factor_ids: ["fac_capacity"] }] }), seen),
      7_777,
    );
    expect(seen.timeoutMs).toBe(7_777);
  });
});

describe("what it does with the answer", () => {
  it("accepts a mapping and keeps its reasoning", async () => {
    const out = await mapOptionsToFactors(
      REQ,
      stub(
        JSON.stringify({
          mappings: [
            { option_id: "opt_two_devs", factor_ids: ["fac_capacity"], reasoning: "two devs add throughput" },
          ],
        }),
      ),
    );
    expect(out).toEqual({
      status: "ok",
      mappings: [
        { option_id: "opt_two_devs", factor_ids: ["fac_capacity"], reasoning: "two devs add throughput" },
      ],
    });
  });

  it("⭐ DROPS A FACTOR IT WAS NOT OFFERED — a typo must not mint an edge to a node that does not exist", async () => {
    const out = await mapOptionsToFactors(
      REQ,
      stub(
        JSON.stringify({
          mappings: [
            { option_id: "opt_two_devs", factor_ids: ["fac_capacity", "fac_TYPO", "fac_capacity"] },
          ],
        }),
      ),
    );
    // Deduped AND filtered by identity, in one step.
    expect(out).toMatchObject({ status: "ok", mappings: [{ factor_ids: ["fac_capacity"] }] });
  });

  it("⭐ DROPS AN OPTION IT WAS NOT ASKED ABOUT — the drafter's own judgement on a sibling stands", async () => {
    const out = await mapOptionsToFactors(
      REQ,
      stub(
        JSON.stringify({
          mappings: [
            { option_id: "opt_tech_lead", factor_ids: ["fac_leadership"] },
            { option_id: "opt_two_devs", factor_ids: ["fac_capacity"] },
          ],
        }),
      ),
    );
    expect(out).toMatchObject({ status: "ok" });
    expect((out as { mappings: Array<{ option_id: string }> }).mappings.map((m) => m.option_id)).toEqual([
      "opt_two_devs",
    ]);
  });

  it("carries an explicit refusal through as a refusal", async () => {
    const out = await mapOptionsToFactors(
      REQ,
      stub(
        JSON.stringify({
          mappings: [
            { option_id: "opt_two_devs", factor_ids: [], declined_reason: "no factor here is about headcount" },
          ],
        }),
      ),
    );
    expect(out).toMatchObject({
      status: "ok",
      mappings: [{ factor_ids: [], declined_reason: "no factor here is about headcount" }],
    });
  });

  it("⭐ REJECTS A BLANK DRESSED AS A REFUSAL: an empty list with no reason is off-contract", async () => {
    const out = await mapOptionsToFactors(
      REQ,
      stub(JSON.stringify({ mappings: [{ option_id: "opt_two_devs", factor_ids: [] }] })),
    );
    expect(out.status).toBe("off_contract");
    // Opposite-direction twin: the SAME shape WITH a reason is accepted above, so
    // this refusal bounds the missing reason and not the empty list.
  });

  it("rejects an unrequested key rather than silently dropping it", async () => {
    const out = await mapOptionsToFactors(
      REQ,
      stub(
        JSON.stringify({
          mappings: [{ option_id: "opt_two_devs", factor_ids: ["fac_capacity"], magnitude: 0.6 }],
        }),
      ),
    );
    expect(out.status).toBe("off_contract");
  });

  it("reports unparseable content as unparseable, not as an empty answer", async () => {
    const out = await mapOptionsToFactors(REQ, stub("I cannot fetch external sources"));
    expect(out).toMatchObject({ status: "unparseable" });
  });

  it("makes no call when there is nothing to ask about", async () => {
    let called = 0;
    const out = await mapOptionsToFactors({ ...REQ, options: [] }, async () => {
      called += 1;
      return { content: "{}" };
    });
    expect(out).toEqual({ status: "no_options" });
    expect(called).toBe(0);
  });
});
