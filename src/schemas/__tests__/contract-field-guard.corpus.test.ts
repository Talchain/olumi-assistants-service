/**
 * ⭐⭐ THE HAND-WRITTEN HALF OF THE CONTRACT FIELD GUARD.
 *
 * `contract-field-guard.ts` DERIVES its field sets from the schemas, so nothing
 * it reports can be stale. ⛔ But a derived guard proves AGREEMENT and can never
 * prove COMPLETENESS (CLAUDE.md trap 12d): deleting a key from a canonical map
 * leaves every derived guard green, because the guard's universe shrank with it.
 * Derivation moves the risk; it does not remove it.
 *
 * So this file does the thing derivation cannot: it takes the twins THIS ESTATE
 * ALREADY PAID FOR, feeds them to the detectors, and asserts each one is found.
 * If the check cannot find a twin we already know exists, it is not a check.
 *
 * ── AND THE FINDING THAT MATTERS MOST HERE ───────────────────────────────────
 * Of the eight known twins, the DERIVED detectors find TWO. Five need a human
 * to have written them into the synonym registry, and one is not a field-name
 * pair at all. That ratio is asserted below as a first-class test, because the
 * tempting reading of a green derived guard is "we have twin detection now",
 * and the measured answer is "we have 2 of 8 by rule and 6 of 8 by memory".
 * `kind` vs `type` share NO CHARACTERS: no lexical rule reaches it, ever, and a
 * check that claimed otherwise would be theatre.
 */
import { describe, it, expect } from "vitest";
import {
  detectStripped,
  detectSurfaceTwins,
  detectCaseTwins,
  detectConventionOutliers,
  detectSynonyms,
  detectOrphans,
  runDetectors,
  adjudicate,
  deriveSurfaces,
  normaliseToken,
  normaliseSurfaceName,
  SYNONYM_REGISTRY,
  SURFACE_PAIRS,
  DECISIONS,
  type SchemaSurface,
  type SynonymSet,
} from "../contract-field-guard.js";
import {
  walkSource,
  scanSourceTokens,
  assertScanIsSound,
  GUARD_MODULE,
  DECLARATION_FILE,
} from "../../../scripts/ci/contract-field-scan.js";

const surface = (
  name: string,
  fields: string[],
  unknownKeys: SchemaSurface["unknownKeys"] = "strip",
): SchemaSurface => ({ name, fields: [...fields].sort(), unknownKeys });

/** A universe with nothing wrong in it — the negative control for every detector. */
const CLEAN: SchemaSurface[] = [
  surface("contract.ThingSchema", ["alpha", "beta"], "passthrough"),
  surface("cee.Other", ["alpha", "beta"]),
];

const ids = (fs: { id: string }[]): string[] => fs.map((f) => f.id).sort();

// ============================================================================
// 1. THE EIGHT KNOWN TWINS — the corpus. One block each, naming the detector
//    that finds it and, where none can, saying so.
// ============================================================================

describe("the eight known twins — every one must be found by something", () => {
  it("#1 scenarios.brief_text vs brief — SYNONYM REGISTRY (no lexical rule reaches it)", () => {
    const u = [surface("db.scenarios", ["brief", "brief_text"], "passthrough")];
    expect(ids(detectSynonyms(u, SYNONYM_REGISTRY))).toContain("synonym:brief-vs-brief_text");
    // Honest negative: `brief` is a PREFIX of `brief_text`, and a containment
    // rule would find it — but the same rule flags the goal_threshold family as
    // four twins. Containment is deliberately not shipped (see the guard's
    // header), so the lexical detectors are silent here and must be seen to be.
    expect(detectCaseTwins(u)).toEqual([]);
  });

  it("#2 two share mechanisms — OUT OF UNIVERSE, and that is stated, not hidden", () => {
    // This one is a pair of MECHANISMS, not two spellings of one field on the
    // node/graph contract. No field-name check can reach it and none should
    // claim to. Recorded here so the corpus is complete and the gap is visible.
    const nodeGraphFields = new Set(deriveSurfaces().flatMap((s) => s.fields));
    expect(nodeGraphFields.has("share")).toBe(false);
    expect(nodeGraphFields.has("share_id")).toBe(false);
  });

  it("#3 graph_hash_at_run vs graph_hash — SYNONYM REGISTRY", () => {
    const u = [surface("cee.Run", ["graph_hash", "graph_hash_at_run"], "passthrough")];
    expect(ids(detectSynonyms(u, SYNONYM_REGISTRY))).toContain(
      "synonym:graph_hash-vs-graph_hash_at_run",
    );
  });

  it("#4 observedState vs observed_state — CASE-TWIN DETECTOR, found by rule", () => {
    const u = [
      surface("contract.NodeLike", ["id", "observedState"], "passthrough"),
      surface("cee.NodeLike", ["id", "observed_state"]),
    ];
    const found = detectCaseTwins(u);
    expect(ids(found)).toEqual(["case-twin:observedstate"]);
    expect(found[0]?.detail).toContain("observedState");
    expect(found[0]?.detail).toContain("observed_state");
    // It is found WITHOUT anybody having written it down anywhere.
    expect(SYNONYM_REGISTRY.some((s) => s.names.includes("observedState"))).toBe(false);
  });

  it("#5 kind vs type — SYNONYM REGISTRY ONLY. ⛔ NO lexical rule can EVER find this", () => {
    const u = [surface("contract.NodeLike", ["kind", "type"], "passthrough")];
    expect(ids(detectSynonyms(u, SYNONYM_REGISTRY))).toContain("synonym:kind-vs-type");
    // ⭐ THE MOST IMPORTANT ASSERTION IN THIS FILE. The two names share no
    // characters, so case/separator normalisation cannot connect them and
    // neither could any containment or edit-distance rule. If this ever starts
    // failing, someone has widened a lexical detector until it guesses — and a
    // detector that guesses at synonyms will flag `label` against `label_authored`
    // and be switched off within a week.
    expect(normaliseToken("kind")).not.toBe(normaliseToken("type"));
    expect(detectCaseTwins(u)).toEqual([]);
    expect(detectConventionOutliers(u)).toEqual([]);
  });

  it("#6 in_model meaning three different things — SYNONYM REGISTRY", () => {
    const u = [
      surface("ui.grounded", ["in_model", "not_in_model"], "passthrough"),
      surface("cee.tally", ["modelled"], "passthrough"),
    ];
    expect(ids(detectSynonyms(u, SYNONYM_REGISTRY))).toContain("synonym:in_model-three-concepts");
  });

  it("#7 attribution_stability vs run-delta attribution — SYNONYM REGISTRY, no lexical route", () => {
    const u = [surface("cee.enrichment", ["attribution_stability", "run_delta"], "passthrough")];
    expect(ids(detectSynonyms(u, SYNONYM_REGISTRY))).toContain(
      "synonym:attribution_stability-vs-run_delta",
    );
    expect(detectCaseTwins(u)).toEqual([]);
  });

  it("#8 two NodeV3 schemas — SURFACE-TWIN DETECTOR, found by rule, and it fires LIVE", () => {
    const u = [
      surface("contract.NodeV3Schema", ["id", "kind", "type"], "passthrough"),
      surface("cee.NodeV3", ["id", "kind", "description"]),
    ];
    const found = detectSurfaceTwins(u);
    expect(ids(found)).toEqual(["surface-twin:nodev3"]);
    expect(found[0]?.detail).toContain("passthrough");
    expect(found[0]?.detail).toContain("strip");
    // Not a fixture-only capability: the real contract carries this pair today.
    expect(ids(detectSurfaceTwins(deriveSurfaces()))).toEqual([
      "surface-twin:edgev3",
      "surface-twin:nodev3",
    ]);
  });

  it("⭐ THE SCORECARD: derived rules find 2 of 8. Six need a human to have written them down", () => {
    const foundByDerivedRule = ["observedState-vs-observed_state", "two-NodeV3-schemas"];
    const foundOnlyByRegistry = [
      "brief-vs-brief_text",
      "graph_hash-vs-graph_hash_at_run",
      "kind-vs-type",
      "in_model-three-concepts",
      "attribution_stability-vs-run_delta",
    ];
    const outOfUniverse = ["two-share-mechanisms"];
    expect(foundByDerivedRule.length).toBe(2);
    expect(foundOnlyByRegistry.length).toBe(5);
    expect(outOfUniverse.length).toBe(1);
    expect(
      foundByDerivedRule.length + foundOnlyByRegistry.length + outOfUniverse.length,
    ).toBe(8);
    // Every registry-caught twin must actually BE in the registry — otherwise
    // this scorecard is a comment pretending to be a test.
    for (const id of foundOnlyByRegistry) {
      expect(SYNONYM_REGISTRY.map((s) => s.id)).toContain(id);
    }
  });
});

// ============================================================================
// 2. THE DETECTORS MUST BE ABLE TO STAY SILENT. A detector that fires on
//    everything is not a detector, and a corpus of positives alone cannot tell.
// ============================================================================

describe("negative controls — a clean universe produces nothing", () => {
  it("no detector fires on a universe with nothing wrong in it", () => {
    expect(detectSurfaceTwins(CLEAN)).toEqual([]);
    expect(detectCaseTwins(CLEAN)).toEqual([]);
    expect(detectConventionOutliers(CLEAN)).toEqual([]);
    expect(detectSynonyms(CLEAN, SYNONYM_REGISTRY)).toEqual([]);
    expect(
      detectStripped(CLEAN, [{ contract: "contract.ThingSchema", implementation: "cee.Other" }]),
    ).toEqual([]);
    expect(detectOrphans(CLEAN, new Map([["alpha", 3], ["beta", 1]]))).toEqual([]);
  });

  it("a passthrough implementation strips nothing, so the stripped detector stays silent", () => {
    const u = [
      surface("contract.T", ["a", "b"], "passthrough"),
      surface("cee.T", ["a"], "passthrough"),
    ];
    expect(detectStripped(u, [{ contract: "contract.T", implementation: "cee.T" }])).toEqual([]);
    // …and the SAME universe with a stripping implementation does fire. One
    // arm alone proves nothing; the pair proves the policy is what discriminates.
    const stripping = [u[0]!, surface("cee.T", ["a"], "strip")];
    expect(ids(detectStripped(stripping, [{ contract: "contract.T", implementation: "cee.T" }])))
      .toEqual(["stripped:cee.T:b"]);
  });

  it("a same-named surface with an IDENTICAL shape is an alias, not a twin", () => {
    const u = [
      surface("contract.ThingSchema", ["a", "b"], "passthrough"),
      surface("cee.Thing", ["a", "b"]),
    ];
    expect(detectSurfaceTwins(u)).toEqual([]);
    expect(normaliseSurfaceName("contract.ThingSchema")).toBe(normaliseSurfaceName("cee.Thing"));
  });

  it("a renamed surface FAILS LOUD rather than silently reporting a clean result", () => {
    expect(() => detectStripped(CLEAN, [{ contract: "contract.Gone", implementation: "cee.Other" }]))
      .toThrow(/unknown contract surface/);
    expect(() => detectStripped(CLEAN, [{ contract: "contract.ThingSchema", implementation: "cee.Gone" }]))
      .toThrow(/unknown implementation surface/);
  });

  it("the convention detector reports nothing when the two conventions are tied", () => {
    const tied = [surface("cee.T", ["a_b", "cD"], "passthrough")];
    expect(detectConventionOutliers(tied)).toEqual([]);
  });
});

// ============================================================================
// 3. THE SCAN'S OWN FAILURE MODES. Both of these were MEASURED while building
//    this, not imagined, and each would silently disable the orphan detector.
// ============================================================================

describe("the source scan cannot be allowed to measure itself", () => {
  const files = walkSource();
  const scan = scanSourceTokens(files);

  it("the scan is sound: controls pass before any result is believed", () => {
    expect(assertScanIsSound(files, scan)).toBeNull();
    expect(scan.filesCounted).toBeGreaterThan(500);
  });

  it("⛔ the guard's OWN module is excluded — its ledger names every orphan it documents", () => {
    // MEASURED, not hypothetical: recording `orphan:analysis_participation` in
    // DECISIONS put that token back into the tree as a string literal (the
    // comment stripper keeps literals, correctly), the orphan stopped being
    // found, the decision went stale and the guard RED on its own entry.
    // An instrument whose output is inside its corpus cannot measure.
    expect(scan.excluded).toContain(GUARD_MODULE);
    expect(scan.excluded).toContain(DECLARATION_FILE);
    // The exclusion must still MATCH something. If either file moves, this is
    // what fails — rather than the exclusion quietly becoming a no-op.
    expect(files).toContain(GUARD_MODULE);
    expect(files).toContain(DECLARATION_FILE);
  });

  it("an empty or blind scan is a HARD ERROR, never a pass", () => {
    expect(assertScanIsSound([], scan)).toMatch(/scanned 0 source files/);
    const blind = { ...scan, occurrences: new Map<string, number>() };
    expect(assertScanIsSound(files, blind)).toMatch(/positive control failed/);
    const noOpExclusion = { ...scan, excluded: ["/nowhere/at/all.ts"] };
    expect(assertScanIsSound(files, noOpExclusion)).toMatch(/exclusion is therefore a no-op/);
  });

  it("orphan claims are sound in ONE direction only, and the detector honours that", () => {
    const u = [surface("cee.T", ["written", "never_written"], "passthrough")];
    // zero ⇒ orphan; any non-zero ⇒ no claim at all, however small.
    expect(ids(detectOrphans(u, new Map([["written", 1]])))).toEqual(["orphan:never_written"]);
    expect(detectOrphans(u, new Map([["written", 1], ["never_written", 1]]))).toEqual([]);
    // A contract-side field is never asked about CEE's source: CEE is not its producer.
    const contractSide = [surface("contract.T", ["nothing_here"], "passthrough")];
    expect(detectOrphans(contractSide, new Map())).toEqual([]);
  });
});

// ============================================================================
// 4. THE LIVE RATCHET — both directions, so the ledger can neither go short
//    nor rot. This is what turns the check into a decision record.
// ============================================================================

describe("the live node/graph contract, adjudicated", () => {
  const files = walkSource();
  const scan = scanSourceTokens(files);
  const report = adjudicate(runDetectors(deriveSurfaces(), scan.occurrences), DECISIONS);

  it("⭐ adjudicate reports BOTH directions BY CONSTRUCTION, not because today is clean", () => {
    // Without this, the two tests below are a guard agreeing with itself: an
    // `adjudicate` that returned `stale: []` unconditionally would satisfy
    // "every decision still reproduces" forever, on a ledger full of rot. Ask
    // what would have to be true for a test to pass while the property fails,
    // then write THAT case.
    const r = adjudicate(
      [{ detector: "orphan", id: "orphan:present", detail: "d" }],
      [{ id: "orphan:absent", status: "ACCEPTED", decision: "its finding is gone" }],
    );
    expect(r.unadjudicated.map((f) => f.id)).toEqual(["orphan:present"]);
    expect(r.stale.map((d) => d.id)).toEqual(["orphan:absent"]);
    // …and a matched pair is neither, and lands in the right status bucket.
    const matched = adjudicate(
      [{ detector: "orphan", id: "orphan:x", detail: "d" }],
      [{ id: "orphan:x", status: "OPEN", decision: "nobody has settled this" }],
    );
    expect(matched.unadjudicated).toEqual([]);
    expect(matched.stale).toEqual([]);
    expect(matched.open.map((d) => d.id)).toEqual(["orphan:x"]);
    expect(matched.accepted).toEqual([]);
  });

  it("every finding has a recorded decision (the ledger cannot go short)", () => {
    expect(report.unadjudicated.map((f) => `${f.id} — ${f.detail}`)).toEqual([]);
  });

  it("every recorded decision still reproduces (the ledger cannot rot)", () => {
    expect(report.stale.map((d) => d.id)).toEqual([]);
  });

  it("the OPEN questions are exactly this set — adding one requires an explicit diff", () => {
    // There is no date trigger anywhere in this check: a CI job that turns red
    // on a calendar is a time bomb, not a mechanism. What this gives instead is
    // a count a human can watch go up, pinned so it cannot move quietly.
    expect(report.open.map((d) => d.id).sort()).toEqual([
      "convention-outlier:extractionType",
      "stripped:cee.NodeV3:body",
      "stripped:cee.NodeV3:categories",
      "stripped:cee.NodeV3:type",
      "synonym:body-vs-description",
      "synonym:kind-vs-type",
    ]);
  });

  it("the live contract really is two schemas that disagree — the premise, re-derived", () => {
    const s = deriveSurfaces();
    const contractNode = s.find((x) => x.name === "contract.NodeV3Schema");
    const ceeNode = s.find((x) => x.name === "cee.NodeV3");
    expect(contractNode?.unknownKeys).toBe("passthrough");
    expect(ceeNode?.unknownKeys).toBe("strip");
    // The node the UI sees is not the node the contract describes.
    expect(contractNode?.fields).not.toEqual(ceeNode?.fields);
  });

  it("SURFACE_PAIRS resolves — a rename cannot silently empty the stripped detector", () => {
    const names = new Set(deriveSurfaces().map((s) => s.name));
    for (const pair of SURFACE_PAIRS) {
      expect(names).toContain(pair.contract);
      expect(names).toContain(pair.implementation);
    }
  });

  it("every synonym set is well formed — a one-member set can never fire", () => {
    const seen = new Set<string>();
    for (const set of SYNONYM_REGISTRY satisfies readonly SynonymSet[]) {
      expect(set.names.length).toBeGreaterThanOrEqual(2);
      expect(new Set(set.names).size).toBe(set.names.length);
      expect(seen.has(set.id)).toBe(false);
      seen.add(set.id);
      expect(set.why.length).toBeGreaterThan(40);
    }
  });
});
