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
 * Staleness handling (Approach A from the Phase 0 plan): fallback summaries
 * are ALWAYS flagged `loaded_from_prior_run_freshness_unknown`. The run
 * fact does not currently carry a graph hash, so the freshness of the
 * cached win_probabilities cannot be proven against the current graph.
 * Stamping unknown-freshness is honest; the routing prompt is expected to
 * treat this flag as "reference material, not fresh results".
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
  type OptionSummary,
} from '../../orchestrator/context/analysis-compact.js';
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
    { label: string; absSensitivity: number; direction: 'positive' | 'negative' }
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

    // direction may be explicit ('positive'|'negative') or implied by the sign
    // of sensitivity/elasticity.
    const explicitDirection =
      e.direction === 'positive' || e.direction === 'negative' ? e.direction : null;
    const direction: 'positive' | 'negative' =
      explicitDirection ?? (sensitivityRaw >= 0 ? 'positive' : 'negative');

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

      // compactAnalysis only walks per-option `results[].factor_sensitivity`.
      // PLoT also publishes top-level `enrichment.factor_sensitivity[]` (the
      // shape on staging), which compactAnalysis ignores. When its top_drivers
      // came back empty, derive from the top-level array.
      const topDrivers =
        fromEnrichment.top_drivers.length > 0
          ? fromEnrichment.top_drivers
          : deriveTopDriversFromTopLevel(enrichment as Record<string, unknown>);

      return {
        ...fromEnrichment,
        options: relabelled,
        winner,
        top_drivers: topDrivers,
      };
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
