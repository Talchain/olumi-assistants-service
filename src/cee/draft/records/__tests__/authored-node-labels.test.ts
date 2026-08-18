/**
 * ⭐⭐ THE NODE LABEL IS AN AUTHORED OBJECTIVE, NOT THE USER'S RAW BRIEF FRAGMENT
 * — and the decision node is not the word "Decision".
 *
 * ── THE WITNESSED DEFECT ───────────────────────────────────────────────────
 * The founder photographed a goal node reading
 *   `Compound Goal: we'd like to spend less + increase productivity, while
 *    maintaining code quality`
 * and, beside it, a decision node reading `Decision`.
 *
 * ── THE RULING IMPLEMENTED (quality bar §8 A1/A2, answered 18 Aug) ─────────
 * A1 — the displayed label is an AUTHORED, concise, faithful objective. The
 *      exact user language is retained as PROVENANCE (inspector/hover), NOT as
 *      a permanent second line under every node. `provenance_class` stays
 *      `stated` (it means *the user stated this*, not *this text is the
 *      user's*) and an explicit `label_authored` is added. No new provenance
 *      class is minted — three live readers key on `stated`.
 * A2 — conservation is asserted across `label ∪ source_quote ∪ goal_threshold
 *      ∪ goal_constraints[]`, NOT within the label alone. That is what frees
 *      the label to be readable.
 * A3 — STILL OPEN, and nothing here answers it: no label is ever produced by
 *      string-joining two objectives.
 *
 * ── WHY THE CORPUS, NOT FIXTURES ───────────────────────────────────────────
 * Every assertion about a label's TEXT is a predicate over natural language, so
 * a corpus written from the author's head cannot see the class the author did
 * not imagine (trap 22). The inputs below are the frozen governed baseline —
 * 14 real staging captures at `b9389df` against served prompt v195 — and its 14
 * source briefs, both already in-tree. Nothing here invents a brief.
 *
 * ⚠ THE CORPUS IS A HISTORIC RECORD (trap 14b): it is read, never rewritten.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { projectRecordsToGraph } from "../projector.js";
import type { DraftRecordSet } from "../grammar.js";
import {
  deriveGoalObjectiveLabel,
  deriveDecisionLabel,
  labelIsDerivedFrom,
} from "../objective-label.js";
import { enforceSingleGoal } from "../../../structure/index.js";
import { projectGraphAndOptionsToV3 } from "../../../transforms/schema-v3.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../../..");
const GOVERNED = path.join(
  REPO_ROOT,
  "tools/graph-evaluator/governed/draft-graph-v5/baseline/run-b9389df-claude-sonnet-4-6.json",
);
const BRIEF_DIR = path.join(REPO_ROOT, "tools/graph-evaluator/briefs");

interface CorpusNode {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly provenance?: { readonly source_quote?: string };
}
interface CorpusCase {
  readonly brief_id: string;
  readonly graph?: { readonly nodes?: readonly CorpusNode[] };
}

function corpusCases(): readonly CorpusCase[] {
  const run = JSON.parse(fs.readFileSync(GOVERNED, "utf8")) as {
    run: { cases: readonly CorpusCase[] };
  };
  return run.run.cases;
}

/** The brief body, with the harness front-matter removed. */
function briefText(briefId: string): string {
  const raw = fs.readFileSync(path.join(BRIEF_DIR, `${briefId}.md`), "utf8");
  return raw.replace(/^---[\s\S]*?---\s*/, "").trim();
}

const canonical = (s: string): string => s.replace(/\s+/g, " ").trim();

// ── The corpus is the instrument. Prove it can see something before using it.
describe("the governed corpus is readable and is the instrument these tests use", () => {
  it("carries 14 cases, 13 goal nodes and 14 decision nodes", () => {
    const cases = corpusCases();
    expect(cases).toHaveLength(14);
    const nodes = cases.flatMap((c) => c.graph?.nodes ?? []);
    expect(nodes.filter((n) => n.kind === "goal")).toHaveLength(13);
    expect(nodes.filter((n) => n.kind === "decision")).toHaveLength(14);
  });
});

describe("the goal label is an authored objective, not the user's verbatim fragment", () => {
  /**
   * ⭐ THE LEAD RED — the founder's own witnessed string, driven through the
   * WHOLE path: records → projector → `enforceSingleGoal`. Two objectives
   * stated in one casual sentence is exactly the shape that produced
   * `Compound Goal: A + B`.
   */
  it("the founder's witnessed compound goal produces neither the repair prefix nor a raw fragment", () => {
    const brief =
      "We'd like to spend less. We also want to increase productivity, " +
      "while maintaining code quality. We could refactor the monolith, or buy a platform.";
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "we'd like to spend less" },
        { kind: "goal", source_quote: "increase productivity, while maintaining code quality" },
        { kind: "option", source_quote: "refactor the monolith" },
        { kind: "option", source_quote: "buy a platform" },
      ],
      claims: [
        { claim_kind: "factor", label: "Engineering Spend", basis: [2] },
        { claim_kind: "outcome", label: "Delivery Throughput", basis: [2] },
        {
          claim_kind: "causal_link",
          label: "refactoring moves engineering spend",
          from_stated: 2,
          to_claim: 0,
          effect: "negative",
        },
        {
          claim_kind: "causal_link",
          label: "buying moves engineering spend",
          from_stated: 3,
          to_claim: 0,
          effect: "negative",
        },
        {
          claim_kind: "causal_link",
          label: "spend drives throughput",
          from_claim: 0,
          to_claim: 1,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "throughput reaches the goal",
          from_claim: 1,
          to_stated: 0,
          effect: "positive",
        },
      ],
    };

    const projected = projectRecordsToGraph(records, brief).graph;
    const goals = projected.nodes.filter((n) => n.kind === "goal");
    expect(goals.length).toBeGreaterThan(0);

    for (const goal of goals) {
      expect(goal.label).not.toContain("Compound Goal");
      expect(goal.label).not.toContain(" + ");
      // Bound by IDENTITY: this node's own quote, never another node's.
      const quote = canonical(goal.provenance?.source_quote ?? "");
      expect(canonical(goal.label)).not.toBe(quote);
      expect(goal.provenance?.label_authored).toBe(true);
    }

    // …and it survives the merge stage that built the witnessed string.
    const merged = enforceSingleGoal({
      nodes: projected.nodes,
      edges: projected.edges,
    } as never);
    const mergedGoals = (merged?.graph as { nodes: CorpusNode[] }).nodes.filter(
      (n) => n.kind === "goal",
    );
    for (const goal of mergedGoals) {
      expect(goal.label).not.toContain("Compound Goal");
      expect(goal.label).not.toContain(" + ");
    }
  });

  it("no governed goal label that carries a stated objective is still its own verbatim quote", () => {
    const stillVerbatim: string[] = [];
    for (const c of corpusCases()) {
      for (const node of (c.graph?.nodes ?? []).filter((n) => n.kind === "goal")) {
        const quote = canonical(node.provenance?.source_quote ?? node.label);
        const derived = deriveGoalObjectiveLabel(quote);
        if (derived.authored) continue;
        stillVerbatim.push(`${c.brief_id}:${node.id}`);
      }
    }
    // The four refusals are the DELIBERATION-FRAMED quotes: those state a
    // decision, not an objective, and authoring one would invent the user's
    // goal. They are named, so the set can never grow or shrink in silence.
    expect(stillVerbatim.sort()).toEqual([
      "01-simple-binary:93c5502d",
      "03-vague-underspecified:ad742f47",
      "06-operations-warehouse:d3e19828",
      "08-channel-strategy:a2075cf8",
    ]);
  });

  it("authors 9 of the 13 governed goal labels", () => {
    const authored = corpusCases()
      .flatMap((c) => c.graph?.nodes ?? [])
      .filter((n) => n.kind === "goal")
      .filter((n) => deriveGoalObjectiveLabel(canonical(n.provenance?.source_quote ?? n.label)).authored);
    expect(authored).toHaveLength(9);
  });
});

describe("the decision node carries a real label derived from the decision being made", () => {
  it("the projector no longer mints the literal 'Decision' when the brief states the decision", () => {
    const brief = "Should we raise the price or keep it as is? Our churn is 3.5% monthly.";
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "Should we raise the price or keep it as is?" },
        { kind: "option", source_quote: "raise the price" },
        { kind: "option", source_quote: "keep it as is" },
      ],
      claims: [
        { claim_kind: "factor", label: "Subscription Price", basis: [1] },
        { claim_kind: "outcome", label: "Monthly Recurring Revenue", basis: [1] },
        {
          claim_kind: "causal_link",
          label: "raising moves price",
          from_stated: 1,
          to_claim: 0,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "keeping holds price",
          from_stated: 2,
          to_claim: 0,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "price drives MRR",
          from_claim: 0,
          to_claim: 1,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "MRR reaches the goal",
          from_claim: 1,
          to_stated: 0,
          effect: "positive",
        },
      ],
    };

    const projected = projectRecordsToGraph(records, brief).graph;
    const decisions = projected.nodes.filter((n) => n.kind === "decision");
    expect(decisions).toHaveLength(1);
    const decision = decisions[0];
    expect(decision.label).not.toBe("Decision");
    expect(decision.label).toBe("Raise the Price or Keep It as Is");
    expect(decision.provenance?.label_authored).toBe(true);
  });

  it("authors 9 of the 14 governed decision labels, and refuses the other 5 by name", () => {
    const refused: string[] = [];
    for (const c of corpusCases()) {
      const goalQuotes = (c.graph?.nodes ?? [])
        .filter((n) => n.kind === "goal")
        .map((n) => canonical(n.provenance?.source_quote ?? n.label));
      const derived = deriveDecisionLabel({ brief: briefText(c.brief_id), goalQuotes });
      if (!derived.authored) refused.push(c.brief_id);
    }
    // Honest refusals: no deliberation-framed statement short enough to be a
    // faithful label, or one whose only reduction would drop an alternative.
    // An honest generic beats a confident wrong one.
    expect(refused.sort()).toEqual([
      "04-conflicting-constraints",
      "06-operations-warehouse",
      "08-channel-strategy",
      "12-similar-options",
      // ⭐ THE ONE COST OF THE DELETION VETOES, RECORDED RATHER THAN TUNED AWAY.
      // 14's decision sentence trails ", which could cannibalise … BUT would
      // provide …". The `but` sits in the span the relative cut discards, and
      // the veto cannot tell a qualification of the DECISION from one of its
      // EFFECTS without semantics. It refuses. That is one label traded for
      // seven measured misrepresentations closed, in the safe direction —
      // refusing falls back to today's behaviour and can regress nothing. A
      // further rule to recover it would be the fifth round on one natural
      // -language predicate, which this estate has ratified as the point to
      // stop guessing (trap 22f).
      "14-qualitative-strategy",
    ]);
  });

  /**
   * ⭐⭐ THE DECISION NODE MUST NAME *THIS* DECISION. A review measured it
   * naming a different one: the goal-quote path accepted ANY deliberation
   * frame, and `considering ` is one, so a goal sentence about hiring became
   * the decision node's name while the real decision sat unread in the brief.
   */
  it("does not name a goal from an unrelated sentence when the brief states the decision", () => {
    const derived = deriveDecisionLabel({
      brief: "We are deciding whether to acquire Northgate or build in-house.",
      goalQuotes: ["We are considering hiring 15 more engineers"],
    });
    expect(derived.authored).toBe(true);
    expect(derived.label).toBe("Acquire Northgate or Build In-House");
    expect(derived.label.toLowerCase()).not.toContain("engineer");
  });

  /**
   * ⭐ A `between` FRAME'S VERB *IS* THE CHOICE. Stripping it produced
   * `Close Leeds and Closing Bristol` — an instruction to do both.
   */
  it("keeps the choosing verb on a `between` construction rather than collapsing it to a conjunction", () => {
    const derived = deriveDecisionLabel({
      brief: "We must choose between closing Leeds and closing Bristol.",
      goalQuotes: [],
    });
    expect(derived.authored).toBe(true);
    expect(derived.label).toBe("Choose Between Closing Leeds and Closing Bristol");
  });

  /**
   * ⭐ THE FOUNDER'S OWN BRIEF. Its decision is phrased "We could X, or Y" —
   * which matched no frame, so his screenshot's second half still read
   * `Decision` after round 1.
   */
  it("names the decision on the founder's own brief, which reads 'We could X, or Y'", () => {
    const derived = deriveDecisionLabel({
      brief:
        "We'd like to spend less. We also want to increase productivity, while maintaining code quality. " +
        "We could refactor the monolith, or buy a platform.",
      goalQuotes: ["we'd like to spend less", "increase productivity, while maintaining code quality"],
    });
    expect(derived.authored).toBe(true);
    expect(derived.label).toBe("Refactor the Monolith, or Buy a Platform");
  });

  /**
   * ⭐⭐ THE DECISION PATH IS WHERE THE CLAUSE CUTS STILL LIVE, AND THEREFORE
   * WHERE THEIR VETOES MUST BE EXERCISED.
   *
   * ⚠ A review found V1 and V3 had ZERO over-refusal coverage: forcing either
   * to always fire left the governed goal labels at 9/13 unchanged, because
   * **not one governed goal quote ever reaches a cut**. The corpus was silent
   * about them, not reassuring — a guard nothing exercises is a guard nobody
   * would notice losing (trap 13b). The goal path no longer cuts at all, so the
   * cuts and their vetoes are scoped to the decision node, and each is pinned
   * here with a DISCRIMINATING TWIN: same construction, qualification removed,
   * which must author. One alone proves nothing; the pair proves the veto is
   * reading the qualification and not merely the shape.
   */
  const DECISION_VETO_PAIRS: ReadonlyArray<readonly [string, string, string, string]> = [
    [
      "V1 · a discarded tail carrying a qualification",
      "We are deciding whether to launch a subscription, which would help but not for enterprise customers.",
      "We are deciding whether to launch a subscription, which would help enterprise customers.",
      "Launch a Subscription",
    ],
    [
      "V3 · a restrictive clause after a quantifier",
      "We are deciding whether to close every office that is below break-even.",
      "We are deciding whether to close the Leeds office that is below break-even.",
      "Close the Leeds Office",
    ],
    [
      "V1 · a discarded parenthetical carrying an exception",
      "We are deciding whether to move to Azure (but not the payments platform).",
      "We are deciding whether to move to Azure (a twelve month programme).",
      "Move to Azure",
    ],
  ];

  it.each(DECISION_VETO_PAIRS)(
    "%s — refuses, while its qualification-free twin authors",
    (_name, vetoed, twin, twinLabel) => {
      const refused = deriveDecisionLabel({ brief: vetoed, goalQuotes: [] });
      expect(refused.authored, `must refuse: ${vetoed}`).toBe(false);
      expect(refused.label).toBe("Decision");
      const authored = deriveDecisionLabel({ brief: twin, goalQuotes: [] });
      expect(authored.authored, `twin must author: ${twin}`).toBe(true);
      expect(authored.label).toBe(twinLabel);
    },
  );

  it("a refused decision keeps the honest generic and says so", () => {
    const derived = deriveDecisionLabel({ brief: "The board set two main options.", goalQuotes: [] });
    expect(derived.authored).toBe(false);
    expect(derived.label).toBe("Decision");
  });
});

// ── OPPOSITE-DIRECTION TWINS ────────────────────────────────────────────────
describe("twins: authoring must not invent, must not lose, and must not spread", () => {
  it("a brief that already states a crisp objective is not re-authored into different content", () => {
    const quote = "achieve 15% revenue growth within 18 months";
    const derived = deriveGoalObjectiveLabel(quote);
    expect(derived.authored).toBe(true);
    expect(derived.label).toBe("Achieve 15% Revenue Growth Within 18 Months");
    // The enforceable half: every token comes from the user's own words.
    expect(labelIsDerivedFrom(derived.label, quote)).toBe(true);
  });

  /**
   * ⭐ THE NO-INVENTION GUARD, PINNED IN BOTH DIRECTIONS. It is a fail-closed
   * belt on a transform that should never introduce a token, so an
   * always-true mutant is invisible from the outside — the negative case is
   * what makes it observable at all (trap 13b).
   */
  it("labelIsDerivedFrom accepts a re-cased/base-form derivation and REJECTS an introduced word", () => {
    expect(labelIsDerivedFrom("Cut Burn Rate by 30%", "cutting our burn rate by 30%")).toBe(true);
    expect(labelIsDerivedFrom("Reach £25M GMV Within 18 Months", "reach £25M GMV within 18 months")).toBe(true);
    expect(
      labelIsDerivedFrom(
        "Reduce Cost-per-Delivery Below £7 Within 12 Months",
        "reduce our cost-per-delivery below £7 within 12 months",
      ),
    ).toBe(true);
    // "Drastically" and "Costs" are nowhere in the source. A derivation that
    // produced them would be a paraphrase badged as the user's own statement.
    expect(labelIsDerivedFrom("Reduce Costs Drastically", "cut spending")).toBe(false);
    // ⚠ IT WAS A SUBSTRING TEST AND A REVIEW MEASURED THE HOLE: `or` sits
    // inside `for`, so an introduced coordinator passed as "derived".
    expect(labelIsDerivedFrom("Or", "for the quarter")).toBe(false);
    // A gerund resolves ONLY through the declared closed map — "shipping" is not
    // in it, so `Ship` is treated as introduced. Deliberately strict: the map is
    // the whole safety property, and a general `-ing` rule would coin verbs.
    expect(labelIsDerivedFrom("Ship Weekly", "shipping is our weekly ritual")).toBe(false);
    expect(
      labelIsDerivedFrom("Switch from Weekly to Flexible Scheduling", "switching from weekly to flexible scheduling"),
    ).toBe(true);
  });

  it("every token of every authored governed label is derived from that node's own quote", () => {
    for (const c of corpusCases()) {
      for (const node of (c.graph?.nodes ?? []).filter((n) => n.kind === "goal")) {
        const quote = canonical(node.provenance?.source_quote ?? node.label);
        const derived = deriveGoalObjectiveLabel(quote);
        if (!derived.authored) continue;
        expect(
          labelIsDerivedFrom(derived.label, quote),
          `${c.brief_id}:${node.id} → ${derived.label}`,
        ).toBe(true);
      }
    }
  });

  it("A2 conservation: no numeral in the quote is lost from label ∪ source_quote ∪ goal_threshold", () => {
    // ⚠ THE QUOTE IS A GERUND WITH A POSSESSIVE, DELIBERATELY. It read
    // "increase MRR …", whose label differs from it only by CAPITALISATION —
    // so both non-vacuity assertions below were satisfied by a case flip and
    // the twin never exercised a real transformation. This one exercises
    // gerund→base AND the possessive drop as well.
    const brief = "We must keep increasing our MRR from £215k to £250k within 6 months.";
    const records: DraftRecordSet = {
      stated_items: [
        {
          kind: "goal",
          source_quote: "increasing our MRR from £215k to £250k within 6 months",
          value: 250000,
          unit: "£",
          role: "target",
        },
        { kind: "option", source_quote: "hold all prices" },
      ],
      claims: [
        { claim_kind: "factor", label: "Enterprise Price Point", basis: [1] },
        { claim_kind: "outcome", label: "Monthly Recurring Revenue", basis: [1] },
        {
          claim_kind: "causal_link",
          label: "holding leaves price unchanged",
          from_stated: 1,
          to_claim: 0,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "price drives MRR",
          from_claim: 0,
          to_claim: 1,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "MRR reaches the goal",
          from_claim: 1,
          to_stated: 0,
          effect: "positive",
        },
      ],
    };
    const projected = projectRecordsToGraph(records, brief).graph;
    const goal = projected.nodes.find((n) => n.kind === "goal");
    expect(goal).toBeDefined();
    // ⚠ `source_quote` IS DELIBERATELY EXCLUDED FROM THE UNION, and including
    // it was the defect a review caught: the quote is the WHOLE input, so every
    // numeral is present in it unconditionally and the assertion passed for a
    // label of `""` or `"TOTALLY WRONG LABEL"`. A conservation twin that cannot
    // fail is a guard agreeing with itself (trap 13b). Asserted over the
    // DERIVED carriers only — the label and the threshold quad — which is the
    // question A2 actually asks of them.
    const union = [goal?.label ?? "", String(goal?.goal_threshold_raw ?? "")].join(" ");
    expect(union).not.toContain(goal?.provenance?.source_quote ?? "\u0000");
    for (const numeral of ["215", "250", "6"]) {
      expect(union, `numeral ${numeral} must survive the union`).toContain(numeral);
    }
    // Non-vacuity: the label really is a different string from the quote, so
    // the union above is not the quote wearing a hat.
    expect(canonical(goal?.label ?? "")).not.toBe(canonical(goal?.provenance?.source_quote ?? ""));
    // …and differs by MORE than case: the transformation really ran.
    expect((goal?.label ?? "").toLowerCase()).not.toBe(
      (goal?.provenance?.source_quote ?? "").toLowerCase(),
    );
    expect(goal?.label).toBe("Increase MRR from £215k to £250k Within 6 Months");
  });

  it("a node that is not the goal is untouched — option, factor and constraint labels stay verbatim", () => {
    const brief =
      "We must keep spend below £250,000. We could hold all prices, or raise Enterprise by 30%. Headcount is 35.";
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "increase MRR from £215k to £250k within 6 months" },
        { kind: "option", source_quote: "hold all prices" },
        { kind: "option", source_quote: "raise Enterprise by 30%" },
        {
          kind: "constraint",
          source_quote: "keep spend below £250,000",
          value: 250000,
          direction: "ceiling",
        },
        { kind: "figure", source_quote: "Headcount is 35", value: 35 },
      ],
      claims: [
        { claim_kind: "factor", label: "Enterprise Price Point", basis: [1] },
        { claim_kind: "outcome", label: "Monthly Recurring Revenue", basis: [1] },
        {
          claim_kind: "causal_link",
          label: "holding leaves price unchanged",
          from_stated: 1,
          to_claim: 0,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "raising lifts price",
          from_stated: 2,
          to_claim: 0,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "price drives MRR",
          from_claim: 0,
          to_claim: 1,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "MRR reaches the goal",
          from_claim: 1,
          to_stated: 0,
          effect: "positive",
        },
      ],
    };
    const projected = projectRecordsToGraph(records, brief).graph;
    for (const node of projected.nodes) {
      if (node.kind === "goal" || node.kind === "decision") continue;
      if (node.provenance?.provenance_class !== "stated") continue;
      // Bound by IDENTITY: this node's own quote.
      expect(canonical(node.label), `${node.kind} ${node.id} must keep the user's words`).toBe(
        canonical(node.provenance?.source_quote ?? ""),
      );
      expect(node.provenance?.label_authored).toBeUndefined();
    }
  });

  /**
   * ⭐⭐⭐ THE ADVERSARIAL CORPORA, AND THEY ARE THE LOAD-BEARING EVIDENCE.
   *
   * Written OUTSIDE the author's head by two rounds of adversarial review, in
   * ordinary British business prose (trap 22: the reviewer's corpus is the
   * evidence, the author's is a development aid).
   *
   * ── ROUND 2: the guard detected ADDITION, every harm was DELETION ─────────
   * 28 of 61 quotes produced a misrepresenting label, and not one could have
   * been caught by `labelIsDerivedFrom`, because every word on screen was
   * genuinely the user's (trap 13d).
   *
   * ── ROUND 3: token vetoes are the same 14 cases in structural clothing ────
   * Round 2 answered with three vetoes black-listing the tokens deletion tends
   * to carry. A FRESH 46-quote corpus, none of them pinned, showed 32 of 45
   * authored quotes still changing meaning — and the six MINIMAL PAIRS below
   * settled it: hold the meaning constant, vary only the veto token, and the
   * pinned harm refuses while its twin sails through. **Each veto matched a
   * token list, not a semantic class, so every class had a synonym.** The fix
   * was to invert the shape, not to add a fifth token: the goal path now
   * white-lists the transformations and refuses the moment any clause would be
   * discarded. `clause_discarded` below is that gate.
   */
  const MEASURED_HARMS: ReadonlyArray<readonly [string, string, string]> = [
    ["disclaimer shown as the goal", "This is not about cutting costs: we want to double our delivery speed", "clause_discarded"],
    ["disclaimer shown as the goal", "We are not trying to grow headcount — the aim is to raise output per engineer", "clause_discarded"],
    ["disclaimer shown as the goal", "Cost is not the problem; the problem is that we cannot ship weekly", "clause_discarded"],
    ["unmade alternative settled", "Build our own last-mile fleet — or partner with a third-party courier", "states_alternatives"],
    ["scope silently widened", "Cut cloud spend by 25% without any change that degrades latency", "clause_discarded"],
    ["exception dropped", "Raise prices — but only for new customers", "clause_discarded"],
    ["label contradicts its own quote", "Move the whole estate to Azure (but not the payments platform)", "clause_discarded"],
    ["deliberation the frame list missed", "Torn between rebuilding and buying", "deliberation_frame"],
    ["deliberation the frame list missed", "The question is whether to rebuild or buy", "deliberation_frame"],
    ["deliberation the frame list missed", "Whether to enter the German market", "deliberation_frame"],
    ["deliberation the frame list missed", "Do we rebuild the platform or buy one", "deliberation_frame"],
    ["negation inverted into an aim", "We must not exceed £250,000", "head_disclaims"],
    ["negation inverted into an aim", "We must never let latency exceed 200ms", "head_disclaims"],
    ["exception dropped", "Grow revenue, but not at the expense of margin", "head_disclaims"],
  ];

  it.each(MEASURED_HARMS)(
    "REFUSES (%s): %s",
    (_harm, quote, expectedReason) => {
      const derived = deriveGoalObjectiveLabel(quote);
      expect(derived.authored, `must not author: ${quote}`).toBe(false);
      expect(derived.reason).toBe(expectedReason);
      // Fail-closed means the verbatim survives — refusing is today's shipped
      // behaviour, so a veto can never make a label worse than it already is.
      expect(derived.label).toBe(quote);
    },
  );

  /**
   * ⭐⭐⭐ THE MINIMAL PAIRS — the result that killed the token vetoes.
   *
   * Meaning held constant, only the veto token varied. Under the blacklist the
   * left column refused and the right column authored, 6 for 6. Under the
   * whitelist BOTH refuse, because the property is now structural — a clause
   * was cut, or it was not — and there is no synonym for that.
   *
   * ⚠ This is the test that must never be allowed to pass by luck: it asserts
   * the TWIN, which is the half no blacklist could ever satisfy.
   */
  const MINIMAL_PAIR_TWINS: ReadonlyArray<readonly [string, string]> = [
    ["`or` → `and`", "Build our own last-mile fleet — and partner with a third-party courier"],
    ["`but only` → `alone`", "Raise prices — new customers alone"],
    ["`but not` → `excluded`", "Move the whole estate to Azure (payments platform excluded)"],
    ["`without` → `using`", "Cut cloud spend by 25% using the changes that preserve latency"],
    ["`or` → `;`", "Cut support costs; grow self-serve"],
    ["`not about` → `not cost`", "The priority is not cost: we want to double our delivery speed"],
  ];

  it.each(MINIMAL_PAIR_TWINS)(
    "REFUSES the synonym twin that walked through the token vetoes (%s): %s",
    (_swap, quote) => {
      const derived = deriveGoalObjectiveLabel(quote);
      expect(derived.authored, `the twin must refuse too: ${quote}`).toBe(false);
      expect(derived.label).toBe(quote);
    },
  );

  /**
   * ⭐ THE SEVEN CLASSES THE TOKEN VETOES NEVER GUARDED AT ALL. Each deletes
   * propositional content while every surviving word is the user's own.
   */
  const UNGUARDED_CLASSES: ReadonlyArray<readonly [string, string]> = [
    ["restrictive clause narrows a set", "Close the offices that are below break-even"],
    ["second objective, joined by `;`", "Cut support costs; grow self-serve revenue"],
    ["temporal clause makes it contingent", "Expand into Germany — once the Series B closes"],
    ["conditional clause", "Double delivery speed, provided the platform team is fully staffed"],
    ["quantifier plus restriction", "Migrate every service that stores personal data"],
    ["beneficiary / region", "Cut cloud spend by 25% (for the EU region)"],
    ["comparative baseline", "Grow revenue faster than we did last year: at least 15%"],
    ["purpose clause", "Rebuild the platform so that onboarding takes under a day"],
  ];

  it.each(UNGUARDED_CLASSES)("REFUSES an unguarded class (%s): %s", (_kind, quote) => {
    expect(deriveGoalObjectiveLabel(quote).authored, `must not author: ${quote}`).toBe(false);
  });

  /**
   * ⚠⚠ THE OPPOSITE DIRECTION, AND IT IS WHAT STOPS THE WHITELIST BEING A
   * LICENCE TO REFUSE EVERYTHING. Nothing is discarded in any of these, so each
   * must still author — including the two that KEEP a hedge in the label, which
   * is the discrimination the round-2 blacklist could not make.
   */
  const MUST_STILL_AUTHOR: ReadonlyArray<readonly [string, string]> = [
    ["achieve 15% revenue growth within 18 months", "Achieve 15% Revenue Growth Within 18 Months"],
    ["cutting our burn rate by 30%", "Cut Burn Rate by 30%"],
    ["we'd like to spend less", "Spend Less"],
    ["Improve retention unless it costs more than £50k", "Improve Retention Unless It Costs More Than £50k"],
    ["Ship weekly, except for the payments service", "Ship Weekly, Except for the Payments Service"],
    ["Cut support costs and grow self-serve revenue", "Cut Support Costs and Grow Self-Serve Revenue"],
  ];

  it.each(MUST_STILL_AUTHOR)("still AUTHORS when no clause is discarded: %s", (quote, expected) => {
    const derived = deriveGoalObjectiveLabel(quote);
    expect(derived.authored, `must still author: ${quote}`).toBe(true);
    expect(derived.label).toBe(expected);
  });

  it("a deliberation-framed goal is REFUSED, not authored into an invented objective", () => {
    const derived = deriveGoalObjectiveLabel(
      "evaluating whether to invest £800k in robotic picking systems or to hire 15 additional quality control staff",
    );
    expect(derived.authored).toBe(false);
    expect(derived.reason).toBe("deliberation_frame");
  });

  it("`label_authored` is DERIVED, never asserted: it holds iff the label differs from the quote", () => {
    for (const c of corpusCases()) {
      for (const node of (c.graph?.nodes ?? []).filter((n) => n.kind === "goal")) {
        const quote = canonical(node.provenance?.source_quote ?? node.label);
        const derived = deriveGoalObjectiveLabel(quote);
        expect(derived.authored, `${c.brief_id}:${node.id}`).toBe(canonical(derived.label) !== quote);
      }
    }
  });

  it("authoring is idempotent — an already-authored label is returned unchanged", () => {
    const once = deriveGoalObjectiveLabel("reduce our cost-per-delivery below £7 within 12 months");
    expect(once.authored).toBe(true);
    const twice = deriveGoalObjectiveLabel(once.label);
    expect(twice.label).toBe(once.label);
  });
});

// ── THE PROVENANCE MUST REMAIN RETRIEVABLE, OR THE FIX IS WORSE THAN THE DEFECT
describe("the user's exact words survive and are reachable", () => {
  it("the projected goal node still carries the verbatim source_quote", () => {
    const brief = "We must reach £25M GMV within 18 months. We could invest, or curate manually.";
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "reach £25M GMV within 18 months" },
        { kind: "option", source_quote: "invest" },
        { kind: "option", source_quote: "curate manually" },
      ],
      claims: [
        { claim_kind: "factor", label: "Match Quality", basis: [1] },
        { claim_kind: "outcome", label: "Gross Merchandise Value", basis: [1] },
        {
          claim_kind: "causal_link",
          label: "investing lifts match quality",
          from_stated: 1,
          to_claim: 0,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "curating lifts match quality",
          from_stated: 2,
          to_claim: 0,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "match quality lifts GMV",
          from_claim: 0,
          to_claim: 1,
          effect: "positive",
        },
        {
          claim_kind: "causal_link",
          label: "GMV reaches the goal",
          from_claim: 1,
          to_stated: 0,
          effect: "positive",
        },
      ],
    };
    const projected = projectRecordsToGraph(records, brief).graph;
    const goal = projected.nodes.find((n) => n.kind === "goal");
    expect(goal?.provenance?.source_quote).toBe("reach £25M GMV within 18 months");
    expect(goal?.label).toBe("Reach £25M GMV Within 18 Months");
  });

  it("the verbatim reaches the V3 WIRE node — the surface the inspector reads", () => {
    const v1 = {
      version: "1",
      nodes: [
        {
          id: "goal_1",
          kind: "goal",
          label: "Reach £25M GMV Within 18 Months",
          provenance: {
            provenance_class: "stated",
            source_quote: "reach £25M GMV within 18 months",
            brief_binding: "verified",
            label_authored: true,
          },
        },
        { id: "opt_1", kind: "option", label: "invest", data: { interventions: {} } },
      ],
      edges: [],
    };
    const projection = projectGraphAndOptionsToV3(v1 as never, {
      brief: "We must reach £25M GMV within 18 months.",
    });
    const wireGoal = projection.graph.nodes.find((n) => n.kind === "goal");
    expect(wireGoal?.source_quote).toBe("reach £25M GMV within 18 months");
    expect(wireGoal?.label_authored).toBe(true);
  });
});
