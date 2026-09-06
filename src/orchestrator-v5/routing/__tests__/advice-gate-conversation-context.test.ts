/** C3 fresh-advice boundary. Synthetic phrasings, real gate, no provider. */
import { describe, expect, it } from 'vitest';
import { tryPostAnalysisAdviceGate, type AdviceGateAnalysis } from '../post-analysis-advice-gate.js';

const analysis: AdviceGateAnalysis = {
  status: 'success',
  leading_option: { label: 'Hire a Tech Lead' },
  runner_up: { label: 'Two Developers' },
  top_drivers: [{ factor_label: 'Technical Leadership Capacity' }],
  fragile_edges: [{ from_label: 'Technical Leadership Capacity', to_label: 'Launch readiness' }],
};
const contextualQuestions = [
  'The senior developer can increase productivity; what do you think?',
  'The senior developer cannot increase productivity. What do you think?',
  'What do you think of adding a temporary technical lead?',
  'What do you think — the team already has an informal lead',
  'We already discussed the technical debt; what would you recommend given that context?',
  'The team disagrees about coordination overhead, any thoughts?',
];

describe('fresh advice preserves the opportunity to answer new context', () => {
  it.each(contextualQuestions)('declines a contextual judgement: %j', (message) => {
    const result = tryPostAnalysisAdviceGate({ message, analysis, freshness: 'fresh' });
    expect(result.matched).toBe(false);
  });

  it.each([
    'What would you do next?',
    'Help me understand these results',
    'Walk me through the results',
  ])('keeps a supported analysis request: %j', (message) => {
    expect(tryPostAnalysisAdviceGate({ message, analysis, freshness: 'fresh' }).matched).toBe(true);
  });

  it('keeps mutation precedence for a clear edit with a question', () => {
    expect(tryPostAnalysisAdviceGate({
      message: 'Set churn to 5%. What do you think?', analysis, freshness: 'fresh',
    })).toEqual({ matched: false, reason: 'mutation_signal' });
  });

  it('keeps stale analysis outside the fresh advice gate', () => {
    expect(tryPostAnalysisAdviceGate({
      message: contextualQuestions[0]!, analysis, freshness: 'stale',
    })).toEqual({ matched: false, reason: 'not_fresh' });
  });
});
