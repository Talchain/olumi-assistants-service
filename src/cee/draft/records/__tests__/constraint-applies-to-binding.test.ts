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

    // ⚠⚠ THE CONSTRAINT NODE IS ABSENT HERE, AND THE REASON IS THE PRUNE, NOT
    // THE BINDING. This line used to be commented "the limit lives ON the
    // quantity now, so the standalone constraint node is withdrawn" — that
    // explanation is false at this tip: the binding no longer withdraws
    // anything (see the ordering rule in `projector.ts` pass 2b). In THIS
    // fixture the constraint is never linked to the goal, so the connectivity
    // pass removes it exactly as it would with no reference at all.
    //
    // ⭐ AND THAT IS PINNED RATHER THAN ASSERTED, against a projection taken in
    // the SAME RUN — otherwise this assertion would keep passing for a reason
    // nobody had checked, which is how the false comment survived in the first
    // place.
    const sameRecordsNoRef = project(churnRecords({}));
    expect(sameRecordsNoRef.graph.nodes.filter((n) => n.kind === "constraint")).toHaveLength(0);
    expect(p.graph.nodes.filter((n) => n.kind === "constraint")).toHaveLength(0);
    // The binding itself removed NOTHING: same graph, with or without the field.
    expect(p.graph).toEqual(sameRecordsNoRef.graph);
    // …and nothing was disclosed as refused, because nothing was refused.
    expect(p.dropped.map((d) => d.reason)).not.toContain("ambiguous_ref");
  });

  /**
   * ⭐ CASE 1b — A REFERENCE INTO THE CONSTRAINT IS NEVER TURNED INTO A DROPPED
   * ONE.
   *
   * ⚠⚠ RESTATED. This case used to pin the REPOINT that accompanied the removal
   * of the constraint node: with the node withdrawn, a `causal_link` into it
   * would have reported `ref_out_of_range` unless its stated index were
   * repointed at the target. Both the withdrawal and the repoint are gone (see
   * the ordering rule in `projector.ts` pass 2b), so the property is now
   * established the plain way — THE NODE IS STILL THERE, so the model's link
   * resolves onto it exactly as it does today.
   *
   * The guard is kept rather than deleted because the property it protects is
   * unchanged and it is the half that would RED if a future splice were
   * re-enabled without restoring the repoint.
   */
  it("CASE 1b — a good reference into the constraint stays good", () => {
    // The model drew a link FROM the constraint (stated_items[1]) to the goal.
    const p = project(churnRecords({ applies_to_claim: 0 }, { linkToGoal: true }));
    const constraintNode = p.graph.nodes.find((n) => n.kind === "constraint");

    expect(p.dropped.map((d) => d.reason)).not.toContain("ref_out_of_range");
    // The node the reference names is on the graph, and the edge starts there.
    expect(constraintNode, "the constraint the model linked must still exist").toBeDefined();
    expect(p.graph.edges.some((e) => e.from === constraintNode!.id)).toBe(true);
    // …and it still carries the user's limit, by its parts.
    expect((constraintNode!.observed_state as { value?: number }).value).toBe(4);
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
   * ⭐ THE UNIT CLASSIFIER DOES NOT FALSE-POSITIVE ON ORDINARY UNIT WORDS.
   *
   * The canonical currency map holds two purely alphabetic symbols (`CHF`,
   * `kr`). Affix-matching those would classify a unit word ending in them as
   * currency — a FALSE REFUSAL, which costs a user their stated limit for no
   * reason. Bound to a unit the model plausibly emits.
   */
  it("a % limit still binds to a node whose unit merely ENDS in a currency symbol's letters", () => {
    const p = project({
      stated_items: [
        { kind: "goal", source_quote: "grow net revenue", role: "target" },
        // "kundkr" ends in "kr", the Swedish krona symbol in the canonical map.
        { kind: "figure", source_quote: "churn is 6.2 kundkr", value: 6.2, unit: "kundkr" },
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
    // The target's unit is unclassifiable, so nothing is PROVEN to mismatch and
    // the gate must not refuse — `unknown` means "I cannot tell", never "wrong".
    expect(p.dropped.map((d) => d.reason)).not.toContain("constraint_target_unit_mismatch");
    expect(p.goalConstraints).toHaveLength(1);
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

/**
 * ⛔⛔ THE ORDERING CONSTRAINT — the repair this block exists to pin.
 *
 * ── WHAT WAS MEASURED, AND IT WAS DESTRUCTIVE ─────────────────────────────
 * The binding pass originally SPLICED the standalone `constraint` node out of
 * the graph on the stated ground that "the limit now lives ON the quantity it
 * bounds". It does not. The row is written to `RecordProjection.goalConstraints`
 * — a SIBLING of `.graph` — and the live draft path copies only `.graph`
 * (`adapters/llm/anthropic.ts`, `rawJson = { ...activeProjection.graph }`).
 * Contrast-controlled sweep: the sibling `.dropped` is read by 12 non-test
 * files; `RecordProjection.goalConstraints` is read by NONE outside
 * `projector.ts`. (`ctx.goalConstraints` in `unified-pipeline` is a
 * DIFFERENTLY-SCOPED FIELD OF THE SAME NAME with many readers — the two are not
 * connected, and conflating them is what made the splice look safe.)
 *
 * A/B on the projection, two arms differing in ONE key, the constraint LINKED
 * to the goal so the connectivity prune is not the variable:
 *   without the field → 3 nodes, incl. `constraint` "keeping monthly churn
 *                        under 4%" with `observed_state.value 4`, `unit "%"`,
 *                        `operator "<="`
 *   with    the field → 2 nodes. THAT NODE IS GONE. `dropped` EMPTY.
 *                        `graph.goal_constraints` undefined.
 * The user's stated limit left the product with nothing disclosed.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 * ⛔ A NODE CARRYING A USER-STATED LIMIT MAY ONLY BE REMOVED ONCE THAT LIMIT IS
 * DEMONSTRABLY CARRIED SOMEWHERE A CONSUMER READS. Until then, KEEP THE NODE.
 *
 * These guards are written against THE RULE, not against the shape of today's
 * code (trap 13d), so they stay load-bearing when a later lane makes
 * `goalConstraints` reach a reader and re-enables the splice: at that moment
 * the last guard below REDs unless the removal is disclosed.
 */
describe("⛔ a stated limit is never removed before its carrier is read", () => {
  /**
   * ⚠⚠ THE FIXTURE LINKS **BOTH** THE CONSTRAINT AND ITS TARGET TO THE GOAL,
   * AND FINDING OUT WHY COST A MEASUREMENT — the same one the reviewer's first
   * attempt got wrong in the other direction.
   *
   * `churnRecords({...}, { linkToGoal: true })` links the CONSTRAINT to the goal
   * and, in doing so, drops the factor→goal link — so the TARGET is unconnected
   * and the connectivity prune withdraws it. That fixture only ever bound at all
   * because the removed splice REPOINTED the constraint's stated index onto the
   * factor, which is what gave the factor its edge. Measuring the removal with
   * it would therefore measure THE PRUNE, not the change, and the arms would
   * agree for a reason that has nothing to do with the binding.
   *
   * A compliant draft links both: the instruction tells the model to link a
   * stated constraint to the goal, and a factor that drives the goal carries its
   * own link. So this is what a real draft looks like, not a convenience — and
   * with it the two arms below differ in EXACTLY ONE KEY.
   */
  const bothLinked = (constraintExtras: Record<string, unknown>) => ({
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
      { claim_kind: "factor", label: "Subscriber Churn Rate" },
      { claim_kind: "causal_link", label: "the churn limit bears on revenue", from_stated: 1, to_stated: 0, effect: "negative" },
      { claim_kind: "causal_link", label: "churn erodes revenue", from_claim: 0, to_stated: 0, effect: "negative" },
    ],
  });

  /**
   * ⭐⭐ THE STRONGEST STATEMENT OF "INERT", AND THE ONE THE PR BODY CLAIMS.
   *
   * A SUCCESSFUL bind must leave the graph byte-identical to the same record
   * set with no reference at all. Compared against a projection taken IN THE
   * SAME RUN, never a snapshot (trap 12b).
   *
   * ⚠ Note this is the BOUND case. The pre-existing additivity comparator only
   * ever ran on REFUSALS — which is exactly why the destruction sat under a
   * fully green suite: every guard pointed at the paths where nothing happened.
   */
  it("NO SILENT LOSS — a SUCCESSFUL bind leaves the graph byte-identical to the same records with no reference", () => {
    const bound = project(bothLinked({ applies_to_claim: 0 }));
    const baseline = project(bothLinked({}));

    // The bind really did happen — the precondition is PINNED in-test, so this
    // cannot pass because nothing bound (trap 13b).
    expect(bound.goalConstraints, "precondition: this fixture must actually bind").toHaveLength(1);

    expect(bound.graph).toEqual(baseline.graph);
    expect(bound.provenance).toEqual(baseline.provenance);
    expect(bound.dropped).toEqual(baseline.dropped);
  });

  /**
   * ⭐ THE SAME PROPERTY STATED AT THE USER'S LEVEL — the limit, by its parts.
   * Bound by IDENTITY to the minted node id, never by "some node with a 4".
   */
  it("NO SILENT LOSS — the node carrying the user's limit survives the bind with label, operator, value and unit intact", () => {
    const baseline = project(bothLinked({}));
    const carrier = baseline.graph.nodes.find((n) => n.kind === "constraint");
    expect(carrier, "precondition: the baseline must carry a constraint node").toBeDefined();

    const bound = project(bothLinked({ applies_to_claim: 0 }));
    expect(bound.goalConstraints, "precondition: this fixture must actually bind").toHaveLength(1);

    const survivor = bound.graph.nodes.find((n) => n.id === carrier!.id);
    expect(survivor, "the node carrying the user's stated limit must survive the bind").toBeDefined();
    expect(survivor!.label).toBe("keeping monthly churn under 4%");
    expect((survivor!.data as { operator?: string }).operator).toBe("<=");
    expect((survivor!.observed_state as { value?: number }).value).toBe(4);
    expect((survivor!.observed_state as { metadata?: { unit?: string } }).metadata!.unit).toBe("%");
  });

  /**
   * ⭐⭐ THE INVARIANT, WRITTEN AGAINST THE RULE AND NOT AGAINST THE CODE.
   *
   * For EVERY record set that binds: the node the user's limit arrived on is
   * still on the graph, OR its disappearance is disclosed in `dropped` against
   * the user's own words. This is the guard that survives a future splice —
   * re-enable one without a disclosure and this REDs.
   *
   * ⭐ What would have to be true for this to pass while the property fails?
   * That no fixture in the table actually binds. So each one asserts its own
   * bind first, and the table asserts a non-zero size.
   */
  it("NO SILENT LOSS INVARIANT — every bound limit is on the graph as a node, or is disclosed", () => {
    const fixtures: Array<[string, unknown]> = [
      // The happy path: both linked, the row survives reconciliation.
      ["both linked", bothLinked({ applies_to_claim: 0 })],
      // ⭐ THE CASE THE REMOVED SPLICE DESTROYED. The constraint reaches the
      // goal so its node survives the prune, but the TARGET does not — so the
      // bound row is reconciled away by pass 2c. Under the old splice the
      // user's limit was gone from the graph AND from the row, with nothing
      // disclosed. Under the ordering rule the node is simply still there.
      ["constraint linked, target pruned", churnRecords({ applies_to_claim: 0 }, { linkToGoal: true })],
    ];
    expect(fixtures.length).toBeGreaterThan(0);

    for (const [name, records] of fixtures) {
      const p = project(records);
      // The carrier id is DERIVED from the same record set with the reference
      // removed, so it is the real minted id and not a literal that can drift.
      const withoutRef = project(name.startsWith("both") ? bothLinked({}) : churnRecords({}, { linkToGoal: true }));
      const carrier = withoutRef.graph.nodes.find((n) => n.kind === "constraint");

      // ⚠ The precondition here is that a BIND WAS ATTEMPTED, not that a row
      // survived: in the unlinked fixture the target is legitimately pruned, and
      // the invariant is about the USER'S LIMIT, which must be on the graph or
      // disclosed either way. Pinned by the same-run baseline carrying a node.
      expect(carrier, `${name}: precondition — the baseline must mint a carrier`).toBeDefined();

      const stillOnGraph = carrier !== undefined && p.graph.nodes.some((n) => n.id === carrier.id);
      const disclosed = p.dropped.some(
        (d) => d.label === "keeping monthly churn under 4%" || d.node_id === carrier?.id,
      );
      expect(
        stillOnGraph || disclosed,
        `${name}: the user's stated limit vanished from the graph with NOTHING disclosed`,
      ).toBe(true);
    }
  });
});

/**
 * ⛔ THE SECOND BLOCK — a malformed OPTIONAL reference killed the whole draft.
 *
 * ⚠⚠ A PREMISE HANDED TO THIS REPAIR WAS THAT `"0"` IS TREATED AS ABSENT BY A
 * FALSY CHECK. MEASURED, AND IT IS NOT. There is no falsy special-case
 * anywhere: `"1"`, `0.5` and `null` refuse identically to `"0"`. The mechanism
 * is `z.number().int().optional()` on the item, and ONE item's type error fails
 * the WHOLE `DraftRecordSetWire.safeParse`, which the seam turns into
 * `not_a_record_set` — a hard failure of the entire draft.
 *
 * ⭐ WHY THESE TWO FIELDS AND NOT THE REFERENCE FAMILY (trap 21 — the two
 * answer different questions). `from_claim`/`to_claim` are LOAD-BEARING
 * STRUCTURE: a malformed one means an edge the model intended cannot be built,
 * and refusing is right. `applies_to_*` is an OPTIONAL ENHANCEMENT whose
 * ABSENCE is defined as byte-identical to today, so the honest degradation for
 * a malformed one is exactly that absence — never the loss of the whole draft.
 * The contrast control below pins that the rule was NOT widened to the family.
 */
describe("a malformed optional reference degrades to absence, never to a dead draft", () => {
  const withAppliesTo = (v: unknown) => ({
    stated_items: [
      { kind: "goal", source_quote: "grow net revenue", role: "target" },
      {
        kind: "constraint",
        source_quote: "keeping monthly churn under 4%",
        value: 4,
        unit: "%",
        direction: "ceiling",
        applies_to_claim: v,
      },
    ],
    claims: [
      { claim_kind: "factor", label: "Subscriber Churn Rate" },
      // Both linked, so neither the constraint node nor its target is removed by
      // the connectivity prune — otherwise this block would be measuring the
      // prune rather than the seam's tolerance.
      { claim_kind: "causal_link", label: "the churn limit bears on revenue", from_stated: 1, to_stated: 0, effect: "negative" },
      { claim_kind: "causal_link", label: "churn erodes revenue", from_claim: 0, to_stated: 0, effect: "negative" },
    ],
  });

  /** ⭐ THE PINNED CASE, spelled out on its own so it can never be generalised away. */
  it('applies_to_claim: "0" — the draft SURVIVES, and the field is simply absent', () => {
    const r = projectDraftRecords(withAppliesTo("0"), BRIEF);
    expect(r.ok, 'a string "0" in an optional enhancement field must not kill the draft').toBe(true);
    if (!r.ok) return;
    // Degraded to ABSENCE: nothing bound, exactly as if the model had said nothing.
    expect(r.records.stated_items[1]!.applies_to_claim).toBeUndefined();
    expect(r.projection.goalConstraints).toHaveLength(0);
    // And the user's limit is still on the graph.
    expect(r.projection.graph.nodes.filter((n) => n.kind === "constraint")).toHaveLength(1);
  });

  it("the whole malformed value space degrades to absence, not to a refusal", () => {
    for (const bad of ["0", "1", 0.5, null, "abc", true, {}, []]) {
      const r = projectDraftRecords(withAppliesTo(bad), BRIEF);
      expect(r.ok, `applies_to_claim: ${JSON.stringify(bad)} must not kill the draft`).toBe(true);
      if (r.ok) expect(r.records.stated_items[1]!.applies_to_claim).toBeUndefined();
    }
  });

  /** ⭐ THE DISCRIMINATING HALF — a well-formed value still binds. */
  it("a WELL-FORMED value still binds, so the tolerance did not swallow the field", () => {
    const r = projectDraftRecords(withAppliesTo(0), BRIEF);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.records.stated_items[1]!.applies_to_claim).toBe(0);
    expect(r.projection.goalConstraints).toHaveLength(1);
  });

  /**
   * ⭐⭐ CONTRAST CONTROL — the load-bearing reference family is UNCHANGED.
   * If this ever passes, the tolerance was widened past the two fields it was
   * scoped to, and a malformed causal-link endpoint is being swallowed.
   */
  it("CONTRAST CONTROL — a malformed load-bearing `from_claim` still refuses the record set", () => {
    const r = projectDraftRecords(
      {
        stated_items: [{ kind: "goal", source_quote: "grow net revenue", role: "target" }],
        claims: [
          { claim_kind: "factor", label: "Subscriber Churn Rate" },
          { claim_kind: "causal_link", label: "churn erodes revenue", from_claim: "0", to_stated: 0, effect: "negative" },
        ],
      },
      BRIEF,
    );
    expect(r.ok, "the reference family must keep refusing — this rule is scoped to applies_to_*").toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_a_record_set");
  });
});
