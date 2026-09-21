/**
 * ⭐⭐⭐ AN OPTION THAT CHANGES NOTHING IS NOT AN ALTERNATIVE.
 *
 * ── THE MEASURED DEFECT THIS CLOSES ────────────────────────────────────────
 * Paul's session on 11 Sep 2026 (`olumi-debug-5b41f0eb-20260911.json`, UI
 * `9e2916fc` / PLoT `d68d4ff` / ISL `7781ca4`). The brief asked whether to
 * raise the Pro plan price "from £49 to £59". Three options were drafted
 * against the factor `Pro Plan Monthly Price`, whose baseline is `0.49`:
 *
 *   14d36e6f  "increase the Pro plan price from £49 to £59 …"   sets_to 0.49
 *   43ba22ae  "Raise Price to £59 at Feature Launch"            sets_to 0.59
 *   5d37cb33  "Raise Price to £54 (Soft Increase)"              sets_to 0.54
 *
 * The first option's intervention EQUALS the baseline exactly, so it models
 * changing nothing. Raising the price hurts in this model, so the do-nothing
 * arm had the least downside — ISL returned outcome means −0.0226 / −0.1358 /
 * −0.0792 and a 73.4% win probability, and the product told the user that
 * *"increase the Pro plan price from £49 to £59 … currently leads"*.
 *
 * **The product recommended raising the price while modelling not raising it.**
 * `warnings_count: 0`. Every gate passed, because every gate checked STRUCTURE
 * and none checked whether an option was an option.
 *
 * ── WRITTEN AGAINST THE SPEC, NOT AGAINST THE FAILURE MODE (trap 13d) ──────
 * The failure mode in hand was a `from X to Y` phrasing whose FROM number was
 * bound. That is where we came in; it is not the property. The property is:
 *
 *   a non-baseline option whose interventions equal the factor baseline on
 *   EVERY factor it intervenes on does not describe a change.
 *
 * Nothing here reads a label, a verb, or a phrasing. A predicate over the
 * wording would have to be right about natural language in both directions,
 * and this estate has burned four consecutive rounds proving it cannot be
 * (CLAUDE.md trap 22f). The values the analysis runs on are decidable.
 *
 * ── WHAT THIS CORPUS DELIBERATELY EXCLUDES, AND WHY THAT IS CHECKED ────────
 * Per trap 13d(c), the classes below exist because the contract admits them
 * and Paul's single failure did NOT show them: a baseline option (both flag
 * surfaces), a multi-factor option where only SOME factors match, a factor
 * with no derivable baseline, an option with no interventions at all, the
 * tolerance boundary in both directions, and NEGATIVE and ZERO levels — the
 * intervention map is a bare `z.record(z.string(), z.number())`
 * (`schemas/graph.ts:200`), so it admits values a unit-interval intuition
 * never pictures.
 */

import { describe, it, expect } from "vitest";
import { validateGraph, buildInterventionSignature } from "../graph-validator.js";
import type { GraphT, NodeT } from "../../schemas/graph.js";

/** The factor baseline in Paul's session, on the model's 0-1 scale. */
const BASELINE = 0.49;

/**
 * Paul's graph shape, reduced to what the invariant reads.
 *
 * Every structural requirement of the other validator tiers is satisfied so a
 * failure here is about THIS invariant and not about a malformed fixture:
 * decision → options, options → factor, factor → outcome → goal.
 */
function paulsGraph(): GraphT {
  return {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: "decision_1", kind: "decision", label: "Which option?" },
      {
        id: "opt_noop",
        kind: "option",
        label: "increase the Pro plan price from £49 to £59 per month with the next Pro feature release",
        data: { interventions: { fac_price: BASELINE } },
      },
      {
        id: "opt_59",
        kind: "option",
        label: "Raise Price to £59 at Feature Launch",
        data: { interventions: { fac_price: 0.59 } },
      },
      {
        id: "opt_54",
        kind: "option",
        label: "Raise Price to £54 (Soft Increase)",
        data: { interventions: { fac_price: 0.54 } },
      },
      {
        id: "fac_price",
        kind: "factor",
        label: "Pro Plan Monthly Price",
        category: "controllable",
        observed_state: { value: BASELINE, raw_value: 49 },
        data: { value: BASELINE, raw_value: 49, extractionType: "explicit" },
      },
      { id: "outcome_1", kind: "outcome", label: "MRR" },
      { id: "goal_1", kind: "goal", label: "£20k MRR" },
    ] as NodeT[],
    edges: [
      { from: "decision_1", to: "opt_noop", strength_mean: 1, belief_exists: 1 },
      { from: "decision_1", to: "opt_59", strength_mean: 1, belief_exists: 1 },
      { from: "decision_1", to: "opt_54", strength_mean: 1, belief_exists: 1 },
      { from: "opt_noop", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_59", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "opt_54", to: "fac_price", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "fac_price", to: "outcome_1", strength_mean: 0.8, belief_exists: 0.9 },
      { from: "outcome_1", to: "goal_1", strength_mean: 0.9, belief_exists: 1 },
    ],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
  } as GraphT;
}

/** Every option id carried on an `OPTION_NO_OP` issue, in issue order. */
function noOpOptionIds(graph: GraphT): string[] {
  const result = validateGraph({ graph });
  return result.errors
    .filter((e) => e.code === "OPTION_NO_OP")
    .map((e) => String((e.context as { optionId?: unknown } | undefined)?.optionId));
}

function node(graph: GraphT, id: string): NodeT {
  const found = graph.nodes.find((n) => n.id === id);
  if (!found) throw new Error(`fixture has no node ${id}`);
  return found as NodeT;
}

describe("OPTION_NO_OP — an option must change something", () => {
  // ── THE MEASURED CASE ───────────────────────────────────────────────────
  it("flags Paul's no-op option BY ID, and only it", () => {
    // ⭐ Bound by IDENTITY, never by a value predicate another option could
    // satisfy (CLAUDE.md trap 19). Asserting "one issue" alone would pass on
    // the wrong option.
    expect(noOpOptionIds(paulsGraph())).toEqual(["opt_noop"]);
  });

  it("the two options that genuinely move the price are NOT flagged", () => {
    const ids = noOpOptionIds(paulsGraph());
    expect(ids).not.toContain("opt_59");
    expect(ids).not.toContain("opt_54");
  });

  it("the issue names the factor it is already at", () => {
    const result = validateGraph({ graph: paulsGraph() });
    const issue = result.errors.find((e) => e.code === "OPTION_NO_OP");
    expect(issue).toBeDefined();
    expect((issue!.context as { factorIds?: string[] }).factorIds).toEqual(["fac_price"]);
    // Ids only — no magnitudes in the context bag, per `schema-v3.ts:1095`.
    expect(JSON.stringify(issue!.context)).not.toContain("0.49");
  });

  // ── THE BASELINE OPTION: A NO-OP THAT IS CORRECT ────────────────────────
  it("does NOT flag the option that declares itself the baseline (data surface)", () => {
    const graph = paulsGraph();
    const opt = node(graph, "opt_noop");
    (opt.data as Record<string, unknown>).is_baseline = true;
    expect(noOpOptionIds(graph)).toEqual([]);
  });

  it("does NOT flag the option that declares itself the baseline (node surface)", () => {
    const graph = paulsGraph();
    (node(graph, "opt_noop") as Record<string, unknown>).is_baseline = true;
    expect(noOpOptionIds(graph)).toEqual([]);
  });

  it("an explicit true on EITHER surface wins over a false on the other", () => {
    // Measured 5/30 samples emit the two surfaces disagreeing — the reason
    // `cee/baseline-identity.ts` exists. This invariant reads THAT authority,
    // it does not spell a second copy of the rule.
    const graph = paulsGraph();
    const opt = node(graph, "opt_noop");
    (opt as Record<string, unknown>).is_baseline = true;
    (opt.data as Record<string, unknown>).is_baseline = false;
    expect(noOpOptionIds(graph)).toEqual([]);
  });

  it("an option explicitly marked NOT baseline is still flagged", () => {
    const graph = paulsGraph();
    (node(graph, "opt_noop").data as Record<string, unknown>).is_baseline = false;
    expect(noOpOptionIds(graph)).toEqual(["opt_noop"]);
  });

  // ── A DELIBERATE DO-NOTHING OPTION THE USER ADDED ───────────────────────
  it("a deliberate 'keep prices as they are' option IS flagged while it is unmarked", () => {
    // ⚠ PINNED DELIBERATELY, not an accident of the predicate. A do-nothing
    // alternative is legitimate and the graph already has the field that says
    // so (`is_baseline`). Until it carries that flag it is indistinguishable
    // from the defect above by anything the analysis can read, and the repair
    // directive's remedy is exactly "mark it as the baseline option".
    const graph = paulsGraph();
    const opt = node(graph, "opt_noop");
    opt.label = "Keep the Pro plan at £49";
    expect(noOpOptionIds(graph)).toEqual(["opt_noop"]);
  });

  // ── PARTIAL MATCHES: THE `EVERY` IN THE SPEC ────────────────────────────
  it("does NOT flag an option that matches the baseline on SOME factors but not all", () => {
    const graph = paulsGraph();
    graph.nodes.push({
      id: "fac_spend",
      kind: "factor",
      label: "Marketing Spend",
      category: "controllable",
      observed_state: { value: 0.3 },
      data: { value: 0.3, extractionType: "explicit" },
    } as NodeT);
    graph.edges.push(
      { from: "opt_noop", to: "fac_spend", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "fac_spend", to: "outcome_1", strength_mean: 0.5, belief_exists: 0.9 },
    );
    // price matches the baseline, spend does not → this option changes something.
    (node(graph, "opt_noop").data as { interventions: Record<string, number> }).interventions = {
      fac_price: BASELINE,
      fac_spend: 0.8,
    };
    expect(noOpOptionIds(graph)).toEqual([]);
  });

  it("DOES flag an option that matches the baseline on EVERY factor it touches", () => {
    const graph = paulsGraph();
    graph.nodes.push({
      id: "fac_spend",
      kind: "factor",
      label: "Marketing Spend",
      category: "controllable",
      observed_state: { value: 0.3 },
      data: { value: 0.3, extractionType: "explicit" },
    } as NodeT);
    graph.edges.push(
      { from: "opt_noop", to: "fac_spend", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
      { from: "fac_spend", to: "outcome_1", strength_mean: 0.5, belief_exists: 0.9 },
    );
    (node(graph, "opt_noop").data as { interventions: Record<string, number> }).interventions = {
      fac_price: BASELINE,
      fac_spend: 0.3,
    };
    const result = validateGraph({ graph });
    const issue = result.errors.find((e) => e.code === "OPTION_NO_OP");
    expect(issue).toBeDefined();
    expect((issue!.context as { factorIds?: string[] }).factorIds).toEqual(["fac_price", "fac_spend"]);
  });

  // ── WHAT THE INVARIANT MAY NOT DECIDE ───────────────────────────────────
  it("does NOT flag when the factor has no derivable baseline", () => {
    // A factor the brief states no value for cannot prove an option changes
    // nothing. Refusing to accuse is the safe direction: a false OPTION_NO_OP
    // withdraws a real alternative, which is the worse harm of the two.
    const graph = paulsGraph();
    const factor = node(graph, "fac_price");
    delete (factor as Record<string, unknown>).observed_state;
    delete (factor.data as Record<string, unknown>).value;
    expect(noOpOptionIds(graph)).toEqual([]);
  });

  it("does NOT flag an option carrying no interventions at all", () => {
    // A different defect with different owners (NO_EFFECT_PATH,
    // OPTIONS_IDENTICAL). Two questions, named apart (trap 21).
    const graph = paulsGraph();
    delete (node(graph, "opt_noop") as Record<string, unknown>).data;
    expect(noOpOptionIds(graph)).toEqual([]);
  });

  it("does NOT flag an option whose intervention names a node that is not a factor", () => {
    // INVALID_INTERVENTION_REF owns that, and it is already raised.
    const graph = paulsGraph();
    (node(graph, "opt_noop").data as { interventions: Record<string, number> }).interventions = {
      outcome_1: BASELINE,
    };
    const result = validateGraph({ graph });
    expect(result.errors.some((e) => e.code === "OPTION_NO_OP")).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_INTERVENTION_REF")).toBe(true);
  });

  // ── THE BASELINE SOURCE, AND ITS PRECEDENCE ─────────────────────────────
  it("reads observed_state.value — the field the run payload carries — over data.value", () => {
    const graph = paulsGraph();
    const factor = node(graph, "fac_price");
    (factor as { observed_state: { value: number } }).observed_state = { value: 0.59 };
    (factor.data as Record<string, unknown>).value = BASELINE;
    // observed_state says the price is already 0.59, so opt_59 is the no-op
    // and opt_noop is a real (downward) change.
    expect(noOpOptionIds(graph)).toEqual(["opt_59"]);
  });

  it("falls back to data.value when the factor carries no observed_state", () => {
    const graph = paulsGraph();
    const factor = node(graph, "fac_price");
    delete (factor as Record<string, unknown>).observed_state;
    expect(noOpOptionIds(graph)).toEqual(["opt_noop"]);
  });

  // ── TOLERANCE, IN BOTH DIRECTIONS ───────────────────────────────────────
  it("treats a difference below the identity resolution as no change", () => {
    const graph = paulsGraph();
    (node(graph, "opt_noop").data as { interventions: Record<string, number> }).interventions = {
      fac_price: BASELINE + 1e-6,
    };
    expect(noOpOptionIds(graph)).toEqual(["opt_noop"]);
  });

  it("treats a difference ABOVE the identity resolution as a real change", () => {
    const graph = paulsGraph();
    (node(graph, "opt_noop").data as { interventions: Record<string, number> }).interventions = {
      fac_price: BASELINE + 1e-3,
    };
    expect(noOpOptionIds(graph)).toEqual([]);
  });

  it("its resolution agrees with the identity signature the duplicate rule uses", () => {
    // ⚠ Two DIFFERENT questions at ONE resolution (trap 21): the signature
    // answers "are these two options the same?", this answers "is this option
    // the same as the status quo?". They must not drift apart on what counts
    // as the same number, so the agreement is asserted rather than assumed.
    const near = BASELINE + 1e-6;
    const far = BASELINE + 1e-3;
    expect(buildInterventionSignature({ f: BASELINE })).toBe(buildInterventionSignature({ f: near }));
    expect(buildInterventionSignature({ f: BASELINE })).not.toBe(buildInterventionSignature({ f: far }));
  });

  // ── VALUE CLASSES THE CONTRACT ADMITS AND PAUL'S FAILURE DID NOT SHOW ───
  it("holds at a ZERO baseline", () => {
    const graph = paulsGraph();
    (node(graph, "fac_price") as { observed_state: { value: number } }).observed_state = { value: 0 };
    (node(graph, "opt_noop").data as { interventions: Record<string, number> }).interventions = { fac_price: 0 };
    expect(noOpOptionIds(graph)).toEqual(["opt_noop"]);
  });

  it("holds at a NEGATIVE baseline, and discriminates its mirror", () => {
    const graph = paulsGraph();
    (node(graph, "fac_price") as { observed_state: { value: number } }).observed_state = { value: -0.2 };
    (node(graph, "opt_noop").data as { interventions: Record<string, number> }).interventions = { fac_price: -0.2 };
    (node(graph, "opt_59").data as { interventions: Record<string, number> }).interventions = { fac_price: 0.2 };
    // ⭐ The opposite-direction twin (trap 22b(b)): the same magnitude with the
    // opposite sign is a REAL change and must not be flagged.
    expect(noOpOptionIds(graph)).toEqual(["opt_noop"]);
  });

  it("does NOT flag a non-finite intervention level", () => {
    const graph = paulsGraph();
    (node(graph, "opt_noop").data as { interventions: Record<string, number> }).interventions = {
      fac_price: Number.NaN,
    };
    const result = validateGraph({ graph });
    expect(result.errors.some((e) => e.code === "OPTION_NO_OP")).toBe(false);
    expect(result.errors.some((e) => e.code === "NAN_VALUE")).toBe(true);
  });

  // ── CONTRAST CONTROL: THE DUPLICATE HALF ALREADY EXISTS ─────────────────
  it("two options with identical intervention sets are ALREADY refused, by OPTIONS_IDENTICAL", () => {
    // ⭐ This is a control, not a new rule. `graph-validator.ts:950` has owned
    // the duplicate question since before this lane; restating it here would
    // be two authorities on one question. It is asserted so the claim "the
    // duplicate half needs nothing" is measured rather than believed.
    const graph = paulsGraph();
    (node(graph, "opt_54").data as { interventions: Record<string, number> }).interventions = {
      fac_price: 0.59,
    };
    const result = validateGraph({ graph });
    const issue = result.errors.find((e) => e.code === "OPTIONS_IDENTICAL");
    expect(issue).toBeDefined();
    expect((issue!.context as { optionIds: string[] }).optionIds).toEqual(["opt_59", "opt_54"]);
  });

  it("a graph with three genuinely distinct options raises neither code", () => {
    // The contrast control for the whole file: a gate that reddens everything
    // discriminates nothing.
    const graph = paulsGraph();
    (node(graph, "opt_noop").data as { interventions: Record<string, number> }).interventions = {
      fac_price: 0.44,
    };
    const result = validateGraph({ graph });
    expect(result.errors.some((e) => e.code === "OPTION_NO_OP")).toBe(false);
    expect(result.errors.some((e) => e.code === "OPTIONS_IDENTICAL")).toBe(false);
  });
});
