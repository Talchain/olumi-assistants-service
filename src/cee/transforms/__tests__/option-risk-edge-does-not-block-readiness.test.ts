/**
 * ⭐⭐⭐ AN OPTION→RISK EDGE IS A QUESTION, NOT A BLOCKER — AND TODAY IT BLOCKS
 * THE ONLY OPTIONS THE USER ACTUALLY NAMED.
 *
 * ── MEASURED ON A REAL SESSION (debug export `65fdde46`, 21 Sep 2026) ─────
 * Brief: *"Should I hire a Tech lead or two developers to increase
 * productivity?"* — about as simple as a brief gets. The result:
 *
 *   Hire One Senior Developer   Olumi's own suggestion   status "ready"
 *   Two Developers              the USER named it        needs_user_mapping
 *   Hire a Tech Lead            the USER named it        needs_user_mapping
 *
 * `may_run: false`, `permitted_analysis_mode: "none"` — the whole model is
 * unanalysable. All three options carry TWO valid factor interventions each,
 * so this is not a missing-magnitude defect.
 *
 * The single difference: both options the user named have an edge to
 * `Coordination Overhead Risk`. Olumi's own suggestion does not.
 * `analysis-ready.ts:691` demotes ANY option with an edge to a `risk` node,
 * unconditionally, and its `unresolved_targets` then blocks a second time
 * through `computeAnalysisReadyStatusWithReason`'s first line.
 *
 * ⚠ THE INCENTIVE IS BACKWARDS, AND THAT IS WHY THIS IS NOT BRIEF-SPECIFIC.
 * The better the model reasons about what could go wrong with an option, the
 * more certainly that option is blocked. Olumi's suggestion was ready because
 * it was modelled more shallowly. Any brief, any labels, any units.
 *
 * ── WHAT IS PRESERVED, AND WHY THE ORIGINAL RULING STILL STANDS ───────────
 * The ruling this softens is right as far as it goes: *"A causal coefficient
 * is not an intervention level; other numeric effects cannot resolve this
 * missing mapping."* True — and untouched. The edge stays unresolved, stays
 * recorded in `unresolved_targets`, and still raises its `user_questions`
 * entry. What changes is only whether that unresolved EDGE condemns the whole
 * OPTION when the option has usable interventions of its own.
 *
 * An option whose ONLY effect is the risk edge still has no interventions and
 * is still `needs_user_mapping` by the ordinary path — pinned below, because a
 * widening that also granted readiness to a numberless option would be the
 * defect in the opposite direction (trap 22b).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  calculateCost: vi.fn(() => 0),
  TelemetryEvents: {},
}));

const { buildAnalysisReadyPayload } = await import("../analysis-ready.js");
type GraphV3T = import("../../../schemas/cee-v3.js").GraphV3T;
type OptionV3T = import("../../../schemas/cee-v3.js").OptionV3T;

/** The session's own node ids and labels. */
const GOAL = "0dde265b";
const RISK = "0b1c1aa5";
const COST = "5fa16524";
const CAPABILITY = "8b8722a8";

function graph(): GraphV3T {
  return {
    nodes: [
      { id: GOAL, kind: "goal", label: "Increase Productivity" },
      { id: RISK, kind: "risk", label: "Coordination Overhead Risk" },
      { id: COST, kind: "factor", label: "Hiring & Salary Cost", category: "controllable",
        observed_state: { value: 0.4, unit: "£", raw_value: 80000 } },
      { id: CAPABILITY, kind: "factor", label: "Team Technical Capability", category: "controllable",
        observed_state: { value: 0.4, unit: "%", raw_value: 40 } },
      { id: "olumis", kind: "option", label: "Hire One Senior Developer" },
      { id: "users", kind: "option", label: "Hire a Tech Lead" },
      { id: "bare", kind: "option", label: "Something With Only A Risk" },
    ],
    edges: [
      { id: "e1", from: "olumis", to: COST, effect_direction: "positive", strength_mean: 1 },
      { id: "e2", from: "olumis", to: CAPABILITY, effect_direction: "positive", strength_mean: 1 },
      // The user's option: the same two interventions PLUS a risk edge.
      { id: "e3", from: "users", to: COST, effect_direction: "positive", strength_mean: 1 },
      { id: "e4", from: "users", to: CAPABILITY, effect_direction: "positive", strength_mean: 1 },
      { id: "e5", from: "users", to: RISK, effect_direction: "positive", strength_mean: 0.2 },
      { id: "e6", from: "bare", to: RISK, effect_direction: "positive", strength_mean: 0.2 },
      { id: "e7", from: COST, to: GOAL, effect_direction: "negative", strength_mean: 0.3 },
      { id: "e8", from: CAPABILITY, to: GOAL, effect_direction: "positive", strength_mean: 0.7 },
      { id: "e9", from: RISK, to: GOAL, effect_direction: "negative", strength_mean: 0.45 },
    ],
  } as unknown as GraphV3T;
}

/** The session's own intervention shape, not a bare number. */
function iv(nodeId: string, value: number, raw: number, unit: string) {
  return {
    value, raw_value: raw, unit, source: "cee_hypothesis",
    target_match: { node_id: nodeId, match_type: "exact_id", confidence: "high" },
    value_confidence: "low", reasoning: "Olumi estimate",
  };
}

function options(): OptionV3T[] {
  return [
    { id: "olumis", label: "Hire One Senior Developer", status: "ready",
      interventions: { [COST]: iv(COST, 0.475, 95000, "\u00a3"),
                       [CAPABILITY]: iv(CAPABILITY, 0.65, 65, "%") } },
    { id: "users", label: "Hire a Tech Lead", status: "ready",
      interventions: { [COST]: iv(COST, 0.45, 90000, "\u00a3"),
                       [CAPABILITY]: iv(CAPABILITY, 0.85, 85, "%") } },
    { id: "bare", label: "Something With Only A Risk", status: "needs_user_mapping",
      interventions: {} },
  ] as unknown as OptionV3T[];
}

function build() {
  const payload = buildAnalysisReadyPayload(options(), GOAL, graph());
  const by = (id: string) => (payload.options ?? []).find((o) => o.id === id)!;
  return { payload, by };
}

describe("a risk edge asks a question; it does not condemn the option", () => {
  it("keeps an option ready when it has usable interventions of its own", () => {
    expect(build().by("users").status).toBe("ready");
  });

  it("leaves an option with no risk edge exactly as it was", () => {
    expect(build().by("olumis").status).toBe("ready");
  });

  it("does not let the whole model become unanalysable over it", () => {
    const { payload } = build();
    const blocked = (payload.options ?? []).filter((o) => o.status !== "ready");
    expect(blocked.map((o) => o.id)).toEqual(["bare"]);
  });

  // ── twins: the ruling this softens must still hold ──────────────────────
  it("still refuses an option whose ONLY effect is the risk edge", () => {
    expect(build().by("bare").status).toBe("needs_user_mapping");
  });

  /**
   * ⚠ THE DISCLOSURE CARRIER DOES NOT EXIST ON THE WIRE, and that is recorded
   * rather than asserted away. `transformOptionToAnalysisReady` builds each
   * payload option field-by-field and copies neither `unresolved_targets` nor
   * `user_questions`; the session's own export carries neither. So the risk
   * edge is today a SILENT blocker — the user is told only "Choose which factor
   * X changes and by how much", which is false of an option that already
   * changes two. Surfacing it is a separate, additive change with its own
   * consumers; this suite pins that nothing is silently GRANTED instead.
   */
  it("does not turn the risk into an intervention", () => {
    const users = build().by("users");
    expect(Object.keys(users.interventions ?? {}).sort()).toEqual([COST, CAPABILITY].sort());
  });

  it("does not change what any option claims to move", () => {
    const { by } = build();
    for (const id of ["olumis", "users"]) {
      expect(Object.keys(by(id).interventions ?? {}).sort()).toEqual([COST, CAPABILITY].sort());
    }
  });

});
