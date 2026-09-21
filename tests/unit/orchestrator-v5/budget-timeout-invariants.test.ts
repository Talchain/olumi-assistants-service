/**
 * Timeout-ladder invariants (this lane).
 *
 * These pin RELATIONSHIPS between budgets, not the numbers themselves. Every
 * defect they guard against is one where the code stays perfectly valid, the
 * suite stays green, and a capability silently stops working:
 *
 *  - PLOT_RUN_TIMEOUT_MS raised without DEFAULT_LLM_HANDLER_BUDGET_MS →
 *    remaining budget floors at 0 and the PLoT retry becomes unreachable by
 *    accounting accident rather than by policy.
 *  - The V5 turn budget drifting above BROWSER_PROXY_TIMEOUT_MS → the proxy
 *    answers before CEE does and the user gets a generic proxy error instead
 *    of CEE's typed one.
 *
 * A comment asking a human to keep two numbers in sync is exactly the
 * hand-maintained mirror that drifts silently. These assertions are the
 * fail-loud replacement.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PLOT_RUN_TIMEOUT_MS,
  PLOT_RUN_BRIEF_TIMEOUT_MS,
  PLOT_VALIDATE_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  ROUTE_TIMEOUT_MS,
  // IMPORTED, not hand-copied. A local `const RETRY_BACKOFF_MS = 2_000` here
  // could not do what its comment claimed: raise the client's backoff to 10s
  // and the real requirement becomes 87s > the 85s budget, yet a test carrying
  // its own stale 2_000 still passes. Importing the source is what makes this
  // suite track the product instead of a snapshot of it.
  RETRY_BACKOFF_MS,
  MIN_RETRY_BUDGET_MS,
  RETRY_SAFETY_MARGIN_MS,
  TURN_RESPONSE_HEADROOM_MS,
  DRAFT_REQUEST_RESPONSE_HEADROOM_MS,
  validateTimeoutRelationships,
  getResolvedTimeouts,
} from "../../../src/config/timeouts.js";
import { getTurnExecutorBudgets, getHandlerBudgetMs } from "../../../src/orchestrator-v5/budgets.js";
import { resolveDecisionReviewHardBudgetMs } from "../../../src/orchestrator-v5/coaching/decision-review-enricher.js";
import {
  resolveComposerBudget,
  COMPOSER_POST_CALL_RESERVE_MS,
} from "../../../src/orchestrator-v5/tools/compose-structural-edit.js";
import { config } from "../../../src/config/index.js";

describe("PLOT_RUN_TIMEOUT_MS ↔ handler budget lockstep", () => {
  it("leaves enough handler budget for a clamped retry after a full-length PLoT attempt", () => {
    // If this fails, the retry has been disabled by arithmetic, not by policy.
    expect(getHandlerBudgetMs()).toBeGreaterThanOrEqual(
      PLOT_RUN_TIMEOUT_MS + RETRY_BACKOFF_MS + MIN_RETRY_BUDGET_MS,
    );
  });

  it("keeps the brief-bearing window at or above the base window", () => {
    // The brief path does strictly MORE work (PLoT calls back into CEE for
    // the LLM-backed decision review). Its window must never end up shorter
    // than the base one.
    expect(PLOT_RUN_BRIEF_TIMEOUT_MS).toBeGreaterThanOrEqual(PLOT_RUN_TIMEOUT_MS);
  });

  it("keeps the PLoT cap above PLoT's own request budget so a timeout means internal failure", () => {
    // This is the premise the "never retry the timeout class" policy rests on.
    // PLoT's REQUEST_BUDGET_MS is 70s; if CEE's cap ever drops back below it,
    // a CEE timeout would once again mean "cut off early" — a case where
    // retrying IS reasonable — and the no-retry policy would be wrong.
    const PLOT_REQUEST_BUDGET_MS = 70_000; // plot-lite-service src/config/timeouts.ts
    expect(PLOT_RUN_TIMEOUT_MS).toBeGreaterThan(PLOT_REQUEST_BUDGET_MS);
  });
});

describe("V5 turn budget is nested inside the browser-proxy deadline", () => {
  it("resolves a turn budget strictly below BROWSER_PROXY_TIMEOUT_MS", () => {
    const { turn_ms } = getTurnExecutorBudgets();
    expect(turn_ms).toBeLessThan(config.proxy.browserProxyTimeoutMs);
  });

  it("leaves headroom for CEE to compose and serialise its typed error", () => {
    const { turn_ms } = getTurnExecutorBudgets();
    // Not merely "less than" — comfortably less, so the abort has time to
    // become bytes on the wire.
    expect(config.proxy.browserProxyTimeoutMs - turn_ms).toBeGreaterThanOrEqual(10_000);
  });

  it("cannot be punched through by a TURN_BUDGET_MS env override", () => {
    const original = process.env.TURN_BUDGET_MS;
    try {
      process.env.TURN_BUDGET_MS = "600000"; // 10 minutes — far above the proxy
      const { turn_ms } = getTurnExecutorBudgets();
      expect(turn_ms).toBeLessThan(config.proxy.browserProxyTimeoutMs);
    } finally {
      if (original === undefined) delete process.env.TURN_BUDGET_MS;
      else process.env.TURN_BUDGET_MS = original;
    }
  });

  it("keeps the whole ladder strictly nested: turn < proxy < route", () => {
    const { turn_ms } = getTurnExecutorBudgets();
    expect(turn_ms).toBeLessThan(config.proxy.browserProxyTimeoutMs);
    expect(config.proxy.browserProxyTimeoutMs).toBeLessThan(ROUTE_TIMEOUT_MS);
  });
});

/**
 * The rungs above run at REPO DEFAULTS only — that is all a unit test can do.
 * Every relationship they pin has BOTH ends env-overridable, so the deployed
 * instance is the only place the real values exist. `validateTimeoutRelationships()`
 * is where they are checked against those values, at boot.
 *
 * These tests are the CI-side POSITIVE CONTROL for that boot check: they prove
 * the rung can SEE a break. Without them the boot validator is an assertion
 * nobody has ever watched fail.
 */
describe("boot validator carries the ladder rungs (positive control)", () => {
  const healthyLadder = () => ({
    handlerBudgetMs: getHandlerBudgetMs(),
    turnBudgetMs: getTurnExecutorBudgets().turn_ms,
    browserProxyTimeoutMs: config.proxy.browserProxyTimeoutMs,
    // ROADMAP 2.180-B: resolved through the SAME single-source function the
    // boot path uses, against the live decompose posture — not a literal.
    decisionReviewHardBudgetMs: resolveDecisionReviewHardBudgetMs(
      config.cee.decisionReviewDecompose,
    ),
  });

  it("is silent on the resolved default ladder", () => {
    const warnings = validateTimeoutRelationships(healthyLadder());
    const ladderWarnings = warnings.filter(
      (w) => w.includes("LLM_BUDGET_HANDLER_MS") || w.includes("V5 turn budget") || w.includes("BROWSER_PROXY_TIMEOUT_MS"),
    );
    expect(ladderWarnings).toEqual([]);
  });

  it("FIRES when the handler budget can no longer afford a clamped retry", () => {
    // This is the exact accounting accident the lane exists to prevent, and
    // the exact case the CI-only assertion could not see: an operator raises
    // PLOT_RUN_TIMEOUT_MS on Render without raising the handler budget.
    const warnings = validateTimeoutRelationships({
      ...healthyLadder(),
      handlerBudgetMs: PLOT_RUN_TIMEOUT_MS + RETRY_BACKOFF_MS + MIN_RETRY_BUDGET_MS - 1,
    });
    expect(warnings.some((w) => w.includes("UNREACHABLE"))).toBe(true);
  });

  it("FIRES when the handler budget escapes the turn budget", () => {
    const { turn_ms } = getTurnExecutorBudgets();
    const warnings = validateTimeoutRelationships({
      ...healthyLadder(),
      handlerBudgetMs: turn_ms,
    });
    expect(warnings.some((w) => w.includes("not nested inside the outer turn budget"))).toBe(true);
  });

  it("FIRES when the turn budget reaches the proxy deadline", () => {
    const warnings = validateTimeoutRelationships({
      ...healthyLadder(),
      turnBudgetMs: config.proxy.browserProxyTimeoutMs,
    });
    expect(warnings.some((w) => w.includes("browser proxy will answer before CEE does"))).toBe(true);
  });

  it("FIRES when too little headroom remains to serialise the typed error", () => {
    const warnings = validateTimeoutRelationships({
      ...healthyLadder(),
      turnBudgetMs: config.proxy.browserProxyTimeoutMs - (TURN_RESPONSE_HEADROOM_MS - 1),
    });
    expect(warnings.some((w) => w.includes("TURN_RESPONSE_HEADROOM_MS"))).toBe(true);
  });

  it("FIRES when the proxy deadline escapes the Fastify route timeout", () => {
    const warnings = validateTimeoutRelationships({
      ...healthyLadder(),
      browserProxyTimeoutMs: ROUTE_TIMEOUT_MS,
    });
    expect(warnings.some((w) => w.includes("no longer strictly nested"))).toBe(true);
  });
});

describe("the ladder rung is registered in the diagnostic snapshot", () => {
  it("exposes the proxy-headroom rungs and the PLoT retry constants", () => {
    // getResolvedTimeouts() is the estate's single view of the ladder. A rung
    // absent from it is a rung nobody can see when diagnosing a live instance.
    const resolved = getResolvedTimeouts();
    expect(resolved.TURN_RESPONSE_HEADROOM_MS).toBe(TURN_RESPONSE_HEADROOM_MS);
    expect(resolved.DRAFT_REQUEST_RESPONSE_HEADROOM_MS).toBe(DRAFT_REQUEST_RESPONSE_HEADROOM_MS);
    expect(resolved.RETRY_BACKOFF_MS).toBe(RETRY_BACKOFF_MS);
    expect(resolved.MIN_RETRY_BUDGET_MS).toBe(MIN_RETRY_BUDGET_MS);
    expect(resolved.RETRY_SAFETY_MARGIN_MS).toBe(RETRY_SAFETY_MARGIN_MS);
  });
});

describe("worst-case analysis path fits inside the turn budget", () => {
  it("bounds PLoT attempt + backoff + clamped retry within the handler budget", () => {
    // Worst case after this lane's fix: one full-length attempt that fails
    // FAST-class (so a retry is allowed), the backoff, then a retry clamped to
    // whatever remains. The clamp means the total can never exceed the
    // handler budget.
    const handlerBudget = getHandlerBudgetMs();
    const worstCaseFirstAttempt = PLOT_RUN_TIMEOUT_MS;
    const clampedRetry = Math.min(
      PLOT_RUN_TIMEOUT_MS,
      handlerBudget - worstCaseFirstAttempt - RETRY_BACKOFF_MS - RETRY_SAFETY_MARGIN_MS,
    );
    const total = worstCaseFirstAttempt + RETRY_BACKOFF_MS + Math.max(0, clampedRetry);
    expect(total).toBeLessThanOrEqual(handlerBudget);
  });

  it("bounds the handler budget inside the turn budget", () => {
    const { turn_ms } = getTurnExecutorBudgets();
    expect(getHandlerBudgetMs()).toBeLessThan(turn_ms);
  });
});

// ============================================================================
// ROADMAP 2.665 (CEE half) — the structural-edit composer's budget.
//
// THE WITNESSED DEFECT. `propose_structural_edit`'s composer call was capped by
// a bare `const COMPOSER_DEFAULT_TIMEOUT_MS = 60_000` in
// `tools/compose-structural-edit.ts`, and the dispatcher at
// `handlers/edit-graph-dispatch.ts` passes NEITHER `timeoutMs` NOR `signal` —
// so that constant WAS the effective bound. The composer was killed at 60.0s
// deterministically (witnessed 2/2), returning `unavailable: call_failed`, and
// `decision=engaged` has therefore never once been reached.
//
// WHY A DERIVED BUDGET AND NOT A BIGGER LITERAL. A second literal would be the
// hand-maintained mirror this whole file exists to abolish: lower
// BROWSER_PROXY_TIMEOUT_MS on Render and a hardcoded composer cap silently
// escapes the turn it has to fit inside, and the symptom is a generic
// TURN_BUDGET_EXCEEDED with nothing naming the cause. The resolver derives from
// the SAME ladder constants asserted above, so both ends move together.
//
// ⚠ WHAT THE DERIVATION CHARGES, STATED SO IT IS A DECISION AND NOT AN
// OVERSIGHT. Inside the edit_graph handler the chain is strictly serial:
// rulebook `handleEditGraph` (bounded by ORCHESTRATOR_TIMEOUT_MS) → composer →
// apply (`preComposedOperations`, which SKIPS the LLM call — edit-graph.ts:2090
// — so its only bounded cost is the PLoT gate at PLOT_VALIDATE_TIMEOUT_MS).
// The V5 ROUTING call ahead of the handler (a second ORCHESTRATOR_TIMEOUT_MS)
// is deliberately NOT charged. This follows the precedent already recorded for
// decision_review in `config/timeouts.ts`: the nominal ladder is ALREADY
// over-subscribed (routing 30s + handler 85s = turn_ms exactly), so a ceiling
// that charges every term at its bound derives 0 and is therefore useless.
// Charging routing at measurement is what makes this rung mean something; it is
// also why the rung below is an upper bound on the HANDLER chain, not a
// sufficiency proof for the whole turn.
// ============================================================================

/** The measured kill point, from the 2.634/2.655 walk. Provenance, not a knob:
 *  the fix is only a fix if the resolved budget is strictly greater than the
 *  value that was observed killing the composer. */
const WITNESSED_COMPOSER_KILL_MS = 60_000;

/**
 * The value the Render dashboard carries for `ORCHESTRATOR_TIMEOUT_MS` on
 * cee-staging, read from the Render API during witness #3 (2026-08-06). Five
 * times the 30,000 code default, and the entire reason #842's derivation
 * collapsed to the floor on the deployed box while reading 80,000 in CI.
 *
 * ⚠ PINNED TO THE HISTORICAL MEASUREMENT, PERMANENTLY (trap 12b). This is a
 * control fixture, not a mirror of the dashboard: it must keep reproducing the
 * env that broke #842 even after somebody corrects the dashboard, or the test
 * that proves immunity quietly stops testing anything.
 */
const WITNESSED_DEPLOYED_ORCHESTRATOR_TIMEOUT_MS = 150_000;

describe("ROADMAP 2.684 — the composer's budget is the turn's REMAINING time", () => {
  it("U3-1 survives the DEPLOYED ORCHESTRATOR_TIMEOUT_MS that collapsed #842 to a 5.0s kill", async () => {
    // ── THE WITNESS, REPRODUCED IN CI ────────────────────────────────────
    // Witness #3 measured the composer killed at 5.008s and 5.006s on staging
    // while CI read a healthy 80,000, because `ORCHESTRATOR_TIMEOUT_MS` is
    // bound at MODULE LOAD from the process env and the dashboard sets it to
    // 150,000. Reproducing that needs the env present BEFORE the module
    // evaluates — hence resetModules + a fresh dynamic import, not a plain
    // assignment (which the already-loaded constant would ignore).
    //
    // Measured at pristine with this env: resolveComposerTimeoutMs() = 5000,
    // "expected 5000 to be greater than 60000". That is the RED this replaces.
    vi.resetModules();
    vi.stubEnv(
      "ORCHESTRATOR_TIMEOUT_MS",
      String(WITNESSED_DEPLOYED_ORCHESTRATOR_TIMEOUT_MS),
    );
    try {
      const freshTimeouts = await import("../../../src/config/timeouts.js");
      const freshCompose = await import(
        "../../../src/orchestrator-v5/tools/compose-structural-edit.js"
      );
      const freshBudgets = await import("../../../src/orchestrator-v5/budgets.js");

      // ⚠ PRECONDITION PIN (trap 13b third face). Without this, a resetModules
      // that silently failed to re-read the env would leave the assertion
      // below passing for the wrong reason — a guard agreeing with itself. The
      // test's discriminating power must not depend on an unpinned fixture.
      expect(freshTimeouts.ORCHESTRATOR_TIMEOUT_MS).toBe(
        WITNESSED_DEPLOYED_ORCHESTRATOR_TIMEOUT_MS,
      );
      // …and the divergence really is large enough to drive the old formula
      // negative, which is what made it clamp to the floor.
      const { turn_ms } = freshBudgets.getTurnExecutorBudgets();
      expect(turn_ms - freshTimeouts.ORCHESTRATOR_TIMEOUT_MS).toBeLessThan(0);

      // THE ASSERTION. At the start of a turn the composer gets essentially the
      // whole turn, whatever a parallel env constant happens to say.
      const nowMs = 1_000_000;
      const budget = freshCompose.resolveComposerBudget({
        requestStartMs: nowMs,
        nowMs,
      });
      expect(budget.kind).toBe("available");
      if (budget.kind !== "available") throw new Error("unreachable");
      expect(budget.timeoutMs).toBeGreaterThan(WITNESSED_COMPOSER_KILL_MS);
      expect(budget.timeoutMs).toBe(turn_ms - freshCompose.COMPOSER_POST_CALL_RESERVE_MS);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("U3-2 charges what the turn ALREADY SPENT — 62s consumed is 62s the composer does not get", () => {
    // The second half of the finding, and the one no static ceiling can reach.
    // Witness #3's trace: boundary.request → edit_graph LLM call (40s) →
    // repair call (22s) → composer entry, i.e. ~62s of a 115s turn already
    // gone. #842's ceiling would have authorised 80,000 at that point — a call
    // 27s longer than the turn had left.
    const { turn_ms } = getTurnExecutorBudgets();
    const CONSUMED_MS = 62_000; // witness #3, w3a1: 09:56:52.280 → 09:57:55.353
    const requestStartMs = 1_000_000;

    const budget = resolveComposerBudget({
      requestStartMs,
      nowMs: requestStartMs + CONSUMED_MS,
    });
    expect(budget.kind).toBe("available");
    if (budget.kind !== "available") throw new Error("unreachable");

    // Exactly what is left, minus what still has to happen after the call.
    expect(budget.timeoutMs).toBe(turn_ms - CONSUMED_MS - COMPOSER_POST_CALL_RESERVE_MS);
    // 48,000 at repo defaults — and the point of the test: NOT the 80,000 a
    // ceiling derived at turn start would have handed out.
    expect(budget.timeoutMs).toBeLessThan(80_000);
    // The call plus the work after it still lands inside the deadline.
    expect(CONSUMED_MS + budget.timeoutMs + COMPOSER_POST_CALL_RESERVE_MS).toBeLessThanOrEqual(
      turn_ms,
    );
  });

  it("U3-3 DECLINES rather than firing a call that cannot finish", () => {
    // The old floor clamped to MIN_TIMEOUT_MS and called anyway; witness #3 is
    // what that costs — a guaranteed UpstreamTimeoutError, twice, at 5.0s of
    // the user's time. A floor-hit must now mean "there is genuinely no time
    // left", and say so.
    const { turn_ms } = getTurnExecutorBudgets();
    const requestStartMs = 1_000_000;
    const budget = resolveComposerBudget({
      requestStartMs,
      // One millisecond short of affording the floor plus the reserve.
      nowMs: requestStartMs + turn_ms - COMPOSER_POST_CALL_RESERVE_MS - MIN_TIMEOUT_MS + 1,
    });
    expect(budget.kind).toBe("exhausted");
  });

  it("U3-4 pins the exhaustion BOUNDARY on both sides", () => {
    // A one-sided assertion would pass for a resolver that always exhausts.
    const { turn_ms } = getTurnExecutorBudgets();
    const requestStartMs = 1_000_000;
    // The last instant that still affords the floor.
    const lastAffordable =
      requestStartMs + turn_ms - COMPOSER_POST_CALL_RESERVE_MS - MIN_TIMEOUT_MS;

    const justAffordable = resolveComposerBudget({ requestStartMs, nowMs: lastAffordable });
    expect(justAffordable.kind).toBe("available");
    if (justAffordable.kind !== "available") throw new Error("unreachable");
    expect(justAffordable.timeoutMs).toBe(MIN_TIMEOUT_MS);

    const justPast = resolveComposerBudget({ requestStartMs, nowMs: lastAffordable + 1 });
    expect(justPast.kind).toBe("exhausted");
  });

  it("U3-5 reports a NEGATIVE remainder when the deadline has already passed", () => {
    // Not cosmetic: `remainingMs` is logged on the decline, and a value floored
    // at 0 would make "we were 12s over" indistinguishable from "we were
    // exactly on time" in the one telemetry line that could tell them apart.
    const { turn_ms } = getTurnExecutorBudgets();
    const requestStartMs = 1_000_000;
    const budget = resolveComposerBudget({
      requestStartMs,
      nowMs: requestStartMs + turn_ms + 12_000,
    });
    expect(budget.kind).toBe("exhausted");
    expect(budget.remainingMs).toBe(-12_000);
  });

  it("U3-6 is DERIVED, not a literal — tightening the turn budget tightens it IN LOCKSTEP", () => {
    // The anti-mirror pin, carried over from U2-3 and still the assertion that
    // discriminates a derived budget from a bigger literal. The delta must be
    // EQUAL to the turn budget's own delta: "it went down a bit" would also
    // pass for a Math.min against a constant.
    const requestStartMs = 1_000_000;
    const at = (): number => {
      const b = resolveComposerBudget({ requestStartMs, nowMs: requestStartMs });
      if (b.kind !== "available") throw new Error("fixture must afford a budget");
      return b.timeoutMs;
    };
    const budgetBefore = at();
    const turnBefore = getTurnExecutorBudgets().turn_ms;
    const original = process.env.TURN_BUDGET_MS;
    try {
      process.env.TURN_BUDGET_MS = "60000";
      const budgetAfter = at();
      const turnAfter = getTurnExecutorBudgets().turn_ms;

      // PRECONDITION PIN (trap 13b third face): the override must actually have
      // moved the turn budget, or the lockstep assertion below is vacuous.
      expect(turnAfter).toBeLessThan(turnBefore);

      expect(budgetAfter).toBeLessThan(budgetBefore);
      expect(turnBefore - turnAfter).toBe(budgetBefore - budgetAfter);
    } finally {
      if (original === undefined) delete process.env.TURN_BUDGET_MS;
      else process.env.TURN_BUDGET_MS = original;
    }
  });

  it("U3-7 charges the post-composer work from the PLoT constant, not a hand-set number", () => {
    // The apply re-enters handleEditGraph with preComposedOperations, which
    // SKIPS the LLM call — its only bounded cost is the PLoT gate. Raise that
    // cap on Render and the reserve must rise with it.
    expect(COMPOSER_POST_CALL_RESERVE_MS).toBe(PLOT_VALIDATE_TIMEOUT_MS);
  });

  it("U3-8 reads NO env constant the deployed box can diverge on behind CEE's back", () => {
    // ── I-B, ASSERTED AT THE SOURCE ──────────────────────────────────────
    // The behavioural pins above prove the resolver is immune TODAY. This one
    // proves the immunity cannot be re-broken the way it was broken before:
    // #842 was correct arithmetic over a constant that describes a per-call cap
    // on a DIFFERENT LLM call, so setting it on the dashboard changed the
    // formula without changing the turn. `turn_ms` is the sole env-bearing term
    // left, and it qualifies because it is the value the turn executor arms its
    // own abort with.
    //
    // A source assertion because that is where the property lives: the defect
    // is "this file subtracts a parallel constant", and no fixture can observe
    // a subtraction that has not happened yet.
    const source = readFileSync(
      join(__dirname, "../../../src/orchestrator-v5/tools/compose-structural-edit.ts"),
      "utf-8",
    );
    const arithmetic = source.slice(source.indexOf("export function resolveComposerBudget"));
    expect(arithmetic).not.toBe("");
    expect(arithmetic).not.toContain("ORCHESTRATOR_TIMEOUT_MS");
  });
});
