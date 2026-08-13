/**
 * ⭐⭐ THE R1 AUDIT'S EIGHT FINDINGS, AS REGRESSION TESTS.
 *
 * ── PROVENANCE OF THIS FILE, WHICH IS THE POINT ────────────────────────────
 * Every case below is an EXTERNAL AUDITOR'S repro, not one of ours. Each was
 * first written to demonstrate the DEFECT and was GREEN at
 * `335a93804c2829abbd34ed5b897f0e56dbf1d226` — 12 tests, three files, all
 * passing, alongside a fully green records suite. What is asserted here is the
 * inverse: the CORRECT behaviour, so each test is RED at that commit and green
 * after the fix.
 *
 * That pairing matters more than either half. The auditor's repro proves the
 * defect was real; this file proves the fix is load-bearing. A corpus drawn from
 * the author's head cannot see the class the author did not imagine (trap 22),
 * and the whole reason these eight got through is that OUR suite could not see
 * them — it proved implementation mechanics while the invariants went unwatched.
 *
 * ── WHAT R1 ACTUALLY GUARANTEED, STATED SO IT IS NOT MIS-READ AGAIN ────────
 * R1 makes it structurally impossible for the MODEL to CLAIM false provenance:
 * the grammar gives it no provenance channel at all. That property held, and it
 * is what our gate tested. It does NOT make it impossible for unsupported
 * content to ACQUIRE true-looking provenance by entering the stated channel —
 * and that is what the badge is read as promising. Two questions under one name
 * (trap 21); the gate answered the first and was named for the second.
 */
import { describe, expect, it } from "vitest";
import {
  completionRegressesProtectedContent,
  enumerateCompletionAsk,
  mergeCompletionClaims,
  shouldKeepCompletion,
} from "../completion.js";
import { projectRecordsToGraph } from "../projector.js";
import { projectDraftRecords } from "../seam.js";
import { transformNodeToV3, transformResponseToV3 } from "../../../transforms/schema-v3.js";
import { CEEGraphResponseV3 } from "../../../../schemas/cee-v3.js";
import type { DraftRecordSet } from "../grammar.js";
import { BUCKET_C_CODES } from "../../../unified-pipeline/stages/repair/bucket-c-codes.js";

function project(records: unknown, brief?: string) {
  const seam = projectDraftRecords(records, brief);
  expect(seam.ok, "fixture must project").toBe(true);
  if (!seam.ok) throw new Error(seam.detail);
  return seam.projection;
}

// ───────────────────────────────────────────────────────────────────────────
describe("ROOT 1 — a stated item earns `from_brief` only when the brief bears it", () => {
  /**
   * FINDING 1. The auditor put a figure the brief never mentions into
   * `stated_items` and it left the pipeline badged `from_brief`. Note that the
   * record is perfectly well-formed — which is exactly why the shipped 2.972
   * gate could not catch it: that gate asks whether a LABEL and a NUMBER are
   * present, a question about shape, and the fabrication's shape was flawless.
   */
  it("unsupported content entering stated_items does NOT leave as from_brief", () => {
    const brief = "Choose between Office A and Office B based on commute time.";
    const records = {
      stated_items: [
        { kind: "goal", source_quote: "Choose an office" },
        { kind: "option", source_quote: "Office A" },
        { kind: "option", source_quote: "Office B" },
        { kind: "figure", source_quote: "Revenue is 10 million pounds", value: 10_000_000, unit: "GBP" },
      ],
      claims: [
        { claim_kind: "causal_link", label: "Revenue affects the choice", from_stated: 3, to_stated: 0 },
      ],
    };
    // Precondition pinned IN-TEST, so this cannot pass by the fixture quietly
    // ceasing to be a fabrication (trap 13b — a discriminator must pin its own
    // precondition, or its discriminating power is unguarded at rest).
    expect(brief).not.toContain("Revenue is 10 million pounds");

    const projection = project(records, brief);
    const node = projection.graph.nodes.find((n) => n.label === "Revenue is 10 million pounds");
    expect(node, "the content is KEPT — only the attribution is withdrawn").toBeDefined();
    expect(projection.provenance[node!.id]?.brief_binding).toBe("unverified");
    expect(transformNodeToV3(node as never).provenance).toBe("ai_inferred");
  });

  /**
   * FINDING 2, and it is the one that proves the quote alone is not enough. The
   * quote is EXACT — it occurs in the brief verbatim — while the value attached
   * to it contradicts the brief outright. Verifying the words and not the number
   * would certify this.
   */
  it("an exact quote carrying a CONTRADICTED value does NOT read from_brief", () => {
    const brief = "We need to reduce churn. Churn is 10 percent today. We can improve onboarding or keep onboarding.";
    const records = {
      stated_items: [
        { kind: "goal", source_quote: "Reduce churn" },
        { kind: "option", source_quote: "Improve onboarding" },
        { kind: "option", source_quote: "Keep onboarding" },
        { kind: "figure", source_quote: "Churn is 10 percent", value: 90, unit: "%" },
      ],
      claims: [
        { claim_kind: "causal_link", label: "Current churn bears on goal", from_stated: 3, to_stated: 0 },
      ],
    };
    // The quote half genuinely holds — that is the whole difficulty of this case.
    expect(brief).toContain("Churn is 10 percent");

    const projection = project(records, brief);
    const node = projection.graph.nodes.find((n) => n.label === "Churn is 10 percent");
    expect(projection.provenance[node!.id]?.brief_binding).toBe("unverified");
    expect(transformNodeToV3(node as never).provenance).toBe("ai_inferred");
  });

  /**
   * ⭐ THE OPPOSITE-DIRECTION TWIN, and it is not optional. A predicate guarding
   * against false authorship can be made trivially safe by refusing everything,
   * and a suite that only watches the lie would applaud that. This watches the
   * gap: a genuine, brief-borne figure must STILL earn its badge.
   */
  it("a genuine stated figure DOES still earn from_brief", () => {
    const brief = "We want to reduce churn. Churn is 10% today. Improve onboarding or keep onboarding.";
    const records = {
      stated_items: [
        { kind: "goal", source_quote: "Reduce churn" },
        { kind: "option", source_quote: "Improve onboarding" },
        { kind: "option", source_quote: "Keep onboarding" },
        { kind: "figure", source_quote: "Churn is 10%", value: 10, unit: "%" },
      ],
      claims: [
        { claim_kind: "causal_link", label: "Current churn bears on goal", from_stated: 3, to_stated: 0 },
      ],
    };
    const projection = project(records, brief);
    const node = projection.graph.nodes.find((n) => n.label === "Churn is 10%");
    expect(projection.provenance[node!.id]?.brief_binding).toBe("verified");
    expect(transformNodeToV3(node as never).provenance).toBe("from_brief");
  });

  /**
   * ⭐⭐ A KNOWN GAP, PINNED RATHER THAN LEFT INVISIBLE.
   *
   * The value half delegates to the SHIPPED `isAmountStatedInBrief`, and that
   * predicate's scanner reads a WORD-FORM percentage in running prose as a
   * PLAIN amount: `findStatedAmounts("Churn is 10 percent today")` returns
   * `{ magnitude: 10, kind: "plain" }`, so a `%`-denominated value finds no
   * percent statement to match and the item binds `unverified`.
   *
   * ⚠ THIS IS PRE-EXISTING BEHAVIOUR OF A SHIPPED PREDICATE, NOT A REGRESSION,
   * and it is deliberately NOT fixed here: `stated-amounts.ts` also decides
   * per-intervention provenance across the product, so widening its scanner is a
   * change with its own blast radius and its own measurement. Fixing it inside a
   * remediation wave would be exactly the "while we're here" move the scope rule
   * forbids.
   *
   * The direction of the error is the safe one — the product UNDER-claims,
   * showing `ai_inferred` for a number the user really did state. It wastes the
   * user's words; it does not lie to them.
   *
   * This test asserts EXACTLY the gap. It REDs if the gap grows, and it REDs if
   * the gap is closed — at which point this test is the thing that tells you to
   * delete it. A gap recorded in the suite is honest; a gap invisible to it is
   * how a defect class survives a remediation.
   */
  it("KNOWN GAP: a word-form percentage in the brief under-claims (safe direction)", () => {
    const brief = "We want to reduce churn. Churn is 10 percent today. Improve onboarding or keep onboarding.";
    const records = {
      stated_items: [
        { kind: "goal", source_quote: "Reduce churn" },
        { kind: "option", source_quote: "Improve onboarding" },
        { kind: "option", source_quote: "Keep onboarding" },
        { kind: "figure", source_quote: "Churn is 10 percent", value: 10, unit: "%" },
      ],
      claims: [
        { claim_kind: "causal_link", label: "Current churn bears on goal", from_stated: 3, to_stated: 0 },
      ],
    };
    // The QUOTE half succeeds — it is only the magnitude that cannot be matched.
    expect(brief).toContain("Churn is 10 percent");
    const projection = project(records, brief);
    const node = projection.graph.nodes.find((n) => n.label === "Churn is 10 percent");
    expect(projection.provenance[node!.id]?.brief_binding).toBe("unverified");
    expect(transformNodeToV3(node as never).provenance).toBe("ai_inferred");
  });

  it("with NO brief in scope the badge is declined rather than assumed (fail-closed)", () => {
    const records = {
      stated_items: [
        { kind: "goal", source_quote: "Reduce churn" },
        { kind: "option", source_quote: "Improve onboarding" },
        { kind: "option", source_quote: "Keep onboarding" },
        { kind: "figure", source_quote: "Churn is 10 percent", value: 10, unit: "%" },
      ],
      claims: [
        { claim_kind: "causal_link", label: "Current churn bears on goal", from_stated: 3, to_stated: 0 },
      ],
    };
    const projection = project(records);
    const node = projection.graph.nodes.find((n) => n.label === "Churn is 10 percent");
    expect(projection.provenance[node!.id]?.brief_binding).toBe("unchecked");
    expect(transformNodeToV3(node as never).provenance).toBe("ai_inferred");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("ROOT 2(a) — an unstated constraint direction is asked about, never guessed", () => {
  const input = {
    stated_items: [
      { kind: "goal", source_quote: "Protect runway" },
      { kind: "option", source_quote: "Expand" },
      { kind: "option", source_quote: "Hold" },
      // Grammar-admitted: `direction` is optional (`required: [kind, source_quote]`).
      { kind: "constraint", source_quote: "Cash must stay above 1000 pounds", value: 1000 },
    ],
    claims: [
      { claim_kind: "factor", label: "Cash use", basis: [0] },
      { claim_kind: "causal_link", label: "Expand changes cash use", from_stated: 1, to_claim: 0, sets_to: 0.8 },
      { claim_kind: "causal_link", label: "Hold changes cash use", from_stated: 2, to_claim: 0, sets_to: 0.4 },
      { claim_kind: "causal_link", label: "Cash use affects runway", from_claim: 0, to_stated: 0 },
      { claim_kind: "causal_link", label: "Cash floor protects runway", from_stated: 3, to_stated: 0 },
    ],
  };

  /**
   * FINDING 3. "Cash must stay above 1000 pounds" is a FLOOR. The projector
   * defaulted a missing direction to `ceiling` → `<=`, i.e. the exact opposite
   * constraint, asserted with confidence and no disclosure while
   * `analysis_ready` reported ready.
   */
  it("asserts NO operator when the direction was never stated", () => {
    const projection = project(input);
    const constraint = projection.graph.nodes.find(
      (n) => n.label === "Cash must stay above 1000 pounds",
    );
    expect(constraint, "the user's own words stay on the graph").toBeDefined();
    expect((constraint!.data as { operator?: string } | undefined)?.operator).toBeUndefined();
    expect(constraint!.observed_state).toBeUndefined();
  });

  it("DISCLOSES the unstated direction rather than absorbing it", () => {
    const projection = project(input);
    const disclosure = projection.dropped.find(
      (d) => d.reason === "constraint_direction_unstated",
    );
    expect(disclosure?.label).toBe("Cash must stay above 1000 pounds");
  });

  /**
   * ⭐ THE TWIN. A STATED direction must still map, and map correctly — the fix
   * must not be "never assert an operator", which would pass the two tests above
   * while destroying the feature.
   */
  it("a STATED direction still maps to its operator, both ways", () => {
    for (const [direction, operator] of [["floor", ">="], ["ceiling", "<="]] as const) {
      const withDirection = structuredClone(input) as unknown as DraftRecordSet;
      (withDirection.stated_items as { direction?: string }[])[3]!.direction = direction;
      const projection = project(withDirection);
      const constraint = projection.graph.nodes.find(
        (n) => n.label === "Cash must stay above 1000 pounds",
      );
      expect((constraint!.data as { operator?: string }).operator, direction).toBe(operator);
      expect(
        projection.dropped.filter((d) => d.reason === "constraint_direction_unstated"),
      ).toEqual([]);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("ROOT 2(b) — a stated target is not silently an observed value", () => {
  function withRole(role: "target" | "baseline") {
    return {
      stated_items: [
        { kind: "goal", source_quote: "Grow sustainably" },
        { kind: "option", source_quote: "Raise prices" },
        { kind: "option", source_quote: "Reduce costs" },
        { kind: "figure", source_quote: "Target gross margin is 80%", value: 80, unit: "%", role },
      ],
      claims: [
        { claim_kind: "causal_link", label: "Pricing changes margin", from_stated: 1, to_stated: 3, sets_to: 85 },
        { claim_kind: "causal_link", label: "Cost reduction changes margin", from_stated: 2, to_stated: 3, sets_to: 82 },
        { claim_kind: "causal_link", label: "Margin supports growth", from_stated: 3, to_stated: 0 },
      ],
    };
  }

  /**
   * FINDING 4. `role` was admitted by the grammar, carried by the seam, and read
   * NOWHERE — so a target and a current reading produced byte-identical
   * projections. Two opposite claims about the same number, collapsed.
   */
  it("target and baseline no longer produce identical projections", () => {
    const target = project(withRole("target"));
    const baseline = project(withRole("baseline"));
    const figureOf = (p: typeof target) =>
      p.graph.nodes.find((n) => n.label === "Target gross margin is 80%");
    expect((figureOf(target)!.data as { role?: string }).role).toBe("target");
    expect((figureOf(baseline)!.data as { role?: string }).role).toBe("baseline");
    expect(JSON.stringify(target.graph)).not.toBe(JSON.stringify(baseline.graph));
  });

  it("a stated TARGET is disclosed as not yet a goal threshold", () => {
    const target = project(withRole("target"));
    expect(
      target.dropped.find((d) => d.reason === "stated_target_not_represented_as_threshold")?.label,
    ).toBe("Target gross margin is 80%");
    // …and a BASELINE raises no such notice: the disclosure is about targets,
    // not about `role` being present at all.
    expect(
      project(withRole("baseline")).dropped.filter(
        (d) => d.reason === "stated_target_not_represented_as_threshold",
      ),
    ).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("ROOT 2(c) — equivalent claims in either order give the same analysis", () => {
  function recordSet(first: number, second: number) {
    return {
      stated_items: [
        { kind: "goal", source_quote: "Grow revenue" },
        { kind: "option", source_quote: "Launch" },
        { kind: "option", source_quote: "Hold" },
      ],
      claims: [
        { claim_kind: "factor", label: "Revenue outcome", basis: [0] },
        { claim_kind: "causal_link", label: `Launch sets revenue to ${first}`, from_stated: 1, to_claim: 0, sets_to: first },
        { claim_kind: "causal_link", label: `Launch sets revenue to ${second}`, from_stated: 1, to_claim: 0, sets_to: second },
        { claim_kind: "causal_link", label: "Hold sets revenue", from_stated: 2, to_claim: 0, sets_to: 5 },
        { claim_kind: "causal_link", label: "Revenue reaches goal", from_claim: 0, to_stated: 0 },
      ],
    };
  }
  function launchLevel(records: ReturnType<typeof recordSet>) {
    const projection = project(records);
    const factor = projection.graph.nodes.find((n) => n.label === "Revenue outcome")!;
    const launch = projection.graph.nodes.find((n) => n.label === "Launch")!;
    return {
      level: (launch.data as { interventions: Record<string, number> }).interventions[factor.id],
      dropped: projection.dropped,
    };
  }

  /**
   * FINDING 5. `bucket[edge.to] = setsTo` was an unconditional write, so the
   * LATER claim silently won. Emission order carries no meaning, and it was
   * deciding the number the analysis ran on.
   */
  it("permuting two equivalent claims does not change the intervention", () => {
    expect(launchLevel(recordSet(10, 20)).level).toBe(launchLevel(recordSet(20, 10)).level);
  });

  it("and the discarded level is DISCLOSED, not absorbed", () => {
    const conflict = launchLevel(recordSet(10, 20)).dropped.find(
      (d) => d.reason === "parallel_intervention_conflict",
    );
    expect(conflict?.label).toBe("Launch");
    expect(conflict?.intervention_signature).toContain("|");
  });

  /**
   * ⭐ THE TWIN — no conflict, no notice. A fix that disclosed unconditionally
   * would pass the test above while crying wolf on every ordinary draft.
   */
  it("agreeing parallel claims raise no conflict notice", () => {
    expect(
      launchLevel(recordSet(10, 10)).dropped.filter(
        (d) => d.reason === "parallel_intervention_conflict",
      ),
    ).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("ROOT 2(d) — a demote may not collapse genuinely distinct meaning", () => {
  const input = {
    stated_items: [
      { kind: "goal", source_quote: "Grow revenue" },
      { kind: "option", source_quote: "Launch nationally" },
      { kind: "option", source_quote: "Hold" },
      { kind: "constraint", source_quote: "Avoid regulatory exposure", direction: "ceiling", value: 1 },
    ],
    claims: [
      { claim_kind: "option_refinement", label: "Launch with an unlicensed pilot", basis: [0] },
      { claim_kind: "factor", label: "Revenue outcome", basis: [0] },
      { claim_kind: "causal_link", label: "National launch sets revenue", from_stated: 1, to_claim: 1, sets_to: 10 },
      { claim_kind: "causal_link", label: "Pilot sets same revenue", from_claim: 0, to_claim: 1, sets_to: 10 },
      { claim_kind: "causal_link", label: "Hold sets revenue", from_stated: 2, to_claim: 1, sets_to: 5 },
      { claim_kind: "causal_link", label: "Revenue reaches goal", from_claim: 1, to_stated: 0 },
      { claim_kind: "causal_link", label: "Pilot creates regulatory exposure", from_claim: 0, to_stated: 3 },
      { claim_kind: "causal_link", label: "Exposure affects goal", from_stated: 3, to_stated: 0 },
    ],
  };

  /**
   * FINDING 6. The pilot and the national launch set revenue identically, so
   * they grouped on `buildInterventionSignature` — which sees ONLY
   * interventions. The pilot ALSO ran an edge into a regulatory-exposure
   * constraint the national launch never touched, and was withdrawn anyway,
   * taking the only representation of that risk with it.
   */
  it("keeps an option whose causal structure reaches somewhere the survivor does not", () => {
    const projection = project(input);
    const pilot = projection.graph.nodes.find(
      (n) => n.label === "Launch with an unlicensed pilot",
    );
    expect(pilot, "an option with a distinct risk path is not an undeveloped duplicate").toBeDefined();
    expect(
      projection.dropped.filter((d) => d.reason === "undeveloped_duplicate_of_stated"),
    ).toEqual([]);
    // …and its distinct edge survives with it, which is the meaning at stake.
    const exposure = projection.graph.nodes.find((n) => n.label === "Avoid regulatory exposure")!;
    expect(
      projection.graph.edges.some((e) => e.from === pilot!.id && e.to === exposure.id),
    ).toBe(true);
  });

  /**
   * ⭐ THE TWIN, and it is the load-bearing half: the duplication pass must
   * STILL fire where the duplicate really is undeveloped. Without this, "spare
   * everything" would pass the test above and silently restore the option
   * explosion the demote exists to prevent.
   */
  it("still demotes a duplicate that adds NO distinct structure", () => {
    const noDistinctPath = structuredClone(input);
    noDistinctPath.claims = noDistinctPath.claims.filter(
      (c) => c.label !== "Pilot creates regulatory exposure",
    );
    const projection = project(noDistinctPath);
    expect(
      projection.graph.nodes.find((n) => n.label === "Launch with an unlicensed pilot"),
    ).toBeUndefined();
    expect(
      projection.dropped.find((d) => d.reason === "undeveloped_duplicate_of_stated")?.label,
    ).toBe("Launch with an unlicensed pilot");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("ROOT 3 — the completion pass is genuinely append-only", () => {
  // ⚠ ANNOTATED, not left to inference: these fixtures are handed to
  // `projectRecordsToGraph` DIRECTLY (not through the `project` helper, which takes
  // `unknown`), so an unannotated literal widens `kind` to `string` and fails the
  // TYPECHECK DRIFT ratchet — which is the only gate that sees test files, because
  // `tsconfig.build.json` excludes them (CLAUDE.md trap 2).
  const pass1: DraftRecordSet = {
    stated_items: [
      { kind: "goal", source_quote: "Grow revenue" },
      { kind: "option", source_quote: "Launch" },
      { kind: "option", source_quote: "Hold" },
    ],
    claims: [
      { claim_kind: "option_refinement", label: "Launch version one", basis: [1] },
      { claim_kind: "factor", label: "Revenue outcome", basis: [0] },
      { claim_kind: "causal_link", label: "Launch v1 sets outcome", from_claim: 0, to_claim: 1, sets_to: 0.8 },
      { claim_kind: "causal_link", label: "Hold sets outcome", from_stated: 2, to_claim: 1, sets_to: 0.3 },
      { claim_kind: "causal_link", label: "Outcome reaches goal", from_claim: 1, to_stated: 0 },
      { claim_kind: "causal_link", label: "Unresolved prompt trigger", from_claim: 99, to_stated: 0 },
    ],
  };

  /**
   * FINDING 7a. The completion overwrote a pass-1 stated option's intervention
   * and reclassified its merged refinement back out — and the comparator kept
   * it, because the blocking COUNT was unchanged.
   */
  it("rejects a completion that overwrites a protected pass-1 intervention", () => {
    const before = projectRecordsToGraph(pass1);
    const askBefore = enumerateCompletionAsk(pass1, before);
    const merged = mergeCompletionClaims(pass1, {
      claims: [
        { claim_kind: "option_refinement", label: "Launch version two", basis: [1] },
        { claim_kind: "causal_link", label: "Stated Launch now sets outcome", from_stated: 1, to_claim: 1, sets_to: 0.7 },
        { claim_kind: "causal_link", label: "Launch v2 sets outcome", from_claim: 6, to_claim: 1, sets_to: 0.6 },
      ],
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const after = projectRecordsToGraph(merged.records);
    const askAfter = enumerateCompletionAsk(merged.records, after);

    const violations = completionRegressesProtectedContent(before, after);
    expect(violations.length, `expected a regression to be detected: ${violations.join(", ")}`)
      .toBeGreaterThan(0);
    expect(shouldKeepCompletion(askBefore, askAfter, { before, after })).toBe(false);
  });

  /**
   * FINDING 7b. A completion invalidated a pass-1 edge, removing a stated figure
   * from the graph, while the comparator reported no worsening at all.
   */
  it("rejects a completion that makes a protected pass-1 stated figure disappear", () => {
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "Grow revenue" },
        { kind: "option", source_quote: "Launch" },
        { kind: "option", source_quote: "Hold" },
        { kind: "figure", source_quote: "Awareness is 20", value: 20 },
        { kind: "figure", source_quote: "Demand is 30", value: 30 },
      ],
      claims: [
        { claim_kind: "factor", label: "Revenue outcome", basis: [0] },
        { claim_kind: "causal_link", label: "Launch sets outcome", from_stated: 1, to_claim: 0, sets_to: 0.8 },
        { claim_kind: "causal_link", label: "Hold sets outcome", from_stated: 2, to_claim: 0, sets_to: 0.3 },
        { claim_kind: "causal_link", label: "Outcome reaches goal", from_claim: 0, to_stated: 0 },
        { claim_kind: "causal_link", label: "Awareness drives demand", from_stated: 3, to_stated: 4 },
        { claim_kind: "causal_link", label: "Demand reaches goal", from_stated: 4, to_stated: 0 },
        { claim_kind: "causal_link", label: "Unresolved prompt trigger", from_claim: 99, to_stated: 0 },
      ],
    };
    const before = projectRecordsToGraph(records);
    const askBefore = enumerateCompletionAsk(records, before);
    expect(before.graph.nodes.some((n) => n.label === "Awareness is 20")).toBe(true);

    const merged = mergeCompletionClaims(records, {
      claims: [
        { claim_kind: "causal_link", label: "Launch sets demand", from_stated: 1, to_stated: 4, sets_to: 0.7 },
      ],
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const after = projectRecordsToGraph(merged.records);
    const askAfter = enumerateCompletionAsk(merged.records, after);
    expect(shouldKeepCompletion(askBefore, askAfter, { before, after })).toBe(false);
  });

  /**
   * ⭐⭐ THE IDENTITY-BOUND PROOF, isolated from the preservation check so that
   * neither can carry the other. Both asks hold EXACTLY ONE blocking item, so a
   * COUNT comparator reads `1 <= 1` and keeps it — while the item is about a
   * different option. This is trap 19 at the comparator: an assertion bound to a
   * value predicate another object satisfies, rather than to the object itself.
   */
  it("rejects a swap that holds the blocking COUNT equal while changing WHICH option is blocked", () => {
    // ⚠ THE CODE IS TAKEN FROM THE SWEEP'S OWN SET, NOT TYPED FROM MEMORY, AND
    // ITS MEMBERSHIP IS ASSERTED. A code that is not in Bucket C makes both items
    // NON-blocking, at which point this test passes by comparing two empty sets
    // and discriminates nothing — which is exactly what the first draft of it did
    // (trap 13: an assertion that cannot fail is not evidence).
    const blockingCode = "NO_PATH_TO_GOAL";
    expect(BUCKET_C_CODES.has(blockingCode), "fixture must use a real blocking code").toBe(true);
    const askOn = (detail: string) => ({
      baseClaimIndex: 0,
      items: [
        { kind: "option_without_chain" as const, detail, validatorCode: blockingCode },
      ],
    });
    const empty = { graph: { nodes: [], edges: [] }, provenance: {}, dropped: [] } as never;
    const before = askOn("hold");
    const after = askOn("hire");

    // The precondition that makes this test meaningful, pinned rather than
    // assumed: the two asks really are the same SIZE and the same CLASS.
    expect(after.items.length).toBe(before.items.length);
    expect(after.items[0]!.validatorCode).toBe(before.items[0]!.validatorCode);

    expect(shouldKeepCompletion(before, after, { before: empty, after: empty })).toBe(false);
    // …and the identical ask is still kept, so this is a discrimination and not
    // a blanket refusal.
    expect(shouldKeepCompletion(before, before, { before: empty, after: empty })).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("ROOT 4 — the final response agrees with itself about provenance", () => {
  const records = {
    stated_items: [
      { kind: "goal", source_quote: "Cut delivery time" },
      { kind: "option", source_quote: "Open a second warehouse" },
      { kind: "option", source_quote: "Keep one warehouse" },
    ],
    claims: [
      { claim_kind: "factor", label: "Handling capacity", basis: [0], value: 1 },
      { claim_kind: "causal_link", label: "Second warehouse raises capacity", basis: [1], from_stated: 1, to_claim: 0, effect: "positive", sets_to: 0.8 },
      { claim_kind: "causal_link", label: "One warehouse limits capacity", basis: [2], from_stated: 2, to_claim: 0, effect: "positive", sets_to: 0.4 },
      { claim_kind: "causal_link", label: "Capacity cuts delivery time", basis: [0], from_claim: 0, to_stated: 0, effect: "positive" },
    ],
  };
  const brief =
    "We want to cut delivery time. We can open a second warehouse, or keep one warehouse.";

  /**
   * FINDING 8a. A STATED option came off the wire `ai_inferred` in `nodes[]` and
   * `brief_extraction` in `options[]` — the response contradicting itself about
   * the user's own words. Two hardcodings of one fact (trap 12).
   */
  it("a stated option reads brief-provenance in BOTH nodes[] and options[]", () => {
    const projection = project(records, brief);
    const wire = CEEGraphResponseV3.parse(
      transformResponseToV3({ graph: projection.graph } as never, { brief }),
    );
    const node = wire.nodes.find((n) => n.label === "Open a second warehouse");
    const option = wire.options.find((o) => o.label === "Open a second warehouse");
    expect(node?.provenance).toBe("from_brief");
    expect(option?.provenance?.source).toBe("brief_extraction");
  });

  /**
   * FINDING 8b. An option the model INVENTED, absent from the brief, also read
   * `brief_extraction` — because the literal had no branch at all and could not
   * read anything else.
   */
  it("an option the brief never mentions reads inferred in BOTH places", () => {
    const inventive = {
      stated_items: [
        { kind: "goal", source_quote: "Grow revenue" },
        { kind: "option", source_quote: "Launch directly" },
        { kind: "option", source_quote: "Hold" },
      ],
      claims: [
        { claim_kind: "factor", label: "Demand", basis: [0] },
        { claim_kind: "option_refinement", label: "Launch through secret agents", basis: [0] },
        { claim_kind: "causal_link", label: "Direct demand", from_stated: 1, to_claim: 0, sets_to: 0.8 },
        { claim_kind: "causal_link", label: "Hold demand", from_stated: 2, to_claim: 0, sets_to: 0.4 },
        { claim_kind: "causal_link", label: "Agents demand", from_claim: 1, to_claim: 0, sets_to: 0.9 },
        { claim_kind: "causal_link", label: "Demand grows revenue", from_claim: 0, to_stated: 0 },
      ],
    };
    const inventiveBrief = "Grow revenue by choosing whether to launch directly or hold.";
    expect(inventiveBrief).not.toContain("Launch through secret agents");

    const projection = project(inventive, inventiveBrief);
    const wire = CEEGraphResponseV3.parse(
      transformResponseToV3({ graph: projection.graph } as never, { brief: inventiveBrief }),
    );
    const option = wire.options.find((o) => o.label === "Launch through secret agents");
    const node = wire.nodes.find((n) => n.label === "Launch through secret agents");
    expect(option, "the option is KEPT — only its attribution changes").toBeDefined();
    expect(option?.provenance?.source).toBe("cee_hypothesis");
    expect(node?.provenance).toBe("ai_inferred");
  });

  /**
   * ⭐ THE AGREEMENT ITSELF, asserted over EVERY option rather than a named one.
   * The two fields are one fact; a test naming a single option would pass while
   * the pair diverged on any other.
   */
  it("nodes[] and options[] never disagree, for any option in the response", () => {
    const projection = project(records, brief);
    const wire = CEEGraphResponseV3.parse(
      transformResponseToV3({ graph: projection.graph } as never, { brief }),
    );
    expect(wire.options.length).toBeGreaterThan(0);
    for (const option of wire.options) {
      const node = wire.nodes.find((n) => n.id === option.id);
      expect(node, `every option must have its node: ${option.label}`).toBeDefined();
      const nodeSaysBrief = node!.provenance === "from_brief";
      const optionSaysBrief = option.provenance?.source === "brief_extraction";
      expect(optionSaysBrief, `disagreement on ${option.label}`).toBe(nodeSaysBrief);
    }
  });
});
