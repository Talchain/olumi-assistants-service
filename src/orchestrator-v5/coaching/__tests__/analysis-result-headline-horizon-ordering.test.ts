import { describe, expect, it } from 'vitest';
import { GOAL_FIGURES_HORIZON_NOT_TESTED, GOAL_FIGURES_WITHHELD_CODES,
  readOptionResultSources } from '../../../orchestrator/context/option-result-source.js';
import { buildAnalysisResultHeadline, isAllowedRunAnalysisAssistantText } from '../analysis-result-headline.js';

const results = [
  { option_id: 'raise', option_label: 'Raise Pro price', win_probability: 0.94 },
  { option_id: 'keep', option_label: 'Keep Pro price', win_probability: 0.06 },
];
const targetOnly = ['goal_probability', 'joint_probability', 'downside'];
const horizon = { code: GOAL_FIGURES_HORIZON_NOT_TESTED, withheld_claims: targetOnly };
const headline = (enrichment: Record<string, unknown>) => buildAnalysisResultHeadline({
  enrichment, leading_option_id: 'raise', status_kind: 'ok',
});

describe('horizon withholding retains only its licensed ordering', () => {
  it('kept win shares give the identical leader headline without horizon or attainment words', () => {
    const clean = { results };
    const held = { results, inference_warnings: [horizon] };
    const text = headline(held);
    expect(text).toBe(headline(clean));
    expect(text).toBe('Raise Pro price was supported by 94% of runs of this model.');
    expect(isAllowedRunAnalysisAssistantText(text!)).toBe(true);
    expect(text).not.toMatch(/month|on track|in time|meets|reaches|falls short/i);
  });

  it.each([undefined, ['goal_probability', 'win_share']])('missing or withheld ordering claims stay restricted: %j', claims => {
    const enrichment = { results, inference_warnings: [{ code: GOAL_FIGURES_HORIZON_NOT_TESTED, withheld_claims: claims }] };
    expect(readOptionResultSources(enrichment)).toEqual([]);
    expect(headline(enrichment)).toBeNull();
  });

  it.each([...GOAL_FIGURES_WITHHELD_CODES].filter(code => code !== GOAL_FIGURES_HORIZON_NOT_TESTED))(
    'other withheld code %s keeps the original restriction, alone and beside horizon', code => {
      for (const claims of [undefined, targetOnly]) {
        const warning = { code, withheld_claims: claims };
        for (const warnings of [[warning], [horizon, warning], [warning, horizon]]) {
          expect(readOptionResultSources({ results, inference_warnings: warnings })).toEqual([]);
          const current = [{ option_id: 'raise', option_label: 'Raise Pro price' }];
          expect(readOptionResultSources({ results, option_comparison: current, inference_warnings: warnings })).toEqual([current]);
        }
      }
    });
});
