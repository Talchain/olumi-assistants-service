/**
 * THE REPHRASE-PREDICATE CORPUS.
 *
 * ⚠⚠ READ THIS BEFORE TRUSTING A GREEN RUN HERE (trap 22 / 22c).
 *
 * This corpus is a DEVELOPMENT AID, not the evidence. The predicate it exercises
 * is a predicate over natural language, and a corpus drawn from the author's head
 * cannot see the class the author did not imagine — a full pass here is a perfect
 * score on an exam the author also wrote. The load-bearing evidence for this
 * module is the REVIEWER's independent corpus.
 *
 * What it can honestly claim, and the provenance is marked per case:
 *   [CAPTURE]  — drawn from the banked first-use-acceptance run-2 draws
 *                (39 option nodes across 12 draws). Outside the author's head.
 *   [PAUL]     — from Paul's pricing screenshots, 14 Aug 2026. Outside the head.
 *   [AUTHORED] — British business English written for this suite. INSIDE the
 *                author's head, and therefore the weakest class here.
 *
 * EVERY case is twinned (trap 22b): the merge cases are paired with
 * opposite-direction cases built from the same vocabulary, so a widening of the
 * predicate that starts merging alternatives REDs here rather than in a capture.
 */
import { describe, it, expect } from "vitest";
import {
  isHighConfidenceRephrase,
  interventionsAreCompatible,
  mergeRephrasedOptions,
} from "../option-rephrase-merge.js";

/** [canonical, twin, provenance-tag] */
type Pair = readonly [string, string, string];

/**
 * MUST MERGE — the same option, said at greater length or in different case.
 */
const MUST_MERGE: readonly Pair[] = [
  // ⭐ THE WITNESSED DEFECT.
  ["two developers", "Hire Two Developers Only", "[CAPTURE] A_hiring-2"],
  // Case-only restatements of real user labels from the captures.
  ["keep what we have", "Keep What We Have", "[CAPTURE] B_crm"],
  ["raise it by 10%", "Raise it by 10%", "[CAPTURE] C_pricing"],
  ["hold price and push volume instead", "Hold Price And Push Volume Instead", "[CAPTURE] C_pricing"],
  [
    "replace our current CRM with HubSpot next quarter",
    "Replace Our Current CRM With HubSpot Next Quarter",
    "[CAPTURE] B_crm",
  ],
  ["say no", "Say No", "[CAPTURE] D_messy-2"],
  ["hire a Tech lead", "Hire a Tech Lead", "[CAPTURE] A_hiring"],
  // Elaborative expansions of real user labels.
  ["two developers", "Hiring Two Developers", "[AUTHORED]"],
  ["two developers", "The Two Developers Option", "[AUTHORED]"],
  ["keep what we have", "Keep What We Have Approach", "[AUTHORED]"],
  ["raise enterprise pricing by 30%", "Raise Enterprise Pricing By 30%", "[CAPTURE] C_pricing"],
  // British business English.
  ["tech lead", "Hire Tech Lead", "[AUTHORED]"],
  ["graduate scheme", "Adopt Graduate Scheme", "[AUTHORED]"],
  ["four-day week", "Adopt the Four-Day Week", "[AUTHORED]"],
  ["freeze hiring", "Freeze Hiring", "[AUTHORED]"],
  ["keep the current CRM", "Keep the Current CRM Option", "[AUTHORED]"],
];

/**
 * MUST NOT MERGE — the opposite-direction twins. A failure in this block is a
 * DESTROYED ALTERNATIVE, the harm this module exists to avoid.
 */
const MUST_NOT_MERGE: readonly Pair[] = [
  // ⭐ THE CANONICAL TWIN. A real staged-hire alternative.
  ["two developers", "Hire One Developer Now, Defer Second", "[CAPTURE] A_hiring-2"],
  ["two developers", "Hire One Senior Developer (Hybrid)", "[CAPTURE] A_hiring-1"],
  // ⭐ PAUL'S PRICING SCREENSHOTS — three genuinely distinct options.
  ["increase our SASS subscription price", "Small price increase", "[PAUL]"],
  ["increase our SASS subscription price", "Large price increase", "[PAUL]"],
  ["Small price increase", "Large price increase", "[PAUL]"],
  // Same construction, different magnitude.
  ["raise it by 10%", "raise it by 30%", "[CAPTURE] C_pricing"],
  ["hire two developers", "Hire Three Developers", "[AUTHORED]"],
  ["hire developers", "Hire Two Developers", "[AUTHORED]"],
  // Different options from the same brief.
  ["hire a Tech lead", "Hire Two Developers Only", "[CAPTURE] A_hiring-2"],
  ["say no", "Decline custom work, hold product roadmap", "[CAPTURE] D_messy-2"],
  [
    "keep what we have",
    "replace our current CRM with HubSpot next quarter",
    "[CAPTURE] B_crm",
  ],
  ["hold price and push volume instead", "Hold Price", "[CAPTURE] C_pricing"],
  // Scope, magnitude, timing and negation all change WHICH option is meant.
  ["four-day week", "Four-Day Week Trial", "[AUTHORED]"],
  ["freeze hiring", "Do Not Freeze Hiring", "[AUTHORED]"],
  ["raise price", "Raise Price Aggressively", "[AUTHORED]"],
  ["outsource support", "Outsource Support Partially", "[AUTHORED]"],
];

/**
 * ⭐⭐ THE KNOWN-DROPPED SET (trap 22f).
 *
 * These ARE genuine rephrases and this predicate deliberately declines them.
 * Every one needs morphology or synonymy that deterministic token matching
 * cannot reach, and reaching for it would widen the predicate toward merging
 * alternatives — the harm that is not recoverable.
 *
 * PINNED EXACTLY: the assertion below REDs if this set GROWS (the predicate got
 * narrower) *and* if it SHRINKS (something started merging). A gap recorded in
 * the suite is honest; a gap invisible to it is how a predicate oscillates.
 */
const KNOWN_DROPPED: readonly Pair[] = [
  ["outsource support", "Outsourcing Support", "[AUTHORED] verb morphology beyond plural"],
  ["increase headcount", "Grow the Team", "[AUTHORED] synonym, no shared token"],
  ["two developers", "Recruit a Pair of Developers", "[AUTHORED] 'pair' for 'two'"],
  ["cut costs", "Reduce Costs", "[AUTHORED] synonym verb"],
  ["hire a Tech lead", "Bring in a Technical Lead", "[AUTHORED] synonym verb + morphology"],
];

/**
 * Words whose presence changes WHICH option is meant. The allow-list must be
 * disjoint from this — that is what stops a later lane widening the predicate by
 * adding "one word to make a case pass".
 */
const DISCRIMINATORS: readonly string[] = [
  // quantity / identity
  "one", "two", "three", "four", "single", "double", "pair", "both", "half", "none",
  "first", "second", "third", "next",
  // magnitude
  "small", "large", "big", "minor", "major", "modest", "aggressive", "slight",
  "steep", "full", "partial", "total",
  // timing / staging
  "now", "later", "defer", "delay", "staged", "phased", "gradual", "immediate",
  "interim", "trial", "pilot", "temporary", "permanent",
  // negation / contrast
  "not", "no", "never", "without", "instead", "rather", "except", "unless",
  // direction
  "increase", "decrease", "raise", "lower", "cut", "reduce", "grow", "shrink",
  "more", "less", "fewer", "greater",
];

describe("rephrase predicate — MUST MERGE", () => {
  it.each(MUST_MERGE)("merges %s ⇐ %s  %s", (canonical, twin) => {
    expect(isHighConfidenceRephrase(canonical, twin)).toBe(true);
  });

  it("is symmetric — which label is canonical is decided by authorship, not length", () => {
    for (const [canonical, twin] of MUST_MERGE) {
      expect(isHighConfidenceRephrase(twin, canonical)).toBe(
        isHighConfidenceRephrase(canonical, twin),
      );
    }
  });
});

describe("rephrase predicate — MUST NOT MERGE (opposite-direction twins)", () => {
  it.each(MUST_NOT_MERGE)("keeps both: %s vs %s  %s", (canonical, twin) => {
    expect(isHighConfidenceRephrase(canonical, twin)).toBe(false);
  });

  it("declines in BOTH directions — no ordering makes an alternative absorbable", () => {
    for (const [canonical, twin] of MUST_NOT_MERGE) {
      expect(isHighConfidenceRephrase(twin, canonical)).toBe(false);
    }
  });
});

describe("KNOWN-DROPPED — genuine rephrases this predicate deliberately declines", () => {
  it.each(KNOWN_DROPPED)("declines (documented gap): %s vs %s  %s", (canonical, twin) => {
    expect(isHighConfidenceRephrase(canonical, twin)).toBe(false);
  });

  it("⭐ the gap is EXACTLY this set — REDs if it grows OR shrinks", () => {
    // If a future change closes one of these, this RED is the instruction to
    // delete that row — not to loosen the assertion.
    const stillDropped = KNOWN_DROPPED.filter(
      ([c, t]) => !isHighConfidenceRephrase(c, t) && !isHighConfidenceRephrase(t, c),
    );
    expect(stillDropped).toHaveLength(KNOWN_DROPPED.length);
  });
});

describe("degenerate and vacuous inputs decline", () => {
  it.each([
    ["", "Hire Two Developers"],
    ["   ", "Hire Two Developers"],
    ["two developers", ""],
    // One shared content word is coincidence, not identity.
    ["hire", "Hire Two Developers Only"],
    ["price", "Raise Enterprise Pricing"],
    ["the", "Keep What We Have"],
  ])("declines %s vs %s", (a, b) => {
    expect(isHighConfidenceRephrase(a, b)).toBe(false);
  });

  it("null and undefined labels decline rather than throw", () => {
    expect(isHighConfidenceRephrase(null, "Hire Two Developers")).toBe(false);
    expect(isHighConfidenceRephrase("two developers", undefined)).toBe(false);
  });
});

describe("the allow-list may not contain a discriminator", () => {
  it("⭐ every discriminator is REFUSED as an elaborative surplus token", () => {
    // Derived, not asserted against a copy of the list: each discriminator is
    // driven through the real predicate as the ONLY surplus token. If any one of
    // them were ever added to ELABORATIVE_MODIFIERS, this REDs by name.
    const admitted = DISCRIMINATORS.filter((word) =>
      isHighConfidenceRephrase("delivery capacity", `delivery capacity ${word}`),
    );
    expect(admitted).toEqual([]);
  });

  it("POSITIVE CONTROL: the probe above can observe a merge at all", () => {
    // Without this, a predicate that returned false for everything would score a
    // perfect pass on the assertion above (trap 13 — an absence probe needs a
    // positive control, and its magnitude must be plausible).
    expect(isHighConfidenceRephrase("delivery capacity", "delivery capacity option")).toBe(true);
    expect(MUST_MERGE.filter(([c, t]) => isHighConfidenceRephrase(c, t))).toHaveLength(
      MUST_MERGE.length,
    );
  });
});

describe("intervention compatibility", () => {
  it("permits merge when either side carries no interventions", () => {
    expect(interventionsAreCompatible({}, { a: 1 })).toBe(true);
    expect(interventionsAreCompatible(undefined, { a: 1 })).toBe(true);
    expect(interventionsAreCompatible({ a: 1 }, {})).toBe(true);
  });

  it("permits merge when both name exactly the same targets", () => {
    expect(interventionsAreCompatible({ a: 1, b: 2 }, { b: 9, a: 3 })).toBe(true);
  });

  it("⭐ REFUSES when both carry interventions on DIFFERENT targets", () => {
    // Two options levering different factors are two proposals, whatever their
    // labels say. The label predicate does not get to overrule this.
    expect(interventionsAreCompatible({ a: 1 }, { b: 1 })).toBe(false);
    expect(interventionsAreCompatible({ a: 1 }, { a: 1, b: 1 })).toBe(false);
  });
});

/**
 * ORCHESTRATION GUARDS — the gates that live in `mergeRephrasedOptions` rather
 * than in the label predicate. The corpus above cannot reach these: it drives
 * strings, and these are decided by authorship and by multiplicity.
 */
describe("merge orchestration — authorship and ambiguity", () => {
  const factor = { id: "f1", kind: "factor", label: "Delivery capacity" };
  const mkNode = (id: string, label: string, provenance: string) =>
    ({ id, kind: "option", label, provenance }) as never;
  const mkOption = (id: string, label: string) =>
    ({ id, label, interventions: {} }) as never;

  function run(nodes: never[], options: never[], edges: never[] = []) {
    const n = [factor as never, ...nodes];
    const o = [...options];
    const e = [...edges];
    const result = mergeRephrasedOptions({ nodes: n, edges: e, options: o });
    return { result, nodes: n, options: o };
  }

  it("⭐ absorbs an ai_inferred twin into a from_brief canonical", () => {
    const { result, options } = run(
      [mkNode("u1", "two developers", "from_brief"), mkNode("a1", "Hire Two Developers Only", "ai_inferred")],
      [mkOption("u1", "two developers"), mkOption("a1", "Hire Two Developers Only")],
    );
    expect(result.absorbedOptionIds).toEqual(["a1"]);
    expect(options.map((o: { id: string }) => o.id)).toEqual(["u1"]);
  });

  it("⭐ TWO from_brief options never merge — a user's own two labels are both theirs", () => {
    // This is the error direction that matters: if the binder OVER-claims and
    // reads a model label as brief-borne, the pair collapses to same-provenance
    // and nothing is absorbed. Fail toward preservation.
    const { result, options } = run(
      [mkNode("u1", "two developers", "from_brief"), mkNode("u2", "Hire Two Developers Only", "from_brief")],
      [mkOption("u1", "two developers"), mkOption("u2", "Hire Two Developers Only")],
    );
    expect(result.absorbedOptionIds).toEqual([]);
    expect(options).toHaveLength(2);
  });

  it("⭐ TWO ai_inferred options never merge — the binder UNDER-claiming also keeps both", () => {
    const { result, options } = run(
      [mkNode("a1", "two developers", "ai_inferred"), mkNode("a2", "Hire Two Developers Only", "ai_inferred")],
      [mkOption("a1", "two developers"), mkOption("a2", "Hire Two Developers Only")],
    );
    expect(result.absorbedOptionIds).toEqual([]);
    expect(options).toHaveLength(2);
  });

  it("⭐ AMBIGUOUS IDENTITY KEEPS BOTH — a twin matching two canonicals is never resolved by picking one", () => {
    // "Hire Tech Lead Option" reads as a rephrase of both user labels. The
    // ruling reserves this case for asking the user; until that slice exists it
    // must be left exactly as drafted.
    const { result, options } = run(
      [
        mkNode("u1", "hire tech lead", "from_brief"),
        mkNode("u2", "Hire Tech Lead", "from_brief"),
        mkNode("a1", "Hire Tech Lead Option", "ai_inferred"),
      ],
      [
        mkOption("u1", "hire tech lead"),
        mkOption("u2", "Hire Tech Lead"),
        mkOption("a1", "Hire Tech Lead Option"),
      ],
    );
    expect(result.absorbedOptionIds).toEqual([]);
    expect(options).toHaveLength(3);
  });

  it("does nothing at all when there is no user-authored option to be canonical", () => {
    const { result, options } = run(
      [mkNode("a1", "Hire Two Developers", "ai_inferred"), mkNode("a2", "Hire Two Developers Only", "ai_inferred")],
      [mkOption("a1", "Hire Two Developers"), mkOption("a2", "Hire Two Developers Only")],
    );
    expect(result.absorbedOptionIds).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(options).toHaveLength(2);
  });
});
