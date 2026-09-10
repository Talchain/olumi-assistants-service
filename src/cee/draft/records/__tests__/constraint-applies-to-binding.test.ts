/**
 * ⭐⭐ A STATED LIMIT BINDS TO THE NODE THE MODEL SAYS IT LIMITS.
 *
 * ── THE DEFECT, WIRE-WITNESSED ────────────────────────────────────────────
 * A user writes "…keeping monthly churn under 4%". The drafting model labels
 * the relevant node **"Subscriber Churn Rate"** — so it plainly knows the two
 * are the same quantity. A regex then minted the target id `fac_monthly_churn`,
 * and a string-containment matcher asked whether `"subscriber_churn_rate"`
 * contains `"monthly_churn"`. It does not. The limit was dropped and the user
 * was told *"I could not match it to anything on the model."*
 * Live evidence: `cee.compound_goal.target_no_match` on `fac_monthly_churn`,
 * `fac_keeping_monthly_churn` and `fac_unspecified`, then
 * `target_unmatched_asked` with `unbindable_count: 1`, reproduced across
 * requests. **The same brief bound once and dropped twice in one session — the
 * only variable was how the model happened to word the label.**
 *
 * ⭐ THE CHARACTERISATION THAT DECIDED THE FIX: the binder worked when the
 * drafter ECHOED the user's phrasing and failed when it IMPROVED on it. The
 * root cause is therefore not the matcher's quality — it is that the record
 * grammar had fields for a limit's value, unit, direction and source quote and
 * NO FIELD FOR WHAT IT APPLIES TO. The model had nowhere to write down what it
 * already knew.
 *
 * ⛔ WHAT THIS FILE DOES NOT TEST, BECAUSE IT MUST NEVER BE BUILT. Three better
 * string matchers (alias-to-labels, head-noun, all-tokens) were built and
 * adversarially tested and EVERY ONE wrong-binds somewhere; the best-looking one
 * passed only because its stop-word list was written while looking at the
 * answer. Widening `CONSTRAINT_ALIASES` is worse still — it matches node IDS
 * while this projector mints CONTENT HASHES, so it can never fire. Both rulings
 * are settled. Nothing below compares two strings.
 *
 * ── THE CORPUS IS THREE CASES, NOT FIFTY ──────────────────────────────────
 * A large corpus here would measure the projector, which is already covered.
 * What needed proving is exactly three things, and each has a NAMED test below:
 *   1. THE FAILURE binds.
 *   2. A case that works today is BYTE-IDENTICAL (additivity).
 *   3. AN AMBIGUOUS case REFUSES and falls through to the existing ask.
 *
 * The rest of the file is the three SAFETY CONDITIONS, each with the twin that
 * proves the gate DISCRIMINATES rather than merely fires (standing brief §3) —
 * because a gate that refuses everything would pass a one-sided corpus just as
 * happily as a correct one.
 *
 * ⚠ ASSERTIONS BIND BY IDENTITY — minted node id, exact reason, exact operator —
 * never by a value predicate another row could satisfy (trap 19). Node ids are
 * `sha8(kind, quote)` content hashes, so every expected id is derived IN-TEST
 * from the projection rather than written as a literal that could drift.
 */
import { describe, it, expect } from "vitest";

import { projectDraftRecords } from "../seam.js";
import { enumerateCompletionAsk } from "../completion.js";
import type { RecordProjection } from "../projector.js";
import { MINTABLE_TARGET_KINDS } from "../../../compound-goal/mintable-target-kinds.js";

const BRIEF =
  "Should we invest in onboarding or in win-back campaigns? " +
  "We need to grow net revenue while keeping monthly churn under 4%.";

const project = (records: unknown, brief: string = BRIEF): RecordProjection => {
  const r = projectDraftRecords(records, brief);
  if (!r.ok) throw new Error(`seam refused: ${r.reason}: ${r.detail}`);
  return r.projection;
};

/**
 * The wire shape, exactly as the model emits it.
 *
 * ⚠ THE `causal_link` FROM THE CONSTRAINT TO THE GOAL IS LOAD-BEARING IN THE
 * FIXTURE, and finding out why cost a measurement. An unconnected `constraint`
 * node is PRUNED by the connectivity pass with `unconnected_to_goal` — so a
 * stated limit that the model does not connect reaches the graph NOWHERE, with
 * or without this change. Without that link the tests below would be measuring
 * the prune rather than the binding, and "the constraint keeps its own node"
 * would read as false for a reason that has nothing to do with references.
 * The draft instruction already tells the model to draw exactly this link
 * ("If a stated figure or constraint bears on the goal, say so with a
 * `causal_link` from it to the goal"), so the fixture is what a compliant draft
 * looks like, not a convenience.
 */
const churnRecords = (constraintExtras: Record<string, unknown>, opts: { linkToGoal?: boolean } = {}) => ({
  stated_items: [
    { kind: "goal", source_quote: "grow net revenue", role: "target" },
    {
      kind: "constraint",
      source_quote: "keeping monthly churn under 4%",
      value: 4,
      unit: "%",
      direction: "ceiling",
      ...constraintExtras,
    },
  ],
  claims: [
    // claims[0] — the model's OWN name for the quantity. Note it shares NO
    // usable token with "monthly churn": this is the pair the string matcher
    // could not join, and the whole reason the reference exists.
    { claim_kind: "factor", label: "Subscriber Churn Rate" },
    ...(opts.linkToGoal === true
      ? [{ claim_kind: "causal_link", label: "the churn limit bears on revenue", from_stated: 1, to_stated: 0, effect: "negative" }]
      : [{ claim_kind: "causal_link", label: "churn erodes revenue", from_claim: 0, to_stated: 0, effect: "negative" }]),
  ],
});

/**
 * ⭐⭐ THE ADDITIVITY COMPARATOR — the strongest form of "byte-identical to
 * today", and the one that cannot decay.
 *
 * Every REFUSAL below asserts that the projection is indistinguishable from the
 * projection of THE SAME RECORD SET WITH THE REFERENCE REMOVED, except for the
 * new disclosure itself. That is the actual promise this change makes, stated
 * directly, rather than a proxy for it — and because the comparison is taken
 * against a projection computed IN THE SAME RUN it can never decay into a
 * tautology the way a remembered snapshot would (trap 12b).
 */
const NEW_REFUSAL_REASONS = new Set([
  "constraint_target_not_measurable",
  "constraint_target_unit_mismatch",
  "ambiguous_ref",
  "ref_out_of_range",
]);

const withoutNewRefusals = (p: RecordProjection) =>
  p.dropped.filter((d) => !(d.claim_kind === "stated_item" && NEW_REFUSAL_REASONS.has(d.reason)));

function expectIndistinguishableFromNoReference(
  withRef: RecordProjection,
  withoutRef: RecordProjection,
): void {
  expect(withRef.graph).toEqual(withoutRef.graph);
  expect(withRef.provenance).toEqual(withoutRef.provenance);
  expect(withoutNewRefusals(withRef)).toEqual(withoutNewRefusals(withoutRef));
  expect(withRef.goalConstraints).toHaveLength(0);
}

const idOfLabel = (p: RecordProjection, label: string): string => {
  const n = p.graph.nodes.find((x) => x.label === label);
  if (!n) throw new Error(`no node labelled ${label}; have: ${p.graph.nodes.map((x) => x.label).join(" | ")}`);
  return n.id;
};

describe("a stated constraint that names what it limits", () => {
  /**
   * ⭐ CASE 1 — THE FAILURE. This is the exact shape that dropped on the wire.
   */
  it("CASE 1 — 'keep monthly churn under 4%' binds to the node the model called 'Subscriber Churn Rate'", () => {
    const p = project(churnRecords({ applies_to_claim: 0 }));
    const churnId = idOfLabel(p, "Subscriber Churn Rate");

    // Bound by IDENTITY to the minted target id, not by "some row with value 4".
    expect(p.goalConstraints).toHaveLength(1);
    const row = p.goalConstraints[0]!;
    expect(row.node_id).toBe(churnId);
    expect(row.operator).toBe("<=");
    expect(row.value).toBe(4);
    // THE UNIT SURVIVED. This is a safety condition, not a nicety: a limit that
    // arrives without its unit is a number nobody can normalise.
    expect(row.unit).toBe("%");
    expect(row.source_quote).toBe("keeping monthly churn under 4%");

    // ⭐ AND THE NODE ID IS ONE THE GRAPH ACTUALLY CARRIES. This is the whole
    // reason the reference is an integer index rather than a name: the merge
    // downstream filters on `existingNodeIds.has(node_id)`, and an id minted in
    // this same pass satisfies it BY CONSTRUCTION.
    expect(p.graph.nodes.map((n) => n.id)).toContain(row.node_id);

    // The limit lives ON the quantity now, so the standalone constraint node is
    // withdrawn rather than left beside it saying the same thing twice.
    expect(p.graph.nodes.filter((n) => n.kind === "constraint")).toHaveLength(0);
    // …and nothing was disclosed as refused, because nothing was refused.
    expect(p.dropped.map((d) => d.reason)).not.toContain("ambiguous_ref");
  });

  /**
   * ⭐ CASE 1b — THE REFERENCE SURVIVES INTO THE EDGE PASS.
   *
   * The stated index is REPOINTED at the target when the constraint node is
   * withdrawn. Without that, a `causal_link` into the constraint would report
   * `ref_out_of_range` — blaming the model for OUR sequencing decision. This is
   * the discriminating half: the edge must still exist and must land on the
   * churn node.
   */
  it("CASE 1b — the withdrawn constraint node does not turn a good reference into a dropped one", () => {
    // The model drew a link FROM the constraint (stated_items[1]) to the goal —
    // and that constraint node is withdrawn by the binding. If the stated index
    // were not repointed at the target, this link would report
    // `ref_out_of_range`, blaming the model for OUR sequencing decision.
    const p = project(churnRecords({ applies_to_claim: 0 }, { linkToGoal: true }));
    const churnId = idOfLabel(p, "Subscriber Churn Rate");

    expect(p.dropped.map((d) => d.reason)).not.toContain("ref_out_of_range");
    // The reference resolved onto the node that now carries the limit.
    expect(p.graph.edges.some((e) => e.from === churnId)).toBe(true);
    expect(p.goalConstraints[0]!.node_id).toBe(churnId);
  });

  /**
   * ⭐ CASE 2 — ADDITIVITY. The same record set with NO reference must behave
   * exactly as it did before the field existed.
   *
   * ⚠ THIS IS A BYTE COMPARISON AGAINST A PROJECTION TAKEN IN THE SAME RUN, not
   * against a remembered snapshot — a snapshot would decay into a tautology the
   * first time anything else about the projector moved (trap 12b).
   */
  it("CASE 2 — a constraint with NO reference is byte-identical to before: its own node, its own threshold", () => {
    const p = project(churnRecords({}, { linkToGoal: true }));

    // The standalone constraint node is still minted, with its operator and its
    // threshold — the behaviour this change is forbidden to disturb.
    const constraintNodes = p.graph.nodes.filter((n) => n.kind === "constraint");
    expect(constraintNodes).toHaveLength(1);
    expect((constraintNodes[0]!.data as { operator?: string }).operator).toBe("<=");
    expect((constraintNodes[0]!.observed_state as { value?: number }).value).toBe(4);

    // And NOTHING was bound. An empty array on every record set that does not
    // use the new field is what makes the change strictly additive.
    expect(p.goalConstraints).toHaveLength(0);
    // No new disclosure appeared either — silence, not a new question.
    expect(withoutNewRefusals(p)).toEqual([...p.dropped]);
  });

  /**
   * ⭐ CASE 3 — AMBIGUITY REFUSES AND FALLS THROUGH TO THE EXISTING ASK.
   *
   * The model named BOTH namespaces at once — two same-family candidates, and
   * nothing here is entitled to choose between them. Asking is the sanctioned
   * exit (trap 22f); guessing is the ratified never-do.
   */
  it("CASE 3 — a limit that names two targets at once REFUSES, changes nothing, and becomes a question", () => {
    const p = project(churnRecords({ applies_to_claim: 0, applies_to_stated: 0 }, { linkToGoal: true }));
    const baseline = project(churnRecords({}, { linkToGoal: true }));

    // REFUSED — bound by reason identity, not by "something was dropped".
    const refusal = p.dropped.find((d) => d.reason === "ambiguous_ref" && d.claim_kind === "stated_item");
    expect(refusal, "the ambiguous reference must be disclosed").toBeDefined();
    expect(refusal!.label).toBe("keeping monthly churn under 4%");
    expect(refusal!.to_ref).toBe("stated_items[0]+claims[0]");

    // FELL THROUGH: indistinguishable from the same draft with no reference at
    // all, so the user loses nothing they had before the field existed.
    expectIndistinguishableFromNoReference(p, baseline);
    expect(p.graph.nodes.filter((n) => n.kind === "constraint")).toHaveLength(1);

    // …and it reaches the user as a question through the EXISTING switch — no
    // new machinery was needed for an unresolved reference.
    const ask = enumerateCompletionAsk(
      churnRecords({ applies_to_claim: 0, applies_to_stated: 0 }, { linkToGoal: true }) as never,
      p,
    );
    expect(ask.items.some((i) => i.kind === "unresolved_reference")).toBe(true);
  });

  // ── THE SAFETY CONDITIONS ────────────────────────────────────────────────

  /**
   * ⭐⭐ SAFETY 1 — THE DIRECTION GATE STAYS IN FRONT OF THE MODEL'S BINDING.
   *
   * A floor shipped as a ceiling is a LIE; an unbound limit is a GAP. So a
   * reference must NOT let the model's confidence about the TARGET smuggle past
   * our refusal to guess the OPERATOR. Same record set, direction removed.
   */
  it("SAFETY 1 — a limit with a perfect reference but NO stated direction binds nothing", () => {
    const records = churnRecords({ applies_to_claim: 0 }, { linkToGoal: true });
    delete (records.stated_items[1] as Record<string, unknown>).direction;
    const p = project(records);

    expect(p.goalConstraints).toHaveLength(0);
    expect(p.dropped.map((d) => d.reason)).toContain("constraint_direction_unstated");
  });

  /**
   * SAFETY 1 — THE TWIN. With the direction stated and everything else equal,
   * the SAME record set binds. Without this pair, "binds nothing" above could be
   * a gate that refuses everything and the test would applaud (trap 13b).
   */
  it("SAFETY 1 TWIN — the same record set WITH a direction binds, so the gate discriminates", () => {
    const p = project(churnRecords({ applies_to_claim: 0 }));
    expect(p.goalConstraints).toHaveLength(1);
    expect(p.goalConstraints[0]!.operator).toBe("<=");
  });

  /**
   * ⭐⭐ SAFETY 2 — THE TARGET MUST BE A MEASURED QUANTITY.
   *
   * `applies_to_stated: 0` is the GOAL. A goal label routinely recites the
   * constraints bearing on it, which makes it a magnet for every limit in the
   * brief — which is exactly why `MINTABLE_TARGET_KINDS` excludes it.
   */
  it("SAFETY 2 — a reference to the GOAL refuses: a goal cannot carry a threshold", () => {
    const p = project(churnRecords({ applies_to_stated: 0 }, { linkToGoal: true }));
    const baseline = project(churnRecords({}, { linkToGoal: true }));

    const refusal = p.dropped.find((d) => d.reason === "constraint_target_not_measurable");
    expect(refusal, "a goal target must be disclosed, not silently dropped").toBeDefined();
    expect(refusal!.label).toBe("keeping monthly churn under 4%");
    expectIndistinguishableFromNoReference(p, baseline);
  });

  /**
   * SAFETY 2 — THE RULE IS DERIVED, NOT RE-SPELLED. Pins the projector to the
   * SHARED constant rather than to a local copy of `{outcome, factor}`. If the
   * two ever diverge this REDs, which is the whole reason the constant moved to
   * a leaf module.
   */
  it("SAFETY 2 — the kind rule is the shared MINTABLE_TARGET_KINDS, not a second spelling", () => {
    expect(MINTABLE_TARGET_KINDS.has("factor")).toBe(true);
    expect(MINTABLE_TARGET_KINDS.has("outcome")).toBe(true);
    expect(MINTABLE_TARGET_KINDS.has("goal")).toBe(false);
    expect(MINTABLE_TARGET_KINDS.has("option")).toBe(false);
  });

  /**
   * ⭐⭐ SAFETY 3 — A PERCENTAGE MUST NOT WELD TO A CURRENCY NODE.
   *
   * The reference resolves perfectly; the target measures money. Binding would
   * change what the user's limit MEANS while looking correctly bound, which is
   * the harm class this whole gate exists for.
   */
  it("SAFETY 3 — a % limit refuses to bind to a node measured in currency", () => {
    const p = project({
      stated_items: [
        { kind: "goal", source_quote: "grow net revenue", role: "target" },
        { kind: "figure", source_quote: "we spend £240,000 a year on support", value: 240000, unit: "£" },
        {
          kind: "constraint",
          source_quote: "keeping monthly churn under 4%",
          value: 4,
          unit: "%",
          direction: "ceiling",
          // Points at the MONEY figure — a real node, wrong quantity.
          applies_to_stated: 1,
        },
      ],
      claims: [
        { claim_kind: "causal_link", label: "support spend bears on revenue", from_stated: 1, to_stated: 0, effect: "negative" },
      ],
    });

    expect(p.goalConstraints).toHaveLength(0);
    const refusal = p.dropped.find((d) => d.reason === "constraint_target_unit_mismatch");
    expect(refusal, "a cross-quantity binding must be refused and disclosed").toBeDefined();
    expect(refusal!.label).toBe("keeping monthly churn under 4%");
  });

  /**
   * SAFETY 3 — THE TWIN, and it is the load-bearing half. A % limit against a %
   * node BINDS. Without it, the refusal above is satisfied by a gate that
   * refuses every unit pair, and this file could not tell the two apart.
   */
  it("SAFETY 3 TWIN — a % limit DOES bind to a node measured in %, so the unit gate discriminates", () => {
    const p = project({
      stated_items: [
        { kind: "goal", source_quote: "grow net revenue", role: "target" },
        { kind: "figure", source_quote: "monthly churn is running at 6.2%", value: 6.2, unit: "%" },
        {
          kind: "constraint",
          source_quote: "keeping monthly churn under 4%",
          value: 4,
          unit: "%",
          direction: "ceiling",
          applies_to_stated: 1,
        },
      ],
      claims: [
        { claim_kind: "causal_link", label: "churn erodes revenue", from_stated: 1, to_stated: 0, effect: "negative" },
      ],
    });

    const target = p.graph.nodes.find((n) => n.label === "monthly churn is running at 6.2%");
    expect(target).toBeDefined();
    expect(p.goalConstraints).toHaveLength(1);
    expect(p.goalConstraints[0]!.node_id).toBe(target!.id);
    expect(p.dropped.map((d) => d.reason)).not.toContain("constraint_target_unit_mismatch");
  });

  /**
   * ⭐⭐ A BOUND ROW NEVER NAMES A NODE THE GRAPH DOES NOT CARRY.
   *
   * ⚠ THIS CASE EXISTS BECAUSE THE CLAIM IT PINS WAS FALSE WHEN FIRST WRITTEN.
   * The binder's own note said the target is on the graph "by construction"
   * because it was minted in the same pass — true at bind time, and NOT true at
   * the end, because the connectivity prune runs afterwards and withdraws a
   * factor that never reaches the goal.
   *
   * It is the worst case available rather than a tidiness one: binding WITHDREW
   * the standalone constraint node, so an orphan row means the user's stated
   * limit is gone from the graph AND from the constraint list, leaving only a
   * downstream warn — exactly the silent loss this change exists to end.
   */
  it("a bound limit whose target is pruned is DISCLOSED, never left as an orphan row", () => {
    const p = project({
      stated_items: [
        { kind: "goal", source_quote: "grow net revenue", role: "target" },
        {
          kind: "constraint",
          source_quote: "keeping monthly churn under 4%",
          value: 4,
          unit: "%",
          direction: "ceiling",
          applies_to_claim: 0,
        },
      ],
      // The churn factor is never linked to the goal, so the prune withdraws it.
      claims: [{ claim_kind: "factor", label: "Subscriber Churn Rate" }],
    });

    // PRECONDITION PINNED IN-TEST (trap 13b): this fixture really does lose the
    // target. Without this the assertion below could pass because the target
    // survived, which would prove nothing about the reconciliation.
    expect(p.graph.nodes.some((n) => n.label === "Subscriber Churn Rate")).toBe(false);

    // Every row names a node the graph actually carries.
    const ids = new Set(p.graph.nodes.map((n) => n.id));
    for (const row of p.goalConstraints) expect(ids.has(row.node_id)).toBe(true);
    expect(p.goalConstraints).toHaveLength(0);

    // And the loss is DISCLOSED against the user's own words, not silent.
    const disclosed = p.dropped.find(
      (d) => d.claim_kind === "stated_item" && d.label === "keeping monthly churn under 4%",
    );
    expect(disclosed, "a limit whose target was pruned must be disclosed").toBeDefined();
    expect(disclosed!.reason).toBe("unconnected_to_goal");
  });

  /**
   * ⭐ AN INDEX THAT REACHES NOTHING IS THE MODEL'S ERROR AND IS DISCLOSED AS
   * ONE — through the SAME resolver, and the SAME existing ask case, as a
   * causal-link endpoint. No new machinery, which was the point of reusing the
   * integer-index reference rather than inventing a name.
   */
  it("an out-of-range reference refuses, discloses, and changes nothing else", () => {
    const p = project(churnRecords({ applies_to_claim: 99 }, { linkToGoal: true }));
    const baseline = project(churnRecords({}, { linkToGoal: true }));

    const refusal = p.dropped.find((d) => d.reason === "ref_out_of_range" && d.claim_kind === "stated_item");
    expect(refusal, "an out-of-range applies_to must be disclosed").toBeDefined();
    expect(refusal!.to_ref).toBe("claims[99]");
    expectIndistinguishableFromNoReference(p, baseline);
  });
});
