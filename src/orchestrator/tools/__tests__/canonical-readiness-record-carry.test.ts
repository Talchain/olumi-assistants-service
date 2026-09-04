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
import ts from "typescript";

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
  // graph that does not clear that gate therefore has NO canonical authority to
  // carry from, and the payload stays visibly pipeline-shaped. Back-filling it
  // from a derivation would invent a record no authority produced.
  //
  // ⚠ AND THE GATE IS NARROWER THAN THE NAME SUGGESTS — DERIVED, NOT INFERRED.
  // `isGraphV3` (`draft-graph.ts:599`) is `Array.isArray(g.nodes) &&
  // Array.isArray(g.edges)` — a shape sniff, NOT a `GraphV3.safeParse`. So the
  // uncovered state is "the pipeline body's graph has no nodes/edges arrays",
  // and it is decided by a MODULE-PRIVATE predicate on the DRAFT PATH, not by
  // anything this file's unit under test can be handed.
  "graph_not_parseable_as_v3",
] as const;

describe("C2 — the uncovered case is named, not silently unexercised", () => {
  it("pins the KNOWN-NOT-COVERED set EXACTLY — REDs if it grows OR shrinks", () => {
    expect([...KNOWN_NOT_COVERED].sort()).toEqual(["graph_not_parseable_as_v3"]);
  });

  /**
   * ⚠⚠ THERE IS DELIBERATELY NO BEHAVIOURAL TEST HERE, AND THE REASON IS THE
   * FINDING. An earlier version of this file carried one, titled *"a graph the
   * canonical authority cannot assess yields NO canonical payload"*, whose
   * fixture removed the goal node and whose assertion sat inside
   * `if (!canonical || !canonical.readiness_issues)`.
   *
   * MEASURED: on that fixture the authority returns a PAYLOAD — `status:
   * 'blocked'`, `readiness_issues` length 1, code `NO_GOAL`, `repair_proposal`
   * absent — so the `if` was FALSE and the body executed ZERO assertions.
   * Inverting the guarded assertion left the file 15/15 GREEN; only forcing the
   * branch REDs it. A test that cannot fail, under a title claiming it guards,
   * is the class this PR is otherwise fixing.
   *
   * AND IT COULD NOT BE REPAIRED IN PLACE. Removing a node cannot falsify
   * `Array.isArray(nodes) && Array.isArray(edges)` (measured: `true` on that
   * fixture; contrast control `isGraphV3({})` = `false`, so the gate IS
   * falsifiable — just not by any graph). Nor does
   * `buildCanonicalAnalysisReadyFromGraph` return `undefined` on that condition:
   * it returns `undefined` only when `resolveRunAdmission(...).assessment
   * .analysisReady` is falsy, which is a DIFFERENT condition on a DIFFERENT
   * seam. Representing this limit needs a draft-path test driving a pipeline
   * body — not a fixture handed to the unit under test here.
   *
   * ✅ THE LIMIT ITSELF IS COVERED, unconditionally, by *"IDENTITY when there is
   * no canonical payload at all"* above: given `undefined`, the carry returns the
   * pipeline payload BY REFERENCE and invents nothing. That is the whole of what
   * this function can promise about the uncovered state, and it is asserted with
   * no branch to dodge.
   */
});

/**
 * ⭐ L2 — THE FAIL-LOUD KEY-SET GUARD (a drift guard, not a defect fix).
 *
 * `extractAnalysisReady` rebuilds the payload key by key. Any field added at a
 * builder later is silently dropped on the draft path unless someone remembers
 * to name it there too — a hand-maintained mirror wearing a function's clothes,
 * and `may_run` was already its victim once.
 *
 * ⚠⚠ THE FIRST VERSION OF THIS GUARD READ ONLY `AnalysisReadyPayload.shape` AND
 * CALLED THE SCHEMA *"the source of truth"*. THAT WAS THE FALSE PREMISE, and it
 * made the guard blind to the exact field class C2 exists to fix.
 *
 * `AnalysisReadyPayload` is `.passthrough()`. `.shape` is therefore BY
 * CONSTRUCTION not the payload's key set — it is only the DECLARED subset, and
 * every additive field that rides the wire without a Zod declaration is
 * invisible to it. Measured at this tip:
 *
 *   schema `.shape`                       17 keys
 *   payload TYPE                          20 keys
 *   in TYPE, absent from `.shape`         readiness_issues · repair_proposal ·
 *                                         computed_at · coaching_summary
 *   in `.shape`, absent from TYPE         user_questions
 *
 * ⭐ `readiness_issues` AND `repair_proposal` ARE THE TWO FIELDS THIS PR EXISTS
 * TO CARRY, and the schema-only guard could not see either of them.
 * `coaching_summary` is likewise live and shipped (`draft-graph-dispatch.ts:1028`)
 * and sat in NO bucket with the guard fully green.
 *
 * ⭐ AND NEITHER SIDE IS A SUPERSET, which is why this derives from BOTH rather
 * than swapping one blindness for its mirror: `user_questions` is declared on the
 * schema and absent from the type, so a TYPE-ONLY guard would stop considering a
 * key that is already bucketed. The honest key set is the UNION.
 *
 * The guard requires every key in that union to be ACCOUNTED FOR in exactly one
 * bucket. A new field on EITHER side REDs this test until someone decides which
 * bucket it belongs in. It still cannot prove the buckets are RIGHT — only that
 * no key is unconsidered. That is the honest limit of a derived guard (it proves
 * agreement, never completeness), which is why the behavioural carry tests above
 * exist too.
 */

/**
 * The payload TYPE's own key set, read from the declaration by the TypeScript
 * AST — `GraphPatchBlockData['analysis_ready']` in `src/orchestrator/types.ts`,
 * which is the type `extractAnalysisReady` returns and `carryCanonicalOnlyFields`
 * takes. Read from the AST rather than from `keyof`, because the TYPE must be
 * enumerable AT RUNTIME for this guard to RED inside the test gate; `z.infer` of
 * a `.passthrough()` schema carries an index signature and is no use either way.
 */
function payloadTypeKeys(): string[] {
  const rel = "../../types.ts";
  const path = fileURLToPath(new URL(rel, import.meta.url));
  const sf = ts.createSourceFile(rel, readFileSync(path, "utf8"), ts.ScriptTarget.ES2022, true);
  let keys: string[] | null = null;
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === "GraphPatchBlockData") {
      for (const member of node.members) {
        if (
          ts.isPropertySignature(member) &&
          member.name !== undefined &&
          member.name.getText() === "analysis_ready" &&
          member.type !== undefined &&
          ts.isTypeLiteralNode(member.type)
        ) {
          keys = member.type.members
            .filter(ts.isPropertySignature)
            .map((p) => p.name.getText());
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return keys ?? [];
}
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

const CARRIED_FROM_CANONICAL = [
  "may_run",
  "readiness_issues",
  "repair_proposal",
  // The ONE analysis-admission result. Same bucket and same mechanism as
  // `may_run`, and for the same reason: the unified pipeline cannot compute it
  // (it does not hold the admission rule), and `extractAnalysisReady` is a
  // named-field re-projection, so without the carry the DRAFT turn — the one
  // turn where a fresh user first meets the Analyse control — would ship no
  // verdict at all. That is not hypothetical: it is exactly how `may_run` once
  // shipped absent on 9 of 9 draft turns.
  "analysis_admission",
] as const;

const DELIBERATELY_NOT_CARRIED = [
  "blocked_reason",      // minted per-turn by the refusal carrier, never re-projected
  "user_questions",      // OUTPUT a refusing/pipeline turn did not produce
  "computed_at",         // stamped at the wire by attachComputedAt
  "freshness",           // stamped at the wire from the freshness derivation
  "freshness_reason",
  "graph_hash_at_run",
  "current_graph_hash",
  // Stamped DOWNSTREAM of the re-projection, by the draft dispatch handler:
  // `draft-graph-dispatch.ts:1028` spreads it onto the payload this seam has
  // already produced (`{ ...baseAnalysisReady, coaching_summary }`). So it is
  // not a re-projection field and not a carry — it survives by a different
  // mechanism entirely, which is precisely why the schema-only guard never
  // asked about it.
  "coaching_summary",
] as const;

const schemaShapeKeys = (): string[] => Object.keys((AnalysisReadyPayloadSchema as any).shape ?? {});

/** The honest key set: everything either declaration knows about. */
const analysisReadyKeyUnion = (): string[] =>
  [...new Set([...schemaShapeKeys(), ...payloadTypeKeys()])].sort();

describe("C2 L2 — every analysis_ready field is accounted for at the re-projection seam", () => {
  it("PRECONDITION: the schema really exposes its key set (or this guard is vacuous)", () => {
    const keys = schemaShapeKeys();
    expect(keys.length, "PRECONDITION: a zero-key read means the probe broke, not that the schema is empty")
      .toBeGreaterThan(5);
    expect(keys, "PRECONDITION: contrast control — a field known to exist").toContain("options");
  });

  it("PRECONDITION: the payload TYPE really parses (or half this guard is vacuous)", () => {
    const keys = payloadTypeKeys();
    expect(keys.length, "PRECONDITION: a zero-key AST read means the parse broke, not that the type is empty")
      .toBeGreaterThan(5);
    expect(keys, "PRECONDITION: contrast control — a field known to be on the type").toContain("options");
  });

  /**
   * ⚠ THE PRECONDITION THAT MAKES THIS GUARD DIFFERENT FROM THE ONE IT REPLACES.
   * It pins, in-test, that the two halves genuinely DISAGREE — and it binds by
   * IDENTITY to the two fields C2 exists to carry, never by a count another pair
   * could satisfy. If the schema ever declares them, this REDs and the union
   * derivation should be re-argued rather than silently kept.
   */
  it("PRECONDITION: the schema is passthrough and CANNOT see the fields C2 carries", () => {
    expect(
      (AnalysisReadyPayloadSchema as any)._def?.unknownKeys,
      "PRECONDITION: a strict schema would make .shape the real key set and change this argument",
    ).toBe("passthrough");

    const shape = new Set(schemaShapeKeys());
    for (const field of ["readiness_issues", "repair_proposal"] as const) {
      expect(
        shape.has(field),
        `PRECONDITION: '${field}' must be INVISIBLE to .shape — that blindness is why the type half exists`,
      ).toBe(false);
      expect(
        payloadTypeKeys(),
        `PRECONDITION: '${field}' must be visible on the TYPE, or the type half adds nothing`,
      ).toContain(field);
    }

    // The mirror direction, so a later "just use the type" tidy-up REDs here:
    // a type-only guard would stop considering a key that IS declared and IS
    // already bucketed.
    const onlyOnSchema = schemaShapeKeys().filter((k) => !new Set(payloadTypeKeys()).has(k));
    expect(
      onlyOnSchema,
      "PRECONDITION: neither side is a superset — that is why the union, not a swap",
    ).not.toEqual([]);
  });

  it("no field on EITHER declaration is UNCONSIDERED — a new field REDs until someone buckets it", () => {
    const declared = new Set<string>([
      ...NAMED_BY_REPROJECTION,
      ...CARRIED_FROM_CANONICAL,
      ...DELIBERATELY_NOT_CARRIED,
    ]);
    const unconsidered = analysisReadyKeyUnion().filter((k) => !declared.has(k));
    expect(unconsidered, `unbucketed analysis_ready field(s): ${unconsidered.join(", ")}`).toEqual([]);
  });

  /**
   * The mirror defect, and this file has already paid for it once: the first
   * version of the trio hand-listed a `goal_threshold_display` that does not
   * exist. A bucket entry naming a field no declaration carries is a
   * hand-maintained mirror that has already drifted.
   */
  it("no bucket entry is a PHANTOM — every declared key exists on some declaration", () => {
    const known = new Set(analysisReadyKeyUnion());
    const phantom = [
      ...NAMED_BY_REPROJECTION,
      ...CARRIED_FROM_CANONICAL,
      ...DELIBERATELY_NOT_CARRIED,
    ].filter((k) => !known.has(k));
    expect(phantom, `bucketed but non-existent analysis_ready field(s): ${phantom.join(", ")}`).toEqual([]);
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
