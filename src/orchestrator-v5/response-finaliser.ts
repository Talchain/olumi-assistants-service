/**
 * V5 response finaliser — single structurally-guaranteed stamping point for
 * envelope-level fields the product depends on, plus a *type-system* and
 * *runtime* contract that nothing else can produce a 200-OK V5 wire body.
 *
 * Background — three rounds of evolution
 * ---------------------------------------
 *
 * 1. Per-composer emission (claude/v5-analysis-ready-contract). Every
 *    compose function accepted an `analysisReady?` parameter. Failed because
 *    composers can forget the field; the next new path silently broke.
 *
 * 2. Single-site finaliser + grep gate (claude/v5-response-finaliser, first
 *    iteration). All 200-OK exits routed through `sendFinalised200`; grep
 *    blocked direct `analysis_ready` writes. Failed external review on two
 *    counts: (a) the gate didn't catch a future path that calls
 *    `reply.send(rawResponse)` without ever writing `analysis_ready`;
 *    (b) the egress-drift fallback shipped without finalisation.
 *
 * 3. Centralised helper + finalised fallback (this file's prior version,
 *    commit 4b3656a9). Closed the fallback hole; helper became the sole
 *    `reply.code(200).send`. Failed external review again: regex couldn't
 *    enumerate every Fastify send shape — `reply.send(raw)`,
 *    `reply.status(200).send(raw)`, `reply.code(200).type(...).send(raw)`,
 *    implicit `return rawObject` from an async handler. Each escalation
 *    of the regex caught one shape and missed another.
 *
 * 4. (CURRENT) Defence in depth via four independent mechanisms — the
 *    structural fix that stops the regex-vs-bypass arms race.
 *
 * The four mechanisms
 * -------------------
 *
 *   A. **Type brand**: `FinalisedV5Response` is `OlumiResponse` extended
 *      with a `unique symbol` brand. Only `finaliseV5Response` produces it.
 *      Fastify 5 supports status-code-keyed Reply types
 *      (`ReplyKeysToCodes` / `ResolveReplyTypeWithRouteGeneric`) so the
 *      route can declare `Reply: { 200: FinalisedV5Response, 422:
 *      BoundaryError, 500: BoundaryError }`. After this declaration,
 *      `reply.code(200).send(raw)` is a TYPE ERROR — `raw` is not branded.
 *      `reply.code(200).send(boundaryError)` is also a type error — body
 *      type doesn't match the 200 key. Catches every Fastify send shape
 *      (`code`, `status`, chained methods, implicit return) at compile
 *      time.
 *
 *   B. **Runtime WeakSet membership**: `finaliseV5Response` adds the
 *      branded response to a module-scoped WeakSet. The route's
 *      `preSerialization` hook reads the membership and asserts it on
 *      every 200-OK send. Catches casts that bypass the type system at
 *      runtime — Render logs a `v5.finaliser.bypass_detected` event and
 *      the wire ships the egress-violation fallback envelope instead of
 *      the bypassing body. Production-observable.
 *
 *   C. **Compile-time negative tests**: tests/types/v5-finaliser-brand.
 *      test-d.ts uses `// @ts-expect-error` to assert the brand actually
 *      rejects the bypass shapes. If the brand silently regresses (e.g.
 *      someone makes it structurally compatible with `OlumiResponse`),
 *      tsc fails the build.
 *
 *   D. **Narrow grep gate**: scripts/check-no-direct-analysis-ready.sh
 *      catches `analysis_ready` writes outside sanctioned files (existing)
 *      AND `FinalisedV5Response` references outside this file plus its
 *      sanctioned tests (new). Anyone introducing a cast-shape bypass
 *      (`as FinalisedV5Response`, `as unknown as FinalisedV5Response`,
 *      type aliasing, `satisfies FinalisedV5Response`) must mention the
 *      identifier and gets caught. The gate no longer enumerates Fastify
 *      send shapes — that's mechanism A's job.
 *
 * No single bypass slips through all four. The next-reviewer question
 * shifts from "have you considered Fastify shape X" to "explain how a
 * cast simultaneously evades the type, the runtime hook, the tests, and
 * the grep" — a much better contract.
 *
 * Skipped paths (legitimate). 500 / `BoundaryError` exits do NOT call this
 * finaliser. They're infrastructure failures with no canvas mutation; UI's
 * prior `ceeAnalysisReady` remains correct. The status-keyed Reply type
 * pairs them with `BoundaryError` directly, so the type system also
 * enforces that 500 paths don't accidentally ship a `FinalisedV5Response`.
 */

import type { OlumiResponse } from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { config } from '../config/index.js';
import { emit, TelemetryEvents } from '../utils/telemetry.js';

import {
  attachComputedAt,
  FRESHNESS_ONLY_SYNTHESIS_REASONS,
  synthesiseFreshnessOnlyAnalysisReady,
  type AnalysisReadyPayload,
} from './compose/analysis-ready-emit.js';
import {
  composeAnalysisStateV1,
  NO_ANALYSIS_CONTEXT_DERIVATION,
  readRawRobustnessFromResponseBody,
  projectAnalysisBlocksForRunBinding,
  WITHHELD_RUN_IDENTITY_UNCONFIRMED,
  WITHHELD_RUN_IDENTITY_CONFLICT,
} from './compose/analysis-state-v1.js';
import { sanitiseEnrichment } from './compose/sanitise-enrichment.js';
import { projectEvidenceAssessment } from './compose/project-evidence-assessment.js';
import { canonicalStateFromFreshness } from './context/canonical-analysis-state.js';
import { buildRunDelta, type RunDeltaRefusal } from './coaching/build-run-delta.js';
import { selectRunAnalysisFact } from './context/freshness.js';

/**
 * Why the run-over-run consequence did or did not ship.
 *
 * ⭐ A UNION OF TWO OWNERSHIPS, AND THE SPLIT IS THE POINT. The five
 * {@link RunDeltaRefusal} members are the PRODUCER's and arrive by passthrough —
 * re-spelling them here would be a second list free to drift from the one
 * `buildRunDelta` actually returns (this estate's dominant defect: the
 * hand-maintained mirror). The three below are the CALLER's, and the producer
 * cannot see them: it is never invoked on these paths, so it has no reason to
 * offer.
 *
 * They are NOT interchangeable and must not be collapsed. `prior_facts_absent`
 * says the exit had no facts in scope; the two identity members say a pair
 * existed but this turn was not entitled to compare them. Same absent
 * `run_delta` on the wire, different findings, different remedies.
 */
export type RunDeltaDisclosureReason =
  | RunDeltaRefusal
  /** `ctx.priorFacts` was undefined — the exit carried no facts at all. */
  | 'prior_facts_absent'
  /** The composer could not confirm the two runs are the same subject. */
  | 'run_identity_unconfirmed'
  /** The composer found the two runs are demonstrably different subjects. */
  | 'run_identity_conflict';

// ─── Mechanism A: type brand ──────────────────────────────────────────────

/**
 * `unique symbol` brand. Cannot be reproduced outside this module — even if
 * the symbol's string description is leaked, the runtime symbol identity is
 * unique. The `as never` declaration means no value can carry this property
 * at runtime; the brand is a compile-time-only marker, type-narrowed in by
 * `finaliseV5Response`.
 */
declare const FINALISED_BRAND: unique symbol;

/**
 * The branded V5 wire body. Produced ONLY by `finaliseV5Response`. The
 * status-keyed Reply on the V5 route requires this brand for status 200,
 * making `reply.code(200).send(rawOlumiResponse)` a compile-time error.
 */
export type FinalisedV5Response = OlumiResponse & {
  readonly [FINALISED_BRAND]: never;
};

// ─── Mechanism B: runtime WeakSet ─────────────────────────────────────────

/**
 * Set of objects that have been processed by `finaliseV5Response`. The
 * route's `preSerialization` hook checks membership on every 200-OK send;
 * if a 200 body is not in the set, that's a cast-bypass attempt. WeakSet
 * uses object identity, so it works even if the response is later
 * structurally cloned or extended (we hold the post-finalise reference,
 * which is what reaches the wire).
 *
 * Exported for the route's hook to read; not exported beyond the
 * orchestrator-v5 surface.
 */
const FINALISED_RESPONSES: WeakSet<object> = new WeakSet();

export function isFinalisedV5Response(value: unknown): value is FinalisedV5Response {
  return typeof value === 'object' && value !== null && FINALISED_RESPONSES.has(value);
}

// ─── Context ──────────────────────────────────────────────────────────────

export interface FinaliserContext {
  /** Already carried by sendFinalised200; independent of selected fact scope. */
  readonly scenarioId?: string;
  /**
   * Pre-computed readiness from the dispatch path:
   *   - TurnExecutor      : structural readiness from the per-turn graph
   *                         (already computed at turn-executor.ts:368-378
   *                         for chip gating; surfaced on
   *                         `TurnExecutorRunResult.analysisReady`).
   *   - draft-graph       : the rich pipeline payload from
   *                         `DraftGraphResult.analysisReady`.
   *   - edit-graph        : structural readiness from the post-edit
   *                         `appliedGraph`.
   *   - chip-click        : structural readiness from the post-handler
   *                         graph state on the `ok` outcome (currently
   *                         undefined; documented in dispatch result type).
   *   - system-event      : currently undefined — graph-mutating kinds
   *                         (direct_graph_edit, patch_accepted) are UI-
   *                         invalidated for now; documented in dispatch
   *                         result type.
   *
   * Undefined ⇒ no analysis_ready stamped on the response, with ONE
   * exception (Mission 3 transport recovery): when `ctx.freshness`
   * carries an honest 'unknown' verdict for a legacy/unparseable-graph
   * reason (FRESHNESS_ONLY_SYNTHESIS_REASONS), the finaliser synthesises
   * a minimal freshness-only block so the already-computed verdict is not
   * dropped at the wire. All other undefined cases still omit the block —
   * the body still gets the brand and the WeakSet membership; those
   * signal "the helper ran", independent of whether readiness was set.
   * The UI's null-as-unknown handling treats absence as "no fresh
   * readiness this turn", not as a blocker.
   */
  readonly analysisReady?: AnalysisReadyPayload;
  /**
   * V5 state-trust freshness derivation. When provided, the finaliser
   * threads it into `attachComputedAt` so analysis_ready.computed_at
   * uses the selected fact's timestamp (not wire-emit time) and the
   * freshness wire fields are stamped on the response. Populated on
   * every primary CEE dispatch path that produces analysis_ready:
   * turn_executor, chip_click, draft_graph, edit_graph. system_event
   * may omit (most variants don't ship analysis_ready); the field stays
   * `optional` in the schema for forward-compat.
   */
  readonly freshness?: import('./context/freshness.js').FreshnessDerivation;
  /**
   * G3 — the turn's SCENARIO-BOUND freshness verdict, carried verbatim from
   * `TurnExecutorRunResult.scenarioFreshness`.
   *
   * ⚠ DECLARED, BUT NOT READ IN THIS FILE, AND THAT IS DELIBERATE. The
   * supersession DECISION is made once at the route seam
   * (`route-v2.ts`, beside the `analysisAuthorityUnavailable` arm) via
   * `resolveScenarioAnalysisSupersession`, and its OUTPUT arrives here as the
   * two `analysisState*` members below. Re-deciding it here would be a second
   * copy of one rule — the hand-maintained-mirror defect (trap 12). It is
   * declared so the exit's context can carry it through the spread without an
   * excess-property error, and so the channel is visible to a reader.
   */
  readonly scenarioFreshness?: import('./context/freshness.js').FreshnessDerivation;
  /**
   * G3 — THE RESOLVED DERIVATION THE TWO ANALYSIS-STATE SURFACES REPORT, when
   * and only when the scenario-bound verdict superseded a hot-window `none`.
   *
   * ⚠ IT IS A SEPARATE MEMBER RATHER THAN AN OVERWRITE OF `freshness`, AND THE
   * REASON IS MEASURED, NOT STYLISTIC. `ctx.freshness` has a third reader three
   * statements below the `analysis_ready` stamp: the AUTHORITATIVE TOP-LEVEL
   * `graph_hash`. The wire-bound derivation is re-derived POST-DISPATCH against
   * the POST-EDIT graph hash on any turn that committed a mutation
   * (`turn-executor.ts`'s `hashForPostHandlerFreshness` and its two
   * `postApplyHash` siblings), while the scenario derivation holds the
   * PRE-dispatch hash. Substituting `ctx.freshness` wholesale would therefore
   * have rewritten `graph_hash` back to the pre-edit value on exactly the edit
   * turns this guarantee is about — reintroducing the FALSE GRAPH_DIVERGED class
   * the stamp's own docblock records as live-proven. Exactly two readers move;
   * `graph_hash` and the freshness-only synthesis predicate do not.
   */
  readonly analysisStateFreshness?: import('./context/freshness.js').FreshnessDerivation;
  /**
   * G3 — the canonical projection of `analysisStateFreshness`, supplied
   * together with it and never alone.
   *
   * ⚠ REQUIRED, BECAUSE `analysis_state` DOES NOT BRANCH ON THE DERIVATION.
   * `composeAnalysisStateV1` reads its `freshness` input for exactly one thing
   * (`refusal_declared`); every run-state branch reads `canonical.freshness`
   * (`compose/analysis-state-v1.ts::composeRunState`). On the `turn_executor`
   * exit `ctx.canonicalState` is always present, so the
   * `canonicalStateFromFreshness` fallback below never runs there — a
   * derivation-only substitution would have been a NO-OP on the one exit that
   * can carry this. That is chronic failure #1 (a field nothing reads), caught
   * by tracing the consumer rather than by assuming the derivation drives it.
   */
  readonly analysisStateCanonical?: import('./context/canonical-analysis-state.js').CanonicalAnalysisState;
  /**
   * ANALYSIS-STATE AUTHORITY, STEP 3 — the turn's canonical analysis verdict,
   * threaded by a dispatch path that computed the FULL verdict (turn-executor,
   * with degraded detection). When absent, the finaliser composes the same
   * partial verdict from `freshness` + `analysisReady` via
   * `canonicalStateFromFreshness` — the SAME call the route already makes for
   * `_context_summary`, so the two surfaces cannot describe one turn
   * differently.
   *
   * This is the promotion the migration calls for: the canonical verdict stops
   * being a flag-gated diagnostic and becomes the producer of record for the
   * `analysis_state` wire field. The `_context_summary` path is unchanged and
   * still reads `ctx.canonicalState` under its own flag.
   */
  readonly canonicalState?: import('./context/canonical-analysis-state.js').CanonicalAnalysisState;
  /**
   * CEE's constraint entitlement for this turn — the CEE half of the
   * `leader_claim` conjunction. Already REQUIRED on every V5 exit's
   * `sendFinalised200` context and read there via the fail-closed canonical
   * reader, so the finaliser reads it rather than re-deriving it (trap 12).
   * Optional here only so the non-route callers of this function (tests, the
   * wire-capture script) need not supply it; absence is read as NOT entitled,
   * which is the fail-closed direction.
   */
  readonly mayNameLeadingOption?: boolean;
  /**
   * The CALLER that decided `mayNameLeadingOption === false` states that its
   * refusal was the unrequested-analysis confinement (a permitting verdict,
   * withheld only because nobody asked for the run). Read only when the turn is
   * not entitled; absent = the constraint token.
   *
   * ⚠ THE FINALISER MUST NOT DERIVE THIS ITSELF. It never learns which fact the
   * refusal came from: the verdict can come from a partial fact the freshness
   * selector skips, from this turn's own run while `priorFacts` is the
   * PRE-handler window, or from the durable newest fact. Deriving it from a fact
   * the finaliser picked named a user's own Run "unrequested" (#1876
   * CHANGES_REQUIRED; `leader-claim-withheld-cause-binding.test.ts`). No turn
   * exit sets it today: the turn verdict is constraint-only, and the Agent lane
   * serves `leader_claim` from the reload read, which binds the cause to one fact.
   */
  readonly leaderWithheldBecauseUnrequested?: boolean;
  /**
   * C46 stage 1 — the CALLER that decided `mayNameLeadingOption === false` states that its refusal was the
   * product stamp: the refusal's OWN fact withheld a leader its constraint verdict permitted, because the goal
   * is a product the analysis only adds up (`nonlinearIdentityLeaderClaimCause`, judged on the graph THAT RUN
   * analysed — OpenAI Runtime #70 5843934816). Read only when the turn is not entitled; absent = the constraint
   * token. The composer's order puts the unrequested first pass above it (AI Quality #70 5841878117).
   *
   * ⚠ THE FINALISER MUST NOT DERIVE THIS ITSELF, for both reasons the field above gives and one more: deriving it
   * would mean walking `graph`, which this context declares as a nullness signal only. The handoff patch's
   * derivation (from `selectRunAnalysisFact(priorFacts)` and `graph`) named a user's failed limit as the product
   * (`c46-finaliser-cause-is-stated.test.ts`, RED A). No turn exit sets it yet: the turn caller that reads it off
   * the refusal's own fact is handoff H2b (OpenAI Runtime). The Agent lane's `leader_claim` comes from the reload
   * read, which binds it to one fact (`scenario-graph-analysis-read.ts`, H1).
   */
  readonly leaderWithheldBecauseNonlinearIdentity?: boolean;
  /**
   * The turn context's PERSISTED-GRAPH freshness derivation, carried to every
   * non-execute exit by `claimSafety.forExit()` (see `TurnExitStamp`).
   *
   * Consumed ONLY as the third choice, and ONLY when `graph` is null — see
   * `attachAnalysisState`. It exists because the graph-less exits genuinely know
   * whether the analysis is current (their claim-safety read established it) and
   * were throwing that knowledge away.
   */
  readonly exitFreshness?: import('./context/freshness.js').FreshnessDerivation;
  /**
   * The per-turn graph this exit declared, verbatim from the `sendFinalised200`
   * ctx where it is a REQUIRED member (`GraphV3T | null`).
   *
   * ⚠ DECLARED HERE PURELY AS A NULLNESS SIGNAL — never walked, never read for
   * content. It was already being passed (the whole ctx object reaches this
   * function); the finaliser simply had no name for it, and so was inferring
   * "no graph was in scope" from `ctx.freshness === undefined`. That inference
   * is FALSE on the four graph-bearing exits that spread their freshness
   * conditionally (`system_event`, `chip_click`, `draft_graph`, `edit_graph`):
   * on any of those an absent derivation would have shipped a
   * `no_graph_this_turn` cause about a turn that had a graph. Reading the graph
   * directly makes the cause true rather than inferred, and
   * `route-egress-analysis-state-freshness.drift.test.ts` makes the
   * graph-without-freshness combination fail loud in CI besides.
   */
  readonly graph?: import('../orchestrator/types.js').GraphV3T | null;
  /**
   * ROADMAP 2.1271 — THIS turn started a provisional analysis and it is in
   * flight. Threaded ONLY by the draft exit, and only from the same
   * `resolveRunAdmission` verdict that gates the auto-run scheduler.
   *
   * ⚠ IT DOES NOT PARTICIPATE IN THE `canonical` PRECEDENCE CHAIN BELOW, and
   * that is deliberate. `running` is not a freshness derivation: the persisted
   * facts genuinely say "nothing has run for this graph", and that reading stays
   * correct — it is the RUN LIFECYCLE that has moved on, which no fact read can
   * see. So this rides alongside the derivation into `composeAnalysisStateV1`,
   * where one arm above `never_run` consumes it. Folding it into a synthetic
   * derivation would corrupt every OTHER member of the verdict (the five
   * usability predicates, the contradiction list) that is correctly computed
   * from the facts.
   */
  readonly autoRunInFlight?: { readonly startedAt: string };
  /**
   * THE CONSEQUENCE PRODUCER'S INPUT — the turn's already-loaded
   * `prior_facts`, threaded so the finaliser can stamp the wire `run_delta`
   * block (see `coaching/build-run-delta.ts`).
   *
   * ⚠ ABSENCE IS THE FAIL-CLOSED DIRECTION AND IS FULLY SUPPORTED. Exits that
   * do not supply it stamp no `run_delta`, which the contract models
   * explicitly: *"absent on every non-rerun turn AND on reruns produced before
   * the producer shipped / where no prior fact exists; never defaulted, and a
   * consumer renders NO delta card on absence."* So a call site that has no
   * facts in scope simply omits this, and nothing downstream infers anything
   * from the omission.
   *
   * It is READ here rather than re-derived: these are the same facts the
   * turn's freshness verdict and claim-safety reads were taken from, so the
   * delta cannot describe a run the rest of the response never saw
   * (CLAUDE.md trap 12 — two derivations over different inputs are how one
   * response contradicts itself).
   */
  readonly priorFacts?: readonly HandlerFact[];
}

// ─── The finaliser ────────────────────────────────────────────────────────

/**
 * Stamp envelope-level fields, brand the response, register WeakSet
 * membership. The route's `sendFinalised200` and `preSerialization` hook
 * are the only consumers; tests and the helper itself are the only
 * sanctioned producers.
 *
 * Idempotency: calling the finaliser twice with the same context returns a
 * fresh branded object each time (different WeakSet entries; latest
 * `computed_at`). The structure (modulo timestamp) is stable.
 *
 * The cast `as FinalisedV5Response` here is the SOLE production-code use of
 * the type identifier. The grep gate exempts this file; any other file
 * mentioning `FinalisedV5Response` triggers the gate.
 */
export function finaliseV5Response(
  response: OlumiResponse,
  ctx: FinaliserContext,
): FinalisedV5Response {
  // Defensive ceeTrace scrub: V5 source code on this branch does not write
  // `ceeTrace` (verified by exhaustive grep), but the V5 golden-path replay
  // observed `ceeTrace.reason: "CEE"` on a Step 4 wire response from an
  // earlier deploy. Strip-on-egress is a permanent guard against any
  // upstream (legacy CEE pipeline, Fastify hook, future regression) that
  // could attach the field. When CEE_TURN_DEBUG_ENABLED is true the field
  // is preserved for operator inspection; otherwise it is removed before
  // analysis_ready stamping so internal trace shapes never reach the wire.
  const debugEnabled = config.cee?.turnDebugEnabled === true;
  const ceeTraceClean = debugEnabled ? response : stripCeeTrace(response);
  // Phase 1 / Commit 6 — analysis-enrichment-critique-prose-safety:
  // Defensive second-pass sanitisation over every block's enrichment.
  // The decision-review enricher (decision-review-enricher.ts) is the
  // primary scrub site; this backstop catches any future enrichment
  // producer that bypasses the enricher (cached blocks, fallback
  // composers, future analysis_result variants). Same CEE_TURN_DEBUG_ENABLED
  // gating as the ceeTrace scrub: when debug is on, enrichment passes
  // through verbatim; otherwise the enrichment is sanitised and bucket-D
  // critiques are removed from the wire.
  //
  // analysisReady is threaded into the resolver's priority-2 lookup so
  // option_id → label resolution works even when graph is unavailable
  // (the finaliser doesn't carry the V3 graph; analysis_ready.options
  // covers most enrichment-prose label needs in practice).
  const scrubbed = attachEvidenceAssessment(
    debugEnabled
      ? ceeTraceClean
      : sanitiseEnrichmentBlocks(ceeTraceClean, ctx.analysisReady ?? null),
    ceeTraceClean,
  );
  // Mission 3 transport recovery: a legacy/unparseable graph reload derives
  // an honest 'unknown' freshness verdict but builds no structural readiness
  // payload, and freshness can only ride the wire inside analysis_ready.
  // Synthesise a minimal science-free carrier for exactly those reasons;
  // every other no-readiness case (none/fresh/stale, other unknown reasons)
  // keeps the omit behaviour.
  const payloadForStamp: AnalysisReadyPayload | undefined =
    ctx.analysisReady ??
    (ctx.freshness?.freshness === 'unknown' &&
    FRESHNESS_ONLY_SYNTHESIS_REASONS.has(ctx.freshness.reason)
      ? synthesiseFreshnessOnlyAnalysisReady()
      : undefined);
  // G3 — MIGRATED READER 1 of 2. The freshness fields stamped onto
  // `analysis_ready` report the scenario-bound verdict when it superseded a
  // hot-window `none`, so a saved analysis that rolled out of the bounded
  // window is still identifiable and still marked as belonging to an earlier
  // revision, instead of reading "never run".
  //
  // ⚠ NOT `payloadForStamp`'s own predicate above, which keeps reading
  // `ctx.freshness`. That predicate asks a different question — *"did this turn
  // have an unparseable graph, so that a freshness-only carrier must be
  // synthesised?"* — and it is inert under supersession anyway (it requires
  // `'unknown'`; supersession requires `'none'`).
  const stamped: OlumiResponse = payloadForStamp
    ? {
        ...scrubbed,
        analysis_ready: attachComputedAt(
          payloadForStamp,
          ctx.analysisStateFreshness ?? ctx.freshness,
        ),
      }
    : { ...scrubbed };
  // ROADMAP 1.192 leg κ(a) — AUTHORITATIVE top-level graph_hash. The egress
  // sanitiser sets graph_hash from the GraphV3-parsed per-turn graph as a
  // FALLBACK, but that projection can diverge from the RAW analysis-affecting
  // hash after the commit-time options normalisation
  // (normaliseOptionInterventionContract) — which would make graph_hash
  // disagree with an analysis block's `computed_against_hash` on a FRESH
  // analysis (a FALSE GRAPH_DIVERGED, live-proven: effectiveGraph
  // 7367714928030768 vs persisted b3ebb23cfb03df1d). `freshness.current_graph_hash`
  // is the SAME canonical hash run_analysis stamps as `graph_hash_at_run` /
  // `computed_against_hash` (both `computeAnalysisAffectingGraphHash` over the
  // raw persisted/authoritative graph), so when present it is the authoritative
  // value — prefer it over the sanitiser fallback. On a STALE turn it is the
  // CURRENT graph's hash (≠ the analysed hash) — the honest divergence signal
  // the handshake exists to carry. Turns with no freshness keep the sanitiser
  // fallback (coverage), where there is no analysis block to mismatch.
  const withGraphHash: OlumiResponse =
    ctx.freshness?.current_graph_hash != null
      ? { ...stamped, graph_hash: ctx.freshness.current_graph_hash }
      : stamped;
  // ANALYSIS-STATE AUTHORITY, STEP 3 — ONE composed verdict per turn, beside
  // `analysis_ready`. On adopted fact-bearing exits it also confines the
  // analysis block to the composed identity verdict. Other exits retain the
  // additive behaviour. Composed from already-loaded inputs — no engine call,
  // model call or store read.
  const withAnalysisState = attachAnalysisState(withGraphHash, ctx);
  // THE RUN-OVER-RUN CONSEQUENCE (schemas 0.39.0 `OlumiResponseSchema.run_delta`).
  // ADDITIVE BY CONSTRUCTION: adds at most one top-level key and rewrites none,
  // so a consumer that ignores it sees byte-identical behaviour.
  //
  // `mayNameLeadingOption` is read from the ctx member that already exists for
  // the leader-claim conjunction, and its documented absence semantics —
  // "absence is read as NOT entitled, which is the fail-closed direction" — are
  // exactly right here: a turn that cannot vouch for the permission emits a
  // delta with no leader ids rather than one that names an option it may not.
  //
  // The producer is PURE and TOTAL: on anything it cannot honestly construct it
  // returns a discriminated refusal and we stamp nothing.
  const withRunDelta = attachRunDelta(withAnalysisState, ctx);
  FINALISED_RESPONSES.add(withRunDelta);
  return withRunDelta as FinalisedV5Response;
}

/**
 * The persisted-graph derivation, IF this exit may honestly use it.
 *
 * ⚠ THE GATE IS THE POINT, and it is the difference between fixing a
 * degradation and shipping a false currency claim. `exitFreshness` describes the
 * PERSISTED graph as the turn-entry claim-safety read found it. On an exit that
 * declared NO graph in scope — the clarify family, the readiness intake, the
 * declines — nothing this turn changed the graph, so that derivation is exactly
 * true of what the user is looking at. On an exit that DID carry a graph, the
 * turn may have mutated it, and a persisted-graph `fresh` verdict over a mutated
 * graph would tell the user a stale result is current. Those exits thread their
 * own `freshness`; if one ever fails to, falling back to `unknown_degraded` is
 * the correct, visible failure, and the drift guard REDs on the combination
 * besides.
 *
 * Precedence lives HERE, in one expression, rather than in object-literal key
 * order at every call site — see `TurnExitStamp.exitFreshness` for the collision
 * that made that mandatory. (No count is typed here on purpose: the population
 * is enumerated by
 * `__tests__/route-egress-analysis-state-freshness.drift.test.ts`.)
 */
function exitDerivationFor(
  ctx: FinaliserContext,
): import('./context/freshness.js').FreshnessDerivation | undefined {
  if (ctx.exitFreshness === undefined) return undefined;
  // `== null` deliberately: a route exit states `graph: GraphV3T | null`, and a
  // non-route caller that omits the member has no graph either.
  return ctx.graph == null ? ctx.exitFreshness : undefined;
}

/**
 * Compose and stamp `analysis_state` — on EVERY exit, ROADMAP 2.1264.
 *
 * ⚠ THIS FUNCTION USED TO RETURN THE BODY UNTOUCHED when the turn carried no
 * analysis context, and the reasoning is kept rather than deleted (trap 14)
 * because half of it still holds. It read: *absence is a first-class state in
 * the contract — "no verdict was supplied" — and stamping a fabricated default
 * would make every no-analysis turn indistinguishable from a turn whose
 * producer genuinely assessed one.*
 *
 * The half that still holds: A FABRICATED DEFAULT IS STILL FORBIDDEN. What
 * changed is that omission was ALSO carrying a second meaning. With the key
 * present on some exits and absent on others, absence on the wire meant BOTH
 * "this CEE build predates the field" AND "this turn supplied no verdict", and
 * no consumer can separate those — which is precisely what kept the UI on
 * legacy per-turn-type feature detection instead of reading one contract. CEE
 * now always supplies a verdict, so absence means exactly one thing.
 *
 * The emission on a no-context exit is NOT a default: it is the verdict
 * `canonicalStateFromFreshness` computes from the derivation that is TRUE of
 * such an exit (see `NO_ANALYSIS_CONTEXT_DERIVATION` for why each member is
 * true, and why the state is `unknown_degraded` / `no_graph_this_turn` rather
 * than the `never_run` the brief asked for). Every predicate, contradiction and
 * readiness value still comes from the one shared implementation — there is no
 * second literal here to drift.
 */
function attachAnalysisState(
  response: OlumiResponse,
  ctx: FinaliserContext,
): OlumiResponse {
  // G3 — MIGRATED READER 2 of 2. The resolved canonical state wins over the
  // dispatch's own when the scenario-bound verdict superseded a hot-window
  // `none`. FIRST in the chain, because on the only exit that can supply it
  // `ctx.canonicalState` is also always present — and that state is the one
  // carrying the `never_run` claim this guarantee exists to remove.
  //
  // It is the healthy twin of the route's `analysisAuthorityUnavailable` arm,
  // which substitutes exactly this pair for the opposite reason: there the
  // durable authority could not be READ, here it could be read and holds a fact
  // the bounded window has lost.
  const canonical =
    ctx.analysisStateCanonical ??
    ctx.canonicalState ??
    canonicalStateFromFreshness(
      // The no-context derivation is passed POSITIONALLY and never assigned to
      // `ctx.freshness` — see its docstring: its reason is a
      // FRESHNESS_ONLY_SYNTHESIS_REASONS member, so binding it to the context
      // would also synthesise a `blocked` analysis_ready block.
      ctx.analysisStateFreshness ?? ctx.freshness ?? exitDerivationFor(ctx) ?? NO_ANALYSIS_CONTEXT_DERIVATION,
      // Threaded UNCONDITIONALLY, which it was not before. Three graph-less
      // exits (`readiness_intake` and two `edit_graph` declines) supply a
      // readiness payload with no freshness derivation; under the old
      // `ctx.freshness !== undefined` guard their readiness verdict and their
      // blockers were dropped on the floor.
      ctx.analysisReady ? { readiness: ctx.analysisReady } : {},
    );
  const selectedRun = ctx.priorFacts === undefined ? null : selectRunAnalysisFact(ctx.priorFacts);
  // ⚠⚠ G3 — `selected_fact_index` IS ARRAY-RELATIVE, AND UNDER SUPERSESSION IT
  // IS RELATIVE TO AN ARRAY THIS FUNCTION DOES NOT HAVE.
  //
  // `FreshnessDerivation.selected_fact_index` documents itself as a position in
  // *"the EXACT array passed to `deriveAnalysisFreshness` — which is
  // caller-defined, NOT a global ordering … Consumers MUST resolve the fact
  // against the same array they passed in"*. `ctx.priorFacts` is the HOT
  // WINDOW; a superseding canonical state's index is a position in the DURABLE
  // scenario array, which is never threaded here.
  //
  // Without this exclusion the fix defeats itself, and silently. Supersession
  // fires precisely when the hot window holds no successful `run_analysis` fact,
  // so `selectedRun` is null while the superseding index is NOT — the old
  // disjunct would flip `hasRunToBind` to true, hand
  // `compareAnalysisRunFactIdentity` an `undefined` left-hand side, take the
  // `unconfirmed` arm, and emit `unknown_degraded` / `store_unreadable` with the
  // leader claim withheld. That is a WORSE answer than the `never_run` being
  // corrected, produced by a green code path with no error anywhere.
  //
  // Omitting the binding is the honest state and not a loss: the binding
  // cross-checks the DISPLAYED fact against the hot window, and on this turn
  // there is no hot-window fact to cross-check. `selectedRun !== null` still
  // binds whenever the window does hold one.
  const hasRunToBind = ctx.priorFacts !== undefined
    && (selectedRun !== null
      || (ctx.analysisStateCanonical === undefined && canonical.selected_fact_index !== null));
  const analysisState = composeAnalysisStateV1({
    canonical,
    // Read for `refusal_declared` only (see `composeRunState`). Substituting is
    // safe because a refusal turn can never reach supersession: its verdict is
    // rewritten to `unknown` by `clampRefusalFreshness`, and supersession
    // requires `none`. That premise is pinned in-test, not just asserted here.
    freshness: ctx.analysisStateFreshness ?? ctx.freshness,
    readiness: ctx.analysisReady,
    mayNameLeadingOption: ctx.mayNameLeadingOption,
    // Stated by the caller that refused, never derived here (see the ctx field).
    withheldBecauseUnrequested: ctx.leaderWithheldBecauseUnrequested === true,
    // C46 (H2): stated by the same caller, on the same terms — never derived here.
    withheldBecauseNonlinearIdentity: ctx.leaderWithheldBecauseNonlinearIdentity === true,
    // Read from the body as it will ship, not from the fact: when the
    // withheld-claim projection has redacted `near_tie`, the separation half
    // is genuinely unknown to the consumer and `leader_claim` must say so.
    rawRobustness: readRawRobustnessFromResponseBody(response),
    ...(!hasRunToBind ? {} : {
      runFactBinding: {
        scenarioId: ctx.scenarioId,
        selectedResult: selectedRun?.fact.result,
      },
    }),
    // ROADMAP 2.1271 — passed through verbatim; the composer owns the arm's
    // precedence and its timestamp validation.
    ...(ctx.autoRunInFlight !== undefined
      ? { autoRunInFlight: ctx.autoRunInFlight }
      : {}),
  });
  if (analysisState === undefined) return response;
  return {
    ...response,
    blocks: projectAnalysisBlocksForRunBinding(response.blocks, analysisState),
    analysis_state: analysisState,
  };
}

/**
 * ⭐ CARRY THE EVIDENCE ASSESSMENT ACROSS THE TRANSPORT BAN.
 *
 * ⚠ TWO RESPONSES, AND WHICH ONE EACH ARGUMENT IS MATTERS.
 * The projection is DERIVED FROM `source` — the response as it stood BEFORE the
 * Tier-3 deletion, because that is the only place `m1_coaching` still exists —
 * and ATTACHED TO `out`, the response as it will ship, so nothing it carries can
 * be rewritten by the prose walker on its way past. Reading the scrubbed copy
 * instead would silently derive from a subtree that had already been removed and
 * emit nothing, on exactly the deployments where this is needed.
 *
 * ⛔ AND IT SITS OUTSIDE THE DEBUG BRANCH ON PURPOSE. The deletion above runs
 * only when turn debug is OFF. A projection placed inside that arm would be
 * present only when the thing it compensates for was absent.
 *
 * Blocks are left byte-identical where the projection declines (`null`), so the
 * consumer's honest refusal is preserved rather than replaced by a weaker claim.
 */
function attachEvidenceAssessment(out: OlumiResponse, source: OlumiResponse): OlumiResponse {
  // ⚠ SINGLE CASTS, MATCHING `sanitiseEnrichmentBlocks` BELOW. A double
  // `as unknown as` is a forbidden boundary pattern in this repo and the
  // containment ratchet blocks its growth — correctly, since the whole point of
  // a boundary is that the compiler still has something to say at it.
  const outRecord = out as Record<string, unknown>;
  const outBlocks = Array.isArray(outRecord.blocks)
    ? (outRecord.blocks as Array<Record<string, unknown>>)
    : null;
  if (!outBlocks || outBlocks.length === 0) return out;

  const sourceRecord = source as Record<string, unknown>;
  const sourceBlocks = Array.isArray(sourceRecord.blocks)
    ? (sourceRecord.blocks as Array<Record<string, unknown>>)
    : [];

  let mutated = false;
  const next = outBlocks.map((block, index) => {
    if (block == null || typeof block !== 'object') return block;
    const assessment = projectEvidenceAssessment(sourceBlocks[index]?.enrichment);
    if (assessment === null) return block;
    const enrichment = (block.enrichment ?? {}) as Record<string, unknown>;
    mutated = true;
    return { ...block, enrichment: { ...enrichment, evidence_assessment: assessment } };
  });
  if (!mutated) return out;
  return { ...outRecord, blocks: next } as OlumiResponse;
}

function sanitiseEnrichmentBlocks(
  response: OlumiResponse,
  analysisReady: AnalysisReadyPayload | null,
): OlumiResponse {
  // Cheap-gate intentionally OMITTED: a previous version of this function
  // skipped the walker when `critiques` was empty AND none of the four flat
  // string leaves (`summary`, `narrative`, `rationale`, `robustness_synthesis`)
  // were present. That gate created a hole — enrichment shaped only with
  // `review_cards`, `factor_sensitivity.interpretation`, `gaps.description`,
  // `robustness.caveat`, `m1_review`, `m1_coaching`, or `improvement_guidance`
  // bypassed the backstop entirely (Codex review 2026-04-30, finding #2).
  // The walker's per-leaf checks are already O(1) when fields are absent;
  // running it unconditionally on every block with non-null enrichment is
  // the safe contract.
  //
  // We DO still skip blocks without an enrichment object — those are the
  // common case for non-analysis_result block types (`text`, `error`,
  // `graph_patch`, etc.) and the walker has nothing to do.
  const asRecord = response as Record<string, unknown>;
  const blocks = Array.isArray(asRecord.blocks) ? (asRecord.blocks as Array<Record<string, unknown>>) : null;
  if (!blocks || blocks.length === 0) return response;
  let mutated = false;
  const newBlocks = blocks.map((b) => {
    if (b == null || typeof b !== 'object') return b;
    const enrichment = b.enrichment as Record<string, unknown> | undefined;
    if (enrichment == null || typeof enrichment !== 'object') return b;
    // Always run the walker — see comment on the function header above.
    // Per-leaf checks inside `sanitiseEnrichment` are O(1) when fields
    // are absent, and the walker is the only path that covers
    // review_cards / factor_sensitivity / gaps / robustness /
    // m1_review / m1_coaching / improvement_guidance.
    // WIRE BACKSTOP (Tier-3 cage): this is the LAST seam before the
    // response ships, so transport-banned Tier-3 subtrees are DELETED
    // here (dropTier3TransportBanned) — an unknown prose field inside
    // them must not reach users. The enricher/fact path deliberately
    // does NOT set this option (the m1 adapter reads m1_coaching's
    // structured enums for the v11 prompt).
    const result = sanitiseEnrichment(enrichment, null, analysisReady, {
      dropTier3TransportBanned: true,
    });
    mutated = true;
    return { ...b, enrichment: result.enrichment };
  });
  if (!mutated) return response;
  return { ...asRecord, blocks: newBlocks } as OlumiResponse;
}

/**
 * Stamp the run-over-run consequence, or nothing.
 *
 * ⚠ THE OMIT PATH IS THE DEFAULT AND IT IS NOT A DEGRADED STATE. The contract
 * declares `run_delta` optional with explicit absence semantics, and the
 * producer refuses — with a discriminated reason — on every pair it cannot
 * honestly classify. Nothing here converts a refusal into a partial or
 * placeholder block: a fabricated comparison is worse than an absent one, and
 * an absent one is what the UI is already built to render.
 *
 * ⚠ NO `?? {}` / `?? 0` ANYWHERE ON THIS PATH. `priorFacts` absent means the
 * exit had no facts in scope, not that there were none.
 */
function attachRunDelta(
  response: OlumiResponse,
  ctx: FinaliserContext,
): OlumiResponse {
  // ⛔ DISCLOSE WHICH PRECONDITION FAILED, ALWAYS, ON EVERY EXIT FROM THIS
  // FUNCTION. Until 15 Sep this function had four exits and all four were
  // byte-identical silence: the producer returns a DISCRIMINATED refusal and
  // the old `if (built.kind !== 'ok') return response;` threw the reason away,
  // while nothing anywhere on the path logged, counted or emitted.
  //
  // An absence that reads the same whether the producer correctly REFUSED or
  // simply could not PRODUCE is two findings wearing one reading, and they have
  // opposite remedies. Seven probes into the dark outcome clause died on this.
  //
  // Observe-only: `disclose` returns its argument, so it cannot alter a wire
  // byte, and every exit routes through it so a future fifth exit that forgets
  // is a visible omission rather than more silence.
  const priorFactsCount = ctx.priorFacts === undefined ? null : ctx.priorFacts.length;
  const runAnalysisFactsCount =
    ctx.priorFacts === undefined
      ? null
      : ctx.priorFacts.filter((f) => f.fact_type === 'run_analysis').length;

  const disclose = <T extends OlumiResponse>(
    outcome: 'emitted' | 'refused' | 'skipped',
    reason: RunDeltaDisclosureReason | null,
    out: T,
    // null on every exit that puts no reason on the wire by design — see
    // `attachRunDeltaAbsenceReason`. Only `false` means "there WAS a user-facing
    // reason and it did not travel", which is the state worth counting.
    wireReasonCarried: boolean | null = null,
  ): T => {
    // ⛔ AN OBSERVABILITY PATH MUST NOT BE ABLE TO BREAK THE THING IT OBSERVES.
    // Before this change `attachRunDelta` could not fail a response; it now
    // makes a call that could. `emit` wraps only its Datadog block —
    // `sanitizeTelemetryData`, the test sink and `log.info` all sit OUTSIDE any
    // try. The payload here is five scalars, so nothing exotic reaches pino and
    // a throw is close to impossible; but "close to impossible" is the wrong
    // trade against silently 500-ing a good turn for the sake of a log line.
    // Swallowing is correct HERE and nowhere else on this file's paths: the
    // whole point of the disclosure is that its absence is now noticeable.
    try {
      emit(TelemetryEvents.V5RunDeltaOutcome, {
        // Honest null, never a placeholder: the system-event exit reaches the
        // finaliser with no scenario, and `sanitizeTelemetryData` DROPS
        // undefined while preserving null — so a bare `ctx.scenarioId` would
        // make the field vanish from the log line rather than read as unknown.
        scenario_id: ctx.scenarioId ?? null,
        outcome,
        reason,
        // Structural counts only. They separate "no facts in scope" from
        // "facts, but not enough run_analysis ones" WITHOUT naming any of them —
        // entity ids here are slug renderings of the user's own labels, so an id
        // is user content, not structure.
        prior_facts_count: priorFactsCount,
        run_analysis_facts_count: runAnalysisFactsCount,
        // Did the user-facing half actually ship? The carrier is CONDITIONAL
        // (see `attachRunDeltaAbsenceReason`), and a conditional carrier that
        // reports nothing when it misses is a silent-loss channel — the exact
        // shape this event was built to end.
        wire_reason_carried: wireReasonCarried,
      });
    } catch {
      // Deliberately swallowed. The response is the product; the log line is not.
    }
    return out;
  };

  // Read the composer's identity verdict. An unbound pair must not add a new
  // comparative delta after the analysis block has been confined.
  const bindingReason = response.analysis_state?.leader_claim.withheld_reason;
  if (bindingReason === WITHHELD_RUN_IDENTITY_UNCONFIRMED || bindingReason === WITHHELD_RUN_IDENTITY_CONFLICT) {
    const { run_delta: _unboundDelta, ...withoutDelta } = response;
    return disclose(
      'skipped',
      bindingReason === WITHHELD_RUN_IDENTITY_UNCONFIRMED
        ? 'run_identity_unconfirmed'
        : 'run_identity_conflict',
      withoutDelta as OlumiResponse,
    );
  }
  if (ctx.priorFacts === undefined) return disclose('skipped', 'prior_facts_absent', response);
  const built = buildRunDelta({
    priorFacts: ctx.priorFacts,
    // Fail-closed on absence, per this member's own documented semantics.
    mayNameLeadingOption: ctx.mayNameLeadingOption === true,
  });
  // The producer's own union, passed through. This caller mints no taxonomy for
  // the five: re-spelling them here would be a second list free to drift from
  // the one the producer actually returns.
  if (built.kind !== 'ok') {
    const stamped = attachRunDeltaAbsenceReason(response, built.reason);
    return disclose('refused', built.reason, stamped.body, stamped.carried);
  }
  return disclose('emitted', null, { ...response, run_delta: built.delta });
}

/**
 * Put the producer's refusal reason where a PERSON can be told it.
 *
 * ⛔ THE DEFECT THIS CLOSES, and it is the other half of the one above. The
 * disclosure added on 15 Sep reaches an OPERATOR. The person looking at an
 * empty comparison panel is told nothing at all — five distinct refusals arrive
 * at the client as one silence, so the panel is built, mounted, and correctly
 * renders NOTHING, because no honest sentence exists without the reason.
 * `insufficient_runs` alone accounts for the overwhelming majority — a wire
 * measurement taken outside this lane over three days found `run_delta` present
 * in 0 of 915 `run_analysis` facts (contrast control `decision_brief` 915/915),
 * and only 11.5% of scenarios ever reaching a second run (1,103 of 9,598). "You
 * have only run this once, so there is nothing to compare" is a TRUE sentence
 * we are currently withholding.
 *
 * ⚠ THE CARRIER IS FORCED BY THE CONTRACT, NOT CHOSEN FOR TIDINESS, and
 * anyone editing this should know why before moving it. Measured by EXECUTING
 * the pinned `@talchain/schemas` 0.55.0, both controls green:
 *   · `OlumiResponseSchema` is `.strict()`. An undeclared TOP-LEVEL sibling of
 *     `run_delta` — the natural home — fails `safeParse` with
 *     `unrecognized_keys`, which takes the whole reply down the egress
 *     degradation path. That home needs a schemas RELEASE, not a CEE change.
 *   · `analysis_ready` is `.passthrough()`, at the boundary AND at CEE's own
 *     `schemas/analysis-ready.ts`, so an undeclared key inside it crosses
 *     INTACT. `validateEgress` returns the CALLER'S OBJECT rather than
 *     `parsed.data`, so it is a gate and not a transform, and nothing strips it.
 * This is the same mechanic `may_run` and `blocked_reason` already ride; the
 * precedent and its derivation are written up in `routing/readiness-intake.ts`.
 * The key is named `run_delta_absence_reason` in full so it can never be
 * mistaken for a readiness field by a reader who arrives at it cold.
 *
 * ⚠ THE MIGRATION IS NAMED IN THIS PR'S BODY AND IS NOT YET A REGISTER ROW —
 * stated plainly so nobody inherits a scheduler that does not exist. When the
 * contract carries a declared top-level sibling of `run_delta`, this moves
 * there and the passthrough key retires. Until then a CEE-only change is the
 * ONLY way the sentence reaches a user, and a user-facing gap does not wait on
 * a release train.
 *
 * ⛔ NEVER FABRICATE THE CARRIER. `analysis_ready`'s `status` / `options` /
 * `goal_node_id` are REQUIRED at the boundary, so synthesising one to hold a
 * reason would invent a readiness claim in order to ship an honesty fix. On a
 * carrier-less exit this returns the body untouched and reports
 * `carried: false`, so the loss is countable rather than silent.
 *
 * ⚠ SCOPE: the FIVE PRODUCER refusals only. The caller's own three are
 * deliberately excluded — `prior_facts_absent` fires on every turn that ran no
 * analysis at all (most of them), and the two identity members already reach
 * the client as `analysis_state.leader_claim.withheld_reason`. Putting either
 * here would be a second spelling of a fact the wire already carries, which is
 * how two authorities under one name get born (CLAUDE.md trap 21).
 */
function attachRunDeltaAbsenceReason(
  response: OlumiResponse,
  reason: RunDeltaRefusal,
): { readonly body: OlumiResponse; readonly carried: boolean } {
  const carrier = response.analysis_ready;
  if (carrier === undefined) return { body: response, carried: false };
  return {
    body: {
      ...response,
      analysis_ready: { ...carrier, run_delta_absence_reason: reason },
    },
    carried: true,
  };
}

function stripCeeTrace(response: OlumiResponse): OlumiResponse {
  // The defensive scrub walks two known leak surfaces:
  //   1. top-level `response.ceeTrace` (legacy CEE pipeline emitter)
  //   2. nested `response.blocks[i].enrichment.ceeTrace` (decision-review
  //      enricher passthrough — observed on staging f588320 inside
  //      `blocks[0].enrichment.ceeTrace.reason: "Legacy CEE calls
  //      skipped (M2 decision-review enabled)"`). Stripped only when
  //      `CEE_TURN_DEBUG_ENABLED=false`; the caller's `debugEnabled`
  //      gate at line 187 short-circuits this whole function when debug
  //      is on, so no per-surface flag is needed here.
  const asRecord = response as Record<string, unknown>;
  const hasTopLevel = 'ceeTrace' in asRecord;
  const blocks = Array.isArray(asRecord.blocks) ? (asRecord.blocks as unknown[]) : null;
  const blockHasTrace = blocks
    ? blocks.some((b) => {
        const enrichment = (b as { enrichment?: Record<string, unknown> })?.enrichment;
        return enrichment != null && 'ceeTrace' in enrichment;
      })
    : false;

  if (!hasTopLevel && !blockHasTrace) return response;

  const clone: Record<string, unknown> = { ...asRecord };
  if (hasTopLevel) delete clone.ceeTrace;
  if (blockHasTrace && blocks) {
    clone.blocks = blocks.map((b) => {
      const blockRec = b as Record<string, unknown>;
      const enrichment = blockRec.enrichment as Record<string, unknown> | undefined;
      if (enrichment && 'ceeTrace' in enrichment) {
        const { ceeTrace: _drop, ...rest } = enrichment;
        return { ...blockRec, enrichment: rest };
      }
      return b;
    });
  }
  return clone as OlumiResponse;
}
