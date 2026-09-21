/**
 * orchestrator-eval — SEAM-1 live-mode gate + cost guard.
 *
 * FAIL-CLOSED double opt-in. A candidate-eval run may only touch the live
 * (paid) model when BOTH of these are present:
 *
 *   1. the environment key  ORCHESTRATOR_EVAL_LIVE_CANDIDATES=1
 *   2. the CLI flag         --live
 *
 * Either one alone REFUSES live mode (with a reason naming the missing half),
 * so neither a stray env var in CI nor a stray flag on a developer's shell can
 * start paid calls by itself. The default path — no env key, no flag — is the
 * offline mock path and makes ZERO network calls; the test suite proves that
 * with a fetch counter plus a positive control (see
 * __tests__/candidate-eval.test.ts). Deleting either half of this check turns
 * that zero-network test RED — that is the mutation-check the gate ships with.
 *
 * COST GUARD: `enforceTurnCap` bounds the number of live model turns a single
 * run may plan (prompts x fixtures). The hard ceiling is a compile-time
 * constant; `--max-turns` can only LOWER it, never raise it. A planned run
 * that exceeds the effective cap is REFUSED before the first call — never
 * silently truncated, because a truncated fixture set would silently bias the
 * A/B ranking.
 */

/** Env key half of the double opt-in. Must be exactly '1'. */
export const LIVE_ENV_KEY = 'ORCHESTRATOR_EVAL_LIVE_CANDIDATES';

/** CLI flag half of the double opt-in. */
export const LIVE_FLAG = '--live';

/**
 * Hard ceiling on live model turns per run (prompts x fixtures).
 * The coach-arm A/B (2 candidates x 6 fixtures) uses 12; 24 leaves room for a
 * 4-candidate run over the current fixture set without ever permitting an
 * unbounded sweep. Raising this is a code change, reviewed like any other.
 */
export const HARD_MAX_LIVE_TURNS_PER_RUN = 24;

export interface LiveGateInput {
  /** Usually process.env — injected so tests can exercise every combination. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Usually process.argv — injected so tests can exercise every combination. */
  readonly argv: readonly string[];
}

export interface LiveGateResult {
  readonly live: boolean;
  /** Human-readable reason, printed by the CLI so refusals are never silent. */
  readonly reason: string;
}

/** Resolve live mode. Fail-closed: live only when BOTH halves are present. */
export function resolveLiveGate({ env, argv }: LiveGateInput): LiveGateResult {
  const flagPresent = argv.includes(LIVE_FLAG);
  const envPresent = env[LIVE_ENV_KEY] === '1';

  if (flagPresent && envPresent) {
    return {
      live: true,
      reason: `live mode: ${LIVE_FLAG} flag and ${LIVE_ENV_KEY}=1 both present`,
    };
  }
  if (flagPresent) {
    return {
      live: false,
      reason: `${LIVE_FLAG} passed but ${LIVE_ENV_KEY} is not '1' — refusing live mode (fail-closed; export ${LIVE_ENV_KEY}=1 to opt in)`,
    };
  }
  if (envPresent) {
    return {
      live: false,
      reason: `${LIVE_ENV_KEY}=1 but ${LIVE_FLAG} flag absent — refusing live mode (fail-closed; pass ${LIVE_FLAG} to opt in)`,
    };
  }
  return { live: false, reason: 'offline default (no live opt-in present)' };
}

/**
 * Enforce the per-run live turn cap BEFORE any call is made.
 *
 * @param plannedTurns  prompts x fixtures for the run being planned.
 * @param requestedMaxTurns  optional --max-turns value; may only LOWER the cap.
 * @throws when the plan exceeds the effective cap, with the arithmetic spelled
 *         out so the operator can shrink the fixture set or candidate list.
 */
export function enforceTurnCap(plannedTurns: number, requestedMaxTurns?: number): void {
  if (requestedMaxTurns !== undefined && (!Number.isInteger(requestedMaxTurns) || requestedMaxTurns < 1)) {
    throw new Error(`--max-turns must be a positive integer (got ${requestedMaxTurns})`);
  }
  const effectiveCap = Math.min(requestedMaxTurns ?? HARD_MAX_LIVE_TURNS_PER_RUN, HARD_MAX_LIVE_TURNS_PER_RUN);
  if (plannedTurns > effectiveCap) {
    throw new Error(
      `planned live turns (${plannedTurns}) exceed the cap (${effectiveCap}; hard ceiling ${HARD_MAX_LIVE_TURNS_PER_RUN}). ` +
        'Refusing the whole run rather than truncating it — a partial fixture set would silently bias the ranking. ' +
        'Reduce the candidate list or fixture set.',
    );
  }
}
