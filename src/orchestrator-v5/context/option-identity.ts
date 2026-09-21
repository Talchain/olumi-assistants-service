/**
 * V5 option-identity comparison for the analysis-freshness guard.
 *
 * The analysis-affecting graph hash (context/graph-hash.ts) already includes
 * `options[].id`, so when BOTH the run-time hash and the current-turn hash are
 * present an option change yields `stale` by hash alone. This module exists to
 * cover the HASH-IMPOSSIBLE paths — `legacy_fact_missing_hash` and
 * `current_graph_hash_unavailable` (recovered-session / unparseable-graph
 * reloads) — where the hash comparison cannot run and freshness would
 * otherwise fall to the lenient `unknown` verdict. It is deliberately NOT
 * consulted on the hash-proven `fresh` path (identical-hash ⇒ fresh, by
 * construction — F10 root, ROADMAP 1.133): the identifiers this module reads
 * from the fact live in the PLoT enrichment namespace and can legitimately
 * differ from graph option IDs on byte-identical input, so a "defence-in-
 * depth" comparison there manufactured false staleness against a run's own
 * response (verified live, 16 Jul).
 *
 * It compares the option IDENTITIES the analysis was computed against (carried
 * on the persisted run_analysis fact) with the current graph's option IDs. IDs
 * only — labels are never used for blocking: a same-ID label rename does not
 * invalidate the analysis, and label-vs-ID comparison would false-positive.
 *
 * Pure module: no I/O, no telemetry, no config reads. The guard is gated by
 * `cee.optionIdentityFreshnessGuard` at the call sites, which pass `undefined`
 * for the current option IDs when the flag is off (skip = today's behaviour).
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

/** Why an option-identity comparison did (not) match. Stable codes. */
export type OptionIdentityReason =
  | 'match'
  | 'leader_absent'
  | 'analysed_option_absent'
  | 'current_option_added'
  | 'indeterminate';

export interface OptionIdentityVerdict {
  /** False ⇒ the analysed options no longer match the current graph. */
  readonly match: boolean;
  readonly reason: OptionIdentityReason;
}

function asRecord(x: unknown): Record<string, unknown> | null {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : null;
}

function nonEmptyString(x: unknown): string | null {
  return typeof x === 'string' && x.length > 0 ? x : null;
}

/**
 * Read the current graph's option IDs from the RAW, unparsed graph object.
 * Deliberately does NOT require a schema parse — the guard must still fire when
 * `GraphStateIngressSchema.safeParse` failed (the unparseable-graph recovery
 * case that produces `current_graph_hash_unavailable`). Mirrors the defensive
 * `graph.options[].id` read in graph-hash.ts:projectOption.
 *
 * Reads BOTH option representations and unions them in the same ID namespace as
 * the analysed `option_comparison[].option_id`:
 *   1. the top-level `options[]` array (the CEEGraphResponseV3 / ISL ingress
 *      shape — what production sends), and
 *   2. nodes with `kind === 'option'` (the GraphV3 / canvas node shape some
 *      fixtures and layers use).
 *
 * Returns `null` (indeterminate — no comparison possible) only when neither an
 * `options` array NOR any option node is present. An explicit empty `options`
 * array is preserved as `[]` (a real zero-option graph). NB: the comparator
 * treats both `[]` and `null` as indeterminate (skip), so this distinction only
 * affects the diagnostic count, never a fail-closed decision.
 */
export function extractGraphOptionIds(graph: unknown): readonly string[] | null {
  const g = asRecord(graph);
  if (g === null) return null;

  const ids: string[] = [];
  let hasOptionsSource = false;

  // Source 1: top-level options[] (production / ISL ingress representation).
  const options = g.options;
  if (Array.isArray(options)) {
    hasOptionsSource = true;
    for (const opt of options) {
      const r = asRecord(opt);
      const id = r ? nonEmptyString(r.id) : null;
      if (id !== null) ids.push(id);
    }
  }

  // Source 2: option-kind nodes (GraphV3 / canvas representation).
  const nodes = g.nodes;
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      const r = asRecord(node);
      if (r && r.kind === 'option') {
        hasOptionsSource = true;
        const id = nonEmptyString(r.id);
        if (id !== null) ids.push(id);
      }
    }
  }

  if (!hasOptionsSource) return null;
  return Array.from(new Set(ids));
}

/**
 * Read the analysed option IDs from a persisted run_analysis fact.
 *
 * Authoritative carrier (verified against the captured staging fact,
 * tests/fixtures/cross-service/v5-turn.run-analysis.staging.json):
 *   result.enrichment.option_comparison[].option_id   (fallback `.id`)
 *
 * Deliberately does NOT read `result.win_probabilities` — that map is keyed by
 * option_LABEL (run-analysis.ts:extractWinProbabilities keys by option_label,
 * falling back to option_id), so its keys are human labels in the normal case;
 * comparing them against graph IDs would false-positive. The analysed leader is
 * returned separately by {@link extractAnalysedLeaderId} so the comparator can
 * apply a leader-only check when option_comparison is unavailable.
 *
 * Returns `null` (indeterminate) when no usable option_id is found — the guard
 * then skips the set comparison rather than blocking on labels.
 */
export function extractAnalysedOptionIds(fact: HandlerFact): readonly string[] | null {
  if (fact.fact_type !== 'run_analysis') return null;
  const result = asRecord((fact as { result?: unknown }).result);
  if (result === null) return null;
  const enrichment = asRecord(result.enrichment);
  const oc = enrichment ? enrichment.option_comparison : undefined;
  if (!Array.isArray(oc)) return null;
  const ids: string[] = [];
  for (const entry of oc) {
    const r = asRecord(entry);
    if (r === null) continue;
    const id = nonEmptyString(r.option_id) ?? nonEmptyString(r.id);
    if (id !== null) ids.push(id);
  }
  return ids.length > 0 ? Array.from(new Set(ids)) : null;
}

/**
 * Read the analysed leader option id from a run_analysis fact. A real option id
 * in the normal case (run-analysis.ts:selectLeadingOptionId prefers option_id);
 * null when there was no unambiguous leader (tie) or the field is empty.
 */
export function extractAnalysedLeaderId(fact: HandlerFact): string | null {
  if (fact.fact_type !== 'run_analysis') return null;
  const result = asRecord((fact as { result?: unknown }).result);
  if (result === null) return null;
  return nonEmptyString(result.leading_option_id);
}

/**
 * Compare the analysed option identities against the current graph's option
 * IDs. Fail closed (match:false) when:
 *   - the analysed leader id is absent from the current graph (leader_absent);
 *   - any analysed option id is absent from the current graph
 *     (analysed_option_absent — a deleted or renamed-id option);
 *   - the current graph carries an option id the analysis never saw
 *     (current_option_added — only checked when the full analysed set is known).
 *
 * Returns `match:true, reason:'indeterminate'` when either side is null/empty —
 * there is nothing to compare, so the hash verdict is left unchanged (the guard
 * never manufactures a divergence from missing data). When only the leader is
 * known (no option_comparison set), only the leader check runs; the
 * set-inequality checks are skipped to avoid false positives from a partial
 * carrier. IDs only; no label comparison.
 */
export function compareAnalysedOptionIdentity(
  analysedIds: readonly string[] | null,
  leaderId: string | null,
  currentGraphOptionIds: readonly string[] | null,
): OptionIdentityVerdict {
  if (currentGraphOptionIds === null || currentGraphOptionIds.length === 0) {
    return { match: true, reason: 'indeterminate' };
  }
  const analysed = analysedIds ?? [];
  if (analysed.length === 0 && leaderId === null) {
    return { match: true, reason: 'indeterminate' };
  }

  const current = new Set(currentGraphOptionIds);

  // Leader check runs whenever a leader is known (the most dangerous case: the
  // analysis named a winner that no longer exists on the canvas).
  if (leaderId !== null && !current.has(leaderId)) {
    return { match: false, reason: 'leader_absent' };
  }

  // Set-inequality checks require the FULL analysed set (option_comparison).
  // With only a leader we cannot assert added/removed options without risking a
  // false positive, so skip them.
  if (analysed.length > 0) {
    for (const id of analysed) {
      if (!current.has(id)) return { match: false, reason: 'analysed_option_absent' };
    }
    const analysedSet = new Set(analysed);
    if (leaderId !== null) analysedSet.add(leaderId);
    for (const id of currentGraphOptionIds) {
      if (!analysedSet.has(id)) return { match: false, reason: 'current_option_added' };
    }
  }

  return { match: true, reason: 'match' };
}
