/**
 * ⭐⭐ A GOAL CARRIES THE USER'S PROVENANCE IFF THE USER DESIGNATED IT.
 *
 * ── THE WITNESSED DEFECT ───────────────────────────────────────────────────
 * Brief: "Churn has gone up over the last two quarters and we're not sure why."
 * Measured over 20 runs, every repeat identical:
 *
 *   goal label     = the whole brief sentence — a SYMPTOM, not an objective
 *   provenance     = `from_brief`
 *   assistant_text = I've built a first model for "Churn has gone up over the
 *                    last two quarters and we're not sure why.".
 *
 * Asserted, in quotation marks, with no disclosure that Olumi chose the span.
 * The founder's ruling: *"Bad: Olumi invents a goal and records it as
 * `from_brief`."*
 *
 * ── THE SPEC THIS SUITE IS WRITTEN AGAINST ─────────────────────────────────
 * NOT "the diagnostic brief must not say from_brief" — that is the single case
 * the lane came in on, and an invariant written to it would be a guard shaped
 * like its own bug (trap 13d). The invariant is the biconditional above, and it
 * has TWO failure directions, which are NOT symmetric in cost:
 *
 *   · stamping an Olumi-chosen goal as the user's  — the defect.
 *   · stamping a user-designated goal as Olumi's   — WORSE. It tells a user
 *     their own words were invented.
 *
 * Every case below therefore appears with its opposite-direction twin, and the
 * mutant pair at the foot proves the guards bind to the NAMED object rather
 * than to any goal at all (trap 19).
 *
 * ── ⚠ THE HONEST LIMIT, ASSERTED RATHER THAN DESCRIBED ─────────────────────
 * The deriver's refusal is SUFFICIENT, NOT NECESSARY. Two gaps stay open and
 * are pinned as such, so the suite records what this change does not do:
 *   (a) a WELL-FORMED invented goal still earns `from_brief`;
 *   (b) a non-objective refused for a CONCISION reason still earns `from_brief`.
 * Both are closed only by a grammar change in `DRAFT_RECORDS_INSTRUCTION`.
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
} from "../objective-label.js";
import { projectGraphAndOptionsToV3 } from "../../../transforms/schema-v3.js";
import { buildPostDraftNarrative } from "../../../../orchestrator-v5/coaching/post-draft-narrative.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../../..");
const GOVERNED = path.join(
  REPO_ROOT,
  "tools/graph-evaluator/governed/draft-graph-v5/baseline/run-b9389df-claude-sonnet-4-6.json",
);

const DIAGNOSTIC_BRIEF = "Churn has gone up over the last two quarters and we're not sure why.";

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
  readonly recordClass: string | undefined;
  readonly wireProvenance: string | undefined;
  readonly sourceQuote: string | undefined;
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
    recordClass: record?.provenance_class,
    wireProvenance: wireGoal?.provenance as string | undefined,
    sourceQuote: wireGoal?.source_quote as string | undefined,
    labelAuthored: wireGoal?.label_authored === true,
    disclosureQuote: record?.quote,
    assistantText: narrative.text ?? "",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 0. THE INSTRUMENT, BEFORE ANY CLAIM IS MADE WITH IT (trap 13).
//    An absence assertion is vacuous until the probe is shown seeing a presence.
// ─────────────────────────────────────────────────────────────────────────────
describe("the seam under test is reachable and discriminating", () => {
  it("projects a goal node and reaches the wire and the narrative on every case", () => {
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
    const chosen = drive(DIAGNOSTIC_BRIEF, DIAGNOSTIC_BRIEF);
    expect(designated.wireProvenance).not.toBe(chosen.wireProvenance);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE LEAD RED — the measured defect, driven end to end.
// ─────────────────────────────────────────────────────────────────────────────
describe("a goal the user never designated does not wear the user's badge", () => {
  it("the diagnostic symptom sentence is stamped as CEE's, not as the user's", () => {
    const o = drive(DIAGNOSTIC_BRIEF, DIAGNOSTIC_BRIEF);

    // The deriver's verdict — the evidence that was being discarded.
    expect(deriveGoalObjectiveLabel(DIAGNOSTIC_BRIEF).reason).toBe("head_disclaims");

    expect(o.recordClass, "record class").toBe(PROJECTOR_STRUCTURAL_CLASS);
    expect(o.wireProvenance, "wire provenance").toBe("ai_inferred");
    // Bound by IDENTITY to the exported constant, never to a copied string.
    expect(o.disclosureQuote).toBe(GOAL_SPAN_CHOSEN_BY_CEE);
  });

  it("the false quotation stops — the opener no longer asserts the symptom as the user's goal", () => {
    const o = drive(DIAGNOSTIC_BRIEF, DIAGNOSTIC_BRIEF);
    expect(o.assistantText).not.toContain(`for "${DIAGNOSTIC_BRIEF}"`);
    expect(o.assistantText).toContain("from your brief");
  });

  it("nothing the user WROTE is lost — only the DESIGNATION is withdrawn", () => {
    // The distinction the whole mechanism exists to hold: we withdraw the claim
    // that the user chose this as the objective, NOT their words.
    const o = drive(DIAGNOSTIC_BRIEF, DIAGNOSTIC_BRIEF);
    expect(o.sourceQuote, "the verbatim still reaches the inspector").toBe(DIAGNOSTIC_BRIEF);
    // `label_authored` answers a DIFFERENT question — "did we write these
    // characters?" — and we did not: the deriver refused, so the label is the
    // user's own text. Setting it here would be a second, false claim (trap 21).
    expect(o.labelAuthored, "we did not author these characters").toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. ⛔ THE OPPOSITE DIRECTION — the worse harm. Every case is a genuine user
//    objective that MUST keep its badge.
// ─────────────────────────────────────────────────────────────────────────────
describe("a goal the user DID designate keeps the user's badge", () => {
  const KEEPS_THE_BADGE: readonly {
    name: string;
    quote: string;
    brief: string;
    expectedReason: string;
  }[] = [
    {
      name: "the explicit-goal CONTROL — authored cleanly, no refusal at all",
      quote: "cut churn below 3% a month",
      brief: "Our goal is to cut churn below 3% a month. We could add onboarding calls.",
      expectedReason: "(authored)",
    },
    {
      name: "identical_to_quote — the union's own words: the quote already IS the objective",
      quote: "Reduce Churn Below Three Percent",
      brief: "Reduce Churn Below Three Percent. We could add onboarding calls.",
      expectedReason: "identical_to_quote",
    },
    {
      name: "no_concise_form — a LENGTH verdict, silent about objecthood",
      quote:
        "reduce cost per delivery below seven pounds across every regional depot before the end of the next financial year",
      brief:
        "Our objective is to reduce cost per delivery below seven pounds across every regional depot before the end of the next financial year. We could renegotiate carriers.",
      expectedReason: "no_concise_form",
    },
    {
      name: "clause_discarded — a REDUCTION verdict, silent about objecthood",
      quote: "cut delivery cost per parcel (excluding fuel surcharges)",
      brief:
        "We want to cut delivery cost per parcel (excluding fuel surcharges). We could renegotiate carriers.",
      expectedReason: "clause_discarded",
    },
  ];

  it.each(KEEPS_THE_BADGE)("$name", ({ quote, brief, expectedReason }) => {
    const derived = deriveGoalObjectiveLabel(quote);
    // PIN THE PRECONDITION IN-TEST (trap 13b): assert the case really is the
    // refusal it claims to be, so a GREEN below is provably the code's doing and
    // not the fixture quietly ceasing to reproduce the shape.
    expect(derived.authored ? "(authored)" : derived.reason).toBe(expectedReason);

    const o = drive(quote, brief);
    expect(o.recordClass, "must stay stated").toBe("stated");
    expect(o.wireProvenance, "must stay from_brief").toBe("from_brief");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE SET IS PINNED BY NAME — it may not grow or shrink in silence.
// ─────────────────────────────────────────────────────────────────────────────
describe("the objecthood-denying refusal set is pinned exactly", () => {
  it("is exactly these three, and each is a POSITIVE judgement of non-objecthood", () => {
    expect([...REFUSALS_DENYING_OBJECTHOOD].sort()).toEqual([
      "deliberation_frame",
      "head_disclaims",
      "states_alternatives",
    ]);
  });

  it("the CONCISION refusals are excluded, by name", () => {
    // These four are the opposite-harm surface. Listing them explicitly means a
    // future widening of the set REDs here rather than shipping the lie.
    for (const reason of [
      "identical_to_quote",
      "no_concise_form",
      "clause_discarded",
      "too_few_tokens",
    ] as const) {
      expect(refusalDeniesObjecthood(reason), `${reason} must NOT deny objecthood`).toBe(false);
    }
    expect(refusalDeniesObjecthood(undefined), "an authored label has no reason").toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE EXTERNAL CORPUS — 13 real staging goal quotes, not the author's head
//    (trap 22). This is the evidence the predicate's BREADTH is right.
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

  it("the corpus is readable and carries 13 goal quotes", () => {
    // The instrument, asserted non-empty before any claim rests on it.
    expect(goalQuotes()).toHaveLength(13);
  });

  it("9 author cleanly, 4 are deliberation_frame, and ZERO refuse for a concision reason", () => {
    const tally = new Map<string, number>();
    for (const g of goalQuotes()) {
      const d = deriveGoalObjectiveLabel(g.quote);
      const key = d.authored ? "AUTHORED" : (d.reason ?? "?");
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    expect(Object.fromEntries([...tally].sort())).toEqual({
      AUTHORED: 9,
      deliberation_frame: 4,
    });
  });

  it("the 4 real decisions-stated-as-goals lose the badge; the 9 real objectives keep it", () => {
    for (const g of goalQuotes()) {
      const d = deriveGoalObjectiveLabel(g.quote);
      const o = drive(g.quote, g.quote);
      const expected = refusalDeniesObjecthood(d.reason) ? "ai_inferred" : "from_brief";
      expect(o.wireProvenance, `${g.brief}: ${JSON.stringify(g.quote).slice(0, 70)}`).toBe(expected);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. ⚠ WHAT THIS CHANGE DOES NOT DO — recorded in the suite, not in a comment
//    nobody runs. A gap the suite can see is honest; an invisible one is how
//    four rounds happen (trap 22f).
// ─────────────────────────────────────────────────────────────────────────────
describe("KNOWN-OPEN: the refusal signal is sufficient, never necessary", () => {
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

  it("a non-objective refused for a CONCISION reason still earns from_brief", () => {
    // A resource-shaped brief. It is not an objective, but the deriver refuses it
    // for LENGTH (`no_concise_form`), which is silent about objecthood — so
    // re-badging on it would take cases 2's genuine long objectives with it.
    // Two harms cannot share one window (trap 21/22b).
    const resource = "We have two engineers and a 40k budget for the quarter";
    expect(deriveGoalObjectiveLabel(resource).reason).toBe("no_concise_form");
    expect(drive(resource, `${resource}. We could hire, or outsource.`).wireProvenance).toBe(
      "from_brief",
    );
  });

  it("a re-badged goal leaves completion.ts's destroyed-content guard domain", () => {
    // `completion.ts:444` skips `projector_structural` nodes. A goal re-badged
    // here is therefore exempt from `removed_undisclosed`. Disclosed as a
    // consequence of the class change rather than discovered later.
    const o = drive(DIAGNOSTIC_BRIEF, DIAGNOSTIC_BRIEF);
    expect(o.recordClass).toBe(PROJECTOR_STRUCTURAL_CLASS);
  });
});
