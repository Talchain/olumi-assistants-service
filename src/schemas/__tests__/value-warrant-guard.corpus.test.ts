/**
 * ⭐⭐ THE HAND-WRITTEN HALF OF THE VALUE WARRANT GUARD.
 *
 * `value-warrant-guard.ts` DERIVES its field set from the Zod schemas, so
 * nothing it reports can be stale. ⛔ But a derived guard proves AGREEMENT and
 * can never prove COMPLETENESS (CLAUDE.md trap 12d): if the universe shrinks,
 * the guard shrinks with it and stays green. Derivation moves the risk.
 *
 * So this file does the two things derivation cannot:
 *
 *  1. A DISCRIMINATING PAIR ON THE LIVE CONTRACT, not on a fixture. A field we
 *     KNOW carries a warrant must not be reported, and a field we KNOW carries
 *     none must be — measured on the real schemas in the same run. One arm
 *     alone proves nothing: a guard that reports everything passes the second
 *     and a guard that reports nothing passes the first.
 *  2. THE ROT MUTANTS. Each of the guard's own safety mechanisms is broken
 *     deliberately here and asserted to fire, because a mechanism that has
 *     never been seen to fail is not evidence that it can.
 */
import { describe, it, expect } from "vitest";
import {
  deriveWarrantRoots,
  deriveValueSites,
  detectUnwarrantedValues,
  detectScopeAmbiguousWarrants,
  runWarrantDetectors,
  deadVocabulary,
  isQualifierName,
  adjudicate,
  WARRANT_TOKENS,
  WARRANT_DECISIONS,
  type ValueSite,
  type WarrantRoot,
} from "../value-warrant-guard.js";
import {
  deriveSurfaces,
  adjudicate as contractAdjudicate,
} from "../contract-field-guard.js";
import { z } from "zod";

const SITES = deriveValueSites();
const FINDINGS = runWarrantDetectors(SITES);
const FOUND = new Set(FINDINGS.map((f) => f.id));
const site = (id: string): ValueSite => {
  const s = SITES.find((x) => x.id === id);
  if (!s) throw new Error(`no such value site: ${id}`);
  return s;
};

// ============================================================================
// 1. THE DISCRIMINATING PAIR — on the LIVE contract, both arms in one run
// ============================================================================

describe("the discriminating pair — a guard that agrees with itself is worthless", () => {
  it("⭐ POSITIVE ARM: `strength.std`, which we KNOW has no warrant, IS reported", () => {
    // The estate's second measured instance: REQUIRED and positive at the
    // contract, and a consumer substituted a constant 0.15 where it was absent.
    // A real 0.15 and a fabricated 0.15 are indistinguishable BY VALUE.
    for (const id of ["contract.EdgeV3Schema::strength.std", "cee.EdgeV3::strength.std"]) {
      const s = site(id);
      expect(s.verdict).toBe("NONE");
      expect(s.fieldWarrants).toEqual([]);
      expect(s.levelWarrants).toEqual([]);
      expect(FOUND.has(`unwarranted:${id}`)).toBe(true);
    }
  });

  it("⭐ NEGATIVE ARM: `goal_threshold`, which we KNOW carries one, is NOT reported", () => {
    // #1604's worked example. Bound by IDENTITY — the exact warrant names — not
    // by "some warrant was found", which a widened matcher would also satisfy.
    const s = site("cee.NodeV3::goal_threshold");
    expect(s.verdict).toBe("FIELD");
    expect([...s.fieldWarrants].sort()).toEqual([
      "goal_threshold_cap_provenance",
      "goal_threshold_frame",
      "goal_threshold_unit",
    ]);
    expect(FOUND.has("unwarranted:cee.NodeV3::goal_threshold")).toBe(false);
    expect(FOUND.has("scope-ambiguous:cee.NodeV3::goal_threshold")).toBe(false);

    // The contract half of the same field carries only the frame, and that is
    // still enough — one warrant is the bar, not three.
    const contract = site("contract.NodeV3Schema::goal_threshold");
    expect(contract.verdict).toBe("FIELD");
    expect(contract.fieldWarrants).toEqual(["goal_threshold_frame"]);
  });

  it("⭐ AND THE MUTANT THAT PROVES THE NEGATIVE ARM IS NOT VACUOUS", () => {
    // Ask what would have to be true for the arm above to pass while the
    // property fails — then write THAT case. Here: the same field with its
    // warrants removed must flip to a finding. If it does not, the negative arm
    // is passing because the detector never fires, not because the field is
    // attested.
    const stripped = z.object({
      goal_threshold: z.number().optional(),
      goal_threshold_cap: z.number().optional(),
      goal_threshold_raw: z.number().optional(),
      label: z.string(),
    });
    const mutant = deriveValueSites([{ name: "cee.NodeV3", schema: stripped }]);
    expect(mutant.find((s) => s.id === "cee.NodeV3::goal_threshold")?.verdict).toBe("NONE");
    expect(runWarrantDetectors(mutant).map((f) => f.id)).toContain(
      "unwarranted:cee.NodeV3::goal_threshold",
    );
  });

  it("⭐ the guard DISCRIMINATES: it does not return one verdict for everything", () => {
    // Trap 20: when a per-item probe returns the same answer for every item,
    // suspect the probe. Uniformity is evidence about the instrument.
    const verdicts = new Set(SITES.map((s) => s.verdict));
    expect([...verdicts].sort()).toEqual(["FIELD", "LEVEL_SHARED", "LEVEL_SOLE", "NONE"]);
    expect(SITES.length).toBeGreaterThan(20);
    // …and the split is not degenerate in either direction.
    expect(FINDINGS.length).toBeGreaterThan(0);
    expect(FINDINGS.length).toBeLessThan(SITES.length);
  });
});

// ============================================================================
// 2. WHAT THE WALK ADDS THAT THE SIBLING GUARD STRUCTURALLY CANNOT SEE
// ============================================================================

describe("the nested walk is the capability, and the flat guard does not have it", () => {
  it("every one of the four measured instances the flat guard cannot reach is nested", () => {
    // Contrast control in the same run: `deriveSurfaces()` enumerates TOP-LEVEL
    // keys only, so none of these fields appears in any of its field sets —
    // while `strength`, their PARENT, does. Target absent + contrast present
    // means the claim is about scope, not about a blind probe.
    const flat = new Set(deriveSurfaces().flatMap((s) => s.fields));
    expect(flat.has("strength")).toBe(true); // contrast: the parent IS visible
    expect(flat.has("std")).toBe(false);
    expect(flat.has("mean")).toBe(false);
    expect(flat.has("range_min")).toBe(false);

    // …and this guard reaches all of them, through objects AND through arrays.
    const ids = SITES.map((s) => s.id);
    expect(ids).toContain("cee.EdgeV3::strength.std"); // nested object
    expect(ids).toContain("cee.NodeV3::observed_state.value"); // nested object
    expect(ids).toContain("cee.CEEGraphResponseV3::goal_constraints[].value"); // array element
    expect(
      ids,
    ).toContain(
      "cee.CEEGraphResponseV3::goal_constraints[].provenance_unit_normalised.original_value",
    ); // array element, then nested again
  });

  it("the roots are the SAME six surfaces the sibling guard names — pinned, not coincidental", () => {
    // ⚠ The one thing here that could go short is the root list, exactly as
    // SURFACE_PAIRS is in contract-field-guard.ts. It cannot be derived: nothing
    // declares "these are the boundary schemas". Pinning it against the sibling
    // guard means a seventh surface added there REDs here instead of being a
    // silent gap in this one.
    expect(deriveWarrantRoots().map((r) => r.name).sort()).toEqual(
      deriveSurfaces().map((s) => s.name).sort(),
    );
  });

  it("a root that is no longer an object FAILS LOUD rather than reporting a clean result", () => {
    expect(() => deriveValueSites([{ name: "gone", schema: z.string() }])).toThrow(
      /non-object schema/,
    );
  });
});

// ============================================================================
// 3. THE DETECTORS MUST BE ABLE TO STAY SILENT
// ============================================================================

describe("negative controls — a detector that fires on everything is not a detector", () => {
  const CLEAN: WarrantRoot[] = [
    {
      name: "clean.Thing",
      schema: z.object({ value: z.number(), unit: z.string(), label: z.string() }),
    },
  ];

  it("a single attested number produces nothing", () => {
    const sites = deriveValueSites(CLEAN);
    expect(sites.map((s) => s.verdict)).toEqual(["LEVEL_SOLE"]);
    expect(detectUnwarrantedValues(sites)).toEqual([]);
    expect(detectScopeAmbiguousWarrants(sites)).toEqual([]);
  });

  it("⭐ and the SAME universe with a second number does fire — the pair proves what discriminates", () => {
    // One arm alone shows nothing. What this pair proves is that the thing
    // deciding the verdict is the SHARED LEVEL, not some incidental property of
    // the fixture: one number beside `unit` is silent, two are reported.
    const shared = deriveValueSites([
      {
        name: "clean.Thing",
        schema: z.object({ value: z.number(), other: z.number(), unit: z.string() }),
      },
    ]);
    expect(detectScopeAmbiguousWarrants(shared).map((f) => f.id).sort()).toEqual([
      "scope-ambiguous:clean.Thing::other",
      "scope-ambiguous:clean.Thing::value",
    ]);
    expect(detectUnwarrantedValues(shared)).toEqual([]);
  });

  it("a number with no qualifier anywhere is NONE, and bounds do not rescue it", () => {
    // ⛔ Deliberate: a declared range is NOT a warrant. `goal_threshold` lived in
    // [0,1] and was still uninterpretable; a fabricated 0.15 satisfies `min=0`
    // exactly as well as a real one.
    const bounded = deriveValueSites([
      { name: "clean.B", schema: z.object({ p: z.number().min(0).max(1) }) },
    ]);
    expect(bounded[0]?.verdict).toBe("NONE");
    expect(bounded[0]?.bounds).toBe("min=0 max=1");
    expect(detectUnwarrantedValues(bounded).map((f) => f.id)).toEqual(["unwarranted:clean.B::p"]);
  });

  it("the three qualifier NAME shapes all resolve, and an ordinary field does not", () => {
    expect(isQualifierName("unit")).toBe(true); // exact token
    expect(isQualifierName("goal_threshold_frame")).toBe(true); // _<token> suffix
    expect(isQualifierName("provenance_unit_relabelled")).toBe(true); // <token>_ prefix
    expect(isQualifierName("declared_scale")).toBe(true);
    // Contrast: real field names that must NOT be credited as attestations.
    expect(isQualifierName("observed_state")).toBe(false);
    expect(isQualifierName("goal_threshold_cap")).toBe(false);
    expect(isQualifierName("display_value")).toBe(false);
    expect(isQualifierName("factor_type")).toBe(false);
  });

  it("an OPTIONAL warrant still counts, and that is a stated limit of this check", () => {
    // ⚠ READ THE CLAIM EXACTLY. This guard reads DECLARATIONS. A warrant that is
    // declared optional and never stamped at runtime is credited here and is
    // invisible — the same one-directional soundness the orphan detector states
    // about its token index. `goal_threshold_frame` is `.optional()`.
    const optionalWarrant = deriveValueSites([
      { name: "x.T", schema: z.object({ v: z.number(), v_frame: z.string().optional() }) },
    ]);
    expect(optionalWarrant[0]?.verdict).toBe("FIELD");
    expect(runWarrantDetectors(optionalWarrant)).toEqual([]);
  });
});

// ============================================================================
// 4. THE GUARD'S OWN SAFETY MECHANISMS, EACH SEEN TO FAIL
// ============================================================================

describe("the vocabulary cannot rot silently", () => {
  it("every warrant token's witness still exists on the live contract", () => {
    expect(deadVocabulary(SITES).map((t) => t.token)).toEqual([]);
  });

  it("⭐ ROT MUTANT: a token whose witness has left the schemas IS reported", () => {
    // Without this arm the test above is a guard agreeing with itself — a
    // `deadVocabulary` that returned [] unconditionally would satisfy it forever.
    const rotted = [
      ...WARRANT_TOKENS,
      { token: "zzz_absent", witness: "zzz_absent_witness_field", why: "a token for nothing" },
    ];
    expect(deadVocabulary(SITES, rotted).map((t) => t.token)).toEqual(["zzz_absent"]);
  });

  it("every token entry is well formed — a witness with no reason is decoration", () => {
    const seen = new Set<string>();
    for (const t of WARRANT_TOKENS) {
      expect(t.token.length).toBeGreaterThan(2);
      expect(t.witness.length).toBeGreaterThan(2);
      expect(t.why.length).toBeGreaterThan(60);
      expect(seen.has(t.token)).toBe(false);
      seen.add(t.token);
    }
  });
});

// ============================================================================
// 5. THE LIVE RATCHET — reused from the sibling guard, not reimplemented
// ============================================================================

describe("the live value-bearing contract, adjudicated", () => {
  const report = adjudicate(FINDINGS, WARRANT_DECISIONS);

  it("adjudicate is literally the sibling guard's — one adjudication model, not two", () => {
    expect(adjudicate).toBe(contractAdjudicate);
  });

  it("⭐ it reports BOTH directions BY CONSTRUCTION, not because today is clean", () => {
    const r = adjudicate(
      [{ detector: "unwarranted-value", id: "unwarranted:x", detail: "d" }],
      [{ id: "unwarranted:gone", status: "ACCEPTED", decision: "its finding is gone" }],
    );
    expect(r.unadjudicated.map((f) => f.id)).toEqual(["unwarranted:x"]);
    expect(r.stale.map((d) => d.id)).toEqual(["unwarranted:gone"]);
  });

  it("every finding has a recorded decision (the ledger cannot go short)", () => {
    expect(report.unadjudicated.map((f) => `${f.id} — ${f.detail}`)).toEqual([]);
  });

  it("every recorded decision still reproduces (the ledger cannot rot)", () => {
    expect(report.stale.map((d) => d.id)).toEqual([]);
  });

  it("the first cut is an ENUMERATION: 36 sites, 28 findings, 20 OPEN, 8 accepted", () => {
    // Pinned so the shape of the first cut cannot move quietly. There is no date
    // trigger anywhere in this check — a CI job that turns red on a calendar is a
    // time bomb. What this gives instead is an OPEN count a human can watch.
    // +2 sites / +2 findings / +2 OPEN (was 34/26/18): schemas 0.56.0 (#60)
    // declares `observed_state.cap` and `.raw_value` on the contract's NodeV3,
    // reaching CEE with the 0.58.0 re-vendor. Recorded OPEN with their family.
    expect(SITES.length).toBe(36);
    expect(FINDINGS.length).toBe(28);
    expect(report.open.length).toBe(20);
    expect(report.accepted.length).toBe(8);
    expect(SITES.filter((s) => s.verdict === "FIELD").length).toBe(4);
    expect(SITES.filter((s) => s.verdict === "LEVEL_SOLE").length).toBe(4);
    expect(SITES.filter((s) => s.verdict === "LEVEL_SHARED").length).toBe(13);
    expect(SITES.filter((s) => s.verdict === "NONE").length).toBe(15);
  });

  it("no decision is a bare exemption — each one argues, or names the one that does", () => {
    // A family of identical findings does not need the argument restated four
    // times; it needs each member to POINT at where the argument lives, so a
    // reader who deletes the head entry sees the pointers break. What is banned
    // is a short entry that argues nothing and refers to nothing.
    const crossReference = /Settle with |reason given at /;
    for (const d of WARRANT_DECISIONS) {
      expect(["OPEN", "ACCEPTED"]).toContain(d.status);
      if (d.decision.length <= 150) {
        expect(
          crossReference.test(d.decision),
          `${d.id} is short and cites nothing: "${d.decision}"`,
        ).toBe(true);
      }
      expect(d.decision.length).toBeGreaterThan(50);
    }
    expect(new Set(WARRANT_DECISIONS.map((d) => d.id)).size).toBe(WARRANT_DECISIONS.length);
    // …and the cross-reference rule is not vacuous: some entries ARE short.
    expect(WARRANT_DECISIONS.filter((d) => d.decision.length <= 150).length).toBeGreaterThan(0);
  });
});

// ============================================================================
// 6. ⭐ THE SCORECARD — what this mechanism covers of the four measured
//    instances, and what it does NOT. The tempting reading of a green run is
//    "values without warrants are caught now"; the measured answer is 2 of 4.
// ============================================================================

describe("the four measured instances of 'a value without its warrant'", () => {
  it("#1 goal_threshold — IN UNIVERSE, and it reads as FIXED", () => {
    expect(site("cee.NodeV3::goal_threshold").verdict).toBe("FIELD");
  });

  it("#2 strength.std — IN UNIVERSE, and it reads as OPEN", () => {
    expect(FOUND.has("unwarranted:contract.EdgeV3Schema::strength.std")).toBe(true);
    expect(
      WARRANT_DECISIONS.find((d) => d.id === "unwarranted:contract.EdgeV3Schema::strength.std")
        ?.status,
    ).toBe("OPEN");
  });

  it("#3 analysis_participation — ⛔ OUT OF UNIVERSE, and that is stated, not hidden", () => {
    // Declared with "CEE mints it; no model authors it" and measured 0 of
    // 193,917 persisted nodes. That is DECLARED-BUT-NEVER-WRITTEN — the sibling
    // guard's `orphan` detector — not a missing frame. It is not a number, so
    // this guard never sees it, and a warrant would not have helped: the field
    // was absent, not misinterpretable.
    expect(SITES.some((s) => s.path.includes("analysis_participation"))).toBe(false);
  });

  it("#4 schema_version / build ids — ⛔ OUT OF UNIVERSE, same reason", () => {
    // An identity that is null for three of four services is a PRODUCER gap.
    // `schema_version` is a `z.literal("3.0")` on CEEGraphResponseV3 — not a
    // number, and nothing about it is open to misreading.
    expect(SITES.some((s) => s.path.includes("schema_version"))).toBe(false);
  });

  it("⭐ THE HONEST TOTAL: this mechanism reaches 2 of the 4, by construction", () => {
    const inUniverse = ["goal_threshold", "strength.std"];
    const outOfUniverse = ["analysis_participation", "schema_versions/build ids"];
    expect(inUniverse.length).toBe(2);
    expect(outOfUniverse.length).toBe(2);
    // The two it misses share ONE shape and it is not this one: a declaration
    // with no producer. Both are already the sibling guard's territory or a
    // runtime question, and neither is closed by adding a frame.
  });
});
