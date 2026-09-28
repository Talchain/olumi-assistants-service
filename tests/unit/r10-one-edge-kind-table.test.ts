/**
 * R10, CEE half: ONE edge-kind grammar (DL #72 5872437724 §3 GO; AI Quality meaning ruling 5872082179).
 *
 * outcome→outcome (mediation), outcome→risk and risk→outcome (a risk's impact) are LEGAL causal links. PLoT now
 * forwards them as drawn (PLoT #397, served 6762221, AIQ wire witness 5873121157). CEE held the old grammar in several
 * hand-kept copies:
 *   · `validators/graph-validator.types.ts` ALLOWED_EDGES: the typed table, which the draft-records pipeline reads;
 *   · `cee/validation/v3-validator.ts`: a local closed-world list that errors "not allowed";
 *   · `services/repair.ts`: Stage-3 `simpleRepair` DELETES any pair outside its own list, so a drafted mediation link
 *     was lost before the user ever saw it;
 *   · `cee/validation/classifier.ts`: the INVALID_EDGE_TYPE suggestion;
 *   · the legacy drafter's prompt `<EDGE_TABLE>` / `<FORBIDDEN_EDGES>` (`prompts/defaults.ts`).
 *
 * The rule pinned here: the typed table admits the three legal links, and every other copy is DERIVED from it
 * (a parity lock, so a later edit to one copy fails here). Illegal pairs are still refused (contrast rows).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALLOWED_EDGES } from "../../src/validators/graph-validator.types.js";
import { ALLOWED_EDGE_PATTERNS as REPAIR_PATTERNS, simpleRepair } from "../../src/services/repair.js";
import { validateV3Response } from "../../src/cee/validation/v3-validator.js";
import { getSuggestionForCode } from "../../src/cee/validation/classifier.js";
import { fixRemainingForbiddenEdges } from "../../src/cee/unified-pipeline/stages/repair/deterministic-sweep.js";
import type { GraphT } from "../../src/schemas/graph.js";

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  calculateCost: vi.fn(),
  TelemetryEvents: {},
}));

const LEGAL_LINKS: Array<[string, string]> = [["outcome", "outcome"], ["outcome", "risk"], ["risk", "outcome"]];
const key = (from: string, to: string) => `${from}→${to}`;
const tablePairs = () => new Set(ALLOWED_EDGES.map((r) => key(r.fromKind, r.toKind)));

describe("R10 — one edge-kind table in CEE", () => {
  it("the typed table admits outcome→outcome, outcome→risk and risk→outcome", () => {
    for (const [from, to] of LEGAL_LINKS) expect(tablePairs().has(key(from, to)), key(from, to)).toBe(true);
  });

  it("PARITY LOCK: repair.ts's patterns are exactly the typed table's kind pairs", () => {
    expect(new Set(REPAIR_PATTERNS.map((p) => key(p.from, p.to)))).toEqual(tablePairs());
  });

  it("CONTRAST: an illegal pair (decision→goal, goal→outcome) is still outside the table", () => {
    expect(tablePairs().has(key("decision", "goal"))).toBe(false);
    expect(tablePairs().has(key("goal", "outcome"))).toBe(false);
  });

  it("the INVALID_EDGE_TYPE suggestion names the legal links (derived from the table)", () => {
    const s = getSuggestionForCode("INVALID_EDGE_TYPE") ?? "";
    for (const [from, to] of LEGAL_LINKS) expect(s).toContain(key(from, to));
  });
});

// ---------------------------------------------------------------------------
// v3-validator: a drawn mediation link is not a closed-world violation.
// ---------------------------------------------------------------------------
function v3With(extraEdges: Array<{ from: string; to: string; mean: number }>) {
  const edge = (from: string, to: string, mean: number) => ({ from, to, strength: { mean, std: 0.15 }, exists_probability: 0.9, effect_direction: mean < 0 ? "negative" : "positive" });
  return {
    schema_version: "3.0",
    goal_node_id: "goal_1",
    nodes: [
      { id: "goal_1", kind: "goal", label: "Goal" },
      { id: "decision_1", kind: "decision", label: "Decision" },
      { id: "option_1", kind: "option", label: "Option A" },
      { id: "factor_a", kind: "factor", label: "Factor A" },
      { id: "outcome_1", kind: "outcome", label: "Outcome 1" },
      { id: "outcome_2", kind: "outcome", label: "Outcome 2" },
      { id: "risk_1", kind: "risk", label: "Risk 1" },
    ],
    edges: [
      { from: "decision_1", to: "option_1", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: "positive" },
      { from: "option_1", to: "factor_a", strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: "positive" },
      edge("factor_a", "outcome_1", 0.6),
      edge("outcome_2", "goal_1", 0.8),
      edge("risk_1", "goal_1", -0.5),
      ...extraEdges.map((e) => edge(e.from, e.to, e.mean)),
    ],
    options: [{ id: "option_1", label: "Option A", status: "ready", interventions: {} }],
  };
}
const edgeTypeErrors = (response: unknown) => {
  const r = validateV3Response(response) as unknown as Record<string, Array<{ code: string }> | undefined>;
  const all = [...new Set([...(r.errors ?? []), ...(r.warnings ?? []), ...(r.warningsOnly ?? []), ...(r.info ?? [])])];
  // PRECONDITION: the fixture passed schema validation, so the edge check actually ran.
  expect(all.filter((w) => w.code === "SCHEMA_VALIDATION_ERROR")).toEqual([]);
  return all.filter((w) => w.code === "INVALID_EDGE_TYPE");
};

describe("R10 — v3-validator reads the same table", () => {
  it("outcome→outcome, outcome→risk and risk→outcome raise no INVALID_EDGE_TYPE", () => {
    const r = v3With([
      { from: "outcome_1", to: "outcome_2", mean: 0.5 },
      { from: "outcome_1", to: "risk_1", mean: 0.4 },
      { from: "risk_1", to: "outcome_2", mean: -0.5 },
    ]);
    expect(edgeTypeErrors(r)).toEqual([]);
  });

  it("CONTRAST: decision→goal is still an INVALID_EDGE_TYPE error", () => {
    const errors = edgeTypeErrors(v3With([{ from: "decision_1", to: "goal_1", mean: 0.5 }]));
    expect(errors.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// simpleRepair (Stage 3 of the draft pipeline) keeps a drafted mediation link.
// ---------------------------------------------------------------------------
function graphWith(edges: Array<{ from: string; to: string; mean: number }>): GraphT {
  return {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: "dec_1", kind: "decision", label: "Decision" },
      { id: "opt_a", kind: "option", label: "Option A" },
      { id: "fac_a", kind: "factor", label: "Factor A" },
      { id: "out_1", kind: "outcome", label: "Outcome 1" },
      { id: "out_2", kind: "outcome", label: "Outcome 2" },
      { id: "risk_1", kind: "risk", label: "Risk 1" },
      { id: "goal_1", kind: "goal", label: "Goal" },
    ],
    edges: edges.map((e, i) => ({ id: `e${i}`, from: e.from, to: e.to, strength_mean: e.mean, strength_std: 0.15, belief_exists: 0.9, effect_direction: e.mean < 0 ? "negative" : "positive" })),
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" as const },
  } as unknown as GraphT;
}
const has = (g: GraphT, from: string, to: string) => g.edges.some((e) => e.from === from && e.to === to);

describe("R10 — simpleRepair keeps a drafted mediation link (drafting fidelity)", () => {
  const drawn = [
    { from: "dec_1", to: "opt_a", mean: 1 },
    { from: "opt_a", to: "fac_a", mean: 1 },
    { from: "fac_a", to: "out_1", mean: 0.6 },
    { from: "out_1", to: "out_2", mean: 0.5 },
    { from: "out_1", to: "risk_1", mean: 0.4 },
    { from: "risk_1", to: "out_2", mean: -0.5 },
    { from: "out_2", to: "goal_1", mean: 0.8 },
  ];

  it("outcome→outcome, outcome→risk and risk→outcome survive", () => {
    const out = simpleRepair(graphWith(drawn), "r10-test");
    expect(has(out, "out_1", "out_2")).toBe(true);
    expect(has(out, "out_1", "risk_1")).toBe(true);
    expect(has(out, "risk_1", "out_2")).toBe(true);
  });

  it("CONTRAST: an illegal decision→goal link is still removed", () => {
    const out = simpleRepair(graphWith([...drawn, { from: "dec_1", to: "goal_1", mean: 0.5 }]), "r10-test");
    expect(has(out, "dec_1", "goal_1")).toBe(false);
  });
});

describe("R10 — the Stage-4 sweep's forbidden-edge remover agrees with the table", () => {
  it("keeps a drafted outcome→outcome link; still removes risk→risk (contrast)", () => {
    const g = graphWith([
      { from: "dec_1", to: "opt_a", mean: 1 },
      { from: "opt_a", to: "fac_a", mean: 1 },
      { from: "fac_a", to: "out_1", mean: 0.6 },
      { from: "out_1", to: "out_2", mean: 0.5 },
      { from: "out_2", to: "goal_1", mean: 0.8 },
      { from: "fac_a", to: "risk_1", mean: 0.4 },
      { from: "risk_1", to: "goal_1", mean: -0.5 },
    ]);
    (g.nodes as Array<{ id: string; kind: string; label: string }>).push({ id: "risk_2", kind: "risk", label: "Risk 2" });
    (g.edges as unknown[]).push({ id: "e_rr", from: "risk_1", to: "risk_2", strength_mean: 0.3, strength_std: 0.15, belief_exists: 0.9, effect_direction: "positive" });
    fixRemainingForbiddenEdges(g, "r10-test");
    expect(has(g, "out_1", "out_2")).toBe(true);
    expect(has(g, "risk_1", "risk_2")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The legacy drafter's prompt says the same grammar.
// ---------------------------------------------------------------------------
describe("R10 — the legacy drafter's prompt agrees with the table", () => {
  const text = readFileSync(resolve(__dirname, "../../src/prompts/defaults.ts"), "utf8");
  const section = (tag: string) => {
    const start = text.indexOf(`<${tag}>`);
    const end = text.indexOf(`</${tag}>`, start);
    expect(start, `<${tag}> present`).toBeGreaterThan(-1);
    return text.slice(start, end);
  };

  it("<FORBIDDEN_EDGES> no longer forbids the three legal links", () => {
    const forbidden = section("FORBIDDEN_EDGES");
    expect(forbidden).not.toMatch(/outcome → outcome/);
    expect(forbidden).not.toMatch(/outcome → risk/);
    expect(forbidden).not.toMatch(/risk → outcome/);
    expect(forbidden, "control: a genuinely forbidden pair is still listed").toMatch(/decision → goal/);
  });

  it("<EDGE_TABLE> lists them", () => {
    const table = section("EDGE_TABLE");
    for (const [from, to] of LEGAL_LINKS) expect(table).toMatch(new RegExp(`\\|\\s*${from}\\s*\\|\\s*${to}\\s*\\|`));
  });
});
