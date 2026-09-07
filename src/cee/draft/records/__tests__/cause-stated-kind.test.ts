/**
 * ⭐⭐ A STATED `cause` IS AN EXPLANATION THE USER OFFERED, NOT A CHOICE THEY FACE.
 *
 * Issue #1287, journey-witnessed on a fresh guest at CEE `d0544243`: a diagnosis
 * brief's four competing hypotheses were drafted as `kind: "option"` nodes and the
 * product prepared to compute a win probability for "The Price Rise We Pushed
 * Through in January". Each was ADDITIONALLY modelled as a factor, so the same
 * four concepts existed twice — once as choices, once as causes.
 *
 * ── WHY THE INSTRUCTION-ONLY ROUTE IS NOT ENOUGH (measured, not argued) ──────
 * Instruction v12 (`e118361f`) says "there is no fifth [kind] … Put the span in
 * `claims` instead". It IS an ancestor of `d0544243`, and `DRAFT_RECORDS_INSTRUCTION`
 * is a code constant pushed as a system block (`anthropic.ts:518`) — not
 * store-overridable. So it was demonstrably SERVED when #1287 was captured ~18
 * hours later, and the model filed all four hypotheses as stated options anyway.
 * Served-and-ignored. `stated_items` is the half of the record set that holds
 * VERBATIM BRIEF SPANS, and a hypothesis IS one; v12 asked the model to put a
 * verbatim span in `claims`, which is the model's own half. The carrier gap is
 * real: there was no way to say "this verbatim span is an explanation".
 *
 * ── THE MERGE, AND WHY ITS ENTRY CONDITION MOVED ────────────────────────────
 * Pass 1b already folds a claim into the stated item its `basis` names. Its
 * parent filter read `kind === "option"`, which is a PARENT-ELIGIBILITY filter
 * (see the pass's own note: `basis` answers two questions, and the kind test is
 * what tells them apart) — NOT a safety gate about optionhood. So a `factor`
 * claim may name a stated `cause` as its parent on exactly the same footing.
 * Both halves are load-bearing: reverting either leaves the merge inert, and
 * reverting the parent filter alone OVER-MERGES a genuine factor into an option.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { projectDraftRecords } from "../seam.js";
import type { RecordProjection } from "../projector.js";

const FIX = JSON.parse(
  readFileSync(new URL("./fixtures/diagnosis-hypotheses-1287.json", import.meta.url), "utf8"),
) as { brief: string; raw_text: string };

const project = (records: unknown, brief: string): RecordProjection => {
  const r = projectDraftRecords(records, brief);
  if (!r.ok) throw new Error(`seam refused: ${r.reason}`);
  return r.projection;
};
const kindsOf = (p: RecordProjection) => p.graph.nodes.map((n) => `${n.kind}:${n.label}`);
const labelsOfKind = (p: RecordProjection, kind: string) =>
  p.graph.nodes.filter((n) => n.kind === kind).map((n) => n.label);
const causeMerges = (p: RecordProjection) =>
  p.dropped.filter((d) => d.reason === "factor_merged_into_stated_cause");
const optionMerges = (p: RecordProjection) =>
  p.dropped.filter((d) => d.reason === "refinement_merged_into_stated_option");

/** #1287's record set with the four hypotheses filed as `cause`, as a truthful producer would. */
const diagnosisRecords = () => {
  const raw = JSON.parse(FIX.raw_text);
  for (const i of [1, 2, 3, 4]) raw.stated_items[i].kind = "cause";
  return raw;
};

const HYPOTHESES = [
  "the price rise we pushed through in January",
  "the migration backlog — we still have about 40 accounts stuck on the old platform",
  "the competitor's new analytics module is genuinely better than ours",
  "we simply stopped doing exec-level QBRs after the reorg",
];
const GENUINE_ACTION =
  "Run a structured churn analysis across all four hypotheses before committing budget";

describe("ACCEPTANCE 1 — a pure-diagnosis brief retains its hypotheses as factors", () => {
  it("A1: every hypothesis is a FACTOR, bound by identity, and none is an option", () => {
    const p = project(diagnosisRecords(), FIX.brief);
    const factors = labelsOfKind(p, "factor");
    const options = labelsOfKind(p, "option");
    for (const h of HYPOTHESES) {
      expect(factors, `hypothesis must be a factor: ${h}`).toContain(h);
      expect(options, `hypothesis must NOT be an option: ${h}`).not.toContain(h);
    }
  });

  it("A1b: the model's analytic restatements MERGE into the user's own spans, 4/4", () => {
    const p = project(diagnosisRecords(), FIX.brief);
    expect(causeMerges(p).map((d) => d.label).sort()).toEqual(
      [
        "Competitive product gap in analytics",
        "Executive relationship coverage",
        "Migration backlog size",
        "Price sensitivity of enterprise accounts",
      ].sort(),
    );
    // The nine-near-duplicate degradation is what this prevents.
    expect(labelsOfKind(p, "factor")).toHaveLength(5);
  });

  it("A1c: ZERO fabricated options — the only option is the genuine action", () => {
    const p = project(diagnosisRecords(), FIX.brief);
    expect(labelsOfKind(p, "option")).toEqual([GENUINE_ACTION]);
  });
});

describe("ACCEPTANCE 2 — the MIXED brief: a choice IS under consideration AND an explanation is sought", () => {
  // The class that dominates real strategy work, and the one a whole-draft
  // boolean is correct-but-useless on: choice=TRUE and explanation=TRUE together.
  const BRIEF =
    "Our enterprise renewal rate dropped from 91% to 78% this quarter. I think it's the " +
    "price rise we pushed through in January, but it could just as easily be the support " +
    "backlog — we're at 40 accounts waiting. Should we roll back the price rise, or hire " +
    "three more support engineers?";
  const MIXED = {
    stated_items: [
      { kind: "goal", source_quote: "Our enterprise renewal rate", role: "baseline", value: 78, unit: "%" },
      { kind: "cause", source_quote: "the price rise we pushed through in January" },
      { kind: "cause", source_quote: "the support backlog — we're at 40 accounts waiting" },
      { kind: "option", source_quote: "roll back the price rise", is_baseline: false },
      { kind: "option", source_quote: "hire three more support engineers", is_baseline: false },
    ],
    claims: [
      { claim_kind: "factor", label: "Price sensitivity of enterprise accounts", basis: [1] },
      { claim_kind: "factor", label: "Support backlog size", basis: [2] },
      { claim_kind: "outcome", label: "Enterprise retention", basis: [] },
      { claim_kind: "causal_link", label: "rollback sets price sensitivity", from_stated: 3, to_claim: 0, sets_to: 0.2, effect: "negative" },
      { claim_kind: "causal_link", label: "hiring sets backlog", from_stated: 4, to_claim: 1, sets_to: 10, effect: "negative" },
      { claim_kind: "causal_link", label: "price sensitivity drives retention", from_claim: 0, to_claim: 2, effect: "negative" },
      { claim_kind: "causal_link", label: "backlog drives retention", from_claim: 1, to_claim: 2, effect: "negative" },
      { claim_kind: "causal_link", label: "retention drives goal", from_claim: 2, to_stated: 0, effect: "positive" },
    ],
  };

  it("A2: both hypotheses become factors and BOTH genuine actions survive as options", () => {
    const p = project(MIXED, BRIEF);
    expect(labelsOfKind(p, "factor").sort()).toEqual(
      [
        "the price rise we pushed through in January",
        "the support backlog — we're at 40 accounts waiting",
      ].sort(),
    );
    expect(labelsOfKind(p, "option").sort()).toEqual(
      ["hire three more support engineers", "roll back the price rise"].sort(),
    );
  });

  it("A2b: the decision is minted — there IS a comparison to run", () => {
    const p = project(MIXED, BRIEF);
    expect(labelsOfKind(p, "decision")).toHaveLength(1);
  });

  it("A2c: 'the price rise' appears ONCE as a factor and is never confused with the action that reverses it", () => {
    const p = project(MIXED, BRIEF);
    // Bound by identity: the cause span and the action span are different strings
    // and must occupy different nodes of different kinds.
    const kinds = kindsOf(p);
    expect(kinds).toContain("factor:the price rise we pushed through in January");
    expect(kinds).toContain("option:roll back the price rise");
    expect(kinds.filter((k) => k.endsWith("the price rise we pushed through in January"))).toHaveLength(1);
  });
});

describe("ACCEPTANCE 3 — a diagnosis plus exactly ONE genuine action keeps that action", () => {
  it("A3: the single genuine action survives as an option (it is the user's own choice set)", () => {
    const p = project(diagnosisRecords(), FIX.brief);
    expect(labelsOfKind(p, "option")).toContain(GENUINE_ACTION);
    expect(labelsOfKind(p, "option")).toHaveLength(1);
  });
});

describe("ACCEPTANCE 4 — a later genuine action gets its OWN option identity", () => {
  it("A4: a second action does not merge into the first, nor into any cause", () => {
    const raw = diagnosisRecords();
    raw.claims.push({
      claim_kind: "option_refinement",
      label: "Roll back the January price rise for enterprise accounts",
      basis: [],
    });
    raw.claims.push({
      claim_kind: "causal_link",
      label: "rollback sets price sensitivity",
      from_claim: raw.claims.length - 1,
      to_claim: 0,
      sets_to: 0.2,
      effect: "negative",
    });
    const p = project(raw, FIX.brief);
    const options = labelsOfKind(p, "option");
    expect(options).toContain(GENUINE_ACTION);
    expect(options).toContain("Roll back the January price rise for enterprise accounts");
    expect(options).toHaveLength(2);
  });
});

describe("ACCEPTANCE 5 — nothing invents a causal edge to make the graph analysable", () => {
  it("A5: every edge is authored by a causal_link claim; none is minted to satisfy analysis", () => {
    const raw = diagnosisRecords();
    const causalLinks = raw.claims.filter((c: { claim_kind: string }) => c.claim_kind === "causal_link").length;
    const p = project(raw, FIX.brief);
    // No edge may exist that no claim authored. Edges can be FEWER (a merge
    // collapses a link onto the parent, and self-loops are refused) — never more.
    expect(p.graph.edges.length).toBeLessThanOrEqual(causalLinks);
    for (const e of p.graph.edges) {
      expect(p.provenance[e.id], `edge ${e.id} has no provenance — it was invented`).toBeDefined();
    }
  });
});

describe("THE TWINS — the opposite direction, which is where the gap would open", () => {
  const OPT_BRIEF = "We could raise prices. Revenue is falling.";
  const optRecords = (extra: Record<string, unknown>[]) => ({
    stated_items: [
      { kind: "goal", source_quote: "Revenue", role: "baseline", value: 100, unit: "k" },
      { kind: "option", source_quote: "raise prices", is_baseline: false },
    ],
    claims: [
      { claim_kind: "factor", label: "Demand elasticity", basis: [] },
      { claim_kind: "causal_link", label: "o", from_stated: 1, to_claim: 0, sets_to: 1, effect: "negative" },
      { claim_kind: "causal_link", label: "e", from_claim: 0, to_stated: 0, effect: "negative" },
      ...extra,
    ],
  });

  it("TWIN-A: an ordinary option_refinement naming one stated option STILL merges", () => {
    const p = project(
      optRecords([{ claim_kind: "option_refinement", label: "Raise prices by 8% in January", basis: [1] }]),
      OPT_BRIEF,
    );
    expect(optionMerges(p).map((d) => d.label)).toEqual(["Raise prices by 8% in January"]);
    expect(kindsOf(p)).not.toContain("option:Raise prices by 8% in January");
  });

  it("TWIN-B: a genuine FACTOR whose EVIDENCE is a stated option must NOT merge (over-merge guard)", () => {
    const p = project(
      {
        stated_items: [
          { kind: "goal", source_quote: "Revenue", role: "baseline", value: 100, unit: "k" },
          { kind: "option", source_quote: "raise prices", is_baseline: false },
          { kind: "option", source_quote: "cut costs", is_baseline: false },
        ],
        claims: [
          { claim_kind: "factor", label: "Demand elasticity", basis: [1] },
          { claim_kind: "causal_link", label: "o", from_stated: 1, to_claim: 0, sets_to: 1, effect: "negative" },
          { claim_kind: "causal_link", label: "e", from_claim: 0, to_stated: 0, effect: "negative" },
          { claim_kind: "causal_link", label: "c", from_stated: 2, to_stated: 0, effect: "positive" },
        ],
      },
      "We could raise prices or cut costs. Revenue is falling.",
    );
    expect(kindsOf(p), "the factor keeps its own identity").toContain("factor:Demand elasticity");
    expect(causeMerges(p)).toEqual([]);
    expect(optionMerges(p)).toEqual([]);
  });

  it("TWIN-C: an ordinary two-option decision brief is COMPLETELY unaffected", () => {
    const records = {
      stated_items: [
        { kind: "goal", source_quote: "Revenue", role: "baseline", value: 100, unit: "k" },
        { kind: "option", source_quote: "raise prices", is_baseline: false },
        { kind: "option", source_quote: "cut costs", is_baseline: false },
      ],
      claims: [
        { claim_kind: "factor", label: "Demand elasticity", basis: [] },
        { claim_kind: "causal_link", label: "a", from_stated: 1, to_claim: 0, sets_to: 1, effect: "negative" },
        { claim_kind: "causal_link", label: "b", from_stated: 2, to_claim: 0, sets_to: 0.5, effect: "positive" },
        { claim_kind: "causal_link", label: "c", from_claim: 0, to_stated: 0, effect: "negative" },
      ],
    };
    const p = project(records, "We could raise prices or cut costs.");
    expect(labelsOfKind(p, "option").sort()).toEqual(["cut costs", "raise prices"].sort());
    expect(labelsOfKind(p, "factor")).toEqual(["Demand elasticity"]);
    expect(causeMerges(p)).toEqual([]);
    expect(labelsOfKind(p, "decision")).toHaveLength(1);
  });
});

describe("THE DOWNSTREAM SEAMS — what a new disclosure reason touches", () => {
  it("NOTICE: the cause merge is `other`, NOT `alternative_consolidated`", async () => {
    const { NOTICE_KIND_BY_REASON } = await import("../model-building-notices.js");
    // The user's ALTERNATIVES were not consolidated — their choice set was never
    // touched. `alternative_consolidated` would be specific-and-false on a
    // channel whose whole purpose is telling the truth about what was lost; the
    // file's own header rule is that the coarse-but-true bucket wins.
    expect(NOTICE_KIND_BY_REASON.factor_merged_into_stated_cause).toBe("other");
    expect(NOTICE_KIND_BY_REASON.factor_merged_into_stated_cause).not.toBe(
      "alternative_consolidated",
    );
    // ...and the twin keeps its own, different answer, so this is a real
    // discrimination and not a table collapsed onto one value.
    expect(NOTICE_KIND_BY_REASON.refinement_merged_into_stated_option).toBe(
      "alternative_consolidated",
    );
  });

  it("COMPLETION: a cause-merged label is ACCOUNTED FOR, not read as lost content", async () => {
    const { completionRegressesProtectedContent } = await import("../completion.js");
    // ⭐ THE PAIR MUST DIFFER, OR THIS PROVES NOTHING. The accounting only ever
    // matters for a node that EXISTS before and is GONE after — comparing a
    // projection with itself can never exercise it (trap 13b, a guard agreeing
    // with itself). So `before` is the same record set with the factor claim
    // UNBASED, where it mints its own node; `after` names the cause in its
    // `basis`, where it merges. Exactly the pass-1 → pass-2 transition the
    // completion pass can produce.
    const unbased = diagnosisRecords();
    unbased.claims[0].basis = [];
    const before = project(unbased, FIX.brief);
    const after = project(diagnosisRecords(), FIX.brief);

    // Precondition, asserted in-test so the outcome is provably the code's doing
    // and not a fixture that stopped discriminating.
    expect(labelsOfKind(before, "factor")).toContain("Price sensitivity of enterprise accounts");
    expect(labelsOfKind(after, "factor")).not.toContain("Price sensitivity of enterprise accounts");

    // The disappearance is excused ONLY because the parent records having
    // absorbed it. REDs if `completion.ts` stops reading `merged_restatements`.
    expect(completionRegressesProtectedContent(before, after)).toEqual([]);
  });
});
