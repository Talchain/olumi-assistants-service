/**
 * ROADMAP 2.1271 — `run_state.kind === 'running'` ON THE DRAFT TURN.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 * A fresh admissible draft schedules a provisional auto-run
 * (`handlers/auto-run-after-draft.ts`). Until this arm existed the draft turn
 * emitted `never_run`, whose contract text is *"No analysis has ever been run
 * for this model … a consumer renders the pre-analysis affordance"* — i.e. the
 * product invited the user to start an analysis that was already running.
 *
 * ── P7 · THE SEMANTICS ARE THE PRODUCER'S, NOT THIS LANE'S ──────────────────
 * Derived from the CONTRACT that declares the state, read at the vendored
 * bytes (`vendor/talchain-schemas-0.46.0.tgz` →
 * `dist/boundary/analysis-state.js:170-178`), not from any document and not
 * from what the field happens to contain elsewhere:
 *
 *   kind `running`    — "An analysis is in flight as at this turn. Any result
 *                       currently on screen is from an EARLIER run: a consumer
 *                       may keep showing it but must mark it as
 *                       superseded-pending, and must not present it as the
 *                       outcome of the run now in flight."
 *   `started_at`      — "ISO-8601 UTC timestamp at which the in-flight run
 *                       started … It is the START, never an estimated
 *                       completion."
 *
 * ⚠ AND THE ONE THE GENERATED TYPES HIDE, which is why `parsesUnderContract`
 * below is not ceremony: the runtime declaration is
 * `z.string().datetime()`, while the emitted `.d.ts` widens it to `string`.
 * TypeScript alone therefore does NOT stop a non-UTC value — it would pass
 * tsc, fail egress validation, and destroy the turn. The composer routes the
 * timestamp through the same `utcIsoOrNull` its `complete_*` branches use, and
 * the "unusable timestamp" test below is the RED that keeps that true.
 *
 * ── THE DISCRIMINATING PAIRS (trap 19), stated so a reviewer can check them ──
 *  · ARM PRESENT vs ABSENT — the same fixture, differing ONLY in whether
 *    `autoRunInFlight` is threaded, must give `running` vs `never_run`. A mutant
 *    that fires the arm unconditionally passes the first and REDs the second; a
 *    mutant that deletes the arm does the reverse.
 *  · THIS TURN vs A SIBLING TURN — threading the signal for the draft under
 *    test must not make an unrelated, un-threaded turn claim `running`.
 *  · PRECEDENCE, in both directions — `refused` and `blocked` must BEAT the
 *    arm; `never_run` and `complete_current` must LOSE to it. A mutant that
 *    moves the arm one position either way REDs exactly one of these.
 */

import { describe, it, expect } from 'vitest';
import { AnalysisStateV1Schema } from '@talchain/schemas/boundary';
import type { OlumiResponse } from '@talchain/schemas/boundary';

import { finaliseV5Response } from '../response-finaliser.js';
import { composeAnalysisStateV1 } from '../compose/analysis-state-v1.js';
import {
  clampRefusalFreshness,
  type AnalysisReadyPayload,
} from '../compose/analysis-ready-emit.js';
import { canonicalStateFromFreshness } from '../context/canonical-analysis-state.js';
import type { FreshnessDerivation } from '../context/freshness.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────

/** The instant the draft exit records. UTC ISO, as the contract requires. */
const RUN_STARTED_AT = '2026-08-17T09:15:30.250Z';

/**
 * EXACTLY the derivation `draft-graph-dispatch.ts:938-945` threads on a fresh
 * draft — copied from the producer rather than invented, so this suite cannot
 * pass on a shape the draft path never emits.
 */
function draftDerivation(): FreshnessDerivation {
  return {
    freshness: 'none',
    reason: 'no_successful_run_analysis_fact',
    selected_fact_index: null,
    graph_hash_at_run: null,
    current_graph_hash: 'hash_draft',
    computed_at: null,
  };
}

function freshDerivation(): FreshnessDerivation {
  return {
    freshness: 'fresh',
    reason: 'graph_hash_match',
    selected_fact_index: 0,
    graph_hash_at_run: 'hash_abc',
    current_graph_hash: 'hash_abc',
    computed_at: '2026-08-16T12:00:00.000Z',
  };
}

function readyPayload(): AnalysisReadyPayload {
  return {
    status: 'ready',
    goal_node_id: 'goal_growth',
    options: [
      {
        option_id: 'opt_status_quo',
        label: 'Status quo',
        status: 'ready',
        interventions: { fac_spend: 0 },
        is_baseline: true,
      },
    ],
  };
}

function blockedPayload(): AnalysisReadyPayload {
  return {
    status: 'blocked',
    blocked_reason: 'MODEL_NOT_ANALYSABLE',
    goal_node_id: 'goal_growth',
    options: [],
    blockers: [
      {
        blocker_type: 'missing_value',
        factor_id: 'fac_spend',
        message: 'Set a value for marketing spend.',
      },
    ],
  } as AnalysisReadyPayload;
}

const BARE_RESPONSE: OlumiResponse = {
  response_version: 2,
  assistant_text: 'Here is a first model of your decision.',
  blocks: [],
  suggested_actions: [],
  insights: [],
  stage_indicator: 'frame',
} as OlumiResponse;

/**
 * Finalise a draft-shaped exit. `graph` is non-null on a real draft, which is
 * also the condition the schedule call is gated on (`route-v2.ts:3997`) — so a
 * fixture with a null graph would be testing a turn that schedules nothing.
 */
function finaliseDraft(opts: {
  readonly freshness: FreshnessDerivation;
  readonly analysisReady?: AnalysisReadyPayload;
  readonly autoRunInFlight?: { readonly startedAt: string };
}): OlumiResponse {
  return finaliseV5Response(BARE_RESPONSE, {
    freshness: opts.freshness,
    analysisReady: opts.analysisReady ?? readyPayload(),
    graph: { version: '1', nodes: [], edges: [] } as never,
    mayNameLeadingOption: false,
    ...(opts.autoRunInFlight !== undefined
      ? { autoRunInFlight: opts.autoRunInFlight }
      : {}),
  }) as OlumiResponse;
}

function runStateOf(response: OlumiResponse): Record<string, unknown> {
  const state = (response as { analysis_state?: { run_state?: unknown } }).analysis_state;
  expect(state, 'the finaliser must emit analysis_state on every exit').toBeDefined();
  return (state as { run_state: Record<string, unknown> }).run_state;
}

/** The contract is the oracle: `.strict()` per branch, `.datetime()` on the clock. */
function parsesUnderContract(response: OlumiResponse): void {
  const state = (response as { analysis_state?: unknown }).analysis_state;
  const parsed = AnalysisStateV1Schema.safeParse(state);
  expect(
    parsed.success,
    `analysis_state must satisfy the 0.46.0 contract: ${
      parsed.success ? '' : JSON.stringify(parsed.error.issues)
    }`,
  ).toBe(true);
}

// ─── The arm ──────────────────────────────────────────────────────────────

describe("2.1271 — the draft turn's `running` arm", () => {
  it('emits `running` with the run START instant when this turn scheduled a provisional run', () => {
    const wire = finaliseDraft({
      freshness: draftDerivation(),
      autoRunInFlight: { startedAt: RUN_STARTED_AT },
    });
    // Bound by IDENTITY: the kind AND the exact instant threaded in, never
    // "some timestamp is present" — a fabricated `now` would satisfy that.
    expect(runStateOf(wire)).toEqual({ kind: 'running', started_at: RUN_STARTED_AT });
    parsesUnderContract(wire);
  });

  it('DISCRIMINATING TWIN — the same draft with NO scheduled run stays `never_run`', () => {
    const wire = finaliseDraft({ freshness: draftDerivation() });
    expect(runStateOf(wire)).toEqual({ kind: 'never_run' });
    parsesUnderContract(wire);
  });

  it('DISCRIMINATING TWIN — threading the signal for one turn does not make a sibling turn claim it', () => {
    const withSignal = finaliseDraft({
      freshness: draftDerivation(),
      autoRunInFlight: { startedAt: RUN_STARTED_AT },
    });
    const sibling = finaliseDraft({ freshness: draftDerivation() });
    expect(runStateOf(withSignal).kind).toBe('running');
    expect(runStateOf(sibling).kind).toBe('never_run');
  });

  it('NEVER FABRICATES A CLOCK — an unusable `started_at` falls through instead of synthesising `now`', () => {
    // Non-UTC offset: accepted by `string`, REJECTED by the contract's
    // `.datetime()`. The honest outcome is the ordinary derivation, not a
    // `running` state carrying a value that would fail egress validation.
    const wire = finaliseDraft({
      freshness: draftDerivation(),
      autoRunInFlight: { startedAt: '2026-08-17T09:15:30+01:00' },
    });
    expect(runStateOf(wire)).toEqual({ kind: 'never_run' });
    parsesUnderContract(wire);
  });

  it('NEVER FABRICATES A CLOCK — an empty `started_at` falls through too', () => {
    const wire = finaliseDraft({
      freshness: draftDerivation(),
      autoRunInFlight: { startedAt: '   ' },
    });
    expect(runStateOf(wire)).toEqual({ kind: 'never_run' });
  });
});

// ─── Precedence, in BOTH directions ───────────────────────────────────────

describe('2.1271 — `running` precedence is load-bearing in both directions', () => {
  it('LOSES to `refused` — a turn that declined to analyse says so', () => {
    const refused = clampRefusalFreshness(freshDerivation(), 'analysis_refused');
    const wire = finaliseDraft({
      freshness: refused,
      analysisReady: blockedPayload(),
      autoRunInFlight: { startedAt: RUN_STARTED_AT },
    });
    expect(runStateOf(wire).kind).toBe('refused');
  });

  it('LOSES to `blocked` — an unanalysable MODEL is the truer statement', () => {
    const wire = finaliseDraft({
      freshness: draftDerivation(),
      analysisReady: blockedPayload(),
      autoRunInFlight: { startedAt: RUN_STARTED_AT },
    });
    expect(runStateOf(wire).kind).toBe('blocked');
  });

  it('BEATS `never_run` — the arm exists to stop the pre-analysis affordance being offered mid-run', () => {
    const wire = finaliseDraft({
      freshness: draftDerivation(),
      autoRunInFlight: { startedAt: RUN_STARTED_AT },
    });
    expect(runStateOf(wire).kind).toBe('running');
  });

  it("BEATS `complete_current` — the contract forbids presenting an EARLIER run as this run's outcome", () => {
    const wire = finaliseDraft({
      freshness: freshDerivation(),
      autoRunInFlight: { startedAt: RUN_STARTED_AT },
    });
    // Without the arm this fixture emits `complete_current` with the prior
    // run's `computed_at` — i.e. the earlier result presented as current while
    // a new run is in flight, which is exactly what `running` exists to say.
    expect(runStateOf(wire)).toEqual({ kind: 'running', started_at: RUN_STARTED_AT });
    parsesUnderContract(wire);
  });
});

// ─── The composer, directly ───────────────────────────────────────────────

describe('2.1271 — composeAnalysisStateV1 owns the arm, not the finaliser', () => {
  it('emits `running` from the composer for a caller that threads the signal', () => {
    const state = composeAnalysisStateV1({
      canonical: canonicalStateFromFreshness(draftDerivation(), {
        readiness: readyPayload(),
      }),
      freshness: draftDerivation(),
      readiness: readyPayload(),
      rawRobustness: null,
      autoRunInFlight: { startedAt: RUN_STARTED_AT },
    });
    expect(state?.run_state).toEqual({ kind: 'running', started_at: RUN_STARTED_AT });
  });

  it('leaves every OTHER member of the verdict computed from the facts, not from the arm', () => {
    // ⚠ THE POINT: `running` describes the RUN LIFECYCLE. The usability
    // predicates and the contradiction list describe the FACTS, which still
    // genuinely say nothing has run for this graph. An implementation that
    // synthesised a derivation to carry `running` would corrupt all of them.
    const canonical = canonicalStateFromFreshness(draftDerivation(), {
      readiness: readyPayload(),
    });
    const withArm = composeAnalysisStateV1({
      canonical,
      freshness: draftDerivation(),
      readiness: readyPayload(),
      rawRobustness: null,
      autoRunInFlight: { startedAt: RUN_STARTED_AT },
    });
    const withoutArm = composeAnalysisStateV1({
      canonical,
      freshness: draftDerivation(),
      readiness: readyPayload(),
      rawRobustness: null,
    });
    expect(withArm).toBeDefined();
    expect(withoutArm).toBeDefined();
    // Everything except run_state is byte-identical.
    const strip = (s: NonNullable<typeof withArm>): unknown => {
      const { run_state: _drop, ...rest } = s;
      return rest;
    };
    expect(strip(withArm!)).toEqual(strip(withoutArm!));
    expect(withArm!.usable_for_prose).toBe(false);
    expect(withArm!.usable_for_chips).toBe(false);
  });
});

// ─── Anti-mirror: exactly ONE exit may claim it ───────────────────────────

describe('2.1271 — only the draft exit may claim a run it started', () => {
  it('exactly one `sendFinalised200` call site threads `autoRunInFlight`', async () => {
    // DERIVED from the route source, not from a hand-kept list (trap 12). If a
    // second exit ever threads the signal, this REDs and a reviewer has to
    // justify a turn claiming a run it did not start.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), 'src/orchestrator/route-v2.ts'),
      'utf8',
    );
    // Count THREADING sites (`autoRunInFlight` inside an object literal passed
    // to the finaliser), not mentions: the declaration in the ctx type and the
    // prose in comments must not inflate the count.
    const threadingSites = src.match(/\{\s*autoRunInFlight\s*\}/g) ?? [];
    expect(threadingSites).toHaveLength(1);
  });

  it('the claim is GATED on the admission verdict, on the graph the draft persisted', async () => {
    // ⚠ WHAT THIS IS AND IS NOT, stated so it is not mistaken for more.
    // It is a STRUCTURAL guard over `route-v2.ts`, derived from the source. It
    // proves the emission is written as conditional on `willProceed` and that
    // the admission is resolved from `dg.graph` — the same object the scheduler
    // receives. It does NOT execute the draft route, so it cannot prove the
    // runtime wiring; that is what the deploy-verify witness is for. It exists
    // because loosening this gate is the one edit that would turn an honest
    // signal into a claim about a run that never starts, and nothing else in the
    // suite would notice.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src/orchestrator/route-v2.ts'), 'utf8');
    expect(src).toContain('resolveRunAdmission(dg.graph)');
    expect(src).toContain('autoRunAdmission?.willProceed === true');
    // And the timestamp is a UTC ISO string taken at the decision, never a
    // compose-time clock read inside the composer.
    expect(src).toContain('{ startedAt: new Date().toISOString() }');
  });
});
