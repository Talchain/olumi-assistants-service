/**
 * BEHAVIOURAL WITNESS — the new served draft_graph prompt, exercised against
 * the REAL consumer.
 *
 * A prompt change with no consumer-side evidence is a hope, not a fix. This
 * file supplies the evidence, on the same brief the retired v195 prompt used
 * for its own worked example, so the two are directly comparable:
 *
 *   ARM A (v195 instructed shape) — the graph object the OLD prompt's
 *     <ANNOTATED_EXAMPLE> told the model to imitate. Read from the pinned
 *     historic bytes, not retyped.
 *   ARM B (new instructed shape) — the record set the NEW prompt plus
 *     DRAFT_RECORDS_INSTRUCTION ask for, over the SAME brief.
 *
 * Both are put through `projectDraftRecords`, the real post-LLM seam. The
 * contract violation is that A fails and B succeeds, on identical source
 * material — i.e. the served prompt was instructing the losing arm.
 *
 * ⚠ WHAT THIS IS NOT. This is a CONSUMER-side witness: it proves the shape the
 * new prompt asks for is the shape the seam accepts, and that the shape the old
 * prompt asked for is not. It does NOT prove what a live model emits when given
 * the new prompt — that needs n≥15 fresh drafts on staging and is named as
 * unsettled in the handover. Do not read this file as a live-draft witness.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { projectDraftRecords } from "../seam.js";
import {
  DRAFT_RECORD_STATED_KINDS,
  DRAFT_RECORD_CLAIM_KINDS,
  DRAFT_RECORD_EFFECTS,
} from "../grammar.js";

/** The brief the v195 <ANNOTATED_EXAMPLE> was written against, verbatim. */
const BRIEF =
  "We're deciding how to expand into the mid-market segment. Our main options " +
  "are acquiring a smaller competitor, building a dedicated mid-market product " +
  "tier, or partnering with system integrators. Our goal is to reach 200 " +
  "mid-market customers within 18 months, while keeping NRR above 110% and " +
  "monthly churn under 4%. We currently have 50 mid-market customers, 3% " +
  "monthly churn, and 18 months of runway at current burn.";

/**
 * ARM B — the same brief in the shape the NEW prompt instructs.
 *
 * Every `source_quote` below is a verbatim span of BRIEF (asserted in-test, so
 * this fixture cannot silently drift into paraphrase — the property the new
 * prompt's FINAL_AUDIT demands). Every number is the user's own; none is
 * invented, and no placeholder midpoint appears anywhere.
 */
const ARM_B_RECORDS = {
  stated_items: [
    {
      kind: "goal",
      source_quote: "reach 200 mid-market customers within 18 months",
      value: 200,
      unit: "customers",
      role: "target",
    },
    {
      kind: "figure",
      source_quote: "We currently have 50 mid-market customers",
      value: 50,
      unit: "customers",
      role: "baseline",
    },
    { kind: "option", source_quote: "acquiring a smaller competitor" },
    { kind: "option", source_quote: "building a dedicated mid-market product tier" },
    { kind: "option", source_quote: "partnering with system integrators" },
    {
      kind: "constraint",
      source_quote: "keeping NRR above 110%",
      value: 110,
      unit: "%",
      direction: "floor",
    },
    {
      kind: "constraint",
      source_quote: "monthly churn under 4%",
      value: 4,
      unit: "%",
      direction: "ceiling",
    },
    {
      kind: "figure",
      source_quote: "3% monthly churn",
      value: 3,
      unit: "%",
      role: "baseline",
    },
    {
      kind: "figure",
      source_quote: "18 months of runway at current burn",
      value: 18,
      unit: "months",
      role: "baseline",
    },
  ],
  claims: [
    // 0 — the status quo the user did not name (the WIDEN step)
    {
      claim_kind: "option_refinement",
      label: "Continue current go-to-market unchanged",
      basis: [1],
      is_baseline: true,
    },
    // 1 — a factor each option moves
    {
      claim_kind: "factor",
      label: "Mid-market customer acquisition rate",
      category: "controllable",
      basis: [1],
    },
    // 2 — execution risk
    { claim_kind: "risk", label: "Integration and execution failure", basis: [2] },
    // 3 — the outcome
    { claim_kind: "outcome", label: "Mid-market footprint established", basis: [0] },
    // 4..6 — option → factor, each carrying its own sets_to in the factor's unit
    {
      claim_kind: "causal_link",
      label: "Acquisition adds an installed base outright",
      from_stated: 2,
      to_claim: 1,
      effect: "positive",
      sets_to: 190,
      basis: [1],
    },
    {
      claim_kind: "causal_link",
      label: "Building a tier grows acquisition organically",
      from_stated: 3,
      to_claim: 1,
      effect: "positive",
      sets_to: 140,
      basis: [1],
    },
    {
      claim_kind: "causal_link",
      label: "Partnering adds integrator-sourced customers",
      from_stated: 4,
      to_claim: 1,
      effect: "positive",
      sets_to: 120,
      basis: [1],
    },
    // 7 — factor → outcome
    {
      claim_kind: "causal_link",
      label: "Acquisition rate drives footprint",
      from_claim: 1,
      to_claim: 3,
      effect: "positive",
    },
    // 8 — factor → risk
    {
      claim_kind: "causal_link",
      label: "Faster expansion strains execution",
      from_claim: 1,
      to_claim: 2,
      effect: "positive",
    },
    // 9 — outcome → goal
    {
      claim_kind: "causal_link",
      label: "Footprint reaches the customer goal",
      from_claim: 3,
      to_stated: 0,
      effect: "positive",
    },
    // 10 — risk → goal
    {
      claim_kind: "causal_link",
      label: "Execution failure threatens the goal",
      from_claim: 2,
      to_stated: 0,
      effect: "negative",
    },
  ],
};

/** Pull the worked example out of the pinned v195 bytes (ARM A). */
function v195WorkedExample(): unknown {
  const p = readFileSync(resolve(__dirname, "fixtures/served-draft-graph-v195.txt"), "utf8");
  const section = p.indexOf("<ANNOTATED_EXAMPLE>");
  const start = p.indexOf("{", section);
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < p.length; i++) {
    const c = p[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(p.slice(start, i + 1));
  }
  return null;
}

describe("behavioural witness: new instructed shape vs the consumer", () => {
  it("instrument: the fixture uses only enum values the grammar declares", () => {
    // Trap 13c: a kit validates sensitivity, never correctness. Derive the
    // expectations from the PRODUCER's enums so this fixture cannot assert a
    // vocabulary the grammar does not have.
    for (const s of ARM_B_RECORDS.stated_items) {
      expect(DRAFT_RECORD_STATED_KINDS as readonly string[]).toContain(s.kind);
    }
    for (const c of ARM_B_RECORDS.claims) {
      expect(DRAFT_RECORD_CLAIM_KINDS as readonly string[]).toContain(c.claim_kind);
      if ("effect" in c && c.effect !== undefined) {
        expect(DRAFT_RECORD_EFFECTS as readonly string[]).toContain(c.effect);
      }
    }
  });

  it("every source_quote is VERBATIM from the brief", () => {
    // The new prompt's central promise about the user's own words. A fixture
    // that paraphrased would prove the wrong thing.
    for (const s of ARM_B_RECORDS.stated_items) {
      expect(BRIEF).toContain(s.source_quote);
    }
  });

  it("every stated value is the USER's number — no invented placeholder", () => {
    // The retired prompt taught `0.5` for an unknown baseline, twice. Assert the
    // property that rule violated: each stated value appears in the brief.
    for (const s of ARM_B_RECORDS.stated_items) {
      if (typeof s.value === "number") {
        expect(BRIEF).toMatch(new RegExp(`\\b${s.value}\\b`));
        expect(s.value).not.toBe(0.5);
      }
    }
  });

  it("ARM A (v195 instructed shape) is REJECTED by the seam", () => {
    const result = projectDraftRecords(v195WorkedExample());
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("graph_shaped_response");
  });

  it("ARM B (new instructed shape) is ACCEPTED and projects to a usable graph", () => {
    const result = projectDraftRecords(ARM_B_RECORDS);
    expect(result.ok).toBe(true);
    // Narrow on the discriminant rather than casting: a cast would also silence
    // a genuine shape change in the seam's own result type.
    if (result.ok !== true) throw new Error("unreachable: asserted above");

    const graph = result.projection.graph as unknown as {
      nodes: Array<Record<string, any>>;
    };

    // ⚠ BIND BY IDENTITY, NEVER BY A VALUE PREDICATE (trap 19). An earlier
    // revision of this test asserted `JSON.stringify(graph).includes("50")` and
    // PASSED — on `goal_threshold_cap: 250` and on a prose reasoning string,
    // while the user's stated 50 was not in the graph at all. A substring probe
    // over a serialised object will find a number somewhere and call it success.
    const goal = graph.nodes.find((n: any) => n.kind === "goal");
    if (!goal) throw new Error("no goal node in projection");
    expect(goal.provenance.provenance_class).toBe("stated");
    expect(goal.provenance.source_quote).toBe(
      "reach 200 mid-market customers within 18 months",
    );
    // The user's own target number survives, in the user's own unit.
    expect(goal.goal_threshold_raw).toBe(200);
    expect(goal.goal_threshold_unit).toBe("customers");

    // Each option node is the user's own span, verbatim, marked as theirs.
    const options = graph.nodes.filter((n: any) => n.kind === "option");
    const statedOptionLabels = options
      .filter((o: any) => o.provenance?.provenance_class === "stated")
      .map((o: any) => o.label)
      .sort();
    expect(statedOptionLabels).toEqual([
      "acquiring a smaller competitor",
      "building a dedicated mid-market product tier",
      "partnering with system integrators",
    ]);
    // Plus the status quo the WIDEN step added — recorded as the model's, not
    // the user's, which is the provenance line the new prompt is built around.
    expect(options.length).toBe(4);

    // Each option's effect reaches the graph as the estimate this lane gave it,
    // and is attributed to CEE rather than to the user.
    const acquire = options.find(
      (o: any) => o.label === "acquiring a smaller competitor",
    );
    if (!acquire) throw new Error("no acquire option in projection");
    const raw = Object.values(acquire.data.raw_interventions)[0];
    expect(raw).toBe(190);
    const detail: any = Object.values(acquire.data.intervention_details)[0];
    expect(detail.source).toBe("cee_hypothesis");
  });

  it("KNOWN-DROPPED SET: pinned exactly, so it reds if it grows OR shrinks", () => {
    // Trap 22f's honest-gap pattern. This fixture deliberately does not chain
    // every stated figure to the goal, and the projector drops what cannot
    // reach it. Recording the exact set keeps the suite green for the RIGHT
    // reason — an unpinned drop is how a silent capability loss ships.
    const result = projectDraftRecords(ARM_B_RECORDS);
    expect(result.ok).toBe(true);
    if (result.ok !== true) throw new Error("unreachable: asserted above");

    const dropped = result.projection.dropped
      .map((d) => `${String(d.reason)}:${String(d.label)}`)
      .sort();
    expect(dropped).toEqual(
      [
        "stated_target_value_dropped:reach 200 mid-market customers within 18 months",
        "unconnected_to_goal:We currently have 50 mid-market customers",
        "unconnected_to_goal:keeping NRR above 110%",
        "unconnected_to_goal:monthly churn under 4%",
        "unconnected_to_goal:3% monthly churn",
        "unconnected_to_goal:18 months of runway at current burn",
      ].sort(),
    );
  });
});
