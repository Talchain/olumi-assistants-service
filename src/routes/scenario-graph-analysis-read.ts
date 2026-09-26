/**
 * ROADMAP 2.1271 — READ A SCENARIO'S COMMITTED ANALYSIS, OUTSIDE A TURN.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 *
 * A fresh admissible draft schedules a provisional auto-run (#999). Its
 * dispatch commits a `run_analysis` fact roughly twenty seconds after the draft
 * SSE stream's terminal COMPLETE frame has closed the socket
 * (`routes/streamed-turn-sse.ts:425`, a `finally` no branch can hold open). So
 * the result exists, is persisted, and is correct — and until this module the
 * ONLY way a browser could see it was to send another turn, because across
 * CEE's whole route surface no route returned a scenario's analysis except a
 * turn.
 *
 * Paul's ruling (2026-08-17): server calculation and automatic client delivery
 * are ONE capability. This is the read half.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IT INVENTS NOTHING. EVERY VALUE COMES FROM AN EXISTING AUTHORITY.
 *
 * That is the whole design constraint, because a second implementation of any
 * of these would be this estate's chronic defect (the two `generateGraphHash`
 * twins, the six freshness derivations) reproduced at a new surface:
 *
 *   the graph hash      `deriveDecisionContextGraphHash` — the SAME projection
 *                       (`canonicaliseForAnalysis` → `GraphStateIngressSchema`
 *                       → `computeAnalysisAffectingGraphHash`) a run's
 *                       `graph_hash_at_run` is stamped over and a turn's
 *                       `freshness.current_graph_hash` is computed with, so
 *                       `fresh` here means bit-for-bit what it means on a turn.
 *                       (CS-AN-2: this leg once hashed the RAW bytes, which
 *                       read a just-completed run as stale on any graph whose
 *                       option carriers needed promotion.)
 *   the fact read       `loadScenarioAnalysisFactsForRead`: the turn path's
 *                       own hot-window and durable readers, reconciled by
 *                       `reconcileScenarioAnalysisFacts`, with the window's
 *                       degraded status kept for the fallback.
 *   the freshness       `deriveAnalysisFreshness` — pure, and given the read
 *                       status so an unreadable store yields `unknown /
 *                       derivation_failed` rather than the positive claim
 *                       "this scenario has never been analysed".
 *   the verdict         `canonicalStateFromFreshness` + `composeAnalysisStateV1`
 *                       — the same pair the finaliser calls, so the five
 *                       usability predicates and the contradiction list cannot
 *                       disagree with a turn's.
 *   the result block    `buildAnalysisResultBlock` — the one builder, which
 *                       applies all three claim-safety layers internally from
 *                       the fact's own persisted verdict
 *                       (`mayPresentLeaderClaimForFact`, the transport keep-list,
 *                       and the withheld projections of `summary`,
 *                       `leading_option_id` and the enrichment blobs).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IT DELIBERATELY DOES **NOT** RETURN, and why each absence is the point
 *
 * NO PROSE. No `assistant_text`, no coaching, no review cards, no chips. The
 * V5 leader-claim wire gate enforces over `WIRE_ENFORCED_PROSE_FIELDS =
 * ['assistant_text', 'framing_question']` and lives inside `sendFinalised200`,
 * which is a route-local function bound to a Fastify reply and is not callable
 * from here. Rather than reproduce that gate — a second enforcement authority
 * over the estate's most honesty-sensitive payload — this leg carries NO
 * enforceable prose surface at all. Numbers and a typed verdict only.
 *
 * NO BLOCK ON A NON-`fresh` VERDICT. Derived from the producer's own lifecycle
 * tree (`orchestrator-v5/compose.ts:380-392`), not chosen here: rule 2a rebuilds
 * blocks only when `freshness === 'fresh'`; `stale` emits the rerun coaching and
 * NO result; `unknown` and `none` suppress entirely. A `stale` fact's numbers
 * describe a graph the user has since changed, so shipping them would present a
 * result about a different model. This leg therefore returns a verdict the
 * client can act on and results ONLY where a turn would also have shown them.
 *
 * NO `running`. This is the H4 seam and it is the sharpest hazard in the slice.
 * A read answers *"has a fact landed for this graph?"*. CEE keeps NO in-flight
 * marker anywhere, so mid-run the only honest answer a READ can give is that no
 * fact has landed — and `never_run` / `unknown_degraded` are what this module
 * emits. It must never be read as a contradiction of the draft turn's `running`:
 * the two authorities answer DIFFERENT QUESTIONS (trap 21), and the consumer
 * carries the corresponding obligation — see
 * `DecisionGuideAI: canvas/hydrate/applyScenarioAnalysisRead.ts`, which applies
 * a read's verdict ONLY on a TERMINAL kind and never clears a standing
 * `running`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IT NEVER THROWS AND NEVER DEGRADES THE GRAPH READ.
 *
 * The route's contract is a graph read; the analysis is ADDITIVE. Any failure
 * here yields `{ analysis_state: null, analysis_result: null }` and the graph
 * still ships — absence means "this leg could not say", which is exactly what a
 * client that has never seen the field also concludes. An analysis fault must
 * not cost the user their model.
 */

import type { OlumiResponse } from '@talchain/schemas/boundary';
import type { AnalysisStateV1 } from '@talchain/schemas/boundary';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import {
  deriveDecisionContextGraphHash,
  loadScenarioAnalysisFactsForRead,
} from '../orchestrator-v5/build-turn-context.js';
import { buildAnalysisResultBlock } from '../orchestrator-v5/compose.js';
import {
  composeAnalysisStateV1,
  readRawRobustnessFromResponseBody,
  projectAnalysisBlocksForRunBinding,
} from '../orchestrator-v5/compose/analysis-state-v1.js';
import {
  leaderWithheldOnlyBecauseUnrequested,
  mayPresentLeaderClaimForFact,
  wasAnalysisRequestedByUser,
} from '../orchestrator-v5/compose/unrequested-analysis-confinement.js';
// C46 stage 1: WHY a persisted fact's leader was withheld, when the reason is a product the analysis adds up.
import { nonlinearIdentityLeaderClaimCause } from '../orchestrator-v5/agent-lane/admit-model.js';
import { canonicalStateFromFreshness } from '../orchestrator-v5/context/canonical-analysis-state.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../orchestrator/tools/analysis-ready-helper.js';
import { deriveAnalysisFreshness, selectRunAnalysisFact } from '../orchestrator-v5/context/freshness.js';
import { isScenarioAnalysisReasoningAuthority } from '../orchestrator-v5/context/reconcile-scenario-analysis-facts.js';
import { getSessionStore } from '../orchestrator-v5/session/index.js';
import { log } from '../utils/telemetry.js';

/** The additive half of the scenario-graph read's 200 body. */
export interface ScenarioAnalysisRead {
  /**
   * The composed verdict, or `null` when this leg could not say. `null` is NOT
   * a state: it means "not answered", and a consumer must leave whatever it
   * already believed standing.
   */
  readonly analysis_state: AnalysisStateV1 | null;
  /**
   * The `analysis_result` block for the fact the verdict selected, present ONLY
   * on a fresh graph-hash verdict with no conflicting run identity. Legacy
   * identity may remain unconfirmed; its figures then carry no designation or
   * currentness claim. `null` never means "the analysis is empty".
   */
  readonly analysis_result: OlumiResponse['blocks'][number] | null;
}

const NOT_ANSWERED: ScenarioAnalysisRead = Object.freeze({
  analysis_state: null,
  analysis_result: null,
});

export interface ReadScenarioAnalysisParams {
  readonly scenarioId: string;
  /** The graph this read just returned, or `null` when the scenario has none. */
  readonly graph: unknown;
  readonly requestId: string;
  /** Atomic restore may supply the DB-returned marker and avoid a second read. */
  readonly analysisInvalidatedAt?: string | null;
}

/**
 * Compose the scenario's analysis verdict (and its current result, if any) from
 * persisted facts alone. Total: never throws, never mutates, no model call.
 */
export async function readScenarioAnalysis(
  params: ReadScenarioAnalysisParams,
): Promise<ScenarioAnalysisRead> {
  try {
    // A scenario with no graph has nothing for a hash to anchor to, so the
    // freshness derivation could only ever return `unknown /
    // current_graph_hash_unavailable`. Saying "not answered" is the same
    // information without spending a store read on it.
    if (params.graph === null || params.graph === undefined) return NOT_ANSWERED;

    // ⭐ CS-AN-2 — THE FRESHNESS HASH IS THE CANONICAL ONE, THE HASH THE RUN
    // STAMPED. `loadScenarioSnapshotForRunAnalysis` hands run_analysis
    // `rawPersistedGraph: canonicaliseForAnalysis(persistedGraph)`, and
    // run-analysis.ts stamps `graph_hash_at_run` over that after
    // `GraphStateIngressSchema.safeParse`. The turn path compares against the
    // same projection. This leg used to hash the RAW persisted bytes, so on any
    // graph whose option-intervention carriers need promotion (DGAI autosave
    // shape: `node.data.interventions`, raw_value-only entries, …) a reload
    // straight after a successful run said `complete_stale / graph_changed`
    // and withheld the result the user had just computed.
    // `deriveDecisionContextGraphHash` is exactly that projection, shared with
    // the turn path rather than re-assembled here.
    //
    // ⚠ ON A GRAPH WHOSE CANONICAL PROJECTION DOES NOT PARSE, THIS FAILS
    // CLOSED, AND THAT COSTS A RESULT. `deriveDecisionContextGraphHash` returns
    // null, `deriveAnalysisFreshness` reports `unknown /
    // current_graph_hash_unavailable`, and the wire says `run_state:
    // unknown_degraded / no_graph_this_turn` with NO `analysis_result`. That is
    // the turn path's answer too (turn-executor.ts `selectedGraphForFreshness`
    // → `currentAnalysisGraphHashForTurn`). It is NOT free: a graph that stops
    // parsing after its run (a node loses its label — no hashed field moves,
    // the RAW hash still equals the stamp) loses a result the raw-hash leg
    // would have served as current. Currency cannot be verified there, so
    // withholding is the chosen side. And the cause `no_graph_this_turn` is
    // imprecise on a reload that DID return a graph — a named follow-up, not
    // fixed here. (Pinned: `scenario-analysis-canonical-hash.test.ts`,
    // UNPARSEABLE AFTER RUN.)
    //
    // ⚠ THIS IS DELIBERATELY NOT THE ROUTE'S WIRE `graph_hash`, and on a
    // repaired-shape graph the two differ. The wire value
    // (`assist.v1.scenario-graph.ts`) is the manual-edit compare-and-set base,
    // and the writers derive their expected base from the RAW persisted graph
    // (`graph-cas-conflict.ts` `hashesForRawGraph`); moving it would put the
    // base out of step with the writer on exactly these graphs. The question
    // here is different — "does this run's result belong
    // to this model?" — and only the projection the run was stamped over can
    // answer it. The one hash this leg ships, `analysis_result.
    // computed_against_hash`, is the fact's own `graph_hash_at_run` (the
    // canonical stamp), never recomputed here: it states what the run was
    // computed against, so it must stay the run's value. A consumer comparing
    // it to the wire `graph_hash` on a repaired-shape graph will see them
    // differ; `analysis_state.run_state` is the currency verdict.
    const currentGraphHash = deriveDecisionContextGraphHash(params.graph);

    const store = getSessionStore();
    const [{ hotWindow, factSet }, analysisInvalidatedAt] = await Promise.all([
      loadScenarioAnalysisFactsForRead(params.scenarioId, params.requestId),
      params.analysisInvalidatedAt !== undefined
        ? Promise.resolve(params.analysisInvalidatedAt)
        : store.readAnalysisInvalidatedAt?.(params.scenarioId) ?? Promise.resolve(null),
    ]);
    // ⚠ THE READ STATUS IS THREADED, and it is load-bearing. An empty fact list
    // is ambiguous: it means "never analysed" OR "the store read failed".
    // `deriveAnalysisFreshness` only distinguishes them when told, and reading a
    // failed read as `none` would be a POSITIVE claim ("this scenario has never
    // been analysed") that this leg cannot support — and on the auto-run path it
    // would terminate the client's wait with the wrong answer.
    //
    // ⭐ THE SCENARIO'S ANALYSIS RECORD, NOT THE LAST 20 ROWS. This leg used to
    // read facts through the `readRecent` window alone. Every value op and every
    // Agent turn is a row, so after ~20 of them the run's turn aged out, and the
    // reload reported `none / never_run` and returned no result for a scenario
    // that HAS one. The reconciled durable set is the same authority the turn
    // path reads (`scenario_analysis_fact_set`). When it is not authority
    // (`degraded`), this leg keeps the window behaviour it always had.
    //
    // ⚠ ABSENCE IS AUTHORITATIVE ONLY FOR THE COMPLETE RECORD. `capped` carries
    // the newest real facts, but unread history sits behind the wall. Reading
    // "no success in that page" as `none` would be a positive "never analysed"
    // claim, so under `capped` an empty selection stays `unknown`. This is the
    // turn path's own rule (`build-turn-context.ts`, `scenarioAnalysisFactsReadOk`).
    //
    // ⚠ AND NEVER FOR THE WINDOW FALLBACK. When the durable read is `degraded`
    // the hot window is still read — a success in it is positive evidence and is
    // compared by hash as before — but an EMPTY window is 20 rows, not the
    // record: a run can sit behind it. So absence there is never authoritative
    // and an empty selection reads `unknown / derivation_failed`, not
    // `none / never_run` (Codex pre-review finding 5824695259). `readOk` is
    // consulted only when no fact is selected, so this changes nothing else.
    // Same rule as the turn path: only `complete` licenses "never analysed".
    const durableAuthority = isScenarioAnalysisReasoningAuthority(factSet);
    const facts = durableAuthority ? factSet.facts : hotWindow.facts;
    const factsReadOk = factSet.status === 'complete';
    const derivation = deriveAnalysisFreshness(facts, currentGraphHash, undefined, {
      priorFactsReadOk: factsReadOk,
      analysisInvalidatedAt,
    });

    // The result block first, so the verdict's `leader_claim` can be composed
    // against the robustness signals the consumer ACTUALLY receives — the same
    // reason `finaliseV5Response` reads them off the body rather than off the
    // fact.
    // Historical selection is independent of permission to display a CURRENT
    // result. A changed graph must not replace the original run's hash/time.
    const historical = selectRunAnalysisFact(facts);
    const selected = derivation.freshness === 'fresh' ? historical : null;
    const fact =
      selected !== null && selected.fact.fact_type === 'run_analysis'
        ? (selected.fact as RunAnalysisHandlerFact)
        : null;
    const analysisResult = fact !== null ? buildAnalysisResultBlock(fact) : null;

    // ⭐ (B) THE ONE ADMISSION VERDICT — the SAME authority and the SAME
    // threading the turn replies use (`route-v2.ts` passes
    // `{ readiness: ctx.analysisReady }`; the finaliser passes it to both
    // composers). Before (B) this leg passed `{}`, so every reload read
    // readiness `{unknown, []}` beside a model the Run control refused.
    // FAIL-SOFT: a throw here keeps the unsupplied verdict (the pre-(B)
    // behaviour) instead of losing the whole additive analysis read.
    let analysisReady: ReturnType<typeof buildCanonicalAnalysisReadyFromGraph>;
    try {
      analysisReady = buildCanonicalAnalysisReadyFromGraph(params.graph);
    } catch (err) {
      analysisReady = undefined;
      log.warn(
        {
          event: 'v5.scenario_graph.analysis_read_admission_failed',
          request_id: params.requestId,
          scenario_id: params.scenarioId,
          err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
        },
        'Scenario graph read — admission verdict unavailable; readiness stays unsupplied',
      );
    }

    const analysisState =
      composeAnalysisStateV1({
        canonical: canonicalStateFromFreshness(
          derivation,
          analysisReady !== undefined ? { readiness: analysisReady } : {},
        ),
        freshness: derivation,
        ...(analysisReady !== undefined ? { readiness: analysisReady } : {}),
        ...(historical === null ? {} : {
          runFactBinding: {
            scenarioId: params.scenarioId,
            selectedResult: historical.fact.result,
          },
        }),
        // ⚠ NOT hardcoded `false`. The entitlement is read from the SELECTED
        // FACT by the canonical fail-closed reader — the same one
        // `buildAnalysisResultBlock` uses internally — so the verdict's
        // `leader_claim` and the block's projections answer the SAME question
        // about the SAME fact. Two answers here would be trap 21 at a new
        // surface. With no fact, `false` is the fail-closed direction.
        //
        // ⭐⭐ AND THAT SENTENCE IS WHY THIS LINE MOVED TO
        // `mayPresentLeaderClaimForFact`. The block builder stopped answering
        // the constraint-verdict question alone the day the post-draft auto-run
        // gained a confinement: it now also asks whether anybody REQUESTED the
        // analysis. This leg is the auto-run's OWN delivery path, so keeping the
        // leaf reader here would have made the paragraph above false at exactly
        // the surface it was written about — an `analysis_result` naming no
        // leader, beside an `analysis_state.leader_claim.permitted: true` that
        // grants the UI permission to name one. Same fact, same second, two
        // answers. The shared admission is the fix; copying the conjunction here
        // would have been the mirror.
        mayNameLeadingOption: fact !== null ? mayPresentLeaderClaimForFact(fact) : false,
        // WHY it is withheld, when the fact can prove it: its own constraint verdict
        // permitted a leader and nobody asked for this run (the automatic first
        // pass). Otherwise the constraint token stands (#63 5825404689).
        // C46 (AI Quality option (i), #70 5842615260): the product takes the field only when the fact's own
        // constraint verdict permitted; a first pass keeps the unrequested code. Bound to the ONE fact the
        // permission above was read from, and judged on the graph the run ANALYSED (OpenAI Runtime #70
        // 5843934816): `currentGraphHash` is this route's own freshness hash of `params.graph`, the value it
        // compared with the fact's `graph_hash_at_run`; the cause is refused unless the two are equal.
        ...(() => {
          const c46 = fact !== null
            ? nonlinearIdentityLeaderClaimCause({
              graph: params.graph,
              graphHash: currentGraphHash,
              result: fact.result,
              requested: wasAnalysisRequestedByUser(fact),
            })
            : null;
          return {
            withheldBecauseUnrequested: (fact !== null && leaderWithheldOnlyBecauseUnrequested(fact)) || c46?.withheldBecauseUnrequested === true,
            withheldBecauseNonlinearIdentity: c46?.withheldBecauseNonlinearIdentity === true,
          };
        })(),
        rawRobustness:
          analysisResult !== null
            ? readRawRobustnessFromResponseBody({ blocks: [analysisResult] })
            : null,
      }) ?? null;

    const boundResult = analysisResult !== null && analysisState !== null
      ? projectAnalysisBlocksForRunBinding([analysisResult], analysisState)[0] ?? null
      : analysisResult;
    return { analysis_state: analysisState, analysis_result: boundResult };
  } catch (err) {
    // ADDITIVE MEANS ADDITIVE: the graph read stands whatever happens here.
    log.warn(
      {
        event: 'v5.scenario_graph.analysis_read_failed',
        request_id: params.requestId,
        scenario_id: params.scenarioId,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'Scenario graph read — analysis composition failed; graph still served without it',
    );
    return NOT_ANSWERED;
  }
}
