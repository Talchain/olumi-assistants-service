/**
 * ⭐⭐⭐ A GOAL CARRIES THE USER'S PROVENANCE IFF THE USER DESIGNATED IT.
 *
 * ── THE WITNESSED DEFECT, ON A REAL GOVERNED CAPTURE ───────────────────────
 * Brief `01-simple-binary` (`run-b9389df`, real staging). The model files the
 * user's own QUESTION as the goal, and every layer below agrees with it:
 *
 *   goal quote     = "Should we raise the price or keep it as is?"
 *   provenance     = `from_brief`
 *   assistant_text = I've built a first decision model for "Should we raise the
 *                    price or keep it as is?".
 *
 * Asserted, in quotation marks, with no disclosure that Olumi chose the span.
 * The founder's ruling: *"Bad: Olumi invents a goal and records it as
 * `from_brief`."* FOUR of the thirteen governed goal quotes are this shape.
 *
 * ── THE SPEC THIS SUITE IS WRITTEN AGAINST ─────────────────────────────────
 * NOT "a refused label must not say from_brief" — that is a guard shaped like
 * its own bug (trap 13d), and it is precisely the defect an earlier head of
 * this branch shipped. The invariant is the biconditional above, and its two
 * failure directions are NOT symmetric in cost:
 *
 *   · stamping an Olumi-chosen goal as the user's  — the defect.
 *   · stamping a user-designated goal as Olumi's   — WORSE. It tells a user
 *     their own words were invented.
 *
 * ⚠⚠ THE SECOND DIRECTION WAS SHIPPED ON THIS BRANCH AND MEASURED BY AN
 * INDEPENDENT REVIEWER AT HEAD `d42f121c`. Admitting `head_disclaims` — a
 * lexical `not|never|no|nor` test whose job is DISPLAY SAFETY — told a user who
 * wrote *"Our objective for this quarter is: We must never let latency exceed
 * 200ms"* that **"the brief designates no objective"**. Section 2 below is that
 * counterexample and its whole class, and it is the load-bearing half of this
 * file. See `objective-label.ts:REFUSAL_ANSWERS` for the two-question table.
 *
 * ── ⚠ WHERE THE EXPECTATIONS COME FROM ────────────────────────────────────
 * An acceptance corpus that computes its expected attribution by calling the
 * predicate under test is a guard agreeing with itself. **Every expectation in
 * sections 4 and 5 is a HAND verdict** — what a person reading the brief would
 * say it designates — written as a literal in the table and never derived from
 * `refusalDeniesObjecthood`. The quotes themselves come from outside this
 * lane's head: this module's adversarial corpus in `authored-node-labels.test.ts`
 * (two rounds of external review, ordinary British business prose) and the
 * frozen governed baseline of real staging captures.
 */
import { describe, expect, it } from "vitest";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  projectRecordsToGraph,
  GOAL_SPAN_CHOSEN_BY_CEE,
  PROJECTOR_STRUCTURAL_CLASS,
} from "../projector.js";
import type { DraftRecordSet } from "../grammar.js";
import {
  deriveGoalObjectiveLabel,
  REFUSALS_DENYING_OBJECTHOOD,
  refusalDeniesObjecthood,
  type AuthoredLabelRefusal,
} from "../objective-label.js";
import { projectGraphAndOptionsToV3 } from "../../../transforms/schema-v3.js";
import { buildPostDraftNarrative } from "../../../../orchestrator-v5/coaching/post-draft-narrative.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../../..");
const GOVERNED = path.join(
  REPO_ROOT,
  "tools/graph-evaluator/governed/draft-graph-v5/baseline/run-b9389df-claude-sonnet-4-6.json",
);

/** The real governed capture the lead RED is taken from (`01-simple-binary`). */
const GOVERNED_QUESTION_AS_GOAL = "Should we raise the price or keep it as is?";
const GOVERNED_QUESTION_BRIEF =
  "Should we raise the price or keep it as is? Margin is tight and volume is soft.";

/** The reviewer's counterexample, verbatim from `authored-node-labels.test.ts`. */
const NEGATIVE_UPPER_BOUND = "We must never let latency exceed 200ms";
const NEGATIVE_UPPER_BOUND_BRIEF =
  "Our objective for this quarter is: We must never let latency exceed 200ms. We could add capacity or tune caching.";
/** Its meaning-preserving positive twin — same objective, no negation token. */
const POSITIVE_UPPER_BOUND = "Keep latency at most 200ms";
const POSITIVE_UPPER_BOUND_BRIEF =
  "Our objective for this quarter is: Keep latency at most 200ms. We could add capacity or tune caching.";

/** The two options are constant across cases so the goal is the only variable. */
function recordsFor(goalQuote: string): DraftRecordSet {
  return {
    stated_items: [
      { kind: "goal", source_quote: goalQuote },
      { kind: "option", source_quote: "add onboarding calls" },
      { kind: "option", source_quote: "ship a self-serve tour" },
    ],
    claims: [{ claim_kind: "outcome", label: "Customer Retention", basis: [0] }],
  } as unknown as DraftRecordSet;
}

interface Observed {
  readonly goalNodeId: string | undefined;
  readonly recordClass: string | undefined;
  readonly wireProvenance: string | undefined;
  readonly sourceQuote: string | undefined;
  readonly wireLabel: string | undefined;
  readonly labelAuthored: boolean;
  readonly disclosureQuote: string | undefined;
  readonly assistantText: string;
}

/** Drive the WHOLE seam: records → projector → V3 wire → assistant narrative. */
function drive(goalQuote: string, brief: string): Observed {
  const projection = projectRecordsToGraph(recordsFor(goalQuote), brief);
  const goalNode = projection.graph.nodes.find((n) => n.kind === "goal");
  if (!goalNode) throw new Error(`no goal node projected for ${JSON.stringify(goalQuote)}`);
  const record = projection.provenance[goalNode.id] as
    | { provenance_class?: string; quote?: string }
    | undefined;

  // ⚠ THE V3 TRANSFORM RETURNS AN ENVELOPE, NOT A GRAPH: `{ graph, options,
  // goal_node_id, ... }`. Reading `.nodes` off the envelope yields `undefined`
  // and every provenance assertion below would then pass or fail on nothing.
  // Asserted, not assumed.
  // ⚠ THE SECOND ARGUMENT IS A CONTEXT OBJECT, NOT A POSITIONAL BRIEF. An
  // earlier draft of this helper passed `(graph, undefined, brief)`; the third
  // argument is silently DISCARDED, so the transform ran with no brief at all
  // and every verdict below was being read off a context the caller thought it
  // had supplied. Caught by the full `tsc` ratchet, not by the build gate
  // (which excludes tests) and not by the suite (which was green throughout).
  const v3 = projectGraphAndOptionsToV3(projection.graph as never, {
    brief,
  }) as unknown as { graph?: { nodes?: readonly Record<string, unknown>[] } };
  const wireNodes = v3.graph?.nodes;
  if (!wireNodes || wireNodes.length === 0) {
    throw new Error("V3 envelope carried no graph.nodes — the probe is blind, not the code green");
  }
  const wireGoal = wireNodes.find((n) => n.kind === "goal");

  const narrative = buildPostDraftNarrative({
    graph: v3.graph,
    briefText: brief,
  } as never) as unknown as { text?: string };

  return {
    goalNodeId: goalNode.id,
    recordClass: record?.provenance_class,
    wireProvenance: wireGoal?.provenance as string | undefined,
    sourceQuote: wireGoal?.source_quote as string | undefined,
    wireLabel: wireGoal?.label as string | undefined,
    labelAuthored: wireGoal?.label_authored === true,
    disclosureQuote: record?.quote,
    assistantText: narrative.text ?? "",
  };
}

/** The reason as a comparable string, so `(authored)` is a first-class value. */
function reasonOf(quote: string): string {
  const derived = deriveGoalObjectiveLabel(quote);
  return derived.authored ? "(authored)" : (derived.reason ?? "(no reason)");
}

// ─────────────────────────────────────────────────────────────────────────────
// 0. THE INSTRUMENT, BEFORE ANY CLAIM IS MADE WITH IT (trap 13).
//    An absence assertion is vacuous until the probe is shown seeing a presence.
// ─────────────────────────────────────────────────────────────────────────────
describe("the seam under test is reachable and discriminating", () => {
  it("projects a goal node and reaches the wire and the narrative", () => {
    const o = drive("cut churn below 3% a month", "Our goal is to cut churn below 3% a month.");
    expect(o.recordClass, "record class must be observable").toBeTypeOf("string");
    expect(o.wireProvenance, "wire provenance must be observable").toBeTypeOf("string");
    expect(o.assistantText.length, "narrative must be non-empty").toBeGreaterThan(0);
  });

  it("DISCRIMINATES: the two directions produce different verdicts on the same seam", () => {
    // ⭐ THE POSITIVE CONTROL FOR THE WHOLE SUITE. If these two ever agree, every
    // assertion below is passing on an instrument that stopped discriminating
    // (trap 20: sameness across inputs that ought to differ is evidence about
    // the probe, not about the world).
    const designated = drive("cut churn below 3% a month", "Our goal is to cut churn below 3% a month.");
    const chosen = drive(GOVERNED_QUESTION_AS_GOAL, GOVERNED_QUESTION_BRIEF);
    expect(designated.wireProvenance).not.toBe(chosen.wireProvenance);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE LEAD RED — the measured defect, on a real governed capture, driven
//    end to end.
// ─────────────────────────────────────────────────────────────────────────────
describe("a goal the user never designated does not wear the user's badge", () => {
  it("the user's own QUESTION is stamped as CEE's, not as the user's", () => {
    const o = drive(GOVERNED_QUESTION_AS_GOAL, GOVERNED_QUESTION_BRIEF);

    // The deriver's verdict — the evidence that was being discarded.
    expect(reasonOf(GOVERNED_QUESTION_AS_GOAL)).toBe("deliberation_frame");

    expect(o.recordClass, "record class").toBe(PROJECTOR_STRUCTURAL_CLASS);
    expect(o.wireProvenance, "wire provenance").toBe("ai_inferred");
    // Bound by IDENTITY to the exported constant, never to a copied string.
    expect(o.disclosureQuote).toBe(GOAL_SPAN_CHOSEN_BY_CEE);
  });

  it("the false quotation stops — the opener no longer asserts the question as the user's goal", () => {
    const o = drive(GOVERNED_QUESTION_AS_GOAL, GOVERNED_QUESTION_BRIEF);
    expect(o.assistantText).not.toContain(`for "${GOVERNED_QUESTION_AS_GOAL}"`);
    expect(o.assistantText).toContain("from your brief");
  });

  it("nothing the user WROTE is lost — only the DESIGNATION is withdrawn", () => {
    // The distinction the whole mechanism exists to hold: we withdraw the claim
    // that the user chose this as the objective, NOT their words.
    const o = drive(GOVERNED_QUESTION_AS_GOAL, GOVERNED_QUESTION_BRIEF);
    expect(o.sourceQuote, "the verbatim still reaches the inspector").toBe(GOVERNED_QUESTION_AS_GOAL);
    // `label_authored` answers a DIFFERENT question — "did we write these
    // characters?" — and we did not: the deriver refused, so the label is the
    // user's own text. Setting it here would be a second, false claim (trap 21).
    expect(o.labelAuthored, "we did not author these characters").toBe(false);
  });

  it("the structural twin — a free-standing alternative — is treated identically", () => {
    const quote = "Build our own last-mile fleet — or partner with a third-party courier";
    expect(reasonOf(quote)).toBe("states_alternatives");
    const o = drive(quote, `${quote}. Costs are rising fast.`);
    expect(o.recordClass).toBe(PROJECTOR_STRUCTURAL_CLASS);
    expect(o.wireProvenance).toBe("ai_inferred");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1b. ⭐ THE SEAM THIS PR SHARES WITH #1180 — A STATE NEITHER REVIEW SAW.
//
//     #1180 bounds every node label at the projector's return and, for a node
//     that CARRIES THE VERBATIM, stamps `label_authored: true` because after
//     shortening the display string really is ours. Its reviewed world had one
//     kind of goal carrying `source_quote`: `stated`. THIS PR mints a second —
//     `projector_structural` WITH `source_quote` — so the combination below
//     came into existence at the rebase and was reviewed by neither side.
//
//     ⚠ REACHABLE, NOT HYPOTHETICAL. The two longest real `deliberation_frame`
//     goal quotes in the governed baseline are 178 and 159 characters against a
//     200-character bound; a slightly wordier brief trips it.
//
//     Measured verdict: the two compose CORRECTLY, and all three signals are
//     true at once — CEE chose the span (`projector_structural`), the display
//     string is ours (`label_authored`), and the user's words survive whole
//     (`source_quote`). Pinned here so it stays that way.
// ─────────────────────────────────────────────────────────────────────────────
describe("the label bound (#1180) and the designation badge (#1250) compose", () => {
  /** `deliberation_frame`, and deliberately past #1180's 200-character bound. */
  const LONG_DECISION_SPAN =
    "evaluating whether to invest £800k in robotic picking systems that promise to reduce errors to 0.3% and increase throughput by 40% across every regional distribution centre, or to hire 15 additional quality control staff on permanent contracts";

  it("an OVER-LONG chosen goal span: badge withdrawn, label bounded, verbatim intact", () => {
    // PIN BOTH PRECONDITIONS IN-TEST (trap 13b): the span must really be the
    // refusal under test AND really exceed the bound, or this passes on nothing.
    expect(reasonOf(LONG_DECISION_SPAN), "precondition: the refusal").toBe("deliberation_frame");
    expect(LONG_DECISION_SPAN.length, "precondition: past #1180's bound").toBeGreaterThan(200);

    const o = drive(LONG_DECISION_SPAN, LONG_DECISION_SPAN);
    expect(o.recordClass, "#1250: CEE chose this span").toBe(PROJECTOR_STRUCTURAL_CLASS);
    expect(o.wireProvenance).toBe("ai_inferred");
    expect(o.wireLabel!.length, "#1180: the label is inside the bound").toBeLessThanOrEqual(200);
    expect(o.labelAuthored, "#1180: after shortening the display string IS ours").toBe(true);
    // ⭐ The load-bearing one: shortening the LABEL must never shorten the
    // user's own words. Bound by identity to the exact span.
    expect(o.sourceQuote, "the verbatim survives WHOLE").toBe(LONG_DECISION_SPAN);
  });

  it("DISCRIMINATES: `label_authored` tracks the BOUND, not the badge", () => {
    // ⭐ The pair. Same badge on both; the flag differs ONLY because one span is
    // over-long. Without this, the assertion above could pass on a
    // `label_authored` that this PR had set for its own reasons.
    const long = drive(LONG_DECISION_SPAN, LONG_DECISION_SPAN);
    const short = drive(GOVERNED_QUESTION_AS_GOAL, GOVERNED_QUESTION_BRIEF);
    expect(GOVERNED_QUESTION_AS_GOAL.length, "precondition: inside the bound").toBeLessThan(200);
    expect(short.recordClass, "same badge as the long one").toBe(long.recordClass);
    expect(short.labelAuthored, "nothing was shortened, so nothing was authored").toBe(false);
    expect(long.labelAuthored).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. ⛔⛔ THE INTRODUCED HARM, AND THE REASON THIS FILE EXISTS IN ITS PRESENT
//    FORM. An explicitly designated objective KEEPS its attribution and its
//    quotation, whatever negation its wording happens to contain.
//
//    Measured at `d42f121c`: every case in this section returned
//    `projector_structural` / `ai_inferred` / "the brief designates no
//    objective". Every one of them is a goal the user plainly designated.
// ─────────────────────────────────────────────────────────────────────────────
describe("an EXPLICITLY DESIGNATED objective keeps the user's badge and its quotation", () => {
  /**
   * ⭐ THE MINIMAL PAIR THE REVIEWER ASKED FOR: the same objective in a negative
   * and a positive wording. Both are designated by the same preamble; both must
   * be attributed to the user; and the pair is what proves the verdict tracks
   * DESIGNATION rather than the presence of a negation token.
   */
  const UPPER_BOUND_PAIR: readonly {
    name: string;
    quote: string;
    brief: string;
    /** HAND verdict, not computed: what does the deriver say about DISPLAY? */
    displayVerdict: string;
  }[] = [
    {
      name: "negative wording — the reviewer's counterexample",
      quote: NEGATIVE_UPPER_BOUND,
      brief: NEGATIVE_UPPER_BOUND_BRIEF,
      displayVerdict: "head_disclaims",
    },
    {
      name: "positive wording — same meaning, no negation token",
      quote: POSITIVE_UPPER_BOUND,
      brief: POSITIVE_UPPER_BOUND_BRIEF,
      displayVerdict: "(authored)",
    },
  ];

  it.each(UPPER_BOUND_PAIR)(
    "$name: keeps stated/from_brief and is quoted back",
    ({ quote, brief, displayVerdict }) => {
      // PIN THE PRECONDITION IN-TEST (trap 13b). The pair is only a
      // discrimination while the two halves reach DIFFERENT display verdicts; if
      // the deriver ever stopped refusing the negative wording this test would
      // pass while proving nothing.
      expect(reasonOf(quote), "the display verdict this case exists to separate").toBe(
        displayVerdict,
      );

      const o = drive(quote, brief);
      expect(o.recordClass, "record class").toBe("stated");
      expect(o.wireProvenance, "wire provenance").toBe("from_brief");
      expect(o.sourceQuote, "the user's verbatim").toBe(quote);
      // Bound by IDENTITY: this node's own label, in the opener, in quotes.
      expect(o.assistantText, "the narrative quotes it back as theirs").toContain(
        `for "${o.wireLabel}"`,
      );
      expect(o.disclosureQuote, "no CEE disclosure may be attached").toBeUndefined();
    },
  );

  it("the pair is a real discrimination: the two halves differ in DISPLAY and agree in ATTRIBUTION", () => {
    // ⭐ Without this, the pair could pass by both halves being authored — the
    // shape that made the earlier corpus a guard agreeing with itself.
    expect(reasonOf(NEGATIVE_UPPER_BOUND)).not.toBe(reasonOf(POSITIVE_UPPER_BOUND));
    const negative = drive(NEGATIVE_UPPER_BOUND, NEGATIVE_UPPER_BOUND_BRIEF);
    const positive = drive(POSITIVE_UPPER_BOUND, POSITIVE_UPPER_BOUND_BRIEF);
    expect(negative.wireProvenance).toBe(positive.wireProvenance);
    expect(negative.goalNodeId).not.toBe(positive.goalNodeId);
  });

  /**
   * ⛔ THE WHOLE `head_disclaims` CLASS, taken from this module's external
   * adversarial corpus (`authored-node-labels.test.ts` MEASURED_HARMS). All
   * three quotes it contains are genuine user objectives stated as upper
   * bounds — 3 of 3, 0 counterexamples — which is the measurement that removed
   * `head_disclaims` from the designation set.
   */
  const HEAD_DISCLAIMS_ARE_ALL_REAL_OBJECTIVES: readonly (readonly [string, string])[] = [
    ["a latency target", NEGATIVE_UPPER_BOUND],
    ["a budget cap", "We must not exceed £250,000"],
    ["a compound objective", "Grow revenue, but not at the expense of margin"],
  ];

  it.each(HEAD_DISCLAIMS_ARE_ALL_REAL_OBJECTIVES)(
    "a display-safety negation refusal never withdraws attribution (%s): %s",
    (_kind, quote) => {
      expect(reasonOf(quote), "precondition: this IS the display refusal under test").toBe(
        "head_disclaims",
      );
      const o = drive(quote, `Our objective is: ${quote}. We could act now, or wait a quarter.`);
      expect(o.recordClass).toBe("stated");
      expect(o.wireProvenance).toBe("from_brief");
      expect(o.disclosureQuote).toBeUndefined();
    },
  );

  /** The display-only refusals that were already excluded, kept pinned. */
  const DISPLAY_REFUSALS_KEEP_THE_BADGE: readonly {
    name: string;
    quote: string;
    brief: string;
    displayVerdict: string;
  }[] = [
    {
      name: "the explicit-goal CONTROL — authored cleanly, no refusal at all",
      quote: "cut churn below 3% a month",
      brief: "Our goal is to cut churn below 3% a month. We could add onboarding calls.",
      displayVerdict: "(authored)",
    },
    {
      name: "identical_to_quote — the union's own words: the quote already IS the objective",
      quote: "Reduce Churn Below Three Percent",
      brief: "Reduce Churn Below Three Percent. We could add onboarding calls.",
      displayVerdict: "identical_to_quote",
    },
    {
      name: "no_concise_form — a LENGTH verdict, silent about objecthood",
      quote:
        "reduce cost per delivery below seven pounds across every regional depot before the end of the next financial year",
      brief:
        "Our objective is to reduce cost per delivery below seven pounds across every regional depot before the end of the next financial year. We could renegotiate carriers.",
      displayVerdict: "no_concise_form",
    },
    {
      name: "clause_discarded — a REDUCTION verdict, silent about objecthood",
      quote: "cut delivery cost per parcel (excluding fuel surcharges)",
      brief:
        "We want to cut delivery cost per parcel (excluding fuel surcharges). We could renegotiate carriers.",
      displayVerdict: "clause_discarded",
    },
  ];

  it.each(DISPLAY_REFUSALS_KEEP_THE_BADGE)("$name", ({ quote, brief, displayVerdict }) => {
    expect(reasonOf(quote), "precondition pinned in-test").toBe(displayVerdict);
    const o = drive(quote, brief);
    expect(o.recordClass, "must stay stated").toBe("stated");
    expect(o.wireProvenance, "must stay from_brief").toBe("from_brief");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE TWO-QUESTION TABLE IS PINNED, MEMBER BY MEMBER.
// ─────────────────────────────────────────────────────────────────────────────
describe("the objecthood-denying refusal set is pinned exactly", () => {
  it("is exactly the two CONSTRUCTION tests, and nothing else", () => {
    expect([...REFUSALS_DENYING_OBJECTHOOD].sort()).toEqual([
      "deliberation_frame",
      "states_alternatives",
    ]);
  });

  /**
   * ⭐ EVERY OTHER MEMBER OF THE UNION, BY NAME. This is the KNOWN-DROPPED
   * discipline: the list may not grow in silence, and `head_disclaims` in
   * particular is pinned OUT with the reason attached, because it is the one
   * that reads like a designation verdict and is not.
   */
  const DISPLAY_ONLY: readonly AuthoredLabelRefusal[] = [
    "empty",
    "would_drop_a_qualification",
    "clause_discarded",
    "head_disclaims",
    "no_concise_form",
    "too_few_tokens",
    "names_no_subject",
    "not_derivable",
    "identical_to_quote",
    "no_derivable_decision_statement",
    "asks_a_question",
  ];

  it.each(DISPLAY_ONLY)("%s answers DISPLAY SAFETY and must NOT deny objecthood", (reason) => {
    expect(refusalDeniesObjecthood(reason)).toBe(false);
  });

  it("an authored label has no reason, and no reason denies objecthood", () => {
    expect(refusalDeniesObjecthood(undefined)).toBe(false);
  });

  it("the two sets together cover the union exactly — no member is unclassified", () => {
    // A new refusal reason fails `tsc` at `REFUSAL_ANSWERS` (exhaustive
    // `Record`), and fails HERE if it is added to the union but not to this
    // spec's own census. Two independent places, so neither can drift alone.
    const census = [...REFUSALS_DENYING_OBJECTHOOD, ...DISPLAY_ONLY].sort();
    expect(new Set(census).size, "no reason may appear in both sets").toBe(census.length);
    expect(census).toHaveLength(13);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. ⭐⭐ THE EXTERNAL ADVERSARIAL CORPUS, WITH HAND-DERIVED EXPECTATIONS.
//
//    The quotes are `authored-node-labels.test.ts` MEASURED_HARMS verbatim —
//    ordinary British business prose written outside this lane's head by two
//    rounds of adversarial review. The `designates` column is a HAND verdict:
//    would a person reading this sentence say the writer put an objective
//    forward? It is NEVER computed from `refusalDeniesObjecthood`, which is the
//    predicate on trial.
// ─────────────────────────────────────────────────────────────────────────────
describe("the external adversarial corpus, judged by hand and replayed through the seam", () => {
  const HAND_JUDGED: readonly {
    readonly quote: string;
    /** TRUE ⇒ a person would say this sentence puts an objective forward. */
    readonly designates: boolean;
    /** Why, in one clause — the human reasoning, recorded not inferred. */
    readonly because: string;
    /**
     * ⛔ Set ONLY where the hand verdict and the shipped behaviour DISAGREE.
     * The row is still replayed and still asserted — against what the code
     * actually does — so the divergence is visible in a run instead of being
     * quietly dropped from the table. See the KNOWN-OPEN census below.
     */
    readonly knownOpen?: true;
  }[] = [
    {
      quote: "This is not about cutting costs: we want to double our delivery speed",
      designates: true,
      because: "states the objective outright after the disclaimer",
    },
    {
      quote: "We are not trying to grow headcount — the aim is to raise output per engineer",
      designates: true,
      because: "names the aim explicitly",
    },
    {
      // ⛔⛔ THE ROW THAT DISAGREES, AND IT IS IN THE TABLE FOR THAT REASON.
      // I judge this NOT a designated objective: it names a PROBLEM ("we cannot
      // ship weekly"), never a target. The shipped behaviour keeps the user's
      // badge, because the refusal is `clause_discarded` — a DISPLAY verdict.
      // An earlier draft of this suite simply omitted the row, which is the
      // "carve out the discrepancy instead of recording it" defect (trap 13b) —
      // committed inside the fix for a defect of that same class. Recorded, and
      // asserted against the CODE's behaviour, so the gap is countable.
      quote: "Cost is not the problem; the problem is that we cannot ship weekly",
      designates: false,
      because: "names a problem, not a target",
      knownOpen: true,
    },
    {
      quote: "Cut cloud spend by 25% without any change that degrades latency",
      designates: true,
      because: "an objective with a constraint attached",
    },
    {
      quote: "Raise prices — but only for new customers",
      designates: true,
      because: "an objective with a scope attached",
    },
    {
      quote: "Move the whole estate to Azure (but not the payments platform)",
      designates: true,
      because: "an objective with an exclusion attached",
    },
    {
      quote: "We must not exceed £250,000",
      designates: true,
      because: "a budget cap is an objective stated as an upper bound",
    },
    {
      quote: NEGATIVE_UPPER_BOUND,
      designates: true,
      because: "a latency target stated as an upper bound",
    },
    {
      quote: "Grow revenue, but not at the expense of margin",
      designates: true,
      because: "a compound objective with a floor",
    },
    {
      quote: "Build our own last-mile fleet — or partner with a third-party courier",
      designates: false,
      because: "an unmade choice between two courses of action",
    },
    {
      quote: "Torn between rebuilding and buying",
      designates: false,
      because: "reports being undecided; names no target",
    },
    {
      quote: "The question is whether to rebuild or buy",
      designates: false,
      because: "states the question, not the aim",
    },
    {
      quote: "Whether to enter the German market",
      designates: false,
      because: "an interrogative complement — a decision to be made",
    },
    {
      quote: "Do we rebuild the platform or buy one",
      designates: false,
      because: "a question offering two alternatives",
    },
  ];

  it("the table is the WHOLE external corpus — every MEASURED_HARMS goal quote, none pruned", () => {
    // ⛔ THE ANTI-PRUNING ASSERTION. A corpus the author may quietly shorten is
    // a corpus that will agree with the code, because the rows that disagree are
    // exactly the ones it is tempting to drop. `authored-node-labels.test.ts`
    // MEASURED_HARMS carries 14 quotes; all 14 are here.
    expect(HAND_JUDGED).toHaveLength(14);
    expect(new Set(HAND_JUDGED.map((c) => c.quote)).size, "no duplicate rows").toBe(14);
  });

  it("the corpus carries both directions — an all-one-way corpus proves nothing", () => {
    // ⭐ The contrast control for the whole section (trap 13e). If either arm
    // ever empties, every row below can pass on a predicate that stopped
    // discriminating.
    expect(HAND_JUDGED.filter((c) => c.designates).length).toBe(8);
    expect(HAND_JUDGED.filter((c) => !c.designates).length).toBe(6);
  });

  it("the KNOWN-OPEN set is EXACTLY the rows where hand and code disagree", () => {
    // ⭐ trap 22f's KNOWN-DROPPED discipline: the gap is pinned by name, so the
    // suite stays green for the RIGHT reason and REDs if the set grows OR
    // shrinks. Shrinking is a WIN that must be noticed, not absorbed.
    expect(HAND_JUDGED.filter((c) => c.knownOpen).map((c) => c.quote)).toEqual([
      "Cost is not the problem; the problem is that we cannot ship weekly",
    ]);
  });

  it.each(HAND_JUDGED)(
    "designates=$designates ($because): $quote",
    ({ quote, designates, knownOpen }) => {
      // Where hand and code AGREE, the hand verdict is the expectation. Where
      // they disagree, the row is asserted against the CODE and carries
      // `knownOpen`, which the census above pins by name. Nothing is dropped.
      const expected = knownOpen ? !designates : designates;
      const o = drive(quote, `${quote}. We could act now, or wait a quarter.`);
      expect(o.wireProvenance, quote).toBe(expected ? "from_brief" : "ai_inferred");
      expect(o.recordClass, quote).toBe(expected ? "stated" : PROJECTOR_STRUCTURAL_CLASS);
      // The user's verbatim survives in BOTH directions — that is the whole
      // point of withdrawing the designation rather than the words.
      expect(o.sourceQuote, `${quote}: the verbatim must survive either way`).toBe(quote);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE GOVERNED BASELINE — 13 real staging goal quotes, partitioned BY HAND.
// ─────────────────────────────────────────────────────────────────────────────
describe("the governed baseline: the predicate costs nothing on real data", () => {
  const goalQuotes = (): readonly { brief: string; quote: string }[] => {
    const run = JSON.parse(fs.readFileSync(GOVERNED, "utf8")).run as {
      cases: readonly { brief_id: string; graph?: { nodes?: readonly Record<string, never>[] } }[];
    };
    return run.cases.flatMap((c) =>
      (c.graph?.nodes ?? [])
        .filter((n) => (n as { kind?: string }).kind === "goal")
        .map((n) => {
          const node = n as { label?: string; provenance?: { source_quote?: string } };
          return {
            brief: c.brief_id,
            quote: (node.provenance?.source_quote ?? node.label ?? "").replace(/\s+/g, " ").trim(),
          };
        }),
    );
  };

  /**
   * ⚠ HAND-WRITTEN, NOT DERIVED. These four brief ids are the captures whose
   * goal quote a person would read as a DECISION rather than an objective —
   * every one of them is a "should we / whether to / evaluating whether to /
   * figure out" construction. Listing the ids means the partition REDs if it
   * grows OR shrinks, rather than silently tracking whatever the predicate says
   * today (the reviewer's criticism of the previous version of this section).
   */
  const BRIEFS_WHOSE_GOAL_QUOTE_DESIGNATES_NOTHING: ReadonlySet<string> = new Set([
    "01-simple-binary",
    "03-vague-underspecified",
    "06-operations-warehouse",
    "08-channel-strategy",
  ]);

  it("the corpus is readable and carries 13 goal quotes", () => {
    // The instrument, asserted non-empty before any claim rests on it.
    expect(goalQuotes()).toHaveLength(13);
  });

  it("the hand partition is 4 decisions and 9 objectives", () => {
    const decisions = goalQuotes().filter((g) =>
      BRIEFS_WHOSE_GOAL_QUOTE_DESIGNATES_NOTHING.has(g.brief),
    );
    expect(decisions).toHaveLength(4);
    expect(goalQuotes().length - decisions.length).toBe(9);
  });

  it("the 4 hand-judged decisions lose the badge; the 9 hand-judged objectives keep it", () => {
    for (const g of goalQuotes()) {
      const expected = BRIEFS_WHOSE_GOAL_QUOTE_DESIGNATES_NOTHING.has(g.brief)
        ? "ai_inferred"
        : "from_brief";
      const o = drive(g.quote, g.quote);
      expect(o.wireProvenance, `${g.brief}: ${JSON.stringify(g.quote).slice(0, 70)}`).toBe(expected);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. ⚠ WHAT THIS CHANGE DOES NOT DO — recorded in the suite, not in a comment
//    nobody runs. A gap the suite can see is honest; an invisible one is how
//    four rounds happen (trap 22f).
// ─────────────────────────────────────────────────────────────────────────────
describe("KNOWN-OPEN: only a CHOICE construction is positive evidence of non-designation", () => {
  it("a WELL-FORMED invented goal still earns from_brief — the grammar follow-up", () => {
    // The model may file any brief span as `kind: "goal"`. When that span happens
    // to be a well-formed objective the deriver authors it happily, returns no
    // reason, and this fix is blind to it. Closing this needs the grammar change
    // in `DRAFT_RECORDS_INSTRUCTION` (which offers only `stated_items` = "what
    // the user actually said" and `claims` = "what YOU are adding", then forbids
    // the goal from being a claim), plus a projector change to read the new
    // channel. Deliberately NOT this PR.
    const wellFormed = "improve customer retention";
    const brief = "Churn is up. Support tickets are up. We could add onboarding calls.";
    expect(deriveGoalObjectiveLabel(wellFormed).authored).toBe(true);
    expect(drive(wellFormed, `${brief} We want to improve customer retention.`).wireProvenance).toBe(
      "from_brief",
    );
  });

  /**
   * ⛔⛔ THE LANE'S OWN MOTIVATING CASE, AND IT IS NOT CLOSED BY THIS SLICE.
   *
   * Brief: "Churn has gone up over the last two quarters and we're not sure
   * why." The model files that whole sentence — a SYMPTOM, not an objective —
   * as the goal, and it still earns `from_brief`.
   *
   * An earlier head of this branch DID close it, via `head_disclaims`. That was
   * a COINCIDENCE, not a signal: the detector is `/(not|never|no|nor)/` and it
   * fired on the incidental "not" in "we're not sure why". The identical
   * accident struck three genuine objectives — "We must never let latency
   * exceed 200ms", "We must not exceed £250,000", "Grow revenue, but not at the
   * expense of margin" — which is the harm section 2 exists to keep closed.
   *
   * Distinguishing a symptom report from an upper-bound objective is a semantic
   * judgement about the span, and nothing in this seam can make it: the same
   * grammar follow-up above is the honest route. Pinned here so the gap is
   * visible in a run rather than remembered.
   */
  it("a SYMPTOM REPORT is not caught — the motivating case is deferred, not solved", () => {
    const symptom = "Churn has gone up over the last two quarters and we're not sure why.";
    expect(reasonOf(symptom), "refused for DISPLAY, which is not designation evidence").toBe(
      "head_disclaims",
    );
    const o = drive(symptom, symptom);
    expect(o.wireProvenance, "KNOWN-OPEN: still the user's badge").toBe("from_brief");
    expect(o.recordClass).toBe("stated");
  });

  it("a non-objective refused for a CONCISION reason still earns from_brief", () => {
    // A resource-shaped brief. It is not an objective, but the deriver refuses it
    // for LENGTH (`no_concise_form`), which is silent about objecthood — so
    // re-badging on it would take the genuine long objectives with it.
    // Two harms cannot share one window (trap 21/22b).
    const resource = "We have two engineers and a 40k budget for the quarter";
    expect(reasonOf(resource)).toBe("no_concise_form");
    expect(drive(resource, `${resource}. We could hire, or outsource.`).wireProvenance).toBe(
      "from_brief",
    );
  });

  it("a re-badged goal leaves completion.ts's destroyed-content guard domain", () => {
    // `completion.ts:444` skips `projector_structural` nodes. A goal re-badged
    // here is therefore exempt from `removed_undisclosed`. Disclosed as a
    // consequence of the class change rather than discovered later.
    const o = drive(GOVERNED_QUESTION_AS_GOAL, GOVERNED_QUESTION_BRIEF);
    expect(o.recordClass).toBe(PROJECTOR_STRUCTURAL_CLASS);
  });
});
