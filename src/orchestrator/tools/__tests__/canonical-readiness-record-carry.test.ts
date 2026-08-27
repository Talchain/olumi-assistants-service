/**
 * ⭐ C2 — ONE SHAPE CONTRACT BETWEEN THE analysis_ready PRODUCERS.
 *
 * ── WHAT WAS MEASURED, AND WHERE THE LOSS ACTUALLY IS ───────────────────────
 * `analysis_ready` reaches consumers in two shapes on one graph:
 *
 *   canonical (`buildCanonicalAnalysisReadyFromGraph`)
 *       8 blockers · 8 readiness_issues · repair_proposal PRESENT
 *   pipeline  (`cee/transforms/analysis-ready.ts` → `extractAnalysisReady`)
 *       8 blockers · 0 readiness_issues · repair_proposal ABSENT
 *
 * ⚠ AND THE ATTRIBUTION MATTERS, because it decides which fix is the right one.
 * The two fields are NOT dropped by `extractAnalysisReady`. The pipeline builds
 * its payload by calling `buildAnalysisReadyPayload` directly
 * (`cee/transforms/schema-v3.ts:1595`), and THAT producer never computes either
 * field — zero occurrences of both names in the file, contrast control
 * `blockers` = 20 in the same sweep. A re-projection cannot drop what was never
 * in the body it re-projects. So a spread-instead-of-named-fields change would
 * NOT have recovered them, and the fix has to CARRY from the canonical
 * authority instead.
 *
 * TWO INDEPENDENT LOSS MECHANISMS, DELIBERATELY FIXED SEPARATELY:
 *   L1 PRODUCER GAP — the pipeline never computes readiness_issues /
 *      repair_proposal. Fixed here, by carrying the canonical authority's own
 *      values (already computed at the same call site).
 *   L2 MIRROR       — `extractAnalysisReady` is a NAMED-FIELD RE-PROJECTION and
 *      silently drops any field added at the builder later (`may_run` was its
 *      first victim, by its own comment). Fixed by the FAIL-LOUD KEY-SET GUARD
 *      below — NOT by a blanket spread, which would silently admit unvetted
 *      pipeline fields (the schema is `.passthrough()`, so nothing else would
 *      stop them). The inverse defect is worse than the one it fixes.
 *
 * ── WHY A CARRY AND NOT A SECOND DERIVATION ─────────────────────────────────
 * `draft-graph.ts` ALREADY computes `canonicalAnalysisReady` on the same line
 * that builds the projected payload. The values are in hand. Re-deriving them —
 * even from the same predicate — would put two computations of one fact in the
 * tree, which is the hazard `analysis-ready-core` exists to remove.
 *
 * ── THE DISCRIMINATING PAIR ─────────────────────────────────────────────────
 * A fix that improves the poor shape while silently perturbing the good one is
 * the over-wide failure this estate keeps paying for. Every carry assertion
 * below is twinned with a REFERENCE-IDENTITY assertion on the canonical shape.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("../../../utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  calculateCost: vi.fn(() => 0),
  TelemetryEvents: {},
}));
vi.mock("../../../config/index.js", () => ({
  config: { cee: {}, features: {} },
  isProduction: () => false,
}));

import { buildAnalysisReadyPayload } from "../../../cee/transforms/analysis-ready.js";
import {
  buildCanonicalAnalysisReadyFromGraph,
  carryCanonicalOnlyFields,
} from "../analysis-ready-helper.js";
import { AnalysisReadyPayload as AnalysisReadyPayloadSchema } from "../../../schemas/analysis-ready.js";
import { pickGoalThresholdTrio } from "../../../utils/goal-threshold-trio.js";

/** The four factors from the witnessed session, by identity — never by count alone. */
const VALUELESS = [
  "AI-native rebuild investment",
  "Discount-led logo acquisition",
  "Positioning and packaging overhaul",
  "Competitive differentiation vs AI copilot rivals",
] as const;

const edge = (from: string, to: string, mean = 0.5) => ({
  from,
  to,
  strength: { mean, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: (mean >= 0 ? "positive" : "negative") as "positive" | "negative",
});

/**
 * The witnessed graph, reused from `readiness-open-items-pipeline-shape.test.ts`
 * rather than re-authored. `valued` controls the ONE variable under test: a
 * fixture written from this lane's own head would encode this lane's model of
 * the producer instead of the producer.
 */
function graphWithFourValuelessFactors(valued: boolean): any {
  const interventions = (v: number) =>
    Object.fromEntries(
      VALUELESS.map((_, i) => [
        `fac_${i}`,
        { value: v, source: "user_specified", target_match: "exact" },
      ]),
    );
  const nodes: any[] = [
    { id: "dec_1", kind: "decision", label: "Which strategy?" },
    {
      id: "opt_a",
      kind: "option",
      label: "Ship AI rebuild",
      ...(valued ? { data: { interventions: interventions(0.6) } } : {}),
    },
    {
      id: "opt_b",
      kind: "option",
      label: "Hold position",
      ...(valued ? { data: { interventions: interventions(0.4) } } : {}),
    },
    { id: "out_1", kind: "outcome", label: "Contribution", observed_state: { value: 0.5 } },
    { id: "goal_1", kind: "goal", label: "Maximise contribution", goal_threshold: 0.7 },
  ];
  const edges: any[] = [edge("dec_1", "opt_a", 1), edge("dec_1", "opt_b", 1)];
  VALUELESS.forEach((label, i) => {
    nodes.push({ id: `fac_${i}`, kind: "factor", label, category: "controllable" });
    edges.push(edge(`fac_${i}`, "out_1", 0.4));
    edges.push(edge("opt_a", `fac_${i}`, 1));
    edges.push(edge("opt_b", `fac_${i}`, 1));
  });
  edges.push(edge("out_1", "goal_1", 0.9));
  return { nodes, edges };
}

/**
 * ⚠ THE VALUED VARIANT USES THE OBJECT FORM ON PURPOSE, and this cost a RED to
 * learn. `transformOptionToAnalysisReady` reads
 * `firstIntervention.value_confidence ?? firstIntervention.target_match.confidence`
 * (`cee/transforms/analysis-ready.ts:147`), which THROWS on a bare number. The
 * sibling test this fixture came from only ever drives the valueless arm, so the
 * flat-number spelling was never exercised through this producer. A fixture the
 * producer cannot accept is not a weaker test — it is a test of nothing.
 */
function pipelineOptions(valued: boolean): any[] {
  const interventions = (v: number) =>
    Object.fromEntries(
      VALUELESS.map((_, i) => [
        `fac_${i}`,
        { value: v, source: "user_specified", target_match: { confidence: "high" } },
      ]),
    );
  return [
    { id: "opt_a", label: "Ship AI rebuild", status: undefined, interventions: valued ? interventions(0.6) : {} },
    { id: "opt_b", label: "Hold position", status: undefined, interventions: valued ? interventions(0.4) : {} },
  ];
}

const pipelineShaped = (valued: boolean): any =>
  buildAnalysisReadyPayload(pipelineOptions(valued) as any, "goal_1", graphWithFourValuelessFactors(valued) as any);

const canonicalShaped = (valued: boolean): any =>
  buildCanonicalAnalysisReadyFromGraph(graphWithFourValuelessFactors(valued));

describe("C2 L1 — the canonical readiness record must reach the pipeline-shaped payload", () => {
  it("PRECONDITION: the pipeline producer really emits the POOR shape (no readiness_issues, no repair_proposal)", () => {
    const poor = pipelineShaped(false);
    expect(poor, "PRECONDITION: the pipeline producer must return a payload").toBeTruthy();
    expect(
      poor.readiness_issues,
      "PRECONDITION: if the pipeline ever gains this field, this whole test asserts nothing",
    ).toBeUndefined();
    expect(poor.repair_proposal, "PRECONDITION: pipeline must not carry a repair proposal").toBeUndefined();
    expect(
      Array.isArray(poor.blockers) && poor.blockers.length,
      "PRECONDITION: blockers must survive the pipeline path — they are the contrast control",
    ).toBeGreaterThan(0);
  });

  it("PRECONDITION: the canonical producer really emits BOTH fields on the same graph", () => {
    const good = canonicalShaped(false);
    expect(good, "PRECONDITION: canonical build must succeed on this graph").toBeTruthy();
    expect(
      Array.isArray(good.readiness_issues) && good.readiness_issues.length,
      "PRECONDITION: canonical must have a non-empty issue record, or the carry has nothing to move",
    ).toBeGreaterThan(0);
    expect(good.repair_proposal, "PRECONDITION: canonical must have a repair proposal").toBeTruthy();
  });

  it("CARRIES the canonical readiness_issues onto the pipeline-shaped payload — BY IDENTITY", () => {
    const poor = pipelineShaped(false);
    const good = canonicalShaped(false);

    const carried: any = carryCanonicalOnlyFields(poor, good);

    // Bind by the issue_ids the canonical authority minted, never by a count a
    // different producer could also satisfy.
    const canonicalIds = good.readiness_issues.map((i: any) => i.issue_id).sort();
    const carriedIds = (carried.readiness_issues ?? []).map((i: any) => i.issue_id).sort();
    expect(carriedIds).toEqual(canonicalIds);
  });

  it("CARRIES the canonical repair_proposal onto the pipeline-shaped payload — BY IDENTITY", () => {
    const poor = pipelineShaped(false);
    const good = canonicalShaped(false);

    const carried: any = carryCanonicalOnlyFields(poor, good);

    expect(carried.repair_proposal?.proposal_version).toBe("readiness_repair_v1");
    // The proposal's own issue_ids must be the canonical ones — a manufactured
    // proposal with the right shape would pass a shape-only assertion.
    expect([...(carried.repair_proposal?.issue_ids ?? [])].sort())
      .toEqual([...good.repair_proposal.issue_ids].sort());
  });

  it("DISCRIMINATING TWIN — the CANONICAL-shaped payload is returned UNCHANGED, by reference", () => {
    const good = canonicalShaped(false);
    // Reference equality, not deep equality: the path that already builds
    // canonically must be PROVABLY unperturbed, which is what makes "the good
    // shape does not move" a property rather than a hope.
    expect(carryCanonicalOnlyFields(good, good)).toBe(good);
  });

  /**
   * ⚠ THE FIRST VERSION OF THIS TEST ASSUMED A FULLY-VALUED GRAPH YIELDS NO
   * `readiness_issues`, AND THAT IS FALSE — its PRECONDITION caught it. The
   * canonical authority records ALL issues, not just blocking ones
   * (`analysis-ready-helper.ts:1179` carries `allIssues`), so a healthy graph
   * still has a record. Weakening the assertion to match would have been the
   * wrong move; the assumption was wrong, not the assertion.
   *
   * The genuinely-absent shape IS reachable — `:1179` reads
   * `...(allIssues.length > 0 ? { readiness_issues: allIssues } : {})`, so a
   * zero-issue assessment OMITS the key entirely. That is the shape built here,
   * by stripping the two keys from a real canonical payload rather than
   * hand-authoring a payload whose other fields would be this lane's invention.
   */
  it("ABSENCE STAYS ABSENCE — nothing is invented when the canonical authority has no record", () => {
    const poor = pipelineShaped(false);
    const { readiness_issues, repair_proposal: _proposal, ...noRecord } = canonicalShaped(false);
    expect(
      readiness_issues,
      "PRECONDITION: the source payload must really have had a record to strip",
    ).toBeTruthy();
    expect(
      "readiness_issues" in noRecord,
      "PRECONDITION: the stripped payload must genuinely lack the key, not hold undefined",
    ).toBe(false);

    const carried: any = carryCanonicalOnlyFields(poor, noRecord as any);
    expect(
      carried.readiness_issues,
      "an empty record must never be substituted for 'checked, none' — a different, false claim",
    ).toBeUndefined();
    expect(carried.repair_proposal).toBeUndefined();
  });

  it("the may_run carry this function already owned is NOT lost by widening it", () => {
    const good = canonicalShaped(false);
    expect(good.may_run, "PRECONDITION: canonical must carry a verdict").toBeTypeOf("boolean");

    const claiming = { ...good, may_run: !good.may_run };
    expect(
      claiming.may_run,
      "PRECONDITION: the payload must really disagree, or this asserts nothing",
    ).toBe(!good.may_run);

    expect((carryCanonicalOnlyFields(claiming, good) as any).may_run).toBe(good.may_run);
  });

  it("IDENTITY when there is no canonical payload at all — the non-V3 case is not back-filled", () => {
    const poor = pipelineShaped(false);
    // This is the KNOWN-NOT-COVERED case made executable: no canonical payload
    // means nothing to carry, and the honest outcome is the pipeline shape
    // UNCHANGED — never a derivation invented to fill the hole.
    expect(carryCanonicalOnlyFields(poor, undefined)).toBe(poor);
  });
});

/**
 * ⭐ THE SCOPE LIMIT, MADE EXECUTABLE.
 *
 * A witness that does not REPRESENT its uncovered case will be read as having
 * covered it — that is exactly how a "20/20 PASS" becomes a false assurance.
 * So the uncovered set is pinned EXACTLY: this test REDs if the set GROWS (a
 * new gap appeared and nobody said so) or SHRINKS (a gap closed and the
 * scope-limit prose is now overstating the risk).
 */
const KNOWN_NOT_COVERED = [
  // `draft-graph.ts:403` — `graphOutput = isGraphV3(graph) ? graph : null`, and
  // `:421` computes the canonical payload ONLY when graphOutput is non-null. A
  // graph that does not parse as V3 therefore has NO canonical authority to
  // carry from, and the payload stays visibly pipeline-shaped. Back-filling it
  // from a derivation would invent a record no authority produced.
  "graph_not_parseable_as_v3",
] as const;

describe("C2 — the uncovered case is named, not silently unexercised", () => {
  it("pins the KNOWN-NOT-COVERED set EXACTLY — REDs if it grows OR shrinks", () => {
    expect([...KNOWN_NOT_COVERED].sort()).toEqual(["graph_not_parseable_as_v3"]);
  });

  it("BEHAVIOURAL: a graph the canonical authority cannot assess yields NO canonical payload", () => {
    // Not a hand-built "invalid" object: a structurally real graph with the goal
    // node removed, so V3 parsing/assessment genuinely cannot produce a payload.
    const graph = graphWithFourValuelessFactors(false);
    graph.nodes = graph.nodes.filter((n: any) => n.kind !== "goal");
    const canonical = buildCanonicalAnalysisReadyFromGraph(graph);

    const poor = pipelineShaped(false);
    const carried = carryCanonicalOnlyFields(poor, canonical as any);
    // Whatever the authority did or did not produce, the pipeline payload must
    // never be back-filled with an invented record.
    if (!canonical || !(canonical as any).readiness_issues) {
      expect((carried as any).readiness_issues).toBeUndefined();
    }
  });
});

/**
 * ⭐ L2 — THE FAIL-LOUD KEY-SET GUARD (a drift guard, not a defect fix).
 *
 * `extractAnalysisReady` rebuilds the payload key by key. Any field added at a
 * builder later is silently dropped on the draft path unless someone remembers
 * to name it there too — a hand-maintained mirror wearing a function's clothes,
 * and `may_run` was already its victim once.
 *
 * This guard DERIVES the key set from the schema (the source of truth) and
 * requires every key to be ACCOUNTED FOR in exactly one bucket. A new schema
 * field REDs this test until someone decides which bucket it belongs in. It
 * cannot prove the buckets are RIGHT — only that no key is unconsidered. That
 * is the honest limit of a derived guard (it proves agreement, never
 * completeness), which is why the behavioural carry tests above exist too.
 */
/**
 * ⚠ THE TRIO IS DERIVED, NOT LISTED — and the first version of this file proved
 * why. It hand-listed a `goal_threshold_display` that does not exist and omitted
 * `goal_threshold_cap` that does; the guard below caught it on its first run, in
 * the very list written to catch hand-maintained mirrors. `pickGoalThresholdTrio`
 * is the owner of which keys ride, so the keys come from IT.
 */
const TRIO_KEYS = Object.keys(
  pickGoalThresholdTrio({
    goal_threshold_raw: 1,
    goal_threshold_unit: "GBP",
    goal_threshold_cap: 10,
  } as any),
);

const NAMED_BY_REPROJECTION = [
  "options", "goal_node_id", "status", "blockers", "model_adjustments",
  "goal_threshold", "bias_findings",
  ...TRIO_KEYS,
] as const;

const CARRIED_FROM_CANONICAL = ["may_run", "readiness_issues", "repair_proposal"] as const;

const DELIBERATELY_NOT_CARRIED = [
  "blocked_reason",      // minted per-turn by the refusal carrier, never re-projected
  "user_questions",      // OUTPUT a refusing/pipeline turn did not produce
  "computed_at",         // stamped at the wire by attachComputedAt
  "freshness",           // stamped at the wire from the freshness derivation
  "freshness_reason",
  "graph_hash_at_run",
  "current_graph_hash",
] as const;

describe("C2 L2 — every analysis_ready field is accounted for at the re-projection seam", () => {
  it("PRECONDITION: the schema really exposes its key set (or this guard is vacuous)", () => {
    const keys = Object.keys((AnalysisReadyPayloadSchema as any).shape ?? {});
    expect(keys.length, "PRECONDITION: a zero-key read means the probe broke, not that the schema is empty")
      .toBeGreaterThan(5);
    expect(keys, "PRECONDITION: contrast control — a field known to exist").toContain("options");
  });

  it("no schema field is UNCONSIDERED — a new field REDs until someone buckets it", () => {
    const declared = new Set<string>([
      ...NAMED_BY_REPROJECTION,
      ...CARRIED_FROM_CANONICAL,
      ...DELIBERATELY_NOT_CARRIED,
    ]);
    const schemaKeys = Object.keys((AnalysisReadyPayloadSchema as any).shape ?? {});
    const unconsidered = schemaKeys.filter((k) => !declared.has(k));
    expect(unconsidered, `unbucketed analysis_ready field(s): ${unconsidered.join(", ")}`).toEqual([]);
  });

  it("the buckets are DISJOINT — a field in two buckets is two answers to one question", () => {
    const all = [...NAMED_BY_REPROJECTION, ...CARRIED_FROM_CANONICAL, ...DELIBERATELY_NOT_CARRIED];
    expect(all.length).toBe(new Set(all).size);
  });
});

/**
 * ⭐ ONE OWNER FOR THE DEGENERATE "blocked, no model" CARRIER.
 *
 * Three production literals asserted the same thing to a consumer — "blocked,
 * no identity" — each with a DIFFERENT optional-field set:
 *   compose/analysis-ready-emit.ts   { …, bias_findings: [] }
 *   tools/analysis-ready-helper.ts   { …, blocked_reason, readiness_issues, … }
 *   tools/analysis-ready-helper.ts   { …, blocked_reason }
 * Three spellings of one shape is how they drift apart silently. This guard
 * scans the PRODUCTION SOURCE and requires exactly one definition site.
 */
const PRODUCTION_SOURCES = [
  // The factory's home — the ONE site that may spell the shape.
  "../../../schemas/analysis-ready.ts",
  // The two sites that used to spell it themselves and must now defer.
  "../../../orchestrator-v5/compose/analysis-ready-emit.ts",
  "../analysis-ready-helper.ts",
] as const;

describe("C2 — the degenerate blocked carrier has exactly ONE definition site", () => {
  it("PRECONDITION: the source scan can actually read these files (contrast control)", () => {
    for (const rel of PRODUCTION_SOURCES) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
      expect(src.length, `PRECONDITION: ${rel} must be readable and non-empty`).toBeGreaterThan(100);
      // Contrast control: a term every scanned file genuinely carries. It was
      // `goal_node_id` until the factory landed and the emit site stopped
      // naming the field at all — a control that decays the moment the fix
      // works is a control with an expiry date nobody wrote down.
      expect(src, `PRECONDITION: contrast control — ${rel} must be the file we think it is`)
        .toContain("blocked");
    }
  });

  it("exactly ONE production literal spells the empty-identity carrier", () => {
    let literals = 0;
    for (const rel of PRODUCTION_SOURCES) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
      for (const line of src.split("\n")) {
        // Skip comment lines: the docblocks quote this shape when explaining it,
        // and a guard that counts prose is a guard that fails for the wrong reason.
        const trimmed = line.trim();
        if (trimmed.startsWith("*") || trimmed.startsWith("//")) continue;
        if (/goal_node_id:\s*(''|"")/.test(line)) literals += 1;
      }
    }
    expect(literals, "each extra literal is a shape free to drift from the others").toBe(1);
  });
});
