/**
 * V5 Coaching State Spine — Stage 2A: deterministic CURRENT-TURN coaching signal
 * derivation.
 *
 * Projects an internal `CoachingState` container — a set of `CoachingStateSignal`s
 * with stable IDs and a current `active | stale | unavailable` status — purely from
 * already-structured canonical state for THIS turn. It is the foundation Stage 2B
 * (durable lifecycle: prior/current comparison, `resolved`/`dismissed`/…) and Stage 3
 * (surfacing) will consume.
 *
 * Discipline (mirrors decision-context.ts):
 *   - PROJECTION, NOT INFERENCE. Every signal is derived from a structured,
 *     deterministic source (decision_context status, the analysis-freshness verdict,
 *     structural readiness blockers, a present `defaulted` graph field, present
 *     decision_review `evidence_enhancements`). Nothing here reads free text,
 *     classifies stakes/intent/priority, calls an LLM, or uses Date.now()/randomness.
 *   - CURRENT-TURN ONLY. No prior-state reads, no transitions. Status `stale`/
 *     `unavailable` describe the CURRENT evidence, not a lifecycle. There is
 *     deliberately NO `resolved` status in Stage 2A (it requires prior-signal
 *     knowledge — Stage 2B).
 *   - Pure + total: never throws; any internal failure collapses to a `degraded`
 *     container (`DEGRADED_COACHING_STATE`).
 *
 * `kind` vs `status` are orthogonal: `kind` names the world-condition being signalled,
 * `status` is the signal's current standing. So `kind:'analysis_stale', status:'active'`
 * = "the analysis-is-stale signal is currently in effect", and
 * `kind:'analysis_stale', status:'unavailable'` = "we cannot determine staleness because
 * the comparable hash is missing". Stage 2B compares signals by `signal_id` across turns;
 * do not conflate `status:'stale'` (a single-producer current-turn property) with
 * `kind:'analysis_stale'`.
 *
 * INTERNAL ONLY: attached to `EnrichedTurnContext`, never serialised on the wire, never
 * added to the LLM-facing ContextPack or the routing prompt. Distinct from the durable
 * `v5_coaching_state` table that Stage 2B will introduce, and from the existing Step-5
 * coaching-TEXT detector in `../signals/coaching-signals.ts` (`CoachingSignal*`), which
 * is an unrelated concept.
 *
 * Import-cycle note: this module must NOT import `build-turn-context.ts` or
 * `context/readiness.ts` (the latter imports `EnrichedTurnContext`). The decision_review
 * walk is inlined here using the exported `selectRunAnalysisFact`.
 */

import type { DecisionContext, HandlerFact } from '@talchain/schemas/orchestrator';

import { GraphV3 } from '../../schemas/cee-v3.js';
import { computeStructuralReadiness } from '../../orchestrator/tools/analysis-ready-helper.js';
import { selectRunAnalysisFact, type FreshnessDerivation } from '../context/freshness.js';
import { summariseReadiness } from '../routing/readiness-summary.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CoachingStateSignalKind =
  | 'decision_context_missing'
  | 'analysis_missing'
  | 'analysis_stale'
  | 'readiness_blocker'
  | 'defaulted_or_unknown_value'
  | 'evidence_gap_available';

/** Current standing of a signal. NO `resolved`/`dismissed`/… in Stage 2A (Stage 2B). */
export type CoachingStateSignalStatus = 'active' | 'stale' | 'unavailable';

export type CoachingStateSignalSource =
  | 'decision_context'
  | 'analysis_freshness'
  | 'analysis_readiness'
  | 'graph_projection'
  | 'existing_enrichment';

/**
 * Closed reason-code enum → low telemetry cardinality and a stable `signal_id`
 * (`${kind}:${reason_code}`) for Stage 2B comparison. Never a raw label / user text.
 */
export type CoachingStateReasonCode =
  | 'not_populated'
  | 'no_successful_run_analysis_fact'
  | 'graph_hash_diverged'
  | 'legacy_fact_missing_hash'
  | 'current_graph_hash_unavailable'
  | 'staleness_indeterminate'
  | 'too_few_options'
  | 'option_needs_mapping'
  | 'option_needs_encoding'
  | 'goal_threshold_missing'
  | 'goal_node_missing'
  | 'edge_strength_defaulted'
  | 'evidence_enhancements_present'
  | 'evidence_enhancements_absent';

export interface CoachingStateSignal {
  /** Deterministic, stable, low-cardinality: `${kind}:${reason_code}`. */
  readonly signal_id: string;
  readonly kind: CoachingStateSignalKind;
  readonly status: CoachingStateSignalStatus;
  readonly source: CoachingStateSignalSource;
  /** Current persisted-graph hash this signal was derived against (provenance). */
  readonly graph_hash: string | null;
  /**
   * The graph hash captured at analysis-run time (`FreshnessDerivation.graph_hash_at_run`)
   * for analysis-derived signals; null otherwise. This is the only analysis-freshness
   * linkage that exists — it is NOT a canonical analysis content hash (none exists),
   * hence the honest name.
   */
  readonly analysis_graph_hash: string | null;
  readonly reason_code: CoachingStateReasonCode;
  readonly created_from: 'derived_current_turn';
}

export interface CoachingState {
  readonly version: 'v1';
  readonly status: 'empty' | 'active' | 'degraded';
  readonly graph_hash: string | null;
  readonly analysis_graph_hash: string | null;
  readonly signals: readonly CoachingStateSignal[];
  readonly summary: {
    readonly active_count: number;
    readonly stale_count: number;
    readonly unavailable_count: number;
  };
}

export const EMPTY_COACHING_STATE: CoachingState = Object.freeze({
  version: 'v1',
  status: 'empty',
  graph_hash: null,
  analysis_graph_hash: null,
  signals: [],
  summary: { active_count: 0, stale_count: 0, unavailable_count: 0 },
});

export interface DeriveCoachingStateInput {
  /** Stage-1 DecisionContext projection (already on the turn context). */
  readonly decisionContext: DecisionContext;
  /**
   * The analysis-freshness verdict, derived once by the caller from the SAME single
   * source of truth (`deriveAnalysisFreshness`) used by routing — reused here, never
   * recomputed with a different input, so there is no second freshness signal.
   */
  readonly freshness: FreshnessDerivation;
  /** Prior handler facts (for the decision_review / evidence-gap walk). */
  readonly priorFacts: readonly HandlerFact[];
  /** Current persisted-graph hash (canonical). */
  readonly graphHash: string | null;
  /** Raw persisted `scenarios.graph` (permissive reads — no strict parse required). */
  readonly persistedGraph: unknown | null;
}

// Defensive cap on total signals (the set is naturally bounded to <=9; this guards
// against any future kind looping unexpectedly).
const MAX_SIGNALS = 24;

// Stable readiness-blocker ordering so the derived array is deterministic.
const READINESS_REASON_ORDER: readonly CoachingStateReasonCode[] = [
  'goal_node_missing',
  'too_few_options',
  'option_needs_mapping',
  'option_needs_encoding',
  'goal_threshold_missing',
];

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Derive the current-turn CoachingState. Pure + total.
 *
 * Container status: `degraded` on a caught error; else `active` when >=1 signal was
 * derived; else `empty` (zero signals). A `not_populated` decision context therefore
 * yields `decision_context_missing` (active) and a container status of `active`, not
 * `empty` — `empty` means genuinely nothing to flag this turn.
 */
export function deriveCoachingState(input: DeriveCoachingStateInput): CoachingState {
  try {
    const { decisionContext, freshness, priorFacts, graphHash, persistedGraph } = input;
    const analysisGraphHash = freshness.graph_hash_at_run;

    const signals: CoachingStateSignal[] = [
      ...deriveDecisionContextSignals(decisionContext, graphHash),
      ...deriveAnalysisSignals(freshness, graphHash),
      ...deriveReadinessSignals(persistedGraph, graphHash),
      ...deriveDefaultedValueSignals(persistedGraph, graphHash),
      ...deriveEvidenceGapSignals(priorFacts, freshness, graphHash),
    ].slice(0, MAX_SIGNALS);

    const summary = summarise(signals);
    const status: CoachingState['status'] = signals.length === 0 ? 'empty' : 'active';

    return {
      version: 'v1',
      status,
      graph_hash: graphHash,
      analysis_graph_hash: analysisGraphHash,
      signals,
      summary,
    };
  } catch {
    return {
      ...EMPTY_COACHING_STATE,
      status: 'degraded',
      graph_hash: input?.graphHash ?? null,
    };
  }
}

// ---------------------------------------------------------------------------
// Per-kind derivation (each pure, each returns 0+ signals)
// ---------------------------------------------------------------------------

function deriveDecisionContextSignals(
  decisionContext: DecisionContext,
  graphHash: string | null,
): CoachingStateSignal[] {
  if (decisionContext.status !== 'not_populated') return [];
  return [
    makeSignal(
      'decision_context_missing',
      'active',
      'decision_context',
      'not_populated',
      graphHash,
      null,
    ),
  ];
}

function deriveAnalysisSignals(
  freshness: FreshnessDerivation,
  graphHash: string | null,
): CoachingStateSignal[] {
  switch (freshness.freshness) {
    case 'none':
      // No successful run_analysis fact at all → analysis is missing.
      return [
        makeSignal(
          'analysis_missing',
          'active',
          'analysis_freshness',
          'no_successful_run_analysis_fact',
          graphHash,
          null,
        ),
      ];
    case 'stale':
      // Analysis exists but the graph has diverged from it.
      return [
        makeSignal(
          'analysis_stale',
          'active',
          'analysis_freshness',
          'graph_hash_diverged',
          graphHash,
          freshness.graph_hash_at_run,
        ),
      ];
    case 'unknown':
      // Analysis exists but the comparable hash is missing → cannot safely determine
      // staleness. `unavailable` per the Stage-2A definition ("required structured
      // data is missing").
      return [
        makeSignal(
          'analysis_stale',
          'unavailable',
          'analysis_freshness',
          mapUnknownFreshnessReason(freshness.reason),
          graphHash,
          freshness.graph_hash_at_run,
        ),
      ];
    case 'fresh':
    default:
      return [];
  }
}

function deriveReadinessSignals(
  persistedGraph: unknown | null,
  graphHash: string | null,
): CoachingStateSignal[] {
  try {
    if (persistedGraph == null) return [];
    const parsed = GraphV3.safeParse(persistedGraph);
    if (!parsed.success) return []; // unparseable → cannot assess structural readiness
    const readiness = computeStructuralReadiness(parsed.data);
    if (readiness === undefined) {
      // No goal node — the strongest "not ready" structural blocker, which
      // computeStructuralReadiness reports only by returning undefined.
      return [
        makeSignal(
          'readiness_blocker',
          'active',
          'analysis_readiness',
          'goal_node_missing',
          graphHash,
          null,
        ),
      ];
    }
    const { open_items } = summariseReadiness(readiness);
    // Dedupe by kind (option_needs_* can repeat per option) and order deterministically.
    const kinds = new Set<CoachingStateReasonCode>();
    for (const item of open_items) kinds.add(item.kind);
    return READINESS_REASON_ORDER.filter((reason) => kinds.has(reason)).map((reason) =>
      makeSignal('readiness_blocker', 'active', 'analysis_readiness', reason, graphHash, null),
    );
  } catch {
    // Defence-in-depth: structural readiness is best-effort; never let it degrade the
    // whole container.
    return [];
  }
}

function deriveDefaultedValueSignals(
  persistedGraph: unknown | null,
  graphHash: string | null,
): CoachingStateSignal[] {
  // Permissive raw read mirroring decision-context.ts readGraphNodes guards. `defaulted`
  // is a genuine structured boolean on edges (z.boolean().optional()); test `=== true`.
  if (!persistedGraph || typeof persistedGraph !== 'object') return [];
  const edges = (persistedGraph as { edges?: unknown }).edges;
  if (!Array.isArray(edges)) return [];
  const hasDefaulted = edges.some(
    (e) => e != null && typeof e === 'object' && (e as { defaulted?: unknown }).defaulted === true,
  );
  if (!hasDefaulted) return [];
  return [
    makeSignal(
      'defaulted_or_unknown_value',
      'active',
      'graph_projection',
      'edge_strength_defaulted',
      graphHash,
      null,
    ),
  ];
}

function deriveEvidenceGapSignals(
  priorFacts: readonly HandlerFact[],
  freshness: FreshnessDerivation,
  graphHash: string | null,
): CoachingStateSignal[] {
  const review = selectDecisionReview(priorFacts);
  // Honesty rule: only emit from a genuinely-present structured decision_review.
  // decision_review is gated off by default (autofire disabled), so this signal is
  // normally absent — never manufacture an evidence gap from graph structure.
  if (review === null) return [];

  const analysisGraphHash = freshness.graph_hash_at_run;
  if (!review.evidenceNonEmpty) {
    // Enrichment present but the structured evidence field is absent/empty → the
    // signal is in scope but cannot be derived from a present field.
    return [
      makeSignal(
        'evidence_gap_available',
        'unavailable',
        'existing_enrichment',
        'evidence_enhancements_absent',
        graphHash,
        analysisGraphHash,
      ),
    ];
  }
  // Present + non-empty evidence. `stale` when the underlying analysis has diverged from
  // the current graph (the one real Stage-2A producer of `stale`); otherwise `active`.
  const status: CoachingStateSignalStatus = freshness.freshness === 'stale' ? 'stale' : 'active';
  return [
    makeSignal(
      'evidence_gap_available',
      status,
      'existing_enrichment',
      'evidence_enhancements_present',
      graphHash,
      analysisGraphHash,
    ),
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSignal(
  kind: CoachingStateSignalKind,
  status: CoachingStateSignalStatus,
  source: CoachingStateSignalSource,
  reason_code: CoachingStateReasonCode,
  graph_hash: string | null,
  analysis_graph_hash: string | null,
): CoachingStateSignal {
  return {
    signal_id: `${kind}:${reason_code}`,
    kind,
    status,
    source,
    graph_hash,
    analysis_graph_hash,
    reason_code,
    created_from: 'derived_current_turn',
  };
}

function summarise(signals: readonly CoachingStateSignal[]): CoachingState['summary'] {
  let active_count = 0;
  let stale_count = 0;
  let unavailable_count = 0;
  for (const s of signals) {
    if (s.status === 'active') active_count += 1;
    else if (s.status === 'stale') stale_count += 1;
    else unavailable_count += 1;
  }
  return { active_count, stale_count, unavailable_count };
}

/**
 * Map a freshness `unknown` reason to a Stage-2A reason code. The expected pure-path
 * reasons are surfaced verbatim; anything else (e.g. an invariant failure) collapses to
 * `staleness_indeterminate` so the reason-code enum stays closed.
 */
function mapUnknownFreshnessReason(reason: FreshnessDerivation['reason']): CoachingStateReasonCode {
  if (reason === 'legacy_fact_missing_hash') return 'legacy_fact_missing_hash';
  if (reason === 'current_graph_hash_unavailable') return 'current_graph_hash_unavailable';
  return 'staleness_indeterminate';
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Inlined decision_review reader (avoids importing context/readiness.ts, which would
 * create an import cycle via EnrichedTurnContext). Walks the newest successful
 * run_analysis fact → `result.enrichment.decision_review.evidence_enhancements`,
 * treating `evidence_enhancements` as a Record (its real shape — NOT an array).
 */
function selectDecisionReview(
  priorFacts: readonly HandlerFact[],
): { readonly evidenceNonEmpty: boolean } | null {
  const selected = selectRunAnalysisFact(priorFacts);
  if (selected === null) return null;
  const result = selected.fact.fact_type === 'run_analysis' ? selected.fact.result : null;
  const resultRecord = readRecord(result);
  const enrichment = resultRecord ? readRecord(resultRecord.enrichment) : null;
  const decisionReview = enrichment ? readRecord(enrichment.decision_review) : null;
  if (decisionReview === null) return null;
  const evidence = readRecord(decisionReview.evidence_enhancements);
  return { evidenceNonEmpty: evidence !== null && Object.keys(evidence).length > 0 };
}
