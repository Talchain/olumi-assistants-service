/**
 * ⭐⭐ THE FIXED-INPUT REPLAY — the testability fix, and the instrument that
 * would have caught the 14 Aug analysis outage before it deployed.
 *
 * Every unit test in this tree points at ONE hop, and every one of them was
 * green while the product shipped a graph whose entire outcome layer was
 * machine scaffolding. The property that failed is a property of the CHAIN.
 * `replayRecordSet` runs the chain on a FIXED INPUT with no LLM, so the
 * question "what does this record set become?" is answerable in CI.
 *
 * ── THE FIXTURES ARE HISTORIC CAPTURES, AND ARE APPEND-ONLY ───────────────
 * `live-emission-round11-set12.json` and the `round7-*` files record what the
 * model ACTUALLY emitted on dated builds. They are evidence, not fixtures to
 * keep current (trap 14b): a test may read them and may add new captures beside
 * them, and may never edit them to go green. Where an expectation below is a
 * MEASURED value rather than a spec-derived one, it says so and says at which
 * tip it was measured.
 *
 * ── WHAT THE INVARIANTS ARE WRITTEN AGAINST ───────────────────────────────
 * The SPEC, never the failure mode in hand (trap 13d):
 *   INV-R1  a record set containing risk/outcome claims projects risk/outcome
 *           nodes — expressibility, end to end;
 *   INV-R2  an authored bridge layer SUPPRESSES the scaffolding mint;
 *   INV-R3  a genuinely gapped set STILL gets the safety-net mint, and it is
 *           MARKED — the pair, so neither direction can pass alone;
 *   INV-R4  replay is byte-identical across runs.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { replayRecordSet, replayDigest, measureSemanticTable } from "../replay.js";
import { PROJECTOR_STRUCTURAL_CLASS } from "../projector.js";
import type { DraftRecordSet } from "../grammar.js";

function loadFixture(name: string): unknown {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

/** The banked round-11 live emission — a bare record set. */
function round11Set12(): DraftRecordSet {
  return loadFixture("live-emission-round11-set12.json") as DraftRecordSet;
}

/** A round-7 capture — `{ __PROVENANCE__, records, completion }`. */
function round7(name: string): DraftRecordSet {
  return (loadFixture(name) as { records: DraftRecordSet }).records;
}

const BRIEF_B3 =
  "We need 15% ARR growth next year without engineering attrition getting worse. " +
  "Do we bet the next two quarters on the AI copilot, finally do the platform rewrite, or neither?";

// ── INV-R1 ──────────────────────────────────────────────────────────────────

describe("INV-R1 — risks and outcomes reach the graph through the whole chain", () => {
  it("projects a risk node and an outcome node the model claimed, and they survive repair", async () => {
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "grow ARR 15% next year" },
        { kind: "option", source_quote: "hire a tech lead" },
        { kind: "option", source_quote: "hire two developers" },
      ],
      claims: [
        { claim_kind: "factor", label: "Engineering Throughput", basis: [0] },
        { claim_kind: "outcome", label: "Feature Delivery Rate", basis: [0] },
        { claim_kind: "risk", label: "Engineering Attrition", basis: [0] },
        { claim_kind: "causal_link", label: "lead raises throughput", from_stated: 1, to_claim: 0, effect: "positive" },
        { claim_kind: "causal_link", label: "devs raise throughput", from_stated: 2, to_claim: 0, effect: "positive" },
        { claim_kind: "causal_link", label: "throughput drives delivery", from_claim: 0, to_claim: 1, effect: "positive" },
        { claim_kind: "causal_link", label: "throughput strains the team", from_claim: 0, to_claim: 2, effect: "positive" },
        { claim_kind: "causal_link", label: "delivery reaches the goal", from_claim: 1, to_stated: 0, effect: "positive" },
        { claim_kind: "causal_link", label: "attrition threatens the goal", from_claim: 2, to_stated: 0, effect: "negative" },
      ],
    };

    const result = await replayRecordSet(records, { brief: "grow ARR 15% next year" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Bound by LABEL — identity, not a count another node could satisfy.
    expect(result.semantics.riskLabels).toContain("Engineering Attrition");
    expect(result.semantics.outcomeLabels).toContain("Feature Delivery Rate");
  });
});

// ── INV-R2 / INV-R3, asserted as a PAIR on one record-set shape ────────────

/**
 * One record set, two variants that differ ONLY in whether the model authored
 * the bridge. Neither assertion is evidence on its own: "no scaffolding" passes
 * trivially if the mint is broken, and "scaffolding present" passes trivially if
 * the gate never fires. The pair is the evidence.
 */
function recordsWithChain(authorBridge: boolean): DraftRecordSet {
  const claims: DraftRecordSet["claims"] = [
    { claim_kind: "factor", label: "Engineering Throughput", basis: [0] },
    { claim_kind: "causal_link", label: "lead raises throughput", from_stated: 1, to_claim: 0, effect: "positive" },
    { claim_kind: "causal_link", label: "devs raise throughput", from_stated: 2, to_claim: 0, effect: "positive" },
  ];
  if (authorBridge) {
    claims.push({ claim_kind: "outcome", label: "Feature Delivery Rate", basis: [0] });
    claims.push({ claim_kind: "causal_link", label: "throughput drives delivery", from_claim: 0, to_claim: 3, effect: "positive" });
    claims.push({ claim_kind: "causal_link", label: "delivery reaches the goal", from_claim: 3, to_stated: 0, effect: "positive" });
    // ⭐ AND THE REDUNDANT SHORTCUT, DELIBERATELY. Without it this variant emits
    // no `factor → goal` edge at all, so `fixFactorGoalEdges` never runs and the
    // assertion below would hold for a reason that has nothing to do with the
    // gap gate — proven by a mutant: removing the gate left this test GREEN.
    // With the shortcut present the variant exercises the gate end to end.
    claims.push({ claim_kind: "causal_link", label: "throughput also bears on the goal", from_claim: 0, to_stated: 0, effect: "positive" });
  } else {
    // The shape the starved grammar forced: a factor pointed straight at the goal.
    claims.push({ claim_kind: "causal_link", label: "throughput reaches the goal", from_claim: 0, to_stated: 0, effect: "positive" });
  }
  return {
    stated_items: [
      { kind: "goal", source_quote: "grow ARR 15% next year" },
      { kind: "option", source_quote: "hire a tech lead" },
      { kind: "option", source_quote: "hire two developers" },
    ],
    claims,
  };
}

describe("INV-R2/R3 — the scaffolding mint fires on a gap and only on a gap", () => {
  it("INV-R2: an AUTHORED outcome layer suppresses the mint entirely", async () => {
    const result = await replayRecordSet(recordsWithChain(true), { brief: "grow ARR 15% next year" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.semantics.outcomeLabels).toEqual(["Feature Delivery Rate"]);
    expect(result.semantics.scaffoldedOutcomeIds).toEqual([]);
    // The independent contrast reading agrees: no `out_<factor>_impact` id exists.
    expect(result.semantics.impactPatternOutcomeIds).toEqual([]);
    expect(result.semantics.scaffoldedOutcomeShare).toBe(0);
    // PRECONDITION — the gate really was exercised. Without this the assertions
    // above would also pass on a graph that never had a `factor → goal` edge to
    // suppress, which is a test agreeing with itself (trap 13b).
    expect(result.repairs.map((r) => r.code)).toContain("FACTOR_GOAL_SHORTCUT_REDUNDANT");
  });

  it("INV-R3: a GENUINELY GAPPED set still gets the safety net, and it is MARKED", async () => {
    const result = await replayRecordSet(recordsWithChain(false), { brief: "grow ARR 15% next year" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The net caught it…
    expect(result.semantics.outcomeCount).toBeGreaterThan(0);
    // …and every outcome on this graph is disclosed as ours.
    expect(result.semantics.scaffoldedOutcomeShare).toBe(1);
    expect(result.semantics.scaffoldedOutcomeIds.length).toBe(result.semantics.outcomeCount);
  });

  it("the two variants genuinely differ — the pair is discriminating, not two copies", async () => {
    // Pins the PRECONDITION of the pair above: if both variants ever produced
    // the same outcome layer, both tests would still pass while proving nothing
    // (trap 13b — a guard whose discrimination depends on something nothing pins).
    const authored = await replayRecordSet(recordsWithChain(true), { brief: "grow ARR 15% next year" });
    const gapped = await replayRecordSet(recordsWithChain(false), { brief: "grow ARR 15% next year" });
    expect(authored.ok && gapped.ok).toBe(true);
    if (!authored.ok || !gapped.ok) return;
    expect(authored.semantics.outcomeLabels).not.toEqual(gapped.semantics.outcomeLabels);
  });
});

// ── The banked live capture ────────────────────────────────────────────────

describe("the banked round-11 live emission, replayed", () => {
  it("reproduces the outage's signature: zero risks, and an outcome layer that is 100% ours", async () => {
    // ⚠ THIS FIXTURE PREDATES THE WIDENED GRAMMAR. It carries no risk or
    // outcome claim — it could not — and one of its FACTOR claims is labelled
    // "Engineering Attrition Risk", which is the flattening the widening exists
    // to end. So the widening does not change what this capture projects, and
    // must not: rewriting the capture to exercise the new kinds would falsify
    // the record.
    //
    // What the change DOES do here is make the graph tell the truth about
    // itself. Before: four outcomes, none marked. After: four outcomes, all
    // four marked as the machine's.
    const result = await replayRecordSet(round11Set12(), { brief: BRIEF_B3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const flattened = result.records.claims.filter(
      (c) => c.claim_kind === "factor" && c.label === "Engineering Attrition Risk",
    );
    expect(flattened).toHaveLength(1);

    expect(result.semantics.riskCount).toBe(0);
    expect(result.semantics.outcomeCount).toBeGreaterThan(0);
    expect(result.semantics.scaffoldedOutcomeShare).toBe(1);
    // Every minted id is marked — the two readings agree, so neither mint site
    // is silently unmarked.
    expect(result.semantics.scaffoldedOutcomeIds).toEqual(result.semantics.impactPatternOutcomeIds);
  });

  it("gives every option a provenance class — none is left unclassified", async () => {
    const result = await replayRecordSet(round11Set12(), { brief: BRIEF_B3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.semantics.optionCount).toBeGreaterThan(0);
    for (const option of result.semantics.optionProvenance) {
      expect(["stated", "ai_inferred", PROJECTOR_STRUCTURAL_CLASS]).toContain(
        option.provenance_class,
      );
    }
  });
});

describe("the banked round-7 captures, replayed", () => {
  /**
   * ⭐ A KNOWN-STATE TABLE, NOT THREE COPIES OF ONE ASSERTION.
   *
   * All three captures failed live with `MISSING_BRIDGE`. Replayed through the
   * current chain, TWO of them now end with a bridge layer and ONE still does
   * not — and the honest way to carry that is to pin EXACTLY which, so the suite
   * REDs if the set grows OR shrinks (trap 22f). A blanket "all three are fixed"
   * would be false; a blanket "none is asserted" would hide the two that are.
   *
   * WHY pass07 cannot be repaired deterministically, DERIVED rather than
   * excused: its projection yields ZERO factors (measured at this tip — five
   * options, one goal, one decision, five edges). `needsTerminalBridge` requires
   * at least one factor, deliberately: a bridge with no inbound edge is itself
   * `UNREACHABLE_FROM_DECISION`, so minting one would swap a blocking code for
   * another rather than clear it. This is the B1 shape the projector's header
   * documents — every link the model drew resolved onto an option refinement —
   * and it is a GENERATION failure, not a repair one. Nothing in this lane
   * claims to fix it.
   */
  const BRIDGED_CAPTURES = ["round7-completion-pass05-tie.json", "round7-completion-pass08.json"];
  const UNBRIDGEABLE_CAPTURES = ["round7-completion-pass07.json"];

  for (const name of BRIDGED_CAPTURES) {
    it(`${name}: ends with a bridge layer, and every scaffolded node in it is marked`, async () => {
      const result = await replayRecordSet(round7(name), { brief: BRIEF_B3 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.semantics.outcomeCount + result.semantics.riskCount).toBeGreaterThan(0);
      expect(result.readiness.errorCodes).not.toContain("MISSING_BRIDGE");
      // Whatever the repairs minted here is disclosed as ours.
      expect(result.semantics.scaffoldedOutcomeIds).toEqual(
        result.semantics.impactPatternOutcomeIds,
      );
    });
  }

  for (const name of UNBRIDGEABLE_CAPTURES) {
    it(`${name}: is STILL unbridgeable, and for the derivable reason — zero factors`, async () => {
      const result = await replayRecordSet(round7(name), { brief: BRIEF_B3 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The reason, asserted — not just the symptom. If a later change makes
      // factors survive here, this REDs and the capture moves to the list above.
      expect(result.semantics.byKind.factor ?? 0).toBe(0);
      expect(result.semantics.outcomeCount + result.semantics.riskCount).toBe(0);
      expect(result.readiness.errorCodes).toContain("MISSING_BRIDGE");
    });
  }
});

// ── INV-R4 ──────────────────────────────────────────────────────────────────

describe("INV-R4 — replay is deterministic", () => {
  it("is byte-identical across three runs of the same record set", async () => {
    const digests: string[] = [];
    for (let i = 0; i < 3; i++) {
      digests.push(replayDigest(await replayRecordSet(round11Set12(), { brief: BRIEF_B3 })));
    }
    expect(digests[1]).toBe(digests[0]);
    expect(digests[2]).toBe(digests[0]);
    // Positive control: the digest is non-trivial, so "identical" is not three
    // copies of an empty string (trap 13 — an absence probe needs a presence).
    expect(digests[0]!.length).toBeGreaterThan(1000);
  });

  it("is byte-identical across two runs of every banked capture", async () => {
    for (const name of [
      "round7-completion-pass05-tie.json",
      "round7-completion-pass07.json",
      "round7-completion-pass08.json",
    ]) {
      const a = replayDigest(await replayRecordSet(round7(name), { brief: BRIEF_B3 }));
      const b = replayDigest(await replayRecordSet(round7(name), { brief: BRIEF_B3 }));
      expect(b, `${name} replayed differently on the second run`).toBe(a);
    }
  });
});

// ── The semantic table itself ──────────────────────────────────────────────

describe("measureSemanticTable", () => {
  it("reports `null` — not 0 — for the scaffolded share when there are no outcomes", () => {
    // "No outcomes exist" and "no outcome is scaffolding" are different findings
    // and must not collapse to the same number in the acceptance table.
    const table = measureSemanticTable({ nodes: [{ id: "g", kind: "goal" }], edges: [] });
    expect(table.outcomeCount).toBe(0);
    expect(table.scaffoldedOutcomeShare).toBeNull();
  });

  it("counts a scaffolded outcome by its MARKER, never by its label", () => {
    // An outcome a model legitimately names "Revenue Impact" must not be counted
    // as scaffolding (trap 19 — bind by identity, not by a predicate another
    // object satisfies).
    const table = measureSemanticTable({
      nodes: [
        { id: "out_authored", kind: "outcome", label: "Revenue Impact" },
        { id: "out_fac_a_impact", kind: "outcome", label: "Throughput Impact", provenance: { provenance_class: PROJECTOR_STRUCTURAL_CLASS } },
      ],
      edges: [],
    });
    expect(table.scaffoldedOutcomeIds).toEqual(["out_fac_a_impact"]);
    expect(table.scaffoldedOutcomeShare).toBe(0.5);
  });
});
