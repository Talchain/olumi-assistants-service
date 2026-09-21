/**
 * V5 context-readiness snapshot.
 *
 * Compact, internal-only structural picture of what the turn executor
 * has loaded for the current turn. Built once after context-pack
 * assembly and emitted as `v5.context_readiness` telemetry so operators
 * can see at a glance what CEE knew when routing fired:
 *
 *   - was a graph present and how large?
 *   - was a brief present?
 *   - how many prior facts did we load?
 *   - did we have a successful run_analysis fact?
 *   - what's the freshness verdict and graph-hash pair?
 *   - how many pending actions are carried from the prior turn?
 *   - how many recent changes did the context pack project?
 *   - is Phase 3 block context available (decision_review on the selected fact)?
 *   - how big is the assembled context pack?
 *
 * Privacy contract: every field is a number, boolean, the four-valued
 * freshness enum, or a graph hash. No user prose, no labels, no raw
 * entity / node / edge / option / fact IDs, no decision_review content.
 * The hashes are SHA-prefix strings already emitted on
 * `v5.analysis_freshness.derived`; they are safe.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { isSuccessfulRunAnalysisFact, selectRunAnalysisFact, type FreshnessDerivation } from './freshness.js';
import type { EnrichedTurnContext } from '../build-turn-context.js';

export interface ContextReadiness {
  readonly graph_present: boolean;
  readonly graph_node_count: number;
  readonly graph_edge_count: number;
  readonly brief_present: boolean;
  readonly prior_fact_count: number;
  readonly has_run_analysis_fact: boolean;
  readonly latest_analysis_freshness:
    | 'fresh'
    | 'stale'
    | 'unknown'
    | 'none';
  readonly latest_analysis_graph_hash: string | null;
  readonly current_graph_hash: string | null;
  readonly pending_action_count: number;
  readonly recent_change_count: number;
  readonly phase3_block_context_available: boolean;
  readonly context_pack_chars: number | null;
}

export interface DeriveContextReadinessInput {
  readonly context: EnrichedTurnContext;
  readonly freshness: FreshnessDerivation;
  readonly recentChangeCount: number;
  readonly contextPackChars: number | null;
}

/**
 * Derive a context-readiness snapshot from already-computed turn data.
 * Pure function, no I/O, no telemetry. The caller is responsible for
 * emitting `v5.context_readiness` after it returns.
 */
export function deriveContextReadiness(
  input: DeriveContextReadinessInput,
): ContextReadiness {
  const { context, freshness, recentChangeCount, contextPackChars } = input;

  const graph = context.persistedGraph;
  const { nodeCount, edgeCount, graphPresent } = countGraphStructurals(graph);

  return {
    graph_present: graphPresent,
    graph_node_count: nodeCount,
    graph_edge_count: edgeCount,
    brief_present:
      typeof context.scenarioBriefText === 'string'
      && context.scenarioBriefText.trim().length > 0,
    prior_fact_count: context.prior_facts.length,
    has_run_analysis_fact: hasSuccessfulRunAnalysisFact(context.prior_facts),
    latest_analysis_freshness: freshness.freshness,
    latest_analysis_graph_hash: freshness.graph_hash_at_run,
    current_graph_hash: freshness.current_graph_hash,
    pending_action_count: context.most_recent_pending_actions?.length ?? 0,
    recent_change_count: recentChangeCount,
    phase3_block_context_available: derivePhase3BlockContextAvailable(
      context.prior_facts,
    ),
    context_pack_chars: contextPackChars,
  };
}

function hasSuccessfulRunAnalysisFact(
  priorFacts: readonly HandlerFact[],
): boolean {
  for (const fact of priorFacts) {
    if (fact.fact_type === 'run_analysis' && isSuccessfulRunAnalysisFact(fact)) {
      return true;
    }
  }
  return false;
}

function derivePhase3BlockContextAvailable(
  priorFacts: readonly HandlerFact[],
): boolean {
  const selected = selectRunAnalysisFact(priorFacts);
  if (selected === null) return false;
  const result = selected.fact.fact_type === 'run_analysis'
    ? selected.fact.result
    : null;
  const enrichment = result && typeof result === 'object'
    ? (result as { enrichment?: unknown }).enrichment
    : null;
  if (!enrichment || typeof enrichment !== 'object') return false;
  const decisionReview = (enrichment as { decision_review?: unknown }).decision_review;
  return decisionReview !== null && decisionReview !== undefined;
}

function countGraphStructurals(graph: unknown): {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly graphPresent: boolean;
} {
  if (!graph || typeof graph !== 'object') {
    return { nodeCount: 0, edgeCount: 0, graphPresent: false };
  }
  const g = graph as { nodes?: unknown; edges?: unknown };
  const nodes = Array.isArray(g.nodes) ? g.nodes : [];
  const edges = Array.isArray(g.edges) ? g.edges : [];
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    graphPresent: nodes.length > 0 || edges.length > 0,
  };
}
