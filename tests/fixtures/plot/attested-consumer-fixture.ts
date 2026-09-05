import { EnrichmentObjectiveRankingSchema } from '@talchain/schemas/boundary';

/**
 * Test data only. The caller explicitly declares the producer recommendation.
 * Copy existing comparison figures into the producer contract; never choose a
 * recommendation from those figures or repair a malformed current row.
 */
export function attestedConsumerFixture(
  enrichment: Record<string, unknown>,
  recommendedOptionId: string,
  rows: readonly Record<string, unknown>[],
): Record<string, unknown> {
  const sorted = [...rows].sort((a, b) => Number(b.win_probability) - Number(a.win_probability) ||
    String(a.option_id).localeCompare(String(b.option_id)));
  let rank = 0;
  const rankedOptions = sorted.map((row, index) => {
    if (index === 0 || row.win_probability !== sorted[index - 1].win_probability) rank += 1;
    return { option_id: row.option_id, win_probability: row.win_probability, rank };
  });
  const objective_ranking = EnrichmentObjectiveRankingSchema.parse({
    direction: 'maximise', attested: true, status: 'computed', ranked_options: rankedOptions,
  });
  return {
    ...enrichment,
    option_comparison: rows,
    objective_ranking,
    robustness: { ...(enrichment.robustness as Record<string, unknown> | undefined),
      recommended_option_id: recommendedOptionId },
  };
}

/** Copy the existing request-bound field for a declared attested saved fixture. */
export function boundFixtureShares(enrichment: Record<string, unknown> | undefined): Record<string, number> | undefined {
  const parsed = EnrichmentObjectiveRankingSchema.safeParse(enrichment?.objective_ranking);
  return parsed.success && parsed.data.status === 'computed'
    ? Object.fromEntries(parsed.data.ranked_options.map((option) => [option.option_id, option.win_probability]))
    : undefined;
}
