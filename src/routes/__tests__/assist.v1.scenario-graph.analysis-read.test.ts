/**
 * ROADMAP 2.1271 — THE ADDITIVE ANALYSIS PAYLOAD ON THE SCENARIO-GRAPH READ.
 *
 * The auto-run after a fresh draft (#999) commits a `run_analysis` fact ~20s
 * after the draft SSE stream's terminal frame has closed the socket. No CEE
 * route returned a scenario's analysis except a turn, so the user could only
 * see their own provisional result by sending another message. This suite pins
 * the read that ends that.
 *
 * ── WHAT IS PINNED, AND WHY EACH ONE IS LOAD-BEARING ───────────────────────
 *
 *  1. ADDITIVE BY CONSTRUCTION, PROVEN AGAINST A BASE CAPTURE — NOT A FIXTURE
 *     THIS LANE WROTE. `__fixtures__/scenario-graph-base-capture.json` was
 *     produced by THIS FILE running in a pristine worktree at the PR base
 *     (`e58a31c1`) under `LANE_CAPTURE_BASE=1`, with byte-identical store
 *     doubles because it is the same file. Every pre-existing key must be
 *     deep-equal, and the new key set must be EXACTLY the declared ones. A
 *     lane-authored expectation could not have caught a reordered or
 *     re-derived pre-existing value; a capture can.
 *
 *  2. RESULTS ONLY ON A `fresh` VERDICT. Derived from the producer's own
 *     lifecycle tree (`orchestrator-v5/compose.ts:380-392`), not chosen here:
 *     rule 2b emits the rerun coaching and NO result on `stale`. A `stale`
 *     fact's numbers describe a graph the user has since changed, so shipping
 *     them would present a result about a different model. Both arms asserted,
 *     so an implementation that ships the block unconditionally REDs the stale
 *     arm and one that never ships it REDs the fresh arm.
 *
 *  3. A FAILED STORE READ IS NOT "NEVER ANALYSED". `never_run`'s contract text
 *     licenses a consumer to render the pre-analysis affordance. Emitting it
 *     when the fact store was unreadable would be a positive claim about the
 *     scenario's whole history that a failed read cannot support — and on the
 *     auto-run path it would end the client's wait with the wrong answer.
 *     Pinned as `unknown_degraded` / `store_unreadable`, with the genuinely
 *     empty scenario as its discriminating twin.
 *
 *  4. THE VERDICT AND THE BLOCK AGREE ABOUT THE LEADER (trap 21). Both are
 *     derived from the SAME fact's persisted claim-safety verdict. A withheld
 *     fact must yield `leading_option_id: null` on the block AND
 *     `leader_claim.permitted: false` on the verdict — never one of each, which
 *     is the shape of the harm this estate has already shipped once.
 *
 *  5. AN ANALYSIS FAULT NEVER COSTS THE USER THEIR MODEL. A store whose fact
 *     read THROWS must still return the graph, with both new keys null.
 */

import { maximalCoachingBlock, maximalReviewCardBlock } from '@talchain/schemas/fixtures';
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SCENARIO = "a6ccf5cf-aab0-4f01-b889-e0d6c072067c";

// `vi.hoisted` + a SPREAD of the real config: a `vi.mock` factory REPLACES the
// module, so a hand-listed stub silently drops every config key added since it
// was written (CLAUDE.md trap 12). Same shape as the sibling suites.
const { mockConfig } = vi.hoisted(() => ({ mockConfig: { value: null as unknown } }));
vi.mock("../../config/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/index.js")>();
  mockConfig.value = {
    ...actual.config,
    auth: { ...actual.config.auth, requireUserJwt: false },
  };
  return { ...actual, config: mockConfig.value };
});

vi.mock("../../utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const scenarioExists = vi.fn();
const loadGraphAndBriefText = vi.fn();
const ensureScenarioExists = vi.fn();
const getScenarioOwner = vi.fn();
const readRecent = vi.fn();
const readFactsFor = vi.fn();
const store = {
  readMostRecentPendingActions: async () => [],
  scenarioExists,
  loadGraphAndBriefText,
  ensureScenarioExists,
  getScenarioOwner,
  readRecent,
  readFactsFor,
};
vi.mock("../../orchestrator-v5/session/index.js", () => ({ getSessionStore: () => store }));
beforeEach(() => {
  delete (store as Record<string, unknown>).readScenarioRunAnalysisFactsFor;
});

import scenarioGraphRoute from "../assist.v1.scenario-graph.js";
import { computeAnalysisAffectingGraphHash } from "../../orchestrator-v5/context/graph-hash.js";
import { buildCanonicalAnalysisReadyFromGraph } from "../../orchestrator/tools/analysis-ready-helper.js";
import { issuesAsWireBlockers } from "../../orchestrator-v5/compose/analysis-state-v1.js";
import { RunAnalysisResultSchema } from "@talchain/schemas/orchestrator";
import { readStoredGoalCertainty } from "../../orchestrator-v5/tools/handlers/run-goal-certainty.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────

const BRIEF = "Should we hire a marketing manager or hold headcount this year?";

const GRAPH = {
  nodes: [
    { id: "goal_growth", kind: "goal", label: "Revenue growth" },
    { id: "decision", kind: "decision", label: "Headcount" },
    {
      id: "fac_market",
      kind: "factor",
      label: "Market demand",
      category: "controllable",
      observed_state: { value: 0.5, cap: 1 },
    },
    { id: "opt_hire", kind: "option", label: "Hire a marketing manager", interventions: { fac_market: 0.4 } },
    { id: "opt_hold", kind: "option", label: "Hold headcount", interventions: { fac_market: 0.1 } },
  ],
  edges: [],
  options: [],
};

/** Derived with the production function, so `fresh` is DERIVED, never asserted. */
const GRAPH_HASH = computeAnalysisAffectingGraphHash(GRAPH as never)!;
const PRE_EDIT_GRAPH_HASH = computeAnalysisAffectingGraphHash({
  ...GRAPH,
  nodes: GRAPH.nodes.map((node) => node.id === "fac_market"
    ? { ...node, observed_state: { value: 0.3, cap: 1 } }
    : node),
})!;
/**
 * P0 SHARED DATA (#85 5963281356): the SAME model, made one the product can RUN (decision → options → factor → goal, a
 * target). The ONE leader licence reads the admission; `GRAPH` above has no links, so the admission refuses it
 * (`structurally_analysable: false`, matrix M5) and no leader may be named from it. This one is admitted
 * (`quantified_provisional`, matrix M2: a separated leader ships with its caveat).
 */
const linkOf = (from: string, to: string, mean = 1) => ({ from, to, strength: { mean, std: 0.1 }, exists_probability: 1, effect_direction: "positive" as const });
const ADMITTED_GRAPH = {
  ...GRAPH,
  goal_node_id: "goal_growth",
  nodes: GRAPH.nodes.map((node) => node.id === "goal_growth" ? { ...node, goal_threshold: 0.8 } : node),
  edges: [linkOf("decision", "opt_hire"), linkOf("decision", "opt_hold"), linkOf("opt_hire", "fac_market"), linkOf("opt_hold", "fac_market", 0.01), linkOf("fac_market", "goal_growth")],
};
const ADMITTED_GRAPH_HASH = computeAnalysisAffectingGraphHash(ADMITTED_GRAPH as never)!;
const FIGURE_GRAPH = {
  ...GRAPH,
  goal_node_id: "goal_growth",
  nodes: GRAPH.nodes.map((node) => node.id === "goal_growth"
    ? { ...node, goal_threshold_frame: "level", goal_threshold_unit: "£/month",
      observed_state: { unit: "£/month" } }
    : node),
};
const FIGURE_GRAPH_HASH = computeAnalysisAffectingGraphHash(FIGURE_GRAPH as never)!;
const PRE_EDIT_FIGURE_GRAPH_HASH = computeAnalysisAffectingGraphHash({
  ...FIGURE_GRAPH,
  nodes: FIGURE_GRAPH.nodes.map((node) => node.id === "fac_market"
    ? { ...node, observed_state: { value: 0.3, cap: 1 } }
    : node),
} as never)!;

/**
 * A committed provisional run. `mayName` drives the PERSISTED claim-safety
 * verdict — the same field `mayNameLeadingOptionForFact` reads fail-closed.
 */
function runAnalysisFact(opts: {
  readonly graphHash: string;
  readonly mayName: boolean;
}): Record<string, unknown> {
  return {
    fact_type: "run_analysis",
    fact_version: 1,
    noop: false,
    turn_id: "turn_autorun",
    result: {
      scenario_id: SCENARIO,
      leading_option_id: "opt_hire",
      summary: "Hiring a marketing manager leads on the current model.",
      graph_hash_at_run: opts.graphHash,
      computed_at: "2026-08-17T09:15:50.000Z",
      win_probabilities: { opt_hire: 0.68, opt_hold: 0.32 },
      constraint_verdict: {
        may_name_leading_option: opts.mayName,
        constraint_verdict_state: opts.mayName ? "evaluated_feasible" : "unevaluated",
      },
      enrichment: {
        analysis_status: "ok",
        robustness: { level: "moderate", near_tie: false },
        option_comparison: [
          { option_id: "opt_hire", option_label: "Hire a marketing manager", win_probability: 0.68, outcome_mean: 0.55 },
          { option_id: "opt_hold", option_label: "Hold headcount", win_probability: 0.32, outcome_mean: 0.41 },
        ],
      },
    },
  };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await scenarioGraphRoute(app);
  await app.ready();
  return app;
}

async function read(app: FastifyInstance) {
  return await app.inject({
    method: "POST",
    url: `/assist/v1/scenarios/${SCENARIO}/graph`,
    payload: {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  scenarioExists.mockResolvedValue(true);
  ensureScenarioExists.mockResolvedValue({ user_id: null });
  getScenarioOwner.mockResolvedValue(null);
  loadGraphAndBriefText.mockResolvedValue({ graph: GRAPH, briefText: BRIEF });
  readRecent.mockResolvedValue([{ id: "row_1" }]);
  readFactsFor.mockResolvedValue([]);
});

// ─── 1. Additive by construction, against the BASE capture ────────────────

const BASE_CAPTURE_PATH = join(
  process.cwd(),
  "src/routes/__tests__/__fixtures__/scenario-graph-base-capture.json",
);

/**
 * The complete set of keys added SINCE THE BASE CAPTURE. Anything else is a
 * regression.
 *
 * ⚠ THE NAME OUTLIVED ITS FIRST CHANGE, so the comment is corrected rather than
 * the guard weakened: this was "the keys 2.1271 adds", and the fixture it
 * compares against is a single frozen base, so every later additive field lands
 * here too. The assertion stays EXACT in both directions — a key that appears
 * without being declared here still fails, which is the property worth keeping.
 *
 * `graph_hash` (2026-09-09) is the write precondition for the graph this
 * response carries. A manual edit is a compare-and-set and its base used to
 * reach a client only on a turn response, so a reload had none and every first
 * edit was refused; it is derived beside `graph_identity_hash` from the same
 * bytes, and is NOT that hash — different projection, different question.
 *
 * `analysis_identity_run_use` (2026-09-28, CEE #2248, R3-9) is what the last successful Run did with each declared
 * identity — the link writer's own input (`identityRunUseFromFacts`), carried so the Agent's door cannot disagree with
 * the writer. It rides every answered read, `null` when no Run succeeded, so the base fixture's no-fact read shows it.
 */
const NEW_KEYS = ["analysis_state", "analysis_result", "current_read", "graph_hash", "analysis_admission", "analysis_identity_run_use", "canonical_analysis_view"] as const;

/**
 * Additions made INSIDE a pre-existing key since the base capture — declared
 * the same way `NEW_KEYS` declares top-level ones, and for the same reason.
 *
 * ⚠ WHY THIS EXISTS RATHER THAN A REGENERATED FIXTURE. The pin below asks two
 * questions through one deep comparison: "was anything pre-existing REWRITTEN?"
 * and "did anything undeclared APPEAR?". A field ADDED inside a pre-existing
 * subtree rewrites nothing, but `toEqual` cannot tell the two apart, so a
 * change that is additive by exactly the standard this pin enforces reads as a
 * violation of it. The fixture is a frozen record of the 2.1271 base and
 * regenerating it here would make it a post-change capture masquerading as a
 * control — the vacuity the block at the top of this test already guards
 * against. So the addition is DECLARED instead, and stays as exact in both
 * directions as `NEW_KEYS` is: each path below must be ABSENT from the base and
 * PRESENT in the body, or this fails.
 *
 * `not_modelled.quantities.in_model_{anchored,unanchored}` split the `in_model`
 * verdict by the route that reached it — a named modelled quantity carrying the
 * figure as a VALUE, versus the literal merely occurring in some model string.
 * Measured on the committed cold-read captures, 11 of 18 `in_model` verdicts
 * name no node, so the two were not distinguishable on the wire at all.
 */
const NEW_NESTED_KEYS: readonly (readonly string[])[] = [
  ["not_modelled", "quantities", "in_model_anchored"],
  ["not_modelled", "quantities", "in_model_unanchored"],
];

/** Walk a declared path to its parent, asserting every hop exists. */
function parentOf(
  root: Record<string, unknown>,
  path: readonly string[],
  what: string,
): Record<string, unknown> | undefined {
  let cursor: unknown = root;
  for (const segment of path.slice(0, -1)) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  expect(
    cursor === null || typeof cursor !== "object",
    `${what}: ${path.join(".")} has no object parent`,
  ).toBe(false);
  return cursor as Record<string, unknown>;
}

describe("2.1271 — additive by construction (pin 1)", () => {
  it("adds EXACTLY the declared keys and rewrites no pre-existing value", async () => {
    const app = await buildApp();
    const res = await read(app);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;

    // CAPTURE MODE — run in a pristine worktree at the PR base to regenerate
    // the fixture. Never enabled in CI; the assertion below is the product.
    if (process.env.LANE_CAPTURE_BASE === "1") {
      mkdirSync(dirname(BASE_CAPTURE_PATH), { recursive: true });
      writeFileSync(BASE_CAPTURE_PATH, `${JSON.stringify(body, null, 2)}\n`);
      return;
    }

    const base = JSON.parse(readFileSync(BASE_CAPTURE_PATH, "utf8")) as Record<string, unknown>;
    // The capture must itself be a BASE capture — if it already carried the new
    // keys it would be a post-change fixture masquerading as a control, and the
    // whole pin would be vacuous.
    for (const key of NEW_KEYS) {
      expect(base, `base capture must predate ${key}`).not.toHaveProperty(key);
    }
    expect(Object.keys(base).length).toBeGreaterThan(5);

    // Every pre-existing key, byte-identical — except the one that is a
    // per-request value by definition, named explicitly rather than skipped
    // silently, and asserted on its own terms below.
    const PER_REQUEST_KEYS = new Set(["request_id"]);

    // Lift the DECLARED nested additions out before comparing — having first
    // proved each one is absent from the base and present in the body. A stale
    // declaration therefore REDs rather than silently excusing nothing, and a
    // rewrite ANYWHERE ELSE in the same subtree still REDs, because only the
    // declared leaf is removed.
    const compared = structuredClone(body) as Record<string, unknown>;
    for (const path of NEW_NESTED_KEYS) {
      const leaf = path[path.length - 1];
      const baseParent = parentOf(base, path, "base capture");
      expect(
        baseParent,
        `base capture must predate ${path.join(".")}`,
      ).not.toHaveProperty(leaf);
      const bodyParent = parentOf(compared, path, "response");
      expect(
        bodyParent,
        `declared nested addition ${path.join(".")} must actually be emitted`,
      ).toHaveProperty(leaf);
      delete (bodyParent as Record<string, unknown>)[leaf];
    }

    for (const [key, value] of Object.entries(base)) {
      if (PER_REQUEST_KEYS.has(key)) continue;
      expect(compared[key], `pre-existing key ${key} must be unchanged`).toEqual(value);
    }
    expect(typeof body.request_id, "request_id must still be a non-empty string").toBe("string");
    expect((body.request_id as string).length).toBeGreaterThan(0);
    // And exactly the declared additions — nothing else appeared.
    const added = Object.keys(body).filter((k) => !(k in base));
    expect(added.sort()).toEqual([...NEW_KEYS].sort());
  });
});

// ─── 2. Results only on a `fresh` verdict ─────────────────────────────────

describe("2.1271 — the committed provisional analysis reaches the wire (pin 2)", () => {
  it("FRESH — delivers `complete_current` AND the analysis_result block", async () => {
    readFactsFor.mockResolvedValue([runAnalysisFact({ graphHash: GRAPH_HASH, mayName: true })]);
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;

    // Bound by IDENTITY: the kind AND the run's own timestamp, not "a
    // complete-ish verdict is present".
    expect((body.analysis_state as { run_state: unknown }).run_state).toEqual({
      kind: "complete_current",
      computed_at: "2026-08-17T09:15:50.000Z",
    });
    const block = body.analysis_result as Record<string, unknown>;
    expect(block).not.toBeNull();
    expect(block.type).toBe("analysis_result");
    // The numbers the Results panel hydrates from, by option id.
    expect(block.win_probabilities).toEqual({ opt_hire: 0.68, opt_hold: 0.32 });
  });

  it("STALE — delivers `complete_stale` and NO block (a result about a different graph)", async () => {
    expect(PRE_EDIT_GRAPH_HASH).not.toBe(GRAPH_HASH);
    readFactsFor.mockResolvedValue([
      runAnalysisFact({ graphHash: PRE_EDIT_GRAPH_HASH, mayName: true }),
    ]);
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;

    expect((body.analysis_state as { run_state: { kind: string } }).run_state.kind).toBe(
      "complete_stale",
    );
    // The discriminating half: same fact, same route, DIFFERENT hash ⇒ no block.
    expect(body.analysis_result).toBeNull();
  });

  it("an unsupported legacy hash is unknown identity, not proof of a valid stale run", async () => {
    readFactsFor.mockResolvedValue([
      runAnalysisFact({ graphHash: "hash_from_a_graph_since_edited", mayName: true }),
    ]);
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;
    expect(body.analysis_state).toMatchObject({
      run_state: { kind: "unknown_degraded" },
      leader_claim: { permitted: false, withheld_reason: "analysis_run_identity_unconfirmed" },
    });
    expect(body.analysis_result).toBeNull();
  });
});

describe("CURRENT-READ-v1 — the selected Run reaches a cold graph read", () => {
  beforeEach(() => {
    loadGraphAndBriefText.mockResolvedValue({ graph: FIGURE_GRAPH, briefText: BRIEF });
  });
  const withFigures = (graphHash: string) => {
    const fact = runAnalysisFact({ graphHash, mayName: true });
    const result = fact.result as Record<string, unknown>;
    const enrichment = result.enrichment as Record<string, unknown>;
    const compared = enrichment.option_comparison as Array<Record<string, unknown>>;
    compared[0] = { ...compared[0], status: "computed", outcome: { mean: 90 }, probability_of_goal: 1 };
    result.goal_certainty = [{
      option_id: "opt_hire", probability_of_goal: 1, earned: false,
      unsized_path: { from: "fac_market", enters_goal_through: "fac_market" },
      break_even: {
        kind: "product", projected_if_held: 92, threshold: 85,
        operand_id: "fac_market", fraction: 0.1, operand_count: 1,
      },
      say: "The conditional projection is 92 if market demand holds; its chance is not known.",
    }];
    return fact;
  };

  it("serves the selected block and attested conditional figure after a cold read, withholding the untyped mean", async () => {
    readFactsFor.mockResolvedValue([withFigures(FIGURE_GRAPH_HASH)]);
    const body = (await read(await buildApp())).json() as Record<string, unknown>;
    const current = body.current_read as Record<string, unknown>;
    expect(current.run_state).toMatchObject({ kind: "complete_current" });
    expect(body.analysis_result).not.toBeNull();
    expect(current).not.toHaveProperty("result");
    expect(current.computed_against_hash).toBe(FIGURE_GRAPH_HASH);
    expect(current.current_analysis_hash).toBe(FIGURE_GRAPH_HASH);
    expect(current.figures).toMatchObject([
      { option_id: "opt_hire", value: 92, measure: "projected_if_held", run_hash: FIGURE_GRAPH_HASH,
        computed_at: "2026-08-17T09:15:50.000Z", condition: { kind: "if_held", operand_id: "fac_market" } },
    ]);
    expect(current.figures).toHaveLength(1);
    expect((current.figures as Array<{ measure: string }>).every((figure) => figure.measure === "projected_if_held")).toBe(true);
  });

  it("withdraws the conditional figure on an edited graph, then serves only the rerun on the next cold read", async () => {
    const app = await buildApp();
    readFactsFor.mockResolvedValue([withFigures(PRE_EDIT_FIGURE_GRAPH_HASH)]);
    const stale = (await read(app)).json() as Record<string, unknown>;
    expect(stale.current_read).toMatchObject({ run_state: { kind: "complete_stale" }, figures: [] });
    expect(stale.current_read).not.toHaveProperty("result");
    expect(stale.current_read).toMatchObject({
      computed_against_hash: PRE_EDIT_FIGURE_GRAPH_HASH,
      current_analysis_hash: FIGURE_GRAPH_HASH,
    });
    expect(stale.analysis_result).toBeNull();

    readFactsFor.mockResolvedValue([withFigures(FIGURE_GRAPH_HASH)]);
    const rerun = (await read(app)).json() as Record<string, unknown>;
    expect(rerun.current_read).toMatchObject({ run_state: { kind: "complete_current" } });
    expect((rerun.current_read as { figures: unknown[] }).figures).toHaveLength(1);
    expect(rerun.current_read).not.toHaveProperty("result");
  });

  it("distinguishes an unreadable analysis from no saved Run while preserving the graph", async () => {
    readFactsFor.mockRejectedValue(new Error("fact store unavailable"));
    const body = (await read(await buildApp())).json() as Record<string, unknown>;
    expect(body.graph_present).toBe(true);
    expect(body.current_read).toMatchObject({ run_state: { kind: "unknown_degraded" }, figures: [] });
    expect(body.current_read).not.toHaveProperty("result");
  });
});

// ─── 3. A failed read is not "never analysed" ─────────────────────────────

describe("2.1271 — an unreadable fact store never claims the scenario was never analysed (pin 3)", () => {
  it("a THROWING fact read yields `unknown_degraded` / `store_unreadable`, not `never_run`", async () => {
    readFactsFor.mockRejectedValue(new Error("supabase unavailable"));
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;

    expect((body.analysis_state as { run_state: unknown }).run_state).toEqual({
      kind: "unknown_degraded",
      cause: "store_unreadable",
    });
    expect(body.analysis_result).toBeNull();
    // Pin 5, at the same seam: the graph still ships.
    expect(body.graph_present).toBe(true);
  });

  it("DISCRIMINATING TWIN — a genuinely empty scenario DOES say `never_run`", async () => {
    // "Genuinely empty" = the durable scenario record is COMPLETE and holds no
    // run (what the production port returns). An empty hot window alone cannot
    // prove absence: its 20 rows can hide an older run (#1860, Codex 5824695259).
    readFactsFor.mockResolvedValue([]);
    (store as Record<string, unknown>).readScenarioRunAnalysisFactsFor = vi
      .fn()
      .mockResolvedValue({ facts: [], total_count: 0 });
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;
    // (B) — this route now carries the canonical admission verdict, and this
    // file's fixture is NOT admitted (options unlinked; see the (B) PRECONDITION
    // below). A KNOWN-absent run on a blocked model reads `blocked` — exactly what
    // a turn reply says for the same model — so the twin still discriminates
    // authoritative absence from the THROWING read above (`unknown_degraded`).
    // The unsupplied-readiness `never_run` arm is pinned in
    // `admission-preserves-prior-run.test.ts`.
    expect((body.analysis_state as { run_state: { kind: string } }).run_state.kind).toBe("blocked");
    expect((body.analysis_state as { readiness: { status: string } }).readiness.status).toBe("blocked");
  });
});

// ─── 4. The verdict and the block agree about the leader ──────────────────

describe("2.1271 — verdict and block cannot disagree about the leader (pin 4)", () => {
  it("a WITHHELD fact withholds on BOTH surfaces", async () => {
    readFactsFor.mockResolvedValue([runAnalysisFact({ graphHash: GRAPH_HASH, mayName: false })]);
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;

    const block = body.analysis_result as Record<string, unknown>;
    const claim = (body.analysis_state as { leader_claim: Record<string, unknown> }).leader_claim;
    expect(block.leading_option_id).toBeNull();
    expect(claim.permitted).toBe(false);
    expect(claim.withheld_reason).toBe("constraint_verdict_withheld");
  });

  it("OPPOSITE-DIRECTION TWIN — an ENTITLED fact on an ADMITTED model names the leader on BOTH surfaces", async () => {
    loadGraphAndBriefText.mockResolvedValue({ graph: ADMITTED_GRAPH, briefText: BRIEF });
    readFactsFor.mockResolvedValue([runAnalysisFact({ graphHash: ADMITTED_GRAPH_HASH, mayName: true })]);
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;

    const block = body.analysis_result as Record<string, unknown>;
    const claim = (body.analysis_state as { leader_claim: Record<string, unknown> }).leader_claim;
    expect(block.leading_option_id).toBe("opt_hire");
    expect(claim.permitted).toBe(true);
    expect(claim.separation).toBe("separated");
  });

  it("P0 SHARED DATA (matrix M5): an ENTITLED fact on a model the admission refuses names NO leader on the block", async () => {
    // The ONE licence fails closed off the claim-strength axis. `leader_claim.permitted` is the composed INPUT (it never
    // reads the admission), so it stays true here: consumers read the licence, never the bare claim (AUDIT §1).
    readFactsFor.mockResolvedValue([runAnalysisFact({ graphHash: GRAPH_HASH, mayName: true })]);
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;
    expect((body.analysis_result as Record<string, unknown>).leading_option_id).toBeNull();
    expect((body.analysis_state as { leader_claim: Record<string, unknown> }).leader_claim.permitted).toBe(true);
  });
});

// ─── 5. No graph, and the graph read is never degraded ────────────────────

describe("2.1271 — the analysis leg is strictly additive to the graph read (pin 5)", () => {
  it("a scenario with NO graph answers both keys null, and spends no fact read", async () => {
    loadGraphAndBriefText.mockResolvedValue({ graph: null, briefText: BRIEF });
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;

    expect(body.graph_present).toBe(false);
    expect(body.analysis_state).toBeNull();
    expect(body.analysis_result).toBeNull();
    expect(body.current_read).toMatchObject({ run_state: null, figures: [] });
    expect(body.current_read).not.toHaveProperty("result");
    expect(readRecent).not.toHaveBeenCalled();
  });

  it("carries NO prose surface — no assistant_text, no blocks array, no chips", async () => {
    // The V5 leader-claim WIRE gate enforces over `assistant_text` /
    // `framing_question` and lives inside `sendFinalised200`, which is not
    // callable from a route helper. This leg therefore ships no enforceable
    // prose at all rather than reproducing that gate — pinned so a later change
    // cannot quietly add one.
    readFactsFor.mockResolvedValue([runAnalysisFact({ graphHash: GRAPH_HASH, mayName: false })]);
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;

    expect(body).not.toHaveProperty("assistant_text");
    expect(body).not.toHaveProperty("blocks");
    expect(body).not.toHaveProperty("suggested_actions");
    expect(body).not.toHaveProperty("analysis_ready");
  });
});

// ─── (B) ONE ADMISSION VERDICT, WITHOUT ERASING THE PRIOR RUN ─────────────────
//
// #70 (B): the read route must carry the SAME whole-model admission verdict the
// turn replies carry (`route-v2.ts` passes `{ readiness: ctx.analysisReady }`),
// and a blocked model must not lose the fact that an earlier analysis exists.
// Before (B) the read route passed `{}` — readiness `{unknown, []}` — and, the
// moment admission was threaded, `composeRunState` would have replaced the
// prior run with `kind: 'blocked'` (`analysis-state-v1.ts`). This fixture is
// Paul's shape: options with NO decision→option link (`edges: []`).

type WireState = {
  run_state: { kind: string };
  readiness: { status: string; blockers: Array<{ code: string }> };
  usable_for_prose: boolean;
  usable_for_followup: boolean;
  requires_rerun: boolean;
  blocked_unusable: boolean;
};

describe("(B) the read route carries the ONE admission verdict and keeps the prior run", () => {
  it("PRECONDITION — the fixture is genuinely NOT admitted by the canonical authority", () => {
    const ready = buildCanonicalAnalysisReadyFromGraph(GRAPH);
    expect(ready?.status).toBe("blocked");
    expect(ready?.may_run).toBe(false);
    expect(issuesAsWireBlockers(ready?.readiness_issues).length).toBeGreaterThan(0);
  });

  it("B1 — readiness is the canonical verdict for THIS graph, not the unsupplied sentinel", async () => {
    const app = await buildApp();
    const state = (await read(app)).json().analysis_state as WireState;
    const ready = buildCanonicalAnalysisReadyFromGraph(GRAPH)!;
    expect(state.readiness.status).toBe(ready.status);
    expect(state.readiness.blockers.map((b) => b.code)).toEqual(
      issuesAsWireBlockers(ready.readiness_issues).map((b) => b.code),
    );
  });

  it("B2 — a STALE prior run stays `complete_stale` beside the blocked verdict, and stays usable as context", async () => {
    readFactsFor.mockResolvedValue([runAnalysisFact({ graphHash: PRE_EDIT_GRAPH_HASH, mayName: true })]);
    const app = await buildApp();
    const state = (await read(app)).json().analysis_state as WireState;
    expect(state.readiness.status).toBe("blocked");
    expect(state.run_state.kind).toBe("complete_stale");
    expect(state.blocked_unusable).toBe(false);
    expect(state.usable_for_prose).toBe(true);
    expect(state.usable_for_followup).toBe(true);
  });

  it("B3 — `requires_rerun` is NOT offered while the model is not admitted", async () => {
    readFactsFor.mockResolvedValue([runAnalysisFact({ graphHash: PRE_EDIT_GRAPH_HASH, mayName: true })]);
    const app = await buildApp();
    const state = (await read(app)).json().analysis_state as WireState;
    expect(state.run_state.kind).toBe("complete_stale");
    expect(state.requires_rerun).toBe(false);
  });

  it("CONTRAST — a KNOWN-absent run on a blocked model reads `blocked` (nothing to preserve)", async () => {
    readFactsFor.mockResolvedValue([]);
    (store as Record<string, unknown>).readScenarioRunAnalysisFactsFor = vi
      .fn()
      .mockResolvedValue({ facts: [], total_count: 0 });
    const app = await buildApp();
    const state = (await read(app)).json().analysis_state as WireState;
    expect(state.run_state.kind).toBe("blocked");
    expect(state.blocked_unusable).toBe(true);
  });

  it("an UNREADABLE record on a blocked model keeps `unknown_degraded` — a run may exist behind the failed read", async () => {
    readFactsFor.mockRejectedValue(new Error("store down"));
    const app = await buildApp();
    const state = (await read(app)).json().analysis_state as WireState;
    expect(state.run_state.kind).toBe("unknown_degraded");
    expect(state.readiness.status).toBe("blocked");
  });
});

// ─── The run's own constraint verdict state rides with its block ──────────

describe("the reload carries the selected run's constraint verdict state (R&C #70 5842182272)", () => {
  it("FRESH — `analysis_constraint_verdict_state` is the fact's own state, beside its block", async () => {
    readFactsFor.mockResolvedValue([runAnalysisFact({ graphHash: GRAPH_HASH, mayName: false })]);
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;
    expect(body.analysis_result).not.toBeNull();
    expect(body.analysis_constraint_verdict_state).toBe("unevaluated");
  });

  it("OPPOSITE TWIN — a permitting fact carries `evaluated_feasible`", async () => {
    readFactsFor.mockResolvedValue([runAnalysisFact({ graphHash: GRAPH_HASH, mayName: true })]);
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;
    expect(body.analysis_constraint_verdict_state).toBe("evaluated_feasible");
  });

  it("STALE — no block, and no verdict state: both describe a different graph", async () => {
    readFactsFor.mockResolvedValue([runAnalysisFact({ graphHash: PRE_EDIT_GRAPH_HASH, mayName: false })]);
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;
    expect(body.analysis_result).toBeNull();
    expect(body).not.toHaveProperty("analysis_constraint_verdict_state");
  });
});

// ─── The run's own leader-limit risks ride with the same block ────────────

describe("the reload carries the selected run's leader-limit risks (R&C #70 5843907129)", () => {
  it("FRESH — `analysis_leader_limit_risks` is present beside its block ([] when nothing is at risk)", async () => {
    readFactsFor.mockResolvedValue([runAnalysisFact({ graphHash: GRAPH_HASH, mayName: true })]);
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;
    expect(body.analysis_result).not.toBeNull();
    expect(body.analysis_leader_limit_risks).toEqual([]);
  });

  it("STALE — no block, and no risks: both describe a different graph", async () => {
    readFactsFor.mockResolvedValue([runAnalysisFact({ graphHash: PRE_EDIT_GRAPH_HASH, mayName: true })]);
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;
    expect(body.analysis_result).toBeNull();
    expect(body).not.toHaveProperty("analysis_leader_limit_risks");
  });
});

// ─── B5: the run's own per-limit verdicts ride with the same block (DL 5859845823) ────────────

describe("the reload carries the selected run's per-limit verdicts (B5, `analysis_limit_verdicts`)", () => {
  const LIMIT_VERDICTS = {
    per_limit: [{ constraint_id: "gc_budget", state: "estimate_only", reason: "level_olumi_estimate" }],
    joint: { state: "estimate_only" },
  };
  const withRows = (graphHash: string) => {
    const fact = runAnalysisFact({ graphHash, mayName: true }) as { result: { constraint_verdict: Record<string, unknown> } };
    fact.result.constraint_verdict = { ...fact.result.constraint_verdict, ...LIMIT_VERDICTS };
    return fact;
  };

  it("FRESH — the fact's stored rows, beside its block, equal to what the fact stores", async () => {
    readFactsFor.mockResolvedValue([withRows(GRAPH_HASH)]);
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;
    expect(body.analysis_result).not.toBeNull();
    expect(body.analysis_limit_verdicts).toEqual(LIMIT_VERDICTS);
  });

  it("CONTRAST — a fresh fact that attests no rows carries no key (absent = not attested)", async () => {
    readFactsFor.mockResolvedValue([runAnalysisFact({ graphHash: GRAPH_HASH, mayName: true })]);
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;
    expect(body.analysis_constraint_verdict_state, "control: the same fact is read").toBe("evaluated_feasible");
    expect(body).not.toHaveProperty("analysis_limit_verdicts");
  });

  it("STALE — no block, and no rows: both describe a different graph", async () => {
    readFactsFor.mockResolvedValue([withRows(PRE_EDIT_GRAPH_HASH)]);
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;
    expect(body.analysis_result).toBeNull();
    expect(body).not.toHaveProperty("analysis_limit_verdicts");
  });
});

// ─── C46 × R3-4: the carriers the run's engine evaluated ride with the same block (Canonical criterion 1) ────────────

describe("the reload carries the selected run's evaluated identities (`analysis_identity_evaluated_node_ids`)", () => {
  /** ISL #187's list as PLoT #379 forwards it; the run fact stores the /v2/run body whole as its `enrichment`. */
  const IDENTITY_EVALUATIONS = [
    { node_id: "mrr", operation: "product", factor_ids: ["pro_plan_price", "pro_subscribers"], evaluated: true, level_source: "identity_inputs" },
    { node_id: "team_mrr", operation: "product", factor_ids: ["team_price", "team_seats"], evaluated: false, withheld_reason: "identity_frame_missing" },
  ];
  const withList = (graphHash: string) => {
    // The leader withheld for ANOTHER reason (the constraint verdict): the lift must still reach the Agent's view.
    const fact = runAnalysisFact({ graphHash, mayName: false }) as { result: { enrichment: Record<string, unknown> } };
    fact.result.enrichment = { ...fact.result.enrichment, identity_evaluations: IDENTITY_EVALUATIONS };
    return fact;
  };

  it("ROW A (FRESH) — exactly the carriers the fact's engine marked `evaluated: true`, beside its block", async () => {
    readFactsFor.mockResolvedValue([withList(GRAPH_HASH)]);
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;
    expect(body.analysis_result).not.toBeNull();
    expect(body.analysis_constraint_verdict_state, "control: the same fact is read").toBe("unevaluated");
    expect(body.analysis_identity_evaluated_node_ids).toEqual(["mrr"]);
  });

  it("CONTRAST — a fresh fact whose enrichment carries no list (every run before batch 7) carries no key", async () => {
    readFactsFor.mockResolvedValue([runAnalysisFact({ graphHash: GRAPH_HASH, mayName: false })]);
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;
    expect(body.analysis_constraint_verdict_state, "control: the same fact is read").toBe("unevaluated");
    expect(body).not.toHaveProperty("analysis_identity_evaluated_node_ids");
  });

  it("ROW A (STALE) — no block, and no evaluated identities: both describe a different graph", async () => {
    readFactsFor.mockResolvedValue([withList(PRE_EDIT_GRAPH_HASH)]);
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;
    expect(body.analysis_result).toBeNull();
    expect(body).not.toHaveProperty("analysis_constraint_verdict_state");
    expect(body).not.toHaveProperty("analysis_identity_evaluated_node_ids");
  });
});

// ─── R3-9 (#2248): the last successful Run's use of each identity — the link writer's own input, NOT freshness-gated ────

describe("the reload carries the last Run's identity use (`analysis_identity_run_use`), exactly as the link writer reads it", () => {
  const withEvaluations = (graphHash: string, evaluations: unknown[]) => {
    const fact = runAnalysisFact({ graphHash, mayName: false }) as { result: { enrichment: Record<string, unknown> } };
    fact.result.enrichment = { ...fact.result.enrichment, identity_evaluations: evaluations };
    return fact;
  };

  it("STALE — the graph was edited after the Run: the block and its evaluated list are withheld, the identity use is NOT", async () => {
    readFactsFor.mockResolvedValue([withEvaluations(PRE_EDIT_GRAPH_HASH, [{ node_id: "mrr", evaluated: true }])]);
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;
    expect(body.analysis_result, "control: the read is stale").toBeNull();
    expect(body).not.toHaveProperty("analysis_identity_evaluated_node_ids");
    // What that Run did stands: it kept MRR's identity, so price → MRR is still a definition.
    expect(body.analysis_identity_run_use).toEqual({ withdrawn_node_ids: [] });
  });

  it("WITHDRAWN — a carrier the last Run did not evaluate is listed, whatever the freshness", async () => {
    readFactsFor.mockResolvedValue([withEvaluations(PRE_EDIT_GRAPH_HASH, [{ node_id: "mrr", evaluated: false, withheld_reason: "identity_zero_level" }])]);
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;
    expect(body.analysis_identity_run_use).toEqual({ withdrawn_node_ids: ["mrr"] });
  });

  it("NO RUN — null: every declared identity is in use", async () => {
    readFactsFor.mockResolvedValue([]);
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;
    expect(body.analysis_identity_run_use).toBeNull();
  });
});

// ─── 0.63.0: the cold read carries the Run's OWN goal certainty (DL 5883197828) ───────────────────────────────────

describe("0.63.0 — `analysis_goal_certainty` is the selected Run's stored array, under the same gates as its block", () => {
  /** One earned and one unearned decision, contract-valid (`GoalCertaintyDecisionSchema`), stored on the Run itself. */
  const STORED = [
    { option_id: "opt_hire", probability_of_goal: 1, earned: true },
    {
      option_id: "opt_hold", probability_of_goal: 0, earned: false,
      unsized_path: { from: "fac_market", enters_goal_through: "fac_market" },
      no_break_even: "not_an_identity",
      say: "Olumi can’t yet say how likely ‘Hold headcount’ is to miss the goal.",
    },
  ];
  const withCertainty = (graphHash: string, certainty: unknown) => {
    const fact = runAnalysisFact({ graphHash, mayName: true });
    (fact.result as Record<string, unknown>).goal_certainty = certainty;
    return fact;
  };

  it("PRECONDITION — the stored fixture parses under the published Run result contract", () => {
    const fact = withCertainty(GRAPH_HASH, STORED);
    expect(RunAnalysisResultSchema.safeParse(fact.result).success).toBe(true);
  });

  it("FRESH — carries the stored array verbatim, by option id (no recomputation, nothing dropped)", async () => {
    readFactsFor.mockResolvedValue([withCertainty(GRAPH_HASH, STORED)]);
    const body = (await read(await buildApp())).json() as Record<string, unknown>;
    expect((body.analysis_state as { run_state: { kind: string } }).run_state.kind).toBe("complete_current");
    expect(body.analysis_goal_certainty).toEqual(STORED);
  });

  it("COLD WIRE — carries an earned exact chance, but strips an unearned exact chance from the option block", async () => {
    const fact = withCertainty(GRAPH_HASH, STORED);
    const enrichment = (fact.result as Record<string, unknown>).enrichment as Record<string, unknown>;
    const options = enrichment.option_comparison as Array<Record<string, unknown>>;
    options[0]!.probability_of_goal = 1;
    options[1]!.probability_of_goal = 0;
    readFactsFor.mockResolvedValue([fact]);

    const body = (await read(await buildApp())).json() as Record<string, unknown>;
    const block = body.analysis_result as { enrichment: { option_comparison: Array<Record<string, unknown>> } };
    const publicOptions = block.enrichment.option_comparison;
    expect(publicOptions.find((row) => row.option_id === "opt_hire")?.probability_of_goal).toBe(1);
    expect(publicOptions.find((row) => row.option_id === "opt_hold")).not.toHaveProperty("probability_of_goal");
    expect(publicOptions.find((row) => row.option_id === "opt_hold")?.outcome_mean).toBe(0.41);
    expect(body.analysis_goal_certainty).toEqual(STORED);
    expect(options[1]!.probability_of_goal).toBe(0); // persisted truth was not rewritten
  });

  it("RECORDED EMPTY — `[]` (no option claims a certainty) is carried as `[]`, never dropped to absent", async () => {
    readFactsFor.mockResolvedValue([withCertainty(GRAPH_HASH, [])]);
    const body = (await read(await buildApp())).json() as Record<string, unknown>;
    expect(body).toHaveProperty("analysis_goal_certainty");
    expect(body.analysis_goal_certainty).toEqual([]);
  });

  it("STALE — no block, so no certainty: a stale Run's certainty is never current", async () => {
    readFactsFor.mockResolvedValue([withCertainty(PRE_EDIT_GRAPH_HASH, STORED)]);
    const body = (await read(await buildApp())).json() as Record<string, unknown>;
    expect((body.analysis_state as { run_state: { kind: string } }).run_state.kind).toBe("complete_stale");
    expect(body.analysis_result).toBeNull();
    expect(body).not.toHaveProperty("analysis_goal_certainty");
  });

  it("NOT RECORDED — a Run from before 0.63.0 leaves the key ABSENT (never defaulted to `[]`)", async () => {
    readFactsFor.mockResolvedValue([runAnalysisFact({ graphHash: GRAPH_HASH, mayName: true })]);
    const body = (await read(await buildApp())).json() as Record<string, unknown>;
    expect(body.analysis_result).not.toBeNull();
    expect(body).not.toHaveProperty("analysis_goal_certainty");
  });

  // DL 5887273384 — turn/cold parity: the cold leg validates with the SAME reader the Agent turn applies to this key.
  const REFUSED = [{ option_id: "opt_hire", probability_of_goal: 1, earned: true, say: "certain" }];

  it("PRECONDITION — the refused array breaks the published contract (earned ⇒ nothing else), and the turn's reader refuses it", () => {
    expect(RunAnalysisResultSchema.safeParse(withCertainty(GRAPH_HASH, REFUSED).result).success).toBe(false);
    expect(readStoredGoalCertainty(REFUSED)).toBeUndefined();
    expect(readStoredGoalCertainty(STORED)).toEqual(STORED);
  });

  it("CONTRACT REFUSED — a stored array the contract refuses is NOT carried on the cold read, exactly as the turn omits it", async () => {
    readFactsFor.mockResolvedValue([withCertainty(GRAPH_HASH, REFUSED)]);
    const body = (await read(await buildApp())).json() as Record<string, unknown>;
    expect((body.analysis_state as { run_state: { kind: string } }).run_state.kind).toBe("complete_current");
    expect(body.analysis_result).not.toBeNull();
    expect(body).not.toHaveProperty("analysis_goal_certainty");
    expect(readStoredGoalCertainty(body.analysis_goal_certainty)).toBeUndefined();
  });

  it("PARITY — on a valid stored array, the turn's reader applied to the cold read returns the cold read's own value", async () => {
    readFactsFor.mockResolvedValue([withCertainty(GRAPH_HASH, STORED)]);
    const body = (await read(await buildApp())).json() as Record<string, unknown>;
    expect(readStoredGoalCertainty(body.analysis_goal_certainty)).toEqual(body.analysis_goal_certainty);
  });
});


describe('SC-24 future goal-unit snapshot joins the cold read', () => {
  it('same-hash unit edit stales with a readable reason; rerun snapshot restores current results', async () => {
    const withUnit = (unit: string) => ({ ...GRAPH, goal_node_id: 'goal_growth',
      nodes: GRAPH.nodes.map((node) => node.id === 'goal_growth' ? { ...node, goal_threshold_unit: unit } : node),
    });
    const before = withUnit('GBP/month');
    const after = withUnit('USD/month');
    const hash = computeAnalysisAffectingGraphHash(after)!;
    expect(computeAnalysisAffectingGraphHash(before)).toBe(hash);
    loadGraphAndBriefText.mockResolvedValue({ graph: after, briefText: BRIEF });
    const saved = runAnalysisFact({ graphHash: hash, mayName: true });
    (saved.result as Record<string, unknown>).input_snapshot = { goal: { node_id: 'goal_growth', unit: 'GBP/month' } };
    readFactsFor.mockResolvedValue([saved]);
    const app = await buildApp();
    try {
      const stale = (await read(app)).json();
      expect(stale.analysis_state.run_state.kind).toBe('complete_stale');
      expect(stale.analysis_result).toBeNull();
      expect(stale).not.toHaveProperty('analysis_ready');
      expect((stale.current_read as { analysis_ready?: unknown }).analysis_ready).toMatchObject({ freshness: 'stale',
        freshness_reason: 'your goal’s unit changed', computed_at: '2026-08-17T09:15:50.000Z' });
      (saved.result as Record<string, unknown>).input_snapshot = { goal: { node_id: 'goal_growth', unit: 'USD/month' } };
      (saved.result as Record<string, unknown>).computed_at = '2026-08-17T09:16:50.000Z';
      const rerun = (await read(app)).json();
      expect(rerun.analysis_state.run_state.kind).toBe('complete_current');
      expect(rerun.analysis_result).not.toBeNull();
      expect(rerun.analysis_state.run_state.computed_at).toBe('2026-08-17T09:16:50.000Z');
    } finally { await app.close(); }
  });
});

// ─── 0.79 SD-1 Slice R: the Run's OWN delivered record, from its `run_delivery` fact (DL ruling #87, option A) ─────────
// J1 record 4b (run 37402501132): after a reload the Run's "Olumi model review" cards were gone — composed for the Run's
// turn and stored nowhere. The served Run is the agent lane, which composes those blocks AFTER the Run's fact is
// committed, so the agent's answer row records them as a `run_delivery` fact (writer: `writer-after-prod-0.79`). This
// read serves the NEWEST one for the selected Run: only while current, only bound to THAT Run, and only if this read's
// own licence leaves every block unchanged (serve-or-omit, never a re-worded copy).
describe("0.79 Slice R — current_read.delivered_record from the Run's run_delivery fact", () => {
  const RUN_ID = "run_slice_r_1";
  const card = (body: string) => ({ ...(maximalReviewCardBlock as Record<string, unknown>), body });
  const record = (over: Record<string, unknown> = {}) => ({
    record_version: 1,
    run_id: RUN_ID,
    graph_hash: GRAPH_HASH,
    phase3_blocks: [card("Most of this result rests on a single factor. Arguing the case against it shows whether it survives.")],
    analysis_ready_options: [{ option_id: "opt_hire", label: "Hire a marketing manager", status: "ready", interventions: { fac_spend: 1 } }],
    ...over,
  });
  const delivery = (rec: Record<string, unknown>) =>
    ({ fact_type: "run_delivery", fact_version: 1, noop: false, result: { run_id: RUN_ID, record: rec } });
  const runFact = (graphHash: string, mayName: boolean, runId: string | null = RUN_ID) => {
    const f = runAnalysisFact({ graphHash, mayName });
    if (runId !== null) (f.result as Record<string, unknown>).run_id = runId;
    return f;
  };
  const readNewestRunDeliveryFor = vi.fn();
  beforeEach(() => { (store as Record<string, unknown>).readNewestRunDeliveryFor = readNewestRunDeliveryFor; });
  afterEach(() => { delete (store as Record<string, unknown>).readNewestRunDeliveryFor; });

  const readOnce = async (fact: Record<string, unknown>) => {
    readFactsFor.mockResolvedValue([fact]);
    const app = await buildApp();
    try { return (await read(app)).json() as { current_read: Record<string, unknown>; analysis_result: unknown }; }
    finally { await app.close(); }
  };

  it("⭐ RED: a FRESH Run serves its newest run_delivery record VERBATIM, with its run_id, read for THAT Run", async () => {
    readNewestRunDeliveryFor.mockResolvedValue(delivery(record()));
    const body = await readOnce(runFact(GRAPH_HASH, true));
    expect(body.current_read.delivered_record).toStrictEqual(record());
    expect(body.current_read.run_id).toBe(RUN_ID);
    expect(readNewestRunDeliveryFor).toHaveBeenCalledTimes(1);
    expect(readNewestRunDeliveryFor).toHaveBeenCalledWith(SCENARIO, RUN_ID);
  });

  it("⭐ a SECOND DEVICE (a fresh app, the same stored row) reads the delivered record byte-identical to what was stored", async () => {
    readNewestRunDeliveryFor.mockResolvedValue(delivery(record()));
    const first = await readOnce(runFact(GRAPH_HASH, true));
    const second = await readOnce(runFact(GRAPH_HASH, true));
    expect(JSON.stringify(first.current_read.delivered_record)).toBe(JSON.stringify(record()));
    expect(JSON.stringify(second.current_read.delivered_record)).toBe(JSON.stringify(first.current_read.delivered_record));
  });

  it("STALE (the graph changed since the Run) → no delivered record, no run_id, and no delivery read at all", async () => {
    readNewestRunDeliveryFor.mockResolvedValue(delivery(record({ graph_hash: PRE_EDIT_GRAPH_HASH })));
    const body = await readOnce(runFact(PRE_EDIT_GRAPH_HASH, true));
    expect(body.current_read).not.toHaveProperty("delivered_record");
    expect(body.current_read).not.toHaveProperty("run_id");
    expect(readNewestRunDeliveryFor).not.toHaveBeenCalled();
    // CONTROL (buddy r1): the same stored delivery for a FRESH Run is read and served, so the omission is staleness.
    readNewestRunDeliveryFor.mockResolvedValue(delivery(record()));
    const fresh = await readOnce(runFact(GRAPH_HASH, true));
    expect(fresh.current_read.delivered_record).toStrictEqual(record());
  });

  it.each([
    ["another Run's record (record.run_id differs)", { run_id: "run_other" }],
    ["a record for another graph (graph_hash differs)", { graph_hash: PRE_EDIT_GRAPH_HASH }],
  ])("not bound to THIS Run: %s → not served", async (_name, over) => {
    readNewestRunDeliveryFor.mockResolvedValue(delivery(record(over)));
    const body = await readOnce(runFact(GRAPH_HASH, true));
    expect(body.current_read).not.toHaveProperty("delivered_record");
    // CONTROL: the Run itself is still served — the omission is the binding, not the read.
    expect(body.current_read.run_id).toBe(RUN_ID);
  });

  it("serve-or-omit: a card naming the leader under a WITHHELD licence is not served — never a projected copy", async () => {
    readNewestRunDeliveryFor.mockResolvedValue(
      delivery(record({ phase3_blocks: [card("Hire a marketing manager leads on the current model; test it before you act.")] })),
    );
    const withheld = await readOnce(runFact(GRAPH_HASH, false));
    expect(withheld.current_read).not.toHaveProperty("delivered_record");
    // CONTROL: the same Run without a leader-naming card is served, so the omission is the licence, not the record.
    readNewestRunDeliveryFor.mockResolvedValue(delivery(record()));
    const neutral = await readOnce(runFact(GRAPH_HASH, false));
    expect(neutral.current_read.delivered_record).toStrictEqual(record());
  });

  it.each([
    ["none recorded", () => readNewestRunDeliveryFor.mockResolvedValue(null)],
    ["the delivery read fails", () => readNewestRunDeliveryFor.mockRejectedValue(new Error("run_delivery_corrupt"))],
  ])("%s → omitted, and the rest of the read stands", async (_name, arrange) => {
    arrange();
    const body = await readOnce(runFact(GRAPH_HASH, true));
    expect(body.current_read).not.toHaveProperty("delivered_record");
    expect(body.current_read.run_id).toBe(RUN_ID);
    expect(body.analysis_result).not.toBeNull();
  });

  it("a Run fact with no run_id → nothing to bind to: no delivery read, no record", async () => {
    readNewestRunDeliveryFor.mockResolvedValue(delivery(record()));
    const body = await readOnce(runFact(GRAPH_HASH, true, null));
    expect(body.current_read).not.toHaveProperty("delivered_record");
    expect(readNewestRunDeliveryFor).not.toHaveBeenCalled();
    // CONTROL (buddy r1): the same Run WITH its run_id is read and served, so the omission is the missing identity.
    const identified = await readOnce(runFact(GRAPH_HASH, true));
    expect(identified.current_read.delivered_record).toStrictEqual(record());
    expect(readNewestRunDeliveryFor).toHaveBeenCalledTimes(1);
  });

  // Buddy r1 (P1 ×2): the licence gate sees only its own prose fields, so a leader claim in ANY other string of the
  // record must also omit it under a withheld licence — a coaching `action_prompt`, or an option's own strings.
  it.each([
    ["a coaching action_prompt", { phase3_blocks: [{ ...(maximalCoachingBlock as Record<string, unknown>), action_prompt: "Hire a marketing manager leads on the current model; test it before you act." }] }],
    ["an option's status", { analysis_ready_options: [{ option_id: "opt_hire", label: "Hire a marketing manager", status: "Hire a marketing manager leads on the current model", interventions: { fac_spend: 1 } }] }],
  ])("a leader claim in %s under a WITHHELD licence → not served", async (_name, over) => {
    readNewestRunDeliveryFor.mockResolvedValue(delivery(record(over)));
    const withheld = await readOnce(runFact(GRAPH_HASH, false));
    expect(withheld.current_read).not.toHaveProperty("delivered_record");
  });

  it("a claim only a ROSTER sees (option 'Team': 'Team leads in 60% of runs.') under a WITHHELD licence → not served", async () => {
    // Precondition (from #2645 P1-1): the roster-free reader misses it; the record's own option label exposes it.
    const { textAssertsLeadingOption } = await import("../../orchestrator-v5/compose/leading-option-egress-guard.js");
    expect(textAssertsLeadingOption("Team leads in 60% of runs.")).toBe(false);
    expect(textAssertsLeadingOption("Team leads in 60% of runs.", { optionLabels: ["Team"] })).toBe(true);
    readNewestRunDeliveryFor.mockResolvedValue(delivery(record({
      phase3_blocks: [card("Team leads in 60% of runs.")],
      analysis_ready_options: [{ option_id: "opt_team", label: "Team", status: "ready", interventions: { fac_spend: 1 } }],
    })));
    const withheld = await readOnce(runFact(GRAPH_HASH, false));
    expect(withheld.current_read).not.toHaveProperty("delivered_record");
  });

  it("CONTROL: the same coaching block with a neutral action_prompt under the same WITHHELD licence is served", async () => {
    const neutral = record({ phase3_blocks: [{ ...(maximalCoachingBlock as Record<string, unknown>), action_prompt: "Argue the case against the single factor this result rests on, and see whether it survives." }] });
    readNewestRunDeliveryFor.mockResolvedValue(delivery(neutral));
    const body = await readOnce(runFact(GRAPH_HASH, false));
    expect(body.current_read.delivered_record).toStrictEqual(neutral);
  });
});
