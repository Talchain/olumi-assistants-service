/**
 * ⭐⭐⭐ A CONSTRAINT MAY NOT SILENTLY BECOME THE OPTIMISATION OBJECTIVE.
 *
 * ── THE DEFECT, REPRODUCED ON DEPLOYED STAGING ─────────────────────────────
 * `enforceSingleGoal` chose the primary goal as `goalIds[0]` — ARRAY POSITION,
 * with nothing about the content of the objectives participating. Every causal
 * chain terminates at the primary, so that pick decides what the entire model
 * is built to justify.
 *
 * MEASURED, guest `POST https://cee-staging.onrender.com/proxy/v5/turn`,
 * 2026-08-29, service build `f18d941`, draft records instruction v9
 * (`7629e9ec738786eb…`), 12 fresh single-turn draws of the brief below:
 *
 *   2 of 12  goal = "Spend Less"                    ← the BUDGET CEILING
 *            outcome = "Increase Productivity, While Maintaining Code Quality"
 *  10 of 12  goal = "Increase Productivity, While Maintaining Code Quality"
 *
 * Captures `out-E-1` and `out-E-10`. Both carried
 * `goal_constraints[0].source_quote = "Our budget is £200,000, but we'd like to
 * spend less."` beside a goal node whose own `source_quote` was
 * `"we'd like to spend less"` — the same span, claimed by two extractors.
 *
 * ── WHY THE QUOTES BELOW ARE EVIDENCE AND NOT A FIXTURE ────────────────────
 * The two `source_quote` strings are copied VERBATIM from those two live wire
 * captures, and the brief is the user's own text. Nothing here is a sentence
 * this lane invented. The surrounding record scaffolding is fed to the REAL
 * projector rather than hand-built, so the node shape is the producer's; and
 * the constraint spans are produced by the REAL `extractCompoundGoals` over the
 * REAL brief, never by a hand-written list — a hand-written list would make
 * this test agree with itself (trap 13b).
 *
 * ── THE OPPOSITE-DIRECTION TWIN IS MANDATORY HERE ──────────────────────────
 * The discriminator is `constraint span ⊇ goal quote`. The REVERSE test would
 * be catastrophic and the repo's own corpus proves it: on
 * `02-multi-option-constrained` the extractor emits a constraint whose source
 * quote is `"within 18 months"`, which is a SUBSTRING of the correct goal
 * `"achieve 15% revenue growth within 18 months"`. Every case below therefore
 * has its twin, and the twin is a live draw too (captures `out-B-1..3`).
 */
import { describe, expect, it } from "vitest";

import { projectRecordsToGraph } from "../../draft/records/projector.js";
import type { DraftRecordSet } from "../../draft/records/grammar.js";
import { enforceSingleGoal, selectPrimaryGoalIndex } from "../index.js";
import { constraintSourceQuotesForBrief } from "../../unified-pipeline/stages/repair/goal-merge.js";

const canonical = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim();

interface AnyNode {
  id: string;
  kind: string;
  label?: string;
  provenance?: { source_quote?: string };
}

/** Bind by IDENTITY: the node carrying THIS objective's verbatim quote. */
const nodeForQuote = (nodes: readonly AnyNode[], quote: string): AnyNode | undefined =>
  nodes.find((n) => canonical(n.provenance?.source_quote) === canonical(quote));

// ---------------------------------------------------------------------------
// THE LIVE CAPTURES. Verbatim from the wire; see the header for provenance.
// ---------------------------------------------------------------------------

/** The user's own brief, complete and unedited. */
const BRIEF =
  "Should I hire a Tech lead or two developers to increase productivity, " +
  "while maintaining code quality? We have an urgent launch date in the next " +
  "three months. We currently have six mid-weight developers, so we're lacking " +
  "leadership. Our budget is £200,000, but we'd like to spend less.";

/** `out-E-1` / `out-E-10`: the span the product promoted to the objective. */
const BUDGET_PREFERENCE = "we'd like to spend less";
/** `out-E-1` / `out-E-10`: the span it demoted to an outcome. */
const REAL_OBJECTIVE = "increase productivity, while maintaining code quality";

/**
 * The two stated goals in the ORDER the failing draws emitted them — which is
 * the whole point: under the old rule that order alone decided the objective.
 */
function twoStatedGoalsBudgetFirst(): DraftRecordSet {
  return {
    stated_items: [
      { kind: "goal", source_quote: BUDGET_PREFERENCE },
      { kind: "goal", source_quote: REAL_OBJECTIVE },
      { kind: "option", source_quote: "hire a Tech lead" },
      { kind: "option", source_quote: "two developers" },
    ],
    claims: [
      { claim_kind: "factor", label: "Hiring cost", basis: [2] },
      { claim_kind: "outcome", label: "Team productivity", basis: [2] },
      {
        claim_kind: "causal_link",
        label: "hiring moves cost",
        from_stated: 2,
        to_claim: 0,
        effect: "negative",
      },
      {
        claim_kind: "causal_link",
        label: "cost drives productivity",
        from_claim: 0,
        to_claim: 1,
        effect: "positive",
      },
      {
        claim_kind: "causal_link",
        label: "productivity reaches the goal",
        from_claim: 1,
        to_stated: 0,
        effect: "positive",
      },
    ],
  } as unknown as DraftRecordSet;
}

/** records → projector → enforceSingleGoal, the real chain. */
function merged(records: DraftRecordSet, brief: string, spans: readonly string[]) {
  const projected = projectRecordsToGraph(records, brief).graph;
  const result = enforceSingleGoal(
    { nodes: projected.nodes, edges: projected.edges } as never,
    spans,
  );
  return (result!.graph as unknown as { nodes: AnyNode[] }).nodes;
}

// ---------------------------------------------------------------------------
// THE INSTRUMENT, PROVEN BEFORE IT IS USED (trap 13).
// If the projector stopped minting one goal node per stated goal, or if the
// extractor stopped reading the budget sentence, every assertion below would
// pass by testing nothing.
// ---------------------------------------------------------------------------
describe("the instrument", () => {
  it("the projector really does mint TWO goal nodes for the two stated objectives", () => {
    const projected = projectRecordsToGraph(twoStatedGoalsBudgetFirst(), BRIEF).graph;
    const goals = (projected.nodes as unknown as AnyNode[]).filter((n) => n.kind === "goal");
    expect(goals).toHaveLength(2);
    expect(goals.map((g) => canonical(g.provenance?.source_quote))).toEqual([
      canonical(BUDGET_PREFERENCE),
      canonical(REAL_OBJECTIVE),
    ]);
  });

  it("the REAL extractor reads the budget sentence as a limit, and it contains the promoted span", () => {
    const spans = constraintSourceQuotesForBrief(BRIEF);
    // Positive control: the probe sees something, and a plausible amount of it.
    expect(spans.length).toBeGreaterThan(0);
    // …and it is the sentence the live captures carried, verbatim.
    expect(spans).toContain("Our budget is £200,000, but we'd like to spend less.");
    // The containment the discriminator turns on, asserted rather than assumed.
    expect(
      spans.some((s) => s.toLowerCase().includes(BUDGET_PREFERENCE.toLowerCase())),
    ).toBe(true);
    // Fabricated contrast control: the extractor can still say NO.
    expect(
      spans.some((s) => s.toLowerCase().includes("zzqq fabricated limit zzqq")),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("⭐ THE LEAD RED — a stated budget limit must not become the objective", () => {
  it("keeps the OBJECTIVE as the goal even when the limit was emitted first", () => {
    const nodes = merged(
      twoStatedGoalsBudgetFirst(),
      BRIEF,
      constraintSourceQuotesForBrief(BRIEF),
    );

    // Exactly one goal, and it is the objective — bound by ITS OWN quote.
    const goals = nodes.filter((n) => n.kind === "goal");
    expect(goals).toHaveLength(1);
    expect(canonical(goals[0].provenance?.source_quote)).toBe(canonical(REAL_OBJECTIVE));
  });

  it("does not DELETE the budget preference — it survives as an outcome, verbatim", () => {
    const nodes = merged(
      twoStatedGoalsBudgetFirst(),
      BRIEF,
      constraintSourceQuotesForBrief(BRIEF),
    );
    const budget = nodeForQuote(nodes, BUDGET_PREFERENCE);
    expect(budget, "the user's budget preference left the graph entirely").toBeDefined();
    expect(budget!.kind).toBe("outcome");
    // The user's exact words are still the provenance. Nothing is hidden.
    expect(budget!.provenance?.source_quote).toBe(BUDGET_PREFERENCE);
  });
});

// ---------------------------------------------------------------------------
// ⭐⭐ THE OPPOSITE-DIRECTION TWINS. Each one is the harm the fix could cause.
// ---------------------------------------------------------------------------
describe("⭐⭐ the twins — a goal the user genuinely stated is still taken as the goal", () => {
  it("a goal that CONTAINS a limit span is NOT disqualified (live capture out-B-1..3)", () => {
    // The repo's own corpus brief, verbatim. Its extractor emits `within 18
    // months`, a SUBSTRING of the correct goal. Under a reversed containment
    // test the real objective would be thrown away.
    const B =
      "We're a UK fintech startup deciding how to expand internationally. Our " +
      "options are entering Germany (large market, heavy regulation), Brazil " +
      "(high growth, currency risk), or Japan (stable, high barrier to entry). " +
      "We need to achieve 15% revenue growth within 18 months while keeping " +
      "total expansion costs below £2M. Our current team is 35 people with no " +
      "international experience. We also need to decide whether to hire locally " +
      "or relocate existing staff.";
    const goalQuote = "achieve 15% revenue growth within 18 months";
    const spans = constraintSourceQuotesForBrief(B);

    // The precondition this twin turns on, PINNED IN-TEST (trap 13b): a span
    // really is a substring of the goal. If the extractor stops emitting it the
    // twin becomes vacuous, and this assertion is what says so.
    expect(
      spans.some((s) => goalQuote.toLowerCase().includes(s.trim().toLowerCase())),
      "no limit span is a substring of the goal — this twin now proves nothing",
    ).toBe(true);

    const goalNodes = [
      { provenance: { source_quote: goalQuote } },
      { provenance: { source_quote: "keeping total expansion costs below £2M" } },
    ];
    expect(selectPrimaryGoalIndex(goalNodes, spans)).toBe(0);
  });

  it("a SINGLE stated objective is taken silently, whatever the brief's limits say", () => {
    // The coordinator's twin: never trade a wrong pick for a prompt or a
    // reshuffle on an unambiguous brief. The single-goal path returns before
    // any of this, so the assertion is that supplying spans changes nothing.
    const single = {
      stated_items: [
        { kind: "goal", source_quote: BUDGET_PREFERENCE },
        { kind: "option", source_quote: "hire a Tech lead" },
        { kind: "option", source_quote: "two developers" },
      ],
      claims: [],
    } as unknown as DraftRecordSet;

    const withSpans = merged(single, BRIEF, constraintSourceQuotesForBrief(BRIEF));
    const withoutSpans = merged(single, BRIEF, []);
    const goal = withSpans.filter((n) => n.kind === "goal");
    expect(goal).toHaveLength(1);
    expect(canonical(goal[0].provenance?.source_quote)).toBe(canonical(BUDGET_PREFERENCE));
    expect(JSON.stringify(withSpans)).toBe(JSON.stringify(withoutSpans));
  });

  it("with NO limit spans the selection is byte-identical to the old rule", () => {
    const nodes = merged(twoStatedGoalsBudgetFirst(), BRIEF, []);
    const goals = nodes.filter((n) => n.kind === "goal");
    expect(goals).toHaveLength(1);
    // Index 0 — exactly the pre-existing behaviour, so a caller that supplies
    // nothing cannot be changed by this fix.
    expect(canonical(goals[0].provenance?.source_quote)).toBe(canonical(BUDGET_PREFERENCE));
  });

  it("never leaves the graph goal-less when EVERY candidate is a stated limit", () => {
    // Fail toward preservation: a goal-less graph is unusable, so index 0
    // stands. This is the direction the duplicate guard already fails in.
    const bothLimits = [
      { provenance: { source_quote: "we'd like to spend less" } },
      { provenance: { source_quote: "spend less" } },
    ];
    expect(
      selectPrimaryGoalIndex(bothLimits, [
        "Our budget is £200,000, but we'd like to spend less.",
      ]),
    ).toBe(0);
  });

  it("a quote-less goal is never disqualified", () => {
    const noQuote = [{ provenance: {} }, { provenance: { source_quote: REAL_OBJECTIVE } }];
    expect(selectPrimaryGoalIndex(noQuote, constraintSourceQuotesForBrief(BRIEF))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⭐ THE KNOWN-DROPPED SET (trap 22f). Pinned BY NAME so it cannot grow or
// shrink in silence, and so nobody reads this fix as covering more than it does.
// ---------------------------------------------------------------------------
describe("what this fix does NOT close, asserted so it stays visible", () => {
  it("several objectives with NO extracted limit are still decided by array position", () => {
    // The founder's brief. MEASURED live 3/3 (captures out-D-1..3): it states
    // three objectives and mints NO constraint, because "spend less" carries no
    // number. Nothing here can fire, and index 0 still decides — which is the
    // residue that needs the product to ASK rather than to pick.
    const FOUNDER =
      "We'd like to spend less. We also want to increase productivity, " +
      "while maintaining code quality. We could refactor the monolith, or buy a platform.";
    expect(constraintSourceQuotesForBrief(FOUNDER)).toEqual([]);

    const goalNodes = [
      { provenance: { source_quote: "we'd like to spend less" } },
      { provenance: { source_quote: "increase productivity" } },
    ];
    // Documented, not fixed. If this ever stops being 0, the residue moved and
    // this test must be re-derived rather than updated.
    expect(selectPrimaryGoalIndex(goalNodes, constraintSourceQuotesForBrief(FOUNDER))).toBe(0);
  });
});
