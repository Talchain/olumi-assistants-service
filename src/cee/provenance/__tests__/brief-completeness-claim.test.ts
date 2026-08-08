/**
 * ROADMAP 2.972(c) — THE PRODUCT MUST NOT TELL A USER THEIR BRIEF WAS LIGHT ON
 * DETAIL WHEN THEIR BRIEF CONTAINS DETAIL.
 *
 * MEASURED on deployed staging 2026-08-08 (CEE `4b57b8f`): the draft response
 * for brief B3 — 2,563 characters, ~14 quantitative atoms, the densest of the
 * three briefs driven that day — opened with
 *
 *     "Your brief was light on detail, so adding specifics will make the
 *      comparison more reliable."
 *
 * The sentence is selected by `widening_log.brief_completeness`, an
 * LLM-AUTHORED enum. Nothing derived it, nothing could refute it, and it
 * shipped as a confident statement about the user's own input.
 *
 * Same doctrine as the rest of the row with the sign flipped: where a claim
 * about what the user did or did not say cannot be established, the honest
 * output is the weaker claim — here, silence.
 */

import { describe, it, expect } from "vitest";

import { buildPostDraftNarrative } from "../../../orchestrator-v5/coaching/post-draft-narrative.js";
import { BRIEF_TEXT_AS_PERSISTED } from "./fixtures/trace-captures.js";

const GRAPH = {
  nodes: [
    { id: "goal", kind: "goal", label: "15% ARR growth without worse attrition" },
    { id: "opt_copilot", kind: "option", label: "Build the AI copilot" },
    { id: "opt_rewrite", kind: "option", label: "Do the platform rewrite" },
    { id: "fac_eng_capacity", kind: "factor", label: "Engineering capacity" },
    { id: "fac_llm_cost", kind: "factor", label: "LLM serving cost" },
  ],
} as any;

function narrate(briefText: string | null, completeness: "thin" | "partial" | "complete") {
  return buildPostDraftNarrative({
    graph: GRAPH,
    wideningLog: { brief_completeness: completeness } as any,
    briefText,
  });
}

const THIN_SENTENCE = "Your brief was light on detail";
const PARTIAL_SENTENCE = "Your brief covered the main points";

describe("2.972(c) the brief-completeness advisory", () => {
  it("withholds \"light on detail\" for B3, the brief it was measured making that claim about", () => {
    const result = narrate(BRIEF_TEXT_AS_PERSISTED.B3, "thin");
    expect(result.text).not.toContain(THIN_SENTENCE);
    expect(result.telemetry.brief_completeness).toBe("thin"); // the enum is still reported honestly
    expect(result.telemetry.brief_completeness_surfaced).toBe(false);
  });

  it("withholds it for B1 and B2 too — every brief of the trace states amounts", () => {
    for (const brief of ["B1", "B2"] as const) {
      const result = narrate(BRIEF_TEXT_AS_PERSISTED[brief], "thin");
      expect(result.text, `${brief} still told its author the brief was light on detail`).not.toContain(
        THIN_SENTENCE,
      );
    }
  });

  it("KEEPS it when the brief genuinely states nothing quantitative (the discriminating positive)", () => {
    // Without this case the guard could pass by suppressing the advisory
    // unconditionally, which is a different behaviour and would delete a
    // legitimate nudge.
    const result = narrate("Should we go into Germany or push harder in the UK? Not sure.", "thin");
    expect(result.text).toContain(THIN_SENTENCE);
    expect(result.telemetry.brief_completeness_surfaced).toBe(true);
  });

  it("KEEPS it when no brief text is available (behaviour is unchanged where evidence is absent)", () => {
    const result = narrate(null, "thin");
    expect(result.text).toContain(THIN_SENTENCE);
  });

  it("leaves the `partial` rung alone — it makes no negative claim and nothing measured it false", () => {
    // CLAUDE.md trap 21: two rungs, two different claims. Do not align them.
    const result = narrate(BRIEF_TEXT_AS_PERSISTED.B3, "partial");
    expect(result.text).toContain(PARTIAL_SENTENCE);
    expect(result.telemetry.brief_completeness_surfaced).toBe(true);
  });

  it("leaves `complete` alone — it surfaced nothing before and surfaces nothing now", () => {
    const result = narrate(BRIEF_TEXT_AS_PERSISTED.B3, "complete");
    expect(result.text).not.toContain(THIN_SENTENCE);
    expect(result.text).not.toContain(PARTIAL_SENTENCE);
    expect(result.telemetry.brief_completeness_surfaced).toBe(false);
  });
});
