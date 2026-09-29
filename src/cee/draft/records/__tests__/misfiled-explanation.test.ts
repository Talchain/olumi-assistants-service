/**
 * ⭐⭐⭐ #1287 IS NOT CLOSED BY THIS PR, AND THIS FILE IS THE MEASUREMENT THAT
 * SAYS WHY — so the next lane does not spend a cycle rediscovering it.
 *
 * The `cause` stated kind is a ROUTE the model must choose to take. Its sibling
 * `cause-stated-kind.test.ts` proves the route works, but it proves it by
 * REWRITING the capture (`raw.stated_items[i].kind = "cause"`) "as a truthful
 * producer would". The producer is not truthful, and the whole mechanism is
 * inert until it is:
 *
 *   · A complete manifest of the raw record sets in this repo — one deployed-wire
 *     capture plus six fixtures, 18 stated options — contains ZERO `kind:
 *     "cause"` spans. Pinned by C1 below, with a contrast control.
 *   · Projected UNMODIFIED, the named witness reproduces the defect exactly.
 *     Pinned by C2 — which is deliberately an assertion that the product is
 *     still WRONG, and must be deleted only by a change that makes it right.
 *
 * ── THREE MEASURED INSTRUCTION FAILURES ON THIS ONE QUESTION ────────────────
 *   v11  `kind: "claim"`      — closed on the wire; 0 of 27 instances arrived.
 *   v12  "put it in `claims`" — SERVED and ignored; #1287 was captured ~18 hours
 *                               after it went live.
 *   the zero-action paragraph — "do not promote one of the causes to fill the
 *                               gap" was in the served instruction at
 *                               `523e74a8`, and a controlled four-brief
 *                               experiment against that very build watched the
 *                               model promote them anyway.
 *
 * ── AND WHY THE CORRECTION CANNOT BE MADE IN CODE EITHER ────────────────────
 * The experiment found the boundary is 0 vs 1 user-named actions. Two things
 * follow, both derived rather than assumed:
 *   · THERE IS NO CODE PATH TO ROUTE THE ZERO-ACTION CASE INTO. Both cases take
 *     byte-identical draft requests — one store prompt, one code instruction
 *     (`DRAFT_RECORDS_INSTRUCTION`, pushed unconditionally at
 *     `anthropic.ts:518`), one grammar. Nothing branches on brief content.
 *   · THE ONE BRIEF-SIDE SIGNAL CEE COMPUTES IS BLIND TO IT.
 *     `option_count_estimate` returns 0 for the failing brief AND for the
 *     passing brief, which differ by one appended sentence naming an action.
 *
 * That leaves a projector-side predicate over the emitted records, and R1–R3
 * below MEASURE that route to destruction. **A hypothesis and a genuine action
 * are structurally isomorphic in the record set**, so every predicate that
 * catches the first deletes the second — which is a worse defect than #1287.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { projectDraftRecords } from "../seam.js";
import type { RecordProjection } from "../projector.js";
import type { DraftRecordSet } from "../grammar.js";

const FIXTURES = new URL("./fixtures/", import.meta.url);
const load = (name: string): any => JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8"));

/**
 * ⚠ THE THREE FIXTURE SHAPES, AND WHY THIS THROWS RATHER THAN COALESCES. The
 * corpus stores record sets three ways: `raw_text` (a captured wire string),
 * bare at the top level, and nested under `records`. An earlier version of this
 * helper missed the third, returned the WRAPPER, and `stated_items` came back
 * `undefined` — whereupon three corpus cases passed WHILE MEASURING NOTHING. An
 * absence probe over an empty input is the vacuity this file exists to refuse.
 */
const recordsOf = (raw: any): DraftRecordSet => {
  const r = raw?.raw_text
    ? JSON.parse(raw.raw_text)
    : raw?.stated_items
      ? raw
      : raw?.records?.stated_items
        ? raw.records
        : undefined;
  if (!r || !Array.isArray(r.stated_items) || !Array.isArray(r.claims)) {
    throw new Error("fixture is not a readable record set — the measurement would be vacuous");
  }
  return r;
};

const FIX = load("diagnosis-hypotheses-1287.json") as { brief: string; raw_text: string };
/** The capture EXACTLY as the deployed model emitted it. Never rewritten. */
const capturedRecords = (): DraftRecordSet => JSON.parse(FIX.raw_text);

const project = (records: unknown, brief?: string): RecordProjection => {
  const r = projectDraftRecords(records, brief);
  if (!r.ok) throw new Error(`seam refused: ${r.reason}`);
  return r.projection;
};
const labelsOfKind = (p: RecordProjection, kind: string) =>
  p.graph.nodes.filter((n) => n.kind === kind).map((n) => n.label);

const HYPOTHESES = [
  "the price rise we pushed through in January",
  "the migration backlog — we still have about 40 accounts stuck on the old platform",
  "the competitor's new analytics module is genuinely better than ours",
  "we simply stopped doing exec-level QBRs after the reorg",
];

describe("C — the `cause` route is INERT as captured, and #1287 is still open", () => {
  it("C1: not one raw record set in the repo carries a `cause` span, with a contrast control", () => {
    const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(6);
    let causes = 0;
    let options = 0;
    for (const f of files) {
      const r = recordsOf(load(f));
      for (const s of r.stated_items) {
        if (s.kind === "cause") causes += 1;
        if (s.kind === "option") options += 1;
      }
    }
    // ⭐ CONTRAST CONTROL, IN THE SAME SWEEP. Absence is proven only when the
    // target reads zero AND a same-family symbol reads non-zero — otherwise the
    // zero is a statement about the instrument.
    expect(options).toBe(18);
    expect(causes).toBe(0);
  });

  it("C2: the named witness, projected UNMODIFIED, STILL DRAFTS EXPLANATIONS AS CHOICES", () => {
    // ⚠ THIS ASSERTS THE PRODUCT IS WRONG, ON PURPOSE. It is the honest record
    // of an open defect, and the only legitimate way to delete it is a change
    // that makes it fail. Do not "fix" it by relaxing the expectation.
    const p = project(capturedRecords(), FIX.brief);
    for (const span of HYPOTHESES) expect(labelsOfKind(p, "option")).toContain(span);
    expect(labelsOfKind(p, "option").length).toBe(5);
  });
});

/**
 * ⭐⭐⭐ R — THE PROJECTOR-SIDE ROUTE, RUN TO DESTRUCTION BEFORE COMMISSIONING IT.
 *
 * The estate's rule after four oscillating rounds on one natural-language
 * predicate: TEST THE NEXT ROUND BEFORE COMMISSIONING IT — running the obvious
 * next tweak and showing it oscillates costs one probe and saves a whole cycle.
 * These are the three obvious rounds, implemented and measured here rather than
 * argued in a comment, against three cases: the #1287 capture (must fire) and
 * two ordinary decision briefs (must not).
 *
 * ⚠ NOTE WHAT THIS IS NOT: it is NOT a classifier over option LABEL TEXT. That
 * route was measured separately by an independent lane and oscillates over 137
 * real labels. These rounds read only the model's own record STRUCTURE, which is
 * the strongest form available — and it still fails, which is the point.
 */
type Rec = { stated_items: any[]; claims: any[] };

/** P1∧P2∧P3 — sole-basis factor · all out-links land on it · no refinement. */
const soleRestatement = (r: Rec, i: number): number | null => {
  const sole = r.claims.flatMap((c, j) =>
    c.claim_kind === "factor" && Array.isArray(c.basis) && c.basis.length === 1 && c.basis[0] === i
      ? [j]
      : [],
  );
  if (sole.length !== 1) return null;
  const out = r.claims.filter((c) => c.claim_kind === "causal_link" && c.from_stated === i);
  if (out.length === 0 || out.some((c) => c.to_claim !== sole[0])) return null;
  if (r.claims.some((c) => c.claim_kind === "option_refinement" && (c.basis ?? []).includes(i)))
    return null;
  return sole[0]!;
};
const optionIndices = (r: Rec) =>
  r.stated_items.flatMap((s, i) => (s.kind === "option" ? [i] : []));

/** ROUND 1 — the structural restatement predicate. */
const round1 = (r: Rec) => new Set(optionIndices(r).filter((i) => soleRestatement(r, i) !== null));
/** ROUND 2 — round 1, and the factor must be PRIVATE to this option. */
const round2 = (r: Rec) =>
  new Set(
    optionIndices(r).filter((i) => {
      const f = soleRestatement(r, i);
      if (f === null) return false;
      return !r.claims.some(
        (c) =>
          c.claim_kind === "causal_link" &&
          c.to_claim === f &&
          c.from_stated !== undefined &&
          c.from_stated !== i,
      );
    }),
  );
/** ROUND 3 — round 2, and only when EVERY stated option fires. */
const round3 = (r: Rec) => {
  const fired = round2(r);
  const opts = optionIndices(r);
  return opts.length > 0 && fired.size === opts.length ? fired : new Set<number>();
};

/** (b) The repo's OWN two-option decision, lifted from `option-action-labels.test.ts`. */
const TWO_OPTION_DECISION: Rec = {
  stated_items: [
    { kind: "goal", source_quote: "grow revenue" },
    { kind: "option", source_quote: "launch our own subscription offering" },
    { kind: "option", source_quote: "always done bespoke client work", is_baseline: true },
  ],
  claims: [
    { claim_kind: "factor", label: "Recurring Revenue Share", basis: [1] },
    { claim_kind: "outcome", label: "Revenue", basis: [0] },
    { claim_kind: "causal_link", label: "a", from_stated: 1, to_claim: 0 },
    { claim_kind: "causal_link", label: "b", from_stated: 2, to_claim: 0 },
    { claim_kind: "causal_link", label: "c", from_claim: 0, to_claim: 1 },
    { claim_kind: "causal_link", label: "d", from_claim: 1, to_stated: 0 },
  ],
};

/** (c) Two genuine actions, each moving its OWN factor, plus a proposed third. */
const TWO_PRIVATE_FACTOR_ACTIONS: Rec = {
  stated_items: [
    { kind: "goal", source_quote: "cut churn" },
    { kind: "option", source_quote: "rebuild onboarding from scratch" },
    { kind: "option", source_quote: "cut our list price by 15%" },
  ],
  claims: [
    { claim_kind: "factor", label: "Onboarding quality", basis: [1] },
    { claim_kind: "factor", label: "Price level", basis: [2] },
    { claim_kind: "outcome", label: "Retention", basis: [] },
    { claim_kind: "option_refinement", label: "Run a churn study", basis: [] },
    { claim_kind: "causal_link", label: "a", from_stated: 1, to_claim: 0 },
    { claim_kind: "causal_link", label: "b", from_stated: 2, to_claim: 1 },
    { claim_kind: "causal_link", label: "c", from_claim: 0, to_claim: 2 },
    { claim_kind: "causal_link", label: "d", from_claim: 1, to_claim: 2 },
  ],
};

describe("R — every projector-side predicate deletes a user's genuine action", () => {
  it("R0: the capture and both controls are well-formed, so the rounds measure something", () => {
    expect(optionIndices(capturedRecords() as Rec)).toEqual([1, 2, 3, 4]);
    expect(optionIndices(TWO_OPTION_DECISION)).toEqual([1, 2]);
    expect(optionIndices(TWO_PRIVATE_FACTOR_ACTIONS)).toEqual([1, 2]);
  });

  it("R1: the structural predicate catches all four hypotheses — and BOTH controls too", () => {
    expect([...round1(capturedRecords() as Rec)]).toEqual([1, 2, 3, 4]);
    // "launch our own subscription offering" is a genuine, user-stated action
    // and it is INDISTINGUISHABLE from a hypothesis: sole-basis factor, one
    // out-link to it, no refinement. Identical on all three conjuncts.
    expect([...round1(TWO_OPTION_DECISION)]).toEqual([1]);
    expect([...round1(TWO_PRIVATE_FACTOR_ACTIONS)]).toEqual([1, 2]);
  });

  it("R2: requiring a PRIVATE factor rescues control (b) and still deletes control (c)", () => {
    expect([...round2(capturedRecords() as Rec)]).toEqual([1, 2, 3, 4]);
    expect([...round2(TWO_OPTION_DECISION)]).toEqual([]);
    // Two ordinary actions each moving their own factor. Both deleted.
    expect([...round2(TWO_PRIVATE_FACTOR_ACTIONS)]).toEqual([1, 2]);
  });

  it("R3: requiring EVERY option to fire changes nothing — control (c) still loses both", () => {
    expect([...round3(capturedRecords() as Rec)]).toEqual([1, 2, 3, 4]);
    expect([...round3(TWO_OPTION_DECISION)]).toEqual([]);
    expect([...round3(TWO_PRIVATE_FACTOR_ACTIONS)]).toEqual([1, 2]);
  });

  it("R4: THE RULING — three rounds, and no round separates the two classes", () => {
    // Each round fixes one direction and leaves the other open, which is this
    // estate's documented signal that the approach is wrong rather than that one
    // more rule is needed. The exit is NOT a fourth predicate: it is to make the
    // ambiguity the product — with zero named actions, ASK what the user would
    // consider doing — or to close the question at the grammar, where the model
    // cannot silently decline it.
    const rounds = [round1, round2, round3];
    for (const r of rounds) {
      // fires correctly on the defect …
      expect(r(capturedRecords() as Rec).size).toBe(4);
      // … and still deletes genuine actions on at least one ordinary brief.
      const harmed =
        r(TWO_OPTION_DECISION).size + r(TWO_PRIVATE_FACTOR_ACTIONS).size;
      expect(harmed).toBeGreaterThan(0);
    }
  });
});

/**
 * ⭐ THE ASYMMETRIC GUARD, CLOSED. `completionRegressesProtectedContent`'s
 * sibling — the protected-content check inside the same file — watched only
 * `merged_refinements`, so a completion pass could silently drop a label the
 * CAUSE-side merge had legitimately absorbed and nothing would report it.
 *
 * Both receipts are append-only, both consume MODEL-origin content into a
 * USER-stated node, and both are already accounted for by
 * `completionRegressesProtectedContent`. A guard that watches one door is not a
 * partial guard; it is a guard that reports success about the door it is not
 * watching.
 */
import { completionRegressesProtectedContent } from "../completion.js";

const nodeWith = (receipt: Record<string, string[]>) => ({
  graph: {
    version: "1",
    nodes: [{ id: "n1", kind: "factor", label: "the price rise", provenance: { provenance_class: "stated", ...receipt } }],
    edges: [],
    meta: { roots: [], leaves: [], source: "assistant", suggested_positions: {} },
  },
  provenance: { n1: { provenance_class: "stated", ...receipt } },
  dropped: [],
}) as any;

describe("G — the reclassification guard watches BOTH absorption receipts", () => {
  it("G1: dropping a merged RESTATEMENT is reported — the case the guard used to miss", () => {
    const before = nodeWith({ merged_restatements: ["Price sensitivity of enterprise accounts"] });
    const after = nodeWith({ merged_restatements: [] });
    const violations = completionRegressesProtectedContent(before, after);
    expect(violations).toContain(
      "restatement_reclassified:n1:Price sensitivity of enterprise accounts",
    );
  });

  it("G2: DISCRIMINATING TWIN — the option-side receipt is still watched, and reported apart", () => {
    // Neither case alone shows the binding. G1 proves the hole is closed; this
    // proves closing it did not swallow the guard that was already there, and
    // that the two are reported under DIFFERENT tags rather than one name doing
    // two jobs (trap 21).
    const before = nodeWith({ merged_refinements: ["Hold Price (Status Quo)"] });
    const after = nodeWith({ merged_refinements: [] });
    const violations = completionRegressesProtectedContent(before, after);
    expect(violations).toContain("refinement_reclassified:n1:Hold Price (Status Quo)");
    expect(violations.some((v) => v.startsWith("restatement_reclassified:"))).toBe(false);
  });

  it("G3: an intact receipt is NOT a violation — the guard is not simply always-on", () => {
    const both = { merged_restatements: ["R"], merged_refinements: ["F"] };
    expect(completionRegressesProtectedContent(nodeWith(both), nodeWith(both))).toEqual([]);
  });
});
