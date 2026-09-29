/**
 * The stated option carries the user's own figures, or it carries none and the
 * ask stands.
 *
 * ⚠ EVERY FIXTURE HERE IS TRANSCRIBED FROM A LIVE STAGING DRAFT, not composed.
 * The captures are 9 drafts of one brief against `8e4efce0` on 2026-09-14
 * (`cee-staging.onrender.com/proxy/v5/turn`), and the ids, labels, provenance
 * stamps, `source`/`raw_value` pairs and edge origins below are the ones those
 * responses carried. A self-authored fixture would encode this author's model of
 * the producer rather than the producer (trap 16-inverse), and the whole claim
 * of this module is about what the producer actually emits.
 *
 * Assertions bind by NODE IDENTITY (`14d36e6f`, `6d9a37f3`, `a4e6cef0`), never
 * by a value predicate another option could satisfy — three options in the
 * witnessed draft carry `0.59` on the same factor.
 */

import { describe, it, expect } from "vitest";
import {
  adoptStatedFiguresForStatedOptions,
  type StatedOptionCoverageResult,
} from "../stated-option-figure-adoption.js";

type AnyNode = Record<string, unknown>;
type AnyOption = Record<string, unknown>;

function briefIntervention(value: number, raw: number, unit?: string) {
  return {
    value,
    raw_value: raw,
    ...(unit !== undefined ? { unit } : {}),
    source: "brief_extraction" as const,
    target_match: { node_id: "", match_type: "exact_id", confidence: "high" },
    value_confidence: "high" as const,
    reasoning: "Direct from V4 prompt data.interventions; the amount is stated in the brief",
  };
}

function hypothesisIntervention(value: number) {
  return {
    value,
    raw_value: value,
    source: "cee_hypothesis" as const,
    target_match: { node_id: "", match_type: "exact_id", confidence: "high" },
    value_confidence: "low" as const,
    reasoning: "Olumi estimate via edge d6c20537; this option→factor effect is not bound to a stated option record",
  };
}

const STATED_QUOTE =
  "increase the Pro plan price from £49 to £59 per month with the next Pro feature release";

/**
 * A stated option whose quote names ONE figure.
 *
 * ⚠ THE WITNESSED QUOTE CANNOT BE USED FOR THE ADOPT CASES, and that is a
 * finding rather than a fixture convenience: it names £49 AND £59, so rule 5
 * refuses it — see the module header on the temporal trajectory the integration
 * corpus caught. The adopt path is therefore exercised on the single-figure
 * shape, and the witnessed two-figure shape is exercised as a REFUSAL.
 */
const SINGLE_FIGURE_QUOTE = "raise the Pro plan price to £59";

/** run00 — the stated option wired to BOTH factors, carrying neither. */
function witnessedDraft(): { nodes: AnyNode[]; edges: AnyNode[]; options: AnyOption[] } {
  const nodes: AnyNode[] = [
    { id: "b4014d90", kind: "goal", label: "Reach £20k MRR Within 12 Months" },
    { id: "6d9a37f3", kind: "factor", label: "Pro Plan Monthly Price" },
    { id: "a4e6cef0", kind: "factor", label: "Feature Release Readiness" },
    {
      id: "14d36e6f",
      kind: "option",
      label: STATED_QUOTE,
      provenance: "from_brief",
      source_quote: STATED_QUOTE,
      is_baseline: false,
      interventions: {},
    },
    {
      id: "7a1b95aa",
      kind: "option",
      label: "Raise Price to £59 Immediately (No Feature Tie)",
      provenance: "ai_inferred",
      is_baseline: false,
      interventions: {},
    },
    {
      id: "868f8b07",
      kind: "option",
      label: "Raise Price to £59 with Feature Release",
      provenance: "ai_inferred",
      is_baseline: false,
      interventions: {},
    },
    {
      id: "b5f75882",
      kind: "option",
      label: "Hold Price at £49",
      provenance: "ai_inferred",
      is_baseline: true,
      interventions: {},
    },
  ];
  const edges: AnyNode[] = [
    // Wired by the status-quo connectivity repair — `origin: "repair"` on the wire.
    { id: "e1", from: "14d36e6f", to: "6d9a37f3", origin: "repair" },
    { id: "e2", from: "14d36e6f", to: "a4e6cef0", origin: "repair" },
    { id: "e3", from: "7a1b95aa", to: "6d9a37f3", origin: "ai" },
    { id: "e4", from: "7a1b95aa", to: "a4e6cef0", origin: "ai" },
    { id: "e5", from: "868f8b07", to: "6d9a37f3", origin: "ai" },
    { id: "e6", from: "868f8b07", to: "a4e6cef0", origin: "ai" },
    { id: "e7", from: "b5f75882", to: "6d9a37f3", origin: "ai" },
    { id: "e8", from: "b5f75882", to: "a4e6cef0", origin: "ai" },
  ];
  const options: AnyOption[] = [
    { id: "14d36e6f", label: STATED_QUOTE, status: "needs_user_mapping", is_baseline: false, interventions: {} },
    {
      id: "7a1b95aa",
      label: "Raise Price to £59 Immediately (No Feature Tie)",
      status: "ready",
      is_baseline: false,
      interventions: { "6d9a37f3": briefIntervention(0.59, 59, "£"), a4e6cef0: hypothesisIntervention(0.3) },
    },
    {
      id: "868f8b07",
      label: "Raise Price to £59 with Feature Release",
      status: "ready",
      is_baseline: false,
      interventions: { "6d9a37f3": briefIntervention(0.59, 59, "£"), a4e6cef0: hypothesisIntervention(0.85) },
    },
    {
      id: "b5f75882",
      label: "Hold Price at £49",
      status: "ready",
      is_baseline: true,
      interventions: { "6d9a37f3": briefIntervention(0.49, 49, "£"), a4e6cef0: hypothesisIntervention(0.5) },
    },
  ];
  // The graph node aliases the option's bundle, exactly as `schema-v3.ts` sets it.
  for (const node of nodes) {
    if (node.kind !== "option") continue;
    const option = options.find((o) => o.id === node.id)!;
    node.interventions = option.interventions;
  }
  return { nodes, edges, options };
}

function run(d: { nodes: AnyNode[]; edges: AnyNode[]; options: AnyOption[] }): StatedOptionCoverageResult {
  return adoptStatedFiguresForStatedOptions(d as never);
}

describe("the stated option is completed whole, or not at all", () => {
  it("adopts nothing on the witnessed draft, because the coupled half has no stated figure", () => {
    const d = witnessedDraft();
    const result = run(d);

    // ⭐ THE LOAD-BEARING ASSERTION. Half-configuring `14d36e6f` would make it
    // `ready` under option-status.ts, silencing the existing ask, and enter the
    // comparison wired on 1 of 2 factors against siblings wired on 2 — the
    // reported harm (16% vs 72% on the feature-release swing) reached by a
    // change that would score as a fix on any count-based metric.
    expect(result.adopted).toEqual([]);
    const stated = d.options.find((o) => o.id === "14d36e6f")!;
    expect(Object.keys(stated.interventions as object)).toEqual([]);

    // And BOTH gaps are RECORDED rather than shipped silently, each naming its
    // factor, its reason, and the fact that a sibling covers it — which is what
    // makes this the reported harm rather than a bare absence.
    expect(result.gaps).toEqual([
      {
        option_id: "14d36e6f",
        factor_id: "6d9a37f3",
        reason: "quote_names_several_figures",
        covered_by_sibling: true,
      },
      {
        option_id: "14d36e6f",
        factor_id: "a4e6cef0",
        reason: "no_stated_donor",
        covered_by_sibling: true,
      },
    ]);
  });

  /**
   * ⭐⭐ RULE 6, PINNED BY THE ONLY SHAPE THAT CAN SEE IT — one connected factor
   * that clears every gate beside one that does not.
   *
   * This case exists because a mutant proved rule 6 unpinned after rule 5 was
   * tightened: once the witnessed two-figure quote refuses BOTH factors, there
   * is no adoption left for all-or-nothing to withdraw, so deleting the rule
   * changed nothing observable. The guard had quietly stopped discriminating
   * while still reading green (trap 13b).
   */
  it("withdraws an otherwise-valid adoption when a SIBLING factor on the same option cannot be wired", () => {
    const d = witnessedDraft();
    // One figure, so the price factor clears rule 5 and would adopt 59 alone.
    d.nodes.find((n) => n.id === "14d36e6f")!.source_quote = SINGLE_FIGURE_QUOTE;
    // `a4e6cef0` still has only cee_hypothesis donors, so it cannot be wired.

    const result = run(d);

    // Half-configuring here is the reported harm: the option would become
    // `ready`, the ask would disappear, and it would enter the comparison wired
    // on 1 of 2 factors against siblings wired on 2.
    expect(result.adopted).toEqual([]);
    expect(Object.keys(d.options.find((o) => o.id === "14d36e6f")!.interventions as object)).toEqual([]);
    expect(result.gaps).toEqual([
      {
        option_id: "14d36e6f",
        factor_id: "a4e6cef0",
        reason: "no_stated_donor",
        covered_by_sibling: true,
      },
    ]);
  });

  it("adopts the user's own £59 when the quote names one figure and the price is the only connected factor", () => {
    const d = witnessedDraft();
    d.edges = d.edges.filter((e) => !(e.from === "14d36e6f" && e.to === "a4e6cef0"));
    d.nodes.find((n) => n.id === "14d36e6f")!.source_quote = SINGLE_FIGURE_QUOTE;

    const result = run(d);

    expect(result.gaps).toEqual([]);
    expect(result.adopted).toEqual([
      { option_id: "14d36e6f", factor_id: "6d9a37f3", raw_value: 59, donor_option_id: "7a1b95aa" },
    ]);

    // Bound by node identity, and it is the RAISE figure, not the hold figure.
    const stated = d.options.find((o) => o.id === "14d36e6f")!;
    const iv = (stated.interventions as Record<string, { value: number; raw_value: number; source: string }>)[
      "6d9a37f3"
    ];
    expect(iv.raw_value).toBe(59);
    expect(iv.value).toBe(0.59);
    expect(iv.source).toBe("brief_extraction");
    expect(Object.keys(stated.interventions as object)).toEqual(["6d9a37f3"]);
  });

  /**
   * ⛔ THE CASE AN OUTSIDE CORPUS CAUGHT, transcribed from
   * `tests/integration/model-readiness-compiler-corpus.records.test.ts` — a
   * corpus written long before this module, carrying the class this author's
   * own fixtures did not contain. The first version of this module adopted 59
   * here, collapsing a two-stage trajectory into one scalar.
   */
  it("refuses a two-stage trajectory, which is indistinguishable from the motivating case except in language", () => {
    const quote = "charging £49 now and £59 in Q2";
    const d = witnessedDraft();
    d.edges = d.edges.filter((e) => !(e.from === "14d36e6f" && e.to === "a4e6cef0"));
    d.nodes.find((n) => n.id === "14d36e6f")!.source_quote = quote;

    const result = run(d);

    expect(result.adopted).toEqual([]);
    expect(result.gaps.map((g) => g.reason)).toEqual(["quote_names_several_figures"]);
    expect(Object.keys(d.options.find((o) => o.id === "14d36e6f")!.interventions as object)).toEqual([]);
  });

  it("refuses the motivating brief's own two-figure quote, by the same rule, and says so", () => {
    const d = witnessedDraft();
    d.edges = d.edges.filter((e) => !(e.from === "14d36e6f" && e.to === "a4e6cef0"));
    // Unmodified: "increase the Pro plan price from £49 to £59 …" names {49, 59}.
    const result = run(d);

    expect(result.adopted).toEqual([]);
    expect(result.gaps.map((g) => g.reason)).toEqual(["quote_names_several_figures"]);
  });

  it("refuses the baseline's £49 for a non-baseline stated option, and the refusal is what makes the adopt clean", () => {
    const d = witnessedDraft();
    d.edges = d.edges.filter((e) => !(e.from === "14d36e6f" && e.to === "a4e6cef0"));
    // A quote naming ONE figure — 49 — so rule 5 cannot be what refuses this,
    // and the baseline ROLE filter is the only gate left standing.
    d.nodes.find((n) => n.id === "14d36e6f")!.source_quote = "hold the Pro plan price at £49";
    // Remove both non-baseline donors, leaving ONLY "Hold Price at £49" (49).
    // 49 is verbatim in the user's quote, so nothing but the role filter can
    // stop it being written onto a proposal to RAISE the price.
    d.options = d.options.filter((o) => o.id !== "7a1b95aa" && o.id !== "868f8b07");

    const result = run(d);

    expect(result.adopted).toEqual([]);
    expect(result.gaps).toEqual([
      {
        option_id: "14d36e6f",
        factor_id: "6d9a37f3",
        reason: "no_stated_donor",
        covered_by_sibling: true,
      },
    ]);
    expect(Object.keys(d.options.find((o) => o.id === "14d36e6f")!.interventions as object)).toEqual([]);
  });

  it("refuses when eligible donors disagree on the stated figure", () => {
    const d = witnessedDraft();
    d.edges = d.edges.filter((e) => !(e.from === "14d36e6f" && e.to === "a4e6cef0"));
    d.nodes.find((n) => n.id === "14d36e6f")!.source_quote = SINGLE_FIGURE_QUOTE;
    // A second non-baseline donor that says 49 rather than 59.
    (d.options.find((o) => o.id === "868f8b07")!.interventions as Record<string, unknown>)["6d9a37f3"] =
      briefIntervention(0.49, 49, "£");

    const result = run(d);

    expect(result.adopted).toEqual([]);
    expect(result.gaps.map((g) => g.reason)).toEqual(["donors_disagree"]);
  });

  it("refuses a figure that is not in the stated option's OWN quote (run03/run04)", () => {
    const d = witnessedDraft();
    d.edges = d.edges.filter((e) => !(e.from === "14d36e6f" && e.to === "a4e6cef0"));
    // The live capture's second stated option: "With the Next Pro Feature
    // Release" — wired to the price factor, and its quote carries no figure.
    // Writing £59 here would be the #1481 harm at option grain.
    const stated = d.nodes.find((n) => n.id === "14d36e6f")!;
    stated.source_quote = "With the Next Pro Feature Release";

    const result = run(d);

    expect(result.adopted).toEqual([]);
    expect(result.gaps.map((g) => g.reason)).toEqual(["figure_not_in_quote"]);
  });

  it("NEGATIVE CONTROL: a simple uncoupled alternative gains no spurious second intervention", () => {
    // "Should we increase the Pro plan price from £49 to £59 per month?" — one
    // connected factor, one stated figure, one AI sibling that also moves a
    // second factor the stated option is NOT wired to.
    const quote = "raise the Pro plan price to £59 per month";
    const nodes: AnyNode[] = [
      { id: "b4014d90", kind: "goal", label: "Reach £20k MRR" },
      { id: "6d9a37f3", kind: "factor", label: "Pro Plan Monthly Price" },
      { id: "a4e6cef0", kind: "factor", label: "Feature Release Readiness" },
      { id: "14d36e6f", kind: "option", label: quote, provenance: "from_brief", source_quote: quote, is_baseline: false, interventions: {} },
      { id: "868f8b07", kind: "option", label: "Raise Price to £59", provenance: "ai_inferred", is_baseline: false, interventions: {} },
    ];
    const options: AnyOption[] = [
      { id: "14d36e6f", label: quote, status: "needs_encoding", is_baseline: false, interventions: {} },
      {
        id: "868f8b07",
        label: "Raise Price to £59",
        status: "ready",
        is_baseline: false,
        interventions: { "6d9a37f3": briefIntervention(0.59, 59, "£"), a4e6cef0: hypothesisIntervention(0.85) },
      },
    ];
    for (const node of nodes) {
      if (node.kind !== "option") continue;
      node.interventions = options.find((o) => o.id === node.id)!.interventions;
    }
    const edges: AnyNode[] = [
      { id: "e1", from: "14d36e6f", to: "6d9a37f3", origin: "ai" },
      { id: "e5", from: "868f8b07", to: "6d9a37f3", origin: "ai" },
      { id: "e6", from: "868f8b07", to: "a4e6cef0", origin: "ai" },
    ];

    const result = run({ nodes, edges, options });

    expect(result.adopted).toEqual([
      { option_id: "14d36e6f", factor_id: "6d9a37f3", raw_value: 59, donor_option_id: "868f8b07" },
    ]);
    // THE CONTROL: exactly one key, and it is the factor the graph wired.
    const stated = options.find((o) => o.id === "14d36e6f")!;
    expect(Object.keys(stated.interventions as object)).toEqual(["6d9a37f3"]);
    expect((stated.interventions as Record<string, unknown>)["a4e6cef0"]).toBeUndefined();
  });

  it("never touches an ai_inferred option, and leaves a fully-configured draft byte-identical", () => {
    const d = witnessedDraft();
    // Give the stated option both values so nothing is outstanding anywhere.
    const stated = d.options.find((o) => o.id === "14d36e6f")!;
    (stated.interventions as Record<string, unknown>)["6d9a37f3"] = briefIntervention(0.59, 59, "£");
    (stated.interventions as Record<string, unknown>)["a4e6cef0"] = hypothesisIntervention(0.85);
    const before = JSON.stringify(d.options);

    const result = run(d);

    expect(result.adopted).toEqual([]);
    expect(result.gaps).toEqual([]);
    expect(JSON.stringify(d.options)).toBe(before);
  });

  /**
   * ⭐ THE AUTHORSHIP GATE IS LOAD-BEARING ON ITS OWN, and this case exists
   * because a mutant proved it was not otherwise pinned.
   *
   * Deleting `node.provenance !== "from_brief"` SURVIVED the rest of this
   * suite, because every `ai_inferred` option in the live captures carries no
   * `source_quote`, so the quote gate was incidentally excluding them. That
   * makes the authorship gate look redundant while it is in fact the only
   * thing standing behind an incidental property of today's producer.
   *
   * It is not a safe property to lean on: `option-rephrase-merge.ts` derived at
   * 39 banked option nodes that brief-binding is CONTAINMENT and over-claims in
   * this exact direction — "a model option whose label happens to be a brief
   * substring reads from_brief". The inverse shape (a model option that acquires
   * a quote) is the one this pins.
   */
  it("does not complete an ai_inferred option, even when it carries a quote with the figure", () => {
    const d = witnessedDraft();
    d.edges = d.edges.filter((e) => !(e.from === "14d36e6f" && e.to === "a4e6cef0"));
    // The model's own option, given the quote it does not have today.
    d.nodes.find((n) => n.id === "14d36e6f")!.source_quote = SINGLE_FIGURE_QUOTE;
    const twin = d.nodes.find((n) => n.id === "868f8b07")!;
    twin.source_quote = SINGLE_FIGURE_QUOTE;
    const twinOption = d.options.find((o) => o.id === "868f8b07")!;
    delete (twinOption.interventions as Record<string, unknown>)["6d9a37f3"];

    const result = run(d);

    // The user's option is completed; the model's twin is not, though every
    // other condition holds for it.
    expect(result.adopted.map((a) => a.option_id)).toEqual(["14d36e6f"]);
    expect((twinOption.interventions as Record<string, unknown>)["6d9a37f3"]).toBeUndefined();
  });

  it("is total: an unreadable shape yields no adoptions and no gaps rather than throwing", () => {
    expect(adoptStatedFiguresForStatedOptions({ nodes: undefined, edges: undefined, options: undefined } as never))
      .toEqual({ adopted: [], gaps: [] });
    expect(run({ nodes: [null as never], edges: [null as never], options: [null as never] }))
      .toEqual({ adopted: [], gaps: [] });
  });
});
