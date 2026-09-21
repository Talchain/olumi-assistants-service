/**
 * ⭐⭐ THE TWO PROMPTS THAT GOVERN `sets_to` MUST NOT CONTRADICT EACH OTHER.
 *
 * ── THE DEFECT THIS PINS ───────────────────────────────────────────────────
 * `sets_to` on an option→factor `causal_link` is asked for by TWO prompts, in
 * TWO provider calls, that between them author ONE graph:
 *
 *   pass 1  `DRAFT_RECORDS_INSTRUCTION` (`instruction.ts`) — a system block on
 *           the draft call (`adapters/llm/anthropic.ts:518`).
 *   pass 2  `buildRecordsCompletionPrompt` (`completion.ts`) — the ENTIRE user
 *           content of the completion call, which sends NO system blocks
 *           (`anthropic.ts:2050-2060`), and whose new claims are merged into
 *           pass 1's record set and re-projected.
 *
 * So an option whose only chain is minted in pass 2 has its magnitude governed
 * by pass 2's rule, and an option chained in pass 1 by pass 1's. Until this
 * spec existed the two rules were OPPOSITE, and `completion.ts` carried the
 * v9 clause *"only where the brief gives you the basis for it"* — the SAME
 * STRING `instruction.ts` withdrew at v10 as false and product-blocking (see
 * `instruction-pin.test.ts:286`, which records v9 verbatim).
 *
 * ⚠ WHY "pass 2 knows less, so it may estimate less" IS NOT AVAILABLE AS A
 * RECONCILIATION: pass 2 receives the FULL BRIEF (`anthropic.ts:2045` passes
 * `prompt.userContent`, rendered under `### The brief`) plus pass 1's records
 * and the projector's verdict. It has strictly MORE context, never less.
 *
 * ── WHAT THIS SPEC CAN AND CANNOT DO ───────────────────────────────────────
 * A prompt is prose; no unit test can assert the model's behaviour. What IS
 * assertable is that the two prompts do not simultaneously REQUIRE and FORBID
 * an estimated magnitude for the same field. That is what this pins.
 *
 * ⭐ BOTH STRINGS ARE DERIVED FROM THEIR MODULES, never copied here. The
 * instruction half is sliced from `DRAFT_RECORDS_CONNECT_INSTRUCTION` at its
 * own section heading (itself pinned by `instruction-pin.test.ts`), and the
 * completion half is taken from a prompt built by the REAL builder against a
 * REAL ask. Copying either would make this spec a mirror that agrees with a
 * snapshot instead of with the serving code (CLAUDE.md trap 12).
 *
 * ⭐⭐ THE CLASSIFIER FAILS LOUD RATHER THAN GUESSING. Its marker lists are
 * hand-written and therefore CANNOT be complete (trap 12d: a derived guard
 * proves agreement, never completeness). The property that makes a short list
 * safe here is that an unrecognised passage returns `unclear`, and `unclear`
 * REDs — so a rewording that escapes every marker breaks this spec loudly
 * instead of passing vacuously. A passage carrying BOTH sides also returns
 * `unclear`, because that is the contradiction itself.
 *
 * ⭐ AND THE DISCRIMINATION IS PROVEN, NOT ASSERTED (trap 13). The controls
 * below are pinned to HISTORICAL artefacts — v9's withdrawn rule and v10's
 * replacement — never to whatever the tree currently says, so they cannot decay
 * into tautologies the first time the live text moves (trap 12b).
 */
import { describe, expect, it } from "vitest";
import { buildRecordsCompletionPrompt, enumerateCompletionAsk } from "../completion.js";
import { DRAFT_RECORDS_CONNECT_INSTRUCTION } from "../instruction.js";
import { projectRecordsToGraph } from "../projector.js";
import type { DraftRecordSet } from "../grammar.js";

type SetsToPolicy = "estimate_permitted" | "brief_only" | "unclear";

/** Sanctions supplying a magnitude the brief does not state. */
const PERMISSION_MARKERS: readonly RegExp[] = [
  /give your best estimate/i,
  /only where you genuinely cannot form a defensible estimate/i,
];

/** Confines the magnitude to what the brief already provides. */
const RESTRICTION_MARKERS: readonly RegExp[] = [
  /only where the brief gives you the basis/i,
  /only levels the brief gives you the basis/i,
  /the brief does not support a number,? ?leave/i,
];

/**
 * Collapse every run of whitespace to one space. Both sources hard-wrap their
 * prose at different widths, so a phrase spans a newline in one and not the
 * other; matching without this would be matching the wrapping, not the rule.
 */
function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function classifySetsToPolicy(text: string): SetsToPolicy {
  const flat = normalise(text);
  const permits = PERMISSION_MARKERS.some((r) => r.test(flat));
  const restricts = RESTRICTION_MARKERS.some((r) => r.test(flat));
  if (permits && !restricts) return "estimate_permitted";
  if (restricts && !permits) return "brief_only";
  return "unclear";
}

/**
 * v9's withdrawn rule, quoted as a HISTORICAL RECORD from
 * `instruction-pin.test.ts:286`. It is append-only evidence of what the product
 * once instructed and must never be re-pointed at the live text (trap 14b).
 */
const HISTORIC_V9_RULE =
  "Set it only where the brief gives you the basis for it. Where the brief does " +
  "not support a number, leave `sets_to` out. An absent number is a truthful " +
  "answer; a guessed one is read as the user's own and cannot be told apart from " +
  "a figure they gave you.";

/** v10's replacement, also a historical record of the change that withdrew v9. */
const HISTORIC_V10_RULE =
  "Where the brief does not give you a figure, give your best estimate, reasoned " +
  "from what the brief does tell you.";

/** A record set whose options chain to the goal, so a prompt can be built. */
function records(): DraftRecordSet {
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
    ],
  };
}

/** The completion prompt's `sets_to` policy, taken from the REAL builder. */
function completionSetsToPassage(): string {
  const r = records();
  const prompt = buildRecordsCompletionPrompt({
    brief: "we want to reach £10m ARR by 2027",
    records: r,
    ask: enumerateCompletionAsk(r, projectRecordsToGraph(r)),
  });
  // PRECONDITION, pinned in-test: the builder produced a real prompt. An empty
  // or `sets_to`-free prompt would otherwise classify as `unclear` and read as
  // a rewording rather than as a broken fixture.
  expect(prompt.length).toBeGreaterThan(500);
  expect(prompt).toContain("sets_to");
  const blocks = prompt.split(/\n\s*\n/).filter((b) => b.includes("sets_to"));
  expect(blocks.length).toBeGreaterThan(0);
  return blocks.join("\n\n");
}

/** The instruction's `sets_to` policy, sliced at its own pinned heading. */
function instructionSetsToPassage(): string {
  const heading = "## HOW MUCH EACH OPTION MOVES";
  const at = DRAFT_RECORDS_CONNECT_INSTRUCTION.indexOf(heading);
  // PRECONDITION: the heading this slice is anchored on still exists. It is
  // pinned independently by `instruction-pin.test.ts`, so a rename REDs there
  // too rather than silently emptying this slice.
  expect(at).toBeGreaterThanOrEqual(0);
  const section = DRAFT_RECORDS_CONNECT_INSTRUCTION.slice(at);
  expect(section.length).toBeGreaterThan(300);
  return section;
}

describe("the classifier discriminates — proven against historical artefacts, not asserted", () => {
  it("reads v9's withdrawn rule as brief-only", () => {
    expect(classifySetsToPolicy(HISTORIC_V9_RULE)).toBe("brief_only");
  });

  it("reads v10's replacement as permitting an estimate", () => {
    expect(classifySetsToPolicy(HISTORIC_V10_RULE)).toBe("estimate_permitted");
  });

  it("returns `unclear` for a passage carrying neither side", () => {
    expect(classifySetsToPolicy("Set `effect` to `positive` or `negative` on every link.")).toBe(
      "unclear",
    );
  });

  it("returns `unclear` — never a winner — for a passage carrying BOTH sides", () => {
    // The contradiction itself must not resolve to one of the two answers, or
    // a prompt that says both things would pass by whichever marker ran first.
    expect(classifySetsToPolicy(`${HISTORIC_V9_RULE} ${HISTORIC_V10_RULE}`)).toBe("unclear");
  });

  it("matches across a hard-wrapped line break, so it pins the rule and not the wrapping", () => {
    const wrapped = HISTORIC_V10_RULE.replace("give your best", "give your\nbest");
    expect(wrapped).toContain("\n");
    expect(classifySetsToPolicy(wrapped)).toBe("estimate_permitted");
  });
});

describe("the draft instruction and the completion prompt agree about `sets_to`", () => {
  it("states a determinable policy in each — an unrecognised rewording REDs here", () => {
    expect(classifySetsToPolicy(instructionSetsToPassage())).not.toBe("unclear");
    expect(classifySetsToPolicy(completionSetsToPassage())).not.toBe("unclear");
  });

  it("does not require an estimate in one call and forbid it in the other", () => {
    expect(classifySetsToPolicy(completionSetsToPassage())).toBe(
      classifySetsToPolicy(instructionSetsToPassage()),
    );
  });

  it("settles that shared policy as `estimate_permitted`, not as a shared refusal", () => {
    // ⚠ EQUALITY ALONE IS NOT ENOUGH, and this is the load-bearing assertion.
    // Both halves reverting to v9's withholding rule would satisfy the equality
    // above while re-blocking the product — a guard agreeing with itself
    // (trap 13b). The DIRECTION is pinned, not just the agreement.
    expect(classifySetsToPolicy(instructionSetsToPassage())).toBe("estimate_permitted");
    expect(classifySetsToPolicy(completionSetsToPassage())).toBe("estimate_permitted");
  });
});
