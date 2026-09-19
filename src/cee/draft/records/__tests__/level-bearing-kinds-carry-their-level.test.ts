/**
 * ⭐⭐ A LEVEL ON A `risk` OR AN `outcome` REACHES THE NODE — the carrier half of
 * instruction v20, and it must ship WITH the ask or the ask is deleted.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS IN THE SAME CHANGE AS THE INSTRUCTION ────
 * Instruction v20 asks the model for the level a `risk` or `outcome` sits at
 * today. The grammar already permits it: `buildDraftClaimItemSchema()` declares
 * `value`, `unit` and `value_scale` with NO kind scoping. But the PROJECTOR read
 * all three inside `if (nodeKind === "factor")` — opened at :3318, closed
 * immediately before `nodes.push(node)` — so a value on a `risk` or `outcome`
 * claim was projected NOWHERE.
 *
 * Shipping the ask alone would have been a no-op on exactly the node kinds it
 * was written for. That is grammar v9's failure repeated inside the change
 * written to close it, and this file's sibling states the rule in terms: *"an
 * enforced structured-output grammar does not degrade an inexpressible fact, it
 * deletes it"* — and for `is_baseline`, *"the two changes ship together"*.
 *
 * ── WHY THESE THREE KINDS AND NOT ALL OF THEM ──────────────────────────────
 * `LEVEL_BEARING_CLAIM_NODE_KINDS` is `factor | risk | outcome`: the kinds that
 * name a QUANTITY WITH A CURRENT LEVEL. Deliberately excluded:
 *   · `option` — an option carries INTERVENTIONS, not a level of its own, and
 *     the `is_baseline` branch immediately above already serves it;
 *   · `causal_link` — maps to `null` in `CLAIM_KIND_TO_NODE_KIND` and mints no
 *     node at all, so a value on one is discarded upstream of this code.
 * `prior` needs no entry: `CLAIM_KIND_TO_NODE_KIND` already maps it to "factor".
 *
 * ── ⚠ THE DOWNSTREAM INTERACTION, STATED RATHER THAN DISCOVERED ────────────
 * PLoT treats `goal | outcome | risk` as a PROBABILITY DOMAIN normalised to
 * [0,1] (`normalisation/constraint-filter.ts:41`, `:121`). So a level on one of
 * these kinds is read on a [0,1] scale, and a value outside it raises
 * `plot.constraint_out_of_domain` — a "warn, don't drop" safety gate that
 * forwards anyway. This change does NOT alter that gate and does not claim to
 * make every level safe; it makes the level REACH the node, which is the
 * precondition ISL states in terms (`CONSTRAINT_NOT_CONVERTIBLE`: *"requires
 * constraint target node X to carry observed_state.baseline … but it carries no
 * observed_state at all"*, 13 of 13 in the banked journey corpus). CEE #1556 is
 * the complementary half — making an out-of-domain limit legible to the user —
 * and the two are complementary, not competing.
 */
import { describe, expect, it } from "vitest";
import { projectRecordsToGraph, type ProjectedNode } from "../projector.js";
import { transformGraphToV3 } from "../../../transforms/schema-v3.js";

/** Bind by the projector's own minted id via kind+label — never by value (trap 19). */
function nodeByLabel(nodes: readonly ProjectedNode[], label: string): ProjectedNode | undefined {
  return nodes.find((n) => n.label === label);
}

/**
 * One brief, four claim kinds, EVERY ONE carrying the same value/unit/scale. The
 * uniformity is the point: any per-kind difference in the result is the
 * projector's doing and not the fixture's.
 */
const RECORDS = {
  stated_items: [
    { kind: "goal", source_quote: "keep monthly churn under 4%" },
    { kind: "option", source_quote: "run a retention programme" },
  ],
  claims: [
    { claim_kind: "factor", label: "Support Response Time", value: 0.42, unit: "%", value_scale: "unit_interval" },
    { claim_kind: "risk", label: "Pro Subscriber Churn Rate", value: 0.04, unit: "%", value_scale: "unit_interval" },
    { claim_kind: "outcome", label: "Net Revenue Retention", value: 0.88, unit: "%", value_scale: "unit_interval" },
    { claim_kind: "option_refinement", label: "Ship a win-back campaign", value: 0.5, unit: "%", value_scale: "unit_interval" },
    // The causal spine, so every node above survives the connectivity prune and
    // the comparison is between kinds rather than between a kept node and a
    // dropped one. option -> factor -> risk -> goal, and factor -> outcome -> goal.
    { claim_kind: "causal_link", label: "the campaign moves response time", from_stated: 1, to_claim: 0 },
    { claim_kind: "causal_link", label: "response time drives churn", from_claim: 0, to_claim: 1 },
    { claim_kind: "causal_link", label: "response time drives retention", from_claim: 0, to_claim: 2 },
    { claim_kind: "causal_link", label: "churn bears on the goal", from_claim: 1, to_stated: 0 },
    { claim_kind: "causal_link", label: "retention bears on the goal", from_claim: 2, to_stated: 0 },
  ],
};

describe("a level-bearing claim reaches its node, whatever kind it is", () => {
  it.each([
    { label: "Support Response Time", kind: "factor", value: 0.42 },
    { label: "Pro Subscriber Churn Rate", kind: "risk", value: 0.04 },
    { label: "Net Revenue Retention", kind: "outcome", value: 0.88 },
  ])("$kind — $label carries its level, unit and declared scale", ({ label, kind, value }) => {
    const { graph } = projectRecordsToGraph(RECORDS as never, "keep monthly churn under 4%");
    const node = nodeByLabel(graph.nodes as readonly ProjectedNode[], label);
    expect(node, `no node labelled "${label}"`).toBeDefined();
    expect(node!.kind).toBe(kind);
    expect((node as { observed_state?: { value?: number } }).observed_state?.value).toBe(value);
    expect((node as { data?: { value?: number; unit?: string } }).data?.value).toBe(value);
    expect((node as { data?: { unit?: string } }).data?.unit).toBe("%");
    expect((node as { declared_scale?: string }).declared_scale).toBe("unit_interval");
  });

  /**
   * THE OPPOSITE-DIRECTION TWIN, and it is what stops this becoming "carry a
   * level onto everything". An option's number is not a level of its own — it
   * is an intervention, and it travels on the `causal_link` that leaves the
   * option. Widening to `option` would mint a phantom baseline on every
   * alternative.
   */
  it("an option_refinement does NOT acquire an observed level", () => {
    const { graph } = projectRecordsToGraph(RECORDS as never, "keep monthly churn under 4%");
    const option = nodeByLabel(graph.nodes as readonly ProjectedNode[], "Ship a win-back campaign");
    expect(option, "no option node").toBeDefined();
    expect(option!.kind).toBe("option");
    expect((option as { observed_state?: unknown }).observed_state).toBeUndefined();
    expect((option as { data?: unknown }).data).toBeUndefined();
  });

  /**
   * THE PRECONDITION, PINNED IN-TEST. Both assertions above could pass on a
   * fixture where nothing carried a value at all. This asserts the factor arm —
   * the one that worked before this change — still works, so a green risk/outcome
   * result is a widening and not a rewrite.
   */
  it("pins that the factor arm is unchanged, so the widening is additive", () => {
    const { graph } = projectRecordsToGraph(RECORDS as never, "keep monthly churn under 4%");
    const factor = nodeByLabel(graph.nodes as readonly ProjectedNode[], "Support Response Time");
    expect((factor as { observed_state?: { value?: number; raw_value?: number } }).observed_state)
      .toEqual({ value: 0.42, raw_value: 0.42, declared_scale: "unit_interval" });
  });
});

/* ===========================================================================
 * THE HOP AFTER — a carrier that stops one hop short is the same defect one
 * level down, and TRACING IS NOT EXECUTING.
 *
 * `schema-v3.ts`'s `data`-present limb builds `observed_state` from `node.data`
 * and is not kind-gated, so the widening above SHOULD survive the V3 transform.
 * Reading that is not evidence: this estate's named failure is a chain that is
 * correct at every hop read individually and broken end to end. So the chain is
 * EXECUTED here rather than argued.
 *
 * This is the hop ISL actually reads — its `CONSTRAINT_NOT_CONVERTIBLE` refusal
 * names `observed_state` on the constraint TARGET, which is a risk or outcome
 * node — so a green result here is the one that matters to the user.
 * ========================================================================= */
describe("the level survives the V3 transform, executed rather than traced", () => {
  it.each([
    { label: "Pro Subscriber Churn Rate", kind: "risk", value: 0.04 },
    { label: "Net Revenue Retention", kind: "outcome", value: 0.88 },
    { label: "Support Response Time", kind: "factor", value: 0.42 },
  ])("$kind — $label still carries its level on the V3 graph", ({ label, kind, value }) => {
    const { graph } = projectRecordsToGraph(RECORDS as never, "keep monthly churn under 4%");
    const v3 = transformGraphToV3(graph as never);
    const nodes = (v3 as { graph?: { nodes?: Array<Record<string, unknown>> } }).graph?.nodes
      ?? (v3 as { nodes?: Array<Record<string, unknown>> }).nodes
      ?? [];
    const node = nodes.find((n) => n.label === label);
    expect(node, `no V3 node labelled "${label}" (V3 keys: ${Object.keys(v3 as object).join(",")})`).toBeDefined();
    expect(node!.kind).toBe(kind);
    expect((node!.observed_state as { value?: number } | undefined)?.value).toBe(value);
  });
});
