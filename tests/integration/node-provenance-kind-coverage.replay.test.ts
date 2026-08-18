/**
 * ⭐⭐ ROW 2.1205 — `from_brief` IS REACHABLE FOR ONE NODE KIND ONLY.
 *
 * ── THE DEFECT, MEASURED ON BANKED CAPTURES, NOT IMAGINED ──────────────────
 * 201 nodes across four capture runs and six briefs
 * (`olumi-docs/PHASE0-EVIDENCE-2026-07-28/closing-witness-20260814/driver/
 *   captures-<run>/captures/<arm>/committed-graph.json`):
 *
 *   option/from_brief    20        risk/ai_inferred      37
 *   option/ai_inferred   38        outcome/ai_inferred   26
 *                                  goal/ai_inferred      16
 *                                  factor/ai_inferred    48
 *                                  decision/ai_inferred  16
 *
 * **Every `from_brief` in the corpus is an option.** 47 of the 201 nodes carry a
 * label that is VERBATIM brief text and are stamped `ai_inferred` — including
 * 16/16 goals, one of which is the user's own sentence *"Our aim is to raise our
 * average seat price"*.
 *
 * Cause, at the bytes: `schema-v3.ts` derives node provenance from
 * `extractionType`, a FACTOR-ONLY field ("Decisions/options/goals fall through
 * to the ai_inferred default", its own comment) — and root 4 later added a
 * brief-bytes derivation for OPTIONS ONLY. Every other kind is structurally
 * unreachable for the badge.
 *
 * ── ⚠ THE PREMISE THIS SPEC DOES **NOT** ASSERT ────────────────────────────
 * The row was written from DOM-3, where the user's stated risk surfaced as a
 * node labelled `Revenue Lost During Cutover` — a title-cased PARAPHRASE of
 * *"losing revenue during the cutover"*. Containment cannot tie a paraphrase to
 * brief bytes, and **nothing here tries to**: a fuzzy match that manufactured a
 * `from_brief` badge would be fabricated provenance, the same sin in the other
 * direction, and would reopen the audit class `brief-binding.ts` exists to
 * close. That node keeps `ai_inferred`, and the KNOWN-DROPPED case below pins it
 * so the gap is visible in the suite rather than invisible to it.
 *
 * What IS fixed is the structural half: a node whose label is bytes the user
 * actually wrote earns the badge WHATEVER ITS KIND — which is how a user-stated
 * hazard reaches a correctly-badged risk node, because the grammar carries it
 * through the `constraint` stated channel where the node's label IS the quote
 * (`projector.ts:1614`), and `NODE_KIND_MAP` maps `constraint → risk`.
 *
 * ── SCOPE, DELIBERATELY BOUNDED: FACTORS ARE NOT INCLUDED ──────────────────
 * A factor is VALUE-BEARING, and a label-only test says nothing about its
 * number. `bindStatedItemToBrief` verifies a figure's value INSIDE its quote
 * precisely because an exact quote carrying a contradicted value ("Churn is 10
 * percent", value 90) is the audit's finding 2. Extending label containment to
 * factors would certify the label and silently re-admit that class. Factors keep
 * their existing value-aware path (`mayClaimFromBrief`), and the twin below
 * asserts they are UNCHANGED — so this decision is pinned, not assumed.
 */
import { describe, expect, it } from "vitest";

import { transformResponseToV3 } from "../../src/cee/transforms/index.js";
import type { V1DraftGraphResponse } from "../../src/cee/transforms/index.js";
import { NodeV3 } from "../../src/schemas/cee-v3.js";

/** Verbatim from the closing witness's own driver (`driver/briefs.mjs:78-82`). */
const BRIEF_PRICING =
  "Should we hold our seat price at £42, raise it to £49 per seat, or raise it to £59 per seat? " +
  "Our aim is to raise our average seat price. Today it is £42 per seat and our monthly " +
  "recurring revenue is £250,000. I want to reach £59 per seat within two quarters. " +
  "Churn is running at 4% and our annual support cost is £120,000.";

/** Verbatim from the closing witness's DOM arm (`driver/dom-driver.mjs:69-72`). */
const BRIEF_RISK =
  "Should we migrate our billing system to Stripe this quarter, or stay on the in-house one? " +
  "The risk I am most worried about is losing revenue during the cutover — that is my own concern, " +
  "not a generic one. " +
  "Annual billing volume is £4,000,000 and the migration would take about eight weeks.";

/**
 * The P2 post-deploy draw, transcribed node-for-node from
 * `captures-postbatch-20260814T153430Z/captures/P2/committed-graph.json`.
 * Ids, kinds and labels are the capture's own; nothing is invented.
 */
function pricingReplay(): V1DraftGraphResponse {
  return {
    graph: {
      nodes: [
        { id: "3ea21b47", kind: "decision", label: "Decision" },
        { id: "987198bf", kind: "option", label: "hold our seat price at £42" },
        { id: "c3441206", kind: "option", label: "raise it to £49 per seat" },
        { id: "2efbecdf", kind: "option", label: "raise it to £59 per seat" },
        { id: "d1344ba3", kind: "factor", label: "Seat Price", category: "controllable" },
        { id: "19d5a529", kind: "factor", label: "Annual Support Cost", category: "external" },
        { id: "94fa174b", kind: "outcome", label: "Monthly Recurring Revenue" },
        { id: "147a2bbc", kind: "outcome", label: "Average Seat Price Achievement" },
        { id: "98e9856a", kind: "risk", label: "Support Cost Pressure" },
        { id: "ef885649", kind: "risk", label: "Customer Churn Acceleration" },
        { id: "53f00f32", kind: "risk", label: "Time-to-Target Constraint" },
        { id: "957ac013", kind: "goal", label: "Our aim is to raise our average seat price" },
      ],
      edges: [
        { from: "3ea21b47", to: "987198bf", weight: 1, belief: 1 },
        { from: "3ea21b47", to: "c3441206", weight: 1, belief: 1 },
        { from: "3ea21b47", to: "2efbecdf", weight: 1, belief: 1 },
        { from: "987198bf", to: "d1344ba3", weight: 1, belief: 1 },
        { from: "c3441206", to: "d1344ba3", weight: 1, belief: 1 },
        { from: "2efbecdf", to: "d1344ba3", weight: 1, belief: 1 },
        { from: "d1344ba3", to: "94fa174b", weight: 0.8, belief: 0.9 },
        { from: "d1344ba3", to: "147a2bbc", weight: 0.8, belief: 0.9 },
        { from: "19d5a529", to: "94fa174b", weight: 0.4, belief: 0.8 },
        { from: "19d5a529", to: "98e9856a", weight: 0.5, belief: 0.8 },
        { from: "d1344ba3", to: "ef885649", weight: 0.5, belief: 0.8 },
        { from: "d1344ba3", to: "53f00f32", weight: 0.5, belief: 0.8 },
        { from: "94fa174b", to: "957ac013", weight: 1, belief: 1 },
        { from: "147a2bbc", to: "957ac013", weight: 1, belief: 1 },
      ],
      meta: { roots: ["3ea21b47"], leaves: ["957ac013"], source: "assistant" },
    },
    quality: { overall: 8, structure: 8, coverage: 8, structural_proxy: 8 },
    trace: { request_id: "replay-p2-provenance", correlation_id: "replay" },
  } as unknown as V1DraftGraphResponse;
}

/**
 * A user-stated hazard as the STATED-CONSTRAINT channel delivers it: the node's
 * label IS the user's own quote (`projector.ts:1614`), and `constraint → risk`.
 * This is the shape DOM-3's brief produces when the model files the hazard as a
 * stated item rather than as a claim.
 */
function statedRiskReplay(): V1DraftGraphResponse {
  return {
    graph: {
      nodes: [
        { id: "dec", kind: "decision", label: "Decision" },
        { id: "opt_a", kind: "option", label: "migrate our billing system to Stripe this quarter" },
        { id: "opt_b", kind: "option", label: "stay on the in-house one" },
        { id: "fac", kind: "factor", label: "Cutover Complexity", category: "controllable" },
        { id: "out", kind: "outcome", label: "Billing Continuity" },
        {
          id: "risk_stated",
          kind: "risk",
          label: "The risk I am most worried about is losing revenue during the cutover",
        },
        // The negative twin: the model's own paraphrase of the SAME hazard.
        { id: "risk_paraphrase", kind: "risk", label: "Revenue Lost During Cutover" },
        { id: "goal", kind: "goal", label: "Billing Migration Success" },
      ],
      edges: [
        { from: "dec", to: "opt_a", weight: 1, belief: 1 },
        { from: "dec", to: "opt_b", weight: 1, belief: 1 },
        { from: "opt_a", to: "fac", weight: 1, belief: 1 },
        { from: "opt_b", to: "fac", weight: 1, belief: 1 },
        { from: "fac", to: "out", weight: 0.8, belief: 0.9 },
        { from: "fac", to: "risk_stated", weight: 0.6, belief: 0.8 },
        { from: "fac", to: "risk_paraphrase", weight: 0.6, belief: 0.8 },
        { from: "out", to: "goal", weight: 1, belief: 1 },
      ],
      meta: { roots: ["dec"], leaves: ["goal"], source: "assistant" },
    },
    quality: { overall: 8, structure: 8, coverage: 8, structural_proxy: 8 },
    trace: { request_id: "replay-dom3-provenance", correlation_id: "replay" },
  } as unknown as V1DraftGraphResponse;
}

type ProvByLabel = ReadonlyMap<string, { kind: string; provenance: unknown }>;

function provenanceByLabel(
  response: V1DraftGraphResponse,
  brief: string,
): ProvByLabel {
  const v3 = transformResponseToV3(response, { brief });
  const out = new Map<string, { kind: string; provenance: unknown }>();
  for (const n of v3.nodes as unknown as ReadonlyArray<Record<string, unknown>>) {
    out.set(String(n.label), { kind: String(n.kind), provenance: n.provenance });
  }
  return out;
}

describe("row 2.1205 — a node whose label is the user's own words earns from_brief, whatever its kind", () => {
  const pricing = provenanceByLabel(pricingReplay(), BRIEF_PRICING);

  // ── The precondition this whole file rests on. Without it every assertion
  // below could pass because the transform ran on nothing (trap 13b: a
  // discriminator must pin its own precondition in-test).
  it("PRECONDITION — the replay produced every transcribed node", () => {
    expect(pricing.size).toBe(12);
  });

  // ⭐ THE DEFECT. Bound by IDENTITY — the exact label, not a predicate another
  // node could satisfy (trap 19).
  it("a GOAL that is the user's own sentence is from_brief", () => {
    const goal = pricing.get("Our aim is to raise our average seat price");
    expect(goal?.kind).toBe("goal");
    expect(goal?.provenance).toBe("from_brief");
  });

  it("an OUTCOME named in the user's own words is from_brief", () => {
    const outcome = pricing.get("Monthly Recurring Revenue");
    expect(outcome?.kind).toBe("outcome");
    expect(outcome?.provenance).toBe("from_brief");
  });

  // ── OPPOSITE-DIRECTION TWINS. Every one of these labels is the MODEL's own
  // coinage and appears nowhere in the brief. A fix that widened the predicate
  // instead of widening the CALLER SET would flip these too, and inventing
  // provenance is the worse of the two harms (trap 22b).
  it.each([
    ["Average Seat Price Achievement", "outcome"],
    ["Support Cost Pressure", "risk"],
    ["Customer Churn Acceleration", "risk"],
    ["Time-to-Target Constraint", "risk"],
    ["Decision", "decision"],
  ])("TWIN — the model's own coinage %s (%s) stays ai_inferred", (label, kind) => {
    const node = pricing.get(label);
    expect(node?.kind).toBe(kind);
    expect(node?.provenance).toBe("ai_inferred");
  });

  // ── KIND-SCOPE TWIN. "annual support cost" and "seat price" ARE verbatim
  // brief text, and these two nodes deliberately do NOT flip: a factor is
  // value-bearing and a label-only test certifies nothing about its number.
  // If a later lane extends the badge to factors it must do so through the
  // VALUE-AWARE authority, and this test is the RED that says so.
  it.each([
    ["Annual Support Cost"],
    ["Seat Price"],
  ])("KIND-SCOPE — the value-bearing factor %s is not certified by its label alone", (label) => {
    const node = pricing.get(label);
    expect(node?.kind).toBe("factor");
    expect(node?.provenance).toBe("ai_inferred");
  });

  // ── ROOT-4 CONTROL. The option path must be byte-identical. If this REDs, the
  // change disturbed shipped behaviour rather than extending it.
  it.each([
    ["hold our seat price at £42"],
    ["raise it to £49 per seat"],
    ["raise it to £59 per seat"],
  ])("CONTROL — the option %s keeps from_brief", (label) => {
    const node = pricing.get(label);
    expect(node?.kind).toBe("option");
    expect(node?.provenance).toBe("from_brief");
  });
});

describe("row 2.1205 — DOM-3's hazard: the stated channel is badged, the paraphrase is not", () => {
  const risky = provenanceByLabel(statedRiskReplay(), BRIEF_RISK);

  it("PRECONDITION — the replay produced every transcribed node", () => {
    expect(risky.size).toBe(8);
  });

  // ⭐ What the fix buys on DOM-3's own brief: the user's stated hazard, carried
  // by the channel that preserves their words, is no longer stamped as Olumi's.
  it("a RISK whose label is the user's own sentence is from_brief", () => {
    const node = risky.get(
      "The risk I am most worried about is losing revenue during the cutover",
    );
    expect(node?.kind).toBe("risk");
    expect(node?.provenance).toBe("from_brief");
  });

  /**
   * ⭐⭐ KNOWN-DROPPED, AND THE HONEST WAY TO SHIP A GAP.
   *
   * This is the node DOM-3 actually witnessed. `Revenue Lost During Cutover` is
   * the model's paraphrase of a sentence the user did write, and containment
   * cannot tie it to brief bytes. It stays `ai_inferred` BY DECISION.
   *
   * The test REDs if the class grows (a paraphrase starts being certified —
   * fabricated provenance) AND if it shrinks (someone finds a deterministic
   * span-binding that recovers it). On that day this RED is the instruction to
   * delete the test, not to loosen it.
   */
  it("KNOWN-DROPPED — the model's paraphrase of the same hazard stays ai_inferred", () => {
    const node = risky.get("Revenue Lost During Cutover");
    expect(node?.kind).toBe("risk");
    expect(node?.provenance).toBe("ai_inferred");
  });

  it("CONTROL — both options still earn from_brief on this brief", () => {
    expect(risky.get("migrate our billing system to Stripe this quarter")?.provenance).toBe(
      "from_brief",
    );
    expect(risky.get("stay on the in-house one")?.provenance).toBe("from_brief");
  });
});

describe("row 2.1205 — a VALUE-BEARING node declines the badge, whatever its kind", () => {
  /**
   * The kind list says WHICH nodes may be badged from their label; this guard
   * says WHEN, and it is derived from the node rather than assumed from its
   * kind. Without it, a goal that acquires a threshold or an outcome that
   * acquires a prior would start claiming the user's authorship for a number
   * the user never gave — the audit's finding-2 class arriving through a kind
   * nobody was watching.
   *
   * Both nodes below carry a label that IS verbatim brief text, so the ONLY
   * thing standing between them and a `from_brief` badge is the value guard.
   */
  function valueBearingReplay(): V1DraftGraphResponse {
    return {
      graph: {
        nodes: [
          { id: "dec", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "hold our seat price at £42" },
          { id: "opt_b", kind: "option", label: "raise it to £49 per seat" },
          { id: "fac", kind: "factor", label: "Seat Price", category: "controllable" },
          // Verbatim brief text, but carrying a prior.
          {
            id: "out_valued",
            kind: "outcome",
            label: "Monthly Recurring Revenue",
            prior: { distribution: "uniform", range_min: 0.2, range_max: 0.8 },
          },
          // Verbatim brief text, but carrying a threshold.
          {
            id: "goal_valued",
            kind: "goal",
            label: "Our aim is to raise our average seat price",
            goal_threshold_raw: 59,
            goal_threshold: 0.59,
          },
        ],
        edges: [
          { from: "dec", to: "opt_a", weight: 1, belief: 1 },
          { from: "dec", to: "opt_b", weight: 1, belief: 1 },
          { from: "opt_a", to: "fac", weight: 1, belief: 1 },
          { from: "opt_b", to: "fac", weight: 1, belief: 1 },
          { from: "fac", to: "out_valued", weight: 0.8, belief: 0.9 },
          { from: "out_valued", to: "goal_valued", weight: 1, belief: 1 },
        ],
        meta: { roots: ["dec"], leaves: ["goal_valued"], source: "assistant" },
      },
      quality: { overall: 8, structure: 8, coverage: 8, structural_proxy: 8 },
      trace: { request_id: "replay-value-bearing", correlation_id: "replay" },
    } as unknown as V1DraftGraphResponse;
  }

  const valued = provenanceByLabel(valueBearingReplay(), BRIEF_PRICING);

  it("PRECONDITION — the two value-bearing nodes are present", () => {
    expect(valued.get("Monthly Recurring Revenue")?.kind).toBe("outcome");
    expect(valued.get("Our aim is to raise our average seat price")?.kind).toBe("goal");
  });

  it("an OUTCOME carrying a prior is not badged from its label", () => {
    expect(valued.get("Monthly Recurring Revenue")?.provenance).toBe("ai_inferred");
  });

  it("a GOAL carrying a threshold is not badged from its label", () => {
    expect(valued.get("Our aim is to raise our average seat price")?.provenance).toBe(
      "ai_inferred",
    );
  });

  // ⭐ THE DISCRIMINATING HALF. Identical labels, identical brief, identical
  // kinds — the ONLY difference is the value. Without this pair the two
  // assertions above could pass because the badge never worked at all.
  it("DISCRIMINATOR — the same labels WITHOUT a value do earn the badge", () => {
    const bare = provenanceByLabel(pricingReplay(), BRIEF_PRICING);
    expect(bare.get("Monthly Recurring Revenue")?.provenance).toBe("from_brief");
    expect(bare.get("Our aim is to raise our average seat price")?.provenance).toBe("from_brief");
  });
});

describe("row 2.1205 — F1: a single word is not evidence of authorship", () => {
  /**
   * ⭐⭐ THE FABRICATION-DIRECTION DEFECT, FOUND AT REVIEW AND MEASURED THROUGH
   * THE FULL TRANSFORM.
   *
   * On an ordinary brief the scaffold node labelled `Decision` and the model's
   * own one-word nodes `Churn`, `Growth` and `Revenue` all came back
   * **`from_brief`** — four fabricated authorship claims on one draw, in exactly
   * the class this loop exists to close.
   *
   * `MIN_QUOTE_CHARS = 3` is a DEGENERACY floor and says so itself: *"A single
   * common word ('the') clears three characters and would still be contained by
   * coincidence."* It was calibrated for OPTION labels, which are phrases by
   * construction; this loop pointed it at kinds where a single-token label is
   * the norm (16/16 banked decision nodes are labelled exactly `Decision`).
   *
   * ⚠ WHY THE BANKED CORPUS MISSED IT: none of the six briefs contains the word
   * "decision". A corpus drawn from captures is still a corpus with a shape — it
   * bounds what the product HAS emitted, not what the predicate WOULD accept.
   */
  const F1_BRIEF =
    "Should we hire two engineers or hold headcount? This is a big decision for us. " +
    "We worry about churn, want growth, and need more revenue.";

  function singleTokenReplay(): V1DraftGraphResponse {
    return {
      graph: {
        nodes: [
          { id: "dec", kind: "decision", label: "Decision" },
          { id: "o1", kind: "option", label: "hire two engineers" },
          { id: "o2", kind: "option", label: "hold headcount" },
          { id: "r1", kind: "risk", label: "Churn" },
          { id: "out1", kind: "outcome", label: "Growth" },
          { id: "out2", kind: "outcome", label: "Revenue" },
          { id: "f1", kind: "factor", label: "Headcount", category: "controllable" },
          { id: "g", kind: "goal", label: "want growth" },
        ],
        edges: [
          { from: "dec", to: "o1", weight: 1, belief: 1 },
          { from: "dec", to: "o2", weight: 1, belief: 1 },
          { from: "o1", to: "f1", weight: 1, belief: 1 },
          { from: "o2", to: "f1", weight: 1, belief: 1 },
          { from: "f1", to: "out1", weight: 0.8, belief: 0.9 },
          { from: "f1", to: "out2", weight: 0.8, belief: 0.9 },
          { from: "f1", to: "r1", weight: 0.5, belief: 0.8 },
          { from: "out1", to: "g", weight: 1, belief: 1 },
        ],
        meta: { roots: ["dec"], leaves: ["g"], source: "assistant" },
      },
      quality: { overall: 8, structure: 8, coverage: 8, structural_proxy: 8 },
      trace: { request_id: "replay-f1-single-token", correlation_id: "replay" },
    } as unknown as V1DraftGraphResponse;
  }

  const f1 = provenanceByLabel(singleTokenReplay(), F1_BRIEF);

  // PRECONDITION — the brief really does contain every one of these words, so a
  // pass below is the ELIGIBILITY guard's doing and not a fixture that stopped
  // reproducing the case (trap 13b).
  it.each([["decision"], ["churn"], ["growth"], ["revenue"]])(
    "PRECONDITION — the brief contains the word %s, so containment WOULD match",
    (word) => {
      expect(F1_BRIEF.toLowerCase()).toContain(word);
    },
  );

  it.each([
    ["Decision", "decision"],
    ["Churn", "risk"],
    ["Growth", "outcome"],
    ["Revenue", "outcome"],
  ])("⭐ the single-token label %s (%s) does NOT earn from_brief", (label, kind) => {
    const node = f1.get(label);
    expect(node?.kind).toBe(kind);
    expect(node?.provenance).toBe("ai_inferred");
  });

  // ⭐ THE DISCRIMINATING TWIN. Without it, the four assertions above could pass
  // because the badge stopped working altogether rather than because a single
  // token is ineligible.
  it("TWIN — a MULTI-WORD verbatim label on the same brief still earns from_brief", () => {
    const goal = f1.get("want growth");
    expect(goal?.kind).toBe("goal");
    expect(goal?.provenance).toBe("from_brief");
  });

  // ⭐ ROOT-4 CONTROL AT THE ELIGIBILITY SEAM. The fix is caller-side, so option
  // provenance must be untouched — including options that are themselves short.
  it.each([["hire two engineers"], ["hold headcount"]])(
    "CONTROL — the option %s is unaffected by the eligibility condition",
    (label) => {
      expect(f1.get(label)?.provenance).toBe("from_brief");
    },
  );
});

describe("row 2.1205 — F2: `intercept` is value-bearing, and the field list is pinned", () => {
  /**
   * `intercept` (`cee-v3.ts:193`) is model-emittable and forwarded to the wire,
   * and the first version of the value guard omitted it — so a label-verbatim
   * node carrying ONLY a model-authored intercept earned the badge for a number
   * the user never gave.
   *
   * ⚠ THE GUARD IS A HAND-MAINTAINED MIRROR AND CANNOT BE DERIVED: the schema
   * marks no field as "value-bearing". What CAN be derived is the schema's KEY
   * SET, so the completeness twin below REDs the day a new node field lands —
   * turning a silent omission into a forced decision.
   */
  function interceptReplay(): V1DraftGraphResponse {
    return {
      graph: {
        nodes: [
          { id: "dec", kind: "decision", label: "Decision" },
          { id: "opt_a", kind: "option", label: "hold our seat price at £42" },
          { id: "opt_b", kind: "option", label: "raise it to £49 per seat" },
          { id: "fac", kind: "factor", label: "Seat Price", category: "controllable" },
          // Verbatim brief text, carrying ONLY a model-authored intercept.
          { id: "out_i", kind: "outcome", label: "Monthly Recurring Revenue", intercept: 0.42 },
          { id: "goal", kind: "goal", label: "Our aim is to raise our average seat price" },
        ],
        edges: [
          { from: "dec", to: "opt_a", weight: 1, belief: 1 },
          { from: "dec", to: "opt_b", weight: 1, belief: 1 },
          { from: "opt_a", to: "fac", weight: 1, belief: 1 },
          { from: "opt_b", to: "fac", weight: 1, belief: 1 },
          { from: "fac", to: "out_i", weight: 0.8, belief: 0.9 },
          { from: "out_i", to: "goal", weight: 1, belief: 1 },
        ],
        meta: { roots: ["dec"], leaves: ["goal"], source: "assistant" },
      },
      quality: { overall: 8, structure: 8, coverage: 8, structural_proxy: 8 },
      trace: { request_id: "replay-intercept", correlation_id: "replay" },
    } as unknown as V1DraftGraphResponse;
  }

  it("an OUTCOME carrying only a model-authored intercept is not badged", () => {
    const withIntercept = provenanceByLabel(interceptReplay(), BRIEF_PRICING);
    expect(withIntercept.get("Monthly Recurring Revenue")?.provenance).toBe("ai_inferred");
  });

  it("DISCRIMINATOR — the same label WITHOUT an intercept does earn the badge", () => {
    const bare = provenanceByLabel(pricingReplay(), BRIEF_PRICING);
    expect(bare.get("Monthly Recurring Revenue")?.provenance).toBe("from_brief");
  });

  /**
   * ⭐ COMPLETENESS TWIN — derived from the schema, not mirrored from it.
   *
   * A derived guard proves AGREEMENT and can never prove COMPLETENESS
   * (trap 12d), and this list is exactly the short-list case. Pinning the
   * schema's key set means a new node field cannot arrive without someone
   * answering "is it value-bearing?" — which is the question `intercept` got to
   * skip.
   *
   * On RED: add the new key here, and add it to `carriesValue` in
   * `schema-v3.ts` IF it can carry a model-authored value.
   *
   * ── DECISION RECORDED, 18 Aug: `source_quote` + `label_authored` ──────────
   * Added for the authored-node-label ruling (quality bar §8 A1). The guard's
   * question is answered explicitly, both ways:
   *   · NOT value-bearing. Neither carries a model-authored quantity — one is
   *     the user's own words, the other a boolean about the display string —
   *     so neither belongs in `carriesValue`, whose job is to withhold the
   *     label-match provenance upgrade from a node that already asserts a
   *     number.
   *   · And they could not reach it in any case: both are written on the TYPED
   *     record path (`schema-v3.ts:1121-1136`), which `continue`s before
   *     `carriesValue` is evaluated.
   */
  it("the NodeV3 key set is unchanged — a new field forces a value-bearing decision", () => {
    expect(Object.keys(NodeV3.shape).sort()).toEqual([
      "category",
      "description",
      "display_value",
      "encoding_map",
      "extractionType",
      "factor_type",
      "goal_threshold",
      "goal_threshold_cap",
      "goal_threshold_frame",
      "goal_threshold_raw",
      "goal_threshold_unit",
      "id",
      "intercept",
      "interventions",
      "is_baseline",
      "kind",
      "label",
      "label_authored",
      "observed_state",
      "prior",
      "provenance",
      "source_quote",
      "uncertainty_drivers",
    ]);
  });
});

describe("row 2.1205 — the badge is declined when there is no brief to check against", () => {
  // `unchecked` and `unverified` are different facts and both decline the badge
  // (`brief-binding.ts`). A transform with no brief must never certify.
  it("no brief supplied ⇒ every kind stays ai_inferred", () => {
    const v3 = transformResponseToV3(pricingReplay(), {});
    for (const n of v3.nodes as unknown as ReadonlyArray<Record<string, unknown>>) {
      expect(n.provenance).toBe("ai_inferred");
    }
  });
});
