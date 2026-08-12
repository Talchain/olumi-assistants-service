/**
 * THE FIXED-POINT DEMOTE-WITH-DISCLOSURE PASS — a MODEL option the analysis
 * cannot tell apart from a USER-STATED one is withdrawn and DISCLOSED, never
 * silently kept and never silently deleted.
 *
 * ⭐ WHY THIS IS AT THE PROJECTOR AND NOT AT THE REPAIR STAGE, derived at the
 * bytes rather than assumed. `options-identical-graceful-dedup.ts` already
 * dedups colliding options — and its guard 3b DECLINES whenever the labels
 * differ, on its own explicit reasoning:
 *
 *   "Guard 3 above depends on isFromBriefMarked, which reads extractionType —
 *    but the draft prompt emits extractionType on FACTOR nodes only … so option
 *    nodes carry no extractionType here and Guard 3 is structurally inert. With
 *    no per-option brief provenance reaching this stage, differently-LABELLED
 *    duplicates are the only remaining signal that ≥2 user-traceable
 *    alternatives were collapsed onto one signature … so DECLINE."
 *
 * That decline is CORRECT there and it names exactly what is missing: per-option
 * provenance. The projector HAS it — it built the option set and knows which
 * node came from `stated_items` and which from a model claim — so it can answer
 * a question the repair stage cannot: *is the duplicate the user's, or ours?*
 * The two stages therefore answer DIFFERENT questions (trap 21) and neither
 * supersedes the other; this one also DISCLOSES, where the repair stage is
 * deliberately silent.
 *
 * ⚠ EVERY ASSERTION BINDS BY IDENTITY — a node's minted id, located by the
 * user's exact quote, or a `dropped` entry located by its claim index — never by
 * a value predicate another option could satisfy (trap 19).
 */
import { describe, expect, it } from "vitest";
import { projectRecordsToGraph, projectionFingerprint } from "../projector.js";
import { buildInterventionSignature } from "../../../../validators/graph-validator.js";
import type { DraftRecordSet } from "../grammar.js";

type G = { nodes: Array<{ id: string; kind: string; label: string; data?: Record<string, unknown> }> };

/** The minted id of the single node carrying this EXACT label. Loud if 0 or 2+. */
function idOf(graph: G, label: string): string {
  const hits = graph.nodes.filter((n) => n.label === label);
  expect(hits, `expected exactly one node labelled "${label}"`).toHaveLength(1);
  return hits[0]!.id;
}
const optionLabels = (graph: G): string[] =>
  graph.nodes.filter((n) => n.kind === "option").map((n) => n.label).sort();
const interventionsOf = (graph: G, id: string): Record<string, number> | undefined =>
  graph.nodes.find((n) => n.id === id)?.data?.interventions as Record<string, number> | undefined;
/** The signature the VALIDATOR would compute, via its own exported function. */
const signatureOf = (graph: G, id: string): string | undefined => {
  const i = interventionsOf(graph, id);
  return i === undefined ? undefined : buildInterventionSignature(i);
};

// ── THE RUN-12 SHAPE, reproduced from the banked corpus ──────────────────────
// "finally do the platform rewrite" [STATED] vs "Rewrite First, Then Copilot
// (Sequenced)" [MODEL]: the refinement names TWO stated options, so the merge
// rule correctly declines it — and the model never said how the sequenced
// alternative differs, so its interventions are byte-identical to the stated
// option's. Measured signature on the real corpus: `475a18b9:1.0000|dbc7be0a:0.0000`.
const RUN12_SHAPE: DraftRecordSet = {
  stated_items: [
    { kind: "goal", source_quote: "15% ARR growth next year" },
    { kind: "option", source_quote: "bet the next two quarters on the AI copilot" },
    { kind: "option", source_quote: "finally do the platform rewrite" },
  ],
  claims: [
    { claim_kind: "factor", label: "engineering capacity consumed" },
    { claim_kind: "factor", label: "platform velocity" },
    // The refinement names BOTH stated options, so it does not merge (correctly:
    // a sequencing of two alternatives is arguably a third one).
    { claim_kind: "option_refinement", label: "Rewrite First, Then Copilot (Sequenced)", basis: [1, 2] },
    { claim_kind: "causal_link", label: "rewrite consumes capacity", from_stated: 2, to_claim: 0, effect: "negative", sets_to: 1 },
    { claim_kind: "causal_link", label: "rewrite holds velocity flat", from_stated: 2, to_claim: 1, effect: "positive", sets_to: 0 },
    // …and the model gave the sequenced option the SAME two magnitudes.
    { claim_kind: "causal_link", label: "sequenced consumes capacity", from_claim: 2, to_claim: 0, effect: "negative", sets_to: 1 },
    { claim_kind: "causal_link", label: "sequenced holds velocity flat", from_claim: 2, to_claim: 1, effect: "positive", sets_to: 0 },
    // The copilot option is genuinely different.
    { claim_kind: "causal_link", label: "copilot consumes capacity", from_stated: 1, to_claim: 0, effect: "negative", sets_to: 0.8 },
    { claim_kind: "causal_link", label: "capacity bears on the goal", from_claim: 0, to_stated: 0, effect: "negative" },
    { claim_kind: "causal_link", label: "velocity bears on the goal", from_claim: 1, to_stated: 0, effect: "positive" },
  ],
};

describe("a MODEL option indistinguishable from a STATED one is demoted and disclosed", () => {
  it("withdraws the model option and leaves the user's own alternative standing", () => {
    const { graph, dropped } = projectRecordsToGraph(RUN12_SHAPE);

    // The user's option survives, located by their VERBATIM quote.
    const stated = idOf(graph, "finally do the platform rewrite");
    expect(graph.nodes.find((n) => n.id === stated)?.kind).toBe("option");
    // The model's duplicate is gone from the OPTION SET.
    expect(optionLabels(graph)).not.toContain("Rewrite First, Then Copilot (Sequenced)");
    // …and the option that was genuinely different is untouched.
    expect(optionLabels(graph)).toContain("bet the next two quarters on the AI copilot");

    // DISCLOSED, bound to the claim by INDEX, naming what it duplicated.
    const demote = dropped.find((d) => d.claim_index === 2);
    expect(demote?.reason).toBe("undeveloped_duplicate_of_stated");
    expect(demote?.label).toBe("Rewrite First, Then Copilot (Sequenced)");
    expect(demote?.duplicate_of).toBe(stated);
    expect(demote?.duplicate_of_label).toBe("finally do the platform rewrite");
    expect(demote?.intervention_signature).toBe(signatureOf(graph, stated));
  });

  it("leaves no option pair the analysis cannot tell apart", () => {
    const { graph } = projectRecordsToGraph(RUN12_SHAPE);
    const sigs = graph.nodes
      .filter((n) => n.kind === "option")
      .map((n) => signatureOf(graph, n.id))
      .filter((s): s is string => s !== undefined);
    // Positive control: the check can SEE signatures at all (an absence assertion
    // over an empty list passes by testing nothing — trap 13).
    expect(sigs.length).toBeGreaterThan(0);
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  it("records the withdrawal on the SURVIVOR's provenance without rewriting the user's words", () => {
    const { graph, provenance } = projectRecordsToGraph(RUN12_SHAPE);
    const stated = idOf(graph, "finally do the platform rewrite");
    const prov = provenance[stated]!;
    // APPEND-ONLY: class and quote are untouched, so nothing the model wrote is
    // ever attributed to the user.
    expect(prov.provenance_class).toBe("stated");
    expect(prov.source_quote).toBe("finally do the platform rewrite");
    expect(prov.undeveloped_duplicates).toEqual(["Rewrite First, Then Copilot (Sequenced)"]);
    // A demote is NOT a merge: the model's wording must not appear as a merged
    // refinement, which would claim the parent absorbed it.
    expect(prov.merged_refinements).toBeUndefined();
  });

  it("is deterministic — the same record set projects to the same bytes", () => {
    expect(projectionFingerprint(projectRecordsToGraph(RUN12_SHAPE))).toBe(
      projectionFingerprint(projectRecordsToGraph(RUN12_SHAPE)),
    );
  });
});

// ── THE FIXED-POINT CASE (the run-16 mechanism) ──────────────────────────────
// Two refinements name the same stated parent, so the choice-set guard refuses
// BOTH merges. Demoting one of them makes the other the ONLY refinement of that
// parent — so on re-projection it MERGES, its magnitudes land on the parent, and
// the PARENT'S SIGNATURE CHANGES. A collision that did not exist on pass 1 then
// exists, and only an iterated pass can see it.
const FIXED_POINT_SHAPE: DraftRecordSet = {
  stated_items: [
    { kind: "goal", source_quote: "grow revenue 15%" },
    { kind: "option", source_quote: "push into Germany next year" },
    { kind: "option", source_quote: "double down on the UK" },
  ],
  claims: [
    { claim_kind: "factor", label: "germany investment" },
    { claim_kind: "factor", label: "uk investment" },
    // c2 and c3 both refine stated_items[1] ⇒ neither merges on pass 1.
    { claim_kind: "option_refinement", label: "Germany Direct (2027)", basis: [1] },
    { claim_kind: "option_refinement", label: "Germany via Partner", basis: [1] },
    // c4 names BOTH stated options, so it never merges under any pass.
    { claim_kind: "option_refinement", label: "Defer Germany 12 Months (CFO path)", basis: [1, 2] },
    // The parent's OWN magnitude on pass 1: germany 1.0 only.
    { claim_kind: "causal_link", label: "germany push invests in germany", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 1 },
    // c2 duplicates the STATED UK option exactly ⇒ demoted in round 1.
    { claim_kind: "causal_link", label: "uk depth invests in the uk", from_stated: 2, to_claim: 1, effect: "positive", sets_to: 0.5 },
    { claim_kind: "causal_link", label: "germany direct invests in the uk", from_claim: 2, to_claim: 1, effect: "positive", sets_to: 0.5 },
    // c3's magnitude — it lands on the PARENT once c3 becomes the only refinement.
    { claim_kind: "causal_link", label: "germany via partner invests in the uk", from_claim: 3, to_claim: 1, effect: "positive", sets_to: 0.25 },
    // c4 already carries the pair the parent will have AFTER absorbing c3.
    { claim_kind: "causal_link", label: "cfo path invests in germany", from_claim: 4, to_claim: 0, effect: "positive", sets_to: 1 },
    { claim_kind: "causal_link", label: "cfo path invests in the uk", from_claim: 4, to_claim: 1, effect: "positive", sets_to: 0.25 },
    { claim_kind: "causal_link", label: "germany investment bears on the goal", from_claim: 0, to_stated: 0, effect: "positive" },
    { claim_kind: "causal_link", label: "uk investment bears on the goal", from_claim: 1, to_stated: 0, effect: "positive" },
  ],
};

describe("the demote pass runs to a FIXED POINT, because a merge can change a signature", () => {
  it("catches the collision that only exists AFTER the first demote lets a sibling merge", () => {
    const { graph, dropped, provenance } = projectRecordsToGraph(FIXED_POINT_SHAPE);
    const parent = idOf(graph, "push into Germany next year");

    // ROUND 1's demote: c2 duplicated the STATED UK option.
    const round1 = dropped.find((d) => d.claim_index === 2);
    expect(round1?.reason).toBe("undeveloped_duplicate_of_stated");
    expect(round1?.duplicate_of).toBe(idOf(graph, "double down on the UK"));

    // Its removal made c3 the parent's only refinement, so c3 MERGED…
    expect(dropped.find((d) => d.claim_index === 3)?.reason).toBe(
      "refinement_merged_into_stated_option",
    );
    expect(provenance[parent]?.merged_refinements).toEqual(["Germany via Partner"]);
    // …which gave the parent a SECOND magnitude it did not have on pass 1.
    expect(Object.keys(interventionsOf(graph, parent) ?? {})).toHaveLength(2);

    // ROUND 2's demote: c4 now duplicates the parent. A single-pass implementation
    // cannot see this, because on pass 1 the parent's signature was different.
    const round2 = dropped.find((d) => d.claim_index === 4);
    expect(round2?.reason).toBe("undeveloped_duplicate_of_stated");
    expect(round2?.duplicate_of).toBe(parent);
    expect(optionLabels(graph)).not.toContain("Defer Germany 12 Months (CFO path)");

    // The user's own two options both stand.
    expect(optionLabels(graph)).toEqual(["double down on the UK", "push into Germany next year"]);
  });

  it("terminates and is deterministic across the iterated pass", () => {
    const a = projectRecordsToGraph(FIXED_POINT_SHAPE);
    const b = projectRecordsToGraph(FIXED_POINT_SHAPE);
    expect(projectionFingerprint(a)).toBe(projectionFingerprint(b));
  });
});

// ── THE DISCRIMINATING NEGATIVE ARMS ─────────────────────────────────────────
// These PASS at pristine. That is what makes them discriminators rather than a
// second copy of the positive case.

const MODEL_MODEL_SHAPE: DraftRecordSet = {
    stated_items: [
      { kind: "goal", source_quote: "grow revenue" },
      { kind: "option", source_quote: "expand the sales team" },
      { kind: "option", source_quote: "hold steady" },
    ],
    claims: [
      { claim_kind: "factor", label: "headcount" },
      // Two refinements, each naming BOTH stated options, so neither merges —
      // and they duplicate EACH OTHER, not the user.
      { claim_kind: "option_refinement", label: "Expand via contractors", basis: [1, 2] },
      { claim_kind: "option_refinement", label: "Expand via an agency", basis: [1, 2] },
      { claim_kind: "causal_link", label: "expansion raises headcount", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 12 },
      { claim_kind: "causal_link", label: "steady holds headcount", from_stated: 2, to_claim: 0, effect: "positive", sets_to: 0 },
      { claim_kind: "causal_link", label: "contractors raise headcount", from_claim: 1, to_claim: 0, effect: "positive", sets_to: 7 },
      { claim_kind: "causal_link", label: "the agency raises headcount", from_claim: 2, to_claim: 0, effect: "positive", sets_to: 7 },
      { claim_kind: "causal_link", label: "headcount bears on the goal", from_claim: 0, to_stated: 0, effect: "positive" },
    ],
  };

const ONE_OPTION_SHAPE: DraftRecordSet = {
    stated_items: [
      { kind: "goal", source_quote: "grow revenue" },
      { kind: "option", source_quote: "keep what we have" },
    ],
    claims: [
      { claim_kind: "factor", label: "headcount" },
      // Basis names NO stated option, so the merge rule correctly declines it
      // and it stands as a rival alternative.
      { claim_kind: "option_refinement", label: "Hire a growth team", basis: [] },
      { claim_kind: "causal_link", label: "the status quo holds headcount", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 12 },
      { claim_kind: "causal_link", label: "the growth team holds headcount", from_claim: 1, to_claim: 0, effect: "positive", sets_to: 12 },
      { claim_kind: "causal_link", label: "headcount bears on the goal", from_claim: 0, to_stated: 0, effect: "positive" },
    ],
  };

const SURVIVOR_MERGES_SHAPE: DraftRecordSet = {
    stated_items: [
      { kind: "goal", source_quote: "grow revenue 15%" },
      { kind: "option", source_quote: "push into Germany next year" },
      { kind: "option", source_quote: "double down on the UK" },
    ],
    claims: [
      { claim_kind: "factor", label: "germany investment" },
      { claim_kind: "factor", label: "uk investment" },
      // Both name stated_items[1] — the guard refuses both merges on pass 1.
      { claim_kind: "option_refinement", label: "Germany Direct", basis: [1] },
      { claim_kind: "option_refinement", label: "Germany via Partner", basis: [1] },
      { claim_kind: "causal_link", label: "the germany push invests", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 0.5 },
      { claim_kind: "causal_link", label: "germany direct invests", from_claim: 2, to_claim: 0, effect: "positive", sets_to: 1 },
      { claim_kind: "causal_link", label: "germany via partner invests", from_claim: 3, to_claim: 0, effect: "positive", sets_to: 1 },
      { claim_kind: "causal_link", label: "the uk push invests", from_stated: 2, to_claim: 1, effect: "positive", sets_to: 0.9 },
      { claim_kind: "causal_link", label: "germany investment bears on the goal", from_claim: 0, to_stated: 0, effect: "positive" },
      { claim_kind: "causal_link", label: "uk investment bears on the goal", from_claim: 1, to_stated: 0, effect: "positive" },
    ],
  };

/**
 * Every shape in this file that PRODUCES a demote disclosure. The dangling-id
 * invariant sweeps this list, so a new demoting shape added here is covered by
 * construction rather than by anyone remembering to extend a second list.
 */
const DEMOTING_SHAPES: ReadonlyArray<readonly [string, DraftRecordSet]> = [
  ["run12", RUN12_SHAPE],
  ["fixed-point", FIXED_POINT_SHAPE],
  ["model-model", MODEL_MODEL_SHAPE],
  ["one-option", ONE_OPTION_SHAPE],
  ["survivor-merges", SURVIVOR_MERGES_SHAPE],
];

describe("what the demote deliberately does NOT touch", () => {
  it("leaves a (stated, stated) collision standing and blocking — the user's duplication is the user's to resolve", () => {
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "grow revenue" },
        { kind: "option", source_quote: "expand the sales team" },
        { kind: "option", source_quote: "hire more reps" },
      ],
      claims: [
        { claim_kind: "factor", label: "headcount" },
        { claim_kind: "causal_link", label: "expansion raises headcount", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 12 },
        { claim_kind: "causal_link", label: "hiring raises headcount", from_stated: 2, to_claim: 0, effect: "positive", sets_to: 12 },
        { claim_kind: "causal_link", label: "headcount bears on the goal", from_claim: 0, to_stated: 0, effect: "positive" },
      ],
    };
    const { graph, dropped } = projectRecordsToGraph(records);
    expect(optionLabels(graph)).toEqual(["expand the sales team", "hire more reps"]);
    // Both signatures identical and BOTH still on the graph: the collision is
    // handed to the validator, loudly, rather than resolved behind the user.
    expect(signatureOf(graph, idOf(graph, "expand the sales team"))).toBe(
      signatureOf(graph, idOf(graph, "hire more reps")),
    );
    expect(dropped.filter((d) => d.reason.startsWith("undeveloped_duplicate"))).toEqual([]);
  });

  it("leaves a MODEL option with a DISTINCT signature standing", () => {
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "grow revenue" },
        { kind: "option", source_quote: "expand the sales team" },
        { kind: "option", source_quote: "hold steady" },
      ],
      claims: [
        { claim_kind: "factor", label: "headcount" },
        { claim_kind: "option_refinement", label: "Expand, but offshore", basis: [1, 2] },
        { claim_kind: "causal_link", label: "expansion raises headcount", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 12 },
        // DISTINCT AT THE VALIDATOR'S OWN RESOLUTION. The signature is
        // `toFixed(4)` over what the validator SEES — which, post pass 3d, is
        // the scale-projected level (frame 20 here). 12 vs 13 → 0.6 vs 0.65:
        // distinct. (The previous fixture used 12 vs 12.0001 — distinct raw,
        // but 0.6000 vs 0.6000 at the validator's own 4dp over the levels it
        // now receives, i.e. genuinely indistinguishable to the analysis; the
        // twin test below pins that side of the boundary.)
        { claim_kind: "causal_link", label: "offshore raises headcount", from_claim: 1, to_claim: 0, effect: "positive", sets_to: 13 },
        { claim_kind: "causal_link", label: "steady holds headcount", from_stated: 2, to_claim: 0, effect: "positive", sets_to: 0 },
        { claim_kind: "causal_link", label: "headcount bears on the goal", from_claim: 0, to_stated: 0, effect: "positive" },
      ],
    };
    const { graph, dropped } = projectRecordsToGraph(records);
    expect(optionLabels(graph)).toContain("Expand, but offshore");
    expect(dropped.filter((d) => d.reason.startsWith("undeveloped_duplicate"))).toEqual([]);
    // Distinct at the validator's 4dp over the projected levels (0.6 vs 0.65).
    expect(signatureOf(graph, idOf(graph, "Expand, but offshore"))).not.toBe(
      signatureOf(graph, idOf(graph, "expand the sales team")),
    );
  });

  it("demotes (and DISCLOSES) a MODEL option whose magnitude differs below the validator's own resolution", () => {
    // The twin of the test above, pinning the other side of the boundary: the
    // validator's signature is `toFixed(4)` over the values it receives, and
    // post pass 3d it receives LEVELS. 12 vs 12.0001 under frame 20 are 0.6000
    // vs 0.6000 at that resolution — indistinguishable to the analysis, so the
    // model option is withdrawn and disclosed, exactly as the validator's own
    // OPTIONS_IDENTICAL would otherwise judge them downstream. The projector
    // and the validator read the SAME values through the SAME function — the
    // demote can never disagree with the gate it pre-empts.
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "grow revenue" },
        { kind: "option", source_quote: "expand the sales team" },
        { kind: "option", source_quote: "hold steady" },
      ],
      claims: [
        { claim_kind: "factor", label: "headcount" },
        { claim_kind: "option_refinement", label: "Expand, but offshore", basis: [1, 2] },
        { claim_kind: "causal_link", label: "expansion raises headcount", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 12 },
        { claim_kind: "causal_link", label: "offshore raises headcount", from_claim: 1, to_claim: 0, effect: "positive", sets_to: 12.0001 },
        { claim_kind: "causal_link", label: "steady holds headcount", from_stated: 2, to_claim: 0, effect: "positive", sets_to: 0 },
        { claim_kind: "causal_link", label: "headcount bears on the goal", from_claim: 0, to_stated: 0, effect: "positive" },
      ],
    };
    const { graph, dropped } = projectRecordsToGraph(records);
    expect(optionLabels(graph)).not.toContain("Expand, but offshore");
    const demotes = dropped.filter((d) => d.reason === "undeveloped_duplicate_of_stated");
    expect(demotes).toHaveLength(1);
    expect(demotes[0]!.label).toBe("Expand, but offshore");
    expect(demotes[0]!.duplicate_of_label).toBe("expand the sales team");
  });

  it("keeps the LOWEST claim index when two MODEL options collide with no stated member", () => {
    // ⚠ This shape does NOT occur in the banked corpus (round-11 population:
    // 4 collision groups, all four (stated, model), zero (model, model)). It is
    // tested synthetically and that is stated rather than implied.
        const { graph, dropped } = projectRecordsToGraph(MODEL_MODEL_SHAPE);
    // The EARLIER claim survives; the later one is demoted against it.
    expect(optionLabels(graph)).toContain("Expand via contractors");
    expect(optionLabels(graph)).not.toContain("Expand via an agency");
    const demote = dropped.find((d) => d.claim_index === 2);
    expect(demote?.reason).toBe("undeveloped_duplicate_of_model");
    expect(demote?.duplicate_of).toBe(idOf(graph, "Expand via contractors"));
  });

  it("trades OPTIONS_IDENTICAL for a VISIBLE INSUFFICIENT_OPTIONS rather than inventing a difference", () => {
    // ⚠ THE REACHABLE EDGE OF THIS PASS, PINNED RATHER THAN DISCOVERED LATER.
    // The user named ONE alternative; the model added a second and gave it the
    // same magnitude. Withdrawing the model's leaves a one-option graph, so the
    // blocking code changes from `OPTIONS_IDENTICAL` to `INSUFFICIENT_OPTIONS`.
    //
    // BOTH block, so the gate outcome is unchanged — and the second one is the
    // TRUE statement: the problem is not that two options look alike, it is that
    // there is only one real alternative on the table. The three things the
    // projector could do here are the same three as everywhere else in this file
    // (force it in, drop it silently, disclose it), and this is the disclosed
    // one. A stated option is still never touched.
        const { graph, dropped } = projectRecordsToGraph(ONE_OPTION_SHAPE);
    expect(optionLabels(graph)).toEqual(["keep what we have"]); // the USER's, and only the user's
    const demote = dropped.find((d) => d.reason === "undeveloped_duplicate_of_stated");
    expect(demote?.label).toBe("Hire a growth team");
    expect(demote?.duplicate_of_label).toBe("keep what we have");
  });

  it("keeps its disclosure RESOLVABLE when the survivor itself later merges away", () => {
    // ⭐⭐ THE REVIEWER'S SHAPE (round-11 review, B1). Two refinements name the
    // SAME single stated option, so the choice-set guard refuses both merges and
    // they stand as rivals — and they duplicate EACH OTHER. R2 is demoted
    // against R1 (lowest claim index). On the next pass R2's withdrawal leaves
    // R1 the ONLY refinement of that parent, so R1 MERGES and mints no node.
    //
    // The disclosure written in round 1 pointed at R1's minted id, and after
    // round 2 that id names nothing on the graph — a record referring to a node
    // the user cannot find. The projector's whole premise is that a disclosure
    // is better than a silent loss, and a dangling disclosure is neither.
        const { graph, dropped, provenance } = projectRecordsToGraph(SURVIVOR_MERGES_SHAPE);

    // Precondition, pinned in-test: this really is the (model, model) path AND
    // the survivor really did merge away. Without both, the assertion below
    // passes for the wrong reason (trap 13b).
    const demote = dropped.find((d) => d.reason === "undeveloped_duplicate_of_model");
    expect(demote?.label).toBe("Germany via Partner");
    expect(dropped.find((d) => d.claim_index === 2)?.reason).toBe(
      "refinement_merged_into_stated_option",
    );

    // THE INVARIANT: the disclosure names a node that is ON THE FINAL GRAPH.
    const parent = idOf(graph, "push into Germany next year");
    expect(demote?.duplicate_of).toBe(parent);
    expect(demote?.duplicate_of_label).toBe("push into Germany next year");
    // …and the option it ORIGINALLY duplicated is not lost from the record.
    expect(demote?.merged_survivor_label).toBe("Germany Direct");

    // The withdrawal is recorded on the node that absorbed the survivor, not
    // dropped on the floor because the survivor's own provenance had gone.
    expect(provenance[parent]?.undeveloped_duplicates).toEqual(["Germany via Partner"]);
    expect(provenance[parent]?.provenance_class).toBe("stated");
    expect(provenance[parent]?.source_quote).toBe("push into Germany next year");
  });

  it("NEVER leaves a dangling id in any disclosure, across every demoting shape in this spec", () => {
    // The general form of the invariant, so a future shape cannot reintroduce
    // B1 quietly. Written against the SPEC — "an id in a disclosure names a node
    // the reader can find" — not against the one case that failed (13d).
    let checkedIds = 0;
    for (const [name, records] of DEMOTING_SHAPES) {
      const { graph, dropped } = projectRecordsToGraph(records);
      const ids = new Set(graph.nodes.map((n) => n.id));
      const labelById = new Map(graph.nodes.map((n) => [n.id, n.label]));
      for (const d of dropped) {
        if (d.duplicate_of === undefined) continue;
        checkedIds += 1;
        expect(ids.has(d.duplicate_of), `${name}: dangling duplicate_of ${d.duplicate_of}`).toBe(true);
        expect(d.duplicate_of_label).toBe(labelById.get(d.duplicate_of));
      }
    }
    // Positive control: the sweep really did examine some ids (an invariant over
    // an empty set passes by testing nothing — trap 13).
    expect(checkedIds).toBeGreaterThan(3);
  });

  it("does NOT fire on a graph with no goal — the validator's own precondition", () => {
    // ⭐ DERIVED FROM THE CONSUMER, not from the symptom (13d).
    // `validateSemantic` (graph-validator.ts) opens with
    //   `const goals = nodeMap.byKind.get("goal") ?? []; if (goals.length === 0) return issues;`
    // so `OPTIONS_IDENTICAL` CANNOT fire on a goal-less graph. A demote pass
    // without that gate withdraws an option to pre-empt a violation the consumer
    // would never raise — the predicate would be broader than the rule it serves.
    const records: DraftRecordSet = {
      stated_items: [{ kind: "option", source_quote: "keep what we have" }],
      claims: [
        { claim_kind: "factor", label: "headcount" },
        { claim_kind: "option_refinement", label: "Hire a growth team", basis: [] },
        { claim_kind: "causal_link", label: "the status quo holds headcount", from_stated: 0, to_claim: 0, effect: "positive", sets_to: 12 },
        { claim_kind: "causal_link", label: "the growth team holds headcount", from_claim: 1, to_claim: 0, effect: "positive", sets_to: 12 },
      ],
    };
    const { graph, dropped } = projectRecordsToGraph(records);
    // Precondition: the collision really is present — both options carry the
    // SAME signature, so the only reason nothing is demoted is the goal gate.
    const a = signatureOf(graph, idOf(graph, "keep what we have"));
    const b = signatureOf(graph, idOf(graph, "Hire a growth team"));
    expect(a).toBeDefined();
    expect(a).toBe(b);
    expect(dropped.filter((d) => d.reason.startsWith("undeveloped_duplicate"))).toEqual([]);
  });

  it("changes NOTHING on a record set with no colliding options", () => {
    // The no-op property: absent a collision the projection must be byte-identical
    // to what the projector produced before this pass existed. 21 of the 25 banked
    // record sets are in this class, so it is the property the corpus mostly tests.
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "grow revenue" },
        { kind: "option", source_quote: "expand the sales team" },
        { kind: "option", source_quote: "hold steady" },
      ],
      claims: [
        { claim_kind: "factor", label: "headcount" },
        { claim_kind: "causal_link", label: "expansion raises headcount", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 12 },
        { claim_kind: "causal_link", label: "steady holds headcount", from_stated: 2, to_claim: 0, effect: "positive", sets_to: 0 },
        { claim_kind: "causal_link", label: "headcount bears on the goal", from_claim: 0, to_stated: 0, effect: "positive" },
      ],
    };
    const { graph, dropped } = projectRecordsToGraph(records);
    expect(optionLabels(graph)).toEqual(["expand the sales team", "hold steady"]);
    expect(dropped.filter((d) => d.reason.startsWith("undeveloped_duplicate"))).toEqual([]);
  });
});
