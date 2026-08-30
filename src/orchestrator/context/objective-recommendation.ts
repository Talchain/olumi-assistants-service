import {
  EnrichmentObjectiveRankingSchema,
  type EnrichmentObjectiveRanking,
} from '@talchain/schemas/boundary';
import { isRecommendableOption } from '../../orchestrator-v5/tools/handlers/recommendable-option.js';
import type { AnalysisResponseSummary } from './analysis-compact.js';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function readObjectiveRanking(value: unknown): EnrichmentObjectiveRanking | null {
  const parsed = EnrichmentObjectiveRankingSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Read PLoT's permitted recommendation; never derive one from raw shares. */
export function readObjectiveRecommendation(enrichment: Record<string, unknown>) {
  const ranking = readObjectiveRanking(enrichment.objective_ranking);
  if (ranking?.status !== 'computed' || !ranking.attested) return null;
  const id = record(enrichment.robustness)?.recommended_option_id;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (!Array.isArray(enrichment.option_comparison)) return null;

  // Join only this run's current comparison by structural ID. A legacy copy,
  // duplicate identity, label match, or inconsistent share cannot repair it.
  const rows = new Map<string, Record<string, unknown>>();
  for (const value of enrichment.option_comparison) {
    const row = record(value);
    if (!row || typeof row.option_id !== 'string' || !row.option_id || rows.has(row.option_id)) {
      return null;
    }
    rows.set(row.option_id, row);
  }
  for (const entry of ranking.ranked_options) {
    const row = rows.get(entry.option_id);
    if (!row || !isRecommendableOption(row) || row.win_probability !== entry.win_probability) return null;
  }
  const ranked = ranking.ranked_options.find((entry) => entry.option_id === id);
  const option = rows.get(id);
  if (!ranked || !option) return null;
  return { option_id: id, win_probability: ranked.win_probability, option, ranking };
}

/** Revalidate the unchanged producer fields after compacting or loading a fact. */
export function readSummaryObjectiveRecommendation(summary: AnalysisResponseSummary | null | undefined) {
  if (!summary) return null;
  const recommendation = readObjectiveRecommendation({
    objective_ranking: summary.objective_ranking,
    robustness: { recommended_option_id: summary.recommended_option_id },
    option_comparison: summary.options,
  });
  return recommendation && summary.winner.option_id === recommendation.option_id &&
    summary.winner.win_probability === recommendation.win_probability
    ? recommendation : null;
}
