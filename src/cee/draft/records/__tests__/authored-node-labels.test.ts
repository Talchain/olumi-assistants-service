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

  it("authors 10 of the 14 governed decision labels, and refuses the other 4 by name", () => {
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
    ]);
  });

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
    const brief = "We must increase MRR from £215k to £250k within 6 months.";
    const records: DraftRecordSet = {
      stated_items: [
        {
          kind: "goal",
          source_quote: "increase MRR from £215k to £250k within 6 months",
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
    const union = [
      goal?.label ?? "",
      goal?.provenance?.source_quote ?? "",
      String(goal?.goal_threshold_raw ?? ""),
    ].join(" ");
    for (const numeral of ["215", "250", "6"]) {
      expect(union, `numeral ${numeral} must survive the union`).toContain(numeral);
    }
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
