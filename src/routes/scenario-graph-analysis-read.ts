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
 *   the graph hash      `computeAnalysisAffectingGraphHash` — the SAME function
 *                       `freshness.current_graph_hash` and a run's
 *                       `graph_hash_at_run` are computed with, so `fresh` here
 *                       means bit-for-bit what it means on a turn.
 *   the fact read       `loadPriorFactsWithReadState` — the observational read
 *                       the turn path uses, including its degraded status.
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
 *                       (`mayNameLeadingOptionForFact`, the transport keep-list,
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

import { loadPriorFactsWithReadState } from '../orchestrator-v5/build-turn-context.js';
import { buildAnalysisResultBlock } from '../orchestrator-v5/compose.js';
import {
  composeAnalysisStateV1,
  readRawRobustnessFromResponseBody,
} from '../orchestrator-v5/compose/analysis-state-v1.js';
import { mayNameLeadingOptionForFact } from '../orchestrator-v5/compose/withheld-claim-projection.js';
import { canonicalStateFromFreshness } from '../orchestrator-v5/context/canonical-analysis-state.js';
import { deriveAnalysisFreshness, selectRunAnalysisFact } from '../orchestrator-v5/context/freshness.js';
import { computeAnalysisAffectingGraphHash } from '../orchestrator-v5/context/graph-hash.js';
import { getSessionStore } from '../orchestrator-v5/session/index.js';
import type { GraphStateIngress } from '../orchestrator-v5/boundary/request-extensions.js';
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
   * on a `fresh` verdict. `null` means no CURRENT result is being delivered —
   * never "the analysis is empty".
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

    const currentGraphHash = computeAnalysisAffectingGraphHash(
      params.graph as GraphStateIngress,
    );

    const store = getSessionStore();
    const [read, analysisInvalidatedAt] = await Promise.all([
      loadPriorFactsWithReadState(params.scenarioId, params.requestId),
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
    const derivation = deriveAnalysisFreshness(read.facts, currentGraphHash, undefined, {
      priorFactsReadOk: read.status === 'ok',
      analysisInvalidatedAt,
    });

    // The result block first, so the verdict's `leader_claim` can be composed
    // against the robustness signals the consumer ACTUALLY receives — the same
    // reason `finaliseV5Response` reads them off the body rather than off the
    // fact.
    const selected = derivation.freshness === 'fresh' ? selectRunAnalysisFact(read.facts) : null;
    const fact =
      selected !== null && selected.fact.fact_type === 'run_analysis'
        ? (selected.fact as RunAnalysisHandlerFact)
        : null;
    const analysisResult = fact !== null ? buildAnalysisResultBlock(fact) : null;

    const analysisState =
      composeAnalysisStateV1({
        canonical: canonicalStateFromFreshness(derivation, {}),
        freshness: derivation,
        // ⚠ NOT hardcoded `false`. The entitlement is read from the SELECTED
        // FACT by the canonical fail-closed reader — the same one
        // `buildAnalysisResultBlock` uses internally — so the verdict's
        // `leader_claim` and the block's projections answer the SAME question
        // about the SAME fact. Two answers here would be trap 21 at a new
        // surface. With no fact, `false` is the fail-closed direction.
        mayNameLeadingOption: fact !== null ? mayNameLeadingOptionForFact(fact) : false,
        rawRobustness:
          analysisResult !== null
            ? readRawRobustnessFromResponseBody({ blocks: [analysisResult] })
            : null,
      }) ?? null;

    return { analysis_state: analysisState, analysis_result: analysisResult };
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
