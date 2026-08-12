/**
 * ⭐⭐ THE COMPLETION PASS'S KEEP/DISCARD PREDICATE — THE BLOCKING CLASSES ONLY.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * This predicate has now been written three times, and the first two were both
 * measured wrong ON REAL RUNS:
 *
 *   v1  NODE COUNT      — read the option-duplication merge's legitimate 8→6
 *                         collapse as harm.
 *   v2  ALL ASK ITEMS   — over the round-7 acceptance block it DISCARDED 7 of
 *                         11 completion passes, two of them on graphs that
 *                         plainly improved (`edges 4→12`, `edges 17→25`).
 *
 * Two reversals on one predicate is the point at which another guess is the
 * sunk-cost fallacy in engineering clothes (trap 22f). So v3 is DERIVED: an ask
 * item counts only if it names a validator code that the deterministic sweep
 * itself routes to Bucket C. The tests below therefore have two jobs, and the
 * second matters as much as the first:
 *
 *   1. the two demonstrably-wrong discards are now KEPT, and
 *   2. a completion that genuinely WORSENS a blocking class is STILL DISCARDED.
 *
 * ── THE DATA IS NOT MINE ───────────────────────────────────────────────────
 * The two keep cases are HISTORIC CAPTURES — the model's real emissions on
 * dated runs, decoded from the round-7 redacting-proxy captures, with the live
 * outcome of each run recorded in the fixture. A corpus written from the
 * author's head cannot see the class the author did not imagine (trap 22), and
 * this predicate's entire failure history is exactly that class.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  enumerateCompletionAsk,
  mergeCompletionClaims,
  countBlockingAskItems,
  isBlockingAskItem,
  shouldKeepCompletion,
  type CompletionAskItem,
} from "../completion.js";
import { projectRecordsToGraph } from "../projector.js";
import type { DraftRecordSet, DraftInferenceClaim } from "../grammar.js";
import { BUCKET_C_CODES } from "../../../unified-pipeline/stages/repair/bucket-c-codes.js";
import { validateGraph } from "../../../../validators/graph-validator.js";
import type { GraphT } from "../../../../schemas/graph.js";

const HERE = dirname(fileURLToPath(import.meta.url));

interface BankedPass {
  __PROVENANCE__: Record<string, string | number>;
  records: DraftRecordSet;
  completion: { claims: DraftInferenceClaim[] };
}

function banked(name: string): BankedPass {
  const parsed = JSON.parse(readFileSync(join(HERE, "fixtures", name), "utf8")) as BankedPass;
  // NON-VACUITY: a fixture that failed to load, or loaded empty, must not be
  // able to agree with anything (trap 13 — an absence probe with no positive
  // control). Every number below is derived from these two arrays.
  expect(parsed.records.stated_items.length).toBeGreaterThan(0);
  expect(parsed.records.claims.length).toBeGreaterThan(0);
  expect(parsed.completion.claims.length).toBeGreaterThan(0);
  return parsed;
}

/** The two measures, side by side: the one that ran in round 7, and the derived one. */
function replay(pass: BankedPass) {
  const projection = projectRecordsToGraph(pass.records);
  const askBefore = enumerateCompletionAsk(pass.records, projection);
  const merged = mergeCompletionClaims(pass.records, { claims: pass.completion.claims });
  if (!merged.ok) throw new Error(`merge declined: ${merged.reason}`);
  const reprojected = projectRecordsToGraph(merged.records);
  const askAfter = enumerateCompletionAsk(merged.records, reprojected);
  return {
    projection,
    reprojected,
    askBefore,
    askAfter,
    /** v2, reproduced LITERALLY — the expression that actually ran in round 7. */
    v2Keeps: askAfter.items.length < askBefore.items.length,
    /**
     * v3 — the PRODUCTION decision function itself, not a restatement of it.
     * A spec that re-computes the comparison agrees with itself whatever the
     * adapter does; this one fails when the shipped decision changes.
     */
    v3Keeps: shouldKeepCompletion(askBefore, askAfter),
    blockingBefore: countBlockingAskItems(askBefore),
    blockingAfter: countBlockingAskItems(askAfter),
  };
}

describe("⭐⭐ the two completion passes round 7 threw away, replayed from their own captures", () => {
  it.each([
    // name, fixture, the improvement the discard destroyed
    ["run 16 · B1 · the run that FAILED live", "round7-completion-pass07.json"],
    ["run 18 · B3 · the run that passed on pass 1 alone", "round7-completion-pass08.json"],
  ])("%s — v2 discards it, v3 keeps it, and the graph is strictly richer", (_name, fixture) => {
    const pass = banked(fixture);
    const r = replay(pass);

    // ── THE PRECONDITION, PINNED IN-TEST ──────────────────────────────────
    // These cases are only evidence if they really are the v2 discards. A
    // guard whose discrimination rests on a fixture nothing pins is a guard
    // agreeing with itself (trap 13b), so v2's verdict is asserted here rather
    // than assumed from the round-7 log.
    expect(r.v2Keeps).toBe(false);

    // ── THE HARM THE DISCARD DID ──────────────────────────────────────────
    // Strictly more causal structure survived the projector after the merge.
    // Bound to edges, which is what the user's model is made of.
    expect(r.reprojected.graph.edges.length).toBeGreaterThan(r.projection.graph.edges.length);

    // ── THE FIX ───────────────────────────────────────────────────────────
    expect(r.blockingAfter).toBeLessThanOrEqual(r.blockingBefore);
    expect(r.v3Keeps).toBe(true);
  });

  it("⭐ THE TIE — blocking unchanged, graph richer, and the completion is KEPT", () => {
    // ⚠ THIS CASE EXISTS BECAUSE A MUTANT SURVIVED. The first mutation run
    // reverted `<=` to `<` (strict improvement) and NOTHING went red: both
    // banked keep cases happen to improve strictly (5→1 and 2→0), so the tie —
    // the exact shape `<=` was chosen for — was untested. A survivor is a
    // claim, and the only way to settle one is a discriminating fixture
    // (trap 13c). This is that fixture, and it is a real run, not a
    // construction: round 7's pass 05, whose completion added two edges at an
    // unchanged blocking count and was thrown away.
    // ⚠⚠ RE-MEASURED AT ROUND 11, AND THE NUMBERS MOVED — recorded rather than
    // quietly re-baselined. This pass IS run 12, whose single blocking item was
    // `options_indistinguishable`: the model's "Rewrite first, then copilot
    // (sequenced)" carried the same intervention signature as the user's
    // "finally do the platform rewrite". The projector's fixed-point demote now
    // withdraws that option and DISCLOSES it, so the collision no longer reaches
    // the ask at all. The tie is therefore at 0–0 where it used to be at 1–1.
    //
    // THE DISCRIMINATION IS UNCHANGED, which is the only reason this fixture is
    // still here: `shouldKeepCompletion` is `after <= before`, and a mutant
    // narrowing it to `<` reads `0 < 0 === false` and REDs on this test exactly
    // as it did at 1–1. The `it` below carries the tie at a POSITIVE count, so
    // the property is not left resting on a zero.
    const pass = banked("round7-completion-pass05-tie.json");
    const r = replay(pass);

    expect(r.v2Keeps).toBe(false);                              // v2 discarded it
    expect(r.blockingAfter).toBe(r.blockingBefore);              // …at a TIE
    expect(r.blockingBefore).toBe(0);                            // now zero — see above
    expect(r.v3Keeps).toBe(true);                               // v3 keeps it

    // ⚠ AND THE COST, PINNED RATHER THAN OMITTED. Three of this completion's
    // five claims elaborate the option that was withdrawn, so the merge adds no
    // edges here any more (it added two before the demote existed). Every one of
    // them is DISCLOSED — the model's work is visible to a reader, not lost —
    // and the trade is a valid graph carrying the user's own three options
    // instead of a 500 carrying none.
    expect(r.reprojected.graph.edges.length).toBe(r.projection.graph.edges.length);
    // Pinned to the EXACT measured count, not `> 0`: this is a banked capture,
    // so the number is a fact about it. A loose bound would stay green if the
    // demote started swallowing more of the completion than it does today.
    const demotedEndpoints = r.reprojected.dropped.filter(
      (d) => d.reason === "endpoint_demoted_duplicate",
    );
    expect(demotedEndpoints.map((d) => d.claim_index).sort((a, b) => a - b)).toEqual([14, 30, 31, 32]);
    const demote = r.reprojected.dropped.find((d) => d.reason === "undeveloped_duplicate_of_stated");
    expect(demote?.label).toBe("Rewrite first, then copilot (sequenced)");
    expect(demote?.duplicate_of_label).toBe("finally do the platform rewrite");
  });

  it("the improvement v2 could not see is NON-BLOCKING disclosure growth, not blocking growth", () => {
    // The mechanism, asserted rather than described: on run 16 the ask's TOTAL
    // does not fall while its blocking count collapses. Everything the ask
    // retains is a projector disclosure about an edge that never entered the
    // graph, and the merge is append-only, so those disclosures count against
    // the completion for ever under a total-count comparator.
    //
    // ⚠ RE-MEASURED AT ROUND 11. Before the projector's demote pass the totals
    // were 7 → 9 with blocking 7 → 2; they are now 7 → 7 with blocking 7 → 0,
    // because the two `options_indistinguishable` items are resolved upstream.
    // The comparison is SHARPER than it was, not weaker: askBefore is 7 items
    // ALL of which are blocking, askAfter is 7 items NONE of which are — the
    // same total, an entirely different composition. A total-count comparator
    // is blind to that by construction, which is the claim this test makes.
    const r = replay(banked("round7-completion-pass07.json"));
    expect(r.askAfter.items.length).toBeGreaterThanOrEqual(r.askBefore.items.length);
    expect(r.blockingAfter).toBeLessThan(r.blockingBefore);
    expect(r.blockingBefore).toBe(r.askBefore.items.length); // before: every item blocking
    expect(r.blockingAfter).toBe(0);                          // after: none of them

    const grown = r.askAfter.items.filter((i) => !isBlockingAskItem(i));
    expect(grown.length).toBeGreaterThan(0);
    // Every one of them names NO validator code, because its edge was dropped.
    for (const item of grown) expect(item.validatorCode).toBeNull();
  });
});

describe("⭐⭐ the guard's PURPOSE survives — a completion that worsens a blocking class is still discarded", () => {
  // ⚠ WRITTEN AGAINST THE SPEC, NOT AGAINST THE FAILURE IN HAND (trap 13d).
  // The property is "the completion can never be the reason a draft got worse".
  // A test built only from the two rescued cases would pass with the predicate
  // hard-wired to `true`, which is the opposite defect and just as shippable.
  const base: DraftRecordSet = {
    stated_items: [
      { kind: "goal", source_quote: "grow revenue" },
      { kind: "option", source_quote: "hire more people" },
      { kind: "option", source_quote: "do nothing" },
    ],
    claims: [
      { claim_kind: "factor", label: "sales capacity" },
      { claim_kind: "causal_link", label: "hiring lifts capacity", from_stated: 1, to_claim: 0, effect: "positive" },
      { claim_kind: "causal_link", label: "capacity lifts revenue", from_claim: 0, to_stated: 0, effect: "positive" },
    ],
  };

  it("DISCARDS a completion that adds a bare option — blocking goes UP", () => {
    const projection = projectRecordsToGraph(base);
    const askBefore = enumerateCompletionAsk(base, projection);
    const blockingBefore = countBlockingAskItems(askBefore);

    // A completion that mints a THIRD option with no chain of its own. This is
    // a case the transformation can actually trigger — not two rows that could
    // never have changed either way (trap 13d).
    const merged = mergeCompletionClaims(base, {
      claims: [{ claim_kind: "option_refinement", label: "hire a whole new region team" }],
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const reprojected = projectRecordsToGraph(merged.records);
    const askAfter = enumerateCompletionAsk(merged.records, reprojected);
    const blockingAfter = countBlockingAskItems(askAfter);

    // Non-vacuity: the new option really did land on the graph.
    expect(reprojected.graph.nodes.filter((n) => n.kind === "option").length)
      .toBeGreaterThan(projection.graph.nodes.filter((n) => n.kind === "option").length);

    expect(blockingAfter).toBeGreaterThan(blockingBefore);
    expect(shouldKeepCompletion(askBefore, askAfter)).toBe(false); // DISCARD
  });

  it("KEEPS a completion at a TIE on a POSITIVE blocking count", () => {
    // ⭐ THE TIE PROPERTY AT A NON-ZERO LEVEL. Round 11 moved the banked tie
    // fixture from 1–1 to 0–0 (the projector now resolves that collision before
    // the ask sees it), and a property left resting on a zero is one step from
    // resting on nothing. So the same discrimination is pinned here at a count
    // that cannot be reached by everything simply being fine.
    const projection = projectRecordsToGraph(base);
    const askBefore = enumerateCompletionAsk(base, projection);
    const blockingBefore = countBlockingAskItems(askBefore);
    // Precondition, pinned in-test: this base really does carry a blocking gap
    // ("do nothing" has no chain), so the tie below is a tie at a POSITIVE count.
    expect(blockingBefore).toBeGreaterThan(0);

    // A completion whose only claim is a link the projector REFUSES at emission
    // (`goal → factor` is unrescuable). It therefore adds a NON-blocking
    // disclosure and cannot change the blocking count in either direction.
    const merged = mergeCompletionClaims(base, {
      claims: [{ claim_kind: "causal_link", label: "the goal drives capacity", from_stated: 0, to_claim: 0 }],
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const reprojected = projectRecordsToGraph(merged.records);
    const askAfter = enumerateCompletionAsk(merged.records, reprojected);

    expect(countBlockingAskItems(askAfter)).toBe(blockingBefore);          // the TIE
    expect(askAfter.items.length).toBeGreaterThan(askBefore.items.length); // v2 would discard
    expect(shouldKeepCompletion(askBefore, askAfter)).toBe(true);          // v3 KEEPS
  });
});

describe("⭐ the classification is DERIVED, and its derivation is checked both ways", () => {
  /** Everything the enumerator emits across the whole corpus available here. */
  function corpusItems(): CompletionAskItem[] {
    const items: CompletionAskItem[] = [];
    for (const f of ["round7-completion-pass07.json", "round7-completion-pass08.json"]) {
      const pass = banked(f);
      const projection = projectRecordsToGraph(pass.records);
      items.push(...enumerateCompletionAsk(pass.records, projection).items);
      const merged = mergeCompletionClaims(pass.records, { claims: pass.completion.claims });
      if (merged.ok) {
        items.push(...enumerateCompletionAsk(merged.records, projectRecordsToGraph(merged.records)).items);
      }
    }
    // Plus the synthetic shapes the captures do not happen to contain.
    const bare: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "grow revenue" },
        { kind: "option", source_quote: "hire" },
        { kind: "option", source_quote: "do nothing" },
      ],
      claims: [],
    };
    items.push(...enumerateCompletionAsk(bare, projectRecordsToGraph(bare)).items);
    return items;
  }

  it("UNION ASSERTION — every code the ask names is one the sweep routes to Bucket C", () => {
    // ⚠ Derivation proves AGREEMENT and can never prove COMPLETENESS (trap
    // 12d), which is why the corpus above is real captures rather than three
    // shapes chosen to make this pass.
    const items = corpusItems();
    expect(items.length).toBeGreaterThan(10);
    const named = [...new Set(items.map((i) => i.validatorCode).filter((c): c is string => c !== null))];
    expect(named.length).toBeGreaterThan(0);
    for (const code of named) expect([...BUCKET_C_CODES]).toContain(code);
  });

  it("STRUCTURAL — an item that names no code is one whose edge never entered the graph", () => {
    const pass = banked("round7-completion-pass07.json");
    const merged = mergeCompletionClaims(pass.records, { claims: pass.completion.claims });
    if (!merged.ok) throw new Error("merge declined");
    const reprojected = projectRecordsToGraph(merged.records);
    const ask = enumerateCompletionAsk(merged.records, reprojected);

    const disclosures = ask.items.filter((i) => i.validatorCode === null);
    expect(disclosures.length).toBeGreaterThan(0);
    // Each such item quotes a dropped record's label, and NO edge with that
    // label is in the graph the validator will be handed.
    const edgeLabels = new Set(reprojected.graph.edges.map((e) => String((e as { label?: unknown }).label ?? "")));
    for (const d of disclosures) {
      const droppedLabel = reprojected.dropped.find((x) => d.detail.includes(String(x.label)));
      expect(droppedLabel, `no dropped record matches: ${d.detail}`).toBeDefined();
      expect(edgeLabels.has(String(droppedLabel!.label))).toBe(false);
    }
  });

  it("BOUND TO THE PRODUCER — the real validator raises each code the ask names", () => {
    // ⚠ A mutant kit measures whether a test can DETECT a change, never
    // whether the EXPECTATION is right (trap 13c). So the mapping is checked
    // against the VALIDATOR'S OWN BEHAVIOUR, not against this lane's reading
    // of the validator's source.
    const graph = {
      nodes: [
        { id: "d1", kind: "decision", label: "Decision" },
        { id: "g1", kind: "goal", label: "Goal" },
        { id: "o1", kind: "option", label: "Option one" },
        { id: "o2", kind: "option", label: "Option two" },
      ],
      edges: [
        { from: "d1", to: "o1" },
        { from: "d1", to: "o2" },
      ],
    } as unknown as GraphT;
    const result = validateGraph({ graph, requestId: "r8-mapping", phase: "post_sweep_authoritative" });
    const raised = new Set(result.errors.map((e) => e.code));
    // Positive control: this graph really is broken, so an empty set would mean
    // the probe, not the graph, is silent.
    expect(raised.size).toBeGreaterThan(0);
    // The codes the ask predicts on exactly this shape — bare options, nothing
    // terminating at the goal, and no outcome or risk node anywhere.
    expect(raised).toContain("NO_EFFECT_PATH");
    expect(raised).toContain("NO_PATH_TO_GOAL");
    // ⭐ ROUND 9 — MISSING_BRIDGE joined this list, and it joined it because the
    // PRODUCER raises it here, which is what this assertion checks. The v4 ask
    // did not predict it and said in terms that no completion pass could; that
    // was wrong. `fixFactorGoalEdges` runs unconditionally and MINTS an outcome
    // node for every `factor → goal` edge, so the code is a CONNECTIVITY symptom
    // and fires exactly when no such edge and no bridge node survive — which is
    // true of this graph and is why the validator raises it.
    expect(raised).toContain("MISSING_BRIDGE");
    // And the ask, on the same shape, names those and only those.
    const bare: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "Goal" },
        { kind: "option", source_quote: "Option one" },
        { kind: "option", source_quote: "Option two" },
      ],
      claims: [],
    };
    const ask = enumerateCompletionAsk(bare, projectRecordsToGraph(bare));
    const codes = new Set(ask.items.map((i) => i.validatorCode).filter((c) => c !== null));
    expect([...codes].sort()).toEqual(["MISSING_BRIDGE", "NO_EFFECT_PATH", "NO_PATH_TO_GOAL"]);
    // ⭐ AND THE DERIVED DIRECTION, which the literal above cannot give:
    // EVERY code the ask names must be one the real validator actually raises on
    // this graph. The literal is a completeness claim about the ask and has to be
    // maintained by hand; this is a soundness claim about it and maintains
    // itself. An ask item that predicted a code the validator never raises would
    // spend a completion turn manufacturing claims for a problem that does not
    // exist, and only this direction can see that.
    for (const code of codes) expect(raised).toContain(code);
  });

  it("a code the sweep does NOT route to Bucket C does not block", () => {
    // Kills the mutant that drops the Bucket-C test and keeps only "names a
    // code". `CONTROLLABLE_MISSING_DATA` is a real validator code the sweep
    // routes to Bucket B — asserted here, so this case cannot silently become
    // vacuous if the routing moves.
    expect(BUCKET_C_CODES.has("CONTROLLABLE_MISSING_DATA")).toBe(false);
    const notBlocking: CompletionAskItem = {
      kind: "option_without_chain",
      detail: "synthetic",
      validatorCode: "CONTROLLABLE_MISSING_DATA",
    };
    expect(isBlockingAskItem(notBlocking)).toBe(false);
    // …and the same item carrying a Bucket-C code DOES block. One assertion
    // alone proves nothing; the pair proves the Bucket-C set is what decides.
    expect(isBlockingAskItem({ ...notBlocking, validatorCode: "NO_EFFECT_PATH" })).toBe(true);
    expect(isBlockingAskItem({ ...notBlocking, validatorCode: null })).toBe(false);
  });
});
