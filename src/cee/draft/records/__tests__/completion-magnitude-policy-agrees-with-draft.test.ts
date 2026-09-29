/**
 * ⭐⭐ ONE POLICY, TWO PROMPTS — THE COMPLETION PASS MUST NOT CARRY THE RULE THE
 * DRAFT DELETED.
 *
 * ── THE DEFECT THIS BINDS ──────────────────────────────────────────────────
 * The draft prompt and the completion prompt both answer ONE question: *"how
 * much does this option move this factor?"*. They are not two authorities
 * answering different questions (trap 21) — they are one policy written down
 * twice, i.e. a hand-maintained mirror (trap 12), and it drifted.
 *
 * On 2026-08-30 the draft prompt deleted v9's withholding rule, because that
 * rule's justification was FALSE: `projector.ts` `bindDirectStatedMagnitude`
 * stamps an option→factor magnitude `brief_extraction` (it equals a stated
 * figure that verifies against the brief bytes) or `cee_hypothesis` (ours), so
 * an estimate CAN be told apart from a figure the user gave. v9 was costing the
 * product `MISSING_OPTION_VALUE` in 20 of 23 measured fresh journeys —
 * `instruction.ts:99-113` records it as *"THE MODEL WAS NOT FAILING TO COMPLY;
 * IT WAS COMPLYING."*
 *
 * The completion prompt kept the deleted rule. So the completion pass closed the
 * structural gap (`option_without_chain`, `NO_EFFECT_PATH`) and then withheld the
 * magnitude on exactly the edges it had just created.
 *
 * ── ⭐ WHY THIS SPEC IS DERIVED AND NOT A SECOND COPY ───────────────────────
 * Pinning the completion's wording as a literal here would create a THIRD copy
 * of the same policy, and the next drift would be silent again. The policy
 * paragraphs are therefore EXTRACTED FROM THE DRAFT INSTRUCTION at run time and
 * asserted present in the completion prompt. If either side is reworded, this
 * REDs — which is the property the estate keeps paying for the absence of
 * (CLAUDE.md: *"where you cannot derive, the mirror must FAIL LOUD on drift,
 * never assume-good"*).
 *
 * ⚠ A derived guard proves AGREEMENT, never CORRECTNESS (trap 12d). It cannot
 * notice that the shared policy is itself wrong. That question is settled on the
 * draft side by `instruction-pin.test.ts`, which pins the policy by content AND
 * by pre-registered hash; this spec's job is only that the completion has not
 * fallen behind it.
 */
import { describe, expect, it } from "vitest";
import { buildRecordsCompletionPrompt, enumerateCompletionAsk } from "../completion.js";
import { projectRecordsToGraph } from "../projector.js";
import { DRAFT_RECORDS_CONNECT_INSTRUCTION } from "../instruction.js";
import type { DraftRecordSet } from "../grammar.js";

/** Collapse every whitespace run, so each prompt keeps its own line wrapping. */
function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The magnitude policy, EXTRACTED from the draft instruction — never retyped.
 *
 * Returns the two POLICY paragraphs of `## HOW MUCH EACH OPTION MOVES WHAT IT
 * CHANGES` (the figure-or-estimate rule, and the narrow leave-it-out rule). The
 * two paragraphs BEFORE them state the obligation and its motivation in the
 * draft's own framing; the completion prompt states that obligation in its own
 * words, so they are deliberately not pinned across the seam.
 */
function draftMagnitudePolicyParagraphs(): readonly string[] {
  const marker = "## HOW MUCH EACH OPTION MOVES";
  const parts = DRAFT_RECORDS_CONNECT_INSTRUCTION.split(marker);
  // PRECONDITION (trap 13b): the section must exist exactly once, or every
  // assertion below is being made about an empty string.
  expect(parts).toHaveLength(2);
  const paragraphs = parts[1]
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  // PRECONDITION: the section's shape is what the extraction assumes. A
  // reshuffle must RED here rather than silently yield the wrong paragraphs.
  expect(paragraphs.length).toBeGreaterThanOrEqual(4);
  const policy = paragraphs.slice(-2);
  expect(policy[0]).toMatch(/^Where the brief gives you the figure/);
  expect(policy[1]).toMatch(/^Leave `sets_to` out only/);
  return policy;
}

/**
 * A record set with an option→factor link and a factor→goal link. `stated_items[1]`
 * is the goal, deliberately NOT index 0, so a test that passes by hardcoding
 * "the goal is 0" fails.
 */
function recordsWithFactorGoalChain(): DraftRecordSet {
  return {
    stated_items: [
      { kind: "option", source_quote: "enter Germany directly" },
      { kind: "goal", source_quote: "reach £10m ARR by 2027" },
      { kind: "option", source_quote: "partner with a local player" },
    ],
    claims: [
      { claim_kind: "factor", label: "new-logo pipeline" },
      { claim_kind: "causal_link", label: "direct entry builds pipeline", from_stated: 0, to_claim: 0, effect: "positive", sets_to: 1 },
      { claim_kind: "causal_link", label: "partnering builds pipeline", from_stated: 2, to_claim: 0, effect: "positive", sets_to: 0.4 },
      { claim_kind: "causal_link", label: "pipeline drives ARR", from_claim: 0, to_stated: 1, effect: "positive" },
    ],
  };
}

function completionPrompt(): string {
  const records = recordsWithFactorGoalChain();
  return buildRecordsCompletionPrompt({
    brief: "We want to reach £10m ARR by 2027. We could enter Germany directly or partner with a local player.",
    records,
    ask: enumerateCompletionAsk(records, projectRecordsToGraph(records)),
  });
}

describe("the completion prompt carries the draft's magnitude policy, not v9's", () => {
  it("states every policy paragraph the draft instruction states", () => {
    const prompt = normalise(completionPrompt());
    for (const paragraph of draftMagnitudePolicyParagraphs()) {
      expect(prompt).toContain(normalise(paragraph));
    }
  });

  it("no longer carries v9's withholding clause", () => {
    const prompt = normalise(completionPrompt());
    expect(prompt).not.toContain("but only where the brief gives you the basis for it");
    // POSITIVE CONTROL for the negative (trap 13): the probe can still find a
    // string that IS present, so the `not.toContain` above is a discrimination
    // rather than an assertion against an empty or mis-built prompt.
    expect(prompt).toContain("set `sets_to` to the level that factor takes under that option");
  });

  it("still tells the model to route a stated figure through `basis`", () => {
    // The estimate is not bought by loosening the USER's half. `basis` is in the
    // completion grammar: `buildRecordsCompletionSchema` reuses
    // `buildDraftClaimItemSchema`, which carries it (`grammar.ts:516`), and the
    // completion turn is shown `stated_items` so the indices resolve.
    expect(normalise(completionPrompt())).toContain("set `basis` to the stated_items it came from");
  });
});
