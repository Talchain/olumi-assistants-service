/**
 * Budget resolution for V5 TurnExecutor.
 *
 * Defaults come from Implementation Plan v2.2. Observed-latency values
 * (~7–22 s for direct_answer narrate turns) inform test fixture bounds, not
 * production defaults. Per Paul's constraint 5.
 *
 * Reads `process.env` on every call so env overrides at runtime (e.g. in
 * integration tests) are honoured. Binding at module load would freeze the
 * reference before tests can mutate the process env.
 *
 * Budget semantics (Paul's correction 4, A2):
 *
 *   Two LLM calls happen per turn on the happy path:
 *     1. Pre-narrate classifier (turn_classifier) → A2TurnClass
 *     2. Narrate fragment (direct_answer_narrate; the clarify_narrate
 *        fragment was retired 2026-07-16 with the Stage-4 clarifier, #486)
 *
 *   Each LLM call gets a FRESH `LLM_BUDGET_NARRATE_MS` window (INDEPENDENT
 *   inner budgets). The outer `TURN_BUDGET_MS` is the SHARED wall-clock
 *   ceiling that bounds the entire turn.
 *
 *   Worst-case total LLM wall-clock time = 2 × LLM_BUDGET_NARRATE_MS,
 *   hard-bounded by TURN_BUDGET_MS. If the outer budget trips mid-call, Paul's
 *   constraint 7 ensures the response classifies as TURN_BUDGET_EXCEEDED
 *   (not UPSTREAM_TIMEOUT), matching the A1 precedence behaviour.
 *
 *   Unit test `__tests__/budgets.test.ts` proves budget independence: running
 *   the classifier does not consume any of the narrate call's budget window.
 */

import type { Budgets } from '@talchain/schemas/orchestrator';

import { config } from '../config/index.js';

const DEFAULT_TURN_BUDGET_MS = 180_000; // 3 minutes — outer bound (see clampTurnBudgetToProxyDeadline)
const DEFAULT_LLM_NARRATE_BUDGET_MS = 60_000; // 1 minute — per-LLM-call inner bound

/**
 * Per-handler inner bound (C1+). Raised 45_000 → 85_000 (2026-07-19) in
 * LOCKSTEP with PLOT_RUN_TIMEOUT_MS 30_000 → 75_000.
 *
 * The lockstep is not cosmetic. `run_analysis` passes this value to
 * plotClient.run as `turnBudgetMs`, and the client derives "remaining budget"
 * from it to decide whether a retry is affordable. If this stayed at 45s
 * while the PLoT cap became 75s, remaining budget after a first attempt would
 * be negative, `getRemainingBudget` would floor at 0, and the retry would
 * become unreachable — disabled by an ACCOUNTING ACCIDENT rather than by a
 * policy anyone chose or could find. That failure mode is silent and reads as
 * green, which is exactly the class of defect this estate keeps paying for.
 *
 * The required relationship is pinned by `budgets.invariants.test.ts`:
 *   DEFAULT_LLM_HANDLER_BUDGET_MS >= PLOT_RUN_TIMEOUT_MS
 *                                    + RETRY_BACKOFF_MS (2s)
 *                                    + MIN_RETRY_BUDGET_MS (2s)
 * 75 + 2 + 2 = 79s, so 85s clears it with 6s of headroom.
 */
const DEFAULT_LLM_HANDLER_BUDGET_MS = 85_000;

/**
 * Headroom reserved between the V5 turn budget and the browser-proxy deadline.
 *
 * The turn must not merely ABORT before the proxy gives up — CEE must still
 * have time to map the abort to a typed error, compose the OlumiResponse,
 * serialise it, and get the bytes onto the wire. 10s is generous for that
 * work (it is response assembly, not compute) while costing little.
 */
const TURN_RESPONSE_HEADROOM_MS = 10_000;

/**
 * Bound the V5 turn budget by the browser-proxy deadline.
 *
 * THE DEFECT THIS FIXES. CEE's timeout ladder is otherwise coherent and
 * strictly nested:
 *
 *   ROUTE_TIMEOUT_MS (Fastify)      135s   outermost
 *   BROWSER_PROXY_TIMEOUT_MS        125s   proxy → must be < route
 *   DRAFT_REQUEST_BUDGET_MS         120s   draft pipeline
 *   ...
 *   V5 turn_ms                      180s   ← ABOVE EVERYTHING. Not nested.
 *
 * The only wall-clock bound on a V5 turn is `turnAbort` at `turn_ms`. At 180s
 * that sits 55s ABOVE the proxy deadline, so for any turn lasting between
 * 125s and 180s the proxy gave up FIRST and the user got a generic
 * PROXY_UPSTREAM_TIMEOUT ("the model generation service did not respond")
 * instead of CEE's own typed, analysis-specific error. CEE could not
 * guarantee it spoke before the proxy did — regardless of this lane's cap
 * raise, which widens exposure to the gap but did not create it.
 *
 * DERIVED, NOT MIRRORED. This reads the proxy timeout from config rather than
 * restating a number next to it. A hand-maintained "keep these two in sync"
 * comment is precisely the mirror that drifts silently and always reads green;
 * deriving makes drift impossible by construction. `Math.min` means an
 * operator raising TURN_BUDGET_MS by env can still never punch through the
 * proxy deadline.
 *
 * Draft turns are strictly BETTER off: previously a 120s-budget draft that ran
 * long was killed by the proxy at 125s with a generic error; now CEE answers
 * at 115s with a typed one. Drafts are measured at 40–60s, so this is not
 * binding in practice.
 */
function clampTurnBudgetToProxyDeadline(configuredMs: number, proxyTimeoutMs: number): number {
  return Math.min(configuredMs, proxyTimeoutMs - TURN_RESPONSE_HEADROOM_MS);
}

function parseMs(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return fallback;
  return n;
}

export function getTurnExecutorBudgets(): Budgets {
  return {
    // Clamped to the browser-proxy deadline so CEE always emits its OWN typed
    // error before the proxy emits a generic one — see
    // clampTurnBudgetToProxyDeadline.
    turn_ms: clampTurnBudgetToProxyDeadline(
      // eslint-disable-next-line no-restricted-syntax -- ISSUE-9020 call-time read: tolerates env rotation without restart (see file header)
      parseMs(process.env.TURN_BUDGET_MS, DEFAULT_TURN_BUDGET_MS),
      config.proxy.browserProxyTimeoutMs,
    ),
    // eslint-disable-next-line no-restricted-syntax -- ISSUE-9020 call-time read: tolerates env rotation without restart (see file header)
    llm_narrate_ms: parseMs(process.env.LLM_BUDGET_NARRATE_MS, DEFAULT_LLM_NARRATE_BUDGET_MS),
  };
}

/**
 * Per-handler inner budget window. Each handler invocation gets a fresh
 * `LLM_BUDGET_HANDLER_MS` (independent of classifier / narrate budgets).
 * Read at call time — overrides from integration tests / Render env rotation
 * are honoured without a restart.
 *
 * Slice C1 exposes this function for registry consumers but registers zero
 * handlers; Slice C2's `run_analysis` is the first caller. The outer
 * `turn_ms` wall-clock bound continues to dominate per Paul's constraint 7
 * (BUDGET_EXCEEDED wins over LLM_TIMEOUT when both apply).
 */
export function getHandlerBudgetMs(): number {
  // eslint-disable-next-line no-restricted-syntax -- ISSUE-9020 call-time read: tolerates env rotation without restart (see file header)
  return parseMs(process.env.LLM_BUDGET_HANDLER_MS, DEFAULT_LLM_HANDLER_BUDGET_MS);
}
