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
import type { V2RunResponseEnvelope } from '../../orchestrator/types.js';
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
 * array — the shape PLoT actually returns on staging. Each entry is read
 * with both legacy and current field names so we tolerate vendor drift:
 *
 *   { label, elasticity, direction }   ← V2RunResponseEnvelope contract
 *   { factor_label, sensitivity, direction }  ← alternate naming
 *
 * `compactAnalysis()`'s `deriveTopDrivers` only walks
 * `results[].factor_sensitivity` (per-option) and misses the top-level
 * array entirely. This helper closes that gap so Step 5 actually sees
 * sensitivity figures from prior facts. Mirrors the dual-shape approach
 * in `src/orchestrator/guidance/post-analysis.ts:getAllFactors`.
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

    const sensitivityRaw =
      typeof e.sensitivity === 'number' ? e.sensitivity
      : typeof e.elasticity === 'number' ? e.elasticity
      : null;
    if (sensitivityRaw === null || !Number.isFinite(sensitivityRaw)) continue;

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
    // 'neutral'); only sign-derive when it is absent (elasticity is unsigned
    // per the sensitivity contract). Shared rule with the primary derive path.
    const direction: InfluenceDirection = resolveInfluenceDirection(e.direction, sensitivityRaw);

    const absSensitivity = Math.abs(sensitivityRaw);
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
    // Collision-proof key — a label could in principle contain the arrow
    // separator, so key on the structured pair rather than a joined string.
    const key = JSON.stringify([fromLabel, toLabel]);
    const score =
      typeof e.switch_probability === 'number' && Number.isFinite(e.switch_probability)
        ? e.switch_probability
        : -Infinity;
    const existing = byKey.get(key);
    if (existing === undefined || score > existing.score) {
      byKey.set(key, { edge: { from_label: fromLabel, to_label: toLabel }, score });
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
export type TopDriverSource = 'per_option' | 'top_level' | 'prior_facts' | 'none';

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
): AnalysisResponseSummary | null {
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
  if (enrichment && typeof enrichment === 'object' && !Array.isArray(enrichment)) {
    const fromEnrichment = compactAnalysis(enrichment as V2RunResponseEnvelope);
    if (fromEnrichment && fromEnrichment.options.length > 0) {
      // Apply option-label resolution from the current graph when a node
      // matches by id; falls back to whatever compactAnalysis derived.
      const relabelled: OptionSummary[] = fromEnrichment.options.map((o) =>
        labelMap.has(o.option_id)
          ? { ...o, option_label: labelMap.get(o.option_id)! }
          : o,
      );
      const winner = relabelled[0]
        ? {
            option_id: relabelled[0].option_id,
            option_label: relabelled[0].option_label,
            win_probability: relabelled[0].win_probability,
          }
        : fromEnrichment.winner;

      // compactAnalysis only walks per-option `results[].factor_sensitivity`
      // and per-option results[].robustness.fragile_edges. On staging both
      // drivers and fragile edges live at the envelope TOP LEVEL and would
      // otherwise be dropped before the advice-gate projection that
      // composeExplainResults / composeMeaning read. Reconcile through the
      // SHARED override helpers so this prior-facts fallback and the body
      // `analysis_state` ingress path (turn-executor) project identically;
      // per-option result wins when present.
      const { summary: withDrivers } = applyTopLevelDriversOverride(
        {
          ...fromEnrichment,
          options: relabelled,
          winner,
        },
        enrichment as Record<string, unknown>,
      );
      const { summary: reconciled } = applyTopLevelFragileEdgeOverride(
        withDrivers,
        enrichment as Record<string, unknown>,
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

  return {
    winner,
    options,
    top_drivers: [],
    robustness_level: 'unknown',
    fragile_edge_count: 0,
    margin,
    margin_pp: marginPp,
    analysis_status: 'complete',
  };
}

/**
 * D1 fallback-to-authoritative for top drivers (V5-WAVE-2 PR-D).
 *
 * Tier 2, applied ONLY after {@link applyTopLevelDriversOverride} (tier 1)
 * has yielded no drivers — i.e. the request `analysis_state` echo carried
 * neither per-option `results[].factor_sensitivity` nor a top-level
 * `factor_sensitivity[]`, so its source came back `'none'`. That lossy echo
 * leaves `top_drivers: []`, which fails the advice gate's `needs_top_driver`
 * classes (`explain_results_free_text` / `what_would_flip_free_text`) and
 * sends "What would change the outcome?" to the fresh-analysis recap stub
 * instead of grounded advice (the baseline 5/5 flip-deflection).
 *
 * The persisted prior-facts analysis is the AUTHORITATIVE source — the
 * run-analysis handler stores the full `V2RunResponseEnvelope` verbatim, so
 * {@link buildAnalysisFromPriorFacts} recovers drivers the ingress echo
 * dropped. Tier 1 is preferred and left untouched; this only runs on the
 * `'none'` tail, so an echo that DID carry its own drivers keeps them.
 *
 * Additive and fail-closed:
 *   - Only fills when `summary.top_drivers` is empty — never overrides a
 *     request projection that carried drivers (a genuinely newer request
 *     analysis keeps its own).
 *   - Drivers key off factor labels, so no option-label source is needed.
 *   - No usable prior `run_analysis` fact, or it too carries no drivers →
 *     returned unchanged (`'unchanged'`).
 *
 * Freshness safety: the fresh-analysis advice gate only short-circuits when
 * the verdict is `'fresh'`, and `buildAnalysisFromPriorFacts` selects the
 * SAME fact the freshness verdict derives from (`selectRunAnalysisFact`).
 * So when the gate fires these drivers describe the current analysis, not a
 * staler one.
 */
export function applyPriorFactsDriversFallback(
  summary: AnalysisResponseSummary,
  priorFacts: readonly HandlerFact[],
): { summary: AnalysisResponseSummary; source: 'prior_facts' | 'unchanged' } {
  if (summary.top_drivers.length > 0) {
    return { summary, source: 'unchanged' };
  }
  const authoritative = buildAnalysisFromPriorFacts(priorFacts);
  if (!authoritative || authoritative.top_drivers.length === 0) {
    return { summary, source: 'unchanged' };
  }
  return {
    summary: { ...summary, top_drivers: authoritative.top_drivers },
    source: 'prior_facts',
  };
}
