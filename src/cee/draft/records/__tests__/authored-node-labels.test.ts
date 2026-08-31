/**
 * ⭐⭐ THE NODE LABEL IS AN AUTHORED OBJECTIVE, NOT THE USER'S RAW BRIEF FRAGMENT
 * — and the decision node is not labelled with the generic word for its kind.
 *
 * ⚠ THE CAPTURES AND SCREENSHOTS BELOW SAY `Decision`, AND ARE LEFT THAT WAY:
 * they are dated records of what the product ACTUALLY emitted, not fixtures to
 * keep current (trap 14b). Today's placeholder is `Question`
 * ({@link UNAUTHORED_DECISION_LABEL}), renamed to agree with the UI's node
 * vocabulary; assertions track the constant, the history does not.
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
  UNAUTHORED_DECISION_LABEL,
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
  it("the projector no longer mints the generic placeholder when the brief states the decision", () => {
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
    expect(decision.label).not.toBe(UNAUTHORED_DECISION_LABEL);
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
      expect(refused.label).toBe(UNAUTHORED_DECISION_LABEL);
      const authored = deriveDecisionLabel({ brief: twin, goalQuotes: [] });
      expect(authored.authored, `twin must author: ${twin}`).toBe(true);
      expect(authored.label).toBe(twinLabel);
    },
  );

  it("a refused decision keeps the honest generic and says so", () => {
    const derived = deriveDecisionLabel({ brief: "The board set two main options.", goalQuotes: [] });
    expect(derived.authored).toBe(false);
    expect(derived.label).toBe(UNAUTHORED_DECISION_LABEL);
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

// ── INVESTIGATIVE BRIEFS ────────────────────────────────────────────────────
/**
 * ⭐⭐ A QUESTION THE USER ASKED IS NOT THE DECISION THEY ARE MAKING.
 *
 * ── THE WITNESSED DEFECT (deployed build `a18e194`, driven 30 Aug 2026) ────
 * A brief ending "…I need to work out what is actually driving it before we
 * commit budget to a fix." produced a DECISION node reading
 *
 *   "What Is Actually Driving It Before We Commit Budget to a Fix"
 *
 * — a title-cased fragment of the user's own sentence, naming no choice. The
 * label is reproduced byte-exactly by {@link deriveDecisionLabel} at rest, so
 * this is the producer and not a downstream surface.
 *
 * ── THE MECHANISM, ISOLATED RATHER THAN INFERRED ───────────────────────────
 * `deriveDecisionLabel` searches goal quotes with `requireChoiceFrame = true`
 * and then the BRIEF with the default `false`. Isolated by running each loop
 * alone: the goal-quote loop correctly returns `Decision`; the brief loop
 * returns the fragment. So the two call sites of one predicate carry two
 * different breadths, and only one of them was ever tightened.
 *
 * ── WHY *INVESTIGATIVE* AND NOT SIMPLY *NON-CHOICE* ────────────────────────
 * Requiring a CHOICE frame on the brief path would have been the wrong fix.
 * Measured across the frame families at pristine, it destroys six good labels
 * that name a real decision subject — `deciding how to allocate the £2m
 * marketing budget` → "Allocate the £2m Marketing Budget", `choosing a payroll
 * vendor` → "Payroll Vendor for Next Year", and four more. The harm is narrower
 * than "not a choice": the four INVESTIGATIVE frames take an EPISTEMIC
 * complement — one works out, figures out, *finds out* a fact — so the span
 * that follows them is a QUESTION, never a course of action. That is a
 * structural property of the construction, not a calibration over a corpus,
 * which is the same footing `DELIBERATION_FRAMES` itself stands on.
 *
 * ⚠ THE DELIBERATE, PINNED COST. A brief phrased "figure out whether to renew"
 * does state a choice, and the earliest-longest frame match is the
 * investigative one, so it now refuses and falls back to the honest generic.
 * That is one label traded, in the safe direction — refusal restores today's
 * pre-authoring behaviour and cannot put words in the user's mouth — and it is
 * pinned BY NAME below so it can neither grow nor shrink in silence (trap 22f).
 * A further rule to recover it would be the next round on a natural-language
 * predicate, which this estate has ratified as the point to stop guessing.
 *
 * ⚠ THE GOAL PATH IS DELIBERATELY UNTOUCHED. The investigative frames STAY in
 * `DELIBERATION_FRAMES`, because "I need to work out what is driving it" is
 * genuinely not an objective and must still be refused as one. This change
 * removes them from the decision node's EXTRACTION ANCHOR only — the two jobs
 * that list does, separated (trap 21).
 */
describe("an investigative brief does not name the decision from a question it asks", () => {
  /** The witnessed brief, verbatim from the deployed run. */
  const WITNESSED_BRIEF =
    "Our onboarding is too slow and customers never reach value. " +
    "I need to work out what is actually driving it before we commit budget to a fix.";

  it("refuses the witnessed churn-diagnosis brief instead of title-casing its question", () => {
    const derived = deriveDecisionLabel({ brief: WITNESSED_BRIEF });
    expect(derived.label).not.toBe(
      "What Is Actually Driving It Before We Commit Budget to a Fix",
    );
    expect(derived.authored).toBe(false);
    expect(derived.label).toBe(UNAUTHORED_DECISION_LABEL);
    expect(derived.reason).toBe("no_derivable_decision_statement");
  });

  /**
   * All four investigative frames, each with the question fragment it produced
   * at pristine. The defect was systematic, not one bad sentence.
   */
  const INVESTIGATIVE_CASES: ReadonlyArray<readonly [string, string]> = [
    ["work out", "I need to work out what is actually driving it before we commit budget to a fix."],
    ["working out", "We are working out which of the three regions is losing us money."],
    ["figure out", "I need to figure out why our conversion rate halved last quarter."],
    ["figuring out", "The team is figuring out where the bottleneck actually sits."],
  ];

  it.each(INVESTIGATIVE_CASES)(
    "refuses to mint a decision label from a brief framed with %s",
    (_frame, brief) => {
      const derived = deriveDecisionLabel({ brief });
      expect(derived.authored).toBe(false);
      expect(derived.label).toBe(UNAUTHORED_DECISION_LABEL);
    },
  );

  // ── OPPOSITE-DIRECTION TWINS. Every one of these authored at pristine and
  // must still author: the fix must close the question path without touching
  // the decision-naming path. Bound by IDENTITY (the exact label), never by a
  // predicate another string could satisfy (trap 19).
  const STILL_AUTHORED: ReadonlyArray<readonly [string, string, string]> = [
    ["should we", "Should we build or buy a billing system?", "Build or Buy a Billing System"],
    ["deciding how to", "We are deciding how to allocate the £2m marketing budget.", "Allocate the £2m Marketing Budget"],
    ["deciding on", "We are deciding on a pricing model for the new tier.", "A Pricing Model for the New Tier"],
    ["choosing a", "We are choosing a payroll vendor for next year.", "Payroll Vendor for Next Year"],
    ["choosing between", "We are choosing between Leeds and Bristol for the new office.", "Choose Between Leeds and Bristol for the New Office"],
    ["considering", "We are considering a move to a subscription model.", "A Move to a Subscription Model"],
    ["deciding", "We are deciding the launch date for the new product.", "The Launch Date for the New Product"],
    ["trying to decide", "We are trying to decide the right size for the sales team.", "The Right Size for the Sales Team"],
    /**
     * ⭐⭐ THE CASE THE GOVERNED CORPUS TAUGHT, and the reason this predicate
     * has two conjuncts. This is `03-vague-underspecified` verbatim. The
     * first version of the fix matched on the FRAME alone and destroyed this
     * label; an investigative verb with a NOUN-PHRASE complement names a real
     * subject and must survive. Bound to the exact string, so a future
     * frame-only formulation REDs here rather than shipping.
     */
    [
      "an investigative frame with a noun-phrase complement",
      "We need to figure out our hiring strategy for next quarter. Things have been pretty hectic and we're not sure if we should hire more engineers or focus on sales. Budget is tight.",
      "Hiring Strategy for Next Quarter",
    ],
  ];

  it.each(STILL_AUTHORED)(
    "still authors the decision on a brief framed with %s",
    (_frame, brief, expected) => {
      const derived = deriveDecisionLabel({ brief });
      expect(derived.authored).toBe(true);
      expect(derived.label).toBe(expected);
    },
  );

  /**
   * ⭐⭐ THE *FIRST* CONJUNCT IS LOAD-BEARING TOO, AND ONLY THESE BIND IT.
   * Found by a surviving mutant (`INVESTIGATIVE_FRAMES.has(...)` → `true`),
   * demonstrated non-equivalent rather than assumed so (trap 13c): a
   * DECIDING frame may take an interrogative complement and still state a real
   * decision. An interrogative complement is only evidence of a question when
   * the verb was one of *finding out*. Without these, dropping the frame
   * requirement is invisible.
   */
  const DECIDING_FRAME_WITH_INTERROGATIVE_COMPLEMENT: ReadonlyArray<
    readonly [string, string]
  > = [
    ["We are deciding what to do about the Leeds office.", "What to Do About the Leeds Office"],
    ["We are deciding which supplier to keep for next year.", "Which Supplier to Keep for Next Year"],
  ];

  it.each(DECIDING_FRAME_WITH_INTERROGATIVE_COMPLEMENT)(
    "still authors when a DECIDING frame takes an interrogative complement: %s",
    (brief, expected) => {
      const derived = deriveDecisionLabel({ brief });
      expect(derived.authored).toBe(true);
      expect(derived.label).toBe(expected);
    },
  );

  /**
   * ⚠ THE KNOWN-DROPPED SET, pinned EXACTLY. It must RED if it grows (a new
   * regression) OR shrinks (someone "recovered" it with the extra rule this
   * comment forbids). Asserting the exact set is what makes both observable.
   */
  const KNOWN_DROPPED: ReadonlyArray<readonly [string, string]> = [
    [
      "an investigative frame that happens to precede a real choice",
      "We need to figure out whether to renew the Salesforce contract.",
    ],
  ];

  it.each(KNOWN_DROPPED)("known-dropped, deliberately: %s", (_why, brief) => {
    const derived = deriveDecisionLabel({ brief });
    expect(derived.authored).toBe(false);
    expect(derived.label).toBe(UNAUTHORED_DECISION_LABEL);
  });

  /**
   * ⭐ THE PRECONDITION THIS GUARD PINS ON ITSELF (trap 13b). The suite above
   * would pass just as happily if `deriveDecisionLabel` refused EVERYTHING —
   * a guard agreeing with itself. This asserts the two arms genuinely
   * discriminate on the SAME run, so the refusals are the code's doing and not
   * a derivation that has quietly stopped working.
   */
  it("discriminates: the investigative arm refuses while the choice arm authors, in one run", () => {
    const investigative = deriveDecisionLabel({ brief: WITNESSED_BRIEF });
    const choice = deriveDecisionLabel({
      brief: "Should we build or buy a billing system?",
    });
    expect(investigative.authored).toBe(false);
    expect(choice.authored).toBe(true);
    expect(choice.label).not.toBe(investigative.label);
  });

  /**
   * ⭐⭐ THE GOAL PATH IS UNCHANGED, ASSERTED RATHER THAN ASSUMED. The
   * investigative frames must REMAIN deliberation frames for the goal, whose
   * refusal on this quote is correct and is not what this change touches.
   */
  it("leaves the goal path's refusal on the same investigative quote untouched", () => {
    const quote = "work out what is actually driving it before we commit budget to a fix";
    const derived = deriveGoalObjectiveLabel(quote);
    expect(derived.authored).toBe(false);
    expect(derived.reason).toBe("deliberation_frame");
    expect(derived.label).toBe(quote);
  });
});

/**
 * ⭐⭐⭐ THE CROSS-SERVICE VOCABULARY PIN — the decision node's unauthored
 * placeholder is the word the UI shows for that node's KIND, and the two
 * services must agree on it or a freshly-drafted graph contradicts its own
 * legend on screen.
 *
 * ── THE DEFECT THIS EXISTS TO CATCH ─────────────────────────────────────────
 * The UI renamed the decision node's user-facing vocabulary from `Decision` to
 * `Question`, from a single constant (`DECISION_NODE_LABEL`,
 * `DecisionGuideAI:src/canvas/domain/vocabulary.ts`, PR #1026). That constant
 * governs the LEGEND, the context menu, the inspector and the node registry's
 * kind label — it does NOT rewrite a node's own `label` field. So a graph
 * drafted by CEE carried the server-minted string `Decision` as the node's
 * text while every affordance around it read `Question`: the two services
 * disagreeing on one screen, which is what this pin forbids.
 *
 * ── WHY THE ASSERTION IS A LITERAL AND NOT THE CONSTANT ─────────────────────
 * Asserting `=== UNAUTHORED_DECISION_LABEL` would be a tautology: it passes for
 * whatever the constant happens to say, which is exactly the drift in question.
 * The literal below is the CONTRACT with the UI. If someone changes the CEE
 * constant, this REDs and the RED is the reminder that the UI half must move
 * in the same wave.
 *
 * ⚠ SCOPE, STATED PRECISELY (trap 20): this pins CEE's half only. It cannot
 * observe the UI's constant from this repo, so it proves the server emits the
 * agreed string — never that the UI still agrees. The UI's own half is pinned
 * in that repo.
 */
describe("the unauthored decision label agrees with the UI's node vocabulary", () => {
  /** The string the UI's `DECISION_NODE_LABEL` holds. Changing one requires changing both. */
  const UI_DECISION_NODE_LABEL = "Question";

  it("⭐ the pure producer mints the agreed placeholder when it declines to author", () => {
    const declined = deriveDecisionLabel({
      brief: "Our burn rate is too high and the team is stretched thin.",
      goalQuotes: [],
    });
    expect(declined.authored).toBe(false);
    expect(declined.reason).toBe("no_derivable_decision_statement");
    expect(declined.label).toBe(UI_DECISION_NODE_LABEL);

    // CONTRAST CONTROL (trap 13): a brief that DOES pose a choice must author a
    // real label. Without this the pin would pass against a producer that had
    // stopped authoring anything at all and returned the placeholder always.
    const authored = deriveDecisionLabel({
      brief: "We are deciding whether to build our own fleet or partner with third-party couriers.",
      goalQuotes: [],
    });
    expect(authored.authored).toBe(true);
    expect(authored.label).not.toBe(UI_DECISION_NODE_LABEL);
  });

  /**
   * ⭐ THE WHOLE MINT PATH, NOT THE LEAF FUNCTION. The pure-function pin above
   * would still pass if the projector stopped calling `deriveDecisionLabel` and
   * hardcoded its own string — which is how the literal got minted in the first
   * place. This drives `projectRecordsToGraph` and reads the node a user would
   * actually see, bound BY IDENTITY (the sole `kind === "decision"` node), never
   * by a value predicate another node could satisfy.
   */
  it("⭐ the PROJECTED decision node a user sees carries the agreed placeholder", () => {
    const brief = "Our burn rate is too high and the team is stretched thin.";
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "Our burn rate is too high" },
        { kind: "option", source_quote: "cut contractor spend" },
        { kind: "option", source_quote: "slow down hiring" },
      ],
      claims: [
        { claim_kind: "outcome", label: "Monthly Burn", basis: [0] },
        {
          claim_kind: "causal_link",
          label: "cutting contractors lowers burn",
          from_stated: 1,
          to_claim: 0,
          effect: "negative",
        },
        {
          claim_kind: "causal_link",
          label: "slower hiring lowers burn",
          from_stated: 2,
          to_claim: 0,
          effect: "negative",
        },
      ],
    };

    const projected = projectRecordsToGraph(records, brief).graph;
    const decisions = projected.nodes.filter((n) => n.kind === "decision");
    expect(decisions).toHaveLength(1);
    const decision = decisions[0];

    expect(decision.label).toBe(UI_DECISION_NODE_LABEL);
    // The placeholder is NOT an authored label, and must not claim to be.
    expect(decision.provenance?.label_authored).toBeUndefined();
  });
});

/**
 * ⭐⭐⭐ `label_placeholder` — THE SIGNAL THAT REPLACES THE STRING MATCH.
 *
 * ── WHY A NEW FIELD AND NOT A FIX TO `label_authored` ───────────────────────
 * Two different questions were riding one boolean (trap 21):
 *
 *   Q1  "is this display string OURS rather than the user's?"
 *   Q2  "did we DERIVE a meaningful label from the brief?"
 *
 * On every node but this one the answers coincide. On the decision
 * placeholder they diverge: the string is ours (Q1 yes) and we derived
 * nothing (Q2 no). `label_authored` encodes Q2 while its own contract comment
 * documents Q1 — *"Absent means the label IS the user's own text"* — which is
 * FALSE of the placeholder.
 *
 * `label_authored` is NOT corrected here, deliberately. It has a live consumer
 * that depends on the answer it currently gives: `hasProvisionalDecision`
 * (`post-draft-narrative.ts`) reads `label_authored !== true` as half of its
 * "the projector declined" signature, and gating on that flag ALONE already
 * shipped a witnessed false claim in the opposite direction — telling users
 * who had posed a perfectly good decision that we could not find one. So the
 * concepts are NAMED APART rather than reconciled, which is trap 21's actual
 * prescription.
 *
 * ── WHAT THIS BUYS THE UI ───────────────────────────────────────────────────
 * A boolean. The consumer no longer has to compare a label against a known
 * placeholder STRING to decide whether to show its empty state — which is the
 * entire fragility class this change exists to remove. Two services agreeing
 * on a display word is a coincidence waiting to lapse; a field is a contract.
 */
describe("label_placeholder — an un-chosen mint, marked as one", () => {
  const UI_DECISION_NODE_LABEL = "Question";

  /** A V1 decision node as the projector banks it on the DECLINE path. */
  const placeholderV1 = (over: Record<string, unknown> = {}) => ({
    version: "1",
    nodes: [
      {
        id: "dec_1",
        kind: "decision",
        label: UI_DECISION_NODE_LABEL,
        provenance: {
          provenance_class: "projector_structural",
          label_placeholder: true,
        },
        ...over,
      },
      { id: "opt_1", kind: "option", label: "invest", data: { interventions: {} } },
    ],
    edges: [],
  });

  const wireDecision = (v1: unknown) =>
    projectGraphAndOptionsToV3(v1 as never, { brief: "We are stretched thin." }).graph.nodes.find(
      (n) => n.kind === "decision",
    );

  it("⭐ ARM 1 — the placeholder path MARKS the node on the wire", () => {
    expect(wireDecision(placeholderV1())?.label_placeholder).toBe(true);
  });

  /**
   * ⭐⭐ THE PRODUCER'S OWN TWO ARMS — ADDED AFTER A SURVIVING MUTANT EXPOSED
   * THAT NOTHING BOUND THEM.
   *
   * The wire-level arms above drive `projectGraphAndOptionsToV3` from a
   * hand-built V1 fixture, so they bypass the PROJECTOR entirely. A mutant that
   * made the reader mark EVERY node SURVIVED all five of them — because the
   * lift's label re-derivation still filtered it, so the suite was agreeing
   * with itself about a producer it never ran (trap 13b). These two run
   * `projectRecordsToGraph` and read what the producer actually banks.
   *
   * They are a PAIR on purpose: one arm alone cannot show the mark
   * discriminates, only that it can appear.
   */
  it("⭐ PRODUCER ARM 1 — a brief that yields no decision statement banks the mark", () => {
    const brief = "Our burn rate is too high and the team is stretched thin.";
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "Our burn rate is too high" },
        { kind: "option", source_quote: "cut contractor spend" },
        { kind: "option", source_quote: "slow down hiring" },
      ],
      claims: [{ claim_kind: "outcome", label: "Monthly Burn", basis: [0] }],
    };
    const projected = projectRecordsToGraph(records, brief).graph;
    const decision = projected.nodes.filter((n) => n.kind === "decision")[0];
    expect(decision.provenance?.label_placeholder).toBe(true);
    expect(decision.provenance?.label_authored).toBeUndefined();
  });

  it("⭐ PRODUCER ARM 2 — a brief that DOES state the decision banks NO mark", () => {
    const brief = "Should we raise the price or keep it as is? Our churn is 3.5% monthly.";
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "Should we raise the price or keep it as is?" },
        { kind: "option", source_quote: "raise the price" },
        { kind: "option", source_quote: "keep it as is" },
      ],
      claims: [{ claim_kind: "outcome", label: "Monthly Recurring Revenue", basis: [1] }],
    };
    const projected = projectRecordsToGraph(records, brief).graph;
    const decision = projected.nodes.filter((n) => n.kind === "decision")[0];
    expect(decision.provenance?.label_authored).toBe(true);
    expect(decision.provenance?.label_placeholder).toBeUndefined();
  });

  /**
   * ⭐ ARM 2. A field that is always present is not a signal. This is the twin
   * of ARM 1 and must be read with it: together they show the field
   * DISCRIMINATES rather than merely existing.
   */
  it("⭐ ARM 2 — an AUTHORED decision label is NOT marked", () => {
    const authoredV1 = {
      version: "1",
      nodes: [
        {
          id: "dec_1",
          kind: "decision",
          label: "Build Our Own Fleet or Partner With Couriers",
          provenance: { provenance_class: "projector_structural", label_authored: true },
        },
        { id: "opt_1", kind: "option", label: "invest", data: { interventions: {} } },
      ],
      edges: [],
    };
    const wire = wireDecision(authoredV1);
    expect(wire?.label_authored).toBe(true);
    expect(wire?.label_placeholder).toBeUndefined();
  });

  /**
   * ⭐⭐ A USER RENAME CLEARS IT — BY DERIVATION, NOT BY A WRITER REMEMBERING.
   *
   * The flag is RE-DERIVED at the lift on every response (the RESPONSE-ONLY
   * rule its two siblings already follow), so it clears when the label stops
   * being the placeholder REGARDLESS of whether a rename writer thought to
   * drop it. That matters because the rename writer is a different lane
   * (#1273): a design that required it to remember would be the
   * hand-maintained mirror this estate keeps paying for (trap 12).
   *
   * Both renames below carry the STALE `label_placeholder: true` banked at
   * draft time — that is the whole point. If the field were merely carried
   * through, these would pass it to the wire and the UI would show an empty
   * state over a name the user had chosen.
   */
  it("⭐ a user rename clears the mark, even with the stale flag still banked", () => {
    const renamed = placeholderV1({
      label: "Should We Move the Warehouse?",
      provenance: { provenance_class: "projector_structural", label_placeholder: true },
    });
    expect(wireDecision(renamed)?.label_placeholder).toBeUndefined();
  });

  it("⭐ a rename stamped `user_set` clears it too (the #1273 shape)", () => {
    const renamed = {
      version: "1",
      nodes: [
        {
          id: "dec_1",
          kind: "decision",
          label: "Should We Move the Warehouse?",
          provenance: "user_set",
        },
        { id: "opt_1", kind: "option", label: "invest", data: { interventions: {} } },
      ],
      edges: [],
    };
    expect(wireDecision(renamed)?.label_placeholder).toBeUndefined();
  });

  /**
   * ⭐ THE BLANK-LABEL PATH, STATED RATHER THAN PAPERED OVER. `NodeV3` ACCEPTS
   * `""` and `"   "` (measured: only ABSENT and NULL are rejected), and no CEE
   * validator errors on a blank label. This field's claim is narrow — "this
   * string is the generic mint we fall back to" — and a blank label is NOT
   * that. So it is left UNMARKED, and the surface's own unnamed-node handling
   * governs it. Deliberately NOT widened to mean "not a real name": that would
   * be one boolean answering two questions again, which is the defect this
   * field was minted to end.
   */
  it("⭐ a blank label is NOT marked as the placeholder — a different question", () => {
    for (const blank of ["", "   "]) {
      const v1 = placeholderV1({ label: blank });
      expect(wireDecision(v1)?.label_placeholder, `blank=${JSON.stringify(blank)}`).toBeUndefined();
    }
  });
});
