/**
 * V5 Task 1.4 — analysis state fallback for follow-up turns.
 *
 * The HTTP request body carries `analysis_state` when the UI has it cached
 * client-side. On turns where the UI omits it but a prior `run_analysis`
 * handler DID run in this scenario, the handler persisted its result into a
 * `RunAnalysisHandlerFact.result`. This module builds a minimal fallback
 * summary from that fact so Sonnet is not blind to prior analysis on
 * conversational follow-up turns.
 *
 * Staleness handling (V5 state-trust — supersedes the original "Approach A"):
 * fallback summaries are NOT always freshness-unknown. The run fact now
 * carries `graph_hash_at_run` (schema 0.10.0+), so freshness is derived
 * deterministically by comparing it against the current graph hash (see
 * `deriveAnalysisFreshness` in `freshness.ts`). The legacy
 * `loaded_from_prior_run_freshness_unknown` reason
 * ({@link FALLBACK_STALENESS_REASON}) is applied by the turn-executor ONLY
 * when that structured verdict is `stale` or `unknown` — never when the
 * fallback analysis is `fresh` (reason `graph_hash_match`). Structured
 * freshness on TurnOutcome / analysis_ready is the single source of truth for
 * copy and routing decisions; this module builds the projection only and does
 * not stamp the reason itself.
 *
 * Enrichment passthrough (V5 post-analysis projection enrichment):
 * The run-analysis handler stores the full V2RunResponseEnvelope verbatim
 * in `result.enrichment` (byte-for-byte; see run-analysis.ts §6). When that
 * field is well-formed, this module reuses `compactAnalysis()` so the
 * fallback projection includes top_drivers, robustness_level, and
 * fragile_edges instead of empty defaults. Fields are sourced from BOTH
 * top-level `enrichment.factor_sensitivity[]` (the staging shape — entries
 * carry `{label, elasticity, direction}`) AND per-option
 * `enrichment.results[].factor_sensitivity[]` — whichever the payload
 * actually carries.
 *
 * Non-goals:
 *   - No new DB reads — `prior_facts` is already loaded by `buildTurnContext`
 *     for the coaching cache.
 *   - Option labels: when a fact omits enrichment we fall through to a
 *     minimal extraction from `result.win_probabilities`; option IDs stand
 *     in as labels there. The routing prompt resolves them via the
 *     ContextPack graph when the user asks about a specific option.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  compactAnalysis,
  type AnalysisResponseSummary,
  type DriverSummary,
  type FragileEdge,
  type OptionSummary,
} from '../../orchestrator/context/analysis-compact.js';
import {
  buildNodeLabelMap,
  readGraph,
  sanitiseLabel,
} from './enrichment-graph-labels.js';
import {
  resolveInfluenceDirection,
  type InfluenceDirection,
} from '../../orchestrator/context/influence-direction.js';
import { readDriverInfluenceScore } from '../../orchestrator/context/driver-influence.js';
import { isRecommendableTypedOption } from '../tools/handlers/recommendable-option.js';
import type { V2RunResponseEnvelope } from '../../orchestrator/types.js';
import {
  deriveConfidenceTierFromEnrichment,
  deriveEvidenceGapsFromEnrichment,
  deriveGoalFitFromEnrichment,
  deriveOptionGoalFitsFromEnrichment,
  deriveOptionOutcomesFromEnrichment,
  deriveTippingPointsFromTopLevel,
  type AnalysisResponseSummaryWithSignals,
} from './analysis-signals.js';
import { selectRunAnalysisFact } from './freshness.js';

export const FALLBACK_STALENESS_REASON = 'loaded_from_prior_run_freshness_unknown';

/**
 * V5 review: option-label lookup for the fallback projection. The fact
 * carries only option IDs, but when the current ContextPack graph has a
 * matching option node we prefer its user-facing label — otherwise Sonnet
 * could surface raw IDs like "opt_a" in responses.
 */
export interface OptionLabelSource {
  readonly id: string;
  readonly label?: string | null;
}

function buildLabelMap(
  optionNodes: readonly OptionLabelSource[] | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of optionNodes ?? []) {
    const label = typeof node.label === 'string' ? node.label.trim() : '';
    if (label.length > 0) map.set(node.id, label);
  }
  return map;
}

/**
 * Derive top drivers from a TOP-LEVEL `enrichment.factor_sensitivity[]`
 * array — the shape PLoT actually returns on staging.
 *
 * DGAI #341: entries are RANKED by `influence_score` via the shared accessor
 * (`readDriverInfluenceScore`) — the field ISL actually ranks
 * (`influence_rank`) and the UI displays. Entries without a usable
 * influence_score are omitted; `sensitivity` / `elasticity` are never a
 * ranking fallback (on an intervention_override board they are zeroed
 * artifacts that invert the ranking). `DriverSummary.sensitivity` carries the
 * influence magnitude (field name kept for shape compatibility).
 *
 * `compactAnalysis()`'s `deriveTopDrivers` only walks
 * `results[].factor_sensitivity` (per-option) and misses the top-level
 * array entirely. This helper closes that gap so Step 5 actually sees
 * driver figures from prior facts.
 */
function deriveTopDriversFromTopLevel(
  enrichment: Record<string, unknown>,
): DriverSummary[] {
  const raw = enrichment.factor_sensitivity;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const factorMap = new Map<
    string,
    { label: string; absSensitivity: number; direction: InfluenceDirection }
  >();

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;

    // DGAI #341: driver RANKING reads the shared influence accessor
    // (`influence_score` only — what ISL ranks and the UI displays). An entry
    // without a usable influence_score is NOT a driver candidate; the former
    // `sensitivity → elasticity` fallback latched onto the only non-zero
    // elasticity artifact on an intervention_override board and named the
    // LEAST influential factor as top driver.
    const influence = readDriverInfluenceScore(e);
    if (influence === null) continue;

    const factorId =
      typeof e.factor_id === 'string' ? e.factor_id
      : typeof e.node_id === 'string' ? e.node_id
      : typeof e.id === 'string' ? e.id
      : typeof e.label === 'string' ? e.label
      : typeof e.factor_label === 'string' ? e.factor_label
      : null;
    if (!factorId) continue;

    const label =
      typeof e.factor_label === 'string' && e.factor_label.length > 0 ? e.factor_label
      : typeof e.label === 'string' && e.label.length > 0 ? e.label
      : factorId;

    // Honour the authoritative `direction` enum ('positive'|'negative'|
    // 'neutral'); when it is absent, sign-derive from the SIGN of the legacy
    // signed magnitude when one exists (`sensitivity` then `elasticity` —
    // sign only, never the magnitude; DGAI #341), else from the non-negative
    // influence score (⇒ 'positive'). Preserves pre-#341 direction behaviour.
    const signedForDirection =
      typeof e.sensitivity === 'number' && Number.isFinite(e.sensitivity)
        ? e.sensitivity
        : typeof e.elasticity === 'number' && Number.isFinite(e.elasticity)
          ? e.elasticity
          : influence;
    const direction: InfluenceDirection = resolveInfluenceDirection(e.direction, signedForDirection);

    const absSensitivity = influence;
    const existing = factorMap.get(factorId);
    if (!existing || absSensitivity > existing.absSensitivity) {
      factorMap.set(factorId, { label, absSensitivity, direction });
    }
  }

  return Array.from(factorMap.entries())
    .sort((a, b) => {
      const diff = b[1].absSensitivity - a[1].absSensitivity;
      if (diff !== 0) return diff;
      return a[0].localeCompare(b[0]);
    })
    .slice(0, 5)
    .map(([factorId, { label, absSensitivity, direction }]) => ({
      factor_id: factorId,
      factor_label: label,
      sensitivity: absSensitivity,
      direction,
    }));
}

/**
 * Derive renderable fragile edges from a TOP-LEVEL
 * `enrichment.robustness.fragile_edges[]` — the shape PLoT actually returns
 * on staging (robustness sits at the envelope top level, NOT per option;
 * `enrichment.results` is often absent — only `option_comparison`, whose
 * entries carry no `.robustness`). `compactAnalysis`'s `deriveTopFragileEdges`
 * only walks per-option `results[].robustness.fragile_edges`, so it misses
 * these entirely. This is the SAME gap `deriveTopDriversFromTopLevel` closes
 * for top_drivers — the override was simply never applied to fragile edges.
 *
 * Label resolution, in priority order:
 *   1. inline `from_label` / `to_label` (present on staging — the renderable
 *      source; the staging envelope usually has NO top-level `enrichment.graph`,
 *      so the map below is empty there),
 *   2. graph node-label map (`buildNodeLabelMap(readGraph(...))`) keyed by the
 *      edge's node id (`from_node_id` / `from_id` / `from`, and the `to_*`
 *      equivalents) — covers node-id-only shapes.
 * Every resolved label is run through `sanitiseLabel` so a blank/missing
 * label or a raw id (slug-prefix or UUID) is dropped rather than emitted —
 * an unresolvable endpoint skips the whole edge (no half-rendered "from X to ").
 *
 * Deduped by resolved label pair, retaining the MOST fragile (max
 * `switch_probability`) per pair, then ranked by `switch_probability`
 * descending so the first entry names the MOST fragile link (parity with
 * `m1_coaching.top_fragile_edge`, which the upstream picks the same way).
 * `switch_probability` is used ONLY for ranking — it is never emitted, so no
 * raw decimal can leak.
 *
 * Returns `{ edges, count }`: `edges` is the top 3 (cap parity with
 * `deriveTopFragileEdges`); `count` is the UNCAPPED number of distinct
 * renderable edges. NOTE this is not the same measure as compactAnalysis's
 * `deriveFragileEdgeCount` (which counts per-option edges by `edge_id` with no
 * renderability filter) — it is the top-level analogue, deduped by resolved
 * label pair and renderability-filtered, so the caller can keep
 * `fragile_edge_count` non-zero/consistent when it projects from the top level.
 */
function deriveTopFragileEdgesFromTopLevel(
  enrichment: Record<string, unknown>,
): { edges: FragileEdge[]; count: number } {
  const rob = enrichment.robustness;
  if (rob === null || typeof rob !== 'object' || Array.isArray(rob)) return { edges: [], count: 0 };
  const raw = (rob as Record<string, unknown>).fragile_edges;
  if (!Array.isArray(raw) || raw.length === 0) return { edges: [], count: 0 };

  const labelMap = buildNodeLabelMap(readGraph(enrichment));

  // Resolve one endpoint: inline label first, then node-id → label map.
  // Returns a clean human label or null (blank / unresolved / id-shaped).
  const resolveEndpoint = (
    inline: unknown,
    idCandidates: readonly unknown[],
  ): string | null => {
    // Non-empty strings only: an empty-string id must not shadow a later valid
    // candidate (e.g. `from_node_id: ''` masking a real `from_id`), nor become
    // an idGuess that no node label could match.
    const id =
      idCandidates.find((c): c is string => typeof c === 'string' && c.length > 0) ?? null;
    const candidate =
      typeof inline === 'string' && inline.trim().length > 0
        ? inline
        : id !== null
          ? labelMap.get(id) ?? null
          : null;
    if (candidate === null) return null;
    return sanitiseLabel(candidate, id ?? '');
  };

  // Dedupe by resolved label pair, retaining the MOST fragile (max score) per
  // pair — so ranking matches the "rank by most fragile" contract even when a
  // duplicate edge pair arrives later in the array with a higher
  // switch_probability (first-wins would otherwise keep the less-fragile one).
  const byKey = new Map<string, { edge: FragileEdge; score: number }>();
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const e = item as Record<string, unknown>;
    const fromLabel = resolveEndpoint(e.from_label, [e.from_node_id, e.from_id, e.from]);
    const toLabel = resolveEndpoint(e.to_label, [e.to_node_id, e.to_id, e.to]);
    if (fromLabel === null || toLabel === null) continue;
    // P0b-1: capture the structural source id (fresh, from the raw edge) so the
    // assembler can suppress lever-sourced fragile edges on the fallback/cached
    // path too. `undefined` only for a label-only raw edge (no id at all) — the
    // assembler fails closed on that rather than letting a lever silently leak.
    const fromId = [e.from_node_id, e.from_id, e.from].find(
      (c): c is string => typeof c === 'string' && c.trim().length > 0,
    );
    // Collision-proof key — a label could in principle contain the arrow
    // separator, so key on the structured pair rather than a joined string.
    const key = JSON.stringify([fromLabel, toLabel]);
    const score =
      typeof e.switch_probability === 'number' && Number.isFinite(e.switch_probability)
        ? e.switch_probability
        : -Infinity;
    const existing = byKey.get(key);
    if (existing === undefined || score > existing.score) {
      byKey.set(key, { edge: { from_label: fromLabel, to_label: toLabel, from_id: fromId }, score });
    }
  }

  const ranked = Array.from(byKey.values());
  // Explicit comparator (NOT `b.score - a.score`): scores can be -Infinity
  // when switch_probability is absent, and `-Infinity - -Infinity` is NaN.
  // Compare scores directly, then fall back to a deterministic label tiebreak.
  ranked.sort((a, b) => {
    if (a.score !== b.score) return a.score > b.score ? -1 : 1;
    return (
      a.edge.from_label.localeCompare(b.edge.from_label) ||
      a.edge.to_label.localeCompare(b.edge.to_label)
    );
  });
  // `edges`: top 3 (cap parity with deriveTopFragileEdges). `count`: UNCAPPED
  // distinct renderable edges — the top-level analogue of (not identical to)
  // deriveFragileEdgeCount, so the caller can keep `fragile_edge_count`
  // non-zero/consistent on the top-level path.
  return { edges: ranked.slice(0, 3).map((r) => r.edge), count: ranked.length };
}

/**
 * Which shape produced the fragile-edge projection, surfaced to telemetry so
 * we can tell — per turn — whether the deterministic fragile-assumption branch
 * fired from the per-option `results[].robustness.fragile_edges` shape, the
 * top-level `enrichment.robustness.fragile_edges` shape (staging / body
 * `analysis_state`), or nothing.
 */
export type FragileEdgeSource = 'per_option' | 'top_level' | 'none';

/**
 * Reconcile an `AnalysisResponseSummary`'s fragile-edge fields against the
 * TOP-LEVEL `enrichment.robustness.fragile_edges` shape.
 *
 * `compactAnalysis`'s `deriveTopFragileEdges` only walks per-option
 * `results[].robustness.fragile_edges`. On staging — and on the body
 * `analysis_state` ingress path, where `coerceIngressAnalysis` leaves
 * `results` empty because the UI sends `option_comparison` rather than
 * `results` — the fragile edges live at the top level and are otherwise
 * dropped, so the deterministic fragile-assumption branch never fires. This
 * helper closes that gap for BOTH the prior-facts fallback
 * (`buildAnalysisFromPriorFacts`) and the ingress path (turn-executor) from a
 * single place, so the two project identically.
 *
 * Rules (additive, fail-closed):
 *   - Per-option edges present → returned unchanged (`'per_option'` wins; the
 *     established Slice-1 precedence).
 *   - Per-option empty + top-level renderable edges present → fill
 *     `top_fragile_edges` and keep `fragile_edge_count` self-consistent from
 *     the top level (`'top_level'`). `deriveTopFragileEdgesFromTopLevel`
 *     already sanitises labels and drops id / UUID / blank endpoints, so
 *     nothing unsafe leaks and an unresolvable edge is simply omitted.
 *   - Neither present → unchanged (`'none'`).
 *
 * Never consults `m1_coaching.top_fragile_edge`; `robustness.fragile_edges` is
 * the renderable source of truth.
 */
export function applyTopLevelFragileEdgeOverride(
  summary: AnalysisResponseSummary,
  enrichment: Record<string, unknown>,
): { summary: AnalysisResponseSummary; source: FragileEdgeSource } {
  const perOptionFragile = summary.top_fragile_edges ?? [];
  if (perOptionFragile.length > 0) {
    return { summary, source: 'per_option' };
  }
  const fromTopLevel = deriveTopFragileEdgesFromTopLevel(enrichment);
  if (fromTopLevel.edges.length === 0) {
    return { summary, source: 'none' };
  }
  return {
    summary: {
      ...summary,
      // compactAnalysis's per-option `fragile_edge_count` stays 0 on this
      // shape; use the top-level path's distinct renderable edge count so the
      // summary stays self-consistent.
      fragile_edge_count:
        fromTopLevel.count > 0 ? fromTopLevel.count : summary.fragile_edge_count,
      top_fragile_edges: fromTopLevel.edges,
    },
    source: 'top_level',
  };
}

/**
 * Which shape produced the top-driver projection, surfaced to telemetry so we
 * can tell — per turn — whether the advice-gate classes that require a
 * `top_driver` (`improvement`, `explain_results_free_text`,
 * `what_would_flip_free_text`) were grounded from the per-option
 * `results[].factor_sensitivity` shape, the top-level
 * `enrichment.factor_sensitivity[]` shape (staging / body `analysis_state`),
 * or nothing.
 */
export type TopDriverSource = 'per_option' | 'top_level' | 'none';

/**
 * Reconcile an `AnalysisResponseSummary`'s `top_drivers` against the
 * TOP-LEVEL `enrichment.factor_sensitivity[]` shape.
 *
 * `compactAnalysis`'s `deriveTopDrivers` only walks per-option
 * `results[].factor_sensitivity`. On staging — and on the body
 * `analysis_state` ingress path, where the UI sends `option_comparison`
 * entries that carry no `factor_sensitivity` — the drivers live at the top
 * level and are otherwise dropped. The prior-facts fallback
 * (`buildAnalysisFromPriorFacts`) has applied this derivation since the
 * enrichment-passthrough slice; the ingress path did NOT, so a request
 * carrying `analysis_state` projected `top_drivers: []`, failed the advice
 * gate's `needs_top_driver` classes (`data_unavailable_for_class`), and fell
 * through to the fresh-analysis follow-up recap copy instead of grounded
 * advice prose. This helper closes that gap for BOTH paths from a single
 * place — the same seam contract as {@link applyTopLevelFragileEdgeOverride}.
 *
 * Rules (additive, fail-closed):
 *   - Per-option drivers present → returned unchanged (`'per_option'` wins).
 *   - Per-option empty + top-level drivers derivable → fill `top_drivers`
 *     (`'top_level'`). `deriveTopDriversFromTopLevel` keeps only finite
 *     sensitivity values and labelled factors, so nothing unsafe leaks.
 *   - Neither present → unchanged (`'none'`).
 */
export function applyTopLevelDriversOverride(
  summary: AnalysisResponseSummary,
  enrichment: Record<string, unknown>,
): { summary: AnalysisResponseSummary; source: TopDriverSource } {
  if (summary.top_drivers.length > 0) {
    return { summary, source: 'per_option' };
  }
  const fromTopLevel = deriveTopDriversFromTopLevel(enrichment);
  if (fromTopLevel.length === 0) {
    return { summary, source: 'none' };
  }
  return {
    summary: { ...summary, top_drivers: fromTopLevel },
    source: 'top_level',
  };
}

/**
 * Lane 21 (P0-A) — the SINGLE reconciliation seam between an
 * `AnalysisResponseSummary` and the raw top-level enrichment record. Shared
 * by the prior-facts fallback below AND the turn-executor body
 * `analysis_state` ingress path so the two can never drift:
 *
 *   1. `applyTopLevelDriversOverride` — top-level `factor_sensitivity[]`
 *      fills `top_drivers` when the per-option shape is empty.
 *   2. `applyTopLevelFragileEdgeOverride` — top-level
 *      `robustness.fragile_edges[]` fills `top_fragile_edges` +
 *      `fragile_edge_count` when the per-option shape is empty.
 *   3. Lane 21 signal attachment (`./analysis-signals.ts`): tipping points
 *      (top-level `flip_thresholds[]`), evidence-gap VOI
 *      (`m1_coaching.evidence_gaps[]`), and goal-fit provenance
 *      (PLoT #204 `goal_fit_basis` / CONSTRAINT_GOALFIT_MODELLED_BASIS).
 *      Lane 30 adds per-option goal-fit VALUES
 *      (`option_comparison[].probability_of_joint_goal`) via the same seam.
 *      Fields are attached only when non-empty — a summary with nothing to
 *      say stays shaped exactly as before.
 *
 * `robustness_level` is deliberately NOT touched here: `compactAnalysis`
 * already derives it from the same envelope on both call paths; the minimal
 * win_probabilities path merges it separately (see
 * `buildAnalysisFromPriorFacts`).
 */
export function reconcileAnalysisSummaryWithEnrichment(
  summary: AnalysisResponseSummary,
  enrichment: Record<string, unknown>,
): {
  summary: AnalysisResponseSummaryWithSignals;
  top_driver_source: TopDriverSource;
  fragile_edge_source: FragileEdgeSource;
} {
  const { summary: withDrivers, source: topDriverSource } =
    applyTopLevelDriversOverride(summary, enrichment);
  const { summary: withFragile, source: fragileEdgeSource } =
    applyTopLevelFragileEdgeOverride(withDrivers, enrichment);

  const tippingPoints = deriveTippingPointsFromTopLevel(enrichment);
  const evidenceGaps = deriveEvidenceGapsFromEnrichment(enrichment);
  const goalFit = deriveGoalFitFromEnrichment(enrichment);
  // Lane 30 — per-option goal-fit VALUES (PLoT #204). Without these the
  // ContextPack carried only the global provenance sentence and the LLM
  // filled the per-option gap with win probabilities (live defect,
  // scenario 90385279).
  const optionGoalFits = deriveOptionGoalFitsFromEnrichment(enrichment);
  // Lane 30 fix 3 — confidence tier (top-level ordinal token) + per-option
  // modelled-outcome means (banded downstream, never surfaced raw).
  const confidenceTier = deriveConfidenceTierFromEnrichment(enrichment);
  const optionOutcomes = deriveOptionOutcomesFromEnrichment(enrichment);

  const withSignals: AnalysisResponseSummaryWithSignals = {
    ...withFragile,
    ...(tippingPoints.length > 0 ? { tipping_points: tippingPoints } : {}),
    ...(evidenceGaps.length > 0 ? { evidence_gaps: evidenceGaps } : {}),
    ...(goalFit !== null ? { goal_fit: goalFit } : {}),
    ...(optionGoalFits.length > 0 ? { option_goal_fits: optionGoalFits } : {}),
    ...(confidenceTier !== null ? { confidence_tier: confidenceTier } : {}),
    ...(optionOutcomes.length > 0 ? { option_outcomes: optionOutcomes } : {}),
  };

  return {
    summary: withSignals,
    top_driver_source: topDriverSource,
    fragile_edge_source: fragileEdgeSource,
  };
}

/**
 * Scan prior facts (newest-first, same order as `readRecent`) for the most
 * recent non-noop `run_analysis` fact and project it into an
 * `AnalysisResponseSummary`. Returns null when no usable prior analysis
 * exists.
 *
 * The projection is deliberately thin: only fields the fact actually carries
 * are populated. Absent fields take safe defaults (`top_drivers: []`,
 * `fragile_edge_count: 0`, `robustness_level: 'unknown'`).
 */
export function buildAnalysisFromPriorFacts(
  priorFacts: readonly HandlerFact[],
  optionLabelSource?: readonly OptionLabelSource[],
): AnalysisResponseSummaryWithSignals | null {
  // V5 state-trust: route both the projection and the freshness verdict
  // through the SAME selector. Pre-state-trust this used `priorFacts.find`
  // which picked the FIRST non-noop fact regardless of analysis_status —
  // so a partial / older fact could ground the projection while the
  // freshness verdict (built from the latest successful fact) reflected a
  // different one. The user saw analysis details from fact A but a
  // freshness verdict about fact B.
  const selected = selectRunAnalysisFact(priorFacts);
  if (!selected) return null;
  const fact = selected.fact;
  if (fact.fact_type !== 'run_analysis') return null; // narrow for the type checker

  const result = fact.result;
  const labelMap = buildLabelMap(optionLabelSource);
  const labelFor = (optionId: string): string =>
    labelMap.get(optionId) ?? optionId;

  // Preferred path: the run-analysis handler stores the full V2RunResponseEnvelope
  // verbatim in result.enrichment (byte-for-byte; see run-analysis.ts §6).
  // Reuse compactAnalysis() so the fallback projection includes top_drivers,
  // robustness_level, and fragile_edges instead of empty defaults. This is
  // the difference between Step 5 saying "top drivers are not available
  // from this run" and Step 5 surfacing the actual sensitivity figures.
  const enrichment = result.enrichment;
  const enrichmentRecord =
    enrichment && typeof enrichment === 'object' && !Array.isArray(enrichment)
      ? (enrichment as Record<string, unknown>)
      : null;
  const fromEnrichment =
    enrichmentRecord !== null
      ? compactAnalysis(enrichmentRecord as unknown as V2RunResponseEnvelope)
      : null;
  if (enrichmentRecord !== null && fromEnrichment !== null) {
    if (fromEnrichment.options.length > 0) {
      // Apply option-label resolution from the current graph when a node
      // matches by id; falls back to whatever compactAnalysis derived.
      const relabelled: OptionSummary[] = fromEnrichment.options.map((o) =>
        labelMap.has(o.option_id)
          ? { ...o, option_label: labelMap.get(o.option_id)! }
          : o,
      );
      // Status gate (shared with compactAnalysis / projectAnalysis / the direct
      // receipt via the ONE isRecommendableOption predicate). `relabelled`
      // deliberately retains the FULL option list (errored options kept so the
      // coach can still disclose they ran) and is sorted by win_probability
      // descending, so `relabelled[0]` can be a FAILED option carrying the top
      // win_probability. Taking it as the winner here would RE-CROWN the failed
      // option that compactAnalysis already excluded — desyncing the winner from
      // the margin, which compactAnalysis measures over the recommendable subset
      // only (fromEnrichment.margin / margin_pp flow through the `...fromEnrichment`
      // spread below). Select the top RECOMMENDABLE option so winner and margin
      // derive from the SAME subset; when none is recommendable, fall through to
      // the honest empty winner compactAnalysis already produced. `relabelled`
      // preserves the win_probability order, so `[0]` of the filtered list is the
      // same option deriveWinner crowned inside compactAnalysis.
      const topRecommendable = relabelled.filter(isRecommendableTypedOption)[0];
      const winner = topRecommendable
        ? {
            option_id: topRecommendable.option_id,
            option_label: topRecommendable.option_label,
            win_probability: topRecommendable.win_probability,
          }
        : fromEnrichment.winner;

      // compactAnalysis only walks per-option `results[].factor_sensitivity`
      // and per-option results[].robustness.fragile_edges. On staging both
      // drivers and fragile edges live at the envelope TOP LEVEL and would
      // otherwise be dropped before the advice-gate projection that
      // composeExplainResults / composeMeaning read. Reconcile through the
      // SHARED composite seam (drivers + fragile edges + Lane 21 signals) so
      // this prior-facts fallback and the body `analysis_state` ingress path
      // (turn-executor) project identically; per-option result wins when
      // present.
      const { summary: reconciled } = reconcileAnalysisSummaryWithEnrichment(
        {
          ...fromEnrichment,
          options: relabelled,
          winner,
        },
        enrichmentRecord,
      );
      return reconciled;
    }
  }

  // Fallback: enrichment missing/malformed. Use the minimal extraction from
  // result.win_probabilities + result.leading_option_id. top_drivers and
  // robustness stay empty/unknown — caller's prompt may decide to re-run.
  const winProbabilities = result.win_probabilities ?? {};

  // Sort option entries by probability desc, tiebreak by option_id lex.
  const sortedEntries = Object.entries(winProbabilities).sort((a, b) => {
    const diff = b[1] - a[1];
    if (diff !== 0) return diff;
    return a[0].localeCompare(b[0]);
  });

  // If the fact declared a leading_option_id, ensure it's the winner even
  // when win_probabilities is absent or ties on probability. Otherwise fall
  // back to the first sorted entry.
  const leadingFromFact = result.leading_option_id;
  let winner: AnalysisResponseSummary['winner'];
  if (leadingFromFact) {
    const leadingProb =
      typeof winProbabilities[leadingFromFact] === 'number'
        ? winProbabilities[leadingFromFact]
        : 0;
    winner = {
      option_id: leadingFromFact,
      option_label: labelFor(leadingFromFact),
      win_probability: leadingProb,
    };
  } else if (sortedEntries.length > 0) {
    const [optionId, prob] = sortedEntries[0]!;
    winner = {
      option_id: optionId,
      option_label: labelFor(optionId),
      win_probability: prob,
    };
  } else {
    // No winner extractable — caller should treat this fact as unusable.
    return null;
  }

  const options: AnalysisResponseSummary['options'] = sortedEntries.map(
    ([optionId, prob]) => ({
      option_id: optionId,
      option_label: labelFor(optionId),
      win_probability: prob,
      outcome_mean: 0,
    }),
  );

  const margin =
    sortedEntries.length >= 2
      ? (sortedEntries[0]![1] - sortedEntries[1]![1])
      : null;
  const marginPp = margin === null ? null : Math.round(margin * 1000) / 10;

  const minimal: AnalysisResponseSummary = {
    winner,
    options,
    top_drivers: [],
    robustness_level: 'unknown',
    fragile_edge_count: 0,
    margin,
    margin_pp: marginPp,
    analysis_status: 'complete',
  };

  // Lane 21 (P0-A) gate reconciliation: before this lane, reaching the
  // minimal win_probabilities path meant the ENTIRE enrichment was dropped —
  // `top_drivers: []`, `robustness_level: 'unknown'`, no fragile edges —
  // even when the well-formed envelope carried all of them at the TOP LEVEL
  // (the live staging shape: `option_comparison[]` entries can be unusable
  // for option identity while `factor_sensitivity[]` / `robustness` /
  // `flip_thresholds[]` / `m1_coaching` are fully populated). Make this path
  // consult the SAME source as the enriched path: merge the
  // option-independent fields compactAnalysis derived, then run the shared
  // composite (drivers + fragile edges + signals). Blocked / failed
  // envelopes (compactAnalysis → null) still skip — a blocked analysis must
  // not ground prose.
  if (enrichmentRecord !== null && fromEnrichment !== null) {
    const merged: AnalysisResponseSummary = {
      ...minimal,
      robustness_level: fromEnrichment.robustness_level,
      fragile_edge_count: fromEnrichment.fragile_edge_count,
      top_drivers: fromEnrichment.top_drivers,
      ...(fromEnrichment.flip_thresholds !== undefined
        ? { flip_thresholds: fromEnrichment.flip_thresholds }
        : {}),
      ...(fromEnrichment.top_fragile_edges !== undefined
        ? { top_fragile_edges: fromEnrichment.top_fragile_edges }
        : {}),
      ...(fromEnrichment.constraint_tensions !== undefined
        ? { constraint_tensions: fromEnrichment.constraint_tensions }
        : {}),
    };
    const { summary: reconciled } = reconcileAnalysisSummaryWithEnrichment(
      merged,
      enrichmentRecord,
    );
    return reconciled;
  }

  return minimal;
}
