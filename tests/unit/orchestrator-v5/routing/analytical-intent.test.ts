import { describe, it, expect } from 'vitest';
import {
  classifyAnalyticalIntent,
  hasMutationSignal,
  looksLikeVagueEdit,
} from '../../../../src/orchestrator-v5/routing/analytical-intent.js';

describe('classifyAnalyticalIntent', () => {
  describe('rerun_question class', () => {
    const positives = [
      'Do I need to rerun the analysis?',
      'Should we re-run analysis?',
      'Is this analysis still valid?',
      'Are these results stale?',
      'Is the result out of date?',
      'Does this need a rerun?',
    ];
    for (const msg of positives) {
      it(`matches "${msg}"`, () => {
        expect(classifyAnalyticalIntent(msg)).toBe('rerun_question');
      });
    }
  });

  describe('what_would_flip class', () => {
    const positives = [
      'What would flip this result?',
      'What would change the outcome?',
      'What would change the leading option?',
      'What would tip the balance?',
      'What would it take to change this?',
      'What would need to change?',
      'How could another option win?',
    ];
    for (const msg of positives) {
      it(`matches "${msg}"`, () => {
        expect(classifyAnalyticalIntent(msg)).toBe('what_would_flip');
      });
    }
  });

  describe('what_drove class', () => {
    const positives = [
      'What drove this result?',
      'Why did this happen?',
      'What made the result go this way?',
      "What's driving the outcome?",
      'Which factors drove the analysis?',
    ];
    for (const msg of positives) {
      it(`matches "${msg}"`, () => {
        expect(classifyAnalyticalIntent(msg)).toBe('what_drove');
      });
    }
  });

  describe('explain class', () => {
    const positives = [
      'Explain the results.',
      'Walk me through the analysis.',
      'Walk me through this.',
      'Tell me about the results.',
      'What does this mean?',
      'How should I interpret this?',
      'Help me understand the result.',
      'Explain this.',
      'Summarise the results.',
      'Summarize the analysis.',
    ];
    for (const msg of positives) {
      it(`matches "${msg}"`, () => {
        expect(classifyAnalyticalIntent(msg)).toBe('explain');
      });
    }
  });

  describe('negative cases (no analytical intent)', () => {
    const negatives = [
      'Set Pricing to 0.7.',
      'Add a new risk for supply chain.',
      'Remove the demand factor.',
      'Update the model.',
      'Increase the strength of that edge.',
      '',
      '   ',
      'Hi there.',
    ];
    for (const msg of negatives) {
      it(`returns null for "${msg}"`, () => {
        expect(classifyAnalyticalIntent(msg)).toBeNull();
      });
    }
  });

  it('preserves precedence: rerun_question over explain', () => {
    expect(
      classifyAnalyticalIntent('Should I rerun analysis before I explain the results?'),
    ).toBe('rerun_question');
  });
});

describe('looksLikeVagueEdit', () => {
  const positives = [
    'Update something.',
    'Change something please.',
    'Adjust this.',
    'Modify the model.',
    'Fix the graph.',
    'Improve this.',
    'Tweak something.',
    'Make a change.',
    'Make an adjustment.',
    'Do an update.',
    'Can you change something?',
    'Can you adjust the model?',
    'Update.',
    'Adjust.',
  ];
  for (const msg of positives) {
    it(`flags "${msg}" as vague edit`, () => {
      expect(looksLikeVagueEdit(msg)).toBe(true);
    });
  }

  const negatives = [
    // Concrete edits — caught by hasMutationSignal, not vague-edit
    'Set Pricing to 0.7.',
    'Add a new risk for supply chain.',
    'Remove the demand node.',
    // Concrete-target imperative with no value: not vague (the target
    // is named). Must fall through to ambiguous so we do not ask
    // "which factor?" when the user has already named one.
    'Change pricing factor',
    'Change pricing factor.',
    'Update the demand driver',
    'Adjust the supply chain edge',
    // Analytical questions
    'Walk me through the analysis.',
    'What drove this result?',
    'What would flip this?',
    // General conversation — must NOT be flagged as vague edit
    'Hi.',
    'OK, thanks.',
    'That is interesting.',
    'I see.',
    'Something needs to change here.',
    'Why is this happening?',
    '',
    '   ',
  ];
  for (const msg of negatives) {
    it(`does not flag "${msg}" as vague edit`, () => {
      expect(looksLikeVagueEdit(msg)).toBe(false);
    });
  }
});

describe('hasMutationSignal', () => {
  const positives = [
    'Set the pricing factor to 0.7.',
    'Change the demand to 0.5.',
    'Increase pricing to 80%.',
    'Add a new risk.',
    'Remove the demand node.',
    'Adjust the edge from A to B.',
    'Set Pricing.',
  ];
  for (const msg of positives) {
    it(`flags "${msg}" as mutation`, () => {
      expect(hasMutationSignal(msg)).toBe(true);
    });
  }

  const negatives = [
    'What should we update based on this?',
    'Walk me through the analysis.',
    'What drove this result?',
    'Is this stale?',
    '',
  ];
  for (const msg of negatives) {
    it(`does not flag "${msg}"`, () => {
      expect(hasMutationSignal(msg)).toBe(false);
    });
  }
});
