/**
 * THE SCALE PROJECTION — records-drafted graphs must carry a coherent value
 * scale, so the analysis COMPUTES on realistic briefs instead of refusing.
 *
 * ── THE DEFECT THIS PINS (witnessed live, 20260812T134625Z-fresh-323fcd) ────
 * The deployed golden fresh journey FAILED INV-4: run_analysis honestly refused
 * with "the scale of Annual CRM Licence Cost, One-Off Migration Cost is
 * unclear…". Root cause at the bytes: the records projector emitted RAW £
 * magnitudes (50000, 20000) as bare interventions on capless factors beside
 * [0,1] proportions (0.75 adoption). The egress guard
 * (`plot-intervention-scale.ts`) is CORRECT to block that mixture — PLoT's
 * request-level gate would divide the stranded [0,1] values by ranges derived
 * from their own spread, silently corrupting them. The fix is NOT to touch the
 * guard: it is for the projector to put the whole drafted request on ONE wire
 * scale (the unit interval), truthfully, with raw user magnitudes preserved on
 * baselines via `raw_value`.
 *
 * ── WHY THE ORACLE HERE IS THE CONSUMER'S OWN PREDICATE (trap 13d) ──────────
 * The decisive tests below feed the projector's output to the REAL analysis
 * seam functions — `buildFactorScaleMap` + `projectRequestInterventionsToWireScale`
 * — and assert `mixedUnresolved === false` / `allWithinUnitInterval === true`.
 * These are the exact functions whose verdict produced the live refusal, so a
 * green here is a claim about the deployed predicate, not about this lane's
 * reading of it. At the pristine tip these tests are RED (the projector emits
 * the mixture the guard blocks) — that is the defect, demonstrated at the
 * consumer's bytes.
 *
 * ── WHAT IS DELIBERATELY *NOT* CHANGED, PINNED HERE TOO ─────────────────────
 *   · NEGATIVE magnitudes have no unit-interval representation. A factor
 *     carrying one is left RAW and the guard's honest typed ask stays
 *     REACHABLE — the corpus (30 banked record sets) contains zero negatives,
 *     so this class is covered synthetically, per trap 13d: a corpus sharing
 *     the code's blind spot certifies the defect.
 *   · No `cap` is stored on any factor. Derived at the bytes: the edit
 *     handler (`d1-shared/normalise-factor-value.ts`) writes
 *     `value = raw/cap` whenever a cap exists, and the golden-journey INV-7
 *     binds `observed_state.value === <user-stated raw>` post-edit — a stored
 *     cap would make a faithful edit read as a failure. Capless factors write
 *     `value === raw_value`, which keeps INV-7 green.
 *
 * ⭐ EVERY ASSERTION BINDS BY IDENTITY — minted ids located via exact labels —
 * never by a value predicate another node could satisfy (trap 19).
 */
import { describe, expect, it } from "vitest";
import { projectRecordsToGraph, projectionFingerprint } from "../projector.js";
import {
  buildFactorScaleMap,
  projectRequestInterventionsToWireScale,
} from "../../../../orchestrator-v5/tools/plot-intervention-scale.js";
import type { DraftRecordSet } from "../grammar.js";

/** Locate a node by its EXACT label; fail loud on 0 or 2+ matches. */
function idOf(graph: { nodes: Array<{ id: string; label: string }> }, label: string): string {
  const hits = graph.nodes.filter((n) => n.label === label);
  expect(hits, `expected exactly one node labelled "${label}"`).toHaveLength(1);
  return hits[0]!.id;
}

const interventionsOf = (
  graph: { nodes: Array<{ id: string; data?: Record<string, unknown> }> },
  optionId: string,
): Record<string, number> =>
  ((graph.nodes.find((n) => n.id === optionId)?.data?.interventions ?? {}) as Record<string, number>);

const observedOf = (
  graph: { nodes: Array<{ id: string; observed_state?: Record<string, unknown> }> },
  id: string,
): Record<string, unknown> => (graph.nodes.find((n) => n.id === id)?.observed_state ?? {});

const dataOf = (
  graph: { nodes: Array<{ id: string; data?: Record<string, unknown> }> },
  id: string,
): Record<string, unknown> => (graph.nodes.find((n) => n.id === id)?.data ?? {});

/**
 * Run the projected graph through the REAL analysis-seam scale projection —
 * the same functions `run-analysis.ts` calls — over the graph's own option
 * interventions. This is the consumer's verdict, not a re-implementation.
 */
function analysisSeamVerdict(graph: {
  nodes: Array<{ id: string; kind: string; label: string; data?: Record<string, unknown> }>;
}) {
  const optionIds = graph.nodes.filter((n) => n.kind === "option").map((n) => n.id);
  const perOption = optionIds.map((id) => interventionsOf(graph, id));
  const scaleMap = buildFactorScaleMap(graph.nodes);
  return projectRequestInterventionsToWireScale(perOption, scaleMap);
}

/**
 * THE GOLDEN-BRIEF CLASS — mirrors the witnessed failing draft (13 nodes:
 * cost factors in £ beside a [0,1] adoption factor, magnitudes on both
 * options). Raw magnitudes and structure taken from the live capture
 * `20260812T134625Z-fresh-323fcd-raw/step-T1_DRAFT.json`.
 */
const GOLDEN: DraftRecordSet = {
  stated_items: [
    { kind: "goal", source_quote: "higher sales productivity without blowing the budget" },
    { kind: "option", source_quote: "replace our current CRM with HubSpot next quarter" },
    { kind: "option", source_quote: "keep what we have" },
    // The user's own figure, stated verbatim — in the witnessed run the model
    // kept such figures in stated_items and connected its OWN factor claims
    // instead, so the stated figure is pruned (disclosed) and the claim
    // factors carry the magnitudes. The fixture keeps that shape.
    { kind: "figure", source_quote: "Annual CRM cost is about £50,000", value: 50000, unit: "£" },
  ],
  claims: [
    { claim_kind: "factor", label: "Annual CRM Licence Cost", value: 50000 },
    { claim_kind: "factor", label: "One-Off Migration Cost", value: 20000 },
    { claim_kind: "factor", label: "CRM Adoption and Usability", value: 0.5 },
    { claim_kind: "causal_link", label: "switching changes licence cost", from_stated: 1, to_claim: 0, effect: "negative", sets_to: 50000 },
    { claim_kind: "causal_link", label: "switching incurs migration cost", from_stated: 1, to_claim: 1, effect: "negative", sets_to: 20000 },
    { claim_kind: "causal_link", label: "switching moves adoption", from_stated: 1, to_claim: 2, effect: "positive", sets_to: 0.75 },
    { claim_kind: "causal_link", label: "staying holds licence cost", from_stated: 2, to_claim: 0, effect: "positive", sets_to: 35000 },
    { claim_kind: "causal_link", label: "staying avoids migration cost", from_stated: 2, to_claim: 1, effect: "positive", sets_to: 0 },
    { claim_kind: "causal_link", label: "staying holds adoption", from_stated: 2, to_claim: 2, effect: "negative", sets_to: 0.65 },
    { claim_kind: "causal_link", label: "licence cost bears on the goal", from_claim: 0, to_stated: 0, effect: "negative" },
    { claim_kind: "causal_link", label: "migration cost bears on the goal", from_claim: 1, to_stated: 0, effect: "negative" },
    { claim_kind: "causal_link", label: "adoption bears on the goal", from_claim: 2, to_stated: 0, effect: "positive" },
  ],
};

describe("the golden-brief class computes: one wire scale, ratios preserved, raw fidelity kept", () => {
  it("passes the analysis seam's own mixed-scale predicate (the exact guard that refused live)", () => {
    const { graph } = projectRecordsToGraph(GOLDEN);
    const verdict = analysisSeamVerdict(graph);
    // The witnessed refusal was mixedUnresolved === true naming the two cost
    // factors. The fix must make the DRAFT satisfy the guard truthfully.
    expect(verdict.mixedUnresolved).toBe(false);
    expect(verdict.unresolvedFactorIds).toEqual([]);
    expect(verdict.postconditionViolated).toBe(false);
    // The whole request lives on the unit interval, so PLoT's request-level
    // gate SKIPS and every value is read as the level it truthfully is.
    expect(verdict.allWithinUnitInterval).toBe(true);
  });

  it("projects each £ factor onto [0,1] by ONE per-factor frame — hand-computed constants", () => {
    const { graph } = projectRecordsToGraph(GOLDEN);
    const replace = idOf(graph, "replace our current CRM with HubSpot next quarter");
    const keep = idOf(graph, "keep what we have");
    const annual = idOf(graph, "Annual CRM Licence Cost");
    const migration = idOf(graph, "One-Off Migration Cost");
    const adoption = idOf(graph, "CRM Adoption and Usability");

    // Annual: magnitudes {50000 baseline, 50000, 35000} → frame 100000
    // (smallest {1,2,5}×10^k STRICTLY above 50000). Hand-computed, not derived
    // from the implementation.
    expect(interventionsOf(graph, replace)[annual]).toBe(0.5);
    expect(interventionsOf(graph, keep)[annual]).toBe(0.35);
    // Migration: {20000 baseline, 20000, 0} → frame 50000.
    expect(interventionsOf(graph, replace)[migration]).toBe(0.4);
    expect(interventionsOf(graph, keep)[migration]).toBe(0);
    // Adoption was ALREADY unit-interval: untouched, verbatim.
    expect(interventionsOf(graph, replace)[adoption]).toBe(0.75);
    expect(interventionsOf(graph, keep)[adoption]).toBe(0.65);
  });

  it("preserves within-factor ratios exactly (scale-correct, not merely present)", () => {
    const { graph } = projectRecordsToGraph(GOLDEN);
    const replace = idOf(graph, "replace our current CRM with HubSpot next quarter");
    const keep = idOf(graph, "keep what we have");
    const annual = idOf(graph, "Annual CRM Licence Cost");
    const a = interventionsOf(graph, replace)[annual]!;
    const b = interventionsOf(graph, keep)[annual]!;
    expect(a / b).toBeCloseTo(50000 / 35000, 12);
  });

  it("keeps the raw user magnitude on the factor baseline via raw_value (display truth)", () => {
    const { graph } = projectRecordsToGraph(GOLDEN);
    const annual = idOf(graph, "Annual CRM Licence Cost");
    const migration = idOf(graph, "One-Off Migration Cost");
    expect(observedOf(graph, annual)).toMatchObject({ value: 0.5, raw_value: 50000 });
    expect(dataOf(graph, annual)).toMatchObject({ value: 0.5, raw_value: 50000 });
    expect(observedOf(graph, migration)).toMatchObject({ value: 0.4, raw_value: 20000 });
    expect(dataOf(graph, migration)).toMatchObject({ value: 0.4, raw_value: 20000 });
  });

  it("stores NO cap anywhere — a cap would flip the edit handler to normalised writes and break INV-7", () => {
    const { graph } = projectRecordsToGraph(GOLDEN);
    for (const n of graph.nodes) {
      expect((n.data ?? {}) as Record<string, unknown>).not.toHaveProperty("cap");
      expect((n.observed_state ?? {}) as Record<string, unknown>).not.toHaveProperty("cap");
    }
  });

  it("is deterministic: two projections of the scale-bearing record set are byte-identical", () => {
    const a = projectionFingerprint(projectRecordsToGraph(GOLDEN));
    const b = projectionFingerprint(projectRecordsToGraph(GOLDEN));
    expect(a).toBe(b);
  });
});

describe("negative magnitudes stay raw and the guard's honest ask stays reachable (trap 13d)", () => {
  const NEGATIVE: DraftRecordSet = {
    stated_items: [
      { kind: "goal", source_quote: "protect cash" },
      { kind: "option", source_quote: "expand now" },
      { kind: "option", source_quote: "wait a year" },
    ],
    claims: [
      { claim_kind: "factor", label: "Net Cash Impact" },
      { claim_kind: "factor", label: "Adoption Likelihood", value: 0.5 },
      // A NEGATIVE magnitude beside a positive one on the SAME factor: no
      // unit-interval representation exists, so the factor must be left raw.
      { claim_kind: "causal_link", label: "expansion drains cash", from_stated: 1, to_claim: 0, effect: "negative", sets_to: -5000 },
      { claim_kind: "causal_link", label: "waiting builds cash", from_stated: 2, to_claim: 0, effect: "positive", sets_to: 20000 },
      { claim_kind: "causal_link", label: "expansion moves adoption", from_stated: 1, to_claim: 1, effect: "positive", sets_to: 0.8 },
      { claim_kind: "causal_link", label: "waiting holds adoption", from_stated: 2, to_claim: 1, effect: "negative", sets_to: 0.4 },
      { claim_kind: "causal_link", label: "cash bears on the goal", from_claim: 0, to_stated: 0, effect: "positive" },
      { claim_kind: "causal_link", label: "adoption bears on the goal", from_claim: 1, to_stated: 0, effect: "positive" },
    ],
  };

  it("leaves the negative-bearing factor's magnitudes verbatim", () => {
    const { graph } = projectRecordsToGraph(NEGATIVE);
    const expand = idOf(graph, "expand now");
    const wait = idOf(graph, "wait a year");
    const cash = idOf(graph, "Net Cash Impact");
    expect(interventionsOf(graph, expand)[cash]).toBe(-5000);
    expect(interventionsOf(graph, wait)[cash]).toBe(20000);
  });

  it("still trips the analysis seam's mixed-scale ask, naming the unframeable factor — the guard is NOT weakened", () => {
    const { graph } = projectRecordsToGraph(NEGATIVE);
    const cash = idOf(graph, "Net Cash Impact");
    const verdict = analysisSeamVerdict(graph);
    expect(verdict.mixedUnresolved).toBe(true);
    expect(verdict.unresolvedFactorIds).toContain(cash);
    // And ONLY the unframeable factor is named — the honest [0,1] sibling is not.
    expect(verdict.unresolvedFactorIds).toEqual([cash]);
  });
});

describe("percent-scaled stated figures use the scale a percentage declares (÷100), not a derived frame", () => {
  const PERCENT: DraftRecordSet = {
    stated_items: [
      { kind: "goal", source_quote: "keep net revenue retention healthy" },
      { kind: "option", source_quote: "invest in customer success" },
      { kind: "option", source_quote: "hold spend flat" },
      // Unit spelt as the corpus spells it: every percent unit in the 30
      // banked record sets STARTS with '%' ('%', '% NRR', '% YoY growth', …).
      { kind: "figure", source_quote: "NRR is currently 95%", value: 95, unit: "% NRR" },
    ],
    claims: [
      { claim_kind: "causal_link", label: "investment lifts NRR", from_stated: 1, to_stated: 3, effect: "positive", sets_to: 99 },
      { claim_kind: "causal_link", label: "flat spend erodes NRR", from_stated: 2, to_stated: 3, effect: "negative", sets_to: 91 },
      { claim_kind: "causal_link", label: "NRR bears on the goal", from_stated: 3, to_stated: 0, effect: "positive" },
    ],
  };

  it("divides by exactly 100 — 95% is level 0.95, not 0.95-of-some-derived-frame", () => {
    const { graph } = projectRecordsToGraph(PERCENT);
    const nrr = idOf(graph, "NRR is currently 95%");
    const invest = idOf(graph, "invest in customer success");
    const hold = idOf(graph, "hold spend flat");
    expect(observedOf(graph, nrr)).toMatchObject({ value: 0.95, raw_value: 95 });
    expect(interventionsOf(graph, invest)[nrr]).toBe(0.99);
    expect(interventionsOf(graph, hold)[nrr]).toBe(0.91);
  });

  it("passes the analysis seam predicate", () => {
    const { graph } = projectRecordsToGraph(PERCENT);
    const verdict = analysisSeamVerdict(graph);
    expect(verdict.mixedUnresolved).toBe(false);
    expect(verdict.allWithinUnitInterval).toBe(true);
  });

  it("a low percentage uses the declared scale: 3% is level 0.03, never 0.6-of-a-derived-5", () => {
    // THE DISCRIMINATOR the 95%-fixture above cannot provide (its derived frame
    // would ALSO be 100, so declared-vs-derived is invisible there — trap 13b).
    // Here the derived frame would be 5 ({1,2,5}·10^k strictly above 4.5),
    // reporting 3% as level 0.6 — discarding the scale the record declares.
    const { graph } = projectRecordsToGraph({
      stated_items: [
        { kind: "goal", source_quote: "keep churn under control" },
        { kind: "option", source_quote: "invest in onboarding" },
        { kind: "option", source_quote: "do nothing" },
        { kind: "figure", source_quote: "churn is 3%", value: 3, unit: "%" },
      ],
      claims: [
        { claim_kind: "causal_link", label: "onboarding cuts churn", from_stated: 1, to_stated: 3, effect: "negative", sets_to: 2 },
        { claim_kind: "causal_link", label: "doing nothing lets churn drift", from_stated: 2, to_stated: 3, effect: "positive", sets_to: 4.5 },
        { claim_kind: "causal_link", label: "churn bears on the goal", from_stated: 3, to_stated: 0, effect: "negative" },
      ],
    });
    const churn = idOf(graph, "churn is 3%");
    expect(observedOf(graph, churn)).toMatchObject({ value: 0.03, raw_value: 3 });
    const invest = idOf(graph, "invest in onboarding");
    const nothing = idOf(graph, "do nothing");
    expect(interventionsOf(graph, invest)[churn]).toBe(0.02);
    expect(interventionsOf(graph, nothing)[churn]).toBe(0.045);
  });

  it('spelt-out percent units use the declared scale too: "3 per cent" is 0.03, never 0.6 (review breadth finding)', () => {
    // From OUTSIDE this lane's corpus: the adversarial review's exact strings
    // (REVIEW-926.md Q3 — a British-English estate writes "per cent"). At the
    // pre-fix head these fell to the derived frame: 3 "per cent" → frame 5 →
    // 0.6, a silent 20× scale error, structurally the M5 class.
    const brief = (unit: string) =>
      projectRecordsToGraph({
        stated_items: [
          { kind: "goal", source_quote: "keep churn under control" },
          { kind: "option", source_quote: "invest" },
          { kind: "option", source_quote: "hold" },
          { kind: "figure", source_quote: "churn is 3", value: 3, unit },
        ],
        claims: [
          { claim_kind: "causal_link", label: "investing cuts churn", from_stated: 1, to_stated: 3, effect: "negative", sets_to: 2 },
          { claim_kind: "causal_link", label: "holding lets churn drift", from_stated: 2, to_stated: 3, effect: "positive", sets_to: 4.5 },
          { claim_kind: "causal_link", label: "churn bears on the goal", from_stated: 3, to_stated: 0, effect: "negative" },
        ],
      }).graph;
    for (const unit of ["per cent", "pct", "Per Cent"]) {
      const g = brief(unit);
      const churn = idOf(g, "churn is 3");
      expect(observedOf(g, churn), `unit "${unit}"`).toMatchObject({ value: 0.03, raw_value: 3 });
    }
  });

  it("basis points declare scale 10000, NOT 100 — treating bps as percent would be a 100× error the other way", () => {
    const { graph } = projectRecordsToGraph({
      stated_items: [
        { kind: "goal", source_quote: "hold the spread" },
        { kind: "option", source_quote: "hedge" },
        { kind: "option", source_quote: "ride it" },
        { kind: "figure", source_quote: "the spread is 30 bps", value: 30, unit: "bps" },
      ],
      claims: [
        { claim_kind: "causal_link", label: "hedging narrows the spread", from_stated: 1, to_stated: 3, effect: "negative", sets_to: 15 },
        { claim_kind: "causal_link", label: "riding widens the spread", from_stated: 2, to_stated: 3, effect: "positive", sets_to: 60 },
        { claim_kind: "causal_link", label: "the spread bears on the goal", from_stated: 3, to_stated: 0, effect: "negative" },
      ],
    });
    const spread = idOf(graph, "the spread is 30 bps");
    // 30 bps = 0.003 exactly (÷10000). A percent reading would say 0.3 (100×);
    // the derived frame would say 30/100 = 0.3 too (nextNice(60)=100). Both wrong.
    expect(observedOf(graph, spread)).toMatchObject({ value: 0.003, raw_value: 30 });
    const hedge = idOf(graph, "hedge");
    expect(interventionsOf(graph, hedge)[spread]).toBe(0.0015);
  });

  it("an astronomically large magnitude cannot mint an infinite frame — it stays raw (honest) rather than shipping level 0", () => {
    // Review breadth finding: ≥ ~1.6e308 → nextNiceNumberAbove overflows to
    // Infinity → level 0 shipped green. The honest posture is UNFRAMED.
    const { graph } = projectRecordsToGraph({
      stated_items: [
        { kind: "goal", source_quote: "cap the exposure" },
        { kind: "option", source_quote: "act" },
        { kind: "option", source_quote: "wait" },
      ],
      claims: [
        { claim_kind: "factor", label: "Absurd Exposure", value: 1.7e308 },
        { claim_kind: "causal_link", label: "acting moves exposure", from_stated: 1, to_claim: 0, effect: "negative", sets_to: 1.7e308 },
        { claim_kind: "causal_link", label: "waiting holds exposure", from_stated: 2, to_claim: 0, effect: "positive", sets_to: 0 },
        { claim_kind: "causal_link", label: "exposure bears on the goal", from_claim: 0, to_stated: 0, effect: "negative" },
      ],
    });
    const exposure = idOf(graph, "Absurd Exposure");
    // Unframed: the raw magnitude passes through verbatim (no fabricated 0).
    expect(observedOf(graph, exposure)).toMatchObject({ value: 1.7e308 });
    const act = idOf(graph, "act");
    expect(interventionsOf(graph, act)[exposure]).toBe(1.7e308);
  });

  it("a percentage above 100 cannot use the declared scale — it falls to the derived frame", () => {
    const { graph } = projectRecordsToGraph({
      stated_items: [
        { kind: "goal", source_quote: "grow fast" },
        { kind: "option", source_quote: "raise now" },
        { kind: "option", source_quote: "bootstrap" },
        { kind: "figure", source_quote: "growth is 150% YoY", value: 150, unit: "% YoY growth" },
      ],
      claims: [
        { claim_kind: "causal_link", label: "raising accelerates growth", from_stated: 1, to_stated: 3, effect: "positive", sets_to: 180 },
        { claim_kind: "causal_link", label: "bootstrapping slows growth", from_stated: 2, to_stated: 3, effect: "negative", sets_to: 110 },
        { claim_kind: "causal_link", label: "growth bears on the goal", from_stated: 3, to_stated: 0, effect: "positive" },
      ],
    });
    const growth = idOf(graph, "growth is 150% YoY");
    // max 180 → derived frame 200 ({1,2,5}×10^k strictly above 180).
    expect(observedOf(graph, growth)).toMatchObject({ value: 0.75, raw_value: 150 });
    const raise = idOf(graph, "raise now");
    expect(interventionsOf(graph, raise)[growth]).toBe(0.9);
  });
});

describe("frame edge cases", () => {
  it("a zero baseline joins the frame its interventions derive (0 stays 0, raw fidelity kept)", () => {
    const { graph } = projectRecordsToGraph({
      stated_items: [
        { kind: "goal", source_quote: "control migration spend" },
        { kind: "option", source_quote: "migrate" },
        { kind: "option", source_quote: "stay" },
      ],
      claims: [
        { claim_kind: "factor", label: "Migration Spend", value: 0 },
        { claim_kind: "causal_link", label: "migrating costs money", from_stated: 1, to_claim: 0, effect: "negative", sets_to: 20000 },
        { claim_kind: "causal_link", label: "staying costs nothing", from_stated: 2, to_claim: 0, effect: "positive", sets_to: 0 },
        { claim_kind: "causal_link", label: "spend bears on the goal", from_claim: 0, to_stated: 0, effect: "negative" },
      ],
    });
    const spend = idOf(graph, "Migration Spend");
    const migrate = idOf(graph, "migrate");
    const stay = idOf(graph, "stay");
    // {0, 20000, 0} → frame 50000.
    expect(observedOf(graph, spend)).toMatchObject({ value: 0, raw_value: 0 });
    expect(interventionsOf(graph, migrate)[spend]).toBe(0.4);
    expect(interventionsOf(graph, stay)[spend]).toBe(0);
    const verdict = analysisSeamVerdict(graph);
    expect(verdict.mixedUnresolved).toBe(false);
    expect(verdict.allWithinUnitInterval).toBe(true);
  });

  it("a sub-unit magnitude beside a raw one on the SAME factor shares the factor's frame (the record declares one unit)", () => {
    // The grammar's own contract: sets_to is "in the same unit the factor is
    // measured in". A £0.50 beside £50,000 is projected by the SAME frame —
    // the projector honours the record rather than second-guessing it.
    const { graph } = projectRecordsToGraph({
      stated_items: [
        { kind: "goal", source_quote: "price sustainably" },
        { kind: "option", source_quote: "penny pricing" },
        { kind: "option", source_quote: "enterprise pricing" },
      ],
      claims: [
        { claim_kind: "factor", label: "Unit Price" },
        { claim_kind: "causal_link", label: "penny pricing sets a low price", from_stated: 1, to_claim: 0, effect: "negative", sets_to: 0.5 },
        { claim_kind: "causal_link", label: "enterprise pricing sets a high price", from_stated: 2, to_claim: 0, effect: "positive", sets_to: 50000 },
        { claim_kind: "causal_link", label: "price bears on the goal", from_claim: 0, to_stated: 0, effect: "positive" },
      ],
    });
    const price = idOf(graph, "Unit Price");
    const penny = idOf(graph, "penny pricing");
    const enterprise = idOf(graph, "enterprise pricing");
    // {0.5, 50000} → frame 100000; ratio preserved exactly.
    expect(interventionsOf(graph, enterprise)[price]).toBe(0.5);
    expect(interventionsOf(graph, penny)[price]).toBe(0.5 / 100000);
    expect(analysisSeamVerdict(graph).mixedUnresolved).toBe(false);
  });

  it("a magnitude-scaled OBSERVABLE factor (baseline only, no interventions) is projected too", () => {
    const { graph } = projectRecordsToGraph({
      stated_items: [
        { kind: "goal", source_quote: "higher sales productivity" },
        { kind: "option", source_quote: "switch tools" },
        { kind: "option", source_quote: "keep tools" },
        { kind: "figure", source_quote: "We are a 34-person B2B sales team", value: 34, unit: "people" },
      ],
      claims: [
        { claim_kind: "factor", label: "Rep Output", value: 0.5 },
        { claim_kind: "causal_link", label: "switching lifts output", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 0.7 },
        { claim_kind: "causal_link", label: "keeping holds output", from_stated: 2, to_claim: 0, effect: "negative", sets_to: 0.5 },
        // NB: not into "Rep Output" — that factor is option-controlled, and the
        // projector's one-edge rule correctly rejects links into such factors.
        { claim_kind: "causal_link", label: "team size shapes the goal", from_stated: 3, to_stated: 0, effect: "positive" },
        { claim_kind: "causal_link", label: "output bears on the goal", from_claim: 0, to_stated: 0, effect: "positive" },
      ],
    });
    const team = idOf(graph, "We are a 34-person B2B sales team");
    // {34} → frame 50 → 0.68, raw kept.
    expect(observedOf(graph, team)).toMatchObject({ value: 0.68, raw_value: 34 });
  });

  it("provenance, labels and extractionType are untouched by the scale pass", () => {
    // The stated figure in GOLDEN is pruned (unconnected — witnessed shape), so
    // the extractionType pin uses a connected stated figure instead.
    const { graph: g2, provenance } = projectRecordsToGraph({
      stated_items: [
        { kind: "goal", source_quote: "higher sales productivity" },
        { kind: "option", source_quote: "switch" },
        { kind: "option", source_quote: "keep" },
        { kind: "figure", source_quote: "Annual CRM cost is about £50,000", value: 50000, unit: "£" },
      ],
      claims: [
        { claim_kind: "causal_link", label: "switch moves the cost", from_stated: 1, to_stated: 3, effect: "negative", sets_to: 30000 },
        { claim_kind: "causal_link", label: "keep holds the cost", from_stated: 2, to_stated: 3, effect: "positive", sets_to: 50000 },
        { claim_kind: "causal_link", label: "cost bears on the goal", from_stated: 3, to_stated: 0, effect: "negative" },
      ],
    });
    const cost = idOf(g2, "Annual CRM cost is about £50,000");
    const node = g2.nodes.find((n) => n.id === cost)!;
    // The user's verbatim quote remains the label; the stated badge remains;
    // the ONE honest extractionType claim survives the scale rewrite.
    expect(node.label).toBe("Annual CRM cost is about £50,000");
    expect(node.provenance?.provenance_class).toBe("stated");
    expect((node.data as Record<string, unknown>).extractionType).toBe("explicit");
    expect((node.data as Record<string, unknown>).unit).toBe("£");
    expect(observedOf(g2, cost)).toMatchObject({ value: 0.5, raw_value: 50000 });
    // provenance map untouched by the pass
    expect(provenance).toBeTruthy();
  });
});
