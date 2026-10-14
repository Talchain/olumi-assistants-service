/**
 * ⭐ PJ-B3, the headline half (R&C root #70 5860314787; DL 5860325629; AIQ gap 2, 5860454709): the headline never
 * names a factor the analysed graph holds no value for as "the strongest driver" — the same screen's run-turn card
 * asks for its value ("has no value yet"), and one screen must not say both.
 *
 * CAPTURE: `fixtures/t2-c1ddb50.analysis-result-block.trimmed.json` (served). Its `factor_sensitivity` #1 is
 * "Active paid seats" (influence 1, NO `value_source`, while #2–#4 carry `brief_extraction`) — the same signature as
 * journey C's unvalued "Pro paying subscribers" #1. With its goal codes removed it serves today's
 * "…because Active paid seats is the strongest driver."
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAnalysisResultHeadline, type AnalysisResultHeadlineInput } from '../analysis-result-headline.js';
import { collectUnvaluedFactorIds } from '../unvalued-factor-ids.js';

type Json = Record<string, unknown>;
const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/t2-c1ddb50.analysis-result-block.trimmed.json', import.meta.url), 'utf8'),
) as { blocks: Json[] };
const BLOCK = FIXTURE.blocks[0] as Json;
const ENRICHMENT = BLOCK['enrichment'] as Json;
// The goal codes removed (the served headline's T4 control in analysis-result-headline-untestable-goal.test.ts).
const NO_GOAL_CODES: Json = {
  ...ENRICHMENT,
  inference_warnings: (ENRICHMENT['inference_warnings'] as Json[]).filter(
    (w) => !['GOAL_DIRECTION_UNATTESTED', 'GOAL_THRESHOLD_NOT_CONVERTIBLE'].includes(w['code'] as string),
  ),
};
const input = (extra: Partial<AnalysisResultHeadlineInput> = {}): AnalysisResultHeadlineInput => ({
  enrichment: NO_GOAL_CODES, leading_option_id: BLOCK['leading_option_id'] as string, status_kind: 'ok', ...extra,
});
const TODAY = 'Raise to £59 was supported by 81% of runs of this model because Active paid seats is the strongest driver.';

describe('PJ-B3 headline: an unvalued factor is never "the strongest driver"', () => {
  it('precondition: #1 is Active paid seats, with no value_source while the others carry one', () => {
    const rows = (ENRICHMENT['factor_sensitivity'] as Json[]).slice(0, 3).map((r) => [r['factor_id'], r['value_source'] ?? null]);
    expect(rows).toEqual([['active_paid_seats', null], ['monthly_churn_rate', 'brief_extraction'], ['new_seats_per_month', 'brief_extraction']]);
  });

  it('CONTROL: without the set, today\'s served headline (byte-identical)', () => {
    expect(buildAnalysisResultHeadline(input())).toBe(TODAY);
  });

  it('RED: the analysed graph holds no value for Active paid seats → the clause is OMITTED (never a weaker substitute)', () => {
    const text = buildAnalysisResultHeadline(input({ unvaluedFactorIds: new Set(['active_paid_seats']) }));
    expect(text).toBe('Raise to £59 was supported by 81% of runs of this model.');
    expect(text).not.toMatch(/strongest driver/);
  });

  it('CONTRAST: an unvalued factor that is NOT the top leaves the top driver named', () => {
    expect(buildAnalysisResultHeadline(input({ unvaluedFactorIds: new Set(['monthly_churn_rate']) }))).toBe(TODAY);
  });
});

describe('collectUnvaluedFactorIds — the analysed graph is the authority', () => {
  it('a factor with no numeric observed value is unvalued; a valued factor and a non-factor are not', () => {
    const graph = {
      nodes: [
        { id: 'pro_paying_subscribers', kind: 'factor', observed_state: null },
        { id: 'monthly_churn', kind: 'factor' },
        { id: 'pro_plan_price', kind: 'factor', observed_state: { value: 49, source: 'brief_extraction' } },
        { id: 'raw_only', kind: 'factor', observed_state: { raw_value: 300 } },
        { id: 'mrr', kind: 'outcome' },
      ],
    };
    expect([...collectUnvaluedFactorIds(graph)].sort()).toEqual(['monthly_churn', 'pro_paying_subscribers']);
    expect(collectUnvaluedFactorIds(null).size).toBe(0);
  });
});
