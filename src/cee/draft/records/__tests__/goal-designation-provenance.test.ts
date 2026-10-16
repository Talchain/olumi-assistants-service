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
import { describe,expect,it } from "vitest";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
deliberationFrameOpensTheSpan,
deriveGoalObjectiveLabel,
FRAME_EVIDENCE,
refusalDeniesObjecthood,
REFUSALS_DENYING_OBJECTHOOD,
type AuthoredLabelRefusal,
} from "../objective-label.js";


const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../../..");
const GOVERNED = path.join(
  REPO_ROOT,
  "tools/graph-evaluator/governed/draft-graph-v5/baseline/run-b9389df-claude-sonnet-4-6.json",
);

/** The real governed capture the lead RED is taken from (`01-simple-binary`). */



/** The reviewer's counterexample, verbatim from `authored-node-labels.test.ts`. */
const NEGATIVE_UPPER_BOUND = "We must never let latency exceed 200ms";

/** Its meaning-preserving positive twin — same objective, no negation token. */



/** The two options are constant across cases so the goal is the only variable. */




/** Drive the WHOLE seam: records → projector → V3 wire → assistant narrative. */


/** The reason as a comparable string, so `(authored)` is a first-class value. */
function reasonOf(quote: string): string {
  const derived = deriveGoalObjectiveLabel(quote);
  return derived.authored ? "(authored)" : (derived.reason ?? "(no reason)");
}

// ─────────────────────────────────────────────────────────────────────────────
// 0. THE INSTRUMENT, BEFORE ANY CLAIM IS MADE WITH IT (trap 13).
//    An absence assertion is vacuous until the probe is shown seeing a presence.
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// 1. THE LEAD RED — the measured defect, on a real governed capture, driven
//    end to end.
// ─────────────────────────────────────────────────────────────────────────────


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


// ─────────────────────────────────────────────────────────────────────────────
// 2. ⛔⛔ THE INTRODUCED HARM, AND THE REASON THIS FILE EXISTS IN ITS PRESENT
//    FORM. An explicitly designated objective KEEPS its attribution and its
//    quotation, whatever negation its wording happens to contain.
//
//    Measured at `d42f121c`: every case in this section returned
//    `projector_structural` / `ai_inferred` / "the brief designates no
//    objective". Every one of them is a goal the user plainly designated.
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// 3. THE TWO-QUESTION TABLE IS PINNED, MEMBER BY MEMBER.
// ─────────────────────────────────────────────────────────────────────────────
describe("the objecthood-denying refusal set is pinned exactly", () => {
  it("is exactly the ONE closed-list construction test, and nothing else", () => {
    // ⛔ TWO reasons have now been demoted out of this set, one review apart —
    // `head_disclaims` (a lexical negation test) and `states_alternatives` (a
    // bare `/(^|\s)or(\s|$)/`). Both read like designation verdicts and neither
    // is one. `deliberation_frame` remains because its predicate is a genuinely
    // CLOSED list of 32 explicit constructions — a property that was read at the
    // bytes, not asserted in a comment.
    expect([...REFUSALS_DENYING_OBJECTHOOD].sort()).toEqual(["deliberation_frame"]);
  });

  /**
   * ⭐ EVERY OTHER MEMBER OF THE UNION, BY NAME. This is the KNOWN-DROPPED
   * discipline: the list may not grow in silence, and `head_disclaims` in
   * particular is pinned OUT with the reason attached, because it is the one
   * that reads like a designation verdict and is not.
   */
  const DISPLAY_ONLY: readonly AuthoredLabelRefusal[] = [
    "empty",
    "states_alternatives",
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
      // ⛔ KNOWN-OPEN since `states_alternatives` was demoted: a genuine unmade
      // choice now KEEPS the badge. A GAP, and today's shipped staging
      // behaviour — not a new lie. The price of not telling three real
      // objectives they were invented. See the disjunction corpus below.
      quote: "Build our own last-mile fleet — or partner with a third-party courier",
      designates: false,
      because: "an unmade choice between two courses of action",
      knownOpen: true,
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

  it("the table is the WHOLE external corpus — DERIVED from the source, not counted by hand", () => {
    // ⛔ THE ANTI-PRUNING ASSERTION, and it must not itself be a hand-maintained
    // mirror (trap 12). `toHaveLength(14)` was one: it could not notice
    // MEASURED_HARMS GROWING, only this table shrinking. The quote set is now
    // read out of the sibling spec's source, so a row added there REDs here.
    const source = fs.readFileSync(
      path.join(HERE, "authored-node-labels.test.ts"),
      "utf8",
    );
    const table = source.slice(
      source.indexOf("const MEASURED_HARMS"),
      source.indexOf("it.each(MEASURED_HARMS)"),
    );
    // Rows are `["harm", "quote", "reason"],` — take the MIDDLE literal.
    const upstream = [...table.matchAll(/\[\s*"(?:[^"\\]|\\.)*",\s*"((?:[^"\\]|\\.)*)"/g)].map(
      (m) => m[1]!.replace(/\\"/g, '"'),
    );
    // POSITIVE CONTROL: a regex that silently matched nothing would make this
    // assertion vacuous in the most convincing way possible (trap 13).
    expect(upstream.length, "extraction must not be blind").toBeGreaterThan(10);
    expect([...HAND_JUDGED].map((c) => c.quote).sort()).toEqual([...upstream].sort());
    expect(new Set(HAND_JUDGED.map((c) => c.quote)).size, "no duplicate rows").toBe(
      HAND_JUDGED.length,
    );
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
    expect(HAND_JUDGED.filter((c) => c.knownOpen).map((c) => c.quote).sort()).toEqual([
      "Build our own last-mile fleet — or partner with a third-party courier",
      "Cost is not the problem; the problem is that we cannot ship weekly",
    ]);
  });


});

// ─────────────────────────────────────────────────────────────────────────────
// 4b. ⛔⛔ THE DISJUNCTION AXIS — the corpus the section above STRUCTURALLY
//     COULD NOT PROVIDE, and the reason a second regression shipped.
//
//     `states_alternatives` keys on `/(^|\s)or(\s|$)/`. Of §4's 8 designating
//     rows, **0** contain a free-standing `or`; 3 of its 6 non-designating rows
//     do. A corpus that is one-way on the exact token a predicate keys on cannot
//     falsify that predicate, however many rows it has (trap 22b). These quotes
//     come from the independent reviewer, i.e. outside this lane's head, and the
//     contrast control below pins BOTH directions on this axis specifically so
//     it can never go one-way again.
// ─────────────────────────────────────────────────────────────────────────────
describe("a free-standing `or` is not evidence of an unmade choice", () => {
  const DISJUNCTIONS: readonly {
    readonly name: string;
    readonly quote: string;
    /** HAND verdict: would a person say this puts an objective forward? */
    readonly designates: boolean;
  }[] = [
    { name: "a COMPARATIVE", quote: "Reach 99.9% uptime or better", designates: true },
    {
      name: "a FALLBACK",
      quote: "Increase margin, or failing that, hold it flat",
      designates: true,
    },
    { name: "a SCOPE", quote: "grow in Germany or France", designates: true },
    {
      name: "a genuine UNMADE CHOICE — the direction this axis must still contain",
      quote: "Build our own last-mile fleet — or partner with a third-party courier",
      designates: false,
    },
  ];

  it("the axis carries BOTH directions — the control that stops it going one-way again", () => {
    // ⭐ Without this the section could silently become all-designating, which is
    // the mirror image of the blindness it was written to fix.
    expect(DISJUNCTIONS.filter((c) => c.designates).length).toBeGreaterThan(0);
    expect(DISJUNCTIONS.filter((c) => !c.designates).length).toBeGreaterThan(0);
    // Every row must actually exercise the token, or this proves nothing.
    for (const c of DISJUNCTIONS) {
      expect(/(^|\s)or(\s|$)/i.test(c.quote), `${c.quote} must contain a free-standing "or"`).toBe(
        true,
      );
      expect(reasonOf(c.quote), `${c.quote}: precondition — the refusal under test`).toBe(
        "states_alternatives",
      );
    }
  });




});

// ─────────────────────────────────────────────────────────────────────────────
// 4c. ⛔⛔⛔ CLOSED IS NOT ANCHORED — the fourth member of this defect family,
//     and the axis §4 was *also* one-way on.
//
//     `DELIBERATION_FRAMES` is genuinely a closed list of 32 constructions.
//     `findDeliberationFrame` is `lower.indexOf(frame)` — UNANCHORED — so a
//     frame token appearing ANYWHERE carried the authorship verdict.
//
//     ⚠ MEASURED ONE-WAYNESS, the same shape as the `or` axis one round earlier:
//     of §4's designating rows, **0** contain any frame token; of its
//     non-designating rows, **all** do. A corpus built from the cases a
//     predicate was written for cannot falsify that predicate.
//
//     The anchor is applied to the AUTHORSHIP question only —
//     `findDeliberationFrame` has three callers and the decision node SLICES at
//     `frame.index`, so anchoring the shared function would stop it naming a
//     decision at all (trap 21 again, this time avoided).
// ─────────────────────────────────────────────────────────────────────────────
describe("a deliberation frame the span merely CONTAINS is ordinary English", () => {
  /** Reviewer-sourced. Every one is a plainly designated objective. */
  const MERELY_CONTAINS: readonly (readonly [string, string])[] = [
    ["`we could` in a PURPOSE CLAUSE", "Cut churn to 3% so we could reinvest in R&D"],
    ["`working out at` = AMOUNTING TO", "Cut cost per unit, working out at under £4"],
    ["`choosing` as a GERUND", "Improve onboarding by choosing a simpler default plan"],
    ["`deciding on` as a NOUN COMPLEMENT", "Speed up deciding on new suppliers"],
    ["`figuring out` inside the OBJECT", "Reduce the time we spend figuring out payroll"],
    ["`work out` in a SUBORDINATE clause", "Grow revenue while we work out the pricing model"],
  ];

  it("every row really does contain a frame token — or this section proves nothing", () => {
    // ⭐ THE PRECONDITION FOR THE WHOLE SECTION (trap 13b). These rows exist to
    // exercise the frame list; if they stopped containing frame tokens they
    // would pass while testing nothing at all.
    for (const [, quote] of MERELY_CONTAINS) {
      expect(reasonOf(quote), `${quote}: must still be refused for DISPLAY`).toBe(
        "deliberation_frame",
      );
      expect(
        deliberationFrameOpensTheSpan(quote),
        `${quote}: the frame must NOT open the span`,
      ).toBe(false);
    }
  });





  /**
   * ⚠⚠ KNOWN-OPEN, AND DELIBERATELY NOT AN ENUMERATION.
   *
   * The residual is a CLASS — a frame token used sentence-initially in a
   * NON-deliberative sense — not a fixed set of frames. Measured: at least five
   * frames produce it (`considering `, `figure out `, `figuring out `,
   * `work out `, `working out `, `deciding `), which is more than the three the
   * review predicted. **Pinning "exactly three" would be a census claiming a
   * completeness it does not have** — the hand-maintained-mirror defect this
   * suite exists to avoid — so the representative members are pinned and the
   * class is named.
   *
   * ⛔ THE STOP CONDITION IS RECORDED HERE ON PURPOSE: four rounds have each
   * found a different member of one family (a lexical negation test, a bare
   * `or`, an unanchored frame). Separating a preposition from a deliberation is
   * a semantic judgement about the span, and a fifth predicate tweak is sunk
   * cost wearing engineering clothes. The route is the grammar follow-on.
   */
  /**
   * ⚠⚠ WIDENED TO THE MEASURED SET. This table carried FOUR rows while the
   * source comment beside it claimed "three sentence-INITIAL uses remain" — and
   * an independent round-4 review measured THIRTEEN frames producing a false
   * withdrawal sentence-initially. **A KNOWN-OPEN pin that understates its own
   * class is the hand-maintained mirror this suite exists to prevent**, so every
   * row below with a `reviewer` tag is that review's corpus VERBATIM, and the
   * `spec` rows are this file's original four. Nothing here was written by the
   * lane that authored the fix — which is the point (trap 22).
   *
   * Each row is asserted against WHAT THE CODE DOES, so the gap stays countable
   * and a future fix REDs here rather than passing unnoticed.
   */
  const SENTENCE_INITIAL_BUT_NOT_DELIBERATIVE: readonly (readonly [string, string])[] = [
    // ── this spec's original four ──────────────────────────────────────────
    ["`considering` as a PREPOSITION", "Considering the runway, reach break-even by Q3"],
    ["`considering` as a PREPOSITION", "Considering our size, hold headcount flat"],
    ["`working out` = AMOUNTING TO", "Working out at under £4, hold cost per unit"],
    ["`deciding` as an ADJECTIVE", "Deciding factors aside, grow revenue 20%"],
    // ── the round-4 reviewer's ARM A, verbatim ─────────────────────────────
    ["reviewer `considering` PREPOSITION", "Considering the runway, reach break-even by Q3."],
    [
      "reviewer `considering` PREPOSITION",
      "Considering our constraints, hold spend under £250,000.",
    ],
    ["reviewer `working out` = AMOUNTING TO", "Working out at under £4 per unit is the target."],
    ["reviewer `work out` IMPERATIVE", "Work out cheaper unit economics before the Series B."],
    [
      "reviewer `choosing a` GERUND SUBJECT",
      "Choosing a simpler default plan should lift activation to 60%.",
    ],
    ["reviewer `choosing an` GERUND SUBJECT", "Choosing an annual billing default lifts LTV by 15%."],
    ["reviewer `deciding` ADJECTIVE", "Deciding factors are cost and speed; cut cost per seat to £9."],
    ["reviewer `our options are` PREAMBLE", "Our options are limited, so cut burn to £120k per month."],
    ["reviewer `the options are` PREAMBLE", "The options are already chosen; hold CAC under £400."],
    ["reviewer `we could` PERCEPTION VERB", "We could see churn rising, so cut it to 3% this year."],
  ];

  /**
   * ⭐ THE CENSUS. Without it the table above can be quietly pruned back to the
   * comfortable four, which is exactly how the understated pin survived a round
   * of review. REDs if the set grows OR shrinks.
   */
  it("the KNOWN-OPEN pin is exactly the 14 measured rows", () => {
    expect(SENTENCE_INITIAL_BUT_NOT_DELIBERATIVE).toHaveLength(14);
    expect(new Set(SENTENCE_INITIAL_BUT_NOT_DELIBERATIVE.map(([, q]) => q)).size).toBe(14);
  });

  /**
   * ⭐⭐ THE CONTRAST CONTROL, and it is what makes the table above evidence
   * rather than a list of strings the predicate happens to dislike. Same
   * objective, frame token removed: the badge must be KEPT. Without this arm the
   * table is one-way and structurally incapable of showing that the predicate
   * keys on the TOKEN rather than on objecthood (trap 22b / 13e).
   */





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


});

// ─────────────────────────────────────────────────────────────────────────────
// 6. ⚠ WHAT THIS CHANGE DOES NOT DO — recorded in the suite, not in a comment
//    nobody runs. A gap the suite can see is honest; an invisible one is how
//    four rounds happen (trap 22f).
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// 7. ⭐⭐ THE FRAME CLASSIFICATION — "closed" and "classified" are different
//    claims about a list, and only the second licenses treating a match as
//    evidence. Four rounds verified the first and none checked the second.
// ─────────────────────────────────────────────────────────────────────────────
describe("FRAME_EVIDENCE: every deliberation frame is classified, not merely counted", () => {
  /**
   * ⭐ DERIVED, NOT MIRRORED. The frame list is read out of the SOURCE, so this
   * census cannot drift from it — and it REDs if a frame is added, removed or
   * renamed without being classified. The `tsc` exhaustiveness of
   * `Record<DeliberationFrame, …>` is the compile-time half; this is the half
   * that notices the list itself moved.
   */
  const framesDeclaredInSource = (): readonly string[] => {
    const src = fs.readFileSync(path.join(HERE, "../objective-label.ts"), "utf8");
    const start = src.indexOf("const DELIBERATION_FRAMES");
    const end = src.indexOf("] as const;", start);
    // The instrument, asserted before any claim rests on it (trap 13).
    expect(start, "DELIBERATION_FRAMES is findable in source").toBeGreaterThan(-1);
    expect(end, "the array terminator is findable").toBeGreaterThan(start);
    return [...src.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  };

  it("the classification covers exactly the declared frames — no more, no fewer", () => {
    const declared = framesDeclaredInSource();
    expect(declared.length, "positive control: the extractor found frames").toBeGreaterThan(0);
    expect([...declared].sort()).toEqual(Object.keys(FRAME_EVIDENCE).sort());
  });

  /**
   * ⛔ THE MEASUREMENT THE ADMISSION RESTS ON, PINNED. `REFUSAL_ANSWERS` admits
   * `deliberation_frame` to the DESIGNATION question on the claim that every
   * member is unambiguous deliberation English. That is true of the closed-class
   * members and FALSE of the open-class ones. Pinning the split means the
   * undischarged admission is visible in a suite rather than in a comment.
   */
  it("the split is 18 closed-class / 14 open-class", () => {
    const values = Object.values(FRAME_EVIDENCE);
    expect(values.filter((v) => v === "closed_class")).toHaveLength(18);
    expect(values.filter((v) => v === "open_class")).toHaveLength(14);
  });

  /**
   * ⭐ WHAT THE CLASSIFICATION EXPLAINS — and, just as important, WHAT IT DOES
   * NOT. Of the 13 frames the round-4 review measured as producing a false
   * withdrawal sentence-initially, 12 are open-class. `do we ` is closed-class
   * and was still reported. **The residual is asserted, not rounded away**: a
   * classification that explained all 13 would license wiring it into the
   * predicate, and this one does not.
   */
  const MEASURED_FALSE_WITHDRAWAL_FRAMES: readonly string[] = [
    "considering ",
    "working out ",
    "work out ",
    "choosing a ",
    "choosing an ",
    "deciding ",
    "deciding on ",
    "we could ",
    "figure out ",
    "figuring out ",
    "do we ",
    "our options are ",
    "the options are ",
  ];

  it("12 of the 13 measured false-withdrawal frames are open-class", () => {
    const openClass = MEASURED_FALSE_WITHDRAWAL_FRAMES.filter(
      (f) => FRAME_EVIDENCE[f as keyof typeof FRAME_EVIDENCE] === "open_class",
    );
    expect(MEASURED_FALSE_WITHDRAWAL_FRAMES).toHaveLength(13);
    expect(openClass).toHaveLength(12);
  });

  it("the ONE unexplained residual is `do we ` — asserted by name, not rounded away", () => {
    const unexplained = MEASURED_FALSE_WITHDRAWAL_FRAMES.filter(
      (f) => FRAME_EVIDENCE[f as keyof typeof FRAME_EVIDENCE] === "closed_class",
    );
    expect(unexplained).toEqual(["do we "]);
  });

  /**
   * ⚠ THE PRICE OF THE PATCH THAT WAS RUN AND REFUSED, pinned so nobody
   * re-proposes it as free. Demoting the open-class members would fix all 13
   * false withdrawals AND cost the one governed closure carried by `figure out `
   * ("figure out our hiring strategy for next quarter", brief
   * `03-vague-underspecified`). That is why this record is not wired into the
   * predicate.
   */
  it("the governed closure an open-class demotion would cost is `figure out `", () => {
    expect(FRAME_EVIDENCE["figure out "]).toBe("open_class");
    expect(deliberationFrameOpensTheSpan("figure out our hiring strategy for next quarter")).toBe(
      true,
    );
  });
});
