/**
 * A GOAL CEE INVENTED MUST NOT WEAR THE USER'S BADGE.
 *
 * THE DEFECT, derived at the bytes and pinned here by execution.
 *
 * When the drafter emits no goal, `ensureGoalNode`
 * (`src/cee/structure/goal-inference.ts`) mints one. Its regex limb lifts a
 * substring of the brief (`inferGoalFromBrief`), capitalises it, and — before
 * this fix — minted the node with NO provenance at all.
 *
 * That absence is not neutral. `projectNodeProvenance`
 * (`transforms/schema-v3.ts:1158`) treats a node with no TYPED record as
 * legacy, and falls through to label containment at `:1193`. `goal` is in
 * `LABEL_BOUND_PROVENANCE_KINDS` (`:122-127`), the minted label carries no
 * value and ≥2 tokens, and the label IS a case-folded substring of the brief
 * BY CONSTRUCTION — the regex lifted it from there. So `bindOptionLabelToBrief`
 * returns `verified` and the node is stamped `provenance: "from_brief"`.
 *
 * The user's badge, on a goal the user never designated and the model never
 * authored. That module's own header names this exact hazard: *"an inferred
 * label that happens to repeat brief text is falsely re-attributed to the
 * user"* (`schema-v3.ts:1153-1155`). The typed path exists to prevent it; the
 * minted goal simply never took it.
 *
 * SECOND CHANNEL, same lie, more visible. `buildConfirmSentence`
 * (`post-draft-narrative.ts`) renders the goal label inside QUOTATION MARKS —
 * `I've built a first decision model for "<label>".` — and that function's own
 * doctrine is that *"Quotation marks promise the user 'these are your
 * words'."* `findGoalLabel` bound on `kind === 'goal'` alone, so it could not
 * tell a user-authored goal from a CEE-minted one, and the placeholder
 * `DEFAULT_GOAL_LABEL` ("Achieve the best outcome for this decision", 42 chars,
 * comfortably inside the 80-char budget) was quoted back at the user as
 * theirs. Invention with a citation.
 *
 * WHY NOT WITHHOLD THE GOAL INSTEAD. The enforcement gate fails closed on a
 * goalless graph: `MISSING_BRIDGE` / `NO_PATH_TO_GOAL` and
 * `applyDeterministicEnforcement` throws the whole draft away
 * (`repair/terminal-bridge.ts` header, measured S3 7/7). Withholding trades a
 * dishonest goal for no draft at all, so honest attribution is the fix and the
 * node stays.
 *
 * THE OPPOSITE-DIRECTION TWIN IS LOAD-BEARING (standing brief §3): a goal the
 * USER genuinely stated must still be stamped as theirs. Both directions are
 * asserted below, because a suppression wide enough to catch the invented goal
 * would otherwise silently strip the badge off a real one.
 */

import { describe, it, expect } from "vitest";
import { ensureGoalNode, DEFAULT_GOAL_LABEL } from "../../src/cee/structure/goal-inference.js";
import { projectGraphAndOptionsToV3 } from "../../src/cee/transforms/schema-v3.js";
import { buildPostDraftNarrative } from "../../src/orchestrator-v5/coaching/post-draft-narrative.js";
import type { GraphV3T } from "../../src/orchestrator/types.js";

/** A goalless draft: decision + option + outcome, the shape the drafter emits. */
function goallessGraph(): any {
  return {
    nodes: [
      { id: "dec_1", kind: "decision", label: "Growth approach" },
      { id: "opt_1", kind: "option", label: "Cut paid acquisition" },
      { id: "out_1", kind: "outcome", label: "Monthly burn" },
    ],
    edges: [{ from: "opt_1", to: "out_1", strength_mean: 0.4, strength_std: 0.1, belief_exists: 0.9 }],
  };
}

function goalNodeOf(projectedNodes: readonly any[]): any {
  const goals = projectedNodes.filter((n) => n.kind === "goal");
  expect(goals, "exactly one goal node must be projected").toHaveLength(1);
  return goals[0];
}

function makeGraph(nodes: unknown[]): GraphV3T {
  return { nodes, edges: [] } as unknown as GraphV3T;
}

function openingLine(nodes: unknown[]): string {
  const result = buildPostDraftNarrative({
    graph: makeGraph(nodes),
    analysisReady: { status: "ready" },
  } as any);
  expect(result.text.length, "narrative must be non-empty").toBeGreaterThan(0);
  return result.text.split("\n")[0] ?? "";
}

const CONFIRM_QUOTED = /^I've built a first decision model for "([^"]*)"\.$/;
const CONFIRM_FROM_BRIEF = "I've built a first decision model from your brief.";

describe("a CEE-minted goal must not be attributed to the user", () => {
  // ── INSTRUMENT CONTROL ────────────────────────────────────────────────────
  // Before any absence claim about `from_brief`, prove this harness can SEE a
  // `from_brief` verdict at all. Without it, every assertion below could pass
  // because the projection never stamps anything (trap 13: an absence probe
  // needs a positive control).
  it("CONTROL: the projection does stamp `from_brief` when a label is genuinely the user's", () => {
    const brief =
      "Our objective is to reduce total landed cost per unit. We could renegotiate freight or consolidate suppliers.";
    const graph = {
      nodes: [
        { id: "goal_stated", kind: "goal", label: "Reduce total landed cost per unit" },
        { id: "opt_1", kind: "option", label: "Renegotiate freight" },
      ],
      edges: [],
    } as any;

    const projected = projectGraphAndOptionsToV3(graph, { brief });
    const goal = goalNodeOf(projected.graph.nodes as any[]);

    expect(
      goal.provenance,
      "positive control: a label the user wrote must earn `from_brief`, else this harness is blind",
    ).toBe("from_brief");
  });

  // ── H1: THE WIRE BADGE ────────────────────────────────────────────────────
  it("does NOT stamp `from_brief` on a goal the regex limb lifted out of the brief", () => {
    // "We want to cut paid acquisition" — the `want to` pattern lifts an
    // OPTION and calls it the goal. The words are in the brief, which is
    // exactly what made the containment check certify them.
    const brief =
      "We want to cut paid acquisition. Options are raising prices, cutting paid acquisition, or doing nothing.";

    const result = ensureGoalNode(goallessGraph(), brief);
    expect(result.goalAdded, "precondition: a goal must have been minted").toBe(true);

    const projected = projectGraphAndOptionsToV3(result.graph as any, { brief });
    const goal = goalNodeOf(projected.graph.nodes as any[]);

    // PIN THE PRECONDITION IN-TEST (trap 13b): the label really is brief text,
    // so this case genuinely exercises the containment path it must not reach.
    expect(
      brief.toLowerCase(),
      "precondition: the minted label must be a substring of the brief, or this case proves nothing",
    ).toContain(String(goal.label).toLowerCase());

    expect(
      goal.provenance,
      "a goal CEE chose must never carry the user's badge",
    ).not.toBe("from_brief");
    expect(goal.provenance).toBe("ai_inferred");
    expect(goal.label_authored, "the minted label is CEE's, and must say so").toBe(true);
  });

  it("does NOT stamp `from_brief` on the placeholder goal", () => {
    const brief = "Enterprise push, or double down on self-serve?";
    const result = ensureGoalNode(goallessGraph(), brief);

    expect(result.inferredFrom).toBe("placeholder");
    const projected = projectGraphAndOptionsToV3(result.graph as any, { brief });
    const goal = goalNodeOf(projected.graph.nodes as any[]);

    expect(goal.label).toBe(DEFAULT_GOAL_LABEL);
    expect(goal.provenance).toBe("ai_inferred");
    expect(goal.label_authored).toBe(true);
  });

  // ── THE OPPOSITE-DIRECTION TWIN ───────────────────────────────────────────
  // A goal the user genuinely stated, supplied through `context.goals`, is
  // THEIR text. The fix must not strip its badge — that is the opposite harm,
  // and it is the one a too-wide suppression would cause.
  it("TWIN: a goal the user genuinely stated still earns `from_brief` and is NOT marked authored", () => {
    const brief =
      "Our objective is to reach profitability without raising headcount. We could cut paid acquisition or raise prices.";
    const stated = "Reach profitability without raising headcount";

    const result = ensureGoalNode(goallessGraph(), brief, stated);
    expect(result.inferredFrom, "the explicit limb must have been taken").toBe("explicit");

    const projected = projectGraphAndOptionsToV3(result.graph as any, { brief });
    const goal = goalNodeOf(projected.graph.nodes as any[]);

    expect(goal.label).toBe(stated);
    expect(
      goal.provenance,
      "the user stated this goal — stripping its badge is the opposite harm",
    ).toBe("from_brief");
    expect(
      goal.label_authored,
      "the user authored this label; CEE did not",
    ).not.toBe(true);
  });

  // ── H2: THE QUOTATION ─────────────────────────────────────────────────────
  it("does NOT quote a CEE-minted goal label back at the user as their words", () => {
    const line = openingLine([
      { id: "goal_inferred", kind: "goal", label: DEFAULT_GOAL_LABEL, label_authored: true },
      { id: "opt_1", kind: "option", label: "Ship it" },
    ]);

    expect(
      line,
      `the placeholder goal must not appear in quotation marks — got: ${line}`,
    ).not.toMatch(CONFIRM_QUOTED);
    expect(line).toBe(CONFIRM_FROM_BRIEF);
  });

  it("TWIN: a goal the user authored IS still quoted back to them", () => {
    const stated = "Reach profitability without raising headcount";
    const line = openingLine([
      { id: "goal_stated", kind: "goal", label: stated },
      { id: "opt_1", kind: "option", label: "Ship it" },
    ]);

    const match = CONFIRM_QUOTED.exec(line);
    expect(match, `a user-authored goal must still be quoted — got: ${line}`).not.toBeNull();
    expect(match?.[1]).toBe(stated);
  });
});
