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
 *     deep-equal, and the new key set must be EXACTLY the two declared ones. A
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

import { describe, it, expect, vi, beforeEach } from "vitest";
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
 */
const NEW_KEYS = ["analysis_state", "analysis_result", "graph_hash", "analysis_admission"] as const;

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

  it("OPPOSITE-DIRECTION TWIN — an ENTITLED fact names the leader on BOTH surfaces", async () => {
    readFactsFor.mockResolvedValue([runAnalysisFact({ graphHash: GRAPH_HASH, mayName: true })]);
    const app = await buildApp();
    const body = (await read(app)).json() as Record<string, unknown>;

    const block = body.analysis_result as Record<string, unknown>;
    const claim = (body.analysis_state as { leader_claim: Record<string, unknown> }).leader_claim;
    expect(block.leading_option_id).toBe("opt_hire");
    expect(claim.permitted).toBe(true);
    expect(claim.separation).toBe("separated");
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
